import type {
  AdminAccessResponse,
  AdminAllowlistResponse,
  AdminConfig,
  AdminGuestsResponse,
  AdminSummary,
  AdminUserDetail,
  AdminUsageResponse,
  AdminUsersResponse,
  ApiError,
  ApiMessage,
  AttemptResult,
  BootstrapResponse,
  CourseDetail,
  CourseSummary,
  CreateCourseResponse,
  DuplicateCourseResponse,
  LectureStreamLine,
  MaterialResponse,
  QuizResponse,
  SendMessageRequest,
  UsageSummary,
} from '../../shared/api'
import type { Course } from './types'
import {
  demoAttempt,
  demoBootstrap,
  demoCompleteStep,
  demoCourse,
  demoMaterial,
  demoQuiz,
  demoStreamTurn,
  demoUsage,
  isDemo,
} from './demo'

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

/**
 * サンプル（「画面を見る」）はここで振り分ける。
 * 画面側にサンプル用の分岐を作らないため、入口を1箇所に閉じている。
 */
export const api = {
  bootstrap: (courseId?: string) =>
    isDemo()
      ? Promise.resolve(demoBootstrap())
      : request<BootstrapResponse>(
          courseId ? `/api/bootstrap?courseId=${encodeURIComponent(courseId)}` : '/api/bootstrap',
        ),
  /**
   * 今月の利用状況（§8.2.3）。起動時は bootstrap に同梱されるため、
   * ここを叩くのは AI を消費した後に取り直すときだけ。
   */
  usage: () => (isDemo() ? Promise.resolve(demoUsage()) : request<UsageSummary>('/api/usage')),
  course: (id: string) =>
    isDemo()
      ? Promise.resolve(demoCourse())
      : request<CourseDetail>(`/api/courses/${encodeURIComponent(id)}`),
  material: (id: string) =>
    isDemo()
      ? Promise.resolve(demoMaterial())
      : request<MaterialResponse>(`/api/courses/${encodeURIComponent(id)}/material`),
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
  /**
   * 講義の複製（§4.5）。AI を呼ばないため生成待ちが無く、複製後の講義がそのまま返る。
   * 利用状況（A-5）は変わらないので取り直さない。
   */
  duplicateCourse: (id: string) =>
    request<DuplicateCourseResponse>(`/api/courses/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    }),
  logout: () => request<unknown>('/auth/logout', { method: 'POST' }),

  /**
   * ゲストサインイン（Q-26）。運営が発行した ID とパスワードで入る。
   * 成功時は本文を持たない（セッションは Cookie で渡される）。
   */
  guestLogin: async (loginId: string, password: string) => {
    const res = await fetch('/auth/guest', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginId, password }),
    })
    if (!res.ok) {
      const body = await res
        .json()
        .then((v) => v as Partial<ApiError>)
        .catch(() => ({}) as Partial<ApiError>)
      throw new ApiFailure(res.status, body.error ?? 'unknown', body.message ?? 'サインインできませんでした')
    }
  },

  /** 確認テストの出題（§4.3.1）。正解と解説は含まれない */
  quiz: (courseId: string) =>
    isDemo()
      ? Promise.resolve(demoQuiz())
      : request<QuizResponse>(`/api/courses/${encodeURIComponent(courseId)}/quiz`),
  /** 解答の判定（§4.3.2）。正誤・正解・解説はここで初めて渡される */
  attempt: (questionId: string, selectedChoiceId: string) =>
    isDemo()
      ? Promise.resolve(demoAttempt(questionId, selectedChoiceId))
      : request<AttemptResult>(`/api/questions/${encodeURIComponent(questionId)}/attempts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedChoiceId }),
        }),
  /** ステップ完了（§4.2.2）。⑤の要約を作り、現在地を次へ移した講義が返る */
  completeStep: (courseId: string, stepId: string) =>
    isDemo()
      ? Promise.resolve(demoCompleteStep(stepId))
      : request<CourseDetail>(
      `/api/courses/${encodeURIComponent(courseId)}/steps/${encodeURIComponent(stepId)}/complete`,
          { method: 'POST' },
        ),
  renameCourse: (courseId: string, title: string) =>
    request<{ courseId: string; title: string }>(`/api/courses/${encodeURIComponent(courseId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  deleteCourse: async (courseId: string) => {
    // 204 を返すため JSON の解釈を行わない
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    if (!res.ok) throw new ApiFailure(res.status, 'delete_failed', '講義を削除できませんでした')
  },
}

/**
 * ③講義本文・④質問応答の受信（§8.1）。
 *
 * 応答は NDJSON で届く。文字の断片は onDelta へ渡し、保存された発言を返り値にする。
 * サーバーが error 行を返した場合は例外にする。部分生成分は保存済みであるため（§5.7）、
 * 呼び出し側は講義を取り直せば途中までの発話を表示できる。
 */
export async function streamTurn(
  path: string,
  body: SendMessageRequest | null,
  onDelta: (text: string) => void,
): Promise<ApiMessage> {
  if (isDemo()) return demoStreamTurn(body?.text ?? null, onDelta)

  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  if (!res.ok || !res.body) {
    const error = await res
      .json()
      .then((v) => v as Partial<ApiError>)
      .catch(() => ({}) as Partial<ApiError>)
    throw new ApiFailure(res.status, error.error ?? 'unknown', error.message ?? '応答を取得できませんでした')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let saved: ApiMessage | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // 最後の要素は行の途中である可能性があるため次の受信へ持ち越す
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      if (!raw.trim()) continue
      const line = JSON.parse(raw) as LectureStreamLine
      if ('delta' in line) onDelta(line.delta)
      else if ('done' in line) saved = line.done
      else if ('error' in line) throw new ApiFailure(500, 'stream_failed', line.error.message)
    }
  }

  if (!saved) throw new ApiFailure(500, 'stream_incomplete', '応答が途中で終わりました')
  return saved
}

/** サーバーの表現を画面の表現へ変換する */
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
    detailLoaded: false,
  }
}

/**
 * 運営管理ページ（§4.7）。段階1は読み取りのみ。
 *
 * サンプル表示（isDemo）の分岐は通さない。サンプルはログイン前に中身を見せるための
 * ものであり、管理ページには対応する偽データを置く意味が無いため。
 * 認可はサーバー側の requireAdmin が担う。ここで隠しても防御にはならない。
 */
export const adminApi = {
  summary: () => request<AdminSummary>('/api/admin/summary'),
  users: () => request<AdminUsersResponse>('/api/admin/users'),
  user: (id: string) => request<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`),
  usage: (params: { purpose?: string; errorsOnly?: boolean; limit?: number }) =>
    request<AdminUsageResponse>(`/api/admin/usage${adminQuery(params)}`),
  access: (params: { result?: string; failuresOnly?: boolean; limit?: number }) =>
    request<AdminAccessResponse>(`/api/admin/access${adminQuery(params)}`),
  allowlist: () => request<AdminAllowlistResponse>('/api/admin/allowlist'),
  guests: () => request<AdminGuestsResponse>('/api/admin/guests'),
  config: () => request<AdminConfig>('/api/admin/config'),
}

/** 未指定の絞り込みはクエリに載せない。サーバー側の既定と食い違わないようにする */
function adminQuery(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === '') continue
    query.set(key, value === true ? '1' : String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}
