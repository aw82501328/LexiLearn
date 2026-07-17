/**
 * 原生应用存储层（Capacitor Filesystem）
 *
 * 当应用打包为 Android/iOS 原生 App 时，使用 Capacitor Filesystem
 * 替代浏览器的 File System Access API 和 OPFS。
 *
 * 文件全部存入 Documents 目录下的 lexilearn/ 文件夹：
 *   lexilearn/
 *     files/
 *       {fileId}/
 *         original.{ext}    # 原始上传文件
 *         content.json       # { text, pages[], version }
 *         pages/
 *           p1.jpg
 *           p2.jpg
 *           ...
 */

const ROOT = 'lexilearn';

let _Filesystem = null;
let _Directory = null;

async function getFS() {
  if (_Filesystem) return { Filesystem: _Filesystem, Directory: _Directory };
  try {
    const mod = await import('@capacitor/filesystem');
    _Filesystem = mod.Filesystem;
    _Directory = mod.Directory;
    return { Filesystem: _Filesystem, Directory: _Directory };
  } catch {
    return null;
  }
}

/** 检测是否运行在 Capacitor 原生环境中 */
export function isNativePlatform() {
  try {
    return !!(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

// ── 内部辅助 ──

function path(...parts) {
  return [ROOT, ...parts].join('/');
}

async function writeText(fs, dir, filePath, text) {
  await fs.writeFile({
    path: filePath,
    data: text,
    directory: dir,
    recursive: true,
  });
}

async function readText(fs, dir, filePath) {
  try {
    const result = await fs.readFile({ path: filePath, directory: dir });
    return result.data;
  } catch {
    return null;
  }
}

async function writeBinary(fs, dir, filePath, blob) {
  const buf = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);
  await fs.writeFile({
    path: filePath,
    data: base64,
    directory: dir,
    recursive: true,
  });
}

async function readBinary(fs, dir, filePath) {
  try {
    const result = await fs.readFile({ path: filePath, directory: dir });
    return base64ToArrayBuffer(result.data);
  } catch {
    return null;
  }
}

async function removeEntry(fs, dir, filePath) {
  try { await fs.deleteFile({ path: filePath, directory: dir }); } catch {}
}

// ── base64 转换 ──

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── 原始文件 ──

export async function saveOriginalFile(fileId, file) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  const ext = (file.name || '').split('.').pop() || 'bin';
  await writeBinary(fs, dir, path('files', fileId, `original.${ext}`), file);
}

export async function loadOriginalFile(fileId) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  try {
    // 枚举找到 original.* 文件
    const list = await fs.readdir({ path: path('files', fileId), directory: dir });
    const orig = list.files.find((f) => f.name.startsWith('original.'));
    if (!orig) return null;
    const buf = await readBinary(fs, dir, path('files', fileId, orig.name));
    if (!buf) return null;
    return { buffer: buf, size: buf.byteLength, name: orig.name };
  } catch {
    return null;
  }
}

// ── 文件正文内容 ──

export async function saveFileContent(fileId, data) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  await writeText(fs, dir, path('files', fileId, 'content.json'), JSON.stringify({
    text: data.text,
    pages: data.pages || null,
    version: Date.now(),
  }));
}

export async function loadFileContent(fileId) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  const raw = await readText(fs, dir, path('files', fileId, 'content.json'));
  return raw ? JSON.parse(raw) : null;
}

// ── PDF 页面图片 ──

export async function savePageImage(fileId, pageNum, dataUrl) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  // dataUrl 格式: "data:image/jpeg;base64,..."
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  await fs.writeFile({
    path: path('files', fileId, 'pages', `p${pageNum}.jpg`),
    data: base64,
    directory: dir,
    recursive: true,
  });
}

export async function loadPageImage(fileId, pageNum) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  try {
    const result = await fs.readFile({
      path: path('files', fileId, 'pages', `p${pageNum}.jpg`),
      directory: dir,
    });
    return `data:image/jpeg;base64,${result.data}`;
  } catch {
    return null;
  }
}

// ── 删除 ──

export async function deleteFileData(fileId) {
  const { Filesystem: fs, Directory: dir } = await getFS();
  try {
    await fs.rmdir({ path: path('files', fileId), directory: dir, recursive: true });
  } catch {}
}

// ── 存储用量 ──

async function dirSizeRecursive(fs, dir, dirPath) {
  let total = 0;
  try {
    const list = await fs.readdir({ path: dirPath, directory: dir });
    for (const f of list.files) {
      if (f.type === 'file') total += f.size || 0;
      if (f.type === 'directory') {
        total += await dirSizeRecursive(fs, dir, `${dirPath}/${f.name}`);
      }
    }
  } catch {}
  return total;
}

export async function getStorageSize() {
  const { Filesystem: fs, Directory: dir } = await getFS();
  const totalBytes = await dirSizeRecursive(fs, dir, ROOT);
  return {
    totalBytes,
    totalMB: Math.round(totalBytes / 1024 / 1024 * 10) / 10,
    quotaMB: 'native',
  };
}

export async function listLocalFileIds() {
  const { Filesystem: fs, Directory: dir } = await getFS();
  const ids = new Set();
  try {
    const list = await fs.readdir({ path: path('files'), directory: dir });
    for (const f of list.files) {
      if (f.type === 'directory') ids.add(f.name);
    }
  } catch {}
  return ids;
}
