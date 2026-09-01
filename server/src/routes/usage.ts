import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { requireUser } from '../auth/session'
import { getUsageSummary } from '../limits'

export const usage = new Hono<AppEnv>()

/**
 * 今月の利用状況（§8.2.3 の上限に対する消費分）。サイドバーの進捗表示に使う。
 *
 * 起動時は /api/bootstrap に同梱して往復を増やさない（§7.6）。この経路は
 * 講義の生成が終わった時点と受講の応答が終わった時点に、消費した分を反映し直すためのもの。
 */
usage.get('/usage', requireUser, async (c) => {
  const user = c.get('user')
  return c.json(await getUsageSummary(c.env.DB, user))
})
