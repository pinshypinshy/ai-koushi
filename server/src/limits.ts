import type { UsageSummary } from '../../shared/api'
import { monthlyCostUsd } from './ai/usage'
import { countCoursesSince } from './db/queries'

/**
 * §8.2.3 の上限値。ゲストを絞るのは、上限が利用者ごとに数える設計であり、
 * ゲストの人数分だけ費用が積み上がるため（Q-26）。
 *
 * 上限判定（§8.2.4）とサイドバーの表示は同じ値を見る必要があるため、
 * ルート側に置かずここへ集約する。二重に定義すると、画面上の残量と
 * 実際にブロックされる境界がずれる。
 */
export const LIMITS = {
  google: { courses: 8, costUsd: 15 },
  guest: { courses: 2, costUsd: 3 },
} as const

export type UserKind = keyof typeof LIMITS

/**
 * 月の境界は JST で判定する。利用者の「今月」の感覚に合わせるためであり、
 * 課金プラットフォーム側の集計期間（§8.2.4 の二層目）と一致させる目的ではない。
 */
export function monthStartMs(now: number): number {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const jst = new Date(now + JST_OFFSET_MS)
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - JST_OFFSET_MS
}

/** 今月の消費と上限をまとめて返す。表示（§8.2.4 の警告）と作成のブロックで共用する */
export async function getUsageSummary(
  db: D1Database,
  user: { id: string; kind: UserKind },
): Promise<UsageSummary> {
  const periodStart = monthStartMs(Date.now())
  const limit = LIMITS[user.kind]
  const [costUsd, courses] = await Promise.all([
    monthlyCostUsd(db, user.id, periodStart),
    countCoursesSince(db, user.id, periodStart),
  ])
  return {
    costUsd,
    costLimitUsd: limit.costUsd,
    courses,
    courseLimit: limit.courses,
    periodStart,
  }
}
