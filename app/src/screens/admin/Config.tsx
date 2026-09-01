import type { AiPurpose } from '../../../../shared/api'
import { adminApi } from '../../api'
import { Empty, Loading, Panel, Table, Td, Th } from './ui'
import { useAdminData } from './data'

/**
 * 設定の表示（§4.7）。段階1は読み取りのみで、変更はコードと wrangler.jsonc で行う。
 *
 * プロンプトはソースの引き写しではなく、サーバーが実際に組み立てた文字列を出す。
 * 「今この瞬間に何を送っているか」が確認したい対象であり、引数で変わる箇所は
 * ソースを読んでも分からないため。
 */

const PURPOSE_LABEL: Record<AiPurpose, string> = {
  outline: '① 骨子生成',
  quiz: '② 確認テスト生成',
  lecture: '③ 講義本文生成',
  answer: '④ 質問応答',
  summary: '⑤ ステップ要約生成',
}

export function ConfigTab() {
  const { data, error, loading } = useAdminData(() => adminApi.config(), 'config')

  if (loading) return <Loading />
  if (error) return <Empty>取得に失敗しました：{error.message}</Empty>
  if (!data) return null

  return (
    <div className="space-y-3">
      <Panel title="モデル" note="wrangler.jsonc の vars（MODEL_*）。呼び出しの種類ごとに指定する（§5.5）">
        <Table
          head={
            <tr>
              <Th>呼び出し</Th>
              <Th>モデルID</Th>
            </tr>
          }
        >
          {data.models.map((m) => (
            <tr key={m.purpose}>
              <Td>{PURPOSE_LABEL[m.purpose]}</Td>
              <Td muted>{m.model}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="月間上限"
        note="利用者ごとに数える（§8.2.3）。ゲストを増やすと費用がその人数分だけ積み上がる"
      >
        <Table
          head={
            <tr>
              <Th>種別</Th>
              <Th numeric>講義作成</Th>
              <Th numeric>AI利用額</Th>
            </tr>
          }
        >
          {data.limits.map((l) => (
            <tr key={l.kind}>
              <Td>{l.kind === 'google' ? 'Google' : 'ゲスト'}</Td>
              <Td numeric>{l.courses} 件</Td>
              <Td numeric>${l.costUsd}</Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="システムプロンプト"
        note="サーバーが実際に組み立てた文字列。段階1では表示のみで、変更は server/src/ai/prompts.ts で行う"
      >
        <div className="divide-y divide-slate-100">
          {data.prompts.map((p) => (
            <details key={p.key} className="group px-4 py-3">
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-800">
                <span className="mr-2 text-slate-400 group-open:hidden">▶</span>
                <span className="mr-2 hidden text-slate-400 group-open:inline">▼</span>
                {p.label}
              </summary>
              {p.note && <p className="mt-1.5 ml-6 text-xs text-slate-500">{p.note}</p>}
              {/* 改行と字下げがそのまま意味を持つため、整形せずに出す */}
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
                {p.body}
              </pre>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  )
}
