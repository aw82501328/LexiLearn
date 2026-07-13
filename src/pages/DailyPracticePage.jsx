import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { speakText } from '../services/tts';
import {
  examCategories,
  wordLists,
  getDailyWords,
} from '../data/wordLists';

// ── helpers ──

/** Generate 4 shuffled options for a quiz question */
function makeQuizOptions(correct, pool) {
  const others = pool
    .filter((w) => w.word !== correct.word)
    .map((w) => w.word);
  // shuffle and pick 3
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const options = [correct.word, ...others.slice(0, 3)];
  // shuffle the 4 so correct isn't always first
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

// ── sub-components ──

function LearnCard({ word, onSpeak, isSpeaking }) {
  return (
    <div className="relative rounded-2xl border border-electric-cyan/20 bg-dark-slate/50 p-8 text-center shadow-[0_0_30px_rgba(45,212,191,0.08)]">
      <p className="text-3xl sm:text-4xl font-bold text-soft-white tracking-wide mb-4">
        {word.word}
      </p>
      {word.phonetic && (
        <p className="text-cyan-glow text-lg mb-3">/{word.phonetic}/</p>
      )}
      <p className="text-electric-cyan text-xl font-medium">
        {word.translation || '暂无翻译'}
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); onSpeak(); }}
        disabled={isSpeaking}
        className="absolute top-4 right-4 h-9 w-9 rounded-lg bg-white/5 hover:bg-electric-cyan/10 transition-all flex items-center justify-center"
      >
        <span className="text-xs">{isSpeaking ? '🔊' : '🔈'}</span>
      </button>
    </div>
  );
}

function QuizCard({ word, options, selected, onSelect, isSpeaking, onSpeak }) {
  const getStyle = (opt) => {
    if (!selected) return 'border-white/10 bg-dark-slate/40 hover:border-white/30 hover:bg-dark-slate/60';
    if (opt === word.word) return 'border-green-400/40 bg-green-400/10 text-green-400';
    if (opt === selected) return 'border-red-400/40 bg-red-400/10 text-red-400';
    return 'border-white/5 bg-dark-slate/30 opacity-40';
  };

  return (
    <div className="text-center">
      {/* Question: Chinese meaning */}
      <p className="text-electric-cyan text-xl sm:text-2xl font-semibold mb-8">
        {word.translation || word.word}
      </p>

      {/* Audio hint */}
      <button
        onClick={(e) => { e.stopPropagation(); onSpeak(); }}
        disabled={isSpeaking}
        className="inline-flex items-center gap-1.5 text-xs text-muted-gray hover:text-electric-cyan mb-6 transition-colors"
      >
        <span>{isSpeaking ? '🔊' : '🔈'}</span>
        听发音
      </button>

      {/* Options grid */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => !selected && onSelect(opt)}
            disabled={!!selected}
            className={`rounded-xl border px-4 py-4 text-base font-medium transition-all duration-200 ${getStyle(opt)}`}
          >
            {opt}
          </button>
        ))}
      </div>

      {selected && selected !== word.word && (
        <p className="text-red-400 text-xs mt-4 animate-fade-in">正确答案：{word.word}</p>
      )}
      {selected === word.word && (
        <p className="text-green-400 text-xs mt-4 animate-fade-in">正确！</p>
      )}
    </div>
  );
}

// ── main page ──

export default function DailyPracticePage() {
  const { state, recordTTS } = useApp();

  // select / learn / quiz / result
  const [phase, setPhase] = useState('select');
  const [category, setCategory] = useState(null);
  const [words, setWords] = useState([]);
  const [dailyCount, setDailyCount] = useState(10);

  // learn phase
  const [learnIndex, setLearnIndex] = useState(0);

  // quiz phase
  const [quizIndex, setQuizIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [quizResults, setQuizResults] = useState([]);
  const [autoAdvance, setAutoAdvance] = useState(null);

  const [isSpeaking, setIsSpeaking] = useState(false);

  // Generate quiz options once per session
  const quizOptionsList = useMemo(() => {
    if (words.length === 0) return [];
    return words.map((w) => makeQuizOptions(w, words));
  }, [words]);

  // ── handlers ──

  const handleSelectCategory = (cat) => {
    const currentVocab =
      cat.key === 'vocabulary'
        ? state.vocabulary.map((v) => ({ word: v.word, translation: v.word, phonetic: '' }))
        : wordLists[cat.key] || [];
    if (currentVocab.length === 0) {
      if (cat.key === 'vocabulary') alert('生词本为空，请先在阅读中点击单词添加生词。');
      return;
    }
    setCategory(cat.key);
    setWords(getDailyWords(currentVocab, Math.min(dailyCount, currentVocab.length)));
    setLearnIndex(0);
    setQuizIndex(0);
    setSelected(null);
    setQuizResults([]);
    setPhase('learn');
  };

  const handleSpeak = async (word) => {
    setIsSpeaking(true);
    try {
      await speakText(null, word);
      recordTTS();
    } catch { /* ignore */ }
    finally { setIsSpeaking(false); }
  };

  const startQuiz = () => {
    setQuizIndex(0);
    setSelected(null);
    setQuizResults([]);
    setPhase('quiz');
  };

  const handleQuizSelect = (opt) => {
    setSelected(opt);
    const correct = opt === words[quizIndex].word;
    const result = { word: words[quizIndex].word, translation: words[quizIndex].translation, correct };
    setQuizResults((prev) => [...prev, result]);

    // auto-advance after 1.2s
    const timer = setTimeout(() => {
      if (quizIndex + 1 >= words.length) {
        setPhase('result');
      } else {
        setSelected(null);
        setQuizIndex((i) => i + 1);
      }
    }, 1200);
    setAutoAdvance(timer);
  };

  const restart = () => {
    if (autoAdvance) clearTimeout(autoAdvance);
    setPhase('select');
    setCategory(null);
    setWords([]);
    setLearnIndex(0);
    setQuizIndex(0);
    setSelected(null);
    setQuizResults([]);
  };

  const backToSelect = () => {
    if (autoAdvance) clearTimeout(autoAdvance);
    setPhase('select');
    setCategory(null);
    setWords([]);
  };

  // ── render: select ──
  if (phase === 'select') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-soft-white mb-2">天天背单词</h1>
        <p className="text-sm text-muted-gray mb-8">先学习，再测试 —— 选择词库开始</p>

        <div className="mb-6 flex items-center gap-3">
          <span className="text-xs text-muted-gray">每日数量</span>
          {[5, 10, 15, 20].map((n) => (
            <button
              key={n}
              onClick={() => setDailyCount(n)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                dailyCount === n
                  ? 'bg-electric-cyan/20 text-electric-cyan border border-electric-cyan/30'
                  : 'bg-white/5 text-muted-gray border border-transparent hover:text-soft-white'
              }`}
            >
              {n} 词
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {examCategories.map((cat) => {
            const count = cat.key === 'vocabulary'
              ? state.vocabulary.length
              : wordLists[cat.key]?.length || 0;
            return (
              <button
                key={cat.key}
                onClick={() => handleSelectCategory(cat)}
                disabled={count === 0}
                className="flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-dark-slate/40 p-6 hover:border-electric-cyan/20 hover:bg-dark-slate/60 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span className="text-3xl">{cat.icon}</span>
                <p className="text-soft-white font-semibold text-sm">{cat.label}</p>
                <p className="text-muted-gray text-xs">{count} 词</p>
              </button>
            );
          })}
        </div>

        {/* Steps preview */}
        <div className="mt-10 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/5 bg-dark-slate/30 p-4 flex items-start gap-3">
            <div className="flex-shrink-0 h-7 w-7 rounded-full bg-electric-cyan/20 text-electric-cyan text-xs font-bold flex items-center justify-center">1</div>
            <div>
              <p className="text-sm font-semibold text-soft-white">学习阶段</p>
              <p className="text-xs text-muted-gray mt-0.5">浏览单词卡片，熟悉词义和发音</p>
            </div>
          </div>
          <div className="rounded-xl border border-white/5 bg-dark-slate/30 p-4 flex items-start gap-3">
            <div className="flex-shrink-0 h-7 w-7 rounded-full bg-electric-cyan/20 text-electric-cyan text-xs font-bold flex items-center justify-center">2</div>
            <div>
              <p className="text-sm font-semibold text-soft-white">测试阶段</p>
              <p className="text-xs text-muted-gray mt-0.5">看中文选英文，4 选 1 即时反馈</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── render: learn ──
  if (phase === 'learn') {
    const w = words[learnIndex];
    const catLabel = examCategories.find((c) => c.key === category)?.label || '';
    const learnedAll = learnIndex + 1 >= words.length;

    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={backToSelect} className="text-xs text-muted-gray hover:text-soft-white">
            ← 返回
          </button>
          <span className="text-xs font-semibold text-electric-cyan bg-electric-cyan/10 px-3 py-1 rounded-full">
            学习阶段
          </span>
          <span className="text-xs text-muted-gray">
            {learnIndex + 1} / {words.length}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full rounded-full bg-mid-slate mb-8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-electric-cyan to-cyan-glow transition-all duration-300"
            style={{ width: `${((learnIndex + 1) / words.length) * 100}%` }}
          />
        </div>

        <p className="text-xs text-muted-gray mb-3">{catLabel}</p>

        <LearnCard word={w} onSpeak={() => handleSpeak(w.word)} isSpeaking={isSpeaking} />

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setLearnIndex((i) => Math.max(0, i - 1))}
            disabled={learnIndex === 0}
            className="rounded-lg border border-mid-slate px-4 py-2 text-xs text-muted-gray hover:border-muted-gray disabled:opacity-30 transition-all"
          >
            ← 上一个
          </button>

          {learnedAll ? (
            <button
              onClick={startQuiz}
              className="rounded-lg bg-electric-cyan px-6 py-2.5 text-sm font-semibold text-dark-slate hover:bg-cyan-glow shadow-[0_0_20px_rgba(45,212,191,0.25)] transition-all"
            >
              开始测试 →
            </button>
          ) : (
            <button
              onClick={() => setLearnIndex((i) => Math.min(words.length - 1, i + 1))}
              className="rounded-lg border border-electric-cyan/30 bg-electric-cyan/10 px-5 py-2.5 text-sm font-medium text-electric-cyan hover:bg-electric-cyan/20 transition-all"
            >
              下一个 →
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── render: quiz ──
  if (phase === 'quiz') {
    const w = words[quizIndex];
    const options = quizOptionsList[quizIndex] || [];
    const quizProgress = ((quizIndex) / words.length) * 100;

    return (
      <div className="mx-auto max-w-xl px-6 py-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={restart} className="text-xs text-muted-gray hover:text-soft-white">
            ← 退出
          </button>
          <span className="text-xs font-semibold text-cyan-glow bg-cyan-glow/10 px-3 py-1 rounded-full">
            测试阶段
          </span>
          <span className="text-xs text-muted-gray">
            {quizIndex + 1} / {words.length}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full rounded-full bg-mid-slate mb-8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-electric-cyan transition-all duration-300"
            style={{ width: `${quizProgress}%` }}
          />
        </div>

        <QuizCard
          word={w}
          options={options}
          selected={selected}
          onSelect={handleQuizSelect}
          isSpeaking={isSpeaking}
          onSpeak={() => handleSpeak(w.word)}
        />
      </div>
    );
  }

  // ── render: result ──
  const correctCount = quizResults.filter((r) => r.correct).length;
  const wrongResults = quizResults.filter((r) => !r.correct);
  const accuracy = words.length > 0 ? Math.round((correctCount / words.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-xl px-6 py-8 animate-fade-in">
      <div className="text-center mb-8">
        <div className="text-5xl mb-4">{accuracy >= 80 ? '🎉' : accuracy >= 60 ? '👍' : '💪'}</div>
        <h1 className="text-2xl font-bold text-soft-white mb-1">测试完成</h1>
        <p className="text-muted-gray text-sm">
          {examCategories.find((c) => c.key === category)?.label} · {words.length} 词
        </p>
      </div>

      {/* Score card */}
      <div className="rounded-2xl border border-electric-cyan/20 bg-dark-slate/50 p-6 mb-6 text-center">
        <p className="text-5xl font-bold text-electric-cyan mb-2">{correctCount}<span className="text-2xl text-muted-gray">/{words.length}</span></p>
        <p className="text-sm text-soft-white font-medium">正确率 {accuracy}%</p>
        <div className="h-2 w-full rounded-full bg-mid-slate mt-4">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              accuracy >= 80 ? 'bg-green-400' : accuracy >= 60 ? 'bg-yellow-400' : 'bg-red-400'
            }`}
            style={{ width: `${accuracy}%` }}
          />
        </div>
      </div>

      {/* Wrong words */}
      {wrongResults.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-dark-slate/30 p-5 mb-6">
          <h3 className="text-sm font-semibold text-soft-white mb-3">
            需要复习 ({wrongResults.length} 词)
          </h3>
          <div className="space-y-2">
            {wrongResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2.5">
                <div>
                  <p className="text-sm text-soft-white font-medium">{r.word}</p>
                  <p className="text-xs text-muted-gray">{r.translation}</p>
                </div>
                <button
                  onClick={() => handleSpeak(r.word)}
                  className="text-muted-gray hover:text-electric-cyan transition-colors text-sm"
                >
                  🔊
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All correct */}
      {wrongResults.length === 0 && (
        <div className="rounded-xl border border-green-400/20 bg-green-400/5 p-5 mb-6 text-center">
          <p className="text-green-400 text-sm font-medium">全部正确，太棒了！🎯</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={backToSelect}
          className="flex-1 rounded-lg border border-mid-slate px-4 py-2.5 text-sm text-muted-gray hover:text-soft-white hover:border-muted-gray transition-all"
        >
          返回选词
        </button>
        <button
          onClick={startQuiz}
          className="flex-1 rounded-lg bg-electric-cyan px-4 py-2.5 text-sm font-semibold text-dark-slate hover:bg-cyan-glow transition-all"
        >
          再测一次
        </button>
      </div>
    </div>
  );
}
