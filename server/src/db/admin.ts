import type {
  AccessResult,
  AccountKind,
  AdminAccessRow,
  AdminAllowedEmailRow,
  AdminCourseRow,
  AdminGuestRow,
  AdminSummary,
  AdminUsageRow,
  AdminUserRow,
  AiPurpose,
} from '../../../shared/api'
import type { CourseStatus, QuizStatus } from '../../../shared/api'
import { LIMITS } from '../limits'

/**
 * 運営管理ページ（§4.7）の読み取りクエリ。
 *
 * ここだけが利用者の垣根を越えて全員分を読む。他のクエリは必ず user_id で
 * 絞る（SEC-2）ため、境界を跨ぐ SQL をこのファイルに閉じ込め、requireAdmin が
 * 付いていない経路から呼ばれていないことを1箇所で確かめられるようにする。
 */

/** 0 を NULL として扱う。SQLite の MAX(x, y) は引数に NULL があると NULL を返すため */
function orNull(value: number | null): number | null {
  return value ? value : null
}

export async function getAdminSummary(db: D1Database, periodStart: number): Promise<AdminSummary> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users WHERE kind = 'guest') AS guests,
         (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
         (SELECT COUNT(*) FROM allowed_emails) AS allowed_emails,
         (SELECT COUNT(*) FROM courses) AS courses,
         -- 全体の実件数。利用者行の courses_month（上限判定と同じ数え方）とは違い、
         -- 複製も含める。ここは上限と突き合わせる値ではなく、稼働の把握が目的である
         (SELECT COUNT(*) FROM courses WHERE created_at >= ?1) AS courses_month,
         (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM ai_usage_logs
           WHERE created_at >= ?1) AS cost_month,
         (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM ai_usage_logs) AS cost_total,
         (SELECT COUNT(*) FROM ai_usage_logs
           WHERE error IS NOT NULL AND created_at >= ?1) AS ai_errors,
         (SELECT COUNT(*) FROM access_logs
           WHERE result <> 'success' AND created_at >= ?1) AS signin_failures`,
    )
    .bind(periodStart)
    .first<{
      users: number
      guests: number
      admins: number
      allowed_emails: number
      courses: number
      courses_month: number
      cost_month: number
      cost_total: number
      ai_errors: number
      signin_failures: number
    }>()

  return {
    users: row?.users ?? 0,
    guests: row?.guests ?? 0,
    admins: row?.admins ?? 0,
    allowedEmails: row?.allowed_emails ?? 0,
    courses: row?.courses ?? 0,
    coursesThisMonth: row?.courses_month ?? 0,
    costThisMonthUsd: row?.cost_month ?? 0,
    costTotalUsd: row?.cost_total ?? 0,
    aiErrorsThisMonth: row?.ai_errors ?? 0,
    signInFailuresThisMonth: row?.signin_failures ?? 0,
    periodStart,
  }
}

interface UserAggregateRow {
  id: string
  email: string
  display_name: string
  kind: AccountKind
  is_admin: number
  created_at: number
  last_login_at: number | null
  courses: number
  courses_month: number
  cost_month: number
  cost_total: number
}

/**
 * 最終ログインは access_logs（§4.7 で新設）と guest_accounts.last_login_at の
 * 新しい方を採る。記録を始める前のゲストは後者にしか痕跡が無いため。
 */
const LAST_LOGIN_SQL = `
  MAX(
    COALESCE((SELECT MAX(a.created_at) FROM access_logs a
               WHERE a.user_id = u.id AND a.result = 'success'), 0),
    COALESCE((SELECT g.last_login_at FROM guest_accounts g WHERE g.user_id = u.id), 0)
  )`

function toUserRow(row: UserAggregateRow): AdminUserRow {
  // 上限は種別で決まる（§8.2.3）。画面側で引き直すと limits.ts と二重定義になる
  const limit = LIMITS[row.kind]
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    kind: row.kind,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    lastLoginAt: orNull(row.last_login_at),
    courses: row.courses,
    coursesThisMonth: row.courses_month,
    courseLimit: limit.courses,
    costThisMonthUsd: row.cost_month,
    costLimitUsd: limit.costUsd,
    costTotalUsd: row.cost_total,
  }
}

const USER_SELECT_SQL = `
  SELECT u.id, u.email, u.display_name, u.kind, u.is_admin, u.created_at,
         ${LAST_LOGIN_SQL} AS last_login_at,
         (SELECT COUNT(*) FROM courses c WHERE c.user_id = u.id) AS courses,
         -- 複製（duplicated_from が入る行）は数えない。courseLimit と並べて出す値であり、
         -- 実際にブロックされる境界（countCoursesSince、Q-30）と数え方を揃える
         (SELECT COUNT(*) FROM courses c
           WHERE c.user_id = u.id AND c.created_at >= ?1
             AND c.duplicated_from IS NULL) AS courses_month,
         (SELECT COALESCE(SUM(l.estimated_cost_usd), 0) FROM ai_usage_logs l
           WHERE l.user_id = u.id AND l.created_at >= ?1) AS cost_month,
         (SELECT COALESCE(SUM(l.estimated_cost_usd), 0) FROM ai_usage_logs l
           WHERE l.user_id = u.id) AS cost_total
  FROM users u`

export async function listAdminUsers(
  db: D1Database,
  periodStart: number,
): Promise<AdminUserRow[]> {
  const res = await db
    .prepare(`${USER_SELECT_SQL} ORDER BY u.created_at`)
    .bind(periodStart)
    .all<UserAggregateRow>()
  return (res.results ?? []).map(toUserRow)
}

export async function getAdminUser(
  db: D1Database,
  userId: string,
  periodStart: number,
): Promise<AdminUserRow | null> {
  const row = await db
    .prepare(`${USER_SELECT_SQL} WHERE u.id = ?2`)
    .bind(periodStart, userId)
    .first<UserAggregateRow>()
  return row ? toUserRow(row) : null
}

/** 利用者詳細の講義一覧。本人の画面では出さない教材文字数と講義単位のコストを足す */
export async function listAdminCourses(
  db: D1Database,
  userId: string,
): Promise<AdminCourseRow[]> {
  const res = await db
    .prepare(
      `SELECT c.id, c.title, c.status, c.quiz_status, c.error_message,
              c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM steps s WHERE s.course_id = c.id) AS total_steps,
              (SELECT COUNT(*) FROM steps s
                WHERE s.course_id = c.id AND s.status = 'completed') AS completed_steps,
              (SELECT COUNT(*) FROM questions q WHERE q.course_id = c.id) AS questions,
              (SELECT COALESCE(m.char_count, 0) FROM materials m
                WHERE m.course_id = c.id) AS material_chars,
              (SELECT COALESCE(SUM(l.estimated_cost_usd), 0) FROM ai_usage_logs l
                WHERE l.course_id = c.id) AS cost
       FROM courses c WHERE c.user_id = ?1 ORDER BY c.updated_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string
      title: string
      status: CourseStatus
      quiz_status: QuizStatus
      error_message: string | null
      created_at: number
      updated_at: number
      total_steps: number
      completed_steps: number
      questions: number
      material_chars: number
      cost: number
    }>()

  return (res.results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    quizStatus: r.quiz_status,
    errorMessage: r.error_message,
    totalSteps: r.total_steps,
    completedSteps: r.completed_steps,
    questions: r.questions,
    materialChars: r.material_chars,
    costUsd: r.cost,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

/**
 * 一覧は limit + 1 件を読み、超過分で hasMore を立てる。
 * 黙って切ると「これで全部」と読み違えるため、切った事実を画面に出す。
 */
export interface UsageFilter {
  limit: number
  userId?: string
  purpose?: AiPurpose
  errorsOnly?: boolean
}

export async function listAdminUsage(
  db: D1Database,
  filter: UsageFilter,
): Promise<{ rows: AdminUsageRow[]; hasMore: boolean }> {
  const where: string[] = []
  const binds: unknown[] = []
  if (filter.userId) {
    where.push('l.user_id = ?')
    binds.push(filter.userId)
  }
  if (filter.purpose) {
    where.push('l.purpose = ?')
    binds.push(filter.purpose)
  }
  if (filter.errorsOnly) where.push('l.error IS NOT NULL')
  binds.push(filter.limit + 1)

  const res = await db
    .prepare(
      `SELECT l.id, l.user_id, l.course_id, l.purpose, l.model,
              l.input_tokens, l.cached_input_tokens, l.output_tokens, l.thinking_tokens,
              l.estimated_cost_usd, l.duration_ms, l.error, l.created_at,
              u.email AS user_email, c.title AS course_title
       FROM ai_usage_logs l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN courses c ON c.id = l.course_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY l.created_at DESC LIMIT ?`,
    )
    .bind(...binds)
    .all<{
      id: string
      user_id: string
      course_id: string | null
      purpose: AiPurpose
      model: string
      input_tokens: number
      cached_input_tokens: number
      output_tokens: number
      thinking_tokens: number
      estimated_cost_usd: number
      duration_ms: number
      error: string | null
      created_at: number
      user_email: string | null
      course_title: string | null
    }>()

  const all = res.results ?? []
  const hasMore = all.length > filter.limit
  return {
    hasMore,
    rows: all.slice(0, filter.limit).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      courseId: r.course_id,
      courseTitle: r.course_title,
      purpose: r.purpose,
      model: r.model,
      inputTokens: r.input_tokens,
      cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens,
      thinkingTokens: r.thinking_tokens,
      estimatedCostUsd: r.estimated_cost_usd,
      durationMs: r.duration_ms,
      error: r.error,
      createdAt: r.created_at,
    })),
  }
}

export interface AccessFilter {
  limit: number
  userId?: string
  result?: AccessResult
  /** 成功以外だけを見る。総当たりと許可漏れの確認に使う */
  failuresOnly?: boolean
}

export async function listAdminAccess(
  db: D1Database,
  filter: AccessFilter,
): Promise<{ rows: AdminAccessRow[]; hasMore: boolean }> {
  const where: string[] = []
  const binds: unknown[] = []
  if (filter.userId) {
    where.push('a.user_id = ?')
    binds.push(filter.userId)
  }
  if (filter.result) {
    where.push('a.result = ?')
    binds.push(filter.result)
  }
  if (filter.failuresOnly) where.push("a.result <> 'success'")
  binds.push(filter.limit + 1)

  const res = await db
    .prepare(
      `SELECT a.id, a.user_id, a.kind, a.identifier, a.result, a.ip, a.created_at,
              u.email AS user_email
       FROM access_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .bind(...binds)
    .all<{
      id: string
      user_id: string | null
      kind: AccountKind
      identifier: string
      result: AccessResult
      ip: string | null
      created_at: number
      user_email: string | null
    }>()

  const all = res.results ?? []
  const hasMore = all.length > filter.limit
  return {
    hasMore,
    rows: all.slice(0, filter.limit).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      kind: r.kind,
      identifier: r.identifier,
      result: r.result,
      ip: r.ip,
      createdAt: r.created_at,
    })),
  }
}

/** 許可リスト。追加しただけで未サインインの行を見分けられるよう、利用者の有無を併記する */
export async function listAdminAllowlist(db: D1Database): Promise<AdminAllowedEmailRow[]> {
  const res = await db
    .prepare(
      `SELECT e.email, e.note, e.created_at, u.id AS user_id,
              (SELECT MAX(a.created_at) FROM access_logs a
                WHERE a.user_id = u.id AND a.result = 'success') AS last_login_at
       FROM allowed_emails e
       LEFT JOIN users u ON u.email = e.email
       ORDER BY e.created_at`,
    )
    .all<{
      email: string
      note: string | null
      created_at: number
      user_id: string | null
      last_login_at: number | null
    }>()

  return (res.results ?? []).map((r) => ({
    email: r.email,
    note: r.note,
    createdAt: r.created_at,
    userId: r.user_id,
    lastLoginAt: r.last_login_at,
  }))
}

/** ゲスト一覧。導出鍵とソルトは返さない（照合に必要な値を画面へ出す理由が無い） */
export async function listAdminGuests(db: D1Database): Promise<AdminGuestRow[]> {
  const res = await db
    .prepare(
      `SELECT g.login_id, g.user_id, g.failed_count, g.locked_until, g.created_at,
              u.display_name,
              MAX(
                COALESCE(g.last_login_at, 0),
                COALESCE((SELECT MAX(a.created_at) FROM access_logs a
                           WHERE a.user_id = g.user_id AND a.result = 'success'), 0)
              ) AS last_login_at,
              (SELECT COUNT(*) FROM courses c WHERE c.user_id = g.user_id) AS courses
       FROM guest_accounts g JOIN users u ON u.id = g.user_id
       ORDER BY g.created_at`,
    )
    .all<{
      login_id: string
      user_id: string
      failed_count: number
      locked_until: number | null
      created_at: number
      display_name: string
      last_login_at: number | null
      courses: number
    }>()

  const now = Date.now()
  return (res.results ?? []).map((r) => ({
    loginId: r.login_id,
    userId: r.user_id,
    displayName: r.display_name,
    failedCount: r.failed_count,
    locked: r.locked_until !== null && r.locked_until > now,
    lockedUntil: r.locked_until,
    createdAt: r.created_at,
    lastLoginAt: orNull(r.last_login_at),
    courses: r.courses,
  }))
}
