import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkCjkFriendly from 'remark-cjk-friendly'
import rehypeKatex from 'rehype-katex'

/**
 * KaTeX の指定。
 *
 * インラインの分数（$\frac{a}{b}$）は既定では一段小さい文字で組まれる。
 * 教材にも解説にも分数が頻出するため、本文と同じ大きさで読める方を優先し、
 * ブロック数式と同じ組み方（\dfrac 相当）へ置き換える。高さは行間で吸収する。
 */
const KATEX_OPTIONS = {
  macros: { '\\frac': '\\dfrac' },
}

/**
 * 強調の判定を日本語向けに差し替える。
 *
 * CommonMark は `**` が閉じ記号かどうかを前後の文字種で決めるため、
 * 「**「見出し」**について」のように閉じの直前が括弧・直後が助詞という並びだと
 * 太字にならず、アスタリスクがそのまま表示される。日本語は括弧で閉じてすぐ
 * 助詞が続くため、この条件を踏みやすい。AI の出力側で回避させる案は、
 * 生成のたびに守られる保証が無いため採らない。
 */
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkCjkFriendly]

/**
 * Markdown 描画（§4.1.3）。
 * 生 HTML は react-markdown が既定で除去するため、別途サニタイズは行っていない（§8.3 SEC-3）。
 * 数式は remark-math + rehype-katex で描画する。教材プレビューだけでなく、
 * 講義チャットと確認テストの表示にも同じ処理を用いる。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/**
 * 行内向けの描画。段落タグを作らないため、ボタンや一覧の中に置ける。
 * 確認テストの選択肢にも数式が現れるため必要になる（§4.1.3 は問題文・選択肢・解説の
 * すべてを同じ規則で描画すると定めている）。
 */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <span className="md">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={{ p: ({ children }) => <>{children}</> }}
      >
        {children}
      </ReactMarkdown>
    </span>
  )
}
