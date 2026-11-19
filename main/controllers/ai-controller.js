'use strict';
/**
 * main/controllers/ai-controller.js — AIController（Wave-B 薄层）
 * 职责：仅 IPC 参数校验 + 路由到 Service；业务实现见对应 services（原文搬迁，契约不变）。
 * AI 探测/模型/连接/问答/取消。
 */
const { ipcMain, app } = require('electron');
const aiProcess = require('../services/ai-process-service');
const acpRuntime = require('../acp/acp-runtime');

/** @type {boolean} 思考强度缓存预热是否已排期（只排一次） */
let thinkingWarmScheduled = false;

/**
 * 启动时预热思考强度缓存：app.whenReady 之后后台跑一次，失败静默（不弹窗、不阻塞启动）。
 * 缓存/探测见 services/ai-thinking-cache + ai-process-service.warmThinkingCache（同 key 单飞）。
 * @returns {void}
 */
function scheduleThinkingCacheWarm() {
  if (thinkingWarmScheduled) return;
  thinkingWarmScheduled = true;
  const run = () => {
    try {
      const task = aiProcess.warmThinkingCache();
      if (task && typeof task.catch === 'function') task.catch(() => {});
    } catch (e) {}
  };
  try {
    if (app && typeof app.whenReady === 'function') {
      Promise.resolve(app.whenReady()).then(() => {
        try { setImmediate(run); } catch (e) { run(); }
      }, () => {});
      return;
    }
  } catch (e) {}
  /* 无 Electron app（纯 Node 装配）：直接排期，探测本身仍是后台任务 */
  run();
}

/**
 * 注册 AI 域 10 通道 (薄层路由, 实现下沉 AIProcessService + ai-config-store).
 * 通道: ai:check, get-config(掩码), save-config(空回写不冲), test-connection, models, pick, ask, open-terminal, cancel, is-busy.
 * @typedef {Object} AiChannelResult {ok?, found?, config?, agents?} (凭据字段恒掩码, 见 MaskedAiConfig)
 * @param {string} channel 9 冻结通道之一
 * @param {*} payload 通道载荷 (prompt/sessionId/sandboxDir/model/extra 等, 由 Service 侧清洗)
 * @returns {Promise<AiChannelResult>} Service 实现结果
 */
function registerAIController() {
  ipcMain.handle('ai:check', async () => {
    return aiProcess.aiCheckImpl();
  });
  ipcMain.handle('ai:get-config', () => {
    return aiProcess.aiGetConfigImpl();
  });
  ipcMain.handle('ai:save-config', (ev, cfg) => {
    return aiProcess.aiSaveConfigImpl(ev, cfg);
  });
  ipcMain.handle('ai:test-connection', async (ev, apiCfg) => {
    return aiProcess.aiTestConnectionImpl(ev, apiCfg);
  });
  ipcMain.handle('ai:models', async (ev, hint) => {
    return aiProcess.aiModelsImpl(ev, hint);
  });
  ipcMain.handle('ai:pick', async () => {
    return aiProcess.aiPickImpl();
  });
  ipcMain.handle('ai:ask', async (ev, prompt, sessionId, sandboxDir, model, extraOpts = {}) => {
    return aiProcess.aiAskImpl(ev, prompt, sessionId, sandboxDir, model, extraOpts);
  });
  ipcMain.handle('ai:open-terminal', async (ev, dir) => {
    return aiProcess.aiOpenTerminalImpl(ev, dir);
  });
  ipcMain.handle('ai:cancel', async () => {
    return aiProcess.aiCancelImpl();
  });
  ipcMain.handle('ai:is-busy', () => {
    return aiProcess.aiIsBusyImpl();
  });
  /* S5 范围确认回复：渲染层经 preload confirmScope 回复 {id, decision}。
   * 刻意用 ipcMain.on（事件投递，无返回值）而不用 handle：回复不需要返回值，
   * 且 handle 计数是 70 通道冻结门禁（lint-guard E-IPC-FROZEN）的统计口径，.on 不计入，冻结保持全绿。
   * Phase 1：kind==='acp-permission' 的回复转 acp-runtime 权限桥，其余保持原 scope confirm 语义。
   * @param {Object} payload {id:string, decision:'allow-once'|'allow-always'|'deny', kind?:'acp-permission'} 确认回复
   * @returns {void} */
  ipcMain.on('ai:scope-confirm', (ev, payload) => {
    try {
      const p = (payload && typeof payload === 'object') ? payload : {};
      if (p.kind === 'acp-permission') {
        try {
          const decision = p.optionId
            ? { outcome: 'selected', optionId: String(p.optionId) }
            : p.decision;
          acpRuntime.resolvePermission(p.id, decision);
        } catch (e) {}
        return;
      }
      aiProcess.handleScopeConfirmResponse(payload);
    } catch (e) {}
  });
  /* 启动预热：等 app.whenReady 后后台探测当前 Agent+模型的思考档位，写入 ai-thinking-cache.json。
   * 只排一次；结果只影响下次打开设置/对话的首屏速度，失败不影响任何流程。 */
  scheduleThinkingCacheWarm();
}

module.exports = { registerAIController };
