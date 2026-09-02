import type { UsageRecord } from './types'

/**
 * §8.2.1 の単価（2026年8月時点、1Mトークンあたり USD）。
 *
 * Flash は2026年12月31日までの導入価格であり、2027-01-01 に倍額となる（Q-23）。
 * その時点でこの表を更新する。
 */
interface Pricing {
  input: number
  output: number
  cachedInput: number
}

const PRICING: Record<string, Pricing> = {
  'gemini-3.1-pro': { input: 2.0, output: 12.0, cachedInput: 0.2 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75, cachedInput: 0.075 },
}

/** 表に無いモデルは上位モデルの単価で見積もる。過小評価して上限を素通りさせないため */
const FALLBACK_PRICING: Pricing = PRICING['gemini-3.1-pro']

function pricingFor(model: string): Pricing {
  for (const [key, value] of Object.entries(PRICING)) {
    if (model.startsWith(key)) return value
  }
  return FALLBACK_PRICING
}

/**
 * キャッシュ保存料（$4.50 or $0.50 / 時 / 1M）はここに含めない。
 * 呼び出し単位では確定せず、キャッシュの生存期間に対して発生するためである。
 */
export function estimateCostUsd(usage: UsageRecord): number {
  const p = pricingFor(usage.model)
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  return (
    (fresh * p.input + usage.cachedInputTokens * p.cachedInput + usage.outputTokens * p.output) /
    1_000_000
  )
}

/**
 * §8.4「AI呼び出しのモデル・トークン数・所要時間・エラーを記録する」。
 *
 * この関数は AI 呼び出し層の内部ではなく、その外側の境界から呼ぶ（§8.2.4）。
 * 生成ロジックに不具合があっても計上が正しく動く必要があるためである。
 */
export async function recordUsage(
  db: D1Database,
  userId: string,
  courseId: string | null,
  usage: UsageRecord,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_usage_logs
       (id, user_id, course_id, purpose, model, input_tokens, cached_input_tokens,
        output_tokens, thinking_tokens, estimated_cost_usd, duration_ms, error, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      courseId,
      usage.purpose,
      usage.model,
      usage.inputTokens,
      usage.cachedInputTokens,
      usage.outputTokens,
      usage.thinkingTokens,
      estimateCostUsd(usage),
      usage.durationMs,
      usage.error ?? null,
      Date.now(),
    )
    .run()
}

/** §8.2.4「月間コストが上限の80%で警告、100%で新規作成をブロック」の材料 */
/**
 * §8.2.3「月間の講義作成数」。**courses ではなく ai_usage_logs から数える**（Q-30）。
 *
 * courses の行数で数えると、講義を削除した時点で今月の件数が1件戻る。複製（§4.5）と
 * 組み合わせると「作成 → 複製 → 元を削除」で内容を保ったまま枠だけ空けられ、上限が
 * 意味を失う。ai_usage_logs は講義を削除しても残るため（FK を張っていない）、
 * 「今月①骨子生成を行った講義の数」で数えれば削除で戻らない。
 *
 * MIN(created_at) で絞るのは、月をまたいだ再試行を新規作成として数えないため
 * （§4.1.6 の再試行は同じ講義に対する2回目の outline として現れる）。
 * 複製は①を呼ばないので、この数え方では自動的に対象外になる。
 * Workflow の起動自体に失敗して①を1度も呼べなかった講義も数えない（費用が出ていない）。
 */
export async function monthlyCourseCount(
  db: D1Database,
  userId: string,
  since: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT course_id FROM ai_usage_logs
          WHERE user_id = ?1 AND purpose = 'outline' AND course_id IS NOT NULL
          GROUP BY course_id
         HAVING MIN(created_at) >= ?2
       )`,
    )
    .bind(userId, since)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function monthlyCostUsd(db: D1Database, userId: string, since: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total
       FROM ai_usage_logs WHERE user_id = ?1 AND created_at >= ?2`,
    )
    .bind(userId, since)
    .first<{ total: number }>()
  return row?.total ?? 0
}
