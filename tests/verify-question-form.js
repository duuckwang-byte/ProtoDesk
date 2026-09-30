'use strict';
// tests/verify-question-form.js — question-form 前端（B）验证套件：纯 Node，无 Electron
// 覆盖：闭合块检出 / 裸标签不算 / 分片拼完才算 / 答案格式 / 跳过记未选 / 推荐识别 / 显示剥离 / 行内渲染 / 提交续跑 / 落盘重建 / 门禁
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAE = fs.readFileSync(path.join(ROOT, 'js', 'project-ai-export.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');
const RUNALL = fs.readFileSync(path.join(ROOT, 'tests', 'run-all.js'), 'utf8');

// —— 源码提取：brace 匹配（跳过字符串/注释/正则），供 new Function 沙箱实调 ——
function extractFn(src, name) {
  const head = 'function ' + name + '(';
  const si = src.indexOf(head);
  assert.ok(si >= 0, '[提取失败] 缺 function ' + name);
  let i = src.indexOf('{', si);
  assert.ok(i >= 0, '[提取失败] 缺函数体 ' + name);
  let depth = 0;
  let inS = null; // ' " `
  let inLine = false; let inBlock = false; let inRe = false; let inCls = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j]; const nx = src[j + 1];
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
    if (c === '/') { inRe = true; inCls = false; continue; } // qform 区无除法，可按正则跳过
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(si, j + 1); }
  }
  assert.fail('[提取失败] 花括号未闭合 ' + name);
}

const PURE = ['qformParseAttrs', 'qformHasRecMark', 'qformStripRecMark', 'qformNormOption',
  'qformNormQuestion', 'qformParseBlock', 'qformFindAll', 'qformDisplayText',
  'qformDefaultValue', 'qformBuildAnswer', 'qformCollectAnswers'];
const DOMF = ['qformPaintOpts', 'qformBuildCard', 'qformSetDone', 'qformPersistState',
  'qformSubmitAnswer', 'qformReplayOne', 'qformRoundDone'];

function sandbox(extraParams, extraArgs, withDom) {
  let src = 'var qformSeq=0; var qformLive={};\n';
  for (const n of PURE.concat(withDom ? DOMF : [])) src += extractFn(PAE, n) + '\n';
  const names = Object.keys(extraParams || {});
  const fn = new Function('document', names.join(','), src + '\nreturn {' + PURE.concat(withDom ? DOMF : []).join(',') + ', __live: qformLive };');
  return fn.apply(null, [withDom ? withDom : undefined].concat(names.map((k) => extraParams[k])));
}

// —— 最小 DOM 桩（仅实现 qform 渲染实际用到的 API） ——
function makeDoc() {
  function El(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.type = '';
    this.name = '';
    this.placeholder = '';
    this.title = '';
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.onclick = null;
    this.onchange = null;
    this.nodeType = 1;
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
  function match(el, sel) {
    ssel(sel);
    function ssel() {}
    if (!sel) return false;
    if (sel.charAt(0) === '[') {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (!m) return false;
      const v = el.getAttribute(m[1]);
      if (m[2] === undefined) return v !== null;
      return v === m[2];
    }
    if (sel.charAt(0) === '.') return el.classList.contains(sel.slice(1));
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }
  El.prototype.querySelector = function (sel) {
    if (match(this, sel)) return this;
    for (const ch of this.children) { const r = ch.querySelector(sel); if (r) return r; }
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
    __reg(id, el) { byId[id] = el; }
  };
}
function collectText(el) {
  let s = String((el && el.textContent) || '');
  for (const ch of ((el && el.children) || [])) s += ' ' + collectText(ch);
  return s.replace(/\s+/g, ' ').trim();
}

const BLOCK1 = '<question-form id="f1" title="发布确认">'
  + '{"questions":['
  + '{"id":"c","label":"颜色","type":"radio","options":["红色","绿色"],"required":true},'
  + '{"id":"n","label":"备注","type":"text","options":[],"required":false}'
  + ']}</question-form>';
const BLOCK_ALIAS = '<ask-question id="f2" title="别名块">'
  + '{"questions":[{"id":"a","label":"去留","type":"radio","options":[{"label":"保留","value":"keep","recommended":true},{"label":"删除","value":"drop"}]}]}</ask-question>';

// 1. 闭合块检出（含别名与对象式 options）
(function t1() {
  const api = sandbox();
  const forms = api.qformFindAll('前言 ' + BLOCK1 + ' 中段 ' + BLOCK_ALIAS + ' 尾巴');
  assert.strictEqual(forms.length, 2, '应检出2个闭合块，实测' + forms.length);
  assert.strictEqual(forms[0].id, 'f1');
  assert.strictEqual(forms[0].title, '发布确认');
  assert.strictEqual(forms[0].questions.length, 2);
  assert.strictEqual(forms[0].questions[0].type, 'radio');
  assert.strictEqual(forms[0].questions[1].type, 'text');
  assert.strictEqual(forms[1].id, 'f2');
  assert.strictEqual(forms[1].questions[0].options[0].value, 'keep');
  assert.strictEqual(forms[1].questions[0].options[0].recommended, true);
  // 跨别名收尾二认一
  const cross = api.qformFindAll('<question-form id="fx" title="tx">{"questions":[{"id":"a","label":"L"}]}</ask-question>');
  assert.strictEqual(cross.length, 1, '跨别名收尾应兼容检出');
  console.log('[PASS] 闭合块检出/别名/对象options');
})();

// 2. 裸标签不算
(function t2() {
  const api = sandbox();
  assert.strictEqual(api.qformFindAll('<question-form id="x" title="t">{"questions":[{"id":"a","label":"L"}]}').length, 0, '无收尾不算');
  assert.strictEqual(api.qformFindAll('只有收尾</question-form>').length, 0, '无开头不算');
  assert.strictEqual(api.qformFindAll('纯文本无标记').length, 0, '无标记不算');
  assert.strictEqual(api.qformFindAll('<ask-question id="x">半截json').length, 0, '别名裸开不算');
  assert.strictEqual(api.qformFindAll('<question-form id="x" title="t">不是json</question-form>').length, 0, '非法JSON不算');
  console.log('[PASS] 裸标签不算');
})();

// 3. 分片拼完才算（流式分片截断标记，中途不判；显示文本不闪现原始标记）
(function t3() {
  const api = sandbox();
  const full = '先说两句前提。' + BLOCK1 + '以上请确认。';
  const cuts = [8, 20, 30, 45, 60, 90, 120, full.length - 10];
  for (const c of cuts) {
    const pre = full.slice(0, c);
    assert.strictEqual(api.qformFindAll(pre).length, 0, '前缀切分(' + c + ')不应检出');
    const disp = api.qformDisplayText(pre);
    assert.ok(disp.indexOf('<question-form') < 0 && disp.indexOf('ask-question') < 0, '前缀显示(' + c + ')不应闪现标记残片：' + JSON.stringify(disp.slice(-40)));
  }
  assert.strictEqual(api.qformFindAll(full).length, 1, '拼完应检出');
  console.log('[PASS] 分片拼完才算/显示无闪现');
})();

// 4. 答案格式（首行固定 + 每题一行）
(function t4() {
  const api = sandbox();
  const forms = api.qformFindAll(BLOCK1);
  const text = api.qformBuildAnswer(forms[0], { c: '红色', n: '' });
  assert.strictEqual(text, '[form answers — f1]\n- 颜色: 红色\n- 备注: （跳过）', '答案格式不符：' + JSON.stringify(text));
  console.log('[PASS] 答案格式');
})();

// 5. 跳过记未选
(function t5() {
  const api = sandbox();
  const forms = api.qformFindAll(BLOCK1);
  const text = api.qformBuildAnswer(forms[0], {});
  assert.ok(text.indexOf('- 颜色: （跳过）') >= 0 && text.indexOf('- 备注: （跳过）') >= 0, '全跳过：' + JSON.stringify(text));
  console.log('[PASS] 跳过记未选');
})();

// 6. 推荐识别（recommended:true / 半角全角前后缀 / 默认第一个 / 绝不空着）
(function t6() {
  const api = sandbox();
  assert.strictEqual(api.qformHasRecMark('方案A（推荐）'), true, '全角后缀');
  assert.strictEqual(api.qformHasRecMark('方案A(推荐)'), true, '半角后缀');
  assert.strictEqual(api.qformHasRecMark('（推荐）方案A'), true, '全角前缀');
  assert.strictEqual(api.qformHasRecMark('(Recommended) Plan'), true, '英文前缀');
  assert.strictEqual(api.qformHasRecMark('Plan (Recommended)'), true, '英文后缀');
  assert.strictEqual(api.qformHasRecMark('普通方案'), false, '无标记');
  assert.strictEqual(api.qformStripRecMark('方案A（推荐）'), '方案A', '剥除标记');
  const f = api.qformFindAll('<question-form id="r" title="t">{"questions":['
    + '{"id":"a","label":"A","type":"radio","options":["甲","乙（推荐）","丙"]},'
    + '{"id":"b","label":"B","type":"radio","options":["甲","乙"]}'
    + ']}</question-form>')[0];
  assert.strictEqual(api.qformDefaultValue(f.questions[0]), '乙', '推荐项默认');
  assert.strictEqual(api.qformDefaultValue(f.questions[1]), '甲', '认不出默认第一个');
  assert.ok(api.qformDefaultValue(f.questions[1]), '绝不空着');
  assert.strictEqual(f.questions[0].options[1].label, '乙', '显示label去标记');
  console.log('[PASS] 推荐识别与默认');
})();

// 7. 显示剥离（完整块移除、未闭合截断、普通文本不动）
(function t7() {
  const api = sandbox();
  const disp = api.qformDisplayText('结论正文。' + BLOCK1 + '尾巴');
  assert.ok(disp.indexOf('结论正文') >= 0 && disp.indexOf('尾巴') >= 0, '正文保留');
  assert.ok(disp.indexOf('question-form') < 0 && disp.indexOf('"questions"') < 0, '原始标记移除：' + JSON.stringify(disp));
  const cut = api.qformDisplayText('结论正文。<question-form id="x" title="t">{"quest');
  assert.ok(cut.indexOf('<question-form') < 0, '未闭合截断：' + JSON.stringify(cut));
  assert.ok(cut.indexOf('结论正文') >= 0, '截断保留前文');
  assert.strictEqual(api.qformDisplayText('普通文本无标记'), '普通文本无标记', '普通文本不动');
  console.log('[PASS] 显示剥离');
})();

// 8. 行内渲染（挂载卡片、待选态、默认选中、推荐徽标、按钮）
(function t8() {
  const doc = makeDoc();
  const api = sandbox({}, [], doc);
  const form = api.qformFindAll(BLOCK_ALIAS)[0].questions ? api.qformFindAll(BLOCK_ALIAS)[0] : null;
  assert.ok(form && form.id === 'f2', '取表单');
  const built = api.qformBuildCard(form, { state: 'pending', answers: {} });
  assert.ok(built.wrap.querySelector('.tool-call-card'), '状态行 tool-call-card');
  assert.strictEqual(built.tagEl.textContent, '待选', '待选态');
  assert.ok(built.tagEl.className.indexOf('waiting') >= 0, 'waiting 样式');
  assert.ok(collectText(built.wrap).indexOf('等输入') >= 0, '等输入状态可见');
  const opts = built.wrap.querySelectorAll('.qform-opt');
  assert.strictEqual(opts.length, 2, '选项行数');
  const radios = built.wrap.querySelectorAll('input');
  assert.ok(radios[0].checked, '推荐项默认选中');
  assert.ok(built.wrap.querySelector('.qform-rec'), '推荐徽标');
  assert.ok(built.wrap.querySelector('.qform-card'), '表单卡片');
  assert.strictEqual(built.wrap.querySelector('.qform-card').getAttribute('data-qform'), 'f2', '挂载点带表单id');
  const btns = built.wrap.querySelectorAll('button');
  const labels = btns.map((b) => b.textContent).join('/');
  assert.ok(labels.indexOf('跳过') >= 0 && labels.indexOf('提交答案') >= 0, '跳过/提交按钮：' + labels);
  console.log('[PASS] 行内渲染与待选态');
})();

// 9. 提交续跑（答案文本进输入框、调 aiDoSend、翻牌已答、只读防重交）
(function t9() {
  const doc = makeDoc();
  const input = doc.createElement('textarea');
  doc.__reg('aiInput', input);
  let sent = 0; const toasts = [];
  const api = sandbox({
    showToast(m) { toasts.push(String(m)); },
    aiDoSend() { sent++; },
    aiCurSesh() { return { id: 's_1', oid: 'ses_abc' }; },
    aiSaveSesh() {}
  }, [], doc);
  const form = api.qformFindAll(BLOCK1)[0];
  const tl = doc.createElement('div');
  const built = api.qformBuildCard(form, { state: 'pending', answers: {} });
  tl.appendChild(built.wrap);
  assert.ok(api.qformSubmitAnswer('f1', false), '提交应成功');
  assert.strictEqual(sent, 1, '应调现有发送链 aiDoSend');
  assert.strictEqual(input.value, '[form answers — f1]\n- 颜色: 红色\n- 备注: （跳过）', '答案文本：' + JSON.stringify(input.value));
  assert.strictEqual(built.tagEl.textContent, '已答', '翻牌已答');
  assert.ok(!api.qformSubmitAnswer('f1', false), '已提交防重复提交');
  assert.strictEqual(sent, 1, '不重发');
  console.log('[PASS] 提交续跑与防重交');
})();

// 10. 跳过提交（全（跳过）、翻牌已跳过）与新会话降级提示
(function t10() {
  const doc = makeDoc();
  const input = doc.createElement('textarea');
  doc.__reg('aiInput', input);
  let sent = 0; const toasts = [];
  const api = sandbox({
    showToast(m) { toasts.push(String(m)); },
    aiDoSend() { sent++; },
    aiCurSesh() { return { id: 's_1', oid: '' }; },
    aiSaveSesh() {}
  }, [], doc);
  const form = api.qformFindAll(BLOCK1)[0];
  api.qformBuildCard(form, { state: 'pending', answers: {} });
  assert.ok(api.qformSubmitAnswer('f1', true), '跳过应成功');
  assert.ok(input.value.indexOf('- 颜色: （跳过）') >= 0, '跳过记未选：' + JSON.stringify(input.value));
  assert.ok(toasts.some((t) => t.indexOf('将开启新会话续答') >= 0), '缺oid如实提示新会话：' + JSON.stringify(toasts));
  assert.strictEqual(sent, 1, '跳过同样续跑');
  console.log('[PASS] 跳过与新会话降级提示');
})();

// 11. 落盘重建（question 事件入库、关闭重开后可答；已答态只读重建）
(function t11() {
  const doc = makeDoc();
  const events = [];
  const host = doc.createElement('div');
  const api = sandbox({
    i5TlEnsureTimeline() { return host; },
    aiCurTaskEvents: events,
    aiSessNow() { return 1700000000000; },
    i5TlScroll() {}
  }, [], doc);
  assert.strictEqual(api.qformRoundDone('正文' + BLOCK1 + '尾'), 1, '收尾检出1单');
  assert.strictEqual(events.length, 1, 'question 事件入库');
  assert.strictEqual(events[0].t, 'question', '事件类型');
  assert.ok(host.querySelector('.qform-card'), '行内卡片已挂载');
  // 重开：用落盘事件重建（可答）
  const doc2 = makeDoc();
  const host2 = doc2.createElement('div');
  const api2 = sandbox({}, [], doc2);
  assert.ok(api2.qformReplayOne(host2, events[0]), '重建成功');
  const card2 = host2.querySelector('.qform-card');
  assert.ok(card2 && card2.getAttribute('data-qform-state') === 'pending', '重建后可答');
  // 已答态重建为只读
  const doneEv = { t: 'question', text: JSON.stringify({ v: 1, form: api.qformFindAll(BLOCK1)[0], state: 'answered', answers: { c: '绿色', n: '' } }), ts: 1 };
  const host3 = doc2.createElement('div');
  assert.ok(api2.qformReplayOne(host3, doneEv), '已答重建');
  const card3 = host3.querySelector('.qform-card');
  assert.strictEqual(card3.getAttribute('data-qform-state'), 'answered', '只读态');
  const txts = [];
  host3.querySelectorAll('input').forEach((el) => txts.push([el.type || el.getAttribute('type'), el.value, !!el.checked, !!el.disabled]));
  assert.ok(txts.some((r) => r[2] && r[1] === '绿色'), '保存答案回显选中：' + JSON.stringify(txts));
  assert.ok(txts.every((r) => r[3]), '全部禁用：' + JSON.stringify(txts));
  console.log('[PASS] 落盘重建与只读态');
})();

// 12. 门禁与静态约束（无原生弹窗/动态执行、样式规范、suite 注册）
(function t12() {
  const secStart = PAE.indexOf('question-form 行内问答');
  assert.ok(secStart > 0, 'qform 区段注释存在');
  const sec = PAE.slice(secStart);
  assert.ok(!/(^|[^_a-zA-Z.$])(alert|confirm|prompt)\s*\(/.test(sec), '禁原生弹窗');
  assert.ok(!/\beval\s*\(/.test(sec) && !/\bnew\s+Function\s*\(/.test(sec), '禁动态执行');
  assert.ok(sec.indexOf('followup') < 0 && sec.indexOf('ai-op-card') < 0, '无已下线类名残留');
  assert.ok(/try\{ qformRoundDone\(txt\); \}catch\(e\)\{\}/.test(PAE), '收尾钩子接入 finishAiStream');
  const finMatch = PAE.match(/function finishAiStream\(isCancel\)[\s\S]*?\n\}/);
  assert.ok(finMatch, 'finishAiStream 可提取');
  assert.ok(finMatch[0].indexOf('innerHTML') < 0, 'finishAiStream 不重写 innerHTML');
  assert.ok(/qformDisplayText\(aiTlAnswerText\)/.test(PAE), '流式显示剥离');
  assert.ok(/qformReplayOne\(tl, e\)/.test(PAE), '回放分支接入');
  assert.ok(!/^import\s/m.test(sec) && !/^export\s/m.test(sec), '经典脚本无 ESM');
  const cssStart = CSS.indexOf('.qform-wrap');
  assert.ok(cssStart > 0, 'qform 样式存在');
  const cssSec = CSS.slice(cssStart);
  assert.ok(cssSec.indexOf('linear-gradient') < 0, '样式无渐变');
  assert.ok(/\.qform-card\{[^}]*border-radius:8px/.test(cssSec), '表面圆角 8px');
  assert.ok(/\.qform-opt\{[^}]*border-radius:6px/.test(cssSec), '控件圆角 6px');
  assert.ok(/\.qform-text\{[^}]*border-radius:6px/.test(cssSec), '输入框圆角 6px');
  assert.ok(/position:\s*fixed/.test(cssSec) === false, '卡片非悬浮定位');
  assert.ok(RUNALL.indexOf('verify-question-form.js') >= 0, 'run-all 已注册');
  console.log('[PASS] 门禁与静态约束');
})();

console.log('QUESTION_FORM_PASS: question-form 前端全绿');
