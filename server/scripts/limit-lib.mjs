/**
 * 月間上限の個別設定（users.course_limit / cost_limit_usd）を操作する
 * コマンドの共通処理（§8.2.3、Q-31）。SQL の実行は他のコマンドと同じ仕組みを使う。
 */
import { lit, runSql } from './guest-lib.mjs'
import { parseArgs } from './allow-lib.mjs'

export { lit, runSql, parseArgs }

/**
 * 対象の利用者を1人引く。メールアドレスとゲストのログインIDのどちらでも指定できる。
 * ゲストのアドレスは `<ID>@guest.local` という機械生成の値であり（guest-add.mjs）、
 * 運営が覚えているのは発行時に渡したログインIDの方であるため。
 */
export function findUser(identifier, { remote }) {
  const key = lit(String(identifier ?? '').trim().toLowerCase())
  const res = runSql(
    `SELECT u.id, u.email, u.display_name, u.kind, u.course_limit, u.cost_limit_usd
     FROM users u LEFT JOIN guest_accounts g ON g.user_id = u.id
     WHERE u.email = ${key} OR g.login_id = ${key};`,
    { remote, json: true },
  )
  return res?.[0]?.results?.[0] ?? null
}

/**
 * 現在の設定を表示する。既定値の場合は数値を出さず「既定値に従う」とだけ書く。
 * ここに既定値を写すと server/src/limits.ts と二重定義になり、片方だけ変えたときに
 * コマンドの表示と実際にブロックされる境界がずれる（実際の値は管理ページで見る）。
 */
export function describeLimits(user) {
  const show = (value, unit) => (value === null ? '種別の既定値に従う' : `${unit(value)}（個別）`)
  return [
    `  講義作成数 : ${show(user.course_limit, (v) => `${v} 件/月`)}`,
    `  コスト     : ${show(user.cost_limit_usd, (v) => `$${v}/月`)}`,
  ].join('\n')
}
