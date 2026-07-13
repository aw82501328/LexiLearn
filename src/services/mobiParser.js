import { initMobiFile, initKf8File } from '@lingo-reader/mobi-parser';

/** HTML 转纯文本 */
function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, head, svg, img, br').forEach((el) => el.remove());
  // 块级元素后插入换行
  doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach((el) => {
    el.insertAdjacentText('afterend', '\n');
  });
  return (doc.body?.textContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export async function parseMOBI(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const errors = [];

  const tryBook = async (initFn, label) => {
    try {
      const book = await initFn(file);
      const spine = book.getSpine();
      if (!spine || spine.length === 0) {
        errors.push(`${label}: 未找到可读章节`);
        return null;
      }
      return { book, spine };
    } catch (e) {
      errors.push(`${label}: ${e.message || e}`);
      return null;
    }
  };

  let result = null;

  if (ext === 'azw' || ext === 'azw3' || ext === 'kf8') {
    result = await tryBook(initKf8File, 'KF8');
  } else {
    // .mobi: 先尝试 MOBI，失败再试 KF8
    result = await tryBook(initMobiFile, 'MOBI');
    if (!result) {
      result = await tryBook(initKf8File, 'KF8');
    }
  }

  if (!result) {
    const detail = errors.length > 0
      ? errors.map((e, i) => `[${i + 1}] ${e}`).join('；')
      : '未知错误';
    throw new Error(`MOBI/AZW3 解析失败：${detail}`);
  }

  const { book, spine } = result;

  // 遍历所有章节加载文本
  const chapters = [];
  for (const chapter of spine) {
    try {
      const chapterResult = book.loadChapter(chapter.id);
      if (chapterResult) {
        const plainText = htmlToPlainText(chapterResult.html);
        if (plainText) chapters.push(plainText);
      }
    } catch {
      // skip corrupted chapters
    }
  }

  const text = chapters.join('\n\n');
  if (!text) {
    throw new Error('MOBI/AZW3 文件中未找到文字内容');
  }

  return { text, name: file.name, size: file.size, messages: [] };
}
