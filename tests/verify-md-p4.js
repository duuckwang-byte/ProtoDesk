'use strict';
// P4 专业交付/全文检索/stateDiagram回归：导出仅PNG/PDF/MD(无富文本)+无历史对比LCS/浮层/Ctrl+F n-m计数与Esc还原/stateDiagram SVG+非法回退/工具栏id无emoji（纯Node，不启动Electron）
// 手段：源文提取 + 最小fake DOM/document/localStorage/navigator + vm加载js/core-docs.js，对应P4 DoD
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

assert.strictEqual(typeof sb.renderMd, 'function', 'core-docs须暴露renderMd');
assert.strictEqual(typeof sb.DocP4, 'object', 'core-docs须暴露window.DocP4');
assert.strictEqual(typeof sb.DocP4.exportLongImage, 'function', 'DocP4.exportLongImage须为函数');
assert.strictEqual(typeof sb.DocP4.exportPdf, 'function', 'DocP4.exportPdf须为函数');
assert.strictEqual(typeof sb.DocP4.exportMd, 'function', '精简2：DocP4.exportMd须为函数(Blob下载)');
assert.strictEqual(sb.docLcsDiff, undefined, '精简3：docLcsDiff须已删除');
assert.strictEqual(sb.DocP4.lcs, undefined, '精简3：DocP4.lcs须已删除');
console.log('[INIT] vm加载core-docs成功 renderMd/DocP4(导出+检索)可用');

function countTag(h, tag) {
  const m = String(h || '').match(new RegExp(tag, 'g'));
  return m ? m.length : 0;
}

// 断言1：stateDiagram起止/矩形SVG渲染（[*]双圆+状态矩形+无泄漏）
function test1_StateStartEnd() {
  const md = '```mermaid\nstateDiagram\n[*] --> Active\nActive --> Done\nDone --> [*]\n```';
  const h = sb.renderMd(md, OPTS);
  assert.ok(h.includes('<svg'), 'stateDiagram应渲染内联SVG，实际:' + h.slice(0, 300));
  assert.ok(h.includes('doc-svg-diagram-svg'), 'SVG须带doc-svg-diagram-svg类');
  assert.ok(h.includes('doc-svg-diagram'), '外层须包doc-svg-diagram');
  assert.ok(h.includes('<circle'), '[*]起止须渲染circle双圆');
  assert.strictEqual(countTag(h, '<circle'), 2, '[*]出现两次应有2个circle组？实际' + countTag(h, '<circle') + '（起止各双圆=2+?，至少2）');
  assert.ok(countTag(h, '<circle') >= 2, '[*]起止至少2个circle');
  assert.ok(h.includes('doc-state-node'), '状态矩形须带doc-state-node类');
  assert.ok(h.includes('Active') && h.includes('Done'), '状态Active/Done须落入SVG文本');
  assert.ok(!h.includes('md-code-wrap'), '成功渲染不应回退代码块');
  assert.ok(!h.includes('stateDiagram'), '原文stateDiagram不应泄漏到输出');
}

// 断言2：stateDiagram箭头线+箭头头+动作标签渲染
function test2_StateArrowsLabels() {
  const md = '```mermaid\nstateDiagram\n[*] --> Active\nActive --> Done : 提交\nDone --> [*]\n```';
  const h = sb.renderMd(md, OPTS);
  assert.ok(h.includes('<svg'), '应渲染SVG，实际:' + h.slice(0, 300));
  assert.ok(h.includes('doc-state-arrow'), '流转线须带doc-state-arrow类');
  assert.strictEqual(countTag(h, 'doc-state-arrow'), 3, '三条流转应有3个doc-state-arrow，实际' + countTag(h, 'doc-state-arrow'));
  assert.ok(h.includes('<polygon'), '箭头头部须为polygon');
  assert.strictEqual(countTag(h, '<polygon'), 3, '三条边应有3个polygon箭头，实际' + countTag(h, '<polygon'));
  assert.ok(h.includes('提交'), '动作标签提交须落入SVG文本');
  assert.ok(h.includes('<text'), '标签须为text元素');
  assert.ok(!h.includes('-->'), '原文-->不应泄漏到输出');
}

// 断言3：stateDiagram-v2兼容+中文状态
function test3_StateV2Chinese() {
  const h = sb.renderMd('```mermaid\nstateDiagram-v2\n[*] --> 待办\n待办 --> 完成 : 审核通过\n完成 --> [*]\n```', OPTS);
  assert.ok(h.includes('<svg'), 'stateDiagram-v2应渲染SVG，实际:' + h.slice(0, 300));
  assert.ok(h.includes('doc-state-node'), 'v2矩形须带doc-state-node');
  assert.ok(h.includes('待办') && h.includes('完成'), '中文状态须落入SVG');
  assert.ok(h.includes('审核通过'), '中文标签须落入SVG');
  assert.ok(!h.includes('md-code-wrap'), 'v2成功不应回退');
  assert.ok(!h.includes('stateDiagram-v2'), '原文stateDiagram-v2不应泄漏');
  const h2 = sb.renderMd('```mermaid\nstateDiagram\n[*] --> Idle\nIdle --> Done : ok\n```', OPTS);
  assert.ok(h2.includes('<svg') && h2.includes('Idle'), 'stateDiagram无v2后缀亦须渲染');
}

// 断言4：stateDiagram非法输入不抛且回退代码块
function test4_StateIllegalFallback() {
  const illegals = [
    '```mermaid\nstateDiagram\n```',
    '```mermaid\nstateDiagram\nActive\n```',
    '```mermaid\n```',
    '```mermaid\nstateDiagram\nnot valid !!!\n```'
  ];
  for (const md of illegals) {
    let h = '';
    assert.doesNotThrow(() => { h = sb.renderMd(md, OPTS); }, '非法stateDiagram不应抛错，输入:' + JSON.stringify(md).slice(0, 80));
    assert.ok(!h.includes('<svg'), '非法输入不应渲染SVG，输入:' + JSON.stringify(md).slice(0, 80));
    assert.ok(h.includes('md-code-wrap'), '非法输入须回退代码块，输入:' + JSON.stringify(md).slice(0, 80));
    assert.ok(h.includes('lang-mermaid'), '回退须保留lang-mermaid');
  }
  assert.doesNotThrow(() => { sb.renderMd('```mermaid\nstateDiagram\n[*] --> \n', OPTS); }, '残缺箭头亦不应抛错');
}

// 断言5：无历史对比LCS（函数/视图/CSS零残留）
function test5_LcsThreeStates() {
  assert.ok(!coreSrc.includes('function docLcsDiff'), '精简3：不应残留docLcsDiff');
  assert.strictEqual(sb.docLcsDiff, undefined, 'vm中docLcsDiff须为undefined');
  assert.strictEqual(sb.DocP4.lcs, undefined, 'DocP4不应再暴露lcs');
  assert.ok(!coreSrc.includes('doc-diff-add') && !coreSrc.includes('doc-diff-del'), '不应残留doc-diff行样式');
  assert.ok(!coreSrc.includes('docDiffMask'), '不应残留docDiffMask浮层');
  assert.ok(!coreSrc.includes('function openDocDiffPanel') && !coreSrc.includes('function ensureDocDiffDom'), '不应残留Diff浮层函数');
  assert.ok(coreSrc.includes('window.DocP4'), 'DocP4瘦身后仍须暴露(导出+检索)');
  assert.ok(!cssSrc.includes('.doc-diff-add') && !cssSrc.includes('.doc-diff-del'), 'CSS不应残留doc-diff');
}

// 断言6：DocP4仅保留导出+检索（无lcs/无Diff开关）
function test6_LcsEmptyStates() {
  assert.strictEqual(typeof sb.DocP4.exportLongImage, 'function', 'DocP4须保留exportLongImage');
  assert.strictEqual(typeof sb.DocP4.exportPdf, 'function', 'DocP4须保留exportPdf');
  assert.strictEqual(typeof sb.DocP4.exportMd, 'function', 'DocP4须保留exportMd');
  assert.strictEqual(typeof sb.DocP4.searchOpen, 'function', 'DocP4须保留searchOpen');
  assert.strictEqual(typeof sb.DocP4.searchClose, 'function', 'DocP4须保留searchClose');
  assert.strictEqual(sb.DocP4.lcs, undefined, 'DocP4不应残留lcs');
  assert.strictEqual(sb.DocP4.openDiff, undefined, 'DocP4不应残留openDiff');
  assert.strictEqual(sb.DocP4.closeDiff, undefined, 'DocP4不应残留closeDiff');
  assert.ok(!coreSrc.includes('copyDocDiffSummary'), '不应残留copyDocDiffSummary');
}

// 断言7：搜索计数n/m源码级（UpdateCount a/b + Goto/Do wiring）
function test7_SearchCountNM() {
  assert.ok(coreSrc.includes('function docSearchUpdateCount'), '须有docSearchUpdateCount');
  assert.ok(coreSrc.includes("c.textContent=String(a||0)+'/'+String(b||0)"), '计数须为a/b拼写n/m，缺失则计数口径漂移');
  assert.ok(coreSrc.includes('function docSearchDo'), '须有docSearchDo');
  assert.ok(coreSrc.includes('function docSearchGoto'), '须有docSearchGoto');
  assert.ok(coreSrc.includes('docSearchUpdateCount(docSearch.idx>=0?docSearch.idx+1:0,hits.length)'), 'Do须按idx+1/hits更新n/m');
  assert.ok(coreSrc.includes('docSearchUpdateCount(cur+1,n)'), 'Goto穿梭须按cur+1/n更新');
  assert.ok(coreSrc.includes("id=\"docSearchCount\"") || coreSrc.includes("getElementById('docSearchCount')"), '须有docSearchCount计数容器');
  assert.ok(htmlSrc.includes('id="docSearchCount"'), 'HTML须含#docSearchCount');
  assert.ok(htmlSrc.includes('0/0'), '计数初始须为0/0');
  assert.ok(cssSrc.includes('.doc-search-count'), 'CSS须有.doc-search-count');
}

// 断言8：搜索退出DOM还原源码级（Close隐藏+ClearHits文本还原+normalize）
function test8_SearchExitRestore() {
  assert.ok(coreSrc.includes('function docSearchClose'), '须有docSearchClose');
  const closeIdx = coreSrc.indexOf('function docSearchClose');
  const closeWin = coreSrc.slice(closeIdx, closeIdx + 1200);
  assert.ok(closeWin.includes("box.style.display='none'"), '退出须隐藏搜索条display=none');
  assert.ok(closeWin.includes('docSearchClearHits()'), '退出须调用docSearchClearHits清除高亮');
  assert.ok(closeWin.includes('docSearchUpdateCount(0,0)'), '退出须重置计数0/0');
  assert.ok(closeWin.includes("docSearch.q=''") || closeWin.includes('docSearch.q='), '退出须清空q');
  assert.ok(coreSrc.includes('function docSearchClearHits'), '须有docSearchClearHits');
  const clearIdx = coreSrc.indexOf('function docSearchClearHits');
  const clearWin = coreSrc.slice(clearIdx, clearIdx + 1500);
  assert.ok(clearWin.includes('.doc-search-hit'), '清除须查询.doc-search-hit高亮span');
  assert.ok(clearWin.includes('createTextNode(sp.textContent'), '还原须用文本节点替换span（不残留标签）');
  assert.ok(clearWin.includes('replaceChild(tx,sp)'), '还原须replaceChild回写文本');
  assert.ok(clearWin.includes('root.normalize()'), '还原须normalize合并文本节点');
}

// 断言9：Ctrl+F唤起与Enter/Esc wiring源码级
function test9_SearchKeys() {
  assert.ok(coreSrc.includes('(e.ctrlKey||e.metaKey)&&isF'), 'Ctrl+F须经ctrlKey/metaKey+isF捕获');
  assert.ok(coreSrc.includes('docSearchOpen()'), 'Ctrl+F命中须调用docSearchOpen');
  assert.ok(coreSrc.includes("e.key==='Enter'"), '搜索条须监听Enter下一处');
  assert.ok(coreSrc.includes('docSearchGoto(e.shiftKey?-1:1)') || coreSrc.includes('docSearchGoto(1)'), 'Enter/Shift+Enter须走docSearchGoto穿梭');
  assert.ok(coreSrc.includes("e.key==='Escape'"), '须监听Escape退出');
  assert.ok(coreSrc.includes('docSearchClose()'), 'Esc/关闭按钮须调用docSearchClose');
  assert.ok(coreSrc.includes('doc-search-hit-active'), '当前项须有doc-search-hit-active焦点框');
  assert.ok(cssSrc.includes('.doc-search-hit-active'), 'CSS须有.doc-search-hit-active');
  assert.ok(cssSrc.includes('.doc-search-hit'), 'CSS须有.doc-search-hit');
  assert.ok(cssSrc.includes('.doc-search-box'), 'CSS须有.doc-search-box搜索条');
  assert.ok(coreSrc.includes('阅读模式全局唤起'), '阅读模式焦点在外须同样唤起检索');
  assert.ok(coreSrc.includes('docs-open'), '全局唤起须以docs-open判定面板打开');
  assert.ok(coreSrc.includes('inCodeEdit){ return; }'), '代码抽屉须让路自有搜索');
}

// 断言10：导出preload仅长图/PDF（无快照历史）
function test10_PreloadThreeP4() {
  assert.ok(preloadSrc.includes('exportLongImage'), 'preload doc须暴露exportLongImage');
  assert.ok(preloadSrc.includes('exportPdf'), 'preload doc须暴露exportPdf');
  assert.ok(!preloadSrc.includes('readSnapshotHistory'), '精简3：preload不应残留readSnapshotHistory');
  assert.ok(preloadSrc.includes("invoke('doc:export-long-image'"), 'exportLongImage须invoke doc:export-long-image');
  assert.ok(preloadSrc.includes("invoke('doc:export-pdf'"), 'exportPdf须invoke doc:export-pdf');
  assert.ok(!preloadSrc.includes("invoke('doc:read-snapshot-history'"), '不应残留invoke doc:read-snapshot-history');
  assert.ok(coreSrc.includes('api.exportLongImage'), '前端长图须经protoAPI.doc.exportLongImage');
  assert.ok(coreSrc.includes('api.exportPdf'), '前端PDF须经protoAPI.doc.exportPdf');
  assert.ok(!coreSrc.includes('api.readSnapshotHistory'), '前端不应再调readSnapshotHistory');
}

// 断言11：主进程仅长图/PDF（saveDialog/printToPDF/capturePage保留，无文档历史）
function test11_MainThreeP4() {
  assert.ok(mainSrc.includes("ipcMain.handle('doc:export-long-image'"), 'main须有doc:export-long-image通道');
  assert.ok(mainSrc.includes("ipcMain.handle('doc:export-pdf'"), 'main须有doc:export-pdf通道');
  assert.ok(!mainSrc.includes("ipcMain.handle('doc:read-snapshot-history'"), '精简3：main不应残留doc:read-snapshot-history');
  assert.ok(mainSrc.includes('showSaveDialog'), '导出须经showSaveDialog选路径');
  assert.ok(mainSrc.includes('capturePage'), '长图须经capturePage全页捕获');
  assert.ok(mainSrc.includes('printToPDF'), 'PDF须经printToPDF输出A4');
  assert.ok(mainSrc.includes('function buildExportHtml'), 'main须有buildExportHtml离线封装');
  assert.ok(mainSrc.includes('function sanitizeExportTitle'), 'main须有sanitizeExportTitle标题清洗');
  assert.ok(mainSrc.includes('缺少导出内容'), '空html须拒绝为缺少导出内容');
  assert.ok(mainSrc.includes("ipcMain.handle('snapshot:list'"), '快照恢复snapshot:list应保留(非文档历史)');
}

// 断言12：无富文本复制（删白名单/ClipboardItem）+MD Blob下载
function test12_RichWhitelist() {
  assert.ok(!coreSrc.includes('function docRichStyleFor'), '精简2：不应残留docRichStyleFor');
  assert.ok(!coreSrc.includes('function copyDocRichText'), '精简2：不应残留copyDocRichText');
  assert.ok(!coreSrc.includes('function docRichFallbackCopy'), '精简2：不应残留docRichFallbackCopy');
  assert.ok(!coreSrc.includes('new ClipboardItem'), '精简2：不应残留ClipboardItem');
  assert.ok(!coreSrc.includes("'text/html'"), '精简2：不应残留text/html富文本写入');
  assert.ok(!htmlSrc.includes('btnDocExportRich'), 'HTML不应残留btnDocExportRich');
  assert.ok(coreSrc.includes('function exportDocMd'), '须新增exportDocMd');
  assert.ok(coreSrc.includes("new Blob([md],{type:'text/markdown"), 'MD导出须经Blob text/markdown');
  assert.ok(coreSrc.includes('createObjectURL'), 'MD导出须经createObjectURL生成下载链接');
  assert.ok(coreSrc.includes("a.download=base+'.md'"), 'MD下载须按base+.md命名');
  assert.ok(coreSrc.includes("getElementById('btnDocExportMd')"), '须绑定btnDocExportMd');
}

// 断言13：导出仅PNG/PDF/MD+搜索id齐备与纯文字无emoji
function test13_ToolbarIdsNoEmoji() {
  for (const id of ['btnDocExport', 'btnDocExportPng', 'btnDocExportPdf', 'btnDocExportMd', 'docExportMenu', 'docExportWrap', 'docSearchBox', 'docSearchInput', 'docSearchCount', 'docSearchPrev', 'docSearchNext', 'docSearchClose']) {
    assert.ok(htmlSrc.includes('id="' + id + '"'), 'HTML须含#' + id);
  }
  for (const id of ['btnDocExportRich', 'btnDocDiff']) {
    assert.ok(!htmlSrc.includes('id="' + id + '"'), '精简2/3：HTML不应残留#' + id);
  }
  assert.ok(coreSrc.includes("getElementById('btnDocExport')"), '前端须绑定btnDocExport');
  assert.ok(coreSrc.includes("getElementById('btnDocExportPng')"), '前端须绑定btnDocExportPng');
  assert.ok(coreSrc.includes("getElementById('btnDocExportPdf')"), '前端须绑定btnDocExportPdf');
  assert.ok(coreSrc.includes("getElementById('btnDocExportMd')"), '前端须绑定btnDocExportMd(新增MD)');
  assert.ok(!coreSrc.includes("getElementById('btnDocExportRich')"), '不应再绑定btnDocExportRich');
  assert.ok(!coreSrc.includes("getElementById('btnDocDiff')"), '不应再绑定btnDocDiff');
  assert.ok(coreSrc.includes('function ensureDocExportUI'), '须有ensureDocExportUI统一绑定');
  assert.ok(coreSrc.includes('function toggleDocExportMenu'), '须有toggleDocExportMenu下拉开关');
  // 工具栏纯文字：校验导出PNG/PDF/MD+搜索4按钮文本无emoji（白名单▾/✕放行）
  const btnTexts = [...htmlSrc.matchAll(/<button[^>]*id="(btnDocExport|btnDocExportPng|btnDocExportPdf|btnDocExportMd|docSearchPrev|docSearchNext|docSearchClose)"[^>]*>([^<]*)<\/button>/g)].map((m) => m[2]);
  assert.ok(btnTexts.length >= 7, '应提取到7个工具栏按钮文本，实际' + btnTexts.length);
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u{1F1E6}-\u{1F1FF}]/gu;
  for (const t of btnTexts) {
    const bad = (String(t).match(emojiRe) || []).filter((ch) => !'✕✎▾«＋'.includes(ch));
    assert.strictEqual(bad.length, 0, '工具栏须纯文字无emoji，文本[' + t + ']残留:' + bad.join(''));
  }
  for (const t of btnTexts) {
    assert.ok(!t.includes('📤') && !t.includes('⏱'), 'P4工具栏文本不应含方案草稿emoji 📤/⏱，文本[' + t + ']');
  }
}

// 断言14：无历史对比浮层（MaskStack/doc-diff零残留）
function test14_DiffMaskStack() {
  assert.ok(!coreSrc.includes('function ensureDocDiffDom'), '精简3：不应残留ensureDocDiffDom');
  assert.ok(!coreSrc.includes('function openDocDiffPanel'), '不应残留openDocDiffPanel');
  assert.ok(!coreSrc.includes('function closeDocDiffPanel'), '不应残留closeDocDiffPanel');
  assert.ok(!coreSrc.includes('docDiffMask'), '不应残留docDiffMask');
  assert.ok(!coreSrc.includes('doc-diff-add'), '不应残留doc-diff-add');
  assert.ok(!coreSrc.includes('doc-diff-del'), '不应残留doc-diff-del');
  assert.ok(!coreSrc.includes('doc-diff-ctx'), '不应残留doc-diff-ctx');
  assert.ok(!coreSrc.includes('copyDocDiffSummary') && !coreSrc.includes('复制变更说明'), '不应残留复制变更说明');
  assert.ok(!cssSrc.includes('.doc-diff-add'), 'CSS不应残留.doc-diff-add');
  assert.ok(!cssSrc.includes('.doc-diff-del'), 'CSS不应残留.doc-diff-del');
  assert.strictEqual(sb.DocP4.openDiff, undefined, 'DocP4不应残留openDiff');
  assert.strictEqual(sb.DocP4.closeDiff, undefined, 'DocP4不应残留closeDiff');
  assert.strictEqual(typeof sb.DocP4.exportMd, 'function', 'DocP4须保留exportMd(瘦身未删)');
  assert.strictEqual(typeof sb.DocP4.searchOpen, 'function', 'DocP4须保留searchOpen');
}

function runAllAssertions() {
  const tests = [
    ['断言1 stateDiagram起止矩形SVG', test1_StateStartEnd],
    ['断言2 stateDiagram箭头标签SVG', test2_StateArrowsLabels],
    ['断言3 stateDiagram-v2中文兼容', test3_StateV2Chinese],
    ['断言4 stateDiagram非法回退', test4_StateIllegalFallback],
    ['断言5 无LCS零残留', test5_LcsThreeStates],
    ['断言6 DocP4仅导出+检索', test6_LcsEmptyStates],
    ['断言7 搜索计数n/m源码', test7_SearchCountNM],
    ['断言8 搜索退出DOM还原源码', test8_SearchExitRestore],
    ['断言9 Ctrl+F/Enter/Esc wiring', test9_SearchKeys],
    ['断言10 preload仅长图PDF无历史', test10_PreloadThreeP4],
    ['断言11 主进程仅长图PDF无历史', test11_MainThreeP4],
    ['断言12 无富文本+MD Blob下载', test12_RichWhitelist],
    ['断言13 导出PNG/PDF/MD无emoji', test13_ToolbarIdsNoEmoji],
    ['断言14 无历史浮层零残留', test14_DiffMaskStack]
  ];
  let passed = 0;
  let failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  if (failed) console.log('MD_P4_FAIL');
  else console.log('MD_P4_PASS: 全部14项MD-P4断言通过');
  process.exitCode = failed ? 1 : 0;
}

runAllAssertions();
