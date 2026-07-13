import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useApp } from '../context/AppContext';

export default function StatsChart() {
  const { state } = useApp();

  const data = [
    { name: '翻译次数', value: state.translationCount },
    { name: '朗读次数', value: state.ttsCount },
    { name: '文件数量', value: state.fileHistory.length },
  ];

  const colors = ['#2DD4BF', '#5EEAD4', '#0EA5E9'];

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload?.length) {
      return (
        <div className="rounded-lg border border-white/10 bg-dark-slate px-3 py-2 text-sm shadow-lg">
          <p className="text-soft-white">
            {payload[0].payload.name}:{' '}
            <span className="text-electric-cyan font-semibold">{payload[0].value}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-6">
      <h3 className="text-sm font-semibold text-soft-white mb-4">学习活动统计</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="name"
              tick={{ fill: '#94A3B8', fontSize: 12 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#94A3B8', fontSize: 12 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(45,212,191,0.05)' }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={48}>
              {data.map((_, index) => (
                <Cell key={index} fill={colors[index]} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
