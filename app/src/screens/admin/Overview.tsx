import type { AdminSummary } from '../../../../shared/api'
import { formatCost, formatDate, formatNumber } from './data'

/**
 * 概要（§4.7）。運営が最初に見る値だけを並べる。
 * 「今月」は §8.2.3 の上限と同じ JST の月初を境界とする。
 */

function Card({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'warn' | 'bad'
}) {
  const color = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900'
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export function Overview({ summary }: { summary: AdminSummary }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        「今月」は {formatDate(summary.periodStart)}（JST の月初）からの集計。
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="利用者"
          value={formatNumber(summary.users)}
          note={`ゲスト ${summary.guests} ／ 管理者 ${summary.admins}`}
        />
        <Card
          label="許可リスト"
          value={formatNumber(summary.allowedEmails)}
          note="Google サインインを許可したアドレス"
        />
        <Card
          label="講義"
          value={formatNumber(summary.courses)}
          note={`今月 ${summary.coursesThisMonth} 件`}
        />
        <Card
          label="今月のAI利用額"
          value={formatCost(summary.costThisMonthUsd)}
          note={`累計 ${formatCost(summary.costTotalUsd)}`}
        />
        <Card
          label="今月のAI呼び出しエラー"
          value={formatNumber(summary.aiErrorsThisMonth)}
          note="ai_usage_logs に error が入った件数"
          tone={summary.aiErrorsThisMonth > 0 ? 'warn' : undefined}
        />
        <Card
          label="今月の失敗ログイン"
          value={formatNumber(summary.signInFailuresThisMonth)}
          note="拒否・失敗・ロック中の試行の合計"
          tone={summary.signInFailuresThisMonth > 0 ? 'warn' : undefined}
        />
      </div>
      <p className="text-xs text-slate-500">
        金額は ai_usage_logs の推定値の積み上げであり、課金プラットフォーム側の実額とは一致しない（§8.2.4）。
      </p>
    </div>
  )
}
