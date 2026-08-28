import { Type } from '@google/genai'
import type { Schema } from '@google/genai'

/**
 * §5.6「構造化出力」。①②はJSONスキーマを指定し、パース失敗を構造的に排除する。
 * ここで定義するのは §5.2 / §5.3 の出力スキーマそのものである。
 */

export const OUTLINE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    course_title: { type: Type.STRING, description: '30文字以内' },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          order_index: { type: Type.INTEGER, description: '1始まりの通し番号' },
          title: { type: Type.STRING, description: '30文字以内' },
          objective: { type: Type.STRING, description: '学習目標。1文' },
          key_points: { type: Type.ARRAY, items: { type: Type.STRING } },
          source_ref: { type: Type.STRING, description: '見出しパスまたは行範囲' },
        },
        required: ['order_index', 'title', 'objective', 'key_points', 'source_ref'],
        propertyOrdering: ['order_index', 'title', 'objective', 'key_points', 'source_ref'],
      },
    },
  },
  required: ['course_title', 'steps'],
  propertyOrdering: ['course_title', 'steps'],
}

export const QUIZ_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stem: { type: Type.STRING },
          choices: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            minItems: '4',
            maxItems: '4',
          },
          correct_index: { type: Type.INTEGER, description: '0〜3' },
          explanation: { type: Type.STRING },
          covered_steps: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: '関連するステップの order_index。複数なら横断設問',
          },
        },
        required: ['stem', 'choices', 'correct_index', 'explanation', 'covered_steps'],
        propertyOrdering: ['stem', 'choices', 'correct_index', 'explanation', 'covered_steps'],
      },
    },
  },
  required: ['questions'],
}

/** 構造化出力の生の形。検証を通してから内部表現へ変換する */
export interface RawOutline {
  course_title: string
  steps: {
    order_index: number
    title: string
    objective: string
    key_points: string[]
    source_ref: string
  }[]
}

export interface RawQuiz {
  questions: {
    stem: string
    choices: string[]
    correct_index: number
    explanation: string
    covered_steps: number[]
  }[]
}
