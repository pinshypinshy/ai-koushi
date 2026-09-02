import type {
  ApiChoice,
  ApiMessage,
  ApiQuestion,
  ApiStep,
  AttemptResult,
  AttemptSummary,
  CourseDetail,
  CourseSummary,
  MaterialResponse,
  QuizResponse,
} from '../../../shared/api'
import type { OutlineResult, OutlineStep, QuizResult, StepSummary, Turn } from '../ai/types'

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

/**
 * §8.2.3「月間の講義作成数 8件」の判定に使う。
 *
 * 複製（duplicated_from が入っている講義）は数えない（Q-30）。上限は AI の費用を
 * 抑えるために置いたものであり、複製は AI を呼ばないためである。
 */
export async function countCoursesSince(
  db: D1Database,
  userId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM courses
       WHERE user_id = ?1 AND created_at >= ?2 AND duplicated_from IS NULL`,
    )
    .bind(userId, since)
    .first<{ n: number }>()
  return row?.n ?? 0
}

// ----------------------------------------------------------------- 受講（③④⑤）

/** ③④のプロンプトに載せる材料（§5.4 のコンテキスト構成） */
export interface LectureContextRow {
  material: string
  outline: OutlineStep[]
  completedSummaries: StepSummary[]
  currentStep: OutlineStep
  currentStepId: string
  history: Turn[]
}

/**
 * 現在のステップを解説するために必要なものを一度に集める。
 *
 * 過去のステップは全文ではなく⑤の要約だけを載せる（§5.4「進捗」層）。
 * 対話は現ステップ内のみを載せる。ステップをまたいで全文を積むと、
 * 教材と骨子で既に大きいコンテキストがさらに膨らみ、§8.2 の想定を超える。
 */
export async function loadLectureContext(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<LectureContextRow | null> {
  const [courseRes, materialRes, stepRes] = await db.batch([
    db
      .prepare('SELECT current_step_id FROM courses WHERE id = ?1 AND user_id = ?2')
      .bind(courseId, userId),
    db.prepare('SELECT raw_markdown FROM materials WHERE course_id = ?1').bind(courseId),
    db
      .prepare(
        `SELECT id, order_index, title, objective, key_points, source_ref, status, summary
         FROM steps WHERE course_id = ?1 ORDER BY order_index`,
      )
      .bind(courseId),
  ])

  const course = (courseRes.results as unknown as { current_step_id: string | null }[])[0]
  if (!course?.current_step_id) return null
  const material = (materialRes.results as unknown as { raw_markdown: string }[])[0]?.raw_markdown
  if (material === undefined) return null

  const rows = stepRes.results as unknown as (StepRow & { summary: string | null })[]
  if (rows.length === 0) return null

  const toOutline = (row: StepRow): OutlineStep => ({
    orderIndex: row.order_index,
    title: row.title,
    objective: row.objective,
    keyPoints: parseKeyPoints(row.key_points),
    sourceRef: row.source_ref ?? '',
  })

  const currentRow = rows.find((r) => r.id === course.current_step_id)
  if (!currentRow) return null

  const { results: messageRows } = await db
    .prepare(
      'SELECT role, content FROM messages WHERE step_id = ?1 ORDER BY created_at, rowid',
    )
    .bind(currentRow.id)
    .all<{ role: string; content: string }>()

  return {
    material,
    outline: rows.map(toOutline),
    completedSummaries: rows
      .filter((r) => r.status === 'completed' && r.summary)
      .map((r): StepSummary => ({
        orderIndex: r.order_index,
        title: r.title,
        summary: r.summary ?? '',
      })),
    currentStep: toOutline(currentRow),
    currentStepId: currentRow.id,
    history: messageRows.map((m): Turn => ({ role: m.role as Turn['role'], content: m.content })),
  }
}

/**
 * 発言を1件保存する。
 * 併せてステップを in_progress にするのは、受講が始まった時点が
 * 「現在のステップ」の実体であるため（骨子の保存時点ではまだ着手していない）。
 */
export async function insertMessage(
  db: D1Database,
  courseId: string,
  stepId: string,
  role: ApiMessage['role'],
  content: string,
): Promise<ApiMessage> {
  const message: ApiMessage = {
    id: crypto.randomUUID(),
    stepId,
    role,
    content,
    createdAt: Date.now(),
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO messages (id, step_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(message.id, stepId, role, content, message.createdAt),
    db
      .prepare(
        `UPDATE steps SET status = 'in_progress' WHERE id = ?1 AND status = 'not_started'`,
      )
      .bind(stepId),
    db.prepare('UPDATE courses SET updated_at = ?2 WHERE id = ?1').bind(courseId, message.createdAt),
  ])
  return message
}

/**
 * ステップを完了にし、現在地を次へ移す（§4.2.2）。
 * 完了の判定はユーザーが次へ進むことに同意した時点であり、確認テストは条件に含めない（Q-4）。
 */
export async function completeStep(
  db: D1Database,
  courseId: string,
  stepId: string,
  summary: string,
): Promise<void> {
  const now = Date.now()
  const next = await db
    .prepare(
      `SELECT id FROM steps
       WHERE course_id = ?1 AND order_index > (SELECT order_index FROM steps WHERE id = ?2)
       ORDER BY order_index LIMIT 1`,
    )
    .bind(courseId, stepId)
    .first<{ id: string }>()

  const statements = [
    db
      .prepare(
        `UPDATE steps SET status = 'completed', summary = ?2, completed_at = ?3 WHERE id = ?1`,
      )
      .bind(stepId, summary, now),
    db
      .prepare('UPDATE courses SET current_step_id = ?2, updated_at = ?3 WHERE id = ?1')
      .bind(courseId, next?.id ?? null, now),
  ]
  if (next) {
    statements.push(
      db
        .prepare(`UPDATE steps SET status = 'in_progress' WHERE id = ?1 AND status = 'not_started'`)
        .bind(next.id),
    )
  }
  await db.batch(statements)
}

/** 現在のステップが指定されたものと一致するか。完了済みステップへの二重操作を弾く */
export async function isCurrentStep(
  db: D1Database,
  userId: string,
  courseId: string,
  stepId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT current_step_id FROM courses WHERE id = ?1 AND user_id = ?2')
    .bind(courseId, userId)
    .first<{ current_step_id: string | null }>()
  return row?.current_step_id === stepId
}

/** §8.2.3「講義1件あたりの累積トークン」。暴走時に当該講義の生成を止めるための集計 */
export async function courseTokenTotals(
  db: D1Database,
  courseId: string,
): Promise<{ input: number; output: number }> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
       FROM ai_usage_logs WHERE course_id = ?1`,
    )
    .bind(courseId)
    .first<{ input: number; output: number }>()
  return { input: row?.input ?? 0, output: row?.output ?? 0 }
}

// ------------------------------------------------------------------ 確認テスト

/**
 * 出題（§4.3.1）。正解と解説を含めないのは、「回答する」を押す前に
 * クライアント側で答えが判明してしまうと §4.3.2 の判定が成立しないため。
 * 出題順のシャッフルは受験のたびにクライアントで行う（Q-6）。
 */
export async function getQuiz(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<QuizResponse | null> {
  const owned = await db
    .prepare('SELECT id FROM courses WHERE id = ?1 AND user_id = ?2')
    .bind(courseId, userId)
    .first<{ id: string }>()
  if (!owned) return null

  const [questionRes, choiceRes, stepRes, attemptRes] = await db.batch([
    db
      .prepare('SELECT id, stem FROM questions WHERE course_id = ?1 ORDER BY order_index')
      .bind(courseId),
    db
      .prepare(
        `SELECT ch.id, ch.question_id, ch.body
         FROM choices ch JOIN questions q ON q.id = ch.question_id
         WHERE q.course_id = ?1 ORDER BY q.order_index, ch.order_index`,
      )
      .bind(courseId),
    db
      .prepare(
        `SELECT qs.question_id, qs.step_id
         FROM question_steps qs JOIN questions q ON q.id = qs.question_id
         WHERE q.course_id = ?1`,
      )
      .bind(courseId),
    // 設問ごとに answered_at が最大の解答（§6.4 復習モード対象）
    db
      .prepare(
        `SELECT a.question_id, a.is_correct, a.answered_at
         FROM attempts a JOIN questions q ON q.id = a.question_id
         WHERE q.course_id = ?1 AND a.user_id = ?2
           AND a.answered_at = (
             SELECT MAX(a2.answered_at) FROM attempts a2
             WHERE a2.question_id = a.question_id AND a2.user_id = a.user_id
           )`,
      )
      .bind(courseId, userId),
  ])

  const choicesByQuestion = new Map<string, ApiChoice[]>()
  for (const row of choiceRes.results as unknown as {
    id: string
    question_id: string
    body: string
  }[]) {
    const list = choicesByQuestion.get(row.question_id) ?? []
    list.push({ id: row.id, body: row.body })
    choicesByQuestion.set(row.question_id, list)
  }

  const stepsByQuestion = new Map<string, string[]>()
  for (const row of stepRes.results as unknown as { question_id: string; step_id: string }[]) {
    const list = stepsByQuestion.get(row.question_id) ?? []
    list.push(row.step_id)
    stepsByQuestion.set(row.question_id, list)
  }

  const questions = (questionRes.results as unknown as { id: string; stem: string }[]).map(
    (row): ApiQuestion => ({
      id: row.id,
      stem: row.stem,
      choices: choicesByQuestion.get(row.id) ?? [],
      coveredStepIds: stepsByQuestion.get(row.id) ?? [],
    }),
  )

  const latestAttempts = (
    attemptRes.results as unknown as {
      question_id: string
      is_correct: number
      answered_at: number
    }[]
  ).map(
    (row): AttemptSummary => ({
      questionId: row.question_id,
      isCorrect: row.is_correct === 1,
      answeredAt: row.answered_at,
    }),
  )

  return { questions, latestAttempts }
}

/** 解答が不正（選択肢が別の設問のものだった）ことを表す。呼び出し側で 400 に変換する */
export class InvalidChoiceError extends Error {}

/**
 * 解答を判定して記録する（§4.3.2 / §4.3.3）。
 * 上書きではなく追記するため、同一設問の複数回挑戦の履歴が残る。
 */
export async function gradeAttempt(
  db: D1Database,
  userId: string,
  questionId: string,
  selectedChoiceId: string,
): Promise<AttemptResult | null> {
  const question = await db
    .prepare(
      `SELECT q.id, q.explanation FROM questions q
       JOIN courses c ON c.id = q.course_id
       WHERE q.id = ?1 AND c.user_id = ?2`,
    )
    .bind(questionId, userId)
    .first<{ id: string; explanation: string }>()
  if (!question) return null

  const { results } = await db
    .prepare('SELECT id, is_correct FROM choices WHERE question_id = ?1')
    .bind(questionId)
    .all<{ id: string; is_correct: number }>()

  const selected = results.find((r) => r.id === selectedChoiceId)
  if (!selected) throw new InvalidChoiceError('選択肢がこの設問のものではありません')
  const correct = results.find((r) => r.is_correct === 1)

  const answeredAt = Date.now()
  await db
    .prepare(
      `INSERT INTO attempts (id, user_id, question_id, selected_choice_id, is_correct, answered_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      questionId,
      selectedChoiceId,
      selected.is_correct === 1 ? 1 : 0,
      answeredAt,
    )
    .run()

  return {
    questionId,
    selectedChoiceId,
    correctChoiceId: correct?.id ?? '',
    isCorrect: selected.is_correct === 1,
    explanation: question.explanation,
    answeredAt,
  }
}

// ------------------------------------------------------------------ 講義管理

/**
 * 講義の削除（§4.5）。ステップ・対話・設問・解答記録は外部キーの連鎖削除で消える。
 * ai_usage_logs だけは残す。当月の課金実績が消えると §8.2.4 の上限判定が狂うため。
 */
export async function deleteCourse(
  db: D1Database,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM courses WHERE id = ?1 AND user_id = ?2')
    .bind(courseId, userId)
    .run()
  return (res.meta.changes ?? 0) > 0
}

export async function renameCourse(
  db: D1Database,
  userId: string,
  courseId: string,
  title: string,
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE courses SET title = ?3, updated_at = ?4 WHERE id = ?1 AND user_id = ?2')
    .bind(courseId, userId, title, Date.now())
    .run()
  return (res.meta.changes ?? 0) > 0
}

/**
 * 講義の複製（§4.5、Q-30）。
 *
 * 教材・ステップ分割・確認テストの設問はそのまま引き継ぎ、受講の記録（messages）・
 * 解答記録（attempts）・ステップの進行状況だけを持たない講義を新しく作る。AI は呼ばない。
 *
 * 設問（questions / choices / question_steps）まで複写するのは、これが「履歴」ではなく
 * ②の生成物であるため。作り直せば AI 費用が発生し、複製の目的（費用ゼロでの再受講）が消える。
 *
 * course_caches は引き継がない。キャッシュは (course_id, model) の組で保持し、Google 側の
 * 実体は TTL で消えるため、新しい講義の初回利用時に作り直させる方が生存期間の管理が単純になる。
 *
 * 所有者の検証はルート側で済んでいるが、読み取りにも user_id を含めて二重に絞る（SEC-2）。
 */
export async function duplicateCourse(
  db: D1Database,
  userId: string,
  sourceId: string,
): Promise<string | null> {
  // 読み取りも1回のバッチにまとめる。教材本文だけは INSERT ... SELECT で DB の中を通す
  const [courseRes, stepRes, questionRes, choiceRes, linkRes] = await db.batch([
    db
      .prepare('SELECT title, quiz_status FROM courses WHERE id = ?1 AND user_id = ?2')
      .bind(sourceId, userId),
    db
      .prepare(
        `SELECT s.id, s.order_index, s.title, s.objective, s.key_points, s.source_ref
         FROM steps s JOIN courses c ON c.id = s.course_id
         WHERE s.course_id = ?1 AND c.user_id = ?2 ORDER BY s.order_index`,
      )
      .bind(sourceId, userId),
    db
      .prepare(
        `SELECT q.id, q.order_index, q.stem, q.explanation
         FROM questions q JOIN courses c ON c.id = q.course_id
         WHERE q.course_id = ?1 AND c.user_id = ?2 ORDER BY q.order_index`,
      )
      .bind(sourceId, userId),
    db
      .prepare(
        `SELECT ch.question_id, ch.order_index, ch.body, ch.is_correct
         FROM choices ch
         JOIN questions q ON q.id = ch.question_id
         JOIN courses c ON c.id = q.course_id
         WHERE q.course_id = ?1 AND c.user_id = ?2
         ORDER BY ch.question_id, ch.order_index`,
      )
      .bind(sourceId, userId),
    db
      .prepare(
        `SELECT qs.question_id, qs.step_id
         FROM question_steps qs
         JOIN questions q ON q.id = qs.question_id
         JOIN courses c ON c.id = q.course_id
         WHERE q.course_id = ?1 AND c.user_id = ?2`,
      )
      .bind(sourceId, userId),
  ])

  const source = (courseRes.results as unknown as { title: string; quiz_status: string }[])[0]
  if (!source) return null

  const stepRows = stepRes.results as unknown as {
    id: string
    order_index: number
    title: string
    objective: string
    key_points: string
    source_ref: string | null
  }[]
  const questionRows = questionRes.results as unknown as {
    id: string
    order_index: number
    stem: string
    explanation: string
  }[]
  const choiceRows = choiceRes.results as unknown as {
    question_id: string
    order_index: number
    body: string
    is_correct: number
  }[]
  const linkRows = linkRes.results as unknown as { question_id: string; step_id: string }[]

  // 複写先のIDを先に決めておく。question_steps が両方のIDを要るため対応表として持つ
  const stepIdMap = new Map(stepRows.map((row) => [row.id, crypto.randomUUID()]))
  const questionIdMap = new Map(questionRows.map((row) => [row.id, crypto.randomUUID()]))

  const now = Date.now()
  const newCourseId = crypto.randomUUID()
  const firstStepId = stepRows[0] ? (stepIdMap.get(stepRows[0].id) ?? null) : null

  const statements: D1PreparedStatement[] = [
    /**
     * 講義本体を先に入れる（steps の外部キーが courses を参照するため）。
     * status は ready 固定、quiz_status は複製元の値をそのまま引き継ぐ（テストが
     * 失敗している講義を複製しても、その事実は残す）。current_step_id は第1ステップに置き、
     * 受講は最初からやり直す（§4.2）。
     */
    db
      .prepare(
        `INSERT INTO courses
           (id, user_id, title, status, quiz_status, phase, current_step_id,
            duplicated_from, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'ready', ?4, NULL, ?5, ?6, ?7, ?7)`,
      )
      .bind(
        newCourseId,
        userId,
        `${source.title}（複製）`,
        source.quiz_status,
        firstStepId,
        sourceId,
        now,
      ),
    // 教材は最大240KB になるため、本文を Worker に載せず DB の中だけで複写する
    db
      .prepare(
        `INSERT INTO materials (id, course_id, raw_markdown, char_count, created_at)
         SELECT ?1, ?2, raw_markdown, char_count, ?3 FROM materials WHERE course_id = ?4`,
      )
      .bind(crypto.randomUUID(), newCourseId, now, sourceId),
  ]

  // status / summary / completed_at は指定しない。進行状況は引き継がない（既定は not_started）
  for (const row of stepRows) {
    statements.push(
      db
        .prepare(
          `INSERT INTO steps (id, course_id, order_index, title, objective, key_points, source_ref)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          stepIdMap.get(row.id)!,
          newCourseId,
          row.order_index,
          row.title,
          row.objective,
          row.key_points,
          row.source_ref,
        ),
    )
  }

  for (const row of questionRows) {
    statements.push(
      db
        .prepare(
          `INSERT INTO questions (id, course_id, order_index, stem, explanation, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(questionIdMap.get(row.id)!, newCourseId, row.order_index, row.stem, row.explanation, now),
    )
  }

  // 選択肢の並びは複製元のまま保つ。正解位置のシャッフルは生成時に済んでいる（§4.3.1）
  for (const row of choiceRows) {
    const questionId = questionIdMap.get(row.question_id)
    if (!questionId) continue
    statements.push(
      db
        .prepare(
          `INSERT INTO choices (id, question_id, order_index, body, is_correct)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), questionId, row.order_index, row.body, row.is_correct),
    )
  }

  for (const row of linkRows) {
    const questionId = questionIdMap.get(row.question_id)
    const stepId = stepIdMap.get(row.step_id)
    if (!questionId || !stepId) continue
    statements.push(
      db
        .prepare('INSERT INTO question_steps (question_id, step_id) VALUES (?1, ?2)')
        .bind(questionId, stepId),
    )
  }

  // 全体を1バッチにするのは、設問だけ入って選択肢が無い講義を作らないため（saveQuiz と同じ）
  await db.batch(statements)
  return newCourseId
}
