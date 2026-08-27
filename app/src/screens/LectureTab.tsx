import { useEffect, useRef, useState } from 'react'
import { MOCK_USER } from '../store'
import { useStore } from '../store'
import type { Course, Message } from '../types'
import { Markdown } from '../components/Markdown'
import { IconUser } from '../components/Icons'

/**
 * ストリーミング表示の模擬（§8.1）。実装時は SSE の逐次受信に置き換わる。
 * 受信中だけこのコンポーネントを描画し、完了したら呼び出し側が通常描画へ戻す。
 */
function StreamedMarkdown({ text, onDone }: { text: string; onDone: () => void }) {
  const [len, setLen] = useState(0)
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      i = Math.min(i + 3, text.length)
      setLen(i)
      if (i >= text.length) {
        clearInterval(id)
        onDoneRef.current()
      }
    }, 16)
    return () => clearInterval(id)
  }, [text])

  return (
    <>
      <Markdown>{text.slice(0, len)}</Markdown>
      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-slate-400 align-text-bottom" />
    </>
  )
}

function Bubble({
  message,
  streaming,
  onDone,
}: {
  message: Message
  streaming: boolean
  onDone: () => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white">
          {message.content}
        </div>
        <IconUser className="mt-1 h-6 w-6 shrink-0 text-slate-400" />
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
        AI
      </span>
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        {streaming ? (
          <StreamedMarkdown text={message.content} onDone={onDone} />
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
      </div>
    </div>
  )
}

/** SC-07 講義タブ（§4.2） */
export function LectureTab({ course }: { course: Course }) {
  const { state, dispatch } = useStore()
  const endRef = useRef<HTMLDivElement>(null)

  const step = course.steps.find((s) => s.id === course.currentStepId) ?? null
  const scriptFinished = step ? course.scriptCursor >= step.script.length : false
  const allDone = course.currentStepId === null
  const isLast = step ? step.orderIndex === course.steps.length : false

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [course.messages.length, state.streamingMessageId])

  // ステップ境界の区切り位置をレンダリング前に決める（描画中に値を書き換えない）
  const dividerIds = new Set<string>()
  course.messages.reduce<string | null>((prev, m) => {
    if (m.stepId !== prev) dividerIds.add(m.id)
    return m.stepId
  }, null)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4">
      {course.messages.map((m) => {
        const s = course.steps.find((x) => x.id === m.stepId)
        return (
          <div key={m.id} className="space-y-5">
            {dividerIds.has(m.id) && s && (
              <div className="flex items-center gap-3 pt-2">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="shrink-0 text-[11px] font-medium tracking-wide text-slate-400">
                  ステップ {s.orderIndex}・{s.title}
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            <Bubble
              message={m}
              streaming={state.streamingMessageId === m.id}
              onDone={() => dispatch({ type: 'endStreaming' })}
            />
          </div>
        )
      })}

      {scriptFinished && !state.streamingMessageId && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => dispatch({ type: 'advanceStep' })}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {isLast ? '講義を終える' : '次のステップへ進む'}
          </button>
        </div>
      )}

      {allDone && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center">
          <p className="text-sm font-semibold text-emerald-800">全ステップが完了しました</p>
          <p className="mt-1 text-xs text-emerald-700">確認テストで理解度を測ってみてください</p>
          <button
            onClick={() => dispatch({ type: 'setTab', tab: 'quiz' })}
            className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-600"
          >
            確認テストへ
          </button>
        </div>
      )}

      <p className="pt-1 text-center text-[11px] text-slate-400">
        {MOCK_USER.name} さんの学習ログはこの端末に保持されません（UIモック）
      </p>
      <div ref={endRef} />
    </div>
  )
}
