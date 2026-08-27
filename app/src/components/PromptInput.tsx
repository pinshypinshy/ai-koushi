import { useState } from 'react'
import { useStore } from '../store'
import { IconSend } from './Icons'

/** E-1（§3.4）。講義タブでのみ表示する。 */
export function PromptInput({ disabled }: { disabled?: boolean }) {
  const { dispatch } = useStore()
  const [text, setText] = useState('')

  const send = () => {
    const t = text.trim()
    if (!t || disabled) return
    dispatch({ type: 'sendMessage', text: t })
    setText('')
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:pb-5">
      <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? '講義が完了しました' : 'プロンプトを入力'}
          className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        <button
          onClick={send}
          disabled={disabled || !text.trim()}
          aria-label="送信"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition disabled:bg-slate-200 disabled:text-slate-400"
        >
          <IconSend className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
