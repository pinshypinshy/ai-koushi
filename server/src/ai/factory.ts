import type { Env } from '../env'
import { D1CacheStore } from '../db/caches'
import { GeminiClient } from './gemini'
import { recordUsage } from './usage'
import type { AiClient, UsageRecord } from './types'

/**
 * 呼び出しの実績を溜める入れ物。
 *
 * §8.2.4 に従い、計上は AI 呼び出し層の内部ではなく境界で行う。
 * 生成ロジックに不具合があっても計上が正しく動く必要があるため、
 * クライアントは記録を「報告」するだけで、永続化には関与しない。
 */
export function collectUsage(): { sink: (u: UsageRecord) => void; records: UsageRecord[] } {
  const records: UsageRecord[] = []
  return { sink: (u) => records.push(u), records }
}

export function createAiClient(env: Env, sink: (u: UsageRecord) => void): AiClient {
  return new GeminiClient(
    env.GEMINI_API_KEY,
    {
      outline: env.MODEL_OUTLINE,
      quiz: env.MODEL_QUIZ,
      lecture: env.MODEL_LECTURE,
      answer: env.MODEL_ANSWER,
      summary: env.MODEL_SUMMARY,
    },
    new D1CacheStore(env.DB),
    sink,
  )
}

/** 溜めた実績をまとめて ai_usage_logs へ書く。呼び出しの成否に関わらず必ず通す */
export async function flushUsage(
  env: Env,
  userId: string,
  courseId: string | null,
  records: UsageRecord[],
): Promise<void> {
  for (const record of records) {
    await recordUsage(env.DB, userId, courseId, record)
  }
}
