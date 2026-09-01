import { useState } from 'react'
import type {
  AccessResult,
  AdminAccessRow,
  AdminUsageRow,
  AiPurpose,
} from '../../../../shared/api'
import { adminApi } from '../../api'
import { Badge, Check, Empty, Loading, Panel, Select, Table, Td, Th, Truncated } from './ui'
import { formatCost, formatDateTime, formatDuration, formatNumber, useAdminData } from './data'

/**
 * AI呼び出しログとアクセスログ（§4.7）。
 * 表そのものは利用者詳細でも使うため、フィルタ付きのタブとは分けて公開する。
 */

/** §5.1 の5種類。番号を添えるのは要件定義書の呼び方に合わせるため */
const PURPOSE_LABEL: Record<AiPurpose, string> = {
  outline: '①骨子',
  quiz: '②テスト',
  lecture: '③講義本文',
  answer: '④質問応答',
  summary: '⑤要約',
}

const RESULT_LABEL: Record<AccessResult, string> = {
  success: '成功',
  denied: '許可外',
  failed: '失敗',
  locked: 'ロック中',
}

const RESULT_TONE: Record<AccessResult, 'ok' | 'warn' | 'bad' | 'mute'> = {
  success: 'ok',
  denied: 'bad',
  failed: 'warn',
  locked: 'bad',
}

export function UsageTable({ rows }: { rows: AdminUsageRow[] }) {
  if (rows.length === 0) return <Empty>記録がありません。</Empty>
  return (
    <Table
      head={
        <tr>
          <Th>時刻</Th>
          <Th>利用者</Th>
          <Th>講義</Th>
          <Th>用途</Th>
          <Th>モデル</Th>
          <Th numeric>入力</Th>
          <Th numeric>うちキャッシュ</Th>
          <Th numeric>出力</Th>
          <Th numeric>うち思考</Th>
          <Th numeric>コスト</Th>
          <Th numeric>所要</Th>
          <Th>エラー</Th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.id} className={r.error ? 'bg-rose-50/40' : undefined}>
          <Td muted>{formatDateTime(r.createdAt)}</Td>
          <Td>{r.userEmail ?? '（削除済み）'}</Td>
          <Td muted>{r.courseTitle ?? '—'}</Td>
          <Td>{PURPOSE_LABEL[r.purpose]}</Td>
          <Td muted>{r.model}</Td>
          <Td numeric>{formatNumber(r.inputTokens)}</Td>
          {/* キャッシュから読まれた割合が §8.2 の実装必須事項の効き具合そのものになる */}
          <Td numeric muted>
            {formatNumber(r.cachedInputTokens)}
          </Td>
          <Td numeric>{formatNumber(r.outputTokens)}</Td>
          <Td numeric muted>
            {formatNumber(r.thinkingTokens)}
          </Td>
          <Td numeric>{formatCost(r.estimatedCostUsd)}</Td>
          <Td numeric muted>
            {formatDuration(r.durationMs)}
          </Td>
          {/* エラー文はAIの応答をそのまま持つため長さの上限が無い。折り返して表を広げない */}
          <Td wrap>
            {r.error ? <Badge tone="bad">{r.error}</Badge> : <span className="text-slate-400">—</span>}
          </Td>
        </tr>
      ))}
    </Table>
  )
}

export function AccessTable({ rows }: { rows: AdminAccessRow[] }) {
  if (rows.length === 0) return <Empty>記録がありません。</Empty>
  return (
    <Table
      head={
        <tr>
          <Th>時刻</Th>
          <Th>種別</Th>
          <Th>識別子</Th>
          <Th>結果</Th>
          <Th>IP</Th>
          <Th>利用者</Th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.id}>
          <Td muted>{formatDateTime(r.createdAt)}</Td>
          <Td>{r.kind === 'google' ? 'Google' : 'ゲスト'}</Td>
          <Td>{r.identifier}</Td>
          <Td>
            <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge>
          </Td>
          <Td muted>{r.ip ?? '—'}</Td>
          <Td muted>{r.userEmail ?? '—'}</Td>
        </tr>
      ))}
    </Table>
  )
}

const LIMIT = 100

export function UsageTab() {
  const [purpose, setPurpose] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const key = `usage:${purpose}:${errorsOnly}`
  const { data, error, loading } = useAdminData(
    () => adminApi.usage({ purpose: purpose || undefined, errorsOnly, limit: LIMIT }),
    key,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="用途"
          value={purpose}
          onChange={setPurpose}
          options={[
            { value: '', label: 'すべて' },
            ...(Object.keys(PURPOSE_LABEL) as AiPurpose[]).map((p) => ({
              value: p,
              label: PURPOSE_LABEL[p],
            })),
          ]}
        />
        <Check label="エラーのみ" checked={errorsOnly} onChange={setErrorsOnly} />
      </div>
      <Panel
        title="AI呼び出しログ"
        note="§8.4 のログ要件（モデル・トークン数・所要時間・エラー）をそのまま並べている"
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <Empty>取得に失敗しました：{error.message}</Empty>
        ) : (
          <>
            <UsageTable rows={data?.rows ?? []} />
            {data?.hasMore && <Truncated limit={LIMIT} />}
          </>
        )}
      </Panel>
    </div>
  )
}

export function AccessTab() {
  const [result, setResult] = useState('')
  const [failuresOnly, setFailuresOnly] = useState(false)
  const key = `access:${result}:${failuresOnly}`
  const { data, error, loading } = useAdminData(
    () => adminApi.access({ result: result || undefined, failuresOnly, limit: LIMIT }),
    key,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="結果"
          value={result}
          onChange={setResult}
          options={[
            { value: '', label: 'すべて' },
            ...(Object.keys(RESULT_LABEL) as AccessResult[]).map((r) => ({
              value: r,
              label: RESULT_LABEL[r],
            })),
          ]}
        />
        <Check label="成功以外のみ" checked={failuresOnly} onChange={setFailuresOnly} />
      </div>
      <Panel
        title="ログイン記録"
        note="同じIDが離れたIPから使われていないか（ゲストの使い回し）と、拒否・失敗の偏りを見る"
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <Empty>取得に失敗しました：{error.message}</Empty>
        ) : (
          <>
            <AccessTable rows={data?.rows ?? []} />
            {data?.hasMore && <Truncated limit={LIMIT} />}
          </>
        )}
      </Panel>
    </div>
  )
}
