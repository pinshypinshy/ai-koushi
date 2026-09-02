import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // shared/api.ts は app/ の外にあるため、既定の許可範囲（app/）だと読み込めない
    fs: { allow: ['..'] },
    // サーバー（server/、wrangler dev）へ転送する。
    // フロントと同一オリジンに揃えることで、セッション Cookie と OAuth の
    // リダイレクト先が単一のオリジンに収まる。
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // KaTeX を本体から分ける。本体が単一ファイルで 700KB を超え、ビルドが
        // 毎回 500KB 超の警告を出していた。KaTeX は画面の変更では中身が変わらず、
        // 分けておくと利用者のブラウザキャッシュがそのまま効く。
        //
        // react-markdown 一式も分ければ本体はさらに 200KB 下がるが、対象を選ぶのに
        // パッケージ名を並べた長い正規表現が要る。依存構成が変われば漏れが静かに
        // 増えるため、名前が変わらず単体で 259KB ある KaTeX だけにする。
        advancedChunks: {
          groups: [
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ },
          ],
        },
      },
    },
  },
})
