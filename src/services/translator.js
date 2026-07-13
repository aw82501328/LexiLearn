/**
 * 翻译服务 — 通过后端代理调用百度翻译 API，带持久化缓存
 */

import { getToken } from './auth';

const API_BASE = '/api';

/** 内存缓存（即时查询免网络） */
const memCache = new Map();

function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ── 核心翻译函数 ──

export async function translateToChinese(text) {
  const key = text.toLowerCase();
  const cached = memCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(`${API_BASE}/translate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('翻译请求失败');
    const data = await res.json();
    if (data.result) {
      memCache.set(key, data.result);
      return data.result;
    }
    throw new Error(data.error || '翻译结果为空');
  } catch (e) {
    throw new Error('翻译服务暂不可用，请稍后重试');
  }
}


/** 同步查询内存缓存（不发起网络请求） */
export function getCached(text) {
  return memCache.get(text.toLowerCase());
}

/** 获取内存缓存数量 */
export function getCacheSize() {
  return memCache.size;
}

/** 批量翻译（后端批量接口） */
export async function translateBatch(texts) {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return {};

  const results = {};
  const toTranslate = [];

  for (const t of unique) {
    const key = t.toLowerCase();
    const cached = memCache.get(key);
    if (cached !== undefined) {
      results[t] = cached;
    } else {
      toTranslate.push(t);
    }
  }

  if (toTranslate.length > 0) {
    try {
      const res = await fetch(`${API_BASE}/translate/batch`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ texts: toTranslate }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results) {
          for (const [src, dst] of Object.entries(data.results)) {
            memCache.set(src.toLowerCase(), dst);
            results[src] = dst;
          }
        }
      }
    } catch {
      // 静默失败，results 中缺失的会返回 undefined
    }
  }

  return results;
}
