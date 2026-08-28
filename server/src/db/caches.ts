import type { CacheRef, CacheStore } from '../ai/types'

/**
 * コンテキストキャッシュの参照を D1 に保持する。
 *
 * Gemini のキャッシュは保存時間に応じた従量課金が乗るため（§8.2.1）、
 * 「講義とモデルの組に対して1つだけ作り、期限まで使い回す」という形で
 * 生存期間を明示的に管理する。
 */
export class D1CacheStore implements CacheStore {
  constructor(private readonly db: D1Database) {}

  async get(courseId: string, model: string): Promise<CacheRef | null> {
    const row = await this.db
      .prepare(
        'SELECT cache_name, expires_at FROM course_caches WHERE course_id = ?1 AND model = ?2',
      )
      .bind(courseId, model)
      .first<{ cache_name: string; expires_at: number }>()
    if (!row) return null
    // 期限切れは無いものとして扱う。Google 側でも TTL で消えている
    if (row.expires_at <= Date.now()) return null
    return { name: row.cache_name, expiresAt: row.expires_at }
  }

  async set(courseId: string, model: string, ref: CacheRef): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO course_caches (course_id, model, cache_name, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (course_id, model)
         DO UPDATE SET cache_name = excluded.cache_name, expires_at = excluded.expires_at`,
      )
      .bind(courseId, model, ref.name, ref.expiresAt, Date.now())
      .run()
  }

  async delete(courseId: string, model: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM course_caches WHERE course_id = ?1 AND model = ?2')
      .bind(courseId, model)
      .run()
  }
}
