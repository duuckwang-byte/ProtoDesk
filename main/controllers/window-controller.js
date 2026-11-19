'use strict';
/**
 * main/controllers/window-controller.js — WindowController（Wave-B）
 * 职责：独立文档窗口工厂 + docwin/mirror 5通道。窗口调度本质是 Electron 生命周期，
 * 故工厂与路由同置本层；主窗口 createWindow 保留在 main.js（启动骨架）。
 * 全部实现自 main.js 原文搬迁（共享态经 shared，preload 路径已修正为 ../../）。
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const shared = require('../state');

/* 主 HTML 绝对路径（打包后 cwd 不再是应用目录，相对 loadFile 会找不到文件导致白屏/错乱）
 * 双渲染器：默认 react；PLAND_RENDERER=legacy 或 ?renderer=legacy 强制回退；未知值回落 react
 * （与 main.js getRendererMode 同规则，不跨文件 import，保持 CommonJS） */
function getRendererMode() {
  try {
    var m = String((process && process.env && process.env.PLAND_RENDERER) || 'react').toLowerCase();
    if (m === 'legacy') return 'legacy';
    try { if (String((process.argv || []).join(' ')).indexOf('renderer=legacy') >= 0) return 'legacy'; } catch (e) {}
    return 'react';
  } catch (e) { return 'react'; }
}
function appHtmlPath(mode) {
  var m = mode || getRendererMode();
  if (String(m).toLowerCase() !== 'legacy') {
    try {
      var reactIndex = path.join(app.getAppPath(), 'dist/renderer/index.html');
      if (fs.existsSync(reactIndex)) return reactIndex;
      console.warn('[window-controller] dist/renderer/index.html 不存在，文档窗自动回退 legacy（先执行 npm run build:renderer）');
    } catch (e) {}
  }
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
 * 窗口域 5 通道契约 (docwin:open/close/toggle, doc:mirror-push/back).
 * 工厂 createDocWindow 与路由同置本层 (Electron 生命周期使然).
 * @typedef {Object} WinOpenOpts {project?:string, proto?:string}
 * @typedef {Object} WinResult {ok:boolean, mode?:string, error?:string, nop?:boolean}
 * @param {WinOpenOpts} [opts] 开窗选项 (project/proto 字符串, 缺省空)
 * @returns {WinResult} 开关窗结果 (mode: win/panel)
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

/* 镜像中继：msg 原样透传不解析 */
ipcMain.handle('doc:mirror-push', (ev, msg) => {
  try {
    var hasDoc = false;
    try { hasDoc = !!(shared.docWin && !shared.docWin.isDestroyed()); } catch (e) { hasDoc = false; }
    if (!hasDoc) return { ok: false, nop: true };
    try { if (hasDoc) shared.docWin.webContents.send('doc:mirror', msg); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
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
