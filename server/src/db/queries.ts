import type {
  ApiMessage,
  ApiStep,
  CourseDetail,
  CourseSummary,
  MaterialResponse,
} from '../../../shared/api'
import type { OutlineResult, OutlineStep, QuizResult } from '../ai/types'

/**
 * REQUIREMENTS.md §6.4「主要クエリ」に対応する。
 * 所有者検証（§8.3 SEC-2）は user_id を WHERE に含めることで行い、
 * 他ユーザーの講義IDを指定された場合は「存在しない」として扱う。
 */

interface CourseRow {
  id: string
  title: string
  status: string
  quiz_status: string
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
    quizStatus: row.quiz_status as CourseSummary['quizStatus'],
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
  c.id, c.title, c.status, c.quiz_status, c.phase, c.error_message, c.current_step_id, c.updated_at,
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

// --------------------------------------------------------------- 書き込み系

/**
 * 講義行と教材行を1つのバッチで作る（§4.1.4「講義・教材を status=generating で保存」）。
 * D1 の batch はトランザクションであり、教材だけ保存されて講義が無い状態にならない。
 */
export async function createCourse(
  db: D1Database,
  userId: string,
  input: { courseId: string; title: string; material: string },
): Promise<void> {
  const now = Date.now()
  await db.batch([
    db
      .prepare(
        `INSERT INTO courses (id, user_id, title, status, quiz_status, phase, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'generating', 'pending', 'outline', ?4, ?4)`,
      )
      .bind(input.courseId, userId, input.title, now),
    db
      .prepare(
        `INSERT INTO materials (id, course_id, raw_markdown, char_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(crypto.randomUUID(), input.courseId, input.material, input.material.length, now),
  ])
}

/** §7.4「Workflow インスタンスIDも courses に保持し、状態照会に用いる」 */
export async function setWorkflowId(
  db: D1Database,
  courseId: string,
  workflowId: string,
): Promise<void> {
  await db
    .prepare('UPDATE courses SET workflow_id = ?2, updated_at = ?3 WHERE id = ?1')
    .bind(courseId, workflowId, Date.now())
    .run()
}

/** 生成に必要な入力。所有者の検証は呼び出し側（ルート）で済んでいる前提 */
export async function getMaterialText(db: D1Database, courseId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT raw_markdown FROM materials WHERE course_id = ?1')
    .bind(courseId)
    .first<{ raw_markdown: string }>()
  return row?.raw_markdown ?? null
}

/** ②の入力になる骨子。確認テストだけを再生成する場合に使う（§4.1.6） */
export async function getOutlineSteps(db: D1Database, courseId: string): Promise<OutlineStep[]> {
  const { results } = await db
    .prepare(
      `SELECT order_index, title, objective, key_points, source_ref
       FROM steps WHERE course_id = ?1 ORDER BY order_index`,
    )
    .bind(courseId)
    .all<{
      order_index: number
      title: string
      objective: string
      key_points: string
      source_ref: string | null
    }>()
  return results.map((row) => ({
    orderIndex: row.order_index,
    title: row.title,
    objective: row.objective,
    keyPoints: parseKeyPoints(row.key_points),
    sourceRef: row.source_ref ?? '',
  }))
}

/**
 * ①の結果を保存し、②の段階へ進める。
 *
 * 既存のステップを消してから入れ直すのは、①からの再生成（§4.1.6「再試行」）で
 * 前回の中途半端な結果が残らないようにするため。この経路は骨子生成が失敗した
 * 講義でしか通らないため、ステップに紐づく対話はまだ存在しない。
 */
export async function saveOutline(
  db: D1Database,
  courseId: string,
  outline: OutlineResult,
  applyGeneratedTitle: boolean,
): Promise<void> {
  const now = Date.now()
  const ids = outline.steps.map(() => crypto.randomUUID())

  const statements = [
    db.prepare('DELETE FROM steps WHERE course_id = ?1').bind(courseId),
    ...outline.steps.map((step, i) =>
      db
        .prepare(
          `INSERT INTO steps (id, course_id, order_index, title, objective, key_points, source_ref)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          ids[i],
          courseId,
          step.orderIndex,
          step.title,
          step.objective,
          JSON.stringify(step.keyPoints),
          step.sourceRef || null,
        ),
    ),
    /**
     * current_step_id を第1ステップに置く。受講の開始位置であり（§4.2）、
     * ステップ自体の status は受講が始まるまで not_started のままにする。
     * タイトルはユーザーが入力していない場合のみ AI の命名で上書きする（§5.2）。
     */
    db
      .prepare(
        `UPDATE courses
         SET phase = 'quiz', current_step_id = ?2, updated_at = ?3,
             title = CASE WHEN ?4 = 1 THEN ?5 ELSE title END
         WHERE id = ?1`,
      )
      .bind(courseId, ids[0] ?? null, now, applyGeneratedTitle ? 1 : 0, outline.courseTitle),
  ]

  await db.batch(statements)
}

/** 正解位置の偏りを排除する（§4.3.1「選択肢の順序：保存時にシャッフルする」） */
function shuffled<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * ②の結果を保存し、講義を完成させる。
 *
 * 設問はステップではなく講義に従属し、対応するステップを question_steps に持つ
 * （§4.3.1.1）。covered_steps は order_index で返るため、ここでステップIDへ変換する。
 * 全体を1バッチにするのは、設問だけ入って選択肢が無い状態を作らないため。
 */
export async function saveQuiz(
  db: D1Database,
  courseId: string,
  quiz: QuizResult,
): Promise<void> {
  const { results: stepRows } = await db
    .prepare('SELECT id, order_index FROM steps WHERE course_id = ?1')
    .bind(courseId)
    .all<{ id: string; order_index: number }>()
  const stepIdByOrder = new Map(stepRows.map((r) => [r.order_index, r.id]))

  const now = Date.now()
  const statements: D1PreparedStatement[] = [
    // choices と question_steps は ON DELETE CASCADE で一緒に消える
    db.prepare('DELETE FROM questions WHERE course_id = ?1').bind(courseId),
  ]

  quiz.questions.forEach((question, index) => {
    const questionId = crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO questions (id, course_id, order_index, stem, explanation, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(questionId, courseId, index, question.stem, question.explanation, now),
    )

    const choices = shuffled(
      question.choices.map((body, i) => ({ body, isCorrect: i === question.correctIndex })),
    )
    choices.forEach((choice, i) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO choices (id, question_id, order_index, body, is_correct)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
          )
          .bind(crypto.randomUUID(), questionId, i, choice.body, choice.isCorrect ? 1 : 0),
      )
    })

    // 存在しない order_index は捨てる。検証（validateQuiz）を通っていれば起きない
    for (const order of new Set(question.coveredSteps)) {
      const stepId = stepIdByOrder.get(order)
      if (!stepId) continue
      statements.push(
        db
          .prepare('INSERT INTO question_steps (question_id, step_id) VALUES (?1, ?2)')
          .bind(questionId, stepId),
      )
    }
  })

  statements.push(
    db
      .prepare(
        `UPDATE courses
         SET status = 'ready', quiz_status = 'ready', phase = NULL, error_message = NULL,
             updated_at = ?2
         WHERE id = ?1`,
      )
      .bind(courseId, now),
  )

  await db.batch(statements)
}

/** ①の失敗（§4.1.6「骨子生成失敗」）。講義そのものが成立しないため failed にする */
export async function markCourseFailed(
  db: D1Database,
  courseId: string,
  message: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE courses SET status = 'failed', phase = NULL, error_message = ?2, updated_at = ?3
       WHERE id = ?1`,
    )
    .bind(courseId, message.slice(0, 500), Date.now())
    .run()
}

/**
 * ②の失敗（§4.1.6「確認テスト生成失敗」）。講義自体は利用可能とするため status は ready。
 *
 * error_message に書かないのは、あの列が SC-06（講義全体が失敗した画面）の文言であり、
 * status=ready の講義に入れると意味が二重になるため。確認テストタブの表示は
 * 「テストの生成に失敗しました」の固定文言であり、原因の文言は必要としない（ログには残す）。
 */
export async function markQuizFailed(db: D1Database, courseId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE courses SET status = 'ready', quiz_status = 'failed', phase = NULL, updated_at = ?2
       WHERE id = ?1`,
    )
    .bind(courseId, Date.now())
    .run()
}

/** 講義の生成状態。§7.4「status=generating の講義には新規のWorkflowを起動しない」の判定に使う */
export async function getCourseState(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<{ status: string; quizStatus: string; title: string } | null> {
  const row = await db
    .prepare('SELECT status, quiz_status, title FROM courses WHERE id = ?1 AND user_id = ?2')
    .bind(courseId, userId)
    .first<{ status: string; quiz_status: string; title: string }>()
  if (!row) return null
  return { status: row.status, quizStatus: row.quiz_status, title: row.title }
}

/** ①からの再試行（§4.1.6）。前回の失敗の痕跡を消してから生成中に戻す */
export async function resetForRetry(db: D1Database, courseId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE courses
       SET status = 'generating', quiz_status = 'pending', phase = 'outline',
           error_message = NULL, updated_at = ?2
       WHERE id = ?1`,
    )
    .bind(courseId, Date.now())
    .run()
}

/** ②だけの再試行（§4.1.6）。講義は利用可能なままなので status は触らない */
export async function resetQuizForRetry(db: D1Database, courseId: string): Promise<void> {
  await db
    .prepare(`UPDATE courses SET quiz_status = 'pending', updated_at = ?2 WHERE id = ?1`)
    .bind(courseId, Date.now())
    .run()
}

/** §8.2.3「月間の講義作成数 8件」の判定に使う */
export async function countCoursesSince(
  db: D1Database,
  userId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM courses WHERE user_id = ?1 AND created_at >= ?2')
    .bind(userId, since)
    .first<{ n: number }>()
  return row?.n ?? 0
}
