import { useState, useEffect, useCallback } from 'react';
import { getAdminGlobalStats } from '../services/adminApi';

const CHART_COLORS = ['#8B5CF6', '#A78BFA', '#F472B6', '#FBBF24', '#60A5FA', '#FB923C'];

export default function AdminStatsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setStats(await getAdminGlobalStats()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { load().then(() => setLoading(false)); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-violet-400 border-t-transparent" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border border-white/10 bg-dark-slate p-10 text-center">
        <p className="text-muted-gray text-sm">暂无统计数据</p>
      </div>
    );
  }

  const today = stats.today || {};
  const week = stats.week || {};
  const trend = stats.trend || {};
  const todayTotal = Object.values(today).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0);
  const weekTotal = Object.values(week).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0);
  const trendDays = Object.keys(trend).sort().slice(-30);
  const typeNames = ['translations', 'tts', 'dictionary', 'practice', 'uploads'];
  const typeLabels = { translations: '翻译', tts: '朗读', dictionary: '查词', practice: '练习', uploads: '上传' };

  let chartMax = 1;
  for (const d of trendDays) {
    const sum = typeNames.reduce((s, k) => s + (trend[d]?.[k] || 0), 0);
    if (sum > chartMax) chartMax = sum;
  }

  return (
    <div className="space-y-6">
      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniCard label="今日事件" value={todayTotal} />
        <MiniCard label="本周事件" value={weekTotal} />
        <MiniCard label="今日活跃用户" value={today.activeUsers || 0} />
        <MiniCard label="本周活跃用户" value={week.activeUsers || 0} />
      </div>

      {/* Distribution */}
      <div className="rounded-2xl border border-white/10 bg-dark-slate p-6">
        <h3 className="text-sm font-semibold text-soft-white mb-4">今日活动分布</h3>
        <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
          <div className="flex-1 space-y-2">
            {typeNames.map((key, i) => {
              const v = today[key] || 0;
              const pct = todayTotal > 0 ? (v / todayTotal) * 100 : 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: CHART_COLORS[i] }} />
                  <span className="text-[11px] text-muted-gray w-10">{typeLabels[key]}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-mid-slate overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i] }} />
                  </div>
                  <span className="text-[11px] font-medium text-soft-white w-8 text-right">{v}</span>
                </div>
              );
            })}
          </div>

          {/* Donut */}
          <div className="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {typeNames.map((key, i) => {
                const v = today[key] || 0;
                const pct = (v / (todayTotal || 1)) * 100;
                const dash = pct * 2.51;
                const elem = (
                  <circle key={key} cx="50" cy="50" r="40" fill="none" stroke={CHART_COLORS[i]}
                    strokeWidth="12" strokeDasharray={`${dash} 251`}
                    strokeDashoffset={-typeNames.slice(0, i).reduce((s, k) => s + (today[k] || 0) / (todayTotal || 1) * 100, 0) * 2.51}
                    className="transition-all duration-700" />
                );
                return elem;
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* 30-day trend */}
      {trendDays.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-dark-slate p-6">
          <h3 className="text-sm font-semibold text-soft-white mb-4">近 30 天活动趋势</h3>
          <div className="flex items-end gap-px h-36">
            {trendDays.map((d) => {
              const sum = typeNames.reduce((s, k) => s + (trend[d]?.[k] || 0), 0);
              const h = chartMax > 0 ? (sum / chartMax) * 100 : 0;
              return (
                <div key={d} className="flex-1 flex flex-col items-center group" title={`${d.slice(5)}: ${sum}`}>
                  <div className="w-full flex-1 flex items-end">
                    <div className="w-full rounded-t-sm bg-gradient-to-t from-violet-500/40 to-violet-400/20 hover:from-violet-500/60 hover:to-violet-400/40 transition-all min-h-[2px]"
                      style={{ height: `${Math.max(h, 2)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[9px] text-muted-gray/50">
            <span>{trendDays[0]?.slice(5)}</span>
            <span>{trendDays[trendDays.length - 1]?.slice(5)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="text-[10px] text-muted-gray mb-1">{label}</p>
      <p className="text-lg font-bold text-soft-white">{value}</p>
    </div>
  );
}
