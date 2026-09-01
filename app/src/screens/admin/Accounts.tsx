import { adminApi } from '../../api'
import { Badge, Empty, Loading, Panel, Table, Td, Th } from './ui'
import { formatDate, formatDateTime, useAdminData } from './data'

/**
 * 認証まわりの一覧（§4.7）：許可リストとゲスト。
 *
 * 段階1は読み取りのみのため、追加・発行の手順をコマンドとして併記する。
 * 画面から発行できないことと、どうすれば発行できるかを同じ場所に置く。
 */

function Command({ children }: { children: string }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{children}</code>
  )
}

function Allowlist() {
  const { data, error, loading } = useAdminData(() => adminApi.allowlist(), 'allowlist')

  return (
    <Panel
      title="許可リスト（Google サインイン）"
      note="ここに載っているアドレスだけが Google サインインを通過できる（§4.6）"
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>取得に失敗しました：{error.message}</Empty>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <Empty>空です。この状態では誰もサインインできません（閉じる側に倒しています）。</Empty>
      ) : (
        <Table
          head={
            <tr>
              <Th>メールアドレス</Th>
              <Th>メモ</Th>
              <Th>状態</Th>
              <Th>最終ログイン</Th>
              <Th>追加</Th>
            </tr>
          }
        >
          {data?.rows.map((r) => (
            <tr key={r.email}>
              <Td>{r.email}</Td>
              <Td muted>{r.note ?? '—'}</Td>
              <Td>
                {/* 許可しただけで一度も入っていない相手を見分けられるようにする */}
                {r.userId ? <Badge tone="ok">利用中</Badge> : <Badge tone="mute">未サインイン</Badge>}
              </Td>
              <Td muted>{formatDateTime(r.lastLoginAt)}</Td>
              <Td muted>{formatDate(r.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        追加・取り消しはコマンドで行う：
        <Command>npm run allow:add -- &lt;アドレス&gt; "&lt;メモ&gt;" --remote</Command> ／{' '}
        <Command>npm run allow:remove -- &lt;アドレス&gt; --remote</Command>
        。削除しても発行済みのセッションは有効期限まで残る。
      </p>
    </Panel>
  )
}

function Guests() {
  const { data, error, loading } = useAdminData(() => adminApi.guests(), 'guests')

  return (
    <Panel
      title="ゲストアカウント"
      note="運営が発行したID・パスワードで入る（Q-26）。パスワードは保存していないため表示できない"
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>取得に失敗しました：{error.message}</Empty>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <Empty>発行済みのゲストはありません。</Empty>
      ) : (
        <Table
          head={
            <tr>
              <Th>ログインID</Th>
              <Th>表示名</Th>
              <Th>状態</Th>
              <Th numeric>連続失敗</Th>
              <Th numeric>講義</Th>
              <Th>最終ログイン</Th>
              <Th>発行</Th>
            </tr>
          }
        >
          {data?.rows.map((r) => (
            <tr key={r.loginId}>
              <Td>{r.loginId}</Td>
              <Td muted>{r.displayName}</Td>
              <Td>
                {r.locked ? (
                  <Badge tone="bad">ロック中（{formatDateTime(r.lockedUntil)}まで）</Badge>
                ) : (
                  <Badge tone="ok">利用可</Badge>
                )}
              </Td>
              {/* 10回で15分ロック（§4.6）。0 でなければ試行が続いている兆候になる */}
              <Td numeric muted={r.failedCount === 0}>
                {r.failedCount}
              </Td>
              <Td numeric muted>
                {r.courses}
              </Td>
              <Td muted>{formatDateTime(r.lastLoginAt)}</Td>
              <Td muted>{formatDate(r.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        発行・再発行はコマンドで行う：
        <Command>npm run guest:add -- &lt;ID&gt; "&lt;表示名&gt;" --remote</Command> ／{' '}
        <Command>npm run guest:reset -- &lt;ID&gt; --remote</Command>
        。行を消して作り直すと講義・対話・解答記録が連鎖削除で失われるため、再発行を使う。
      </p>
    </Panel>
  )
}

export function AccountsTab() {
  return (
    <div className="space-y-3">
      <Allowlist />
      <Guests />
    </div>
  )
}
