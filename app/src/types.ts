/**
 * 型定義。REQUIREMENTS.md §6「データモデル」に対応する。
 *
 * 講義・ステップ・対話はサーバーと共有する shared/api.ts の型に寄せている。
 * 一方、講義タブと確認テストタブはまだモックで動いているため、台本（script）や
 * 設問（Question）といったモック専用の項目が画面側にだけ残っている。
 * これらは段階3（受講と確認テストの接続）で取り除く。
 */

import type {
  ApiMessage,
  ApiStep,
  CourseStatus,
  GeneratingPhase,
  QuizStatus,
  StepStatus,
} from '../../shared/api'

export type { CourseStatus, GeneratingPhase, QuizStatus, StepStatus }
export type Tab = 'material' | 'lecture' | 'quiz'

export interface Step extends ApiStep {
  /** 講義本文のモック。1要素が AI の1発話にあたる（§5.4 R-1）。実データでは持たない */
  script?: string[]
}

export type Message = ApiMessage

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
  quizStatus: QuizStatus
  phase?: GeneratingPhase | null
  errorMessage?: string | null
  /** 教材タブで表示する原文。取得するまでは空（§4.4） */
  sourceMarkdown: string
  /** 教材原文を取得済みか。空の教材と未取得を区別する */
  materialLoaded?: boolean
  steps: Step[]
  questions: Question[]
  messages: Message[]
  currentStepId: string | null
  /** 現在のステップで何発話目まで提示したか（モック専用） */
  scriptCursor: number
  updatedAt: number
  /** 一覧だけを持つ状態でも進捗を表示できるようにする（§6.4 講義一覧は軽量に保つ） */
  totalSteps?: number
  completedSteps?: number
  /** ステップと対話まで取得済みか。未取得なら選択時に取りに行く */
  detailLoaded?: boolean
  /** 開発パネルが投入したモック講義。サーバーへ問い合わせない目印 */
  isMock?: boolean
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
