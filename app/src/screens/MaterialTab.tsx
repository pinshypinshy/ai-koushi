import type { Course } from '../types'
import { Markdown } from '../components/Markdown'

/**
 * SC-16 教材タブ（§4.4）。選択中の講義に紐づく教材原文を読み取り専用で表示する。
 * 編集・差し替えは行わない（§4.1.7）。生成中・失敗中でも教材自体は保存済みのため表示する。
 */
export function MaterialTab({ course }: { course: Course }) {
  const count = course.sourceMarkdown.length

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-3 px-4 pb-4">
      <div className="flex shrink-0 items-baseline gap-3">
        <h2 className="truncate text-sm font-semibold text-slate-700">{course.title}</h2>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {count.toLocaleString()} 文字
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
          読み取り専用
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
        {course.sourceMarkdown.trim() ? (
          <Markdown>{course.sourceMarkdown}</Markdown>
        ) : (
          <p className="text-sm text-slate-400">教材が登録されていません</p>
        )}
      </div>
    </div>
  )
}
