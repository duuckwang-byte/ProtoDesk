'use strict';
// P3 MD单文档恒功能说明/最新需求双流/DocShuttle双向/迷你Mermaid回归：doc:list+读写文件名寻址/DocShuttle双向/迷你Mermaid/flowchart+sequence/route badge/恒功能说明+最新需求双流+DocGuard保留（纯Node，不启动Electron）
// 手段：源文提取 + 最小fake DOM/document/localStorage/navigator + vm加载js/core-docs.js，对应P3 DoD
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
const editSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const sbSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');

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
  return { sandbox, elCache, store };
}

const OPTS = { project: 'DemoProj', proto: 'DemoProto' };
const ctx = loadCore();
const sb = ctx.sandbox;

assert.strictEqual(typeof sb.renderMd, 'function', 'core-docs须暴露renderMd');
assert.strictEqual(typeof sb.DocShuttle, 'object', 'core-docs须暴露window.DocShuttle');
assert.strictEqual(typeof sb.curDocMd, 'function', '单文档须暴露curDocMd(恒功能说明)');
assert.strictEqual(typeof sb.fullDocMd, 'function', '单文档须暴露fullDocMd');
assert.strictEqual(typeof sb.sourceDocKey, 'function', '单文档须暴露sourceDocKey(单键)');
assert.strictEqual(typeof sb.removeDocTabStrip, 'function', '须暴露removeDocTabStrip(清残留Tab条)');
assert.strictEqual(typeof sb.docTitleFor, 'function', '须暴露docTitleFor(恒功能说明标题)');
assert.strictEqual(sb.docSwitchTo, undefined, '精简4：docSwitchTo须已删除');
assert.strictEqual(sb.docFileForName, undefined, '精简4：docFileForName须已删除');
assert.strictEqual(sb.docStorageKey, undefined, '精简4：docStorageKey须已删除');
console.log('[INIT] vm加载core-docs成功 renderMd/DocShuttle/单文档恒功能说明可用');

function countTag(h, tag) {
  const m = String(h || '').match(new RegExp(tag, 'g'));
  return m ? m.length : 0;
}

// 断言1：mermaid flowchart TD三节点两边渲染SVG且无原文泄漏
function test1_FlowchartTD() {
  const md = '```mermaid\nflowchart TD\nA[START]-->B[DOING]\nB-->C[DONE]\n```';
  const h = sb.renderMd(md, OPTS);
  assert.ok(h.includes('<svg'), 'flowchart TD应渲染内联SVG，实际:' + h.slice(0, 300));
  assert.ok(h.includes('doc-svg-diagram-svg'), 'SVG须带doc-svg-diagram-svg类');
  assert.ok(h.includes('doc-svg-diagram'), '外层须包doc-svg-diagram');
  assert.ok(h.includes('START') && h.includes('DOING') && h.includes('DONE'), '三节点标签须落入SVG文本');
  assert.strictEqual(countTag(h, '<rect'), 3, '三节点应有3个rect，实际' + countTag(h, '<rect'));
  assert.strictEqual(countTag(h, '<line'), 2, '两边应有2条line，实际' + countTag(h, '<line'));
  assert.ok(!h.includes('flowchart'), '原文flowchart不应泄漏到输出');
  assert.ok(!h.includes('-->'), '原文-->不应泄漏到输出');
  assert.ok(!h.includes('md-code-wrap'), '成功渲染不应回退代码块');
  // LR方向同引擎亦须渲染
  const hLR = sb.renderMd('```mermaid\nflowchart LR\nA[START]-->B[DOING]\nB-->C[DONE]\n```', OPTS);
  assert.ok(hLR.includes('<svg') && hLR.includes('START'), 'flowchart LR亦须渲染SVG');
  assert.ok(!hLR.includes('flowchart'), 'LR原文不应泄漏');
}

// 断言2：sequence参与者+消息渲染
function test2_Sequence() {
  const md = '```mermaid\nsequenceDiagram\nparticipant A as Alice\nparticipant B as Bob\nA->>B: hello\nB-->A: hi\n```';
  const h = sb.renderMd(md, OPTS);
  assert.ok(h.includes('<svg'), 'sequence应渲染内联SVG，实际:' + h.slice(0, 300));
  assert.ok(h.includes('doc-svg-diagram-svg'), 'sequence SVG须带doc-svg-diagram-svg类');
  assert.ok(h.includes('Alice') && h.includes('Bob'), '参与者Alice/Bob须落入SVG');
  assert.ok(h.includes('hello') && h.includes('hi'), '消息hello/hi须落入SVG');
  assert.ok(!h.includes('sequenceDiagram'), '原文sequenceDiagram不应泄漏');
  assert.ok(!h.includes('participant A as'), '原文participant声明不应泄漏');
  assert.ok(!h.includes('md-code-wrap'), '成功渲染不应回退代码块');
}

// 断言3：非flowchart/sequence/stateDiagram回退代码块（P4 supersede：stateDiagram/stateDiagram-v2已由mermaidStateSvg原生支持，原P3要求回退的断言作废，现按P4方案期望渲染SVG；仅gantt/pie等仍回退）
function test3_FallbackOther() {
  const cases = [
    '```mermaid\ngantt\ntitle Test\n```',
    '```mermaid\npie title Pets\n"Dogs" : 10\n```'
  ];
  for (const md of cases) {
    const h = sb.renderMd(md, OPTS);
    assert.ok(!h.includes('<svg'), '非支持类型不应渲染SVG，输入:' + md.slice(0, 40));
    assert.ok(h.includes('md-code-wrap'), '非支持类型须回退代码块md-code-wrap');
    assert.ok(h.includes('lang-mermaid'), '回退代码块须保留lang-mermaid');
  }
  const gantt = sb.renderMd(cases[0], OPTS);
  assert.ok(gantt.includes('gantt'), '回退代码块须保留原文gantt供查阅');
  // P4 supersede：stateDiagram-v2现应渲染SVG（原P3断言要求回退已失效）
  const st = sb.renderMd('```mermaid\nstateDiagram-v2\n[*] --> Active\n```', OPTS);
  assert.ok(st.includes('<svg'), 'P4 supersede：stateDiagram-v2现应渲染SVG，实际:' + st.slice(0, 200));
  assert.ok(st.includes('doc-svg-diagram-svg'), 'P4 supersede：stateDiagram SVG须带doc-svg-diagram-svg类');
  assert.ok(st.includes('doc-state-node'), 'P4 supersede：stateDiagram须含doc-state-node矩形');
  assert.ok(st.includes('<circle'), 'P4 supersede：stateDiagram起止[*]须渲染circle');
  assert.ok(st.includes('Active'), 'P4 supersede：状态Active须落入SVG');
  assert.ok(!st.includes('md-code-wrap'), 'P4 supersede：stateDiagram成功渲染不应回退代码块');
}

// 断言4：非法mermaid不抛且回退
function test4_IllegalNoThrow() {
  const illegals = [
    '```mermaid\n```',
    '```mermaid\nnot a diagram\n```',
    '```mermaid\nflowchart TD\n```',
    '```mermaid\nflowchart XX\nA-->B\n```',
    '```mermaid\nsequenceDiagram\n```',
    '```mermaid\nflowchart TD\nA--> \n```'
  ];
  for (const md of illegals) {
    let h = '';
    assert.doesNotThrow(() => { h = sb.renderMd(md, OPTS); }, '非法mermaid不应抛错，输入:' + JSON.stringify(md).slice(0, 80));
    assert.ok(!h.includes('<svg'), '非法输入不应渲染SVG，输入:' + JSON.stringify(md).slice(0, 80));
    assert.ok(h.includes('md-code-wrap'), '非法输入须回退代码块，输入:' + JSON.stringify(md).slice(0, 80));
  }
  assert.doesNotThrow(() => { sb.renderMd('```mermaid\nflowchart TD\nA[AAA]-->B[BBB]\n', OPTS); }, '未闭合围栏亦不应抛错');
}

// 断言5：锚点删除后标题恢复普通渲染（无route badge）
function test5_RouteBadge() {
  const h = sb.renderMd('## 页面 登录页（#home）\n\n正文', OPTS);
  assert.ok(h.includes('<h2 class="md-h">'), '标题应为普通h2.md-h，实际:' + h.slice(0, 400));
  assert.ok(h.includes('#home'), '标题文本须保留#home原文');
  assert.ok(!h.includes('doc-route-badge'), '锚点删除后标题不应含badge');
  assert.ok(!h.includes('doc-page-jump'), '不应含doc-page-jump可点类');
  assert.ok(!h.includes('data-route='), '不应含data-route属性');
  assert.ok(!h.includes('点击预览该子页面'), '不应含跳转提示');
  const plain = sb.renderMd('## 普通标题\n\n正文', OPTS);
  assert.ok(plain.includes('<h2 class="md-h">普通标题</h2>'), '普通标题应为普通渲染，实际:' + plain.slice(0, 200));
  assert.ok(!plain.includes('doc-route-badge'), '普通标题不应含badge');
  assert.ok(!coreSrc.includes("closest('.doc-route-badge"), '标题点击badge分流须已解绑');
  assert.ok(coreSrc.includes('已删除页面锚点'), '须注释已删除页面锚点');
  assert.ok(coreSrc.includes('handleDocRouteJump') || coreSrc.includes('DocShuttle'), '跳转复用器保留(DocShuttle/canvasToDoc不动)');
}

// 断言6：DocShuttle三函数存在
function test6_DocShuttleThree() {
  assert.ok(sb.DocShuttle, '须暴露window.DocShuttle');
  assert.strictEqual(typeof sb.DocShuttle.findSubPage, 'function', 'DocShuttle.findSubPage须为函数');
  assert.strictEqual(typeof sb.DocShuttle.docToCanvas, 'function', 'DocShuttle.docToCanvas须为函数');
  assert.strictEqual(typeof sb.DocShuttle.canvasToDoc, 'function', 'DocShuttle.canvasToDoc须为函数');
  assert.ok(coreSrc.includes('window.DocShuttle'), '源码须定义window.DocShuttle');
  assert.ok(coreSrc.includes('function docFindSubPage'), '源码须有docFindSubPage');
  assert.ok(coreSrc.includes('docToCanvas:function') || coreSrc.includes('docToCanvas:'), '源码须有docToCanvas实现');
  assert.ok(coreSrc.includes('canvasToDoc:function') || coreSrc.includes('canvasToDoc:'), '源码须有canvasToDoc实现');
  // 双向失败绝不抛错
  assert.doesNotThrow(() => { sb.DocShuttle.docToCanvas(''); }, 'docToCanvas空参不应抛');
  assert.doesNotThrow(() => { sb.DocShuttle.canvasToDoc(null); }, 'canvasToDoc空参不应抛');
  assert.doesNotThrow(() => { sb.DocShuttle.findSubPage(''); }, 'findSubPage空参不应抛');
}

// 断言7（新需求）：拾取无反查 + DocShuttle三函数存根保留(canvasToDoc return false)
function test7_PickHook() {
  // 7a 拾取流程不再调用canvasToDoc（无调用点，edit-entry已删拾取反查调用）
  assert.ok(!editSrc.includes('canvasToDoc'), 'edit-entry拾取流程不得再调用canvasToDoc（已删反查调用），实际仍含调用点');
  assert.ok(!editSrc.includes('window.DocShuttle'), 'edit-entry拾取流程不得再引用window.DocShuttle');
  // 7b DocShuttle三函数结构保留
  assert.ok(sb.DocShuttle, '须保留window.DocShuttle');
  assert.strictEqual(typeof sb.DocShuttle.findSubPage, 'function', 'DocShuttle.findSubPage须为函数');
  assert.strictEqual(typeof sb.DocShuttle.docToCanvas, 'function', 'DocShuttle.docToCanvas须为函数');
  assert.strictEqual(typeof sb.DocShuttle.canvasToDoc, 'function', 'DocShuttle.canvasToDoc须为函数（存根false）');
  assert.ok(coreSrc.includes('window.DocShuttle'), '源码须定义window.DocShuttle');
  assert.ok(coreSrc.includes('canvasToDoc:function') || coreSrc.includes('canvasToDoc:'), '源码须保留canvasToDoc桩位');
  // 7c canvasToDoc为存根false：任意入参均返回false且绝不抛错
  const cIdx = coreSrc.indexOf('canvasToDoc:function');
  assert.ok(cIdx >= 0, '须能定位canvasToDoc存根');
  const cWin = coreSrc.slice(cIdx, cIdx + 200);
  assert.ok(cWin.includes('return false'), 'canvasToDoc存根须return false，实际:' + cWin.slice(0, 120));
  assert.doesNotThrow(() => { sb.DocShuttle.canvasToDoc(null); }, 'canvasToDoc(null)不应抛');
  assert.strictEqual(sb.DocShuttle.canvasToDoc(null), false, 'canvasToDoc(null)须为false存根');
  assert.strictEqual(sb.DocShuttle.canvasToDoc(undefined), false, 'canvasToDoc(undefined)须为false');
  assert.strictEqual(sb.DocShuttle.canvasToDoc(''), false, 'canvasToDoc空串须为false');
  assert.strictEqual(sb.DocShuttle.canvasToDoc('#home'), false, 'canvasToDoc任意路由须为false存根');
}

// 断言8：单文档恒功能说明（<name>.md恒定，无三Tab映射）
function test8_MultiDocMapping() {
  assert.ok(coreSrc.includes('恒显示功能说明'), '须注释恒显示功能说明');
  assert.ok(coreSrc.includes('function curDocMd'), '须有curDocMd单文档入口');
  assert.ok(coreSrc.includes('function getDocMd'), '须有getDocMd取数');
  assert.ok(coreSrc.includes('function docTitleFor'), '须有docTitleFor恒标题');
  assert.ok(coreSrc.includes('function removeDocTabStrip'), '须有removeDocTabStrip清残留');
  assert.ok(!coreSrc.includes('function docSwitchTo'), '精简4：不应残留docSwitchTo');
  assert.ok(!coreSrc.includes('function docFileForName'), '精简4：不应残留docFileForName');
  assert.ok(!coreSrc.includes('function ensureDocTabs') && !coreSrc.includes('function renderDocTabs'), '精简4：不应残留三Tab状态机');
  assert.ok(!htmlSrc.includes('docTabStrip'), '精简4：HTML不应残留docTabStrip');
  assert.ok(coreSrc.includes("getElementById('docTabStrip')"), '残留清理须按id定位docTabStrip');
  sb.reqMode = false; try { delete sb.reqText; } catch (e) {}
  sb.currentSource = { name: 'Demo.html', displayName: 'Demo', kind: 'mobile', md: '# hello', docs: {} };
  assert.strictEqual(sb.curDocMd(), '# hello', '非req态curDocMd应恒取功能说明src.md');
  assert.strictEqual(sb.fullDocMd(), '# hello', 'fullDocMd亦应恒取功能说明');
  assert.strictEqual(sb.docTitleFor('功能说明'), sb.docTitleFor('变更日志'), '标题恒定：任意入参均同路，不再按名分流');
}

// 断言9：存储单键（沿用旧键）+最新需求双流（reqMode不动）
function test9_StorageKeyCompat() {
  const src = { name: 'Demo.html', kind: 'mobile' };
  const base = sb.sourceDocKey(src);
  assert.ok(base === 'protoDoc_v2_Demo.html_mobile', '单键应为protoDoc_v2_<name>_<kind>，实际' + base);
  assert.ok(!coreSrc.includes('function docStorageKey'), '精简4：不应残留docStorageKey多键派生');
  assert.ok(coreSrc.includes('function sourceDocKey'), '须保留sourceDocKey单键');
  assert.ok(coreSrc.includes('typeof reqMode'), '双流须按reqMode分流');
  assert.ok(coreSrc.includes('reqText'), 'req态须取reqText最新需求流');
  assert.ok(coreSrc.includes('最新需求'), '须注释最新需求双流');
  sb.currentSource = { name: 'Demo.html', kind: 'mobile', md: '# 功能说明正文', docs: {} };
  sb.reqMode = true; sb.reqText = '# 最新需求正文';
  assert.strictEqual(sb.curDocMd(), '# 最新需求正文', 'req态应取最新需求reqText');
  assert.strictEqual(sb.fullDocMd(), '# 最新需求正文', 'req态fullDocMd亦取最新需求');
  sb.reqMode = false;
  assert.strictEqual(sb.curDocMd(), '# 功能说明正文', '非req态应恒取功能说明');
  assert.ok(coreSrc.includes('if(reqMode)'), 'DocGuard/编辑须保留reqMode分支');
}

// 断言10：主进程doc:list通道+目录守卫
function test10_MainDocList() {
  assert.ok(mainSrc.includes("ipcMain.handle('doc:list'"), 'main须有doc:list通道');
  assert.ok(mainSrc.includes('validProtoDir'), 'doc:list须经validProtoDir校验');
  assert.ok(mainSrc.includes('目录不在沙箱范围内'), '目录外须拒绝为目录不在沙箱范围内');
  assert.ok(mainSrc.includes('isSubPath(full, SANDBOX_ROOT)') || mainSrc.includes('isSubPath(target, SANDBOX_ROOT)') || mainSrc.includes('isSubPath(full, paths.SANDBOX_ROOT)') || mainSrc.includes('isSubPath(target, paths.SANDBOX_ROOT)'), '须经isSubPath防穿越');
  // doc:list仅收md、上限20、按mtime倒序
  assert.ok(mainSrc.includes('/\\.md$/i.test(name)'), 'doc:list须过滤.md');
  assert.ok(mainSrc.includes('.slice(0, 20)'), 'doc:list须上限20');
  assert.ok(mainSrc.includes('mtimeMs'), 'doc:list须按mtime排序');
}

// 断言11：主进程读写文件名清洗（../拒绝）
function test11_MainSanitize() {
  assert.ok(mainSrc.includes('function sanitizeDocFile'), 'main须有sanitizeDocFile');
  assert.ok(mainSrc.includes("s.includes('..')"), '清洗须拦截..穿越');
  assert.ok(mainSrc.includes("s.includes('/')"), '清洗须拦截/分隔符');
  assert.ok(mainSrc.includes("s.includes('\\\\')") || mainSrc.includes('includes(\'\\\\\')') || mainSrc.includes("includes('\\')"), '清洗须拦截\\分隔符');
  assert.ok(mainSrc.includes('/\\.md$/i.test(s)'), '清洗须限定.md后缀');
  assert.ok(mainSrc.includes("ipcMain.handle('doc:read-latest'"), 'main须有doc:read-latest');
  assert.ok(mainSrc.includes("ipcMain.handle('doc:write-latest'"), 'main须有doc:write-latest');
  assert.ok(mainSrc.includes('function parseDocReadArgs') && mainSrc.includes('function parseDocWriteArgs'), '读写须兼容旧调用(parseDocRead/WriteArgs)');
  // 读写非法名拒绝文案
  const readIdx = mainSrc.indexOf("ipcMain.handle('doc:read-latest'");
  const readWin = mainSrc.slice(readIdx, readIdx + 1500);
  assert.ok((readWin.includes('非法文件名') || mainSrc.includes('非法文件名')), '读非法名须报非法文件名');
  assert.ok(readWin.includes('文件不存在') || mainSrc.includes('文件不存在'), '读缺失须报文件不存在');
  const writeIdx = mainSrc.indexOf("ipcMain.handle('doc:write-latest'");
  const writeWin = mainSrc.slice(writeIdx, writeIdx + 1500);
  assert.ok((writeWin.includes('非法文件名') || mainSrc.includes('非法文件名')), '写非法名须报非法文件名');
}

// 断言12：preload三暴露
function test12_PreloadThree() {
  assert.ok(preloadSrc.includes('list:'), 'preload doc须暴露list');
  assert.ok(preloadSrc.includes('readLatest'), 'preload doc须暴露readLatest');
  assert.ok(preloadSrc.includes('writeLatest'), 'preload doc须暴露writeLatest');
  assert.ok(preloadSrc.includes("invoke('doc:list'"), 'list须invoke doc:list');
  assert.ok(preloadSrc.includes("invoke('doc:read-latest'"), 'readLatest须invoke doc:read-latest');
  assert.ok(preloadSrc.includes("invoke('doc:write-latest'"), 'writeLatest须invoke doc:write-latest');
}

// 断言13：无Tab条且恒功能说明（DocGuard保留供跨文件调用）
function test13_DocSwitchVirtualGuard() {
  assert.ok(coreSrc.includes('function removeDocTabStrip'), '须有removeDocTabStrip');
  assert.ok(coreSrc.includes("getElementById('docTabStrip')"), '清理须定位docTabStrip');
  assert.ok(!htmlSrc.includes('docTabStrip'), 'HTML不应残留docTabStrip');
  assert.ok(!coreSrc.includes('function docSwitchTo'), '精简4：不应残留docSwitchTo');
  assert.ok(!coreSrc.includes('虚拟空'), '精简4：不应残留虚拟空文档');
  assert.ok(typeof sb.DocGuard === 'object', '须暴露window.DocGuard(跨文件守卫保留)');
  assert.strictEqual(typeof sb.DocGuard.confirmLeave, 'function', 'DocGuard.confirmLeave须为函数');
  assert.strictEqual(typeof sb.DocGuard.isDirty, 'function', 'DocGuard.isDirty须为函数');
  assert.ok(coreSrc.includes('已移除三文档Tab'), '须注释已移除三文档Tab');
  assert.doesNotThrow(() => { sb.removeDocTabStrip(); }, '清理残留Tab条不应抛错');
  sb.reqMode = false;
  sb.currentSource = { name: 'Demo.html', displayName: 'Demo', kind: 'mobile', md: '# old\n', docs: {} };
  assert.strictEqual(sb.curDocMd(), '# old\n', '恒功能说明：curDocMd应取src.md');
}

// 断言14：文档→画布复用器只读+绝不抛错
function test14_JumpReuseNoThrow() {
  assert.ok(sbSrc.includes('function jumpToSubPageByRoute'), 'sandbox-core须有jumpToSubPageByRoute复用器');
  assert.ok(sbSrc.includes('window.jumpToSubPageByRoute'), '须暴露window.jumpToSubPageByRoute供DocShuttle复用');
  const idx = sbSrc.indexOf('function jumpToSubPageByRoute');
  const win = sbSrc.slice(idx, idx + 1200);
  assert.ok(win.includes('try{') || win.includes('try {'), '复用器须try保护');
  assert.ok(win.includes('return false'), '失败须返回false');
  assert.ok(win.includes('loadSubPage'), '复用器须只读调用既有loadSubPage不改其实现');
  assert.ok(coreSrc.includes('jumpToSubPageByRoute'), 'DocShuttle须优先复用jumpToSubPageByRoute');
  assert.ok(coreSrc.includes('按route只读匹配') || coreSrc.includes('只读调用'), '须注释只读复用');
  // DocShuttle.docToCanvas在无源时亦不抛
  sb.currentSource = null;
  assert.doesNotThrow(() => { sb.DocShuttle.docToCanvas('#home'); }, '无源跳转不应抛错');
  assert.doesNotThrow(() => { sb.DocShuttle.docToCanvas(''); }, '空路由不应抛错');
}

// 断言15：子页面切换须刷新文档面板（与主页面loadSource一致，否则滞留旧原型文档）
function test15_SubPageReloadsDoc() {
  const subIdx = sbSrc.indexOf('function loadSubPage(s, subFile)');
  assert.ok(subIdx >= 0, '须能定位loadSubPage');
  const subBlock = sbSrc.slice(subIdx, subIdx + 2200);
  assert.ok(subBlock.includes('loadSourceDocs(s)'), '子页面切换须合入本地文档');
  assert.ok(/typeof loadDesc==='function'/.test(subBlock) || /loadDesc\(\)/.test(subBlock), '子页面切换须调loadDesc渲染文档面板');
  const mainIdx = sbSrc.indexOf('function loadSource(src, keepPanels)');
  assert.ok(mainIdx >= 0, '须能定位loadSource');
  const mainBlock = sbSrc.slice(mainIdx, mainIdx + 3000);
  assert.ok(mainBlock.includes('loadDesc()'), '主页面切换须调loadDesc（既有行为保持）');
}

function runAllAssertions() {
  const tests = [
    ['断言1 flowchart三节点两边SVG无泄漏', test1_FlowchartTD],
    ['断言2 sequence参与者+消息', test2_Sequence],
    ['断言3 非支持类型回退代码块', test3_FallbackOther],
    ['断言4 非法mermaid不抛回退', test4_IllegalNoThrow],
    ['断言5 标题普通渲染无badge(锚点删除)', test5_RouteBadge],
    ['断言6 DocShuttle三函数', test6_DocShuttleThree],
    ['断言7 拾取无反查+穿梭存根false', test7_PickHook],
    ['断言8 单文档恒功能说明无Tab', test8_MultiDocMapping],
    ['断言9 存储单键+最新需求双流', test9_StorageKeyCompat],
    ['断言10 主进程doc:list+目录守卫', test10_MainDocList],
    ['断言11 主进程读写文件名清洗', test11_MainSanitize],
    ['断言12 preload三暴露', test12_PreloadThree],
    ['断言13 无Tab条恒功能说明', test13_DocSwitchVirtualGuard],
    ['断言14 复用器只读不抛', test14_JumpReuseNoThrow],
    ['断言15 子页面切换刷新文档', test15_SubPageReloadsDoc]
  ];
  let passed = 0;
  let failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  if (failed) console.log('MD_P3_FAIL');
  else console.log('MD_P3_PASS: 全部15项MD-P3断言通过');
  process.exitCode = failed ? 1 : 0;
}

runAllAssertions();
