import { ApiError } from '@google/genai'

/**
 * §5.7 エラーハンドリング。
 *
 * リトライは有限回に固定する。無限に再試行する経路を作らないことは
 * §8.2.4 の防護の一部でもある（利用額上限の集計には数時間の遅延があり、
 * 短時間の暴走はアプリ側でしか塞げない）。
 */
const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 500

export class AiUnavailableError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AiUnavailableError'
    this.status = status
  }
}

function statusOf(err: unknown): number | null {
  if (err instanceof ApiError) return err.status
  return null
}

/**
 * 429 には二種類ある。単位時間あたりの上限（待てば回復する）と、
 * クレジット枯渇・支出上限到達（待っても回復しない、§5.7「クォータ超過」）である。
 * 後者を再試行すると、回復しない事象に対して3回分の待ち時間を費やすだけになる。
 */
function isQuotaExhausted(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    message.includes('credits are depleted') ||
    message.includes('billing') ||
    message.includes('quota exceeded')
  )
}

function isRetryable(status: number | null): boolean {
  if (status === null) return false
  // 429（レート制限）と 5xx（サーバーエラー）のみ再試行する
  return status === 429 || (status >= 500 && status < 600)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const status = statusOf(err)

      // 401 は APIキーの失効を意味する。再試行しても回復しないため即座に失敗させる
      if (status === 401 || status === 403) {
        throw new AiUnavailableError(status, 'AIのAPIキーが無効です。設定を確認してください。')
      }
      if (status === 429 && isQuotaExhausted(err)) {
        throw new AiUnavailableError(
          429,
          'AIの利用枠を使い切っています。課金設定を確認してください。',
        )
      }
      if (!isRetryable(status) || attempt === MAX_ATTEMPTS) break

      // 指数バックオフ
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1))
      console.warn(`ai_retry ${label} attempt=${attempt} status=${status}`)
    }
  }

  const status = statusOf(lastError)
  if (status === 429) {
    throw new AiUnavailableError(429, 'AIのレート制限に達しました。時間をおいて再試行してください。')
  }
  if (status !== null && status >= 500) {
    throw new AiUnavailableError(status, 'AI側で一時的なエラーが発生しました。')
  }
  throw lastError
}
