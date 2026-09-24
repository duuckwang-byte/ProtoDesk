'use strict';
/**
 * main/controllers/doc-controller.js — DocController（Wave-B 薄层）
 * 职责：仅 IPC 参数校验 + 路由；doc:list/read/write -> SandboxStorageService，export-* -> DocExportService。
 */
const { ipcMain } = require('electron');
const sandboxStorage = require('../services/sandbox-storage-service');
const docExport = require('../services/doc-export-service');

/**
 * 注册文档域 5 通道 (薄层路由).
 * doc:list/read/write -> SandboxStorageService; export-long-image/pdf -> DocExportService.
 * @typedef {Object} DocChannelResult {ok, error?, filePath?, cancelled?}
 * @param {string} channel 5 冻结通道之一 (doc:list, doc:read-latest, doc:write-latest, doc:export-long-image, doc:export-pdf)
 * @param {*} payload 通道载荷 (a/b/c 兼容位由 parseDocReadArgs/parseDocWriteArgs 清洗)
 * @returns {Promise<DocChannelResult>} Service 实现结果
 */
function registerDocController() {
  ipcMain.handle('doc:list', (ev, o) => {
    return sandboxStorage.docListImpl(ev, o);
  });
  ipcMain.handle('doc:read-latest', (ev, a, b) => {
    return sandboxStorage.docReadLatestImpl(ev, a, b);
  });
  ipcMain.handle('doc:write-latest', (ev, a, b, c) => {
    return sandboxStorage.docWriteLatestImpl(ev, a, b, c);
  });
  ipcMain.handle('doc:export-long-image', async (ev, o) => {
    return docExport.docExportLongImageImpl(ev, o);
  });
  ipcMain.handle('doc:export-pdf', async (ev, o) => {
    return docExport.docExportPdfImpl(ev, o);
  });
}

module.exports = { registerDocController };
