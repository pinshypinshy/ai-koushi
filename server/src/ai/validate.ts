import type { RawOutline, RawQuiz } from './schemas'
import type { OutlineResult, QuizResult } from './types'

/**
 * 構造化出力はスキーマ違反を構造的に排除するが、意味的な制約までは保証しない。
 * §5.3「検証」に挙げた項目をサーバー側で確認し、違反時は1度だけ再生成する。
 */
export class AiValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiValidationError'
  }
}

export function validateOutline(raw: RawOutline): OutlineResult {
  const steps = [...(raw.steps ?? [])].sort((a, b) => a.order_index - b.order_index)
  // §5.2 R-1：3〜10個
  if (steps.length < 3 || steps.length > 10) {
    throw new AiValidationError(`ステップ数が範囲外です（${steps.length}個）`)
  }
  // order_index は 1 始まりの連番であること。欠番があると設問の covered_steps と対応が取れない
  steps.forEach((s, i) => {
    if (s.order_index !== i + 1) {
      throw new AiValidationError(`order_index が連番ではありません（${s.order_index}）`)
    }
    if (!s.title?.trim() || !s.objective?.trim()) {
      throw new AiValidationError(`ステップ ${s.order_index} のタイトルまたは学習目標が空です`)
    }
  })
  const courseTitle = raw.course_title?.trim()
  if (!courseTitle) throw new AiValidationError('講義タイトルが空です')

  return {
    courseTitle,
    steps: steps.map((s) => ({
      orderIndex: s.order_index,
      title: s.title.trim(),
      objective: s.objective.trim(),
      keyPoints: (s.key_points ?? []).map((p) => p.trim()).filter((p) => p.length > 0),
      sourceRef: s.source_ref?.trim() ?? '',
    })),
  }
}

export function validateQuiz(raw: RawQuiz, stepCount: number): QuizResult {
  const questions = raw.questions ?? []
  // §5.3 R-1：10〜30問
  if (questions.length < 10 || questions.length > 30) {
    throw new AiValidationError(`設問数が範囲外です（${questions.length}問）`)
  }

  const covered = new Set<number>()
  questions.forEach((q, i) => {
    const at = `設問${i + 1}`
    if (q.choices?.length !== 4) {
      throw new AiValidationError(`${at}の選択肢が4つではありません（${q.choices?.length ?? 0}個）`)
    }
    if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index > 3) {
      throw new AiValidationError(`${at}の correct_index が不正です（${q.correct_index}）`)
    }
    const normalized = q.choices.map((c) => c.trim())
    if (new Set(normalized).size !== 4) {
      throw new AiValidationError(`${at}の選択肢に重複があります`)
    }
    if (normalized.some((c) => c.length === 0)) {
      throw new AiValidationError(`${at}に空の選択肢があります`)
    }
    if (!q.stem?.trim() || !q.explanation?.trim()) {
      throw new AiValidationError(`${at}の問題文または解説が空です`)
    }
    const steps = q.covered_steps ?? []
    if (steps.length === 0) {
      throw new AiValidationError(`${at}に関連ステップが指定されていません`)
    }
    for (const s of steps) {
      if (!Number.isInteger(s) || s < 1 || s > stepCount) {
        throw new AiValidationError(`${at}の covered_steps に無効な値があります（${s}）`)
      }
      covered.add(s)
    }
  })

  // いずれの設問からも参照されないステップが存在しないこと（§5.3 検証）
  const missing: number[] = []
  for (let i = 1; i <= stepCount; i++) if (!covered.has(i)) missing.push(i)
  if (missing.length > 0) {
    throw new AiValidationError(`設問が存在しないステップがあります（${missing.join(', ')}）`)
  }

  return {
    questions: questions.map((q) => ({
      stem: q.stem.trim(),
      choices: q.choices.map((c) => c.trim()),
      correctIndex: q.correct_index,
      explanation: q.explanation.trim(),
      coveredSteps: [...new Set(q.covered_steps)].sort((a, b) => a - b),
    })),
  }
}
