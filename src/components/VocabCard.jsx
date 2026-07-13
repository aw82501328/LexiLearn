import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { speakText } from '../services/tts';
import { translateToChinese } from '../services/translator';
import { useApp } from '../context/AppContext';

export default function VocabCard({ item, onRemove }) {
  const navigate = useNavigate();
  const [translation, setTranslation] = useState('');
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    translateToChinese(item.word)
      .then((zh) => { if (!cancelled) setTranslation(zh); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.word]);

  const handlePlay = async (e) => {
    e.stopPropagation();
    setPlaying(true);
    try {
      await speakText(null, item.word);
    } catch {
      // ignore
    } finally {
      setPlaying(false);
    }
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    onRemove(item.word);
  };

  return (
    <div
      onClick={() => navigate(`/vocabulary/${encodeURIComponent(item.word)}`)}
      className="group relative flex flex-col items-center justify-between rounded-xl border border-white/5 bg-dark-slate/40 p-4 hover:border-electric-cyan/20 cursor-pointer transition-all duration-200"
    >
      <button
        onClick={handleRemove}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-gray hover:text-red-400 text-xs"
        title="移除"
      >
        ✕
      </button>

      <div className="text-center">
        <p className="text-base font-semibold text-soft-white">
          {item.word}
        </p>
        <p className="text-xs text-electric-cyan mt-0.5 min-h-[1rem]">
          {translation || '...'}
        </p>
      </div>

      {item.count > 1 && (
        <p className="text-[10px] text-muted-gray mt-1 mb-1">
          点击 {item.count} 次
        </p>
      )}
      {item.count <= 1 && <div className="mt-1 mb-1" />}

      <button
        onClick={handlePlay}
        disabled={playing}
        className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
          playing
            ? 'bg-electric-cyan/20 text-electric-cyan'
            : 'bg-white/5 text-muted-gray hover:bg-electric-cyan/10 hover:text-electric-cyan'
        }`}
      >
        <span className={playing ? 'animate-pulse' : ''}>
          {playing ? '🔊' : '🔈'}
        </span>
        朗读
      </button>
    </div>
  );
}
