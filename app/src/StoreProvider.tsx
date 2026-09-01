import { useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { StoreCtx, initialState, reducer } from './store'
import { api, courseFromDetail, courseFromSummary } from './api'

/**
 * 状態の提供と、サーバーからの読み込みを担うファイル。
 * コンポーネント以外を同居させると Fast Refresh が効かなくなるため、store.ts と分けている。
 *
 * 通信はここと各画面の副作用に置き、reducer は結果を受け取るだけにする。
 * reducer を純粋に保つことで、開発パネルのシナリオ（モック）と実データが同じ経路を通る。
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)

  // §6.4「初回ロード」。講義一覧・選択中講義・利用者を1往復で受け取る
  useEffect(() => {
    let alive = true
    api
      .bootstrap()
      .then((res) => {
        if (!alive) return
        const courses = res.courses.map(courseFromSummary)
        // 選択中の講義はステップと対話まで返るため、そちらで上書きする
        const selected = res.selected ? courseFromDetail(res.selected) : null
        dispatch({
          type: 'bootstrapped',
          user: { name: res.user.displayName, email: res.user.email },
          courses: selected ? courses.map((c) => (c.id === selected.id ? selected : c)) : courses,
          selectedId: selected?.id ?? null,
        })
      })
      .catch(() => {
        // 401（未ログイン）も通信失敗も、この画面ではログインへ落とすほかない
        if (alive) dispatch({ type: 'bootFailed' })
      })
    return () => {
      alive = false
    }
  }, [])

  // 一覧から選び直した講義は中身を持っていないため、選択された時点で取りに行く
  const selectedId = state.selectedCourseId
  const selected = state.courses.find((c) => c.id === selectedId)
  const needsDetail = !!selected && !selected.detailLoaded && !selected.isMock
  useEffect(() => {
    if (!selectedId || !needsDetail) return
    let alive = true
    api
      .course(selectedId)
      .then((detail) => {
        if (alive) dispatch({ type: 'courseUpdated', course: courseFromDetail(detail) })
      })
      .catch(() => {
        // 取得できなくても一覧の情報は残っている。生成中ならポーリングが拾い直す
      })
    return () => {
      alive = false
    }
  }, [selectedId, needsDetail])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}
