import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 7901,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7900', changeOrigin: false },
      '/media': { target: 'http://127.0.0.1:7900', changeOrigin: false },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 1200,
  },
})