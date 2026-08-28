import type { SessionUser } from '../auth/session'

interface UserRow {
  id: string
  email: string
  display_name: string
}

/**
 * Google で確認できたアドレスに対応するユーザー行を返す。無ければ作る。
 * 表示名は Google 側で変更されうるため、ログインのたびに追従させる。
 */
export async function findOrCreateUser(
  db: D1Database,
  email: string,
  displayName: string,
): Promise<SessionUser> {
  const existing = await db
    .prepare('SELECT id, email, display_name FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow>()

  if (existing) {
    if (existing.display_name !== displayName) {
      await db
        .prepare('UPDATE users SET display_name = ?1 WHERE id = ?2')
        .bind(displayName, existing.id)
        .run()
    }
    return { id: existing.id, email: existing.email, displayName }
  }

  const id = crypto.randomUUID()
  await db
    .prepare('INSERT INTO users (id, email, display_name, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(id, email, displayName, Date.now())
    .run()
  return { id, email, displayName }
}
