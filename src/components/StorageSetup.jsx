import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  isDiskMode, supportsDiskStorage,
  requestStorageDirectory, restoreStorageDirectory,
  resetDiskMode, getStorageSize, getStoragePath,
  isOPFSSupported,
} from '../services/dataStore';

export default function StorageSetup({ onReady, showToggle = false, forceShow = false, onClose }) {
  const { user } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState('loading');
  const [storageInfo, setStorageInfo] = useState(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [showPanel, setShowPanel] = useState(false);

  function closePanel() {
    setShowPanel(false);
    onClose?.();
  }

  // 外部强制打开面板
  useEffect(() => {
    if (forceShow) setShowPanel(true);
    else if (!showToggle) setShowPanel(false);
  }, [forceShow]);

  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';

  useEffect(() => {
    if (user && !isAuthPage) {
      init();
    } else if (!user || isAuthPage) {
      setStatus('pending-auth');
    }
  }, [user, isAuthPage]);

  async function init() {
    setStatus('loading');
    // 直接从 localStorage 读取存储模式，不弹任何选择框（惰性恢复句柄）
    const mode = localStorage.getItem('lexilearn_storage_mode');
    if (mode === 'disk') {
      try { await restoreStorageDirectory(); } catch {}
      setStatus('disk-ready');
      setPath(getStoragePath() || '');
      onReady?.();
      return;
    }
    // OPFS（已保存或可用）
    if (mode === 'opfs' || isOPFSSupported()) {
      if (!mode) localStorage.setItem('lexilearn_storage_mode', 'opfs');
      setStatus('opfs-ready');
      setPath(getStoragePath() || '');
      onReady?.();
      return;
    }
    // 完全不支持任何存储
    setStatus('need-setup');
    setError('您的浏览器不支持本地文件存储，请使用 Chrome/Edge/Safari 最新版。');
  }

  async function handleSelectFolder() {
    setError('');
    const result = await requestStorageDirectory();
    if (result.ok) {
      setPath(result.path);
      setStatus('disk-ready');
      await refreshInfo();
      onReady?.();
    } else if (result.reason === 'cancelled') {
      if (isOPFSSupported()) {
        localStorage.setItem('lexilearn_storage_mode', 'opfs');
        setStatus('opfs-ready');
        setPath(getStoragePath() || '');
        await refreshInfo();
        onReady?.();
      } else {
        setError('已取消。您的浏览器不支持降级存储方式，请重新选择。');
      }
    } else if (result.reason === 'unsupported') {
      setError('您的浏览器不支持文件系统访问 API，请使用 Chrome/Edge。');
    } else {
      setError(result.error || '选择文件夹失败，请重试。');
    }
  }

  function handleReset() {
    resetDiskMode();
    setPath('');
    if (isOPFSSupported()) {
      localStorage.setItem('lexilearn_storage_mode', 'opfs');
      setStatus('opfs-ready');
      setPath(getStoragePath() || '');
    } else {
      setStatus('need-setup');
    }
  }

  async function refreshInfo() {
    try {
      const info = await getStorageSize();
      setStorageInfo(info);
    } catch {
      setStorageInfo(null);
    }
  }

  useEffect(() => {
    if (showPanel || showToggle) {
      setPath(getStoragePath() || '');
      refreshInfo();
    }
  }, [showPanel, showToggle]);

  if (status === 'pending-auth') return null;
  if (!showToggle && status === 'disk-ready' && !showPanel) return null;
  if (!showToggle && status === 'opfs-ready' && !showPanel) return null;

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
          <p className="text-muted-gray text-sm">正在初始化存储...</p>
        </div>
      </div>
    );
  }

  if (!showToggle && !showPanel && status !== 'need-setup') return null;

  return (
    <>
      {/* Floating toggle button */}
      {showToggle && !showPanel && status !== 'need-setup' && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed bottom-5 left-5 z-50 group flex items-center gap-2 rounded-xl border border-white/5 bg-deep-space/80 backdrop-blur-xl px-3.5 py-2.5 text-xs text-muted-gray shadow-lg hover:border-electric-cyan/20 hover:text-soft-white transition-all duration-200"
          title="存储管理"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-electric-cyan/70 group-hover:text-electric-cyan transition-colors">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
          <span className="hidden sm:inline">存储</span>
        </button>
      )}

      {/* Storage panel */}
      {(status === 'need-setup' || showPanel) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-dark-slate shadow-2xl animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <h2 className="text-base font-semibold text-soft-white">
                {status === 'need-setup' ? '数据存储设置' : '存储管理'}
              </h2>
              {status === 'need-setup' && !showPanel ? null : (
                <button
                  onClick={closePanel}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-gray hover:text-soft-white hover:bg-white/5 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>

            <div className="px-6 pb-6">
              {status === 'need-setup' && (
                <p className="text-xs text-muted-gray mb-5 leading-relaxed">
                  LexiLearn 将学习资料保存在您的本地磁盘上。请选择一个文件夹（建议新建空文件夹），所有数据仅存储在您电脑中。
                </p>
              )}

              {/* Local folder card */}
              <div className={`rounded-xl border p-4 mb-4 transition-all ${
                isDiskMode()
                  ? 'border-electric-cyan/20 bg-electric-cyan/5'
                  : 'border-white/5 hover:border-white/10'
              }`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric-cyan/10">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-electric-cyan">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-soft-white">本地文件夹</p>
                    <p className="text-[11px] text-muted-gray">
                      {path ? (
                        <span className="inline-flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                          </svg>
                          {path}
                        </span>
                      ) : '数据直接保存在您选择的文件夹'}
                    </p>
                  </div>
                  {isDiskMode() && (
                    <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-electric-cyan/10 text-electric-cyan border border-electric-cyan/20">
                      <span className="h-1.5 w-1.5 rounded-full bg-electric-cyan animate-pulse-glow" />
                      使用中
                    </span>
                  )}
                </div>

                {isDiskMode() ? (
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/15 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-500/8 hover:border-red-500/30 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    更换存储
                  </button>
                ) : (
                  <button
                    onClick={handleSelectFolder}
                    disabled={!supportsDiskStorage()}
                    className="w-full rounded-lg bg-electric-cyan/10 border border-electric-cyan/20 px-4 py-2.5 text-xs font-medium text-electric-cyan hover:bg-electric-cyan/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    选择本地文件夹
                  </button>
                )}
              </div>

              {/* OPFS fallback */}
              {isOPFSSupported() && !isDiskMode() && (
                <div className={`rounded-xl border p-4 mb-4 transition-all ${
                  status === 'opfs-ready'
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : 'border-white/5'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      status === 'opfs-ready' ? 'bg-emerald-500/10' : 'bg-mid-slate/50'
                    }`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={status === 'opfs-ready' ? 'text-emerald-400' : 'text-muted-gray'}>
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-soft-white">浏览器内置存储</p>
                      <p className="text-[11px] text-muted-gray">
                        {path ? (
                          <span className="inline-flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                            </svg>
                            {path}
                          </span>
                        ) : '无需选择文件夹，有容量限制'}
                      </p>
                    </div>
                    {status === 'opfs-ready' && (
                      <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
                        使用中
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Storage usage */}
              {storageInfo && (storageInfo.totalMB != null || storageInfo.totalBytes > 0) && (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-muted-gray">存储用量</span>
                    <span className="text-[11px] font-medium text-soft-white">
                      {storageInfo.totalMB != null ? `${storageInfo.totalMB} MB` : formatBytes(storageInfo.totalBytes)}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-mid-slate overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-electric-cyan to-cyan-glow transition-all duration-500"
                      style={{ width: `${Math.min((storageInfo.totalMB || 0) / 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* PDF mode preference */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <p className="text-[11px] text-muted-gray mb-3">PDF 解析默认方式</p>
                <PDFModeSetting />
              </div>

              {error && (
                <p className="mt-4 text-[11px] text-red-400/80 bg-red-500/5 rounded-lg border border-red-500/10 px-3 py-2">{error}</p>
              )}

              {status === 'need-setup' && (
                <div className="mt-4 rounded-lg border border-amber-500/10 bg-amber-500/[0.03] px-3 py-2">
                  <p className="text-[10px] text-muted-gray/70 leading-relaxed">
                    版权声明：请仅上传您拥有合法使用权的学习资料。所有上传文件仅保存在您的本地设备中。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function PDFModeSetting() {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('lexilearn_pdf_mode') || null; } catch { return null; }
  });

  function handleChange(newMode) {
    if (newMode === mode) {
      try { localStorage.removeItem('lexilearn_pdf_mode'); } catch {}
      setMode(null);
      return;
    }
    try { localStorage.setItem('lexilearn_pdf_mode', newMode); } catch {}
    setMode(newMode);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        <button
          onClick={() => handleChange('native')}
          title="原生文本提取 — 快速，适合电子书 PDF"
          className={`flex-1 rounded-lg border px-3 py-2 text-left transition-all ${
            mode === 'native'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
          }`}
        >
          <p className={`text-xs font-medium ${mode === 'native' ? 'text-emerald-400' : 'text-muted-gray'}`}>
            原生提取
          </p>
          <p className="text-[9px] text-muted-gray/60 mt-0.5">快速 · 免费 · 无需 API</p>
        </button>
        <button
          onClick={() => handleChange('vision')}
          title="AI 视觉识别 — 高精度，适合扫描版 PDF"
          className={`flex-1 rounded-lg border px-3 py-2 text-left transition-all ${
            mode === 'vision'
              ? 'border-purple-500/30 bg-purple-500/10'
              : 'border-white/5 hover:border-white/10 hover:bg-white/[0.02]'
          }`}
        >
          <p className={`text-xs font-medium ${mode === 'vision' ? 'text-purple-400' : 'text-muted-gray'}`}>
            AI 视觉识别
          </p>
          <p className="text-[9px] text-muted-gray/60 mt-0.5">高精度 · 需 API · 有配额</p>
        </button>
      </div>
      {mode && (
        <button
          onClick={() => handleChange(mode)}
          className="flex items-center gap-1 text-[10px] text-muted-gray/50 hover:text-electric-cyan transition-colors self-start"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          取消偏好，每次询问
        </button>
      )}
    </div>
  );
}
