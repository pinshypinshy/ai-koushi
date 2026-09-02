/**
 * 個別の月間上限を取り消し、種別の既定値へ戻す（§8.2.3、Q-31）。
 *
 *   npm run limit:clear -- <メールアドレス or ゲストID> [--courses] [--cost] [--remote]
 *
 * どちらも指定しなければ両方を戻す。既定値そのものは server/src/limits.ts にあり、
 * NULL に戻せば以降はそちらへ自動的に追従する。
 */
import { describeLimits, findUser, lit, parseArgs, runSql } from './limit-lib.mjs'

const argv = process.argv.slice(2)
const { remote, rest, target } = parseArgs(argv)
const [identifier] = rest

if (!identifier) {
  console.error('使い方: npm run limit:clear -- <メールアドレス or ゲストID> [--courses] [--cost] [--remote]')
  process.exit(1)
}

const onlyCourses = argv.includes('--courses')
const onlyCost = argv.includes('--cost')
const clearCourses = onlyCourses || !onlyCost
const clearCost = onlyCost || !onlyCourses

const user = findUser(identifier, { remote })
if (!user) {
  console.error(`${identifier} の利用者が見つからない（対象：${target}）`)
  process.exit(1)
}
if (user.course_limit === null && user.cost_limit_usd === null) {
  console.error(`${user.email} に個別の上限は設定されていない（対象：${target}）`)
  process.exit(1)
}

const sets = []
if (clearCourses) sets.push('course_limit = NULL')
if (clearCost) sets.push('cost_limit_usd = NULL')
runSql(`UPDATE users SET ${sets.join(', ')} WHERE id = ${lit(user.id)};`, { remote })

const after = findUser(identifier, { remote })

console.log('')
console.log(`${user.email}（${user.display_name} / ${user.kind}）を既定値へ戻した（対象：${target}）`)
console.log(describeLimits(after))
