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
  const stepId = course.currentStepId

  const run = useCallback(
    async (question: string | null) => {
      if (!stepId || running) return
      dispatch({ type: 'streamStart', stepId })
      try {
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
          question === null
            ? `/api/courses/${course.id}/lecture`
            : `/api/courses/${course.id}/messages`,
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
    [course.id, stepId, running, dispatch, refreshUsage],
  )

  return {
    running,
    /** ③ ステップの解説を始める */
    start: useCallback(() => run(null), [run]),
    /** ④ 質問・応答を送る */
    send: useCallback((text: string) => run(text), [run]),
  }
}
