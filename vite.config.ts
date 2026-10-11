import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: { exclude: ['mupdf'] },
  worker: { format: 'es' },
  build: { target: 'esnext', outDir: 'dist' },
});
