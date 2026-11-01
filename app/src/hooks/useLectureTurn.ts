import { useCallback } from 'react'
import { ApiFailure, api, courseFromDetail, streamTurn } from '../api'
import { useStore } from '../store'
import { useUsageRefresh } from './useUsageRefresh'
import type { Course } from '../types'

/**
 * 受講の1ターン（§4.2.2）。
 *
 * 講義本文（③）と質問応答（④）は同じ流れで、ユーザーの発言が付いているかどうかだけが違う。
 * 講義タブと入力欄（E-1）の双方から呼ぶため、フックとして切り出している。
 */
export function useLectureTurn(course: Course) {
  const { state, dispatch } = useStore()
  const refreshUsage = useUsageRefresh()
  const running = state.streaming !== null
  /**
   * 発言を紐づけるステップ。全ステップ完了後は現在地が無いため最後のステップを使う
   * （§4.2.4、Q-32）。messages.step_id は NOT NULL であり、サーバー側も同じ規則で解決する
   */
  const allCompleted = course.currentStepId === null
  const stepId = course.currentStepId ?? course.steps[course.steps.length - 1]?.id ?? null

  /**
   * 応答が欠けたまま終わっているか（§5.7、Q-33）。
   * 最後の発言が途切れた応答か、回答の付いていない質問なら、再生成の導線を出す。
   * 何をやり直すか（③か④か）はサーバーが決めるため、ここでは出すかどうかだけを見る
   */
  const stepMessages = course.messages.filter((m) => m.stepId === stepId)
  const last = stepMessages.at(-1) ?? null
  const answersQuestion =
    last?.role === 'user' || (last?.interrupted === true && stepMessages.at(-2)?.role === 'user')
  /**
   * 完了後は④のやり直しに限る。③は完了後に受け付けないため（Q-32）、
   * 講義本文の途切れを再生成しようとしてもサーバーが 409 を返すだけになる
   */
  const needsRegenerate =
    last !== null &&
    (last.role === 'user' || last.interrupted) &&
    (!allCompleted || answersQuestion)

  const run = useCallback(
    async (turn: TurnRequest) => {
      if (!stepId || running) return
      // 完了後に受け付けるのは質問（④）だけ。講義本文（③）を送るとサーバーでも 409 になり、
      // 「全ステップが完了しました」の表示の下に解説が再び流れてしまう（Q-32）
      if (turn.kind === 'lecture' && allCompleted) return
      dispatch({
        type: 'streamStart',
        stepId,
        replacingId: turn.kind === 'regenerate' ? turn.replacingId : null,
      })
      try {
        const question = turn.kind === 'question' ? turn.text : null
        if (question !== null) {
          // 送信した発言はすぐ画面に出す。サーバー側でも保存され、
          // 講義を取り直した時点で正式な id を持つものに置き換わる
          dispatch({
            type: 'messageAppended',
            courseId: course.id,
            message: {
              id: `local-${Date.now()}`,
              stepId,
              role: 'user',
              content: question,
              createdAt: Date.now(),
              interrupted: false,
            },
          })
        }
        /**
         * 受信した断片は一定間隔でまとめて反映する。
         * 届くたびに反映すると描画が1文字単位で走り、表示がかくつくため。
         * 60ms は「文字が流れて見える」下限に近い値で、目に見える遅延にはならない。
         */
        let buffered = ''
        let lastFlush = 0
        const flush = () => {
          if (!buffered) return
          dispatch({ type: 'streamDelta', text: buffered })
          buffered = ''
          lastFlush = performance.now()
        }

        const saved = await streamTurn(
          `/api/courses/${course.id}/${TURN_PATHS[turn.kind]}`,
          question === null ? null : { text: question },
          (text) => {
            buffered += text
            if (performance.now() - lastFlush >= 60) flush()
          },
        )
        flush()
        dispatch({ type: 'messageAppended', courseId: course.id, message: saved })
        dispatch({ type: 'streamEnd' })
        // このターンで消費した分をサイドバーの表示へ反映する（§8.2.4）
        refreshUsage()
      } catch (err) {
        dispatch({
          type: 'streamFailed',
          message: err instanceof ApiFailure ? err.message : '応答を取得できませんでした',
        })
        // 中断しても部分生成分は課金されている。利用状況も取り直す（§8.2.4）
        refreshUsage()
        // 中断しても部分生成分は保存されている（§5.7）。取り直して表示を揃える
        api
          .course(course.id)
          .then((detail) => dispatch({ type: 'courseUpdated', course: courseFromDetail(detail) }))
          .catch(() => undefined)
      }
    },
    [course.id, stepId, allCompleted, running, dispatch, refreshUsage],
  )

  const replacingId = last?.role === 'assistant' && last.interrupted ? last.id : null

  return {
    running,
    needsRegenerate,
    /** ③ ステップの解説を始める */
    start: useCallback(() => run({ kind: 'lecture' }), [run]),
    /** ④ 質問・応答を送る */
    send: useCallback((text: string) => run({ kind: 'question', text }), [run]),
    /** 途中で失敗した③④をやり直す（§5.7、Q-33） */
    regenerate: useCallback(() => run({ kind: 'regenerate', replacingId }), [run, replacingId]),
  }
}

type TurnRequest =
  | { kind: 'lecture' }
  | { kind: 'question'; text: string }
  | { kind: 'regenerate'; replacingId: string | null }

const TURN_PATHS: Record<TurnRequest['kind'], string> = {
  lecture: 'lecture',
  question: 'messages',
  regenerate: 'regenerate',
}
