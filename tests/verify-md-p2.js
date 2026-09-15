'use strict';
// P2 MD展示重构回归：图片缩放对齐后缀/Scrollspy/资产抽屉/双击微浮层/主进程资产通道/导出后缀保留（纯Node，不启动Electron）
// 手段：源文提取 + 最小fake DOM/document/localStorage/navigator + vm加载js/core-docs.js，对应P2 DoD
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

assert.strictEqual(typeof sb.renderMd, 'function', 'core-docs须暴露renderMd');
assert.strictEqual(typeof sb.mdBlocksOf, 'function', 'core-docs须暴露mdBlocksOf(P2切块)');
assert.strictEqual(typeof sb.openDocMicroPop, 'function', 'core-docs须暴露openDocMicroPop');
assert.strictEqual(typeof sb.openDocAssetDrawer, 'function', 'core-docs须暴露openDocAssetDrawer');
assert.strictEqual(typeof sb.closeDocAssetDrawer, 'function', 'core-docs须暴露closeDocAssetDrawer');
assert.strictEqual(typeof sb.ensureTocSpy, 'function', 'core-docs须暴露ensureTocSpy');
console.log('[INIT] vm加载core-docs成功 renderMd/mdBlocksOf/抽屉/微浮层/Scrollspy可用');

function extractImgSrc(h) {
  const m = /<img[^>]+src="([^"]+)"/.exec(String(h || ''));
  return m ? m[1] : '';
}
function fnBody(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// 断言1：合法后缀 {w=50} 宽度+居中对齐类
function test1_SuffixW() {
  const plain = sb.renderMd('![a](assets/a.png)', OPTS);
  const h = sb.renderMd('![a](assets/a.png){w=50}', OPTS);
  assert.ok(h.includes('doc-img-align-center'), 'w单键缺省应居中对齐类，实际:' + h.slice(0, 400));
  assert.ok(h.includes('width:50%'), 'w=50应含width:50%，实际:' + h.slice(0, 400));
  assert.ok(h.includes('max-width:50%'), 'w=50应含max-width:50%');
  assert.ok(h.includes('text-align:center'), 'w单键应text-align:center');
  assert.ok(h.includes('proto-asset://local/DemoProj/DemoProto/assets/a.png'), '仍应重写为proto-asset');
  assert.ok(!h.includes('{w='), '后缀花括号不应泄漏到输出');
  assert.strictEqual(extractImgSrc(h), extractImgSrc(plain), '缩放不应改变img src(Lightbox原图一致)');
}

// 断言2：合法后缀 {w=50 align=left} 双键渲染
function test2_SuffixWAlign() {
  const h = sb.renderMd('![a](assets/a.png){w=50 align=left}', OPTS);
  assert.ok(h.includes('doc-img-align-left'), '双键应含doc-img-align-left，实际:' + h.slice(0, 400));
  assert.ok(h.includes('width:50%'), '双键应含width:50%');
  assert.ok(h.includes('text-align:left'), '双键应text-align:left');
  assert.ok(h.includes('margin:10px 0;'), 'left应对齐左侧margin:10px 0;');
  assert.ok(h.includes('data-src="assets/a.png"'), '应保留data-src原文');
  assert.ok(!h.includes('{w='), '后缀不应泄漏');
}

// 断言3：合法后缀 {align=right} 单align渲染
function test3_SuffixAlignOnly() {
  const h = sb.renderMd('![a](assets/a.png){align=right}', OPTS);
  assert.ok(h.includes('doc-img-align-right'), '单align应含doc-img-align-right，实际:' + h.slice(0, 400));
  assert.ok(h.includes('text-align:right'), '单align应text-align:right');
  assert.ok(h.includes('margin:10px 0 10px auto;'), 'right应靠右margin');
  assert.ok(h.includes('max-width:100%;'), '单align无w时应max-width:100%');
  assert.ok(!h.includes('width:50%'), '单align不应含width:50%');
  assert.ok(!h.includes('{align='), '后缀不应泄漏');
}

// 断言4：非法后缀整体忽略且与P1无后缀逐字一致
function test4_SuffixIllegal() {
  const plain = sb.renderMd('![a](assets/a.png)', OPTS);
  assert.ok(plain.includes('<figure class="md-img"'), 'P1无后缀应为figure.md-img');
  assert.ok(!plain.includes('doc-img-align-'), 'P1无后缀不应含对齐类');
  const illegals = [
    '{w=5}', '{w=9}', '{w=101}', '{w=200}',
    '{align=top}', '{align=center1}',
    '{w=50 w=60}', '{align=left align=right}',
    '{foo=bar}', '{w=50 foo=bar}', '{w=}', '{align=}', '{w=50 align=top}'
  ];
  for (const suf of illegals) {
    const h = sb.renderMd('![a](assets/a.png)' + suf, OPTS);
    assert.strictEqual(h, plain, '非法后缀' + suf + '应整体忽略、与无后缀逐字一致，实际:' + h.slice(0, 300));
    assert.ok(!h.includes('doc-img-align-'), '非法后缀' + suf + '不应含对齐类');
    assert.ok(!h.includes(suf), '非法后缀' + suf + '原文不应泄漏');
  }
}

// 断言5：Lightbox仍用原图（不受缩放影响）
function test5_LightboxOriginal() {
  assert.ok(coreSrc.includes("openDocLightbox(t.getAttribute('src')"), '点击须openDocLightbox(src)直传原图URL');
  assert.ok(coreSrc.includes("im.setAttribute('src',src"), 'Lightbox img须由传入src设置');
  assert.ok(coreSrc.includes('Lightbox'), '须保留Lightbox逻辑');
  assert.ok(coreSrc.includes('不受缩放影响') || coreSrc.includes('走原图'), '须注释Lightbox走原图/不受缩放影响');
  const plain = sb.renderMd('![a](assets/a.png)', OPTS);
  const scaled = sb.renderMd('![a](assets/a.png){w=50 align=left}', OPTS);
  assert.strictEqual(extractImgSrc(scaled), extractImgSrc(plain), '缩放前后img src须一致(Lightbox同图)');
  assert.ok(scaled.includes('data-src="assets/a.png"'), '缩放仍保留data-src原文');
}

// 断言6：切块顺序 mdBlocksOf（与渲染引擎同序）
function test6_BlocksOrder() {
  const md = '# H1\n\npara1\n\n- a\n- b\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quote\n\n```\ncode\n```';
  const blocks = sb.mdBlocksOf(md);
  assert.strictEqual(blocks.length, 6, '应切6块，实际' + JSON.stringify(blocks));
  assert.strictEqual(JSON.stringify(Array.from(blocks.map(b => b.kind))), JSON.stringify(['head', 'para', 'list', 'table', 'quote', 'code']), 'kind顺序应head/para/list/table/quote/code');
  assert.strictEqual(JSON.stringify(Array.from(blocks.map(b => b.isCode))), JSON.stringify([false, false, false, false, false, true]), '仅code块isCode=true');
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].start >= blocks[i - 1].end, '块行区间须单调递增');
  assert.strictEqual(blocks[0].text, '# H1', '首块应为标题行');
  assert.ok(blocks[5].text.includes('code'), '末块应含code内容');
  const withComment = sb.mdBlocksOf('<!-- c -->\n# H\n\npara\n');
  assert.ok(withComment.length === 2 && withComment[0].text === '# H', '注释不应占块，实际' + JSON.stringify(withComment));
}

// 断言7：微存只换目标块（源码+纯逻辑）
function test7_MicroSaveTargetOnly() {
  assert.ok(coreSrc.includes('function saveDocMicroPop'), '须有saveDocMicroPop');
  assert.ok(coreSrc.includes('slice(0,Math.max(0,blk.start))'), '微存须按blk.start切前段');
  assert.ok(coreSrc.includes('concat(rep)'), '微存须concat替换行');
  assert.ok(coreSrc.includes('applyEditText(out2)'), 'doc微存须走applyEditText正常保存通道');
  assert.ok(coreSrc.includes('closeDocMicroPop()'), '微存后须关闭浮层');
  assert.ok(coreSrc.includes('已保存该段落'), '微存成功toast应为已保存该段落');
  assert.ok(coreSrc.includes('function openDocMicroPop'), '须有openDocMicroPop');
  assert.ok(coreSrc.includes('仅替换该段落块'), '须注释仅替换该块');
  // 纯逻辑：只换中间块
  const md = '# H1\n\npara-A\n\n- a\n- b\n';
  const blocks = sb.mdBlocksOf(md);
  assert.strictEqual(blocks.length, 3, '前置切块应3块');
  const blk = blocks[1];
  assert.strictEqual(blk.kind, 'para', '目标块应为para');
  const rep = ['NEW-PARA'];
  const lines = md.split('\n');
  const out = lines.slice(0, Math.max(0, blk.start)).concat(rep).concat(lines.slice(Math.min(lines.length, blk.end))).join('\n');
  assert.ok(out.includes('# H1') && out.includes('- a') && out.includes('NEW-PARA'), '替换后首尾块须保留');
  assert.ok(!out.includes('para-A'), '目标块旧文须被替换');
  assert.strictEqual(out, '# H1\n\nNEW-PARA\n\n- a\n- b\n', '仅目标块行区间被替换，实际:' + JSON.stringify(out));
}

// 断言8：抽屉开关不丢编辑态（源码级，剥离注释后断言不触碰编辑态变量）
function test8_DrawerKeepsEditState() {
  const openBody = fnBody(coreSrc, 'openDocAssetDrawer');
  const closeBody = fnBody(coreSrc, 'closeDocAssetDrawer');
  assert.ok(openBody, '须能提取openDocAssetDrawer函数体');
  assert.ok(closeBody, '须能提取closeDocAssetDrawer函数体');
  const stripComments = (s) => String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const openCode = stripComments(openBody);
  const closeCode = stripComments(closeBody);
  for (const tok of ['editOn', 'docEditArea', 'applyEditText', 'markDirty', 'isDocDirty', 'exitEdit', 'flushEdit']) {
    assert.ok(!openCode.includes(tok), 'openDocAssetDrawer不应触碰编辑态:' + tok);
    assert.ok(!closeCode.includes(tok), 'closeDocAssetDrawer不应触碰编辑态:' + tok);
  }
  assert.ok(coreSrc.includes('关闭不丢编辑态'), '须注释关闭不丢编辑态');
  assert.ok(openBody.includes('refreshDocAssetList'), '打开须刷新资产列表');
  assert.ok(openBody.includes('MaskStack'), '打开须走MaskStack');
  assert.ok(closeBody.includes('MaskStack'), '关闭须走MaskStack');
  assert.ok(closeBody.includes('aria-hidden'), '关闭须维护aria-hidden');
}

// 断言9：主进程两通道+目录守卫
function test9_MainTwoChannels() {
  assert.ok(mainSrc.includes("ipcMain.handle('sandbox:list-assets'"), 'main须有sandbox:list-assets通道');
  assert.ok(mainSrc.includes("ipcMain.handle('sandbox:delete-asset'"), 'main须有sandbox:delete-asset通道');
  assert.ok(mainSrc.includes('validProtoDir(o2.dir)'), '两通道须经validProtoDir校验');
  assert.ok(mainSrc.includes('目录不在沙箱范围内'), '目录外须拒绝为目录不在沙箱范围内');
  assert.ok(mainSrc.includes('isSubPath(target, SANDBOX_ROOT)') || mainSrc.includes('isSubPath(full, SANDBOX_ROOT)') || mainSrc.includes('isSubPath(target, paths.SANDBOX_ROOT)') || mainSrc.includes('isSubPath(full, paths.SANDBOX_ROOT)'), '须经isSubPath防穿越');
}

// 断言10：主进程白名单+删除守卫（非法名/目录外拒绝）
function test10_MainWhitelistDeleteGuard() {
  assert.ok(mainSrc.includes('PROTO_ASSET_EXT_MIME'), 'main须有白名单PROTO_ASSET_EXT_MIME');
  assert.ok(mainSrc.includes('fs.readdirSync(assetsDir'), 'list须读assetsDir');
  assert.ok(mainSrc.includes('b.mtimeMs - a.mtimeMs'), 'list须按mtime倒序');
  assert.ok(mainSrc.includes('非法文件名'), '非法名须拒绝为非法文件名');
  assert.ok(mainSrc.includes("name.includes('..')"), '删除须拦截..穿越');
  assert.ok(mainSrc.includes("name.includes('/')"), '删除须拦截/分隔符');
  assert.ok(mainSrc.includes('仅允许删除文件'), '非文件须拒绝为仅允许删除文件');
  assert.ok(mainSrc.includes('文件不存在'), '缺失文件须报文件不存在');
  assert.ok(mainSrc.includes('target.startsWith(assetsNorm'), '删除须startsWith锁定assets目录内');
}

// 断言11：preload两暴露
function test11_PreloadExposes() {
  assert.ok(preloadSrc.includes('listAssets'), 'preload须暴露listAssets');
  assert.ok(preloadSrc.includes('deleteAsset'), 'preload须暴露deleteAsset');
  assert.ok(preloadSrc.includes('sandbox:list-assets'), 'listAssets须invoke sandbox:list-assets');
  assert.ok(preloadSrc.includes('sandbox:delete-asset'), 'deleteAsset须invoke sandbox:delete-asset');
}

// 断言12：export后缀保留（扫描与替换均容忍后缀）
function test12_ExportSuffixKept() {
  assert.ok(exportSrc.includes('function inlineMarkdownImages'), '导出引擎须含inlineMarkdownImages');
  assert.ok(exportSrc.includes('容忍自有 GFM 后缀'), '须注释容忍后缀');
  assert.ok(exportSrc.includes('替换路径保留后缀'), '须注释替换保留后缀');
  assert.ok(exportSrc.includes('(\\{[^{}]*\\})?'), '扫描与替换正则须容忍可选后缀');
  assert.ok(exportSrc.includes('String(full).replace(inner, du+rest)'), '替换须仅换路径、保留后缀rest');
}

// 断言13：Scrollspy函数（滚动监听+防抖）
function test13_ScrollspyFns() {
  assert.ok(coreSrc.includes('function ensureTocSpy'), '须有ensureTocSpy');
  assert.ok(coreSrc.includes('function updateTocSpy'), '须有updateTocSpy');
  assert.ok(coreSrc.includes('function scheduleTocSpy'), '须有scheduleTocSpy(100ms防抖)');
  assert.ok(coreSrc.includes('_tocSpyBound'), '须有_tocSpyBound防重绑');
  assert.ok(coreSrc.includes("addEventListener('scroll'"), '须监听scroll');
  assert.strictEqual(typeof sb.ensureTocSpy, 'function', 'vm中ensureTocSpy须为函数');
  assert.strictEqual(typeof sb.updateTocSpy, 'function', 'vm中updateTocSpy须为函数');
  assert.strictEqual(typeof sb.scheduleTocSpy, 'function', 'vm中scheduleTocSpy须为函数');
}

// 断言14：Scrollspy高亮.toc-item.active
function test14_ScrollspyActive() {
  assert.ok(coreSrc.includes("querySelectorAll('.toc-item')"), '须查询.toc-item列表');
  assert.ok(coreSrc.includes("classList.add('active')"), '高亮须add active');
  assert.ok(coreSrc.includes("querySelector('.toc-item.active')"), '须查询.toc-item.active维持可见');
  assert.ok(cssSrc.includes('.doc-toc .toc-item.active'), 'CSS须有.doc-toc .toc-item.active高亮');
  assert.ok(coreSrc.includes("b.classList.add('active')") || coreSrc.includes(".classList.add('active')"), '点击TOC项须即时高亮');
}

// 断言15：CSS对齐/抽屉/微浮层样式存在
function test15_CssAssets() {
  assert.ok(cssSrc.includes('.doc-img-align-left'), 'CSS须有.doc-img-align-left');
  assert.ok(cssSrc.includes('.doc-img-align-center'), 'CSS须有.doc-img-align-center');
  assert.ok(cssSrc.includes('.doc-img-align-right'), 'CSS须有.doc-img-align-right');
  assert.ok(cssSrc.includes('.doc-asset-card'), 'CSS须有.doc-asset-card');
  assert.ok(cssSrc.includes('.doc-micro-pop'), 'CSS须有.doc-micro-pop');
  assert.ok(cssSrc.includes('.doc-micro-ta'), 'CSS须有.doc-micro-ta');
  assert.ok(coreSrc.includes('function parseImgSpec'), 'core须有parseImgSpec');
  assert.ok(coreSrc.includes('function renderImg'), 'core须有renderImg(suffixRaw)');
}

function runAllAssertions() {
  const tests = [
    ['断言1 合法后缀{w=50}', test1_SuffixW],
    ['断言2 合法后缀{w+align}', test2_SuffixWAlign],
    ['断言3 合法后缀单align', test3_SuffixAlignOnly],
    ['断言4 非法后缀忽略+P1一致', test4_SuffixIllegal],
    ['断言5 Lightbox仍用原图', test5_LightboxOriginal],
    ['断言6 切块顺序mdBlocksOf', test6_BlocksOrder],
    ['断言7 微存只换目标块', test7_MicroSaveTargetOnly],
    ['断言8 抽屉开关不丢编辑态', test8_DrawerKeepsEditState],
    ['断言9 主进程两通道+目录守卫', test9_MainTwoChannels],
    ['断言10 主进程白名单+删除守卫', test10_MainWhitelistDeleteGuard],
    ['断言11 preload两暴露', test11_PreloadExposes],
    ['断言12 export后缀保留', test12_ExportSuffixKept],
    ['断言13 Scrollspy函数+防抖', test13_ScrollspyFns],
    ['断言14 高亮.toc-item.active', test14_ScrollspyActive],
    ['断言15 CSS对齐/抽屉/微浮层', test15_CssAssets]
  ];
  let passed = 0;
  let failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  if (failed) console.log('MD_P2_FAIL');
  else console.log('MD_P2_PASS: 全部15项MD-P2断言通过');
  process.exitCode = failed ? 1 : 0;
}

runAllAssertions();
