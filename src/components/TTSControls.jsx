import { useState, useEffect, useRef, useCallback } from 'react';
import { speakBySentences, stopTTS } from '../services/tts';
import { useApp } from '../context/AppContext';
import { logActivity } from '../services/adminApi';

export default function TTSControls({
  text,
  isSpeaking,
  setIsSpeaking,
  onSentence,
  onFinish,
  speed,
  onSpeedChange,
  voice,
  onVoiceChange,
  shouldAutoSpeak,
  sentencePause,
  onSentencePauseChange,
}) {
  const { recordTTS } = useApp();
  const stoppedRef = useRef(false);
  const onSentenceRef = useRef(onSentence);
  const onFinishRef = useRef(onFinish);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const [voices, setVoices] = useState([]);
  const voiceInitedRef = useRef(false);

  const TARGET_NAMES = [
    { name: 'Microsoft Ava Multilingual Online (Natural) - English (United States)',    label: 'Ava（女声）' },
    { name: 'Microsoft Ana Online (Natural) - English (United States)',                label: 'Ana（童声）' },
    { name: 'Microsoft Andrew Multilingual Online (Natural) - English (United States)', label: 'Andrew（男声）' },
  ];

  useEffect(() => {
    const updateVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      const available = TARGET_NAMES
        .filter((t) => allVoices.some((v) => v.name === t.name))
        .map((t) => ({ name: t.name, label: t.label }));
      setVoices(available);

      if (available.length > 0) {
        const currentExists = available.some((v) => v.name === voiceRef.current);
        if (!currentExists) {
          const ana = available.find((v) => v.name === TARGET_NAMES[1].name);
          const sel = ana || available[0];
          onVoiceChange?.(sel.name);
          voiceRef.current = sel.name;
        }
      }
    };

    updateVoices();
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
  }, [onVoiceChange]);

  useEffect(() => { onSentenceRef.current = onSentence; });
  useEffect(() => { onFinishRef.current = onFinish; });

  const sentencePauseRef = useRef(sentencePause);
  sentencePauseRef.current = sentencePause;

  const doSpeak = useCallback(async () => {
    stoppedRef.current = false;
    stopTTS();
    setIsSpeaking(true);
    logActivity('tts', { text: text.slice(0, 100) }).catch(() => {});
    try {
      await speakBySentences(text, () => speedRef.current, (idx) => onSentenceRef.current?.(idx), () => voiceRef.current, () => sentencePauseRef.current);
      if (!stoppedRef.current) {
        recordTTS();
        onFinishRef.current?.();
      }
    } catch {
      // swallow
    } finally {
      setIsSpeaking(false);
    }
  }, [text, setIsSpeaking, recordTTS]);

  const handleSpeakRef = useRef(doSpeak);
  useEffect(() => { handleSpeakRef.current = doSpeak; });

  const handleStop = useCallback(() => {
    stoppedRef.current = true;
    stopTTS();
    setIsSpeaking(false);
  }, [setIsSpeaking]);

  useEffect(() => {
    if (shouldAutoSpeak) {
      const t = setTimeout(() => handleSpeakRef.current(), 100);
      return () => clearTimeout(t);
    }
  }, [shouldAutoSpeak]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={isSpeaking ? handleStop : () => handleSpeakRef.current()}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 ${
          isSpeaking
            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
            : 'bg-electric-cyan/10 text-electric-cyan border border-electric-cyan/20 hover:bg-electric-cyan/20 hover:shadow-[0_0_20px_rgba(45,212,191,0.2)]'
        }`}
      >
        <span className={isSpeaking ? 'animate-pulse' : ''}>
          {isSpeaking ? '⏹' : '▶'}
        </span>
        {isSpeaking ? '停止' : '开始朗读'}
      </button>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-gray">语速</span>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          className="speed-slider w-24"
        />
        <span className="text-xs text-electric-cyan font-mono w-8">{speed}x</span>
      </div>

      {voices.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-gray">声音</span>
          <select
            value={voice || ''}
            onChange={(e) => { onVoiceChange?.(e.target.value); voiceRef.current = e.target.value; }}
            className="text-xs bg-mid-slate border border-mid-slate rounded-md px-2 py-1 text-soft-white focus:outline-none focus:border-electric-cyan/30 max-w-[160px] truncate"
          >
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-gray">句间间隔</span>
        <select
          value={sentencePause}
          onChange={(e) => onSentencePauseChange?.(Number(e.target.value))}
          className="text-xs bg-mid-slate border border-mid-slate rounded-md px-2 py-1 text-soft-white focus:outline-none focus:border-electric-cyan/30"
        >
          <option value={0}>无</option>
          <option value={200}>0.2秒</option>
          <option value={500}>0.5秒</option>
          <option value={800}>0.8秒</option>
          <option value={1200}>1.2秒</option>
          <option value={2000}>2秒</option>
          <option value={10000}>10秒</option>
          <option value={20000}>20秒</option>
        </select>
      </div>
    </div>
  );
}
