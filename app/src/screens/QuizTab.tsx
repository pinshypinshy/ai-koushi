import { useEffect, useState } from 'react'
import { ApiFailure, api } from '../api'
import { latestAttempt, useStore, wrongQuestions } from '../store'
import type { Course, Question } from '../types'
import { InlineMarkdown, Markdown } from '../components/Markdown'
import { IconCheck, IconX } from '../components/Icons'

const LABELS = ['A', 'B', 'C', 'D']

function stats(course: Course, attempts: ReturnType<typeof useStore>['state']['attempts']) {
  const answered = course.questions.filter((q) => latestAttempt(attempts, q.id))
  const correct = answered.filter((q) => latestAttempt(attempts, q.id)!.isCorrect)
  return {
    answered: answered.length,
    correct: correct.length,
    rate: answered.length ? Math.round((correct.length / answered.length) * 100) : null,
  }
}

/** SC-08 開始画面 */
function StartView({ course }: { course: Course }) {
  const { state, dispatch } = useStore()
  const s = stats(course, state.attempts)
  const wrong = wrongQuestions(course, state.attempts)
  const filtered =
    state.quiz.stepFilter.length === 0
      ? course.questions
      : course.questions.filter((q) => q.coveredStepIds.some((id) => state.quiz.stepFilter.includes(id)))

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">確認テスト</h2>
        <p className="mt-0.5 text-sm text-slate-500">{course.title}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-slate-500">出題数</p>
            <p className="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums">
              {filtered.length}
              <span className="ml-1 text-sm font-normal text-slate-500">問</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">正答率</p>
            <p className="mt-0.5 text-2xl font-bold text-slate-900 tabular-nums">
              {s.rate === null ? '—' : `${s.rate}%`}
              {s.rate !== null && (
                <span className="ml-1 text-sm font-normal text-slate-500">
                  （{s.correct} / {s.answered}）
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => dispatch({ type: 'startQuiz', reviewMode: false })}
            disabled={filtered.length === 0}
            className="ml-auto rounded-xl bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            テストを始める
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">ステップで絞り込む（任意）</p>
        <ul className="space-y-1.5">
          {course.steps.map((st) => {
            const qs = course.questions.filter((q) => q.coveredStepIds.includes(st.id))
            const answered = qs.filter((q) => latestAttempt(state.attempts, q.id))
            const correct = answered.filter((q) => latestAttempt(state.attempts, q.id)!.isCorrect)
            const checked = state.quiz.stepFilter.includes(st.id)
            return (
              <li key={st.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm transition hover:border-slate-300">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => dispatch({ type: 'toggleStepFilter', stepId: st.id })}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  <span className="truncate text-slate-700">{st.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-500 tabular-nums">
                    {qs.length}問
                    {answered.length > 0 &&
                      ` / 正答率 ${Math.round((correct.length / answered.length) * 100)}%`}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          設問はステップに1対1で対応しません。複数ステップにまたがる横断設問があるため、
          各行の合計は総問数と一致しないことがあります。
        </p>
      </div>

      <div>
        <button
          onClick={() => dispatch({ type: 'startQuiz', reviewMode: true })}
          disabled={wrong.length === 0}
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          誤答のみに取り組む（{wrong.length}問）
        </button>
      </div>
    </div>
  )
}

/** SC-09 出題中 ／ SC-10 正誤と解説 */
function QuestionView({ course, question }: { course: Course; question: Question }) {
  const { state, dispatch } = useStore()
  const { index, order, selectedChoiceId, result, grading, reviewMode } = state.quiz
  const [error, setError] = useState<string | null>(null)
  const isLast = index >= order.length - 1
  // 正誤と解説は採点の応答で初めて渡される（§4.3.2）
  const revealed = result !== null

  async function grade() {
    if (!selectedChoiceId || grading) return
    setError(null)
    dispatch({ type: 'gradingStarted' })
    try {
      dispatch({ type: 'attemptRecorded', result: await api.attempt(question.id, selectedChoiceId) })
    } catch (err) {
      dispatch({ type: 'gradingFailed' })
      setError(err instanceof ApiFailure ? err.message : '採点できませんでした')
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <div className="flex items-center gap-4">
        <p className="shrink-0 text-sm font-medium text-slate-600 tabular-nums">
          {reviewMode && <span className="mr-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">復習モード</span>}
          第{index + 1}問 / {order.length}問
        </p>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${((index + (revealed ? 1 : 0)) / order.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="text-[15px] leading-relaxed font-medium text-slate-900">
          <Markdown>{question.stem}</Markdown>
        </div>
      </div>

      <ul className="space-y-2">
        {question.choices.map((c, i) => {
          const selected = c.id === selectedChoiceId
          const showCorrect = revealed && c.id === result.correctChoiceId
          const showWrong = revealed && selected && c.id !== result.correctChoiceId
          return (
            <li key={c.id}>
              <button
                onClick={() => dispatch({ type: 'selectChoice', choiceId: c.id })}
                disabled={revealed}
                className={`flex min-h-[56px] w-full items-start gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm transition ${
                  showCorrect
                    ? 'border-emerald-500 bg-emerald-50'
                    : showWrong
                      ? 'border-rose-400 bg-rose-50'
                      : selected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                } ${revealed ? 'cursor-default' : ''}`}
              >
                <span
                  className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                    showCorrect
                      ? 'bg-emerald-600 text-white'
                      : showWrong
                        ? 'bg-rose-500 text-white'
                        : selected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {showCorrect ? <IconCheck className="h-3.5 w-3.5" /> : showWrong ? <IconX className="h-3.5 w-3.5" /> : LABELS[i]}
                </span>
                <span className="min-w-0 flex-1 leading-relaxed text-slate-800">
                  <InlineMarkdown>{c.body}</InlineMarkdown>
                </span>
                {revealed && (showCorrect || showWrong) && (
                  <span
                    className={`shrink-0 self-center text-[11px] font-medium ${
                      showCorrect ? 'text-emerald-700' : 'text-rose-600'
                    }`}
                  >
                    {showCorrect ? '正解' : 'あなたの回答'}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {revealed && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="mb-2 text-xs font-bold text-slate-500">解説</p>
          <div className="text-sm leading-relaxed text-slate-700">
            <Markdown>{result.explanation}</Markdown>
          </div>
          <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
            関連ステップ：
            {question.coveredStepIds
              .map((id) => course.steps.find((s) => s.id === id)?.title ?? '—')
              .join('、')}
            {question.coveredStepIds.length > 1 && '（横断設問）'}
          </p>
        </div>
      )}

      {error && <p className="text-right text-sm text-rose-600">{error}</p>}

      <div className="flex justify-end">
        {revealed ? (
          <button
            onClick={() => dispatch({ type: 'nextQuestion' })}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {isLast ? '結果を見る' : '次の問題へ'}
          </button>
        ) : (
          <button
            onClick={() => void grade()}
            disabled={!selectedChoiceId || grading}
            className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {grading ? '採点しています…' : '回答する'}
          </button>
        )}
      </div>
    </div>
  )
}

/** SC-11 結果集計 ／ SC-12 復習モード対象なし */
function ResultView({ course }: { course: Course }) {
  const { state, dispatch } = useStore()
  const { order, reviewMode } = state.quiz

  if (order.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <IconCheck className="h-8 w-8 text-emerald-500" />
        <p className="mt-4 text-base font-semibold text-slate-800">誤答した問題はありません</p>
        <p className="mt-2 text-sm text-slate-500">すべての設問に正解しています。</p>
        <button
          onClick={() => dispatch({ type: 'backToQuizStart' })}
          className="mt-8 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          通常のテストに戻る
        </button>
      </div>
    )
  }

  const asked = order.map((id) => course.questions.find((q) => q.id === id)!)
  const results = asked.map((q) => ({ q, a: latestAttempt(state.attempts, q.id) }))
  const correct = results.filter((r) => r.a?.isCorrect).length
  const wrongList = results.filter((r) => r.a && !r.a.isCorrect)
  const remaining = wrongQuestions(course, state.attempts)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <div className="text-center">
        <p className="text-sm font-medium text-slate-500">
          {reviewMode ? '復習モード終了' : 'テスト終了'}
        </p>
        <p className="mt-3 text-4xl font-bold text-slate-900 tabular-nums">
          {correct}
          <span className="text-2xl font-normal text-slate-400"> / {order.length}</span>
        </p>
        <p className="mt-1 text-sm text-slate-500 tabular-nums">
          正答率 {Math.round((correct / order.length) * 100)}%
        </p>
      </div>

      {wrongList.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">誤答した問題</p>
          <ul className="space-y-1.5">
            {wrongList.map(({ q }) => (
              <li
                key={q.id}
                className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm"
              >
                <IconX className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <span className="min-w-0 flex-1 text-slate-700">
                  <InlineMarkdown>{q.stem}</InlineMarkdown>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => dispatch({ type: 'startQuiz', reviewMode: true })}
          disabled={remaining.length === 0}
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
        >
          誤答のみ再挑戦（{remaining.length}問）
        </button>
        <button
          onClick={() => dispatch({ type: 'backToQuizStart' })}
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          テスト一覧へ戻る
        </button>
        <button
          onClick={() => dispatch({ type: 'setTab', tab: 'lecture' })}
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          講義タブへ戻る
        </button>
      </div>
    </div>
  )
}

export function QuizTab({ course }: { course: Course }) {
  const { state, dispatch } = useStore()
  const { phase, order, index } = state.quiz
  const loaded = course.quizLoaded === true

  /**
   * 設問と、設問ごとの最新の解答を取得する（§4.3）。
   * 解答記録をサーバーから受け取るのは、再訪時にも復習モードの対象を復元するため。
   */
  useEffect(() => {
    if (loaded) return
    let alive = true
    api
      .quiz(course.id)
      .then((res) => {
        if (!alive) return
        dispatch({
          type: 'quizLoaded',
          courseId: course.id,
          questions: res.questions,
          attempts: res.latestAttempts,
        })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [course.id, loaded, dispatch])

  // §4.1.6：テストだけ失敗した講義は、講義本体は利用できる
  if (course.quizStatus === 'failed') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-base font-semibold text-slate-800">確認テストの生成に失敗しました</p>
        <p className="mt-2 text-sm text-slate-500">講義はそのまま受講できます。</p>
      </div>
    )
  }
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-sm text-slate-400">確認テストを読み込んでいます…</p>
      </div>
    )
  }

  if (phase === 'start') return <StartView course={course} />
  if (phase === 'result') return <ResultView course={course} />

  const question = course.questions.find((q) => q.id === order[index])
  if (!question) return <StartView course={course} />
  return <QuestionView course={course} question={question} />
}
