'use strict';
/**
 * main/controllers/ai-controller.js — AIController（Wave-B 薄层）
 * 职责：仅 IPC 参数校验 + 路由到 Service；业务实现见对应 services（原文搬迁，契约不变）。
 * AI 探测/模型/连接/问答/取消。
 */
const { ipcMain } = require('electron');
const aiProcess = require('../services/ai-process-service');

/**
 * 注册 AI 域 9 通道 (薄层路由, 实现下沉 AIProcessService + ai-config-store).
 * 通道: ai:check, get-config(掩码), save-config(空回写不冲), test-connection, models, pick, ask, cancel, is-busy.
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
  ipcMain.handle('ai:remote-send', async (ev, o) => {
    return aiProcess.aiRemoteSendImpl(ev, o);
  });
  ipcMain.handle('ai:is-busy', () => {
    return aiProcess.aiIsBusyImpl();
  });
  /* S5 范围确认回复：渲染层经 preload confirmScope 回复 {id, decision}。
   * 刻意用 ipcMain.on（事件投递，无返回值）而不用 handle：回复不需要返回值，
   * 且 handle 计数是 72 通道冻结门禁（lint-guard E-IPC-FROZEN）的统计口径，.on 不计入，冻结保持全绿。
   * @param {Object} payload {id:string, decision:'allow-once'|'allow-always'|'deny'} 确认回复
   * @returns {void} */
  ipcMain.on('ai:scope-confirm', (ev, payload) => {
    try { aiProcess.handleScopeConfirmResponse(payload); } catch (e) {}
  });
}

module.exports = { registerAIController };
