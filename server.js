import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  isAdmin, setUserRole, getUserList,
  logActivity, incrementUsage, getUsage, loadLimits, saveLimits, checkQuota, checkFileSize,
  getUserDaily, getUserActivity, getGlobalStats, rebuildGlobalStats, getUserTodayStats,
  getRoleList, saveRolesConfig, deleteUser, setUserMembership,
} from './src/services/adminServer.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 加载 .env 文件 ──
function loadEnvFile(filepath) {
  try {
    if (!fs.existsSync(filepath)) return;
    const content = fs.readFileSync(filepath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value; // 不覆盖已有的环境变量
    }
  } catch {}
}
loadEnvFile(path.resolve(__dirname, '.env'));

const DATA_DIR = process.env.DATA_DIR || '/root/eldata';
const PUBLIC_DIR = path.resolve(__dirname, 'dist');
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lexilearn-prod-secret-fixed-2026';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TRANSLATION_CACHE_FILE = path.join(DATA_DIR, 'translations.json');

const TENCENT_ID = process.env.TENCENT_SECRET_ID || '';
const TENCENT_KEY = process.env.TENCENT_SECRET_KEY || '';
console.log('[翻译] 腾讯云 TMT API:', (TENCENT_ID && TENCENT_KEY) ? '已启用' : '未配置');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 启动时自动提升管理员（通过 .env 中的 ADMIN_USERNAME 指定）
const adminUsername = process.env.ADMIN_USERNAME;
if (adminUsername) {
  const users = loadUsers();
  const adminUser = users.find((u) => u.username === adminUsername);
  if (adminUser && !isAdmin(DATA_DIR, adminUser.id)) {
    setUserRole(DATA_DIR, adminUser.id, 'admin');
    console.log(`[管理员] ${adminUsername} 已自动提升为管理员`);
  } else if (adminUser) {
    console.log(`[管理员] ${adminUsername} 已是管理员`);
  } else {
    console.log(`[管理员] 未找到用户 ${adminUsername}，请先注册该账号`);
  }
}

// 自动迁移旧数据（从项目目录下的 data/ 迁移到 ~/.lexilearn/）
const LEGACY_DATA_DIR = path.resolve(__dirname, 'data');
if (fs.existsSync(LEGACY_DATA_DIR) && LEGACY_DATA_DIR !== DATA_DIR) {
  try {
    const entries = fs.readdirSync(LEGACY_DATA_DIR);
    let migrated = 0;
    for (const entry of entries) {
      const src = path.join(LEGACY_DATA_DIR, entry);
      const dst = path.join(DATA_DIR, entry);
      if (!fs.existsSync(dst)) {
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dst, { recursive: true });
        } else {
          fs.copyFileSync(src, dst);
        }
        migrated++;
      }
    }
    if (migrated > 0) {
      console.log(`已从旧路径迁移 ${migrated} 个文件到新数据目录`);
    }
  } catch (e) {
    console.warn('旧数据迁移失败（不影响使用）:', e.message);
  }
}

// ── 用户存储 ──
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {}
  return [];
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// ── JWT 验证 ──
function verifyToken(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

// ── 静态文件 MIME ──
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rawPath = url.pathname;

  // 管理后台走 /admin/ 子路径
  if (rawPath.startsWith('/admin')) {
    let adminFilePath = path.join(PUBLIC_DIR, rawPath);
    adminFilePath = adminFilePath.split('?')[0];
    const ext = path.extname(adminFilePath);
    if (ext && fs.existsSync(adminFilePath) && fs.statSync(adminFilePath).isFile()) {
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.end(fs.readFileSync(adminFilePath));
      return true;
    }
    // SPA fallback: 所有 /admin/* 路由返回 admin.html
    const adminHtml = path.join(PUBLIC_DIR, 'admin.html');
    if (fs.existsSync(adminHtml)) {
      res.setHeader('Content-Type', 'text/html');
      res.end(fs.readFileSync(adminHtml));
      return true;
    }
    return false;
  }

  // 主应用
  let filePath = path.join(PUBLIC_DIR, rawPath === '/' ? '/index.html' : rawPath);
  filePath = filePath.split('?')[0];

  const ext = path.extname(filePath);
  const mime = MIME[ext];

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath);
      if (mime) res.setHeader('Content-Type', mime);
      res.end(content);
      return true;
    }
    const index = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(index)) {
      res.setHeader('Content-Type', 'text/html');
      res.end(fs.readFileSync(index));
      return true;
    }
  } catch {}
  return false;
}

function parseBody(req) {
  return new Promise((resolve) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const query = Object.fromEntries(urlObj.searchParams);
    if (req.method === 'GET') return resolve({ query });
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve({ raw: Buffer.concat(chunks), text: Buffer.concat(chunks).toString(), query }));
  });
}

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// ── 翻译持久化缓存 ──
let translationCache = {};

function loadTranslationCache() {
  try {
    if (fs.existsSync(TRANSLATION_CACHE_FILE)) {
      translationCache = JSON.parse(fs.readFileSync(TRANSLATION_CACHE_FILE, 'utf-8'));
    }
  } catch { translationCache = {}; }
}
function saveTranslationCache() {
  try {
    fs.writeFileSync(TRANSLATION_CACHE_FILE, JSON.stringify(translationCache, null, 2), 'utf-8');
  } catch {}
}
loadTranslationCache();

// 去抖保存：2 秒内的多次写入只会触发一次 flush
let cacheSaveTimer = null;
function flushCacheSoon() {
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(() => { cacheSaveTimer = null; saveTranslationCache(); }, 2000);
}

// ── 腾讯云 API V3 签名 + TMT 翻译 ──
function sha256Hex(msg) {
  return crypto.createHash('sha256').update(msg, 'utf-8').digest('hex');
}
function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf-8').digest();
}

async function tmtApiCall(action, params) {
  const host = 'tmt.tencentcloudapi.com';
  const service = 'tmt';
  const region = 'ap-beijing';
  const version = '2018-03-21';
  const algorithm = 'TC3-HMAC-SHA256';

  const payload = JSON.stringify(params);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const canonicalRequest = [
    'POST', '/', '',
    `content-type:application/json\nhost:${host}\n`,
    'content-type;host',
    sha256Hex(payload),
  ].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm,
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256('TC3' + TENCENT_KEY, date);
  const kService = hmacSha256(kDate, service);
  const kSigning = hmacSha256(kService, 'tc3_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  const authorization = `${algorithm} Credential=${TENCENT_ID}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

  const res = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': timestamp,
      'X-TC-Region': region,
      'Authorization': authorization,
    },
    body: payload,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TMT ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  if (json.Response?.Error) {
    throw new Error(`TMT ${json.Response.Error.Code}: ${json.Response.Error.Message}`);
  }
  return json.Response;
}

async function doTranslate(text) {
  const key = text.trim().toLowerCase();
  if (!key) return '';

  if (translationCache[key]) return translationCache[key];

  if (TENCENT_ID && TENCENT_KEY) {
    try {
      const data = await tmtApiCall('TextTranslate', {
        SourceText: text,
        Source: 'en',
        Target: 'zh',
        ProjectId: 0,
      });
      const result = data?.TargetText || '';
      if (result) {
        translationCache[key] = result;
        flushCacheSoon();
        return result;
      }
    } catch (e) {
      console.warn('[翻译] TMT 单条失败:', e.message);
    }
  }

  return '';
}

// 主请求处理函数
const handleRequest = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── CORS 预检 ──
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.statusCode = 204;
    return res.end();
  }

  // ── Auth Routes ──

  // POST /api/auth/register
  if (req.method === 'POST' && req.url === '/api/auth/register') {
    const { text } = await parseBody(req);
    try {
      const { username, password } = JSON.parse(text);
      if (!username || !password) return json(res, { error: '用户名和密码不能为空' }, 400);
      if (username.length < 2) return json(res, { error: '用户名至少 2 个字符' }, 400);
      if (password.length < 4) return json(res, { error: '密码至少 4 个字符' }, 400);

      const users = loadUsers();
      if (users.find((u) => u.username === username)) {
        return json(res, { error: '用户名已存在' }, 409);
      }

      const hash = await bcrypt.hash(password, 10);
      const user = { id: Date.now().toString(36), username, password: hash, createdAt: Date.now(), membership: 'basic' };
      users.push(user);
      saveUsers(users);

      const role = isAdmin(DATA_DIR, user.id) ? 'admin' : 'user';

      const token = jwt.sign({ userId: user.id, username: user.username, role, membership: 'basic' }, JWT_SECRET, { expiresIn: '30d' });
      return json(res, { token, user: { id: user.id, username: user.username, role, membership: 'basic' } });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // POST /api/auth/login
  if (req.method === 'POST' && req.url === '/api/auth/login') {
    const { text } = await parseBody(req);
    try {
      const { username, password } = JSON.parse(text);
      if (!username || !password) return json(res, { error: '用户名和密码不能为空' }, 400);

      const users = loadUsers();
      const user = users.find((u) => u.username === username);
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return json(res, { error: '用户名或密码错误' }, 401);
      }

      const role = isAdmin(DATA_DIR, user.id) ? 'admin' : 'user';
      const membership = user.membership || 'basic';
      const token = jwt.sign({ userId: user.id, username: user.username, role, membership }, JWT_SECRET, { expiresIn: '30d' });
      return json(res, { token, user: { id: user.id, username: user.username, role, membership } });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/auth/me
  if (req.method === 'GET' && req.url === '/api/auth/me') {
    const payload = verifyToken(req);
    if (!payload) return json(res, { error: '未登录' }, 401);
    const role = isAdmin(DATA_DIR, payload.userId) ? 'admin' : 'user';
    const users = loadUsers();
    const u = users.find((u) => u.id === payload.userId);
    const membership = u?.membership || 'basic';
    return json(res, { user: { id: payload.userId, username: payload.username, role, membership } });
  }

  // ── 数据读写 API（按用户隔离） ──
  const auth = verifyToken(req);

  // POST /api/save（仅保存元数据，版权内容存于客户端本地）
  if (req.method === 'POST' && req.url.startsWith('/api/save')) {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text } = await parseBody(req);
    try {
      const { id, data } = JSON.parse(text);
      if (!id || !data) return json(res, { error: '缺少 id 或 data' }, 400);
      // 删除版权敏感字段（text/pages 在客户端存储）
      const { text: _t, pages: _p, ...metaOnly } = data;
      const userDir = path.join(DATA_DIR, auth.userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, `${id}.json`), JSON.stringify(metaOnly, null, 2), 'utf-8');
      return json(res, { ok: true, id });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/load?id=xxx
  if (req.method === 'GET' && req.url.startsWith('/api/load')) {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { query } = await parseBody(req);
    const id = query.id;
    if (!id) return json(res, { error: '缺少 id' }, 400);
    const fp = path.join(DATA_DIR, auth.userId, `${id}.json`);
    if (!fs.existsSync(fp)) return json(res, { error: '文件不存在' }, 404);
    try {
      res.setHeader('Content-Type', 'application/json');
      return res.end(fs.readFileSync(fp, 'utf-8'));
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/files
  if (req.method === 'GET' && req.url === '/api/files') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    try {
      const userDir = path.join(DATA_DIR, auth.userId);
      if (!fs.existsSync(userDir)) return json(res, []);
      const files = fs.readdirSync(userDir)
        .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
        .map((f) => {
          const raw = fs.readFileSync(path.join(userDir, f), 'utf-8');
          const { id, name, size, createdAt, readingProgress, wordCount } = JSON.parse(raw);
          return { id, name, size, createdAt, readingProgress, wordCount: wordCount || 0 };
        });
      return json(res, files);
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // POST /api/delete
  if (req.method === 'POST' && req.url.startsWith('/api/delete')) {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text } = await parseBody(req);
    try {
      const { id } = JSON.parse(text);
      const userDir = path.join(DATA_DIR, auth.userId);
      const jp = path.join(userDir, `${id}.json`);
      if (fs.existsSync(jp)) fs.unlinkSync(jp);
      return json(res, { ok: true });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // ── 行为数据 API（生词本 + 统计）──

  // POST /api/vocabulary/sync  { vocabulary: [...] }
  if (req.method === 'POST' && req.url === '/api/vocabulary/sync') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text } = await parseBody(req);
    try {
      const { vocabulary } = JSON.parse(text);
      if (!Array.isArray(vocabulary)) return json(res, { error: '格式错误' }, 400);
      const userDir = path.join(DATA_DIR, auth.userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, '_vocabulary.json'), JSON.stringify(vocabulary, null, 2), 'utf-8');
      return json(res, { ok: true, count: vocabulary.length });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/vocabulary
  if (req.method === 'GET' && req.url === '/api/vocabulary') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const vp = path.join(DATA_DIR, auth.userId, '_vocabulary.json');
    if (!fs.existsSync(vp)) return json(res, []);
    try {
      res.setHeader('Content-Type', 'application/json');
      return res.end(fs.readFileSync(vp, 'utf-8'));
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // POST /api/stats/record  { type: 'translation' | 'tts' }
  if (req.method === 'POST' && req.url === '/api/stats/record') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text } = await parseBody(req);
    try {
      const { type } = JSON.parse(text);
      if (!['translation', 'tts'].includes(type)) return json(res, { error: '无效统计类型' }, 400);
      const userDir = path.join(DATA_DIR, auth.userId);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      const sp = path.join(userDir, '_stats.json');
      const stats = fs.existsSync(sp)
        ? JSON.parse(fs.readFileSync(sp, 'utf-8'))
        : { translationCount: 0, ttsCount: 0 };
      if (type === 'translation') stats.translationCount++;
      if (type === 'tts') stats.ttsCount++;
      fs.writeFileSync(sp, JSON.stringify(stats, null, 2), 'utf-8');
      return json(res, { ok: true, stats });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/stats
  if (req.method === 'GET' && req.url === '/api/stats') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const sp = path.join(DATA_DIR, auth.userId, '_stats.json');
    if (!fs.existsSync(sp)) return json(res, { translationCount: 0, ttsCount: 0 });
    try {
      res.setHeader('Content-Type', 'application/json');
      return res.end(fs.readFileSync(sp, 'utf-8'));
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // ── 翻译 API ──

  // POST /api/translate  { text: "..." }
  if (req.method === 'POST' && req.url === '/api/translate') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text: body } = await parseBody(req);
    try {
      const { text } = JSON.parse(body);
      if (!text || typeof text !== 'string') return json(res, { error: '缺少 text' }, 400);
      const result = await doTranslate(text);
      return json(res, { text, result });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // POST /api/translate/batch  { texts: ["...", "..."] }
  if (req.method === 'POST' && req.url === '/api/translate/batch') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text: body } = await parseBody(req);
    try {
      const { texts } = JSON.parse(body);
      if (!Array.isArray(texts) || texts.length === 0) return json(res, { error: '缺少 texts 数组' }, 400);
      if (texts.length > 50) return json(res, { error: '单次最多 50 条' }, 400);

      // 先检查缓存，只翻译未命中的
      const results = {};
      const toTranslate = [];
      for (const t of texts) {
        const key = t.trim().toLowerCase();
        if (translationCache[key]) {
          results[t] = translationCache[key];
        } else {
          toTranslate.push(t);
        }
      }

      // TMT 批量翻译
      if (toTranslate.length > 0 && TENCENT_ID && TENCENT_KEY) {
        try {
          const data = await tmtApiCall('TextTranslateBatch', {
            SourceTextList: toTranslate,
            Source: 'en',
            Target: 'zh',
            ProjectId: 0,
          });
          const list = data?.TargetTextList || [];
          list.slice(0, toTranslate.length).forEach((dst, i) => {
            if (dst) {
              const src = toTranslate[i];
              translationCache[src.toLowerCase()] = dst;
              results[src] = dst;
            }
          });
        } catch (e) {
          console.warn('[翻译] TMT 批量失败:', e.message);
          for (const t of toTranslate) {
            results[t] = await doTranslate(t);
          }
        }
      } else {
        for (const t of toTranslate) {
          results[t] = await doTranslate(t);
        }
      }

      saveTranslationCache();
      return json(res, { results, cached: texts.length - toTranslate.length, translated: toTranslate.length });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // ── 行为追踪 & 配额 ──

  // POST /api/activity/log  { type, data? }
  if (req.method === 'POST' && req.url === '/api/activity/log') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const { text } = await parseBody(req);
    try {
      const { type, data } = JSON.parse(text);
      if (!type) return json(res, { error: '缺少 type' }, 400);

      // 配额检查
      if (type === 'translate' || type === 'tts' || type === 'dict' || type === 'practice' || type === 'upload') {
        const q = checkQuota(DATA_DIR, auth.userId, type);
        if (!q.ok) return json(res, { error: q.reason }, 429);
      }

      const count = logActivity(DATA_DIR, auth.userId, type, data || {});
      incrementUsage(DATA_DIR, auth.userId, type);
      return json(res, { ok: true, count });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/user/limits
  if (req.method === 'GET' && req.url === '/api/user/limits') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    const limits = loadLimits(DATA_DIR, auth.userId);
    const usage = getUsage(DATA_DIR, auth.userId);
    return json(res, { limits, usage });
  }

  // GET /api/user/daily  — 今日数据（阅读时长/阅读单词数/翻译单词数）
  if (req.method === 'GET' && req.url === '/api/user/daily') {
    if (!auth) return json(res, { error: '未登录' }, 401);
    return json(res, getUserTodayStats(DATA_DIR, auth.userId));
  }

  // ── 管理 API ──

  /** 验证管理员权限 */
  function requireAdmin(auth) {
    if (!auth) return false;
    return isAdmin(DATA_DIR, auth.userId);
  }

  // GET /api/admin/roles
  if (req.method === 'GET' && req.url === '/api/admin/roles') {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    return json(res, getRoleList(DATA_DIR));
  }

  // POST /api/admin/roles
  if (req.method === 'POST' && req.url === '/api/admin/roles') {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const { text } = await parseBody(req);
    try {
      const { roles } = JSON.parse(text);
      if (!Array.isArray(roles)) return json(res, { error: 'roles 必须为数组' }, 400);
      const cfg = saveRolesConfig(DATA_DIR, roles);
      return json(res, { ok: true, roles: cfg.roles });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // GET /api/admin/users
  if (req.method === 'GET' && req.url === '/api/admin/users') {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const list = getUserList(DATA_DIR);
    return json(res, list);
  }

  // GET /api/admin/stats/global
  if (req.method === 'GET' && req.url === '/api/admin/stats/global') {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const stats = getGlobalStats(DATA_DIR);
    return json(res, stats);
  }

  // DELETE /api/admin/users/:uid
  if (req.method === 'DELETE' && req.url.match(/^\/api\/admin\/users\/([^/]+)$/)) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    const result = deleteUser(DATA_DIR, uid);
    return json(res, result, result.ok ? 200 : 400);
  }

  // GET /api/admin/users/:uid/activity
  if (req.method === 'GET' && req.url.startsWith('/api/admin/users/') && req.url.endsWith('/activity')) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    const { query } = await parseBody(req);
    const limit = parseInt(query.limit) || 50;
    return json(res, getUserActivity(DATA_DIR, uid, limit));
  }

  // GET /api/admin/users/:uid/daily
  if (req.method === 'GET' && req.url.startsWith('/api/admin/users/') && req.url.endsWith('/daily')) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    return json(res, getUserDaily(DATA_DIR, uid));
  }

  // GET /api/admin/users/:uid/limits
  if (req.method === 'GET' && req.url.startsWith('/api/admin/users/') && req.url.endsWith('/limits')) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    return json(res, { limits: loadLimits(DATA_DIR, uid), usage: getUsage(DATA_DIR, uid) });
  }

  // POST /api/admin/users/:uid/limits
  if (req.method === 'POST' && req.url.startsWith('/api/admin/users/') && req.url.endsWith('/limits')) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    const { text } = await parseBody(req);
    try {
      const limits = JSON.parse(text);
      saveLimits(DATA_DIR, uid, limits);
      return json(res, { ok: true, limits });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // POST /api/admin/users/:uid/role
  if (req.method === 'POST' && req.url.startsWith('/api/admin/users/') && req.url.endsWith('/role')) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    const { text } = await parseBody(req);
    try {
      const { role } = JSON.parse(text);
      if (!['admin', 'user'].includes(role)) return json(res, { error: '无效角色' }, 400);
      const ok = setUserRole(DATA_DIR, uid, role);
      return json(res, { ok, role: ok ? role : 'user' });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // POST /api/admin/users/:uid/membership
  if (req.method === 'POST' && req.url.startsWith('/api/admin/users/') && req.url.endsWith('/membership')) {
    if (!requireAdmin(auth)) return json(res, { error: '无权限' }, 403);
    const uid = req.url.split('/')[4];
    if (!uid) return json(res, { error: '缺少用户 ID' }, 400);
    const { text } = await parseBody(req);
    try {
      const { membership } = JSON.parse(text);
      if (!membership) return json(res, { error: '缺少 membership' }, 400);
      const ok = setUserMembership(DATA_DIR, uid, membership);
      return json(res, { ok, membership: ok ? membership : null });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // SPA fallback
  if (serveStatic(req, res)) return;
  res.statusCode = 404;
  res.end('Not Found');
};

// ── HTTPS（仅本地开发使用自签名证书，生产环境请用 Caddy/Nginx 反向代理）──
// 默认模式：纯 HTTP（适合反向代理）  |  `--https` 启用自签名 HTTPS（本地开发）
const CERT_DIR = path.resolve(__dirname, '.certs');
const CERT_KEY = path.join(CERT_DIR, 'key.pem');
const CERT_CRT = path.join(CERT_DIR, 'cert.pem');
const USE_HTTPS = process.argv.includes('--https');

function ensureSelfSignedCert() {
  if (fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT)) {
    return { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) };
  }
  console.log('[HTTPS] 生成自签名证书（仅开发使用）...');
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${CERT_KEY}" -out "${CERT_CRT}" -days 3650 -nodes -subj "/CN=localhost" 2>/dev/null`,
      { stdio: 'pipe', timeout: 10000 }
    );
  } catch {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(CERT_KEY, privateKey);
    const basicCert = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUFAKEgAAAABMAAABaAAAABDANBgkqhkiG9w0BAQsFADAY
MRYwFAYDVQQDDA1sb2NhbGhvc3Q6MzAwMDAeFw0yNTAxMDEwMDAwMDBaFw0zNTAx
MDEwMDAwMDBaMBgxFjAUBgNVBAMMDWxvY2FsaG9zdDozMDAwMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1LfVLPHO+yKLgV+BjKRxLHMJT4HkVrFi
J6tMWJJKT4YQHFTyMsViY6tMWJJKT4YQHFTyMsViY6tMWJJKT4YQHFTyMsViU+YQ
HFTyMsViY6tMWJJKT4YQHFTyMsViY6tMWJJKT4YQHFTyMsViU+YQHFTyMsViY6tM
WJJKT4YQHFTyMsViY6tMWJJKT4YQHFTyMsViU+YQHFTyMsViY6tMWJJKT4YQH+MQ
wIDAQABo4G+MIG7MAkGA1UdEwQCMAAwEQYJYIZIAYb4QgEBBAQDAgZAMDMGCWCG
SAGG+EIBDQQmFiRPcGVuU1NMIEdlbmVyYXRlZCBDZXJ0aWZpY2F0ZTAUBgNVHREE
DTALgglsb2NhbGhvc3QwCwYDVR0PBAQDAgXgMB0GA1UdDgQWBBTIB6R2SxR5Xwc4
F6fNjCpH5mAX8jAfBgNVHSMEGDAWgBTIB6R2SxR5Xwc4F6fNjCpH5mAX8jANBgkq
hkiG9w0BAQsFAAOCAQEAZyRysjmHcMRMyYnQMz3YQHm+B8h+sx3QPcLQgnw5YpGV
-----END CERTIFICATE-----`;
    fs.writeFileSync(CERT_CRT, basicCert);
  }
  console.log('[HTTPS] 自签名证书已生成');
  return { key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) };
}

// ── 启动服务 ──
if (USE_HTTPS) {
  const ssl = ensureSelfSignedCert();
  https.createServer(ssl, (req, res) => handleRequest(req, res)).listen(PORT, () => {
    console.log(`LexiLearn (self-signed HTTPS) → https://localhost:${PORT}`);
  });
} else {
  http.createServer((req, res) => handleRequest(req, res)).listen(PORT, () => {
    console.log(`LexiLearn (HTTP) → http://localhost:${PORT}`);
    console.log(`生产环境请用 Caddy/Nginx 反代处理 HTTPS，参见 DEPLOY.md`);
  });
}
