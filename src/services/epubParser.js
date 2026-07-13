import JSZip from 'jszip';

/**
 * 解析 EPUB 文件，提取其中所有 HTML 章节的纯文本
 * EPUB 本质是一个 ZIP 包，内含 XHTML/HTML 内容文件
 */
export async function parseEPUB(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. 读取 container.xml 获取 OPF 文件路径
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('无效的 EPUB 文件：缺少 container.xml');
  }

  const containerXml = await containerFile.async('text');
  const opfPath = parseOPFPath(containerXml);
  if (!opfPath) {
    throw new Error('无法在 container.xml 中找到 OPF 文件路径');
  }

  // 2. 读取 OPF 文件，获取 spine（阅读顺序）中的内容文件列表
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error('找不到 OPF 文件：' + opfPath);
  }

  const opfXml = await opfFile.async('text');
  const spineItems = parseSpineItems(opfXml, opfPath);

  // 3. 逐个读取内容文件，提取纯文本
  const chapters = [];
  for (const href of spineItems) {
    const fullPath = resolvePath(opfPath, href);
    const contentFile = zip.file(fullPath);
    if (!contentFile) continue;

    const html = await contentFile.async('text');
    const text = htmlToPlainText(html);
    if (text.trim()) {
      chapters.push(text.trim());
    }
  }

  const text = chapters.join('\n\n');
  if (!text) {
    throw new Error('EPUB 文件中未找到文字内容。');
  }

  return {
    text,
    name: file.name,
    size: file.size,
    messages: [],
  };
}

/** 从 container.xml 中提取 OPF 文件路径 */
function parseOPFPath(xml) {
  const match = xml.match(/full-path="([^"]+)"/);
  return match ? match[1] : null;
}

/** 从 OPF 文件中提取 spine 条目列表（按阅读顺序） */
function parseSpineItems(opfXml) {
  const items = {};

  // 解析 manifest 中的 item id -> href 映射
  const manifestRegex = /<item[^>]*>/g;
  let m;
  while ((m = manifestRegex.exec(opfXml)) !== null) {
    const idMatch = m[0].match(/id="([^"]+)"/);
    const hrefMatch = m[0].match(/href="([^"]+)"/);
    if (idMatch && hrefMatch) {
      items[idMatch[1]] = hrefMatch[1];
    }
  }

  // 解析 spine 中的阅读顺序
  const spine = [];
  const spineRegex = /<itemref[^>]*>/g;
  while ((m = spineRegex.exec(opfXml)) !== null) {
    const idrefMatch = m[0].match(/idref="([^"]+)"/);
    if (idrefMatch && items[idrefMatch[1]]) {
      spine.push(items[idrefMatch[1]]);
    }
  }

  return spine;
}

/** 解析相对路径 */
function resolvePath(basePath, href) {
  const baseDir = basePath.split('/').slice(0, -1).join('/');
  if (!baseDir) return href;

  const parts = baseDir.split('/');
  for (const seg of href.split('/')) {
    if (seg === '..') {
      parts.pop();
    } else if (seg !== '.') {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

/** 将 HTML 转为纯文本 */
function htmlToPlainText(html) {
  // 用 DOM 解析器清理标签
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 移除 script / style
  doc.querySelectorAll('script, style, head, svg, img').forEach((el) => el.remove());

  // 在块级元素后插入换行
  doc.querySelectorAll('p, div, br, h1, h2, h3, h4, h5, h6, li, tr').forEach((el) => {
    el.insertAdjacentText('afterend', '\n');
  });

  const text = doc.body?.textContent || '';
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
