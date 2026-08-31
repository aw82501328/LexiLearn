# SPEC：同域名多站点共存 — 子路径被 PWA Service Worker 劫持问题

## 1. 问题描述

- 域名 `https://lexilearn.cloud` 使用 Caddy 反向代理 LexiLearn（Node + React SPA + PWA）。
- 同域名下挂载其他独立静态站点，如 `/jd_view`（简历）、`/lx_vibe`（耳机）。
- 现象：访问 `https://lexilearn.cloud/JD_VIEW/` 等子路径时，自动跳转到 `https://lexilearn.cloud`（首页）。
- 无痕模式下访问正常，普通模式下强制刷新也无效。

## 2. 根因分析

跳转由三层叠加导致，缺一不可：

### 2.1 Node 的 SPA fallback（Caddy 未接住子路径时）

`server.js` 的 `serveStatic()` 对找不到的静态文件统一返回 `index.html`（应用壳），这是 SPA 路由的必要兜底，但也吞掉了本应属于其他站点的子路径请求。

### 2.2 React 路由的 catch-all 重定向

`src/App.jsx` 中 `path="*"` 路由执行 `<Navigate to="/" replace />`，任何未注册的前端路由都会被重定向到首页。

### 2.3 PWA Service Worker 的导航兜底（本次真正的关键）

`vite-plugin-pwa`（Workbox）生成的 `sw.js` 中有一行：

```js
e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html")))
```

作用域 `/` 下，**所有页面导航请求**（包括 `/jd_view/`、`/lx_vibe/`）只要不是预缓存资源，都会被 SW 直接返回缓存的 `index.html`。之后前端路由表没有该路径，触发 2.2 的重定向。

这解释了为什么无痕模式正常（无 SW）、强制刷新无效（HTTP 缓存可被绕过，但 SW 拦截无法被强制刷新绕过）、以及"Caddy 配置正确、curl 返回 200 简历页"但浏览器仍跳转（curl 无 SW）。

## 3. 解决方案（三层联动）

### 3.1 Caddy 层：子路径分流（静态站点）

在 `/etc/caddy/Caddyfile` 的站点块中，将子路径交给 `file_server` 或独立后端，**必须在任何 `reverse_proxy` 兜底之前**：

```caddyfile
lexilearn.cloud {
    # ① 独立静态站点（放在最前面，优先匹配）
    handle_path /jd_view/* {
        root * /var/www/lexilearn/jd_view
        file_server
    }
    handle_path /lx_vibe/* {
        root * /var/www/lexilearn/lx_vibe
        file_server
    }

    # ② LexiLearn API
    reverse_proxy /api/* localhost:3000

    # ③ LexiLearn 静态资源（Caddy 直接返回）
    handle_path /assets/* {
        root * /root/deploy-package/dist
        file_server
    }

    # ④ LexiLearn 兜底
    reverse_proxy localhost:3000
}
```

注意事项：

- `handle_path /jd_view/*` 要求**尾部斜杠**才能匹配 `/jd_view/`，直接访问 `/jd_view`（无斜杠）会漏掉。
- Caddy 路径匹配**大小写敏感**，`/JD_VIEW` 与 `/jd_view` 需通过 `path_regexp` 的 `(?i)` 标志统一（见下方更稳妥写法）。
- `handle` 块按声明顺序互斥匹配、命中即终止。

更稳妥的写法（大小写不敏感 + 带/不带尾部斜杠都匹配）：

```caddyfile
    @jdview path_regexp jdview ^/jd_view(/.*)?$ (?i)
    handle @jdview {
        uri strip_prefix /jd_view
        root * /var/www/lexilearn/jd_view
        file_server
    }
```

### 3.2 前端 PWA 层：SW 导航兜底排除清单

`vite.config.js` 的 workbox 配置增加 `navigateFallbackDenylist`，让子路径导航直连网络、不返回应用壳：

```js
workbox: {
  // ...
  navigateFallback: 'index.html',
  // 加 i 标志：与 Caddy 侧 path_regexp (?i) 大小写不敏感保持一致
  navigateFallbackDenylist: [/^\/jd_view($|\/)/i, /^\/lx_vibe($|\/)/i],
}
```

**必须加 `i` 标志**，否则用户以大写访问 `/JD_VIEW` 时 SW 仍会拦截（本次 BUG 的最后一个隐藏点）。

生成的正则形式：`^\/jd_view($|\/)` 匹配 `/jd_view` 及 `/jd_view/...`，不误伤 `/jd_viewer` 等路径。

### 3.3 服务器层：`sw.js` / `workbox-*.js` 禁止缓存

浏览器对 `sw.js` 默认有 **24 小时缓存上限**。若不加控制，部署新版 SW 后旧 SW 可能继续工作一整天。

`server.js` 的 `serveStatic()` 中对 SW 相关文件设置禁止缓存：

```js
const baseName = path.basename(filePath);
if (baseName === 'sw.js' || baseName.startsWith('workbox-')) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}
```

Caddy 侧也可以对 `/sw.js` 强制 no-cache（双保险）：

```caddyfile
    @sw path /sw.js
    header @sw Cache-Control "no-cache, no-store, must-revalidate"
```

## 4. 可配置项：新增子路径免改代码

`vite.config.js` 从 `.env` 读取 `LEXILEARN_SW_EXCLUDES`，默认内置 `jd_view` / `lx_vibe`，新增子路径时在 `.env` 追加即可：

```env
# 逗号分隔的子路径前缀，自动合并到 SW 的 navigateFallbackDenylist
LEXILEARN_SW_EXCLUDES=docs,blog
```

逻辑：

```js
const DEFAULT_SW_EXCLUDED_PATHS = ['jd_view', 'lx_vibe'];

function buildSwDenylist(excludedPaths) {
  return excludedPaths
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .map((p) => new RegExp(`^\\/${p}($|\\/)`, 'i'));
}

const env = loadEnv(mode, process.cwd(), '');
const extraPaths = (env.LEXILEARN_SW_EXCLUDES || '').split(',').map((s) => s.trim()).filter(Boolean);
// 合并：buildSwDenylist([...DEFAULT_SW_EXCLUDED_PATHS, ...extraPaths])
```

## 5. 未来新增子路径的标准流程

以新增 `/docs` 为例：

1. **Caddyfile** 加静态站点规则（放在兜底之前），如 `handle_path /docs/* { root * /var/www/lexilearn/docs; file_server }`。
2. **.env** 加 `LEXILEARN_SW_EXCLUDES=docs`（追加，不删已有项）。
3. **重新构建部署**：`npm run build` 或 `deploy.bat` → 上传 `dist/` 覆盖服务器。
4. 浏览器打开一次 `https://lexilearn.cloud/`，新版 SW 自动接管（`skipWaiting` + `clientsClaim`）。

## 6. 验证清单

服务器侧：

```bash
# 子路径直接返回其站点内容（200），而非 LexiLearn 首页
curl -I https://lexilearn.cloud/jd_view/
curl -I https://lexilearn.cloud/JD_VIEW/        # 大写也要测

# sw.js 已含大小写不敏感的 denylist
curl -s https://lexilearn.cloud/sw.js | grep -o "denylist:\[[^]]*\]"
# 期望：denylist:[/^\/jd_view($|\/)/i,/^\/lx_vibe($|\/)/i]

# sw.js 不带缓存
curl -I https://lexilearn.cloud/sw.js | grep -i cache-control
```

浏览器侧：

- 普通窗口访问 `https://lexilearn.cloud/JD_VIEW/`（大写）停留简历页不跳转。
- 若旧 SW 仍在拦截：DevTools → Application → Service Workers → Unregister → 刷新。

## 7. 排查经验记录

| 现象 | 结论 |
|------|------|
| 无痕模式正常、普通模式跳转 | 典型 SW 特征，非 HTTP 缓存问题 |
| `curl` 返回 200 简历页但浏览器跳转 | curl 无 SW，请求直达 Caddy；浏览器被 SW 拦截 |
| 服务器 `sw.js` 不含 `/i` | 新 dist 未上传或未覆盖，注意 `sw.js` 与 `workbox-*.js` 需同步更新 |
| 部署后仍跳转 | 先注销浏览器旧 SW（`Unregister`），no-cache 头可防止今后复发 |

## 8. 涉及文件

- `vite.config.js`：`navigateFallbackDenylist` + `LEXILEARN_SW_EXCLUDES` 环境变量支持
- `server.js`：`sw.js` / `workbox-*` 禁止缓存
- `.env.example`：`LEXILEARN_SW_EXCLUDES` 配置项说明
- 服务器 `/etc/caddy/Caddyfile`：子路径分流规则 + `/sw.js` no-cache

## 9. 线上部署状态与同步提醒（重要）

> 本节点记录 2026-08-31 本次线上修复的实际操作，防止后续部署覆盖掉手改内容。

### 9.1 当前线上状态

- **服务器 `/root/deploy-package/dist/sw.js` 已被手动修改**：denylist 加上了 `/i` 标志
  （因为最初多次上传 dist 都未生效，最后在服务器上直接改了文件内容）。
- 该手改内容与仓库中 `vite.config.js` 重新构建出的 `sw.js` 产物一致。
- **注意**：`sw.js` 内容取决于构建产物，若后续重新构建并整体覆盖 `dist/`，手改会被
  新构建产物替换。由于新构建产物本身就含 `/i`，替换后仍是正确状态，无需担心。

### 9.2 待同步项（务必执行，否则线上与仓库不一致）

| 项 | 说明 |
|----|------|
| `deploy-package/server.js` | 本地最新版含 `sw.js`/`workbox-*` no-cache 逻辑；若服务器上的 `server.js` 还是旧版（无此逻辑），需上传覆盖并 `pm2 restart lexilearn` |
| `/etc/caddy/Caddyfile` | 若未添加 `/sw.js` no-cache 头（`@sw path /sw.js` + `header @sw Cache-Control ...`），建议补上（server.js 已有 no-cache，此为双保险，可省略） |
| 浏览器旧 SW | 曾访问过站点的浏览器需注销一次旧 SW（DevTools → Application → Service Workers → Unregister → 刷新），否则旧 SW 会继续拦截到缓存过期 |

### 9.3 后续标准发布流程（避免再踩坑）

1. 本地 `npm run build`（或 `deploy.bat`）生成新 `dist/`。
2. 上传 `deploy-package/` 到服务器**整体替换** `dist/`（含 `sw.js` 与 `workbox-*.js` 必须同步更新），并上传 `server.js`。
3. `pm2 restart lexilearn`。
4. 验证 `curl -s https://lexilearn.cloud/sw.js | grep -o "denylist:\[[^]]*\]"` 输出含 `/i`。
5. 验证 `curl -I https://lexilearn.cloud/sw.js | grep -i cache-control` 输出 no-cache。
6. 浏览器打开一次 `https://lexilearn.cloud/` 让新版 SW 自动接管。

