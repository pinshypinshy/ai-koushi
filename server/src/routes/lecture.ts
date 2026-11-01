import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import type { LectureStreamLine, SendMessageRequest } from '../../../shared/api'
import { requireUser } from '../auth/session'
import { collectUsage, createAiClient, flushUsage } from '../ai/factory'
import type { LectureContext, Turn } from '../ai/types'
import {
  completeStep,
  courseTokenTotals,
  getCourseDetail,
  insertMessage,
  isCurrentStep,
  loadLectureContext,
  replaceInterruptedMessage,
  type LectureContextRow,
  type StoredMessage,
} from '../db/queries'

/**
 * 受講（§4.2）。③講義本文生成・④質問応答・⑤ステップ要約生成をここで扱う。
 * ③と④の呼び分けは、ユーザーの発言が付いているかどうかで決める。
 * 途中で失敗した③④の再生成（§5.7）もここで扱う。
 */
export const lecture = new Hono<AppEnv>()

/**
 * §8.2.3「講義1件あたりの累積トークン」。暴走を止めるための値であり、
 * 通常の受講では触れない水準に置いてある。超過時はその講義での生成を停止する。
 */
const COURSE_INPUT_TOKEN_LIMIT = 2_000_000
const COURSE_OUTPUT_TOKEN_LIMIT = 100_000

/** §8.4 のログ要件と揃える。長大なスタックはそのまま載せない */
function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

function line(value: LectureStreamLine): string {
  return `${JSON.stringify(value)}\n`
}

/**
 * 1ターンで何を生成し、どこへ保存するか。
 * 新しい応答と再生成（§5.7、Q-33）で違うのはここだけで、生成と保存の手順は共通にする。
 */
interface TurnPlan {
  /** ④の質問。null なら③講義本文 */
  question: string | null
  /** プロンプトに載せる対話。質問は turn プロンプト側で別に載せるため含めない（二重に載る） */
  history: Turn[]
  /** 置き換える途切れた発言。新しい発言として保存する場合は null */
  replacing: StoredMessage | null
}

const toTurns = (messages: StoredMessage[]): Turn[] =>
  messages.map((m) => ({ role: m.role, content: m.content }))

/**
 * 再生成で何をやり直すかを、現在のステップの発言から決める（§5.7、Q-33）。
 *
 * 履歴は失敗した応答の直前までに切り詰め、失敗したときと同じプロンプトを組む。
 * 途切れた箇所から続けさせる案は、どこで切れたか・どこから書くかの解釈を AI に委ねることになり、
 * 出力が読めない形で始まるおそれがあるため採らなかった。
 *
 * ③か④かをクライアントに送らせないのは、④の受け口が質問を新しく保存するため。
 * 同じ質問で呼び直すと質問が二重に残り、履歴も失敗時と変わってしまう。
 */
export function regeneratePlan(messages: StoredMessage[]): TurnPlan | null {
  const last = messages[messages.length - 1]
  // ③が1文字も届かずに失敗した。ステップの冒頭からやり直す
  if (!last) return { question: null, history: [], replacing: null }
  // ④が1文字も届かずに失敗した。質問は保存済みなので、その質問で④をやり直す
  if (last.role === 'user') {
    return { question: last.content, history: toTurns(messages.slice(0, -1)), replacing: null }
  }
  // 最後まで届いた応答は再生成しない。やり直したいなら質問を送ればよい
  if (!last.interrupted) return null
  const prev = messages[messages.length - 2]
  if (prev?.role === 'user') {
    return { question: prev.content, history: toTurns(messages.slice(0, -2)), replacing: last }
  }
  return { question: null, history: toTurns(messages.slice(0, -1)), replacing: last }
}

/** ③④と再生成に共通する前提の確認。講義が存在し、講義単位の上限に達していないこと */
async function loadTurnContext(
  c: Context<AppEnv>,
  courseId: string,
): Promise<LectureContextRow | Response> {
  const ctx = await loadLectureContext(c.env.DB, c.get('user').id, courseId)
  if (!ctx) {
    return c.json({ error: 'not_found', message: '受講できる状態ではありません' }, 404)
  }

  const totals = await courseTokenTotals(c.env.DB, courseId)
  if (totals.input >= COURSE_INPUT_TOKEN_LIMIT || totals.output >= COURSE_OUTPUT_TOKEN_LIMIT) {
    return c.json(
      { error: 'limit_exceeded', message: 'この講義の生成量が上限に達しました' },
      403,
    )
  }
  return ctx
}

/** ③④の新しい1ターン */
async function handleTurn(c: Context<AppEnv>, courseId: string, question: string | null) {
  const ctx = await loadTurnContext(c, courseId)
  if (ctx instanceof Response) return ctx

  // 発話はステップに紐づけて保存する（§4.2.1）。応答の生成前に保存するのは、
  // 生成が失敗しても利用者の発言が消えないようにするため
  if (question !== null) {
    await insertMessage(c.env.DB, courseId, ctx.currentStepId, 'user', question)
  }
  return runTurn(c, courseId, ctx, { question, history: ctx.history, replacing: null })
}

/**
 * 生成して流し、保存する。
 *
 * 応答は NDJSON で流す（1行1件のJSON）。文字の断片に加えて、保存された発言の id と
 * 途中で発生した失敗を同じ経路で伝えるためである。
 */
async function runTurn(
  c: Context<AppEnv>,
  courseId: string,
  ctx: LectureContextRow,
  plan: TurnPlan,
) {
  const user = c.get('user')
  const { question } = plan

  // 完了済みの講義で通すのは④だけにする（§4.2.4、Q-32）。③まで通すと最後のステップの
  // 解説がもう一度流れ、「全ステップが完了しました」の表示と食い違う
  if (ctx.allCompleted && question === null) {
    return c.json({ error: 'course_completed', message: '全ステップが完了しています' }, 409)
  }

  const aiContext: LectureContext = {
    courseId,
    material: ctx.material,
    outline: ctx.outline,
    completedSummaries: ctx.completedSummaries,
    currentStep: ctx.currentStep,
    history: plan.history,
    allCompleted: ctx.allCompleted,
  }

  c.header('content-type', 'application/x-ndjson; charset=utf-8')
  // 生成に数十秒かかる。途中結果を握り込まれると §8.1 の初回トークン到達時間を満たせない
  c.header('cache-control', 'no-store')
  c.header('x-content-type-options', 'nosniff')

  return stream(c, async (s) => {
    const { sink, records } = collectUsage()
    const client = createAiClient(c.env, sink)
    let text = ''
    try {
      const iterator =
        question === null
          ? client.streamLecture(aiContext)
          : client.streamAnswer({ ...aiContext, question })
      for await (const chunk of iterator) {
        text += chunk
        await s.write(line({ delta: chunk }))
      }
      const saved = plan.replacing
        ? await replaceInterruptedMessage(
            c.env.DB,
            courseId,
            ctx.currentStepId,
            plan.replacing,
            text,
            false,
          )
        : await insertMessage(c.env.DB, courseId, ctx.currentStepId, 'assistant', text)
      await s.write(line({ done: saved }))
    } catch (err) {
      // §5.7「ストリーミング中断：部分生成分を保存し、再生成ボタンを提示する」。
      // 課金は発生済みであり、途中まで読めるものを捨てる理由がない。
      // 途切れた印を残すのは、再読み込みの後も再生成の導線を出すため（Q-33）
      const partial = text.trim().length > 0
      if (partial) {
        if (plan.replacing) {
          await replaceInterruptedMessage(
            c.env.DB,
            courseId,
            ctx.currentStepId,
            plan.replacing,
            text,
            true,
          )
        } else {
          await insertMessage(c.env.DB, courseId, ctx.currentStepId, 'assistant', text, true)
        }
      }
      console.error('lecture_stream_failed', courseId, messageOf(err))
      await s.write(line({ error: { message: messageOf(err), partialSaved: partial } }))
    } finally {
      // 応答の成否に関わらず計上する（§8.2.4）
      await flushUsage(c.env, user.id, courseId, records)
    }
  })
}

/** ③ 現在のステップの講義本文。ステップに到達した時点で呼ぶ（§4.2.2） */
lecture.post('/courses/:id/lecture', requireUser, (c) => handleTurn(c, c.req.param('id'), null))

/** ④ 質問応答（§4.2.4）。理解の確認に対する応答もここを通る */
lecture.post('/courses/:id/messages', requireUser, async (c) => {
  const body = await c.req.json<SendMessageRequest>().catch(() => null)
  const text = body?.text?.trim()
  if (!text) {
    return c.json({ error: 'invalid_request', message: '本文が空です' }, 400)
  }
  return handleTurn(c, c.req.param('id'), text)
})

/**
 * 途中で失敗した③④の再生成（§5.7、Q-33）。失敗したときと同じプロンプトを送り直す。
 * 何をやり直すかはサーバーが決める（regeneratePlan）。
 */
lecture.post('/courses/:id/regenerate', requireUser, async (c) => {
  const courseId = c.req.param('id')
  const ctx = await loadTurnContext(c, courseId)
  if (ctx instanceof Response) return ctx

  const plan = regeneratePlan(ctx.stepMessages)
  if (!plan) {
    return c.json(
      { error: 'nothing_to_regenerate', message: '再生成する応答がありません' },
      409,
    )
  }
  return runTurn(c, courseId, ctx, plan)
})

/**
 * ⑤ ステップ完了（§4.2.2）。
 * 完了はユーザーが次へ進むことに同意した時点であり、確認テストの通過は条件に含めない（Q-4）。
 */
lecture.post('/courses/:id/steps/:stepId/complete', requireUser, async (c) => {
  const user = c.get('user')
  const courseId = c.req.param('id')
  const stepId = c.req.param('stepId')

  if (!(await isCurrentStep(c.env.DB, user.id, courseId, stepId))) {
    return c.json({ error: 'not_current_step', message: '現在のステップではありません' }, 409)
  }
  const ctx = await loadLectureContext(c.env.DB, user.id, courseId)
  if (!ctx) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)

  const { sink, records } = collectUsage()
  const client = createAiClient(c.env, sink)
  let summary = ''
  try {
    summary = await client.summarizeStep({ step: ctx.currentStep, history: ctx.history })
  } catch (err) {
    // 要約は次ステップ以降の文脈を軽くするためのものであり（§5.4「進捗」層）、
    // これが作れないことを理由に進行を止める価値はない。空のまま完了させる
    console.error('summary_failed', courseId, stepId, messageOf(err))
  } finally {
    await flushUsage(c.env, user.id, courseId, records)
  }

  await completeStep(c.env.DB, courseId, stepId, summary)

  const detail = await getCourseDetail(c.env.DB, user.id, courseId)
  if (!detail) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  return c.json(detail)
})
