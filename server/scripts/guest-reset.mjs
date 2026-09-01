/**
 * ゲストのパスワード再発行（Q-26）。
 *
 *   npm run guest:reset -- <ログインID> [--remote]
 *
 * 利用者の行は触らないため、講義・対話・解答記録はそのまま残る。
 * パスワードを忘れた場合にアカウントを作り直すと、連鎖削除でそれらが失われる。
 * 併せて失敗回数とロックも解除する。忘れて何度も試した結果、締められている場合が多い。
 */
import { generatePassword, hashPassword, lit, parseLoginId, printCredentials, runSql } from './guest-lib.mjs'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const [rawLoginId] = args.filter((a) => !a.startsWith('--'))

if (!rawLoginId) {
  console.error('使い方: npm run guest:reset -- <ログインID> [--remote]')
  process.exit(1)
}
const loginId = parseLoginId(rawLoginId)

// 存在を先に確かめる。更新件数は環境によって返らないため（ローカルの D1 は
// meta に changes を含めない）、更新の後から成否を判定できない
const found = runSql(
  `SELECT login_id FROM guest_accounts WHERE login_id = ${lit(loginId)};`,
  { remote, json: true },
)
if ((found?.[0]?.results?.length ?? 0) === 0) {
  console.error(`ログインID「${loginId}」のゲストが見つからない（対象：${remote ? 'リモート' : 'ローカル'}）`)
  process.exit(1)
}

const password = generatePassword()
const { hash, salt, iterations } = await hashPassword(password)

runSql(
  `
UPDATE guest_accounts
SET password_hash = ${lit(hash)}, salt = ${lit(salt)}, iterations = ${iterations},
    failed_count = 0, locked_until = NULL
WHERE login_id = ${lit(loginId)};
`.trim(),
  { remote },
)

printCredentials({
  loginId,
  password,
  remote,
  note: '講義・対話・解答記録はそのまま残っている。',
})
