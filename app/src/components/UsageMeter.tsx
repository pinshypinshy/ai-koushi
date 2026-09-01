import type { UsageSummary } from '../../../shared/api'

/**
 * A-4 の上に置く今月の利用状況（§8.2.3 の上限に対する消費）。
 *
 * 金額そのものは出さず割合で示す。上限に触れる条件は「AI利用額」と
 * 「講義作成数」の2つあり（§8.2.4）、片方だけでは残量を読み違えるため両方を並べる。
 */

/** 80% で警告、100% でブロック（§8.2.4）。色と注意文はこの境界に合わせる */
const WARN_PERCENT = 80

function percentOf(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function barColor(percent: number): string {
  if (percent >= 100) return 'bg-rose-400'
  if (percent >= WARN_PERCENT) return 'bg-amber-400'
  return 'bg-indigo-400'
}

function Meter({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-slate-400">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all ${barColor(percent)}`}
          // 0% ちょうどでない限り帯を見えるところまで残す。消費の有無が判別できなくなるため
          style={{ width: percent > 0 ? `${Math.max(percent, 2)}%` : '0%' }}
        />
      </div>
    </div>
  )
}

export function UsageMeter({ usage }: { usage: UsageSummary }) {
  const costPercent = percentOf(usage.costUsd, usage.costLimitUsd)
  const coursePercent = percentOf(usage.courses, usage.courseLimit)
  const worst = Math.max(costPercent, coursePercent)

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] font-bold tracking-wide text-slate-500">今月の利用状況</p>
      <Meter label="AI利用額" value={`${costPercent}%`} percent={costPercent} />
      <Meter
        label="講義作成"
        value={`${usage.courses} / ${usage.courseLimit} 件`}
        percent={coursePercent}
      />
      {worst >= WARN_PERCENT && (
        <p className={`text-[11px] leading-snug ${worst >= 100 ? 'text-rose-300' : 'text-amber-300'}`}>
          {worst >= 100
            ? '上限に達しました。新しい講義は作成できません。'
            : '上限に近づいています。'}
        </p>
      )}
    </div>
  )
}
