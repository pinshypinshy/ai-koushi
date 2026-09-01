/**
 * ゲストアカウントの発行・再発行で共通に使う処理（Q-26）。
 *
 * 鍵導出の手順は server/src/auth/password.ts と一致させること。
 * 動く場所が違う（Workers と Node）ため実装は分かれているが、反復回数や方式を
 * 片方だけ変えると既存のゲストが誰もログインできなくなる。
 */
import { webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Workers の上限に合わせる。src/auth/password.ts と必ず同じ値にする */
export const ITERATIONS = 100_000
const KEY_BITS = 256
/** 紛らわしい文字（0/O、1/l/I）を外す。口頭やメモで伝える場面を想定している */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PASSWORD_LENGTH = 16

export function generatePassword() {
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

export async function hashPassword(password) {
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
export const lit = (value) => `'${String(value).replace(/'/g, "''")}'`

export function parseLoginId(loginId) {
  if (!/^[a-z0-9_-]{3,32}$/.test(loginId ?? '')) {
    console.error('ログインIDは英小文字・数字・ハイフン・アンダースコアの3〜32文字で指定する')
    process.exit(1)
  }
  return loginId
}

/**
 * SQL を流す。結果を読みたい場合は json:true を渡す。
 *
 * 読み取りだけ --command を使うのは、--remote と --file を組み合わせると
 * 「ファイルの取り込み（import）」という別経路に入り、SELECT の行が返らないため。
 * ローカルでは行が返るので、この違いは本番でだけ表面化する。実際、guest:reset の
 * 存在確認が素通りし、存在しないゲストのパスワードを発行してしまった。
 * 書き込みは複数文を流すためファイル経由を維持する。
 */
export function runSql(sql, { remote, json = false }) {
  const target = remote ? '--remote' : '--local'

  if (json) {
    const out = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'ai-koushi', target, '--json', '--command', sql],
      { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
    )
    // 先頭に案内文が混ざることがあるため、JSON の開始位置から読む
    const start = out.indexOf('[')
    return start >= 0 ? JSON.parse(out.slice(start)) : null
  }

  const file = join(tmpdir(), `guest-${Date.now()}.sql`)
  writeFileSync(file, sql)
  try {
    execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'ai-koushi', target, '--file', file],
      { stdio: 'inherit', encoding: 'utf8' },
    )
    return null
  } finally {
    unlinkSync(file)
  }
}

export function printCredentials({ loginId, password, displayName, remote, note }) {
  console.log('')
  console.log('----------------------------------------')
  console.log(`  ログインID : ${loginId}`)
  console.log(`  パスワード : ${password}`)
  if (displayName) console.log(`  表示名     : ${displayName}`)
  console.log(`  対象       : ${remote ? 'リモート（本番）' : 'ローカル'}`)
  console.log('----------------------------------------')
  if (note) console.log(note)
  console.log('パスワードはここにしか表示されない。控えてから閉じること。')
}
