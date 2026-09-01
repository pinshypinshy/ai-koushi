import { Hono } from 'hono'
import type { AppEnv } from '../env'
import type { AttemptRequest } from '../../../shared/api'
import { requireUser } from '../auth/session'
import { InvalidChoiceError, getQuiz, gradeAttempt } from '../db/queries'

/** 確認テスト（§4.3）。出題と採点を扱う */
export const quiz = new Hono<AppEnv>()

/**
 * 出題（§4.3.1）。正解と解説は含めない。
 * 併せて設問ごとの最新の解答を返す。復習モード（§4.3.4）の対象は
 * 「最新の解答記録が誤答である設問」であり、再訪時にも復元できる必要がある。
 */
quiz.get('/courses/:id/quiz', requireUser, async (c) => {
  const user = c.get('user')
  const result = await getQuiz(c.env.DB, user.id, c.req.param('id'))
  if (!result) return c.json({ error: 'not_found', message: '講義が見つかりません' }, 404)
  return c.json(result)
})

/**
 * 解答（§4.3.2）。正誤・正解・解説はここで初めてクライアントへ渡る。
 * 記録は上書きではなく追記する（§4.3.3）。
 */
quiz.post('/questions/:id/attempts', requireUser, async (c) => {
  const user = c.get('user')
  const body = await c.req.json<AttemptRequest>().catch(() => null)
  if (!body?.selectedChoiceId) {
    return c.json({ error: 'invalid_request', message: '選択肢が指定されていません' }, 400)
  }

  try {
    const result = await gradeAttempt(
      c.env.DB,
      user.id,
      c.req.param('id'),
      body.selectedChoiceId,
    )
    if (!result) return c.json({ error: 'not_found', message: '設問が見つかりません' }, 404)
    return c.json(result)
  } catch (err) {
    if (err instanceof InvalidChoiceError) {
      return c.json({ error: 'invalid_choice', message: err.message }, 400)
    }
    throw err
  }
})
