'use strict';
// P1 MD展示与编辑重构回归：GFM排版/任务回写/表格对齐/callout/引用/图片资产/目录/工具栏/守卫（纯Node，不启动Electron）
// 手段：源文提取 + 最小fake DOM/document/localStorage/navigator + vm加载js/core-docs.js，对应DoD第四节
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(rootDir, 'js', 'core-docs.js'), 'utf8');
const mainSrc = (() => {
  // Wave-B兼容：主进程已拆为 main.js(骨架)+main/controllers+main/services，聚合后断言（72通道契约不变）
  const __files = [path.join(rootDir, 'main.js')];
  const __walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) __walk(p);
      else if (e.isFile() && p.endsWith('.js')) __files.push(p);
    }
  };
  __walk(path.join(rootDir, 'main'));
  return __files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }).join('\n');
})();
const preloadSrc = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
const exportSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');

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

function loadCore() {
  const elCache = {};
  const fakeDoc = {
    getElementById(id) { if (!elCache[id]) elCache[id] = mkEl(id); return elCache[id]; },
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
    console, setTimeout, clearTimeout,
    Map, JSON, Math, Date, RegExp, encodeURIComponent, decodeURIComponent,
    Promise, Object, Array, String, Number, Boolean, Error, URL
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox, { filename: 'js/core-docs.js' });
  return { sandbox, elCache };
}

const OPTS = { project: 'DemoProj', proto: 'DemoProto' };
const ctx = loadCore();
const sb = ctx.sandbox;
const elCache = ctx.elCache;

assert.strictEqual(typeof sb.renderMd, 'function', 'core-docs须暴露renderMd');
assert.strictEqual(typeof sb.extractHeadings, 'function', 'core-docs须暴露extractHeadings');
console.log('[INIT] vm加载core-docs成功 renderMd/extractHeadings可用');

// 断言1：标题H1~H6
function test1_Headings() {
  for (let lv = 1; lv <= 6; lv++) {
    const md = new Array(lv + 1).join('#') + ' T' + lv;
    const h = sb.renderMd(md, OPTS);
    assert.ok(h.includes('<h' + lv + ' class="md-h">'), 'H' + lv + '应渲染为h' + lv + '.md-h，实际:' + h.slice(0, 120));
    assert.ok(h.includes('T' + lv), 'H' + lv + '文本丢失');
  }
}

// 断言2：加粗/斜体/删除线
function test2_InlineEmphasis() {
  const h = sb.renderMd('**加粗** and *斜体* and ~~删除线~~', OPTS);
  assert.ok(h.includes('<strong>加粗</strong>'), '加粗**应渲染strong，实际:' + h.slice(0, 200));
  assert.ok(h.includes('<em>斜体</em>'), '斜体*应渲染em，实际:' + h.slice(0, 200));
  assert.ok(h.includes('<del>删除线</del>'), '删除线~~应渲染del，实际:' + h.slice(0, 200));
}

// 断言3：行内代码+围栏代码
function test3_Code() {
  const inline = sb.renderMd('hi `code` end', OPTS);
  assert.ok(inline.includes('<code>code</code>'), '行内代码应渲染code，实际:' + inline.slice(0, 200));
  const fence = sb.renderMd('```js\nvar a=1;\n```', OPTS);
  assert.ok(fence.includes('md-code-wrap'), '围栏代码应包md-code-wrap，实际:' + fence.slice(0, 200));
  assert.ok(fence.includes('<code'), '围栏代码应含code标签');
  assert.ok(fence.includes('var a=1;'), '围栏代码内容丢失');
  assert.ok(fence.includes('lang-js'), '围栏语言应保留lang-js');
}

// 断言4：任务列表渲染与索引
function test4_TaskRender() {
  const h = sb.renderMd('- [ ] todo\n- [x] done', OPTS);
  assert.ok(h.includes('md-task-list'), '任务列表应含md-task-list');
  assert.ok(h.includes('class="doc-task"'), '任务项应含doc-task checkbox');
  assert.ok(h.includes('data-task-idx="0"'), '首项索引应为0');
  assert.ok(h.includes('data-task-idx="1"'), '次项索引应为1');
  assert.ok(h.includes('checked'), '已完成项应含checked');
  const count = (h.match(/data-task-idx="/g) || []).length;
  assert.strictEqual(count, 2, '两项任务应有两个索引，实际' + count);
}

// 断言5：任务回写索引（含围栏跳过）
function test5_TaskToggle() {
  sb.currentSource = { name: 'Demo.html', kind: 'mobile', md: '- [ ] alpha\n- [x] beta\n- [ ] gamma\n', docs: {} };
  sb.reqMode = false;
  sb.mdTaskToggle(0, true);
  assert.strictEqual(sb.currentSource.md, '- [x] alpha\n- [x] beta\n- [ ] gamma\n', 'idx0置true应只改首行');
  sb.mdTaskToggle(1, false);
  assert.strictEqual(sb.currentSource.md, '- [x] alpha\n- [ ] beta\n- [ ] gamma\n', 'idx1置false应只改次行');
  // 围栏内任务不计数
  sb.currentSource.md = '```\n- [ ] fenced\n```\n- [ ] real\n';
  sb.currentSource.docs = {};
  sb.mdTaskToggle(0, true);
  assert.strictEqual(sb.currentSource.md, '```\n- [ ] fenced\n```\n- [x] real\n', '围栏内任务应跳过，idx0应命中real行');
}

// 断言6：对齐表格th(text-align)+wrap
function test6_TableAlign() {
  const h = sb.renderMd('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |', OPTS);
  assert.ok(h.includes('md-table-wrap'), '表格应包md-table-wrap');
  assert.ok(h.includes('md-table'), '表格应含md-table');
  assert.ok(h.includes('<th style="text-align:left;">a</th>'), '左对齐th缺失，实际:' + h.slice(0, 400));
  assert.ok(h.includes('<th style="text-align:center;">b</th>'), '居中th缺失');
  assert.ok(h.includes('<th style="text-align:right;">c</th>'), '右对齐th缺失');
  assert.ok(h.includes('<td style="text-align:center;">2</td>'), '居中td缺失');
}

// 断言7：callout三类
function test7_Callout() {
  const n = sb.renderMd('> [!NOTE] hello', OPTS);
  assert.ok(n.includes('md-callout') && n.includes('md-note'), 'NOTE应含md-callout md-note');
  assert.ok(n.includes('NOTE'), 'NOTE标题丢失');
  const t = sb.renderMd('> [!TIP] tip', OPTS);
  assert.ok(t.includes('md-tip'), 'TIP应含md-tip');
  const w = sb.renderMd('> [!WARNING] warn', OPTS);
  assert.ok(w.includes('md-warning'), 'WARNING应含md-warning');
  assert.ok(w.includes('WARNING'), 'WARNING标题丢失');
}

// 断言8：普通引用
function test8_Quote() {
  const h = sb.renderMd('> hello quote', OPTS);
  assert.ok(h.includes('<blockquote class="md-quote"'), '普通引用应为blockquote.md-quote');
  assert.ok(h.includes('hello quote'), '引用内容丢失');
  assert.ok(!h.includes('md-callout'), '普通引用不应含callout类');
}

// 断言9：相对assets重写为proto-asset
function test9_AssetRewrite() {
  const h = sb.renderMd('![alt](assets/a.png)', OPTS);
  assert.ok(h.includes('proto-asset://local/DemoProj/DemoProto/assets/a.png'), '相对assets应重写为proto-asset://local/项目/原型/路径，实际:' + h.slice(0, 400));
  assert.ok(h.includes('data-src="assets/a.png"'), '应保留data-src原文');
  assert.ok(h.includes('class="md-img-el"'), '图片应含md-img-el供Lightbox/容错绑定');
  const h2 = sb.renderMd('![b](./assets/b.png)', OPTS);
  assert.ok(h2.includes('proto-asset://local/'), './前缀也应重写');
}

// 断言10：data:/http原样
function test10_AssetPassthrough() {
  const d = sb.renderMd('![a](data:image/png;base64,AAA)', OPTS);
  assert.ok(d.includes('src="data:image/png;base64,AAA"'), 'data:应原样保留');
  assert.ok(!d.includes('proto-asset://'), 'data:不应被重写');
  const h1 = sb.renderMd('![b](http://x/y.png)', OPTS);
  assert.ok(h1.includes('src="http://x/y.png"'), 'http应原样保留');
  const h2 = sb.renderMd('![c](https://x/y.png)', OPTS);
  assert.ok(h2.includes('src="https://x/y.png"'), 'https应原样保留');
}

// 断言11：缺失图片虚线卡片不抛
function test11_MissingImg() {
  let h = '';
  assert.doesNotThrow(() => { h = sb.renderMd('![alt](assets/missing.png)', OPTS); }, '缺失图片渲染不应抛错');
  assert.ok(h.includes('md-img-el'), '缺失图片首屏仍渲染img占位');
  assert.ok(coreSrc.includes('md-img-missing'), '须有md-img-missing容错节点');
  assert.ok(coreSrc.includes('1px dashed'), '容错卡片须为虚线边框');
  assert.ok(coreSrc.includes('60px'), '容错卡片最小高度60px');
  assert.ok(coreSrc.includes('图片丢失'), '容错卡片文案应含图片丢失');
  assert.ok(coreSrc.includes('replaceChild'), '容错应replaceChild替换img不抛错');
}

// 断言12：extractHeadings顺序（vm跨realm数组须用JSON比对，避免deepStrictEqual原型不一致误报）
function test12_HeadingsOrder() {
  const hs = sb.extractHeadings('# H1\ntext\n### H3\n## H2\n');
  assert.strictEqual(hs.length, 3, '应提取3个标题，实际' + JSON.stringify(hs));
  assert.strictEqual(JSON.stringify(Array.from(hs.map(x => x.text))), JSON.stringify(['H1', 'H3', 'H2']), '顺序应按源码行序');
  assert.strictEqual(JSON.stringify(Array.from(hs.map(x => x.level))), JSON.stringify([1, 3, 2]), 'level应为1/3/2');
  assert.ok(hs[0].line === 0 && hs[1].line === 2 && hs[2].line === 3, 'line行号应为0/2/3，实际' + JSON.stringify(hs));
  const fenced = sb.extractHeadings('```\n# fenced\n```\n# real\n');
  assert.strictEqual(fenced.length, 1, '围栏内标题应跳过');
  assert.strictEqual(fenced[0].text, 'real', '仅保留real标题');
}

// 断言13：工具栏15动作(锚点已删)与DocGuard接口
function test13_ToolbarGuard() {
  const acts = sb.DocToolbar && sb.DocToolbar.actions;
  assert.ok(acts, '须暴露window.DocToolbar.actions');
  const need = ['h1', 'h2', 'h3', 'para', 'bold', 'italic', 'strike', 'ul', 'ol', 'task', 'table', 'image', 'assets', 'save', 'cancel'];
  for (const k of need) assert.strictEqual(typeof acts[k], 'function', '工具栏缺动作:' + k);
  assert.strictEqual(acts.anchor, undefined, '锚点anchor动作须已删除');
  assert.ok(!Object.prototype.hasOwnProperty.call(acts, 'anchor'), '映射须无anchor键');
  assert.strictEqual(Object.keys(acts).length, 15, '工具栏动作应为15个(删anchor后)，实际' + Object.keys(acts).length);
  assert.ok(!coreSrc.includes("act='anchor'"), '键盘映射须无anchor');
  assert.ok(!coreSrc.includes('function tbAnchorAct'), '须无tbAnchorAct实现');
  assert.strictEqual(typeof sb.DocToolbar.bind, 'function', 'DocToolbar.bind须为函数');
  assert.strictEqual(typeof sb.bindDocToolbar, 'function', '全局bindDocToolbar须为函数');
  assert.ok(sb.DocGuard, '须暴露window.DocGuard');
  assert.strictEqual(typeof sb.DocGuard.isDirty, 'function', 'DocGuard.isDirty须为函数');
  assert.strictEqual(typeof sb.DocGuard.confirmLeave, 'function', 'DocGuard.confirmLeave须为函数');
}

// 断言14：renderMd单参兼容
function test14_SingleParam() {
  let h = '';
  assert.doesNotThrow(() => { h = sb.renderMd('# Solo'); }, 'renderMd单参不应抛错');
  assert.ok(h.includes('<h1'), '单参应渲染h1，实际:' + h.slice(0, 120));
  let empty = '';
  assert.doesNotThrow(() => { empty = sb.renderMd(''); }, '空串不应抛错');
  assert.ok(empty.includes('doc-empty'), '空串应返回doc-empty占位');
}

// 断言15：主进程+预加载资产通道
function test15_MainPreload() {
  assert.ok(mainSrc.includes("protocol.registerSchemesAsPrivileged"), 'main须注册特权协议');
  assert.ok(mainSrc.includes('proto-asset'), 'main须含proto-asset协议');
  assert.ok(mainSrc.includes("ipcMain.handle('sandbox:save-asset'"), 'main须有save-asset通道');
  assert.ok(mainSrc.includes("ipcMain.handle('sandbox:read-asset-base64'"), 'main须有read-asset-base64通道');
  assert.ok(preloadSrc.includes('saveAsset'), 'preload须暴露saveAsset');
  assert.ok(preloadSrc.includes('readAssetBase64'), 'preload须暴露readAssetBase64');
  assert.ok(mainSrc.includes('o2.dataUrl'), 'save-asset读取前端dataUrl字段');
}

// 断言16：无#docToolbar空块+CSS零残留+导出内联+图片文案（P5精简）
function test16_HtmlCssExport() {
  assert.ok(!htmlSrc.includes('id="docToolbar"'), '精简5：HTML不应残留#docToolbar空容器');
  assert.ok(!htmlSrc.includes('doc-edit-toolbar'), '精简5：HTML不应残留doc-edit-toolbar类');
  assert.ok(!cssSrc.includes('.doc-edit-toolbar'), '精简5：CSS不应残留.doc-edit-toolbar');
  assert.ok(!cssSrc.includes('docToolbar'), '精简5：CSS不应残留docToolbar选择器');
  assert.ok(cssSrc.includes('.doc-lightbox-mask'), 'CSS须有.doc-lightbox-mask');
  assert.ok(cssSrc.includes('.md-table-wrap'), 'CSS须有.md-table-wrap');
  assert.ok(exportSrc.includes('inlineMarkdownImages'), '导出引擎须含inlineMarkdownImages');
  assert.ok(exportSrc.includes('function buildExportHtml'), '导出引擎须含buildExportHtml');
  assert.ok(exportSrc.includes('readAssetBase64'), '导出内联须走readAssetBase64');
  assert.ok(coreSrc.includes("b.textContent='图片'"), '资产改名图片：抽屉入口文案须为图片');
  assert.ok(coreSrc.includes('图片抽屉'), '资产改名图片：标题须含图片抽屉');
  assert.ok(coreSrc.includes('已插入图片引用') || coreSrc.includes('图片已保存'), '图片操作toast须含图片文案');
  assert.ok(coreSrc.includes('btnDocAssets'), '标识符保留：btnDocAssets不动');
}

// 断言17：有序ol修为ol（1./1) → ol，-/+/* → ul；tbListAct产1. ）
function test17_OrderedListOl() {
  const olDot = sb.renderMd('1. a\n2. b', OPTS);
  assert.ok(olDot.includes('<ol class="md-ol">'), '1. 应渲染ol.md-ol，实际:' + olDot.slice(0, 200));
  assert.ok(olDot.includes('<li>a</li>') && olDot.includes('<li>b</li>'), '有序项内容丢失');
  const olParen = sb.renderMd('1) a\n2) b', OPTS);
  assert.ok(olParen.includes('<ol class="md-ol">'), '1) 应同样渲染ol.md-ol，实际:' + olParen.slice(0, 200));
  for (const mk of ['- a\n- b', '* a\n* b', '+ a\n+ b']) {
    const h = sb.renderMd(mk, OPTS);
    assert.ok(h.includes('<ul class="md-ul">'), `无序${JSON.stringify(mk).slice(0, 12)}应渲染ul.md-ul，实际:` + h.slice(0, 200));
    assert.ok(!h.includes('<ol'), `无序${JSON.stringify(mk).slice(0, 12)}不应含ol`);
  }
  assert.ok(!olDot.includes('<ul'), '有序不应含ul');
  assert.ok(coreSrc.includes('function tbListAct('), '须有tbListAct有序修复入口');
  assert.ok(coreSrc.includes("'1. '"), 'tbListAct有序须产1. 前缀');
  assert.ok(coreSrc.includes("tag=listType==='ol'?'ol':'ul'") || coreSrc.includes("listType==='ol'"), '渲染须按ol/ul分流标签');
}

function runAllAssertions() {
  const tests = [
    ['断言1 标题H1~H6', test1_Headings],
    ['断言2 加粗斜体删除线', test2_InlineEmphasis],
    ['断言3 行内+围栏代码', test3_Code],
    ['断言4 任务列表渲染与索引', test4_TaskRender],
    ['断言5 任务回写索引', test5_TaskToggle],
    ['断言6 对齐表格th+wrap', test6_TableAlign],
    ['断言7 callout三类', test7_Callout],
    ['断言8 普通引用', test8_Quote],
    ['断言9 相对assets重写proto-asset', test9_AssetRewrite],
    ['断言10 data:/http原样', test10_AssetPassthrough],
    ['断言11 缺失图片虚线卡片不抛', test11_MissingImg],
    ['断言12 extractHeadings顺序', test12_HeadingsOrder],
    ['断言13 工具栏15动作(无anchor)与DocGuard', test13_ToolbarGuard],
    ['断言14 renderMd单参兼容', test14_SingleParam],
    ['断言15 主进程+预加载资产通道', test15_MainPreload],
    ['断言16 无docToolbar空块+图片文案', test16_HtmlCssExport],
    ['断言17 有序ol/无序ul渲染', test17_OrderedListOl]
  ];
  let passed = 0;
  let failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  if (failed) console.log('MD_P1_FAIL');
  else console.log('MD_P1_PASS: 全部17项MD-P1断言通过');
  process.exitCode = failed ? 1 : 0;
}

runAllAssertions();
