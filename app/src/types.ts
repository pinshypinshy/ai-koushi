/**
 * 型定義。REQUIREMENTS.md §6「データモデル」に対応する。
 * UI 実装のためサーバー側の表現をそのまま持たず、画面が必要とする形に寄せている。
 */

export type CourseStatus = 'generating' | 'ready' | 'failed'
export type GeneratingPhase = 'outline' | 'quiz'
export type StepStatus = 'not_started' | 'in_progress' | 'completed'
export type Tab = 'upload' | 'lecture' | 'quiz'

export interface Step {
  id: string
  orderIndex: number
  title: string
  objective: string
  keyPoints: string[]
  status: StepStatus
  /**
   * 講義本文のモック。1要素が AI の1発話にあたる（§5.4 R-1）。
   * 実装時はここが streamLecture の逐次生成に置き換わる（§5.8）。
   */
  script: string[]
}

export interface Message {
  id: string
  stepId: string
  role: 'user' | 'assistant'
  content: string
}

export interface Choice {
  id: string
  body: string
  isCorrect: boolean
}

export interface Question {
  id: string
  stem: string
  explanation: string
  choices: Choice[]
  /** 関連するステップの id。複数持つものが横断設問（§4.3.1.1） */
  coveredStepIds: string[]
}

export interface Course {
  id: string
  title: string
  status: CourseStatus
  phase?: GeneratingPhase
  errorMessage?: string
  sourceMarkdown: string
  steps: Step[]
  questions: Question[]
  messages: Message[]
  currentStepId: string | null
  /** 現在のステップで何発話目まで提示したか */
  scriptCursor: number
  updatedAt: number
}

export interface Attempt {
  questionId: string
  selectedChoiceId: string
  isCorrect: boolean
  answeredAt: number
}

export interface User {
  name: string
  email: string
}
