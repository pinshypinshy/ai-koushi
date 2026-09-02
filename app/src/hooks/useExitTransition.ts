import { useEffect, useState } from 'react'

/**
 * 閉じたあとも退場アニメーションの間だけ DOM に残す（§3.4 モバイルのドロワー）。
 * 条件レンダリングのままだと、閉じる瞬間に要素ごと消えて動きが再生されないため。
 *
 * durationMs は CSS 側のアニメーション長と合わせる。長すぎると閉じた後も
 * 透明な要素が画面を覆い、下の操作を奪う。
 */
export function useExitTransition(open: boolean, durationMs: number) {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (!mounted) return
    const timer = setTimeout(() => setMounted(false), durationMs)
    return () => clearTimeout(timer)
  }, [open, mounted, durationMs])

  // closing：DOM には残っているが、利用者はもう閉じたつもりでいる状態
  return { mounted, closing: mounted && !open }
}
