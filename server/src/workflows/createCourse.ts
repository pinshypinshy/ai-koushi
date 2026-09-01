import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import type { Env } from '../env'
import { collectUsage, createAiClient, flushUsage } from '../ai/factory'
import {
  getMaterialText,
  getOutlineSteps,
  markCourseFailed,
  markQuizFailed,
  saveOutline,
  saveQuiz,
} from '../db/queries'

/**
 * 講義作成ジョブ（§7.4）。①骨子生成 → ②確認テスト生成の2段階で構成する。
 *
 * Workflows を使う理由は、ステップ単位で結果が永続化され、失敗したステップだけを
 * やり直せる点にある。②が失敗しても①をやり直さないという §4.1.6 の要求が、
 * 自前の状態管理なしにそのまま実現できる。
 */
export interface CreateCourseParams {
  courseId: string
  userId: string
  /** 'full'＝①から。'quiz'＝②のみ（§4.1.6「確認テスト生成失敗」からの再生成） */
  mode: 'full' | 'quiz'
  /** ユーザーがタイトルを未入力なら、①の命名で上書きする（§5.2） */
  applyGeneratedTitle: boolean
}

/**
 * AI を呼ぶステップの再試行設定。
 *
 * 1回に絞るのは、AI 呼び出し層が既に §5.7 のリトライ（429・5xx を最大3回、
 * スキーマ違反を1回）を済ませており、ここでの再試行はその上に積み上がるため。
 * 失敗のたびに課金が発生する以上、基盤側の障害を1度だけ救済する水準に留める（§8.2.4）。
 */
const AI_STEP: WorkflowStepConfig = {
  retries: { limit: 1, delay: '30 seconds', backoff: 'exponential' },
  // ①②の実測は合計164秒、再生成が発火した場合で294秒（§7.4）。その数倍を上限に置く
  timeout: '15 minutes',
}

/** DB を更新するだけのステップ。課金が絡まないため通常どおり再試行してよい */
const DB_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '1 minute',
}

export class CreateCourseWorkflow extends WorkflowEntrypoint<Env, CreateCourseParams> {
  async run(event: WorkflowEvent<CreateCourseParams>, step: WorkflowStep): Promise<void> {
    const { courseId, userId, mode, applyGeneratedTitle } = event.payload

    // ------------------------------------------------------------ ① 骨子生成
    if (mode === 'full') {
      try {
        await step.do('骨子生成', AI_STEP, async () => {
          const material = await getMaterialText(this.env.DB, courseId)
          if (!material) throw new Error('教材が見つかりません')

          const { sink, records } = collectUsage()
          const client = createAiClient(this.env, sink)
          try {
            // タイトルを AI に決めさせる場合はヒントを渡さない（§5.2）
            const outline = await client.generateOutline({
              material,
              titleHint: applyGeneratedTitle ? undefined : await currentTitle(this.env, courseId),
            })
            await saveOutline(this.env.DB, courseId, outline, applyGeneratedTitle)
          } finally {
            // 生成の成否に関わらず計上する（§8.2.4）
            await flushUsage(this.env, userId, courseId, records)
          }
        })
      } catch (err) {
        // 骨子が無い講義は成立しないため、講義ごと失敗にする（§4.1.6）
        await step.do('骨子失敗の記録', DB_STEP, async () => {
          await markCourseFailed(this.env.DB, courseId, messageOf(err))
        })
        return
      }
    }

    // ------------------------------------------------------ ② 確認テスト生成
    try {
      await step.do('確認テスト生成', AI_STEP, async () => {
        const material = await getMaterialText(this.env.DB, courseId)
        if (!material) throw new Error('教材が見つかりません')
        const outline = await getOutlineSteps(this.env.DB, courseId)
        if (outline.length === 0) throw new Error('骨子が保存されていません')

        const { sink, records } = collectUsage()
        const client = createAiClient(this.env, sink)
        try {
          const quiz = await client.generateQuiz({ material, outline, courseId })
          // ここで status=ready まで進む。①の結果より後にしか実行されないため、
          // 「テストはあるが講義が無い」状態は構造上作られない
          await saveQuiz(this.env.DB, courseId, quiz)
        } finally {
          await flushUsage(this.env, userId, courseId, records)
        }
      })
    } catch (err) {
      // 骨子は保存済みで講義は利用可能。テストの状態だけを失敗にする（§4.1.6）
      console.error('quiz_generation_failed', courseId, messageOf(err))
      await step.do('確認テスト失敗の記録', DB_STEP, async () => {
        await markQuizFailed(this.env.DB, courseId)
      })
    }
  }
}

/** ユーザーが入力したタイトル。命名の手がかりとして①へ渡す（§5.2） */
async function currentTitle(env: Env, courseId: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT title FROM courses WHERE id = ?1')
    .bind(courseId)
    .first<{ title: string }>()
  return row?.title || undefined
}

/** §8.4 のログ要件と揃える。長大なスタックはそのまま載せない */
function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}
