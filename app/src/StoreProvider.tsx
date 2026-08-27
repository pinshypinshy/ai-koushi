import { useMemo, useReducer, type ReactNode } from 'react'
import { StoreCtx, initialState, reducer } from './store'

/**
 * 状態の提供のみを担うファイル。
 * コンポーネント以外を同居させると Fast Refresh が効かなくなるため、store.ts と分けている。
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}
