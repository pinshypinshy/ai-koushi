import { createContext, useContext, type Dispatch } from 'react'
import type { Attempt, Course, Question, Tab, User } from './types'
import { SAMPLE_MARKDOWN, createInitialCourses } from './mock/data'

export const MOCK_USER: User = { name: '平石悠生', email: 'hrisyklit@gmail.com' }

/** 教材の文字数制約（§4.1.2） */
export const MIN_CHARS = 500
export const MAX_CHARS = 80000

export type QuizPhase = 'start' | 'question' | 'result'

export interface QuizState {
  phase: QuizPhase
  order: string[]
  index: number
  selectedChoiceId: string | null
  revealed: boolean
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
  | { type: 'course'; courseId: string }
  | { type: 'user' }

export interface State {
  authed: boolean
  courses: Course[]
  selectedCourseId: string | null
  tab: Tab
  quiz: QuizState
  attempts: Attempt[]
  modal: ModalState
  menu: MenuState
  drawerOpen: boolean
  progressOpen: boolean
  /** アップロードタブの入力状態 */
  draftTitle: string
  draftMarkdown: string
  /** 直前に追加された assistant メッセージ（ストリーミング演出の対象） */
  streamingMessageId: string | null
}

const emptyQuiz: QuizState = {
  phase: 'start',
  order: [],
  index: 0,
  selectedChoiceId: null,
  revealed: false,
  reviewMode: false,
  stepFilter: [],
}

export function initialState(): State {
  const courses = createInitialCourses()
  return {
    authed: false,
    courses,
    selectedCourseId: courses[0]?.id ?? null,
    tab: 'lecture',
    quiz: emptyQuiz,
    attempts: [],
    modal: null,
    menu: null,
    drawerOpen: false,
    progressOpen: false,
    draftTitle: '',
    draftMarkdown: '',
    streamingMessageId: null,
  }
}

export type Action =
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'selectCourse'; id: string }
  | { type: 'setTab'; tab: Tab }
  | { type: 'setDraft'; title?: string; markdown?: string }
  | { type: 'openModal'; modal: ModalState }
  | { type: 'openMenu'; menu: MenuState }
  | { type: 'setDrawer'; open: boolean }
  | { type: 'toggleProgress' }
  | { type: 'createCourse' }
  | { type: 'generationPhase'; courseId: string; phase: 'outline' | 'quiz' }
  | { type: 'generationDone'; courseId: string }
  | { type: 'generationFail'; courseId: string; message: string }
  | { type: 'retryGeneration'; courseId: string }
  | { type: 'deleteCourse'; courseId: string }
  | { type: 'renameCourse'; courseId: string; title: string }
  | { type: 'sendMessage'; text: string }
  | { type: 'advanceStep' }
  | { type: 'endStreaming' }
  | { type: 'toggleStepFilter'; stepId: string }
  | { type: 'startQuiz'; reviewMode: boolean }
  | { type: 'selectChoice'; choiceId: string }
  | { type: 'reveal' }
  | { type: 'nextQuestion' }
  | { type: 'backToQuizStart' }
  | { type: 'devScenario'; name: DevScenario }

export type DevScenario =
  | 'reset'
  | 'login'
  | 'empty'
  | 'generating'
  | 'failed'
  | 'uploadSample'
  | 'confirmCreate'
  | 'deleteDialog'
  | 'courseMenu'
  | 'userMenu'
  | 'quizStart'
  | 'quizQuestion'
  | 'quizRevealed'
  | 'quizResult'
  | 'reviewEmpty'
  | 'lectureStepEnd'

let idSeq = 1000
const nid = (p: string) => `${p}-${++idSeq}`

/** 台本を使い切った後の質問応答モック（§4.2.4） */
const FALLBACK_ANSWERS = [
  'よい質問です。教材の該当箇所を確認すると、その点は次のように説明されています。\n\n該当ステップの要点に立ち返ると、判断の分かれ目は「どこに変更が置かれているか」です。手元の状態を `git status` で確認しながら追うと理解しやすくなります。',
  '補足します。\n\nその挙動は教材に明記されていませんが、一般的な運用としては後続のステップで扱う内容と関係します。ここでは現在のステップの範囲に絞って、まず基本の流れを押さえてください。',
  '整理すると、混同しやすいのは名前が似ている2つの操作です。\n\n片方は状態を「移す」操作、もう片方は「記録する」操作です。目的が違うと意識すると区別しやすくなります。',
]
let fallbackCursor = 0

function currentCourse(s: State): Course | null {
  return s.courses.find((c) => c.id === s.selectedCourseId) ?? null
}

function updateCourse(s: State, id: string, fn: (c: Course) => Course): Course[] {
  return s.courses.map((c) => (c.id === id ? fn(c) : c))
}

export function latestAttempt(attempts: Attempt[], questionId: string): Attempt | null {
  let found: Attempt | null = null
  for (const a of attempts) {
    if (a.questionId === questionId && (!found || a.answeredAt > found.answeredAt)) found = a
  }
  return found
}

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
    case 'login':
      return { ...s, authed: true }
    case 'logout':
      return { ...initialState(), authed: false }
    case 'selectCourse':
      return { ...s, selectedCourseId: action.id, tab: 'lecture', drawerOpen: false, quiz: emptyQuiz }
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

    case 'createCourse': {
      const id = nid('course')
      const base = createInitialCourses()[0]
      const course: Course = {
        ...base,
        id,
        title: s.draftTitle.trim() || '無題の講義',
        status: 'generating',
        phase: 'outline',
        sourceMarkdown: s.draftMarkdown,
        messages: [],
        currentStepId: null,
        scriptCursor: 0,
        steps: base.steps.map((x) => ({ ...x, status: 'not_started' })),
        updatedAt: Date.now(),
      }
      return {
        ...s,
        courses: [course, ...s.courses],
        selectedCourseId: id,
        tab: 'lecture',
        modal: null,
        draftTitle: '',
        draftMarkdown: '',
      }
    }
    case 'generationPhase':
      return { ...s, courses: updateCourse(s, action.courseId, (c) => ({ ...c, phase: action.phase })) }
    case 'generationDone':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => {
          const steps = c.steps.map((x, i) => ({
            ...x,
            status: (i === 0 ? 'in_progress' : 'not_started') as never,
          }))
          const first = steps[0]
          return {
            ...c,
            status: 'ready',
            phase: undefined,
            steps,
            currentStepId: first.id,
            scriptCursor: 1,
            messages: [
              { id: nid('m'), stepId: first.id, role: 'assistant', content: first.script[0] },
            ],
          }
        }),
      }
    case 'generationFail':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({
          ...c,
          status: 'failed',
          phase: undefined,
          errorMessage: action.message,
        })),
      }
    case 'retryGeneration':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({
          ...c,
          status: 'generating',
          phase: 'outline',
          errorMessage: undefined,
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
      }
    }
    case 'renameCourse':
      return {
        ...s,
        courses: updateCourse(s, action.courseId, (c) => ({ ...c, title: action.title })),
        menu: null,
      }

    case 'sendMessage': {
      const c = currentCourse(s)
      if (!c || !c.currentStepId) return s
      const step = c.steps.find((x) => x.id === c.currentStepId)!
      const userMsg = {
        id: nid('m'),
        stepId: step.id,
        role: 'user' as const,
        content: action.text,
      }
      const hasNext = c.scriptCursor < step.script.length
      const content = hasNext
        ? step.script[c.scriptCursor]
        : FALLBACK_ANSWERS[fallbackCursor++ % FALLBACK_ANSWERS.length]
      const aiMsg = { id: nid('m'), stepId: step.id, role: 'assistant' as const, content }
      return {
        ...s,
        streamingMessageId: aiMsg.id,
        courses: updateCourse(s, c.id, (x) => ({
          ...x,
          messages: [...x.messages, userMsg, aiMsg],
          scriptCursor: hasNext ? x.scriptCursor + 1 : x.scriptCursor,
          updatedAt: Date.now(),
        })),
      }
    }
    case 'advanceStep': {
      const c = currentCourse(s)
      if (!c || !c.currentStepId) return s
      const idx = c.steps.findIndex((x) => x.id === c.currentStepId)
      const next = c.steps[idx + 1]
      const steps = c.steps.map((x, i) =>
        i === idx
          ? { ...x, status: 'completed' as const }
          : i === idx + 1
            ? { ...x, status: 'in_progress' as const }
            : x,
      )
      if (!next) {
        return {
          ...s,
          courses: updateCourse(s, c.id, (x) => ({ ...x, steps, currentStepId: null })),
        }
      }
      const aiMsg = { id: nid('m'), stepId: next.id, role: 'assistant' as const, content: next.script[0] }
      return {
        ...s,
        streamingMessageId: aiMsg.id,
        courses: updateCourse(s, c.id, (x) => ({
          ...x,
          steps,
          currentStepId: next.id,
          scriptCursor: 1,
          messages: [...x.messages, aiMsg],
          updatedAt: Date.now(),
        })),
      }
    }
    case 'endStreaming':
      return { ...s, streamingMessageId: null }

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
      const c = currentCourse(s)
      if (!c) return s
      const pool = action.reviewMode
        ? wrongQuestions(c, s.attempts)
        : s.quiz.stepFilter.length === 0
          ? c.questions
          : c.questions.filter((q) =>
              q.coveredStepIds.some((id) => s.quiz.stepFilter.includes(id)),
            )
      if (pool.length === 0) {
        return { ...s, quiz: { ...s.quiz, phase: 'result', order: [], index: 0, reviewMode: action.reviewMode } }
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
          revealed: false,
          reviewMode: action.reviewMode,
        },
      }
    }
    case 'selectChoice':
      return s.quiz.revealed ? s : { ...s, quiz: { ...s.quiz, selectedChoiceId: action.choiceId } }
    case 'reveal': {
      const c = currentCourse(s)
      const qid = s.quiz.order[s.quiz.index]
      const question = c?.questions.find((q) => q.id === qid)
      const choice = question?.choices.find((x) => x.id === s.quiz.selectedChoiceId)
      if (!question || !choice) return s
      return {
        ...s,
        quiz: { ...s.quiz, revealed: true },
        attempts: [
          ...s.attempts,
          {
            questionId: question.id,
            selectedChoiceId: choice.id,
            isCorrect: choice.isCorrect,
            answeredAt: Date.now(),
          },
        ],
      }
    }
    case 'nextQuestion': {
      const last = s.quiz.index >= s.quiz.order.length - 1
      return {
        ...s,
        quiz: last
          ? { ...s.quiz, phase: 'result' }
          : { ...s.quiz, index: s.quiz.index + 1, selectedChoiceId: null, revealed: false },
      }
    }
    case 'backToQuizStart':
      return { ...s, quiz: { ...emptyQuiz, stepFilter: s.quiz.stepFilter } }

    case 'devScenario':
      return applyScenario(s, action.name)
    default:
      return s
  }
}

function applyScenario(s: State, name: DevScenario): State {
  const fresh = { ...initialState(), authed: true }
  const gitId = 'c-git'
  switch (name) {
    case 'reset':
      return fresh
    case 'login':
      return { ...initialState(), authed: false }
    case 'empty':
      return { ...fresh, courses: [], selectedCourseId: null }
    case 'generating':
      return {
        ...fresh,
        tab: 'lecture',
        selectedCourseId: gitId,
        courses: updateCourse(fresh, gitId, (c) => ({ ...c, status: 'generating', phase: 'outline' })),
      }
    case 'failed':
      return {
        ...fresh,
        tab: 'lecture',
        selectedCourseId: gitId,
        courses: updateCourse(fresh, gitId, (c) => ({
          ...c,
          status: 'failed',
          errorMessage: 'レート制限に達しました。',
        })),
      }
    case 'uploadSample':
      return { ...fresh, tab: 'upload', draftTitle: 'Git入門', draftMarkdown: SAMPLE_MARKDOWN }
    case 'confirmCreate':
      return {
        ...fresh,
        tab: 'upload',
        draftTitle: 'Git入門',
        draftMarkdown: SAMPLE_MARKDOWN,
        modal: { type: 'confirmCreate', title: 'Git入門', charCount: SAMPLE_MARKDOWN.length },
      }
    case 'deleteDialog':
      return { ...fresh, modal: { type: 'deleteCourse', courseId: gitId } }
    case 'courseMenu':
      return { ...fresh, menu: { type: 'course', courseId: gitId } }
    case 'userMenu':
      return { ...fresh, menu: { type: 'user' } }
    case 'quizStart':
      return { ...fresh, tab: 'quiz', selectedCourseId: gitId, attempts: sampleAttempts(fresh) }
    case 'quizQuestion': {
      const withAttempts = { ...fresh, tab: 'quiz' as const, selectedCourseId: gitId }
      return reducer(withAttempts, { type: 'startQuiz', reviewMode: false })
    }
    case 'quizRevealed': {
      const base = reducer(
        { ...fresh, tab: 'quiz', selectedCourseId: gitId },
        { type: 'startQuiz', reviewMode: false },
      )
      const q = base.courses
        .find((c) => c.id === gitId)!
        .questions.find((x) => x.id === base.quiz.order[0])!
      const wrong = q.choices.find((c) => !c.isCorrect)!
      return reducer(reducer(base, { type: 'selectChoice', choiceId: wrong.id }), { type: 'reveal' })
    }
    case 'quizResult': {
      const withAttempts = { ...fresh, tab: 'quiz' as const, selectedCourseId: gitId, attempts: sampleAttempts(fresh) }
      const started = reducer(withAttempts, { type: 'startQuiz', reviewMode: false })
      return { ...started, quiz: { ...started.quiz, phase: 'result' } }
    }
    case 'reviewEmpty': {
      const c = fresh.courses.find((x) => x.id === gitId)!
      const allCorrect: Attempt[] = c.questions.map((q) => ({
        questionId: q.id,
        selectedChoiceId: q.choices.find((x) => x.isCorrect)!.id,
        isCorrect: true,
        answeredAt: Date.now(),
      }))
      const st = { ...fresh, tab: 'quiz' as const, selectedCourseId: gitId, attempts: allCorrect }
      return reducer(st, { type: 'startQuiz', reviewMode: true })
    }
    case 'lectureStepEnd': {
      const st = { ...fresh, tab: 'lecture' as const, selectedCourseId: gitId }
      return {
        ...st,
        courses: updateCourse(st, gitId, (c) => {
          const step = c.steps.find((x) => x.id === c.currentStepId)!
          return {
            ...c,
            scriptCursor: step.script.length,
            messages: step.script.map((content, i) => ({
              id: nid('m'),
              stepId: step.id,
              role: 'assistant' as const,
              content: i === 0 ? content : content,
            })),
          }
        }),
      }
    }
    default:
      return s
  }
}

/** 開始画面や結果画面の見た目確認用に、正誤混在の解答記録を作る */
function sampleAttempts(s: State): Attempt[] {
  const c = s.courses.find((x) => x.id === 'c-git')
  if (!c) return []
  return c.questions.slice(0, 9).map((q, i) => {
    const correct = i % 3 !== 0
    const choice = correct
      ? q.choices.find((x) => x.isCorrect)!
      : q.choices.find((x) => !x.isCorrect)!
    return { questionId: q.id, selectedChoiceId: choice.id, isCorrect: correct, answeredAt: i + 1 }
  })
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
