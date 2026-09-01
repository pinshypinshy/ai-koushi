import { useStore } from '../store'
import { IconUpload } from '../components/Icons'

/** SC-02 空状態（講義0件）。全タブ共通で表示する（§4.2.5）。 */
export function EmptyState() {
  const { dispatch } = useStore()
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="text-base font-semibold text-slate-700">まだ講義がありません</p>
      <p className="mt-2 text-sm text-slate-500">教材をアップロードすると講義が作成されます</p>
      <button
        onClick={() => dispatch({ type: 'openCreate' })}
        className="mt-8 flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        <IconUpload className="h-4 w-4" />
        教材をアップロード
      </button>
      {/* 講義が0件の時点が最も迷いやすい。ここにもガイドを置く（§4.8） */}
      <button
        onClick={() => dispatch({ type: 'setHelp', open: true })}
        className="mt-4 text-sm text-slate-500 underline underline-offset-4 transition hover:text-slate-800"
      >
        使い方を見る
      </button>
    </div>
  )
}
