import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { AccessResult, AdminConfig, AiPurpose } from '../../../shared/api'
import { requireAdmin } from '../auth/admin'
import { LIMITS, monthStartMs } from '../limits'
import {
  getAdminSummary,
  getAdminUser,
  listAdminAccess,
  listAdminAllowlist,
  listAdminCourses,
  listAdminGuests,
  listAdminUsage,
  listAdminUsers,
} from '../db/admin'
import {
  lectureSystemPrompt,
  outlineSystemPrompt,
  quizSystemPrompt,
  summarySystemPrompt,
  wrapMaterial,
} from '../ai/prompts'

/**
 * 運営管理ページ（§4.7）。段階1は読み取りのみで、更新系のルートを持たない。
 *
 * requireAdmin は各ルートに明示して当てる。`/api/admin/*` にワイルドカードで
 * 当てると、後から別プレフィックスで生やしたルートの扱いが暗黙になる（CLAUDE.md）。
 */
export const admin = new Hono<AppEnv>()

/** 一覧の既定件数と上限。画面が固まらない範囲に収める */
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function parseLimit(raw: string | undefined): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(value), MAX_LIMIT)
}

const PURPOSES: AiPurpose[] = ['outline', 'quiz', 'lecture', 'answer', 'summary']
const RESULTS: AccessResult[] = ['success', 'denied', 'failed', 'locked']

function parsePurpose(raw: string | undefined): AiPurpose | undefined {
  return PURPOSES.find((p) => p === raw)
}
function parseResult(raw: string | undefined): AccessResult | undefined {
  return RESULTS.find((r) => r === raw)
}

admin.get('/summary', requireAdmin, async (c) => {
  return c.json(await getAdminSummary(c.env.DB, monthStartMs(Date.now())))
})

admin.get('/users', requireAdmin, async (c) => {
  return c.json({ users: await listAdminUsers(c.env.DB, monthStartMs(Date.now())) })
})

/** 利用者1人ぶん。講義・AI呼び出し・ログインを1往復で返す（画面がタブごとに往復しない） */
admin.get('/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const periodStart = monthStartMs(Date.now())
  const user = await getAdminUser(c.env.DB, id, periodStart)
  if (!user) return c.json({ error: 'not_found', message: '利用者が見つかりません' }, 404)

  const [courses, usage, access] = await Promise.all([
    listAdminCourses(c.env.DB, id),
    listAdminUsage(c.env.DB, { limit: 50, userId: id }),
    listAdminAccess(c.env.DB, { limit: 50, userId: id }),
  ])
  return c.json({ user, courses, usage: usage.rows, access: access.rows })
})

admin.get('/usage', requireAdmin, async (c) => {
  const result = await listAdminUsage(c.env.DB, {
    limit: parseLimit(c.req.query('limit')),
    purpose: parsePurpose(c.req.query('purpose')),
    errorsOnly: c.req.query('errorsOnly') === '1',
    userId: c.req.query('userId') || undefined,
  })
  return c.json(result)
})

admin.get('/access', requireAdmin, async (c) => {
  const result = await listAdminAccess(c.env.DB, {
    limit: parseLimit(c.req.query('limit')),
    result: parseResult(c.req.query('result')),
    failuresOnly: c.req.query('failuresOnly') === '1',
    userId: c.req.query('userId') || undefined,
  })
  return c.json(result)
})

admin.get('/allowlist', requireAdmin, async (c) => {
  return c.json({ rows: await listAdminAllowlist(c.env.DB) })
})

admin.get('/guests', requireAdmin, async (c) => {
  return c.json({ rows: await listAdminGuests(c.env.DB) })
})

/**
 * 設定の表示。モデルID・上限値・システムプロンプトを返す。
 *
 * プロンプトはコードの中身ではなく、関数を実際に呼んで得た文字列を返す。
 * 「今このサーバーが何を送っているか」が知りたい対象であり、ソースを読む代替では
 * 引数で変わる部分の確認にならないため。引数依存の箇所は note で断る。
 *
 * 秘密（GEMINI_API_KEY・SESSION_SECRET・OAuth のクライアント秘密）は返さない（SEC-1）。
 */
admin.get('/config', requireAdmin, (c) => {
  const config: AdminConfig = {
    models: [
      { purpose: 'outline', model: c.env.MODEL_OUTLINE },
      { purpose: 'quiz', model: c.env.MODEL_QUIZ },
      { purpose: 'lecture', model: c.env.MODEL_LECTURE },
      { purpose: 'answer', model: c.env.MODEL_ANSWER },
      { purpose: 'summary', model: c.env.MODEL_SUMMARY },
    ],
    limits: [
      { kind: 'google', courses: LIMITS.google.courses, costUsd: LIMITS.google.costUsd },
      { kind: 'guest', courses: LIMITS.guest.courses, costUsd: LIMITS.guest.costUsd },
    ],
    prompts: [
      {
        key: 'outline',
        label: '① 骨子生成',
        note: 'タイトルを指定せずに作成した場合の文面。指定するとタイトル行が置き換わる',
        body: outlineSystemPrompt(),
      },
      { key: 'quiz', label: '② 確認テスト生成', note: null, body: quizSystemPrompt() },
      {
        key: 'lecture',
        label: '③④ 講義本文・質問応答',
        note: '末尾の「講義全体の構成」には講義ごとの骨子が差し込まれる（ここでは空）',
        body: lectureSystemPrompt([]),
      },
      { key: 'summary', label: '⑤ ステップ要約生成', note: null, body: summarySystemPrompt() },
      {
        key: 'material',
        label: '教材の囲い込み（SEC-4）',
        note: '教材はこの形で囲ってからプロンプトに載せる。内側は教材原文に置き換わる',
        body: wrapMaterial('（ここに教材の原文が入る）'),
      },
    ],
  }
  return c.json(config)
})
