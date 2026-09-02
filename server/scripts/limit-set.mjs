/**
 * 月間上限の個別設定（§8.2.3、Q-31）。
 *
 *   npm run limit:set -- <メールアドレス or ゲストID> [--courses 5] [--cost 10] [--remote]
 *
 * 指定しなかった側は現状のまま（既定値なら既定値のまま）にする。片方だけ緩めたい
 * 場合があるためである。判定は毎回 DB を引くため（server/src/limits.ts）、
 * 再ログインを待たずにこの時点で効く。
 */
import { describeLimits, findUser, lit, parseArgs, runSql } from './limit-lib.mjs'

const argv = process.argv.slice(2)
const { remote, rest, target } = parseArgs(argv)
const [identifier] = rest

const USAGE =
  '使い方: npm run limit:set -- <メールアドレス or ゲストID> [--courses <件数>] [--cost <USD>] [--remote]'

/** `--courses 5` と `--courses=5` の両方を受ける */
function readOption(name) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

function parseNumber(raw, label, { integer }) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    console.error(`${label}は0以上の${integer ? '整数' : '数値'}で指定する`)
    process.exit(1)
  }
  return value
}

if (!identifier) {
  console.error(USAGE)
  process.exit(1)
}

const rawCourses = readOption('courses')
const rawCost = readOption('cost')
if (rawCourses === undefined && rawCost === undefined) {
  console.error('--courses と --cost の少なくとも一方を指定する')
  console.error(USAGE)
  process.exit(1)
}

const courses = rawCourses === undefined ? null : parseNumber(rawCourses, '講義作成数', { integer: true })
const cost = rawCost === undefined ? null : parseNumber(rawCost, 'コスト上限', { integer: false })

const user = findUser(identifier, { remote })
if (!user) {
  console.error(`${identifier} の利用者が見つからない（対象：${target}）`)
  console.error('メールアドレス、またはゲストのログインIDで指定する。')
  process.exit(1)
}

const sets = []
if (courses !== null) sets.push(`course_limit = ${courses}`)
if (cost !== null) sets.push(`cost_limit_usd = ${cost}`)
runSql(`UPDATE users SET ${sets.join(', ')} WHERE id = ${lit(user.id)};`, { remote })

const after = findUser(identifier, { remote })

console.log('')
console.log(`${user.email}（${user.display_name} / ${user.kind}）の上限を変更した（対象：${target}）`)
console.log(describeLimits(after))
console.log('既定値へ戻すには npm run limit:clear を使う。')
