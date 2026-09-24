'use strict';
// T3.5: AI事件管线 + 僵尸模式清零 + MaskStack唯一ESC 验证套件（AI执行流展示-2.8/8章同步版）
// 覆盖: onEvent tool_call/thinking/error分支 / finishAiStream尾i5RenderDoneCards(isCancel)
//       模式变量零残留 / document keydown仅1处全局委托
//       动词映射i5VerbKind/i5VerbLabel实调 + i5ExploreAdd累计 / 思考切分i5SplitThink / 光标i5-cursor+编辑i5EditFinalize
//       done.fileChanges新字段（sandbox-storage + ai-process onClose）/ 历史回放i5ReplayTimeline+i5ReplayV1
//       审计卡i5AppendDiffAudit必须不存在 + 快照卡i5AppendSnapshotCard + i5RenderErrorCard 实调
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = 'D:\\文件\\工具\\原型工具-PlanD';
const paePath = path.join(rootDir, 'js', 'project-ai-export.js');
const eePath = path.join(rootDir, 'js', 'edit-entry.js');
const maskPath = path.join(rootDir, 'js', 'mask-manager.js');
const sandboxPath = path.join(rootDir, 'js', 'sandbox-core.js');
const cssPath = path.join(rootDir, 'app.css');
const sbStorePath = path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js');
const aiProcPath = path.join(rootDir, 'main', 'services', 'ai-process-service.js');
const pae = fs.readFileSync(paePath, 'utf8');
const ee = fs.readFileSync(eePath, 'utf8');
const maskContent = fs.readFileSync(maskPath, 'utf8');
const sandboxContent = fs.readFileSync(sandboxPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const sbStoreContent = fs.readFileSync(sbStorePath, 'utf8');
const aiProcContent = fs.readFileSync(aiProcPath, 'utf8');

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
    this.nodeType = 1;
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
    const allow = new Set(['thinking-header', 'thinking-title-text', 'thinking-content', 'fold-indicator', 'err-card-actions', 'err-card-header', 'err-title', 'err-card-body', 'err-icon', 'changes-card-header', 'file-item-row', 'snapshot-info', 'snapshot-actions']);
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
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get previousSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return i > 0 ? this.parentNode.children[i - 1] : null; }
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
function collectText(el) {
  let s = String((el && el.textContent) || '') + ' ' + String((el && el.innerHTML) || '');
  for (const ch of ((el && el.children) || [])) s += ' ' + collectText(ch);
  return s;
}
function collectClass(el) {
  let s = ' ' + String((el && el.className) || '');
  for (const ch of ((el && el.children) || [])) s += collectClass(ch);
  return s;
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
  const body = pae.slice(idx, idx + 7000);
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

// ========== 运行5: 动词映射 + 已探索累计（2.2/5.4） ==========
function testR5_VerbExplore() {
  const kindSrc = extract(pae, 'i5VerbKind');
  const labelSrc = extract(pae, 'i5VerbLabel');
  const kind = new Function(kindSrc + '\nreturn i5VerbKind;')();
  const label = new Function(kindSrc + '\n' + labelSrc + '\nreturn i5VerbLabel;')();
  // read/glob/grep → 已探索
  assert.strictEqual(kind('readFile'), 'explore', 'read应映射explore');
  assert.strictEqual(kind('glob'), 'explore', 'glob应映射explore');
  assert.strictEqual(kind('grep'), 'explore', 'grep应映射explore');
  assert.strictEqual(label('explore'), '已探索', 'explore标签已探索');
  // edit/write/apply → 编辑
  assert.strictEqual(kind('edit'), 'edit', 'edit应映射edit');
  assert.strictEqual(kind('writeFile'), 'edit', 'write应映射edit');
  assert.strictEqual(kind('applyPatch'), 'edit', 'apply应映射edit');
  assert.strictEqual(label('edit'), '编辑', 'edit标签编辑');
  // exec/bash/shell → Shell
  assert.strictEqual(kind('exec'), 'shell', 'exec应映射shell');
  assert.strictEqual(kind('bash'), 'shell', 'bash应映射shell');
  assert.strictEqual(kind('shell'), 'shell', 'shell应映射shell');
  assert.strictEqual(label('shell'), 'Shell', 'shell标签Shell');
  // 未知回落原文
  assert.strictEqual(kind('zzzQQQ999'), 'unknown', '未知工具应unknown');
  assert.strictEqual(label('unknown', 'zzzQQQ999'), 'zzzQQQ999', '未知标签应回落原文');
  // 同文件多读累计（i5ExploreAdd）：同一文件读两次按次累计
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const aiChatView = new MockElement('div');
  const src = extract(pae, 'i5ToolName') + '\n' + extract(pae, 'i5ExtractToolFile') + '\n' + extract(pae, 'i5IsDirPath') + '\n'
    + extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + 'function i5TlScroll(){}\n' + extract(pae, 'i5ExploreAdd')
    + '\nvar aiTlReadCount=0, aiTlDirCount=0, aiTlReadFiles=[], aiTlExploreRow=null, aiTlExploreCountEl=null, aiTlExploreChipsEl=null;'
    + '\ni5ExploreAdd({tool:"readFile", path:"a.html"});'
    + '\nvar c1 = aiTlExploreCountEl ? aiTlExploreCountEl.textContent : "";'
    + '\ni5ExploreAdd({tool:"readFile", path:"a.html"});'
    + '\nreturn {c1:c1, cnt: aiTlExploreCountEl?aiTlExploreCountEl.textContent:"", chips: aiTlExploreChipsEl?aiTlExploreChipsEl.children.filter(function(c){return c.tagName==="CODE";}).length:-1, verb: aiTlExploreRow?aiTlExploreRow.querySelector(".i5-verb").textContent:"", rowCls: aiTlExploreRow?aiTlExploreRow.className:"", chipsCls: aiTlExploreChipsEl?aiTlExploreChipsEl.className:"", rowTags: aiTlExploreRow?aiTlExploreRow.children.map(function(c){return c.tagName;}).join(","):"", curInRow: (function(){var ch=aiTlExploreRow?aiTlExploreRow.children:[];var l=ch.length?ch[ch.length-1]:null;return l?l.className:"";})(), cntPos: (function(){var ch=aiTlExploreRow?aiTlExploreRow.children:[];for(var i=0;i<ch.length;i++){if(String(ch[i].className).split(" ").indexOf("n")>=0)return i;}return -1;})()};';
  const r = new Function('document', 'aiStreaming', 'aiChatView', src)(mockDoc, aiStreaming, aiChatView);
  assert.strictEqual(r.c1, '1 次读取', `首次读取计数，实测${r.c1}`);
  assert.strictEqual(r.cnt, '2 次读取', `同文件多读应累计2次，实测${r.cnt}`);
  assert.strictEqual(r.chips, 2, '同文件多读chips按次追加');
  assert.strictEqual(r.verb, '已探索', '聚合行动词已探索');
  // 原型原名双类：exp/i5-explore + exp-files/i5-chips（旧.i5-*仅兼容保留）
  assert.ok(String(r.rowCls).split(/\s+/).includes('exp') && String(r.rowCls).split(/\s+/).includes('i5-explore'), `已探索行须双类exp+i5-explore，实测${r.rowCls}`);
  assert.ok(String(r.chipsCls).split(/\s+/).includes('exp-files') && String(r.chipsCls).split(/\s+/).includes('i5-chips'), `chips行须双类exp-files+i5-chips，实测${r.chipsCls}`);
  // 单行顺序：已探索 ｜ 文件chips ｜ 次数，光标跟行末
  assert.strictEqual(r.rowTags, 'B,SPAN,SPAN,SPAN', `行内顺序须动词-文件-次数-光标，实测${r.rowTags}`);
  assert.ok(String(r.curInRow).split(/\s+/).includes('cursor'), `光标须在行末，实测${r.curInRow}`);
  assert.strictEqual(r.cntPos, 2, `次数须在第三位，实测${r.cntPos}`);
  // 多exp块：累计N + 本块chips（思考穿插后另起一块，计数累计、chips只列本块新文件）
  const mockDoc5b = makeMockDoc();
  const aiStreaming5b = new MockElement('div');
  const aiChatView5b = new MockElement('div');
  const src5b = extract(pae, 'i5ToolName') + '\n' + extract(pae, 'i5ExtractToolFile') + '\n' + extract(pae, 'i5IsDirPath') + '\n'
    + extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + 'function i5TlScroll(){}\n' + extract(pae, 'i5ExploreAdd')
    + '\nvar aiTlReadCount=0, aiTlDirCount=0, aiTlReadFiles=[], aiTlExploreRow=null, aiTlExploreCountEl=null, aiTlExploreChipsEl=null;'
    + '\ni5ExploreAdd({tool:"readFile", path:"a.html"});'
    + '\nvar _b1row = aiTlExploreRow; var _b1chips = aiTlExploreChipsEl; var _b1cnt = aiTlExploreCountEl?aiTlExploreCountEl.textContent:"";'
    + '\nvar _tl5 = aiStreaming.querySelector(".i5-timeline");'
    + '\nvar _th = document.createElement("div"); _th.className="think-p i5-think-p"; _th.textContent="思考穿插"; _tl5.appendChild(_th);'
    + '\ni5ExploreAdd({tool:"readFile", path:"b.html"});'
    + '\nvar _b2row = aiTlExploreRow; var _b2chips = aiTlExploreChipsEl;'
    + '\nvar _expRows = _tl5.querySelectorAll(".exp");'
    + '\nreturn {b1cnt:_b1cnt, b2cnt: aiTlExploreCountEl?aiTlExploreCountEl.textContent:"", diff: _b1row!==_b2row, expN:_expRows.length, b1chips:_b1chips?_b1chips.children.filter(function(c){return c.tagName==="CODE";}).length:-1, b2chips:_b2chips?_b2chips.children.filter(function(c){return c.tagName==="CODE";}).length:-1, b2cls:_b2row?_b2row.className:""};';
  const r5b = new Function('document', 'aiStreaming', 'aiChatView', src5b)(mockDoc5b, aiStreaming5b, aiChatView5b);
  assert.ok(r5b.diff, '思考穿插后应另起exp块（不同row对象）');
  assert.strictEqual(r5b.b1cnt, '1 次读取', `首块计数，实测${r5b.b1cnt}`);
  assert.strictEqual(r5b.b2cnt, '2 次读取', `次块计数应累计N=2，实测${r5b.b2cnt}`);
  assert.strictEqual(r5b.expN, 2, `应有2个exp块，实测${r5b.expN}`);
  assert.strictEqual(r5b.b1chips, 1, '首块chips只列本块1文件');
  assert.strictEqual(r5b.b2chips, 1, '次块chips只列本块新文件b.html');
  assert.ok(String(r5b.b2cls).includes('exp'), '次块行主类名exp');
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

// ========== 运行7: 审计卡必须不存在 + 快照卡（span结构兼容） + 多exp块静态 ==========
function testR7_NoAuditSnap() {
  // 2.8 审计卡删除三断言：定义/调用/任意引用均须为零
  assert.ok(!/function\s+i5AppendDiffAudit\b/.test(pae), '[静态失败] i5AppendDiffAudit定义应已彻底删除');
  assert.ok(!/i5AppendDiffAudit\s*\(/.test(pae), '[静态失败] i5AppendDiffAudit调用应已彻底删除');
  assert.ok(!pae.includes('i5AppendDiffAudit'), '[静态失败] pae内不应残留i5AppendDiffAudit任意引用');
  // 多exp块静态：思考/工具穿插后另起一块（累计N+本块chips），行主类名原型双类
  const expSrc = extract(pae, 'i5ExploreAdd');
  assert.ok(/aiTlExploreRow\s*=\s*null/.test(expSrc), 'i5ExploreAdd须含另起块重置（穿插后aiTlExploreRow=null）');
  assert.ok(/exp i5-explore/.test(pae) && /exp-files i5-chips/.test(pae), '已探索行须原型双类exp/i5-explore + exp-files/i5-chips');
  // 快照卡保留仿真（snapshot-card/一键回滚/btn-rollback，无刷新预览；span结构只断言文本/类名，不锁div/span标签）
  const mockDoc = makeMockDoc();
  const chatView = new MockElement('div');
  const helperSrc = extract(pae, 'i5CurSubFile') + '\n' + extract(pae, 'i5SubFileRow') + '\n';
  const sSrc = helperSrc + extract(pae, 'i5AppendSnapshotCard');
  const snap = new Function('container', 'snapInfo', 'document', 'aiChatView', 'escHtml', sSrc + '\nreturn i5AppendSnapshotCard(container, snapInfo);')(chatView, '快照 #14 已生成', mockDoc, chatView, escHtmlStub);
  assert.ok(snap && snap.className === 'snapshot-card', '快照类名snapshot-card');
  const txt = collectText(snap);
  const cls = collectClass(snap);
  assert.ok(txt.includes('一键回滚'), '快照须含一键回滚文案');
  assert.ok(cls.includes('btn-rollback'), '快照须含btn-rollback');
  assert.ok(snap.querySelector('.snapshot-info'), '快照须含.snapshot-info（不锁标签）');
  assert.ok(snap.querySelector('.snapshot-actions'), '快照须含.snapshot-actions（不锁标签）');
  assert.ok(!txt.includes('刷新预览') && !cls.includes('btn-refresh-preview'), '快照须无刷新预览/btn-refresh-preview');
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

// ========== 运行9: 思考切分 i5SplitThink（2.3） ==========
function testR9_ThinkSplit() {
  const split = new Function(extract(pae, 'i5SplitThink') + '\nreturn i5SplitThink;')();
  // 终结符 。！？立即落段
  let r = split('你好。你在吗？我在！');
  assert.strictEqual(r.list.length, 3, `中文终结符应切3段，实测${JSON.stringify(r)}`);
  assert.ok(r.list[0].includes('你好') && r.list[1].includes('你在吗') && r.list[2].includes('我在'), '切分内容');
  // 英文句号guard：3.5/v2.0/e.g.不切
  r = split('版本3.5很好用');
  assert.strictEqual(r.list.length, 0, `3.5不应切碎，实测${JSON.stringify(r)}`);
  r = split('升级到v2.0了');
  assert.strictEqual(r.list.length, 0, `v2.0不应切碎，实测${JSON.stringify(r)}`);
  r = split('比如e.g.这样不切。下一句。');
  assert.ok(r.list.length === 2 && r.list[0].includes('e.g.'), `e.g.内句号不应切碎，实测${JSON.stringify(r)}`);
  r = split('Hello. Next');
  assert.ok(r.list.length === 1 && r.list[0] === 'Hello.', `英文句号+空格大写应切，实测${JSON.stringify(r)}`);
  r = split('Hello. next');
  assert.strictEqual(r.list.length, 0, `英文句号+小写不应切，实测${JSON.stringify(r)}`);
  // \n\n分段（权重最高）
  r = split('第一段\n\n第二段');
  assert.ok(r.list.length === 1 && r.list[0] === '第一段' && r.rest === '第二段', `双换行应分段，实测${JSON.stringify(r)}`);
  // ```围栏暂停
  r = split('思考```code.inside();```继续。下一句。');
  assert.ok(r.list.length === 2 && r.list[0].includes('```'), `围栏内句号不应切碎，实测${JSON.stringify(r)}`);
  // flush语义：只断言函数存在，不碰定时器
  assert.ok(/function\s+i5ThinkFlushPending\b/.test(pae), '缺function i5ThinkFlushPending');
  assert.ok(/function\s+i5ThinkAppendChunk\b/.test(pae), '缺function i5ThinkAppendChunk');
  assert.ok(/function\s+i5TlAppendThinkPara\b/.test(pae), '缺function i5TlAppendThinkPara');
}

// ========== 运行10: 光标复用 + 编辑完成态（2.3/2.4，原型双类+半角减号） ==========
function testR10_CursorEdit() {
  // 静态：原型.cursor + 兼容.i5-cursor均复用i5blink
  assert.ok(cssContent.includes('.i5-cursor'), 'app.css缺.i5-cursor');
  assert.ok(cssContent.includes('.cursor'), 'app.css缺原型.cursor');
  assert.ok(/\.i5-cursor\s*\{[^}]*i5blink/.test(cssContent), 'i5-cursor须复用i5blink闪烁');
  assert.ok(/\.cursor\s*\{[^}]*i5blink/.test(cssContent), '原型.cursor须复用i5blink闪烁');
  assert.ok(/@keyframes\s+i5blink\b/.test(cssContent), 'app.css缺@keyframes i5blink');
  assert.ok(/function\s+i5TlMoveCursorTo\b/.test(pae) && /i5-cursor/.test(pae), 'i5TlMoveCursorTo须创建i5-cursor');
  assert.ok(/cursor i5-cursor/.test(pae), '光标须双类cursor i5-cursor（原型原名优先）');
  // 静态：编辑完成态含 +/- 逻辑（半角减号，不再是U+2212）
  const finSrc = extract(pae, 'i5EditFinalize');
  assert.ok(/i5-add/.test(finSrc) && /i5-del/.test(finSrc), 'i5EditFinalize须含i5-add/i5-del');
  assert.ok(/'add i5-add'/.test(finSrc) && /'del i5-del'/.test(finSrc), 'i5EditFinalize须含原型add/del双类');
  assert.ok(/added/.test(finSrc) && /deleted/.test(finSrc), 'i5EditFinalize须透传added/deleted');
  assert.ok(!finSrc.includes('\u2212'), 'i5EditFinalize不得含U+2212，必须半角-');
  // 实调：编辑行 +14 -1（半角减号）
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const aiChatView = new MockElement('div');
  const wrap = extract(pae, 'i5ExtractToolFile') + '\n' + extract(pae, 'i5ToolRawParam') + '\n' + extract(pae, 'i5CurSubFile') + '\n'
    + extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + 'function i5TlScroll(){}\n' + extract(pae, 'i5EditAdd') + '\n' + extract(pae, 'i5EditFinalize')
    + '\nvar aiTlEditRows=[];'
    + '\nvar row=i5EditAdd({tool:"edit", path:"src/a.html"});'
    + '\nvar fileName = row ? collectText(row) : "";'
    + '\nvar rowCls0 = row ? row.className : "";'
    + '\ni5EditFinalize([{path:"src/a.html", action:"modified", added:14, deleted:1}]);'
    + '\nvar addEl = row ? row.querySelector(".i5-add") : null;'
    + '\nvar delEl = row ? row.querySelector(".i5-del") : null;'
    + '\nvar addEl2 = row ? row.querySelector(".add") : null;'
    + '\nvar delEl2 = row ? row.querySelector(".del") : null;'
    + '\nreturn {hasRow: !!row, fileName: fileName, rowCls: rowCls0, add: addEl?addEl.textContent:"", del: delEl?delEl.textContent:"", add2: addEl2?addEl2.textContent:"", del2: delEl2?delEl2.textContent:""};';
  const run = new Function('document', 'aiStreaming', 'aiChatView', 'collectText', 'curHtmlFile', 'isMainFile', 'escHtml', wrap);
  const out = run(mockDoc, aiStreaming, aiChatView, collectText, undefined, undefined, escHtmlStub);
  assert.ok(out.hasRow, 'i5EditAdd应生成编辑行');
  assert.ok(String(out.fileName).includes('a.html'), `编辑行须含纯文件名回落，实测${out.fileName}`);
  assert.ok(String(out.rowCls).includes('edit-row'), `编辑行主类名edit-row，实测${out.rowCls}`);
  assert.strictEqual(out.add, '+14', `完成态增量，实测${out.add}`);
  assert.strictEqual(out.del, '-1', `完成态减量半角-，实测${out.del}`);
  assert.strictEqual(out.add2, '+14', '原型.add同步可查');
  assert.strictEqual(out.del2, '-1', '原型.del同步可查半角-');
  assert.ok(!String(out.del).includes('\u2212'), '减量不得含U+2212');
  // 失败回落：空fileChanges不断言过细，只做存在性+不抛错
  const wrap2 = extract(pae, 'i5ExtractToolFile') + '\n' + extract(pae, 'i5ToolRawParam') + '\n' + extract(pae, 'i5CurSubFile') + '\n'
    + extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + 'function i5TlScroll(){}\n' + extract(pae, 'i5EditAdd') + '\n' + extract(pae, 'i5EditFinalize')
    + '\nvar aiTlEditRows=[];'
    + '\nvar row2=i5EditAdd({tool:"edit", path:"b.html"});'
    + '\ni5EditFinalize([]);'
    + '\nreturn {hasRow: !!row2};';
  assert.doesNotThrow(() => new Function('document', 'aiStreaming', 'aiChatView', 'curHtmlFile', 'isMainFile', 'escHtml', wrap2)(makeMockDoc(), new MockElement('div'), new MockElement('div'), undefined, undefined, escHtmlStub), '空fileChanges不应抛错');
}

// ========== 静态5: done新字段（5.1/6.2：added/deleted透传） ==========
function testS5_DoneFields() {
  for (const fn of ['isDiffableTextFile', 'snapshotProtoFileContents', 'countTextLines', 'diffTextLines', 'diffFileContents', 'diffFileSignatures']) {
    assert.ok(new RegExp('function\\s+' + fn + '\\b').test(sbStoreContent), `[静态失败] sandbox-storage缺function ${fn}`);
  }
  assert.ok(/function\s+diffFileSignatures\s*\(\s*beforeMap\s*,\s*afterMap\s*,\s*beforeContents/.test(sbStoreContent), 'diffFileSignatures须扩展可选参数(beforeContents/afterContents)');
  assert.ok(/added/.test(sbStoreContent) && /deleted/.test(sbStoreContent), 'sandbox-storage须含added/deleted行数逻辑');
  assert.ok(/\.added\s*=\s*nums\.added/.test(sbStoreContent) && /\.deleted\s*=\s*nums\.deleted/.test(sbStoreContent), 'diffFileSignatures须返回{path,action,added,deleted}');
  assert.ok(/onClose/.test(aiProcContent), 'ai-process缺onClose');
  assert.ok(/type:\s*['"]done['"]/.test(aiProcContent) && /fileChanges/.test(aiProcContent), 'onClose须emit done含fileChanges');
  assert.ok(/diffFileSignatures/.test(aiProcContent), 'onClose须调diffFileSignatures富化fileChanges');
  assert.ok(/snapshotProtoFileContents/.test(aiProcContent), 'onClose须调snapshotProtoFileContents做快照diff');
}

// ========== 运行12: 历史回放 v2 + v1降级（第3章，原型双类+多exp块+半角减号） ==========
function testR12_Replay() {
  assert.ok(/function\s+i5ReplayTimeline\b/.test(pae), '缺function i5ReplayTimeline');
  assert.ok(/function\s+i5ReplayV1\b/.test(pae), '缺function i5ReplayV1');
  // v2轻仿真：事件流按序重走（思考切分 + 已探索聚合），只做存在性+计数，避免脆弱
  const mockDoc = makeMockDoc();
  const cont = new MockElement('div');
  const src = extract(pae, 'i5SplitThink') + '\n' + extract(pae, 'i5VerbKind') + '\n' + extract(pae, 'i5FmtMsgTime') + '\n'
    + extract(pae, 'i5CopySvg') + '\n' + extract(pae, 'i5CreateCopyIconBtn') + '\n' + extract(pae, 'i5ReplayTimeline')
    + '\nvar tl=i5ReplayTimeline(container, [{t:"thinking", text:"你好。世界。"}, {t:"tool", tool:"readFile", file:"a.html"}], {});'
    + '\nreturn {hasTl: !!tl, cls: tl?tl.className:"", thinkN: tl?tl.querySelectorAll(".i5-think-p").length:-1, verb: (function(){var v=tl?tl.querySelector(".i5-verb"):null; return v?v.textContent:"";})()};';
  const run = new Function('container', 'document', 'escHtml', 'formatAiTextConclusionOnly', 'openSnapPanel', src);
  const out = run(cont, mockDoc, escHtmlStub, (s) => String(s), () => {});
  assert.ok(out.hasTl && out.cls === 'i5-timeline', 'v2回放须生成.i5-timeline');
  assert.strictEqual(out.thinkN, 2, `v2思考应切2段，实测${out.thinkN}`);
  assert.strictEqual(out.verb, '已探索', `v2工具应聚合已探索，实测${out.verb}`);
  // v2多exp块：累计N + 本块chips（思考穿插后另起一块，与直播一致）
  const contM = new MockElement('div');
  const srcM = extract(pae, 'i5SplitThink') + '\n' + extract(pae, 'i5VerbKind') + '\n' + extract(pae, 'i5FmtMsgTime') + '\n'
    + extract(pae, 'i5CopySvg') + '\n' + extract(pae, 'i5CreateCopyIconBtn') + '\n' + extract(pae, 'i5ReplayTimeline')
    + '\nvar tl2=i5ReplayTimeline(container, [{t:"tool", tool:"readFile", file:"a.html"}, {t:"thinking", text:"穿插。"}, {t:"tool", tool:"readFile", file:"b.html"}], {});'
    + '\nvar _rows = tl2?tl2.querySelectorAll(".exp"):[];'
    + '\nvar _cnts = []; for(var _i=0;_i<_rows.length;_i++){ var _c=_rows[_i].querySelector(".n"); if(!_c) _c=_rows[_i].querySelector(".i5-count"); _cnts.push(_c?_c.textContent:""); }'
    + '\nvar _chipsRows = tl2?tl2.querySelectorAll(".exp-files"):[];'
    + '\nvar _chipNs = []; for(var _j=0;_j<_chipsRows.length;_j++){ _chipNs.push(_chipsRows[_j].children.filter(function(c){return c.tagName==="CODE";}).length); }'
    + '\nreturn {n:_rows.length, cnts:_cnts, chipNs:_chipNs};';
  const outM = new Function('container', 'document', 'escHtml', 'formatAiTextConclusionOnly', 'openSnapPanel', srcM)(contM, makeMockDoc(), escHtmlStub, (s) => String(s), () => {});
  assert.strictEqual(outM.n, 2, `回放多exp块应2块，实测${outM.n}`);
  assert.strictEqual(outM.cnts[0], '1 次读取', `首块计数，实测${JSON.stringify(outM.cnts)}`);
  assert.strictEqual(outM.cnts[1], '2 次读取', `次块计数应累计N=2，实测${JSON.stringify(outM.cnts)}`);
  assert.deepStrictEqual(outM.chipNs, [1, 1], `每块chips只列本块新文件，实测${JSON.stringify(outM.chipNs)}`);
  // v2编辑半角减号：+62 -5（半角-，不得含U+2212）
  const contE = new MockElement('div');
  const srcE = extract(pae, 'i5SplitThink') + '\n' + extract(pae, 'i5VerbKind') + '\n' + extract(pae, 'i5FmtMsgTime') + '\n'
    + extract(pae, 'i5CopySvg') + '\n' + extract(pae, 'i5CreateCopyIconBtn') + '\n' + extract(pae, 'i5ReplayTimeline')
    + '\nvar tl3=i5ReplayTimeline(container, [{t:"edit", file:"fund-list.html", added:62, deleted:5}], {});'
    + '\nvar _add = tl3?tl3.querySelector(".i5-add"):null; var _del = tl3?tl3.querySelector(".i5-del"):null;'
    + '\nvar _row3 = tl3?tl3.querySelector(".edit-row"):null;'
    + '\nreturn {add:_add?_add.textContent:"", del:_del?_del.textContent:"", rowCls:_row3?_row3.className:""};';
  const outE = new Function('container', 'document', 'escHtml', 'formatAiTextConclusionOnly', 'openSnapPanel', srcE)(contE, makeMockDoc(), escHtmlStub, (s) => String(s), () => {});
  assert.strictEqual(outE.add, '+62', `回放编辑增量，实测${outE.add}`);
  assert.strictEqual(outE.del, '-5', `回放编辑减量半角-，实测${outE.del}`);
  assert.ok(!String(outE.del).includes('\u2212'), '回放减量不得含U+2212');
  assert.ok(String(outE.rowCls).includes('edit-row'), `回放编辑行主类名edit-row，实测${outE.rowCls}`);
  // v1降级轻仿真：全文合并一段
  const cont2 = new MockElement('div');
  const out2 = new Function('container', 'document', extract(pae, 'i5ReplayV1') + '\nvar tl=i5ReplayV1(container, "全文思考", 0); return {hasTl: !!tl, n: tl?tl.querySelectorAll(".i5-think-p").length:-1};')(cont2, mockDoc);
  assert.ok(out2.hasTl, 'v1回放须生成timeline');
  assert.strictEqual(out2.n, 1, 'v1全文应合并为一段');
}

// ========== 静态2b: 完成不重写（原地收尾，不整坨重建） ==========
function testS2b_FinishNoRewrite() {
  const body = extract(pae, 'finishAiStream');
  // 不含innerHTML=h整坨重建与ai-op-card总结卡
  assert.ok(!/innerHTML\s*=\s*h\b/.test(body), 'finishAiStream不得含innerHTML=h整坨重建');
  assert.ok(!body.includes('innerHTML'), 'finishAiStream不得重写innerHTML（只原地收尾）');
  assert.ok(!body.includes('ai-op-card'), 'finishAiStream不得构造ai-op-card总结卡');
  // 含原地收尾三调用
  assert.ok(body.includes('i5ThinkFlushPending'), 'finishAiStream须调i5ThinkFlushPending落段');
  assert.ok(body.includes('i5EditFinalize'), 'finishAiStream须调i5EditFinalize补+N -M');
  assert.ok(body.includes('i5RenderDoneCards'), 'finishAiStream须调i5RenderDoneCards追加回滚卡');
  // 额外原地收尾（Shell置tag/去光标/挂落款，存在性即可）
  assert.ok(body.includes('i5ShellFinalizeAll'), 'finishAiStream须调i5ShellFinalizeAll置tag');
  assert.ok(body.includes('i5TlRemoveCursor'), 'finishAiStream须去光标i5TlRemoveCursor');
}

// ========== 静态2c: 无followup-chips生成（原型无追问胶囊） ==========
function testS2c_NoFollowup() {
  // 生成口径：className/innerHTML/createElement含followup即算生成；纯注释提及不算
  assert.ok(!/className\s*=\s*['"][^'"]*followup-chips/.test(pae), '不得以className生成followup-chips');
  assert.ok(!/innerHTML[^;]*followup-chips/.test(pae), '不得以innerHTML生成followup-chips');
  assert.ok(!/createElement\([^)]*\)[^;]*followup/i.test(pae), '不得以createElement生成followup');
  const doneSrc = extract(pae, 'i5RenderDoneCards');
  assert.ok(!/className[^;]*followup/i.test(doneSrc), 'i5RenderDoneCards不得含followup类名生成');
  assert.ok(!/innerHTML[^;]*followup/i.test(doneSrc), 'i5RenderDoneCards不得含followup innerHTML生成');
  assert.ok(!pae.includes('ai-op-card'), '全文件不得残留ai-op-card构造');
}

// ========== 静态2d: 落款一次断言（msg-foot存在性，不过细） ==========
function testS2d_MsgFoot() {
  // 用户：msg-foot right（time→钮）；回答：msg-foot（钮→time）；只断存在性
  assert.ok(pae.includes('msg-foot right'), '须有用户落款msg-foot right');
  assert.ok(/className\s*=\s*['"]msg-foot['"]/.test(pae), '须有回答落款msg-foot');
  assert.ok(/createElement\s*\(\s*['"]time['"]\s*\)/.test(pae), '落款须创建time元素');
  assert.ok(pae.includes('i5CreateCopyIconBtn'), '落款须含复制图标钮i5CreateCopyIconBtn');
  assert.ok(pae.includes('i5FmtMsgTime'), '落款时间须走i5FmtMsgTime（当天HH:MM/昨日/月日）');
}

// ========== 运行5c: opencode实测形态 part.tool/part.state.input（mimo-v2.5走opencode CLI） ==========
function testR5c_OpencodePartShape() {
  // 后端：onToolCall须type最后（防...data覆盖成tool_use）+ 归一化part.tool/input
  assert.ok(/onToolCall/.test(aiProcContent), '[静态失败] ai-process缺onToolCall');
  assert.ok(!/emitAiEvent\(\{\s*type:\s*['"]tool_call['"],\s*\.\.\.data\s*\}\)/.test(aiProcContent),
    '[静态失败] 后端{type:tool_call,...data}会被raw type覆盖，须type置末');
  assert.ok(/part\s*&&\s*part\.tool/.test(aiProcContent) || /part\.tool/.test(aiProcContent),
    '[静态失败] 后端onToolCall须归一化part.tool');
  // 解析器：tool_use实测样本须触发onToolCall且归一化tool/path/command
  const { getStreamParser } = require(path.join(rootDir, 'runtimes', 'parsers'));
  const parser = getStreamParser('json-event-stream', 'opencode');
  const tools = [];
  const h = { onToolCall: (e) => tools.push(e), onChunk: () => {}, onThinking: () => {}, onSession: () => {} };
  parser.push('{"type":"tool_use","timestamp":1,"sessionID":"ses_abc","part":{"id":"p1","type":"tool","tool":"read","callID":"c1","state":{"status":"completed","input":{"path":"a.html"},"output":"c"}}}\n', h);
  parser.push('{"type":"tool_use","timestamp":1,"sessionID":"ses_abc","part":{"id":"p2","type":"tool","tool":"bash","callID":"c2","state":{"status":"completed","input":{"command":"echo hi"},"output":"hi"}}}\n', h);
  parser.flush(h);
  assert.strictEqual(tools.length, 2, `opencode tool_use应识别2次，实测${tools.length}`);
  assert.strictEqual(tools[0].tool, 'read', `parser须归一化tool=read，实测${tools[0].tool}`);
  assert.strictEqual(tools[0].path, 'a.html', `parser须归一化path=a.html，实测${tools[0].path}`);
  assert.strictEqual(tools[1].tool, 'bash', `parser须归一化tool=bash，实测${tools[1].tool}`);
  assert.strictEqual(tools[1].command, 'echo hi', `parser须归一化command，实测${tools[1].command}`);
  // 前端：raw part形态直调须出.exp行（兼容无后端归一化旧事件）；未知工具回落原文不丢弃
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const aiChatView = new MockElement('div');
  const pre = extract(pae, 'i5ToolName') + '\n' + extract(pae, 'i5ToolRawParam') + '\n' + extract(pae, 'i5ExtractToolFile') + '\n'
    + extract(pae, 'i5ExtractShellCmd') + '\n' + extract(pae, 'i5IsDirPath') + '\n' + extract(pae, 'i5VerbKind') + '\n'
    + extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + extract(pae, 'i5ThinkFlushPending') + '\n' + extract(pae, 'i5TlAppendThinkPara') + '\n'
    + 'function i5TlScroll(){}\nfunction aiAppendTrace(){}\nfunction i5TlSetStalled(){}\n'
    + extract(pae, 'i5ExploreAdd') + '\n' + extract(pae, 'i5CurSubFile') + '\n' + extract(pae, 'i5EditAdd') + '\n'
    + extract(pae, 'i5ShellAdd') + '\n' + extract(pae, 'i5AppendToolCall')
    + '\nvar aiTlReadCount=0,aiTlDirCount=0,aiTlReadFiles=[],aiTlExploreRow=null,aiTlExploreCountEl=null,aiTlExploreChipsEl=null,aiTlEditRows=[],aiTlShellRows=[],aiTlBuf="",aiTlFull="",aiTlPendingEl=null,aiTlLastPacket=0,aiTlLastType="",aiTlStalled=false,aiTlAnswerText="",aiTlAnswerEl=null,aiTlAnswerBodyEl=null;'
    + '\nvar aiUserScrolledPause=false; function aiShouldAutoScroll(){return false;} function escHtml(s){return String(s==null?"":s);}';
  const runOne = (ev) => new Function('document', 'aiStreaming', 'aiChatView', 'ev', 'collectText',
    pre + '\ni5AppendToolCall(ev);'
    + '\nvar tl=aiStreaming.querySelector(".i5-timeline"); var exp=tl?tl.querySelector(".exp"):null; var verb=exp?exp.querySelector(".i5-verb"):null;'
    + '\nvar shell=tl?tl.querySelector(".shell-row"):null;'
    + '\nreturn {hasExp:!!exp, verb:verb?verb.textContent:"", hasShell:!!shell, txt:tl?collectText(tl):""};')(mockDoc, new MockElement('div'), aiChatView, ev, collectText);
  const rRead = runOne({ type: 'tool_use', part: { type: 'tool', tool: 'read', state: { input: { path: 'a.html' } } } });
  assert.ok(rRead.hasExp && rRead.verb === '已探索', `raw part.read须出已探索行，实测${JSON.stringify(rRead)}`);
  assert.ok(rRead.txt.includes('a.html'), '已探索行须含文件名a.html');
  const rBash = runOne({ type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { input: { command: 'echo hi' } } } });
  assert.ok(rBash.hasShell && rBash.txt.includes('echo hi'), `raw part.bash须出Shell行含命令，实测${JSON.stringify(rBash)}`);
  const rUnk = runOne({ type: 'tool_use', part: { type: 'tool', tool: 'zzzQQQ999', state: { input: { foo: 'bar' } } } });
  assert.ok(rUnk.hasShell && rUnk.txt.includes('zzzQQQ999'), `未知工具须回落原文展示不丢弃，实测${JSON.stringify(rUnk)}`);
}

// ========== 运行13: 显示与发送分离（气泡简版/发模型全文/落盘d/老历史回落） ==========
function testR13_MsgSplit() {
  // 静态：aiDoSend一次性消费暂存、落盘d、气泡与任务事件用简版
  assert.ok(/window\.__aiUserMsgDisplay\s*=\s*null/.test(pae), 'aiDoSend须一次性消费展示串');
  assert.ok(/_um\.d\s*=\s*_uDisp|d:_uDisp|\.d\s*=\s*disp/i.test(pae), '会话落盘须含d字段');
  assert.ok(/aiAppendMsg\(\(_uDisp\|\|t\)/.test(pae), '气泡须用简版优先');
  assert.ok(/text:\(_uDisp\|\|t\)/.test(pae), '任务事件user文本须用简版');
  // 静态：提交侧拼简版并暂存
  const eeSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  assert.ok(/var td=dparts\.join/.test(eeSrc), '提交须拼展示串td');
  assert.ok(/window\.__aiUserMsgDisplay\s*=\s*td/.test(eeSrc), '提交须暂存展示串');
  assert.ok(/dparts\.push\(head\)/.test(eeSrc), '简版须含条目头');
  // 行为：aiUserDisp 简版优先、空白/缺失回落全文
  const disp = new Function(extract(pae, 'aiUserDisp') + '\nreturn aiUserDisp;')();
  assert.strictEqual(disp({ r: 'u', t: 'FULL', d: 'BRIEF' }), 'BRIEF', '有d用d');
  assert.strictEqual(disp({ r: 'u', t: 'FULL' }), 'FULL', '无d回落t');
  assert.strictEqual(disp({ r: 'u', t: 'FULL', d: '  ' }), 'FULL', '空白d回落t');
  assert.strictEqual(disp(null), '', 'null安全');
  // 行为：两处用户渲染均走 aiUserDisp（v1分支 + 回退分支）
  const uses = (pae.match(/aiUserDisp\(msg\)/g) || []).length;
  assert.ok(uses >= 4, `用户渲染须走aiUserDisp，实测${uses}处`);
}

// ========== 运行14: 思考入链（日志思考按句进链，不堆文本框） ==========
function testR14_ThinkChain() {
  // 静态：增量落句 + THINK 行 + 结束落空；渲染不再建思考文本框
  assert.ok(/thinkLogged/.test(pae), '缺增量游标thinkLogged');
  assert.ok(/tag:'THINK', level:'think'/.test(pae), '缺THINK行');
  assert.ok(!pae.includes("aiGroupSection('思考链')"), '删除思考链文本框分区');
  assert.ok(!/createElement\([^)]*\)[\s\S]{0,200}tg-think-pre/.test(pae), '不得再创建思考文本框');
  // 行为：半句暂留 → 续写追加不重复 → 结束落空 → 与TOOL穿插有序
  const go = (g) => new Function('g', 'aiLogsConsole', 'logsCount', 'logErrDot', 'chkAutoScrollTrace',
    extract(pae, 'aiGroupBodyNode') + '\n' + extract(pae, 'aiRefreshGroupMeta') + '\n'
    + extract(pae, 'aiTraceAppendLine') + '\n' + extract(pae, 'i5SplitThink') + '\n'
    + extract(pae, 'aiTraceFlushThink') + '\nreturn aiTraceFlushThink(g);'
  )(g, null, null, null, null);
  const g = { id: 'g1', status: 'run', lines: [], think: '第一句。第二句没完', thinkFlush: 0 };
  go(g);
  assert.strictEqual(g.lines.length, 1, '只落完整句');
  assert.strictEqual(g.lines[0].tag, 'THINK', '行标签THINK');
  assert.strictEqual(g.lines[0].level, 'think', '行样式think');
  g.think = '第一句。第二句没完，现在完了。第三句';
  go(g);
  assert.strictEqual(g.lines.length, 2, '追加不重复');
  g.status = 'ok';
  go(g);
  assert.strictEqual(g.lines.length, 3, '结束落空半句');
  assert.ok(g.lines[2].text.includes('第三句'), '尾句内容');
}

// ========== 运行16: 新会话清视图 + 发送等待行（首包即撤） ==========
function testR16_SessClearWaiting() {
  // 静态：fallback分支先清空（空事件会话如新建不再残留旧气泡）
  assert.ok(/aiChatView\.innerHTML='';?\s*\}catch\(e\)\{\}\s*\/\* fallback同样先清空/.test(pae), 'fallback须先清空');
  // 静态：发送挂等待行，结束/失败撤等待行（T-CLI启动中：先挂启动中，run_started到后切等待响应）
  const doSrc = pae.match(/function aiDoSend[\s\S]*?\n\}/)[0];
  assert.ok(/i5ShowBooting\(_eng0,_ag0\)/.test(doSrc), '发送须先挂启动中');
  const finSrc = pae.match(/function finishAiStream[\s\S]*?\n\}/)[0];
  assert.ok(/i5HideWaiting\(\)/.test(finSrc), '结束须撤等待行');
  // 行为：show挂行带光标 → 重复不叠加 → 内容落子撤行跟光标
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const show = new Function('document', 'aiStreaming',
    extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + extract(pae, 'i5ShowWaiting') + '\n' + extract(pae, 'i5HideWaiting')
    + '\nreturn { show: i5ShowWaiting, move: i5TlMoveCursorTo };')(mockDoc, aiStreaming);
  show.show();
  const tl = aiStreaming.querySelector('.i5-timeline');
  assert.ok(tl, '时间线容器应存在');
  const w = tl.querySelector('.i5-waiting');
  assert.ok(w && w.textContent.includes('等待响应'), '等待行文案');
  assert.ok(w.querySelector('.cursor'), '等待行带闪烁光标');
  show.show();
  assert.strictEqual(tl.querySelectorAll('.i5-waiting').length, 1, '不重复挂');
  const p = mockDoc.createElement('div'); p.className = 'think-p';
  tl.appendChild(p);
  show.move(p);
  assert.strictEqual(tl.querySelectorAll('.i5-waiting').length, 0, '内容落子撤等待行');
  assert.ok(p.querySelector('.cursor'), '光标跟到新行');
}

// ========== 运行17: CLI启动中两阶段（方案B真信号：boot→run_started→等待响应→落子撤行） ==========
function testR17_CliBootWaiting() {
  // 静态：后端真信号（spawn成功触发onStart，主进程透出run_started，仍走ai:event无新通道）
  const engSrc = fs.readFileSync(path.join(rootDir, 'runtimes', 'engine.js'), 'utf8');
  assert.ok(/handlers\.onStart/.test(engSrc), 'engine须触发onStart');
  assert.ok(/child\.on\('spawn'/.test(engSrc), 'engine须绑spawn兜底');
  assert.ok(/_startFired/.test(engSrc), 'onStart须幂等只发一次');
  assert.ok(/type:\s*'run_started'/.test(aiProcContent), '主进程须透出run_started');
  assert.ok(/agentId/.test(aiProcContent.split("type: 'run_started'")[0].slice(-400) + aiProcContent.split("type: 'run_started'")[1].slice(0, 200)), 'run_started须带agent标识');
  // 静态：前端状态机（同行原地换字，未知事件回落不丢弃）
  assert.ok(/function i5ShowBooting\(/.test(pae), '缺i5ShowBooting');
  assert.ok(/function i5MarkRunStarted\(/.test(pae), '缺i5MarkRunStarted');
  assert.ok(/function i5SetWaitingText\(/.test(pae), '缺i5SetWaitingText');
  assert.ok(/ev\.type==='run_started'/.test(pae), '事件分发须接run_started');
  assert.ok(/请求发送中/.test(pae), 'API模式须用请求发送中文案');
  // 行为：boot挂启动中（带CLI名）→ run_started切等待响应（不另起行）→ 落子撤行
  const mockDoc = makeMockDoc();
  const aiStreaming = new MockElement('div');
  const api = new Function('document', 'aiStreaming',
    extract(pae, 'i5TlEnsureTimeline') + '\n' + extract(pae, 'i5TlRemoveCursor') + '\n' + extract(pae, 'i5TlMoveCursorTo') + '\n'
    + extract(pae, 'i5SetWaitingText') + '\n' + extract(pae, 'i5ShowBooting') + '\n' + extract(pae, 'i5MarkRunStarted') + '\n'
    + extract(pae, 'i5ShowWaiting') + '\n' + extract(pae, 'i5HideWaiting')
    + '\nreturn { boot: i5ShowBooting, started: i5MarkRunStarted, move: i5TlMoveCursorTo, hide: i5HideWaiting };')(mockDoc, aiStreaming);
  api.boot('cli', 'opencode');
  const tl = aiStreaming.querySelector('.i5-timeline');
  assert.ok(tl, '时间线容器应存在');
  let w = tl.querySelector('.i5-waiting');
  assert.ok(w && w.textContent.includes('opencode') && w.textContent.includes('启动中'), '启动中文案须带CLI名');
  assert.ok(w.querySelector('.cursor'), '启动行带闪烁光标');
  api.started({});
  w = tl.querySelector('.i5-waiting');
  assert.ok(w && w.textContent.includes('等待响应'), 'run_started须切等待响应');
  assert.strictEqual(tl.querySelectorAll('.i5-waiting').length, 1, '换字不另起行');
  api.boot('api', '');
  w = tl.querySelector('.i5-waiting');
  assert.ok(w && w.textContent.includes('请求发送中'), 'API模式须用请求发送中文案');
  api.started({});
  w = tl.querySelector('.i5-waiting');
  assert.ok(w && w.textContent.includes('等待响应'), 'API模式run_started后同样切等待响应');
  const p = mockDoc.createElement('div'); p.className = 'think-p';
  tl.appendChild(p);
  api.move(p);
  assert.strictEqual(tl.querySelectorAll('.i5-waiting').length, 0, '内容落子撤等待行');
  api.hide();
}

// ========== 运行15: 对话框打磨（发送到底/落款出泡/无图标） ==========
function testR15_UiPolish() {
  // 静态：停止按钮无图标
  assert.ok(pae.includes("textContent='停止生成'"), '停止按钮文案');
  assert.ok(!pae.includes('⏹ 停止生成') && !pae.includes('⏹'), '停止按钮不得含图标');
  // 静态：发送强制到底 + 落款helper四处复用
  const doIdx = pae.indexOf('function aiDoSend');
  const doSeg = doIdx >= 0 ? pae.slice(doIdx, doIdx + 4000) : '';
  assert.ok(/aiUserScrolledPause\s*=\s*false/.test(doSeg) && /scrollTop\s*=\s*aiChatView\.scrollHeight/.test(doSeg), '发送须清暂停并强制到底');
  assert.ok(/function aiAppendUserFoot/.test(pae), '缺aiAppendUserFoot');
  const footUses = (pae.match(/aiAppendUserFoot\(aiChatView|aiAppendUserFoot\(tl/g) || []).length;
  assert.ok(footUses >= 4, `落款须在4处复用helper，实测${footUses}处`);
  // 行为：用户气泡只含正文，落款为气泡外兄弟行
  const mockDoc = makeMockDoc();
  const chat = new MockElement('div');
  const btnStub = 'function i5CreateCopyIconBtn(fn){ var b=document.createElement("button"); b._fn=fn; return b; }\n';
  const run = new Function('document', 'aiChatView', 'aiUserScrolledPause', 'aiShouldAutoScroll', 'scrubAiChatView',
    extract(pae, 'i5FmtMsgTime') + '\n' + btnStub + extract(pae, 'aiAppendUserFoot') + '\n' + extract(pae, 'aiAppendMsg')
    + '\nreturn aiAppendMsg("hi","user",1700000000000);')(mockDoc, chat, false, () => true, () => {});
  assert.ok(run && run.className.includes('ai-msg') && run.className.includes('user'), '返回用户气泡');
  assert.strictEqual(run.children.length, 1, '气泡内只剩正文体');
  assert.ok(run.children[0].className.includes('ai-msg-body'), '气泡子为正文');
  assert.strictEqual(chat.children.length, 2, '聊天区为气泡+落款两行');
  assert.strictEqual(chat.children[0], run, '首行为气泡');
  const foot = chat.children[1];
  assert.ok(foot.className.includes('msg-foot') && foot.className.includes('right'), '次行为右对齐落款');
  assert.ok(foot.children.some((c) => c.tagName === 'TIME'), '落款含时间');
  assert.ok(foot.children.some((c) => c.tagName === 'BUTTON'), '落款含复制钮');
}

// ========== 运行18: 忙态死锁修复（busy错误分支复位+主从核对自愈） ==========
function testR18_BusyDeadlock() {
  const doIdx = pae.indexOf('function aiDoSend');
  const doSeg = doIdx >= 0 ? pae.slice(doIdx, doIdx + 6000) : '';
  assert.ok(/r&&r\.error==='busy'/.test(doSeg), '须处理主进程忙回执');
  const busySeg = doSeg.slice(doSeg.indexOf("r&&r.error==='busy'"), doSeg.indexOf("r&&r.error==='busy'") + 400);
  assert.ok(/aiSetBusy\(false\)/.test(busySeg), 'busy分支须复位本地忙态（否则输入框永久禁用）');
  assert.ok(/ai\.isBusy\(\)\.then/.test(doSeg) && /忙态已自动恢复/.test(doSeg), '忙拦截须向主进程核对自愈');
  const ee = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  assert.ok(/hasLiveEl/.test(ee), '覆盖层须区分活元素与远端');
  assert.ok(/!r && !hasLiveEl/.test(ee), '活元素不得用旧rect兜底（防回滚后幽灵框）');
  assert.ok(!/if \(!r\) r = it\.rect;/.test(ee), '不得再无条件回退旧rect');
  assert.ok(/cancelCtrlPickState/.test(pae) || /CTRL_PICK\.clear/.test(pae), '快照恢复须清拾取态');
}

// ========== 运行19: 输入框自适应高度 ==========
function testR19_InputAutosize() {
  assert.ok(/function aiAutosizeInput\(\)/.test(pae), '缺aiAutosizeInput');
  assert.ok(/aiAutosizeInput\(\);?\s*\}catch/.test(pae) || /try\{\s*aiAutosizeInput\(\)/.test(pae), '须在多处调用自适应');
  assert.ok(/addEventListener\('input'/.test(pae) && /aiAutosizeInput/.test(pae), '输入事件须触发自适应');
  assert.ok(/scrollHeight/.test(pae), '自适应须按scrollHeight定高');
  const docs = fs.readFileSync(path.join(rootDir, 'js', 'core-docs.js'), 'utf8');
  assert.ok(/aiAutosizeInput/.test(docs), '草稿恢复须同步高度');
}

// ========== 运行20: 后台任务重开恢复（流式气泡挂回） ==========
function testR20_ReattachStream() {
  const noComments = pae.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/aiActiveKey===aiHistKey\(\)/.test(noComments), '死条件须删除（两侧键格式永不相等）');
  assert.ok(/function aiShouldReattachStream\(\)/.test(pae) && /function aiReattachStream\(\)/.test(pae), '缺重开恢复helper');
  const opens = (pae.match(/try\{ aiReattachStream\(\); \}catch\(e\)\{\}/g) || []).length;
  assert.strictEqual(opens, 2, `两处open（openAi/openAiDesign）都要挂回，实测${opens}处`);
  assert.ok(/aiTaskSessId=s\.id\|\|null/.test(pae), '发送时须快照会话ID');
  assert.ok(/aiTaskSessId=null; aiTaskSbxDir=null/.test(pae), '任务结束须清快照');
  // 行为：同沙箱同会话+游离节点→挂回；跨沙箱/已挂载/空闲→不挂
  const srcShould = extract(pae, 'aiShouldReattachStream');
  const srcRe = extract(pae, 'aiReattachStream');
  const run = (st) => new Function('aiBusy', 'aiStreaming', 'aiTaskSessId', 'aiTaskSbxDir', 'aiSession', 'aiChatView', 'aiSbxDir', 'aiRenderStream',
    srcShould + '\n' + srcRe + '\nreturn {s:aiShouldReattachStream(),r:aiReattachStream()};')(
    st.busy, st.streaming, st.sessId, st.dir, st.session, st.chat, () => st.curDir, () => {});
  const mkChat = () => ({ kid: null, appendChild(c) { this.kid = c; }, scrollTop: 0, scrollHeight: 100 });
  const chat1 = mkChat(), detached = { parentNode: {} };
  const ok = run({ busy: true, streaming: detached, sessId: 's1', dir: 'd1', session: { id: 's1' }, chat: chat1, curDir: 'd1' });
  assert.strictEqual(ok.s, true, '同源游离须挂回');
  assert.strictEqual(ok.r, true, '挂回须返回true');
  assert.strictEqual(chat1.kid, detached, '须appendChild到对话区');
  const chat2 = mkChat(), attached = { parentNode: chat2 };
  assert.strictEqual(run({ busy: true, streaming: attached, sessId: 's1', dir: 'd1', session: { id: 's1' }, chat: chat2, curDir: 'd1' }).s, false, '已挂载不得重复挂');
  assert.strictEqual(run({ busy: true, streaming: detached, sessId: 's1', dir: 'd1', session: { id: 's1' }, chat: mkChat(), curDir: 'd2' }).s, false, '跨沙箱不得挂回（防串扰）');
  assert.strictEqual(run({ busy: true, streaming: detached, sessId: 's1', dir: 'd1', session: { id: 's9' }, chat: mkChat(), curDir: 'd1' }).s, false, '跨会话不得挂回');
  assert.strictEqual(run({ busy: false, streaming: detached, sessId: 's1', dir: 'd1', session: { id: 's1' }, chat: mkChat(), curDir: 'd1' }).s, false, '空闲不得挂回');
  assert.strictEqual(run({ busy: true, streaming: null, sessId: 's1', dir: 'd1', session: { id: 's1' }, chat: mkChat(), curDir: 'd1' }).s, false, '无流式节点不得挂回');
}

function runAll() {
  let p = 0, f = 0;
  const ts = [['S1 onEvent管线', testS1_OnEventPipeline], ['R1b session落盘', testR1b_SessionOidPersist], ['S2 finish尾', testS2_FinishTail], ['S2b 完成不重写', testS2b_FinishNoRewrite], ['S2c 无followup', testS2c_NoFollowup], ['S2d 落款', testS2d_MsgFoot], ['S3 模式清零', testS3_EditModeZero], ['S4 唯一ESC', testS4_SingleEsc], ['R5 动词映射+计数', testR5_VerbExplore], ['R5c opencode形态', testR5c_OpencodePartShape], ['R7 审计删除+快照', testR7_NoAuditSnap], ['R8 ErrorCard', testR8_ErrorCard], ['R9 思考切分', testR9_ThinkSplit], ['R10 光标/编辑', testR10_CursorEdit], ['S5 done新字段', testS5_DoneFields], ['R12 历史回放', testR12_Replay], ['R13 显示发送分离', testR13_MsgSplit], ['R14 思考入链', testR14_ThinkChain], ['R15 对话框打磨', testR15_UiPolish], ['R16 会话清空与等待行', testR16_SessClearWaiting], ['R17 CLI启动中两阶段', testR17_CliBootWaiting], ['R18 忙态死锁与幽灵框', testR18_BusyDeadlock], ['R19 输入框自适应高度', testR19_InputAutosize], ['R20 后台任务重开恢复', testR20_ReattachStream]];
  for (const [t, fn] of ts) { try { fn(); console.log(`[PASS] ${t}`); p++; } catch (e) { console.error(`[FAIL] ${t}`); console.error(e); f++; } }
  console.log(`SUMMARY passed=${p} failed=${f}\n`);
  if (f) process.exit(1);
}
runAll();
