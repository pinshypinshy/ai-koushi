import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { requireUser } from '../auth/session'
import { getCourseDetail, getMaterial, listCourses } from '../db/queries'

export const courses = new Hono<AppEnv>()

/**
 * §6.4「初回ロード」。講義一覧・選択中講義・ユーザーを1往復で返す。
 * CSR のウォーターフォールへの対処であり、機能ごとに API を分けて往復させない（§7.6）。
 */
courses.get('/bootstrap', requireUser, async (c) => {
  const user = c.get('user')
  const list = await listCourses(c.env.DB, user.id)

  const requested = c.req.query('courseId')
  const targetId = requested ?? list[0]?.id ?? null
  const selected = targetId ? await getCourseDetail(c.env.DB, user.id, targetId) : null

  // 明示指定された講義が引けない場合のみ 404。他ユーザーの講義IDもここに含まれる（SEC-2）
  if (requested && !selected) {
    return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  }
  return c.json({ user, courses: list, selected })
})

courses.get('/courses/:id', requireUser, async (c) => {
  const user = c.get('user')
  const detail = await getCourseDetail(c.env.DB, user.id, c.req.param('id'))
  if (!detail) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  return c.json(detail)
})

/** 教材原文は最大240KB になるため、講義本体とは別に取得する（§4.4） */
courses.get('/courses/:id/material', requireUser, async (c) => {
  const user = c.get('user')
  const material = await getMaterial(c.env.DB, user.id, c.req.param('id'))
  if (!material) return c.json({ error: 'not_found', message: '教材が見つかりません' }, 404)
  return c.json(material)
})
