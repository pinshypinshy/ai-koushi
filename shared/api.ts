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

/**
 * 今月の利用状況（§8.2.3 の上限に対する消費分）。サイドバーの進捗表示に使う。
 *
 * 上限値も併せて返すのは、上限が利用者の種別で異なるため（Google $15・8件 ／
 * ゲスト $3・2件、Q-26）。クライアントに上限を持たせると種別の判定が画面側に漏れる。
 */
export interface UsageSummary {
  /**
   * 推定コストの月間合計（USD）。ai_usage_logs の積み上げであり、
   * 課金プラットフォーム側の実額（§8.2.4 の二層目）とは一致しない。
   */
  costUsd: number
  costLimitUsd: number
  /** 今月に作成した講義の件数。再試行は新規作成として数えない */
  courses: number
  courseLimit: number
  /** 集計期間の開始時刻（JST の月初）。「今月」の区切りを利用者の感覚に合わせる */
  periodStart: number
}

/** §6.4「初回ロード」。講義一覧・選択中講義・ユーザーを1往復で返す */
export interface BootstrapResponse {
  user: ApiUser
  courses: CourseSummary[]
  selected: CourseDetail | null
  /** 起動直後からサイドバーに出せるよう、利用状況も同じ応答に載せる（§7.6） */
  usage: UsageSummary
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
 * 講義の複製（§4.5、Q-30）。教材・ステップ分割・確認テストの設問は引き継ぎ、
 * 対話ログ・解答記録・進行状況だけを持たない講義を作る。
 *
 * 作成（CreateCourseResponse）と違って生成を待つ必要が無いため、IDではなく講義そのものを
 * 返す。IDだけ返して取り直させると往復が1つ増える（§7.6）。
 */
export type DuplicateCourseResponse = CourseDetail

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

/* ────────────────────────────────────────────────────────────
   運営管理ページ（§4.7）。段階1では読み取りのみで、更新系は持たない。
   ここに載るのは運営が見る値であり、利用者本人の画面には現れない。
   秘密（APIキー・セッション鍵）は含めない（§8.3 SEC-1）。
   ──────────────────────────────────────────────────────────── */

export type AccountKind = 'google' | 'guest'
/** ログインの結果。denied は許可リストに無い、failed は認証そのものの失敗 */
export type AccessResult = 'success' | 'denied' | 'failed' | 'locked'
/** ai_usage_logs.purpose（§5.1 の5種類の呼び出し） */
export type AiPurpose = 'outline' | 'quiz' | 'lecture' | 'answer' | 'summary'

/** 概要タブ。件数と金額だけを持つ */
export interface AdminSummary {
  users: number
  guests: number
  admins: number
  allowedEmails: number
  courses: number
  /** 全体の実件数。利用者行と違い複製（§4.5）も含める。上限と突き合わせる値ではない */
  coursesThisMonth: number
  costThisMonthUsd: number
  costTotalUsd: number
  /** AI 呼び出しのうち error が入っている件数（今月） */
  aiErrorsThisMonth: number
  /** success 以外のログイン（今月）。総当たりと許可漏れの両方がここに出る */
  signInFailuresThisMonth: number
  /** 集計期間の開始時刻（JST の月初）。§8.2.3 の「今月」と同じ境界 */
  periodStart: number
}

/**
 * 利用者一覧の1行。上限値も同じ行に載せる。
 * 種別で上限が異なるため（§8.2.3）、クライアント側で種別から引き直すと
 * limits.ts と二重定義になる。
 */
export interface AdminUserRow {
  id: string
  email: string
  displayName: string
  kind: AccountKind
  isAdmin: boolean
  createdAt: number
  lastLoginAt: number | null
  courses: number
  /** 上限判定と同じ数え方をする。複製は AI を呼ばないため数えない（Q-30） */
  coursesThisMonth: number
  courseLimit: number
  costThisMonthUsd: number
  costLimitUsd: number
  costTotalUsd: number
}

/** 利用者詳細に並べる講義。本人の画面（CourseSummary）とは別物で、運営が見る値を足す */
export interface AdminCourseRow {
  id: string
  title: string
  status: CourseStatus
  quizStatus: QuizStatus
  errorMessage: string | null
  totalSteps: number
  completedSteps: number
  questions: number
  materialChars: number
  costUsd: number
  createdAt: number
  updatedAt: number
}

/** AI 呼び出し1件（ai_usage_logs の1行）。§8.4 のログ要件がそのまま画面に出る */
export interface AdminUsageRow {
  id: string
  userId: string
  userEmail: string | null
  courseId: string | null
  courseTitle: string | null
  purpose: AiPurpose
  model: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  thinkingTokens: number
  estimatedCostUsd: number
  durationMs: number
  error: string | null
  createdAt: number
}

/** ログイン1件（access_logs の1行） */
export interface AdminAccessRow {
  id: string
  userId: string | null
  userEmail: string | null
  kind: AccountKind
  identifier: string
  result: AccessResult
  ip: string | null
  createdAt: number
}

export interface AdminUserDetail {
  user: AdminUserRow
  courses: AdminCourseRow[]
  usage: AdminUsageRow[]
  access: AdminAccessRow[]
}

/** 許可リストの1行。サインイン済みかどうかを併記する（追加しただけで未使用が分かる） */
export interface AdminAllowedEmailRow {
  email: string
  note: string | null
  createdAt: number
  userId: string | null
  lastLoginAt: number | null
}

/** ゲストの1行。パスワードに関わる値（導出鍵・ソルト）は返さない */
export interface AdminGuestRow {
  loginId: string
  userId: string
  displayName: string
  failedCount: number
  /**
   * 現在ロック中かどうか。lockedUntil と現在時刻の比較をサーバー側で済ませる。
   * 画面で判定すると描画のたびに現在時刻を読むことになり、同じ値を映しているのに
   * 表示が変わりうる（React の描画は純粋であることを前提に置いている）。
   */
  locked: boolean
  lockedUntil: number | null
  createdAt: number
  lastLoginAt: number | null
  courses: number
}

/**
 * システムプロンプト1件。コードの中身ではなく、実際に送っている文字列を返す。
 * 引数で変わる箇所（講義タイトルの指定、骨子の埋め込み）は note で断る。
 */
export interface AdminPrompt {
  key: string
  label: string
  note: string | null
  body: string
}

/** 設定タブ。段階1では表示のみで、変更はコードと wrangler.jsonc で行う */
export interface AdminConfig {
  models: { purpose: AiPurpose; model: string }[]
  limits: { kind: AccountKind; courses: number; costUsd: number }[]
  prompts: AdminPrompt[]
}

export interface AdminUsersResponse {
  users: AdminUserRow[]
}
/** 一覧は上限件数で切る。切られたかどうかを hasMore で示す（黙って落とさない） */
export interface AdminUsageResponse {
  rows: AdminUsageRow[]
  hasMore: boolean
}
export interface AdminAccessResponse {
  rows: AdminAccessRow[]
  hasMore: boolean
}
export interface AdminAllowlistResponse {
  rows: AdminAllowedEmailRow[]
}
export interface AdminGuestsResponse {
  rows: AdminGuestRow[]
}
