/**
 * 許可リストの一覧（§4.6）。
 *
 *   npm run allow:list [-- --remote]
 */
import { parseArgs, runSql } from './allow-lib.mjs'

const { remote, target } = parseArgs(process.argv.slice(2))

const res = runSql(
  `SELECT email, note, datetime(created_at / 1000, 'unixepoch', '+9 hours') AS added
   FROM allowed_emails ORDER BY created_at;`,
  { remote, json: true },
)
const rows = res?.[0]?.results ?? []

console.log('')
console.log(`許可リスト（対象：${target}）：${rows.length} 件`)
for (const r of rows) {
  console.log(`  ${r.email}${r.note ? `  （${r.note}）` : ''}  追加 ${r.added}`)
}
if (rows.length === 0) {
  console.log('  空。この状態では誰もサインインできない（閉じる側に倒している）')
}
