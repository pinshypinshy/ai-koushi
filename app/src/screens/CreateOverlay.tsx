import { useEffect, useState } from 'react'
import { MAX_CHARS, MIN_CHARS, useStore } from '../store'
import { Markdown } from '../components/Markdown'
import { IconHelp, IconX } from '../components/Icons'
import { useIsMobile } from '../hooks/useMediaQuery'

/** SC-03 講義作成オーバーレイ（§4.1）。タブではなく A-2 から開く一時的な画面。 */
export function CreateOverlay() {
  const { state, dispatch } = useStore()
  const isMobile = useIsMobile()
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit')

  const count = state.draftMarkdown.length
  const tooShort = count < MIN_CHARS
  const tooLong = count > MAX_CHARS
  const canSubmit = !tooShort && !tooLong

  // Esc で閉じる。入力内容は保持する（§4.1.5）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !state.modal && !state.helpOpen) dispatch({ type: 'closeCreate' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, state.modal, state.helpOpen])

  const editor = (
    <textarea
      value={state.draftMarkdown}
      onChange={(e) => dispatch({ type: 'setDraft', markdown: e.target.value })}
      placeholder="教科書や授業スライドの本文を、ここに貼り付けてください"
      spellCheck={false}
      className="h-full w-full resize-none rounded-xl border border-slate-200 bg-white p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
    />
  )

  const preview = (
    <div className="h-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
      {state.draftMarkdown.trim() ? (
        <Markdown>{state.draftMarkdown}</Markdown>
      ) : (
        <p className="text-sm text-slate-400">入力した内容がここに表示されます</p>
      )}
    </div>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-heading"
      className="absolute inset-0 z-40 flex flex-col bg-slate-100"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h2 id="create-heading" className="text-sm font-bold text-slate-900">
          新しい講義
        </h2>
        <button
          onClick={() => dispatch({ type: 'closeCreate' })}
          aria-label="閉じる"
          className="ml-auto rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <IconX className="h-5 w-5" />
        </button>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 px-4 py-4">
        <div>
          <label htmlFor="course-title" className="mb-1.5 block text-xs font-medium text-slate-500">
            講義タイトル（任意）
          </label>
          <input
            id="course-title"
            value={state.draftTitle}
            onChange={(e) => dispatch({ type: 'setDraft', title: e.target.value })}
            placeholder="未入力の場合は教材の内容から自動で命名されます"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>

        {/* 使い方ガイド（§4.8）への導線。貼り付ける直前に読む位置へ置く（§4.1.1） */}
        <div>
          <button
            onClick={() => dispatch({ type: 'setHelp', open: true })}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            <IconHelp className="h-4 w-4" />
            使い方を見る
          </button>
        </div>

        {isMobile ? (
          <>
            <div className="inline-flex self-start rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
              {(['edit', 'preview'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setMobilePane(k)}
                  className={`rounded-md px-3 py-1.5 transition ${
                    mobilePane === k ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  {k === 'edit' ? '入力' : 'プレビュー'}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">{mobilePane === 'edit' ? editor : preview}</div>
          </>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            <div className="flex min-h-0 flex-col">
              <span className="mb-1.5 text-xs font-medium text-slate-500">教材を貼り付け</span>
              <div className="min-h-0 flex-1">{editor}</div>
            </div>
            <div className="flex min-h-0 flex-col">
              <span className="mb-1.5 text-xs font-medium text-slate-500">プレビュー</span>
              <div className="min-h-0 flex-1">{preview}</div>
            </div>
          </div>
        )}

        <p className="shrink-0 text-xs text-slate-500">Markdown 記法に対応しています。</p>

        <div className="flex shrink-0 items-center gap-4">
          <p className={`text-xs tabular-nums ${tooLong ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
            {count.toLocaleString()} / {MAX_CHARS.toLocaleString()} 文字
            {tooShort && count > 0 && (
              <span className="ml-2 text-slate-400">（あと {MIN_CHARS - count} 文字必要です）</span>
            )}
            {tooLong && <span className="ml-2">（{(count - MAX_CHARS).toLocaleString()} 文字超過）</span>}
          </p>
          <button
            disabled={!canSubmit}
            onClick={() =>
              dispatch({
                type: 'openModal',
                modal: {
                  type: 'confirmCreate',
                  title: state.draftTitle.trim() || '無題の講義',
                  charCount: count,
                },
              })
            }
            className="ml-auto shrink-0 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-medium whitespace-nowrap text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  )
}
