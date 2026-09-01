/**
 * 許可リストへの追加（§4.6）。
 *
 *   npm run allow:add -- <メールアドレス> ["<メモ>"] [--remote]
 *
 * ここに載っているアドレスだけが Google サインインを通過できる。
 * 認証できることと利用を許すことを分けているのは、APIコストが利用者数に
 * 比例するため（§8.2）。
 */
import { lit, parseArgs, parseEmail, runSql } from './allow-lib.mjs'

const { remote, rest, target } = parseArgs(process.argv.slice(2))
const [rawEmail, note] = rest

if (!rawEmail) {
  console.error('使い方: npm run allow:add -- <メールアドレス> ["<メモ>"] [--remote]')
  process.exit(1)
}
const email = parseEmail(rawEmail)

const found = runSql(`SELECT email FROM allowed_emails WHERE email = ${lit(email)};`, {
  remote,
  json: true,
})
if ((found?.[0]?.results?.length ?? 0) > 0) {
  console.error(`${email} は既に登録されている（対象：${target}）`)
  process.exit(1)
}

runSql(
  `INSERT INTO allowed_emails (email, note, created_at)
   VALUES (${lit(email)}, ${note ? lit(note) : 'NULL'}, ${Date.now()});`,
  { remote },
)

console.log('')
console.log(`${email} を許可リストに追加した（対象：${target}）`)
console.log('この人が Google でサインインすると、利用者の行が自動で作られる。')
