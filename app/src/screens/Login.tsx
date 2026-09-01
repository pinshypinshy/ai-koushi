import { LOGIN_URL } from '../api'
import { IconGoogle } from '../components/Icons'

/** SC-01 ログイン画面（§3.2）。未認証時はこの画面のみを表示する（§4.5）。 */
export function Login() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-3xl font-bold tracking-wide text-slate-900">AI講師</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          参考書をアップロードすると、
          <br className="sm:hidden" />
          AIが講義と確認テストを作ります
        </p>
        <button
          // 認可コードフローの往路。サーバー側で Google へ転送される（§4.6）
          onClick={() => {
            window.location.href = LOGIN_URL
          }}
          className="mt-10 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          <IconGoogle />
          Googleでサインイン
        </button>
        <p className="mt-6 text-xs text-slate-400">
          許可されたアカウントのみ利用できます
        </p>
      </div>
    </div>
  )
}
