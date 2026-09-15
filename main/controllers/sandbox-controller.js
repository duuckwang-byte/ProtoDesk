'use strict';
/**
 * main/controllers/sandbox-controller.js — SandboxController（Wave-B 薄层）
 * 职责：仅 IPC 参数校验 + 路由到 Service；业务实现见对应 services（原文搬迁，契约不变）。
 * 沙箱/项目/规范库/组件库/绑定/快照/外链/标注/资产/文档读写。
 */
const { ipcMain } = require('electron');
const sandboxStorage = require('../services/sandbox-storage-service');

/**
 * 注册沙箱/项目/规范库/资产域 39 通道 (薄层路由, 实现下沉 SandboxStorageService).
 * 覆盖: log:write, app:get-version, sandbox:*(17), project:*(3), spec:*(7), uilib:*(3),
 *   project:*-binding(2), pick-text-file, snapshot:*(2), links:*(2), proto:annotations:*(2), sandbox:*-asset(4).
 * @typedef {Object} SandboxChannelResult {ok, error?, cancelled?}
 * @param {string} channel 39 冻结通道之一
 * @param {*} payload 通道载荷 (SandboxRef/DocSnapshot 等, 见 main/ipc-contract.js)
 * @returns {Promise<SandboxChannelResult>} Service 实现结果
 */
function registerSandboxController() {
  ipcMain.handle('log:write', (ev, level, tag, msg) => {
    return sandboxStorage.logWriteImpl(ev, level, tag, msg);
  });
  ipcMain.handle('app:get-version', () => {
    return sandboxStorage.appGetVersionImpl();
  });
  ipcMain.handle('sandbox:list', async (ev, projectName) => {
    return sandboxStorage.sandboxListImpl(ev, projectName);
  });
  ipcMain.handle('sandbox:write', (ev, o) => {
    return sandboxStorage.sandboxWriteImpl(ev, o);
  });
  ipcMain.handle('sandbox:read-file', async (ev, o) => {
    return sandboxStorage.sandboxReadFileImpl(ev, o);
  });
  ipcMain.handle('sandbox:create-subpage', async (ev, o) => {
    return sandboxStorage.sandboxCreateSubpageImpl(ev, o);
  });
  ipcMain.handle('sandbox:delete-subpage', async (ev, o) => {
    return sandboxStorage.sandboxDeleteSubpageImpl(ev, o);
  });
  ipcMain.handle('sandbox:rename-subpage', async (ev, o) => {
    return sandboxStorage.sandboxRenameSubpageImpl(ev, o);
  });
  ipcMain.handle('sandbox:create', (ev, o) => {
    return sandboxStorage.sandboxCreateImpl(ev, o);
  });
  ipcMain.handle('sandbox:adopt', (ev, o) => {
    return sandboxStorage.sandboxAdoptImpl(ev, o);
  });
  ipcMain.handle('sandbox:rename', (ev, o) => {
    return sandboxStorage.sandboxRenameImpl(ev, o);
  });
  ipcMain.handle('sandbox:remove', (ev, o) => {
    return sandboxStorage.sandboxRemoveImpl(ev, o);
  });
  ipcMain.handle('sandbox:projects', () => {
    return sandboxStorage.sandboxProjectsImpl();
  });
  ipcMain.handle('project:create', (ev, o) => {
    return sandboxStorage.projectCreateImpl(ev, o);
  });
  ipcMain.handle('project:rename', (ev, o) => {
    return sandboxStorage.projectRenameImpl(ev, o);
  });
  ipcMain.handle('project:remove', (ev, o) => {
    return sandboxStorage.projectRemoveImpl(ev, o);
  });
  ipcMain.handle('spec:list', () => {
    return sandboxStorage.specListImpl();
  });
  ipcMain.handle('spec:create-from-file', (ev, o) => {
    return sandboxStorage.specCreateFromFileImpl(ev, o);
  });
  ipcMain.handle('spec:create-from-text', (ev, o) => {
    return sandboxStorage.specCreateFromTextImpl(ev, o);
  });
  ipcMain.handle('spec:update', (ev, o) => {
    return sandboxStorage.specUpdateImpl(ev, o);
  });
  ipcMain.handle('spec:rename', (ev, o) => {
    return sandboxStorage.specRenameImpl(ev, o);
  });
  ipcMain.handle('spec:remove', (ev, o) => {
    return sandboxStorage.specRemoveImpl(ev, o);
  });
  ipcMain.handle('spec:read', (ev, o) => {
    return sandboxStorage.specReadImpl(ev, o);
  });
  ipcMain.handle('uilib:list', () => {
    return sandboxStorage.uilibListImpl();
  });
  ipcMain.handle('uilib:save', (ev, o) => {
    return sandboxStorage.uilibSaveImpl(ev, o);
  });
  ipcMain.handle('uilib:remove', (ev, o) => {
    return sandboxStorage.uilibRemoveImpl(ev, o);
  });
  ipcMain.handle('project:get-binding', (ev, o) => {
    return sandboxStorage.projectGetBindingImpl(ev, o);
  });
  ipcMain.handle('project:set-binding', (ev, o) => {
    return sandboxStorage.projectSetBindingImpl(ev, o);
  });
  ipcMain.handle('pick-text-file', async (event, opts) => {
    return sandboxStorage.pickTextFileImpl(event, opts);
  });
  ipcMain.handle('snapshot:list', (ev, dir) => {
    return sandboxStorage.snapshotListImpl(ev, dir);
  });
  ipcMain.handle('snapshot:restore', (ev, o) => {
    return sandboxStorage.snapshotRestoreImpl(ev, o);
  });
  ipcMain.handle('links:read', (ev, dir) => {
    return sandboxStorage.linksReadImpl(ev, dir);
  });
  ipcMain.handle('links:write', (ev, dir, data) => {
    return sandboxStorage.linksWriteImpl(ev, dir, data);
  });
  ipcMain.handle('proto:annotations:read', sandboxStorage.handleAnnoRead);
  ipcMain.handle('proto:annotations:save', sandboxStorage.handleAnnoSave);
  ipcMain.handle('sandbox:save-asset', async (ev, o) => {
    return sandboxStorage.sandboxSaveAssetImpl(ev, o);
  });
  ipcMain.handle('sandbox:read-asset-base64', async (ev, o) => {
    return sandboxStorage.sandboxReadAssetBase64Impl(ev, o);
  });
  ipcMain.handle('sandbox:list-assets', async (ev, o) => {
    return sandboxStorage.sandboxListAssetsImpl(ev, o);
  });
  ipcMain.handle('sandbox:delete-asset', async (ev, o) => {
    return sandboxStorage.sandboxDeleteAssetImpl(ev, o);
  });
}

module.exports = { registerSandboxController };
