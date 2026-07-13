import { useState, useEffect } from 'react';
import { lookupWord } from '../services/dictionary';
import { translateToChinese, translateBatch } from '../services/translator';
import { speakText, speakTextFrom } from '../services/tts';
import { useApp } from '../context/AppContext';
import { logActivity } from '../services/adminApi';

export default function TranslationPanel({ word, mode, fullText, wordGlobalIndex, auto }) {
  const { recordTTS } = useApp();
  const [cnTranslation, setCnTranslation] = useState(null);
  const [dictData, setDictData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isReadingFrom, setIsReadingFrom] = useState(false);

  useEffect(() => {
    if (!word) {
      setCnTranslation(null);
      setDictData(null);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError('');
      setDictData(null);
      setCnTranslation(null);

      if (mode === 'word') {
        try {
          const dict = await lookupWord(word);
          if (cancelled) return;

          // 批量翻译所有英文释义
          const englishDefs = dict.entries.map((e) => e.english);
          const zhMap = await translateBatch(englishDefs);

          setDictData({
            phonetic: dict.phonetic,
            entries: dict.entries.map((e) => ({
              ...e,
              chinese: zhMap[e.english] || '',
            })),
          });

          // 同时查单词本身的中文翻译作补充
          try {
            const zh = await translateToChinese(word);
            if (!cancelled) setCnTranslation(zh);
          } catch { /* ignore */ }

          setLoading(false);
          logActivity('dict', { word }).catch(() => {});
        } catch (e) {
          if (!cancelled) {
            setError(e.message);
            setLoading(false);
          }
        }
      } else {
        try {
          const result = await translateToChinese(word);
          if (!cancelled) {
            setCnTranslation(result);
            setLoading(false);
            logActivity('translate', { text: word.slice(0, 100) }).catch(() => {});
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

  if (!word) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
        <div className="text-3xl mb-3 opacity-30">📖</div>
        <p className="text-muted-gray text-sm">点击单词查词典</p>
        <p className="text-muted-gray/50 text-xs mt-1">选中句子即时翻译</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-electric-cyan font-semibold">
          {mode === 'word' ? '单词查询' : '整句翻译'}
          {auto && (
            <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-green-500/15 text-green-400 border border-green-500/20 align-middle">
              自动
            </span>
          )}
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
            title="朗读"
          >
            <span className={isSpeaking ? 'animate-pulse' : ''}>
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
              title="从此处开始朗读"
            >
              <span className={isReadingFrom ? 'animate-pulse' : ''}>
                {isReadingFrom ? '⏸' : '📖'}
              </span>
              从此朗读
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 py-4">
          <div className="h-4 w-3/4 shimmer rounded" />
          <div className="h-4 w-1/2 shimmer rounded" />
          <div className="h-4 w-2/3 shimmer rounded" />
        </div>
      ) : error && !dictData && !cnTranslation ? (
        <p className="text-red-400 text-sm py-2">{error}</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-gray mb-1">原文：</p>
            <p className="text-soft-white font-medium text-base">{word}</p>
          </div>

          {dictData?.phonetic && (
            <div>
              <p className="text-xs text-muted-gray mb-1">音标：</p>
              <p className="text-cyan-glow text-base">/{dictData.phonetic}/</p>
            </div>
          )}

          {mode === 'sentence' && (
            <div>
              <p className="text-xs text-muted-gray mb-1">翻译：</p>
              <p className="text-soft-white">{cnTranslation || '暂无'}</p>
            </div>
          )}

          {mode === 'word' && dictData?.entries?.length > 0 && (
            <div>
              <p className="text-xs text-muted-gray mb-2">释义：</p>
              <div className="space-y-2">
                {dictData.entries.slice(0, 15).map((entry, i) => (
                  <div key={i} className="rounded-lg bg-white/3 px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      {entry.pos && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-electric-cyan/10 text-electric-cyan font-medium">
                          {entry.pos}
                        </span>
                      )}
                      <p className="text-soft-white text-xs">{entry.chinese || entry.english}</p>
                    </div>
                    {entry.example && (
                      <p className="text-muted-gray text-sm mt-1 italic pl-1 border-l-2 border-white/10">
                        {entry.example}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
