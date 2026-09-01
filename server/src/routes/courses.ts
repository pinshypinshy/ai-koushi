import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { CreateCourseRequest } from '../../../shared/api'
import { requireUser } from '../auth/session'
import {
  countCoursesSince,
  createCourse,
  getCourseDetail,
  getCourseState,
  getMaterial,
  listCourses,
  markCourseFailed,
  markQuizFailed,
  resetForRetry,
  resetQuizForRetry,
  setWorkflowId,
} from '../db/queries'
import { monthlyCostUsd } from '../ai/usage'

export const courses = new Hono<AppEnv>()

/** §4.1.2 の入力制約。dev ルートも同じ値を参照する */
export const MATERIAL_MIN_CHARS = 500
export const MATERIAL_MAX_CHARS = 80_000

/** §8.2.3 の上限値 */
const MONTHLY_COURSE_LIMIT = 8
const MONTHLY_COST_LIMIT_USD = 15

/**
 * 月の境界は JST で判定する。利用者の「今月」の感覚に合わせるためであり、
 * 課金プラットフォーム側の集計期間（§8.2.4 の二層目）と一致させる目的ではない。
 */
function monthStartMs(now: number): number {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const jst = new Date(now + JST_OFFSET_MS)
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - JST_OFFSET_MS
}

/**
 * §8.2.4「月間コストが100%に達したら新規の講義作成をブロックする」。
 *
 * 計上には AI 呼び出しの完了までのずれがあるが、集計遅延が数時間ある課金側の
 * 上限（二層目）に対して、こちらは即時に効く層として置く。
 * countsAsNewCourse を分けているのは、再試行が §8.2.3 の「月間の講義作成数」を
 * 消費しないため。失敗した生成のやり直しは新しい講義ではない。
 */
async function creationBlockedReason(
  db: D1Database,
  userId: string,
  countsAsNewCourse: boolean,
): Promise<string | null> {
  const since = monthStartMs(Date.now())

  const cost = await monthlyCostUsd(db, userId, since)
  if (cost >= MONTHLY_COST_LIMIT_USD) {
    return `今月のAI利用額が上限（$${MONTHLY_COST_LIMIT_USD}）に達したため、新しい生成を行えません。`
  }
  if (countsAsNewCourse) {
    const count = await countCoursesSince(db, userId, since)
    if (count >= MONTHLY_COURSE_LIMIT) {
      return `今月の講義作成数が上限（${MONTHLY_COURSE_LIMIT}件）に達しています。`
    }
  }
  return null
}

/**
 * §6.4「初回ロード」。講義一覧・選択中講義・ユーザーを1往復で返す。
 * CSR のウォーターフォールへの対処であり、機能ごとに API を分けて往復させない（§7.6）。
 */
courses.get('/bootstrap', requireUser, async (c) => {
  const user = c.get('user')
  const list = await listCourses(c.env.DB, user.id)

  const requested = c.req.query('courseId')
  const targetId = requested ?? list[0]?.id ?? null
  const selected = targetId ? await getCourseDetail(c.env.DB, user.id, targetId) : null

  // 明示指定された講義が引けない場合のみ 404。他ユーザーの講義IDもここに含まれる（SEC-2）
  if (requested && !selected) {
    return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  }
  return c.json({ user, courses: list, selected })
})

courses.get('/courses/:id', requireUser, async (c) => {
  const user = c.get('user')
  const detail = await getCourseDetail(c.env.DB, user.id, c.req.param('id'))
  if (!detail) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  return c.json(detail)
})

/** 教材原文は最大240KB になるため、講義本体とは別に取得する（§4.4） */
courses.get('/courses/:id/material', requireUser, async (c) => {
  const user = c.get('user')
  const material = await getMaterial(c.env.DB, user.id, c.req.param('id'))
  if (!material) return c.json({ error: 'not_found', message: '教材が見つかりません' }, 404)
  return c.json(material)
})


/**
 * §4.1.4 講義作成。教材を保存して Workflow を起動し、完了を待たずに講義IDを返す。
 * 生成には3分前後かかるため（§7.4）、以降の進捗はフロントがポーリングで見る。
 */
courses.post('/courses', requireUser, async (c) => {
  const user = c.get('user')

  const body = await c.req.json<CreateCourseRequest>().catch(() => null)
  if (!body || typeof body.material !== 'string') {
    return c.json({ error: 'invalid_request', message: '教材が指定されていません' }, 400)
  }

  const material = body.material
  if (material.length < MATERIAL_MIN_CHARS || material.length > MATERIAL_MAX_CHARS) {
    return c.json(
      {
        error: 'invalid_material',
        message: `教材は${MATERIAL_MIN_CHARS}〜${MATERIAL_MAX_CHARS}文字である必要があります（${material.length}文字）`,
      },
      400,
    )
  }

  const blocked = await creationBlockedReason(c.env.DB, user.id, true)
  if (blocked) return c.json({ error: 'limit_exceeded', message: blocked }, 403)

  /**
   * タイトル未入力は空文字として保存する。AI が命名したかどうかを別列で持たなくても、
   * 「空なら AI に命名させる」という判定が再試行時にもそのまま成立する（§5.2）。
   */
  const title = (body.title ?? '').trim()
  const courseId = crypto.randomUUID()
  await createCourse(c.env.DB, user.id, { courseId, title, material })

  try {
    const instance = await c.env.COURSE_WORKFLOW.create({
      params: { courseId, userId: user.id, mode: 'full', applyGeneratedTitle: title.length === 0 },
    })
    await setWorkflowId(c.env.DB, courseId, instance.id)
  } catch (err) {
    // 起動に失敗した講義を generating のまま残すと、永久に完了しない行になる
    console.error('workflow_create_failed', courseId, err)
    await markCourseFailed(c.env.DB, courseId, '生成ジョブの起動に失敗しました')
    return c.json({ error: 'workflow_failed', message: '生成を開始できませんでした' }, 502)
  }

  return c.json({ courseId }, 202)
})

/** §4.1.6「骨子生成失敗」からの再試行。①からやり直す */
courses.post('/courses/:id/retry', requireUser, async (c) => {
  const user = c.get('user')
  const courseId = c.req.param('id')

  const state = await getCourseState(c.env.DB, user.id, courseId)
  if (!state) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  // §7.4「status=generating の講義には新規のWorkflowを起動しない」
  if (state.status === 'generating') {
    return c.json({ error: 'already_generating', message: '生成中です' }, 409)
  }
  if (state.status !== 'failed') {
    return c.json({ error: 'not_failed', message: 'この講義は失敗していません' }, 409)
  }

  const blocked = await creationBlockedReason(c.env.DB, user.id, false)
  if (blocked) return c.json({ error: 'limit_exceeded', message: blocked }, 403)

  await resetForRetry(c.env.DB, courseId)
  try {
    const instance = await c.env.COURSE_WORKFLOW.create({
      params: {
        courseId,
        userId: user.id,
        mode: 'full',
        applyGeneratedTitle: state.title.length === 0,
      },
    })
    await setWorkflowId(c.env.DB, courseId, instance.id)
  } catch (err) {
    console.error('workflow_create_failed', courseId, err)
    await markCourseFailed(c.env.DB, courseId, '生成ジョブの起動に失敗しました')
    return c.json({ error: 'workflow_failed', message: '生成を開始できませんでした' }, 502)
  }

  return c.json({ courseId }, 202)
})

/**
 * §4.1.6「確認テスト生成失敗」からの再生成。②だけをやり直す。
 * 骨子は保存済みであり、①を再実行すればステップIDが変わって対話や解答記録との
 * 対応が壊れるため、この経路では触らない。
 */
courses.post('/courses/:id/quiz/retry', requireUser, async (c) => {
  const user = c.get('user')
  const courseId = c.req.param('id')

  const state = await getCourseState(c.env.DB, user.id, courseId)
  if (!state) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  if (state.quizStatus === 'pending') {
    return c.json({ error: 'already_generating', message: '確認テストを生成中です' }, 409)
  }
  if (state.quizStatus !== 'failed') {
    return c.json({ error: 'not_failed', message: '確認テストは失敗していません' }, 409)
  }

  const blocked = await creationBlockedReason(c.env.DB, user.id, false)
  if (blocked) return c.json({ error: 'limit_exceeded', message: blocked }, 403)

  await resetQuizForRetry(c.env.DB, courseId)
  try {
    const instance = await c.env.COURSE_WORKFLOW.create({
      params: { courseId, userId: user.id, mode: 'quiz', applyGeneratedTitle: false },
    })
    await setWorkflowId(c.env.DB, courseId, instance.id)
  } catch (err) {
    // pending のまま放置すると「生成中」の表示から戻れなくなる
    console.error('workflow_create_failed', courseId, err)
    await markQuizFailed(c.env.DB, courseId)
    return c.json({ error: 'workflow_failed', message: '生成を開始できませんでした' }, 502)
  }

  return c.json({ courseId }, 202)
})
