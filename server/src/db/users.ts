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
    return { id: existing.id, email: existing.email, displayName, kind: 'google' }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, kind, created_at)
       VALUES (?1, ?2, ?3, 'google', ?4)`,
    )
    .bind(id, email, displayName, Date.now())
    .run()
  return { id, email, displayName, kind: 'google' }
}

/** ゲストのログイン情報（Q-26）。発行はコマンドで行い、サーバーは照合だけを担う */
export interface GuestAccountRow {
  loginId: string
  userId: string
  email: string
  displayName: string
  passwordHash: string
  salt: string
  iterations: number
  failedCount: number
  lockedUntil: number | null
}

export async function findGuestAccount(
  db: D1Database,
  loginId: string,
): Promise<GuestAccountRow | null> {
  const row = await db
    .prepare(
      `SELECT g.login_id, g.user_id, g.password_hash, g.salt, g.iterations,
              g.failed_count, g.locked_until, u.email, u.display_name
       FROM guest_accounts g JOIN users u ON u.id = g.user_id
       WHERE g.login_id = ?1`,
    )
    .bind(loginId)
    .first<{
      login_id: string
      user_id: string
      password_hash: string
      salt: string
      iterations: number
      failed_count: number
      locked_until: number | null
      email: string
      display_name: string
    }>()
  if (!row) return null
  return {
    loginId: row.login_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    salt: row.salt,
    iterations: row.iterations,
    failedCount: row.failed_count,
    lockedUntil: row.locked_until,
  }
}

/** 失敗の記録。規定回数に達したら一時的に締める（総当たりへの備え） */
export async function recordGuestFailure(
  db: D1Database,
  loginId: string,
  maxAttempts: number,
  lockMs: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE guest_accounts
       SET failed_count = failed_count + 1,
           locked_until = CASE WHEN failed_count + 1 >= ?2 THEN ?3 ELSE locked_until END
       WHERE login_id = ?1`,
    )
    .bind(loginId, maxAttempts, Date.now() + lockMs)
    .run()
}

export async function recordGuestSuccess(db: D1Database, loginId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE guest_accounts
       SET failed_count = 0, locked_until = NULL, last_login_at = ?2
       WHERE login_id = ?1`,
    )
    .bind(loginId, Date.now())
    .run()
}
