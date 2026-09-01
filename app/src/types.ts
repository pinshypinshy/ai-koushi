/**
 * 型定義。REQUIREMENTS.md §6「データモデル」に対応する。
 * サーバーと共有する shared/api.ts の型に寄せ、画面固有のものだけをここに置く。
 */

import type {
  ApiChoice,
  ApiMessage,
  ApiQuestion,
  ApiStep,
  CourseStatus,
  GeneratingPhase,
  QuizStatus,
  StepStatus,
} from '../../shared/api'

export type { CourseStatus, GeneratingPhase, QuizStatus, StepStatus }
export type Tab = 'material' | 'lecture' | 'quiz'

export type Step = ApiStep
export type Message = ApiMessage
export type Choice = ApiChoice
export type Question = ApiQuestion

export interface Course {
  id: string
  title: string
  status: CourseStatus
  quizStatus: QuizStatus
  phase?: GeneratingPhase | null
  errorMessage?: string | null
  /** 教材タブで表示する原文。取得するまでは空（§4.4） */
  sourceMarkdown: string
  /** 教材原文を取得済みか。空の教材と未取得を区別する */
  materialLoaded?: boolean
  steps: Step[]
  /** 確認テストの設問。開いた時点で取得する（§4.3） */
  questions: Question[]
  quizLoaded?: boolean
  messages: Message[]
  currentStepId: string | null
  updatedAt: number
  /** 一覧だけを持つ状態でも進捗を表示できるようにする（§6.4 講義一覧は軽量に保つ） */
  totalSteps?: number
  completedSteps?: number
  /** ステップと対話まで取得済みか。未取得なら選択時に取りに行く */
  detailLoaded?: boolean
}

/**
 * 解答の記録（§4.3.3）。
 * 選択した選択肢は保持しない。画面が使うのは正誤と時刻だけであり、
 * 履歴そのものはサーバー側の attempts に残る。
 */
export interface Attempt {
  questionId: string
  isCorrect: boolean
  answeredAt: number
}

export interface User {
  name: string
  email: string
}
