import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  // @ffmpeg/ffmpeg crea su worker con `new URL('./worker.js', import.meta.url)`.
  // Al precompilarse en node_modules/.vite/deps esa URL apunta a un worker que no
  // existe (404) y `FFmpeg.load()` nunca resuelve. Excluyéndolos del optimizador
  // Vite sirve el ESM original y el worker se resuelve correctamente.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/core', '@ffmpeg/util'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
