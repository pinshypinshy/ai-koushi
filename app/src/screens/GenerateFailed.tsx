import { useStore } from '../store'
import type { Course } from '../types'
import { IconWarn } from '../components/Icons'

/** SC-06 生成失敗（§4.1.6、§5.7） */
export function GenerateFailed({ course }: { course: Course }) {
  const { dispatch } = useStore()
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <IconWarn className="h-8 w-8 text-amber-500" />
      <p className="mt-4 text-base font-semibold text-slate-800">講義の作成に失敗しました</p>
      <p className="mt-2 text-sm text-slate-500">
        教材の解析中にエラーが発生しました。
        {course.errorMessage && (
          <>
            <br />
            <span className="text-slate-400">（{course.errorMessage}）</span>
          </>
        )}
      </p>
      <div className="mt-8 flex gap-3">
        <button
          onClick={() => dispatch({ type: 'retryGeneration', courseId: course.id })}
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          再試行する
        </button>
        <button
          onClick={() => dispatch({ type: 'openModal', modal: { type: 'deleteCourse', courseId: course.id } })}
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          講義を削除
        </button>
      </div>
    </div>
  )
}
