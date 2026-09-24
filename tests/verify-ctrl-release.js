'use strict';
// Ctrl拾取释放链回归仿真（只读实现文件，不修改 js/*）
// 背景：帧侧 keydown/keyup 均直传上报（输入框可拾取）；宿主进入拾取受弹窗互斥门禁约束
// 覆盖：(a) INPUT内按下Ctrl→keydown上报 (b) INPUT内松开Ctrl→keyup必上报释放态
//       (c) 武装→点选→输入框内释放→宿主openPanel被触发 (d) 模板与内嵌副本两处逐行一致
//       (e) 任一弹窗打开时宿主/远端均不进入拾取态
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const agentPath = path.join(ROOT, 'js', 'sandbox-agent.js');
const corePath = path.join(ROOT, 'js', 'sandbox-core.js');
const eePath = path.join(ROOT, 'js', 'edit-entry.js');
const agentSrc = fs.readFileSync(agentPath, 'utf8');
const coreSrc = fs.readFileSync(corePath, 'utf8');
const eeSrc = fs.readFileSync(eePath, 'utf8');

console.log('=== Ctrl拾取释放链仿真 ===');
console.log('Node=' + process.version + ' root=' + ROOT);

// ---------- helpers ----------
function braceExtract(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  assert.ok(m, '[提取失败] function ' + name);
  let i = m.index + m[0].length; let depth = 1; let inS = null; let inL = false; let inB = false;
  for (; i < src.length; i++) {
    const c = src[i]; const n = src[i + 1];
    if (inL) { if (c === '\n') inL = false; continue; }
    if (inB) { if (c === '*' && n === '/') { inB = false; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inL = true; i++; continue; }
    if (c === '/' && n === '*') { inB = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(depth === 0, '[括号失衡] function ' + name);
  return src.slice(m.index, i + 1);
}
// 从帧模板源码行中提取 '  function xxx...' 单行代码（去掉首尾引号/逗号）
function extractFrameLine(fileSrc, substr) {
  const lines = String(fileSrc).split('\n');
  const hit = lines.filter((l) => l.indexOf(substr) >= 0);
  return hit;
}

// ---------- (d) 模板与内嵌副本 sendCtrlState / keyup 两处逐行一致 ----------
{
  const t1 = extractFrameLine(agentSrc, 'function sendCtrlState(ev,force)');
  const c1 = extractFrameLine(coreSrc, 'function sendCtrlState(ev,force)');
  assert.ok(t1.length >= 1, '模板须含 sendCtrlState(ev,force) 行');
  assert.ok(c1.length >= 1, '内嵌副本须含 sendCtrlState(ev,force) 行');
  const norm = (s) => String(s).trim();
  assert.strictEqual(norm(c1[0]), norm(t1[0]), 'sendCtrlState 行必须逐行一致');
  console.log('[PASS] (d1) sendCtrlState逐行一致 (' + norm(t1[0]).slice(0, 80) + '...)');

  const t2 = extractFrameLine(agentSrc, 'document.addEventListener("keyup"');
  const c2 = extractFrameLine(coreSrc, 'document.addEventListener("keyup"');
  assert.ok(t2.length >= 1 && c2.length >= 1, '双副本须各含 keyup 监听行');
  assert.strictEqual(norm(c2[0]), norm(t2[0]), 'keyup 监听行必须逐行一致');
  console.log('[PASS] (d2) keyup监听行逐行一致 (' + norm(t2[0]).slice(0, 100) + '...)');

  const t3 = extractFrameLine(agentSrc, 'document.addEventListener("keydown"');
  const c3 = extractFrameLine(coreSrc, 'document.addEventListener("keydown"');
  assert.strictEqual(norm(c3[0]), norm(t3[0]), 'keydown 监听行必须逐行一致');
  console.log('[PASS] (d3) keydown监听行逐行一致');

  // 语义门：keydown 带 force=true（输入框聚焦同样上报，方可拾取输入框/下拉框）；
  // keyup 保持 force=true。函数内 !force&&inFormFocus 守卫保留（直调无 force 仍抑制）。
  assert.ok(/sendCtrlState\(ev,\s*true\)/.test(t3[0]), 'keydown 须为 sendCtrlState(ev,true)');
  assert.ok(/sendCtrlState\(ev,\s*true\)/.test(t2[0]), 'keyup 必须为 sendCtrlState(ev,true)');
  console.log('[PASS] (d4) keydown/keyup 均 force 上报（表单聚焦可拾取）');

  // sendCtrlState 必须含 !force&&inFormFocus 守卫
  assert.ok(/if\(!force&&inFormFocus\(\)\)/.test(t1[0]), 'sendCtrlState 必须含 if(!force&&inFormFocus()) 守卫');
  console.log('[PASS] (d5) sendCtrlState含 !force&&inFormFocus 守卫');

  // 全量双副本一致（与 verify-ui-specs 同口径，防止丢行导致帧脚本全挂）
  const inlineCode = new Function('sandboxSafeScript', braceExtract(coreSrc, 'sandboxAgentSource') + '\nreturn sandboxAgentSource();')((s) => String(s || ''));
  const esmCode = new Function('sandboxSafeScript', braceExtract(agentSrc, 'sandboxAgentSource') + '\nreturn sandboxAgentSource();')((s) => String(s || ''));
  assert.strictEqual(inlineCode, esmCode, '帧模板双副本须逐字节一致');
  assert.doesNotThrow(() => new vm.Script(inlineCode), '内嵌帧模板须可解析');
  console.log('[PASS] (d6) 双副本sandboxAgentSource逐字节一致且可解析');
}

// ---------- 帧侧运行时仿真：从真实源码行求值出 inFormFocus/sendCtrlState ----------
function buildFrameRuntime(focusTag) {
  // 提取真实行并去引号，还原为可执行函数声明
  const rawInForm = extractFrameLine(agentSrc, 'function inFormFocus()')[0];
  const rawSend = extractFrameLine(agentSrc, 'function sendCtrlState(ev,force)')[0];
  const strip = (l) => {
    let s = String(l).trim();
    if (s.endsWith(',')) s = s.slice(0, -1);
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    return s.trim();
  };
  const codeInForm = strip(rawInForm);
  const codeSend = strip(rawSend);
  // 构造沙箱：document.activeElement / window.parent.postMessage / bytes / MAXB
  const posted = [];
  const fakeDocument = { activeElement: focusTag ? { tagName: focusTag, isContentEditable: false } : null };
  const fakeWindow = { parent: { postMessage: (mm, origin) => { posted.push({ mm, origin }); } } };
  const factory = new Function('document', 'window', 'bytes', 'MAXB', codeInForm + '\n' + codeSend + '\nreturn {inFormFocus:inFormFocus, sendCtrlState:sendCtrlState};');
  const bytes = (o) => { try { return String(JSON.stringify(o)).length; } catch (e) { return 99999999; } };
  const api = factory(fakeDocument, fakeWindow, bytes, 1048576);
  return { api, posted, fakeDocument, fakeWindow };
}

function mkKey(key, down) {
  if (key === 'Control') return { key: 'Control', ctrlKey: !!down, metaKey: false, shiftKey: false, altKey: false };
  if (key === 'Meta') return { key: 'Meta', ctrlKey: false, metaKey: !!down, shiftKey: false, altKey: false };
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
}

// ---------- (a) 焦点在INPUT内按下Ctrl → keydown 带 force 上报（方可拾取输入框） ----------
{
  const { api, posted } = buildFrameRuntime('INPUT');
  assert.strictEqual(api.inFormFocus(), true, 'INPUT 焦点下 inFormFocus 应为 true');
  api.sendCtrlState(mkKey('Control', true), true); // keydown 路径：模板现传 force=true
  assert.strictEqual(posted.length, 1, 'INPUT内 keydown 须上报（表单元素可拾取）');
  assert.strictEqual(posted[0].mm.type, 'CTRL_STATE', '上报类型须为 CTRL_STATE');
  console.log('[PASS] (a) INPUT内按下Ctrl→keydown上报（posted=1）');
  // 函数级守卫仍在：直调无 force 在表单焦点下抑制（防误报）
  const r0 = buildFrameRuntime('INPUT');
  r0.api.sendCtrlState(mkKey('Control', true));
  assert.strictEqual(r0.posted.length, 0, '无 force 直调在表单焦点下仍抑制');
  console.log('[PASS] (a-守卫) 无 force 直调仍抑制');
  // 反例：非表单焦点按下应上报（证明守卫仅拦表单）
  const r2 = buildFrameRuntime('DIV');
  r2.api.sendCtrlState(mkKey('Control', true));
  assert.strictEqual(r2.posted.length, 1, '非表单焦点 keydown 应上报');
  assert.strictEqual(r2.posted[0].mm.type, 'CTRL_STATE', '上报类型须为 CTRL_STATE');
  console.log('[PASS] (a-反例) DIV焦点按下Ctrl→上报CTRL_STATE');
  // 非修饰键永不上报（内容键安全）
  const r3 = buildFrameRuntime('DIV');
  r3.api.sendCtrlState({ key: 'a', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
  assert.strictEqual(r3.posted.length, 0, '内容键 a 不得上报');
  console.log('[PASS] (a-安全) 内容键不上报（仅Control/Meta/Shift）');
}

// ---------- (b) 焦点在INPUT内松开Ctrl → keyup必上报释放态 ----------
{
  const { api, posted } = buildFrameRuntime('INPUT');
  api.sendCtrlState(mkKey('Control', false), true); // keyup 路径：force=true
  assert.strictEqual(posted.length, 1, 'INPUT内 keyup 必须上报（force跳过守卫）');
  const mm = posted[0].mm;
  assert.strictEqual(mm.type, 'CTRL_STATE', '类型须为 CTRL_STATE');
  assert.strictEqual(mm.source, 'frame', '来源须为 frame');
  assert.strictEqual(mm.payload.ctrlKey, false, '释放态 ctrlKey 须为 false');
  assert.strictEqual(mm.payload.metaKey, false, '释放态 metaKey 须为 false');
  assert.strictEqual(mm.payload.key, 'Control', '释放键须为 Control');
  console.log('[PASS] (b) INPUT内松开Ctrl→keyup必上报释放态 ' + JSON.stringify(mm.payload));
  // TEXTAREA / contentEditable 同理
  for (const tag of ['TEXTAREA', 'SELECT']) {
    const r = buildFrameRuntime(tag);
    r.api.sendCtrlState(mkKey('Control', false), true);
    assert.strictEqual(r.posted.length, 1, tag + '内 keyup 必须上报');
  }
  console.log('[PASS] (b-扩展) TEXTAREA/SELECT内keyup均上报');
}

// ---------- (c) 完整流程：武装→点选→输入框内释放→宿主亮悬浮按钮（点后才开面板） ----------
// 宿主侧用真实 edit-entry.js remoteCtrlStateChanged 源码求值（stub 外围依赖），帧侧用真实 sendCtrlState 行求值，
// 中间经 sandbox-core.js CTRL_STATE 分发分支（静态已验 + 运行时转发仿真）。
{
  // 1) 静态：宿主 CTRL_STATE 分支须分发到 __onRemoteCtrlState
  assert.ok(coreSrc.includes("t === 'CTRL_STATE'"), '宿主须含 CTRL_STATE 分支');
  assert.ok(coreSrc.includes('__onRemoteCtrlState'), '宿主须分发到 __onRemoteCtrlState');
  assert.ok(eeSrc.includes('function remoteCtrlStateChanged('), '宿主须含 remoteCtrlStateChanged 状态机');
  assert.ok(eeSrc.includes('__onRemoteCtrlState'), '宿主须注册远端按键回调');
  // 释放分支须含 showFab（selected>0 时亮悬浮按钮，不直开面板）
  const rcIdx = eeSrc.indexOf('function remoteCtrlStateChanged(');
  const rcSeg = eeSrc.slice(rcIdx, rcIdx + 2200);
  assert.ok(rcSeg.includes('CTRL_PICK.showFab()') || rcSeg.includes('showFab'), '释放分支须触发 showFab');
  console.log('[PASS] (c0) 宿主链路静态存在：CTRL_STATE→__onRemoteCtrlState→remoteCtrlStateChanged→openPanel');

  // 2) 求值真实 remoteCtrlStateChanged（brace提取，stub依赖）
  const rcCode = braceExtract(eeSrc, 'remoteCtrlStateChanged');
  const calls = { enter: 0, exit: 0, openPanel: 0, showFab: 0, startLoop: 0, stopLoop: 0, armInline: 0 };
  const CTRL_PICK = {
    holding: false, remoteMode: 'pick', selected: [],
    enter: () => { calls.enter++; },
    exit: () => { calls.exit++; },
    openPanel: () => { calls.openPanel++; },
    showFab: () => { calls.showFab++; },
  };
  const stubs = {
    CTRL_PICK,
    ctrlStartRemotePickLoop: () => { calls.startLoop++; },
    ctrlStopRemotePickLoop: () => { calls.stopLoop++; },
    ctrlArmInlineOnce: () => { calls.armInline++; },
  };
  // remoteCtrlStateChanged 引用 window.__EXPORT_BOOT__ / INLINE_EDIT / CTRL_PICK / 循环函数
  const runHost = (st) => {
    const fn = new Function('window', 'CTRL_PICK', 'ctrlStartRemotePickLoop', 'ctrlStopRemotePickLoop', 'ctrlArmInlineOnce', 'INLINE_EDIT',
      rcCode + '\nreturn remoteCtrlStateChanged;')(
        { __EXPORT_BOOT__: false }, stubs.CTRL_PICK, stubs.ctrlStartRemotePickLoop, stubs.ctrlStopRemotePickLoop, stubs.ctrlArmInlineOnce, undefined);
    fn(st);
  };

  // 3) 帧侧武装态仿真：非输入框按下 Ctrl → 上报 HOLD
  const frameHold = buildFrameRuntime('DIV');
  frameHold.api.sendCtrlState(mkKey('Control', true));
  assert.strictEqual(frameHold.posted.length, 1, '武装按下须上报');
  const holdMsg = frameHold.posted[0].mm;
  assert.strictEqual(holdMsg.payload.ctrlKey, true, '武装态 ctrlKey=true');
  // 宿主消费 HOLD → holding=true + enter + 起循环
  runHost({ key: 'Control', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
  assert.strictEqual(CTRL_PICK.holding, true, 'HOLD 后宿主 holding 应为 true');
  assert.strictEqual(calls.enter, 1, 'HOLD 后须 enter');
  assert.strictEqual(calls.startLoop, 1, 'HOLD 后须起远端循环');
  console.log('[PASS] (c1) 武装：帧HOLD上报→宿主holding=true/enter/起循环');

  // 4) 点选：模拟 PICK_RESULT 收编一个元素
  CTRL_PICK.selected.push({ selector: '#btn-submit', tagName: 'button' });
  assert.strictEqual(CTRL_PICK.selected.length, 1, '点选后 selected 应为 1');
  console.log('[PASS] (c2) 点选：selected=1（模拟PICK_RESULT收编）');

  // 5) 输入框内释放：帧 keyup(force=true) 必上报 RELEASE → 宿主亮悬浮按钮（不直开面板）
  const frameRel = buildFrameRuntime('INPUT');
  frameRel.api.sendCtrlState(mkKey('Control', false), true);
  assert.strictEqual(frameRel.posted.length, 1, 'INPUT内释放须上报（force）');
  const relMsg = frameRel.posted[0].mm;
  assert.strictEqual(relMsg.payload.ctrlKey, false, 'RELEASE ctrlKey=false');
  // 宿主消费 RELEASE（经 CTRL_STATE 分发 → remoteCtrlStateChanged）
  runHost({ key: relMsg.payload.key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
  assert.strictEqual(CTRL_PICK.holding, false, 'RELEASE 后 holding 应为 false');
  assert.strictEqual(calls.exit, 1, 'RELEASE 后须 exit');
  assert.strictEqual(calls.showFab, 1, 'RELEASE 且 selected>0 时须亮悬浮按钮');
  assert.strictEqual(calls.openPanel, 0, 'RELEASE 不得直开面板');
  console.log('[PASS] (c3) 输入框内释放→亮悬浮按钮（holding=false/exit/showFab=1）');

  // 6) 反例：空选释放不亮按钮（防空扰）
  CTRL_PICK.holding = true; CTRL_PICK.selected.length = 0; calls.openPanel = 0; calls.exit = 0; calls.showFab = 0;
  runHost({ key: 'Control', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
  assert.strictEqual(calls.showFab, 0, '空选释放不得亮按钮');
  console.log('[PASS] (c4-反例) 空选释放不亮按钮');
}

// ---------- (e) 弹窗互斥：任一弹窗打开时不进入拾取态 ----------
{
  const srcFn = braceExtract(eeSrc, 'isAnyPopupOpen');
  assert.ok(srcFn, '缺 isAnyPopupOpen');
  const factory = new Function('document', 'window', srcFn + '\nreturn isAnyPopupOpen;');
  const run = (masks, drawers, stackLen) => {
    const els = {};
    masks.forEach((id) => { els[id] = { style: { display: 'block' } }; });
    const fakeDoc = { getElementById: (id) => els[id] || null };
    const fakeWin = { MaskStack: { stack: new Array(stackLen) } };
    return factory(fakeDoc, fakeWin)();
  };
  assert.strictEqual(run([], [], 0), false, '无弹窗须放行');
  assert.strictEqual(run(['aiMask'], [], 0), true, 'AI 弹窗须拦截');
  assert.strictEqual(run(['editDrawerMask'], [], 0), true, '待提交抽屉遮罩须拦截');
  assert.strictEqual(run([], [], 1), true, 'MaskStack 非空须拦截');
  // drawer open 类分支
  const runDrawer = () => {
    const fakeDoc = { getElementById: (id) => (id === 'linkInspector' ? { classList: { contains: (c) => c === 'open' } } : null) };
    return factory(fakeDoc, { MaskStack: { stack: [] } })();
  };
  assert.strictEqual(runDrawer(), true, '抽屉 open 类须拦截');
  // 接线：宿主进入与远端进入两处均须调用门禁
  const gateCalls = eeSrc.match(/isAnyPopupOpen\(\)/g) || [];
  assert.ok(gateCalls.length >= 3, '门禁定义+两处接线，实际' + gateCalls.length);
  console.log('[PASS] (e) 弹窗互斥门禁');
}

console.log('=== Ctrl释放链仿真全部通过 (a/b/c/d/e) ===');