/**
 * OPFS 降级存储层
 * 当浏览器不支持 File System Access API 时，
 * 使用 Origin Private File System 作为大文件存储。
 * 适用于 Chrome 102+ / Firefox 111+ / Safari 15.2+
 */

const ROOT_DIR = 'lexilearn_data';

async function getRoot() {
  return await navigator.storage.getDirectory();
}

async function ensureDir(...pathParts) {
  const root = await getRoot();
  let current = root;
  for (const part of [ROOT_DIR, ...pathParts].filter(Boolean)) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

// ── 存储配额 ──

export async function getOPFSStorageInfo() {
  const estimate = await navigator.storage?.estimate();
  if (!estimate) return { quotaMB: 'unknown', usageMB: 'unknown' };
  return {
    quotaMB: Math.round(estimate.quota / 1024 / 1024),
    usageMB: Math.round(estimate.usage / 1024 / 1024),
  };
}

export async function checkOPFSQuota(neededMB) {
  const { quotaMB, usageMB } = await getOPFSStorageInfo();
  if (typeof quotaMB !== 'number') return { ok: true };
  if (usageMB + neededMB > quotaMB * 0.9) {
    return { ok: false, quotaMB, usageMB, neededMB };
  }
  return { ok: true, quotaMB, usageMB, neededMB };
}

// ── 原始文件（PDF/EPUB 等） ──

export async function saveOriginalToOPFS(fileId, file) {
  const dir = await ensureDir('originals');
  const ext = (file.name || '').split('.').pop() || 'bin';
  const name = `${fileId}.${ext}`;
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await file.stream().pipeTo(writable);

  // 记录元信息
  const metaDir = await ensureDir('originals', fileId);
  const metaHandle = await metaDir.getFileHandle('_meta.json', { create: true });
  const metaWritable = await metaHandle.createWritable();
  await metaWritable.write(JSON.stringify({
    name: file.name,
    size: file.size,
    savedAt: Date.now(),
  }));
  await metaWritable.close();
}

export async function loadOriginalFromOPFS(fileId) {
  const dir = await ensureDir('originals');
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.startsWith(fileId + '.')) {
      const file = await handle.getFile();
      return { buffer: await file.arrayBuffer(), size: file.size, name };
    }
  }
  return null;
}

// ── 文件正文内容（text + pages） ──

export async function saveContentToOPFS(fileId, content) {
  const dir = await ensureDir('content');
  const fileHandle = await dir.getFileHandle(`${fileId}.json`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(content));
  await writable.close();
}

export async function loadContentFromOPFS(fileId) {
  const dir = await ensureDir('content');
  try {
    const fileHandle = await dir.getFileHandle(`${fileId}.json`);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── PDF 页面图片 ──

export async function savePageImageToOPFS(fileId, pageNum, dataUrl) {
  const imgDir = await ensureDir('images', fileId);
  const fileHandle = await imgDir.getFileHandle(`p${pageNum}.jpg`, { create: true });
  const writable = await fileHandle.createWritable();
  const resp = await fetch(dataUrl);
  await resp.body.pipeTo(writable);
}

export async function loadPageImageFromOPFS(fileId, pageNum) {
  try {
    const imgDir = await ensureDir('images', fileId);
    const fileHandle = await imgDir.getFileHandle(`p${pageNum}.jpg`);
    const file = await fileHandle.getFile();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  } catch {
    return null;
  }
}

// ── 清理 ──

export async function deleteFileFromOPFS(fileId) {
  const root = await getRoot();
  try {
    const mainDir = await root.getDirectoryHandle(ROOT_DIR);
    const subDirs = ['originals', 'content', 'images'];
    for (const sub of subDirs) {
      try {
        const dir = await mainDir.getDirectoryHandle(sub);
        if (sub === 'images' || sub === 'originals') {
          try { await dir.removeEntry(fileId, { recursive: true }); } catch {}
        }
        if (sub === 'originals') {
          for await (const [name] of dir.entries()) {
            if (name.startsWith(fileId + '.')) {
              try { await dir.removeEntry(name); } catch {}
              break;
            }
          }
        }
        if (sub === 'content') {
          try { await dir.removeEntry(`${fileId}.json`); } catch {}
        }
      } catch {}
    }
  } catch {}
}

export async function listOPFSFileIds() {
  const ids = new Set();
  const root = await getRoot();
  try {
    const mainDir = await root.getDirectoryHandle(ROOT_DIR);
    const contentDir = await mainDir.getDirectoryHandle('content');
    for await (const [name] of contentDir.entries()) {
      const id = name.replace('.json', '');
      ids.add(id);
    }
  } catch {}
  return ids;
}

export function isOPFSSupported() {
  try {
    return typeof navigator !== 'undefined'
      && typeof navigator.storage !== 'undefined'
      && typeof navigator.storage.getDirectory === 'function';
  } catch {
    return false;
  }
}
