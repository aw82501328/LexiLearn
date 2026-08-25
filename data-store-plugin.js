import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  isAdmin, setUserRole, getUserList,
  logActivity, incrementUsage, getUsage, loadLimits, saveLimits, checkQuota, checkFileSize,
  getUserDaily, getUserActivity, getGlobalStats, getUserTodayStats,
  getRoleList, saveRolesConfig, deleteUser, setUserMembership,
} from './src/services/adminServer.js';

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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}
loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env'));

const DATA_DIR = process.env.DATA_DIR || '/root/eldata';
const JWT_SECRET = process.env.JWT_SECRET || 'lexilearn-dev-secret';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TRANSLATION_CACHE_FILE = path.join(DATA_DIR, 'translations.json');

const TENCENT_ID = process.env.TENCENT_SECRET_ID || '';
const TENCENT_KEY = process.env.TENCENT_SECRET_KEY || '';
console.log('[翻译] 腾讯云 TMT API:', (TENCENT_ID && TENCENT_KEY) ? '已启用' : '未配置');

// ── 翻译缓存 ──
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

let cacheSaveTimer = null;
function flushCacheSoon() {
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(() => { cacheSaveTimer = null; saveTranslationCache(); }, 2000);
}

// ── 腾讯云 API V3 签名（无需 SDK）──
function sha256Hex(msg) {
  return crypto.createHash('sha256').update(msg, 'utf-8').digest('hex');
}
function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf-8').digest();
}

/** 调用腾讯云 TMT API（V3 签名） */
async function tmtApiCall(action, params) {
  const host = 'tmt.tencentcloudapi.com';
  const service = 'tmt';
  const region = 'ap-beijing';
  const version = '2018-03-21';
  const algorithm = 'TC3-HMAC-SHA256';

  const payload = JSON.stringify(params);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // 1. Canonical Request
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json\nhost:${host}\n`,
    'content-type;host',
    sha256Hex(payload),
  ].join('\n');

  // 2. String to Sign
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm,
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // 3. Signature
  const kDate = hmacSha256('TC3' + TENCENT_KEY, date);
  const kService = hmacSha256(kDate, service);
  const kSigning = hmacSha256(kService, 'tc3_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  // 4. Authorization header
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
    const data = await tmtApiCall('TextTranslate', {
      SourceText: text,
      Source: 'en',
      Target: 'zh',
      ProjectId: 0,
    });
    const result = data?.TargetText || '';
    if (result) { translationCache[key] = result; flushCacheSoon(); return result; }
    console.warn('[翻译] TMT 返回空结果, text:', text.slice(0, 50));
  }

  return '';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {}
  return [];
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function verifyToken(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try { return jwt.verify(auth.slice(7), JWT_SECRET); } catch { return null; }
}

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
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

export default function dataStorePlugin() {
  ensureDir(DATA_DIR);

  return {
    name: 'data-store-plugin',
    configureServer(server) {
      // ── Auth Routes ──
      server.middlewares.use('/api/auth/register', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        const { text } = await parseBody(req);
        try {
          const { username, password } = JSON.parse(text);
          if (!username || !password) return json(res, { error: '用户名和密码不能为空' }, 400);
          if (username.length < 2) return json(res, { error: '用户名至少 2 个字符' }, 400);
          if (password.length < 4) return json(res, { error: '密码至少 4 个字符' }, 400);
          const users = loadUsers();
          if (users.find((u) => u.username === username)) return json(res, { error: '用户名已存在' }, 409);
          const hash = await bcrypt.hash(password, 10);
          const user = { id: Date.now().toString(36), username, password: hash, createdAt: Date.now(), membership: 'basic' };
          users.push(user);
          saveUsers(users);

          const role = isAdmin(DATA_DIR, user.id) ? 'admin' : 'user';
          const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '30d' });
          return json(res, { token, user: { id: user.id, username: user.username, role, membership: 'basic' } });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/auth/login', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        const { text } = await parseBody(req);
        try {
          const { username, password } = JSON.parse(text);
          const users = loadUsers();
          const user = users.find((u) => u.username === username);
          if (!user || !(await bcrypt.compare(password, user.password))) return json(res, { error: '用户名或密码错误' }, 401);
          const role = isAdmin(DATA_DIR, user.id) ? 'admin' : 'user';
          const membership = user.membership || 'basic';
          const token = jwt.sign({ userId: user.id, username: user.username, role, membership }, JWT_SECRET, { expiresIn: '30d' });
          return json(res, { token, user: { id: user.id, username: user.username, role, membership } });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/auth/me', (req, res) => {
        if (req.method !== 'GET') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        const role = isAdmin(DATA_DIR, payload.userId) ? 'admin' : 'user';
        const users = loadUsers();
        const u = users.find((u) => u.id === payload.userId);
        const membership = u?.membership || 'basic';
        return json(res, { user: { id: payload.userId, username: payload.username, role, membership } });
      });

      // ── Data Routes (用户隔离) ──
      function getUserDir(req, res) {
        const payload = verifyToken(req);
        if (!payload) { json(res, { error: '未登录' }, 401); return null; }
        const dir = path.join(DATA_DIR, payload.userId);
        ensureDir(dir);
        return dir;
      }

      server.middlewares.use('/api/save', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        const userDir = getUserDir(req, res);
        if (!userDir) return;
        const { text } = await parseBody(req);
        try {
          const { id, data } = JSON.parse(text);
          if (!id || !data) return json(res, { error: '缺少 id 或 data' }, 400);
          const { text: _t, pages: _p, ...metaOnly } = data;
          fs.writeFileSync(path.join(userDir, `${id}.json`), JSON.stringify(metaOnly, null, 2), 'utf-8');
          return json(res, { ok: true, id });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/load', async (req, res) => {
        if (req.method !== 'GET') return json(res, { error: 'Method Not Allowed' }, 405);
        const userDir = getUserDir(req, res);
        if (!userDir) return;
        const { query } = await parseBody(req);
        const id = query.id;
        if (!id) return json(res, { error: '缺少 id' }, 400);
        const fp = path.join(userDir, `${id}.json`);
        if (!fs.existsSync(fp)) return json(res, { error: '文件不存在' }, 404);
        try { res.setHeader('Content-Type', 'application/json'); return res.end(fs.readFileSync(fp, 'utf-8')); }
        catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/files', (req, res) => {
        const userDir = getUserDir(req, res);
        if (!userDir) return;
        try {
          const files = fs.readdirSync(userDir)
            .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
            .map((f) => {
              const raw = fs.readFileSync(path.join(userDir, f), 'utf-8');
              const { id, name, size, createdAt, readingProgress, wordCount } = JSON.parse(raw);
              return { id, name, size, createdAt, readingProgress, wordCount: wordCount || 0 };
            });
          return json(res, files);
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/delete', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        const userDir = getUserDir(req, res);
        if (!userDir) return;
        const { text } = await parseBody(req);
        try {
          const { id } = JSON.parse(text);
          const jp = path.join(userDir, `${id}.json`);
          if (fs.existsSync(jp)) fs.unlinkSync(jp);
          return json(res, { ok: true });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      // ── 行为数据 API（生词本 + 统计）──

      server.middlewares.use('/api/vocabulary/sync', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        if (!verifyToken(req)) return json(res, { error: '未登录' }, 401);
        const { text: body } = await parseBody(req);
        try {
          const { vocabulary } = JSON.parse(body);
          if (!Array.isArray(vocabulary)) return json(res, { error: '格式错误' }, 400);
          const userDir = path.join(DATA_DIR, verifyToken(req).userId);
          ensureDir(userDir);
          fs.writeFileSync(path.join(userDir, '_vocabulary.json'), JSON.stringify(vocabulary, null, 2), 'utf-8');
          return json(res, { ok: true, count: vocabulary.length });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/vocabulary', (req, res) => {
        if (req.method !== 'GET') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        const vp = path.join(DATA_DIR, payload.userId, '_vocabulary.json');
        if (!fs.existsSync(vp)) return json(res, []);
        try { res.setHeader('Content-Type', 'application/json'); return res.end(fs.readFileSync(vp, 'utf-8')); }
        catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/stats/record', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        const { text: body } = await parseBody(req);
        try {
          const { type } = JSON.parse(body);
          if (!['translation', 'tts'].includes(type)) return json(res, { error: '无效统计类型' }, 400);
          const userDir = path.join(DATA_DIR, payload.userId);
          ensureDir(userDir);
          const sp = path.join(userDir, '_stats.json');
          const stats = fs.existsSync(sp)
            ? JSON.parse(fs.readFileSync(sp, 'utf-8'))
            : { translationCount: 0, ttsCount: 0 };
          if (type === 'translation') stats.translationCount++;
          if (type === 'tts') stats.ttsCount++;
          fs.writeFileSync(sp, JSON.stringify(stats, null, 2), 'utf-8');
          return json(res, { ok: true, stats });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/stats', (req, res) => {
        if (req.method !== 'GET') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        const sp = path.join(DATA_DIR, payload.userId, '_stats.json');
        if (!fs.existsSync(sp)) return json(res, { translationCount: 0, ttsCount: 0 });
        try { res.setHeader('Content-Type', 'application/json'); return res.end(fs.readFileSync(sp, 'utf-8')); }
        catch (e) { return json(res, { error: e.message }, 500); }
      });

      // ── 行为追踪 & 配额 ──

      server.middlewares.use('/api/activity/log', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        const { text } = await parseBody(req);
        try {
          const { type, data } = JSON.parse(text);
          if (!type) return json(res, { error: '缺少 type' }, 400);

          if (type === 'translate' || type === 'tts' || type === 'dict' || type === 'practice' || type === 'upload') {
            const q = checkQuota(DATA_DIR, payload.userId, type);
            if (!q.ok) return json(res, { error: q.reason }, 429);
          }

          const count = logActivity(DATA_DIR, payload.userId, type, data || {});
          incrementUsage(DATA_DIR, payload.userId, type);
          return json(res, { ok: true, count });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });

      server.middlewares.use('/api/user/limits', (req, res) => {
        if (req.method !== 'GET') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        const limits = loadLimits(DATA_DIR, payload.userId);
        const usage = getUsage(DATA_DIR, payload.userId);
        return json(res, { limits, usage });
      });

      // 用户今日数据（阅读时长/阅读单词数/翻译单词数）
      server.middlewares.use('/api/user/daily', (req, res) => {
        if (req.method !== 'GET') return json(res, { error: 'Method Not Allowed' }, 405);
        const payload = verifyToken(req);
        if (!payload) return json(res, { error: '未登录' }, 401);
        return json(res, getUserTodayStats(DATA_DIR, payload.userId));
      });

      // ── 管理 API ──

      function requireAdmin(payload) {
        if (!payload) return false;
        return isAdmin(DATA_DIR, payload.userId);
      }

      server.middlewares.use('/api/admin', async (req, res) => {
        const payload = verifyToken(req);
        if (!requireAdmin(payload)) return json(res, { error: '无权限' }, 403);

        // req.url 已去掉 /api/admin 前缀

        // ── 角色管理 ──
        if (req.url === '/roles' && req.method === 'GET') {
          return json(res, getRoleList(DATA_DIR));
        }
        if (req.url === '/roles' && req.method === 'POST') {
          const { text } = await parseBody(req);
          try {
            const { roles } = JSON.parse(text);
            if (!Array.isArray(roles)) return json(res, { error: 'roles 必须为数组' }, 400);
            const cfg = saveRolesConfig(DATA_DIR, roles);
            return json(res, { ok: true, roles: cfg.roles });
          } catch (e) { return json(res, { error: e.message }, 500); }
        }

        // ── 用户列表 ──
        if (req.url === '/users' && req.method === 'GET') {
          return json(res, getUserList(DATA_DIR));
        }

        // ── 全局统计 ──
        if (req.url === '/stats/global' && req.method === 'GET') {
          return json(res, getGlobalStats(DATA_DIR));
        }

        // ── /users/:uid 及子路由 ──
        const match = req.url.match(/^\/users\/([^/]+)(\/(\w+))?/);
        if (match) {
          const uid = match[1];
          const sub = match[3];

          // DELETE /users/:uid — 删除用户
          if (!sub && req.method === 'DELETE') {
            const result = deleteUser(DATA_DIR, uid);
            return json(res, result, result.ok ? 200 : 400);
          }

          if (sub === 'activity' && req.method === 'GET') {
            const { query } = await parseBody(req);
            const limit = parseInt(query.limit) || 50;
            return json(res, getUserActivity(DATA_DIR, uid, limit));
          }
          if (sub === 'daily' && req.method === 'GET') {
            return json(res, getUserDaily(DATA_DIR, uid));
          }
          if (sub === 'limits') {
            if (req.method === 'GET') {
              return json(res, { limits: loadLimits(DATA_DIR, uid), usage: getUsage(DATA_DIR, uid) });
            }
            if (req.method === 'POST') {
              const { text } = await parseBody(req);
              try {
                const limits = JSON.parse(text);
                saveLimits(DATA_DIR, uid, limits);
                return json(res, { ok: true, limits });
              } catch (e) { return json(res, { error: e.message }, 500); }
            }
          }
          if (sub === 'role' && req.method === 'POST') {
            const { text } = await parseBody(req);
            try {
              const { role } = JSON.parse(text);
              if (!['admin', 'user'].includes(role)) return json(res, { error: '无效角色' }, 400);
              const ok = setUserRole(DATA_DIR, uid, role);
              return json(res, { ok, role: ok ? role : 'user' });
            } catch (e) { return json(res, { error: e.message }, 500); }
          }
          if (sub === 'membership' && req.method === 'POST') {
            const { text } = await parseBody(req);
            try {
              const { membership } = JSON.parse(text);
              if (!membership) return json(res, { error: '缺少 membership' }, 400);
              const ok = setUserMembership(DATA_DIR, uid, membership);
              return json(res, { ok, membership: ok ? membership : null });
            } catch (e) { return json(res, { error: e.message }, 500); }
          }
        }
        return json(res, { error: 'Not Found' }, 404);
      });

      // ── 翻译 API ──

      server.middlewares.use('/api/translate/batch', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        if (!verifyToken(req)) return json(res, { error: '未登录' }, 401);
        const { text: body } = await parseBody(req);
        try {
          const { texts } = JSON.parse(body);
          if (!Array.isArray(texts) || texts.length === 0) return json(res, { error: '缺少 texts 数组' }, 400);
          if (texts.length > 50) return json(res, { error: '单次最多 50 条' }, 400);

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
      });

      server.middlewares.use('/api/translate', async (req, res) => {
        if (req.method !== 'POST') return json(res, { error: 'Method Not Allowed' }, 405);
        if (!verifyToken(req)) return json(res, { error: '未登录' }, 401);
        const { text: body } = await parseBody(req);
        try {
          const { text } = JSON.parse(body);
          if (!text || typeof text !== 'string') return json(res, { error: '缺少 text' }, 400);
          if (!(TENCENT_ID && TENCENT_KEY)) return json(res, { error: '翻译服务未配置（缺少 TENCENT_SECRET_ID/TENCENT_SECRET_KEY）' }, 500);
          const result = await doTranslate(text);
          if (!result) return json(res, { error: '翻译失败：TMT API 返回空结果，请检查控制台日志' }, 500);
          return json(res, { text, result });
        } catch (e) { return json(res, { error: e.message }, 500); }
      });
    },
  };
}
