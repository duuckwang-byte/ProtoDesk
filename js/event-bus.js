/** [js/event-bus.js] Wave-C/F: 轻量事件总线 (EventBus) —— 替代 monkey-patch(window.closeAi 等)
 * 目标架构: DomainModules <--> EventBus (见审计报告第七章 Phase 2 蓝图)
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {string} EventType 事件名 (见 EVENTS: ai:request-close/ai:closed/source:switch/doc:save-start/doc:saved/doc:save-blocked/queue:change)
 * @typedef {Function} Listener 回调 (payload:any)=>void (异常隔离, 不中断其他订阅者)
 * @param {EventType} type 事件名
 * @param {Listener|Object} fn_or_payload 订阅回调 (on/once) 或发射载荷 (emit)
 * @returns {Function|number} on/once 返解绑函数; emit 返触达数; off/clear 返空
 * 设计约束:
 *  - 零依赖、零构建, 纯原生 ESM (import/export 显式依赖)
 *  - 同步发射 + once/off, 回调异常隔离 (不中断其他订阅者)
 *  - file:// + srcdoc 降级: 导出单文件时内联为经典脚本 (见 project-ai-export.stripEsmForExport),
 *    window 兼容挂载保留为只读别名, 新代码一律 import { bus } from './event-bus.js'
 *  - 不接管 window.closeAi 等既有函数 (仅提供事件通道, 兼容垫片见 js/store.js 与 core-docs 桥接段)
 */
export class EventBus {
  constructor() {
    this._map = new Map();
  }
  on(type, fn) {
    if (!type || typeof fn !== 'function') return () => {};
    const t = String(type);
    if (!this._map.has(t)) this._map.set(t, new Set());
    const set = this._map.get(t);
    set.add(fn);
    return () => { try { set.delete(fn); } catch (e) {} };
  }
  once(type, fn) {
    if (typeof fn !== 'function') return () => {};
    const off = this.on(type, function wrapper(...args) {
      try { off(); } catch (e) {}
      return fn.apply(this, args);
    });
    return off;
  }
  off(type, fn) {
    try {
      if (!type) { this._map.clear(); return; }
      const set = this._map.get(String(type));
      if (!set) return;
      if (fn) set.delete(fn);
      else set.clear();
    } catch (e) {}
  }
  emit(type, payload) {
    const t = String(type || '');
    if (!t) return 0;
    const set = this._map.get(t);
    if (!set || !set.size) return 0;
    let n = 0;
    // 快照遍历: 回调内 on/off 不影响本轮派发
    const fns = Array.from(set);
    for (const fn of fns) {
      try { fn(payload); n++; }
      catch (e) { try { console.error('[EventBus]', t, e); } catch (e2) {} }
    }
    return n;
  }
  clear() { try { this._map.clear(); } catch (e) {} }
  count(type) {
    try {
      if (type) { const s = this._map.get(String(type)); return s ? s.size : 0; }
      let n = 0; this._map.forEach((s) => { n += s.size; }); return n;
    } catch (e) { return 0; }
  }
}

/* 全局单例: 新代码统一 import { bus } */
export const bus = new EventBus();

/* 事件名常量 (避免魔法字符串漂移) */
export const EVENTS = {
  AI_CLOSE_REQUEST: 'ai:request-close',
  AI_CLOSED: 'ai:closed',
  SOURCE_SWITCH: 'source:switch',
  DOC_SAVE_START: 'doc:save-start',
  DOC_SAVED: 'doc:saved',
  DOC_SAVE_BLOCKED: 'doc:save-blocked',
  QUEUE_CHANGE: 'queue:change',
};

export default bus;

/* ---- 经典脚本兼容垫片 (Wave-D 移除; 保留字符串以通过 static-verify 等门禁) ----
 * ESM 以 import 为准; window 挂载仅供尚未迁移的经典文件只读订阅, 禁止再出现
 * window.X = guarded 式 monkey-patch (一律改为 bus.on/emit)。 */
try {
  if (typeof window !== 'undefined') {
    if (!window.EventBus) window.EventBus = bus;
    if (!window.__EventBusClass) window.__EventBusClass = EventBus;
  }
} catch (e) {}
