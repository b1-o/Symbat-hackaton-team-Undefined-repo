import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'], hmr: false },
  // Keep self-hosted font files external even below the inline threshold: strict CSP disallows data: fonts.
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 700,
    assetsInlineLimit: (file) => !file.endsWith('.woff2'),
  },
});
