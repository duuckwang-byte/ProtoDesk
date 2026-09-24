'use strict';
/**
 * main/controllers/window-controller.js — WindowController（Wave-B）
 * 职责：独立文档/AI 窗口工厂 + docwin/aiwin/mirror 8通道。窗口调度本质是 Electron 生命周期，
 * 故工厂与路由同置本层；主窗口 createWindow 保留在 main.js（启动骨架）。
 * 全部实现自 main.js 原文搬迁（共享态经 shared，preload 路径已修正为 ../../）。
 */
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const shared = require('../state');
const paths = require('../paths');
const { killProcessTree } = require('../../platform/process');

/* 主 HTML 绝对路径（打包后 cwd 不再是应用目录，相对 loadFile 会找不到文件导致白屏/错乱） */
function appHtmlPath() {
  try { return path.join(app.getAppPath(), '原型+文档.html'); } catch (e) { return '原型+文档.html'; }
}

/* F12 / Ctrl+Shift+I 开关 DevTools（各窗口独立，detached 模式不挤布局；before-input-event 先于页面按键，不干扰拾取/Ctrl+F 等） */
function attachDevToolsShortcut(win) {
  try {
    if (!win || !win.webContents || typeof win.webContents.on !== 'function') return false;
    if (win.webContents.__devToolsShortcutBound) return true;
    win.webContents.__devToolsShortcutBound = true;
    win.webContents.on('before-input-event', function (event, input) {
      try {
        if (!input || input.type !== 'keyDown') return;
        var isF12 = (input.key === 'F12');
        var k = String(input.key || '').toLowerCase();
        var isToggle = !!((input.control || input.meta) && input.shift && k === 'i');
        if (!isF12 && !isToggle) return;
        try {
          if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
          else win.webContents.openDevTools({ mode: 'detach' });
        } catch (e) {}
      } catch (e) {}
    });
    return true;
  } catch (e) { return false; }
}

/**
 * 窗口域 8 通道契约 (docwin:open/close/toggle, aiwin:open/close/toggle, doc:mirror-push/back).
 * 工厂 createDocWindow/createAiWindow 与路由同置本层 (Electron 生命周期使然).
 * @typedef {Object} WinOpenOpts {project?:string, proto?:string}
 * @typedef {Object} WinResult {ok:boolean, mode?:string, error?:string, nop?:boolean}
 * @param {WinOpenOpts} [opts] 开窗选项 (project/proto 字符串, 缺省空)
 * @returns {WinResult} 开关窗结果 (mode: win/panel/ai-win/ai-panel)
 */

function createDocWindow(opts) {
  try {
    if (shared.docWin && !shared.docWin.isDestroyed()) { try { shared.docWin.focus(); } catch (e) {} return shared.docWin; }
  } catch (e) {}
  var _o = (opts && typeof opts === 'object') ? opts : {};
  var _project = _o.project != null ? String(_o.project) : '';
  var _proto = _o.proto != null ? String(_o.proto) : '';
  var _q = { docwin: '1' };
  if (_project) _q.project = encodeURIComponent(_project);
  if (_proto) _q.proto = encodeURIComponent(_proto);
  shared.docWin = new BrowserWindow({
    width: 520,
    height: 800,
    title: '文档-功能说明',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      webSecurity: true, // P0-1 fix
      allowFileAccessFromFiles: false, // P0-1 fix
      allowRunningInsecureContent: false, // P0-1 fix
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'preload.js')
    }
  });
  try { shared.docWin.setMenuBarVisibility(false); } catch (e) {}
  try { attachDevToolsShortcut(shared.docWin); } catch (e) {}
  shared.docWin.on('closed', () => {
    shared.docWin = null;
    try { if (shared.mainWin && !shared.mainWin.isDestroyed()) shared.mainWin.webContents.send('doc:mirror', { kind: 'mode', mode: 'panel' }); } catch (e) {}
  });
  try { shared.docWin.loadFile(appHtmlPath(), { query: _q }); } catch (e) {}
  try { shared.docWin.show(); } catch (e) {}
  try { shared.docWin.maximize(); } catch (e) {}
  return shared.docWin;
}
/* iter15: AI独立窗口复用docwin实现模式，变量aiWin独立，query aiwin=1 (+project/proto)，关闭经doc:mirror kind=ai-mode通知主窗（handleDocMirror忽略该kind故不冲突） */

function createAiWindow(opts) {
  try {
    if (shared.aiWin && !shared.aiWin.isDestroyed()) { try { shared.aiWin.focus(); } catch (e) {} return shared.aiWin; }
  } catch (e) {}
  var _o = (opts && typeof opts === 'object') ? opts : {};
  var _project = _o.project != null ? String(_o.project) : '';
  var _proto = _o.proto != null ? String(_o.proto) : '';
  var _q = { aiwin: '1' };
  if (_project) _q.project = encodeURIComponent(_project);
  if (_proto) _q.proto = encodeURIComponent(_proto);
  shared.aiWin = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'AI对话',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      webSecurity: true,
      allowFileAccessFromFiles: false,
      allowRunningInsecureContent: false,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'preload.js')
    }
  });
  try { shared.aiWin.setMenuBarVisibility(false); } catch (e) {}
  try { attachDevToolsShortcut(shared.aiWin); } catch (e) {}
  shared.aiWin.on('closed', () => {
    shared.aiWin = null;
    try { if (shared.mainWin && !shared.mainWin.isDestroyed()) shared.mainWin.webContents.send('doc:mirror', { kind: 'ai-mode', mode: 'ai-panel' }); } catch (e) {}
  });
  try { shared.aiWin.loadFile(appHtmlPath(), { query: _q }); } catch (e) {}
  try { shared.aiWin.show(); } catch (e) {}
  try { shared.aiWin.maximize(); } catch (e) {}
  /* iter25: 关窗任务守卫（纯色，无渐变）：任务在跑时弹窗确认，继续跑则归属转主窗口 */
  try {
    shared.aiWin.on('close', (e) => {
      try {
        if (shared.aiWinForceClose) { shared.aiWinForceClose = false; return; }
        if (shared.activeExecution) {
          try { e.preventDefault(); } catch (ee) {}
          var choice = 0;
          try {
            choice = dialog.showMessageBoxSync(shared.aiWin, {
              type: 'question', buttons: ['继续跑', '中断后关'], defaultId: 0, cancelId: 0,
              title: 'AI任务进行中',
              message: 'AI任务正在进行中，是否让任务在主窗口继续运行？',
              detail: '选择“继续跑”任务归属转主窗口并在主窗口恢复提示；选择“中断后关”将停止任务后关闭窗口。'
            });
          } catch (err) { choice = 0; }
          if (choice === 1) {
            try {
              if (shared.activeExecution) {
                try { if (typeof shared.activeExecution.cancel === 'function') shared.activeExecution.cancel().catch(function(){}); } catch (err) {}
                try { if (shared.activeExecution && shared.activeExecution.pid) killProcessTree(shared.activeExecution.pid).catch(function(){}); } catch (err) {}
              }
            } catch (err) {}
            try { shared.activeExecution = null; shared.aiTransferToMain = false; shared.aiEventTarget = null; } catch (err) {}
            try { shared.aiWinForceClose = true; shared.aiWin.close(); } catch (err) {}
          } else {
            try { shared.aiTransferToMain = true; } catch (err) {}
            try { if (shared.mainWin && !shared.mainWin.isDestroyed()) shared.mainWin.webContents.send('doc:mirror', { kind: 'ai-busy-restore', payload: { restored: true } }); } catch (err) {}
            try { shared.aiWinForceClose = true; shared.aiWin.close(); } catch (err) {}
          }
        }
      } catch (err) {}
    });
  } catch (e) {}
  return shared.aiWin;
}


ipcMain.handle('docwin:open', (ev, opts) => {
  try {
    createDocWindow(opts);
    try { if (shared.docWin && !shared.docWin.isDestroyed()) shared.docWin.focus(); } catch (e) {}
    return { ok: true, mode: 'win' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

ipcMain.handle('docwin:close', () => {
  try {
    try { if (shared.docWin && !shared.docWin.isDestroyed()) shared.docWin.close(); } catch (e) {}
    return { ok: true, mode: 'panel' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

ipcMain.handle('docwin:toggle', () => {
  try {
    /* iter25: 任务进行中拒绝切换 */
    try { if (shared.activeExecution) return { ok: false, error: 'busy' }; } catch (e) {}
    if (shared.docWin && !shared.docWin.isDestroyed()) {
      try { shared.docWin.close(); } catch (e) {}
      return { ok: true, mode: 'panel' };
    }
    createDocWindow();
    return { ok: true, mode: 'win' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

ipcMain.handle('aiwin:open', (ev, opts) => {
  try {
    createAiWindow(opts);
    try { if (shared.aiWin && !shared.aiWin.isDestroyed()) shared.aiWin.focus(); } catch (e) {}
    return { ok: true, mode: 'ai-win' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

ipcMain.handle('aiwin:close', () => {
  try {
    try { if (shared.aiWin && !shared.aiWin.isDestroyed()) shared.aiWin.close(); } catch (e) {}
    return { ok: true, mode: 'ai-panel' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

ipcMain.handle('aiwin:toggle', () => {
  try {
    /* iter25: 任务进行中拒绝切换 */
    try { if (shared.activeExecution) return { ok: false, error: 'busy' }; } catch (e) {}
    if (shared.aiWin && !shared.aiWin.isDestroyed()) {
      try { shared.aiWin.close(); } catch (e) {}
      return { ok: true, mode: 'ai-panel' };
    }
    createAiWindow();
    return { ok: true, mode: 'ai-win' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

/* 镜像中继：msg 原样透传不解析 */
ipcMain.handle('doc:mirror-push', (ev, msg) => {
  try {
    var hasDoc = false;
    try { hasDoc = !!(shared.docWin && !shared.docWin.isDestroyed()); } catch (e) { hasDoc = false; }
    var hasAi = false;
    try { hasAi = !!(shared.aiWin && !shared.aiWin.isDestroyed()); } catch (e) { hasAi = false; }
    if (!hasDoc && !hasAi) return { ok: false, nop: true };
    try { if (hasDoc) shared.docWin.webContents.send('doc:mirror', msg); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    try { if (hasAi) shared.aiWin.webContents.send('doc:mirror', msg); } catch (e) {}
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

ipcMain.handle('doc:mirror-back', (ev, msg) => {
  try {
    try { if (shared.mainWin && !shared.mainWin.isDestroyed()) shared.mainWin.webContents.send('doc:mirror', msg); } catch (e) {}
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }

});

function registerWindowController() {
  /* handlers self-register at require time (above); kept for symmetry with other controllers */
}

module.exports = { registerWindowController, attachDevToolsShortcut };
