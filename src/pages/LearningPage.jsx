import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import TextContent from '../components/TextContent';
import PDFPageViewer from '../components/PDFPageViewer';
import { useApp } from '../context/AppContext';
import { loadContent, loadPDFBuffer, saveContent } from '../services/dataStore';

export default function LearningPage() {
  const { fileId } = useParams();
  const location = useLocation();
  const { state, getFileBuffer, addFileBuffer, updateFileProgress } = useApp();
  const [fileData, setFileData] = useState(null);
  const [pdfBuffer, setPdfBuffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toolbarNode, setToolbarNode] = useState(null);
  const progressRef = useRef(null);
  const saveTimerRef = useRef(null);

  const navigateState = location.state;
  const initialProgress = navigateState?.initialProgress || null;

  useEffect(() => {
    (async () => {
      // 优先从 context 获取
      const found = state.fileHistory.find((f) => f.id === fileId);
      if (found) {
        // 从历史记录打开的 metadata 可能不包含 text，需要从服务端加载完整内容
        if (!found.text && !found.pages) {
          try {
            const saved = await loadContent(fileId);
            if (saved) {
              setFileData(saved);
              const ext = saved.name?.split('.').pop().toLowerCase();
              if (ext === 'pdf') {
                const buf = await loadPDFBuffer(fileId).catch(() => null);
                if (buf) { addFileBuffer(fileId, buf); setPdfBuffer(buf); }
              }
              setLoading(false);
              return;
            }
          } catch (e) { console.warn('从服务端加载内容失败:', e.message); }
        }
        setFileData(found);
        const ext = found.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') {
          let buf = getFileBuffer(fileId);
          if (!buf) {
            // 内存中没有，从磁盘加载
            try {
              buf = await loadPDFBuffer(fileId);
              if (buf) addFileBuffer(fileId, buf);
            } catch (e) {
              console.warn('从磁盘加载 PDF 失败:', e.message);
            }
          }
          setPdfBuffer(buf);
        }
      } else {
        // context 中没有（如页面刷新），从 data/ 目录加载
        try {
          const saved = await loadContent(fileId);
          if (saved) setFileData(saved);
          // 同时加载 PDF 二进制
          const ext = saved?.name?.split('.').pop().toLowerCase();
          if (ext === 'pdf') {
            try {
              const buf = await loadPDFBuffer(fileId);
              if (buf) {
                addFileBuffer(fileId, buf);
                setPdfBuffer(buf);
              }
            } catch (e) {
              console.warn('从磁盘加载 PDF 失败:', e.message);
            }
          }
        } catch (e) {
          console.warn('从磁盘加载失败:', e.message);
        }
      }
      setLoading(false);
    })();
  }, [fileId, state.fileHistory, getFileBuffer, addFileBuffer]);

  const handleProgress = useCallback((progress) => {
    progressRef.current = progress;
    updateFileProgress(fileId, progress);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      loadContent(fileId).then((existing) => {
        saveContent(fileId, { ...(existing || {}), readingProgress: progress }).catch(() => {});
      }).catch(() => {});
    }, 2000);
  }, [fileId, updateFileProgress]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (progressRef.current) {
        loadContent(fileId).then((existing) => {
          saveContent(fileId, { ...(existing || {}), readingProgress: progressRef.current }).catch(() => {});
        }).catch(() => {});
      }
    };
  }, [fileId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
          <p className="text-muted-gray text-sm">正在加载文档...</p>
        </div>
      </div>
    );
  }

  if (!fileData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-muted-gray text-lg">文件未找到。</p>
        <Link
          to="/"
          className="text-electric-cyan hover:text-cyan-glow text-sm underline underline-offset-4"
        >
          返回首页上传
        </Link>
      </div>
    );
  }

  const isPdf = fileData.name.split('.').pop().toLowerCase() === 'pdf';

  return (
    <div className="mx-auto w-full max-w-[90rem] px-3 md:px-6 py-3 h-[calc(100vh-var(--tab-bar-height)-var(--safe-area-bottom))] md:h-[calc(100vh-56px)] flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 text-sm mb-2 shrink-0 flex-wrap">
        <span className="text-soft-white truncate max-w-[300px] mr-3">{fileData.name}</span>
        {/* 子组件的控件通过 Portal 渲染到这里 */}
        <div ref={setToolbarNode} className="flex items-center gap-3 ml-auto" />
      </div>

      {/* Content: PDF viewer or text content — fills remaining height */}
      <div className="flex-1 min-h-0">
        {isPdf && pdfBuffer ? (
          <PDFPageViewer
            fileId={fileId}
            pdfBuffer={pdfBuffer}
            fileName={fileData.name}
            pages={fileData.pages}
            fullText={fileData.text}
            toolbarNode={toolbarNode}
            onProgress={handleProgress}
            initialPage={initialProgress?.page}
          />
        ) : (
          <TextContent text={fileData.text} fileName={fileData.name} toolbarNode={toolbarNode} onProgress={handleProgress} initialPage={initialProgress ? initialProgress.page - 1 : undefined} />
        )}
      </div>
    </div>
  );
}
