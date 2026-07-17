/**
 * LLM 文本提取服务 — 兼容 OpenAI / DeepSeek / 智谱 / 月之暗面 等接口
 * 配置方式：.env 文件（API 密钥） + src/config/llmPrompts.json（提示词）
 *
 *   .env:
 *     VITE_LLM_API_KEY=sk-xxx
 *     VITE_LLM_BASE_URL=https://api.openai.com/v1
 *     VITE_LLM_MODEL=gpt-4o-mini
 *
 *   src/config/llmPrompts.json:
 *     修改 systemPrompt / userPrompt / maxTokens / temperature 即可生效
 */

// ── 提示词配置（来自 llmPrompts.json，支持用户自定义）──

const DEFAULT_SYSTEM_PROMPT = 'You are a precise OCR engine. Extract text from document images exactly as they appear. IMPORTANT: Do NOT include page numbers or page footers in the extracted text. Return only the content text, nothing else.';
const DEFAULT_USER_PROMPT = 'Extract ALL text from this English document page (page {pageNum}). Preserve the original reading order, paragraphs, and line breaks. Only return the extracted text, no explanations. If the page is blank or contains only images without text, return an empty response.';

let _promptConfig = null;

async function loadPromptConfig() {
  if (_promptConfig) return _promptConfig;
  try {
    const mod = await import('../config/llmPrompts.json');
    _promptConfig = {
      systemPrompt: mod.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      userPrompt: mod.userPrompt || DEFAULT_USER_PROMPT,
      maxTokens: mod.maxTokens || 4096,
      temperature: mod.temperature ?? 0,
    };
  } catch {
    // 配置文件不存在时使用默认值
    _promptConfig = {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      userPrompt: DEFAULT_USER_PROMPT,
      maxTokens: 4096,
      temperature: 0,
    };
  }
  return _promptConfig;
}

function getBaseUrl() {
  return import.meta.env.VITE_LLM_BASE_URL || 'https://api.openai.com/v1';
}

function getApiKey() {
  return import.meta.env.VITE_LLM_API_KEY || '';
}

function getModel() {
  return import.meta.env.VITE_LLM_MODEL || 'gpt-4o-mini';
}

export function isLLMConfigured() {
  return !!getApiKey();
}

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 3000; // 基础重试延迟 3 秒

/**
 * 等待指定毫秒
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 将 PDF 页面图片发送给 LLM，提取文字（带指数退避重试）
 * @param {string} imageBase64 - canvas.toDataURL() 结果
 * @param {number} pageNum - 页码
 * @returns {Promise<string>} 提取的文字
 */
export async function extractTextWithLLM(imageBase64, pageNum) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('请在 .env 文件中配置 VITE_LLM_API_KEY');
  }

  const baseUrl = getBaseUrl();
  const model = getModel();
  const cfg = await loadPromptConfig();

  const systemContent = cfg.systemPrompt;
  const userContent = cfg.userPrompt.replace(/\{pageNum\}/g, String(pageNum));

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
      console.warn(`[LLM] 页面 ${pageNum} 第 ${attempt}/${MAX_RETRIES} 次重试，等待 ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      let response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content: systemContent,
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: userContent,
                  },
                  {
                    type: 'image_url',
                    image_url: { url: imageBase64 },
                  },
                ],
              },
            ],
            max_tokens: cfg.maxTokens,
            temperature: cfg.temperature,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const body = await response.text();
        const status = response.status;

        // 429 限流 / 503 服务不可用 → 可重试
        if ((status === 429 || status === 503) && attempt < MAX_RETRIES) {
          lastError = new Error(`LLM API ${status} (可重试): ${body.substring(0, 200)}`);
          continue;
        }

        let detail = body;
        try { detail = JSON.parse(body).error?.message || JSON.stringify(JSON.parse(body).error) || body; } catch {}
        throw new Error(`LLM API ${status}: ${detail}`);
      }

      const data = await response.json();
      return (data.choices?.[0]?.message?.content || '').trim();
    } catch (err) {
      // 网络错误也可以重试
      if (err.name === 'TypeError' && err.message.includes('fetch') && attempt < MAX_RETRIES) {
        lastError = err;
        continue;
      }
      // 非可重试错误直接抛出
      if (err.message && !err.message.includes('可重试')) {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError || new Error(`LLM API: 页面 ${pageNum} 重试 ${MAX_RETRIES} 次后仍然失败`);
}

/**
 * 批量提取多页 PDF 的文字（并发控制 + 批次间延迟，避免 TPM 限流）
 * @param {function} renderPageToImage - (pageNum) => Promise<{dataUrl}>
 * @param {number} totalPages
 * @param {function} [onProgress]
 * @returns {Promise<{pages: string[], text: string}>}
 */
export async function extractPDFWithLLM(renderPageToImage, totalPages, onProgress) {
  const pages = new Array(totalPages);
  let completed = 0;

  const CONCURRENCY = 4;          // 每批 4 页，充分利用 API 并发

  async function processPage(pageNum) {
    onProgress?.({ page: pageNum, totalPages, stage: 'llm', pct: 0, done: completed });

    const { dataUrl } = await renderPageToImage(pageNum);

    onProgress?.({ page: pageNum, totalPages, stage: 'llm', pct: 50, done: completed });
    const pageText = await extractTextWithLLM(dataUrl, pageNum);
    pages[pageNum - 1] = pageText;

    completed++;
    onProgress?.({ page: pageNum, totalPages, stage: 'llm', pct: 100, done: completed });
  }

  for (let i = 0; i < totalPages; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < i + CONCURRENCY && j < totalPages; j++) {
      batch.push(processPage(j + 1));
    }
    await Promise.all(batch);
  }

  return { pages, text: pages.join('\n\n') };
}
