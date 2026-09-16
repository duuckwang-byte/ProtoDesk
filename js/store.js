/** [js/store.js] Wave-C/F: 轻量响应式 Store —— 集中管理 currentProject/currentSource/EDIT_QUEUE
 * 对应审计报告第三章第3节 (全局状态散落与数据竞态) + 第七章 Phase 2 (统一响应式数据源 AppStore)
 *
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} SourceRef 原型源 {sandboxDir?:string, name?:string, displayName?:string, __ver?:number, md?:string}
 * @typedef {Object} DocSaveSnapshot {sourceId:string, ver:number, dir:string, file:string, content:string, ts:number}
 * @typedef {Object} GuardResult {ok:boolean, reason:string, snap?:DocSaveSnapshot}
 * @param {string|SourceRef|Object} payload 各 API 载荷 (setCurrentProject 收 string; setCurrentSource 收 SourceRef; enqueue 收队列项)
 * @returns {SourceRef|DocSaveSnapshot|GuardResult|number|Array} 各 API 返回 (切换返源对象; beginDocSave 返快照; guard 返 GuardResult; 队列类返长度/数组)
 *
 * 设计:
 *  - 零依赖原生 ESM; 单一真相源 + 订阅通知 + 版本快照守卫
 *  - 竞态修复: 保存时快照 { sourceId, ver }, 写回时 guardDocWrite 校验, 失配阻断 + bus.emit('doc:save-blocked')
 *  - 双轨兼容 (Wave-C): 模块初始化时从 window 全局收编 (syncFromWindow), 每次变更回写 window
 *    (syncWindow) 以保持 25 套门禁与经典文件可见性; 全量替换待 Wave-D (巨石拆分后删除 window 裸挂)
 *  - file:// + 导出单文件降级: 见 project-ai-export.stripEsmForExport (内联时剥离 import/export 转经典)
 */
import { bus, EVENTS } from './event-bus.js';

function sourceIdOf(src) {
  try {
    if (!src) return '';
    if (src.sandboxDir) return String(src.sandboxDir);
    if (src.name) return String(src.name);
    if (src.displayName) return String(src.displayName);
  } catch (e) {}
  return '';
}

function safeClone(o) {
  try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; }
}

// ---- 内部状态 (模块私有, 对外仅经 Store API) ----
let _project = '';
let _source = null;
let _sources = [];
let _queue = [];
const _subs = new Set();

function notify(kind, payload) {
  try {
    const snap = { kind: kind || '', project: _project, source: _source, queueLen: _queue.length };
    _subs.forEach((fn) => { try { fn(snap, payload); } catch (e) {} });
  } catch (e) {}
  try { bus.emit(EVENTS.QUEUE_CHANGE, { len: _queue.length }); } catch (e) {}
}

function bumpVer(src) {
  try {
    if (!src || typeof src !== 'object') return 0;
    const v = (Number(src.__ver) || 0) + 1;
    src.__ver = v;
    return v;
  } catch (e) { return 0; }
}

function syncWindow() {
  try {
    if (typeof window === 'undefined') return;
    // 回写兼容别名 (只读语义: 新代码以 Store 为准, 经典文件过渡期仍读 window)
    // P0 加固: 绝不用 Store 里的空值覆盖 window 里的真值 (仅 Store 有值或 window 无值时回写;
    // _queue 特例: [] 系合法清空必须同步, 仅 undefined/null 不覆盖)。
    try { if (_project || !window.currentProject) window.currentProject = _project; } catch (e) {}
    try { if (_source || !window.currentSource) window.currentSource = _source; } catch (e) {}
    try { if ((_sources && _sources.length) || !window.sources || !window.sources.length) window.sources = _sources; } catch (e) {}
    try { if (_queue !== undefined && _queue !== null) window.EDIT_QUEUE = _queue; else if (typeof window.EDIT_QUEUE === 'undefined') window.EDIT_QUEUE = _queue; } catch (e) {}
    try { window.Store = Store; } catch (e) {}
  } catch (e) {}
}

function syncFromWindow() {
  try {
    if (typeof window === 'undefined') return;
    // 仅在 Store 为空而 window 已有值时收编 (避免覆盖模块内已确立的状态)
    try { if (!_project && typeof window.currentProject === 'string' && window.currentProject) _project = window.currentProject; } catch (e) {}
    try { if (!_source && window.currentSource) _source = window.currentSource; } catch (e) {}
    try { if ((!_sources || !_sources.length) && Array.isArray(window.sources) && window.sources.length) _sources = window.sources; } catch (e) {}
    try {
      if ((!_queue || !_queue.length) && Array.isArray(window.EDIT_QUEUE) && window.EDIT_QUEUE.length) _queue = window.EDIT_QUEUE;
      else if ((!_queue || !_queue.length)) {
        try {
          const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('edit_queue_v1') : null;
          const arr = raw ? JSON.parse(raw) : null;
          if (Array.isArray(arr) && arr.length) _queue = arr;
        } catch (e2) {}
      }
    } catch (e) {}
  } catch (e) {}
}

function persistQueue() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('edit_queue_v1', JSON.stringify(_queue));
  } catch (e) {}
}

export const Store = {
  sourceIdOf,

  getState() {
    return { project: _project, source: _source, sources: _sources, queue: _queue };
  },
  get project() { return _project; },
  get source() { return _source; },
  get sources() { return _sources; },
  get queue() { return _queue; },

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _subs.add(fn);
    return () => { try { _subs.delete(fn); } catch (e) {} };
  },

  setCurrentProject(name) {
    _project = String(name || '');
    try { bumpVer(_source); } catch (e) {}
    syncWindow();
    notify('project', { project: _project });
    try { bus.emit(EVENTS.SOURCE_SWITCH, { project: _project, sourceId: sourceIdOf(_source) }); } catch (e) {}
    return _project;
  },

  setSources(arr) {
    if (Array.isArray(arr)) _sources = arr;
    syncWindow();
    notify('sources', { len: _sources.length });
    return _sources;
  },

  /* 切换原型: 版本+1 (使飞行中的旧保存快照失配), 发射 SOURCE_SWITCH, 回写 window */
  setCurrentSource(src) {
    _source = src || null;
    try { if (_source && typeof _source === 'object' && !(_source.__ver >= 0)) _source.__ver = 0; } catch (e) {}
    try { bumpVer(_source); } catch (e) {}
    syncWindow();
    notify('source', { sourceId: sourceIdOf(_source) });
    try { bus.emit(EVENTS.SOURCE_SWITCH, { sourceId: sourceIdOf(_source) }); } catch (e) {}
    return _source;
  },

  bumpSourceVersion(src) { return bumpVer(src || _source); },

  /* ---- 待提交队列 (EDIT_QUEUE 收编) ---- */
  getQueue() { return _queue; },
  enqueue(item) {
    if (item == null) return _queue.length;
    _queue.push(item);
    persistQueue();
    syncWindow();
    notify('queue', { op: 'enqueue', len: _queue.length });
    return _queue.length;
  },
  removeById(id) {
    const n0 = _queue.length;
    _queue = _queue.filter((it) => it && it.id !== id);
    if (_queue.length !== n0) { persistQueue(); syncWindow(); notify('queue', { op: 'remove', len: _queue.length }); }
    return _queue.length;
  },
  clearQueue() {
    _queue = [];
    persistQueue();
    syncWindow();
    notify('queue', { op: 'clear', len: 0 });
    return 0;
  },
  replaceQueue(arr) {
    _queue = Array.isArray(arr) ? arr : [];
    persistQueue();
    syncWindow();
    notify('queue', { op: 'replace', len: _queue.length });
    return _queue;
  },

  /* ---- 竞态守卫: 保存时快照, 写回时校验 ----
   * 用法 (core-docs.persistSandboxDoc / applyEditText):
   *   const snap = Store.beginDocSave({ dir, file, content });
   *   protoAPI.sandbox.write({ dir: snap.dir, file: snap.file, content: snap.content }).then(...)
   *   // then 内首行: const g = Store.guardDocWrite(snap); if (!g.ok) { toast阻断; return; }
   * 失配原因: 'switched' (已切到另一原型) / 'stale-version' (同原型但期间被再次切换/保存) */
  beginDocSave(extra) {
    const src = _source;
    const ex = (extra && typeof extra === 'object') ? extra : {};
    const snap = {
      sourceId: sourceIdOf(src),
      ver: Number((src && src.__ver) || 0),
      dir: String(ex.dir || (src && src.sandboxDir) || ''),
      file: String(ex.file || ''),
      content: String(ex.content != null ? ex.content : ((src && src.md) || '')),
      ts: Date.now(),
    };
    try { bus.emit(EVENTS.DOC_SAVE_START, { sourceId: snap.sourceId, ver: snap.ver, file: snap.file }); } catch (e) {}
    return snap;
  },

  guardDocWrite(snap) {
    try {
      if (!snap || typeof snap !== 'object') return { ok: false, reason: 'empty-snapshot' };
      const cur = _source;
      const curId = sourceIdOf(cur);
      if (!cur) return { ok: false, reason: 'no-current', snap };
      if (String(curId) !== String(snap.sourceId || '')) {
        const r = { ok: false, reason: 'switched', expect: snap.sourceId, actual: curId, snap };
        try { bus.emit(EVENTS.DOC_SAVE_BLOCKED, r); } catch (e) {}
        return r;
      }
      const curVer = Number((cur && cur.__ver) || 0);
      if (curVer !== Number(snap.ver || 0)) {
        const r2 = { ok: false, reason: 'stale-version', expectVer: snap.ver, actualVer: curVer, snap };
        try { bus.emit(EVENTS.DOC_SAVE_BLOCKED, r2); } catch (e) {}
        return r2;
      }
      return { ok: true, reason: '', snap };
    } catch (e) {
      return { ok: false, reason: 'guard-error' };
    }
  },

  markDocSaved(snap) {
    try { bumpVer(_source); } catch (e) {}
    syncWindow();
    notify('doc-saved', { sourceId: sourceIdOf(_source) });
    try { bus.emit(EVENTS.DOC_SAVED, { sourceId: sourceIdOf(_source) }); } catch (e) {}
  },

  syncWindow,
  syncFromWindow,
};

// 初始化收编 (经典文件先于模块执行, 此处把 window 已有值收归 Store)
try { syncFromWindow(); } catch (e) {}
try { syncWindow(); } catch (e) {}

// 最佳努力预加载 ESM 入口与帧侧模板 (file:// 下失败静默, 经典路径兜底; 不占 HTML <script> 配额)
try {
  if (typeof window !== 'undefined' && !window.__EXPORT_BOOT__) {
    try {
      const p = import('./main.js');
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
  }
} catch (e) {}

export default Store;

/* ---- 经典兼容垫片 (Wave-D 移除) ---- */
try {
  if (typeof window !== 'undefined' && !window.Store) window.Store = Store;
} catch (e) {}
