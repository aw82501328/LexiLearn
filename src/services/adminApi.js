/**
 * 管理 API 客户端
 */
import { getToken } from './auth';

const API_BASE = '/api';

function headers(extra = {}) {
  const h = { ...extra, 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── 用户行为上报 ──
export async function logActivity(type, data = {}) {
  try {
    return await fetchJSON(`${API_BASE}/activity/log`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type, data }),
    });
  } catch (e) {
    if (e.status === 429) throw e;
    console.debug('[activity] log failed:', e.message);
    return null;
  }
}

// ── 用户配额 ──
export async function getUserLimits() {
  return fetchJSON(`${API_BASE}/user/limits`, { headers: headers() });
}

// 用户今日数据（阅读时长/阅读单词数/翻译单词数）
export async function getUserTodayStats() {
  return fetchJSON(`${API_BASE}/user/daily`, { headers: headers() });
}

// ── 管理接口 ──

// 角色管理
export async function getAdminRoles() {
  return fetchJSON(`${API_BASE}/admin/roles`, { headers: headers() });
}

export async function saveAdminRoles(roles) {
  return fetchJSON(`${API_BASE}/admin/roles`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ roles }),
  });
}

// 用户列表
export async function getAdminUsers() {
  return fetchJSON(`${API_BASE}/admin/users`, { headers: headers() });
}

// 删除用户
export async function deleteAdminUser(uid) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}`, {
    method: 'DELETE',
    headers: headers(),
  });
}

// 全局统计
export async function getAdminGlobalStats() {
  return fetchJSON(`${API_BASE}/admin/stats/global`, { headers: headers() });
}

// 用户活动
export async function getAdminUserActivity(uid, limit = 50) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}/activity?limit=${limit}`, { headers: headers() });
}

// 用户每日聚合
export async function getAdminUserDaily(uid) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}/daily`, { headers: headers() });
}

// 用户限制
export async function getAdminUserLimits(uid) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}/limits`, { headers: headers() });
}

export async function setAdminUserLimits(uid, limits) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}/limits`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(limits),
  });
}

// 用户管理员角色
export async function setAdminUserRole(uid, role) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}/role`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ role }),
  });
}

// 用户会员等级
export async function setAdminUserMembership(uid, membership) {
  return fetchJSON(`${API_BASE}/admin/users/${uid}/membership`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ membership }),
  });
}
