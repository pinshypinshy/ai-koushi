/**
 * 管理者の一覧（§4.7）。
 *
 *   npm run admin:list [-- --remote]
 */
import { parseArgs, runSql } from './admin-lib.mjs'

const { remote, target } = parseArgs(process.argv.slice(2))

const res = runSql(
  `SELECT email, display_name, kind,
          datetime(created_at / 1000, 'unixepoch', '+9 hours') AS registered
   FROM users WHERE is_admin = 1 ORDER BY created_at;`,
  { remote, json: true },
)
const rows = res?.[0]?.results ?? []

console.log('')
console.log(`管理者（対象：${target}）：${rows.length} 人`)
for (const r of rows) {
  console.log(`  ${r.email}  （${r.display_name} / ${r.kind}）  登録 ${r.registered}`)
}
if (rows.length === 0) {
  console.log('  空。この状態では運営管理ページに誰も入れない')
}
