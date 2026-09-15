/** [js/utils.js] Wave-C/F: 标准 ESM 工具模块 (单一真相源)
 * 审计报告第六章第3节: esc/showToast/debounce/deepClone/pad2/copyToClipboard 全仓重复 10 余处, 收敛至此。
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {*} AnyValue 任意值 (esc系收 null 安全转空串)
 * @param {AnyValue} s 输入值 (esc/escHtml/escAttr 收任意转义; showToast 收消息; copyToClipboard 收文本)
 * @returns {string|Function|Object} esc系返转义串; debounce 返节流函数; deepClone 返克隆或 null; showToast 返节点或 null
 * 用法 (新代码): import { esc, escHtml, escAttr, showToast, debounce, deepClone, pad2, formatDate, copyToClipboard } from './utils.js';
 * 兼容: 经典文件过渡期经 window.Utils 只读使用 (Wave-B 挂载收敛为本文件唯一出口, 各文件重复兜底已删);
 *       导出单文件 (file://) 时经 stripEsmForExport 剥离 import/export 转经典内联 (见 project-ai-export.js)。
 */
export function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function escHtml(s) { return esc(s); }
export function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

let _toastBox = null;
function ensureBox() {
  if (_toastBox) return _toastBox;
  try { _toastBox = document.getElementById('toastBox'); } catch (e) { _toastBox = null; }
  if (_toastBox) return _toastBox;
  try {
    _toastBox = document.createElement('div'); _toastBox.id = 'toastBox';
    document.body.appendChild(_toastBox);
  } catch (e) { _toastBox = null; }
  return _toastBox;
}
export function showToast(msg) {
  try {
    const box = ensureBox();
    if (!box) { try { alert(String(msg == null ? '' : msg)); } catch (e2) {} return null; }
    const it = document.createElement('div'); it.className = 'toast-item'; it.textContent = String(msg == null ? '' : msg);
    box.appendChild(it);
    setTimeout(function () { try { it.classList.add('out'); } catch (e) {} }, 2600);
    setTimeout(function () { try { if (it.parentNode) it.parentNode.removeChild(it); } catch (e) {} }, 3050);
    return it;
  } catch (e) { return null; }
}
export function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    const self = this;
    if (t) clearTimeout(t);
    t = setTimeout(function () { t = null; try { fn.apply(self, args); } catch (e) {} }, wait || 100);
  };
}
export function deepClone(o) {
  try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; }
}
export function pad2(n) { try { return String(n).padStart(2, '0'); } catch (e) { n = Number(n) || 0; return (n < 10 ? '0' : '') + n; } }
export function formatDate(d) {
  try {
    const date = d || new Date();
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  } catch (e) { return ''; }
}
function fallbackCopy(s) {
  try {
    const ta = document.createElement('textarea');
    ta.value = String(s || '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    if (ta.parentNode) ta.parentNode.removeChild(ta);
  } catch (e) {}
}
export function copyToClipboard(text, okMsg) {
  const s = String(text == null ? '' : text);
  const done = function () { try { showToast(okMsg || '已复制'); } catch (e) {} };
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        const p = navigator.clipboard.writeText(s);
        if (p && typeof p.then === 'function') { p.then(done, function () { fallbackCopy(s); done(); }); return; }
      } catch (e) {}
    }
  } catch (e) {}
  fallbackCopy(s); done();
}

export const Utils = { esc, escHtml, escAttr, showToast, debounce, deepClone, pad2, formatDate, copyToClipboard };
export default Utils;

/* ---- 经典兼容唯一出口 (Wave-D 删除; 本文件为全仓唯一 window.Utils 写点) ----
 * 各文件重复的 window.Utils 兜底装配已删 (core-docs 等改为 import 或只读使用)。
 * ESM 以 export 为准; 此挂载仅供经典文件过渡期只读, 禁止再写 window.Utils 新键。 */
try {
  if (typeof window !== 'undefined') {
    window.Utils = window.Utils || Utils;
    for (const k of Object.keys(Utils)) { try { if (!window.Utils[k]) window.Utils[k] = Utils[k]; } catch (e) {} }
  }
} catch (e) {}
