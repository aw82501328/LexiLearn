import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import TTSControls from './TTSControls';
import { useApp } from '../context/AppContext';
import { speakBySentences, stopTTS, getDefaultVoiceURI } from '../services/tts';
import { translateToChinese } from '../services/translator';
import { highlight, clearAll } from '../utils/sentenceMarker';



const WORDS_PER_PAGE = 150;

function splitSentenceGroups(textSegment) {
  // 将一段文本按句子拆分
  return textSegment.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function splitIntoPages(paragraphs) {
  const pages = [];
  let cur = 0, buf = [];

  function flushIfNeeded() {
    if (buf.length > 0) { pages.push(buf); buf = []; cur = 0; }
  }

  for (const p of paragraphs) {
    const words = p.split(/\s+/);
    const wc = words.length;

    // 短段落：直接尝试放入当前页
    if (wc <= WORDS_PER_PAGE) {
      if (cur + wc > WORDS_PER_PAGE) flushIfNeeded();
      buf.push(p);
      cur += wc;
      continue;
    }

    // 长段落：按句子边界切分，每块 ≤ WORDS_PER_PAGE
    const sentences = splitSentenceGroups(p);
    flushIfNeeded(); // 长段落从新页开始

    let chunkWords = 0;
    let chunkStart = 0;
    for (let i = 0; i < sentences.length; i++) {
      const sw = sentences[i].split(/\s+/).length;
      if (chunkWords > 0 && chunkWords + sw > WORDS_PER_PAGE) {
        // 当前句子块已满，换页
        buf.push(sentences.slice(chunkStart, i).join(' '));
        pages.push(buf);
        buf = [];
        cur = 0;
        chunkWords = 0;
        chunkStart = i;
      }
      chunkWords += sw;
    }
    // 剩余句子
    if (chunkStart < sentences.length) {
      buf.push(sentences.slice(chunkStart).join(' '));
      cur = chunkWords;
    }
  }

  if (buf.length) pages.push(buf);
  return pages;
}

/**
 * 内联翻译组件
 * - variant="word"：单词翻译，紧凑显示在单词正下方
 * - variant="sentence"：整句翻译，显示在句子下方（带"译"标记）
 */
function InlineTranslation({ text, mode, variant = 'sentence' }) {
  const [zh, setZh] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!text) {
      setZh(null);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    async function fetchTranslation() {
      setLoading(true);
      setError('');
      setZh(null);
      try {
        const result = await translateToChinese(text);
        if (!cancelled) {
          setZh(result);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      }
    }
    fetchTranslation();
    return () => { cancelled = true; };
  }, [text]);

  if (!text) return null;

  if (variant === 'word') {
    return (
      <span className="text-xs text-electric-cyan leading-tight whitespace-nowrap">
        {loading ? (
          <span className="text-muted-gray">…</span>
        ) : error ? (
          <span className="text-red-400">…</span>
        ) : (
          zh || ''
        )}
      </span>
    );
  }

  return (
    <div className="mt-1.5 mb-1 pl-3 border-l-2 border-electric-cyan/30 text-sm">
      <span className="text-xs text-electric-cyan font-medium mr-1.5">
        {mode === 'word' ? '词' : '译'}
      </span>
      {loading ? (
        <span className="text-muted-gray">翻译中…</span>
      ) : error ? (
        <span className="text-red-400">{error}</span>
      ) : (
        <span className="text-soft-white/90">{zh || '暂无翻译'}</span>
      )}
    </div>
  );
}

export default function TextContent({ text, fileName, toolbarNode, onProgress, initialPage }) {
  const { state, recordTranslation, addToVocabulary, removeFromVocabulary } = useApp();
  const [translationTarget, setTranslationTarget] = useState(null); // { sentenceIndex, text, mode }
  const [page, setPage] = useState(initialPage >= 0 ? initialPage : 0);
  const [speaking, setSpeaking] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [autoFlip, setAutoFlip] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState(getDefaultVoiceURI);
  const [sentencePause, setSentencePause] = useState(0);
  const [flipTarget, setFlipTarget] = useState(null);

  const autoFlipRef = useRef(autoFlip);
  autoFlipRef.current = autoFlip;

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const voiceRef = useRef(selectedVoice);
  voiceRef.current = selectedVoice;
  const sentencePauseRef = useRef(sentencePause);
  sentencePauseRef.current = sentencePause;
  const textPanelRef = useRef(null);
  const sentenceCountRef = useRef(0);
  const handleSentenceRef = useRef(null);
  const autoFlipGenRef = useRef(0); // generation counter: prevents overlapping async callbacks from corrupting state
  const manualPageFlipRef = useRef(false); // 手动翻页中，阻止旧 handleTTSFinish 误触发
  const pageTransitionRef = useRef(false); // 翻页进行中，阻止快速重复点击
  const flipPendingRef = useRef(false); // setSpk ignores setIsSpeaking(false) when auto-flip queued
  const pageRef = useRef(page);
  pageRef.current = page;

  const paras = useMemo(() => text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0), [text]);
  const pg = useMemo(() => splitIntoPages(paras), [paras]);

  const vocabSet = useMemo(() => {
    const set = new Set();
    state.vocabulary.forEach((v) => set.add(v.word));
    return set;
  }, [state.vocabulary]);

  const pp = pg[page] || [];
  const total = pg.length;
  const pt = pp.join('\n\n');

  // 预计算句子数组（逐段拆分，与 DOM data-sentence-index 顺序一致）
  const flatSentences = useMemo(() => {
    const result = [];
    for (const p of pp) {
      const sens = p.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
      result.push(...sens);
    }
    return result;
  }, [pp]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [page]);

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
    manualPageFlipRef.current = true;    // 阻止旧 handleTTSFinish 误触发
    autoFlipGenRef.current++;           // 递增 generation，使旧回调失活
    flipPendingRef.current = true;       // 阻止 setSpk 重置 speaking
    setPage(newPage);                    // 直接切换页码，由 page effect 触发朗读
  }, [speaking]);

  useEffect(() => {
    const h = (e) => {
      if (e.key === 'ArrowLeft') handleManualPageChange(Math.max(0, page - 1));
      if (e.key === 'ArrowRight') handleManualPageChange(Math.min(total - 1, page + 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [total, page, handleManualPageChange]);

  useEffect(() => {
    if (onProgress && total > 0) {
      onProgress({ page: page + 1, total });
    }
  }, [page, total, onProgress]);

  useEffect(() => () => stopTTS(), []);

  // 自动翻页第一步：仅切换页码
  useEffect(() => {
    if (flipTarget == null) return;
    setPage(flipTarget);
    setFlipTarget(null);
  }, [flipTarget]);

  // 自动翻页第二步：页码切换后 DOM 已更新，开始朗读
  const pageInitRef = useRef(true);
  useEffect(() => {
    if (pageInitRef.current) { pageInitRef.current = false; return; }
    if (!speaking) return;

    const gen = autoFlipGenRef.current;
    if (gen === 0) return; // 不是自动翻页触发的页面变化（用户手动点击朗读），跳过

    clearAll(textPanelRef.current);

    (async () => {
      // 等待上一个页面的 speechSynthesis 完全释放
      await new Promise((r) => setTimeout(r, 250));
      pageTransitionRef.current = false; // 翻页完成，开放下次点击
      flipPendingRef.current = false; // 重置，避免 setSpk 的 guards 卡死按钮状态
      try {
        await speakBySentences(flatSentences, () => speedRef.current, (idx) => handleSentenceRef.current?.(idx), () => voiceRef.current, () => sentencePauseRef.current);
      } catch { /* */ }
      // generation 未变 = 朗读自然结束，没有额外的翻页排队
      if (autoFlipGenRef.current === gen) {
        if (autoFlipRef.current && pageRef.current < total - 1) {
          autoFlipGenRef.current++;
          flipPendingRef.current = true;
          setFlipTarget(pageRef.current + 1);
          // 不设 speaking=false，等翻页自动朗读
        } else {
          flipPendingRef.current = false; // 确保 setSpk 不会因为残留 true 而忽略本次 speaking=false
          setSpeaking(false);
          clearAll(textPanelRef.current);
        }
      }
    })();
  }, [page, speaking, flatSentences]);

  const clickW = useCallback((w, e, idx, sentenceIdx) => {
    setTranslationTarget({ sentenceIndex: sentenceIdx, wordIndex: idx, text: w, mode: 'word' });
    recordTranslation();
    if (w.length > 1) {
      // 已加入生词本 → 再点击一次移除；未加入 → 加入
      if (vocabSet.has(w.toLowerCase())) {
        removeFromVocabulary(w);
      } else {
        addToVocabulary(w);
      }
    }
  }, [recordTranslation, addToVocabulary, removeFromVocabulary, vocabSet]);

  const selectS = useCallback(() => {
    const selection = window.getSelection();
    const s = selection?.toString().trim();
    if (s && s.split(/\s+/).length > 1) {
      // 定位选区起始句子：从 anchorNode 向上找最近的 data-sentence-index 元素
      let sentenceIndex = null;
      const node = selection.anchorNode;
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      const sentEl = el?.closest?.('[data-sentence-index]');
      if (sentEl) sentenceIndex = Number(sentEl.dataset.sentenceIndex);

      setTranslationTarget({ sentenceIndex, text: s, mode: 'sentence' });
      recordTranslation();
    }
  }, [recordTranslation]);

  const handleSentence = useCallback((sentenceIdx) => {
    highlight(textPanelRef.current, sentenceIdx);
  }, []);

  useEffect(() => { handleSentenceRef.current = handleSentence; });

  const handleTTSFinish = useCallback(() => {
    // 手动翻页中：旧 TTS 会话的 finish 回调，直接跳过
    if (manualPageFlipRef.current) {
      manualPageFlipRef.current = false;
      return;
    }
    // 从 TTSControls.doSpeak 触发：如果在此期间页面已被手动切换，跳过本次回调
    if (pageRef.current !== page) return;

    clearAll(textPanelRef.current);
    if (autoFlip && page < total - 1) {
      autoFlipGenRef.current++;
      flipPendingRef.current = true;
      setFlipTarget(page + 1);
      return; // 保持 speaking=true，等翻页自动朗读
    }
    flipPendingRef.current = false;
    setSpeaking(false);
  }, [autoFlip, page, total]);

  const setSpk = useCallback((v) => {
    if (!v && flipPendingRef.current) {
      flipPendingRef.current = false;
      return; // auto-flip queued, don't set speaking=false
    }
    setSpeaking(v);
    if (!v) {
      clearAll(textPanelRef.current);
    }
  }, []);

  // 渲染数据 — 同时计算每个句子的全局序号（页内从 0 起）
  let gIdx = 0;
  let sentIdx = 0;
  const blocks = pp.map((para) => {
    const wds = para.split(/\s+/);
    const wd = wds.map((w) => {
      const cl = w.replace(/[^a-zA-Z-']/g, '');
      const pu = w.match(/[^a-zA-Z-'\s]+/g)?.[0] || '';
      return { cleaned: cl, punctuation: pu, gIdx: gIdx++ };
    });
    const sens = para.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
    const wps = sens.map((s) => { const m = s.match(/\S+/g); return m ? m.length : 0; });
    const startIdx = sentIdx;
    sentIdx += wps.length;
    return { wd, wps, sens, startIdx };
  });

  const totalSenses = sentIdx;
  sentenceCountRef.current = totalSenses;

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏通过 Portal 渲染到顶栏 */}
      {toolbarNode && createPortal(
        <>
          <TTSControls
            text={flatSentences}
            isSpeaking={speaking}
            setIsSpeaking={setSpk}
            onSentence={handleSentence}
            onFinish={handleTTSFinish}
            speed={speed}
            onSpeedChange={setSpeed}
            voice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            sentencePause={sentencePause}
            onSentencePauseChange={setSentencePause}
            autoFlip={autoFlip}
            onAutoFlipChange={setAutoFlip}
          />
        </>,
        toolbarNode,
      )}

      <div className="relative flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-10 gap-4">
        {/* Text content */}
        <div className="relative rounded-xl border border-white/5 bg-dark-slate/50 pt-6 pb-10 px-4 flex flex-col min-h-0 lg:col-span-10">
          <div className="text-xs text-muted-gray mb-1.5 text-center shrink-0 h-5 flex items-center justify-center">段落</div>
          <div className="h-px bg-white/5 shrink-0 mb-4" />
          <div className="flex-1 min-h-0 overflow-y-auto rounded-b-xl">
            <div ref={textPanelRef} className="text-[15px] leading-[2.4] h-full" onMouseUp={selectS}>
            {pp.length === 0 ? (
              <p className="text-muted-gray italic text-center py-12">文档中没有找到文本内容。</p>
            ) : (
              blocks.map((b, bi) => {
                let o = 0;
                return (
                  <div key={bi} className="mb-8 last:mb-0">
                    {b.sens.map((_, si) => {
                      const c = b.wps[si];
                      const sw = b.wd.slice(o, o + c); o += c;
                      const sid = b.startIdx + si;
                      return (
                        <div key={sid} className={si === 0 ? '' : 'mt-3'}>
                          <span data-sentence-index={sid} className="block" style={{ padding: '2px 4px', borderRadius: '4px' }}>
                            {sw.map((w) => {
                              const isVocab = vocabSet.has(w.cleaned.toLowerCase());
                              const showWordTrans = translationTarget?.mode === 'word' && translationTarget?.wordIndex === w.gIdx;
                              return (
                                <span key={w.gIdx}>
                                  <span className="inline-flex flex-col items-center align-bottom">
                                    <span
                                      className={`inline-block px-1 rounded cursor-pointer transition-colors duration-150 ${
                                        isVocab
                                          ? 'text-red-400 hover:text-red-300'
                                          : 'word-hoverable hover:text-cyan-glow'
                                      }`}
                                      onClick={(e) => clickW(w.cleaned, e, w.gIdx, sid)}
                                    >
                                      {w.cleaned}
                                    </span>
                                    {showWordTrans && (
                                      <InlineTranslation text={translationTarget.text} mode="word" variant="word" />
                                    )}
                                  </span>
                                  {w.punctuation}
                                  <span> </span>
                                </span>
                              );
                            })}
                          </span>
                          {translationTarget?.mode === 'sentence' && translationTarget?.sentenceIndex === sid && (
                            <InlineTranslation text={translationTarget.text} mode="sentence" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
          </div>

          {/* Page arrow buttons */}
          {total > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleManualPageChange(Math.max(0, page - 1)); }}
                disabled={page === 0}
                className="absolute left-0 -translate-x-1/2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center bg-dark-slate/70 border border-white/10 text-muted-gray/60 hover:text-electric-cyan hover:border-electric-cyan/30 hover:bg-dark-slate/90 transition-all disabled:opacity-0 disabled:cursor-not-allowed"
                style={{ marginTop: '1px' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleManualPageChange(Math.min(total - 1, page + 1)); }}
                disabled={page >= total - 1}
                className="absolute right-0 translate-x-1/2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center bg-dark-slate/70 border border-white/10 text-muted-gray/60 hover:text-electric-cyan hover:border-electric-cyan/30 hover:bg-dark-slate/90 transition-all disabled:opacity-0 disabled:cursor-not-allowed"
                style={{ marginTop: '1px' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </>
          )}
          {/* Page indicator */}
          {total > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-muted-gray/70">
              {page + 1} / {total}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
