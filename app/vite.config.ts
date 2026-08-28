import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // サーバー（server/、wrangler dev）へ転送する。
    // フロントと同一オリジンに揃えることで、セッション Cookie と OAuth の
    // リダイレクト先が単一のオリジンに収まる。
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
})
