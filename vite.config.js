import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dataStorePlugin from './data-store-plugin.js';

export default defineConfig({
  plugins: [react(), dataStorePlugin()],
  server: {
    port: 5176,
    open: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
      },
    },
  },
});
