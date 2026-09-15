/* [js/doc/editor-controller.js] Wave-D/G 文档域：Editor控制器（经典脚本，经 Store/EventBus）
 * 职责：文档编辑态 + Store竞态守卫（beginDocSave/guardDocWrite/markDocSaved）+ EventBus doc:save-*。
 * 不碰：GFM编译（markdown-compiler）、TOC（toc-navigator）、镜像（mirror-sync）。
 * 兼容：core-docs.js 保留编辑实现（过渡期），本模块为新代码唯一 Store 入口（经 window.Store 只读）。
 */
var EditorController = (function () {
  'use strict';
  function store() {
    try { if (typeof window !== 'undefined' && window.Store) return window.Store; } catch (e) {}
    try { if (typeof Store !== 'undefined' && Store) return Store; } catch (e) {}
    return null;
  }
  function emit(type, payload) {
    try { if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.emit === 'function') { window.EventBus.emit(type, payload); return; } } catch (e) {}
    try { if (typeof bus !== 'undefined' && bus && typeof bus.emit === 'function') bus.emit(type, payload); } catch (e2) {}
  }
  function validateDocContent(text) {
    var s = String(text == null ? '' : text);
    if (s.length > 500000) return { ok: false, code: 'TOO_LARGE', error: '文档超过500KB，拒绝保存。' };
    return { ok: true, code: '', content: s };
  }
  function beginSave(extra) {
    try {
      var st = store();
      if (st && typeof st.beginDocSave === 'function') return st.beginDocSave(extra);
    } catch (e) {}
    return { sourceId: '', ver: 0, dir: (extra && extra.dir) || '', file: (extra && extra.file) || '', content: (extra && extra.content) || '', ts: Date.now() };
  }
  function guardWrite(snap) {
    try {
      var st = store();
      if (st && typeof st.guardDocWrite === 'function') return st.guardDocWrite(snap);
    } catch (e) {}
    return { ok: true, reason: '', snap: snap };
  }
  function markSaved(snap) {
    try {
      var st = store();
      if (st && typeof st.markDocSaved === 'function') st.markDocSaved(snap);
    } catch (e) {}
    try { emit('doc:saved', { sourceId: (snap && snap.sourceId) || '' }); } catch (e2) {}
  }
  return { validateDocContent: validateDocContent, beginSave: beginSave, guardWrite: guardWrite, markSaved: markSaved };
})();
try { if (typeof window !== 'undefined' && !window.EditorController) window.EditorController = EditorController; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = EditorController; } catch (e) {}
