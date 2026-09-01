import { createContext, useContext, type Dispatch } from 'react'
import type { AttemptResult } from '../../shared/api'
import type { Attempt, Course, Message, Question, Tab, User } from './types'

/** 教材の文字数制約（§4.1.2） */
export const MIN_CHARS = 500
export const MAX_CHARS = 80000

export type QuizPhase = 'start' | 'question' | 'result'

export interface QuizState {
  phase: QuizPhase
  order: string[]
  index: number
  selectedChoiceId: string | null
  /**
   * 採点結果（§4.3.2）。null なら未回答。
   * 正誤・正解・解説はサーバーの採点で初めて渡されるため、出題側は持っていない。
   */
  result: AttemptResult | null
  /** 採点の通信中。二重送信を防ぐ */
  grading: boolean
  reviewMode: boolean
  /** 開始画面で選択中の絞り込みステップ id */
  stepFilter: string[]
}

export type ModalState =
  | null
  | { type: 'confirmCreate'; title: string; charCount: number }
  | { type: 'deleteCourse'; courseId: string }

export type MenuState =
  | null
  /** renaming は SC-13 の「名前を変更」を選んだ後の状態（その場で編集可能にする） */
  | { type: 'course'; courseId: string; renaming?: boolean }
  | { type: 'user' }

/** 受信中の発話（§8.1）。届いた文字をそのまま積み、完了時に messages へ移す */
export interface StreamingState {
  stepId: string
  text: string
}

export interface State {
  authed: boolean
  /** 起動時の問い合わせが終わったか。終わるまではログイン画面も本体も出さない */
  booted: boolean
  user: User | null
  courses: Course[]
  selectedCourseId: string | null
  tab: Tab
  quiz: QuizState
  attempts: Attempt[]
  modal: ModalState
  menu: MenuState
  drawerOpen: boolean
  progressOpen: boolean
  /** 講義作成オーバーレイ（SC-03）を開いているか */
  createOpen: boolean
  /** 講義作成オーバーレイの入力状態 */
  draftTitle: string
  draftMarkdown: string
  /** 講義作成の要求がサーバーに拒否されたときの文言（文字数・月間上限など） */
  createError: string | null
  streaming: StreamingState | null
  /** 受信が中断したときの文言（§5.7） */
  streamError: string | null
}

const emptyQuiz: QuizState = {
  phase: 'start',
  order: [],
  index: 0,
  selectedChoiceId: null,
  result: null,
  grading: false,
  reviewMode: false,
  stepFilter: [],
}

export function initialState(): State {
  return {
    authed: false,
    booted: false,
    user: null,
    courses: [],
    selectedCourseId: null,
    tab: 'lecture',
    quiz: emptyQuiz,
    attempts: [],
    modal: null,
    menu: null,
    drawerOpen: false,
    progressOpen: false,
    createOpen: false,
    draftTitle: '',
    draftMarkdown: '',
    createError: null,
    streaming: null,
    streamError: null,
  }
}

export type Action =
  | { type: 'logout' }
  /** 起動時の /api/bootstrap の結果 */
  | { type: 'bootstrapped'; user: User; courses: Course[]; selectedId: string | null }
  /** 未ログイン、または起動時の問い合わせに失敗した */
  | { type: 'bootFailed' }
  /** サーバーから取り直した講義で置き換える（選択時・生成中のポーリング・ステップ完了） */
  | { type: 'courseUpdated'; course: Course }
  | { type: 'courseCreated'; course: Course }
  | { type: 'materialLoaded'; courseId: string; markdown: string }
  | { type: 'setCreateError'; message: string | null }
  | { type: 'selectCourse'; id: string }
  | { type: 'setTab'; tab: Tab }
  | { type: 'setDraft'; title?: string; markdown?: string }
  | { type: 'openModal'; modal: ModalState }
  | { type: 'openMenu'; menu: MenuState }
  | { type: 'setDrawer'; open: boolean }
  | { type: 'toggleProgress' }
  | { type: 'openCreate' }
  | { type: 'closeCreate' }
  | { type: 'retryGeneration'; courseId: string }
  | { type: 'deleteCourse'; courseId: string }
  | { type: 'renameCourse'; courseId: string; title: string }
  // 受講（③④）
  | { type: 'messageAppended'; courseId: string; message: Message }
  | { type: 'streamStart'; stepId: string }
  | { type: 'streamDelta'; text: string }
  | { type: 'streamEnd' }
  | { type: 'streamFailed'; message: string }
  // 確認テスト
  | { type: 'quizLoaded'; courseId: string; questions: Question[]; attempts: Attempt[] }
  | { type: 'gradingStarted' }
  | { type: 'gradingFailed' }
  | { type: 'attemptRecorded'; result: AttemptResult }
  | { type: 'toggleStepFilter'; stepId: string }
  | { type: 'startQuiz'; reviewMode: boolean }
  | { type: 'selectChoice'; choiceId: string }
  | { type: 'nextQuestion' }
  | { type: 'backToQuizStart' }

function updateCourse(s: State, id: string, fn: (c: Course) => Course): Course[] {
  return s.courses.map((c) => (c.id === id ? fn(c) : c))
}

/**
 * サーバーから取り直した講義を、手元の講義へ重ねる。
 *
 * 一覧（/api/bootstrap）は軽量で、ステップも対話も持たない（§6.4）。
 * 単純に置き換えると、選択中の講義の中身が一覧の更新で消えてしまうため、
 * 「取得できたものだけを上書きする」形にする。
 */
function mergeCourse(prev: Course, next: Course): Course {
  return {
    ...prev,
    ...next,
    steps: next.detailLoaded ? next.steps : prev.steps,
    messages: next.detailLoaded ? next.messages : prev.messages,
    detailLoaded: prev.detailLoaded || next.detailLoaded,
    // 教材原文と設問は別のエンドポイントで取得する。講義の更新では触らない
    sourceMarkdown: prev.materialLoaded ? prev.sourceMarkdown : next.sourceMarkdown,
    materialLoaded: prev.materialLoaded,
    questions: prev.quizLoaded ? prev.questions : next.questions,
    quizLoaded: prev.quizLoaded,
  }
}

export function latestAttempt(attempts: Attempt[], questionId: string): Attempt | null {
  let found: Attempt | null = null
  for (const a of attempts) {
    if (a.questionId === questionId && (!found || a.answeredAt > found.answeredAt)) found = a
  }
  return found
}

/** 復習モードの対象（§4.3.4）。最新の解答が誤答である設問 */
export function wrongQuestions(course: Course, attempts: Attempt[]): Question[] {
  return course.questions.filter((q) => latestAttempt(attempts, q.id)?.isCorrect === false)
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function reducer(s: State, action: Action): State {
  switch (action.type) {
    case 'logout':
      return { ...initialState(), booted: true, authed: false }
    case 'bootstrapped':
      return {
        ...s,
        booted: true,
        authed: true,
        user: action.user,
        courses: action.courses,
        selectedCourseId: action.selectedId,
      }
    case 'bootFailed':
      return { ...s, booted: true, authed: false }
    case 'courseUpdated':
      return {
        ...s,
        courses: s.courses.map((c) =>
          c.id === action.course.id ? mergeCourse(c, action.course) : c,
        ),
      }
    case 'courseCreated':
      return {
        ...s,
        courses: [action.course, ...s.courses],
        selectedCourseId: action.course.id,
        tab: 'lecture',
        createOpen: false,
        modal: null,
        draftTitle: '',
        draftMarkdown: '',
        createError: null,
      }
    case 'materialLoaded':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({
          ...c,
          sourceMarkdown: action.markdown,
          materialLoaded: true,
        })),
      }
    case 'setCreateError':
      return { ...s, createError: action.message }
    case 'selectCourse':
      return {
        ...s,
        selectedCourseId: action.id,
        tab: 'lecture',
        drawerOpen: false,
        createOpen: false,
        quiz: emptyQuiz,
        // 受信中の発話は選択中の講義に属する。切り替えたら破棄する
        streaming: null,
        streamError: null,
      }
    case 'setTab':
      return { ...s, tab: action.tab, quiz: action.tab === 'quiz' ? { ...emptyQuiz } : s.quiz }
    case 'setDraft':
      return {
        ...s,
        draftTitle: action.title ?? s.draftTitle,
        draftMarkdown: action.markdown ?? s.draftMarkdown,
      }
    case 'openModal':
      return { ...s, modal: action.modal }
    case 'openMenu':
      return { ...s, menu: action.menu }
    case 'setDrawer':
      return { ...s, drawerOpen: action.open }
    case 'toggleProgress':
      return { ...s, progressOpen: !s.progressOpen }
    // 書きかけの入力は破棄せずに復元する（§4.1.5）
    case 'openCreate':
      return { ...s, createOpen: true, drawerOpen: false, menu: null }
    case 'closeCreate':
      return { ...s, createOpen: false }
    case 'retryGeneration':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({
          ...c,
          status: 'generating',
          quizStatus: 'pending',
          phase: 'outline',
          errorMessage: null,
        })),
      }
    case 'deleteCourse': {
      const courses = s.courses.filter((c) => c.id !== action.courseId)
      return {
        ...s,
        courses,
        selectedCourseId:
          s.selectedCourseId === action.courseId ? (courses[0]?.id ?? null) : s.selectedCourseId,
        modal: null,
        menu: null,
        quiz: emptyQuiz,
      }
    }
    case 'renameCourse':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({ ...c, title: action.title })),
        menu: null,
      }

    // ------------------------------------------------------------ 受講（③④）
    case 'messageAppended':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({
          ...c,
          messages: [...c.messages, action.message],
          updatedAt: action.message.createdAt,
        })),
      }
    case 'streamStart':
      return { ...s, streaming: { stepId: action.stepId, text: '' }, streamError: null }
    case 'streamDelta':
      return s.streaming
        ? { ...s, streaming: { ...s.streaming, text: s.streaming.text + action.text } }
        : s
    case 'streamEnd':
      return { ...s, streaming: null }
    case 'streamFailed':
      return { ...s, streaming: null, streamError: action.message }

    // ---------------------------------------------------------- 確認テスト
    case 'quizLoaded':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({
          ...c,
          questions: action.questions,
          quizLoaded: true,
        })),
        // サーバーの解答記録を初期値にする。手元の記録は同じ講義のものだけ入れ替える
        attempts: [
          ...s.attempts.filter(
            (a) => !action.questions.some((q) => q.id === a.questionId),
          ),
          ...action.attempts,
        ],
      }
    case 'gradingStarted':
      return { ...s, quiz: { ...s.quiz, grading: true } }
    case 'gradingFailed':
      return { ...s, quiz: { ...s.quiz, grading: false } }
    case 'attemptRecorded':
      return {
        ...s,
        quiz: { ...s.quiz, grading: false, result: action.result },
        attempts: [
          ...s.attempts,
          {
            questionId: action.result.questionId,
            isCorrect: action.result.isCorrect,
            answeredAt: action.result.answeredAt,
          },
        ],
      }
    case 'toggleStepFilter': {
      const f = s.quiz.stepFilter
      return {
        ...s,
        quiz: {
          ...s.quiz,
          stepFilter: f.includes(action.stepId)
            ? f.filter((x) => x !== action.stepId)
            : [...f, action.stepId],
        },
      }
    }
    case 'startQuiz': {
      const c = s.courses.find((x) => x.id === s.selectedCourseId)
      if (!c) return s
      const pool = action.reviewMode
        ? wrongQuestions(c, s.attempts)
        : s.quiz.stepFilter.length === 0
          ? c.questions
          : c.questions.filter((q) =>
              q.coveredStepIds.some((id) => s.quiz.stepFilter.includes(id)),
            )
      if (pool.length === 0) {
        return {
          ...s,
          quiz: {
            ...s.quiz,
            phase: 'result',
            order: [],
            index: 0,
            result: null,
            reviewMode: action.reviewMode,
          },
        }
      }
      return {
        ...s,
        quiz: {
          ...s.quiz,
          // §4.3.1 出題順は受験のたびにシャッフルする（Q-6）
          order: shuffle(pool.map((q) => q.id)),
          index: 0,
          phase: 'question',
          selectedChoiceId: null,
          result: null,
          grading: false,
          reviewMode: action.reviewMode,
        },
      }
    }
    case 'selectChoice':
      // 確定後の変更は不可（§4.3.2）
      return s.quiz.result ? s : { ...s, quiz: { ...s.quiz, selectedChoiceId: action.choiceId } }
    case 'nextQuestion': {
      const last = s.quiz.index >= s.quiz.order.length - 1
      return {
        ...s,
        quiz: last
          ? { ...s.quiz, phase: 'result' }
          : {
              ...s.quiz,
              index: s.quiz.index + 1,
              selectedChoiceId: null,
              result: null,
            },
      }
    }
    case 'backToQuizStart':
      return { ...s, quiz: { ...emptyQuiz, stepFilter: s.quiz.stepFilter } }
    default:
      return s
  }
}

export const StoreCtx = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null)

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('StoreProvider の外で useStore が呼ばれました')
  return ctx
}

export function useCurrentCourse(): Course | null {
  const { state } = useStore()
  return state.courses.find((c) => c.id === state.selectedCourseId) ?? null
}
