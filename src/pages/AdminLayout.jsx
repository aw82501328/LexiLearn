import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * 管理后台布局 — 独立紫色导航
 */
export default function AdminLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navLinks = [
    { to: '/users', label: '用户列表' },
    { to: '/roles', label: '角色管理' },
    { to: '/stats', label: '全站汇总' },
  ];

  return (
    <div className="min-h-screen bg-deep-space">
      {/* ── 紫色管理导航栏 ── */}
      <nav className="sticky top-0 z-50 border-b border-violet-500/10 bg-deep-space/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white font-bold text-sm shadow-[0_0_15px_rgba(139,92,246,0.25)]">
                A
              </div>
              <span className="text-lg font-semibold tracking-tight text-soft-white">
                管理<span className="text-violet-400">后台</span>
              </span>
            </div>

            {/* 分隔线 */}
            <div className="w-px h-5 bg-white/10" />

            {/* 导航链接 */}
            {navLinks.map((link) => {
              const isActive = location.pathname === link.to;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end
                  className={`rounded-lg px-4 py-2 text-xs font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-violet-500/15 text-violet-400'
                      : 'text-muted-gray hover:text-soft-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </NavLink>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-gray">{user?.username}</span>
            <button
              onClick={logout}
              className="text-xs text-muted-gray hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg border border-transparent hover:border-red-500/20"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      {/* ── 内容区域 ── */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
