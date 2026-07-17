import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import dataStorePlugin from './data-store-plugin.js';

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  plugins: [
    react(),
    dataStorePlugin(),
    // ── 开发模式下：/admin/* 请求重写到 admin.html ──
    {
      name: 'admin-entry',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url;
          // /admin 及 /admin/ 子路径 → admin.html
          if (url === '/admin' || url.startsWith('/admin/')) {
            req.url = '/admin.html';
          }
          // 根路径保留走 index.html（main）
          next();
        });
      },
    },
    VitePWA({
      // dev 环境禁用 Service Worker，避免干扰 HMR 和动态导入
      disable: isDev,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/ocr-core/**', '**/*.wasm.js'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-static-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
      manifest: {
        name: 'LexiLearn - AI English Learning',
        short_name: 'LexiLearn',
        description: 'AI-powered English reading and vocabulary learning tool',
        theme_color: '#6366f1',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/logo.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
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
