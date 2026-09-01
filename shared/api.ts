/**
 * フロントエンド（app/）とサーバー（server/）で共有する API の型。
 * DB の行そのものではなく、クライアントへ返す表現を定義する。
 *
 * app/src/types.ts はモック UI 用の型であり、当面は別物として併存させる。
 * 実 API への差し替えが済んだ時点で、そちらをここへ寄せる。
 */

export type CourseStatus = 'generating' | 'ready' | 'failed'
/**
 * 確認テストの状態（§4.1.6）。CourseStatus とは独立に動く。
 * pending は「まだ無い」で、初回生成中と再生成中の両方を含む。
 */
export type QuizStatus = 'pending' | 'ready' | 'failed'
export type GeneratingPhase = 'outline' | 'quiz'
export type StepStatus = 'not_started' | 'in_progress' | 'completed'
export type MessageRole = 'user' | 'assistant'

export interface ApiUser {
  id: string
  email: string
  displayName: string
}

/** サイドバー（A-3）の1行。教材原文は含めない（§6.4 講義一覧は軽量に保つ） */
export interface CourseSummary {
  id: string
  title: string
  status: CourseStatus
  /** 講義は利用可能でテストだけ失敗している状態を表せるようにする（§4.1.6） */
  quizStatus: QuizStatus
  phase: GeneratingPhase | null
  errorMessage: string | null
  totalSteps: number
  completedSteps: number
  updatedAt: number
}

export interface ApiStep {
  id: string
  orderIndex: number
  title: string
  objective: string
  keyPoints: string[]
  sourceRef: string | null
  status: StepStatus
  completedAt: number | null
}

export interface ApiMessage {
  id: string
  stepId: string
  role: MessageRole
  content: string
  createdAt: number
}

/** 選択中の講義。講義タブの描画に必要な分だけを持つ */
export interface CourseDetail extends CourseSummary {
  currentStepId: string | null
  steps: ApiStep[]
  messages: ApiMessage[]
}

/** 教材タブ（§4.4）。原文は最大240KB になるため個別に取得する */
export interface MaterialResponse {
  courseId: string
  title: string
  charCount: number
  rawMarkdown: string
}

/**
 * 出題時に返す設問。
 * is_correct と explanation を含めないのは、正解がクライアントに渡ると
 * 「回答する」押下前に判明してしまい、§4.3.2 の判定が成立しないため。
 */
export interface ApiChoice {
  id: string
  body: string
}

export interface ApiQuestion {
  id: string
  stem: string
  choices: ApiChoice[]
  coveredStepIds: string[]
}

/** 解答の判定結果。正誤と解説はここで初めてクライアントへ渡る */
export interface AttemptResult {
  questionId: string
  selectedChoiceId: string
  correctChoiceId: string
  isCorrect: boolean
  explanation: string
  answeredAt: number
}

/** §6.4「初回ロード」。講義一覧・選択中講義・ユーザーを1往復で返す */
export interface BootstrapResponse {
  user: ApiUser
  courses: CourseSummary[]
  selected: CourseDetail | null
}

export interface ApiError {
  error: string
  message: string
}

/** 講義作成（§4.1.4）。title が null のとき、AI が教材から命名する（§5.2） */
export interface CreateCourseRequest {
  title: string | null
  material: string
}

/**
 * 作成の受付。生成の完了は待たず、講義IDだけを即座に返す（§4.1.4）。
 * 以降の進捗は GET /api/courses/:id の status / phase / quizStatus で見る（§7.4）。
 */
export interface CreateCourseResponse {
  courseId: string
}

/**
 * 講義本文（③）・質問応答（④）のストリーミング1行ぶん。
 *
 * 応答は NDJSON（1行1件のJSON）で流す。文字の断片だけでなく、保存された発言の id と
 * 途中で発生した失敗を同じ経路で伝えるためである（§5.7「ストリーミング中断」）。
 */
export type LectureStreamLine =
  | { delta: string }
  | { done: ApiMessage }
  | { error: { message: string; partialSaved: boolean } }

/** 質問・応答の送信（§4.2.4） */
export interface SendMessageRequest {
  text: string
}

/** 各設問に対する最新の解答（§4.3.3）。復習モードの抽出に使う（§4.3.4） */
export interface AttemptSummary {
  questionId: string
  isCorrect: boolean
  answeredAt: number
}

/**
 * 確認テストの出題（§4.3）。
 * 出題順のシャッフルは受験のたびにクライアントで行う（Q-6）。ここは order_index 順で返す。
 */
export interface QuizResponse {
  questions: ApiQuestion[]
  latestAttempts: AttemptSummary[]
}

export interface AttemptRequest {
  selectedChoiceId: string
}

export interface RenameCourseRequest {
  title: string
}
