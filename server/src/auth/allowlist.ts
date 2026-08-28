/**
 * §4.6「MVPでは許可リスト方式でログイン可能なアカウントを制限する」。
 * APIコストが利用者数に比例するため、認証できることと利用を許すことを分ける。
 */
export function isAllowed(allowedEmails: string, email: string): boolean {
  const allowed = allowedEmails
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0)
  // 設定が空の場合は全員を拒否する。設定漏れが「全員許可」になると
  // 許可リストを置いた意味が失われるため、閉じる側に倒す
  if (allowed.length === 0) return false
  return allowed.includes(email.trim().toLowerCase())
}
