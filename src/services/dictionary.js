/**
 * 词典查询 — 彻底绕开第三方 API，统一走本地后端 TMT 翻译接口
 * 保留原 lookupWord 对外接口（返回 { phonetic, entries }），
 * 但数据来源改为腾讯云机器翻译（TMT），不再直连外部词典服务。
 */

import { getToken } from './auth';

// 内存缓存，避免重复请求
const cache = new Map();

const API_BASE = '/api';

function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export async function lookupWord(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) {
    return cache.get(key);
  }

  const zh = await translateViaTMT(word);
  const result = {
    phonetic: '',
    entries: [{ pos: '', english: zh || '', example: null }],
  };

  cache.set(key, result);
  return result;
}

// 调用本地后端翻译接口（TMT），失败时抛出可读错误
async function translateViaTMT(text) {
  const res = await fetch(`${API_BASE}/translate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '翻译服务暂不可用');
  }
  const data = await res.json();
  if (!data.result) {
    throw new Error(data.error || '翻译结果为空');
  }
  return data.result;
}
