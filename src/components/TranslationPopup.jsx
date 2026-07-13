import { useState, useEffect, useRef } from 'react';
import { lookupWord } from '../services/dictionary';
import { translateToChinese } from '../services/translator';
import { speakText, speakTextFrom } from '../services/tts';
import { useApp } from '../context/AppContext';

export default function TranslationPopup({ word, position, mode, onClose, fullText, wordGlobalIndex }) {
  const { recordTTS } = useApp();
  const [cnTranslation, setCnTranslation] = useState(null);
  const [dictData, setDictData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isReadingFrom, setIsReadingFrom] = useState(false);
  const popupRef = useRef(null);

  useEffect(() => {
    if (!word) return;
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError('');
      setDictData(null);
      setCnTranslation(null);

      if (mode === 'word') {
        const [dictResult, zhResult] = await Promise.allSettled([
          lookupWord(word),
          translateToChinese(word),
        ]);

        if (cancelled) return;

        if (dictResult.status === 'fulfilled') {
          setDictData(dictResult.value);
        }
        if (zhResult.status === 'fulfilled') {
          setCnTranslation(zhResult.value);
        } else {
          setCnTranslation(dictResult.value?.definition || '未找到翻译');
        }

        if (!dictResult.value && zhResult.status === 'rejected') {
          setError('查询失败');
        }
        setLoading(false);
      } else {
        try {
          const result = await translateToChinese(word);
          if (!cancelled) {
            setCnTranslation(result);
            setLoading(false);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e.message);
            setLoading(false);
          }
        }
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [word, mode]);

  useEffect(() => {
    function handleClick(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  const handleSpeak = async () => {
    setIsSpeaking(true);
    try {
      await speakText(null, word);
      recordTTS();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsSpeaking(false);
    }
  };

  const handleReadFromHere = async () => {
    if (fullText == null || wordGlobalIndex == null) return;
    setIsReadingFrom(true);
    try {
      await speakTextFrom(fullText, wordGlobalIndex);
      recordTTS();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsReadingFrom(false);
    }
  };

  const POPUP_W = 360;
  const POPUP_H = 340;
  const PADDING = 12;

  let left = position.x - POPUP_W / 2;
  left = Math.max(PADDING, Math.min(left, window.innerWidth - POPUP_W - PADDING));

  let top = position.y;
  if (top + POPUP_H + PADDING > window.innerHeight) {
    top = position.y - POPUP_H - 16;
  }
  top = Math.max(PADDING, Math.min(top, window.innerHeight - POPUP_H - PADDING));

  const adjustedStyle = { left, top };

  return (
    <div
      ref={popupRef}
      style={adjustedStyle}
      className="fixed z-50 w-[360px] max-h-[400px] overflow-y-auto rounded-xl border border-electric-cyan/20 bg-dark-slate/95 backdrop-blur-xl p-5 text-sm animate-slide-up floating-card"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-electric-cyan font-semibold">
          {mode === 'word' ? '单词查询' : '整句翻译'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSpeak}
            disabled={isSpeaking || loading}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
              isSpeaking
                ? 'bg-electric-cyan/20 text-electric-cyan'
                : 'bg-white/5 text-muted-gray hover:bg-white/10 hover:text-soft-white'
            }`}
            title="朗读此单词"
          >
            <span className={`${isSpeaking ? 'animate-pulse' : ''}`}>
              {isSpeaking ? '🔊' : '🔈'}
            </span>
          </button>
          {mode === 'word' && fullText != null && wordGlobalIndex != null && (
            <button
              onClick={handleReadFromHere}
              disabled={isReadingFrom || loading}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
                isReadingFrom
                  ? 'bg-cyan-glow/20 text-cyan-glow'
                  : 'bg-electric-cyan/10 text-electric-cyan hover:bg-electric-cyan/20'
              }`}
              title="从此处开始朗读全文"
            >
              <span className={`${isReadingFrom ? 'animate-pulse' : ''}`}>
                {isReadingFrom ? '⏸' : '📖'}
              </span>
              从此朗读
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted-gray hover:text-soft-white transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 py-4">
          <div className="h-4 w-3/4 shimmer rounded" />
          <div className="h-4 w-1/2 shimmer rounded" />
          {mode === 'word' && <div className="h-4 w-2/3 shimmer rounded" />}
        </div>
      ) : error && !dictData && !cnTranslation ? (
        <p className="text-red-400 text-sm py-2">{error}</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-gray mb-1">原文：</p>
            <p className="text-soft-white font-medium text-base">{word}</p>
          </div>

          {dictData?.partOfSpeech && (
            <div className="inline-block rounded bg-electric-cyan/10 px-2 py-0.5">
              <p className="text-xs text-electric-cyan">{dictData.partOfSpeech}</p>
            </div>
          )}

          {dictData?.phonetic && (
            <div>
              <p className="text-xs text-muted-gray mb-1">音标：</p>
              <p className="text-cyan-glow text-base">/{dictData.phonetic}/</p>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-gray mb-1">
              {mode === 'word' ? '中文翻译：' : '翻译：'}
            </p>
            <p className="text-soft-white">{cnTranslation || '暂无'}</p>
          </div>

          {mode === 'word' && dictData?.definition && (
            <div>
              <p className="text-xs text-muted-gray mb-1">英文释义：</p>
              <p className="text-muted-gray text-xs">"{dictData.definition}"</p>
            </div>
          )}

          {mode === 'word' && dictData?.collocations?.length > 0 && (
            <div>
              <p className="text-xs text-muted-gray mb-1">近义词：</p>
              <div className="flex flex-wrap gap-1.5">
                {dictData.collocations.map((c, i) => (
                  <span
                    key={i}
                    className="inline-block rounded-md bg-white/5 px-2 py-0.5 text-xs text-muted-gray"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {mode === 'word' && dictData?.examples?.length > 0 && (
            <div>
              <p className="text-xs text-muted-gray mb-1">例句：</p>
              <div className="space-y-1">
                {dictData.examples.map((ex, i) => (
                  <p key={i} className="text-muted-gray italic text-xs">"{ex}"</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
