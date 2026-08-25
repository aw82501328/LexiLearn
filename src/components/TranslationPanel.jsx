import { useState, useEffect } from 'react';
import { translateToChinese } from '../services/translator';
import { speakText, speakTextFrom } from '../services/tts';
import { useApp } from '../context/AppContext';
import { logActivity } from '../services/adminApi';

export default function TranslationPanel({ word, mode, fullText, wordGlobalIndex, auto }) {
  const { recordTTS } = useApp();
  const [cnTranslation, setCnTranslation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isReadingFrom, setIsReadingFrom] = useState(false);

  useEffect(() => {
    if (!word) {
      setCnTranslation(null);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError('');
      setCnTranslation(null);

      if (mode === 'word') {
        try {
          const zh = await translateToChinese(word);
          if (cancelled) return;
          setCnTranslation(zh);
          setLoading(false);
          logActivity('translateWord', { word }).catch(() => {}); // 今日翻译单词数
          logActivity('dict', { word }).catch(() => {}); // 查词统计
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
            logActivity('translateSentence', { text: word.slice(0, 100) }).catch(() => {}); // 今日翻译句子数
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
      ) : error && !cnTranslation ? (
        <p className="text-red-400 text-sm py-2">{error}</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-gray mb-1">原文：</p>
            <p className="text-soft-white font-medium text-base">{word}</p>
          </div>

          <div>
            <p className="text-xs text-muted-gray mb-1">翻译：</p>
            <p className="text-soft-white">{cnTranslation || '暂无'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
