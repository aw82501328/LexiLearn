/**
 * Paragraph generator — uses LLM to create an English passage
 * incorporating the user's vocabulary words.
 */

function getApiConfig() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY || '';
  const baseUrl = import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-3.5-turbo';
  return { apiKey, baseUrl, model };
}

function buildPrompt(words, wordCount, difficulty) {
  const difficultyMap = {
    easy: 'beginner (A1-A2), simple sentences, common everyday topics',
    medium: 'intermediate (B1-B2), moderately complex sentences, general topics',
    hard: 'advanced (C1-C2), complex sentence structures, academic or professional topics',
  };

  const level = difficultyMap[difficulty] || difficultyMap.medium;

  return `你是一个英语学习材料生成器。请使用以下生词创建一个连贯的英文段落。

要求：
- 难度：${level}
- 总字数：约 ${wordCount} 词
- 必须将以下所有单词自然地融入段落中（可以适当使用派生形式，如名词变复数、动词变过去式等）
- 段落要有连贯的主题和逻辑，不要生硬地堆砌单词
- 在段落后面用「---」分隔，然后列出每个生词在段落中的中文翻译（格式：word: 中文释义）

生词列表：${words.join(', ')}

只输出英文段落和生词翻译，不要添加其他解释。`;
}

export async function generateParagraph(words, wordCount = 150, difficulty = 'medium') {
  const { apiKey, baseUrl, model } = getApiConfig();

  if (!apiKey) {
    throw new Error('请在 .env 文件中配置 VITE_OPENAI_API_KEY');
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are an English learning material generator. Always respond in English with Chinese word translations after a --- separator.' },
        { role: 'user', content: buildPrompt(words, wordCount, difficulty) },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `生成失败: ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices[0]?.message?.content || '';

  // Split paragraph from vocabulary translations
  const parts = content.split('---');
  const paragraph = parts[0]?.trim() || content;
  const vocabSection = parts[1]?.trim() || '';

  return { paragraph, vocabSection };
}
