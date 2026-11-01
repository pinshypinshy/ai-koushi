import { memo, useEffect, useRef, useState } from 'react'
import { ApiFailure, api, courseFromDetail } from '../api'
import { useStore } from '../store'
import { useLectureTurn } from '../hooks/useLectureTurn'
import type { Course, Message } from '../types'
import { Markdown } from '../components/Markdown'
import { IconUser } from '../components/Icons'

/**
 * AI の発話。footer は吹き出しの外、すぐ下に置く（途切れた旨と再生成の導線、§5.7）。
 * children を渡さなければ吹き出しを描かず、アイコンと footer だけになる
 * （回答が1文字も届かなかった質問の場合）。
 */
function AssistantBubble({
  children,
  footer,
}: {
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
        AI
      </span>
      <div className="flex min-w-0 max-w-[85%] flex-col">
        {children !== undefined && (
          <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {children}
          </div>
        )}
        {footer && (
          <div
            className={`flex items-center gap-3 px-1 ${children !== undefined ? 'mt-1.5' : 'min-h-6'}`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** 途切れた応答・届かなかった応答の下に並べる文言と再生成ボタン（§5.7、Q-33） */
function FailedReplyFooter({
  label,
  onRegenerate,
}: {
  label: string
  onRegenerate?: () => void
}) {
  return (
    <>
      <span className="text-xs text-amber-700">{label}</span>
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700"
        >
          再生成する
        </button>
      )}
    </>
  )
}

/**
 * 受信中は state が頻繁に変わる。確定済みの発話まで描き直すと
 * 数式の組版をやり直すことになり、表示がかくつく原因になる。
 */
const Bubble = memo(function Bubble({
  message,
  onRegenerate,
}: {
  message: Message
  /** 再生成の対象（現在のステップの最後の途切れた発言）にだけ渡す */
  onRegenerate?: () => void
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
    <AssistantBubble
      // 完了した発言と見分けられるようにする（§5.7、Q-33）。本文だけでは途中で切れたと分からない
      footer={
        message.interrupted && (
          <FailedReplyFooter label="応答が途中で途切れました" onRegenerate={onRegenerate} />
        )
      }
    >
      <Markdown>{message.content}</Markdown>
    </AssistantBubble>
  )
})

/**
 * 講義タブの表示位置。
 *
 * タブを切り替えると講義タブは一度取り外されるため、位置を覚えておかないと
 * 戻ったときに先頭へ跳ぶ。講義が変わった場合とリロード直後は末尾から始める。
 */
let savedScroll: { courseId: string; top: number } | null = null

/** SC-07 講義タブ（§4.2） */
export function LectureTab({ course }: { course: Course }) {
  const { state, dispatch } = useStore()
  const { running, start, regenerate, needsRegenerate, replacingId } = useLectureTurn(course)
  /** 再生成の導線を出すか。受信中は出さない（二重に押されるのを防ぐ） */
  const canRegenerate = needsRegenerate && !running
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  /** 末尾に貼り付いているか。新しい発話で追従するかの判断に使う */
  const stickRef = useRef(true)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)

  const step = course.steps.find((s) => s.id === course.currentStepId) ?? null
  const allDone = course.currentStepId === null
  const isLast = step ? step.orderIndex === course.steps.length : false
  const hasMessages = course.messages.some((m) => m.stepId === course.currentStepId)

  /**
   * §4.2.2「講義を開いた時点で、未完了の最初のステップの講義本文を生成・表示する」。
   * 開始済みのステップを覚えておき、再描画のたびに呼び直さない（呼ぶたびに課金される）。
   */
  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    const id = course.currentStepId
    if (!id || !course.detailLoaded || hasMessages || running || state.streamError) return
    if (startedFor.current === id) return
    startedFor.current = id
    void start()
  }, [course.currentStepId, course.detailLoaded, hasMessages, running, state.streamError, start])

  /**
   * 表示位置の管理。スクロールするのは App 側の <main> であるため、親を辿って掴む。
   *
   * 位置の記録を「取り外される直前」ではなくスクロールのたびに行うのは、
   * React の後片付けが取り外しの後に走るため。その時点では中身が入れ替わっており、
   * スクロール位置は 0 に丸められていて読み取れない。
   *
   * 復元するのはタブを切り替えて戻ってきた場合のみ。講義を変えた場合と
   * リロード直後は末尾から始める。
   */
  useEffect(() => {
    const el = (rootRef.current?.closest('main') as HTMLElement | null) ?? null
    scrollerRef.current = el
    if (!el) return

    const restore = savedScroll && savedScroll.courseId === course.id ? savedScroll.top : null
    // 復元しない場合は末尾に貼り付ける。発話の取得が遅れて届いても末尾を保てる
    stickRef.current = restore === null

    // 直後は高さが確定していないことがあるため、描画の後に適用する
    const raf = requestAnimationFrame(() => {
      el.scrollTop = restore !== null ? restore : el.scrollHeight
    })

    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      savedScroll = { courseId: course.id, top: el.scrollTop }
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [course.id])

  /**
   * 新しい発話が届いたときの追従。末尾付近にいるときだけ動かす。
   * 上に戻って読んでいる最中に引き戻さないため。
   */
  useEffect(() => {
    const el = scrollerRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [course.messages.length, state.streaming?.text])

  /** ステップ完了（§4.2.2）。⑤の要約を作るため、応答まで数秒かかる */
  async function complete() {
    if (!course.currentStepId) return
    setCompleting(true)
    setCompleteError(null)
    try {
      const detail = await api.completeStep(course.id, course.currentStepId)
      dispatch({ type: 'courseUpdated', course: courseFromDetail(detail) })
      // 次のステップの解説は上の副作用が開始する
    } catch (err) {
      setCompleteError(err instanceof ApiFailure ? err.message : 'ステップを完了できませんでした')
    } finally {
      setCompleting(false)
    }
  }

  // ステップ境界の区切り位置をレンダリング前に決める（描画中に値を書き換えない）
  const dividerIds = new Set<string>()
  course.messages.reduce<string | null>((prev, m) => {
    if (m.stepId !== prev) dividerIds.add(m.id)
    return m.stepId
  }, null)

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4">
      {course.messages.map((m) => {
        // 再生成の受信中は置き換え前の発言を隠す。受信中の発言と同じ内容が二重に並ぶため
        if (m.id === state.streaming?.replacingId) return null
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
              onRegenerate={canRegenerate && m.id === replacingId ? regenerate : undefined}
            />
          </div>
        )
      })}

      {/*
        回答が1文字も届かなかった質問。置き換える吹き出しが無いため、AI のアイコンだけを出し、
        途切れた発言と同じ位置に文言と再生成ボタンを並べる（§5.7、Q-33）
      */}
      {canRegenerate && replacingId === null && (
        <AssistantBubble
          footer={<FailedReplyFooter label="応答を取得できませんでした" onRegenerate={regenerate} />}
        />
      )}

      {/* 受信中の発話。届いた文字をそのまま表示する（§8.1） */}
      {state.streaming && (
        <AssistantBubble>
          {state.streaming.text ? (
            <Markdown>{state.streaming.text}</Markdown>
          ) : (
            <span className="text-sm text-slate-400">応答を待っています…</span>
          )}
          <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-slate-400 align-text-bottom" />
        </AssistantBubble>
      )}

      {/*
        再生成の導線を発言の下に出せない失敗だけを枠で示す。解説が1文字も届かなかった場合
        （空のステップ）や、講義単位の上限で断られた場合など。発言の下に出せる場合は枠を
        重ねない。同じ失敗を2か所で示すことになるため（§5.7、Q-33）
      */}
      {!running && state.streamError && !needsRegenerate && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-center">
          <p className="text-sm text-amber-800">{state.streamError}</p>
          {/* 何をやり直すかはサーバーが決める（regeneratePlan）。空のステップなら③を最初から */}
          {!allDone && !hasMessages && (
            <button
              onClick={() => void regenerate()}
              className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-700"
            >
              再生成する
            </button>
          )}
        </div>
      )}

      {/*
        「次のステップへ進む」は失敗の表示中も出す。ステップ完了はユーザーが次へ進むことに
        同意した時点であり（Q-4）、判断は本人に委ねられているため。隠すと、生成が失敗し
        続ける場合に先へ進めなくなる
      */}
      {!allDone && !running && hasMessages && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <button
            onClick={() => void complete()}
            disabled={completing}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
          >
            {completing
              ? '要約を作成しています…'
              : isLast
                ? '講義を終える'
                : '次のステップへ進む'}
          </button>
          {completeError && <p className="text-xs text-rose-600">{completeError}</p>}
        </div>
      )}

      {allDone && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center">
          <p className="text-sm font-semibold text-emerald-800">全ステップが完了しました</p>
          {/* 完了後も入力欄は開いている（§4.2.4、Q-32）。それが分かる文面にする */}
          <p className="mt-1 text-xs text-emerald-700">
            まだわからないことがあれば、いつでも質問してください
          </p>
          <button
            onClick={() => dispatch({ type: 'setTab', tab: 'quiz' })}
            className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-600"
          >
            確認テストへ
          </button>
        </div>
      )}
    </div>
  )
}
