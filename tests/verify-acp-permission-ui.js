'use strict';
// tests/verify-acp-permission-ui.js — ACP 权限请求卡前端验证（纯 Node，无 Electron / 无真 DOM）
// 覆盖：ai:event 分支 / 类型与风险映射 / optionId 匹配 / 内联卡片结构 / 回传 payload /
//       按钮禁用与已处理态 / aiCurTaskEvents 落盘 / 去重 / 回放只读 / CSS 规范 / 未新增 IPC。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
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

const PURE = ['permStr', 'permKindInfo', 'permRiskInfo', 'permOptionId', 'permNormalize',
  'permMergeState', 'permStatusText', 'permShortTarget', 'permTargetValue'];
const DOMF = ['permPaint', 'permBuildCard', 'permHost', 'permPushEvent', 'permPersistState',
  'permDecide', 'permRequest', 'permResolved', 'permReplayOne', 'permAgentStatus'];
const ALL = PURE.concat(DOMF);

function sandbox(extraParams, withDom) {
  let src = 'var permSeq=0; var permLive={}; var permResolvedEarly={};\n';
  for (const n of ALL) src += extractFn(PAE, n) + '\n';
  const names = Object.keys(extraParams || {});
  const fn = new Function('document', 'window', names.join(','),
    src + '\nreturn {' + ALL.join(',') + ', __live: permLive, __early: permResolvedEarly };');
  return fn.apply(null, [withDom || undefined, extraParams && extraParams.window]
    .concat(names.map((k) => extraParams[k])));
}

// —— 最小 DOM 桩（覆盖权限卡渲染与查询实际用到的 API） ——
function makeDoc() {
  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.type = '';
    this.disabled = false;
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.onclick = null;
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
function collectText(el) {
  let s = String((el && el.textContent) || '');
  for (const ch of ((el && el.children) || [])) s += ' ' + collectText(ch);
  return s.replace(/\s+/g, ' ').trim();
}
function makeWindow() {
  const calls = [];
  return {
    __calls: calls,
    protoAPI: {
      ai: {
        confirmScope(payload) { calls.push(payload); }
      }
    }
  };
}
const PAYLOAD = {
  id: 'perm_1',
  uiSessionId: 's_1',
  sessionId: 'ses_1',
  toolCallId: 'call_1',
  title: '执行命令',
  kind: 'execute',
  command: 'npm run build',
  cwd: 'D:\\work\\sandbox\\A',
  locations: [{ path: 'src/a.js', line: 12 }],
  options: [
    { optionId: 'opt-once', name: '允许一次', kind: 'allow_once' },
    { optionId: 'opt-always', name: '始终允许', kind: 'allow_always' },
    { optionId: 'opt-deny', name: '拒绝', kind: 'reject_once' }
  ],
  risk: 'high'
};

// 1. 静态契约：事件分支 / 函数 / 回放钩子 / 回传与落盘
(function t1() {
  assert.ok(/ev\.type==='permission_request'/.test(PAE), 'ai:event 缺 permission_request 分支');
  assert.ok(/ev\.type==='permission_resolved'/.test(PAE), 'ai:event 缺 permission_resolved 分支');
  assert.ok(/ev\.type==='agent_status'/.test(PAE), 'ai:event 缺 agent_status 分支');
  for (const fn of ['permBuildCard', 'permRequest', 'permResolved', 'permReplayOne', 'permPersistState', 'permDecide']) {
    assert.ok(new RegExp('function\\s+' + fn + '\\b').test(PAE), '缺函数 ' + fn);
  }
  assert.ok(/permReplayOne\(tl, e\)/.test(PAE), 'i5ReplayTimeline 未接入 permission 回放');
  assert.ok(/kind:'acp-permission'/.test(PAE), '回执缺 kind:acp-permission');
  assert.ok(/confirmScope\(payload\)/.test(PAE), '回执未走 confirmScope');
  assert.ok(/t:\s*'permission'/.test(PAE), '未落盘 t:permission 事件');
  assert.ok(/data-permission-id/.test(PAE), '卡片未记录 data-permission-id');
  assert.ok(PAE.indexOf('ipcRenderer') < 0, '前端文件不得直接触碰 ipcRenderer');
  console.log('[PASS] 静态契约/事件分支/回放钩子');
})();

// 2. 类型与风险映射
(function t2() {
  const api = sandbox();
  assert.strictEqual(api.permKindInfo('execute', '').label, '执行');
  assert.strictEqual(api.permKindInfo('shell', '').label, '执行');
  assert.strictEqual(api.permKindInfo('edit', '').label, '写文件');
  assert.strictEqual(api.permKindInfo('write', '').label, '写文件');
  assert.strictEqual(api.permKindInfo('read', '').label, '读取');
  assert.strictEqual(api.permKindInfo('glob', '').label, '读取');
  assert.strictEqual(api.permKindInfo('fetch', '').label, '网络');
  assert.strictEqual(api.permKindInfo('http', '').label, '网络');
  assert.strictEqual(api.permKindInfo('', '执行命令').label, '执行', 'kind 缺失时按 title 兜底');
  assert.strictEqual(api.permKindInfo('mystery', '').label, '操作');
  assert.strictEqual(api.permRiskInfo('high').label, '高风险');
  assert.strictEqual(api.permRiskInfo('medium').label, '中风险');
  assert.strictEqual(api.permRiskInfo('low').label, '低风险');
  assert.strictEqual(api.permRiskInfo('').label, '中风险', '缺省风险按中风险');
  console.log('[PASS] 类型徽标/风险映射');
})();

// 3. optionId 匹配（允许一次 / 始终允许 / 拒绝；无匹配不带）
(function t3() {
  const api = sandbox();
  assert.strictEqual(api.permOptionId(PAYLOAD, 'allow-once'), 'opt-once');
  assert.strictEqual(api.permOptionId(PAYLOAD, 'allow-always'), 'opt-always');
  assert.strictEqual(api.permOptionId(PAYLOAD, 'deny'), 'opt-deny');
  const hyphen = { options: [{ optionId: 'o1', kind: 'allow-once' }] };
  assert.strictEqual(api.permOptionId(hyphen, 'allow-once'), 'o1', '连字符 kind 应归一');
  assert.strictEqual(api.permOptionId({ options: [] }, 'allow-once'), '', '无匹配返回空');
  console.log('[PASS] optionId 匹配');
})();

// 4. 卡片结构：标题/徽标/命令/cwd/位置/风险/三按钮/去重属性
(function t4() {
  const doc = makeDoc();
  const api = sandbox({ window: makeWindow() }, doc);
  const built = api.permBuildCard(PAYLOAD, { state: 'pending' });
  const card = built.wrap.querySelector('.perm-card');
  assert.ok(card, '缺 .perm-card');
  assert.strictEqual(card.getAttribute('data-permission-id'), 'perm_1', '挂载点带权限 id');
  assert.strictEqual(card.getAttribute('data-permission-state'), 'pending', '初始待处理态');
  const text = collectText(built.wrap);
  for (const s of ['Agent 请求执行操作', '执行', '高风险', 'npm run build', '工作目录：D:\\work\\sandbox\\A', 'src/a.js:12']) {
    assert.ok(text.indexOf(s) >= 0, '卡片缺文案：' + s + ' / ' + text);
  }
  assert.strictEqual(built.entry.buttons.length, 3, '应有三按钮');
  assert.deepStrictEqual(built.entry.buttons.map((b) => b.textContent), ['拒绝', '本会话始终允许此类', '允许一次']);
  assert.strictEqual(built.tagEl.textContent, '待处理');
  assert.ok(built.wrap.querySelector('.tool-call-card'), '状态行复用 tool-call-card');
  assert.ok(built.wrap.querySelector('.qform-card') === null, '不得误用问答卡类名');
  console.log('[PASS] 内联卡片结构与目标展示');
})();

// 5. 允许一次：回传 payload / 按钮禁用 / 已允许 / 落盘事件 / 去重
(function t5() {
  const doc = makeDoc();
  const win = makeWindow();
  const events = [];
  const host = doc.createElement('div');
  const api = sandbox({
    window: win,
    aiCurTaskEvents: events,
    aiSessNow() { return 1700000000000; },
    i5TlEnsureTimeline() { return host; },
    i5TlScroll() {}
  }, doc);
  assert.strictEqual(api.permRequest(PAYLOAD), true, '首次请求应渲染');
  assert.strictEqual(events.length, 1, 'permission 事件应落盘');
  assert.strictEqual(events[0].t, 'permission');
  assert.strictEqual(JSON.parse(events[0].text).id, 'perm_1');
  const entry = api.__live.perm_1;
  assert.ok(entry, '应登记 live entry');
  entry.buttons[2].onclick();
  assert.strictEqual(win.__calls.length, 1, '应回传一次');
  assert.deepStrictEqual(win.__calls[0], {
    kind: 'acp-permission', id: 'perm_1', decision: 'allow-once', optionId: 'opt-once'
  });
  const card = host.querySelector('[data-permission-id="perm_1"]');
  assert.strictEqual(card.getAttribute('data-permission-state'), 'allowed');
  assert.ok(entry.buttons.every((b) => b.disabled), '回传后按钮应禁用');
  assert.strictEqual(entry.stateEl.textContent, '已允许');
  assert.strictEqual(JSON.parse(events[0].text).state, 'allowed');
  assert.strictEqual(JSON.parse(events[0].text).decision, 'allow-once');
  entry.buttons[2].onclick();
  assert.strictEqual(win.__calls.length, 1, '二次点击不得重发');
  assert.strictEqual(api.permRequest(PAYLOAD), false, '同 id 重复请求应忽略');
  assert.strictEqual(host.querySelectorAll('[data-permission-id]').length, 1, '不得重复卡片');
  assert.strictEqual(events.length, 1, '不得重复落盘');
  console.log('[PASS] 允许一次回传/禁用/落盘/去重');
})();

// 6. 拒绝 / 始终允许 / 无 optionId 时省略字段
(function t6() {
  const doc = makeDoc();
  const win = makeWindow();
  const events = [];
  const host = doc.createElement('div');
  const api = sandbox({
    window: win,
    aiCurTaskEvents: events,
    i5TlEnsureTimeline() { return host; },
    i5TlScroll() {}
  }, doc);
  api.permRequest(PAYLOAD);
  api.__live.perm_1.buttons[0].onclick();
  assert.deepStrictEqual(win.__calls[0], {
    kind: 'acp-permission', id: 'perm_1', decision: 'deny', optionId: 'opt-deny'
  });
  assert.strictEqual(api.__live.perm_1.state, 'denied');
  assert.strictEqual(api.__live.perm_1.stateEl.textContent, '已拒绝');

  const win2 = makeWindow();
  const doc2 = makeDoc();
  const host2 = doc2.createElement('div');
  const api2 = sandbox({
    window: win2,
    aiCurTaskEvents: [],
    i5TlEnsureTimeline() { return host2; },
    i5TlScroll() {}
  }, doc2);
  const noOpt = Object.assign({}, PAYLOAD, { id: 'perm_2', options: [] });
  api2.permRequest(noOpt);
  api2.__live.perm_2.buttons[1].onclick();
  assert.deepStrictEqual(win2.__calls[0], {
    kind: 'acp-permission', id: 'perm_2', decision: 'allow-always'
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(win2.__calls[0], 'optionId'), '无匹配不得硬塞 optionId');
  console.log('[PASS] 拒绝/始终允许/无 optionId');
})();

// 7. permission_resolved：待处理翻已处理；提前 resolved；已允许保持已允许
(function t7() {
  const doc = makeDoc();
  const win = makeWindow();
  const events = [];
  const sessEvents = [];
  const host = doc.createElement('div');
  const api = sandbox({
    window: win,
    aiCurTaskEvents: events,
    aiCurSesh() { return { events: sessEvents }; },
    aiSaveSesh() {},
    i5TlEnsureTimeline() { return host; },
    i5TlScroll() {}
  }, doc);
  api.permRequest(Object.assign({}, PAYLOAD, { id: 'perm_r' }));
  assert.strictEqual(api.permResolved('perm_r'), true);
  assert.strictEqual(api.__live.perm_r.state, 'resolved');
  assert.strictEqual(api.__live.perm_r.stateEl.textContent, '已处理');
  assert.ok(api.__live.perm_r.buttons.every((b) => b.disabled));
  assert.strictEqual(JSON.parse(events[0].text).state, 'resolved');

  api.permResolved('perm_e');
  api.permRequest(Object.assign({}, PAYLOAD, { id: 'perm_e' }));
  assert.strictEqual(api.__live.perm_e.state, 'resolved', '提前 resolved 应直接建已处理态');
  const earlyEv = events.filter((e) => JSON.parse(e.text).id === 'perm_e')[0];
  assert.ok(earlyEv, '提前 resolved 也应落盘');
  assert.strictEqual(JSON.parse(earlyEv.text).state, 'resolved');

  api.permRequest(Object.assign({}, PAYLOAD, { id: 'perm_a' }));
  api.__live.perm_a.buttons[2].onclick();
  api.permResolved('perm_a');
  assert.strictEqual(api.__live.perm_a.state, 'allowed', '已允许后 resolved 不应改口');
  console.log('[PASS] resolved/提前 resolved/保持已允许');
})();

// 8. 回放：pending 只读、已处理只读、按钮不可回传
(function t8() {
  const doc = makeDoc();
  const win = makeWindow();
  const host = doc.createElement('div');
  const api = sandbox({ window: win, i5TlEnsureTimeline() { return host; }, i5TlScroll() {} }, doc);
  assert.strictEqual(api.permReplayOne(host, {
    t: 'permission', text: JSON.stringify(Object.assign({}, PAYLOAD, { id: 'perm_old' })), ts: 1
  }), true);
  const card = host.querySelector('[data-permission-id="perm_old"]');
  assert.strictEqual(card.getAttribute('data-permission-state'), 'pending');
  assert.ok(api.__live.perm_old.readonly, '回放 pending 应只读');
  assert.ok(api.__live.perm_old.buttons.every((b) => b.disabled), '回放按钮禁用');
  assert.strictEqual(api.__live.perm_old.stateEl.textContent, '待处理 · 仅供查看');
  assert.strictEqual(api.permDecide(api.__live.perm_old, 'allow-once'), false, '只读不得回传');
  assert.strictEqual(win.__calls.length, 0);

  assert.strictEqual(api.permRequest(Object.assign({}, PAYLOAD, { id: 'perm_old' })), true, '回放待处理可升级为真实请求');
  assert.strictEqual(api.__live.perm_old.readonly, false, '升级后可操作');
  assert.ok(!api.__live.perm_old.buttons[0].disabled, '升级后按钮可用');
  assert.strictEqual(host.querySelectorAll('[data-permission-id="perm_old"]').length, 1, '升级不重复卡片');

  const doneEv = {
    t: 'permission',
    text: JSON.stringify(Object.assign({}, PAYLOAD, { id: 'perm_done', state: 'allowed', decision: 'allow-once' })),
    ts: 2
  };
  assert.strictEqual(api.permReplayOne(host, doneEv), true);
  const doneCard = host.querySelector('[data-permission-id="perm_done"]');
  assert.strictEqual(doneCard.getAttribute('data-permission-state'), 'allowed');
  assert.strictEqual(api.__live.perm_done.stateEl.textContent, '已允许');
  assert.ok(api.__live.perm_done.buttons.every((b) => b.disabled));
  console.log('[PASS] 回放只读/已处理态');
})();

// 9. agent_status 轻量状态（不改布局，只更新既有节点 data/title/class）
(function t9() {
  const doc = makeDoc();
  const cli = doc.createElement('span');
  const badge = doc.createElement('span');
  const chat = doc.createElement('div');
  doc.__reg('aiCli', cli);
  doc.__reg('aiAgentBadge', badge);
  doc.__reg('aiChatView', chat);
  const win = {};
  let dotCls = '';
  const api = sandbox({ window: win, aiSyncBadgeDot(c) { dotCls = c; } }, doc);
  assert.strictEqual(api.permAgentStatus({ status: 'disconnected', message: '进程退出' }), true);
  assert.strictEqual(cli.className, 'ai-cli err');
  assert.strictEqual(dotCls, 'err', '顶部圆点应同步 err');
  assert.ok(cli.title.indexOf('Agent 已断开') >= 0 && cli.title.indexOf('进程退出') >= 0);
  assert.strictEqual(badge.getAttribute('data-agent-status'), 'disconnected');
  assert.strictEqual(chat.getAttribute('data-agent-status'), 'disconnected');
  assert.strictEqual(win.__aiAgentStatus.status, 'disconnected');
  api.permAgentStatus({ status: 'connected' });
  assert.strictEqual(cli.className, 'ai-cli ok');
  console.log('[PASS] agent_status 轻量状态');
})();

// 10. CSS 规范：纯色、无渐变、无 fixed、8px 表面圆角、沿用 docs-btn
(function t10() {
  const start = CSS.indexOf('.perm-wrap');
  assert.ok(start > 0, '缺 .perm-wrap 样式');
  const sec = CSS.slice(start);
  for (const sel of ['.perm-card', '.perm-title', '.perm-badge', '.perm-risk.high', '.perm-risk.medium',
    '.perm-risk.low', '.perm-target', '.perm-cwd', '.perm-foot', '.perm-state', '.perm-loc-list',
    '.tool-status-tag.deny', '.tool-status-tag.processed']) {
    assert.ok(sec.indexOf(sel) >= 0, '缺样式 ' + sel);
  }
  assert.ok(sec.indexOf('linear-gradient') < 0, '权限卡样式不得使用渐变');
  assert.ok(!/position\s*:\s*fixed/.test(sec), '权限卡不得悬浮定位');
  assert.ok(/\.perm-card\{[^}]*border-radius:8px/.test(sec), '表面圆角 8px');
  assert.ok(/\.perm-target\{[^}]*border-radius:6px/.test(sec), '目标块圆角 6px');
  assert.ok(PAE.indexOf("'docs-btn primary'") >= 0, '主按钮复用 docs-btn primary');
  console.log('[PASS] CSS 规范');
})();

console.log('ACP_PERMISSION_UI_PASS: 权限请求卡前端全绿');
