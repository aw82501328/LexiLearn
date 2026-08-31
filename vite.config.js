import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import dataStorePlugin from './data-store-plugin.js';

const isDev = process.env.NODE_ENV !== 'production';

// 同域名下共存的"其他站点"子路径前缀（如 /jd_view、/lx_vibe）。
// 这些路径由 Caddy 的静态站点规则处理，导航请求必须直连网络，不能被本应用的
// Service Worker 导航兜底劫持。未来新增子路径时，在 .env 中追加即可，无需改代码。
const DEFAULT_SW_EXCLUDED_PATHS = ['jd_view', 'lx_vibe'];

function buildSwDenylist(excludedPaths) {
  const list = (excludedPaths || [])
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/^\/+|\/+$/g, ''));
  // 加 i 标志：与 Caddy 侧 path_regexp (?i) 保持大小写不敏感一致，
  // 否则用户访问 /JD_VIEW（大写）时 SW 导航兜底仍会拦截
  return list.map((p) => new RegExp(`^\\/${p}($|\\/)`, 'i'));
}

export default defineConfig(({ mode }) => {
  // 读取 .env（含非 VITE_ 前缀），支持通过环境变量追加排除的子路径
  const env = loadEnv(mode, process.cwd(), '');
  const extraPaths = (env.LEXILEARN_SW_EXCLUDES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
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
          // SPA 导航兜底：排除同域名下其他站点的子路径，导航请求直连网络由 Caddy 处理
          navigateFallback: 'index.html',
          navigateFallbackDenylist: buildSwDenylist([...DEFAULT_SW_EXCLUDED_PATHS, ...extraPaths]),
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
  };
});

