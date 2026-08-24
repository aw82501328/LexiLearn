import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { translateToChinese } from '../services/translator';
import { speakText } from '../services/tts';
import { useApp } from '../context/AppContext';

export default function WordDetailPage() {
  const { word: encodedWord } = useParams();
  const word = decodeURIComponent(encodedWord || '');

  const { state, removeFromVocabulary, recordTTS } = useApp();
  const [cnTranslation, setCnTranslation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  const vocabItem = state.vocabulary.find((w) => w.word === word.toLowerCase());

  useEffect(() => {
    if (!word) return;
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError('');

      try {
        const zh = await translateToChinese(word);
        if (cancelled) return;
        setCnTranslation(zh);
      } catch {
        if (!cancelled) setError('查询失败');
      }
      setLoading(false);
    }

    fetchData();
    return () => { cancelled = true; };
  }, [word]);

  const handleSpeak = async () => {
    setIsSpeaking(true);
    try {
      await speakText(null, word);
      recordTTS();
    } catch {
      // ignore
    } finally {
      setIsSpeaking(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-gray mb-8">
        <Link to="/vocabulary" className="hover:text-soft-white transition-colors">
          生词本
        </Link>
        <span>/</span>
        <span className="text-soft-white">{word}</span>
      </div>

      {loading ? (
        <div className="space-y-4 py-12">
          <div className="h-8 w-48 shimmer rounded" />
          <div className="h-4 w-3/4 shimmer rounded" />
          <div className="h-4 w-1/2 shimmer rounded" />
          <div className="h-4 w-2/3 shimmer rounded" />
        </div>
      ) : error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : (
        <>
          {/* Word header */}
          <div className="flex items-center gap-4 mb-6">
            <h1 className="text-3xl font-bold text-soft-white">{word}</h1>
            <button
              onClick={handleSpeak}
              disabled={isSpeaking}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                isSpeaking
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-electric-cyan/10 text-electric-cyan border border-electric-cyan/20 hover:bg-electric-cyan/20'
              }`}
            >
              <span className={isSpeaking ? 'animate-pulse' : ''}>
                {isSpeaking ? '🔊' : '🔈'}
              </span>
              {isSpeaking ? '播放中' : '朗读'}
            </button>
          </div>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {vocabItem && vocabItem.count > 0 && (
              <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-muted-gray">
                查询 {vocabItem.count} 次
              </span>
            )}
          </div>

          {/* Content sections */}
          <div className="space-y-6">
            {/* Chinese translation */}
            <Section title="中文翻译">
              <p className="text-soft-white text-base">{cnTranslation || '暂无'}</p>
            </Section>

            {/* Remove from vocabulary */}
            {vocabItem && (
              <div className="pt-2">
                <button
                  onClick={() => removeFromVocabulary(word)}
                  className="rounded-lg border border-red-500/20 px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-all"
                >
                  从生词本中移除
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-white/5 bg-dark-slate/30 p-4">
      <h3 className="text-xs font-semibold text-muted-gray uppercase tracking-wider mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}
