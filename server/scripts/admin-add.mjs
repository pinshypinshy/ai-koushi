/**
 * 管理者権限の付与（§4.7）。
 *
 *   npm run admin:add -- <メールアドレス> [--remote]
 *
 * 対象は既に一度サインインした利用者に限られる。is_admin は users の列であり、
 * 行が無ければ立てる先が無いためである（許可リストとは別物で、許可リストに
 * 載せただけの相手にはまだ行が存在しない）。
 */
import { lit, parseArgs, parseEmail, runSql } from './admin-lib.mjs'

const { remote, rest, target } = parseArgs(process.argv.slice(2))
const [rawEmail] = rest

if (!rawEmail) {
  console.error('使い方: npm run admin:add -- <メールアドレス> [--remote]')
  process.exit(1)
}
const email = parseEmail(rawEmail)

const found = runSql(
  `SELECT id, display_name, kind, is_admin FROM users WHERE email = ${lit(email)};`,
  { remote, json: true },
)
const user = found?.[0]?.results?.[0]

if (!user) {
  console.error(`${email} の利用者が見つからない（対象：${target}）`)
  console.error('一度サインインさせてから実行する。サインインの時点で利用者の行が作られる。')
  process.exit(1)
}
if (user.is_admin === 1) {
  console.error(`${email} は既に管理者である（対象：${target}）`)
  process.exit(1)
}

runSql(`UPDATE users SET is_admin = 1 WHERE email = ${lit(email)};`, { remote })

console.log('')
console.log(`${email}（${user.display_name}）に管理者権限を付与した（対象：${target}）`)
console.log('/admin から運営管理ページを開ける。')
