'use strict';
// tests/verify-acp-settings-ui.js — ACP 运行时设置页最小 UI 验证（纯 Node，无 Electron / 无真 DOM）
// 覆盖：控件与文案 / 默认值回填 / 变更保存 payload / 失败 toast+回滚 / Agent 传输徽标映射 / CSS 规范。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, '原型+文档.html'), 'utf8');
const PAE = fs.readFileSync(path.join(ROOT, 'js', 'project-ai-export.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');

// —— 源码提取：brace 匹配（跳过字符串/注释/正则），供 new Function 沙箱实调 ——
function extractFn(src, name) {
  const head = 'function ' + name + '(';
  const si = src.indexOf(head);
  assert.ok(si >= 0, '[提取失败] 缺 function ' + name);
  let i = src.indexOf('{', si);
  assert.ok(i >= 0, '[提取失败] 缺函数体 ' + name);
  let depth = 0;
  let inS = null;
  let inLine = false;
  let inBlock = false;
  let inRe = false;
  let inCls = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    const nx = src[j + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && nx === '/') { inBlock = false; j++; } continue; }
    if (inS) {
      if (c === '\\') { j++; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (inRe) {
      if (c === '\\') { j++; continue; }
      if (c === '[') inCls = true;
      else if (c === ']') inCls = false;
      else if (c === '/' && !inCls) inRe = false;
      continue;
    }
    if (c === '/' && nx === '/') { inLine = true; j++; continue; }
    if (c === '/' && nx === '*') { inBlock = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '/') { inRe = true; inCls = false; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(si, j + 1); }
  }
  assert.fail('[提取失败] 花括号未闭合 ' + name);
}

// —— 最小 DOM 桩（覆盖设置控件与 Agent 矩阵渲染实际用到的 API） ——
function makeDoc() {
  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.type = '';
    this.checked = false;
    this.disabled = false;
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.onclick = null;
    this.onchange = null;
    this.nodeType = 1;
    this.style = {};
    const self = this;
    this.classList = {
      add(c) { const s = new Set(String(self.className).split(/\s+/).filter(Boolean)); s.add(c); self.className = Array.from(s).join(' '); },
      remove(c) { const s = new Set(String(self.className).split(/\s+/).filter(Boolean)); s.delete(c); self.className = Array.from(s).join(' '); },
      contains(c) { return String(' ' + self.className + ' ').indexOf(' ' + c + ' ') >= 0; }
    };
  }
  El.prototype.setAttribute = function (k, v) { this.attributes[String(k)] = String(v); };
  El.prototype.getAttribute = function (k) { const v = this.attributes[String(k)]; return v == null ? null : v; };
  El.prototype.appendChild = function (ch) { if (ch) { ch.parentNode = this; this.children.push(ch); } return ch; };
  El.prototype.removeChild = function (ch) {
    const i = this.children.indexOf(ch);
    if (i >= 0) { this.children.splice(i, 1); ch.parentNode = null; }
    return ch;
  };
  Object.defineProperty(El.prototype, 'innerHTML', {
    get() { return ''; },
    set() { this.children = []; }
  });
  function match(el, sel) {
    if (!sel) return false;
    if (sel.charAt(0) === '[') {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (!m) return false;
      const v = el.getAttribute(m[1]);
      if (m[2] === undefined) return v !== null;
      return v === m[2];
    }
    if (sel.charAt(0) === '.') return el.classList.contains(sel.slice(1));
    if (sel.charAt(0) === '#') return el.getAttribute('id') === sel.slice(1);
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }
  El.prototype.querySelector = function (sel) {
    if (match(this, sel)) return this;
    for (const ch of this.children) {
      const r = ch.querySelector(sel);
      if (r) return r;
    }
    return null;
  };
  El.prototype.querySelectorAll = function (sel) {
    let out = [];
    if (match(this, sel)) out.push(this);
    for (const ch of this.children) out = out.concat(ch.querySelectorAll(sel));
    return out;
  };
  const byId = {};
  return {
    createElement(t) { return new El(t); },
    getElementById(id) { return byId[id] || null; },
    __reg(id, el) { byId[id] = el; },
    __root: new El('div')
  };
}

// —— ACP 设置函数沙箱：可注入 document / window / 提示函数，返回可读改的 curAiConfig ——
const ACP_FNS = ['acpPermissionMode', 'acpConfigFromUi', 'acpApplyUiFromConfig', 'acpSaveFromUi'];
function acpSandbox(doc, win, opts) {
  let src = 'var curAiConfig=' + JSON.stringify(opts.cfg || {}) + ';\n'
    + 'var ACP_PERMISSION_MODES=[\'approve-all\',\'approve-reads\',\'deny-all\'];\n'
    + 'var ACP_DEFAULT_PERMISSION_MODE=\'approve-reads\';\n';
  for (const n of ACP_FNS) src += extractFn(PAE, n) + '\n';
  const fn = new Function('document', 'window', '$', 'showToast', 'showSettingsSaveTip', 'refreshCliInfo', 'aiRefreshCli',
    src + '\nreturn { acpPermissionMode: acpPermissionMode, acpConfigFromUi: acpConfigFromUi,'
    + ' acpApplyUiFromConfig: acpApplyUiFromConfig, acpSaveFromUi: acpSaveFromUi,'
    + ' getCfg: function(){ return curAiConfig; } };');
  return fn(doc, win, (id) => doc.getElementById(id), opts.showToast || function () {},
    opts.showSettingsSaveTip || function () {}, opts.refreshCliInfo || function () {},
    opts.aiRefreshCli || function () {});
}

// —— Agent 矩阵沙箱（只测卡片徽标，不触碰真实探测） ——
function matrixSandbox(doc, opts) {
  let src = 'var aiAgentMatrix=null;\nvar curAiConfig=' + JSON.stringify(opts.cfg || {}) + ';\n'
    + 'var I5_AGENT_ORDER=' + JSON.stringify(opts.order || ['opencode', 'claude', 'codex']) + ';\n'
    + 'var I5_AGENT_FALLBACK=' + JSON.stringify(opts.fallback || { opencode: 'OpenCode', claude: 'Claude', codex: 'Codex' }) + ';\n'
    + 'function i5AgentLabel(a){ return (a&&(a.name||a.id))||\'\'; }\n'
    + 'function i5PickAgentPath(){}\n';
  src += extractFn(PAE, 'i5RenderAgentMatrix') + '\n';
  const fn = new Function('document', 'window', '$', 'i5SetMainAgent', 'getActiveEngineInUi',
    src + '\nreturn { render: i5RenderAgentMatrix, get matrix(){ return aiAgentMatrix; } };');
  return fn(doc, { protoAPI: {} }, (id) => doc.getElementById(id),
    opts.setMain || function () {}, () => 'cli');
}

// 1. 静态契约：HTML 控件位置/文案/默认值
(function t1() {
  const paneStart = HTML.indexOf('id="paneSetAi"');
  assert.ok(paneStart > 0, '缺 #paneSetAi');
  const paneEnd = HTML.indexOf('id="paneSetModels"', paneStart);
  assert.ok(paneEnd > paneStart, '缺 #paneSetModels 边界');
  const pane = HTML.slice(paneStart, paneEnd);

  const box = pane.indexOf('id="boxAcpCfg"');
  const cli = pane.indexOf('id="boxCliCfg"');
  assert.ok(box > 0, 'ACP 卡片缺 #boxAcpCfg');
  assert.ok(cli > box, 'ACP 卡片须位于本地 CLI 矩阵 #boxCliCfg 上方');
  assert.ok(/class="set-box acp-cfg-box"/.test(pane), 'ACP 卡片须沿用 .set-box');
  assert.ok(pane.indexOf('ACP 运行时（实验）') > 0, '缺标题「ACP 运行时（实验）」');

  const chkAt = pane.indexOf('id="chkAcpEnabled"');
  assert.ok(chkAt > 0, '缺 #chkAcpEnabled');
  assert.ok(pane.slice(chkAt - 120, chkAt).indexOf('type="checkbox"') >= 0, 'ACP 开关须为复选框');
  assert.ok(/id="chkAcpEnabled"[^>]*>/.test(pane), '复选框须可被脚本读取');
  assert.ok(!/id="chkAcpEnabled"[^>]*\bchecked\b/.test(pane), '复选框默认不勾选');
  assert.ok(pane.indexOf('开启后支持 ACP 的 Agent 走标准协议，失败可关闭回退兼容模式') > 0, '缺开关说明文案');

  assert.ok(pane.indexOf('id="selAcpPermissionMode"') > 0, '缺 #selAcpPermissionMode');
  const selStart = pane.indexOf('id="selAcpPermissionMode"');
  const selEnd = pane.indexOf('</select>', selStart);
  assert.ok(selEnd > selStart, '权限下拉未闭合');
  const sel = pane.slice(selStart, selEnd);
  const opts = [...sel.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(opts, [
    ['approve-reads', '按需审批（推荐）'],
    ['approve-all', '自动放行'],
    ['deny-all', '只读']
  ], '权限模式选项与顺序不符');

  assert.ok(pane.indexOf('需要 Electron 37+；首次使用某个 Agent 可能需要在终端完成登录。') > 0, '缺兼容性/登录提示');
  const block = pane.slice(box, cli);
  assert.ok(/class="set-field"/.test(block), 'ACP 卡片须沿用 .set-field');
  assert.ok(/class="set-tip"/.test(block), 'ACP 卡片须沿用 .set-tip');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(block), 'ACP 卡片不得使用 emoji');
  console.log('[PASS] HTML 控件/位置/文案/默认值');
})();

// 2. 静态契约：读取回填、保存 payload、刷新与回滚
(function t2() {
  for (const fn of ACP_FNS) assert.ok(new RegExp('function\\s+' + fn + '\\b').test(PAE), '缺函数 ' + fn);
  assert.ok(/acpApplyUiFromConfig\(curAiConfig\)/.test(PAE), 'loadSettingsToUi 未回填 ACP 配置');
  assert.ok(/acpApplyUiFromConfig\(\{\}\)/.test(PAE), '非桌面端未回填默认值');
  assert.ok(/c\.acp\.enabled===true/.test(PAE), '未读取 cfg.acp.enabled');
  assert.ok(/c\.acp\.defaultPermissionMode/.test(PAE), '未读取 cfg.acp.defaultPermissionMode');
  assert.ok(/defaultPermissionMode:'approve-reads'/.test(PAE) || /ACP_DEFAULT_PERMISSION_MODE='approve-reads'/.test(PAE), '默认权限须为 approve-reads');
  assert.ok(/saveConfig\(curAiConfig\)/.test(PAE), 'ACP 变更须调用 saveConfig(curAiConfig)');
  assert.ok(/_acpChk\.onchange=acpSaveFromUi/.test(PAE), '复选框 change 未绑定保存');
  assert.ok(/_acpSel\.onchange=acpSaveFromUi/.test(PAE), '权限下拉 change 未绑定保存');
  assert.ok(/refreshCliInfo\(\)/.test(extractFn(PAE, 'acpSaveFromUi')), '保存成功须刷新 CLI/Agent 矩阵');
  const save = extractFn(PAE, 'acpSaveFromUi');
  assert.ok(/showToast\(msg\)/.test(save), '保存失败须 toast');
  assert.ok(/curAiConfig\.acp=prevAcp/.test(save), '保存失败须回滚 curAiConfig.acp');
  assert.ok(/acpApplyUiFromConfig\(curAiConfig\)/.test(save), '保存失败须回滚 UI');
  assert.ok(PAE.indexOf('ipcRenderer') < 0, '前端文件不得直接触碰 ipcRenderer');
  const applySettings = extractFn(PAE, 'saveSettingsFromUi');
  assert.ok(/\bacp\s*:/.test(applySettings), '「保存并应用」须保留 acp 配置');
  assert.ok(!/acp[:_-]?(start|spawn|connect)/i.test(PAE), '前端不得自行启动 ACP');
  console.log('[PASS] JS 回填/保存/刷新/回滚契约');
})();

// 3. 默认值与合法模式回填
(function t3() {
  const doc = makeDoc();
  const chk = doc.createElement('input'); chk.id = 'chkAcpEnabled'; doc.__reg('chkAcpEnabled', chk);
  const sel = doc.createElement('select'); sel.id = 'selAcpPermissionMode'; doc.__reg('selAcpPermissionMode', sel);
  const api = acpSandbox(doc, { protoAPI: {} }, { cfg: {} });

  api.acpApplyUiFromConfig({});
  assert.strictEqual(chk.checked, false, '默认关闭');
  assert.strictEqual(sel.value, 'approve-reads', '默认按需审批');

  api.acpApplyUiFromConfig({ acp: { enabled: true, defaultPermissionMode: 'approve-all' } });
  assert.strictEqual(chk.checked, true, '回填开启态');
  assert.strictEqual(sel.value, 'approve-all', '回填自动放行');

  api.acpApplyUiFromConfig({ acp: { enabled: false, defaultPermissionMode: 'deny-all' } });
  assert.strictEqual(chk.checked, false);
  assert.strictEqual(sel.value, 'deny-all', '回填只读');

  api.acpApplyUiFromConfig({ acp: { enabled: true, defaultPermissionMode: 'bogus' } });
  assert.strictEqual(sel.value, 'approve-reads', '非法模式回落 approve-reads');

  api.acpApplyUiFromConfig();
  assert.strictEqual(chk.checked, false, '无参回填读 curAiConfig（初始为空 => 关闭）');
  console.log('[PASS] 默认值/回填/非法模式回落');
})();

// 4. 变更保存 payload：保留 agents 与其它配置
async function t4() {
  const doc = makeDoc();
  const chk = doc.createElement('input'); chk.id = 'chkAcpEnabled'; doc.__reg('chkAcpEnabled', chk);
  const sel = doc.createElement('select'); sel.id = 'selAcpPermissionMode'; doc.__reg('selAcpPermissionMode', sel);
  const calls = [];
  let refreshed = 0;
  let tip = 0;
  const win = { protoAPI: { ai: { saveConfig(cfg) { calls.push(JSON.parse(JSON.stringify(cfg))); return Promise.resolve({ ok: true }); } } } };
  const cfg = {
    engine: 'cli',
    agentId: 'opencode',
    acp: { enabled: false, defaultPermissionMode: 'approve-reads', agents: { opencode: { permissionMode: 'approve-all' } } }
  };
  const api = acpSandbox(doc, win, { cfg, refreshCliInfo() { refreshed += 1; }, showSettingsSaveTip() { tip += 1; } });

  api.acpApplyUiFromConfig(api.getCfg());
  chk.checked = true;
  sel.value = 'deny-all';
  api.acpSaveFromUi();
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(calls.length, 1, '应保存一次');
  assert.strictEqual(calls[0].acp.enabled, true, 'payload.enabled');
  assert.strictEqual(calls[0].acp.defaultPermissionMode, 'deny-all', 'payload.defaultPermissionMode');
  assert.deepStrictEqual(calls[0].acp.agents, { opencode: { permissionMode: 'approve-all' } }, '保留 acp.agents');
  assert.strictEqual(calls[0].engine, 'cli', '保留其它配置');
  assert.strictEqual(calls[0].agentId, 'opencode', '保留主力 Agent');
  assert.strictEqual(api.getCfg().acp.enabled, true, 'curAiConfig 同步');
  assert.strictEqual(refreshed, 1, '保存成功刷新 CLI/矩阵');
  assert.strictEqual(tip, 1, '保存成功显示已保存提示');
  console.log('[PASS] 保存 payload/保留 agents/成功刷新');
}

// 5. 失败 toast + UI/内存回滚（Promise reject 与 {ok:false} 两条路）
async function t5() {
  const doc = makeDoc();
  const chk = doc.createElement('input'); chk.id = 'chkAcpEnabled'; doc.__reg('chkAcpEnabled', chk);
  const sel = doc.createElement('select'); sel.id = 'selAcpPermissionMode'; doc.__reg('selAcpPermissionMode', sel);
  const toasts = [];
  const cfg = { acp: { enabled: false, defaultPermissionMode: 'approve-reads', agents: {} } };
  const api = acpSandbox(doc, { protoAPI: { ai: { saveConfig() { return Promise.reject(new Error('磁盘不可写')); } } } },
    { cfg, showToast(m) { toasts.push(m); } });
  api.acpApplyUiFromConfig(api.getCfg());
  chk.checked = true;
  sel.value = 'approve-all';
  api.acpSaveFromUi();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(chk.checked, false, '失败后复选框回滚');
  assert.strictEqual(sel.value, 'approve-reads', '失败后下拉回滚');
  assert.strictEqual(api.getCfg().acp.enabled, false, '失败后内存回滚');
  assert.strictEqual(api.getCfg().acp.defaultPermissionMode, 'approve-reads');
  assert.strictEqual(toasts.length, 1, '失败 toast 一次');
  assert.ok(toasts[0].indexOf('保存失败') >= 0 && toasts[0].indexOf('磁盘不可写') >= 0, 'toast 带原因：' + toasts[0]);

  const doc2 = makeDoc();
  const chk2 = doc2.createElement('input'); chk2.id = 'chkAcpEnabled'; doc2.__reg('chkAcpEnabled', chk2);
  const sel2 = doc2.createElement('select'); sel2.id = 'selAcpPermissionMode'; doc2.__reg('selAcpPermissionMode', sel2);
  const toasts2 = [];
  const api2 = acpSandbox(doc2, { protoAPI: { ai: { saveConfig() { return Promise.resolve({ ok: false, error: '权限不足' }); } } } },
    { cfg: { acp: { enabled: true, defaultPermissionMode: 'deny-all' } }, showToast(m) { toasts2.push(m); } });
  api2.acpApplyUiFromConfig(api2.getCfg());
  chk2.checked = false;
  api2.acpSaveFromUi();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(chk2.checked, true, '{ok:false} 也要回滚');
  assert.strictEqual(toasts2.length, 1);
  assert.ok(toasts2[0].indexOf('权限不足') >= 0, 'toast 带后端错误');
  console.log('[PASS] 失败 toast + UI/内存回滚');
}

// 6. Agent 徽标：ACP / 兼容映射、位置、点击与路径逻辑不变
(function t6() {
  const doc = makeDoc();
  const matrix = doc.createElement('div'); matrix.id = 'aiAgentMatrix'; doc.__reg('aiAgentMatrix', matrix);
  const picked = [];
  const api = matrixSandbox(doc, {
    cfg: { agentId: 'opencode', mainAgent: 'opencode' },
    setMain(id) { picked.push(id); }
  });
  api.render([
    { id: 'opencode', name: 'OpenCode', available: true, path: 'C:\\bin\\opencode.exe', transport: 'acp', acp: { supported: true } },
    { id: 'claude', name: 'Claude', available: true, path: 'C:\\bin\\claude.exe', transport: 'legacy' },
    { id: 'codex', name: 'Codex', available: false, path: null, transport: 'acp', acp: { supported: false } }
  ], 'opencode');

  const card = (id) => matrix.querySelector('[data-id="' + id + '"]');
  const oc = card('opencode');
  assert.ok(oc, '缺 opencode 卡片');
  const ocBadge = oc.querySelector('.agent-transport-badge');
  assert.ok(ocBadge, '缺传输徽标');
  assert.ok(ocBadge.classList.contains('acp'), 'ACP 卡徽标须为蓝色 acp 类');
  assert.strictEqual(ocBadge.textContent, 'ACP');
  const ocHead = oc.querySelector('.agent-head-right');
  const order = ocHead.children;
  const badgeIdx = order.indexOf(ocBadge);
  const statusIdx = order.findIndex((el) => el.classList.contains('agent-status'));
  assert.ok(badgeIdx >= 0 && statusIdx > badgeIdx, '徽标须在状态点左侧');
  assert.ok(oc.querySelector('.agent-use-flag'), '使用中标识不得丢失');
  assert.ok(oc.querySelector('.agent-path'), '路径行不得丢失');
  assert.ok(oc.querySelector('.btn-pick-cli'), '指定路径按钮不得丢失');

  const cl = card('claude');
  const clBadge = cl.querySelector('.agent-transport-badge');
  assert.ok(clBadge.classList.contains('compat'), 'legacy 卡须为灰色 compat 类');
  assert.strictEqual(clBadge.textContent, '兼容');

  const cx = card('codex');
  const cxBadge = cx.querySelector('.agent-transport-badge');
  assert.ok(cxBadge.classList.contains('compat'), 'acp.supported=false 须回落兼容');
  assert.strictEqual(cxBadge.textContent, '兼容');

  oc.onclick();
  assert.deepStrictEqual(picked, ['opencode'], '可用卡片点击仍切换主力');
  cx.onclick();
  assert.deepStrictEqual(picked, ['opencode'], '未安装卡片点击不切换');
  console.log('[PASS] Agent 徽标映射/位置/点击路径逻辑');
})();

// 7. CSS：纯色、token、无渐变、无 emoji
(function t7() {
  const badgeAt = CSS.indexOf('.agent-transport-badge{');
  assert.ok(badgeAt > 0, '缺 .agent-transport-badge 样式');
  const badgeSec = CSS.slice(badgeAt, badgeAt + 600);
  assert.ok(/\.agent-transport-badge\.acp\{[^}]*var\(--pri\)/.test(badgeSec), 'ACP 徽标须用 --pri 蓝色');
  assert.ok(/\.agent-transport-badge\.acp\{[^}]*var\(--pri-soft\)/.test(badgeSec), 'ACP 徽标底须用 --pri-soft');
  assert.ok(/\.agent-transport-badge\.compat\{[^}]*var\(--sub\)/.test(badgeSec), '兼容徽标须用 --sub 灰色');
  assert.ok(badgeSec.indexOf('linear-gradient') < 0, '徽标不得使用渐变');
  assert.ok(/\.agent-transport-badge\{[^}]*border-radius:99px/.test(badgeSec), '徽标圆角 99px');

  const cardAt = CSS.indexOf('.acp-cfg-box{');
  assert.ok(cardAt > 0, '缺 .acp-cfg-box 样式');
  const cardSec = CSS.slice(cardAt, cardAt + 800);
  for (const sel of ['.acp-cfg-box', '.acp-cfg-toggle', '.acp-cfg-toggle input', '.acp-cfg-row', '.acp-cfg-select']) {
    assert.ok(cardSec.indexOf(sel) >= 0, '缺样式 ' + sel);
  }
  assert.ok(/\.acp-cfg-box\{[^}]*var\(--line\)/.test(cardSec), 'ACP 卡片边框沿用 --line');
  assert.ok(/\.acp-cfg-box\{[^}]*var\(--bg-subtle\)/.test(cardSec), 'ACP 卡片底色沿用 --bg-subtle');
  assert.ok(cardSec.indexOf('linear-gradient') < 0, 'ACP 卡片不得使用渐变');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(cardSec), 'ACP 卡片样式不得含 emoji');
  console.log('[PASS] CSS 纯色/token/无渐变');
})();

(async function main() {
  let passed = 5; // 同步断言已通过 1/2/3/6/7
  let failed = 0;
  for (const [name, fn] of [['断言4 保存 payload', t4], ['断言5 失败回滚', t5]]) {
    try {
      await fn();
      passed += 1;
    } catch (e) {
      failed += 1;
      console.log('[FAIL] ' + name);
      console.log((e && e.stack) || String(e));
    }
  }
  if (failed) {
    console.log(`SUMMARY passed=${passed} failed=${failed}`);
    process.exitCode = 1;
  } else {
    console.log('ACP_SETTINGS_UI_PASS: ACP 设置页最小 UI 全绿');
  }
})();
