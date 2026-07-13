/**
 * 数据持久化服务（混合模式）
 * 
 * 版权内容（正文/PDF二进制/页面图片）→ 存用户本地磁盘
 * 元数据 + 行为数据（name/size/进度/生词本/统计）→ 存服务端
 */

import { getToken } from './auth';
import {
  saveOriginalFile as localSaveOriginal,
  loadOriginalFile as localLoadOriginal,
  saveFileContent as localSaveContent,
  loadFileContent as localLoadContent,
  savePageImage as localSaveImage,
  loadPageImage as localLoadImage,
  deleteFileData as localDeleteFile,
  getStorageSize,
  getStoragePath,
  isDiskMode,
  supportsDiskStorage,
  requestStorageDirectory,
  restoreStorageDirectory,
  resetDiskMode,
  ensureDiskReady,
  listLocalFileIds,
} from './localStorage';
import { isOPFSSupported } from './opfsStorage';

const API_BASE = '/api';

function authHeaders(extra = {}) {
  const h = { ...extra };
  const t = getToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ════════════════════════════════════════════
// 服务端 API（元数据 + 行为数据）
// ════════════════════════════════════════════

/** 获取文件目录列表（仅元数据） */
export async function listFiles() {
  const res = await fetch(`${API_BASE}/files`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`获取文件列表失败: ${res.status}`);
  return res.json();
}

/** 同步文件元数据到服务端（不含 text/pages） */
async function syncFileMeta(id, meta) {
  // 剔除版权内容字段
  const { text: _t, pages: _p, ...metaOnly } = meta;
  const res = await fetch(`${API_BASE}/save`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id, data: metaOnly }),
  });
  if (!res.ok) throw new Error(`同步元数据失败: ${res.status}`);
  return res.json();
}

/** 从服务端加载文件元数据 */
export async function loadFileMeta(id) {
  const res = await fetch(`${API_BASE}/load?id=${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`加载元数据失败: ${res.status}`);
  return res.json();
}

// ════════════════════════════════════════════
// 混合操作（版权内容→本地，元数据→服务端）
// ════════════════════════════════════════════

/** 保存文件完整数据 */
export async function saveContent(id, data) {
  const { text, pages, originalFile, ...meta } = data;

  // 正文内容 → 本地磁盘
  if (text !== undefined || pages !== undefined) {
    await localSaveContent(id, { text: text || '', pages: pages || null });
  }

  // 原始文件 → 本地磁盘
  if (originalFile) {
    await localSaveOriginal(id, originalFile);
  }

  // 元数据 → 服务端
  await syncFileMeta(id, meta);
}

/** 加载文件完整数据（合并本地 + 服务端） */
export async function loadContent(id) {
  const [meta, local] = await Promise.allSettled([
    loadFileMeta(id),
    localLoadContent(id),
  ]);

  return {
    ...(meta.status === 'fulfilled' && meta.value ? meta.value : {}),
    text: local.status === 'fulfilled' && local.value ? local.value.text : null,
    pages: local.status === 'fulfilled' && local.value ? local.value.pages : null,
  };
}

// ════════════════════════════════════════════
// PDF / 文件操作（全部本地磁盘）
// ════════════════════════════════════════════

/** 保存 PDF 二进制（val 为 File 对象或 ArrayBuffer） */
export async function savePDFBuffer(id, val) {
  if (val instanceof File) {
    await localSaveOriginal(id, val);
  } else {
    const file = new File([val], `${id}.pdf`, { type: 'application/pdf' });
    await localSaveOriginal(id, file);
  }
}

/** 加载 PDF 二进制（返回 ArrayBuffer） */
export async function loadPDFBuffer(id) {
  const result = await localLoadOriginal(id);
  return result ? result.buffer : null;
}

/** 保存 PDF 页面渲染图片 */
export async function savePageImage(fileId, pageNum, dataUrl) {
  await localSaveImage(fileId, pageNum, dataUrl);
}

/** 加载 PDF 页面渲染图片（返回 dataUrl） */
export async function loadPageImage(fileId, pageNum) {
  return await localLoadImage(fileId, pageNum);
}

// ════════════════════════════════════════════
// 删除
// ════════════════════════════════════════════

/** 删除文件（本地磁盘 + 服务端） */
export async function deleteContent(id) {
  const res = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id }),
  });
  // 同时清理本地磁盘数据
  localDeleteFile(id).catch(() => {});
  return res.json();
}

// ════════════════════════════════════════════
// 存储管理
// ════════════════════════════════════════════

export {
  getStorageSize,
  getStoragePath,
  ensureDiskReady,
  isDiskMode,
  supportsDiskStorage,
  requestStorageDirectory,
  restoreStorageDirectory,
  resetDiskMode,
  listLocalFileIds,
  isOPFSSupported,
};
