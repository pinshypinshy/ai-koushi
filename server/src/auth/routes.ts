import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { googleAuth } from '@hono/oauth-providers/google'
import type { AppEnv } from '../env'
import { clearSession, issueSession } from './session'
import { isAllowed } from './allowlist'
import { verifyPassword } from './password'
import {
  findGuestAccount,
  findOrCreateUser,
  recordGuestFailure,
  recordGuestSuccess,
} from '../db/users'

export const auth = new Hono<AppEnv>()

/**
 * §4.6 Googleサインイン（OAuth 2.0 / OpenID Connect）。
 *
 * googleAuth は同一ハンドラで往路と復路の両方を担う。`code` が無ければ Google へ
 * リダイレクトし、有れば認可コードを交換する。CSRF 対策の `state` は乱数を Cookie に
 * 保存して復路で突き合わせる実装がライブラリ側にあるため、こちらでは扱わない。
 *
 * 環境変数はリクエストコンテキストからしか読めないため、ミドルウェアは都度組み立てる。
 */
const google = createMiddleware<AppEnv>(async (c, next) => {
  // 未設定のまま進むとライブラリ内部で「Required parameters were not found」という
  // 原因の分かりにくい例外になるため、手前で落として何が欠けているかを示す
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json(
      {
        error: 'not_configured',
        message: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です（server/.dev.vars）',
      },
      503,
    )
  }
  const middleware = googleAuth({
    client_id: c.env.GOOGLE_CLIENT_ID,
    client_secret: c.env.GOOGLE_CLIENT_SECRET,
    // §4.6 の目的は利用者の特定に限られるため、要求するのは識別情報だけに留める
    scope: ['openid', 'email', 'profile'],
    // Google Cloud Console に登録した値と完全一致させる必要がある
    redirect_uri: `${c.env.APP_ORIGIN}/auth/callback`,
  })
  return middleware(c, next)
})

auth.use('/google', google)
auth.use('/callback', google)

/** ミドルウェアが Google へ 302 するため、通常ここには到達しない */
auth.get('/google', (c) => c.redirect(c.env.APP_ORIGIN))

auth.get('/callback', async (c) => {
  const profile = c.get('user-google')

  // 失敗はログイン画面へ戻して理由をクエリで伝える。理由を出し分けるのは、
  // 「許可されていない」と「Googleの認証に失敗した」で利用者の取るべき行動が異なるため
  if (!profile?.email) return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=failed`)
  if (profile.verified_email === false) {
    return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=unverified`)
  }
  if (!isAllowed(c.env.ALLOWED_EMAILS, profile.email)) {
    return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=not_allowed`)
  }

  const user = await findOrCreateUser(c.env.DB, profile.email, profile.name ?? profile.email)
  await issueSession(c, user)
  return c.redirect(c.env.APP_ORIGIN)
})

/**
 * ゲストサインイン（Q-26）。Google アカウントを持たない相手に、運営が発行した
 * ID とパスワードで利用してもらう。発行は `npm run guest:add` で行う。
 */
const GUEST_MAX_ATTEMPTS = 10
const GUEST_LOCK_MS = 15 * 60 * 1000

/**
 * 存在しない ID でも同じだけ時間を使うためのダミー。
 * 応答の速さで「その ID は存在しない」と分かる状態を避ける。
 */
const DUMMY_RECORD = {
  hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iterations: 100_000,
}

auth.post('/guest', async (c) => {
  const body = await c.req.json<{ loginId?: string; password?: string }>().catch(() => null)
  const loginId = body?.loginId?.trim()
  const password = body?.password
  if (!loginId || !password) {
    return c.json({ error: 'invalid_request', message: 'IDとパスワードを入力してください' }, 400)
  }

  const account = await findGuestAccount(c.env.DB, loginId)
  if (!account) {
    await verifyPassword(password, DUMMY_RECORD)
    return c.json({ error: 'unauthorized', message: 'IDまたはパスワードが違います' }, 401)
  }

  if (account.lockedUntil && account.lockedUntil > Date.now()) {
    const minutes = Math.ceil((account.lockedUntil - Date.now()) / 60000)
    return c.json(
      {
        error: 'locked',
        message: `試行回数が上限に達しました。${minutes}分ほど時間をおいて再度お試しください。`,
      },
      429,
    )
  }

  const ok = await verifyPassword(password, {
    hash: account.passwordHash,
    salt: account.salt,
    iterations: account.iterations,
  })
  if (!ok) {
    await recordGuestFailure(c.env.DB, loginId, GUEST_MAX_ATTEMPTS, GUEST_LOCK_MS)
    // 「ID が無い」と「パスワードが違う」を区別しない。存在の確認に使わせないため
    return c.json({ error: 'unauthorized', message: 'IDまたはパスワードが違います' }, 401)
  }

  await recordGuestSuccess(c.env.DB, loginId)
  await issueSession(c, {
    id: account.userId,
    email: account.email,
    displayName: account.displayName,
    kind: 'guest',
  })
  return c.body(null, 204)
})

/**
 * ログアウト。Google 側のトークンは失効させない。
 * セッションは自前の Cookie で表現しており、Google のトークンは
 * ログイン時の本人確認以降まったく使わないため、破棄すべき状態が手元にしかない。
 */
auth.post('/logout', (c) => {
  clearSession(c)
  return c.body(null, 204)
})
