import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: { exclude: ['mupdf'] },
  worker: { format: 'es' },
  // 글자 읽기를 여러 코어로 돌리려면 교차 출처 격리가 필요하다 (설치형은 electron/main.cjs에서 같은 헤더를 붙인다)
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  build: { target: 'esnext', outDir: 'dist' },
});
