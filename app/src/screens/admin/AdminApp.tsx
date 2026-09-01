import { useState } from 'react'
import { ApiFailure, adminApi } from '../../api'
import { Loading } from './ui'
import { useAdminData } from './data'
import { Overview } from './Overview'
import { UsersTab } from './Users'
import { AccessTab, UsageTab } from './Logs'
import { AccountsTab } from './Accounts'
import { ConfigTab } from './Config'

/**
 * 運営管理ページ（§4.7）。`/admin` で開く。
 *
 * 段階1は読み取りのみで、発行・許可・設定の変更はコマンドのまま残す。
 * 認可はサーバーの requireAdmin が担う。この画面を隠すことは防御にならないため、
 * ここでの分岐は「権限が無いと分かる形で伝える」ためのものに留める。
 */

const TABS = [
  { id: 'overview', label: '概要' },
  { id: 'users', label: '利用者' },
  { id: 'usage', label: 'AI呼び出し' },
  { id: 'access', label: 'アクセス' },
  { id: 'accounts', label: '認証' },
  { id: 'config', label: '設定' },
] as const

type TabId = (typeof TABS)[number]['id']

/** タブは URL のハッシュに残す。再読み込みで概要へ戻らないようにするため */
function initialTab(): TabId {
  const hash = window.location.hash.replace('#', '')
  return TABS.find((t) => t.id === hash)?.id ?? 'overview'
}

function Gate({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-base font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{message}</p>
        <a
          href="/"
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          アプリへ戻る
        </a>
      </div>
    </div>
  )
}

export default function AdminApp() {
  const [tab, setTab] = useState<TabId>(initialTab)
  // 概要は入口の可否の確認も兼ねる。403 ならこの時点で分かり、各タブが個別に弾かれない
  const { data: summary, error, loading } = useAdminData(() => adminApi.summary(), 'summary')

  if (loading) {
    return (
      <div className="h-full bg-slate-100">
        <Loading />
      </div>
    )
  }

  if (error) {
    if (error instanceof ApiFailure && error.status === 401) {
      return <Gate title="ログインが必要です" message="サインインしてから開き直してください。" />
    }
    if (error instanceof ApiFailure && error.status === 403) {
      // 権限の付け方は書かない。この画面が出ている相手は運営ではなく、
      // 手順を示す相手が居ない（付与の方法は README と CLAUDE.md にある）
      return <Gate title="管理者の権限がありません" message="このページは運営用です。" />
    }
    return <Gate title="表示できません" message={error.message} />
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-sm font-bold text-slate-900">AI講師 ／ 運営管理</h1>
        <nav className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id)
                window.location.hash = t.id
              }}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === t.id
                  ? 'bg-slate-900 font-medium text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <a href="/" className="ml-auto text-xs text-slate-500 transition hover:text-slate-800">
          アプリへ戻る
        </a>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'overview' && summary && <Overview summary={summary} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'access' && <AccessTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'config' && <ConfigTab />}
      </main>
    </div>
  )
}
