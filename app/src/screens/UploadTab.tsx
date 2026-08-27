import { useState } from 'react'
import { MAX_CHARS, MIN_CHARS, useStore } from '../store'
import { Markdown } from '../components/Markdown'
import { useIsMobile } from '../hooks/useMediaQuery'

/** SC-03 アップロードタブ（§4.1） */
export function UploadTab() {
  const { state, dispatch } = useStore()
  const isMobile = useIsMobile()
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit')

  const count = state.draftMarkdown.length
  const tooShort = count < MIN_CHARS
  const tooLong = count > MAX_CHARS
  const canSubmit = !tooShort && !tooLong

  const editor = (
    <textarea
      value={state.draftMarkdown}
      onChange={(e) => dispatch({ type: 'setDraft', markdown: e.target.value })}
      placeholder="ここに参考書の内容を Markdown で貼り付けてください"
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
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-3 px-4 pb-4">
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
            <span className="mb-1.5 text-xs font-medium text-slate-500">Markdown を貼り付け</span>
            <div className="min-h-0 flex-1">{editor}</div>
          </div>
          <div className="flex min-h-0 flex-col">
            <span className="mb-1.5 text-xs font-medium text-slate-500">プレビュー</span>
            <div className="min-h-0 flex-1">{preview}</div>
          </div>
        </div>
      )}

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
          className="ml-auto rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          完了
        </button>
      </div>
    </div>
  )
}
