import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const IS_WEB = process.env.VITE_WEB === '1';

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
    outDir: IS_WEB ? 'gh-pages' : 'dist',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 1200,
  },
})