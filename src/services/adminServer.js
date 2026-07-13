/**
 * 管理功能共享模块（server.js 和 data-store-plugin.js 共用）
 * - 用户行为追踪
 * - 配额控制（支持角色层级 + 个人覆盖）
 * - 管理员接口
 * - 角色/会员管理
 * - 全站汇总
 */

import fs from 'fs';
import path from 'path';

// ── 工具函数 ──

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 获取本周一日期 */
function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

// ── Admin 配置 ──

export function loadAdminConfig(DATA_DIR) {
  const f = path.join(DATA_DIR, '_admin.json');
  try {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return { adminIds: [] };
}

function saveAdminConfig(DATA_DIR, cfg) {
  const f = path.join(DATA_DIR, '_admin.json');
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function isAdmin(DATA_DIR, userId) {
  const cfg = loadAdminConfig(DATA_DIR);
  return cfg.adminIds.includes(userId);
}

/** 确保至少有一个管理员（首个注册用户自动成为管理员） */
export function ensureFirstAdmin(DATA_DIR, userId) {
  const cfg = loadAdminConfig(DATA_DIR);
  if (cfg.adminIds.length === 0) {
    cfg.adminIds = [userId];
    saveAdminConfig(DATA_DIR, cfg);
    return true;
  }
  return false;
}

/** 设置用户管理员角色 */
export function setUserRole(DATA_DIR, userId, role) {
  const cfg = loadAdminConfig(DATA_DIR);
  if (role === 'admin') {
    if (!cfg.adminIds.includes(userId)) cfg.adminIds.push(userId);
  } else {
    cfg.adminIds = cfg.adminIds.filter((id) => id !== userId);
  }
  saveAdminConfig(DATA_DIR, cfg);
  return cfg.adminIds.includes(userId);
}

// ── 角色/会员系统 ──

const BUILTIN_ROLES = [
  {
    id: 'basic',
    name: '普通用户',
    description: '默认免费用户',
    isDefault: true,
    color: '#9ca3af',
    limits: {
      maxFiles: 10,
      maxFilesDaily: 3,
      maxTranslationsDaily: 20,
      maxTTSDaily: 20,
      maxDictionaryDaily: 50,
      maxPracticeDaily: 10,
      maxFileSizeMB: 10,
    },
  },
  {
    id: 'gold',
    name: '黄金会员',
    description: '月度订阅会员',
    color: '#f59e0b',
    limits: {
      maxFiles: 50,
      maxFilesDaily: 10,
      maxTranslationsDaily: 100,
      maxTTSDaily: 100,
      maxDictionaryDaily: 200,
      maxPracticeDaily: 30,
      maxFileSizeMB: 30,
    },
  },
  {
    id: 'diamond',
    name: '钻石会员',
    description: '年度订阅会员',
    color: '#3b82f6',
    limits: {
      maxFiles: 200,
      maxFilesDaily: 30,
      maxTranslationsDaily: 500,
      maxTTSDaily: 500,
      maxDictionaryDaily: -1,
      maxPracticeDaily: -1,
      maxFileSizeMB: 100,
    },
  },
];

/** 加载角色配置 */
export function loadRoles(DATA_DIR) {
  const f = path.join(DATA_DIR, '_roles.json');
  try {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  // 初始化默认角色
  const defaults = { roles: BUILTIN_ROLES };
  saveRoles(DATA_DIR, defaults);
  return defaults;
}

/** 保存角色配置 */
function saveRoles(DATA_DIR, config) {
  fs.writeFileSync(path.join(DATA_DIR, '_roles.json'), JSON.stringify(config, null, 2), 'utf-8');
}

/** 保存角色配置（管理接口） */
export function saveRolesConfig(DATA_DIR, roles) {
  const config = { roles };
  saveRoles(DATA_DIR, config);
  return config;
}

/** 获取所有角色列表（含管理员内置角色） */
export function getRoleList(DATA_DIR) {
  const cfg = loadRoles(DATA_DIR);
  return [
    { id: 'admin', name: '管理员', description: '系统管理员，不受限制', color: '#8b5cf6', isAdmin: true, limits: {} },
    ...cfg.roles,
  ];
}

/** 获取某个会员等级的默认限制 */
export function getRoleDefaults(DATA_DIR, membership) {
  const roles = loadRoles(DATA_DIR);
  const role = roles.roles.find((r) => r.id === membership);
  return role ? { ...role.limits } : {};
}

// ── 用户会员等级 ──

/** 读取用户会员等级（从 users.json） */
function getUserMembership(DATA_DIR, userId) {
  const usersFile = path.join(DATA_DIR, 'users.json');
  try {
    if (fs.existsSync(usersFile)) {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      const u = users.find((u) => u.id === userId);
      return u?.membership || 'basic';
    }
  } catch {}
  return 'basic';
}

function saveUserMembershipField(DATA_DIR, userId, membership) {
  const usersFile = path.join(DATA_DIR, 'users.json');
  const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  const u = users.find((u) => u.id === userId);
  if (u) {
    u.membership = membership;
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
  }
}

/** 设置用户会员等级 */
export function setUserMembership(DATA_DIR, userId, membership) {
  const roles = loadRoles(DATA_DIR);
  const validIds = ['basic', ...roles.roles.map((r) => r.id)];
  if (!validIds.includes(membership)) return false;
  saveUserMembershipField(DATA_DIR, userId, membership);
  return true;
}

// ── 每日用量 ──

function loadUsage(DATA_DIR, userId) {
  const f = path.join(DATA_DIR, userId, '_usage.json');
  try {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return {
    date: today(),
    totalFiles: 0,
    dailyUploads: 0,
    dailyTranslations: 0,
    dailyTTS: 0,
    dailyDictionary: 0,
    dailyPractice: 0,
  };
}

function saveUsage(DATA_DIR, userId, usage) {
  const userDir = path.join(DATA_DIR, userId);
  ensureDir(userDir);
  fs.writeFileSync(path.join(userDir, '_usage.json'), JSON.stringify(usage, null, 2), 'utf-8');
}

/** 获取当前用量（自动跨日重置） */
export function getUsage(DATA_DIR, userId) {
  const usage = loadUsage(DATA_DIR, userId);
  const now = today();
  if (usage.date !== now) {
    usage.date = now;
    usage.dailyUploads = 0;
    usage.dailyTranslations = 0;
    usage.dailyTTS = 0;
    usage.dailyDictionary = 0;
    usage.dailyPractice = 0;
    saveUsage(DATA_DIR, userId, usage);
  }
  return usage;
}

const ACTIVITY_TO_USAGE = {
  upload: 'dailyUploads',
  translate: 'dailyTranslations',
  tts: 'dailyTTS',
  dict: 'dailyDictionary',
  dictionary: 'dailyDictionary',
  practice: 'dailyPractice',
};

/** 增加某项用量（接受活动类型名或字段名） */
export function incrementUsage(DATA_DIR, userId, field) {
  const mapped = ACTIVITY_TO_USAGE[field] || field;
  const usage = getUsage(DATA_DIR, userId);
  if (usage[mapped] !== undefined) usage[mapped] = (usage[mapped] || 0) + 1;
  if (mapped === 'dailyUploads') usage.totalFiles = (usage.totalFiles || 0) + 1;
  saveUsage(DATA_DIR, userId, usage);
  return usage;
}

// ── 默认配额 ──

const HARD_DEFAULT_LIMITS = {
  maxFiles: -1,
  maxFilesDaily: -1,
  maxTranslationsDaily: -1,
  maxTTSDaily: -1,
  maxDictionaryDaily: -1,
  maxPracticeDaily: -1,
  maxFileSizeMB: -1,
  status: 'active',
};

/** 加载用户完整限制（角色默认 + 个人覆盖） */
export function loadLimits(DATA_DIR, userId) {
  // 管理员不受限制
  if (isAdmin(DATA_DIR, userId)) return { ...HARD_DEFAULT_LIMITS, status: 'active' };

  const membership = getUserMembership(DATA_DIR, userId);
  const roleDefaults = getRoleDefaults(DATA_DIR, membership);

  // 合并: 角色默认 < 个人覆盖
  const merged = { ...HARD_DEFAULT_LIMITS, ...roleDefaults };

  // 加载个人覆盖
  const f = path.join(DATA_DIR, userId, '_limits.json');
  try {
    if (fs.existsSync(f)) {
      const overrides = JSON.parse(fs.readFileSync(f, 'utf-8'));
      Object.assign(merged, overrides);
    }
  } catch {}

  return merged;
}

export function saveLimits(DATA_DIR, userId, limits) {
  const userDir = path.join(DATA_DIR, userId);
  ensureDir(userDir);
  limits.updatedAt = Date.now();
  fs.writeFileSync(path.join(userDir, '_limits.json'), JSON.stringify(limits, null, 2), 'utf-8');
}

/** 检查是否超过配额。返回 { ok, reason } */
export function checkQuota(DATA_DIR, userId, action) {
  const limits = loadLimits(DATA_DIR, userId);
  const usage = getUsage(DATA_DIR, userId);

  if (limits.status === 'disabled') return { ok: false, reason: '账号已被管理员禁用' };

  const mapping = {
    translate: { limit: limits.maxTranslationsDaily, used: usage.dailyTranslations, name: '每日翻译次数' },
    tts: { limit: limits.maxTTSDaily, used: usage.dailyTTS, name: '每日朗读次数' },
    dictionary: { limit: limits.maxDictionaryDaily, used: usage.dailyDictionary, name: '每日查词次数' },
    practice: { limit: limits.maxPracticeDaily, used: usage.dailyPractice, name: '每日练习次数' },
    upload: { limit: limits.maxFilesDaily, used: usage.dailyUploads, name: '每日上传次数' },
    uploadTotal: { limit: limits.maxFiles, used: usage.totalFiles, name: '上传文件总数' },
  };

  const rule = mapping[action];
  if (!rule) return { ok: true };

  if (rule.limit > 0 && rule.used >= rule.limit) {
    return { ok: false, reason: `${rule.name}已用完（${rule.used}/${rule.limit}）` };
  }

  return { ok: true };
}

export function checkFileSize(DATA_DIR, userId, fileSizeBytes) {
  const limits = loadLimits(DATA_DIR, userId);
  if (limits.maxFileSizeMB > 0) {
    const maxBytes = limits.maxFileSizeMB * 1024 * 1024;
    if (fileSizeBytes > maxBytes) {
      return { ok: false, reason: `文件大小超过限制（${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB > ${limits.maxFileSizeMB}MB）` };
    }
  }
  return { ok: true };
}

// ── 删除用户 ──

/** 删除用户及其所有数据，返回 { ok } */
export function deleteUser(DATA_DIR, userId) {
  // 不允许删除所有管理员
  const cfg = loadAdminConfig(DATA_DIR);
  const isUserAdmin = cfg.adminIds.includes(userId);
  if (isUserAdmin && cfg.adminIds.length <= 1) {
    return { ok: false, error: '不能删除唯一的管理员' };
  }

  // 从 users.json 移除
  const usersFile = path.join(DATA_DIR, 'users.json');
  let users = [];
  try {
    if (fs.existsSync(usersFile)) users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  } catch {}
  users = users.filter((u) => u.id !== userId);
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');

  // 从 _admin.json 移除
  if (isUserAdmin) {
    cfg.adminIds = cfg.adminIds.filter((id) => id !== userId);
    saveAdminConfig(DATA_DIR, cfg);
  }

  // 删除用户目录（所有数据文件）
  const userDir = path.join(DATA_DIR, userId);
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }

  return { ok: true };
}

// ── 活动日志 ──

const MAX_ACTIVITY_LOG = 2000;
const ACTIVITY_RETENTION_DAYS = 90;

export function logActivity(DATA_DIR, userId, type, data = {}) {
  const userDir = path.join(DATA_DIR, userId);
  ensureDir(userDir);
  const f = path.join(userDir, '_activity.json');

  let activities = [];
  try {
    if (fs.existsSync(f)) activities = JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}

  activities.push({ t: Date.now(), type, data });

  const cutoff = Date.now() - ACTIVITY_RETENTION_DAYS * 86400000;
  activities = activities.filter((a) => a.t > cutoff).slice(-MAX_ACTIVITY_LOG);

  fs.writeFileSync(f, JSON.stringify(activities), 'utf-8');

  updateDailyStats(DATA_DIR, userId, type);

  return activities.length;
}

// ── 每日聚合 ──

function updateDailyStats(DATA_DIR, userId, type) {
  const userDir = path.join(DATA_DIR, userId);
  ensureDir(userDir);
  const f = path.join(userDir, '_daily.json');
  const date = today();

  let daily = {};
  try {
    if (fs.existsSync(f)) daily = JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}

  if (!daily[date]) daily[date] = { uploads: 0, translations: 0, tts: 0, dictionary: 0, practice: 0, logins: 0 };

  const mapping = {
    upload: 'uploads',
    translate: 'translations',
    tts: 'tts',
    dict: 'dictionary',
    practice: 'practice',
    login: 'logins',
  };

  const field = mapping[type];
  if (field) daily[date][field] = (daily[date][field] || 0) + 1;

  const keys = Object.keys(daily).sort();
  while (keys.length > 120) {
    delete daily[keys.shift()];
  }

  fs.writeFileSync(f, JSON.stringify(daily), 'utf-8');
  return daily;
}

export function getUserDaily(DATA_DIR, userId) {
  const f = path.join(DATA_DIR, userId, '_daily.json');
  try {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return {};
}

export function getUserActivity(DATA_DIR, userId, limit = 50) {
  const f = path.join(DATA_DIR, userId, '_activity.json');
  try {
    if (!fs.existsSync(f)) return [];
    const all = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return all.slice(-limit).reverse();
  } catch {}
  return [];
}

// ── 全站汇总 ──

function loadGlobalStats(DATA_DIR) {
  const f = path.join(DATA_DIR, '_global_stats.json');
  try {
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return {};
}

function saveGlobalStats(DATA_DIR, stats) {
  fs.writeFileSync(path.join(DATA_DIR, '_global_stats.json'), JSON.stringify(stats, null, 2), 'utf-8');
}

export function rebuildGlobalStats(DATA_DIR) {
  const usersFile = path.join(DATA_DIR, 'users.json');
  let userIds = [];
  try {
    if (fs.existsSync(usersFile)) {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      userIds = users.map((u) => u.id);
    }
  } catch {}

  const date = today();
  const ws = weekStart();
  const stats = { date, rebuiltAt: Date.now() };

  stats.today = { uploads: 0, translations: 0, tts: 0, dictionary: 0, practice: 0, activeUsers: 0 };
  stats.week = { uploads: 0, translations: 0, tts: 0, dictionary: 0, practice: 0, activeUsers: 0 };
  stats.trend = {};

  for (const uid of userIds) {
    const daily = getUserDaily(DATA_DIR, uid);
    let userActiveToday = false;
    let userActiveWeek = false;

    for (const [d, dayStats] of Object.entries(daily)) {
      if (!stats.trend[d]) stats.trend[d] = { uploads: 0, translations: 0, tts: 0, dictionary: 0, practice: 0, activeUsers: 0 };
      let dayHasActivity = false;
      for (const key of ['uploads', 'translations', 'tts', 'dictionary', 'practice']) {
        const v = dayStats[key] || 0;
        stats.trend[d][key] += v;
        if (v > 0) dayHasActivity = true;
      }
      if (dayHasActivity) stats.trend[d].activeUsers++;

      if (d === date) {
        for (const key of ['uploads', 'translations', 'tts', 'dictionary', 'practice']) {
          stats.today[key] += dayStats[key] || 0;
        }
        if (Object.values(dayStats).some((v) => v > 0)) {
          stats.today.activeUsers++;
          userActiveToday = true;
        }
      }

      if (d >= ws && d <= date) {
        for (const key of ['uploads', 'translations', 'tts', 'dictionary', 'practice']) {
          stats.week[key] += dayStats[key] || 0;
        }
        if (Object.values(dayStats).some((v) => v > 0)) {
          userActiveWeek = true;
        }
      }
    }

    if (userActiveWeek) stats.week.activeUsers++;
  }

  const trendSorted = {};
  Object.keys(stats.trend).sort().forEach((k) => { trendSorted[k] = stats.trend[k]; });
  stats.trend = trendSorted;

  saveGlobalStats(DATA_DIR, stats);
  return stats;
}

export function getGlobalStats(DATA_DIR) {
  const stats = loadGlobalStats(DATA_DIR);
  if (!stats.rebuiltAt || Date.now() - stats.rebuiltAt > 3600000) {
    return rebuildGlobalStats(DATA_DIR);
  }
  return stats;
}

// ── 用户列表 ──

const MEMBERSHIP_LABELS = {
  basic: '普通用户',
  gold: '黄金会员',
  diamond: '钻石会员',
  admin: '管理员',
};

export function getUserList(DATA_DIR) {
  const usersFile = path.join(DATA_DIR, 'users.json');
  let users = [];
  try {
    if (fs.existsSync(usersFile)) users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  } catch {}

  const cfg = loadAdminConfig(DATA_DIR);

  return users.map((u) => {
    const isUserAdmin = cfg.adminIds.includes(u.id);
    const usage = getUsage(DATA_DIR, u.id);
    const limits = loadLimits(DATA_DIR, u.id);
    const daily = getUserDaily(DATA_DIR, u.id);
    const todayStats = daily[today()] || {};
    const membership = u.membership || 'basic';

    return {
      id: u.id,
      username: u.username,
      role: isUserAdmin ? 'admin' : 'user',
      membership,
      membershipLabel: isUserAdmin ? '管理员' : (MEMBERSHIP_LABELS[membership] || membership),
      status: limits.status || 'active',
      createdAt: u.createdAt,
      today: {
        uploads: todayStats.uploads || 0,
        translations: todayStats.translations || 0,
        tts: todayStats.tts || 0,
        dictionary: todayStats.dictionary || 0,
        practice: todayStats.practice || 0,
      },
      usage: {
        totalFiles: usage.totalFiles || 0,
        dailyUploads: usage.dailyUploads || 0,
        dailyTranslations: usage.dailyTranslations || 0,
        dailyTTS: usage.dailyTTS || 0,
        dailyDictionary: usage.dailyDictionary || 0,
        dailyPractice: usage.dailyPractice || 0,
      },
      limits,
      lastActive: getUserActivity(DATA_DIR, u.id, 1)[0]?.t || null,
    };
  });
}
