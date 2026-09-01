/**
 * ゲストアカウントの発行（Q-26）。
 *
 *   npm run guest:add -- <ログインID> "<表示名>" [--remote]
 *
 * パスワードはここで自動生成し、この実行時にのみ表示する。保存するのは
 * PBKDF2-SHA256 の導出鍵だけで、平文はどこにも残さない。
 * 導出の手順は server/src/auth/password.ts と一致させること（片方だけ変えると照合が壊れる）。
 */
import { randomUUID, webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ITERATIONS = 210_000
const KEY_BITS = 256
/** 紛らわしい文字（0/O、1/l/I）を外す。口頭やメモで伝える場面を想定している */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PASSWORD_LENGTH = 16

function generatePassword() {
  const bytes = new Uint8Array(PASSWORD_LENGTH * 2)
  webcrypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) {
    // 偏りを避けるため、割り切れない範囲に落ちた値は捨てる
    if (b >= 256 - (256 % ALPHABET.length)) continue
    out += ALPHABET[b % ALPHABET.length]
    if (out.length === PASSWORD_LENGTH) break
  }
  return out.length === PASSWORD_LENGTH ? out : generatePassword()
}

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16))
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    KEY_BITS,
  )
  const b64 = (u8) => Buffer.from(u8).toString('base64')
  return { hash: b64(new Uint8Array(bits)), salt: b64(salt), iterations: ITERATIONS }
}

/** SQL の文字列リテラルに埋める。単一引用符は2つ重ねて閉じないようにする */
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`

const args = process.argv.slice(2)
const remote = args.includes('--remote')
const [loginId, displayName] = args.filter((a) => !a.startsWith('--'))

if (!loginId || !displayName) {
  console.error('使い方: npm run guest:add -- <ログインID> "<表示名>" [--remote]')
  process.exit(1)
}
if (!/^[a-z0-9_-]{3,32}$/.test(loginId)) {
  console.error('ログインIDは英小文字・数字・ハイフン・アンダースコアの3〜32文字で指定する')
  process.exit(1)
}

const password = generatePassword()
const { hash, salt, iterations } = await hashPassword(password)
const userId = randomUUID()
const now = Date.now()
// 実在しないドメインを使う。ゲストはメールアドレスを持たないが、users.email は
// 一意制約付きで必須のため、衝突しない値を機械的に作る
const email = `${loginId}@guest.local`

const sql = `
INSERT INTO users (id, email, display_name, kind, created_at)
VALUES (${lit(userId)}, ${lit(email)}, ${lit(displayName)}, 'guest', ${now});
INSERT INTO guest_accounts (login_id, user_id, password_hash, salt, iterations, created_at)
VALUES (${lit(loginId)}, ${lit(userId)}, ${lit(hash)}, ${lit(salt)}, ${iterations}, ${now});
`.trim()

const file = join(tmpdir(), `guest-${loginId}-${now}.sql`)
writeFileSync(file, sql)
try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'ai-koushi', remote ? '--remote' : '--local', '--file', file],
    { stdio: 'inherit' },
  )
} finally {
  unlinkSync(file)
}

console.log('')
console.log('----------------------------------------')
console.log(`  ログインID : ${loginId}`)
console.log(`  パスワード : ${password}`)
console.log(`  表示名     : ${displayName}`)
console.log(`  対象       : ${remote ? 'リモート（本番）' : 'ローカル'}`)
console.log('----------------------------------------')
console.log('パスワードはここにしか表示されない。控えてから閉じること。')
