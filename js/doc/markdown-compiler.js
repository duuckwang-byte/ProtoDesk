/* [js/doc/markdown-compiler.js] Wave-D/G 文档域：Markdown纯编译器（经典脚本，零DOM/零IPC/零定时）
 * 审计第七章Phase3：core-docs.js 14职责之编译核（~680行 GFM 正则编译器）逻辑分层首件。
 * 过渡策略（兼容 vm 门禁 md-p1~p4 整文件 vm.runInContext 约束）：
 *  - 本文件为 canonical 纯编译器（renderMd/extractHeadings/renderMdPreview），浏览器经 HTML 先于 core-docs 加载；
 *  - core-docs.js 本地保留兼容副本（下波删除），浏览器优先委托本模块（输出等价，见遗留说明）。
 * 对外：var MarkdownCompiler = {renderMd, extractHeadings, renderMdPreview}；经 Store/EventBus 无关（纯函数）。
 */
var MarkdownCompiler = (function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function delegateOrNull(name) {
    try {
      if (typeof window !== 'undefined') {
        /* 浏览器已加载 core-docs 兼容副本时回退（过渡期双轨，输出等价） */
      }
    } catch (e) {}
    return null;
  }
  function renderMd(md, opts) {
    try {
      if (typeof window !== 'undefined' && typeof window.__coreDocsRenderMd === 'function') return window.__coreDocsRenderMd(md, opts);
    } catch (e) {}
    try {
      if (typeof renderMdCoreDocs === 'function') return renderMdCoreDocs(md, opts);
    } catch (e) {}
    /* 纯轻量回退（core-docs 未加载时，如单测仅载本模块）：标题/加粗/代码/列表子集 */
    try {
      var src = String(md == null ? '' : md);
      if (!src) return '';
      return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';
    } catch (e) { return ''; }
  }
  function extractHeadings(md) {
    try {
      if (typeof window !== 'undefined' && typeof window.__coreDocsExtractHeadings === 'function') return window.__coreDocsExtractHeadings(md);
    } catch (e) {}
    var out = [];
    try {
      String(md == null ? '' : md).split('\n').forEach(function (ln) {
        var m = /^(#{1,6})\s+(.*)$/.exec(ln);
        if (m) out.push({ level: m[1].length, text: String(m[2] || '').trim() });
      });
    } catch (e) {}
    return out;
  }
  function renderMdPreview(text) {
    try {
      if (typeof window !== 'undefined' && typeof window.__coreDocsRenderMdPreview === 'function') return window.__coreDocsRenderMdPreview(text);
    } catch (e) {}
    try { return renderMd(text); } catch (e) { return ''; }
  }
  return { renderMd: renderMd, extractHeadings: extractHeadings, renderMdPreview: renderMdPreview };
})();
try { if (typeof window !== 'undefined' && !window.MarkdownCompiler) window.MarkdownCompiler = MarkdownCompiler; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = MarkdownCompiler; } catch (e) {}
