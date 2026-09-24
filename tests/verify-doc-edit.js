'use strict';
// 文档编辑体验五项调整回归：编辑态隐藏导出/图片入口 + Ctrl+S原地保存 + 17组快捷键复用DocToolbarActions
// + 新提示文案 + 蓝色快捷键按钮 + 快捷键弹窗（纯Node，不启动Electron）
// 手段：源文提取静态断言 + 最小fake DOM/vm加载js/core-docs.js语义抽查（fake textarea stub）
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(rootDir, 'js', 'core-docs.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = src.indexOf('{', i);
  let depth = 0;
  for (let j = b; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return null;
}

// ── fake DOM（复用 md-p1 模式，textarea 增强 selection/restore 可观测） ──
function mkEl(id) {
  return {
    id: id || '',
    style: {},
    _attrs: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, replaceChild() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    focus() {}, click() {},
    scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    value: '', innerHTML: '', textContent: '', disabled: false,
    offsetWidth: 0, parentNode: null
  };
}
function mkTextarea(id) {
  const el = mkEl(id);
  el.selectionStart = 0;
  el.selectionEnd = 0;
  el._setSelCalls = [];
  el._focusCount = 0;
  el._listeners = {};
  el.setSelectionRange = function (s, e) { this._setSelCalls.push([s, e]); this.selectionStart = s; this.selectionEnd = e; };
  el.focus = function () { this._focusCount++; };
  el.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); };
  el.removeEventListener = function () {};
  return el;
}
function loadCore() {
  const elCache = {};
  const fakeDoc = {
    activeElement: null,
    getElementById(id) {
      if (!elCache[id]) {
        if (id === 'docEditArea' || id === 'reqEditArea') elCache[id] = mkTextarea(id);
        else elCache[id] = mkEl(id);
      }
      return elCache[id];
    },
    createElement(tag) { return mkEl(tag); },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: mkEl('body'),
    documentElement: mkEl('html')
  };
  const store = {};
  const sandbox = {
    document: fakeDoc,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    navigator: { userAgent: 'node' },
    addEventListener() {}, removeEventListener() {},
    confirm() { return true; },
    console, setTimeout, clearTimeout,
    Map, JSON, Math, Date, RegExp, encodeURIComponent, decodeURIComponent,
    Promise, Object, Array, String, Number, Boolean, Error, URL
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox, { filename: 'js/core-docs.js' });
  return { sandbox, elCache, fakeDoc };
}
function mkKeyEvent(over) {
  return Object.assign({
    key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    target: { id: 'docEditArea' },
    _pd: false, _sp: false,
    preventDefault() { this._pd = true; },
    stopPropagation() { this._sp = true; }
  }, over || {});
}

// ── A1 新提示文案双处存在 ──
function testA1_NewTip() {
  const NEW = '支持 Markdown 语法（表格、标题、列表、加粗等）';
  const count = htmlSrc.split(NEW).length - 1;
  assert.strictEqual(count, 2, `新文案应恰出现2处(docEdit+reqEdit)，实际${count}`);
  assert.ok(htmlSrc.includes('id="btnDocShortcut"'), '须有#btnDocShortcut');
  assert.ok(htmlSrc.includes('id="btnReqShortcut"'), '须有#btnReqShortcut');
  const tips = [...htmlSrc.matchAll(/<div class="doc-edit-tip">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.strictEqual(tips.length, 2, `应有2个.doc-edit-tip块，实际${tips.length}`);
  for (const t of tips) {
    assert.ok(t.includes(NEW), 'tip块须含新文案，实际:' + t.slice(0, 160));
    assert.ok(t.includes('doc-shortcut-link'), 'tip块须含蓝色快捷键按钮类');
  }
}

// ── A2 旧文案消失（含<br>可换行） ──
function testA2_OldTipGone() {
  assert.ok(!htmlSrc.includes('可换行'), '旧文案“可换行”须消失');
  const tips = [...htmlSrc.matchAll(/<div class="doc-edit-tip">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  for (const t of tips) {
    assert.ok(!t.includes('<code>'), 'tip块不应再含<code>（旧<br>写法残留）');
    assert.ok(!t.includes('&lt;br&gt;') && !t.includes('<br'), 'tip块不应再含br换行写法');
  }
  // 全文剩余<br>/&lt;br&gt;仅允许渲染引擎与设置页正当用途，不允许出现在tip上下文
  assert.ok(!/doc-edit-tip[\s\S]{0,300}(可换行|&lt;br&gt;)/.test(htmlSrc), 'tip上下文300字符内不应出现旧换行文案');
}

// ── A3 蓝色快捷键按钮样式 ──
function testA3_BlueLink() {
  assert.ok(cssSrc.includes('.doc-shortcut-link'), 'CSS须有.doc-shortcut-link');
  assert.ok(cssSrc.includes('#3B5BDB'), '快捷键按钮须为蓝色#3B5BDB');
  assert.ok(htmlSrc.split('doc-shortcut-link').length - 1 >= 2, 'HTML应至少2处doc-shortcut-link(doc+req)');
}

// ── A4 快捷键弹窗DOM与21行表(删A加Z/Y) ──
function testA4_ShortcutMask() {
  for (const id of ['docShortcutMask', 'docShortcutModal', 'docShortcutClose', 'docShortcutOk']) {
    assert.ok(htmlSrc.includes('id="' + id + '"'), '弹窗DOM缺失#' + id);
  }
  assert.ok(htmlSrc.includes('doc-shortcut-table'), '弹窗须含doc-shortcut-table');
  assert.ok(cssSrc.includes('.doc-shortcut-table'), 'CSS须有.doc-shortcut-table');
  const mi = htmlSrc.indexOf('doc-shortcut-table');
  assert.ok(mi >= 0, '须能定位表格');
  const slice = htmlSrc.slice(mi, mi + 8000);
  const trs = (slice.match(/<tr>/g) || []).length;
  assert.strictEqual(trs, 22, `表格应22个<tr>(1表头+21行)，实际${trs}`);
  const rows = [...slice.matchAll(/<tr><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];
  assert.strictEqual(rows.length, 21, `数据行应21行，实际${rows.length}`);
  const needKeys = ['Ctrl+S', 'Esc', 'Tab / Shift+Tab', '回车', 'Ctrl+V', 'Ctrl+F', 'Ctrl+B', 'Ctrl+I',
    'Ctrl+Shift+S', 'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+0', 'Ctrl+Shift+U', 'Ctrl+Shift+O',
    'Ctrl+Shift+T', 'Ctrl+T', 'Ctrl+Shift+I', 'Ctrl+Shift+P', 'Ctrl+Z', 'Ctrl+Shift+Z / Ctrl+Y'];
  const gotKeys = rows.map(r => r[1]);
  for (const k of needKeys) assert.ok(gotKeys.includes(k), '表格缺快捷键行:' + k);
  assert.ok(!gotKeys.includes('Ctrl+Shift+A'), '锚点删除后表格不应含Ctrl+Shift+A');
  const needActs = ['原地保存', '放弃本次编辑', '缩进', '列表自动延续', '粘贴图片', '文档检索', '粗体', '斜体',
    '删除线', '一级标题', '二级标题', '三级标题', '正文', '无序列表', '有序列表', '任务列表', '表格骨架', '插入图片', '图片抽屉', '撤销', '重做'];
  for (const a of needActs) assert.ok(slice.includes(a), '表格缺功能列:' + a);
  assert.ok(!slice.includes('锚点'), '表格不应再含锚点行');
}

// ── A5 核心函数与映射存在 ──
function testA5_CoreFns() {
  for (const fn of ['function setDocEditChrome(', 'function saveDocInPlace(', 'function saveReqPanelInPlace(', 'function onDocKeydown(', 'function openDocShortcut(', 'function closeDocShortcut(', 'function bindDocShortcut(', 'function ensureDocShortcutDom(']) {
    assert.ok(coreSrc.includes(fn), 'core-docs缺失:' + fn);
  }
  assert.ok(coreSrc.includes('var DocToolbarActions='), '须有DocToolbarActions映射表');
  assert.ok(coreSrc.includes('window.DocShortcut='), '须暴露window.DocShortcut');
  assert.ok(coreSrc.includes('window.DocToolbar='), '须暴露window.DocToolbar');
}

// ── A6 编辑态隐藏逻辑 ──
function testA6_EditChrome() {
  const body = extractFn(coreSrc, 'setDocEditChrome');
  assert.ok(body, '须能提取setDocEditChrome函数体');
  assert.ok(body.includes("getElementById('docExportWrap')"), '须隐藏#docExportWrap');
  assert.ok(body.includes("getElementById('btnDocAssets')"), '须隐藏#btnDocAssets（动态注入按钮按ID隐藏）');
  assert.ok(body.includes("display=editing?'none':''"), '须按editing切换none/还原');
  assert.ok(body.includes('closeDocExportMenu'), '进入编辑须关闭导出菜单');
  const trueCount = (coreSrc.match(/setDocEditChrome\(true\)/g) || []).length;
  assert.ok(trueCount >= 2, `enterEdit两路(reqMode/常规)均须setDocEditChrome(true)，实际${trueCount}`);
  assert.ok(coreSrc.includes('setDocEditChrome(false)'), 'exitEdit须setDocEditChrome(false)还原');
  const exitBody = extractFn(coreSrc, 'exitEdit');
  assert.ok(exitBody && exitBody.includes('setDocEditChrome(false)'), 'exitEdit函数体内须调用setDocEditChrome(false)');
  // 动态按钮兜底：ensureDocAssetBtn在editOn时隐藏
  assert.ok(coreSrc.includes('function ensureDocAssetBtn('), '须有ensureDocAssetBtn动态注入');
  assert.ok(/ensureDocAssetBtn[\s\S]{0,1200}if\(editOn\)/.test(coreSrc), 'ensureDocAssetBtn须含editOn隐藏兜底');
}

// ── A7 Ctrl+S原地保存语义（源码级：不exitEdit/恢复光标） ──
function testA7_InPlaceSrc() {
  const docBody = extractFn(coreSrc, 'saveDocInPlace');
  const reqBody = extractFn(coreSrc, 'saveReqPanelInPlace');
  assert.ok(docBody && reqBody, '须能提取双路原地保存函数');
  for (const [n, b] of [['saveDocInPlace', docBody], ['saveReqPanelInPlace', reqBody]]) {
    assert.ok(!/exitEdit/.test(b), n + '不得调用exitEdit（原地保存不退出编辑）');
    assert.ok(!/editOn\s*=\s*false/.test(b), n + '不得写editOn=false');
    assert.ok(/setSelectionRange/.test(b), n + '须恢复selection');
    assert.ok(/scrollTop/.test(b), n + '须恢复scrollTop视口');
    assert.ok(/已保存/.test(b), n + '须toast已保存');
  }
  assert.ok(/editBase=String\(el\.value/.test(docBody), 'saveDocInPlace须更新editBase防脏误报');
  assert.ok(docBody.includes('saveReqPanelInPlace()'), 'saveDocInPlace须按activeElement分流到req面板');
  assert.ok(/if\(!editOn\|\|!docEditArea\)return/.test(docBody), '非编辑态须直接返回');
}

// ── A8 16组快捷键复用DocToolbarActions(删anchor)+自建undo绑定（源码级） ──
function testA8_KeymapSrc() {
  const body = extractFn(coreSrc, 'onDocKeydown');
  assert.ok(body, '须能提取onDocKeydown');
  assert.ok(body.includes('isAnyDocEditing'), '须先判isAnyDocEditing');
  assert.ok(body.includes("tid!=='docEditArea'") && body.includes("tid!=='reqEditArea'"), '须限定docEditArea/reqEditArea双框生效');
  assert.ok(/saveDocInPlace\(\)/.test(body), 'Ctrl+S须走saveDocInPlace');
  assert.ok(/cancelEdit\(\)/.test(body), 'Esc须走cancelEdit');
  assert.ok(/tbIndent\(/.test(body), 'Tab须走tbIndent');
  assert.ok(/tbEnterList\(\)/.test(body), '回车须走tbEnterList');
  assert.ok(body.includes("kl==='v'") && body.includes("kl==='f'"), 'Ctrl+V/Ctrl+F须显式放行(粘贴图片/文档检索)');
  const acts = ['strike', 'ul', 'ol', 'task', 'image', 'assets', 'bold', 'italic', 'table', 'h1', 'h2', 'h3', 'para'];
  for (const a of acts) assert.ok(body.includes("act='" + a + "'"), 'onDocKeydown缺映射:' + a);
  assert.ok(!body.includes("act='anchor'"), '锚点删除后不应再映射anchor');
  assert.ok(body.includes('DocToolbarActions[act]'), '须复用DocToolbarActions[act]()执行');
  assert.ok(!coreSrc.includes('function tbAnchorAct'), '须无tbAnchorAct实现');
  // 自建undo栈绑定：Ctrl+Z撤销、Ctrl+Shift+Z/Ctrl+Y重做
  assert.ok(body.includes('docUndoDo'), 'Ctrl+Z须绑定docUndoDo');
  assert.ok(body.includes('docRedoDo'), 'Ctrl+Y须绑定docRedoDo');
  assert.ok(coreSrc.includes('function docUndoDo('), '须有docUndoDo实现');
  assert.ok(coreSrc.includes('function docRedoDo('), '须有docRedoDo实现');
  // 双框绑定
  const bindDoc = (coreSrc.match(/docEditArea\.addEventListener\('keydown',onDocKeydown\)/g) || []).length;
  const bindReq = (coreSrc.match(/reqEditAreaEl2\.addEventListener\('keydown',onDocKeydown\)/g) || []).length;
  assert.ok(bindDoc >= 1, 'docEditArea须绑定keydown->onDocKeydown');
  assert.ok(bindReq >= 1, 'reqEditArea须绑定keydown->onDocKeydown');
}

// ── A9 弹窗Esc/遮罩语义（源码级） ──
function testA9_MaskSrc() {
  const keyBody = extractFn(coreSrc, 'onDocKeydown');
  assert.ok(/getElementById\('docShortcutMask'\)[\s\S]{0,120}display!=='none'\)return/.test(keyBody), 'Esc时弹窗打开须优先return（不放弃编辑）');
  const openBody = extractFn(coreSrc, 'openDocShortcut');
  const closeBody = extractFn(coreSrc, 'closeDocShortcut');
  assert.ok(openBody.includes("display='flex'") && openBody.includes('docShortcutOpened=true'), 'open须display=flex+标记true');
  assert.ok(closeBody.includes("display='none'") && closeBody.includes('docShortcutOpened=false'), 'close须display=none+标记false');
  assert.ok(coreSrc.includes("MaskStack.push('docShortcutMask'") || coreSrc.includes('MaskStack.push'), 'open须MaskStack.push模态');
  assert.ok(coreSrc.includes("MaskStack.pop('docShortcutMask'") || coreSrc.includes('MaskStack.pop'), 'close须MaskStack.pop');
  assert.ok(coreSrc.includes("MaskStack.register('docShortcutMask'") || coreSrc.includes('MaskStack') && coreSrc.includes('docShortcutMask'), '须向MaskStack注册实现Esc/点遮罩关闭');
  const bindBody = extractFn(coreSrc, 'bindDocShortcut');
  assert.ok(bindBody.includes('docShortcutClose') && bindBody.includes('docShortcutOk'), '须绑定关闭X与底部关闭按钮');
  assert.ok(bindBody.includes('.doc-shortcut-link'), '须绑定.doc-shortcut-link入口（含doc/req双按钮）');
}

// ── S1 Ctrl+S后editOn仍true且selection恢复（真执行fake textarea stub） ──
function testS1_InPlaceRuntime() {
  const { sandbox, elCache, fakeDoc } = loadCore();
  assert.strictEqual(typeof sandbox.saveDocInPlace, 'function', '须暴露saveDocInPlace');
  const ta = elCache['docEditArea'];
  const editBox = elCache['docEdit'];
  editBox.style.display = 'flex';
  sandbox.editOn = true;
  sandbox.reqMode = false;
  sandbox.currentSource = { md: 'old', docs: {} };
  sandbox.editBase = 'old';
  ta.value = 'hello world';
  ta.selectionStart = 4; ta.selectionEnd = 7; ta.scrollTop = 11;
  ta._setSelCalls.length = 0;
  fakeDoc.activeElement = ta;
  sandbox.saveDocInPlace();
  assert.strictEqual(sandbox.editOn, true, 'Ctrl+S原地保存后editOn须仍true（不退出编辑）');
  assert.strictEqual(editBox.style.display, 'flex', '编辑容器须保持可见，不被隐藏');
  assert.ok(ta._setSelCalls.length >= 1, '须调用setSelectionRange恢复光标');
  const last = ta._setSelCalls[ta._setSelCalls.length - 1];
  assert.deepStrictEqual(last, [4, 7], `光标应恢复[4,7]，实际${JSON.stringify(last)}`);
  assert.strictEqual(ta.scrollTop, 11, 'scrollTop视口须恢复');
  assert.strictEqual(sandbox.editBase, 'hello world', 'editBase须同步新值防脏误报');
  assert.strictEqual(sandbox.currentSource.md, 'hello world', 'currentSource.md须落盘新值');
  // req面板同理
  const re = elCache['reqEditArea'];
  re.value = 'req hello';
  re.selectionStart = 2; re.selectionEnd = 5; re.scrollTop = 9;
  re._setSelCalls.length = 0;
  sandbox.reqText = 'old-req';
  sandbox.saveReqPanelInPlace();
  assert.deepStrictEqual(re._setSelCalls[re._setSelCalls.length - 1], [2, 5], 'req面板光标须恢复[2,5]');
  assert.strictEqual(re.scrollTop, 9, 'req面板scrollTop须恢复');
  assert.strictEqual(sandbox.reqText, 'req hello', 'reqText须更新');
}

// ── S2 各快捷键映射到对应action（真分发onDocKeydown，锚点已删） ──
function testS2_KeyDispatch() {
  const { sandbox, elCache, fakeDoc } = loadCore();
  assert.strictEqual(typeof sandbox.onDocKeydown, 'function', '须暴露onDocKeydown');
  sandbox.editOn = true;
  const mask = sandbox.document.getElementById('docShortcutMask');
  mask.style.display = 'none';
  const calls = [];
  // 桩化13个toolbar动作(删anchor)
  const actions = sandbox.DocToolbar.actions;
  assert.strictEqual(actions.anchor, undefined, 'DocToolbar映射须无anchor');
  for (const k of ['h1', 'h2', 'h3', 'para', 'bold', 'italic', 'strike', 'ul', 'ol', 'task', 'table', 'image', 'assets']) {
    actions[k] = (function (kk) { return function () { calls.push(kk); }; })(k);
  }
  // 桩化控制键通道
  sandbox.saveDocInPlace = function () { calls.push('__save__'); };
  sandbox.cancelEdit = function () { calls.push('__cancel__'); };
  sandbox.tbIndent = function (out) { calls.push(out ? '__outdent__' : '__indent__'); };
  sandbox.tbEnterList = function () { calls.push('__enter__'); return true; };
  sandbox.docUndoDo = function () { calls.push('__undo__'); return true; };
  sandbox.docRedoDo = function () { calls.push('__redo__'); return true; };
  fakeDoc.activeElement = elCache['docEditArea'];
  const matrix = [
    [{ key: 'b', ctrlKey: true, target: { id: 'docEditArea' } }, 'bold'],
    [{ key: 'i', ctrlKey: true, target: { id: 'docEditArea' } }, 'italic'],
    [{ key: 't', ctrlKey: true, target: { id: 'docEditArea' } }, 'table'],
    [{ key: '1', ctrlKey: true, target: { id: 'docEditArea' } }, 'h1'],
    [{ key: '2', ctrlKey: true, target: { id: 'docEditArea' } }, 'h2'],
    [{ key: '3', ctrlKey: true, target: { id: 'docEditArea' } }, 'h3'],
    [{ key: '0', ctrlKey: true, target: { id: 'docEditArea' } }, 'para'],
    [{ key: 's', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }, 'strike'],
    [{ key: 'u', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }, 'ul'],
    [{ key: 'o', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }, 'ol'],
    [{ key: 't', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }, 'task'],
    [{ key: 'i', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }, 'image'],
    [{ key: 'p', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }, 'assets'],
    [{ key: 's', ctrlKey: true, target: { id: 'docEditArea' } }, '__save__'],
    [{ key: 'Tab', target: { id: 'docEditArea' } }, '__indent__'],
    [{ key: 'Tab', shiftKey: true, target: { id: 'docEditArea' } }, '__outdent__'],
    [{ key: 'Enter', target: { id: 'docEditArea' } }, '__enter__'],
    [{ key: 'Escape', target: { id: 'docEditArea' } }, '__cancel__']
  ];
  for (const [evOver, want] of matrix) {
    calls.length = 0;
    sandbox.onDocKeydown(mkKeyEvent(evOver));
    assert.ok(calls.includes(want), `按键${JSON.stringify(evOver)}应触发${want}，实际${JSON.stringify(calls)}`);
  }
  // 锚点删除：Ctrl+Shift+A须不再触发任何动作
  calls.length = 0;
  sandbox.onDocKeydown(mkKeyEvent({ key: 'a', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }));
  assert.strictEqual(calls.length, 0, `Ctrl+Shift+A删除后须无动作，实际${JSON.stringify(calls)}`);
  // 自建undo：Ctrl+Z撤销、Ctrl+Y/Ctrl+Shift+Z重做须分发
  calls.length = 0;
  sandbox.onDocKeydown(mkKeyEvent({ key: 'z', ctrlKey: true, target: { id: 'docEditArea' } }));
  assert.ok(calls.includes('__undo__'), `Ctrl+Z应触发undo，实际${JSON.stringify(calls)}`);
  calls.length = 0;
  sandbox.onDocKeydown(mkKeyEvent({ key: 'y', ctrlKey: true, target: { id: 'docEditArea' } }));
  assert.ok(calls.includes('__redo__'), `Ctrl+Y应触发redo，实际${JSON.stringify(calls)}`);
  calls.length = 0;
  sandbox.onDocKeydown(mkKeyEvent({ key: 'z', ctrlKey: true, shiftKey: true, target: { id: 'docEditArea' } }));
  assert.ok(calls.includes('__redo__'), `Ctrl+Shift+Z应触发redo，实际${JSON.stringify(calls)}`);
  // req框同样生效（抽查2组）
  calls.length = 0;
  sandbox.onDocKeydown(mkKeyEvent({ key: 'b', ctrlKey: true, target: { id: 'reqEditArea' } }));
  assert.ok(calls.includes('bold'), 'reqEditArea内Ctrl+B须同样触发bold');
  // Ctrl+V / Ctrl+F 显式放行：不得触发任何toolbar动作
  for (const k of ['v', 'f']) {
    calls.length = 0;
    sandbox.onDocKeydown(mkKeyEvent({ key: k, ctrlKey: true, target: { id: 'docEditArea' } }));
    assert.strictEqual(calls.length, 0, `Ctrl+${k}须放行不触发动作，实际${JSON.stringify(calls)}`);
  }
  // 非编辑态不响应
  sandbox.editOn = false;
  sandbox.reqEditing = false;
  calls.length = 0;
  sandbox.onDocKeydown(mkKeyEvent({ key: 'b', ctrlKey: true, target: { id: 'docEditArea' } }));
  assert.strictEqual(calls.length, 0, '非编辑态须不响应快捷键');
}

// ── S4 自建undo栈函数与运行时（docUndoDo/docRedoDo） ──
function testS4_UndoStack() {
  const { sandbox, elCache } = loadCore();
  assert.strictEqual(typeof sandbox.docUndoDo, 'function', '须暴露docUndoDo');
  assert.strictEqual(typeof sandbox.docRedoDo, 'function', '须暴露docRedoDo');
  assert.ok(coreSrc.includes('function docUndoDo('), '源码须有docUndoDo实现');
  assert.ok(coreSrc.includes('function docRedoDo('), '源码须有docRedoDo实现');
  assert.ok(coreSrc.includes('DOC_UNDO_LIMIT'), '须有自建undo栈上限DOC_UNDO_LIMIT');
  assert.ok(coreSrc.includes('function docUndoPush('), '须有docUndoPush压栈');
  assert.ok(coreSrc.includes('function docUndoReset('), '须有docUndoReset初始化');
  const keyBody = extractFn(coreSrc, 'onDocKeydown');
  assert.ok(keyBody.includes('docUndoDo') && keyBody.includes('docRedoDo'), 'onDocKeydown须绑定undo/redo');
  // 运行时：reset v1 → push v2 → undo回v1 → redo回v2
  const ta = elCache['docEditArea'];
  ta.value = 'v1';
  ta.selectionStart = 2; ta.selectionEnd = 2;
  sandbox.docUndoReset(ta, 'v1');
  ta.value = 'v2';
  ta.selectionStart = 2; ta.selectionEnd = 2;
  sandbox.docUndoPush(ta);
  const okUndo = sandbox.docUndoDo(ta);
  assert.strictEqual(okUndo, true, 'undo应返回true');
  assert.strictEqual(ta.value, 'v1', 'undo后应恢复v1，实际' + ta.value);
  const okRedo = sandbox.docRedoDo(ta);
  assert.strictEqual(okRedo, true, 'redo应返回true');
  assert.strictEqual(ta.value, 'v2', 'redo后应恢复v2，实际' + ta.value);
}

// ── S5 回车五分支与有序ol修复（tbEnterList/tbListAct） ──
function testS5_EnterFiveAndOl() {
  const { sandbox } = loadCore();
  assert.strictEqual(typeof sandbox.tbEnterList, 'function', '须暴露tbEnterList');
  assert.strictEqual(typeof sandbox.tbListAct, 'function', '须暴露tbListAct');
  assert.ok(coreSrc.includes('function tbEnterList('), '源码须有tbEnterList实现');
  assert.ok(coreSrc.includes('function tbListAct('), '源码须有tbListAct实现');
  const body = extractFn(coreSrc, 'tbEnterList');
  assert.ok(body, '须能提取tbEnterList函数体');
  assert.ok(body.includes('五种行为') || body.includes('回车收敛'), '须注释五分支收敛');
  assert.ok(body.includes('isTableRow'), '须有表格内换行分支(行为2)');
  assert.ok(body.includes('mTask'), '须有任务列表分支(行为5)');
  assert.ok(body.includes('mOl'), '须有序列表重排分支(行为3)');
  assert.ok(body.includes('mUl'), '须有无序列表分支(行为4)');
  assert.ok(/文本换行/.test(body), '须有文本换行分支(行为1)');
  assert.ok(coreSrc.includes("'1. '"), 'tbListAct有序须产1. 前缀');
  const listBody = extractFn(coreSrc, 'tbListAct');
  assert.ok(listBody.includes("'1. '"), 'tbListAct函数体内须含1. 前缀');
}

// ── S3 弹窗Esc关闭与开关（真执行） ──
function testS3_PopupEsc() {
  const { sandbox } = loadCore();
  sandbox.editOn = true;
  const mask = sandbox.document.getElementById('docShortcutMask');
  // open/close 基本语义
  sandbox.openDocShortcut();
  assert.strictEqual(mask.style.display, 'flex', 'open后mask须flex可见');
  assert.strictEqual(sandbox.docShortcutOpened, true, 'open后标记须true');
  sandbox.closeDocShortcut();
  assert.strictEqual(mask.style.display, 'none', 'close后mask须none隐藏');
  assert.strictEqual(sandbox.docShortcutOpened, false, 'close后标记须false');
  // Esc：弹窗打开时不放弃编辑
  let cancelled = 0;
  sandbox.cancelEdit = function () { cancelled++; };
  mask.style.display = 'flex';
  sandbox.onDocKeydown(mkKeyEvent({ key: 'Escape', target: { id: 'docEditArea' } }));
  assert.strictEqual(cancelled, 0, '弹窗打开时Esc须被弹窗消费，不得cancelEdit');
  mask.style.display = 'none';
  sandbox.onDocKeydown(mkKeyEvent({ key: 'Escape', target: { id: 'docEditArea' } }));
  assert.strictEqual(cancelled, 1, '弹窗关闭时Esc须走cancelEdit放弃编辑');
}

// ── A10 设置页快捷键Tab（tabNavShortcut/paneSetShortcut，关于上方，现22行6组：文档编辑分组已删） ──
function testA10_SettingsShortcutTab() {
  for (const id of ['tabNavShortcut', 'paneSetShortcut', 'tabNavAbout', 'paneSetAbout']) {
    assert.ok(htmlSrc.includes('id="' + id + '"'), '设置页缺失#' + id);
  }
  assert.ok(htmlSrc.includes('data-tab="shortcut"'), '快捷键Tab须有data-tab="shortcut"');
  const navIdx = htmlSrc.indexOf('id="tabNavShortcut"');
  const aboutNavIdx = htmlSrc.indexOf('id="tabNavAbout"');
  assert.ok(navIdx >= 0 && aboutNavIdx >= 0 && navIdx < aboutNavIdx, 'tabNavShortcut须在tabNavAbout（关于）上方');
  const paneIdx = htmlSrc.indexOf('id="paneSetShortcut"');
  const aboutPaneIdx = htmlSrc.indexOf('id="paneSetAbout"');
  assert.ok(paneIdx >= 0 && aboutPaneIdx >= 0 && paneIdx < aboutPaneIdx, 'paneSetShortcut须在paneSetAbout上方');
  assert.ok(htmlSrc.includes('快捷键一览'), 'paneSetShortcut须含标题快捷键一览');
  const sec = htmlSrc.slice(paneIdx, aboutPaneIdx);
  const rows = (sec.match(/set-shortcut-row/g) || []).length;
  assert.strictEqual(rows, 22, `设置快捷键一览行数应22行（文档编辑分组已删，现6组），实际${rows}`);
  // 无文档编辑分组，6组存在
  assert.ok(!sec.includes('文档编辑'), '文档编辑分组须已删除（设置页不得含“文档编辑”）');
  const needGroups = ['预览拾取与就地改', 'AI 对话', '文档检索', '段落微浮层', '通用输入框', 'Esc 关闭体系'];
  assert.strictEqual(needGroups.length, 6, '应恰6组');
  for (const g of needGroups) assert.ok(sec.includes(g), '设置快捷键一览缺分组:' + g);
  // Ctrl+Shift+单击文案存在（就地改唯一入口）
  assert.ok(sec.includes('Ctrl+Shift+单击'), '须有 Ctrl+Shift+单击（就地改唯一入口）');
  assert.ok(sec.includes('直接进入就地改浮层而不拾取'), 'Ctrl+Shift+单击文案须为“直接进入就地改浮层而不拾取”');
  // 无原型双击行（文案去双击）；保留项不断言删除，须仍在
  assert.ok(!/双击[^<]*就地改/.test(sec), '不得有“双击…就地改”原型双击行（已去双击）');
  assert.ok(!sec.includes('双击原型'), '不得有“双击原型”行');
  assert.ok(!sec.includes('双击进入'), '不得有“双击进入”行');
  assert.ok(sec.includes('Ctrl+滚轮 / 双击舞台'), '须保留 Ctrl+滚轮 / 双击舞台（舞台缩放，非文档项）');
  assert.ok(sec.includes('双击侧栏项'), '须保留 双击侧栏项（重命名，非文档项）');
  // 关键条目抽查（现22行内真实存在）
  const needKeys = ['Ctrl+Shift+单击', '就地改内 Ctrl+Enter', 'Ctrl+滚轮 / 双击舞台', '双击侧栏项', '文档面板内 Ctrl+F', '微浮层内 Ctrl+S', 'Esc'];
  for (const k of needKeys) assert.ok(sec.includes(k), '设置快捷键一览缺关键条目:' + k);
}

// ── A11 需求草稿按原型隔离（串沙箱回归：显示/保存/取消曾串到其他原型） ──
function testA11_ReqDraftIsolation() {
  assert.ok(!/return 'protoDocDraft___req__'/.test(coreSrc), '不得再有全局需求草稿键');
  const { sandbox } = loadCore();
  assert.strictEqual(typeof sandbox.draftKeyFor, 'function', '须暴露draftKeyFor');
  sandbox.currentSource = { name: 'ProtoA', kind: 'pc' };
  const ka = sandbox.draftKeyFor(true);
  const kaDoc = sandbox.draftKeyFor(false);
  sandbox.currentSource = { name: 'ProtoB', kind: 'pc' };
  const kb = sandbox.draftKeyFor(true);
  assert.notStrictEqual(ka, kb, `不同原型需求草稿键须不同，实际${ka} vs ${kb}`);
  assert.ok(ka.includes('ProtoA') && kb.includes('ProtoB'), `草稿键须带原型名，实际${ka} vs ${kb}`);
  assert.notStrictEqual(ka, kaDoc, '同原型下需求与说明草稿键须不同');
  // 切原型须先落定时草稿（防500ms定时器把旧文本写到新键下）
  const sbSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
  assert.ok(/function loadSource\(src, keepPanels\)\{[\s\S]{0,800}draftTimer/.test(sbSrc), 'loadSource须先落定时草稿');
  // 需求读取须带目录守卫（快切原型时旧读回包直接丢弃）
  const paeSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
  assert.ok((paeSrc.match(/wantDir/g) || []).length >= 4, 'loadReqContent/renderReqIntoDocs须带目录守卫');
}

function runAll() {
  const tests = [
    ['A1 新提示文案双处+双按钮', testA1_NewTip],
    ['A2 旧文案可换行消失', testA2_OldTipGone],
    ['A3 蓝色快捷键按钮', testA3_BlueLink],
    ['A4 弹窗DOM+21行表(删A加Z/Y)', testA4_ShortcutMask],
    ['A5 核心函数与映射', testA5_CoreFns],
    ['A6 编辑态隐藏逻辑', testA6_EditChrome],
    ['A7 原地保存源码语义', testA7_InPlaceSrc],
    ['A8 16组快捷键复用+undo绑定', testA8_KeymapSrc],
    ['A9 弹窗Esc源码语义', testA9_MaskSrc],
    ['S1 原地保存运行时', testS1_InPlaceRuntime],
    ['S2 快捷键真分发(无anchor含Z/Y)', testS2_KeyDispatch],
    ['S3 弹窗Esc运行时', testS3_PopupEsc],
    ['S4 自建undo栈运行时', testS4_UndoStack],
    ['S5 回车五分支+有序ol', testS5_EnterFiveAndOl],
    ['A10 设置页快捷键Tab(关于上方+行数+关键条目)', testA10_SettingsShortcutTab],
    ['A11 需求草稿按原型隔离', testA11_ReqDraftIsolation]
  ];
  let passed = 0, failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(failed ? 'DOC_EDIT_FAIL' : 'DOC_EDIT_PASS: 全部16项文档编辑体验断言通过');
  process.exitCode = failed ? 1 : 0;
}
runAll();
