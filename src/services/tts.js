let currentUtterance = null;
let _ttsActive = false;
let _ttsStopped = false;
let _ttsPaused = false;
let _pauseResolver = null;

export function stopTTS() {
  _ttsStopped = true;
  _ttsActive = false;
  _ttsPaused = false;
  if (_pauseResolver) {
    _pauseResolver();
    _pauseResolver = null;
  }
  // 无论是否跟踪到 utterance，都清空整个语音队列，确保单词/句子发音也能被停止
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
}

/** 暂停朗读（保留位置，可恢复） */
export function pauseTTS() {
  _ttsPaused = true;
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.pause();
  }
}

/** 恢复朗读 */
export function resumeTTS() {
  _ttsPaused = false;
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.resume();
  }
}

export async function speakTextFrom(fullText, startWordIndex, speed, onWord) {
  const words = fullText.split(/\s+/);
  const textFromHere = words.slice(startWordIndex).join(' ');
  return speakSingleUtterance(null, textFromHere, speed);
}

/**
 * 逐句朗读文本，每句开始前调用 onSentence(index)
 * 调用方应通过 DOM 直操实现高亮，不依赖 React 渲染周期
 *
 * @param {string|string[]} textOrSentences - 完整文本字符串或预拆分句子数组
 * @param {number|function():number} speed - 语速或返回语速的函数（支持朗读中动态调整）
 */
export async function speakBySentences(textOrSentences, speed, onSentence, voice, pauseMs = 0) {
  if (_ttsActive) return;
  _ttsActive = true;
  _ttsStopped = false;

  const getSpeed = typeof speed === 'function' ? speed : () => speed;
  const getVoice = typeof voice === 'function' ? voice : () => voice;
  const getPause = typeof pauseMs === 'function' ? pauseMs : () => pauseMs;

  const sentences = Array.isArray(textOrSentences)
    ? textOrSentences
    : textOrSentences.split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

  if (sentences.length === 0) {
    _ttsActive = false;
    return;
  }

  for (let i = 0; i < sentences.length; i++) {
    if (_ttsStopped) break;
    onSentence?.(i);
    // 若处于暂停状态，等待恢复（重新 resume 播放）
    while (_ttsPaused && !_ttsStopped) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (_ttsStopped) break;
    try {
      await speakSingleUtterance(null, sentences[i], getSpeed(), getVoice());
    } catch {
      break;
    }
    const p = getPause();
    if (p > 0 && i < sentences.length - 1) {
      try {
        await new Promise((r, reject) => {
          _pauseResolver = r;
          const t = setTimeout(() => { _pauseResolver = null; r(); }, p);
        });
      } catch {
        break;
      }
    }
  }

  // 循环结束后：若被打断为暂停（点击单词/句子），等待恢复后再收尾
  while (_ttsPaused && !_ttsStopped) {
    await new Promise((r) => setTimeout(r, 100));
  }

  _ttsActive = false;
  // 返回是否自然完成：被 stopTTS 中断时返回 false，调用方据此决定是否触发 onFinish
  return !_ttsStopped;
}

export async function speakText(_apiKey, text, speed, voiceName) {
  speed = speed || 1.0;

  if (!text.trim()) return;

  // 单独发音（单词/句子）：若主朗读正在进行中，将其切换为暂停（而非继续往后读）。
  // 仅置位 _ttsPaused 标志，让 speakBySentences 主循环在下一句边界等待；不调用
  // speechSynthesis.pause()，以免影响紧随其后的单词/句子单独发音。
  if (_ttsActive && !_ttsStopped) {
    _ttsPaused = true;
  }

  // 打断当前正在播放的语音（主朗读的当前句会被 cancel，主循环随后在下一句边界暂停等待）
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  try {
    await speakSingleUtterance(null, text, speed, voiceName);
  } catch {
    // 忽略
  }
}

function speakSingleUtterance(_apiKey, text, speed, voiceName) {
  speed = speed || 1.0;

  if (!text.trim()) return Promise.resolve();

  const maxLen = 5000;
  const truncated = text.length > maxLen ? text.slice(0, maxLen) : text;

  const doSpeak = (voices) => {
    let enVoice = null;

    if (voiceName) {
      // 精确名称匹配
      enVoice = voices.find((v) => v.name === voiceName);
      // 若精确匹配失败，用关键词回退
      if (!enVoice) {
        if (/ava/i.test(voiceName)) {
          enVoice = voices.find((v) => v.lang.startsWith('en') && /ava/i.test(v.name));
        } else if (/andr/i.test(voiceName)) {
          enVoice = voices.find((v) => v.lang.startsWith('en') && /andr/i.test(v.name));
        } else if (/ana/i.test(voiceName)) {
          enVoice = voices.find((v) => v.lang.startsWith('en') && /ana/i.test(v.name));
        }
      }
    }

    // 回退：优先 Ana，再任意英文
    if (!enVoice) {
      enVoice = voices.find((v) => v.lang.startsWith('en') && /ana/i.test(v.name))
        || voices.find((v) => v.lang.startsWith('en'));
    }

    return enVoice;
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      currentUtterance = null;
      fn();
    };

    const utterance = new SpeechSynthesisUtterance(truncated);
    utterance.lang = 'en-US';
    utterance.rate = speed;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voices = window.speechSynthesis.getVoices();

    if (voices.length === 0) {
      const handler = () => {
        const freshVoices = window.speechSynthesis.getVoices();
        if (freshVoices.length > 0) {
          const v = doSpeak(freshVoices);
          if (v) utterance.voice = v;
          window.speechSynthesis.removeEventListener('voiceschanged', handler);
          window.speechSynthesis.speak(utterance);
        }
      };
      window.speechSynthesis.addEventListener('voiceschanged', handler);
    } else {
      const v = doSpeak(voices);
      if (v) utterance.voice = v;
      currentUtterance = utterance;
      utterance.onend = () => finish(resolve);
      utterance.onerror = (e) => {
        if (e.error === 'canceled' || e.error === 'interrupted') {
          finish(resolve);
        } else {
          finish(() => reject(new Error('语音播放失败：' + e.error)));
        }
      };
      window.speechSynthesis.speak(utterance);
    }
  });
}

/** 获取默认语音名称 */
export function getDefaultVoiceURI() {
  const voices = window.speechSynthesis.getVoices();
  const ana = voices.find((v) => v.lang.startsWith('en') && /ana/i.test(v.name));
  return ana ? ana.name : '';
}

/** 获取可用的英文语音列表 */
export function getEnglishVoices() {
  return window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
}
