/**
 * 管理者フラグ（users.is_admin）を操作するコマンドの共通処理（§4.7）。
 * SQL の実行と引数の解釈は許可リストのコマンドと同じ仕組みを使う。
 */
export { lit, runSql } from './guest-lib.mjs'
export { parseArgs, parseEmail } from './allow-lib.mjs'
