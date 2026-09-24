/* [js/doc/mirror-sync.js] Wave-D/G 文档域：镜像同步 EventBus 桥（经典脚本，无 monkey-patch）
 * 职责：doc:mirror 收发经 EventBus（替代 window.closeAi / window.showProjectPicker 裸挂）。
 * 红线：本文件禁止出现 window.X = guarded 式 monkey-patch（一律 bus.on/emit）。
 * 兼容：core-docs.js 保留 mirrorPush/mirrorBack/handleDocMirror 实现（docwin 门禁除 C5 外仍验旧体）；
 *       本桥仅双发 EventBus（mirror:push/mirror:back），不接管旧函数。
 */
var MirrorSync = (function () {
  'use strict';
  function emit(type, payload) {
    try { if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.emit === 'function') return window.EventBus.emit(type, payload); } catch (e) {}
    try { if (typeof bus !== 'undefined' && bus && typeof bus.emit === 'function') return bus.emit(type, payload); } catch (e2) {}
    return 0;
  }
  function on(type, fn) {
    try { if (typeof window !== 'undefined' && window.EventBus && typeof window.EventBus.on === 'function') return window.EventBus.on(type, fn); } catch (e) {}
    try { if (typeof bus !== 'undefined' && bus && typeof bus.on === 'function') return bus.on(type, fn); } catch (e2) {}
    return function () {};
  }
  function notifyPush(kind, payload) { try { emit('mirror:push', { kind: String(kind || ''), payload: payload || null }); } catch (e) {} }
  function notifyBack(kind, payload) { try { emit('mirror:back', { kind: String(kind || ''), payload: payload || null }); } catch (e) {} }
  function requestAiClose(reason) { try { emit('ai:request-close', { reason: reason || 'mirror' }); } catch (e) {} }
  return { emit: emit, on: on, notifyPush: notifyPush, notifyBack: notifyBack, requestAiClose: requestAiClose };
})();
try { if (typeof window !== 'undefined' && !window.MirrorSync) window.MirrorSync = MirrorSync; } catch (e) {}
try { if (typeof module !== 'undefined' && module.exports) module.exports = MirrorSync; } catch (e) {}
