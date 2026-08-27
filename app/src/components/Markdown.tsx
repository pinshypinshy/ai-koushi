import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/**
 * Markdown 描画（§4.1.3）。
 * 生 HTML は react-markdown が既定で除去するため、別途サニタイズは行っていない（§8.3 SEC-3）。
 * 数式は remark-math + rehype-katex で描画する。教材プレビューだけでなく、
 * 講義チャットと確認テストの表示にも同じ処理を用いる。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
