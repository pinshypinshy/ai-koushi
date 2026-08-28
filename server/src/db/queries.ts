import type {
  ApiMessage,
  ApiStep,
  CourseDetail,
  CourseSummary,
  MaterialResponse,
} from '../../../shared/api'

/**
 * REQUIREMENTS.md §6.4「主要クエリ」に対応する。
 * 所有者検証（§8.3 SEC-2）は user_id を WHERE に含めることで行い、
 * 他ユーザーの講義IDを指定された場合は「存在しない」として扱う。
 */

interface CourseRow {
  id: string
  title: string
  status: string
  phase: string | null
  error_message: string | null
  current_step_id: string | null
  updated_at: number
  total_steps: number
  completed_steps: number
}

interface StepRow {
  id: string
  order_index: number
  title: string
  objective: string
  key_points: string
  source_ref: string | null
  status: string
  completed_at: number | null
}

interface MessageRow {
  id: string
  step_id: string
  role: string
  content: string
  created_at: number
}

/** key_points は JSON 文字列で格納されている（§6.2）。壊れていても講義全体を落とさない */
function parseKeyPoints(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toSummary(row: CourseRow): CourseSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as CourseSummary['status'],
    phase: row.phase as CourseSummary['phase'],
    errorMessage: row.error_message,
    totalSteps: row.total_steps,
    completedSteps: row.completed_steps,
    updatedAt: row.updated_at,
  }
}

function toStep(row: StepRow): ApiStep {
  return {
    id: row.id,
    orderIndex: row.order_index,
    title: row.title,
    objective: row.objective,
    keyPoints: parseKeyPoints(row.key_points),
    sourceRef: row.source_ref,
    status: row.status as ApiStep['status'],
    completedAt: row.completed_at,
  }
}

const COURSE_COLUMNS = `
  c.id, c.title, c.status, c.phase, c.error_message, c.current_step_id, c.updated_at,
  (SELECT COUNT(*) FROM steps s WHERE s.course_id = c.id) AS total_steps,
  (SELECT COUNT(*) FROM steps s WHERE s.course_id = c.id AND s.status = 'completed') AS completed_steps
`

/** サイドバー（A-3）。教材原文を含めないため一覧が重くならない */
export async function listCourses(db: D1Database, userId: string): Promise<CourseSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COURSE_COLUMNS} FROM courses c WHERE c.user_id = ?1 ORDER BY c.updated_at DESC`,
    )
    .bind(userId)
    .all<CourseRow>()
  return results.map(toSummary)
}

/** 選択中の講義。ステップと対話を1回のバッチで取得する（§6.4 初回ロード） */
export async function getCourseDetail(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<CourseDetail | null> {
  const [courseRes, stepRes, messageRes] = await db.batch([
    db
      .prepare(`SELECT ${COURSE_COLUMNS} FROM courses c WHERE c.id = ?1 AND c.user_id = ?2`)
      .bind(courseId, userId),
    db
      .prepare(
        `SELECT s.id, s.order_index, s.title, s.objective, s.key_points, s.source_ref,
                s.status, s.completed_at
         FROM steps s
         JOIN courses c ON c.id = s.course_id
         WHERE s.course_id = ?1 AND c.user_id = ?2
         ORDER BY s.order_index`,
      )
      .bind(courseId, userId),
    db
      .prepare(
        `SELECT m.id, m.step_id, m.role, m.content, m.created_at
         FROM messages m
         JOIN steps s ON s.id = m.step_id
         JOIN courses c ON c.id = s.course_id
         WHERE s.course_id = ?1 AND c.user_id = ?2
         ORDER BY s.order_index, m.created_at`,
      )
      .bind(courseId, userId),
  ])

  const course = (courseRes.results as unknown as CourseRow[])[0]
  if (!course) return null

  const steps = (stepRes.results as unknown as StepRow[]).map(toStep)
  const messages = (messageRes.results as unknown as MessageRow[]).map(
    (row): ApiMessage => ({
      id: row.id,
      stepId: row.step_id,
      role: row.role as ApiMessage['role'],
      content: row.content,
      createdAt: row.created_at,
    }),
  )

  return { ...toSummary(course), currentStepId: course.current_step_id, steps, messages }
}

/** 教材タブ（§4.4）。status に関わらず表示するため、生成中・失敗中でも返す */
export async function getMaterial(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<MaterialResponse | null> {
  const row = await db
    .prepare(
      `SELECT c.id AS course_id, c.title, m.char_count, m.raw_markdown
       FROM materials m
       JOIN courses c ON c.id = m.course_id
       WHERE m.course_id = ?1 AND c.user_id = ?2`,
    )
    .bind(courseId, userId)
    .first<{ course_id: string; title: string; char_count: number; raw_markdown: string }>()
  if (!row) return null
  return {
    courseId: row.course_id,
    title: row.title,
    charCount: row.char_count,
    rawMarkdown: row.raw_markdown,
  }
}
