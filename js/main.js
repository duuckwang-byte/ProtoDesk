/** [js/main.js] Wave-C/F: 渲染层 ESM 入口 (与主进程 main.js 同名但分属渲染层 js/ 目录)
 * 注意: 本文件为浏览器 ESM (type="module"), 并非 Electron 主进程入口 (根 main.js)。
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} BootState {time:number, esm:boolean, exportBoot:boolean, fileProtocol:boolean}
 * @typedef {string} SandboxCheck 'ok'|'enforced'|'no-frame'|'error' (iframe sandbox 属性复核)
 * @param {void} 无入参 (boot 自执行; enforceSandboxAttr/warmStore/bindSaveBlockedToast 均无参)
 * @returns {Object} boot() 返回 {skipped,sandbox,agentLen} (exportBoot 下 skip)
 * 职责:
 *  - 显式依赖编排: import utils/store/event-bus/sandbox-agent (依赖图见本次交付文档)
 *  - 启动诊断: ESM 可用性探测 + file:// 降级提示 + __EXPORT_BOOT__ 单文件短路
 *  - 安全复核: iframe sandbox 属性强制 (allow-scripts allow-forms, 无 allow-same-origin)
 *  - Store/EventBus 预热: 从 window 收编经典全局, 订阅保存阻断提示
 * file:// + srcdoc 降级 (审计 Phase 2 要求):
 *  - Electron (app:// / file:// + allow-scripts): ESM 相对 import 正常, 本入口全量接管。
 *  - 导出单文件 (file:// 双击): 内联脚本经 stripEsmForExport 转经典, 无 module/import,
 *    本入口不执行 (由 __EXPORT_BOOT__ 短路), 经典内联脚本直接驱动 (零 CORS, 零模块)。
 *  - srcdoc iframe: 帧侧仅注入 sandbox-agent 模板字符串, 不使用模块 (见 sandbox-core)。
 */
import { Utils } from './utils.js';
import { Store } from './store.js';
import { bus, EVENTS } from './event-bus.js';
import { sandboxAgentSource } from './sandbox-agent.js';

const BOOT = {
  time: Date.now(),
  esm: true,
  exportBoot: false,
  fileProtocol: false,
};

try { BOOT.exportBoot = (typeof window !== 'undefined' && window.__EXPORT_BOOT__ === true); } catch (e) {}
try { BOOT.fileProtocol = (typeof location !== 'undefined' && String(location.protocol || '') === 'file:'); } catch (e) {}

function enforceSandboxAttr() {
  try {
    const frame = (typeof document !== 'undefined') ? document.getElementById('frame') : null;
    if (!frame || !frame.setAttribute) return 'no-frame';
    let cur = '';
    try { cur = String(frame.getAttribute('sandbox') || ''); } catch (e) {}
    if (cur.indexOf('allow-scripts') < 0 || cur.indexOf('allow-same-origin') >= 0) {
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      return 'enforced';
    }
    return 'ok';
  } catch (e) { return 'error'; }
}

function warmStore() {
  try { if (Store && typeof Store.syncFromWindow === 'function') Store.syncFromWindow(); } catch (e) {}
  try { if (Store && typeof Store.syncWindow === 'function') Store.syncWindow(); } catch (e) {}
  return true;
}

function bindSaveBlockedToast() {
  try {
    bus.on(EVENTS.DOC_SAVE_BLOCKED, (info) => {
      const reason = (info && info.reason) || '';
      let msg = '保存已阻断: 已切换原型, 请重新保存。';
      if (reason === 'stale-version') msg = '保存已阻断: 当前原型版本已变更 (并发保存), 请重新保存。';
      try {
        if (typeof window !== 'undefined' && window.Store) { /* Store 已回写, 无需额外处理 */ }
        if (Utils && typeof Utils.showToast === 'function') Utils.showToast(msg);
        else if (typeof window !== 'undefined' && window.Utils && window.Utils.showToast) window.Utils.showToast(msg);
        else if (typeof showToast === 'function') showToast(msg);
      } catch (e) {}
    });
  } catch (e) {}
}

function boot() {
  // 导出单文件: 经典内联脚本已接管, ESM 入口主动让路 (避免双重初始化)
  if (BOOT.exportBoot) {
    try { console.info('[esm-entry] export boot, skip (classic inline owns the page)'); } catch (e) {}
    return { skipped: true, reason: 'export-boot' };
  }
  const sandboxState = enforceSandboxAttr();
  warmStore();
  bindSaveBlockedToast();
  // 自检: 代理模板可达 (长度门槛, 与 sandbox-core 内嵌副本同构校验见测试外验证脚本)
  let agentLen = 0;
  try { agentLen = String(sandboxAgentSource() || '').length; } catch (e) {}
  try {
    if (typeof window !== 'undefined') {
      window.__ESM_BOOT__ = { time: BOOT.time, sandbox: sandboxState, agentLen, fileProtocol: BOOT.fileProtocol };
    }
  } catch (e) {}
  try { console.info('[esm-entry] boot ok', JSON.stringify({ sandbox: sandboxState, agentLen, file: BOOT.fileProtocol })); } catch (e) {}
  return { skipped: false, sandbox: sandboxState, agentLen };
}

try { boot(); } catch (e) { try { console.error('[esm-entry] boot failed', e); } catch (e2) {} }

export { BOOT, boot, enforceSandboxAttr };
export default BOOT;
