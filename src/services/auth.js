const API_BASE = '/api';

let token = localStorage.getItem('lexilearn_token') || '';

export function getToken() {
  return token;
}

export function setToken(t) {
  token = t;
  if (t) {
    localStorage.setItem('lexilearn_token', t);
  } else {
    localStorage.removeItem('lexilearn_token');
  }
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export async function register(username, password) {
  const data = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export async function login(username, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export async function getMe() {
  if (!token) return null;
  try {
    const data = await api('/auth/me');
    return data.user;
  } catch {
    setToken('');
    return null;
  }
}

export function logout() {
  setToken('');
  localStorage.removeItem('lexilearn_state');
  window.location.href = '/login';
}
