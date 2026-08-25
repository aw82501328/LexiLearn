import { useState, useEffect, useRef, useCallback } from 'react';
import { speakBySentences, stopTTS, pauseTTS, resumeTTS } from '../services/tts';
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
  onAutoSpeakConsumed,
  onStop,
  sentencePause,
  onSentencePauseChange,
  autoFlip,
  onAutoFlipChange,
  isPaused: isPausedProp,
  onPausedChange,
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
  const [isPausedInternal, setIsPausedInternal] = useState(false); // 是否处于暂停状态（内部兜底）
  // 受控优先：父组件传入 isPausedProp 时以它为准（用于点击单词/句子时切换为暂停）
  const isPaused = isPausedProp !== undefined ? isPausedProp : isPausedInternal;
  const setPaused = useCallback((v) => {
    if (onPausedChange) onPausedChange(v);
    else setIsPausedInternal(v);
  }, [onPausedChange]);

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
    setPaused(false);
    setIsSpeaking(true);
    logActivity('tts', { text: text.slice(0, 100) }).catch(() => {});
    try {
      // finished 为 false 表示朗读被中断（用户停止/翻页等），不应触发 onFinish（避免误 autoFlip）
      const finished = await speakBySentences(text, () => speedRef.current, (idx) => onSentenceRef.current?.(idx), () => voiceRef.current, () => sentencePauseRef.current);
      if (finished && !stoppedRef.current) {
        recordTTS();
        // 朗读未停止即自然读完本页：交由父组件 handleTTSFinish 按「自动翻页」勾选决定是否翻页
        onFinishRef.current?.();
      }
    } catch {
      // swallow
    } finally {
      setPaused(false);
      setIsSpeaking(false);
    }
  }, [text, setIsSpeaking, recordTTS, setPaused]);

  const handleSpeakRef = useRef(doSpeak);
  useEffect(() => { handleSpeakRef.current = doSpeak; });

  const handleStop = useCallback(() => {
    stoppedRef.current = true;
    stopTTS();
    setPaused(false);
    setIsSpeaking(false);
    onStop?.(); // 通知父组件：用户显式停止，需清除翻页队列
  }, [setIsSpeaking, onStop, setPaused]);

  // 暂停 / 恢复
  const handlePauseToggle = useCallback(() => {
    if (isPaused) {
      resumeTTS();
      setPaused(false);
    } else {
      pauseTTS();
      setPaused(true);
    }
  }, [isPaused, setPaused]);

  useEffect(() => {
    if (shouldAutoSpeak) {
      const t = setTimeout(() => {
        // 手动翻页触发的朗读：读完本页后同样交给 onFinish 判断自动翻页
        handleSpeakRef.current();
        onAutoSpeakConsumed?.(); // 通知父组件：本次自动朗读已消费
      }, 100);
      return () => clearTimeout(t);
    }
  }, [shouldAutoSpeak, onAutoSpeakConsumed]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={isSpeaking ? handlePauseToggle : () => handleSpeakRef.current()}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 ${
          isSpeaking
            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            : 'bg-electric-cyan/10 text-electric-cyan border border-electric-cyan/20 hover:bg-electric-cyan/20 hover:shadow-[0_0_20px_rgba(45,212,191,0.2)]'
        }`}
      >
        <span className={isSpeaking && !isPaused ? 'animate-pulse' : ''}>
          {isSpeaking ? (isPaused ? '▶' : '⏸') : '▶'}
        </span>
        {isSpeaking ? (isPaused ? '继续' : '暂停') : '开始朗读'}
      </button>

      {onAutoFlipChange && (
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!autoFlip}
            onChange={(e) => onAutoFlipChange(e.target.checked)}
            className="accent-electric-cyan h-3.5 w-3.5"
          />
          <span className="text-xs text-muted-gray">自动翻页</span>
        </label>
      )}

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
