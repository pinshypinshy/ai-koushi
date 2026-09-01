import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './env'
import { auth } from './auth/routes'
import { requireUser } from './auth/session'
import { courses } from './routes/courses'
import { lecture } from './routes/lecture'
import { quiz } from './routes/quiz'
import { usage } from './routes/usage'
import { dev } from './routes/dev'

const app = new Hono<AppEnv>()

/** 疎通確認用。DB へは触れない */
app.get('/api/health', (c) => c.json({ ok: true }))

app.route('/auth', auth)

/** ログイン状態の確認。フロントは起動時にこれを見て SC-01 か本体かを決める */
app.get('/api/me', requireUser, (c) => c.json(c.get('user')))

app.route('/api', courses)
app.route('/api', lecture)
app.route('/api', quiz)
app.route('/api', usage)

/**
 * 開発用。製品には含めない（§3「画面一覧」の DevPanel と同じ位置づけ）。
 * 本番でも到達できると、モデル一覧の取得のように課金の走る口が外に出る。
 * 判定に APP_ORIGIN を使うのは、環境を識別する値をこれ1つに保つため
 * （Cookie の Secure 判定も同じ値を見ている → auth/session.ts の isSecure）。
 */
app.use('/api/dev/*', async (c, next) => {
  if (!c.env.APP_ORIGIN.startsWith('http://localhost')) return c.notFound()
  await next()
})
app.route('/api/dev', dev)

app.notFound((c) => c.json({ error: 'not_found', message: 'エンドポイントが存在しません' }, 404))

app.onError((err, c) => {
  // §8.4：エラーは Workers Observability のログに残す
  console.error('unhandled', err)
  // ライブラリが投げる HTTPException（OAuth の state 不一致など）は
  // 自身のステータスを持っているため、500 に塗り潰さない
  if (err instanceof HTTPException) {
    return c.json({ error: 'request_failed', message: err.message }, err.status)
  }
  return c.json({ error: 'internal', message: 'サーバー側でエラーが発生しました' }, 500)
})

export default app

/**
 * Workflow のクラスは Worker のエクスポートとして公開する必要がある（Cloudflare の仕様）。
 * wrangler.jsonc の workflows[].class_name がこの名前を参照する。
 */
export { CreateCourseWorkflow } from './workflows/createCourse'
