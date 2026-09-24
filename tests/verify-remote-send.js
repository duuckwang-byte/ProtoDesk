'use strict';
// 独立窗代发（ai:remote-send）：主窗待提交列表委托独立窗执行自己的 aiDoSend，
// 气泡与事件全落独立窗。无窗/空文本即回 false，调用方回落本地发送。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const paeSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const eeSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const preSrc = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
const ctlSrc = fs.readFileSync(path.join(rootDir, 'main', 'controllers', 'ai-controller.js'), 'utf8');
const svc = require(path.join(rootDir, 'main', 'services', 'ai-process-service.js'));

// ---- 1. 通道三件套 + 冻结 74 ----
(function testChannel() {
  assert.ok(preSrc.includes("remoteSend: (o) => ipcRenderer.invoke('ai:remote-send', o)"), 'preload 须暴露 remoteSend');
  assert.ok(ctlSrc.includes("ipcMain.handle('ai:remote-send'"), 'controller 须注册 ai:remote-send');
  assert.ok(ctlSrc.includes('aiRemoteSendImpl'), 'controller 须委托 aiRemoteSendImpl');
  const contract = require(path.join(rootDir, 'main', 'ipc-contract.js'));
  assert.ok(contract.IPC_CHANNELS.includes('ai:remote-send'), '冻结表须含 ai:remote-send');
  assert.strictEqual(contract.IPC_CHANNELS.length, 74, '冻结须 74');
  assert.strictEqual(typeof svc.aiRemoteSendImpl, 'function', '缺 aiRemoteSendImpl');
  console.log('[PASS] 通道三件套');
})();

// ---- 2. 服务端行为（无窗/空文本不抛错） ----
async function testService() {
  const r1 = await svc.aiRemoteSendImpl(null, { text: '  ' });
  assert.ok(!r1.ok && r1.error === 'empty', '空文本须回 empty');
  const r2 = await svc.aiRemoteSendImpl(null, { text: '改xx', display: '改xx' });
  assert.ok(!r2.ok && r2.error === 'no-window', '无独立窗须回 no-window（测试进程无 Electron 窗）');
  const r3 = await svc.aiRemoteSendImpl(null, null);
  assert.ok(!r3.ok, '空参数须安全');
  console.log('[PASS] 服务端行为');
}

// ---- 3. 渲染两侧接线 ----
(function testRender() {
  assert.ok(paeSrc.includes("ev.type==='remote-send'"), '独立窗须接 remote-send 事件分支');
  assert.ok(eeSrc.includes('__aiWinOpen') && eeSrc.includes('remoteSend({text:t, display:td})'), '提交流须按独立窗委托');
  assert.ok(eeSrc.includes('function editQueueRollback('), '失败回滚须抽取共用');
  console.log('[PASS] 渲染两侧接线');
})();

testService().then(() => {
  console.log('REMOTESEND_PASS: 独立窗代发全绿');
}).catch((e) => {
  console.error('[FAIL] 服务端行为');
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
