import { useState } from 'react'
import { ApiFailure, LOGIN_URL, api } from '../api'
import { IconGoogle } from '../components/Icons'

/**
 * サインインを断られた理由（server/src/auth/routes.ts がクエリで返す）。
 * 出し分けるのは、利用者が取るべき行動が状況ごとに違うためである
 * （別のアカウントで試す／Google 側の設定を直す／単に再試行する）。
 */
const AUTH_ERRORS: Record<string, string> = {
  not_allowed: 'このアカウントは利用を許可されていません。別のアカウントでお試しください。',
  unverified:
    'Google アカウントのメールアドレスが確認されていません。Google 側で確認を済ませてから再度お試しください。',
  failed: 'サインインに失敗しました。もう一度お試しください。',
}

/**
 * 読み取ったら URL からクエリを取り除く。残したままだとリロードのたびに
 * エラーが出続け、何も起きていないのにエラー状態に見えるため。
 * 履歴の置き換えだけを行い、再読み込みは発生させない。
 */
function readAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('auth_error')
  if (!code) return null
  params.delete('auth_error')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  return AUTH_ERRORS[code] ?? 'サインインできませんでした。もう一度お試しください。'
}

/** SC-01 ログイン画面（§3.2）。未認証時はこの画面のみを表示する（§4.5）。 */
export function Login() {
  // 初回描画時に一度だけ読む。再描画のたびに URL を書き換えないため
  const [redirectError] = useState(readAuthError)
  const [guestOpen, setGuestOpen] = useState(false)
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)

  /** ゲストサインイン（Q-26）。成功したら読み込み直して通常の起動処理へ入る */
  async function submitGuest(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setGuestError(null)
    try {
      await api.guestLogin(loginId.trim(), password)
      window.location.href = '/'
    } catch (err) {
      setGuestError(err instanceof ApiFailure ? err.message : 'サインインできませんでした')
      setSubmitting(false)
    }
  }

  const error = guestError ?? redirectError

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-slate-100 px-6 py-10">
      {/*
        見出しだけ操作部（max-w-sm）より広い枠に置く。説明文を PC で1行に収めるには
        384px では 1 文字ぶん足らず、「作り／ます」のように語の途中で割れるため。
        狭い画面では枠が入りきらないので、読点の位置に <br> を出して折る
      */}
      <div className="w-full max-w-md text-center">
        <div className="flex items-center justify-center gap-3">
          {/* favicon と同じ実体を指す。図形の定義を1箇所に留め、差し替えたときにずれないため */}
          <img src="/favicon.svg" alt="" width={48} height={48} className="h-12 w-12" />
          <h1 className="text-3xl font-bold tracking-wide text-slate-900">AI講師</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          参考書をアップロードすると、
          <br className="sm:hidden" />
          AIが講義と確認テストを作ります
        </p>
      </div>

      <div className="w-full max-w-sm text-center">
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

        {!guestOpen && (
          <button
            onClick={() => setGuestOpen(true)}
            className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            ゲストとしてサインイン
          </button>
        )}

        {guestOpen && (
          <form onSubmit={submitGuest} className="mt-3 rounded-xl border border-slate-300 bg-white p-4 text-left">
            <p className="text-xs text-slate-500">発行された ID とパスワードを入力してください</p>
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              placeholder="ID"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="パスワード"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
            <button
              type="submit"
              disabled={submitting || !loginId.trim() || !password}
              className="mt-3 w-full rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {submitting ? 'サインインしています…' : 'サインイン'}
            </button>
          </form>
        )}

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm leading-relaxed text-rose-700"
          >
            {error}
          </p>
        )}

        <p className="mt-6 text-xs text-slate-400">
          Google アカウントは許可された方のみ利用できます
        </p>

        {/* 許可されていない人が中身を確かめられるようにする。サンプルの講義1件で動く */}
        <button
          onClick={() => {
            window.location.href = '/?demo'
          }}
          className="mt-6 text-sm font-medium text-slate-500 underline underline-offset-4 transition hover:text-slate-800"
        >
          画面を見る（サンプル）
        </button>
      </div>
    </div>
  )
}
