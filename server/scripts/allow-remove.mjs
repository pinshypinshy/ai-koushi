/**
 * 許可リストからの削除（§4.6）。
 *
 *   npm run allow:remove -- <メールアドレス> [--remote]
 *
 * 利用者の行や講義は消さない。判定は次回のサインイン時に効くため、
 * 既に発行済みのセッション Cookie（30日）はそのまま有効である点に注意する。
 * 即座に締め出したい場合は SESSION_SECRET を入れ替える（全員が再ログインになる）。
 */
import { lit, parseArgs, parseEmail, runSql } from './allow-lib.mjs'

const { remote, rest, target } = parseArgs(process.argv.slice(2))
const [rawEmail] = rest

if (!rawEmail) {
  console.error('使い方: npm run allow:remove -- <メールアドレス> [--remote]')
  process.exit(1)
}
const email = parseEmail(rawEmail)

const found = runSql(`SELECT email FROM allowed_emails WHERE email = ${lit(email)};`, {
  remote,
  json: true,
})
if ((found?.[0]?.results?.length ?? 0) === 0) {
  console.error(`${email} は許可リストに無い（対象：${target}）`)
  process.exit(1)
}

runSql(`DELETE FROM allowed_emails WHERE email = ${lit(email)};`, { remote })

console.log('')
console.log(`${email} を許可リストから削除した（対象：${target}）`)
console.log('講義などのデータは残る。発行済みのセッションは有効期限まで有効。')
