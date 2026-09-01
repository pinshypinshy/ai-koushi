import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Markdown } from '../components/Markdown'
import { IconCheck, IconCopy, IconX } from '../components/Icons'
import { HELP_GREETING, HELP_TOPICS, type HelpBlock, type HelpTopic } from '../help/topics'

/**
 * SC-17 使い方ガイド（§4.8）。
 *
 * 段階1は定型回答のみで、自由入力も AI 呼び出しも持たない（Q-29）。
 * チャット形式にしているのは、段階2で自由入力を足す際に入力欄を1つ増やすだけで
 * 済ませるためであり、機能としては現時点で FAQ と等価である。
 *
 * やりとりは保存しない（§4.8）。開き直せば初期状態に戻る。
 */
export function HelpGuide() {
  const { dispatch } = useStore()
  const [asked, setAsked] = useState<HelpTopic[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'setHelp', open: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  // 回答は縦に長い。追加したら末尾へ送り、質問した直後に答えが視界へ入るようにする
  useEffect(() => {
    if (asked.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [asked.length])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-heading"
      className="absolute inset-0 z-50 flex flex-col bg-slate-100"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h2 id="help-heading" className="text-sm font-bold text-slate-900">
          使い方
        </h2>
        <button
          onClick={() => dispatch({ type: 'setHelp', open: false })}
          aria-label="閉じる"
          className="ml-auto rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <IconX className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
          <AssistantBubble>
            <p className="text-sm leading-relaxed text-slate-700">{HELP_GREETING}</p>
          </AssistantBubble>

          {asked.map((topic, i) => (
            <div key={`${topic.id}-${i}`} className="flex flex-col gap-4">
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm leading-relaxed text-white">
                  {topic.question}
                </div>
              </div>
              <AssistantBubble>
                <div className="flex flex-col gap-3">
                  {topic.answer.map((block, j) => (
                    <Block key={j} block={block} />
                  ))}
                </div>
              </AssistantBubble>
            </div>
          ))}

          <Chips onPick={(t) => setAsked((prev) => [...prev, t])} askedIds={asked.map((t) => t.id)} />
          <div ref={endRef} />
        </div>
      </div>
    </div>
  )
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
        AI
      </span>
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        {children}
      </div>
    </div>
  )
}

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === 'text') return <Markdown>{block.body}</Markdown>
  return <PromptBlock body={block.body} />
}

/**
 * 外部の生成AIへ送るプロンプト（§4.8.2）。
 * コードブロックとして置くだけにすると、範囲選択という新たなつまずきを作る。
 * ボタン一つでコピーできる形にすることが、この回答の要点である。
 */
function PromptBlock({ body }: { body: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'selected'>('idle')
  const preRef = useRef<HTMLPreElement>(null)

  /**
   * クリップボードへの書き込みは、ブラウザの設定や埋め込み環境で拒否されうる。
   * その場合に黙って何も起きないと、この回答の唯一の目的が果たせないため、
   * 代わりに本文を選択状態にして、手でコピーできるところまで進めておく。
   */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body)
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      const pre = preRef.current
      const sel = window.getSelection()
      if (!pre || !sel) return
      const range = document.createRange()
      range.selectNodeContents(pre)
      sel.removeAllRanges()
      sel.addRange(range)
      setStatus('selected')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <span className="text-xs font-medium text-slate-500">生成AI に送る文章</span>
        <button
          onClick={copy}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
        >
          {status === 'copied' ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
          )}
          {status === 'copied' ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <pre
        ref={preRef}
        className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-slate-700"
      >
        {body}
      </pre>
      {status === 'selected' && (
        <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          このブラウザでは自動でコピーできませんでした。文章を選択したので、そのまま
          <kbd className="mx-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[11px]">
            Ctrl
          </kbd>
          または
          <kbd className="mx-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[11px]">
            ⌘
          </kbd>
          ＋
          <kbd className="mx-1 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[11px]">
            C
          </kbd>
          でコピーしてください。
        </p>
      )}
    </div>
  )
}

/**
 * 質問の候補。一度聞いたものも消さずに残す。回答を読んだあとで
 * 別の質問へ移るとき、選択肢の位置が変わると探し直しになるため。
 */
function Chips({ onPick, askedIds }: { onPick: (t: HelpTopic) => void; askedIds: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 pl-[34px]">
      {HELP_TOPICS.map((t) => {
        const done = askedIds.includes(t.id)
        return (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${
              done
                ? 'border-slate-200 bg-transparent text-slate-400 hover:bg-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-400 hover:text-indigo-600'
            }`}
          >
            {t.question}
          </button>
        )
      })}
    </div>
  )
}
