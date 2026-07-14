import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dataStorePlugin from './data-store-plugin.js';

export default defineConfig({
  plugins: [
    {
      name: 'admin-entry',
      configureServer(server) {
        // 所有非 API / 非静态文件请求使用 admin.html
        server.middlewares.use((req, res, next) => {
          const url = req.url;
          if (url === '/' || (!url.includes('.') && !url.startsWith('/api/') && !url.startsWith('/@') && !url.startsWith('/node_modules') && !url.startsWith('/src'))) {
            req.url = '/admin.html';
          }
          // /admin/ 子路径也走 admin.html
          if (url.startsWith('/admin/') || url === '/admin') {
            req.url = '/admin.html';
          }
          next();
        });
      },
    },
    react(),
    dataStorePlugin(),
  ],
  server: {
    port: 5188,
    strictPort: true,
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: 'admin.html',
    },
  },
});
