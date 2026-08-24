import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const location = useLocation();
  const { state } = useApp();
  const { user, logout } = useAuth();
  const vocabCount = state.vocabulary.length;

  // 登录页不显示导航栏
  if (location.pathname === '/login') return null;

  const navLinks = [
    { to: '/', label: '首页' },
    { to: '/vocabulary', label: `生词本${vocabCount > 0 ? ` (${vocabCount})` : ''}` },
    { to: '/stats', label: '统计' },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-white/5 bg-deep-space/80 backdrop-blur-xl hidden md:block">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-electric-cyan to-cyan-glow/60 text-dark-slate font-bold text-sm shadow-[0_0_15px_rgba(45,212,191,0.25)]">
            L
          </div>
          <span className="text-lg font-semibold tracking-tight text-soft-white">
            Lexi<span className="text-electric-cyan">Learn</span>
          </span>
        </Link>

        <div className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive =
              link.to === '/vocabulary' || link.to === '/stats'
                ? location.pathname.startsWith(link.to)
                : location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-white/10 text-electric-cyan'
                    : 'text-muted-gray hover:text-soft-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <span className="text-xs text-muted-gray">{user.username}</span>
          )}
          <button
            onClick={logout}
            className="text-xs text-muted-gray hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg border border-transparent hover:border-red-500/20"
          >
            退出
          </button>
        </div>
      </div>
    </nav>
  );
}
