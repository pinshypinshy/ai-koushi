import { useStore } from '../store'
import type { Course } from '../types'
import { IconCheck, IconChevron } from './Icons'

function StepList({ course }: { course: Course }) {
  return (
    <ul className="space-y-1.5">
      {course.steps.map((s) => {
        const done = s.status === 'completed'
        const current = s.status === 'in_progress'
        return (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              {done ? (
                <IconCheck className="h-4 w-4 text-emerald-600" />
              ) : current ? (
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              )}
            </span>
            <span
              className={
                done
                  ? 'text-slate-600'
                  : current
                    ? 'font-semibold text-slate-900'
                    : 'text-slate-400'
              }
            >
              {s.title}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function summary(course: Course) {
  const done = course.steps.filter((s) => s.status === 'completed').length
  return { done, total: course.steps.length }
}

/** C-1（§3.4）。講義タブでのみ表示する。 */
export function ProgressPanel({ course }: { course: Course }) {
  const { done, total } = summary(course)
  return (
    <aside className="w-56 shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-bold tracking-wide text-slate-500">進捗状況</h2>
      <StepList course={course} />
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-1.5 flex items-baseline justify-between text-xs text-slate-500">
          <span>
            <span className="text-sm font-bold text-slate-800 tabular-nums">{done}</span> / {total}{' '}
            ステップ完了
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>
    </aside>
  )
}

/** モバイル版：ヘッダー下の1行に折りたたみ、タップで展開する（§3.3） */
export function ProgressCollapsible({ course }: { course: Course }) {
  const { state, dispatch } = useStore()
  const { done, total } = summary(course)
  return (
    <div className="border-b border-slate-200 bg-white">
      <button
        onClick={() => dispatch({ type: 'toggleProgress' })}
        aria-expanded={state.progressOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="truncate text-sm font-semibold text-slate-800">{course.title}</span>
        <span className="ml-auto shrink-0 text-xs text-slate-500 tabular-nums">
          {done} / {total} 完了
        </span>
        <IconChevron
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${state.progressOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {state.progressOpen && (
        <div className="border-t border-slate-100 px-4 py-3">
          <StepList course={course} />
        </div>
      )}
    </div>
  )
}
