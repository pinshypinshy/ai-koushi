import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import type { GenerateContentResponse } from '@google/genai'
import { OUTLINE_SCHEMA, QUIZ_SCHEMA, type RawOutline, type RawQuiz } from './schemas'
import {
  formatHistory,
  lectureSystemPrompt,
  lectureTurnPrompt,
  outlineSystemPrompt,
  quizSystemPrompt,
  summarySystemPrompt,
  wrapMaterial,
} from './prompts'
import { AiValidationError, validateOutline, validateQuiz } from './validate'
import { withRetry } from './retry'
import type {
  AiClient,
  AiPurpose,
  CacheStore,
  LectureContext,
  OutlineResult,
  OutlineStep,
  QuizResult,
  Turn,
  UsageRecord,
} from './types'

export interface GeminiModels {
  outline: string
  quiz: string
  lecture: string
  answer: string
  summary: string
}

/** 呼び出しの実績を外側へ渡す。計上は AI 層の外で行う（§8.2.4） */
export type UsageSink = (usage: UsageRecord) => void

/**
 * キャッシュの生存期間。§8.2.2 は講義1件あたり計3時間の保存を見込んでいる。
 * 1時間ごとに作り直すことで、放置された講義のキャッシュ保存料が累積しない。
 */
const CACHE_TTL_SEC = 60 * 60

export class GeminiClient implements AiClient {
  private readonly ai: GoogleGenAI

  constructor(
    apiKey: string,
    private readonly models: GeminiModels,
    private readonly caches: CacheStore,
    private readonly onUsage: UsageSink,
  ) {
    this.ai = new GoogleGenAI({ apiKey })
  }

  // ---------------------------------------------------------------- 共通処理

  private report(
    purpose: AiPurpose,
    model: string,
    startedAt: number,
    response: GenerateContentResponse | null,
    error?: string,
  ): void {
    const u = response?.usageMetadata
    this.onUsage({
      purpose,
      model,
      inputTokens: u?.promptTokenCount ?? 0,
      cachedInputTokens: u?.cachedContentTokenCount ?? 0,
      // 思考トークンは課金上は出力として扱われるため合算する
      outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
      // 上の内数。切り分けのために別途保持する（§5.5）
      thinkingTokens: u?.thoughtsTokenCount ?? 0,
      durationMs: Date.now() - startedAt,
      error,
    })
  }

  /**
   * 教材と骨子のコンテキストキャッシュを用意する（§8.2「実装必須事項」）。
   *
   * 作成に失敗した場合は null を返し、呼び出し側は教材を毎回そのまま送る。
   * 失敗しうる主な理由は最小トークン数の未達で、教材の下限は500文字（§4.1.2）と
   * 小さいため現実に起こる。キャッシュ不成立で講義自体が作れなくなる方が損失が大きい。
   */
  private async ensureCache(
    courseId: string,
    model: string,
    material: string,
    systemInstruction: string,
  ): Promise<string | null> {
    const existing = await this.caches.get(courseId, model)
    if (existing) return existing.name

    try {
      const created = await this.ai.caches.create({
        model,
        config: {
          contents: [{ role: 'user', parts: [{ text: wrapMaterial(material) }] }],
          systemInstruction,
          ttl: `${CACHE_TTL_SEC}s`,
          displayName: `course-${courseId}`,
        },
      })
      if (!created.name) return null
      const expiresAt = created.expireTime
        ? Date.parse(created.expireTime)
        : Date.now() + CACHE_TTL_SEC * 1000
      await this.caches.set(courseId, model, { name: created.name, expiresAt })
      return created.name
    } catch (err) {
      console.warn('cache_create_failed', model, err instanceof Error ? err.message : err)
      return null
    }
  }

  // ------------------------------------------------------------ ① 骨子生成

  async generateOutline(input: { material: string; titleHint?: string }): Promise<OutlineResult> {
    const model = this.models.outline
    const system = outlineSystemPrompt(input.titleHint)

    const run = async (): Promise<OutlineResult> => {
      const startedAt = Date.now()
      let response: GenerateContentResponse | null = null
      try {
        response = await withRetry('outline', () =>
          this.ai.models.generateContent({
            model,
            contents: wrapMaterial(input.material),
            config: {
              systemInstruction: system,
              responseMimeType: 'application/json',
              responseSchema: OUTLINE_SCHEMA,
            },
          }),
        )
        const raw = JSON.parse(response.text ?? '{}') as RawOutline
        const result = validateOutline(raw)
        this.report('outline', model, startedAt, response)
        return result
      } catch (err) {
        this.report('outline', model, startedAt, response, messageOf(err))
        throw err
      }
    }

    return retryOnValidation(run)
  }

  // ------------------------------------------------------- ② 確認テスト生成

  async generateQuiz(input: {
    material: string
    outline: OutlineStep[]
    courseId: string
  }): Promise<QuizResult> {
    const model = this.models.quiz
    const system = quizSystemPrompt()
    // ①で作られたキャッシュを読み取る形になる（同一モデルのため）
    const cacheName = await this.ensureCache(input.courseId, model, input.material, system)

    const outlineText = input.outline
      .map(
        (s) =>
          `${s.orderIndex}. ${s.title}\n  学習目標：${s.objective}\n  要点：${s.keyPoints.join('、')}`,
      )
      .join('\n')

    const run = async (): Promise<QuizResult> => {
      const startedAt = Date.now()
      let response: GenerateContentResponse | null = null
      try {
        response = await withRetry('quiz', () =>
          this.ai.models.generateContent({
            model,
            contents: cacheName
              ? `# 骨子\n${outlineText}`
              : `${wrapMaterial(input.material)}\n\n# 骨子\n${outlineText}`,
            config: {
              ...(cacheName ? { cachedContent: cacheName } : { systemInstruction: system }),
              responseMimeType: 'application/json',
              responseSchema: QUIZ_SCHEMA,
            },
          }),
        )
        const raw = JSON.parse(response.text ?? '{}') as RawQuiz
        const result = validateQuiz(raw, input.outline.length)
        this.report('quiz', model, startedAt, response)
        return result
      } catch (err) {
        this.report('quiz', model, startedAt, response, messageOf(err))
        throw err
      }
    }

    return retryOnValidation(run)
  }

  // --------------------------------------------- ③④ 講義本文生成／質問応答

  private async *stream(
    purpose: 'lecture' | 'answer',
    model: string,
    ctx: LectureContext,
    question?: string,
  ): AsyncIterable<string> {
    const system = lectureSystemPrompt(ctx.outline)
    const cacheName = await this.ensureCache(ctx.courseId, model, ctx.material, system)

    const turn = lectureTurnPrompt(ctx, question)
    const contents = [
      cacheName ? '' : wrapMaterial(ctx.material),
      cacheName ? '' : system,
      ctx.history.length > 0 ? `# これまでの対話\n${formatHistory(ctx.history)}` : '',
      turn,
    ]
      .filter((x) => x.length > 0)
      .join('\n\n')

    const startedAt = Date.now()
    let last: GenerateContentResponse | null = null
    try {
      const iterator = await withRetry(purpose, () =>
        this.ai.models.generateContentStream({
          model,
          contents,
          config: {
            ...(cacheName ? { cachedContent: cacheName } : { systemInstruction: system }),
            // レイテンシが支配的な用途のため、思考は最小限に留める（§5.5）
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
      )
      for await (const chunk of iterator) {
        last = chunk
        const text = chunk.text
        if (text) yield text
      }
      this.report(purpose, model, startedAt, last)
    } catch (err) {
      this.report(purpose, model, startedAt, last, messageOf(err))
      throw err
    }
  }

  streamLecture(ctx: LectureContext): AsyncIterable<string> {
    return this.stream('lecture', this.models.lecture, ctx)
  }

  streamAnswer(ctx: LectureContext & { question: string }): AsyncIterable<string> {
    return this.stream('answer', this.models.answer, ctx, ctx.question)
  }

  // -------------------------------------------------------- ⑤ ステップ要約

  async summarizeStep(input: { step: OutlineStep; history: Turn[] }): Promise<string> {
    const model = this.models.summary
    const startedAt = Date.now()
    let response: GenerateContentResponse | null = null
    try {
      response = await withRetry('summary', () =>
        this.ai.models.generateContent({
          model,
          contents: [
            `# ステップ\n${input.step.orderIndex}. ${input.step.title}`,
            `学習目標：${input.step.objective}`,
            `# 対話ログ\n${formatHistory(input.history)}`,
          ].join('\n\n'),
          config: {
            systemInstruction: summarySystemPrompt(),
            // 思考トークンは課金上の出力に算入される。実測では200文字の要約に対して
            // 出力313トークンが計上されており、大半が思考だった。
            // §5.5 のとおり定型的な要約であり、思考を要する処理ではない
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          },
        }),
      )
      const text = response.text?.trim() ?? ''
      this.report('summary', model, startedAt, response)
      return text
    } catch (err) {
      this.report('summary', model, startedAt, response, messageOf(err))
      throw err
    }
  }
}

/** ログに残す用の短い理由。§8.4 はエラーの記録を必須としている */
function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

/**
 * §5.6「スキーマ違反時のリトライは §5.3 の検証と合わせて最大1回」。
 * 検証エラーのみ1度だけやり直す。通信エラーは withRetry 側で扱う。
 */
async function retryOnValidation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof AiValidationError)) throw err
    console.warn('ai_validation_retry', err.message)
    return run()
  }
}
