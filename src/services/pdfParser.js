import * as pdfjsLib from 'pdfjs-dist';
import { extractPDFWithLLM } from './llmExtractor.js';
import { WORD_DICT } from './wordDict.js';

// 使用 Vite 的 import.meta.url 正确解析 worker 路径
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * 对页面数组统一做清理：去乱码 → 去页眉页脚
 * 返回清理后的页面数组和拼接全文
 */
function cleanPages(pages) {
  const cleaned = pages.map((p) => {
    const garbled = filterGarbledText(p);
    return stripHeaderFooterLines(garbled);
  });
  const body = cleaned.map((p) => p || '');
  return { pages: body, text: body.filter(Boolean).join('\n\n') };
}

function stripHeaderFooterLines(text) {
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length === 0) return '';

  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // 跳过纯空行
    if (!trimmed) continue;

    // 纯数字 / 罗马数字（页码）
    if (/^\d{1,5}$/.test(trimmed)) continue;
    if (/^(?:[ivxlcdm]+|\d{1,5})$/.test(trimmed.toLowerCase().replace(/\.$/, ''))) continue;

    // 短大写行（页眉：类似 "CHAPTER 1" / "JOHN DOE"），长度 < 60 且全大写或几乎全大写
    const alpha = trimmed.replace(/[^a-zA-Z]/g, '');
    const upperCount = (alpha.match(/[A-Z]/g) || []).length;
    const totalAlpha = alpha.length;
    if (trimmed.length < 60 && totalAlpha > 0 && upperCount / totalAlpha >= 0.85) {
      // 但排除正文中的短行如 "The" 或 "I." — 全大写才算页眉
      if (upperCount === totalAlpha) {
        // 跳过太长的独立行 (可能是标题，不是页眉)
        if (trimmed.length > 3) continue;
      }
    }

    result.push(lines[i]); // 保留原始格式
  }

  return result.join('\n').trim();
}

/**
 * 乱码过滤：逐行两层过滤
 * ① 英文字母占比 ≥ 65%
 * ② 至少 1 个非全大写 token（≥2 字母）在词典中
 */
function filterGarbledText(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const filtered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // ① 字母占比 ≥ 65%
    const letters = (line.match(/[a-zA-Z]/g) || []).length;
    if (letters / line.length < 0.65) continue;

    // ② 至少 1 个非全大写 token 在 10000 词词典中
    const tokens = line.match(/[a-zA-Z]{2,}/g);
    const found = tokens && tokens.some((t) => {
      if (!/[a-z]/.test(t)) return false; // 全大写 → 跳过
      return WORD_DICT.has(t.toLowerCase());
    });
    if (!found) continue;

    filtered.push(line);
  }

  return filtered.join('\n').trim();
}

/**
 * 使用 LLM 逐页提取 PDF 文字
 */
export async function parsePDFWithLLM(file, onProgress) {

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const scale = 1.5;

  const result = await extractPDFWithLLM(
    async (pageNum) => {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: viewport.width, height: viewport.height };
    },
    totalPages,
    onProgress
  );

  const { pages, text } = cleanPages(result.pages);

  return {
    text,
    pages: pages.map((p) => p || ''),
    name: file.name,
    size: file.size,
    messages: [],
    _buffer: arrayBuffer,
  };
}

/**
 * 将 PDF 每页渲染为图片，用 tesseract.js 识别
 */
export async function parsePDFWithOCR(file, onProgress) {
  const Tesseract = (await import('tesseract.js')).default;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pages = new Array(totalPages);

  async function processOCRPage(pageNum) {
    onProgress?.({ page: pageNum, totalPages, stage: 'ocr', pct: 0 });
    const page = await pdf.getPage(pageNum);

    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const result = await Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.({
            page: pageNum, totalPages, stage: 'ocr',
            pct: Math.round(m.progress * 100),
          });
        }
      },
    });

    const pageText = result.data.text.trim();
    pages[pageNum - 1] = pageText;
  }

  // 并行 3 页一批
  for (let i = 1; i <= totalPages; i += 3) {
    const batch = [processOCRPage(i)];
    if (i + 1 <= totalPages) batch.push(processOCRPage(i + 1));
    if (i + 2 <= totalPages) batch.push(processOCRPage(i + 2));
    await Promise.all(batch);
  }

  const { pages: cleanP, text: finalText } = cleanPages(pages);
  if (!finalText.trim()) {
    throw new Error('OCR 未能识别到任何文字。该 PDF 可能不含文字内容。');
  }

  return { text: finalText, pages: cleanP, name: file.name, size: file.size, messages: [], _buffer: arrayBuffer };
}
