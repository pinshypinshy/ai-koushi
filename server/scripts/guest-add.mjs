/**
 * ゲストアカウントの発行（Q-26）。
 *
 *   npm run guest:add -- <ログインID> "<表示名>" [--remote]
 *
 * パスワードは自動生成し、この実行時にのみ表示する。保存するのは
 * PBKDF2-SHA256 の導出鍵だけで、平文はどこにも残さない。
 */
import { randomUUID } from 'node:crypto'
import { generatePassword, hashPassword, lit, parseLoginId, printCredentials, runSql } from './guest-lib.mjs'

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const [rawLoginId, displayName] = args.filter((a) => !a.startsWith('--'))

if (!rawLoginId || !displayName) {
  console.error('使い方: npm run guest:add -- <ログインID> "<表示名>" [--remote]')
  process.exit(1)
}
const loginId = parseLoginId(rawLoginId)

const password = generatePassword()
const { hash, salt, iterations } = await hashPassword(password)
const userId = randomUUID()
const now = Date.now()
// 実在しないドメインを使う。ゲストはメールアドレスを持たないが、users.email は
// 一意制約付きで必須のため、衝突しない値を機械的に作る
const email = `${loginId}@guest.local`

runSql(
  `
INSERT INTO users (id, email, display_name, kind, created_at)
VALUES (${lit(userId)}, ${lit(email)}, ${lit(displayName)}, 'guest', ${now});
INSERT INTO guest_accounts (login_id, user_id, password_hash, salt, iterations, created_at)
VALUES (${lit(loginId)}, ${lit(userId)}, ${lit(hash)}, ${lit(salt)}, ${iterations}, ${now});
`.trim(),
  { remote },
)

printCredentials({ loginId, password, displayName, remote })
