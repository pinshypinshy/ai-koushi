import type { AccessResult, AccountKind } from '../../../shared/api'

/**
 * ログインの記録（§4.7）。成功だけでなく拒否・失敗も残す。
 *
 * 記録の失敗でログインそのものを止めない。監査は運用のためのものであり、
 * これが書けないことを理由に利用者を締め出す理由が無いためである。
 * 呼び出し側では待つが、例外はここで握る。
 */
export async function recordAccess(
  db: D1Database,
  entry: {
    userId: string | null
    kind: AccountKind
    identifier: string
    result: AccessResult
    ip: string | null
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO access_logs (id, user_id, kind, identifier, result, ip, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        crypto.randomUUID(),
        entry.userId,
        entry.kind,
        // 識別子は小文字に正規化して残す。allowed_emails と突き合わせるため
        entry.identifier.trim().toLowerCase(),
        entry.result,
        entry.ip,
        Date.now(),
      )
      .run()
  } catch (err) {
    // §8.4：Workers Observability のログには残す
    console.error('access log failed', err)
  }
}
