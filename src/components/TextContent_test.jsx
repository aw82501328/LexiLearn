import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import TranslationPopup from './TranslationPopup';
import TTSControls from './TTSControls';
import { useApp } from '../context/AppContext';
import { speakBySentences, stopTTS } from '../services/tts';
import { highlight, clearAll } from '../utils/sentenceMarker';

const WORDS_PER_PAGE = 350;

function splitIntoPages(paragraphs, wordsPerPage) {
  const pages = [];
  let cur = 0, buf = [];
  for (const p of paragraphs) {
    const wc = p.split(/\s+/).length;
    if (cur + wc > wordsPerPage && buf.length) { pages.push(buf); buf = []; cur = 0; }
    buf.push(p); cur += wc;
  }
  if (buf.length) pages.push(buf);
  return pages;
}

export default function TextContent({ text, fileName, toolbarNode }) {
  const { recordTranslation, addToVocabulary } = useApp();
  const [selWord, setSelWord] = useState(null);
  const [selSent, setSelSent] = useState(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [showW, setShowW] = useState(false);
  const [showS, setShowS] = useState(false);
  const [readIdx, setReadIdx] = useState(null);
  const [page, setPage] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [autoFlip, setAutoFlip] = useState(true);
  const [flipTarget, setFlipTarget] = useState(null);

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const textPanelRef = useRef(null);
  const sentenceCountRef = useRef(0);
  const handleSentenceRef = useRef(null);
  const autoFlipGenRef = useRef(0); // generation counter: prevents overlapping async callbacks from corrupting state
  const flipPendingRef = useRef(false); // setSpk ignores setIsSpeaking(false) when auto-flip queued
  const autoFlipRef = useRef(autoFlip);
  autoFlipRef.current = autoFlip;
  const pageRef = useRef(page);
  pageRef.current = page;

  const paras = useMemo(() => text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0), [text]);
  const pg = useMemo(() => splitIntoPages(paras, WORDS_PER_PAGE), [paras]);

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
    // 正在朗读中 — 停止当前 TTS，跳转到目标页并从头朗读
    stopTTS();
    clearAll(textPanelRef.current);
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
      flipPendingRef.current = false; // 重置，避免 setSpk 的 guards 卡死按钮状态
      try {
        await speakBySentences(flatSentences, () => speedRef.current, (idx) => handleSentenceRef.current?.(idx));
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

  const clickW = useCallback((w, e, idx) => {
    setPos({ x: e.target.getBoundingClientRect().left + e.target.getBoundingClientRect().width / 2, y: e.target.getBoundingClientRect().bottom + 8 });
    setSelWord(w); setReadIdx(idx); setShowW(true);
    recordTranslation();
    if (w.length > 1) addToVocabulary(w);
  }, [recordTranslation, addToVocabulary]);

  const selectS = useCallback(() => {
    const s = window.getSelection()?.toString().trim();
    if (s && s.split(/\s+/).length > 1) {
      const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
      setSelSent(s); setShowS(true); recordTranslation();
    }
  }, [recordTranslation]);

  const handleSentence = useCallback((sentenceIdx) => {
    highlight(textPanelRef.current, sentenceIdx);
  }, []);

  useEffect(() => { handleSentenceRef.current = handleSentence; });

  const handleTTSFinish = useCallback(() => {
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
          />
          {total > 1 && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoFlip}
                  onChange={(e) => setAutoFlip(e.target.checked)}
                  className="accent-electric-cyan h-3.5 w-3.5"
                />
                <span className="text-xs text-muted-gray">自动翻页</span>
              </label>
              <span className="text-xs text-soft-white font-medium min-w-[60px] text-center">{page + 1} / {total}</span>
              <button onClick={() => handleManualPageChange(Math.max(0, page - 1))} disabled={page === 0} className="inline-flex items-center gap-1 rounded-lg border border-mid-slate px-2.5 py-1 text-xs text-muted-gray transition-all hover:border-electric-cyan/30 hover:text-electric-cyan disabled:opacity-30 disabled:cursor-not-allowed">← 上一页</button>
              <button onClick={() => handleManualPageChange(Math.min(total - 1, page + 1))} disabled={page >= total - 1} className="inline-flex items-center gap-1 rounded-lg border border-mid-slate px-2.5 py-1 text-xs text-muted-gray transition-all hover:border-electric-cyan/30 hover:text-electric-cyan disabled:opacity-30 disabled:cursor-not-allowed">下一页 →</button>
            </div>
          )}
        </>,
        toolbarNode,
      )}

      <div ref={textPanelRef} className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/5 bg-dark-slate/50 p-5 leading-relaxed" onMouseUp={selectS}>
        {pp.length === 0 ? (
          <p className="text-muted-gray italic text-center py-12">文档中没有找到文本内容。</p>
        ) : (
          blocks.map((b, bi) => (
            <p key={bi} className="mb-4 last:mb-0">
              {b.wps.length <= 1
                ? (() => {
                    return (
                      <span data-sentence-index={b.startIdx} style={{ marginRight: '0.25em', padding: '2px 4px', borderRadius: '4px' }}>
                        {b.wd.map((w) => (
                          <span key={w.gIdx}>
                            <span className="word-hoverable inline-block px-0.5 rounded" onClick={(e) => clickW(w.cleaned, e, w.gIdx)}>{w.cleaned}</span>
                            {w.punctuation}
                            <span> </span>
                          </span>
                        ))}
                      </span>
                    );
                  })()
                : (() => {
                    let o = 0;
                    return b.sens.map((_, si) => {
                      const c = b.wps[si];
                      const sw = b.wd.slice(o, o + c); o += c;
                      const sid = b.startIdx + si;
                      return (
                        <span key={si} data-sentence-index={sid} style={{ marginRight: '0.25em', padding: '2px 4px', borderRadius: '4px' }}>
                          {sw.map((w) => (
                            <span key={w.gIdx}>
                              <span className="word-hoverable inline-block px-0.5 rounded" onClick={(e) => clickW(w.cleaned, e, w.gIdx)}>{w.cleaned}</span>
                              {w.punctuation}
                              <span> </span>
                            </span>
                          ))}
                        </span>
                      );
                    });
                  })()}
            </p>
          ))
        )}
      </div>

      {showW && selWord && (
        <TranslationPopup word={selWord} position={pos} mode="word" fullText={pt} wordGlobalIndex={readIdx} onClose={() => { setShowW(false); setSelWord(null); }} />
      )}
      {showS && selSent && (
        <TranslationPopup word={selSent} position={pos} mode="sentence" onClose={() => { setShowS(false); setSelSent(null); }} />
      )}
    </div>
  );
}
