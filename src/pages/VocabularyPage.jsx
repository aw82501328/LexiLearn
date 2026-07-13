import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { generateParagraph } from '../services/paragraphGenerator';
import VocabCard from '../components/VocabCard';

export default function VocabularyPage() {
  const { state, removeFromVocabulary, clearVocabulary, addFile } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');

  // Generation controls
  const [wordCount, setWordCount] = useState(150);
  const [difficulty, setDifficulty] = useState('medium');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');

  const filtered = filter.trim()
    ? state.vocabulary.filter((w) => w.word.includes(filter.trim().toLowerCase()))
    : state.vocabulary;

  const handleGenerate = async () => {
    if (state.vocabulary.length < 2) {
      setGenError('至少需要 2 个生词才能生成段落');
      return;
    }
    setGenerating(true);
    setGenError('');
    try {
      const words = state.vocabulary.map((w) => w.word);
      const result = await generateParagraph(words, wordCount, difficulty);

      const fileId = 'gen-' + Date.now().toString(36);
      const fileRecord = {
        id: fileId,
        name: `AI 生成段落 · ${words.length} 生词 · ${difficulty === 'easy' ? '简单' : difficulty === 'medium' ? '中等' : '困难'}`,
        size: new Blob([result.paragraph]).size,
        text: result.paragraph,
        createdAt: Date.now(),
        isGenerated: true,
      };
      addFile(fileRecord);
      navigate(`/learn/${fileId}`);
    } catch (e) {
      setGenError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-soft-white">生词本</h1>
        {state.vocabulary.length > 0 && (
          <button
            onClick={clearVocabulary}
            className="rounded-lg border border-red-500/20 px-4 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-all"
          >
            清空全部
          </button>
        )}
      </div>

      {state.vocabulary.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
          <div className="text-5xl mb-4">📝</div>
          <p className="text-muted-gray text-lg mb-2">生词本为空</p>
          <p className="text-muted-gray text-sm">阅读文档时点击单词即可自动添加到这里</p>
        </div>
      ) : (
        <>
          {/* Generation panel */}
          {state.vocabulary.length >= 2 && (
            <div className="mb-8 rounded-xl border border-electric-cyan/20 bg-dark-slate/50 p-5 animate-fade-in">
              <h3 className="text-sm font-semibold text-soft-white mb-4 flex items-center gap-2">
                <span>✨</span> AI 段落生成
              </h3>
              <p className="text-xs text-muted-gray mb-4">
                使用生词本中的 {state.vocabulary.length} 个单词，自动生成一篇英文阅读材料。
              </p>

              <div className="flex flex-wrap items-end gap-4 mb-4">
                <div>
                  <label className="block text-xs text-muted-gray mb-1.5">目标字数</label>
                  <select
                    value={wordCount}
                    onChange={(e) => setWordCount(Number(e.target.value))}
                    className="rounded-lg border border-mid-slate bg-dark-slate px-3 py-2 text-sm text-soft-white focus:border-electric-cyan focus:outline-none focus:ring-1 focus:ring-electric-cyan transition-all appearance-none cursor-pointer"
                  >
                    <option value={100}>100 词</option>
                    <option value={150}>150 词</option>
                    <option value={200}>200 词</option>
                    <option value={300}>300 词</option>
                    <option value={500}>500 词</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-muted-gray mb-1.5">难度</label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="rounded-lg border border-mid-slate bg-dark-slate px-3 py-2 text-sm text-soft-white focus:border-electric-cyan focus:outline-none focus:ring-1 focus:ring-electric-cyan transition-all appearance-none cursor-pointer"
                  >
                    <option value="easy">简单 (A1-A2)</option>
                    <option value="medium">中等 (B1-B2)</option>
                    <option value="hard">困难 (C1-C2)</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="rounded-lg bg-electric-cyan px-5 py-2 text-sm font-semibold text-dark-slate hover:bg-cyan-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-dark-slate border-t-transparent" />
                      生成中...
                    </span>
                  ) : (
                    '生成段落'
                  )}
                </button>
              </div>

              {genError && (
                <p className="text-xs text-red-400 animate-fade-in">{genError}</p>
              )}
            </div>
          )}

          {/* Search */}
          <div className="mb-6">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索生词..."
              className="w-full max-w-sm rounded-lg border border-mid-slate bg-dark-slate px-4 py-2.5 text-sm text-soft-white placeholder:text-muted-gray focus:border-electric-cyan focus:outline-none focus:ring-1 focus:ring-electric-cyan transition-all"
            />
          </div>

          <p className="text-xs text-muted-gray mb-4">
            共 {state.vocabulary.length} 个单词
            {filter.trim() && ` · 匹配 ${filtered.length} 个`}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filtered.map((item) => (
              <VocabCard
                key={item.word}
                item={item}
                onRemove={removeFromVocabulary}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
