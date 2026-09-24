'use strict';
// 本地 CLI 终端按钮（Git 旁）：HTML 按钮 + preload + ai:open-terminal 通道 + 主进程启动器
// 约定：只开独立控制台，不传用户文本进命令行（bin/cwd 均为程序解析值，防注入）。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const paeSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const preSrc = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
const ctlSrc = fs.readFileSync(path.join(rootDir, 'main', 'controllers', 'ai-controller.js'), 'utf8');
const svc = require(path.join(rootDir, 'main', 'services', 'ai-process-service.js'));

// ---- 1. 按钮在 Git 旁 ----
(function testButton() {
  assert.ok(html.includes('id="btnOpenCli"'), '缺 #btnOpenCli');
  assert.ok(html.indexOf('id="btnOpenCli"') > html.indexOf('id="gitDropdownWrap"'), '按钮须在 Git 下拉之后（Git 旁）');
  assert.ok(paeSrc.includes("var btnOpenCliEl = $('btnOpenCli')"), '缺渲染层接线');
  assert.ok(paeSrc.includes('openTerminal(dir)'), '须经 openTerminal 下发沙箱目录');
  assert.ok(paeSrc.includes('请先选择一个原型'), '无原型须提示');
  console.log('[PASS] 按钮与渲染接线');
})();

// ---- 2. 通道三件套 ----
(function testChannel() {
  assert.ok(preSrc.includes("openTerminal: (dir) => ipcRenderer.invoke('ai:open-terminal', dir)"), 'preload 须暴露 openTerminal');
  assert.ok(ctlSrc.includes("ipcMain.handle('ai:open-terminal'"), 'controller 须注册 ai:open-terminal');
  assert.ok(ctlSrc.includes('aiOpenTerminalImpl'), 'controller 须委托 aiOpenTerminalImpl');
  const contract = require(path.join(rootDir, 'main', 'ipc-contract.js'));
  assert.ok(contract.IPC_CHANNELS.includes('ai:open-terminal'), '冻结表须含 ai:open-terminal');
  assert.strictEqual(typeof svc.aiOpenTerminalImpl, 'function', '缺 aiOpenTerminalImpl');
  assert.strictEqual(typeof svc.buildTerminalLaunch, 'function', '缺 buildTerminalLaunch');
  console.log('[PASS] 通道三件套');
})();

// ---- 3. 启动组装（纯函数，win32） ----
(function testLaunch() {
  if (process.platform !== 'win32') { console.log('[SKIP] 非 win 跳过组装断言'); return; }
  const r = svc.buildTerminalLaunch('C:\\Tools\\agy\\agy.exe', 'C:\\sbx\\proj');
  assert.ok(r.ok, '正常须 ok');
  assert.strictEqual(r.command, 'cmd.exe', '须走 cmd');
  assert.strictEqual(r.windowsVerbatimArguments, true, '须 verbatim 投递（否则 Node 二次转义吃掉 start 标题）');
  const line = r.args[r.args.length - 1];
  assert.ok(/start\s/i.test(line), '须用 start 开独立窗口');
  assert.ok(line.includes('/D'), '须带 /D 工作目录');
  assert.ok(line.includes('C:\\sbx\\proj'), '须带工作目录');
  assert.ok(line.includes('agy.exe'), '须带可执行文件');
  const spaced = svc.buildTerminalLaunch('C:\\My Tools\\agy.exe', 'C:\\my sbx\\proj');
  assert.ok(spaced.ok, '含空格须 ok');
  const sline = spaced.args[spaced.args.length - 1];
  assert.ok(sline.includes('"C:\\my sbx\\proj"'), '含空格目录须引号包裹，实际' + sline);
  assert.ok(sline.includes('"C:\\My Tools\\agy.exe"'), '含空格可执行文件须引号包裹');
  const bad1 = svc.buildTerminalLaunch('', 'C:\\sbx');
  assert.ok(!bad1.ok, '空 bin 须拒绝');
  const bad2 = svc.buildTerminalLaunch('agy', '');
  assert.ok(!bad2.ok, '空目录须拒绝');
  const withArgs = svc.buildTerminalLaunch('agy', 'C:\\sbx', ['--foo', 'bar']);
  assert.ok(withArgs.ok && withArgs.args[withArgs.args.length - 1].includes('--foo'), '附加参数须透传');
  console.log('[PASS] 启动组装');
})();

// ---- 4. 每家独立启动命令表 ----
async function testTerminalTable() {
  assert.strictEqual(typeof svc.resolveTerminalTarget, 'function', '缺 resolveTerminalTarget');
  // 缺省：用解析到的 bin（agy 本机可解出）
  const reg = require(path.join(rootDir, 'runtimes', 'registry.js'));
  const agy = reg.getAgentDef('antigravity');
  const t1 = await svc.resolveTerminalTarget(agy, '');
  assert.ok(t1.ok && t1.bin && t1.display, 'agy 应解析出启动目标，实际' + JSON.stringify(t1).slice(0, 160));
  // 缺失：报错须列出试过的名字
  const ghost = { id: 'ghost-x', name: 'GhostX', bin: 'ghost-no-such-bin-xyz', fallbackBins: ['ghost-fb'] };
  const t2 = await svc.resolveTerminalTarget(ghost, '');
  assert.ok(!t2.ok && t2.error.includes('ghost-no-such-bin-xyz') && t2.error.includes('ghost-fb'), '报错须列出试过的名字，实际' + t2.error);
  assert.ok(t2.error.includes('设置'), '报错须指引去设置指定路径');
  // cmd 覆盖 + args
  const t3 = await svc.resolveTerminalTarget({ id: 'd', name: 'D', bin: 'agy', terminal: { cmd: ['agy', '--sand'], args: ['--x'] } }, '');
  assert.ok(t3.ok && t3.bin === 'agy' && t3.args.join(' ').includes('--sand') && t3.args.join(' ').includes('--x'), '覆盖+args 须合并');
  // unsupported（vibe 走 factory + manifest）
  const vibe = reg.getAgentDef('vibe');
  assert.ok(vibe && vibe.terminal && vibe.terminal.unsupported, 'vibe 须带 unsupported（manifest 透传）');
  const t4 = await svc.resolveTerminalTarget(vibe, '');
  assert.ok(!t4.ok && t4.error.includes('ACP'), 'vibe 须拒绝并说明原因');
  // 无 def 安全
  const t5 = await svc.resolveTerminalTarget(null, '');
  assert.ok(!t5.ok, '空 def 须拒绝');
  console.log('[PASS] 独立启动命令表');
}

testTerminalTable().then(() => {
  console.log('TERMINAL_PASS: 本地 CLI 终端按钮全绿');
}).catch((e) => {
  console.error('[FAIL] 独立启动命令表');
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
