/**
 * §4.6「MVPでは許可リスト方式でログイン可能なアカウントを制限する」。
 * APIコストが利用者数に比例するため、認証できることと利用を許すことを分ける。
 *
 * 保持先は D1（allowed_emails）。環境変数から移した経緯は
 * migrations/0006_allowed_emails.sql に書いてある。
 */
export async function isAllowed(db: D1Database, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  const row = await db
    .prepare('SELECT email FROM allowed_emails WHERE email = ?1')
    .bind(normalized)
    .first<{ email: string }>()
  // 表が空の場合は全員を拒否する。設定漏れが「全員許可」になると
  // 許可リストを置いた意味が失われるため、閉じる側に倒す
  return row !== null
}
