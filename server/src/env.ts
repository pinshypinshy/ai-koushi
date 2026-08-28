import type { SessionUser } from './auth/session'

/** wrangler.jsonc の vars / d1_databases と .dev.vars（本番は wrangler secret）に対応する */
export interface Env {
  DB: D1Database

  // vars（秘密でない設定値）
  APP_ORIGIN: string
  /** §5.5「モデルIDは設定値として外出しする」 */
  MODEL_OUTLINE: string
  MODEL_QUIZ: string
  MODEL_LECTURE: string
  MODEL_ANSWER: string
  MODEL_SUMMARY: string

  // secrets（§8.3 SEC-1：クライアントへ送出しない）
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  /** ログインを許可するアドレスのカンマ区切り（§4.6 利用者制限） */
  ALLOWED_EMAILS: string
  GEMINI_API_KEY: string
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: SessionUser
  }
}
