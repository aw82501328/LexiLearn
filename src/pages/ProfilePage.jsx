import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useApp } from '../context/AppContext';
import StatsChart from '../components/StatsChart';

export default function ProfilePage() {
  const { state, deleteFile, addFile, syncFiles } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    syncFiles();
  }, [syncFiles]);

  const handleOpenFile = (file) => {
    addFile(file);
    navigate(`/learn/${file.id}`);
  };

  const formatDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold text-soft-white mb-8">个人中心</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Stats */}
        <div className="lg:col-span-1 space-y-6">
          <StatsChart />

          {/* Quick stats */}
          <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-5">
            <h3 className="text-sm font-semibold text-soft-white mb-3">数据概览</h3>
            <div className="space-y-2">
              {[
                { label: '文件总数', value: state.fileHistory.length },
                { label: '翻译次数', value: state.translationCount },
                { label: '朗读次数', value: state.ttsCount },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted-gray">{stat.label}</span>
                  <span className="text-electric-cyan font-mono font-semibold">
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: File history */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-white/5 bg-dark-slate/50 p-5">
            <h3 className="text-sm font-semibold text-soft-white mb-4">
              历史文件
            </h3>

            {state.fileHistory.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-3xl mb-3">📂</div>
                <p className="text-muted-gray text-sm">暂无上传文件。</p>
              </div>
            ) : (
              <div className="space-y-2">
                {state.fileHistory.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-dark-slate/30 px-4 py-3 hover:border-white/10 transition-all group"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm text-soft-white truncate font-medium">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-gray mt-0.5">
                        {formatDate(file.openedAt || file.createdAt)} ·{' '}
                        {file.text ? file.text.split(/\s+/).length.toLocaleString() : 0} 词
                      </p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenFile(file)}
                        className="rounded-md bg-electric-cyan/10 px-3 py-1.5 text-xs text-electric-cyan hover:bg-electric-cyan/20 transition-all"
                      >
                        打开
                      </button>
                      <button
                        onClick={() => deleteFile(file.id)}
                        className="rounded-md px-2 py-1.5 text-xs text-muted-gray hover:text-red-400 hover:bg-red-400/10 transition-all"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
