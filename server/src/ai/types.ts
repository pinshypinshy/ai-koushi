/**
 * REQUIREMENTS.md §5.8「AI呼び出し層の抽象化」。
 *
 * MVP で実装するのは Gemini 版のみであり、この抽象化は将来の差し替え余地を
 * 確保するためだけに置く。実装を1つしか持たない段階で過剰な汎用化は行わない。
 */

export type AiPurpose = 'outline' | 'quiz' | 'lecture' | 'answer' | 'summary'

/** §5.2 の出力スキーマに対応する。order_index は 1 始まり */
export interface OutlineStep {
  orderIndex: number
  title: string
  objective: string
  keyPoints: string[]
  sourceRef: string
}

export interface OutlineResult {
  courseTitle: string
  steps: OutlineStep[]
}

/** §5.3 の出力スキーマに対応する */
export interface QuizQuestion {
  stem: string
  choices: string[]
  correctIndex: number
  explanation: string
  /** 関連するステップの orderIndex。複数持つものが横断設問（§4.3.1.1） */
  coveredSteps: number[]
}

export interface QuizResult {
  questions: QuizQuestion[]
}

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/** 完了済みステップの要約（§5.4「進捗」層） */
export interface StepSummary {
  orderIndex: number
  title: string
  summary: string
}

/**
 * §5.4 のコンテキスト構成に対応する。
 * material と outline は講義中不変であり、プロンプトキャッシュの対象になる。
 * courseId はキャッシュの引き当てキーとして使う。
 */
export interface LectureContext {
  courseId: string
  material: string
  outline: OutlineStep[]
  completedSummaries: StepSummary[]
  currentStep: OutlineStep
  /** 現ステップ内の全メッセージ。過去ステップは completedSummaries で表現する */
  history: Turn[]
}

export interface AiClient {
  generateOutline(input: { material: string; titleHint?: string }): Promise<OutlineResult>
  generateQuiz(input: { material: string; outline: OutlineStep[]; courseId: string }): Promise<QuizResult>
  streamLecture(ctx: LectureContext): AsyncIterable<string>
  streamAnswer(ctx: LectureContext & { question: string }): AsyncIterable<string>
  summarizeStep(input: { step: OutlineStep; history: Turn[] }): Promise<string>
}

/** 実際に消費したトークン。§8.2.4 の計上に用いる */
export interface UsageRecord {
  purpose: AiPurpose
  model: string
  inputTokens: number
  cachedInputTokens: number
  /** 思考トークンを含む。課金上は出力として扱われるため合算する */
  outputTokens: number
  durationMs: number
  error?: string
}

/**
 * コンテキストキャッシュの保存先。
 * Gemini のキャッシュは保存時間に応じた従量課金が乗るため（§8.2.1）、
 * 生存期間を明示的に管理する必要がある。
 */
export interface CacheRef {
  name: string
  expiresAt: number
}

export interface CacheStore {
  get(courseId: string, model: string): Promise<CacheRef | null>
  set(courseId: string, model: string, ref: CacheRef): Promise<void>
  delete(courseId: string, model: string): Promise<void>
}
