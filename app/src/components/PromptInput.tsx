import { useState } from 'react'
import { useLectureTurn } from '../hooks/useLectureTurn'
import { isDemo } from '../demo'
import type { Course } from '../types'
import { IconSend } from './Icons'

/** E-1（§3.4）。講義タブでのみ表示する。 */
export function PromptInput({ course }: { course: Course }) {
  const { running, send } = useLectureTurn(course)
  const [text, setText] = useState('')
  // サンプルでは AI を呼ばないため、質問は受け付けない
  const demo = isDemo()
  const disabled = course.currentStepId === null || running || demo

  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    setText('')
    void send(t)
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
              submit()
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={
            demo
              ? 'サンプルでは質問できません'
              : course.currentStepId === null
                ? '講義が完了しました'
                : running
                  ? 'AIが応答しています…'
                  : 'プロンプトを入力'
          }
          className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        <button
          onClick={submit}
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
