import { Hono } from 'hono'
import { GoogleGenAI, Type } from '@google/genai'
import type { AppEnv, Env } from '../env'
import { requireUser } from '../auth/session'
import { MATERIAL_MAX_CHARS, MATERIAL_MIN_CHARS } from './courses'
import { collectUsage, createAiClient, flushUsage } from '../ai/factory'
import { estimateCostUsd } from '../ai/usage'
import { D1CacheStore } from '../db/caches'
import type { OutlineResult, QuizResult, UsageRecord } from '../ai/types'

/**
 * 開発時の確認用エンドポイント。製品には含めない。
 *
 * Q-22（`@google/genai` が Cloudflare Workers 上で動作するか）と
 * Q-16（日本語1文字あたりのトークン数）の確認をここで行う。
 */
export const dev = new Hono<AppEnv>()

/**
 * SDK がバンドルされ、Workers のランタイムで読み込めるかだけを見る。
 * 外部への通信を行わないため、APIキーも課金も不要。
 */
dev.get('/ai/build', (c) => {
  const client = new GoogleGenAI({ apiKey: 'dummy-key-for-instantiation-check' })
  return c.json({
    ok: true,
    sdkLoaded: typeof client.models.generateContent === 'function',
    streamAvailable: typeof client.models.generateContentStream === 'function',
    cachesAvailable: typeof client.caches.create === 'function',
    hasApiKey: c.env.GEMINI_API_KEY.length > 0,
  })
})

/** 実際に使えるモデルIDの一覧。§5.5 で指定したIDが存在するかの確認に使う */
dev.get('/ai/models', requireUser, async (c) => {
  const ai = new GoogleGenAI({ apiKey: c.env.GEMINI_API_KEY })
  const names: string[] = []
  try {
    const pager = await ai.models.list()
    for await (const model of pager) {
      if (model.name) names.push(model.name)
      if (names.length >= 200) break
    }
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
  }
  const configured = {
    outline: c.env.MODEL_OUTLINE,
    quiz: c.env.MODEL_QUIZ,
    lecture: c.env.MODEL_LECTURE,
  }
  const available = (id: string) => names.some((n) => n === id || n === `models/${id}`)
  return c.json({
    ok: true,
    configured,
    configuredAvailable: {
      outline: available(configured.outline),
      quiz: available(configured.quiz),
      lecture: available(configured.lecture),
    },
    count: names.length,
    models: names,
  })
})

/** 教材として現実的な日本語。Q-16 の実測に用いる */
const JA_SAMPLE = [
  'バージョン管理システムは、ファイルの変更履歴を記録し、任意の時点の状態を復元できるようにする仕組みである。',
  'Git は分散型のバージョン管理システムであり、各利用者の手元に完全な履歴の複製を持つ点に特徴がある。',
  '中央のサーバーに接続できない状況でも、コミットや履歴の参照といった操作を行える。',
  'Git における変更の記録は、ワーキングツリー、ステージングエリア、リポジトリの三つの領域を移動する形で進む。',
  '編集した内容はまずワーキングツリーに現れ、`git add` によってステージングエリアへ移され、`git commit` によってリポジトリへ記録される。',
  'この二段階の構造は、一度の編集のうち意味的にまとまった部分だけを選んで記録することを可能にしている。',
].join('')

/**
 * 実際に Gemini を呼ぶ確認。数十トークン規模のため費用は無視できる。
 * トークン計測・非ストリーミング・構造化出力・ストリーミングの4つを順に試す。
 */
dev.get('/ai/probe', requireUser, async (c) => {
  const user = c.get('user')
  const model = c.env.MODEL_LECTURE
  const ai = new GoogleGenAI({ apiKey: c.env.GEMINI_API_KEY })
  const result: Record<string, unknown> = { model }

  // 1. Q-16：日本語1文字あたりのトークン数
  try {
    const counted = await ai.models.countTokens({ model, contents: JA_SAMPLE })
    const tokens = counted.totalTokens ?? 0
    result.tokenCount = {
      chars: JA_SAMPLE.length,
      tokens,
      charsPerToken: tokens > 0 ? Number((JA_SAMPLE.length / tokens).toFixed(3)) : null,
      // §4.1.2 の上限80,000文字を、この比率で換算するとどうなるか
      estimatedTokensAt80kChars: tokens > 0 ? Math.round((80000 / JA_SAMPLE.length) * tokens) : null,
    }
  } catch (err) {
    result.tokenCount = { error: err instanceof Error ? err.message : String(err) }
  }

  const { sink, records } = collectUsage()
  const client = createAiClient(c.env, sink)

  // 2. 構造化出力とストリーミングを、AI層を通さず直接確認する
  try {
    const started = Date.now()
    const structured = await ai.models.generateContent({
      model,
      contents: '「Git」という語の読みを1つだけ答えよ。',
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { reading: { type: Type.STRING } },
          required: ['reading'],
        },
      },
    })
    result.structuredOutput = {
      ok: true,
      latencyMs: Date.now() - started,
      text: structured.text,
      usage: structured.usageMetadata,
    }
  } catch (err) {
    result.structuredOutput = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  try {
    const started = Date.now()
    let firstChunkMs: number | null = null
    let chunks = 0
    let text = ''
    const stream = await ai.models.generateContentStream({
      model,
      contents: 'バージョン管理とは何かを2文で説明せよ。',
    })
    for await (const chunk of stream) {
      if (firstChunkMs === null) firstChunkMs = Date.now() - started
      chunks++
      text += chunk.text ?? ''
    }
    result.streaming = {
      ok: true,
      // §8.1 の目標は3秒以内。ここは教材キャッシュ無しの短文なので参考値
      firstChunkMs,
      totalMs: Date.now() - started,
      chunks,
      preview: text.slice(0, 120),
    }
  } catch (err) {
    result.streaming = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  // 3. ⑤ステップ要約を AI 層経由で呼び、計上の経路まで通す
  try {
    const summary = await client.summarizeStep({
      step: {
        orderIndex: 1,
        title: '三つの領域',
        objective: 'ワーキングツリー・ステージング・リポジトリの違いを説明できる',
        keyPoints: ['git add はステージングへ移す', 'git commit は記録する'],
        sourceRef: '§1',
      },
      history: [
        { role: 'assistant', content: 'Git には三つの領域があります。' },
        { role: 'user', content: 'add と commit の違いが分かりません。' },
        { role: 'assistant', content: 'add は移す操作、commit は記録する操作です。' },
      ],
    })
    result.aiLayer = { ok: true, summary }
  } catch (err) {
    result.aiLayer = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  await flushUsage(c.env, user.id, null, records)
  result.usage = records.map((r) => ({ ...r, estimatedCostUsd: estimateCostUsd(r) }))

  return c.json(result)
})

// ---------------------------------------------------------------------------
// ①骨子生成 → ②確認テスト生成の実通信確認
// ---------------------------------------------------------------------------

// §4.1.2 の入力制約は本番の受け口（courses.ts）と同じ値を使う。検証用でも上限を外さない。
// 誤って巨大な教材を投げたときに発生する課金は本番とまったく同じであるため

/** §8.4 のログ要件と揃える。長大なスタックはそのまま載せない */
function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

/**
 * 検証で作られたコンテキストキャッシュと一時的な講義行を消す。
 *
 * Gemini のキャッシュ保存料は保存時間に対する従量課金であり（§8.2.1）、
 * TTL 満了まで放置すると検証を回すたびに無駄が積み上がる。
 * 「生存期間は明示的に管理する」という §8.2.1 の方針をここでも守る。
 */
async function cleanupProbeCourse(env: Env, ai: GoogleGenAI, courseId: string): Promise<void> {
  const store = new D1CacheStore(env.DB)
  // ①は現状キャッシュを作らないが、後から作るようになっても取りこぼさない
  const models = [env.MODEL_OUTLINE, env.MODEL_QUIZ].filter((m, i, a) => a.indexOf(m) === i)
  for (const model of models) {
    const ref = await store.get(courseId, model)
    if (!ref) continue
    try {
      await ai.caches.delete({ name: ref.name })
    } catch (err) {
      console.warn('dev_cache_delete_failed', ref.name, messageOf(err))
    }
  }
  // course_caches は ON DELETE CASCADE で一緒に消える
  await env.DB.prepare('DELETE FROM courses WHERE id = ?1').bind(courseId).run()
}

/**
 * §5.3 R-8「横断設問を全体の2〜3割程度含める」は validateQuiz が見ていない。
 * 満たさなくても講義は成立するため検証で弾かず、ここで観測だけする。
 */
function quizStats(quiz: QuizResult, stepCount: number) {
  const total = quiz.questions.length
  const cross = quiz.questions.filter((q) => q.coveredSteps.length >= 2).length
  const ratio = total > 0 ? cross / total : 0
  const questionsPerStep: Record<number, number> = {}
  for (let i = 1; i <= stepCount; i++) questionsPerStep[i] = 0
  for (const q of quiz.questions) for (const s of q.coveredSteps) questionsPerStep[s]++
  return {
    total,
    crossStep: cross,
    crossStepRatio: Number(ratio.toFixed(3)),
    crossStepRatioInRange: ratio >= 0.2 && ratio <= 0.3,
    questionsPerStep,
  }
}

/**
 * ①骨子生成 → ②確認テスト生成を実データで通す。DB には結果を残さない。
 *
 * この2つは講義作成 Workflow（§7.4）の `step.do()` の中身そのものである。
 * Workflow のリトライと永続化が絡んだ状態で不具合を切り分けるのは高くつくため、
 * 素の HTTP エンドポイントで先に確定させる。
 *
 * 見るべきものは3つ。
 *   1. §5.2 / §5.3 の要件を満たす出力が返るか（steps / questions を目視する）
 *   2. コンテキストキャッシュが実際に効いているか（cache.effective）
 *   3. §8.2.2 の文字/トークン比が数式主体の教材でどう変わるか（tokenCount）
 *
 * 呼び出しはブラウザの開発者コンソールから行う（セッション Cookie が自動で乗る）。
 */
dev.post('/ai/generate', requireUser, async (c) => {
  const user = c.get('user')
  const material = await c.req.text()
  const titleHint = c.req.query('title')?.trim() || undefined

  if (material.length < MATERIAL_MIN_CHARS || material.length > MATERIAL_MAX_CHARS) {
    return c.json(
      {
        error: 'invalid_material',
        message: `教材は${MATERIAL_MIN_CHARS}〜${MATERIAL_MAX_CHARS}文字である必要があります（${material.length}文字）`,
      },
      400,
    )
  }

  const ai = new GoogleGenAI({ apiKey: c.env.GEMINI_API_KEY })

  // Q-16 の再測定。§8.2.2 の 2.02文字/トークン は日本語散文1サンプルの値であり、
  // 数式やコードを多く含む教材では比率が変わる。実際に課金された量は usage 側で見る
  let tokenCount: unknown
  try {
    const counted = await ai.models.countTokens({ model: c.env.MODEL_OUTLINE, contents: material })
    const tokens = counted.totalTokens ?? 0
    tokenCount = {
      chars: material.length,
      tokens,
      charsPerToken: tokens > 0 ? Number((material.length / tokens).toFixed(3)) : null,
      // この比率で §4.1.2 の上限まで積んだ場合のトークン数。20万の割増境界（§8.2.1）との距離を見る
      estimatedTokensAtMaxChars:
        tokens > 0 ? Math.round((MATERIAL_MAX_CHARS / material.length) * tokens) : null,
    }
  } catch (err) {
    tokenCount = { error: messageOf(err) }
  }

  /**
   * ②はコンテキストキャッシュを講義単位で引き当てる（§8.2「実装必須事項」）。
   * course_caches.course_id は courses への外部キーを持つため、実在する講義行が無いと
   * キャッシュ参照の保存が失敗する。ensureCache はその失敗を握り潰して非キャッシュ経路へ
   * 落ちる設計であり、行を作らずに走らせると「キャッシュが効かない」ことに気付けない。
   * 検証のためだけに一時的な行を作り、最後に必ず消す。
   */
  const courseId = `dev-${crypto.randomUUID()}`
  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO courses (id, user_id, title, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'generating', ?4, ?4)`,
  )
    .bind(courseId, user.id, '[dev] AI層の検証', now)
    .run()

  const { sink, records } = collectUsage()
  const client = createAiClient(c.env, sink)

  let outline: OutlineResult | null = null
  let outlineError: string | null = null
  let quiz: QuizResult | null = null
  let quizError: string | null = null

  try {
    try {
      outline = await client.generateOutline({ material, titleHint })
    } catch (err) {
      outlineError = messageOf(err)
    }

    // ①が失敗したら②は実行しない。②は骨子を入力に取るためであり、
    // Workflow のステップ依存（§7.4）と同じ関係になる
    if (outline) {
      try {
        quiz = await client.generateQuiz({ material, outline: outline.steps, courseId })
      } catch (err) {
        quizError = messageOf(err)
      }
    }
  } finally {
    // 呼び出しの成否に関わらず計上する（§8.2.4）。
    // course_id を null にするのは、紐づけ先の行をこの直後に消すため。
    //
    // 計上と後片付けの失敗でレスポンスを落とさない。ここで例外を投げると、
    // 課金済みの生成結果ごと 500 になり、検証のために払った分が無駄になる。
    // 失敗はログに残し、後片付けの取りこぼしは TTL とキャッシュ削除の再実行で回収する。
    try {
      await flushUsage(c.env, user.id, null, records)
    } catch (err) {
      console.error('dev_flush_usage_failed', messageOf(err))
    }
    try {
      await cleanupProbeCourse(c.env, ai, courseId)
    } catch (err) {
      console.error('dev_cleanup_failed', courseId, messageOf(err))
    }
  }

  /**
   * 同一 purpose の記録が2件あれば §5.6「スキーマ違反時のリトライは最大1回」が発火している。
   * 失敗した試行にも UsageRecord が error 付きで残るため、AI層に手を入れずに外から観測できる。
   */
  const attemptsOf = (purpose: UsageRecord['purpose']) => {
    const rs = records.filter((r) => r.purpose === purpose)
    return { attempts: rs.length, attemptErrors: rs.map((r) => r.error).filter(Boolean) }
  }

  const usage = records.map((r) => ({ ...r, estimatedCostUsd: estimateCostUsd(r) }))
  const totalCostUsd = usage.reduce((sum, u) => sum + u.estimatedCostUsd, 0)

  /**
   * 出力トークンに占める思考の割合（§5.5）。
   * ①②の思考は既定のままにしてあるが、実測でコストが §8.2.2 の見積もりを大きく超えた。
   * 主因が思考なら思考レベルの引き下げが効き、本文出力なら効かない。その切り分けに使う。
   */
  const outputTotal = records.reduce((sum, r) => sum + r.outputTokens, 0)
  const thinkingTotal = records.reduce((sum, r) => sum + r.thinkingTokens, 0)

  // §8.2 が「実装必須事項」とした一点。②で 0 ならキャッシュは効いていない
  const quizCachedInputTokens = records
    .filter((r) => r.purpose === 'quiz')
    .reduce((max, r) => Math.max(max, r.cachedInputTokens), 0)

  const stepCount = outline?.steps.length ?? 0

  return c.json({
    models: { outline: c.env.MODEL_OUTLINE, quiz: c.env.MODEL_QUIZ },
    material: { chars: material.length, titleHint: titleHint ?? null },
    tokenCount,
    outline: outline
      ? {
          ok: true,
          courseTitle: outline.courseTitle,
          stepCount,
          steps: outline.steps,
          ...attemptsOf('outline'),
        }
      : { ok: false, error: outlineError, ...attemptsOf('outline') },
    quiz: quiz
      ? { ok: true, ...quizStats(quiz, stepCount), questions: quiz.questions, ...attemptsOf('quiz') }
      : {
          ok: false,
          error: quizError ?? '骨子生成に失敗したため実行していません',
          ...attemptsOf('quiz'),
        },
    cache: { quizCachedInputTokens, effective: quizCachedInputTokens > 0 },
    thinking: {
      outputTokens: outputTotal,
      thinkingTokens: thinkingTotal,
      share: outputTotal > 0 ? Number((thinkingTotal / outputTotal).toFixed(3)) : 0,
    },
    usage,
    totalCostUsd: Number(totalCostUsd.toFixed(5)),
  })
})
