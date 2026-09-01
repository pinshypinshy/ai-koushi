import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import type { LectureStreamLine, SendMessageRequest } from '../../../shared/api'
import { requireUser } from '../auth/session'
import { collectUsage, createAiClient, flushUsage } from '../ai/factory'
import type { LectureContext } from '../ai/types'
import {
  completeStep,
  courseTokenTotals,
  getCourseDetail,
  insertMessage,
  isCurrentStep,
  loadLectureContext,
} from '../db/queries'

/**
 * 受講（§4.2）。③講義本文生成・④質問応答・⑤ステップ要約生成をここで扱う。
 * ③と④の呼び分けは、ユーザーの発言が付いているかどうかで決める。
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
 * ③④に共通する1ターンの処理。
 *
 * 応答は NDJSON で流す（1行1件のJSON）。文字の断片に加えて、保存された発言の id と
 * 途中で発生した失敗を同じ経路で伝えるためである。
 */
async function handleTurn(c: Context<AppEnv>, courseId: string, question: string | null) {
  const user = c.get('user')

  const ctx = await loadLectureContext(c.env.DB, user.id, courseId)
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

  // 発話はステップに紐づけて保存する（§4.2.1）。応答の生成前に保存するのは、
  // 生成が失敗しても利用者の発言が消えないようにするため
  if (question !== null) {
    await insertMessage(c.env.DB, courseId, ctx.currentStepId, 'user', question)
  }

  const aiContext: LectureContext = {
    courseId,
    material: ctx.material,
    outline: ctx.outline,
    completedSummaries: ctx.completedSummaries,
    currentStep: ctx.currentStep,
    // 質問は turn プロンプト側で別に載せるため、履歴には含めない（二重に載る）
    history: ctx.history,
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
      const saved = await insertMessage(
        c.env.DB,
        courseId,
        ctx.currentStepId,
        'assistant',
        text,
      )
      await s.write(line({ done: saved }))
    } catch (err) {
      // §5.7「ストリーミング中断：部分生成分を保存し、再生成ボタンを提示する」。
      // 課金は発生済みであり、途中まで読めるものを捨てる理由がない
      const partial = text.trim().length > 0
      if (partial) {
        await insertMessage(c.env.DB, courseId, ctx.currentStepId, 'assistant', text)
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
