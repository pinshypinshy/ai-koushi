import type {
  ApiMessage,
  ApiQuestion,
  ApiStep,
  AttemptResult,
  AttemptSummary,
  BootstrapResponse,
  CourseDetail,
  CourseSummary,
  MaterialResponse,
  QuizResponse,
} from '../../../shared/api'
import { DEMO_MATERIAL, DEMO_QUESTIONS, DEMO_STEPS, stepId } from './data'

/**
 * ログイン前に中身を見てもらうためのサンプル（「画面を見る」）。
 *
 * サーバーと同じ形の応答をこの層で組み立て、api.ts が入口で振り分ける。
 * 画面側にサンプル用の分岐を作らないための構成であり、実データとサンプルで
 * 画面のコードが二重にならないようにしている。
 */

const COURSE_ID = 'demo-course'
const COURSE_TITLE = 'Git入門（サンプル）'

/** URL に demo が付いている間だけサンプルとして振る舞う */
export function isDemo(): boolean {
  return new URLSearchParams(window.location.search).has('demo')
}

interface Session {
  steps: ApiStep[]
  messages: ApiMessage[]
  currentStepId: string | null
  attempts: AttemptSummary[]
  /** ステップごとに何発話目まで出したか。台本を順に出すために持つ */
  cursor: Record<string, number>
}

let session: Session | null = null

/** サンプルの初期状態。ステップ2まで受講済みで、3つ目の解説がこれから始まる */
function createSession(): Session {
  const steps: ApiStep[] = DEMO_STEPS.map((s, i) => ({
    id: stepId(s.title),
    orderIndex: s.orderIndex,
    title: s.title,
    objective: s.objective,
    keyPoints: s.keyPoints,
    sourceRef: null,
    status: i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'not_started',
    completedAt: i < 2 ? Date.now() : null,
  }))

  // 過去のステップにも会話を残す。チャットの形と区切りの見え方を伝えるため
  const messages: ApiMessage[] = []
  const cursor: Record<string, number> = {}
  DEMO_STEPS.slice(0, 2).forEach((s, i) => {
    const id = stepId(s.title)
    messages.push(
      {
        id: `demo-m-${i}-0`,
        stepId: id,
        role: 'assistant',
        content: s.script[0],
        createdAt: Date.now() - (2 - i) * 60_000,
      },
      {
        id: `demo-m-${i}-1`,
        stepId: id,
        role: 'user',
        content: 'なるほど、理解できました。',
        createdAt: Date.now() - (2 - i) * 60_000 + 1000,
      },
    )
    cursor[id] = 1
  })

  return { steps, messages, currentStepId: steps[2]?.id ?? null, attempts: [], cursor }
}

function state(): Session {
  session ??= createSession()
  return session
}

function summary(): CourseSummary {
  const s = state()
  return {
    id: COURSE_ID,
    title: COURSE_TITLE,
    status: 'ready',
    quizStatus: 'ready',
    phase: null,
    errorMessage: null,
    totalSteps: s.steps.length,
    completedSteps: s.steps.filter((x) => x.status === 'completed').length,
    updatedAt: Date.now(),
  }
}

export function demoCourse(): CourseDetail {
  const s = state()
  return { ...summary(), currentStepId: s.currentStepId, steps: s.steps, messages: s.messages }
}

export function demoBootstrap(): BootstrapResponse {
  return {
    user: { id: 'demo-user', email: 'sample@example.com', displayName: 'サンプル' },
    courses: [summary()],
    selected: demoCourse(),
  }
}

export function demoMaterial(): MaterialResponse {
  return {
    courseId: COURSE_ID,
    title: COURSE_TITLE,
    charCount: DEMO_MATERIAL.length,
    rawMarkdown: DEMO_MATERIAL,
  }
}

const questionId = (i: number) => `demo-q-${i}`
const choiceId = (qi: number, ci: number) => `demo-c-${qi}-${ci}`

export function demoQuiz(): QuizResponse {
  const questions: ApiQuestion[] = DEMO_QUESTIONS.map((q, i) => ({
    id: questionId(i),
    stem: q.stem,
    // 正解と解説は含めない。実データと同じく採点の応答で初めて渡す（§4.3.2）
    choices: q.choices.map((c, ci) => ({ id: choiceId(i, ci), body: c.body })),
    coveredStepIds: q.coveredStepIds,
  }))
  return { questions, latestAttempts: state().attempts }
}

export function demoAttempt(qid: string, selectedChoiceId: string): AttemptResult {
  const index = DEMO_QUESTIONS.findIndex((_, i) => questionId(i) === qid)
  const question = DEMO_QUESTIONS[index]
  const correctIndex = question.choices.findIndex((c) => c.isCorrect)
  const selectedIndex = question.choices.findIndex((_, ci) => choiceId(index, ci) === selectedChoiceId)
  const isCorrect = selectedIndex === correctIndex
  const answeredAt = Date.now()

  const s = state()
  s.attempts = [...s.attempts.filter((a) => a.questionId !== qid), { questionId: qid, isCorrect, answeredAt }]

  return {
    questionId: qid,
    selectedChoiceId,
    correctChoiceId: choiceId(index, correctIndex),
    isCorrect,
    explanation: question.explanation,
    answeredAt,
  }
}

export function demoCompleteStep(id: string): CourseDetail {
  const s = state()
  const index = s.steps.findIndex((x) => x.id === id)
  if (index >= 0) {
    s.steps = s.steps.map((x, i) =>
      i === index
        ? { ...x, status: 'completed', completedAt: Date.now() }
        : i === index + 1
          ? { ...x, status: 'in_progress' }
          : x,
    )
    s.currentStepId = s.steps[index + 1]?.id ?? null
  }
  return demoCourse()
}

/**
 * 受講の1ターン。台本を少しずつ流し、実際の受講と同じ見え方にする。
 * 本物の生成ではないため、間隔は一定にしてある。
 */
export async function demoStreamTurn(
  question: string | null,
  onDelta: (text: string) => void,
): Promise<ApiMessage> {
  const s = state()
  const id = s.currentStepId
  if (!id) throw new Error('サンプルの講義は完了しています')

  const step = DEMO_STEPS.find((x) => stepId(x.title) === id)
  const used = s.cursor[id] ?? 0
  const content =
    question !== null
      ? 'サンプルでは質問に回答できません。実際の講義では、教材の該当箇所を根拠に回答します。'
      : (step?.script[used] ??
        'このステップの解説は以上です。「次のステップへ進む」を押してください。')

  for (let i = 0; i < content.length; i += 8) {
    onDelta(content.slice(i, i + 8))
    await new Promise((r) => setTimeout(r, 35))
  }

  const message: ApiMessage = {
    id: `demo-m-${id}-${used}-${Date.now()}`,
    stepId: id,
    role: 'assistant',
    content,
    createdAt: Date.now(),
  }
  if (question === null) s.cursor[id] = used + 1
  s.messages = [...s.messages, message]
  return message
}
