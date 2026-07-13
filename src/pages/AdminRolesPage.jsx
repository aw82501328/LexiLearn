import { useState, useEffect, useCallback } from 'react';
import { getAdminRoles, saveAdminRoles } from '../services/adminApi';

const LIMIT_FIELDS = [
  { key: 'maxFiles', label: '上传文件总数', hint: '-1 表示无限制' },
  { key: 'maxFilesDaily', label: '每日上传', hint: '-1 表示无限制' },
  { key: 'maxTranslationsDaily', label: '每日翻译', hint: '-1 表示无限制' },
  { key: 'maxTTSDaily', label: '每日朗读', hint: '-1 表示无限制' },
  { key: 'maxDictionaryDaily', label: '每日查词', hint: '-1 表示无限制' },
  { key: 'maxPracticeDaily', label: '每日练习', hint: '-1 表示无限制' },
  { key: 'maxFileSizeMB', label: '单文件最大(MB)', hint: '-1 表示无限制' },
];

export default function AdminRolesPage() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedRoles, setEditedRoles] = useState(null);

  const loadRoles = useCallback(async () => {
    try {
      const list = await getAdminRoles();
      // 过滤掉内置管理员角色（不可编辑）
      const editable = list.filter((r) => !r.isAdmin);
      setRoles(editable);
      setEditedRoles(JSON.parse(JSON.stringify(editable)));
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadRoles().then(() => setLoading(false)); }, [loadRoles]);

  function updateRoleLimits(roleId, field, value) {
    setEditedRoles((prev) =>
      prev.map((r) => {
        if (r.id !== roleId) return r;
        return { ...r, limits: { ...r.limits, [field]: parseInt(value) || 0 } };
      })
    );
  }

  function updateRoleMeta(roleId, field, value) {
    setEditedRoles((prev) =>
      prev.map((r) => {
        if (r.id !== roleId) return r;
        return { ...r, [field]: value };
      })
    );
  }

  function addRole() {
    const id = 'role_' + Date.now().toString(36);
    setEditedRoles((prev) => [
      ...prev,
      {
        id, name: '新角色', description: '', color: '#6b7280',
        limits: {
          maxFiles: -1, maxFilesDaily: -1, maxTranslationsDaily: -1,
          maxTTSDaily: -1, maxDictionaryDaily: -1, maxPracticeDaily: -1,
          maxFileSizeMB: -1,
        },
      },
    ]);
  }

  function removeRole(roleId) {
    if (!confirm('确定删除此角色？已有该角色的用户将回退到"普通用户"配额。')) return;
    setEditedRoles((prev) => prev.filter((r) => r.id !== roleId));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveAdminRoles(editedRoles);
      alert('已保存');
      await loadRoles();
    } catch (e) { alert('保存失败: ' + e.message); }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-violet-400 border-t-transparent" />
      </div>
    );
  }

  const defaultRoles = roles.filter((r) => r.isDefault);
  const customRoles = editedRoles?.filter((r) => !r.isDefault) || [];

  return (
    <div className="space-y-6">
      {/* 提示 */}
      <div className="rounded-xl border border-violet-500/10 bg-violet-500/[0.03] p-4">
        <p className="text-xs text-muted-gray">
          角色定义了不同会员等级的使用限额。每个用户可被分配一个角色，用户可在此基础上拥有个人覆盖限额。
          编辑角色后，所有属于该角色的用户将立即受到新限额影响。
        </p>
      </div>

      {/* 默认角色（不可删除，只可编辑限制） */}
      <Section title="内置角色">
        {defaultRoles.map((role) => {
          const edit = editedRoles?.find((r) => r.id === role.id);
          return (
            <RoleCard
              key={role.id}
              role={edit || role}
              readonlyMeta
              onLimitChange={(f, v) => updateRoleLimits(role.id, f, v)}
            />
          );
        })}
      </Section>

      {/* 自定义角色 */}
      <Section title="自定义角色">
        {customRoles.length === 0 && (
          <p className="text-xs text-muted-gray py-4">暂无自定义角色，点击下方按钮创建。</p>
        )}
        {customRoles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            onMetaChange={(f, v) => updateRoleMeta(role.id, f, v)}
            onLimitChange={(f, v) => updateRoleLimits(role.id, f, v)}
            onRemove={() => removeRole(role.id)}
          />
        ))}
        <button onClick={addRole}
          className="mt-2 w-full rounded-lg border border-dashed border-white/10 py-3 text-xs text-muted-gray hover:text-soft-white hover:border-white/20 transition-all">
          + 新增角色
        </button>
      </Section>

      {/* 保存 */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="rounded-lg bg-violet-500/10 border border-violet-500/20 px-6 py-2.5 text-sm font-medium text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-40">
          {saving ? '保存中...' : '保存所有更改'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-gray uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function RoleCard({ role, readonlyMeta, onMetaChange, onLimitChange, onRemove }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-white/10 bg-dark-slate overflow-hidden">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: role.color || '#6b7280' }} />
          <div>
            <p className="text-sm font-medium text-soft-white">{role.name}</p>
            <p className="text-[10px] text-muted-gray">{role.description || role.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors">
            {expanded ? '收起限制' : '编辑限制'}
          </button>
          {!onRemove && <span className="text-[10px] text-muted-gray/50 px-2 py-0.5 rounded border border-white/10">默认</span>}
          {onRemove && (
            <button onClick={onRemove}
              className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors px-1.5">
              删除
            </button>
          )}
        </div>
      </div>

      {/* Meta info (for custom roles) */}
      {!readonlyMeta && expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-white/5 pt-3 mx-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-muted-gray block mb-1">名称</label>
              <input value={role.name} onChange={(e) => onMetaChange('name', e.target.value)}
                className="w-full h-7 rounded-lg border border-white/10 bg-dark-slate px-2 text-xs text-soft-white focus:border-violet-500/30 focus:outline-none" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-gray block mb-1">颜色</label>
              <div className="flex items-center gap-2">
                <input type="color" value={role.color || '#6b7280'}
                  onChange={(e) => onMetaChange('color', e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent" />
                <input value={role.color || ''} onChange={(e) => onMetaChange('color', e.target.value)}
                  className="flex-1 h-7 rounded-lg border border-white/10 bg-dark-slate px-2 text-xs text-soft-white focus:border-violet-500/30 focus:outline-none font-mono" />
              </div>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-gray block mb-1">描述</label>
            <input value={role.description || ''} onChange={(e) => onMetaChange('description', e.target.value)}
              className="w-full h-7 rounded-lg border border-white/10 bg-dark-slate px-2 text-xs text-soft-white focus:border-violet-500/30 focus:outline-none" />
          </div>
        </div>
      )}

      {/* Limits */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {LIMIT_FIELDS.map(({ key, label, hint }) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <label className="text-[11px] text-muted-gray" title={hint}>{label}</label>
                <input type="number" value={role.limits?.[key] ?? -1}
                  onChange={(e) => onLimitChange(key, e.target.value)}
                  min="-1"
                  className="w-16 h-7 rounded-lg border border-white/10 bg-dark-slate px-2 text-xs text-soft-white text-center focus:border-violet-500/30 focus:outline-none [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
