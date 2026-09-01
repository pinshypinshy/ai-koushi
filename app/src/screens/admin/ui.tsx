import type { ReactNode } from 'react'

/**
 * 運営管理ページ（§4.7）の表示部品。
 *
 * 表が中心の画面であり、桁が揃わないと金額とトークン数を読み違えるため、
 * 数値列には tabular-nums を当てて右寄せに統一する。
 * 整形と取得の処理は data.ts に置く（この階層はコンポーネントだけを公開する）。
 */

export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      </header>
      {children}
    </section>
  )
}

/** 横に広い表が多いため、パネルの内側だけを横スクロールさせる */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-sm">
        <thead className="border-b border-slate-100 text-[11px] font-medium text-slate-500">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-50">{children}</tbody>
      </table>
    </div>
  )
}

export function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th className={`px-4 py-2 font-medium whitespace-nowrap ${numeric ? 'text-right' : ''}`}>
      {children}
    </th>
  )
}

export function Td({
  children,
  numeric,
  muted,
  wrap,
}: {
  children: ReactNode
  numeric?: boolean
  muted?: boolean
  /** 長さの上限が無い値（AI が返したエラー文など）に使う。折り返して表の幅を抑える */
  wrap?: boolean
}) {
  return (
    <td
      className={`px-4 py-2 ${wrap ? 'max-w-xs break-words whitespace-normal' : 'whitespace-nowrap'} ${
        numeric ? 'text-right tabular-nums' : ''
      } ${muted ? 'text-slate-500' : 'text-slate-800'}`}
    >
      {children}
    </td>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-slate-500">{children}</p>
}

export function Loading() {
  return <p className="px-4 py-6 text-sm text-slate-500">読み込んでいます…</p>
}

/** 一覧を上限件数で切った場合に出す。黙って切ると「これで全部」と読み違える */
export function Truncated({ limit }: { limit: number }) {
  return (
    <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700">
      新しい順に {limit} 件だけ表示している。これより古い記録は含まれていない。
    </p>
  )
}

const BADGE_BASE = 'inline-block rounded px-1.5 py-0.5 text-[11px] font-medium'

export function Badge({ children, tone }: { children: ReactNode; tone: 'ok' | 'warn' | 'bad' | 'mute' }) {
  const color = {
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    bad: 'bg-rose-50 text-rose-700',
    mute: 'bg-slate-100 text-slate-600',
  }[tone]
  return <span className={`${BADGE_BASE} ${color}`}>{children}</span>
}

/** 選択式の絞り込み。ラベルと select を1組で扱う */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-indigo-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-500"
      />
      {label}
    </label>
  )
}
