import { useStore } from '../store'
import type { Tab } from '../types'
import { IconChat, IconCheckSquare, IconUpload } from './Icons'

const TABS: { key: Tab; label: string; short: string; Icon: typeof IconUpload }[] = [
  { key: 'upload', label: 'アップロード', short: '教材', Icon: IconUpload },
  { key: 'lecture', label: '講義', short: '講義', Icon: IconChat },
  { key: 'quiz', label: '確認テスト', short: 'テスト', Icon: IconCheckSquare },
]

/** B-1（§3.4）。デスクトップは上部中央、モバイルは下部固定。 */
export function TabBar({ variant }: { variant: 'desktop' | 'mobile' }) {
  const { state, dispatch } = useStore()

  if (variant === 'mobile') {
    return (
      <nav className="flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ key, short, Icon }) => {
          const active = state.tab === key
          return (
            <button
              key={key}
              onClick={() => dispatch({ type: 'setTab', tab: key })}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
                active ? 'text-indigo-600' : 'text-slate-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              {short}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <div className="flex justify-center py-3">
      <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map(({ key, label, Icon }) => {
          const active = state.tab === key
          return (
            <button
              key={key}
              onClick={() => dispatch({ type: 'setTab', tab: key })}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
