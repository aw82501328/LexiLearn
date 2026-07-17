import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { saveContent, savePDFBuffer, savePageImage, deleteContent, loadContent, loadPageImage } from '../services/dataStore';
import StorageSetup from '../components/StorageSetup';
import { logActivity } from '../services/adminApi';

/** 只渲染第 1 页作为书架封面缩略图（其余页面由 PDFPageViewer 按需渲染） */
async function saveFirstPageThumbnail(fileId, pdfBuffer) {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();

    const task = pdfjsLib.getDocument({ data: pdfBuffer.slice(0) });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    savePageImage(fileId, 1, dataUrl).catch(() => {});
  } catch {
    // 缩略图生成失败不影响主流程
  }
}

const FILE_TYPE_CONFIG = {
  pdf: { icon: '📕', label: 'PDF', border: 'border-red-500/20' },
  epub: { icon: '📗', label: 'EPUB', border: 'border-emerald-500/20' },
  doc: { icon: '📘', label: 'Word', border: 'border-blue-500/20' },
  docx: { icon: '📘', label: 'Word', border: 'border-blue-500/20' },
  mobi: { icon: '📙', label: 'Kindle', border: 'border-slate-500/20' },
  azw: { icon: '📙', label: 'Kindle', border: 'border-slate-500/20' },
  azw3: { icon: '📙', label: 'Kindle', border: 'border-slate-500/20' },
};

const PDF_MODE_KEY = 'lexilearn_pdf_mode';

const GROUP_COLORS = [
  { spine: 'from-indigo-600 to-blue-700', overlay: 'from-indigo-600/70 to-blue-700/70' },
  { spine: 'from-emerald-600 to-teal-700', overlay: 'from-emerald-600/70 to-teal-700/70' },
  { spine: 'from-rose-600 to-pink-700', overlay: 'from-rose-600/70 to-pink-700/70' },
  { spine: 'from-amber-600 to-orange-700', overlay: 'from-amber-600/70 to-orange-700/70' },
  { spine: 'from-violet-600 to-purple-700', overlay: 'from-violet-600/70 to-purple-700/70' },
  { spine: 'from-cyan-600 to-sky-700', overlay: 'from-cyan-600/70 to-sky-700/70' },
  { spine: 'from-red-600 to-rose-700', overlay: 'from-red-600/70 to-rose-700/70' },
  { spine: 'from-lime-600 to-green-700', overlay: 'from-lime-600/70 to-green-700/70' },
];

function getFileTypeConfig(name) {
  if (!name) return { icon: '📄', label: 'FILE', border: 'border-violet-500/20' };
  const ext = name.split('.').pop().toLowerCase();
  return FILE_TYPE_CONFIG[ext] || { icon: '📄', label: ext.toUpperCase() || 'FILE', border: 'border-violet-500/20' };
}

function stripExtension(name) {
  if (!name) return '';
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'its', 'his', 'how',
  'who', 'what', 'when', 'where', 'which', 'there', 'their', 'this', 'that',
  'with', 'from', 'into', 'your', 'will', 'about', 'they', 'them', 'been',
  'would', 'could', 'should', 'does', 'said', 'like', 'some', 'more', 'than',
  'just', 'very', 'much', 'also', 'over', 'under', 'after', 'before',
]);

function getTitleWords(fileName) {
  let base = stripExtension(fileName);
  base = base.replace(/^\d+[.\-_—–\s]+/, '');
  base = base.replace(/\[.*?\]/g, ' ');
  base = base.replace(/[（(].*?[）)]/g, ' ');
  base = base.replace(/[_\s,.\-—–]+\s*(?:Vol\.?\s*\d+|Volume\s*\d+|Book\s*\d+|Part\s*\d+|#\d+|第[一二三四五六七八九十\d]+[卷册部章节])\s*$/i, ' ');
  const words = base.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const w of a) { if (b.has(w)) intersect++; }
  return intersect / (a.size + b.size - intersect);
}

function groupBooksBySeries(files) {
  if (files.length < 2) return { series: [], standalone: files.map((f) => f) };

  const wordSets = files.map((f) => getTitleWords(f.name));
  const parent = Array.from({ length: files.length }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { parent[find(a)] = find(b); }

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      if (jaccard(wordSets[i], wordSets[j]) >= 0.20) {
        union(i, j);
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < files.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(files[i]);
  }

  const result = { series: [], standalone: [] };
  for (const [, books] of clusters) {
    if (books.length >= 2) {
      const words = books.map((b) => [...getTitleWords(b.name)]);
      let common = words[0].filter((w) => words.every((ws) => ws.includes(w)));
      const seriesName = common.length > 0 ? common.join(' ') : stripExtension(books[0].name);
      result.series.push({ key: seriesName, name: seriesName, books });
    } else {
      result.standalone.push(...books);
    }
  }
  return result;
}

/** mergeRef shape: { sourceFileId, targetGroupKey } — set before tick for one-shot use */
export default function HomePage() {
  const navigate = useNavigate();
  const { state, addFile, addFileBuffer, deleteFile, syncFiles, renameFile } = useApp();
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [pdfThumbnails, setPdfThumbnails] = useState({});
  const [expandedSeries, setExpandedSeries] = useState(null);
  const [expandedSeriesKey, setExpandedSeriesKey] = useState(null);

  const [seriesDragOver, setSeriesDragOver] = useState(null);
  const [shelfDragOver, setShelfDragOver] = useState(false);
  const [editingCategoryKey, setEditingCategoryKey] = useState(null);
  const [editCategoryValue, setEditCategoryValue] = useState('');
  const [categoryNames, setCategoryNames] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('lexilearn_category_names') || '{}');
    } catch { return {}; }
  });

  // Persist category names across sessions
  useEffect(() => {
    localStorage.setItem('lexilearn_category_names', JSON.stringify(categoryNames));
  }, [categoryNames]);

  const mergeActionRef = useRef(null);
  const forceGroupKeyRef = useRef(null);
  const [mergeTick, setMergeTick] = useState(0);

  // ── local multi-file upload state ──
  const [uploadTasks, setUploadTasks] = useState([]);

  // ── PDF mode selection dialog ──
  const [pdfModeDialog, setPdfModeDialog] = useState({ open: false, file: null, group: null });
  const [showStoragePanel, setShowStoragePanel] = useState(false);
  const [pdfModeRemember, setPdfModeRemember] = useState(true);

  // ── allGroups: build from auto-clustering, then apply pending manual merge ──
  const allGroups = useMemo(() => {
    const { series, standalone } = groupBooksBySeries(state.fileHistory);
    const groups = [
      ...series.map(s => ({ key: s.key, name: categoryNames[s.key] || s.name, books: s.books, isMulti: true })),
      ...standalone.map(f => ({ key: '__solo__' + f.id, name: stripExtension(f.name), books: [f], isMulti: false })),
    ];

    // Assign group colors
    groups.forEach((g, i) => {
      g.color = GROUP_COLORS[i % GROUP_COLORS.length];
    });

    // apply one-shot merge action
    const action = mergeActionRef.current;
    if (action) {
      const { sourceFileId, targetGroupKey } = action;
      const srcFile = state.fileHistory.find(f => f.id === sourceFileId);
      if (srcFile) {
        // remove from source group
        for (const g of groups) {
          g.books = g.books.filter(b => b.id !== sourceFileId);
        }
        // add to target group
        const target = groups.find(g => g.key === targetGroupKey);
        if (target) {
          target.books.push(srcFile);
          if (!target.isMulti) {
            target.isMulti = true;
            target.name = stripExtension(target.books[0].name);
          }
        }
      }
      mergeActionRef.current = null;
    }

    return groups.filter(g => g.books.length > 0);
  }, [state.fileHistory, mergeTick, categoryNames]);

  // ── Keep expanded series in sync with allGroups ──
  const expandedGroup = useMemo(() => {
    if (!expandedSeriesKey) return null;
    return allGroups.find(g => g.key === expandedSeriesKey) || null;
  }, [allGroups, expandedSeriesKey]);

  // When expandedGroup changes, keep expandedSeries in sync (for delete/rename callbacks)
  useEffect(() => {
    setExpandedSeries(expandedGroup);
    // Auto-close if group no longer exists (all books removed)
    if (!expandedGroup && expandedSeriesKey) {
      setExpandedSeriesKey(null);
    }
  }, [expandedGroup, expandedSeriesKey]);

  // ── PDF thumbnail loader ──
  useEffect(() => {
    const pdfFiles = (state.fileHistory || []).filter(f => {
      const ext = (f.name || '').split('.').pop().toLowerCase();
      return ext === 'pdf';
    });
    pdfFiles.forEach(async (file) => {
      if (pdfThumbnails[file.id]) return;
      try {
        const dataUrl = await loadPageImage(file.id, 1);
        if (dataUrl) {
          setPdfThumbnails(prev => ({ ...prev, [file.id]: dataUrl }));
        }
      } catch {
        // thumbnail not available yet
      }
    });
  }, [state.fileHistory, pdfThumbnails]);

  useEffect(() => {
    syncFiles();
  }, [syncFiles]);

  const handleFileParsed = async (result, rawFile) => {
    const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const wordCount = result.text ? result.text.split(/\s+/).length : 0;
    const fileRecord = {
      id: fileId,
      name: result.name,
      size: result.size,
      text: result.text,
      pages: result.pages || null,
      wordCount,
      createdAt: Date.now(),
    };
    addFile(fileRecord);

    const ext = result.name.split('.').pop().toLowerCase();
    if (ext === 'pdf' && rawFile) {
      const buffer = result._buffer ?? (await rawFile.arrayBuffer());
      addFileBuffer(fileId, buffer);
      savePDFBuffer(fileId, rawFile).catch((e) =>
        console.warn('PDF 文件保存到本地磁盘失败:', e.message)
      );
      saveFirstPageThumbnail(fileId, buffer);
    }

    saveContent(fileId, fileRecord).catch((e) =>
      console.warn('持久化保存失败:', e.message)
    );

    return fileId;
  };

  const handleOpenFile = (file) => {
    addFile(file);
    const navState = file.readingProgress ? { initialProgress: file.readingProgress } : undefined;
    navigate(`/learn/${file.id}`, { state: navState });
  };

  const handleDeleteFile = (fileId) => {
    deleteFile(fileId);
    deleteContent(fileId).catch((e) => console.warn('删除文件失败:', e.message));
  };

  const handleStartRename = useCallback((e, file) => {
    e.stopPropagation();
    const displayName = stripExtension(file.name);
    setEditValue(displayName);
    setEditingId(file.id);
  }, []);

  const handleSaveRename = useCallback((e, file) => {
    e.stopPropagation();
    const origExt = file.name.split('.').pop();
    const newName = (editValue.trim() || stripExtension(file.name)) + '.' + origExt;
    if (newName === file.name) {
      setEditingId(null);
      return;
    }
    renameFile(file.id, newName);
    loadContent(file.id).then((existing) => {
      saveContent(file.id, { ...(existing || {}), name: newName }).catch(() => {});
    }).catch(() => {});
    setEditingId(null);
  }, [editValue, renameFile]);

  const handleCancelRename = useCallback((e) => {
    e.stopPropagation();
    setEditingId(null);
  }, []);

  // ── PDF mode preference helpers ──
  function getSavedPdfMode() {
    try {
      return localStorage.getItem(PDF_MODE_KEY) || null;
    } catch { return null; }
  }

  function savePdfMode(mode) {
    try {
      localStorage.setItem(PDF_MODE_KEY, mode);
    } catch {}
  }

  // ── upload handler: self-contained, updates its own task in uploadTasks ──
  const uploadFile = useCallback(async (file, forceGroup = null, pdfMode = null) => {
    if (!file) return;
    const allowedExts = ['pdf', 'doc', 'docx', 'epub', 'mobi', 'azw', 'azw3'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
      const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      setUploadTasks(prev => [...prev, { id: taskId, name: file.name, error: '仅支持 PDF / Word / EPUB / MOBI 格式文件', targetGroup: forceGroup }]);
      return;
    }

    // 如果是 PDF 且没有指定模式，检查是否有保存的偏好
    if (ext === 'pdf' && !pdfMode) {
      const savedMode = getSavedPdfMode();
      if (savedMode === 'vision' || savedMode === 'ocr') {
        pdfMode = savedMode;
      } else {
        // 没有偏好，弹出选择对话框
        setPdfModeDialog({ open: true, file, group: forceGroup });
        return;
      }
    }

    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setUploadTasks(prev => [...prev, { id: taskId, name: file.name, stage: 'init', targetGroup: forceGroup }]);
    try {
      // 先检查配额，避免超限后仍解析并保存文件
      setUploadTasks(prev => prev.map(t => t.id === taskId ? { ...t, stage: 'quota' } : t));
      await logActivity('upload', { fileName: file.name });

      const tParse = performance.now();
      const { parseFile } = await import('../services/fileParser');
      const result = await parseFile(file, (info) => {
        setUploadTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...info } : t));
      }, { pdfMode });
      console.log('[perf] parseFile total:', (performance.now() - tParse).toFixed(0), 'ms');
      const tHook = performance.now();
      const fileId = await handleFileParsed(result, file);
      console.log('[perf] handleFileParsed:', (performance.now() - tHook).toFixed(0), 'ms');
      setUploadTasks(prev => prev.filter(t => t.id !== taskId));

      if (forceGroup) {
        forceGroupKeyRef.current = forceGroup;
        mergeActionRef.current = { sourceFileId: fileId, targetGroupKey: forceGroup };
        forceGroupKeyRef.current = null;
        setMergeTick(t => t + 1);
      }
    } catch (e) {
      setUploadTasks(prev => prev.map(t => t.id === taskId ? { ...t, error: e.status === 429 ? e.message : '文件解析失败：' + e.message } : t));
    }
  }, [handleFileParsed]);

  // ── PDF mode selection handler ──
  function handlePdfModeSelect(mode) {
    const { file, group } = pdfModeDialog;
    if (pdfModeRemember) {
      savePdfMode(mode);
    }
    setPdfModeDialog({ open: false, file: null, group: null });
    if (file) {
      uploadFile(file, group, mode);
    }
  }

  const hasBooks = state.fileHistory.length > 0;

  // ── helper: render a single book card (used in expanded view) ──
  const renderBookCard = (file, groupColor = null) => {
    const config = getFileTypeConfig(file.name);
    const displayName = stripExtension(file.name);
    const wordCount = file.wordCount ?? (file.text ? file.text.split(/\s+/).length : 0);
    const progress = file.readingProgress;
    const pct = progress && progress.total > 0 ? Math.round((progress.page / progress.total) * 100) : 0;
    const hasProgress = pct > 0;
    const isEditing = editingId === file.id;
    const isPdf = config.label === 'PDF';
    const thumbnail = pdfThumbnails[file.id];
    return (
      <div key={file.id} className="group relative cursor-pointer" onClick={() => { if (!isEditing) handleOpenFile(file); }}>
        <div className="absolute -bottom-1.5 left-1 right-1 h-3 rounded-b-lg bg-black/30 blur-sm transition-all duration-300 group-hover:-bottom-2 group-hover:blur-md" />
        <div
          className="relative h-64 rounded-xl overflow-hidden border border-white/10 shadow-lg transition-all duration-300 group-hover:-translate-y-3 group-hover:shadow-2xl group-hover:shadow-electric-cyan/10 group-hover:border-white/20"
          style={isPdf && thumbnail ? { backgroundImage: `url(${thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
        >
          {!(isPdf && thumbnail) && (
            <div className={`absolute inset-0 bg-gradient-to-br ${groupColor?.overlay || 'from-dark-slate/90 via-dark-slate/60 to-dark-slate/30'}`} />
          )}
          <div className="absolute top-2.5 left-2.5 z-10"><span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-slate/70 border border-white/10 text-muted-gray font-medium backdrop-blur-sm">{config.label}</span></div>
          <div className="absolute top-2.5 right-2.5 z-10"><span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-slate/70 border border-white/10 text-muted-gray font-medium backdrop-blur-sm">{wordCount.toLocaleString()} 词</span></div>
          <div className="relative z-10 flex flex-col justify-center h-full px-4 pb-4 pt-4">
            {isEditing ? (
              <div className="flex flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(e, file); if (e.key === 'Escape') handleCancelRename(e); }} className="w-full px-2 py-1 text-xs font-bold text-soft-white text-center bg-dark-slate border border-electric-cyan/40 rounded-lg outline-none focus:border-electric-cyan" />
                <div className="flex gap-2"><button onClick={(e) => handleSaveRename(e, file)} className="text-[11px] px-2.5 py-0.5 rounded-md bg-electric-cyan/20 text-electric-cyan hover:bg-electric-cyan/30 transition-all">保存</button><button onClick={handleCancelRename} className="text-[11px] px-2.5 py-0.5 rounded-md bg-white/5 text-muted-gray hover:bg-white/10 transition-all">取消</button></div>
              </div>
            ) : isPdf ? <div className="flex-1" /> : (
              <div className="flex-1 flex items-center justify-center">
                <h3 className="text-sm font-bold text-electric-cyan leading-snug line-clamp-2 text-center tracking-wide transition-opacity group-hover:opacity-0" onDoubleClick={(e) => handleStartRename(e, file)} title="双击编辑书名">{displayName}</h3>
              </div>
            )}
          </div>
          {hasProgress && (
            <div className="absolute bottom-0 inset-x-0">
              <div className="h-1 w-full bg-white/5"><div className="h-full bg-gradient-to-r from-electric-cyan to-cyan-glow transition-all duration-500" style={{ width: `${pct}%` }} /></div>
              <div className="flex justify-center py-0.5 bg-dark-slate/60"><span className="text-[9px] text-electric-cyan/80 font-medium">{pct}%</span></div>
            </div>
          )}
          <div className="absolute inset-0 z-20 bg-dark-slate/85 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-3 rounded-xl">
            <button onClick={(e) => { e.stopPropagation(); handleOpenFile(file); }} className="rounded-xl bg-gradient-to-r from-electric-cyan/30 to-cyan-glow/20 px-5 py-2 text-sm font-semibold text-electric-cyan hover:from-electric-cyan/40 hover:to-cyan-glow/30 transition-all shadow-lg shadow-electric-cyan/10 border border-electric-cyan/20">{hasProgress ? '继续阅读' : '开始阅读'}</button>
            {!isPdf && <button onClick={(e) => { e.stopPropagation(); handleStartRename(e, file); }} className="rounded-lg px-4 py-1.5 text-xs text-muted-gray hover:text-amber-400 hover:bg-amber-400/10 transition-all">重命名</button>}
            <button onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.id); }} className="rounded-lg px-4 py-1.5 text-xs text-muted-gray hover:text-red-400 hover:bg-red-500/10 transition-all">从书架移除</button>
          </div>
        </div>
      </div>
    );
  };

  // ── helper: upload progress card for a single task ──
  const renderUploadingCard = (task) => {
    const hasError = !!task.error;
    return (
      <div key={task.id} className="relative">
        <div className="absolute -bottom-1.5 left-1 right-1 h-3 rounded-b-lg bg-black/30 blur-sm" />
        <div className="relative h-64 rounded-xl overflow-hidden border border-electric-cyan/30 shadow-lg shadow-electric-cyan/10 bg-dark-slate/60">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4">
            <p className="text-muted-gray text-xs font-medium truncate max-w-full px-2">{task.name}</p>
            {hasError ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400/60">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <p className="text-red-400 text-[11px] max-w-[180px] leading-snug text-center">{task.error}</p>
                <button
                  onClick={() => setUploadTasks(prev => prev.filter(t => t.id !== task.id))}
                  className="text-[11px] px-2.5 py-1 rounded-md bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-all"
                >关闭</button>
              </>
            ) : (
              <>
                <div className="h-10 w-10 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
                {task.stage === 'llm' ? (
                  <div className="flex flex-col items-center gap-1.5 w-full">
                    <p className="text-muted-gray text-xs">AI 识别文字</p>
                    <p className="text-electric-cyan text-xs font-medium">
                      {task.done || 0} / {task.totalPages} 页
                    </p>
                    <div className="w-full max-w-[120px] h-1 rounded-full bg-mid-slate overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                        style={{ width: `${task.totalPages > 0 ? ((task.done || 0) / task.totalPages) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ) : task.stage === 'text' ? (
                  <div className="flex flex-col items-center gap-1.5 w-full">
                    <p className="text-muted-gray text-xs">提取文本</p>
                    <p className="text-muted-gray text-[10px]">
                      {task.done || 0} / {task.totalPages} 页
                    </p>
                    <div className="w-full max-w-[120px] h-1 rounded-full bg-mid-slate overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                        style={{ width: `${task.totalPages > 0 ? ((task.done || 0) / task.totalPages) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ) : task.stage === 'ocr' ? (
                  <div className="flex flex-col items-center gap-1.5 w-full">
                    <p className="text-muted-gray text-xs">OCR 识别文字</p>
                    <p className="text-muted-gray text-[10px]">
                      {task.page || 0} / {task.totalPages} 页
                    </p>
                    <div className="w-full max-w-[120px] h-1 rounded-full bg-mid-slate overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                        style={{ width: `${task.totalPages > 0 ? ((task.page || 0) / task.totalPages) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ) : task.stage === 'quota' ? (
                  <p className="text-muted-gray text-xs">检查上传配额...</p>
                ) : (
                  <p className="text-muted-gray text-xs">正在处理文件...</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── helper: uploading content overlay for category cards (reuses task progress) ──
  const renderCategoryUploadContent = (task) => {
    if (!task) return null;
    if (task.error) {
      return (
        <div className="flex flex-col items-center gap-2 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400/60">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <p className="text-red-400 text-xs max-w-[140px] leading-snug">{task.error}</p>
          <button
            onClick={() => setUploadTasks(prev => prev.filter(t => t.id !== task.id))}
            className="text-[11px] px-2.5 py-1 rounded-md bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-all"
          >关闭</button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 w-full px-2">
        <div className="h-10 w-10 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
        {task.stage === 'llm' ? (
          <div className="flex flex-col items-center gap-1.5 w-full">
            <p className="text-muted-gray text-xs">AI 识别文字</p>
            <p className="text-electric-cyan text-xs font-medium">
              {task.done || 0} / {task.totalPages} 页
            </p>
            <div className="w-full max-w-[120px] h-1 rounded-full bg-mid-slate overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                style={{ width: `${task.totalPages > 0 ? ((task.done || 0) / task.totalPages) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : task.stage === 'text' ? (
          <div className="flex flex-col items-center gap-1.5 w-full">
            <p className="text-muted-gray text-xs">提取文本</p>
            <p className="text-muted-gray text-[10px]">
              {task.done || 0} / {task.totalPages} 页
            </p>
            <div className="w-full max-w-[120px] h-1 rounded-full bg-mid-slate overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                style={{ width: `${task.totalPages > 0 ? ((task.done || 0) / task.totalPages) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : task.stage === 'ocr' ? (
          <div className="flex flex-col items-center gap-1.5 w-full">
            <p className="text-muted-gray text-xs">OCR 识别文字</p>
            <p className="text-muted-gray text-[10px]">
              {task.page || 0} / {task.totalPages} 页
            </p>
            <div className="w-full max-w-[120px] h-1 rounded-full bg-mid-slate overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-purple-400 transition-all duration-500"
                style={{ width: `${task.totalPages > 0 ? ((task.page || 0) / task.totalPages) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : task.stage === 'quota' ? (
          <p className="text-muted-gray text-xs">检查上传配额...</p>
        ) : (
          <p className="text-muted-gray text-xs">正在处理文件...</p>
        )}
      </div>
    );
  };

  // ── helper: category card (series stack or standalone book) ──
  const renderCategoryCard = (group) => {
    const isDragTarget = seriesDragOver === group.key;
    const activeUploadTask = uploadTasks.find(t => t.targetGroup === group.key);

    const dropHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSeriesDragOver(null);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        Array.from(files).forEach((f) => uploadFile(f, group.key));
      }
    };

    if (!group.isMulti) {
      // Single book — show a regular book card inside a category wrapper
      const file = group.books[0];
      const config = getFileTypeConfig(file.name);
      const displayName = stripExtension(file.name);
      const wordCount = file.wordCount ?? (file.text ? file.text.split(/\s+/).length : 0);
      const isEditing = editingId === file.id;
      const isPdf = config.label === 'PDF';
      const thumbnail = pdfThumbnails[file.id];

      return (
        <div
          key={group.key}
          className={`relative cursor-pointer group rounded-xl border transition-all duration-200 ${
            isDragTarget
              ? 'border-electric-cyan bg-electric-cyan/5 shadow-[0_0_20px_rgba(45,212,191,0.1)]'
              : 'border-white/10 hover:border-white/20'
          }`}
          onClick={() => {
            if (activeUploadTask) return;
            setExpandedSeries(group);
            setExpandedSeriesKey(group.key);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSeriesDragOver(group.key);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSeriesDragOver(null);
          }}
          onDrop={dropHandler}
        >
          {activeUploadTask ? (
            <div className="h-64 flex items-center justify-center">{renderCategoryUploadContent(activeUploadTask)}</div>
          ) : (
            <div>
              <div className="absolute -bottom-1.5 left-1 right-1 h-3 rounded-b-lg bg-black/30 blur-sm transition-all duration-300 group-hover:-bottom-2 group-hover:blur-md" />
              <div
                className="relative h-64 rounded-xl overflow-hidden border border-white/10 shadow-lg transition-all duration-300 group-hover:-translate-y-3 group-hover:shadow-2xl group-hover:shadow-electric-cyan/10 group-hover:border-white/20"
                style={isPdf && thumbnail ? { backgroundImage: `url(${thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
              >
                {!(isPdf && thumbnail) && <div className={`absolute inset-0 bg-gradient-to-br ${group.color?.overlay || 'from-dark-slate/90 via-dark-slate/60 to-dark-slate/30'}`} />}
                <div className="absolute top-2.5 left-2.5 z-10"><span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-slate/70 border border-white/10 text-muted-gray font-medium backdrop-blur-sm">{config.label}</span></div>
                <div className="absolute top-2.5 right-2.5 z-10"><span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-slate/70 border border-white/10 text-muted-gray font-medium backdrop-blur-sm">{wordCount.toLocaleString()} 词</span></div>
                <div className="relative z-10 flex flex-col justify-center h-full px-4 pb-4 pt-4">
                  {isEditing ? (
                    <div className="flex flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRename(e, file); if (e.key === 'Escape') handleCancelRename(e); }} className="w-full px-2 py-1 text-xs font-bold text-soft-white text-center bg-dark-slate border border-electric-cyan/40 rounded-lg outline-none focus:border-electric-cyan" />
                      <div className="flex gap-2"><button onClick={(e) => handleSaveRename(e, file)} className="text-[11px] px-2.5 py-0.5 rounded-md bg-electric-cyan/20 text-electric-cyan hover:bg-electric-cyan/30 transition-all">保存</button><button onClick={handleCancelRename} className="text-[11px] px-2.5 py-0.5 rounded-md bg-white/5 text-muted-gray hover:bg-white/10 transition-all">取消</button></div>
                    </div>
                  ) : isPdf ? <div className="flex-1" /> : (
                    <div className="flex-1 flex items-center justify-center">
                      <h3 className="text-sm font-bold text-electric-cyan leading-snug line-clamp-2 text-center tracking-wide transition-opacity group-hover:opacity-0" onDoubleClick={(e) => handleStartRename(e, file)} title="双击编辑书名">{displayName}</h3>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* hover overlay */}
          {!activeUploadTask && (
            <div className="absolute inset-0 z-20 bg-dark-slate/85 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-3 rounded-xl">
              <button onClick={(e) => { e.stopPropagation(); handleOpenFile(file); }} className="rounded-xl bg-gradient-to-r from-electric-cyan/30 to-cyan-glow/20 px-5 py-2 text-sm font-semibold text-electric-cyan hover:from-electric-cyan/40 hover:to-cyan-glow/30 transition-all shadow-lg shadow-electric-cyan/10 border border-electric-cyan/20">查看书籍</button>
              {!isPdf && <button onClick={(e) => { e.stopPropagation(); handleStartRename(e, file); }} className="rounded-lg px-4 py-1.5 text-xs text-muted-gray hover:text-amber-400 hover:bg-amber-400/10 transition-all">重命名</button>}
              <button onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.id); }} className="rounded-lg px-4 py-1.5 text-xs text-muted-gray hover:text-red-400 hover:bg-red-500/10 transition-all">从书架移除</button>
            </div>
          )}
        </div>
      );
    }

    // Multi-book series stack
    const stackBooks = group.books.slice(0, 4);
    const stackColors = [
      'from-slate-800 to-slate-950', 'from-zinc-700 to-zinc-900',
      'from-neutral-700 to-neutral-900', 'from-stone-700 to-stone-900',
    ];
    return (
      <div
        key={group.key}
        className={`relative cursor-pointer group/series rounded-xl border transition-all duration-200 ${
          isDragTarget
            ? 'border-electric-cyan bg-electric-cyan/5 shadow-[0_0_20px_rgba(45,212,191,0.1)]'
            : 'border-white/10 hover:border-white/20'
        }`}
        onClick={() => {
          if (activeUploadTask) return;
          setExpandedSeries(group);
          setExpandedSeriesKey(group.key);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSeriesDragOver(group.key);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSeriesDragOver(null);
        }}
        onDrop={dropHandler}
      >
        {activeUploadTask ? (
          <div className="h-64 flex items-center justify-center">{renderCategoryUploadContent(activeUploadTask)}</div>
        ) : (
          <div className="h-64 p-3 flex flex-col items-center justify-center">
            <div className="relative w-full max-w-[115px] h-52">
              {stackBooks.map((file, idx) => {
                const isPdf = (file.name || '').split('.').pop().toLowerCase() === 'pdf';
                const thumbnail = pdfThumbnails[file.id];
                const config = getFileTypeConfig(file.name);
                return (
                  <div
                    key={file.id}
                    className="absolute inset-x-0 top-0 bottom-6 rounded-lg border border-white/15 shadow-xl transition-all duration-300 group-hover/series:shadow-2xl"
                    style={{
                      transform: `rotate(${(idx - 1.5) * 3}deg) translateX(${(idx - 1.5) * 5}px) translateY(${idx * 3}px)`,
                      zIndex: stackBooks.length - idx,
                    }}
                  >
                    {isPdf && thumbnail ? (
                      <div className="w-full h-full rounded-lg" style={{ backgroundImage: `url(${thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                    ) : (
                      <div className={`w-full h-full rounded-lg bg-gradient-to-br ${group.color?.spine || stackColors[idx % stackColors.length]}`}>
                        <div className="absolute left-0 top-0 bottom-0 w-2 rounded-l-lg bg-white/10" />
                        <div className="absolute inset-0 flex items-center justify-center p-3">
                          <span className="text-[9px] font-bold text-white/80 text-center leading-tight line-clamp-3">{stripExtension(file.name)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {editingCategoryKey === group.key ? (
              <div className="flex items-center gap-2 mt-auto" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={editCategoryValue}
                  onChange={(e) => setEditCategoryValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const newName = editCategoryValue.trim() || group.name;
                      setCategoryNames(prev => ({ ...prev, [group.key]: newName }));
                      setEditingCategoryKey(null);
                    }
                    if (e.key === 'Escape') setEditingCategoryKey(null);
                  }}
                  onBlur={() => {
                    const newName = editCategoryValue.trim() || group.name;
                    setCategoryNames(prev => ({ ...prev, [group.key]: newName }));
                    setEditingCategoryKey(null);
                  }}
                  className="w-20 px-2 py-0.5 text-[10px] font-semibold text-soft-white text-center bg-dark-slate border border-electric-cyan/40 rounded outline-none focus:border-electric-cyan"
                />
              </div>
            ) : (
              <p className="text-center text-[10px] text-muted-gray/60 mt-auto">
                <span
                  className="text-xs font-semibold text-soft-white cursor-text hover:text-electric-cyan transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCategoryKey(group.key);
                    setEditCategoryValue(group.name);
                  }}
                  title="点击编辑分类名"
                >{group.name}</span>
                <span className="ml-1">· {group.books.length} 册</span>
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      {/* Hero Section */}
      <div className="text-center mb-10 animate-fade-in">
        <h1 className="text-4xl font-bold tracking-tight text-soft-white sm:text-5xl">
          用{' '}
          <span className="bg-gradient-to-r from-electric-cyan to-cyan-glow bg-clip-text text-transparent">
            AI
          </span>
          {' '}轻松学英语
        </h1>
        <p className="mt-4 text-lg text-muted-gray max-w-2xl mx-auto">
          上传英文文档，点击单词秒查词典释义，选中句子即时翻译，畅享地道发音。
        </p>
      </div>

      {/* Bookshelf */}
      <div className="mb-12 animate-slide-up">
        <div className="flex items-center gap-4 mb-6">
          <div className="h-8 w-1.5 rounded-full bg-gradient-to-b from-electric-cyan to-cyan-glow" />
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-soft-white flex items-center gap-2 flex-wrap">
              我的书架
              {hasBooks && (
                <span className="text-base font-normal text-muted-gray">
                  · 共 {state.fileHistory.length} 本
                </span>
              )}
              <button
                onClick={() => setShowStoragePanel(true)}
                className="ml-1 inline-flex items-center gap-1 rounded-lg border border-white/5 px-2 py-1 text-xs text-muted-gray hover:text-electric-cyan hover:border-electric-cyan/20 hover:bg-white/[0.03] transition-all"
                title="存储管理"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                </svg>
                存储
              </button>
            </h2>
            <p className="text-sm text-muted-gray mt-0.5">
              {hasBooks
                ? '点击分类查看书籍 · 拖拽文件到书架即可上传'
                : '将文件拖拽到书架即可上传'}
            </p>
          </div>
        </div>

        {/* Shelf background — accepts drops for upload */}
        <div
          className={`relative rounded-2xl border min-h-[200px] overflow-hidden transition-all duration-300 ${
            shelfDragOver
              ? 'border-electric-cyan bg-electric-cyan/5 shadow-[0_0_40px_rgba(45,212,191,0.15)]'
              : 'border-white/10 bg-gradient-to-b from-amber-900/20 via-dark-slate/40 to-dark-slate/20'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShelfDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShelfDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShelfDragOver(false);
            Array.from(e.dataTransfer.files).forEach((f) => uploadFile(f));
          }}
        >
          <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-amber-900/30 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-[calc(50%-2px)] h-[3px] bg-amber-900/15 pointer-events-none" />

          {/* Drag-over hint */}
          {shelfDragOver && uploadTasks.length === 0 && (
            <div className="absolute inset-0 z-30 bg-electric-cyan/5 flex items-center justify-center pointer-events-none">
              <p className="text-electric-cyan text-lg font-medium">释放以上传文件</p>
            </div>
          )}

          {!hasBooks && uploadTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="text-6xl mb-5 opacity-40">📖</div>
              <p className="text-muted-gray text-base font-medium mb-1">书架空空如也</p>
              <p className="text-muted-gray/50 text-sm">将文件拖拽到此区域即可上传</p>
            </div>
          ) : expandedGroup ? (
            /* ── Expanded category view ── */
            <div className="p-6">
              <button
                onClick={() => { setExpandedSeries(null); setExpandedSeriesKey(null); }}
                className="flex items-center gap-2 mb-4 text-muted-gray/60 hover:text-electric-cyan transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span className="text-sm">返回分类</span>
              </button>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
                {expandedGroup.books.map((file) => renderBookCard(file, expandedGroup.color))}
              </div>
            </div>
          ) : (
            /* ── Main shelf grid ── */
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
                {allGroups.map((group) => renderCategoryCard(group))}
                {uploadTasks.filter(t => !t.targetGroup).map((task) => renderUploadingCard(task))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Features grid */}
      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          { icon: '🔍', title: '即时词典', desc: '点击单词秒速查询英英释义、音标和例句，基于免费词典 API，无需等待。' },
          { icon: '🔊', title: '语音朗读', desc: '浏览器原生语音合成，支持调节语速。可朗读单词、句子及全文。' },
          { icon: '📈', title: '学习追踪', desc: '内置统计功能，随时掌握翻译和听读学习进度。' },
        ].map((feature, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/5 bg-dark-slate/30 p-6 hover:border-electric-cyan/10 transition-all duration-300"
          >
            <div className="text-2xl mb-3">{feature.icon}</div>
            <h3 className="text-sm font-semibold text-soft-white mb-1">{feature.title}</h3>
            <p className="text-xs text-muted-gray leading-relaxed">{feature.desc}</p>
          </div>
        ))}
      </div>

      {/* ── PDF 解析模式选择弹窗 ── */}
      {pdfModeDialog.open && pdfModeDialog.file && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-dark-slate p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-soft-white mb-3">选择 PDF 解析方式</h2>

            <p className="text-sm text-muted-gray mb-1">
              文件：<span className="text-soft-white">{pdfModeDialog.file.name}</span>
            </p>
            <p className="text-xs text-muted-gray/60 mb-5">
              {((pdfModeDialog.file.size || 0) / 1024 / 1024).toFixed(1)} MB
            </p>

            <div className="space-y-3 mb-5">
              {/* OCR text extraction */}
              <button
                onClick={() => handlePdfModeSelect('ocr')}
                className="w-full rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-left hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all"
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xl">🔍</span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">OCR 文字识别</p>
                    <p className="text-[11px] text-muted-gray">本地识别 · 免费 · 无需 API</p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-gray/70 leading-relaxed ml-10">
                  将 PDF 逐页渲染为图片，使用本地 OCR 引擎识别文字。
                  适合纯文字 PDF，速度取决于设备性能。
                </p>
              </button>

              {/* Vision model */}
              <button
                onClick={() => handlePdfModeSelect('vision')}
                className="w-full rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 text-left hover:bg-purple-500/10 hover:border-purple-500/30 transition-all"
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xl">🤖</span>
                  <div>
                    <p className="text-sm font-semibold text-purple-400">AI 视觉识别</p>
                    <p className="text-[11px] text-muted-gray">高精度 · 需 API · 有配额限制</p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-gray/70 leading-relaxed ml-10">
                  用视觉模型逐页识别文字，对扫描版、图片型 PDF 效果好。
                  速度较慢，依赖外部 API，需注意限流。
                </p>
              </button>
            </div>

            {/* Remember preference checkbox */}
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={pdfModeRemember}
                onChange={(e) => setPdfModeRemember(e.target.checked)}
                className="h-4 w-4 rounded border-mid-slate bg-dark-slate accent-electric-cyan"
              />
              <span className="text-xs text-muted-gray">记住此选择，下次不再询问</span>
            </label>

            <p className="text-[10px] text-muted-gray/50 mb-4">
              后续可在页面左上角「存储」按钮中重置此偏好。
            </p>

            <button
              onClick={() => setPdfModeDialog({ open: false, file: null, group: null })}
              className="w-full rounded-lg border border-white/5 px-4 py-2 text-xs text-muted-gray hover:text-soft-white hover:border-white/15 transition-all"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {/* 存储管理面板 */}
      {showStoragePanel && (
        <StorageSetup forceShow onReady={() => {}} onClose={() => setShowStoragePanel(false)} />
      )}
    </div>
  );
}
