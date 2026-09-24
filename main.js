'use strict';
/**
 * main.js — 主进程启动骨架（Wave-B 解耦后 <150 行）
 * 仅保留：应用生命周期、主窗口工厂、安全协议注册、控制器装配、存储初始化与凭据迁移。
 * 业务实现已下沉：
 *   controllers/ GitController/SandboxController/AIController/DocController/WindowController（薄层路由）
 *   services/ GitWorkflowService/SandboxStorageService/AIProcessService/DocExportService/AIConfigStore
 * IPC 通道名与出入参契约保持 72 通道不变（见 docs/IPC-CONTRACT-WaveB.md）。
 */
const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');

/* 开发隔离：未打包时 userData 重定向到 .devdata（须在 paths/services 加载前执行） */
if (!app.isPackaged) {
  try { app.setPath('userData', path.join(__dirname, '.devdata')); } catch (e) {}
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
const { registerGitController } = require('./main/controllers/git-controller');
const { registerSandboxController } = require('./main/controllers/sandbox-controller');
const { registerAIController } = require('./main/controllers/ai-controller');
const { registerDocController } = require('./main/controllers/doc-controller');
require('./main/controllers/window-controller');

/* 软件包所在目录：文件选择对话框默认目录 */
const pkgDir = path.dirname(app.getPath('exe'));

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
  /* 主窗口关闭联带独立文档窗口与AI窗口 */
  win.on('close', () => {
    try { if (shared.docWin && !shared.docWin.isDestroyed()) shared.docWin.close(); } catch (e) {}
    try { if (shared.aiWin && !shared.aiWin.isDestroyed()) shared.aiWin.close(); } catch (e) {}
  });
  win.on('closed', () => { try { if (shared.mainWin === win) shared.mainWin = null; } catch (e) {} });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.loadFile(path.join(app.getAppPath(), '原型+文档.html'));
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
