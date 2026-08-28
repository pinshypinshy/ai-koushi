import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { AppEnv } from '../env'

/**
 * セッションは Google のトークンをそのまま持たず、自前の署名付き Cookie で表現する。
 * Google のアクセストークンはログイン時の本人確認にしか使わず、以降の認可には
 * 使わないため（§4.6 の目的は「利用者の特定」に限られる）。
 */
export interface SessionUser {
  id: string
  email: string
  displayName: string
}

const COOKIE_NAME = 'ak_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 30

/** hono/jwt の JWTPayload に合わせるため、インデックスシグネチャを持たせる */
interface SessionPayload {
  sub: string
  email: string
  name: string
  exp: number
  [key: string]: unknown
}

/**
 * 署名アルゴリズムは明示する。この Hono では verify が第3引数を必須としており、
 * 省略できない。共有鍵方式のため HS256 を用いる。
 */
const ALG = 'HS256' as const

/** http://localhost では Secure 属性付き Cookie が保存されないため、配信元で切り替える */
function isSecure(c: Context<AppEnv>): boolean {
  return c.env.APP_ORIGIN.startsWith('https://')
}

export async function issueSession(c: Context<AppEnv>, user: SessionUser): Promise<void> {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.displayName,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  }
  const token = await sign(payload, c.env.SESSION_SECRET, ALG)
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE_SEC,
  })
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: isSecure(c) })
}

export async function readSession(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE_NAME)
  if (!token) return null
  try {
    const payload = (await verify(token, c.env.SESSION_SECRET, ALG)) as unknown as SessionPayload
    return { id: payload.sub, email: payload.email, displayName: payload.name }
  } catch {
    // 署名不正・期限切れはいずれも「未ログイン」として扱う
    return null
  }
}

/** §4.6「未ログイン時は他機能を利用不可」。全ての /api ルートに適用する */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c)
  if (!user) return c.json({ error: 'unauthorized', message: 'ログインが必要です' }, 401)
  c.set('user', user)
  await next()
})
