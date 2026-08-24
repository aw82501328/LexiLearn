import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import TranslationPanel from './TranslationPanel';
import { stopTTS, getDefaultVoiceURI } from '../services/tts';
import TTSControls from './TTSControls';
import { useApp } from '../context/AppContext';
import { savePageImage, loadPageImage } from '../services/dataStore';
import { highlight, clearAll } from '../utils/sentenceMarker';



pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const SCALE = 2.5;

export default function PDFPageViewer({ fileId, pdfBuffer, fileName, pages, fullText, toolbarNode, onProgress, initialPage }) {
  const { state, addToVocabulary, removeFromVocabulary, recordTranslation } = useApp();
  const [pdfDoc, setPdfDoc] = useState(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageImages, setPageImages] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [wordTranslation, setWordTranslation] = useState(null);
  const [sentenceTranslation, setSentenceTranslation] = useState(null);
  const [activeTab, setActiveTab] = useState('click');

  const [speaking, setSpeaking] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [autoFlip, setAutoFlip] = useState(true);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState(getDefaultVoiceURI);
  const [sentencePause, setSentencePause] = useState(0);
  const [autoSpeakToken, setAutoSpeakToken] = useState(0);




  const textPanelRef = useRef(null);
  const renderedPagesRef = useRef(new Set());
  const [page, setPage] = useState(initialPage || 1);
  const pageRef = useRef(page);
  pageRef.current = page;
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const flipGenRef = useRef(0);         // generation counter: 手动翻页或自动翻页时递增
  const manualPageFlipRef = useRef(false); // 手动翻页中，阻止旧 handleTTSFinish 误触发
  const pageTransitionRef = useRef(false); // 翻页进行中，阻止快速重复点击
  const flipPendingRef = useRef(false); // 翻页排队中，阻止 setIsSpeaking 重置 speaking

  const currentPageText = (pages && pages.length >= page) ? (pages[page - 1] || '') : '';
  const hasPagesText = Array.isArray(pages) && pages.some((p) => p && p.trim());
  const textForPanel = hasPagesText ? currentPageText : (fullText || '');
  const displayText = hasPagesText ? currentPageText : (fullText || '');

  // 按标点拆句子，每句单独一行
  const paragraphBlocks = useMemo(() => {
    if (!textForPanel) return [];
    const cleanText = textForPanel.replace(/\n\s*\n/g, '\n').replace(/\n/g, ' ');
    const sentences = cleanText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
    const blocks = [];
    for (let i = 0; i < sentences.length; i++) {
      blocks.push({ sentences: [sentences[i]], startIdx: i });
    }
    return blocks;
  }, [textForPanel]);

  const vocabSet = useMemo(() => {
    const set = new Set();
    state.vocabulary.forEach((v) => set.add(v.word));
    return set;
  }, [state.vocabulary]);

  // 扁平句子数组，与段落渲染的 data-sentence-index 顺序一致，传给 TTS 确保高亮同步
  const flatSentences = useMemo(() => {
    const result = [];
    for (const block of paragraphBlocks) {
      result.push(...block.sentences);
    }
    return result;
  }, [paragraphBlocks]);

  // 高亮回调：直接 DOM 操作
  const lastSentenceRef = useRef(-1);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const showTranslationRef = useRef(showTranslation);
  showTranslationRef.current = showTranslation;
  const handleSentence = useCallback((sentenceIdx) => {
    if (sentenceIdx !== lastSentenceRef.current) {
      lastSentenceRef.current = sentenceIdx;
      highlight(textPanelRef.current, sentenceIdx);
      // 翻译列可见且选中"自动"选项卡时才翻译
      if (showTranslationRef.current && activeTabRef.current === 'auto' && flatSentences[sentenceIdx]) {
        setSentenceTranslation({ word: flatSentences[sentenceIdx], mode: 'sentence', auto: true });
      }
    }
  }, [flatSentences]);

  const handleTTSFinish = useCallback(() => {
    // 手动翻页中：旧 TTS 会话的 finish 回调，直接跳过
    if (manualPageFlipRef.current) {
      manualPageFlipRef.current = false;
      return;
    }
    // 从 TTSControls.doSpeak 触发：如果在此期间页面已被手动切换，跳过本次回调
    if (pageRef.current !== page) return;

    lastSentenceRef.current = -1;
    clearAll(textPanelRef.current);
    if (autoFlip && page < totalPages) {
      flipGenRef.current++;
      flipPendingRef.current = true;
      setPage(p => p + 1);
      setAutoSpeakToken(t => t + 1);
    }
  }, [autoFlip, page, totalPages]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        renderedPagesRef.current.clear();
        setPageImages({});
        const task = pdfjsLib.getDocument({ data: pdfBuffer.slice(0) });
        const pdf = await task.promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError('PDF 加载失败：' + e.message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfBuffer]);

  const renderPageImage = useCallback(async (pageNum) => {
    if (!pdfDoc) return;
    const key = String(pageNum);
    if (renderedPagesRef.current.has(key)) return;
    renderedPagesRef.current.add(key);

    const fallbacks = [];

    if (fileId) {
      fallbacks.push(
        loadPageImage(fileId, pageNum).then((cached) => {
          if (cached) return cached;
          throw new Error('no-cache');
        })
      );
    }

    const renderPdf = (async () => {
      const p = await pdfDoc.getPage(pageNum);
      const viewport = p.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await p.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL();
      if (fileId) {
        savePageImage(fileId, pageNum, dataUrl).catch(() => {});
      }
      return dataUrl;
    })();

    fallbacks.push(renderPdf);

    try {
      const result = await Promise.any(fallbacks);
      setPageImages((prev) => ({ ...prev, [pageNum]: result }));
    } catch {
      renderedPagesRef.current.delete(key);
    }
  }, [pdfDoc, fileId]);

  useEffect(() => {
    if (!pdfDoc) return;
    renderPageImage(page);
    if (page > 1) renderPageImage(page - 1);
    if (page < totalPages) renderPageImage(page + 1);
  }, [pdfDoc, page, totalPages, renderPageImage]);

  const handleManualPageChange = useCallback((newPage) => {
    if (!speaking) {
      setPage(newPage);
      return;
    }
    // 正在朗读中 — 阻止快速重复点击
    if (pageTransitionRef.current) return;
    pageTransitionRef.current = true;
    stopTTS();
    clearAll(textPanelRef.current);
    lastSentenceRef.current = -1;
    manualPageFlipRef.current = true; // 阻止旧 handleTTSFinish 误触发
    flipGenRef.current++;           // 递增 generation，使旧 handleTTSFinish 失活
    flipPendingRef.current = true;   // 阻止 setIsSpeaking 重置 speaking
    setPage(newPage);
    setAutoSpeakToken(t => t + 1);   // 触发 TTSControls 从新页首句朗读
  }, [speaking]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'ArrowLeft') handleManualPageChange(Math.max(1, page - 1));
      if (e.key === 'ArrowRight') handleManualPageChange(Math.min(totalPages, page + 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [totalPages, page, handleManualPageChange]);

  useEffect(() => {
    if (onProgress && totalPages > 0) {
      onProgress({ page, total: totalPages });
    }
  }, [page, totalPages, onProgress]);

  useEffect(() => () => stopTTS(), []);

  const handleWordClick = useCallback((e) => {
    const target = e.target.closest('[data-word]');
    if (!target) return;
    const word = target.dataset.word;
    if (!word || word.length < 2) return;
    setWordTranslation({ word, mode: 'word' });
    setActiveTab('click');
    // 已加入生词本 → 再点击一次移除；未加入 → 加入
    if (vocabSet.has(word.toLowerCase())) {
      removeFromVocabulary(word);
    } else {
      addToVocabulary(word);
    }
    recordTranslation();
  }, [addToVocabulary, removeFromVocabulary, recordTranslation, vocabSet]);

  const handleTextMouseUp = useCallback(() => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.split(/\s+/).length > 1) {
      setWordTranslation({ word: sel, mode: 'sentence' });
      setActiveTab('click');
      recordTranslation();
    }
  }, [recordTranslation]);

  const currentImage = pageImages[page];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
          <p className="text-muted-gray text-sm">正在加载 PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏通过 Portal 渲染到顶栏 */}
      {toolbarNode && createPortal(
        <>
          <TTSControls
            text={flatSentences}
            isSpeaking={speaking}
            setIsSpeaking={(v) => {
              if (!v && flipPendingRef.current) {
                flipPendingRef.current = false;
                return;
              }
              if (v && pageTransitionRef.current) {
                pageTransitionRef.current = false;
              }
              setSpeaking(v);
              if (!v) { lastSentenceRef.current = -1; clearAll(textPanelRef.current); }
            }}
            speed={speed}
            onSpeedChange={setSpeed}
            onSentence={handleSentence}
            onFinish={handleTTSFinish}
            voice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            sentencePause={sentencePause}
            onSentencePauseChange={setSentencePause}
            shouldAutoSpeak={autoSpeakToken > 0 ? autoSpeakToken : undefined}
            autoFlip={autoFlip}
            onAutoFlipChange={setAutoFlip}
          />
        </>,
        toolbarNode,
      )}

      {/* 内容区域：填充剩余高度 */}
      <div className="relative flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-10 gap-4">
        {/* Left: PDF page area (4 cols) */}
        <div className="lg:col-span-4 rounded-xl border border-white/5 bg-dark-slate/50 p-2 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-gray mb-1.5 text-center shrink-0 h-5 flex items-center justify-center">原文</div>
          <div className="h-px bg-white/5 shrink-0" />
          {currentImage ? (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={currentImage}
                alt={`第 ${page} 页`}
                className="max-w-full max-h-full object-contain shadow-lg rounded select-none"
                draggable={false}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center flex-1">
              <div className="h-6 w-6 animate-spin-slow rounded-full border-2 border-electric-cyan border-t-transparent" />
            </div>
          )}
        </div>

        {/* Middle: Extracted text */}
        <div
          ref={textPanelRef}
          className={`relative rounded-xl border border-white/5 bg-dark-slate/50 pt-2 pb-6 px-6 lg:pb-8 lg:px-8 flex flex-col ${showTranslation ? 'lg:col-span-4' : 'lg:col-span-6'}`}
          onMouseUp={handleTextMouseUp}
          style={{ cursor: 'text' }}
        >
          <div className="text-xs text-muted-gray mb-1.5 text-center shrink-0 h-5 flex items-center justify-center">段落</div>
          <div className="h-px bg-white/5 shrink-0" />
          <div className="flex-1 min-h-0 overflow-y-auto rounded-b-xl">
            <div className="min-h-full flex flex-col justify-center">
          {textForPanel ? (
            <div
              className="text-sm text-soft-white leading-relaxed max-w-[52ch] mx-auto"
              onClick={handleWordClick}
            >
              {paragraphBlocks.map((block, bi) => (
                <p key={bi} className="mb-3 last:mb-0">
                  {block.sentences.map((sentence, si) => {
                    const sid = block.startIdx + si;
                    return (
                      <span
                        key={si}
                        data-sentence-index={sid}
                        style={{ marginRight: '0.25em', padding: '2px 4px', borderRadius: '4px' }}
                      >
                        {sentence.split(/\s+/).map((token, ti) => {
                          const clean = token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
                          const prefix = token.match(/^[^a-zA-Z]+/)?.[0] || '';
                          const suffix = token.match(/[^a-zA-Z]+$/)?.[0] || '';

                          if (!clean || clean.length < 2) {
                            return <span key={ti}>{token} </span>;
                          }
                          const isVocab = vocabSet.has(clean.toLowerCase());
                          return (
                            <span key={ti}>
                              {prefix}
                              <span
                                data-word={clean}
                                className={`inline-block px-0.5 rounded cursor-pointer transition-colors duration-150 ${
                                  isVocab
                                    ? 'text-red-400 hover:text-red-300'
                                    : 'word-hoverable hover:text-cyan-glow'
                                }`}
                              >
                                {clean}
                              </span>
                              {suffix}
                              <span> </span>
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </p>
              ))}
            </div>
          ) : null}
            </div>
          </div>

          {/* Page arrow buttons */}
          {totalPages > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleManualPageChange(Math.max(1, page - 1)); }}
                disabled={page <= 1}
                className="absolute left-0 -translate-x-1/2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center bg-dark-slate/70 border border-white/10 text-muted-gray/60 hover:text-electric-cyan hover:border-electric-cyan/30 hover:bg-dark-slate/90 transition-all disabled:opacity-0 disabled:cursor-not-allowed"
                style={{ marginTop: '1px' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleManualPageChange(Math.min(totalPages, page + 1)); }}
                disabled={page >= totalPages}
                className="absolute right-0 translate-x-1/2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center bg-dark-slate/70 border border-white/10 text-muted-gray/60 hover:text-electric-cyan hover:border-electric-cyan/30 hover:bg-dark-slate/90 transition-all disabled:opacity-0 disabled:cursor-not-allowed"
                style={{ marginTop: '1px' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </>
          )}
          {/* Page indicator */}
          {totalPages > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-muted-gray/70">
              {page} / {totalPages}
            </div>
          )}
        </div>

        {/* Right: Translation panel */}
        {showTranslation && (
        <div className="relative lg:col-span-2 rounded-xl border border-white/5 bg-dark-slate/50 overflow-hidden flex flex-col min-h-0 p-2">
          <div className="flex shrink-0 rounded-lg bg-white/5 p-0.5 mb-1.5 h-5 items-center gap-0.5">
            <button
              onClick={() => setShowTranslation(false)}
              className="w-5 h-full rounded-md flex items-center justify-center text-muted-gray/50 hover:text-electric-cyan hover:bg-electric-cyan/10 transition-all shrink-0"
              title="隐藏翻译"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
            </button>
            <button
              onClick={() => setActiveTab('click')}
              className={`flex-1 rounded-md py-0.5 px-3 text-xs font-medium transition-all ${
                activeTab === 'click'
                  ? 'bg-electric-cyan/20 text-electric-cyan'
                  : 'text-muted-gray hover:text-soft-white'
              }`}
            >
              点击
            </button>
            <button
              onClick={() => setActiveTab('auto')}
              className={`flex-1 rounded-md py-0.5 px-3 text-xs font-medium transition-all ${
                activeTab === 'auto'
                  ? 'bg-electric-cyan/20 text-electric-cyan'
                  : 'text-muted-gray hover:text-soft-white'
              }`}
            >
              自动
            </button>
          </div>
          <div className="h-px bg-white/5 shrink-0" />
          <div className="flex-1 min-h-0">
            <TranslationPanel
              word={activeTab === 'click' ? (wordTranslation?.word || null) : (sentenceTranslation?.word || null)}
              mode={activeTab === 'click' ? (wordTranslation?.mode || 'word') : 'sentence'}
              fullText={activeTab === 'click' ? displayText : undefined}
              auto={activeTab === 'auto'}
            />
          </div>
        </div>
        )}

    {/* Show toggle when hidden */}
    {!showTranslation && (
      <button
        onClick={() => setShowTranslation(true)}
        className="absolute right-0 -translate-x-1/2 top-1.5 w-7 h-7 rounded-full bg-dark-slate/70 border border-white/10 flex items-center justify-center text-muted-gray/60 hover:text-electric-cyan hover:bg-dark-slate/90 hover:border-electric-cyan/20 transition-all z-10"
        title="显示翻译"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
      </button>
    )}
      </div>
    </div>
  );
}
