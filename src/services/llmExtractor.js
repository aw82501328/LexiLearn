/**
 * LLM 文本提取服务 — 兼容 OpenAI / DeepSeek / 智谱 / 月之暗面 等接口
 * 配置方式：.env 文件
 *
 *   VITE_LLM_API_KEY=sk-xxx
 *   VITE_LLM_BASE_URL=https://api.openai.com/v1
 *   VITE_LLM_MODEL=gpt-4o-mini
 */

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
                content: 'You are a precise OCR engine. Extract text from document images exactly as they appear. IMPORTANT: Do NOT include page numbers or page footers in the extracted text. Return only the content text, nothing else.',
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Extract ALL text from this English document page (page ${pageNum}). Preserve the original reading order, paragraphs, and line breaks. Only return the extracted text, no explanations. If the page is blank or contains only images without text, return an empty response.`,
                  },
                  {
                    type: 'image_url',
                    image_url: { url: imageBase64 },
                  },
                ],
              },
            ],
            max_tokens: 4096,
            temperature: 0,
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

  const CONCURRENCY = 2;          // 降低并发数，减轻 TPM 压力
  const BATCH_DELAY = 2000;      // 每批之间等待 2 秒

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

    // 批次间延迟，避免触发 TPM 限流
    if (i + CONCURRENCY < totalPages) {
      await sleep(BATCH_DELAY);
    }
  }

  return { pages, text: pages.join('\n\n') };
}
