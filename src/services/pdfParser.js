import * as pdfjsLib from 'pdfjs-dist';
import { extractPDFWithLLM } from './llmExtractor.js';
import { WORD_DICT } from './wordDict.js';

// 使用 Vite 的 import.meta.url 正确解析 worker 路径
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/** 按行排序（先 Y 再 X，确保阅读顺序正确），并根据水平间隙自动补充空格 */
function simpleSortItems(items, pageHeight = Infinity) {
  if (!items || items.length === 0) return '';

  // 只取有效文本项，同时估算每个项的右边界
  const pts = [];
  for (const it of items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    // transform: [a, b, c, d, e, f] — a≈fontSize, e=X, f=Y
    const fontSize = Math.abs(it.transform[0]) || 12;
    const x = it.transform[4];
    const y = it.transform[5];
    const estimatedWidth = s.length * fontSize * 0.55;
    pts.push({ s, x, y, approximateRight: x + estimatedWidth, fontSize });
  }
  if (pts.length === 0) return '';

  // 按 Y 降序（大Y=上方行），同一行内按 X 升序（左到右）
  pts.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.x - b.x;
  });

  // 计算页眉/页脚区域
  const headerThreshold = pageHeight > 0 ? pageHeight * 0.88 : Infinity; // 顶部 12%
  const footerThreshold = pageHeight > 0 ? pageHeight * 0.12 : -Infinity; // 底部 12%

  // 逐项拼接：过滤页眉页脚，换行时加 \n，同行内根据间隙决定是否加空格
  let result = '';
  let firstItem = true;
  let lastY = 0;
  let prevRightX = 0;

  for (const p of pts) {
    // ── 过滤页眉/页脚/页码 ──
    // 页眉区 (Y > 88% 高度) 或 页脚区 (Y < 12% 高度)：丢弃，除非是长文本（短文本才是页眉页脚）
    if ((p.y > headerThreshold || p.y < footerThreshold) && p.s.length < 20) {
      continue;
    }
    // 纯粹的数字（页码）在任何位置都过滤
    if (/^\d{1,4}$/.test(p.s.trim())) continue;

    if (firstItem) {
      result += p.s;
      lastY = p.y;
      prevRightX = p.approximateRight;
      firstItem = false;
      continue;
    }

    const yChanged = Math.abs(p.y - lastY) > 5;
    if (yChanged) {
      result += '\n';
      prevRightX = p.approximateRight;
    } else {
      const gap = p.x - prevRightX;
      if (gap > p.fontSize * 0.15) {
        result += ' ';
      }
      prevRightX = p.approximateRight;
    }

    result += p.s;
    lastY = p.y;
  }

  return result.replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
}

/** 获取页面尺寸并处理文本项（页眉页脚过滤 + 排序拼装） */
async function processPageText(page) {
  const content = await page.getTextContent();
  // 用文本项 Y 范围估算页面高度，避免 getViewport 开销
  let maxY = 0;
  for (const item of content.items) {
    if (item.transform && item.transform[5] > maxY) maxY = item.transform[5];
  }
  const pageHeight = maxY || 850; // 默认 A4 高度
  return simpleSortItems(content.items, pageHeight);
}

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
 * 解析 PDF 文件，优先提取内嵌文字，若无文字则回退到 OCR 识别
 * @returns {{ text, pages, name, size, messages }}
 *   - text: 全文（pages 用 \n\n 拼接）
 *   - pages: string[] 每页文字
 */
export async function parsePDF(file, onProgress, { skipOCR = false } = {}) {

  const t0 = performance.now();
  const arrayBuffer = await file.arrayBuffer();
  console.log('[perf] arrayBuffer:', (performance.now() - t0).toFixed(0), 'ms, size:', (file.size / 1024 / 1024).toFixed(1), 'MB');

  const t1 = performance.now();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  console.log('[perf] pdf.js load:', (performance.now() - t1).toFixed(0), 'ms, pages:', totalPages);

  const SAMPLE_PAGES = Math.min(3, totalPages);
  const CONCURRENCY = 6; // 并行处理页数
  let completedCount = 0;

  // 先并行采样前几页，快速判断是否有内嵌文字
  const samplePages = [];
  for (let batchStart = 1; batchStart <= SAMPLE_PAGES; batchStart += CONCURRENCY) {
    const batch = [];
    for (let i = batchStart; i < batchStart + CONCURRENCY && i <= SAMPLE_PAGES; i++) {
      batch.push(
        (async (pageNum) => {
          const page = await pdf.getPage(pageNum);
          const text = await processPageText(page);
          return { pageNum, text };
        })(i)
      );
    }
    const results = await Promise.all(batch);
    for (const r of results) samplePages.push(r);
    completedCount += results.length;
    onProgress?.({ done: completedCount, totalPages, stage: 'text' });
  }

  let hasText = false;
  const pages = [];
  for (const r of samplePages) {
    const cleaned = filterGarbledText(r.text);
    if (cleaned) {
      hasText = true;
      pages[r.pageNum - 1] = cleaned;
    } else {
      pages[r.pageNum - 1] = '';
    }
  }

  if (!hasText) {
    if (skipOCR) {
      return { text: '', pages: [], name: file.name, size: file.size, messages: [] };
    }
    return await parsePDFWithOCR(pdf, totalPages, file, onProgress);
  }

  // 检查前几页文本质量（用过滤后的文本）
  const sampleText = samplePages.map((r) => filterGarbledText(r.text)).join(' ');
  const clean = sampleText.replace(/[^a-zA-Z0-9 .,!?;:'"()\-\n]/g, '');
  const readableRatio = sampleText.length > 0 ? clean.length / sampleText.length : 0;
  if (readableRatio < 0.7) {
    if (skipOCR) {
      return { text: '', pages: [], name: file.name, size: file.size, messages: [] };
    }
    return await parsePDFWithOCR(pdf, totalPages, file, onProgress);
  }

  // 内嵌文字质量好，并行处理剩余页面
  const tPagesStart = performance.now();
  for (let batchStart = SAMPLE_PAGES + 1; batchStart <= totalPages; batchStart += CONCURRENCY) {
    const batch = [];
    for (let i = batchStart; i < batchStart + CONCURRENCY && i <= totalPages; i++) {
      batch.push(
        (async (pageNum) => {
          const page = await pdf.getPage(pageNum);
          const text = await processPageText(page);
          return { pageNum, text };
        })(i)
      );
    }
    const results = await Promise.all(batch);
    for (const r of results) {
      const cleaned = filterGarbledText(r.text || '');
      pages[r.pageNum - 1] = cleaned;
    }
    completedCount += results.length;
    onProgress?.({ done: completedCount, totalPages, stage: 'text' });
  }
  console.log('[perf] page processing:', (performance.now() - tPagesStart).toFixed(0), 'ms for', totalPages, 'pages');

  return {
    text: pages.filter(Boolean).join('\n\n'),
    pages: pages.map((p) => p || ''),
    name: file.name,
    size: file.size,
    messages: [],
    _buffer: arrayBuffer,  // 带出已读的 buffer，避免调用方再读一遍
  };
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
async function parsePDFWithOCR(pdf, totalPages, file, onProgress) {
  const Tesseract = (await import('tesseract.js')).default;

  const pages = [];

  const originalError = console.error;
  const filteredError = (...args) => {
    const msg = args.join(' ');
    if (/tesseract|line cannot be recognized|image too small|cannot rescale/i.test(msg)) return;
    originalError(...args);
  };

  for (let i = 1; i <= totalPages; i++) {
    onProgress?.({ page: i, totalPages, stage: 'ocr', pct: 0 });
    const page = await pdf.getPage(i);

    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const currentPage = i;
    console.error = filteredError;
    const result = await Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.({
            page: currentPage, totalPages, stage: 'ocr',
            pct: Math.round(m.progress * 100),
          });
        }
      },
    });
    console.error = originalError;

    const pageText = result.data.text.trim();
    pages.push(pageText);
  }

  const { pages: cleanP, text: finalText } = cleanPages(pages);
  if (!finalText.trim()) {
    throw new Error('OCR 未能识别到任何文字。该 PDF 可能不含文字内容。');
  }

  return { text: finalText, pages: cleanP, name: file.name, size: file.size, messages: [], _buffer: null };
}
