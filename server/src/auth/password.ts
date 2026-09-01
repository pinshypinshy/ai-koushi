/**
 * ゲストサインインのパスワード検証（Q-26）。
 *
 * Workers で標準に使える鍵導出のうち、実用に足るのは PBKDF2 のみである
 * （bcrypt / scrypt / argon2 は WebCrypto に無い）。反復回数は OWASP が
 * PBKDF2-SHA256 に対して示す水準に合わせる。
 */

const ITERATIONS = 210_000
const KEY_BITS = 256

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export interface PasswordRecord {
  hash: string
  salt: string
  iterations: number
}

/** 発行時に使う。サーバー側では検証しか行わないが、同じ手順を1箇所に置く */
export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return { hash: toBase64(hash), salt: toBase64(salt), iterations: ITERATIONS }
}

/**
 * 一致の判定は定数時間で行う。先頭から順に比較して早期に返すと、
 * 応答時間の差から正解の断片が推測されうるため。
 */
export async function verifyPassword(
  password: string,
  record: PasswordRecord,
): Promise<boolean> {
  const expected = fromBase64(record.hash)
  const actual = await derive(password, fromBase64(record.salt), record.iterations)
  if (expected.length !== actual.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i]
  return diff === 0
}
