import { useState } from 'react'
import type { AdminCourseRow, AdminUserRow } from '../../../../shared/api'
import { adminApi } from '../../api'
import { AccessTable, UsageTable } from './Logs'
import { Badge, Empty, Loading, Panel, Table, Td, Th } from './ui'
import { formatCost, formatDate, formatDateTime, formatNumber, useAdminData } from './data'

/**
 * 利用者一覧と詳細（§4.7）。
 *
 * 上限に対する消費は「AI利用額」と「講義作成数」の2つあり（§8.2.4）、
 * 片方だけでは残量を読み違えるため、サイドバーの表示（A-5）と同じく両方を並べる。
 */

/** 80% で警告、100% でブロック（§8.2.4）。色の境界はサイドバーと揃える */
const WARN_PERCENT = 80

function ratioTone(used: number, limit: number): string {
  if (limit <= 0) return ''
  const percent = (used / limit) * 100
  if (percent >= 100) return 'text-rose-600 font-medium'
  if (percent >= WARN_PERCENT) return 'text-amber-600 font-medium'
  return ''
}

function CourseTable({ rows }: { rows: AdminCourseRow[] }) {
  if (rows.length === 0) return <Empty>講義がありません。</Empty>
  return (
    <Table
      head={
        <tr>
          <Th>タイトル</Th>
          <Th>状態</Th>
          <Th>テスト</Th>
          <Th numeric>進捗</Th>
          <Th numeric>設問</Th>
          <Th numeric>教材</Th>
          <Th numeric>コスト</Th>
          <Th>作成</Th>
          <Th>最終更新</Th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.id}>
          <Td>{r.title}</Td>
          <Td>
            {r.status === 'ready' ? (
              <Badge tone="ok">完了</Badge>
            ) : r.status === 'generating' ? (
              <Badge tone="mute">生成中</Badge>
            ) : (
              <Badge tone="bad">失敗</Badge>
            )}
          </Td>
          <Td>
            {r.quizStatus === 'ready' ? (
              <Badge tone="ok">あり</Badge>
            ) : r.quizStatus === 'pending' ? (
              <Badge tone="mute">未</Badge>
            ) : (
              <Badge tone="bad">失敗</Badge>
            )}
          </Td>
          <Td numeric muted>
            {r.completedSteps} / {r.totalSteps}
          </Td>
          <Td numeric muted>
            {r.questions}
          </Td>
          <Td numeric muted>
            {formatNumber(r.materialChars)}字
          </Td>
          <Td numeric>{formatCost(r.costUsd)}</Td>
          <Td muted>{formatDate(r.createdAt)}</Td>
          <Td muted>{formatDateTime(r.updatedAt)}</Td>
        </tr>
      ))}
    </Table>
  )
}

function UserDetail({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, error, loading } = useAdminData(() => adminApi.user(userId), `user:${userId}`)

  if (loading) return <Loading />
  if (error) return <Empty>取得に失敗しました：{error.message}</Empty>
  if (!data) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">
          {data.user.displayName}
          <span className="ml-2 font-normal text-slate-500">{data.user.email}</span>
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100"
        >
          閉じる
        </button>
      </div>
      <Panel title="講義">
        <CourseTable rows={data.courses} />
      </Panel>
      <Panel title="AI呼び出し" note="新しい順に50件">
        <UsageTable rows={data.usage} />
      </Panel>
      <Panel title="ログイン" note="新しい順に50件">
        <AccessTable rows={data.access} />
      </Panel>
    </div>
  )
}

function UserTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: AdminUserRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (rows.length === 0) return <Empty>利用者がいません。</Empty>
  return (
    <Table
      head={
        <tr>
          <Th>メールアドレス</Th>
          <Th>表示名</Th>
          <Th>種別</Th>
          <Th numeric>今月の講義</Th>
          <Th numeric>今月の利用額</Th>
          <Th numeric>累計</Th>
          <Th numeric>講義</Th>
          <Th>最終ログイン</Th>
          <Th>登録</Th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr
          key={r.id}
          onClick={() => onSelect(r.id)}
          className={`cursor-pointer transition hover:bg-slate-50 ${
            r.id === selectedId ? 'bg-indigo-50/60' : ''
          }`}
        >
          <Td>{r.email}</Td>
          <Td muted>{r.displayName}</Td>
          <Td>
            <span className="flex items-center gap-1">
              {r.kind === 'google' ? 'Google' : <Badge tone="mute">ゲスト</Badge>}
              {r.isAdmin && <Badge tone="warn">管理者</Badge>}
            </span>
          </Td>
          <Td numeric>
            <span className={ratioTone(r.coursesThisMonth, r.courseLimit)}>
              {r.coursesThisMonth} / {r.courseLimit}
            </span>
          </Td>
          <Td numeric>
            <span className={ratioTone(r.costThisMonthUsd, r.costLimitUsd)}>
              {formatCost(r.costThisMonthUsd)} / ${r.costLimitUsd}
            </span>
          </Td>
          <Td numeric muted>
            {formatCost(r.costTotalUsd)}
          </Td>
          <Td numeric muted>
            {r.courses}
          </Td>
          <Td muted>{formatDateTime(r.lastLoginAt)}</Td>
          <Td muted>{formatDate(r.createdAt)}</Td>
        </tr>
      ))}
    </Table>
  )
}

export function UsersTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, error, loading } = useAdminData(() => adminApi.users(), 'users')

  return (
    <div className="space-y-3">
      <Panel title="利用者" note="行を選ぶと講義・AI呼び出し・ログインを表示する">
        {loading ? (
          <Loading />
        ) : error ? (
          <Empty>取得に失敗しました：{error.message}</Empty>
        ) : (
          <UserTable
            rows={data?.users ?? []}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
          />
        )}
      </Panel>
      {selectedId && <UserDetail userId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
