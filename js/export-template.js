/* [js/export-template.js] Wave-D/G 导出轻量只读渲染器模板（经典脚本，零依赖，file://可直跑）
 * 目标：解除“开发脚本与导出脚本物理同构”包袱。导出单文件仅内联本模板 + icons + app.css + JSON数据，
 * 不再内联 core-docs/project-ai-export 等开发巨石（~500KB→~30KB）。
 * 兼容：仍由 buildExportHtml 注入 window.__EXPORT_BOOT__/__EXPORT_SOURCES__/__REQ_MAP__/__EXPORT_LINKS__/__ANNO_MAP__，
 * 老导出（含全量开发脚本）仍可打开；新导出仅依赖本模板只读渲染。
 * 只读：无 protoAPI 调用、无 Git/AI/编辑入口；原型切换 + 文档查看 + 跳转 + 标注展示。
 */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function escHtml(s) { return esc(s); }

  /* 极简只读 Markdown：标题/加粗/斜体/行内码/链接/列表/表格/任务，保持与 core-docs 视觉类名子集兼容 */
  function renderMdLite(md) {
    try {
      var src = String(md == null ? '' : md);
      if (!src) return '<p class="md-empty">（暂无文档）</p>';
      var lines = src.replace(/\r\n/g, '\n').split('\n');
      var html = '', inUl = false, inOl = false, inTable = false, inCode = false, codeBuf = [];
      function closeLists() {
        if (inUl) { html += '</ul>'; inUl = false; }
        if (inOl) { html += '</ol>'; inOl = false; }
        if (inTable) { html += '</tbody></table>'; inTable = false; }
      }
      function inline(s) {
        s = esc(s);
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
        return s;
      }
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (/^```/.test(ln)) {
          if (!inCode) { closeLists(); inCode = true; codeBuf = []; }
          else { inCode = false; html += '<pre class="md-code-wrap"><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; }
          continue;
        }
        if (inCode) { codeBuf.push(ln); continue; }
        var hm = /^(#{1,6})\s+(.*)$/.exec(ln);
        if (hm) { closeLists(); html += '<h' + hm[1].length + ' class="md-h">' + inline(hm[2]) + '</h' + hm[1].length + '>'; continue; }
        if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
          closeLists();
          var heads = ln.split('|').map(function (c) { return c.trim(); }).filter(function (c, ix, a) { return !(ix === 0 && c === '') && !(ix === a.length - 1 && c === ''); });
          html += '<div class="md-table-wrap"><table class="md-table"><thead><tr>' + heads.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
          inTable = true; i++; continue;
        }
        if (inTable && /^\s*\|.*\|\s*$/.test(ln)) {
          var cells = ln.split('|').map(function (c) { return c.trim(); }).filter(function (c, ix, a) { return !(ix === 0 && c === '') && !(ix === a.length - 1 && c === ''); });
          html += '<tr>' + cells.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; continue;
        }
        if (inTable) { html += '</tbody></table>'; inTable = false; }
        var tm = /^\s*-\s+\[([ xX])\]\s+(.*)$/.exec(ln);
        if (tm) { if (!inUl) { if (inOl) { html += '</ol>'; inOl = false; } html += '<ul class="md-task-list">'; inUl = true; } html += '<li><input type="checkbox" class="doc-task" disabled' + (tm[1].toLowerCase() === 'x' ? ' checked' : '') + '>' + inline(tm[2]) + '</li>'; continue; }
        var um = /^\s*[-*+]\s+(.*)$/.exec(ln);
        if (um) { if (!inUl) { if (inOl) { html += '</ol>'; inOl = false; } html += '<ul>'; inUl = true; } html += '<li>' + inline(um[1]) + '</li>'; continue; }
        var om = /^\s*\d+[.)]\s+(.*)$/.exec(ln);
        if (om) { if (!inOl) { if (inUl) { html += '</ul>'; inUl = false; } html += '<ol>'; inOl = true; } html += '<li>' + inline(om[1]) + '</li>'; continue; }
        if (/^\s*>/.test(ln)) { closeLists(); html += '<blockquote>' + inline(ln.replace(/^\s*>\s?/, '')) + '</blockquote>'; continue; }
        if (/^\s*$/.test(ln)) { closeLists(); continue; }
        closeLists(); html += '<p>' + inline(ln) + '</p>';
      }
      closeLists();
      if (inCode) html += '<pre class="md-code-wrap"><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
      return html;
    } catch (e) { try { return '<pre>' + escHtml(String(md || '')) + '</pre>'; } catch (e2) { return ''; } }
  }

  function getSources() {
    try {
      if (typeof window !== 'undefined' && Array.isArray(window.__EXPORT_SOURCES__)) return window.__EXPORT_SOURCES__;
      try { var raw = localStorage.getItem('protoLib_sources_v1'); var arr = raw ? JSON.parse(raw) : null; if (Array.isArray(arr)) return arr; } catch (e) {}
    } catch (e) {}
    return [];
  }
  function getReqMap() {
    try { if (typeof window !== 'undefined' && window.__REQ_MAP__ && typeof window.__REQ_MAP__ === 'object') return window.__REQ_MAP__; } catch (e) {}
    return {};
  }

  function currentDocOf(src, reqMap) {
    try {
      if (src && typeof src.md === 'string' && src.md) return src.md;
      if (src && src.docs && typeof src.docs === 'object') { var v = Object.values(src.docs); if (v.length) return String(v.join('\n\n')); }
      if (src && reqMap && reqMap[src.name]) return String(reqMap[src.name] || '');
    } catch (e) {}
    return '';
  }

  function boot() {
    try {
      if (typeof window === 'undefined' || window.__EXPORT_BOOT__ !== true) return { skipped: true };
      if (typeof document === 'undefined') return { skipped: true, reason: 'no-document' };
      var list = getSources();
      var reqMap = getReqMap();
      var listEl = document.getElementById('exportLiteList') || document.getElementById('sbList');
      var frame = document.getElementById('frame');
      var docEl = document.getElementById('docContent') || document.getElementById('exportLiteDoc');
      var titleEl = document.getElementById('docTitle') || document.getElementById('exportLiteTitle');
      function show(src) {
        try {
          var proto = (src && src.content) || '';
          if (frame) {
            try {
              if ('srcdoc' in frame) frame.srcdoc = String(proto || '');
              else frame.setAttribute('src', 'about:blank');
            } catch (e) {}
            try { frame.removeAttribute('srcdoc'); frame.setAttribute('src', 'about:blank'); } catch (e2) {}
            /* 标准只读注入：srcdoc 优先（模板页与原型同源但无特权桥，仅展示） */
            try { if ('srcdoc' in frame) frame.srcdoc = String(proto || ''); } catch (e3) {}
          }
          var md = currentDocOf(src, reqMap);
          if (docEl) docEl.innerHTML = renderMdLite(md);
          if (titleEl) titleEl.textContent = (src && (src.displayName || src.name)) || '';
          try {
            if (listEl) {
              var items = listEl.querySelectorAll('[data-export-name]');
              for (var i = 0; i < items.length; i++) {
                try { items[i].classList.toggle('on', items[i].getAttribute('data-export-name') === (src && src.name)); } catch (e) {}
              }
            }
          } catch (e) {}
        } catch (e) {}
      }
      try {
        if (listEl && !listEl.children.length && list.length) {
          list.forEach(function (s, ix) {
            try {
              var b = document.createElement('button');
              b.className = 'export-lite-item' + (ix === 0 ? ' on' : '');
              b.setAttribute('data-export-name', s.name);
              b.textContent = String(s.displayName || s.name || ('原型' + (ix + 1)));
              b.onclick = function () { show(s); };
              listEl.appendChild(b);
            } catch (e) {}
          });
        } else if (listEl && list.length) {
          try {
            var btns = listEl.querySelectorAll('button');
            for (var bi = 0; bi < btns.length && bi < list.length; bi++) {
              (function (btn, s) { try { btn.onclick = function () { show(s); }; } catch (e) {} })(btns[bi], list[bi]);
            }
          } catch (e) {}
        }
      } catch (e) {}
      if (list.length) show(list[0]);
      try { window.__EXPORT_RENDER__ = { show, renderMdLite, count: list.length }; } catch (e) {}
      return { skipped: false, count: list.length };
    } catch (e) { return { skipped: true, reason: 'error' }; }
  }

  try {
    if (typeof window !== 'undefined') {
      window.__exportRenderMdLite = renderMdLite;
      window.__EXPORT_RENDER_BOOT__ = boot;
    }
  } catch (e) {}
  try {
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();
      try { setTimeout(boot, 0); } catch (e) {}
    }
  } catch (e) {}

  /* ESM 兼容：stripEsmForExport 剥离后本行消失，经典下保留 */
  try { if (typeof module !== 'undefined' && module.exports) module.exports = { renderMdLite }; } catch (e) {}
})();
