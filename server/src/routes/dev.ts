import { Hono } from 'hono'
import { GoogleGenAI, Type } from '@google/genai'
import type { AppEnv } from '../env'
import { requireUser } from '../auth/session'
import { collectUsage, createAiClient, flushUsage } from '../ai/factory'
import { estimateCostUsd } from '../ai/usage'

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
