/* ═══════════════════════════════════════════════════════════════════
   PlanB 图标系统（Lucide / Feather 规范）：1.5px 线性、单色 currentColor
   零依赖：内置常用图标 path，`PlanBIcon(name,size)` 返回内联 SVG 字符串；
   `data-ic` 占位自动替换（HTML 静态处使用 <i data-ic="folder"></i>）。
   与主程序同包分发：导出 HTML 时随 EXPORT_SCRIPT_FILES 内嵌（保持查看器可用）。
   Wave-C/F: 转标准 ESM (export) + 经典兼容垫片 (window 挂载保留供门禁与经典文件只读)。
   ═══════════════════════════════════════════════════════════════════ */
const ICON_PATHS = {
  'menu':        '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
  'folder':      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'link':        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'pen':         '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'settings':    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'cpu':         '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M2 9h2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M20 15h2"/>',
  'sliders':     '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  'info':        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'globe':       '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'eye':         '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':     '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>',
  'zap':         '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  'search':      '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'plus':        '<path d="M12 5v14"/><path d="M5 12h14"/>',
  'check':       '<path d="M20 6 9 17l-5-5"/>',
  'check-circle':'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'x':           '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'alert':       '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  'sparkles':    '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
  'message-square':'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'file-text':   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  'clock':       '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'copy':        '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'trash':       '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'terminal':    '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  'monitor':     '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  'smartphone':  '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'target':      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'refresh':     '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'download':    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'git-branch':  '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  'cloud':       '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'command':     '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  'panel-left':  '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
  'panel-right': '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>'
};
const _iconCache = {};
/* FIX: 经典<script>加载，禁用ESM export(浏览器会整文件罢工)，以window挂载为准 */
function PlanBIcon(name, size) {
  size = size || 16;
  const k = name + ':' + size;
  if (_iconCache[k]) return _iconCache[k];
  const d = ICON_PATHS[name];
  if (!d) return '';
  const s = '<svg class="ap-icon" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  _iconCache[k] = s;
  return s;
}
/* 替换容器内所有 data-ic 占位为实际 SVG（静态 HTML 用） */
/* FIX: 经典<script>加载，禁用ESM export */
function initPlanbIcons(root) {
  try {
    const scope = root || ((typeof document !== 'undefined') ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    const els = scope.querySelectorAll('[data-ic]');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const name = el.getAttribute('data-ic');
      const size = parseInt(el.getAttribute('data-ic-size') || '16', 10) || 16;
      if (name && ICON_PATHS[name]) { el.innerHTML = PlanBIcon(name, size); }
      else { el.innerHTML = ''; }
    }
  } catch (e) {}
}
/* FIX: 经典<script>加载，移除 export default(以window.PlanBIcon为准) */

/* ---- 经典兼容垫片 (Wave-D 移除; 保留 window.PlanBIcon / initPlanbIcons 字符串供门禁) ---- */
try {
  if (typeof window !== 'undefined') {
    window.PlanBIcon = window.PlanBIcon || PlanBIcon;
    window.initPlanbIcons = window.initPlanbIcons || initPlanbIcons;
  }
} catch (e) {}
// icon align fix: 全局图标容器已在 app.css 统一为 inline-flex 基线对齐
try {
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { initPlanbIcons(document); });
    } else {
      initPlanbIcons(document);
    }
  }
} catch (e) {}
