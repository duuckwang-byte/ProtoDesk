'use strict';
/**
 * main.js — 主进程启动骨架（Wave-B 解耦后 <150 行）
 * 仅保留：应用生命周期、主窗口工厂、安全协议注册、控制器装配、存储初始化与凭据迁移。
 * 业务实现已下沉：
 *   controllers/ GitController/SandboxController/AIController/DocController/WindowController（薄层路由）
 *   services/ GitWorkflowService/SandboxStorageService/AIProcessService/DocExportService/AIConfigStore
 * IPC 通道名与出入参契约保持 70 通道不变（见 main/ipc-contract.js）。
 */
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

/* 开发隔离：未打包时 userData 重定向到 .devdata（须在 paths/services 加载前执行）。
 * 并行真机测试可用 PLAND_DEV_DATA_DIR 指定独立目录（相对路径以本文件所在目录为基准），
 * 避免多实例共用 .devdata 造成项目/凭据/窗口状态串扰；打包态忽略该变量，行为不变。 */
if (!app.isPackaged) {
  var _devDataDir = path.join(__dirname, '.devdata');
  try {
    var _devDataEnv = String(process.env.PLAND_DEV_DATA_DIR || '').trim();
    if (_devDataEnv) _devDataDir = path.resolve(__dirname, _devDataEnv);
  } catch (e) {}
  try {
    app.setPath('userData', _devDataDir);
  } catch (e) {
    /* 自定义目录不可用时回退默认开发目录，避免启动失败 */
    try { app.setPath('userData', path.join(__dirname, '.devdata')); } catch (ee) {}
  }
}
/* 应用名固定，保证 userData 路径稳定（%APPDATA%/原型工具） */
app.setName('原型工具');

/* P1 MD重构：proto-asset 特权协议（standard+secure+supportFetchAPI+stream+corsEnabled） */
protocol.registerSchemesAsPrivileged([{
  scheme: 'proto-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

const shared = require('./main/state');
const sandboxStorage = require('./main/services/sandbox-storage-service');
const gitConfigStore = require('./git/config-store');
const aiConfigStore = require('./main/services/ai-config-store');
const { registerGitController, cleanupGitChildren, cleanupGitChildrenSync } = require('./main/controllers/git-controller');
const { registerSandboxController } = require('./main/controllers/sandbox-controller');
const { registerAIController } = require('./main/controllers/ai-controller');
const { registerDocController } = require('./main/controllers/doc-controller');
const { shutdownAiProcesses, shutdownAiProcessesSync } = require('./main/services/ai-process-service');
require('./main/controllers/window-controller');
const { attachDevToolsShortcut } = require('./main/controllers/window-controller');

/* 软件包所在目录：文件选择对话框默认目录 */
const pkgDir = path.dirname(app.getPath('exe'));

/* 双渲染器入口：默认 react；PLAND_RENDERER=legacy 或 ?renderer=legacy 强制回退；未知值回落 react
 * （与 window-controller 同规则，不跨文件 import，保持启动骨架零耦合） */
function getRendererMode() {
  try {
    var m = String(process.env.PLAND_RENDERER || 'react').toLowerCase();
    if (m === 'legacy') return 'legacy';
    try { if (String((process.argv || []).join(' ')).indexOf('renderer=legacy') >= 0) return 'legacy'; } catch (e) {}
    return 'react';
  } catch (e) { return 'react'; }
}
/* React 入口产物校验：缺失时自动回退 legacy，避免 file:// 白屏 */
function hasReactRenderer() {
  try { return fs.existsSync(path.join(app.getAppPath(), 'dist/renderer/index.html')); } catch (e) { return false; }
}

/* 主窗口工厂（唯一保留在骨架的窗口代码；doc/ai 窗口见 window-controller） */
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 1080,
    minWidth: 1024,
    minHeight: 680,
    title: '原型预览',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      webSecurity: true, // P0-1 fix
      allowFileAccessFromFiles: false, // P0-1 fix
      allowRunningInsecureContent: false, // P0-1 fix
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  shared.mainWin = win;
  /* 主窗口关闭联带独立文档窗口 */
  win.on('close', () => {
    try { if (shared.docWin && !shared.docWin.isDestroyed()) shared.docWin.close(); } catch (e) {}
  });
  win.on('closed', () => { try { if (shared.mainWin === win) shared.mainWin = null; } catch (e) {} });
  win.setMenuBarVisibility(false);
  try { attachDevToolsShortcut(win); } catch (e) {} /* F12/Ctrl+Shift+I 开关控制台 */
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  /* 深链 ?renderer=legacy 在 loadFile 前拦截（已并入 getRendererMode），强制走 legacy 文件，不走 Vite 路由 */
  var _rendererMode = getRendererMode();
  if (_rendererMode === 'react' && !hasReactRenderer()) {
    console.warn('[renderer] dist/renderer/index.html 不存在，自动回退 legacy（先执行 npm run build:renderer）');
    _rendererMode = 'legacy';
  }
  if (_rendererMode === 'react') {
    win.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  } else {
    win.loadFile(path.join(app.getAppPath(), '原型+文档.html'));
  }
}

/* IPC 薄层装配（通道名与契约不变，实现下沉 services） */
registerGitController();
registerSandboxController();
registerAIController();
registerDocController();

app.whenReady().then(() => {
  try { sandboxStorage.migrateLegacySandbox(); } catch (e) {} /* 旧版 exe 旁沙箱数据迁移 */
  try { sandboxStorage.ensureSandbox(); } catch (e) {}        /* 展开沙箱根 */
  try { sandboxStorage.normalizeProjects(); } catch (e) {}    /* 扁平目录 → 项目结构 */
  try { sandboxStorage.cleanOldLogs(); } catch (e) {}         /* 清理 7 天前日志 */
  /* P0/D 凭据迁移：旧明文先备份再迁入安全存储（失败不阻塞启动） */
  try { gitConfigStore.migratePlaintextTokensOnce().catch(() => {}); } catch (e) {}
  try { aiConfigStore.migratePlaintextOnce().catch(() => {}); } catch (e) {}
  /* P1 MD重构：proto-asset 本地文件流服务（只服务 SANDBOX_ROOT 内 assets 图片） */
  try { protocol.handle('proto-asset', sandboxStorage.handleProtoAsset); } catch (e) {}
  createWindow();
});

/* P2-1：子进程收尾三条兜底（window-all-closed / before-quit / process exit），
 * Git 与 AI 探测/ACP 统一走各自活跃集合，只杀本进程 spawn 的进程树，不碰无关进程。 */
app.on('window-all-closed', () => {
  try { cleanupGitChildrenSync(); } catch (e) {}
  try { shutdownAiProcessesSync({ sweep: false }); } catch (e) {}
  if (process.platform !== 'darwin') app.quit();
});

let quitCleanupStarted = false;
app.on('before-quit', (event) => {
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  try {
    event.preventDefault();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { app.quit(); } catch (e) {}
    };
    const timer = setTimeout(finish, 5000); /* 兜底：清理异常也不阻塞退出 */
    if (timer && typeof timer.unref === 'function') { try { timer.unref(); } catch (e) {} }
    Promise.allSettled([
      cleanupGitChildren(),
      shutdownAiProcesses({ reason: 'app-quit', timeoutMs: 2500 })
    ]).then(() => { clearTimeout(timer); finish(); }, () => { clearTimeout(timer); finish(); });
  } catch (e) {
    quitCleanupStarted = false;
  }
});

/* 最后一道兜底：无论走哪条退出路径，都同步强杀仍在登记的 AI 进程树。 */
app.on('will-quit', () => {
  try { shutdownAiProcessesSync(); } catch (e) {}
});

process.on('exit', () => {
  try { cleanupGitChildrenSync(); } catch (e) {}
  try { shutdownAiProcessesSync(); } catch (e) {}
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
