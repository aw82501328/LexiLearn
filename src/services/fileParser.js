import mammoth from 'mammoth';
import { isLLMConfigured } from './llmExtractor.js';

/**
 * 去除文本中的前言/目录/版权页等非正文内容，从正文开始
 */
const FRONT_MATTER_PATTERNS = [
  /^(?:table\s+of\s+)?contents$/i,
  /^copyright\b/i,
  /^all\s+rights?\s+reserved/i,
  /^(?:isbn|published\s+by|publisher|edition|printing|printed\s+in)/i,
  /^(?:preface|foreword|acknowledg?ements?|introduction|prologue|epigraph)$/i,
  /^(?:about\s+the\s+author|author'\s?\s*notes?|dedication|epigraph)$/i,
  /^(?:also\s+by|by\s+the\s+same\s+author|other\s+books\s+by)/i,
  /^(?:title\s+page|front\s*matter)$/i,
];

function isFrontMatterLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // 太长的行不太可能是纯粹的元数据标题
  if (trimmed.length > 80) return false;
  return FRONT_MATTER_PATTERNS.some((re) => re.test(trimmed));
}

function trimToBody(text) {
  if (!text) return text;
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length <= 1) return text;

  let startIdx = 0;

  // 从头部扫描，跳过前言段落
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i].trim();
    if (!p) {
      startIdx = i + 1;
      continue;
    }

    // 遇到独立的纯数字（页码）跳过
    if (/^\d{1,5}$/.test(p)) {
      startIdx = i + 1;
      continue;
    }

    if (isFrontMatterLine(p)) {
      startIdx = i + 1;
      continue;
    }

    // 正文段落通常更长，一旦遇到长段落就认为正文开始了
    if (p.length > 80 && /[a-z]{3,}/i.test(p)) {
      break;
    }

    // 如果已经略过很多段落了，剩下也该算正文
    if (i > 15) break;
  }

  // 如果跳过了太多，只保留后面部分
  const maxSkip = Math.min(startIdx, Math.max(paragraphs.length - 3, 3));
  const result = paragraphs.slice(maxSkip).join('\n\n').trim();
  return result || text;
}

export async function parseFile(file, onProgress, options = {}) {
  const { pdfMode } = options; // 'vision' | 'native' | undefined (auto)
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    // OCR 本地识别
    if (pdfMode === 'ocr') {
      const { parsePDFWithOCR } = await import('./pdfParser.js');
      return await parsePDFWithOCR(file, onProgress);
    }
    // LLM 视觉识别
    if (pdfMode === 'vision') {
      if (!isLLMConfigured()) {
        throw new Error('视觉模型未配置，请在 .env 中设置 VITE_LLM_API_KEY');
      }
      const { parsePDFWithLLM } = await import('./pdfParser.js');
      return await parsePDFWithLLM(file, onProgress);
    }
    // 自动模式：有 LLM 就用 LLM，否则 OCR
    if (isLLMConfigured()) {
      const { parsePDFWithLLM } = await import('./pdfParser.js');
      return await parsePDFWithLLM(file, onProgress);
    }
    const { parsePDFWithOCR } = await import('./pdfParser.js');
    return await parsePDFWithOCR(file, onProgress);
  }
  if (ext === 'doc' || ext === 'docx') {
    const result = await parseWord(file);
    result.text = trimToBody(result.text);
    return result;
  }
  if (ext === 'epub') {
    const { parseEPUB } = await import('./epubParser.js');
    const result = await parseEPUB(file);
    result.text = trimToBody(result.text);
    return result;
  }
  if (ext === 'mobi' || ext === 'azw' || ext === 'azw3') {
    try {
      const { parseMOBI } = await import('./mobiParser.js');
      const result = await parseMOBI(file);
      result.text = trimToBody(result.text);
      return result;
    } catch (mobiErr) {
      // MOBI 解析失败，尝试 EPUB 解析（文件可能被错误命名为 .mobi）
      if (ext === 'mobi') {
        try {
          const { parseEPUB } = await import('./epubParser.js');
          const result = await parseEPUB(file);
          result.text = trimToBody(result.text);
          return result;
        } catch {
          // EPUB fallback 也失败，抛出原始 MOBI 错误
        }
      }
      throw mobiErr;
    }
  }
  throw new Error('不支持的文件格式。仅支持 .doc、.docx、.pdf、.epub、.mobi、.azw/.azw3');
}

async function parseWord(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return {
    text: result.value,
    name: file.name,
    size: file.size,
    messages: result.messages,
  };
}

export function splitTextToParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function splitParagraphToSentences(paragraph) {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitSentenceToWords(sentence) {
  return sentence.split(/(\s+)/).filter((w) => w.trim().length > 0);
}
