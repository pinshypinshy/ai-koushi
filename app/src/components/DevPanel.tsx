import { useState } from 'react'
import { useStore, type DevScenario } from '../store'

/**
 * 開発用の画面切替パネル。要件定義書 §3.1 の画面IDに対応する。
 * 通常の操作では到達しにくい例外画面を直接確認するためのもので、製品には含めない。
 */
const SCENARIOS: { id: string; label: string; name: DevScenario }[] = [
  { id: 'SC-01', label: 'ログイン', name: 'login' },
  { id: 'SC-02', label: '空状態（講義0件）', name: 'empty' },
  { id: 'SC-03', label: 'アップロード（サンプル投入）', name: 'uploadSample' },
  { id: 'SC-04', label: '作成確認ダイアログ', name: 'confirmCreate' },
  { id: 'SC-05', label: '生成中', name: 'generating' },
  { id: 'SC-06', label: '生成失敗', name: 'failed' },
  { id: 'SC-07', label: '講義タブ（ステップ末尾）', name: 'lectureStepEnd' },
  { id: 'SC-08', label: '確認テスト／開始画面', name: 'quizStart' },
  { id: 'SC-09', label: '確認テスト／出題中', name: 'quizQuestion' },
  { id: 'SC-10', label: '確認テスト／正誤と解説', name: 'quizRevealed' },
  { id: 'SC-11', label: '確認テスト／結果集計', name: 'quizResult' },
  { id: 'SC-12', label: '復習モード／対象なし', name: 'reviewEmpty' },
  { id: 'SC-13', label: '講義メニュー', name: 'courseMenu' },
  { id: 'SC-14', label: '削除確認ダイアログ', name: 'deleteDialog' },
  { id: 'SC-15', label: 'ユーザーメニュー', name: 'userMenu' },
]

export function DevPanel() {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed right-3 bottom-36 z-[60] md:bottom-3 print:hidden">
      {open && (
        <div className="mb-2 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] font-bold tracking-wide text-slate-400">画面切替（開発用）</span>
            <button
              onClick={() => dispatch({ type: 'devScenario', name: 'reset' })}
              className="rounded px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-slate-800"
            >
              リセット
            </button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => dispatch({ type: 'devScenario', name: s.name })}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">{s.id}</span>
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-2 py-2 text-[10px] leading-relaxed text-slate-500">
            モバイル版はブラウザの幅を 767px 以下にすると確認できます。
          </p>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="ml-auto flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-3.5 text-xs font-medium text-white shadow-lg transition hover:bg-slate-700"
      >
        {open ? '閉じる' : '画面一覧'}
      </button>
    </div>
  )
}
