import { useRef, useState } from 'react';

const DEFAULT_ACCEPT = ['.doc', '.docx', '.pdf', '.epub', '.mobi', '.azw', '.azw3'];

export default function FileUpload({
  onFileParsed,
  accept = DEFAULT_ACCEPT,
  title = '拖拽文档到此处',
  subtitle = '或点击浏览 — 支持 Word / PDF / EPUB / MOBI / AZW3 格式',
  icon = '📄',
}) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const allowedExts = accept.map((a) => a.replace('.', '').toLowerCase());

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
      const extList = accept.join(' / ');
      setError(`仅支持 ${extList} 格式文件`);
      return;
    }
    setError('');
    setLoading(true);
    setProgress(null);
    try {
      const { parseFile } = await import('../services/fileParser');
      const result = await parseFile(file, (info) => {
        setProgress(info);
      });
      onFileParsed(result, file);
    } catch (e) {
      setError('文件解析失败：' + e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="w-full">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 lg:p-10 text-center transition-all duration-300 ${
          dragOver
            ? 'border-electric-cyan bg-electric-cyan/5 shadow-[0_0_40px_rgba(45,212,191,0.15)]'
            : 'border-mid-slate hover:border-muted-gray hover:bg-white/[0.02]'
        }`}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
            {progress?.stage === 'text' ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-muted-gray text-sm">正在提取文本...</p>
                <p className="text-muted-gray text-xs">
                  已完成 {progress.done || 0} / {progress.totalPages} 页
                </p>
                <div className="w-48 h-1.5 rounded-full bg-mid-slate overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                    style={{
                      width: `${((progress.done || 0) / progress.totalPages) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : progress?.stage === 'ocr' ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-muted-gray text-sm">
                  正在 OCR 识别（扫描件）
                  {progress.pct != null && (
                    <span className="ml-1 text-electric-cyan">{progress.pct}%</span>
                  )}
                </p>
                <p className="text-muted-gray text-xs">
                  第 {progress.page} / {progress.totalPages} 页
                </p>
                <div className="w-48 h-1.5 rounded-full bg-mid-slate overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-electric-cyan to-cyan-glow transition-all duration-500"
                    style={{
                      width: `${((progress.page - 1 + (progress.pct || 0) / 100) / progress.totalPages) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : progress?.stage === 'llm' ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-muted-gray text-sm">
                  AI 正在并行识别文字
                  {progress.pct != null && (
                    <span className="ml-1 text-electric-cyan">{progress.pct}%</span>
                  )}
                </p>
                <p className="text-muted-gray text-xs">
                  已完成 {progress.done || 0} / {progress.totalPages} 页
                </p>
                <div className="w-48 h-1.5 rounded-full bg-mid-slate overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                    style={{
                      width: `${((progress.done || 0) / progress.totalPages) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-muted-gray text-sm">正在解析文档...</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-electric-cyan/10 text-3xl">
              {icon}
            </div>
            <div>
              <p className="text-soft-white font-medium text-lg">
                {title}
              </p>
              <p className="mt-1 text-muted-gray text-sm">
                {subtitle}
              </p>
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept.join(',')}
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-400 animate-fade-in">{error}</p>
      )}
    </div>
  );
}
