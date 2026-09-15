'use strict';
/**
 * main/controllers/git-controller.js — GitController（Wave-B 薄层）
 * 职责：仅 IPC 参数校验 + 路由到 Service；业务实现见对应 services（原文搬迁，契约不变）。
 * Git 协同、自愈与并发锁。
 */
const { ipcMain } = require('electron');
const gitWorkflow = require('../services/git-workflow-service');

/**
 * 注册 Git 域 11 通道 (薄层路由, 实现下沉 GitWorkflowService).
 * 通道: git:config-get/save, list-branches, test-connection, status, push, fetch-diff, pull, is-busy, cancel, heal-repair.
 * @typedef {Object} GitChannelResult {ok, error?} (脱敏: config-get 永不返 token, 仅 hasToken + 掩码)
 * @param {string} channel 11 冻结通道之一
 * @param {*} payload 通道载荷 (project 名或选项对象, 由 Service 侧做类型清洗)
 * @returns {Promise<GitChannelResult>} Service 实现结果
 */
function registerGitController() {
  ipcMain.handle('git:config-get', (ev, projectName) => {
    return gitWorkflow.gitConfigGetImpl(ev, projectName);
  });
  ipcMain.handle('git:config-save', async (ev, o) => {
    return gitWorkflow.gitConfigSaveImpl(ev, o);
  });
  ipcMain.handle('git:list-branches', async (ev, o) => {
    return gitWorkflow.gitListBranchesImpl(ev, o);
  });
  ipcMain.handle('git:test-connection', async (ev, cfg) => {
    return gitWorkflow.gitTestConnectionImpl(ev, cfg);
  });
  ipcMain.handle('git:status', async (ev, o) => {
    return gitWorkflow.gitStatusImpl(ev, o);
  });
  ipcMain.handle('git:push', async (ev, o) => {
    return gitWorkflow.gitPushImpl(ev, o);
  });
  ipcMain.handle('git:fetch-diff', async (ev, o) => {
    return gitWorkflow.gitFetchDiffImpl(ev, o);
  });
  ipcMain.handle('git:pull', async (ev, o) => {
    return gitWorkflow.gitPullImpl(ev, o);
  });
  ipcMain.handle('git:is-busy', () => {
    return gitWorkflow.gitIsBusyImpl();
  });
  ipcMain.handle('git:cancel', async () => {
    return gitWorkflow.gitCancelImpl();
  });
  ipcMain.handle('git:heal-repair', async (ev, o) => {
    return gitWorkflow.gitHealRepairImpl(ev, o);
  });
}

module.exports = { registerGitController };
