import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../env'
import { readSession } from './session'

/**
 * 運営管理ページ（§4.7）の認可。
 *
 * 判定はセッション（JWT）ではなく users.is_admin を毎回参照する。セッションに
 * 載せると、権限を外しても発行済みのトークンが期限（30日）まで管理者のまま残る。
 * 画面側で管理タブを隠すのは防御にならないため、認可はここで完結させる。
 *
 * requireUser と同じく、ワイルドカードではなく各ルートに明示して当てる。
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c)
  if (!user) return c.json({ error: 'unauthorized', message: 'ログインが必要です' }, 401)

  const row = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?1')
    .bind(user.id)
    .first<{ is_admin: number }>()
  // 利用者の行が消えている場合も含め、管理者と確認できない限り通さない
  if (!row || row.is_admin !== 1) {
    return c.json({ error: 'forbidden', message: '管理者の権限がありません' }, 403)
  }

  c.set('user', user)
  await next()
})
