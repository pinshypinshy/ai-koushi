import { useCallback } from 'react'
import { api } from '../api'
import { useStore } from '../store'

/**
 * 今月の利用状況を取り直す（§8.2.4）。
 *
 * AI を消費するのは講義の生成と受講の応答であり、その終わりでだけ呼ぶ。
 * 定期ポーリングにしないのは、消費が起きていない間も数えることになるため。
 * 失敗しても表示が古いままになるだけなので、握り潰して次の機会に任せる。
 */
export function useUsageRefresh(): () => void {
  const { dispatch } = useStore()
  return useCallback(() => {
    api
      .usage()
      .then((usage) => dispatch({ type: 'usageUpdated', usage }))
      .catch(() => undefined)
  }, [dispatch])
}
