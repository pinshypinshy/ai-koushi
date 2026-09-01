/**
 * 管理者権限の取り消し（§4.7）。
 *
 *   npm run admin:remove -- <メールアドレス> [--force] [--remote]
 *
 * 判定は毎回 users.is_admin を見るため、取り消しは即座に効く（発行済みの
 * セッションが管理者のまま残ることはない → server/src/auth/admin.ts）。
 * 最後の1人は既定で外さない。外すと運営管理ページへ入る手段がコマンドしか
 * 残らないため、意図した操作であることを --force で示させる。
 */
import { lit, parseArgs, parseEmail, runSql } from './admin-lib.mjs'

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const { remote, rest, target } = parseArgs(argv)
const [rawEmail] = rest

if (!rawEmail) {
  console.error('使い方: npm run admin:remove -- <メールアドレス> [--force] [--remote]')
  process.exit(1)
}
const email = parseEmail(rawEmail)

const res = runSql(
  `SELECT (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
          (SELECT COUNT(*) FROM users WHERE is_admin = 1 AND email = ${lit(email)}) AS target;`,
  { remote, json: true },
)
const row = res?.[0]?.results?.[0]

if (!row || row.target === 0) {
  console.error(`${email} は管理者ではない（対象：${target}）`)
  process.exit(1)
}
if (row.admins <= 1 && !force) {
  console.error(`${email} は最後の管理者である（対象：${target}）`)
  console.error('外すと運営管理ページに誰も入れなくなる。承知の上なら --force を付ける。')
  process.exit(1)
}

runSql(`UPDATE users SET is_admin = 0 WHERE email = ${lit(email)};`, { remote })

console.log('')
console.log(`${email} の管理者権限を取り消した（対象：${target}）`)
console.log('判定は毎回 DB を見るため、この時点で管理ページへは入れなくなる。')
