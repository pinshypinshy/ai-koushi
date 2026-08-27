import { useEffect, useState } from 'react'

/**
 * ソフトキーボードの表示状態を Visual Viewport API で判定する（§3.3 Q-15）。
 * キーボード表示中は下部タブバーを隠し、入力欄を画面下端へ寄せるために使う。
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      // 可視領域がウィンドウ高の 75% を下回ったらキーボードが出ているとみなす
      setOpen(vv.height < window.innerHeight * 0.75)
    }
    onResize()
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  return open
}
