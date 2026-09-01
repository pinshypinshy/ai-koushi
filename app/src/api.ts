import type {
  ApiError,
  BootstrapResponse,
  CourseDetail,
  CourseSummary,
  CreateCourseResponse,
  MaterialResponse,
} from '../../shared/api'
import type { Course } from './types'

/**
 * サーバーとの通信をここに集約する。画面からは fetch を直接呼ばない。
 * 型は shared/api.ts をそのまま使う（API の契約はあちらが唯一の正）。
 */

export class ApiFailure extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    // エラー応答は ApiError の形で返る。JSON でない場合（プロキシの502など）も落とさない
    const body = await res
      .json()
      .then((v) => v as Partial<ApiError>)
      .catch(() => ({}) as Partial<ApiError>)
    throw new ApiFailure(res.status, body.error ?? 'unknown', body.message ?? '通信に失敗しました')
  }
  return (await res.json()) as T
}

/**
 * ログインの入口。`code` を持たない `/auth/callback` は Google へ転送される
 * （server/src/auth/routes.ts の googleAuth が往路と復路を兼ねているため）。
 */
export const LOGIN_URL = '/auth/callback'

export const api = {
  bootstrap: (courseId?: string) =>
    request<BootstrapResponse>(
      courseId ? `/api/bootstrap?courseId=${encodeURIComponent(courseId)}` : '/api/bootstrap',
    ),
  course: (id: string) => request<CourseDetail>(`/api/courses/${encodeURIComponent(id)}`),
  material: (id: string) =>
    request<MaterialResponse>(`/api/courses/${encodeURIComponent(id)}/material`),
  createCourse: (title: string | null, material: string) =>
    request<CreateCourseResponse>('/api/courses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, material }),
    }),
  retryCourse: (id: string) =>
    request<CreateCourseResponse>(`/api/courses/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    }),
  logout: () => request<unknown>('/auth/logout', { method: 'POST' }),
}

/**
 * サーバーの表現を画面の表現へ変換する。
 *
 * 講義タブと確認テストタブはまだモックで動いているため（段階3で置き換える）、
 * 画面側の Course には台本や設問といったモック専用の項目が残っている。
 * 実データの講義ではそれらを空にする。
 */
export function courseFromDetail(detail: CourseDetail): Course {
  return {
    ...courseFromSummary(detail),
    currentStepId: detail.currentStepId,
    steps: detail.steps,
    messages: detail.messages,
    detailLoaded: true,
  }
}

/** 一覧の1行ぶん。ステップや対話は含まれないため、選択された時点で改めて取得する */
export function courseFromSummary(summary: CourseSummary): Course {
  return {
    id: summary.id,
    title: summary.title,
    status: summary.status,
    quizStatus: summary.quizStatus,
    phase: summary.phase,
    errorMessage: summary.errorMessage,
    totalSteps: summary.totalSteps,
    completedSteps: summary.completedSteps,
    updatedAt: summary.updatedAt,
    currentStepId: null,
    steps: [],
    messages: [],
    questions: [],
    sourceMarkdown: '',
    scriptCursor: 0,
    detailLoaded: false,
  }
}
