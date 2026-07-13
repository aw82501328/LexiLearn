import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Area, AreaChart, Legend,
} from 'recharts';

const COLORS = ['#2dd4bf', '#22d3ee', '#a78bfa', '#fbbf24', '#fb7185', '#34d399'];

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getFileTypeCounts(fileHistory) {
  const counts = {};
  for (const f of fileHistory) {
    const ext = (f.name || '').split('.').pop().toLowerCase();
    const label = ext === 'pdf' ? 'PDF' : ext === 'epub' ? 'EPUB' : ext === 'mobi' ? 'MOBI' : ext === 'docx' || ext === 'doc' ? 'Word' : ext === 'txt' ? 'TXT' : '其他';
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => ({ name: k, value: v }));
}

export default function StatsPage() {
  const { state } = useApp();
  const { fileHistory, vocabulary, translationCount, ttsCount } = state;

  // 概览数据
  const totalFiles = fileHistory.length;
  const totalWords = fileHistory.reduce((sum, f) => sum + (f.wordCount || 0), 0);
  const vocabCount = vocabulary.length;
  const readFiles = fileHistory.filter((f) => {
    const p = f.readingProgress;
    return p && p.page > 0 && p.total > 0;
  }).length;

  // 阅读进度柱状图数据
  const progressData = useMemo(() => {
    return fileHistory
      .filter((f) => {
        const p = f.readingProgress;
        return p && p.total > 0;
      })
      .slice(0, 12)
      .map((f) => {
        const p = f.readingProgress;
        const pct = Math.round((p.page / p.total) * 100);
        const shortName = (f.name || '未命名').replace(/\.[^.]+$/, '');
        return {
          name: shortName.length > 8 ? shortName.slice(0, 7) + '…' : shortName,
          进度: pct,
        };
      })
      .reverse();
  }, [fileHistory]);

  // 生词增长趋势（按天汇总）
  const vocabTrend = useMemo(() => {
    const byDay = {};
    for (const item of vocabulary) {
      const day = formatDate(item.addedAt);
      if (!day) continue;
      byDay[day] = (byDay[day] || 0) + 1;
    }
    let accum = 0;
    return Object.entries(byDay)
      .sort(([a], [b]) => {
        const [am, ad] = a.split('/').map(Number);
        const [bm, bd] = b.split('/').map(Number);
        return am !== bm ? am - bm : ad - bd;
      })
      .map(([day, count]) => {
        accum += count;
        return { day, 累计: accum, 新增: count };
      });
  }, [vocabulary]);

  // 文件类型分布
  const fileTypeData = useMemo(() => getFileTypeCounts(fileHistory), [fileHistory]);

  // 阅读时长估算（假设每页平均2分钟）
  const totalPagesRead = fileHistory.reduce((sum, f) => {
    const p = f.readingProgress;
    return sum + (p ? p.page : 0);
  }, 0);
  const estMinutes = totalPagesRead * 2;
  const estHours = (estMinutes / 60).toFixed(1);

  // 学习活跃度（最近打开的文件）
  const recentActivity = useMemo(() => {
    return [...fileHistory]
      .filter((f) => f.openedAt)
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 7)
      .map((f) => {
        const shortName = (f.name || '未命名').replace(/\.[^.]+$/, '');
        return { name: shortName.length > 6 ? shortName.slice(0, 5) + '…' : shortName, openedAt: f.openedAt };
      });
  }, [fileHistory]);

  const activityByDay = useMemo(() => {
    const byDay = {};
    for (const f of recentActivity) {
      const day = formatDate(f.openedAt);
      if (!day) continue;
      byDay[day] = (byDay[day] || 0) + 1;
    }
    return Object.entries(byDay).map(([day, count]) => ({ day, 次数: count }));
  }, [recentActivity]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold text-soft-white mb-8">学习统计</h1>

      {totalFiles === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 animate-fade-in">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-muted-gray text-lg mb-2">暂无学习数据</p>
          <p className="text-muted-gray text-sm">上传并阅读文档后，统计数据将在这里展示</p>
        </div>
      ) : (
        <>
          {/* ---- 概览卡片 ---- */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
            {[
              { label: '文档数量', value: totalFiles, unit: '本', color: 'text-electric-cyan', bg: 'border-l-electric-cyan' },
              { label: '总词汇量', value: totalWords.toLocaleString(), unit: '词', color: 'text-cyan-glow', bg: 'border-l-cyan-glow' },
              { label: '已读页面', value: totalPagesRead, unit: '页', color: 'text-violet-400', bg: 'border-l-violet-400' },
              { label: '生词本', value: vocabCount, unit: '词', color: 'text-amber-400', bg: 'border-l-amber-400' },
              { label: '翻译次数', value: translationCount, unit: '次', color: 'text-emerald-400', bg: 'border-l-emerald-400' },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-xl border border-white/5 bg-dark-slate/50 p-4 border-l-2 ${card.bg} transition-all hover:border-white/10`}
              >
                <p className="text-xs text-muted-gray mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>
                  {card.value}
                  <span className="text-xs ml-1 text-muted-gray font-normal">{card.unit}</span>
                </p>
              </div>
            ))}
          </div>

          {/* ---- 图表区 ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* 阅读进度 */}
            <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-5">
              <h3 className="text-sm font-semibold text-soft-white mb-4">阅读进度 (%)</h3>
              {progressData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={progressData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 13 }}
                      formatter={(v) => [`${v}%`, '进度']}
                    />
                    <Bar dataKey="进度" fill="#2dd4bf" radius={[4, 4, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-60 text-muted-gray text-sm">暂无阅读数据</div>
              )}
            </div>

            {/* 生词增长趋势 */}
            <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-5">
              <h3 className="text-sm font-semibold text-soft-white mb-4">生词增长趋势</h3>
              {vocabTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={vocabTrend} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 13 }}
                    />
                    <defs>
                      <linearGradient id="vocabGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="累计" stroke="#a78bfa" fill="url(#vocabGrad)" strokeWidth={2} />
                    <Line type="monotone" dataKey="新增" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-60 text-muted-gray text-sm">暂无生词数据</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 文件类型分布 */}
            <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-5">
              <h3 className="text-sm font-semibold text-soft-white mb-4">文档类型分布</h3>
              {fileTypeData.length > 0 ? (
                <div className="flex items-center">
                  <ResponsiveContainer width="55%" height={200}>
                    <PieChart>
                      <Pie
                        data={fileTypeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={80}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {fileTypeData.map((entry, idx) => (
                          <Cell key={entry.name} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 13 }}
                        formatter={(v, name) => [`${v} 本`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2.5">
                    {fileTypeData.map((entry, idx) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <span className="text-xs text-muted-gray">{entry.name}</span>
                        <span className="text-xs text-soft-white font-medium ml-auto">{entry.value} 本</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-gray text-sm">暂无数据</div>
              )}
            </div>

            {/* 学习活跃度 */}
            <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-5">
              <h3 className="text-sm font-semibold text-soft-white mb-4">学习活跃度（最近7天）</h3>
              {activityByDay.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={activityByDay.slice(-7)} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 13 }}
                      formatter={(v) => [`${v} 次`, '阅读']}
                    />
                    <Bar dataKey="次数" fill="#22d3ee" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-48 text-muted-gray text-sm">暂无活跃数据</div>
              )}
            </div>
          </div>

          {/* 阅读时长估算 */}
          <div className="mt-6 rounded-xl border border-white/5 bg-dark-slate/50 p-5">
            <h3 className="text-sm font-semibold text-soft-white mb-4">学习概览</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-400">{estHours}</p>
                <p className="text-xs text-muted-gray mt-1">估算阅读时长（小时）</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-cyan-400">{ttsCount}</p>
                <p className="text-xs text-muted-gray mt-1">语音朗读次数</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-violet-400">{readFiles}</p>
                <p className="text-xs text-muted-gray mt-1">已开始阅读文档</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-400">{fileHistory.filter((f) => {
                  const p = f.readingProgress;
                  return p && p.total > 0 && p.page >= p.total;
                }).length}</p>
                <p className="text-xs text-muted-gray mt-1">已完成阅读</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
