'use strict';
// T3.5: AI事件管线 + 僵尸模式清零 + MaskStack唯一ESC 验证套件
// 覆盖: onEvent tool_call/thinking/error分支 / finishAiStream尾i5RenderDoneCards(isCancel)
//       模式变量零残留 / document keydown仅1处全局委托
//       i5AppendToolCall/i5UpdateThinkBox/i5AppendDiffAudit/i5AppendSnapshotCard/i5RenderErrorCard 实调
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const paePath = path.join(rootDir, 'js', 'project-ai-export.js');
const eePath = path.join(rootDir, 'js', 'edit-entry.js');
const maskPath = path.join(rootDir, 'js', 'mask-manager.js');
const sandboxPath = path.join(rootDir, 'js', 'sandbox-core.js');
const pae = fs.readFileSync(paePath, 'utf8');
const ee = fs.readFileSync(eePath, 'utf8');
const maskContent = fs.readFileSync(maskPath, 'utf8');
const sandboxContent = fs.readFileSync(sandboxPath, 'utf8');

function extract(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, `[提取失败] function ${name}`);
  return m[0];
}
function escHtmlStub(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this._className = '';
    const self0 = this;
    Object.defineProperty(this, 'className', {
      get() { return self0._className; },
      set(v) { self0._className = String(v == null ? '' : v); self0.classList._set = new Set(self0._className.split(/\s+/).filter(Boolean)); }
    });
    this.id = '';
    this.textContent = '';
    this._innerHTML = '';
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.disabled = false;
    this.title = '';
    this.value = '';
    this.options = [];
    this.onclick = null;
    this.onchange = null;
    this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 500;
    const self = this;
    this.classList = {
      _set: new Set(),
      add(...cs) { cs.forEach(c => { if (c) { self.classList._set.add(c); self._className = Array.from(self.classList._set).join(' '); } }); },
      remove(...cs) { cs.forEach(c => { if (c) { self.classList._set.delete(c); self._className = Array.from(self.classList._set).join(' '); } }); },
      toggle(c, force) { if (force === true) this.add(c); else if (force === false) this.remove(c); else if (self.classList._set.has(c)) this.remove(c); else this.add(c); },
      contains(c) { return self.classList._set.has(c); }
    };
  }
  set innerHTML(v) {
    this._innerHTML = String(v == null ? '' : v);
    const allow = new Set(['thinking-header', 'thinking-title-text', 'thinking-content', 'fold-indicator', 'err-card-actions', 'err-card-header', 'err-title', 'err-card-body', 'err-icon', 'changes-card-header', 'file-item-row', 'snapshot-info', 'snapshot-actions', 'followup-chips']);
    const re = /class=["']([^"']+)["']/g;
    let m; const seen = new Set();
    while ((m = re.exec(this._innerHTML))) {
      for (const c of m[1].split(/\s+/)) {
        if (!c || seen.has(c) || !allow.has(c)) continue;
        seen.add(c);
        const ch = new MockElement('div');
        ch.classList.add(c);
        this.appendChild(ch);
      }
    }
  }
  get innerHTML() { return this._innerHTML; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] != null ? this.attributes[k] : null; }
  appendChild(ch) { if (ch) { ch.parentNode = this; this.children.push(ch); } return ch; }
  insertBefore(nw, ref) {
    if (!nw) return nw;
    nw.parentNode = this;
    if (!ref) { this.children.unshift(nw); return nw; }
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.unshift(nw); else this.children.splice(i, 0, nw);
    return nw;
  }
  get firstChild() { return this.children[0] || null; }
  removeChild(ch) { const i = this.children.indexOf(ch); if (i >= 0) { ch.parentNode = null; this.children.splice(i, 1); } return ch; }
  querySelector(sel) {
    if (!sel) return null;
    if (sel.startsWith('.')) {
      if (this.classList.contains(sel.slice(1))) return this;
      for (const ch of this.children) { const r = ch.querySelector ? ch.querySelector(sel) : null; if (r) return r; }
    } else if (sel.startsWith('#')) {
      if (this.id === sel.slice(1)) return this;
      for (const ch of this.children) { const r = ch.querySelector ? ch.querySelector(sel) : null; if (r) return r; }
    } else {
      if (this.tagName.toLowerCase() === sel.toLowerCase()) return this;
      for (const ch of this.children) { const r = ch.querySelector ? ch.querySelector(sel) : null; if (r) return r; }
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const match = (el) => {
      if (sel === 'button' && el.tagName === 'BUTTON') return true;
      if (sel.startsWith('.') && el.classList && el.classList.contains(sel.slice(1))) return true;
      return false;
    };
    if (match(this)) out.push(this);
    for (const ch of this.children) { if (ch.querySelectorAll) out.push(...ch.querySelectorAll(sel)); }
    return out;
  }
}
function makeMockDoc() {
  return {
    getElementById: () => null,
    createElement: (t) => new MockElement(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}, removeEventListener: () => {},
    body: new MockElement('body'), documentElement: new MockElement('html')
  };
}

// ========== 静态1: onEvent含tool_call/thinking/error三分支 ==========
function testS1_OnEventPipeline() {
  assert.ok(/ev\.type\s*===\s*['"]tool_call['"][\s\S]{0,300}i5AppendToolCall\s*\(/.test(pae),
    '[静态失败] onEvent缺tool_call分支或未调i5AppendToolCall(ev)');
  assert.ok(!/ev\.type\s*===\s*['"]thinking['"][\s\S]{0,800}i5UpdateThinkBox\s*\(/.test(pae),
    '[静态失败] thinking分支不应再调i5UpdateThinkBox（折叠盒已下线，只留弹窗）');
  assert.ok(/ev\.type\s*===\s*['"]error['"][\s\S]{0,600}i5RenderErrorCard\s*\(/.test(pae),
    '[静态失败] onEvent error分支未调i5RenderErrorCard(ev)');
  assert.ok(/aiBubbleError/.test(pae), '[静态失败] aiBubbleError兜底被误删，error分支须保留');
  assert.ok(/ev\.type\s*===\s*['"]done['"][\s\S]{0,200}finishAiStream\s*\(\s*false\s*\)/.test(pae),
    '[静态失败] onEvent done分支须finishAiStream(false)');
  // session分支须与error/finish同口径含SESS_KEY守卫，否则运行中k=ai_sessions_v2_#s_..落入aiWriteSeshFor空读，oid静默丢失
  assert.ok(/ev\.type\s*===\s*['"]session['"][\s\S]{0,400}indexOf\(SESS_KEY\)===0/.test(pae),
    '[静态失败] onEvent session分支缺SESS_KEY守卫，运行中oid无法落盘');
}

// ========== 运行1b: session事件oid落盘仿真（复现：无记忆Bug） ==========
function testR1b_SessionOidPersist() {
  const SESS_KEY = 'ai_sessions_v2_';
  const aiHistKey = () => 'ai_hist_ROOT';
  let aiActiveKey = SESS_KEY + '#' + encodeURIComponent('s_abc123'); // aiDoSend设置值
  const aiActiveHistKey = () => aiActiveKey || aiHistKey();
  const aiSession = { id: 's_abc123', m: [], oid: '' };
  // 提取生产session分支的判定条件（k===aiHistKey()||(k&&k.indexOf(SESS_KEY)===0)）
  const seg = pae.match(/if\(ev\.type==='session'\)[\s\S]{0,400}aiWriteSeshFor/);
  assert.ok(seg, '[提取失败] session分支');
  const hasGuard = /indexOf\(SESS_KEY\)===0/.test(seg[0]);
  assert.ok(hasGuard, '[静态失败] session分支无SESS_KEY守卫');
  // 用生产同判定仿真：运行中k应走内存落盘分支
  const k = aiActiveHistKey();
  const takeMemoryPath = (k === aiHistKey() || (k && k.indexOf(SESS_KEY) === 0));
  assert.ok(takeMemoryPath, `运行中k=${k}应走内存落盘分支`);
  if (takeMemoryPath) { aiSession.oid = 'ses_repro123'; }
  assert.strictEqual(aiSession.oid, 'ses_repro123', 'oid应落盘到内存会话');
  // 落盘oid可拼出-s续接参数（经真实opencode def）
  const { getAgentDef } = require(path.join(rootDir, 'runtimes', 'registry'));
  const args = getAgentDef('opencode').buildArgs('hi', [], [], {}, { cwd: 'C:\\sbx', resumeSessionId: aiSession.oid });
  assert.ok(args.includes('-s') && args.includes('ses_repro123'), `应含-s续接，实际${JSON.stringify(args)}`);
}

// ========== 静态2: finishAiStream尾调i5RenderDoneCards(isCancel) ==========
function testS2_FinishTail() {
  const idx = pae.indexOf('function finishAiStream');
  assert.ok(idx >= 0, '[静态失败] 缺function finishAiStream');
  const body = pae.slice(idx, idx + 6000);
  assert.ok(/function\s+finishAiStream\s*\(\s*isCancel\s*\)/.test(body),
    '[静态失败] finishAiStream签名须为(isCancel)');
  assert.ok(/i5RenderDoneCards\s*\(\s*isCancel\s*\)/.test(body),
    '[静态失败] finishAiStream尾缺i5RenderDoneCards(isCancel)');
  const aiIdx = pae.indexOf('function aiShouldAutoScroll');
  if (aiIdx >= 0) {
    const aiBody = pae.slice(aiIdx, aiIdx + 800);
    assert.ok(!/i5RenderDoneCards/.test(aiBody), '[静态失败] aiShouldAutoScroll内不应调i5RenderDoneCards');
  }
}

// ========== 静态3: 僵尸模式变量零残留 ==========
function testS3_EditModeZero() {
  for (const [nm, content] of [['edit-entry.js', ee], ['project-ai-export.js', pae], ['sandbox-core.js', sandboxContent]]) {
    assert.ok(!/EDIT_MODE/.test(content), `[静态失败] ${nm}仍含EDIT_MODE残留`);
  }
  assert.ok(/CTRL_PICK/.test(ee) && /bindCtrlInspectListeners/.test(ee), '[静态失败] CTRL_PICK接管逻辑缺失');
}

// ========== 静态4: MaskStack唯一ESC ==========
function testS4_SingleEsc() {
  const cnt = (pae.match(/document\.addEventListener\s*\(\s*['"]keydown['"]/g) || []).length;
  assert.strictEqual(cnt, 1, `[静态失败] project-ai-export.js document keydown应仅剩1处全局委托，实测${cnt}处`);
  assert.ok(/window\.MaskStack\s*&&\s*window\.MaskStack\.stack/.test(pae), '[静态失败] 剩余委托须优先判断MaskStack.stack');
  const mCnt = (maskContent.match(/document\.addEventListener\s*\(\s*['"]keydown['"]/g) || []).length;
  assert.strictEqual(mCnt, 1, '[静态失败] mask-manager.js须保留唯一ESC监听');
}

// ========== 运行5: i5AppendToolCall卡片 ==========
function testR5_ToolCall() {
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const aiChatView = new MockElement('div');
  aiChatView.scrollHeight = 1000; aiChatView.scrollTop = 0; aiChatView.clientHeight = 500;
  const src = extract(pae, 'i5EnsureToolStream') + '\n' + extract(pae, 'i5ToolName') + '\n' + extract(pae, 'i5ToolParam') + '\n' + extract(pae, 'i5AppendToolCall');
  const _st = global.setTimeout; global.setTimeout = () => 0;
  try {
    const run = (ev) => new Function('ev', 'document', 'aiStreaming', 'aiChatView', 'aiUserScrolledPause', 'aiShouldAutoScroll', 'aiAppendTrace', 'setTimeout',
      src + '\nreturn i5AppendToolCall(ev);')(ev, mockDoc, aiStreaming, aiChatView, false, () => true, () => {}, global.setTimeout);
    run({ tool: 'readFile', path: 'index.html' });
    const stream = aiStreaming.querySelector('.tool-execution-stream');
    assert.ok(stream, '须生成.tool-execution-stream');
    const card = aiStreaming.querySelector('.tool-call-card');
    assert.ok(card, '须生成.tool-call-card');
    assert.ok(card.querySelector('.tool-call-left') && card.querySelector('.tool-name') && card.querySelector('.tool-param'), '卡片须含tool-call-left/tool-name/tool-param');
    assert.strictEqual(card.querySelector('.tool-name').textContent, 'readFile', 'tool-name取值');
    assert.ok(card.querySelector('.tool-status-tag'), '须含tool-status-tag');
    assert.ok(card.querySelector('.tool-status-tag').className.includes('running'), '默认running/执行中');
    run({ tool: 'writeFile', path: 'a.html', status: 'done' });
    const cards = stream.querySelectorAll('.tool-call-card');
    assert.strictEqual(cards.length, 2, '第二通tool_call追加卡片');
    assert.ok(cards[1].querySelector('.tool-status-tag').className.includes('done'), 'done->.done/完成');
    run({ tool: 'lint', status: 'queued' });
    assert.ok(stream.querySelectorAll('.tool-call-card')[2].querySelector('.tool-status-tag').className.includes('waiting'), 'queued->.waiting/等待中');
  } finally { global.setTimeout = _st; }
}

// ========== 运行6: i5UpdateThinkBox ==========
function testR6_ThinkBox() {
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const aiChatView = new MockElement('div');
  const src = extract(pae, 'i5EnsureThinkBox') + '\n' + extract(pae, 'i5UpdateThinkBox');
  const run = (think) => new Function('document', 'aiStreaming', 'aiChatView', 'aiStreamThink', 'aiThinkStart',
    src + '\nreturn i5UpdateThinkBox();')(mockDoc, aiStreaming, aiChatView, think, Date.now() - 5000);
  run('正在分析原型结构...');
  const box = aiStreaming.querySelector('.thinking-box');
  assert.ok(box && box.className.includes('thinking-box'), '须生成.thinking-box');
  assert.ok(box.querySelector('.thinking-title-text').textContent.includes('正在思考'), '标题含正在思考+耗时/字数');
  assert.ok(box.querySelector('.thinking-content').textContent.includes('正在分析'), '内容区写入aiStreamThink');
  run('');
  assert.ok(aiStreaming.querySelector('.thinking-box'), '空思考复用同一box不重建');
}

// ========== 运行7: Diff/快照卡片 ==========
function testR7_DiffSnap() {
  const mockDoc = makeMockDoc();
  const chatView = new MockElement('div');
  const helperSrc = extract(pae, 'i5CurSubFile') + '\n' + extract(pae, 'i5SubFileRow') + '\n';
  const dSrc = helperSrc + extract(pae, 'i5AppendDiffAudit');
  const sSrc = helperSrc + extract(pae, 'i5AppendSnapshotCard');
  const diff = new Function('container', 'filesInfo', 'document', 'aiChatView', 'escHtml', dSrc + '\nreturn i5AppendDiffAudit(container, filesInfo);')(chatView, 'index.html (+28/-6)', mockDoc, chatView, escHtmlStub);
  assert.ok(diff && diff.className === 'file-changes-card', 'Diff类名file-changes-card');
  assert.ok(!diff.innerHTML.includes('查看 Diff') && !diff.innerHTML.includes('btn-diff-view'), 'Diff须无查看Diff/btn-diff-view');
  assert.ok(diff.innerHTML.includes('变更') && diff.innerHTML.includes('index.html'), 'Diff须含有变更tag与文件名');
  const snap = new Function('container', 'snapInfo', 'document', 'aiChatView', 'escHtml', sSrc + '\nreturn i5AppendSnapshotCard(container, snapInfo);')(chatView, '快照 #14 已生成', mockDoc, chatView, escHtmlStub);
  assert.ok(snap && snap.className === 'snapshot-card', '快照类名snapshot-card');
  assert.ok(snap.innerHTML.includes('一键回滚') && snap.innerHTML.includes('btn-rollback'), '快照须含一键回滚/btn-rollback');
  assert.ok(!snap.innerHTML.includes('刷新预览') && !snap.innerHTML.includes('btn-refresh-preview'), '快照须无刷新预览/btn-refresh-preview');
  const bubSrc = extract(pae, 'aiRenderBubbles');
  assert.ok(!/isLast/.test(bubSrc), 'aiRenderBubbles须无isLast区分');
  assert.ok(/fold\.open\s*=\s*true/.test(bubSrc) && /AI 回复/.test(bubSrc), 'aiRenderBubbles新旧AI消息同样展开');
  assert.ok(!/AI 回复（最新）/.test(bubSrc) && !/点击展开/.test(bubSrc), 'aiRenderBubbles不再有最新/点击展开之分');
}

// ========== 运行8: i5RenderErrorCard结构化卡片 ==========
function testR8_ErrorCard() {
  const mockDoc = makeMockDoc();
  const mk = () => { const c = new MockElement('div'); c.scrollHeight = 500; return c; };
  const src = extract(pae, 'i5ClassifyError') + '\n' + extract(pae, 'i5RenderErrorCard');
  const run = (chatView, ev) => new Function('ev', 'document', 'aiChatView', 'escHtml', 'scrubAiChatView',
    src + '\nreturn i5RenderErrorCard(ev);')(ev, mockDoc, chatView, escHtmlStub, () => {});
  let cv = mk();
  run(cv, { code: '429', message: 'Quota exhausted' });
  let w = cv.children[0];
  assert.ok(w.className.includes('ai-error-card'), '错误卡片ai-error-card');
  assert.ok(w.innerHTML.includes('err-card-header') && w.innerHTML.includes('err-card-body') && w.innerHTML.includes('err-card-actions'), '须含header/body/actions');
  const btns = w.querySelectorAll('button');
  assert.ok(btns.length === 3, '429应3按钮(设Key/切免费/重试)');
  assert.ok(btns.every(b => b.className.includes('btn-err-action')), '按钮btn-err-action');
  assert.ok(btns[0].getAttribute('data-js'), '按钮带data-js');
  cv = mk(); run(cv, { code: '401', message: 'Invalid API Key' });
  assert.ok(cv.children[0].innerHTML.includes('err-card-header'), '401卡片');
  assert.strictEqual(cv.children[0].querySelectorAll('button').length, 2, '401应2按钮');
  cv = mk(); run(cv, { title: 'boom', message: 'x' });
  assert.ok(cv.children[0].querySelectorAll('button').length === 2, 'unknown应2按钮(日志/重试)');
}

function runAll() {
  let p = 0, f = 0;
  const ts = [['S1 onEvent管线', testS1_OnEventPipeline], ['R1b session落盘', testR1b_SessionOidPersist], ['S2 finish尾', testS2_FinishTail], ['S3 模式清零', testS3_EditModeZero], ['S4 唯一ESC', testS4_SingleEsc], ['R5 tool_call卡片', testR5_ToolCall], ['R7 Diff/快照', testR7_DiffSnap], ['R8 ErrorCard', testR8_ErrorCard]];
  for (const [t, fn] of ts) { try { fn(); console.log(`[PASS] ${t}`); p++; } catch (e) { console.error(`[FAIL] ${t}`); console.error(e); f++; } }
  console.log(`SUMMARY passed=${p} failed=${f}\n`);
  if (f) process.exit(1);
}
runAll();
