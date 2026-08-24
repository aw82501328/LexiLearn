import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const tabs = [
  {
    to: '/',
    label: '首页',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2DD4BF' : '#94A3B8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    to: '/vocabulary',
    label: '生词本',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2DD4BF' : '#94A3B8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    to: '/stats',
    label: '统计',
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#2DD4BF' : '#94A3B8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 20V10" />
        <path d="M12 20V4" />
        <path d="M6 20v-6" />
      </svg>
    ),
  },
];

export default function MobileTabBar() {
  const location = useLocation();
  const { state } = useApp();
  const vocabCount = state.vocabulary.length;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/5 bg-deep-space/95 backdrop-blur-xl md:hidden"
      style={{
        paddingBottom: 'var(--safe-area-bottom)',
        height: 'calc(var(--tab-bar-height) + var(--safe-area-bottom))',
      }}
    >
      {tabs.map((tab) => {
        const isActive =
          tab.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(tab.to);

        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] min-w-[44px] px-2 py-1"
          >
            {tab.icon(isActive)}
            <span
              className={`text-[10px] leading-none transition-colors ${
                isActive ? 'text-electric-cyan' : 'text-muted-gray'
              }`}
            >
              {tab.label}
              {tab.to === '/vocabulary' && vocabCount > 0 && (
                <span className="ml-0.5 text-[9px]">({vocabCount})</span>
              )}
            </span>
            {isActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-electric-cyan" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
