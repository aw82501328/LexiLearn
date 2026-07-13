import { useState, useEffect, useCallback } from 'react';
import {
  getAdminUsers, getAdminRoles,
  getAdminUserActivity, getAdminUserDaily,
  setAdminUserMembership,
  deleteAdminUser,
} from '../services/adminApi';

const ACTIVITY_LABELS = {
  upload: '上传文件', translate: '翻译', tts: '朗读',
  dict: '查词典', practice: '练习', login: '登录',
  delete: '删除文件', read: '阅读',
};

const MEMBERSHIP_LABELS = {
  basic: '普通用户',
  gold: '黄金会员',
  diamond: '钻石会员',
  admin: '管理员',
};
const MEMBERSHIP_COLORS = {
  basic: '#9ca3af',
  gold: '#f59e0b',
  diamond: '#3b82f6',
  admin: '#8b5cf6',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Detail
  const [selectedUser, setSelectedUser] = useState(null);
  const [userActivity, setUserActivity] = useState([]);
  const [userDaily, setUserDaily] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    try { setUsers(await getAdminUsers()); } catch (e) { console.error(e); }
  }, []);

  const loadRoles = useCallback(async () => {
    try { setRoles(await getAdminRoles()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    Promise.all([loadUsers(), loadRoles()]).then(() => setLoading(false));
  }, [loadUsers, loadRoles]);

  async function openUserDetail(uid) {
    setSelectedUser(uid); setDetailLoading(true);
    try {
      const [act, dly] = await Promise.all([
        getAdminUserActivity(uid), getAdminUserDaily(uid),
      ]);
      setUserActivity(act); setUserDaily(dly);
    } catch (e) { console.error(e); }
    setDetailLoading(false);
  }

  async function handleMembershipChange(uid, membership) {
    try {
      await setAdminUserMembership(uid, membership);
      await loadUsers();
      openUserDetail(uid);
    } catch (e) { alert('操作失败: ' + e.message); }
  }

  async function handleDeleteUser(uid, username) {
    if (!confirm(`确定要删除用户 "${username}" 吗？\n\n此操作不可撤销，将清除该用户的所有数据（文件、记录等）。`)) return;
    try {
      await deleteAdminUser(uid);
      if (selectedUser === uid) setSelectedUser(null);
      await loadUsers();
    } catch (e) { alert('删除失败: ' + e.message); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-violet-400 border-t-transparent" />
      </div>
    );
  }

  const totalToday = users.reduce((sum, u) =>
    sum + Object.values(u.today || {}).reduce((a, b) => a + b, 0), 0);

  // 汇总卡片：用户数 / 各会员等级人数 / 今日活跃
  const membershipCounts = { admin: 0, basic: 0, gold: 0, diamond: 0 };
  users.forEach((u) => {
    const m = u.role === 'admin' ? 'admin' : (u.membership || 'basic');
    membershipCounts[m] = (membershipCounts[m] || 0) + 1;
  });

  return (
    <div className="flex gap-6">
      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl border border-white/10 bg-dark-slate overflow-hidden">
          {/* Summary */}
          <div className="grid grid-cols-6 gap-3 p-5 border-b border-white/5">
            <MiniCard label="总用户" value={users.length} />
            <MiniCard label="管理员" value={membershipCounts.admin} color="#8b5cf6" />
            <MiniCard label="普通用户" value={membershipCounts.basic} color="#9ca3af" />
            <MiniCard label="黄金会员" value={membershipCounts.gold} color="#f59e0b" />
            <MiniCard label="钻石会员" value={membershipCounts.diamond} color="#3b82f6" />
            <MiniCard label="今日事件" value={totalToday} />
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.01]">
                <th className="px-5 py-3 text-left text-[11px] font-medium text-muted-gray uppercase tracking-wider">用户</th>
                <th className="px-5 py-3 text-left text-[11px] font-medium text-muted-gray uppercase tracking-wider">角色/会员</th>
                <th className="px-5 py-3 text-left text-[11px] font-medium text-muted-gray uppercase tracking-wider">状态</th>
                <th className="px-5 py-3 text-right text-[11px] font-medium text-muted-gray uppercase tracking-wider">今日事件</th>
                <th className="px-5 py-3 text-right text-[11px] font-medium text-muted-gray uppercase tracking-wider">最后活跃</th>
                <th className="px-5 py-3 text-center text-[11px] font-medium text-muted-gray uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const t = Object.values(u.today || {}).reduce((a, b) => a + b, 0);
                const s = u.id === selectedUser;
                const isAdmin = u.role === 'admin';
                const membership = isAdmin ? 'admin' : (u.membership || 'basic');
                return (
                  <tr key={u.id}
                    className={`border-b border-white/[0.02] transition-all hover:bg-white/[0.02] ${
                      s ? 'bg-violet-500/5 border-l-2 border-l-violet-500' : ''}`}>
                    <td className="px-5 py-3 cursor-pointer" onClick={() => openUserDetail(u.id)}>
                      <p className="text-sm font-medium text-soft-white">{u.username}</p>
                      <p className="text-[10px] text-muted-gray">{u.id.slice(-6)}</p>
                    </td>
                    <td className="px-5 py-3 cursor-pointer" onClick={() => openUserDetail(u.id)}>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MEMBERSHIP_COLORS[membership] || '#9ca3af' }} />
                        <span className="text-[11px] text-muted-gray">
                          {isAdmin ? '管理员' : (MEMBERSHIP_LABELS[membership] || membership)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 cursor-pointer" onClick={() => openUserDetail(u.id)}>
                      <span className={`flex items-center gap-1 text-[11px] ${u.status === 'active' ? 'text-emerald-400' : 'text-red-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        {u.status === 'active' ? '正常' : '已禁用'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right cursor-pointer" onClick={() => openUserDetail(u.id)}>
                      <span className="text-xs text-soft-white">{t}</span>
                    </td>
                    <td className="px-5 py-3 text-right cursor-pointer" onClick={() => openUserDetail(u.id)}>
                      <span className="text-[11px] text-muted-gray">{u.lastActive ? formatTime(u.lastActive) : '-'}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id, u.username); }}
                        className="text-[11px] text-red-400/50 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/5">
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selectedUser && (
        <div className="w-96 shrink-0">
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin-slow rounded-full border-2 border-violet-400 border-t-transparent" />
            </div>
          ) : (
            <UserDetailPanel
              user={users.find((u) => u.id === selectedUser)}
              roles={roles}
              activity={userActivity} daily={userDaily}
              onMembershipChange={(m) => handleMembershipChange(selectedUser, m)}
              onDeleteUser={() => {
                const u = users.find((u) => u.id === selectedUser);
                if (u) handleDeleteUser(u.id, u.username);
              }}
              onClose={() => setSelectedUser(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, color }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
        <p className="text-[10px] text-muted-gray">{label}</p>
      </div>
      <p className="text-lg font-bold text-soft-white">{value}</p>
    </div>
  );
}

function UserDetailPanel({ user, roles, activity, daily, onMembershipChange, onDeleteUser, onClose }) {
  const isAdmin = user.role === 'admin';
  const membership = isAdmin ? 'admin' : (user.membership || 'basic');
  const editableRoles = roles.filter((r) => !r.isAdmin);

  // 当前会员等级对应的默认限额
  const roleDefault = editableRoles.find((r) => r.id === membership);

  const dailyKeys = Object.keys(daily || {}).sort().slice(-30);
  let dailyMax = 1;
  dailyKeys.forEach((d) => {
    const s = Object.values(daily[d] || {}).reduce((a, b) => a + b, 0);
    if (s > dailyMax) dailyMax = s;
  });

  const fields = [
    { key: 'maxFiles', label: '上传文件总数', field: 'totalFiles' },
    { key: 'maxFilesDaily', label: '每日上传', field: 'dailyUploads' },
    { key: 'maxTranslationsDaily', label: '每日翻译', field: 'dailyTranslations' },
    { key: 'maxTTSDaily', label: '每日朗读', field: 'dailyTTS' },
    { key: 'maxDictionaryDaily', label: '每日查词', field: 'dailyDictionary' },
    { key: 'maxPracticeDaily', label: '每日练习', field: 'dailyPractice' },
    { key: 'maxFileSizeMB', label: '单文件最大(MB)', field: null },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-dark-slate overflow-hidden sticky top-24">
      <div className="flex items-center justify-between p-5 border-b border-white/5">
        <div>
          <h3 className="text-base font-semibold text-soft-white">{user.username}</h3>
          <p className="text-[10px] text-muted-gray mt-0.5">ID: {user.id.slice(-8)}</p>
        </div>
        <button onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-gray hover:text-soft-white hover:bg-white/5 transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* 会员等级 */}
      <div className="p-5 space-y-3 border-b border-white/5">
        {/* 会员等级下拉 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-gray">会员等级</span>
          <select
            value={membership}
            onChange={(e) => onMembershipChange(e.target.value)}
            disabled={isAdmin}
            className={`h-7 rounded-lg border border-white/10 bg-dark-slate px-2 text-xs text-soft-white focus:border-violet-500/30 focus:outline-none ${isAdmin ? 'opacity-40 cursor-not-allowed' : ''}`}>
            {editableRoles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        {/* 当前角色默认限额预览 */}
        {!isAdmin && roleDefault && (
          <div className="rounded-lg border border-white/5 bg-white/[0.01] p-3">
            <p className="text-[10px] text-muted-gray mb-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full mr-1" style={{ backgroundColor: roleDefault.color || '#6b7280' }} />
              {roleDefault.name} 默认限额
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {fields.map(({ key, label }) => (
                <div key={key} className="flex justify-between text-[10px]">
                  <span className="text-muted-gray/60">{label}</span>
                  <span className="text-muted-gray">{roleDefault.limits?.[key] === -1 ? '∞' : roleDefault.limits?.[key] ?? '-'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 状态行 */}
      <div className="flex items-center gap-1 px-5 py-2 text-[11px]">
        <span className={`h-1.5 w-1.5 rounded-full ${user.status === 'active' ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className={user.status === 'active' ? 'text-emerald-400' : 'text-red-400'}>
          {user.status === 'active' ? '正常' : '已禁用'}
        </span>
      </div>

      {/* 近 30 天活动 */}
      {dailyKeys.length > 0 && (
        <div className="px-5 py-3 border-y border-white/5">
          <p className="text-[10px] text-muted-gray mb-2 uppercase tracking-wider">近 30 天活动</p>
          <div className="flex items-end gap-px h-16">
            {dailyKeys.map((d) => {
              const sum = Object.values(daily[d] || {}).reduce((a, b) => a + b, 0);
              const h = dailyMax > 0 ? (sum / dailyMax) * 100 : 0;
              return (
                <div key={d} className="flex-1 flex items-end" title={`${d.slice(5)}: ${sum}`}>
                  <div className="w-full rounded-t-sm bg-violet-400/30 hover:bg-violet-400/50 transition-all min-h-[2px]"
                    style={{ height: `${Math.max(h, 2)}%` }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近动态 */}
      {activity.length > 0 && (
        <div className="p-5">
          <p className="text-[10px] text-muted-gray mb-2 uppercase tracking-wider">最近动态</p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {activity.slice(0, 30).map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[10px] text-muted-gray/50 shrink-0 w-10 text-right">{formatTimeShort(a.t)}</span>
                <span className="text-[11px] text-muted-gray">
                  {ACTIVITY_LABELS[a.type] || a.type}
                  {a.data?.word ? `「${a.data.word}」` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部操作区 */}
      <div className="p-5 border-t border-white/5 space-y-2">
        <button onClick={onDeleteUser}
          className="w-full rounded-lg border border-red-500/10 py-2 text-xs text-red-400/60 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/[0.03] transition-all">
          删除此用户
        </button>
      </div>
    </div>
  );
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts), now = new Date(), diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function formatTimeShort(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
