import { useEffect, useRef, useState } from 'react'

/**
 * 運営管理ページ（§4.7）の整形と取得。表示部品は ui.tsx に置く。
 */

/** 時刻は JST で出す。§8.2.3 の「今月」の境界と同じ基準に揃える */
export function formatDateTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/**
 * 1呼び出しあたりの費用は $0.004 程度まで小さくなる（README の実測）。
 * 一律の桁数だと合計が読みにくく、細部が消えるため、桁数を金額で切り替える。
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(4)}`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('ja-JP')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}秒`
}

/**
 * 取得の状態をまとめて持つ。key が変わったときだけ取り直す。
 *
 * load を依存に入れないのは、呼び出し側が無名関数を渡すたびに取得が走るため。
 * 読み込み中かどうかを状態として持たず「表示中のデータがどの key のものか」で
 * 判定するのは、効果の中で同期的に setState すると余計な再描画が連鎖するため。
 */
export function useAdminData<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Error | null }>({
    key: null,
    data: null,
    error: null,
  })

  // 最新の load を保持する。参照の更新は描画中ではなく効果の中で行う
  const latest = useRef(load)
  useEffect(() => {
    latest.current = load
  })

  useEffect(() => {
    let alive = true
    latest.current().then(
      (data) => {
        if (alive) setState({ key, data, error: null })
      },
      (error: Error) => {
        if (alive) setState({ key, data: null, error })
      },
    )
    // 取得中に別のタブへ移った場合、古い応答で画面を上書きしない
    return () => {
      alive = false
    }
  }, [key])

  const fresh = state.key === key
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: !fresh,
  }
}
