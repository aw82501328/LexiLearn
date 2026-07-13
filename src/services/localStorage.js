/**
 * 统一本地存储层
 * 
 * 优先使用 File System Access API（直接读写用户磁盘），
 * 不支持时降级到 OPFS（浏览器沙箱文件系统）。
 * 
 * 磁盘模式目录结构：
 *   用户选择的文件夹/
 *     lexilearn_info.json
 *     files/
 *       {fileId}/
 *         original.{ext}   # 用户上传的原始文件
 *         content.json      # { text, pages[], version }
 *         pages/            # PDF 页面渲染图片
 *           p1.jpg
 *           p2.jpg
 *           ...
 */

let _dirHandle = null;
const APP_FOLDER_ID = 'lexilearn-storage-v3';
const IDB_NAME = 'lexilearn-fs';
const IDB_STORE = 'handles';

// ── 目录句柄 IndexedDB 持久化（跨 HMR / 页面刷新恢复）──

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, APP_FOLDER_ID);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* IndexedDB 不可用时静默失败 */ }
}

async function loadDirHandle() {
  try {
    const db = await openIDB();
    const handle = await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(APP_FOLDER_ID);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    db.close();
    if (handle) {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return handle;
      // 权限已过期，需要重新请求
      const requested = await handle.requestPermission({ mode: 'readwrite' });
      if (requested === 'granted') return handle;
    }
    return null;
  } catch { return null; }
}

// ── 模式检测 ──

export function supportsDiskStorage() {
  try {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  } catch {
    return false;
  }
}

export function isDiskMode() {
  return localStorage.getItem('lexilearn_storage_mode') === 'disk';
}

// ── 目录初始化 ──

export async function requestStorageDirectory() {
  if (!supportsDiskStorage()) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const handle = await window.showDirectoryPicker({
      id: APP_FOLDER_ID,
      mode: 'readwrite',
      startIn: 'documents',
    });
    _dirHandle = handle;
    saveDirHandle(handle);
    await ensureSubDirs(handle);
    const meta = { app: 'lexilearn', version: 1, createdAt: Date.now() };
    await writeFile(handle, 'lexilearn_info.json', JSON.stringify(meta, null, 2));
    localStorage.setItem('lexilearn_storage_mode', 'disk');
    localStorage.setItem('lexilearn_storage_path', handle.name);
    return { ok: true, path: handle.name };
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'DOMException') {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: false, reason: 'error', error: e.message };
  }
}

export async function restoreStorageDirectory() {
  if (!supportsDiskStorage()) return false;
  if (localStorage.getItem('lexilearn_storage_mode') !== 'disk') return false;
  try {
    // 优先从 IndexedDB 恢复，避免弹选文件夹框
    const cached = await loadDirHandle();
    if (cached) {
      _dirHandle = cached;
      await ensureSubDirs(cached);
      return true;
    }
    const handle = await window.showDirectoryPicker({ id: APP_FOLDER_ID, mode: 'readwrite' });
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const requested = await handle.requestPermission({ mode: 'readwrite' });
      if (requested !== 'granted') {
        localStorage.removeItem('lexilearn_storage_mode');
        localStorage.removeItem('lexilearn_storage_path');
        return false;
      }
    }
    _dirHandle = handle;
    saveDirHandle(handle);
    await ensureSubDirs(handle);
    localStorage.setItem('lexilearn_storage_mode', 'disk');
    localStorage.setItem('lexilearn_storage_path', handle.name);
    return true;
  } catch {
    return false;
  }
}

/**
 * 惰性恢复磁盘目录句柄
 * 先尝试 IndexedDB 恢复，失败再请求浏览器 API
 */
export async function ensureDiskReady() {
  if (_dirHandle) return;
  if (localStorage.getItem('lexilearn_storage_mode') !== 'disk') throw new Error('当前不是磁盘存储模式');
  try {
    // 优先从 IndexedDB 恢复句柄（无弹窗）
    const cached = await loadDirHandle();
    if (cached) {
      _dirHandle = cached;
      await ensureSubDirs(cached);
      return;
    }
    // 回退：请求浏览器恢复（可能弹权限确认框）
    const handle = await window.showDirectoryPicker({ id: APP_FOLDER_ID, mode: 'readwrite' });
    if (!handle) throw new Error('无法恢复磁盘目录访问权限');
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const requested = await handle.requestPermission({ mode: 'readwrite' });
      if (requested !== 'granted') throw new Error('磁盘目录权限已被拒绝，请在存储管理中重新授权');
    }
    _dirHandle = handle;
    saveDirHandle(handle);
    await ensureSubDirs(handle);
  } catch (e) {
    if (e.name === 'AbortError' || e.message?.includes('拒绝')) throw e;
    throw new Error('磁盘访问权限已过期，请在存储管理中重新选择文件夹');
  }
}

export function resetDiskMode() {
  _dirHandle = null;
  localStorage.removeItem('lexilearn_storage_mode');
  localStorage.removeItem('lexilearn_storage_path');
  // 清除 IndexedDB 中缓存的句柄
  openIDB().then((db) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(APP_FOLDER_ID);
    db.close();
  }).catch(() => {});
}

export function getStoragePath() {
  const mode = localStorage.getItem('lexilearn_storage_mode');
  if (mode === 'disk') return localStorage.getItem('lexilearn_storage_path') || '本地文件夹';
  if (mode === 'opfs') return '浏览器内置存储 (OPFS)';
  return null;
}

// ── 内部辅助 ──

async function ensureSubDirs(root) {
  await root.getDirectoryHandle('files', { create: true });
}

async function writeFile(dirHandle, fileName, content) {
  const fh = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(typeof content === 'string' ? content : content);
  await writable.close();
}

async function readFile(dirHandle, fileName) {
  try {
    const fh = await dirHandle.getFileHandle(fileName);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function getFilesDir() {
  if (!_dirHandle) throw new Error('磁盘存储未初始化');
  return await _dirHandle.getDirectoryHandle('files');
}

async function getFileDir(fileId) {
  const filesDir = await getFilesDir();
  return await filesDir.getDirectoryHandle(fileId, { create: true });
}

async function getPagesDir(fileId) {
  const fileDir = await getFileDir(fileId);
  return await fileDir.getDirectoryHandle('pages', { create: true });
}

async function removeEntry(parentHandle, name, recursive = false) {
  try { await parentHandle.removeEntry(name, { recursive }); } catch {}
}

// ── 原始文件 ──

export async function saveOriginalFile(fileId, file) {
  if (!isDiskMode()) {
    const { saveOriginalToOPFS } = await import('./opfsStorage');
    return await saveOriginalToOPFS(fileId, file);
  }
  await ensureDiskReady();
  const ext = (file.name || '').split('.').pop() || 'bin';
  const fileDir = await getFileDir(fileId);
  const fh = await fileDir.getFileHandle(`original.${ext}`, { create: true });
  const writable = await fh.createWritable();
  await file.stream().pipeTo(writable);
}

export async function loadOriginalFile(fileId) {
  if (!isDiskMode()) {
    const { loadOriginalFromOPFS } = await import('./opfsStorage');
    return await loadOriginalFromOPFS(fileId);
  }
  await ensureDiskReady();
  try {
    const fileDir = await getFileDir(fileId);
    for await (const [name, handle] of fileDir.entries()) {
      if (handle.kind === 'file' && name.startsWith('original.')) {
        const file = await handle.getFile();
        return { buffer: await file.arrayBuffer(), size: file.size, name };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── 文件正文内容 ──

export async function saveFileContent(fileId, data) {
  if (!isDiskMode()) {
    const { saveContentToOPFS } = await import('./opfsStorage');
    return await saveContentToOPFS(fileId, data);
  }
  await ensureDiskReady();
  const fileDir = await getFileDir(fileId);
  await writeFile(fileDir, 'content.json', JSON.stringify({
    text: data.text,
    pages: data.pages || null,
    version: Date.now(),
  }));
}

export async function loadFileContent(fileId) {
  if (!isDiskMode()) {
    const { loadContentFromOPFS } = await import('./opfsStorage');
    return await loadContentFromOPFS(fileId);
  }
  await ensureDiskReady();
  try {
    const fileDir = await getFileDir(fileId);
    const raw = await readFile(fileDir, 'content.json');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── PDF 页面图片 ──

export async function savePageImage(fileId, pageNum, dataUrl) {
  if (!isDiskMode()) {
    const { savePageImageToOPFS } = await import('./opfsStorage');
    return await savePageImageToOPFS(fileId, pageNum, dataUrl);
  }
  await ensureDiskReady();
  const pagesDir = await getPagesDir(fileId);
  const fh = await pagesDir.getFileHandle(`p${pageNum}.jpg`, { create: true });
  const writable = await fh.createWritable();
  const resp = await fetch(dataUrl);
  await resp.body.pipeTo(writable);
}

export async function loadPageImage(fileId, pageNum) {
  if (!isDiskMode()) {
    const { loadPageImageFromOPFS } = await import('./opfsStorage');
    return await loadPageImageFromOPFS(fileId, pageNum);
  }
  await ensureDiskReady();
  try {
    const pagesDir = await getPagesDir(fileId);
    const fh = await pagesDir.getFileHandle(`p${pageNum}.jpg`);
    const file = await fh.getFile();
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

// ── 删除 ──

export async function deleteFileData(fileId) {
  if (!isDiskMode()) {
    const { deleteFileFromOPFS } = await import('./opfsStorage');
    await deleteFileFromOPFS(fileId);
    return;
  }
  await ensureDiskReady();
  try {
    const filesDir = await getFilesDir();
    await removeEntry(filesDir, fileId, true);
  } catch {}
}

// ── 存储用量统计 ──

async function dirSizeRecursive(dirHandle) {
  let size = 0;
  for await (const [, handle] of dirHandle.entries()) {
    if (handle.kind === 'file') {
      try { const file = await handle.getFile(); size += file.size; } catch {}
    } else if (handle.kind === 'directory') {
      size += await dirSizeRecursive(handle);
    }
  }
  return size;
}

export async function getStorageSize() {
  if (!isDiskMode()) {
    const { getOPFSStorageInfo } = await import('./opfsStorage');
    const info = await getOPFSStorageInfo();
    return { totalBytes: 0, quotaMB: info.quotaMB, usageMB: info.usageMB };
  }
  if (!_dirHandle) return { totalBytes: 0, totalMB: null, quotaMB: 'pending' };
  try {
    const filesDir = await getFilesDir();
    const totalBytes = await dirSizeRecursive(filesDir);
    return {
      totalBytes,
      totalMB: Math.round(totalBytes / 1024 / 1024 * 10) / 10,
      quotaMB: 'disk',
    };
  } catch {
    return { totalBytes: 0, totalMB: 0, quotaMB: 'error' };
  }
}

export async function listLocalFileIds() {
  if (!isDiskMode()) {
    const { listOPFSFileIds } = await import('./opfsStorage');
    return await listOPFSFileIds();
  }
  await ensureDiskReady();
  const ids = new Set();
  try {
    const filesDir = await getFilesDir();
    for await (const [name, handle] of filesDir.entries()) {
      if (handle.kind === 'directory') ids.add(name);
    }
  } catch {}
  return ids;
}
