/* [js/project-ai-export-compiler.js] Wave-D/G 导出编译器域（经典脚本）
 * 来源：js/project-ai-export.js 导出段（safeScript/stripEsm/guessImageMime/inlineMarkdownImages/filterKept/buildExportHtml）。
 * 职责：纯编译（数据 jobs + 模板组装），无 Git/AI 业务；经传入 ctx（chosen/api/helpers）通信，不直读裸全局。
 * 兼容：project-ai-export.js 保留 function buildExportHtml thin delegate + var EXPORT_SCRIPT_FILES（门禁语义不变）。
 */
var ExportCompiler = (function () {
  'use strict';
  function escAttrInner(s) {
    try { if (typeof _paeEscAttr === 'function') return _paeEscAttr(s); } catch (e) {}
    try { if (typeof window !== 'undefined' && window.Utils && window.Utils.escAttr) return window.Utils.escAttr(s); } catch (e2) {}
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeScript(t) { return String(t || '').split('</script').join('<\\/script'); }
  function stripEsmForExport(code) {
    try {
      var s = String(code || '');
      s = s.replace(/^[ \t]*import\s+[^;]*?;[ \t]*(?:\r?\n|$)/gm, '');
      s = s.replace(/^[ \t]*import\s*\(/gm, '/*esm-stripped:*/void(');
      s = s.replace(/^[ \t]*export\s+default\s+/gm, '');
      s = s.replace(/^[ \t]*export\s+\{\s*[^}]*\}\s*;?[ \t]*(?:\r?\n|$)/gm, '');
      s = s.replace(/^[ \t]*export\s+(?=function|const|let|var|class|async)/gm, '');
      return s;
    } catch (e) { try { return String(code || ''); } catch (e2) { return ''; } }
  }
  function guessImageMime(p) {
    var s = String(p || '').toLowerCase();
    if (/\.jpe?g$/.test(s)) return 'image/jpeg';
    if (/\.gif$/.test(s)) return 'image/gif';
    if (/\.svg$/.test(s)) return 'image/svg+xml';
    if (/\.webp$/.test(s)) return 'image/webp';
    if (/\.bmp$/.test(s)) return 'image/bmp';
    if (/\.ico$/.test(s)) return 'image/x-icon';
    return 'image/png';
  }
  function filterKept(links, chosen) {
    if (!links || !links.length) return [];
    var nameSet = {}, displayNameSet = {}, fileKeySet = {};
    (chosen || []).forEach(function (s) {
      if (!s) return;
      if (s.name) { nameSet[s.name] = 1; fileKeySet[s.name] = 1; try { var k = String(s.name).replace(/\.(html?)$/i, ''); if (k) fileKeySet[k] = 1; } catch (e) {} }
      if (s.displayName) { displayNameSet[s.displayName] = 1; fileKeySet[s.displayName] = 1; }
      if (s.fileKey) fileKeySet[s.fileKey] = 1;
      if (s.htmlFile) fileKeySet[s.htmlFile] = 1;
      if (s.mainHtmlFile) fileKeySet[s.mainHtmlFile] = 1;
    });
    return links.filter(function (l) {
      var t = (l && l.target) || '';
      return nameSet[t] || displayNameSet[t] || fileKeySet[t];
    }).map(function (l) {
      var c = {}; for (var k in l) { if (l.hasOwnProperty(k) && k[0] !== '_') c[k] = l[k]; } return c;
    });
  }
  function liteCss() {
    return '\n.export-lite{max-width:1200px;margin:0 auto;padding:16px;font-family:system-ui,sans-serif;}\n.export-lite-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}\n.export-lite-item{border:1px solid #ddd;border-radius:8px;padding:6px 12px;background:#fff;cursor:pointer;}\n.export-lite-item.on{border-color:#0052ff;color:#0052ff;}\n.export-lite-stage{display:flex;gap:16px;}\n.export-lite-frame{flex:1 1 auto;min-height:480px;border:1px solid #e5e7eb;border-radius:8px;}\n.export-lite-doc{flex:1 1 360px;max-width:480px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fff;}\n';
  }
  function liteBody(first) {
    return '<div class="export-lite"><h2>原型预览 · ' + escAttrInner(first.displayName) + '（只读导出）</h2>'
      + '<div class="export-lite-bar" id="exportLiteList"></div>'
      + '<div class="export-lite-stage"><iframe id="frame" class="export-lite-frame" src="about:blank" title="原型预览"></iframe>'
      + '<div class="export-lite-doc"><h3 id="exportLiteTitle"></h3><div id="exportLiteDoc"></div>'
      + '<div id="docContent" style="display:none"></div><div id="docTitle" style="display:none"></div><div id="sbList" style="display:none"></div></div></div></div>';
  }
  return {
    safeScript: safeScript,
    stripEsmForExport: stripEsmForExport,
    guessImageMime: guessImageMime,
    filterKept: filterKept,
    liteCss: liteCss,
    liteBody: liteBody
  };
})();
try { if (typeof window !== 'undefined' && !window.ExportCompiler) window.ExportCompiler = ExportCompiler; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = ExportCompiler; } catch (e) {}
