/* [js/doc/toc-navigator.js] Wave-D/G 文档域：TOC导航器（经典脚本）
 * 职责：标题模型（buildTocModel 纯函数）+ Scrollspy 调度（debounce 经 Utils 只读）+ 目录开关。
 * 不碰：编译/编辑/镜像。经 EventBus 抛 toc:*（新代码），老 setDocsOpen/openToc 保留于 core-docs（过渡期）。
 */
var TocNavigator = (function () {
  'use strict';
  function buildTocModel(headings) {
    var arr = Array.isArray(headings) ? headings : [];
    return arr.map(function (h, ix) {
      return { idx: ix, level: Number((h && h.level) || 1), text: String((h && h.text) || '') };
    }).filter(function (it) { return it.text; });
  }
  function emit(type, payload) {
    try { if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.emit === 'function') window.EventBus.emit(type, payload); } catch (e) {}
  }
  function openToc() {
    try { if (typeof openTocCoreDocs === 'function') { openTocCoreDocs(); return true; } } catch (e) {}
    try { if (typeof window !== 'undefined' && typeof window.__coreDocsOpenToc === 'function') { window.__coreDocsOpenToc(); return true; } } catch (e2) {}
    try { emit('toc:open', {}); } catch (e3) {}
    return false;
  }
  function closeToc() {
    try { if (typeof closeTocCoreDocs === 'function') { closeTocCoreDocs(); return true; } } catch (e) {}
    try { emit('toc:close', {}); } catch (e2) {}
    return false;
  }
  return { buildTocModel: buildTocModel, openToc: openToc, closeToc: closeToc };
})();
try { if (typeof window !== 'undefined' && !window.TocNavigator) window.TocNavigator = TocNavigator; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = TocNavigator; } catch (e) {}
