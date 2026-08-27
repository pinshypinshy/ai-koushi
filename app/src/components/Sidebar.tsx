import { MOCK_USER, useStore } from '../store'
import { IconDots, IconPlus, IconUser, IconX } from './Icons'

/** A-1〜A-4（§3.4）。モバイルではドロワーとして表示する。 */
export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { state, dispatch } = useStore()
  const courses = [...state.courses].sort((a, b) => b.updatedAt - a.updatedAt)

  const progress = (courseId: string) => {
    const c = state.courses.find((x) => x.id === courseId)
    if (!c || c.steps.length === 0) return null
    const done = c.steps.filter((s) => s.status === 'completed').length
    return `${done} / ${c.steps.length}`
  }

  return (
    <div className="flex h-full w-full flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <h1 className="text-lg font-bold tracking-wide text-white">AI講師</h1>
        {onClose && (
          <button onClick={onClose} aria-label="閉じる" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
            <IconX className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="px-3">
        <button
          onClick={() => {
            dispatch({ type: 'setTab', tab: 'upload' })
            dispatch({ type: 'setDraft', title: '', markdown: '' })
            onClose?.()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
        >
          <IconPlus className="h-4 w-4" />
          新規講義
        </button>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
        {courses.length === 0 ? (
          <p className="px-3 py-2 text-sm text-slate-500">まだ講義がありません</p>
        ) : (
          <ul className="space-y-0.5">
            {courses.map((c) => {
              const selected = c.id === state.selectedCourseId
              return (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => dispatch({ type: 'selectCourse', id: c.id })}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 pr-9 text-left text-sm transition ${
                      selected ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-indigo-400' : 'bg-transparent'}`} />
                    <span className="truncate">{c.title}</span>
                    {c.status === 'generating' && (
                      <span className="ml-auto shrink-0 text-[11px] text-indigo-300">生成中</span>
                    )}
                    {c.status === 'failed' && (
                      <span className="ml-auto shrink-0 text-[11px] text-rose-300">失敗</span>
                    )}
                    {c.status === 'ready' && (
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
                        {progress(c.id)}
                      </span>
                    )}
                  </button>
                  <button
                    aria-label={`${c.title} のメニュー`}
                    onClick={(e) => {
                      e.stopPropagation()
                      dispatch({ type: 'openMenu', menu: { type: 'course', courseId: c.id } })
                    }}
                    className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-slate-700 hover:text-white focus:opacity-100"
                  >
                    <IconDots className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <button
          onClick={() => dispatch({ type: 'openMenu', menu: { type: 'user' } })}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
        >
          <IconUser className="h-5 w-5 shrink-0" />
          <span className="truncate">{MOCK_USER.name}</span>
        </button>
      </div>
    </div>
  )
}
