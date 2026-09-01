/**
 * 許可リスト（allowed_emails）を操作するコマンドの共通処理（§4.6）。
 * SQL の実行はゲスト発行と同じ仕組みを使う。
 */
export { lit, runSql } from './guest-lib.mjs'

/** 保存は小文字に正規化する。大文字違いで同じ人が二重に載るのを防ぐ */
export function parseEmail(raw) {
  const email = (raw ?? '').trim().toLowerCase()
  // 厳密な検証はしない。Google が認証したアドレスとの一致だけが問題であり、
  // ここで弾きたいのは打ち間違いと空文字に限られる
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('メールアドレスの形式が正しくない')
    process.exit(1)
  }
  return email
}

export function parseArgs(argv) {
  const remote = argv.includes('--remote')
  const rest = argv.filter((a) => !a.startsWith('--'))
  return { remote, rest, target: remote ? 'リモート（本番）' : 'ローカル' }
}
