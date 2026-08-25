/**
 * DOM 直操高亮 — 不依赖 React 渲染周期，100% 即时
 *
 * 用法：
 *   1. 渲染句子时给每个句子的包裹元素添加 `data-sentence-index="0,1,2,..."`
 *   2. 朗读回调中调用 `highlight(containerEl, index)` 高亮当前句
 *   3. 朗读结束时调用 `clearAll(containerEl)` 清除所有高亮
 */

const ACTIVE_CLASS = 'sentence-glow';
const SELECTED_CLASS = 'sentence-selected';

export function highlight(container, index) {
  if (!container) return;
  // 先清除上一条
  const prev = container.querySelector('.' + ACTIVE_CLASS);
  if (prev) prev.classList.remove(ACTIVE_CLASS);
  // 设置新条
  const target = container.querySelector(`[data-sentence-index="${index}"]`);
  if (target) target.classList.add(ACTIVE_CLASS);
}

export function clearAll(container) {
  if (!container) return;
  container.querySelectorAll('.' + ACTIVE_CLASS).forEach(el => el.classList.remove(ACTIVE_CLASS));
}

// 整句选择翻译：给整个句子容器加连续高亮（单词之间无间隙）
export function selectSentence(container, index) {
  if (!container) return;
  clearAll(container); // 清除朗读高亮，避免叠加
  const prev = container.querySelector('.' + SELECTED_CLASS);
  if (prev) prev.classList.remove(SELECTED_CLASS);
  const target = container.querySelector(`[data-sentence-index="${index}"]`);
  if (target) target.classList.add(SELECTED_CLASS);
}

export function clearSentenceSelection(container) {
  if (!container) return;
  container.querySelectorAll('.' + SELECTED_CLASS).forEach(el => el.classList.remove(SELECTED_CLASS));
}
