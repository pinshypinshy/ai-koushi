import { useEffect, type ReactNode } from 'react'

export function Modal({
  onClose,
  children,
  labelledBy,
}: {
  onClose: () => void
  children: ReactNode
  labelledBy: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        {children}
      </div>
    </div>
  )
}

export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>
}

export const btnGhost =
  'rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100'
export const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700'
export const btnDanger =
  'rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500'
