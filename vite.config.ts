import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    // The OpenAI key lives only in the API process. The browser never sees it.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
