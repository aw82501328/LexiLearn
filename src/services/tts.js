let currentUtterance = null;
let _ttsActive = false;
let _ttsStopped = false;
let _pauseResolver = null;

export function stopTTS() {
  _ttsStopped = true;
  _ttsActive = false;
  if (_pauseResolver) {
    _pauseResolver();
    _pauseResolver = null;
  }
  if (currentUtterance) {
    window.speechSynthesis.cancel();
    currentUtterance = null;
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

  _ttsActive = false;
}

export async function speakText(_apiKey, text, speed, onWord) {
  if (_ttsActive) return;
  _ttsActive = true;
  _ttsStopped = false;
  speed = speed || 1.0;

  if (!text.trim()) {
    _ttsActive = false;
    return;
  }

  try {
    await speakSingleUtterance(null, text, speed);
  } finally {
    _ttsActive = false;
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
