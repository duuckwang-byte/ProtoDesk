'use strict';
// PlanD 独立文档窗口回归：后端 docwin 三通道+镜像中继+关窗通知+主窗联带 / preload 暴露 / 前端窗口模式+镜像+双Tab+切换按钮+面板模式
// 手段：源文提取静态断言 + 最小 fake DOM + vm 执行 isDocWinMode/syncDocWinBtn/applyDocWinPanelMode（纯 Node，不启动 Electron）
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
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
const coreSrc = fs.readFileSync(path.join(rootDir, 'js', 'core-docs.js'), 'utf8');
const exportSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const aiDomainSrc = fs.readFileSync(path.join(rootDir, 'js', 'ai', 'ai-domain.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, '须能定位 function ' + name);
  const b = src.indexOf('{', i);
  assert.ok(b > i, 'function ' + name + ' 缺函数体 {');
  let depth = 0;
  for (let j = b; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  assert.fail('function ' + name + ' 括号未闭合');
}

function mkClassList(init) {
  const s = new Set(Array.isArray(init) ? init : []);
  return {
    _set: s,
    add(c) { if (c) s.add(c); },
    remove(c) { if (c) s.delete(c); },
    contains(c) { return s.has(c); }
  };
}

// ── A1 主进程 docwin 三通道（open带参透传query project/proto） ──
function testA1_DocwinChannels() {
  for (const ch of ['docwin:open', 'docwin:close', 'docwin:toggle']) {
    assert.ok(mainSrc.includes("ipcMain.handle('" + ch + "'"), 'main.js 缺通道 ' + ch);
  }
  const openBody = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('docwin:open'"), mainSrc.indexOf("ipcMain.handle('docwin:open'") + 800);
  assert.ok(/\(ev,\s*opts\)/.test(openBody), 'docwin:open 须签名 (ev,opts) 带参');
  assert.ok(/createDocWindow\(opts\)/.test(openBody), 'docwin:open 须 createDocWindow(opts) 透传');
  assert.ok(/mode:\s*'win'/.test(openBody), 'docwin:open 须返回 mode win');
  const closeBody = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('docwin:close'"), mainSrc.indexOf("ipcMain.handle('docwin:close'") + 800);
  assert.ok(/docWin.*\.close\(\)/.test(closeBody), 'docwin:close 须关闭 docWin');
  assert.ok(/mode:\s*'panel'/.test(closeBody), 'docwin:close 须返回 mode panel');
  const togBody = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('docwin:toggle'"), mainSrc.indexOf("ipcMain.handle('docwin:toggle'") + 1000);
  assert.ok(/docWin.*\.close\(\)/.test(togBody) && /createDocWindow\(\)/.test(togBody), 'docwin:toggle 须按存在关闭/不存在创建');
  assert.ok(/mode:\s*'panel'/.test(togBody) && /mode:\s*'win'/.test(togBody), 'docwin:toggle 须双向返回 panel/win');
}

// ── A2 镜像中继透传 ──
function testA2_MirrorRelay() {
  assert.ok(mainSrc.includes("ipcMain.handle('doc:mirror-push'"), '缺 doc:mirror-push');
  assert.ok(mainSrc.includes("ipcMain.handle('doc:mirror-back'"), '缺 doc:mirror-back');
  assert.ok(/镜像中继/.test(mainSrc) && /原样透传不解析/.test(mainSrc), '须注释原样透传不解析');
  const pushI = mainSrc.indexOf("ipcMain.handle('doc:mirror-push'");
  const pushBody = mainSrc.slice(pushI, pushI + 800);
  assert.ok(/docWin\.webContents\.send\('doc:mirror',\s*msg\)/.test(pushBody), 'mirror-push 须向 docWin 透传 doc:mirror');
  assert.ok(/nop:\s*true/.test(pushBody), 'mirror-push 无窗时须 nop:true');
  const backI = mainSrc.indexOf("ipcMain.handle('doc:mirror-back'");
  const backBody = mainSrc.slice(backI, backI + 800);
  assert.ok(/mainWin.*\.webContents\.send\('doc:mirror',\s*msg\)/.test(backBody), 'mirror-back 须向 mainWin 透传 doc:mirror');
  assert.ok(/return\s*\{\s*ok:\s*true/.test(backBody), 'mirror-back 须返回 ok:true');
}

// ── A3 关窗通知 panel（open带参透传query） ──
function testA3_CloseNotifyPanel() {
  const ci = mainSrc.indexOf('function createDocWindow(');
  assert.ok(ci >= 0, '须有 createDocWindow');
  const body = mainSrc.slice(ci, ci + 2500);
  assert.ok(/function createDocWindow\(\s*opts\s*\)/.test(body), 'createDocWindow 须带 opts 参（open带参透传query）');
  assert.ok(/var _o = \(opts/.test(body), '须归一化 opts');
  assert.ok(/_project/.test(body) && /_proto/.test(body), '须提取 project/proto');
  assert.ok(/var _q = \{\s*docwin:\s*'1'\s*\}/.test(body), '须以 _q={docwin:1} 起步');
  assert.ok(/encodeURIComponent\(_project\)/.test(body) && /encodeURIComponent\(_proto\)/.test(body), 'project/proto 须 encodeURIComponent 透传');
  assert.ok(/docWin\.on\('closed'/.test(body), '须监听 docWin closed');
  assert.ok(/docWin\s*=\s*null/.test(body), 'closed 须置空 docWin');
  assert.ok(/mainWin.*\.webContents\.send\('doc:mirror',\s*\{\s*kind:\s*'mode',\s*mode:\s*'panel'\s*\}\)/.test(body), 'closed 须通知主窗 mode=panel');
  assert.ok(/loadFile\(appHtmlPath\(\),\s*\{\s*query:\s*_q\s*\}\)/.test(body), '须以 query _q（含docwin=1+project/proto）复用同一 HTML（绝对路径，打包后 cwd 不可靠）');
}

// ── A4 主窗联带关闭 ──
function testA4_MainCloseChain() {
  const ci = mainSrc.indexOf('function createWindow()');
  assert.ok(ci >= 0, '须有 createWindow');
  const body = mainSrc.slice(ci, ci + 2000);
  assert.ok(/mainWin\s*=\s*win/.test(body), '须赋值 mainWin=win');
  assert.ok(/win\.on\('close'/.test(body), '须监听主窗 close');
  assert.ok(/docWin.*\.close\(\)/.test(body.slice(body.indexOf("win.on('close'"), body.indexOf("win.on('close'") + 400)), '主窗 close 须联带 docWin.close');
  assert.ok(/win\.on\('closed'/.test(body), '须监听主窗 closed');
  assert.ok(/win\.loadFile\(path\.join\(app\.getAppPath\(\),\s*'原型\+文档\.html'\)\)/.test(body), '主窗须 loadFile 绝对路径（getAppPath，打包后 cwd 不可靠）');
}

// ── A5 preload docwin/mirror 暴露（open带参透传） ──
function testA5_PreloadExpose() {
  assert.ok(preloadSrc.includes('docwin:'), 'preload 须暴露 docwin 命名空间');
  assert.ok(/open:\s*\(o\)\s*=>\s*ipcRenderer\.invoke\('docwin:open',\s*o\)/.test(preloadSrc), 'docwin.open 须签名 (o)=>invoke docwin:open,o 透传query参');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('docwin:close')"), 'docwin.close 须 invoke docwin:close');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('docwin:toggle')"), 'docwin.toggle 须 invoke docwin:toggle');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('doc:mirror-push'"), '须暴露 mirrorPush->doc:mirror-push');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('doc:mirror-back'"), '须暴露 mirrorBack->doc:mirror-back');
  assert.ok(/onDocMirror/.test(preloadSrc), '须有 onDocMirror 多播封装');
  assert.ok(/ipcRenderer\.on\('doc:mirror'/.test(preloadSrc), '须桥接 doc:mirror 事件');
  assert.ok(/docMirrorListeners\.indexOf\(cb\)\s*<\s*0/.test(preloadSrc), 'onDocMirror 须去重');
  assert.ok(/splice\(i,\s*1\)/.test(preloadSrc), 'onDocMirror 须返回解绑函数');
  assert.ok(/onMirror:\s*\(cb\)\s*=>\s*onDocMirror\(cb\)/.test(preloadSrc), 'doc/docwin 均须暴露 onMirror');
  assert.ok(/mirrorPush:\s*\(o\)\s*=>\s*ipcRenderer\.invoke\('doc:mirror-push'/.test(preloadSrc), 'doc 与 docwin 均须暴露 mirrorPush');
  assert.ok(/mirrorBack:\s*\(o\)\s*=>\s*ipcRenderer\.invoke\('doc:mirror-back'/.test(preloadSrc), 'doc 与 docwin 均须暴露 mirrorBack');
}

// ── A6 isDocWinMode ──
function testA6_IsDocWinMode() {
  assert.ok(coreSrc.includes('function isDocWinMode('), 'core-docs 缺 isDocWinMode');
  assert.ok(coreSrc.includes("var DOCWIN_QUERY_KEY='docwin'"), '须有 DOCWIN_QUERY_KEY=docwin');
  const body = extractFn(coreSrc, 'isDocWinMode');
  assert.ok(/URLSearchParams/.test(body) && /\.get\(DOCWIN_QUERY_KEY\)==='1'/.test(body), '须经 URLSearchParams 判 docwin=1');
  assert.ok(/indexOf\('docwin=1'\)/.test(body), '须有 indexOf 兜底判 docwin=1');
  assert.ok(coreSrc.includes('window.isDocWinMode=isDocWinMode'), '须 window.isDocWinMode 暴露');
}

// ── A7 bootDocWinMode ──
function testA7_BootDocWinMode() {
  assert.ok(coreSrc.includes('function bootDocWinMode('), '缺 bootDocWinMode');
  const body = extractFn(coreSrc, 'bootDocWinMode');
  assert.ok(/document\.title='文档/.test(body), '须设标题 文档');
  assert.ok(/classList\.add\('docwin-mode'\)/.test(body), '须加 docwin-mode 类');
  assert.ok(/classList\.add\('docs-open'\)/.test(body), '须加 docs-open');
  assert.ok(/classList\.remove\('sb-open'\)/.test(body), '须移除 sb-open');
  assert.ok(/ensureDocModeUI\(\)/.test(body), '须 ensureDocModeUI');
  assert.ok(coreSrc.includes('window.bootDocWinMode=bootDocWinMode'), '须 window.bootDocWinMode 暴露');
  assert.ok(/if\(isDocWinMode\(\)\)\{\s*bootDocWinMode\(\);/.test(coreSrc), 'init 须按 isDocWinMode 分流 boot');
}

// ── A8 handleDocMirror 四 kind ──
function testA8_HandleFourKinds() {
  assert.ok(coreSrc.includes('function handleDocMirror('), '缺 handleDocMirror');
  const body = extractFn(coreSrc, 'handleDocMirror');
  for (const k of ['content', 'source', 'saved', 'mode']) {
    assert.ok(body.includes("kind==='" + k + "'"), 'handleDocMirror 缺分支 ' + k);
  }
  assert.ok(/payload\.reqMode/.test(body), '须处理 payload.reqMode');
  assert.ok(/payload\.mode/.test(body) || /dwMode/.test(body), 'mode 分支须处理 dwMode panel/win');
  assert.ok(/applyDocWinPanelMode\(dwMode\)/.test(body), 'mode 分支须调 applyDocWinPanelMode');
  assert.ok(/__docMirrorApplying=true/.test(body), '各分支须置 __docMirrorApplying 防环');
  assert.ok(coreSrc.includes('window.handleDocMirror=handleDocMirror'), '须 window.handleDocMirror 暴露');
}

// ── A9 mirrorPush/mirrorBack 防环 ──
function testA9_MirrorLoopGuard() {
  assert.ok(coreSrc.includes('function mirrorPush('), '缺 mirrorPush');
  assert.ok(coreSrc.includes('function mirrorBack('), '缺 mirrorBack');
  const push = extractFn(coreSrc, 'mirrorPush');
  const back = extractFn(coreSrc, 'mirrorBack');
  assert.ok(/if\(__docMirrorApplying\)\s*return/.test(push), 'mirrorPush 须 __docMirrorApplying 防环');
  assert.ok(/if\(isDocWinMode\(\)\)\s*return/.test(push), 'mirrorPush 在文档窗口内须直接返回（只主窗外发）');
  assert.ok(/if\(__docMirrorApplying\)\s*return/.test(back), 'mirrorBack 须 __docMirrorApplying 防环');
  assert.ok(/if\(!isDocWinMode\(\)\)\s*return/.test(back), 'mirrorBack 在主窗内须直接返回（只文档窗回传）');
  assert.ok(push.includes("['doc','mirrorPush']") && push.includes("['docwin','mirrorPush']"), 'mirrorPush 须兼容 doc/docwin 双通道');
  assert.ok(back.includes("['doc','mirrorBack']") && back.includes("['docwin','mirrorBack']"), 'mirrorBack 须兼容 doc/docwin 双通道');
  assert.ok(/__lastMirrorPush/.test(push), 'mirrorPush 须写 __lastMirrorPush 可观测');
  assert.ok(/__lastMirrorBack/.test(back), 'mirrorBack 须写 __lastMirrorBack 可观测');
  assert.ok(coreSrc.includes('window.mirrorPush=mirrorPush'), '须 window.mirrorPush 暴露');
  assert.ok(coreSrc.includes('window.mirrorBack=mirrorBack'), '须 window.mirrorBack 暴露');
}

// ── A10 双 Tab 与 reqMode 切换 ──
function testA10_DualTabs() {
  assert.ok(htmlSrc.includes('id="btnDocTabDesc"'), 'HTML 缺 #btnDocTabDesc');
  assert.ok(htmlSrc.includes('id="btnDocTabReq"'), 'HTML 缺 #btnDocTabReq');
  assert.ok(htmlSrc.includes('id="docModeTabs"'), 'HTML 缺 #docModeTabs');
  assert.ok(/id="btnDocTabDesc"[^>]*>功能说明</.test(htmlSrc), '#btnDocTabDesc 文案须 功能说明');
  assert.ok(/id="btnDocTabReq"[^>]*>最新需求</.test(htmlSrc), '#btnDocTabReq 文案须 最新需求');
  assert.ok(coreSrc.includes("bd.id='btnDocTabDesc'") || coreSrc.includes('bd.id="btnDocTabDesc"') || coreSrc.includes("id='btnDocTabDesc'") || coreSrc.includes('btnDocTabDesc'), 'js 须动态创建 btnDocTabDesc（ensureDocModeUI）');
  assert.ok(coreSrc.includes("br.id='btnDocTabReq'") || coreSrc.includes('btnDocTabReq'), 'js 须动态创建 btnDocTabReq');
  assert.ok(coreSrc.includes('function switchDocTab('), '缺 switchDocTab');
  assert.ok(coreSrc.includes('function syncDocModeTabs('), '缺 syncDocModeTabs');
  const sw = extractFn(coreSrc, 'switchDocTab');
  assert.ok(/setReqModeMobile/.test(sw), '移动端须走 setReqModeMobile');
  assert.ok(/setDocsOpen/.test(sw) && /renderReqIntoDocs/.test(sw), 'PC 端须面板内切换（setDocsOpen+renderReqIntoDocs），不再弹裸弹窗');
  assert.ok(!/setReqOpen\([^)]*true/.test(sw), 'PC 端不得再 setReqOpen(true) 弹裸弹窗');
  assert.ok(/mirrorPush\('mode'/.test(sw) && /mirrorBack\('mode'/.test(sw), '切换后须 mirrorPush/mirrorBack mode');
  const sync = extractFn(coreSrc, 'syncDocModeTabs');
  assert.ok(/btnDocTabDesc/.test(sync) && /btnDocTabReq/.test(sync), 'sync 须同步双 Tab');
  assert.ok(/classList.*'on'/.test(sync), 'sync 须切换 on 类');
}

// ── A10b 合一：PC 入口与状态收敛（单壳 tab 切换） ──
function testA10b_UnifiedReqTab() {
  // reqFab 入口：PC 直接进统一面板切 tab，不弹裸弹窗
  const tg = extractFn(exportSrc, 'toggleReqPane');
  assert.ok(tg, '缺 toggleReqPane');
  assert.ok(/switchDocTab\(true\)/.test(tg), 'PC 入口须 switchDocTab(true)');
  assert.ok(!/setReqOpen\([^)]*true/.test(tg), 'PC 入口不得 setReqOpen(true)');
  // PC 状态：reqMode 同样代表最新需求 tab
  const gs = extractFn(coreSrc, 'getDocReqState');
  assert.ok(/reqMode/.test(gs), 'PC 状态须感知 reqMode');
  // 关面板回落 desc（非编辑态）
  const sd = extractFn(exportSrc, 'setDocsOpen');
  assert.ok(/loadDesc/.test(sd), '关面板须回落 loadDesc');
  // PC 目录常驻：切 tab 刷新目录、随面板同显隐、外部点击不收
  const sw2 = extractFn(coreSrc, 'switchDocTab');
  assert.ok(/syncTocForTab/.test(sw2), '切 tab 须同步目录');
  assert.ok(/function syncTocForTab\(/.test(coreSrc), '缺 syncTocForTab');
  assert.ok(/function isTocPinMode\(/.test(coreSrc), '缺 isTocPinMode（移动端/独立窗除外）');
  assert.ok(/syncTocForTab/.test(sd) && /closeToc/.test(sd), '开面板须同步目录、关面板须一并隐藏目录');
  console.log('[PASS] A10b');
}

// ── A10c PC 目录左侧固定列（与文档平级不遮挡） ──
function testA10c_TocSideColumn() {
  const tocCount = (htmlSrc.match(/id="docToc"/g) || []).length;
  assert.strictEqual(tocCount, 1, 'docToc 须唯一，实际' + tocCount);
  const panelIdx = htmlSrc.indexOf('<div class="docs-panel">');
  const tocIdx = htmlSrc.indexOf('id="docToc"');
  const mainIdx = htmlSrc.indexOf('class="docs-main"');
  assert.ok(panelIdx >= 0 && tocIdx > panelIdx && mainIdx > tocIdx, '目录须在面板内文档列左侧');
  assert.ok(/body\.kind-pc:not\(\.docwin-mode\) \.docs-panel\s*\{[^}]*flex-direction\s*:\s*row/.test(cssSrc), 'PC 面板须横向排布');
  assert.ok(/body\.kind-pc:not\(\.docwin-mode\) \.doc-toc\s*\{[^}]*position\s*:\s*static/.test(cssSrc), 'PC 目录须静态列（非悬浮）');
  assert.ok(/\.docs-main\s*\{[^}]*flex-direction\s*:\s*column/.test(cssSrc), '文档主列须纵向（全模式通用）');
  const pos = extractFn(coreSrc, 'positionToc');
  assert.ok(/isTocPinMode/.test(pos), 'positionToc 须识别常驻模式清行内定位');
  // 点击定位后常驻不收 + 开目录弹窗加宽不挤文档
  const clickSeg = coreSrc.slice(coreSrc.indexOf("docTocEl.addEventListener('click'"), coreSrc.indexOf("docTocEl.addEventListener('click'") + 1500);
  assert.ok(/isTocPinMode/.test(clickSeg), '目录项点击定位后常驻模式不得 closeToc');
  assert.ok(/toc-open/.test(coreSrc), '开/关目录须同步 toc-open 标记');
  assert.ok(/\.toc-open \.docs-panel\s*\{[^}]*calc\(66vw \+ 224px\)/.test(cssSrc), '开目录时弹窗须加宽一列不挤文档');
  assert.ok(/body\.docwin-mode \.docs-panel\s*\{[^}]*flex-direction\s*:\s*row/.test(cssSrc), '独立窗面板须行排（目录入面板后防主列压成0）');
  assert.ok(/\.docs-main\s*\{[^}]*flex-direction\s*:\s*column/.test(cssSrc), '文档主列须纵向布局（移动端滚动与独立窗内容靠它）');
  assert.ok(/\.docs-main\s*\{[^}]*min-height\s*:\s*0/.test(cssSrc), '文档主列须 min-height:0 不撑破滚动链');
  console.log('[PASS] A10c');
}

// ── A11 切换按钮文案互换 ──
function testA11_ToggleBtnText() {
  assert.ok(htmlSrc.includes('id="btnDocWinToggle"'), 'HTML 缺 #btnDocWinToggle');
  assert.ok(/id="btnDocWinToggle"[^>]*>独立窗口</.test(htmlSrc), '#btnDocWinToggle 默认文案须 独立窗口');
  assert.ok(coreSrc.includes('function syncDocWinBtn('), '缺 syncDocWinBtn');
  const body = extractFn(coreSrc, 'syncDocWinBtn');
  assert.ok(/btnDocWinToggle/.test(body), 'sync 须取 #btnDocWinToggle');
  assert.ok(/独立窗口/.test(body) && /切换回弹窗/.test(body), '文案须互换 独立窗口/切换回弹窗');
  assert.ok(/在独立窗口中打开文档/.test(body) && /关闭独立窗口/.test(body), 'title 须同步互换');
  assert.ok(coreSrc.includes('function toggleDocWin('), '缺 toggleDocWin');
  assert.ok(coreSrc.includes('function ensureDocModeUI('), '缺 ensureDocModeUI');
  const ens = extractFn(coreSrc, 'ensureDocModeUI');
  assert.ok(/btnDocWinToggle/.test(ens), 'ensure 须在缺失时创建切换按钮');
  assert.ok(/toggleDocWin/.test(ens), '切换按钮点击须调 toggleDocWin');
  assert.ok(coreSrc.includes('window.toggleDocWin=toggleDocWin'), '须 window.toggleDocWin 暴露');
}

// ── A12 applyDocWinPanelMode 源码语义 ──
function testA12_ApplySrc() {
  assert.ok(coreSrc.includes('function applyDocWinPanelMode('), '缺 applyDocWinPanelMode');
  const body = extractFn(coreSrc, 'applyDocWinPanelMode');
  assert.ok(/dwMode!=='panel'&&dwMode!=='win'/.test(body), '非法 mode 须直接返回');
  assert.ok(/inWin=isDocWinMode\(\);?\s*\}catch[\s\S]{0,40}\}?\s*if\(inWin\)\s*return/.test(body), '文档窗口内须不响应');
  assert.ok(/if\(docsOpen\|\|reqUiOpen\)\s*return/.test(body), 'panel 已开时须不重复');
  assert.ok(/if\(!docsOpen&&!reqUiOpen\)\s*return/.test(body), 'win 已收时须不重复');
  assert.ok(/setDocsOpen.*true/.test(body), 'panel 须开文档（setDocsOpen true）');
  assert.ok(/setDocsOpen.*false/.test(body), 'win 须收文档（setDocsOpen false）');
  assert.ok(/setReqOpen.*false/.test(body), 'win 须收需求（setReqOpen false）');
  assert.ok(/__docMirrorApplying=true/.test(body) && /__docMirrorApplying=false/.test(body), '须以 __docMirrorApplying 包裹防环');
}

// ── S1 isDocWinMode + syncDocWinBtn 真执行 ──
function testS1_IsModeAndBtnRuntime() {
  const isBody = extractFn(coreSrc, 'isDocWinMode');
  function runIs(search) {
    const sb = { location: { search: search }, URLSearchParams: URLSearchParams };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext("var DOCWIN_QUERY_KEY='docwin';\n" + isBody + "\nthis.__ret=isDocWinMode();", sb);
    return sb.__ret;
  }
  assert.strictEqual(runIs('?docwin=1'), true, '?docwin=1 须 true');
  assert.strictEqual(runIs('?docwin=1&project=x'), true, '带参 docwin=1 须 true');
  assert.strictEqual(runIs(''), false, '空 search 须 false');
  assert.strictEqual(runIs('?project=a'), false, '无 docwin 须 false');
  assert.strictEqual(runIs('?docwin=0'), false, 'docwin=0 须 false');
  const syncBody = extractFn(coreSrc, 'syncDocWinBtn');
  function runBtn(search) {
    const btn = { textContent: '', title: '' };
    const sb = {
      document: { getElementById(id) { return id === 'btnDocWinToggle' ? btn : null; } },
      location: { search: search },
      URLSearchParams: URLSearchParams,
      __btn: btn
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext("var DOCWIN_QUERY_KEY='docwin';\n" + isBody + '\n' + syncBody + '\nsyncDocWinBtn();', sb);
    return btn;
  }
  const w = runBtn('?docwin=1');
  assert.strictEqual(w.textContent, '切换回弹窗', '文档窗口内文案须 切换回弹窗，实际:' + w.textContent);
  assert.ok(/关闭独立窗口/.test(w.title), '文档窗口内 title 须含 关闭独立窗口，实际:' + w.title);
  const m = runBtn('');
  assert.strictEqual(m.textContent, '独立窗口', '主窗口内文案须 独立窗口，实际:' + m.textContent);
  assert.ok(/在独立窗口中打开文档/.test(m.title), '主窗口内 title 须含 在独立窗口中打开文档，实际:' + m.title);
}

// ── S2 applyDocWinPanelMode 真执行：panel开/win收/已达不重复/窗内不响应 ──
function testS2_ApplyRuntime() {
  const isBody = extractFn(coreSrc, 'isDocWinMode');
  const applyBody = extractFn(coreSrc, 'applyDocWinPanelMode');
  function runApply(opt) {
    const search = opt.search || '';
    const bodyEl = { classList: mkClassList(opt.classes || []) };
    const calls = { docs: [], req: [] };
    const sb = {
      document: { body: bodyEl, getElementById() { return null; } },
      window: {},
      location: { search: search },
      URLSearchParams: URLSearchParams,
      pcMode: function () { return false; },
      getDocReqState: function () { return false; },
      setDocsOpen: function (on) { calls.docs.push(!!on); if (on) bodyEl.classList.add('docs-open'); else bodyEl.classList.remove('docs-open'); },
      setReqOpen: function (on) { calls.req.push(!!on); if (on) bodyEl.classList.add('req-open'); else bodyEl.classList.remove('req-open'); },
      __calls: calls,
      __body: bodyEl
    };
    sb.window = sb.window || {};
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext("var DOCWIN_QUERY_KEY='docwin';\nvar __docMirrorApplying=false;\n" + isBody + '\n' + applyBody, sb);
    vm.runInContext("applyDocWinPanelMode(" + JSON.stringify(opt.mode) + ");\nthis.__applying=__docMirrorApplying;", sb);
    return {
      calls: calls,
      hasDocs: bodyEl.classList.contains('docs-open'),
      hasReq: bodyEl.classList.contains('req-open'),
      applying: sb.__applying
    };
  }
  // panel开：关闭态 -> 开
  let r = runApply({ mode: 'panel', classes: [] });
  assert.deepStrictEqual(r.calls.docs, [true], 'panel关闭态须 setDocsOpen(true)，实际:' + JSON.stringify(r.calls.docs));
  assert.strictEqual(r.hasDocs, true, 'panel后须含 docs-open');
  assert.strictEqual(r.applying, false, 'panel后 __docMirrorApplying 须复位 false');
  // win收：打开态 -> 收
  r = runApply({ mode: 'win', classes: ['docs-open'] });
  assert.deepStrictEqual(r.calls.docs, [false], 'win打开态须 setDocsOpen(false)，实际:' + JSON.stringify(r.calls.docs));
  assert.strictEqual(r.hasDocs, false, 'win后须移除 docs-open');
  assert.strictEqual(r.applying, false, 'win后 __docMirrorApplying 须复位 false');
  // 已达不重复：panel已开不再调
  r = runApply({ mode: 'panel', classes: ['docs-open'] });
  assert.strictEqual(r.calls.docs.length, 0, 'panel已开须不重复调用，实际:' + JSON.stringify(r.calls.docs));
  assert.strictEqual(r.hasDocs, true, 'panel已开须保持 docs-open');
  // 已达不重复：win已收不再调
  r = runApply({ mode: 'win', classes: [] });
  assert.strictEqual(r.calls.docs.length, 0, 'win已收须不重复调用，实际:' + JSON.stringify(r.calls.docs));
  assert.strictEqual(r.calls.req.length, 0, 'win已收须不碰 req，实际:' + JSON.stringify(r.calls.req));
  // 窗内不响应：docwin=1 时 panel/win 均静默
  r = runApply({ mode: 'panel', classes: [], search: '?docwin=1' });
  assert.strictEqual(r.calls.docs.length, 0, '文档窗口内 panel 须不响应，实际:' + JSON.stringify(r.calls.docs));
  assert.strictEqual(r.hasDocs, false, '文档窗口内 panel 须不改 docs-open');
  r = runApply({ mode: 'win', classes: ['docs-open'], search: '?docwin=1' });
  assert.strictEqual(r.calls.docs.length, 0, '文档窗口内 win 须不响应，实际:' + JSON.stringify(r.calls.docs));
  assert.strictEqual(r.hasDocs, true, '文档窗口内 win 须不改 docs-open');
  // 非法 mode 静默
  r = runApply({ mode: 'bad', classes: [] });
  assert.strictEqual(r.calls.docs.length, 0, '非法 mode 须静默，实际:' + JSON.stringify(r.calls.docs));
}

// ── B1 Tab胶囊：宽120px/圆角50px ──
function testB1_TabCapsule() {
  const m = cssSrc.match(/\.doc-mode-tab\{[^}]*\}/);
  assert.ok(m, 'css 缺 .doc-mode-tab 规则');
  assert.ok(/width:120px/.test(m[0]), 'Tab宽须120px，实际:' + m[0].slice(0, 160));
  assert.ok(/height:28px/.test(m[0]), 'Tab高须28px，实际:' + m[0].slice(0, 160));
  assert.ok(/border-radius:50px/.test(m[0]), 'Tab圆角须50px胶囊，实际:' + m[0].slice(0, 160));
  assert.ok(htmlSrc.includes('class="doc-mode-tab on" id="btnDocTabDesc"'), 'HTML #btnDocTabDesc 须 doc-mode-tab 胶囊类');
  assert.ok(htmlSrc.includes('class="doc-mode-tab" id="btnDocTabReq"'), 'HTML #btnDocTabReq 须 doc-mode-tab 胶囊类');
  assert.ok(/\.doc-mode-tab\.on\{[^}]*background:var\(--pri\)/.test(cssSrc), '激活态须纯色 pri 背景');
}

// ── B2 docwin恒左目录右文档：220px独立侧栏 ──
function testB2_DocwinLeftTocRightDoc() {
  assert.ok(/恒为左侧目录\+右侧文档/.test(cssSrc), 'css 须注明恒为左侧目录+右侧文档');
  assert.ok(/body\.docwin-mode \.stage-frame\{[^}]*display:flex[^}]*flex-direction:row/.test(cssSrc), 'docwin stage-frame 须 flex 横排（左目录右文档）');
  const tocAll = cssSrc.match(/body\.docwin-mode \.doc-toc\{[^}]*\}/g) || [];
  const toc = tocAll.find(s => /width:220px/.test(s));
  assert.ok(toc, 'css 缺 docwin 220px .doc-toc 规则');
  assert.ok(/position:static/.test(toc), '目录须 static 独立板块（非浮层）');
  assert.ok(/width:220px/.test(toc) && /min-width:220px/.test(toc) && /max-width:220px/.test(toc), '目录侧栏须锁定220px，实际:' + toc.slice(0, 200));
  const panel = cssSrc.match(/body\.docwin-mode \.docs-panel\{[^}]*position:static[^}]*\}/);
  assert.ok(panel, 'css 缺 docwin .docs-panel static 规则');
  assert.ok(/flex:1 1 auto/.test(panel[0]), '文档区须 flex:1 自适应剩余宽度');
  assert.ok(/body\.docwin-mode\.kind-pc \.docs-panel\{[^}]*position:static/.test(cssSrc), 'PC 端须同样 static（不跟随端别）');
  assert.ok(/body\.docwin-mode\.kind-mobile \.docs-panel\{[^}]*position:static/.test(cssSrc), '移动端须同样 static（不跟随端别）');
}

// ── B3 docwin maximize + 默认openToc（open带参透传query） ──
function testB3_DocwinMaximizeOpenToc() {
  const ci = mainSrc.indexOf('function createDocWindow(');
  assert.ok(ci >= 0, '须有 createDocWindow');
  const cbody = mainSrc.slice(ci, ci + 2500);
  assert.ok(/function createDocWindow\(\s*opts\s*\)/.test(cbody), 'createDocWindow 须带 opts 参');
  assert.ok(/encodeURIComponent\(_project\)/.test(cbody) && /encodeURIComponent\(_proto\)/.test(cbody), '须透传 project/proto');
  assert.ok(/loadFile\(appHtmlPath\(\),\s*\{\s*query:\s*_q\s*\}\)/.test(cbody), '须以 query _q 复用同一 HTML（绝对路径）');
  assert.ok(/docWin\.maximize\(\)/.test(cbody), 'docwin 创建后须 maximize 最大化');
  assert.ok(/docWin\.show\(\)/.test(cbody), 'docwin 创建后须 show');
  const bi = coreSrc.indexOf('function bootDocWinMode(');
  assert.ok(bi >= 0, '缺 bootDocWinMode');
  const btail = coreSrc.slice(bi, bi + 3200);
  assert.ok(/document\.body.*classList\.add\('docs-open'\)/.test(btail), 'boot 默认须 docs-open（直接展示文档）');
  assert.ok(/if\(typeof openToc==='function'\) openToc\(\)/.test(btail), 'boot 默认须 openToc 展开目录');
  assert.ok(/typeof openToc==='function'\)\{\s*try\{\s*openToc\(\)/.test(btail) && /,\s*1200\)/.test(btail), 'boot 须 1200ms 延迟兜底 openToc');
}

// ── C1 aiwin主进程三通道（open带参透传query project/proto） ──
function testC1_AiwinChannels() {
  for (const ch of ['aiwin:open', 'aiwin:close', 'aiwin:toggle']) {
    assert.ok(mainSrc.includes("ipcMain.handle('" + ch + "'"), 'main.js 缺通道 ' + ch);
  }
  assert.ok(/(let docWin = null|docWin:\s*null)/.test(mainSrc) && /(let aiWin = null|aiWin:\s*null)/.test(mainSrc), 'docWin/aiWin 须独立变量（Wave-B: shared/state）');
  assert.ok(mainSrc.includes('function createAiWindow('), '须有 createAiWindow');
  const ci = mainSrc.indexOf('function createAiWindow(');
  assert.ok(ci >= 0, '须能定位 createAiWindow');
  const cbody = mainSrc.slice(ci, ci + 1800);
  assert.ok(/function createAiWindow\(\s*opts\s*\)/.test(cbody), 'createAiWindow 须带 opts 参（open带参透传query）');
  assert.ok(/var _o = \(opts/.test(cbody), '须归一化 opts');
  assert.ok(/_project/.test(cbody) && /_proto/.test(cbody), '须提取 project/proto');
  assert.ok(/var _q = \{\s*aiwin:\s*'1'\s*\}/.test(cbody), '须以 _q={aiwin:1} 起步');
  assert.ok(/encodeURIComponent\(_project\)/.test(cbody) && /encodeURIComponent\(_proto\)/.test(cbody), 'project/proto 须 encodeURIComponent 透传');
  assert.ok(/aiWin\s*=\s*new BrowserWindow/.test(cbody), '须创建独立 aiWin 窗口');
  assert.ok(/title:\s*'AI对话'/.test(cbody), 'aiwin 标题须 AI对话');
  assert.ok(/loadFile\(appHtmlPath\(\),\s*\{\s*query:\s*_q\s*\}\)/.test(cbody), '须以 query _q（含aiwin=1+project/proto）复用同一 HTML（绝对路径）');
  assert.ok(/aiWin\.show\(\)/.test(cbody) && /aiWin\.maximize\(\)/.test(cbody), 'aiwin 须 show+maximize');
  const openAt = mainSrc.indexOf("ipcMain.handle('aiwin:open'");
  assert.ok(openAt >= 0, '缺 aiwin:open');
  const openBody = mainSrc.slice(openAt, openAt + 600);
  assert.ok(/\(ev,\s*opts\)/.test(openBody), 'aiwin:open 须签名 (ev,opts) 带参');
  assert.ok(/createAiWindow\(opts\)/.test(openBody), 'aiwin:open 须 createAiWindow(opts) 透传');
  assert.ok(/mode:\s*'ai-win'/.test(openBody), 'aiwin:open 须返回 ai-win');
  const closeBody = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('aiwin:close'"), mainSrc.indexOf("ipcMain.handle('aiwin:close'") + 600);
  assert.ok(/aiWin.*\.close\(\)/.test(closeBody) && /mode:\s*'ai-panel'/.test(closeBody), 'aiwin:close 须关闭并返回 ai-panel');
  const togBody = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('aiwin:toggle'"), mainSrc.indexOf("ipcMain.handle('aiwin:toggle'") + 800);
  assert.ok(/aiWin.*\.close\(\)/.test(togBody) && /createAiWindow\(\)/.test(togBody), 'aiwin:toggle 须按存在关闭/不存在创建');
  assert.ok(/mode:\s*'ai-panel'/.test(togBody) && /mode:\s*'ai-win'/.test(togBody), 'aiwin:toggle 须双向返回 ai-panel/ai-win');
}

// ── C2 aiwin preload暴露（open带参透传） ──
function testC2_AiwinPreload() {
  assert.ok(preloadSrc.includes('aiwin:'), 'preload 须暴露 aiwin 命名空间');
  const ai = preloadSrc.slice(preloadSrc.indexOf('aiwin:'), preloadSrc.indexOf('aiwin:') + 600);
  assert.ok(/open:\s*\(o\)\s*=>\s*ipcRenderer\.invoke\('aiwin:open',\s*o\)/.test(ai), 'aiwin.open 须签名 (o)=>invoke aiwin:open,o 透传query参');
  assert.ok(ai.includes("ipcRenderer.invoke('aiwin:close')"), 'aiwin.close 须 invoke aiwin:close');
  assert.ok(ai.includes("ipcRenderer.invoke('aiwin:toggle')"), 'aiwin.toggle 须 invoke aiwin:toggle');
  assert.ok(ai.includes("ipcRenderer.invoke('doc:mirror-push'"), 'aiwin 须复用 mirrorPush->doc:mirror-push');
  assert.ok(ai.includes("ipcRenderer.invoke('doc:mirror-back'"), 'aiwin 须复用 mirrorBack->doc:mirror-back');
  assert.ok(/onMirror:\s*\(cb\)\s*=>\s*onDocMirror\(cb\)/.test(ai), 'aiwin 须复用 onDocMirror 桥接 onMirror');
}

// ── C3 aiwin前端：aiwin-mode + ai-head内tab后沙箱前按钮 + bootAiWinMode ──
function testC3_AiwinFrontend() {
  assert.ok(coreSrc.includes("var AIWIN_QUERY_KEY='aiwin'"), '须有 AIWIN_QUERY_KEY=aiwin');
  assert.ok(coreSrc.includes('function isAiWinMode('), '缺 isAiWinMode');
  const isBody = extractFn(coreSrc, 'isAiWinMode');
  assert.ok(/\.get\(AIWIN_QUERY_KEY\)==='1'/.test(isBody), '须经 URLSearchParams 判 aiwin=1');
  assert.ok(/indexOf\('aiwin=1'\)/.test(isBody), '须有 indexOf 兜底判 aiwin=1');
  assert.ok(coreSrc.includes('function bootAiWinMode('), '缺 bootAiWinMode');
  const boot = extractFn(coreSrc, 'bootAiWinMode');
  assert.ok(/document\.title='AI对话/.test(boot), 'boot 须设标题 AI对话');
  assert.ok(/classList\.add\('aiwin-mode'\)/.test(boot), 'boot 须加 aiwin-mode 类');
  assert.ok(/ensureAiWinUI\(\)/.test(boot) && /syncAiWinBtn\(\)/.test(boot), 'boot 须 ensureAiWinUI+syncAiWinBtn');
  assert.ok(/applyAiWinCloseGuard\(\)/.test(boot), 'boot 须 applyAiWinCloseGuard（隐藏#aiClose/禁关）');
  assert.ok(/applyAiWinLockSwitchers\(\)/.test(boot), 'boot 须 applyAiWinLockSwitchers（锁定切换入口）');
  assert.ok(/aiWinBootProject\(\)/.test(boot), 'boot 须 aiWinBootProject（query直进沙箱）');
  assert.ok(/typeof openAi==='function'/.test(boot), 'boot 须 openAi 自动拉起对话（失败回退 aiMask flex）');
  assert.ok(coreSrc.includes('function syncAiWinBtn('), '缺 syncAiWinBtn');
  const sync = extractFn(coreSrc, 'syncAiWinBtn');
  assert.ok(/btnAiWinToggle/.test(sync) && /独立窗口/.test(sync) && /切换回弹窗/.test(sync), '按钮文案须互换 独立窗口/切换回弹窗');
  assert.ok(/在独立窗口中打开AI对话/.test(sync) && /关闭独立窗口/.test(sync), 'title 须同步互换');
  assert.ok(coreSrc.includes('function ensureAiWinUI('), '缺 ensureAiWinUI');
  const ens = extractFn(coreSrc, 'ensureAiWinUI');
  assert.ok(/querySelector\('\.ai-head'\)/.test(ens), '按钮宿主须优先 .ai-head（已移出日志栏）');
  assert.ok(/ai-tab-header/.test(ens), '须定位 tab 头 .ai-tab-header');
  assert.ok(/getElementById\('aiSbx'\)/.test(ens), '须定位沙箱 #aiSbx 以插到其前');
  assert.ok(/head\.insertBefore\(b,sbx\)/.test(ens) || /head\.insertBefore\(btn,sbx\)/.test(ens), '须插到沙箱前（tab后沙箱前）');
  assert.ok(/tabBar&&tabBar\.nextSibling|tabBar\.nextSibling/.test(ens), '无沙箱时须跟随 tabBar 之后');
  assert.ok(/b\.id='btnAiWinToggle'/.test(ens) && /toggleAiWin/.test(ens), '须创建 #btnAiWinToggle 并绑定 toggleAiWin');
  assert.ok(/btn\.nextSibling!==sbx|needMove/.test(ens), '已存在按钮须迁移到沙箱前（幂等纠偏）');
  assert.ok(/_aiWinBound/.test(ens), '须 _aiWinBound 防重绑');
  assert.ok(/host===head/.test(ens), '主路径须 host===head（ai-head内，非日志栏）');
  assert.ok(coreSrc.includes('function toggleAiWin('), '缺 toggleAiWin');
  const tog = extractFn(coreSrc, 'toggleAiWin');
  assert.ok(/openArg/.test(tog) && /currentProject/.test(tog) && /currentSource/.test(tog), 'toggle 须组装 openArg{project,proto}');
  assert.ok(/replace\(.*html/.test(tog), 'proto 须去 .html/.md 后缀');
  assert.ok(/protoAPI\.aiwin.*\.toggle/.test(tog), 'toggle 优先走 protoAPI.aiwin.toggle');
  assert.ok(/protoAPI\.aiwin.*\.open/.test(tog) && /protoAPI\.aiwin.*\.close/.test(tog), 'fallback 须按窗口归属走 open/close');
  assert.ok(/toggle\(openArg\)/.test(tog) && /open\(openArg\)/.test(tog), '须透传 openArg（query直进）');
  for (const w of ['window.isAiWinMode=isAiWinMode', 'window.bootAiWinMode=bootAiWinMode', 'window.toggleAiWin=toggleAiWin', 'window.syncAiWinBtn=syncAiWinBtn']) {
    assert.ok(coreSrc.includes(w), '须 ' + w + ' 暴露');
  }
  assert.ok(coreSrc.includes('window.getAiWinQueryParams=getAiWinQueryParams'), '须 window.getAiWinQueryParams 暴露');
  assert.ok(/if\(isAiWinMode\(\)\)\{\s*bootAiWinMode\(\);/.test(coreSrc), 'init 须按 isAiWinMode 分流 bootAiWinMode');
  // HTML：按钮位于 ai-head 内、tab 后、沙箱前（不在日志tab内）
  assert.ok(htmlSrc.includes('id="btnAiWinToggle"'), 'HTML 缺 #btnAiWinToggle');
  assert.ok(/id="btnAiWinToggle"[^>]*>独立窗口</.test(htmlSrc), '#btnAiWinToggle 默认文案须 独立窗口');
  const headAt = htmlSrc.indexOf('ai-head');
  const tabAt = htmlSrc.indexOf('ai-tab-header');
  const bb = htmlSrc.indexOf('id="btnAiWinToggle"');
  const sbxAt = htmlSrc.indexOf('id="aiSbx"');
  assert.ok(headAt >= 0 && tabAt > headAt && bb > tabAt && sbxAt > bb, '按钮须在 ai-head内tab后沙箱前（head<tab<btn<sbx），实际 head=' + headAt + ' tab=' + tabAt + ' btn=' + bb + ' sbx=' + sbxAt);
  const ctx = htmlSrc.slice(Math.max(0, bb - 600), bb + 600);
  assert.ok(/ai-tab-header/.test(ctx) && /id="aiSbx"/.test(ctx), '按钮上下文须同时含 tab头与沙箱');
  assert.ok(!/ai-logs-toolbar/.test(ctx), '按钮上下文不得含 ai-logs-toolbar（不在日志tab内）');
  assert.ok(htmlSrc.indexOf('ai-logs-toolbar') < 0 || bb < htmlSrc.indexOf('ai-logs-toolbar') || bb > htmlSrc.indexOf('logs-autoscroll'), '按钮不得位于日志栏吸底前（已迁至ai-head）');
  // CSS：独立窗口仅留AI弹窗全屏 + 头部按钮定位
  assert.ok(/body\.aiwin-mode \.app\{\s*display:none/.test(cssSrc), 'aiwin-mode 须隐藏主 app');
  assert.ok(/body\.aiwin-mode \.ai-modal\{[^}]*width:100vw[^}]*height:100vh[^}]*border-radius:0/.test(cssSrc), 'aiwin 对话框须全屏无圆角');
  assert.ok(/\.ai-head #btnAiWinToggle\{/.test(cssSrc), 'css 须有 .ai-head #btnAiWinToggle 定位规则');
}

// ── C4 aiwin关窗通知 + mirror复用kind ai-mode + 主窗联带 ──
function testC4_AiwinCloseNotify() {
  assert.ok(mainSrc.includes('function createAiWindow('), '须有 createAiWindow');
  const ci = mainSrc.indexOf('function createAiWindow(');
  assert.ok(ci >= 0, '须能定位 createAiWindow');
  const cbody = mainSrc.slice(ci, ci + 1800);
  assert.ok(/aiWin\.on\('closed'/.test(cbody), '须监听 aiWin closed');
  assert.ok(/aiWin\s*=\s*null/.test(cbody), 'closed 须置空 aiWin');
  assert.ok(/mainWin.*\.webContents\.send\('doc:mirror',\s*\{\s*kind:\s*'ai-mode',\s*mode:\s*'ai-panel'\s*\}\)/.test(cbody), 'closed 须经 mirror kind=ai-mode 通知主窗 ai-panel');
  const wi = mainSrc.indexOf('function createWindow()');
  const wbody = mainSrc.slice(wi, wi + 2200);
  const closeAt = wbody.indexOf("win.on('close'");
  assert.ok(closeAt >= 0, '须监听主窗 close');
  const closeBody = wbody.slice(closeAt, closeAt + 500);
  assert.ok(/docWin.*\.close\(\)/.test(closeBody), '主窗 close 须联带 docWin.close');
  assert.ok(/aiWin.*\.close\(\)/.test(closeBody), '主窗 close 须联带 aiWin.close');
  assert.ok(coreSrc.includes('function handleDocMirror('), '缺 handleDocMirror');
  const hbody = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(hbody.includes("kind==='ai-mode'"), 'handleDocMirror 须有 ai-mode 分支（复用 mirror 通道）');
  const aiBranch = hbody.slice(hbody.indexOf("kind==='ai-mode'"), hbody.indexOf("kind==='ai-mode'") + 300);
  assert.ok(/syncAiWinBtn/.test(aiBranch), 'ai-mode 分支须调 syncAiWinBtn');
  assert.ok(!/applyDocWinPanelMode/.test(aiBranch), 'ai-mode 分支须不碰文档面板（与 docwin 不冲突）');
  assert.ok(/\['aiwin','onMirror'\]/.test(coreSrc), 'mirror 监听候选须含 aiwin.onMirror');
}

// ── D1 纯色红线：无linear-gradient新增、无emoji新增 ──
function testD1_NoGradientNoEmoji() {
  for (const [name, src] of [['app.css', cssSrc], ['html', htmlSrc], ['core-docs', coreSrc], ['main', mainSrc], ['preload', preloadSrc]]) {
    assert.ok(!/linear-gradient/.test(src), name + ' 不得新增 linear-gradient');
  }
  assert.ok(/纯色/.test(cssSrc), 'css 优化块须注明纯色');
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
  for (const [name, src] of [['html', htmlSrc], ['css', cssSrc], ['core-docs', coreSrc], ['main', mainSrc], ['preload', preloadSrc]]) {
    const m = (src.match(emojiRe) || []).filter(ch => !'✕✎▾«＋'.includes(ch));
    assert.strictEqual(m.length, 0, name + ' 不得新增 emoji，实际:' + m.join(''));
  }
}

// ── S3 aiwin真执行：判别+按钮文案+boot挂类 ──
function testS3_AiwinRuntime() {
  const isBody = extractFn(coreSrc, 'isAiWinMode');
  function runIs(search) {
    const sb = { location: { search: search }, URLSearchParams: URLSearchParams };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext("var AIWIN_QUERY_KEY='aiwin';\n" + isBody + "\nthis.__ret=isAiWinMode();", sb);
    return sb.__ret;
  }
  assert.strictEqual(runIs('?aiwin=1'), true, '?aiwin=1 须 true');
  assert.strictEqual(runIs('?aiwin=1&project=x'), true, '带参 aiwin=1 须 true');
  assert.strictEqual(runIs(''), false, '空 search 须 false');
  assert.strictEqual(runIs('?docwin=1'), false, 'docwin=1 不得误判 aiwin');
  assert.strictEqual(runIs('?aiwin=0'), false, 'aiwin=0 须 false');
  const syncBody = extractFn(coreSrc, 'syncAiWinBtn');
  function runBtn(search) {
    const btn = { textContent: '', title: '' };
    const sb = {
      document: { getElementById(id) { return id === 'btnAiWinToggle' ? btn : null; } },
      location: { search: search },
      URLSearchParams: URLSearchParams,
      __btn: btn
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext("var AIWIN_QUERY_KEY='aiwin';\n" + isBody + '\n' + syncBody + '\nsyncAiWinBtn();', sb);
    return btn;
  }
  const w = runBtn('?aiwin=1');
  assert.strictEqual(w.textContent, '切换回弹窗', 'AI窗口内文案须 切换回弹窗，实际:' + w.textContent);
  assert.ok(/关闭独立窗口/.test(w.title), 'AI窗口内 title 须含 关闭独立窗口，实际:' + w.title);
  const m = runBtn('');
  assert.strictEqual(m.textContent, '独立窗口', '主窗口内文案须 独立窗口，实际:' + m.textContent);
  assert.ok(/在独立窗口中打开AI对话/.test(m.title), '主窗口内 title 须含 在独立窗口中打开AI对话，实际:' + m.title);
  const bootBody = extractFn(coreSrc, 'bootAiWinMode');
  const bodyEl = { classList: mkClassList([]) };
  const mask = { style: {} };
  const sb = {
    document: { title: '', body: bodyEl, getElementById(id) { return id === 'aiMask' ? mask : null; }, querySelector() { return null; } },
    location: { search: '?aiwin=1' },
    URLSearchParams: URLSearchParams,
    ensureAiWinUI: function () {}, syncAiWinBtn: function () {},
    setTimeout: function () { return 0; }
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(bootBody + "\nbootAiWinMode();\nthis.__cls=document.body.classList.contains('aiwin-mode');\nthis.__title=document.title;", sb);
  assert.strictEqual(sb.__cls, true, 'bootAiWinMode 须挂 aiwin-mode 类');
  assert.ok(/AI对话/.test(sb.__title), 'bootAiWinMode 须设 AI对话 标题，实际:' + sb.__title);
}

// ── C5 aiwin内隐藏#aiClose + EventBus禁关（Wave-D/G：window.closeAi monkey-patch已删） ──
function testC5_AiCloseGuard() {
  assert.ok(htmlSrc.includes('id="aiClose"'), 'HTML 须保留 #aiClose（以便CSS/JS隐藏，非删除）');
  assert.ok(/body\.aiwin-mode #aiClose\{\s*display:none/.test(cssSrc), 'CSS 须 body.aiwin-mode #aiClose{display:none}');
  assert.ok(coreSrc.includes('function applyAiWinCloseGuard('), '缺 applyAiWinCloseGuard');
  const body = extractFn(coreSrc, 'applyAiWinCloseGuard');
  assert.ok(/getElementById\('aiClose'\)/.test(body), '须取 #aiClose');
  assert.ok(/style\.display='none'/.test(body), '须 display=none 隐藏');
  assert.ok(/setAttribute\('aria-hidden','true'\)/.test(body), '须 aria-hidden=true');
  assert.ok(/\.onclick=function/.test(body), '须吞掉 onclick 防误关');
  assert.ok(/isAiWinMode\(\)/.test(body), '须按 isAiWinMode 分流');
  assert.ok(/__aiWinCloseGuard/.test(body), '须置 __aiWinCloseGuard 标志（AiDomain.requestClose 统一消费）');
  assert.ok(/EventBus/.test(body) && /ai:request-close/.test(body), '须订阅 EventBus ai:request-close（替代裸挂）');
  assert.ok(!/window\.closeAi\s*=\s*[^=\s]/.test(coreSrc), 'core-docs 不得再有 window.closeAi= monkey-patch赋值（Wave-D/G已删，===比较除外）');
  assert.ok(!/_aiWinGuarded/.test(body) && !/_aiWinOrig/.test(body), 'applyAiWinCloseGuard 不得再含 _aiWinGuarded/_aiWinOrig 裸挂');
  assert.ok(coreSrc.includes('window.applyAiWinCloseGuard=applyAiWinCloseGuard'), '须 window.applyAiWinCloseGuard 暴露');
  const boot = extractFn(coreSrc, 'bootAiWinMode');
  assert.ok(/applyAiWinCloseGuard\(\)/.test(boot), 'bootAiWinMode 须调 applyAiWinCloseGuard');
  // AiDomain EventBus 断言：requestClose 经 ai:request-close/ai:closed，无 window.closeAi 裸挂
  assert.ok(aiDomainSrc.includes('requestClose'), 'ai-domain 缺 requestClose');
  assert.ok(/ai:request-close/.test(aiDomainSrc), 'ai-domain 须 emit ai:request-close');
  assert.ok(/ai:closed/.test(aiDomainSrc), 'ai-domain 须 emit ai:closed');
  assert.ok(!/window\.closeAi\s*=\s*[^=\s]/.test(aiDomainSrc), 'ai-domain 不得写 window.closeAi 裸挂赋值（===比较除外）');
  assert.ok(/__aiWinCloseGuard/.test(aiDomainSrc), 'ai-domain 须消费 __aiWinCloseGuard（独立窗禁关）');
  // 真执行：aiwin内外均隐藏 + __aiWinCloseGuard 分流；window.closeAi 保持原函数不被改写
  function runGuard(isAi) {
    const el = { style: {}, attrs: {}, onclick: null, setAttribute(k, v) { this.attrs[k] = v; } };
    let closed = 0;
    const orig = function () { closed++; return 'closed'; };
    const sb = {
      document: { getElementById(id) { return id === 'aiClose' ? el : null; } },
      window: { closeAi: orig, EventBus: { on() {}, emit() {} }, __aiWinGuardSubscribed: false },
      isAiWinMode: function () { return isAi; },
      __el: el
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(body + '\napplyAiWinCloseGuard();\nthis.__disp=__el.style.display;\nthis.__aria=__el.attrs["aria-hidden"];\nthis.__flag=window.__aiWinCloseGuard;', sb);
    vm.runInContext('try{ this.__ret2=window.closeAi(); }catch(e){ this.__ret2="err"; }', sb);
    return { disp: sb.__disp, aria: sb.__aria, flag: sb.__flag, ret2: sb.__ret2, closed: closed, patched: sb.window.closeAi !== orig };
  }
  let r = runGuard(true);
  assert.strictEqual(r.disp, 'none', 'aiwin内须隐藏 #aiClose');
  assert.strictEqual(r.aria, 'true', 'aiwin内须 aria-hidden');
  assert.strictEqual(r.flag, true, 'aiwin内 __aiWinCloseGuard 须 true');
  assert.strictEqual(r.patched, false, '不得再改写 window.closeAi（无裸挂）');
  assert.strictEqual(r.ret2, 'closed', 'window.closeAi 保持原函数可调（禁关改由 AiDomain.requestClose 经 EventBus）');
  assert.strictEqual(r.closed, 1, '原 closeAi 可达一次');
  r = runGuard(false);
  assert.strictEqual(r.disp, 'none', '主窗也须隐藏占位（CSS按模式二次隐藏）');
  assert.strictEqual(r.flag, false, '主窗 __aiWinCloseGuard 须 false');
  assert.strictEqual(r.patched, false, '主窗同样不得改写 window.closeAi');
}

// ── C6 query直进沙箱：getAiWinQueryParams + aiWinBootProject + 禁picker ──
function testC6_QueryBootProject() {
  assert.ok(coreSrc.includes('function getAiWinQueryParams('), '缺 getAiWinQueryParams');
  const qp = extractFn(coreSrc, 'getAiWinQueryParams');
  assert.ok(/new URLSearchParams\(location\.search\)/.test(qp), '须经 URLSearchParams 取 project/proto');
  assert.ok(/sp\.get\('project'\)/.test(qp) && /sp\.get\('proto'\)/.test(qp), '须取 project 与 proto');
  assert.ok(/\[?&\]project=/.test(qp) && /\[?&\]proto=/.test(qp), '须有正则兜底取参');
  assert.ok(/decodeURIComponent/.test(qp), '须 decodeURIComponent 解码（后端 encodeURIComponent 对应）');
  assert.ok(/\.trim\(\)/.test(qp), '须 trim');
  assert.ok(coreSrc.includes('function aiWinGuardProjectPicker('), '缺 aiWinGuardProjectPicker（禁弹窗）');
  const gp = extractFn(coreSrc, 'aiWinGuardProjectPicker');
  assert.ok(/isAiWinMode\(\)/.test(gp) && /if\(!inAi\) return/.test(gp), '非aiwin须直接返回（仅aiwin内生效）');
  assert.ok(/getElementById\('projMask'\)/.test(gp) && /style\.display='none'/.test(gp), '须强制隐藏 projMask');
  assert.ok(/window\.showProjectPicker/.test(gp) && /_aiWinGuarded/.test(gp), '须包装 showProjectPicker（_aiWinGuarded）');
  assert.ok(/qp&&qp\.project/.test(gp) || /qp\.project/.test(gp), '守卫须优先 query project');
  assert.ok(/enterProject\(target\)/.test(gp) || /enterProject\(/.test(gp), '守卫须自动 enterProject（禁弹窗死等）');
  assert.ok(/orig\.apply\(this,arguments\)/.test(gp), '非aiwin须回落 orig');
  assert.ok(coreSrc.includes('function aiWinBootProject('), '缺 aiWinBootProject');
  const bp = extractFn(coreSrc, 'aiWinBootProject');
  assert.ok(/aiWinGuardProjectPicker\(\)/.test(bp), 'bootProject 须先禁 picker');
  assert.ok(/getElementById\('projMask'\)/.test(bp), 'bootProject 须隐藏 projMask');
  assert.ok(/getAiWinQueryParams\(\)/.test(bp), 'bootProject 须读 query');
  assert.ok(/enterProject\(qproj\)/.test(bp), '有 query project 须 enterProject(qproj) 直进');
  assert.ok(/loadSandboxSources\(/.test(bp), '须 loadSandboxSources 拉沙箱');
  assert.ok(/aiWinSelectProto\(qproto\)/.test(bp) || /aiWinSelectProto\(/.test(bp), '须 aiWinSelectProto 直进 proto');
  assert.ok(/aiWinSyncTitleSbx\(\)/.test(bp), '须同步标题/沙箱');
  assert.ok(/protoLastProject/.test(bp), '缺参须回退 localStorage protoLastProject');
  assert.ok(/bootProjectFlow\(\)/.test(bp), '全缺参须回退 bootProjectFlow');
  assert.ok(/,600\)/.test(bp) && /,1500\)/.test(bp), '须 600/1500ms 延迟兜底选沙箱');
  const boot = extractFn(coreSrc, 'bootAiWinMode');
  assert.ok(/aiWinBootProject\(\)/.test(boot), 'bootAiWinMode 须调 aiWinBootProject');
  // 真执行 getAiWinQueryParams
  function runQp(search) {
    const sb = { location: { search: search }, URLSearchParams: URLSearchParams };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(qp + "\nthis.__r=getAiWinQueryParams();", sb);
    return sb.__r;
  }
  let q = runQp('?aiwin=1&project=P1&proto=S1');
  assert.strictEqual(q.project, 'P1', 'query project 须直进，实际:' + JSON.stringify(q));
  assert.strictEqual(q.proto, 'S1', 'query proto 须直进，实际:' + JSON.stringify(q));
  q = runQp('?aiwin=1&project=' + encodeURIComponent('项 目A') + '&proto=' + encodeURIComponent('沙箱 B'));
  assert.strictEqual(q.project, '项 目A', '须解码中文 project，实际:' + q.project);
  q = runQp('?aiwin=1');
  assert.strictEqual(q.project, '', '缺参须回退空串（走last/首源/bootFlow），实际:' + JSON.stringify(q));
  assert.strictEqual(q.proto, '', '缺参 proto 须空串');
}

// ── C7 ai-source镜像联动 + 防环 ──
function testC7_AiSourceMirror() {
  assert.ok(coreSrc.includes('function getAiSourcePayload('), '缺 getAiSourcePayload');
  const pay = extractFn(coreSrc, 'getAiSourcePayload');
  assert.ok(/currentProject/.test(pay), 'payload 须含 project');
  assert.ok(/currentSource/.test(pay) && /displayName/.test(pay), 'payload 须含 source/displayName');
  assert.ok(/sandboxDir/.test(pay), 'payload 须从 sandboxDir 推导 proto');
  assert.ok(coreSrc.includes('function pushAiSource('), '缺 pushAiSource');
  const push = extractFn(coreSrc, 'pushAiSource');
  assert.ok(/if\(__docMirrorApplying\) return/.test(push), 'push 须 __docMirrorApplying 防环');
  assert.ok(/if\(isAiWinMode\(\)\) return/.test(push), 'push 在aiwin内须直接返回（只主窗外发，防环）');
  assert.ok(/mirrorPush\('ai-source'/.test(push), 'push 须 mirrorPush ai-source');
  assert.ok(coreSrc.includes('window.pushAiSource=pushAiSource'), '须 window.pushAiSource 暴露');
  assert.ok(coreSrc.includes('window.getAiSourcePayload=getAiSourcePayload'), '须 window.getAiSourcePayload 暴露');
  assert.ok(coreSrc.includes('function handleDocMirror('), '缺 handleDocMirror');
  const h = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(h.includes("kind==='ai-source'"), '须有 ai-source 分支');
  const ab = h.slice(h.indexOf("kind==='ai-source'"), h.indexOf("kind==='ai-source'") + 6000);
  assert.ok(/isAiWinMode\(\)/.test(ab), 'ai-source 须判 isAiWinMode');
  assert.ok(/if\(!inAi2\)/.test(ab), '非aiwin须直接返回（只aiwin内接收，防环）');
  assert.ok(/__docMirrorApplying=true/.test(ab), 'ai-source 须置 __docMirrorApplying=true 防环');
  assert.ok(/__docMirrorApplying=false/.test(h.slice(h.indexOf("kind==='ai-source'"), h.indexOf("kind==='ai-source'") + 8000)), 'ai-source 须复位 __docMirrorApplying=false');
  assert.ok(/enterProject\(/.test(ab), '须 enterProject 跟随项目');
  assert.ok(/aiWinSelectProto\(/.test(ab), '须 aiWinSelectProto 跟随沙箱');
  assert.ok(/aiWinSyncTitleSbx\(\)/.test(ab), '须同步标题/沙箱');
  assert.ok(/syncAiWinBtn\(\)/.test(ab), '须同步按钮');
  // source 分支亦须感知 aiwin（防覆盖标题/沙箱）
  assert.ok(/inAiS/.test(h) && /aiWinSyncTitleSbx/.test(h), 'source 分支须感知 aiwin 并同步标题/沙箱');
  // 真执行 push 防环：窗内/Applying 时不外发
  const mirrorPushBody = extractFn(coreSrc, 'mirrorPush');
  assert.ok(/if\(__docMirrorApplying\)\s*return/.test(mirrorPushBody), '底层 mirrorPush 亦须防环');
}

// ── C8 aiwin内锁定切换入口 ──
function testC8_LockSwitchers() {
  assert.ok(/body\.aiwin-mode #sbProject, body\.aiwin-mode #sbList, body\.aiwin-mode #btnAddSource, body\.aiwin-mode #btnAddGroup, body\.aiwin-mode #btnSettings, body\.aiwin-mode #sbTrigger, body\.aiwin-mode #btnSbCollapse\{\s*display:none/.test(cssSrc), 'CSS 须隐藏切换入口组（sbProject/sbList/btnAddSource/btnAddGroup/btnSettings/sbTrigger/btnSbCollapse）');
  assert.ok(/body\.aiwin-mode #projMask\{\s*display:none/.test(cssSrc), 'CSS 须隐藏 projMask');
  assert.ok(/body\.aiwin-mode \.ai-head #btnAiWinToggle\{\s*display:inline-flex/.test(cssSrc), 'CSS 须保留头部切换按钮可见');
  assert.ok(coreSrc.includes('function applyAiWinLockSwitchers('), '缺 applyAiWinLockSwitchers');
  const body = extractFn(coreSrc, 'applyAiWinLockSwitchers');
  assert.ok(/isAiWinMode\(\)/.test(body) && /if\(!inAi\) return/.test(body), '非aiwin须直接返回');
  for (const id of ['sbProject', 'sbList', 'btnAddSource', 'btnAddGroup', 'btnSettings', 'sbTrigger', 'btnSbCollapse']) {
    assert.ok(body.includes("'" + id + "'") || body.includes('"' + id + '"'), '须锁定 #' + id);
  }
  assert.ok(/style\.display='none'/.test(body), '须 display=none');
  assert.ok(/setAttribute\('aria-hidden','true'\)/.test(body), '须 aria-hidden');
  assert.ok(/disabled/.test(body), '须 disabled');
  assert.ok(/_aiWinLocked/.test(body), 'sbProject 须 _aiWinLocked 锁定点击');
  assert.ok(/getElementById\('projMask'\)/.test(body), '须隐藏 projMask');
  assert.ok(coreSrc.includes('window.applyAiWinLockSwitchers=applyAiWinLockSwitchers'), '须 window.applyAiWinLockSwitchers 暴露');
  const boot = extractFn(coreSrc, 'bootAiWinMode');
  assert.ok(/applyAiWinLockSwitchers\(\)/.test(boot), 'bootAiWinMode 须调 applyAiWinLockSwitchers');
  for (const id of ['sbProject', 'sbList', 'btnAddSource', 'btnSettings', 'sbTrigger']) {
    assert.ok(htmlSrc.includes('id="' + id + '"'), 'HTML 须存在 #' + id + '（以便锁定隐藏）');
  }
  // 真执行：aiwin内隐藏，主窗内不碰
  function runLock(isAi) {
    const els = {};
    for (const id of ['sbProject', 'sbList', 'btnAddSource', 'btnAddGroup', 'btnSettings', 'sbTrigger', 'btnSbCollapse', 'projMask']) {
      els[id] = { style: {}, attrs: {}, disabled: false, onclick: null, setAttribute(k, v) { this.attrs[k] = v; } };
    }
    const sb = {
      document: { getElementById(id) { return els[id] || null; } },
      isAiWinMode: function () { return isAi; },
      __els: els
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(body + '\napplyAiWinLockSwitchers();', sb);
    return els;
  }
  let els = runLock(true);
  assert.strictEqual(els.sbProject.style.display, 'none', 'aiwin内须隐藏 sbProject');
  assert.strictEqual(els.btnSettings.style.display, 'none', 'aiwin内须隐藏 btnSettings');
  assert.strictEqual(els.projMask.style.display, 'none', 'aiwin内须隐藏 projMask');
  els = runLock(false);
  assert.strictEqual(els.sbProject.style.display, undefined, '主窗不得隐藏 sbProject，实际:' + els.sbProject.style.display);
}

// ── E1 docwin前端open带参：toggle组装{project,proto}透传 ──
function testE1_DocwinOpenArgFrontend() {
  assert.ok(coreSrc.includes('function toggleDocWin('), '缺 toggleDocWin');
  const tog = extractFn(coreSrc, 'toggleDocWin');
  assert.ok(/__docWinOpenArg/.test(tog), 'toggle 须经 __docWinOpenArg 组装参');
  assert.ok(/arg\.project/.test(tog) && /arg\.proto/.test(tog), 'openArg 须含 project/proto');
  assert.ok(/replace\(.*html/.test(tog), 'proto 须去 .html/.md 后缀');
  assert.ok(/toggle\(_oa\)/.test(tog), '主窗须 toggle(_oa) 透传');
  assert.ok(/open\(arg\)/.test(tog), 'fallback 须 open(arg) 透传');
  assert.ok(/docWinMarkReopen/.test(tog), '文档窗内切回须先记 reopen');
  assert.ok(/currentProject/.test(tog) && /currentSource/.test(tog), '须从 currentProject/currentSource 取参');
}

// ── E2 切回显式开/X关仅同步（B5新语义） ──
function testE2_ExplicitReopenOnlySync() {
  assert.ok(coreSrc.includes('function setDocWinOpen('), '缺 setDocWinOpen');
  assert.ok(/var __docWinOpen=false/.test(coreSrc), '须有 __docWinOpen 跟踪');
  assert.ok(coreSrc.includes('function docWinMarkReopen('), '缺 docWinMarkReopen');
  const mark = extractFn(coreSrc, 'docWinMarkReopen');
  assert.ok(/docMirrorBCSend\('mode'/.test(mark), 'mark 须经 BC 发送 mode');
  assert.ok(/localStorage\.setItem\('docWinReopen','1'\)/.test(mark), 'mark 须写 localStorage docWinReopen');
  assert.ok(/mirrorBack\('mode'/.test(mark), 'mark 须 mirrorBack mode+reopen');
  assert.ok(coreSrc.includes('function openDocsForSwitchBack('), '缺 openDocsForSwitchBack');
  const back = extractFn(coreSrc, 'openDocsForSwitchBack');
  assert.ok(/setDocsOpen/.test(back), '显式切回须 setDocsOpen(true) 开文档');
  assert.ok(/syncDocWinBtn/.test(back), '显式切回须同步按钮文案');
  assert.ok(coreSrc.includes('function __docWinHandleToggleResult('), '缺 __docWinHandleToggleResult');
  const tr = extractFn(coreSrc, '__docWinHandleToggleResult');
  assert.ok(/setDocWinOpen\(true\)/.test(tr) && /setDocWinOpen\(false\)/.test(tr), 'toggle结果须同步 __docWinOpen');
  assert.ok(/if\(!inW&&\(m==='panel'\|\|m==='win'\)\)/.test(tr), '仅主窗toggle才显式 apply');
  assert.ok(/applyDocWinPanelMode\(m\)/.test(tr), 'toggle内须显式 applyDocWinPanelMode(m)');
  const h = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(/B5 反转旧panel即开/.test(h), 'mode分支须注明 B5 反转旧panel即开');
  assert.ok(/setDocWinOpen\(true\)/.test(h) && /setDocWinOpen\(false\)/.test(h), 'mode事件须同步 __docWinOpen');
  assert.ok(/docWinReopen/.test(h), '须读 reopen 标记（payload/localStorage）');
  assert.ok(/if\(!inW2&&dwMode==='panel'\)/.test(h), '仅 reopen 且 panel 才显式开（X关不自动开）');
  assert.ok(/applyDocWinPanelMode\(dwMode\)/.test(h), 'reopen 路径须调 applyDocWinPanelMode');
  assert.ok(/syncDocWinBtn/.test(h) && /syncDocModeTabs/.test(h), 'mode事件须同步文案/Tab（X关仅同步）');
}

// ── E3 API卡片隐敏：URL/模型/Key三字段不渲染（B1） ──
function testE3_ApiCardHide() {
  assert.ok(exportSrc.includes('function renderApiProfileMatrix('), '缺 renderApiProfileMatrix');
  const rap = extractFn(exportSrc, 'renderApiProfileMatrix');
  assert.ok(/B1 隐敏/.test(rap), '须注明 B1 隐敏');
  assert.ok(/api-profile-name/.test(rap) && (/api-profile-badge/.test(rap) || /api-use-flag/.test(rap)), '卡片须显名称+使用态');
  assert.ok(/data-id/.test(rap), '卡片须保留 data-id 标识');
  assert.ok(!/baseUrl/.test(rap), '卡片不得渲染 baseUrl，实际含残留');
  assert.ok(!/apiKey/.test(rap), '卡片不得渲染 apiKey，实际含残留');
  const cardSlice = rap.slice(rap.indexOf('var card'), rap.indexOf('var card') + 2500);
  assert.ok(!/\.model/.test(cardSlice) && !/setApiModel/.test(cardSlice), '卡片不得渲染模型字段');
  assert.ok(/\.api-profile-matrix \.api-profile-sub\{\s*display:none/.test(cssSrc), 'CSS 须兜底隐藏残留三字段');
}

// ── E4 行号属性存在：tr/外层wrap/标题/段落承载 ──
function testE4_LineNumberAttrs() {
  assert.ok(/data-md-line/.test(coreSrc), '须有 data-md-line 行号属性');
  assert.ok(/data-md-start/.test(coreSrc) && /data-md-end/.test(coreSrc), '须有 data-md-start/end 区间');
  assert.ok(/data-md-lines/.test(coreSrc), '须有 data-md-lines 列表行组');
  assert.ok(/<tr data-md-line/.test(coreSrc), '表格须经 tr 承载行号');
  assert.ok(/行号经tr与外层wrap承载/.test(coreSrc), '须注明行号经tr承载');
  assert.ok(/class="md-h"/.test(coreSrc) && /data-md-line/.test(coreSrc), '标题须经外层包裹承载行号');
  assert.ok(/paraAttr/.test(coreSrc), '段落须经 paraAttr 承载区间');
}

// ── E5 微改段落/格级：自然段落区间+单格只换内容 ──
function testE5_MicroParaCell() {
  assert.ok(coreSrc.includes('function mdParaRangeOf('), '缺 mdParaRangeOf（自然段落区间）');
  assert.ok(coreSrc.includes('function mdReplaceTableCellForMicro('), '缺 mdReplaceTableCellForMicro（单格）');
  assert.ok(/行号细粒度微改/.test(coreSrc), '须注明行号细粒度微改');
  assert.ok(coreSrc.includes('function saveDocMicroPop('), '缺 saveDocMicroPop');
  const sv = extractFn(coreSrc, 'saveDocMicroPop');
  assert.ok(/isCell/.test(sv), '微存须分 isCell/段落双路');
  assert.ok(/已保存该单元格/.test(sv), '格级须 toast 已保存该单元格');
  assert.ok(/已保存该段落/.test(sv), '段落须 toast 已保存该段落');
  assert.ok(/mdReplaceTableCellForMicro/.test(sv), '格级须只换格内容（竖线不动）');
  assert.ok(coreSrc.includes('function bindDocMicro('), '缺 bindDocMicro');
  const bd = extractFn(coreSrc, 'bindDocMicro');
  assert.ok(/closest\('td,th'\)/.test(bd), '须点哪格改哪格');
  assert.ok(/closest\('p'\)/.test(bd), '须自然段落定位 p');
  assert.ok(/只换格内容/.test(coreSrc), '须注明只换格内容');
}

// ── E6 文档窗query直进禁picker闪（B6） ──
function testE6_DocWinQueryNoPicker() {
  assert.ok(coreSrc.includes('function getDocWinQueryParams('), '缺 getDocWinQueryParams');
  const qp = extractFn(coreSrc, 'getDocWinQueryParams');
  assert.ok(/sp\.get\('project'\)/.test(qp) && /sp\.get\('proto'\)/.test(qp), '须取 project 与 proto');
  assert.ok(/decodeURIComponent/.test(qp), '须 decode 解码');
  assert.ok(coreSrc.includes('function docWinGuardProjectPicker('), '缺 docWinGuardProjectPicker（禁弹窗）');
  const gp = extractFn(coreSrc, 'docWinGuardProjectPicker');
  assert.ok(/isDocWinMode/.test(gp), '须按 isDocWinMode 分流');
  assert.ok(/getElementById\('projMask'\)/.test(gp) && /style\.display='none'/.test(gp), '须强制隐藏 projMask（禁闪）');
  assert.ok(/showProjectPicker/.test(gp) && /_docWinGuarded/.test(gp), '须包装 showProjectPicker');
  assert.ok(coreSrc.includes('function docWinBootProject('), '缺 docWinBootProject');
  const bp = extractFn(coreSrc, 'docWinBootProject');
  assert.ok(/docWinGuardProjectPicker\(\)/.test(bp), 'boot 须先禁 picker');
  assert.ok(/enterProject\(qproj\)/.test(bp), '有 query 须 enterProject(qproj) 直进');
  assert.ok(/loadSandboxSources\(/.test(bp), '须拉沙箱');
  assert.ok(/docWinSelectProto\(/.test(bp), '须直进 proto');
  assert.ok(/,600\)/.test(bp) && /,1500\)/.test(bp), '须 600/1500ms 兜底');
  assert.ok(/protoLastProject/.test(bp), '缺参须回退 protoLastProject');
  const boot = extractFn(coreSrc, 'bootDocWinMode');
  assert.ok(/docWinGuardProjectPicker\(\)/.test(boot) && /docWinBootProject\(\)/.test(boot), 'boot 须禁picker+直进');
  assert.ok(/body\.docwin-mode #projMask\{\s*display:none/.test(cssSrc), 'CSS 须全程隐藏 projMask');
  // 真执行 getDocWinQueryParams
  function runQp(search) {
    const sb = { location: { search: search }, URLSearchParams: URLSearchParams };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(qp + "\nthis.__r=getDocWinQueryParams();", sb);
    return sb.__r;
  }
  let q = runQp('?docwin=1&project=P1&proto=S1');
  assert.strictEqual(q.project, 'P1', 'query project 须直进');
  assert.strictEqual(q.proto, 'S1', 'query proto 须直进');
  q = runQp('?docwin=1');
  assert.strictEqual(q.project, '', '缺参须空串回退');
}

// ── E7 AI窗开后关弹窗+AI设计focus独立窗（B2） ──
function testE7_AiFocusClose() {
  const aiTog = extractFn(coreSrc, '__aiWinHandleToggleResult');
  assert.ok(/B2 打开独立窗后关闭应用内弹窗/.test(aiTog), '须注明 B2 关弹窗');
  assert.ok(/isAiWinMode/.test(aiTog), '须判 isAiWinMode（仅主窗关）');
  assert.ok(/closeAi/.test(aiTog), '开窗后须关应用内弹窗');
  assert.ok(exportSrc.includes('function openAiDesign('), '缺 openAiDesign');
  const od = extractFn(exportSrc, 'openAiDesign');
  assert.ok(/B2 独立窗已开则直接focus/.test(od), '须注明 focus 独立窗');
  assert.ok(/window\.__aiWinOpen/.test(od), '须读 __aiWinOpen 判定');
  assert.ok(/protoAPI\.aiwin\.open/.test(od), '已开须调 aiwin.open focus');
  assert.ok(/closeAi/.test(od), 'focus 后须关应用内弹窗残留');
}

// ── F1 高度链100vh+独立滚动（iter25：stage-frame/docs-panel/docs-body+doc-toc） ──
function testF1_HeightChain() {
  assert.ok(/docwin高度链修复/.test(cssSrc), 'css须注明docwin高度链修复');
  assert.ok(/body\.docwin-mode \.app\{[^}]*height:100vh[^}]*overflow:hidden/.test(cssSrc), 'app须height:100vh+overflow:hidden成链');
  assert.ok(/body\.docwin-mode \.app-body\{[^}]*height:100vh[^}]*overflow:hidden/.test(cssSrc), 'app-body须height:100vh+overflow:hidden成链');
  assert.ok(/body\.docwin-mode \.stage-frame\{[^}]*height:100vh[^}]*overflow:hidden/.test(cssSrc), 'stage-frame须height:100vh+overflow:hidden成链');
  assert.ok(/body\.docwin-mode \.stage-frame\{[^}]*min-height:0/.test(cssSrc), 'stage-frame须min-height:0防挤压');
  const panels = cssSrc.match(/body\.docwin-mode \.docs-panel\{[^}]*\}/g) || [];
  assert.ok(panels.length, 'css缺docwin .docs-panel规则');
  const panelStr = panels.find(s => /height:100%/.test(s) && /flex-direction:row/.test(s));
  assert.ok(panelStr, 'css缺高度链docs-panel规则(height:100%+row，目录入面板后左右排)，实际仅:' + panels.map(s => s.slice(0, 80)).join(' | '));
  assert.ok(/height:100%/.test(panelStr), 'docs-panel须height:100%承接100vh链，实际:' + panelStr.slice(0, 200));
  assert.ok(/display:flex/.test(panelStr), 'docs-panel须display:flex横向成链');
  assert.ok(/flex-direction:row/.test(panelStr), 'docs-panel须flex-direction:row（目录左列+文档右列）');
  assert.ok(/overflow:hidden/.test(panelStr), 'docs-panel须overflow:hidden（仅内容区滚动）');
  assert.ok(/min-height:0/.test(panelStr), 'docs-panel须min-height:0');
  const bds = cssSrc.match(/body\.docwin-mode \.docs-body\{[^}]*\}/g) || [];
  assert.ok(bds.length, 'css缺docwin .docs-body规则');
  const bdStr = bds.find(s => /overflow-y:auto/.test(s)) || bds[0];
  assert.ok(/flex:1 1 auto/.test(bdStr), 'docs-body须flex:1 1 auto自适应剩余高度');
  assert.ok(/min-height:0/.test(bdStr), 'docs-body须min-height:0');
  assert.ok(/overflow-y:auto/.test(bdStr), 'docs-body须独立overflow-y:auto');
  const tocAll = cssSrc.match(/body\.docwin-mode \.doc-toc\{[^}]*\}/g) || [];
  assert.ok(tocAll.length, 'css缺docwin .doc-toc规则');
  const toc = tocAll.join('\n');
  assert.ok(/width:220px/.test(toc), 'doc-toc须锁定220px');
  assert.ok(/height:100%/.test(toc), 'doc-toc须height:100%承接高度链');
  assert.ok(/min-height:0/.test(toc), 'doc-toc须min-height:0');
  assert.ok(/max-height:100%/.test(toc), 'doc-toc须max-height:100%');
  assert.ok(/overflow-y:auto/.test(toc), 'doc-toc须独立overflow-y:auto（与docs-body互不干扰）');
  assert.ok(/body\.docwin-mode \.docs-head\{[^}]*flex:none/.test(cssSrc), 'docs-head须flex:none不被压缩');
  assert.ok(/\.docs-main\s*\{[^}]*flex\s*:\s*1 1 auto/.test(cssSrc), 'docs-main须flex:1 1 auto吃掉剩余（目录列固定后）');
  assert.ok(/body\.docwin-mode \.doc-mode-tabs\{[^}]*flex:none/.test(cssSrc), 'doc-mode-tabs须flex:none不被压缩');
}

// ── F2 ai-draft草稿镜像双向同步+重试 ──
function testF2_AiDraftSync() {
  assert.ok(coreSrc.includes('function isAiTaskRunning('), '缺isAiTaskRunning守卫');
  for (const fn of ['getAiDraftText', 'applyAiDraftText', 'setAiDraftWithRetry', 'sendAiDraftViaMirror', 'pushAiDraftWithRetry', 'restoreAiBusyInMain']) {
    assert.ok(coreSrc.includes('function ' + fn + '('), '缺' + fn);
  }
  const get = extractFn(coreSrc, 'getAiDraftText');
  assert.ok(/getElementById\('aiInput'\)/.test(get), 'get须读#aiInput');
  assert.ok(/\.value/.test(get), 'get须读value');
  const apply = extractFn(coreSrc, 'applyAiDraftText');
  assert.ok(/getElementById\('aiInput'\)/.test(apply), 'apply须写#aiInput');
  assert.ok(/el\.value=String/.test(apply), 'apply须el.value=String赋值');
  assert.ok(/return true/.test(apply) && /return false/.test(apply), 'apply须true/false双路可观测');
  const setR = extractFn(coreSrc, 'setAiDraftWithRetry');
  assert.ok(/applyAiDraftText/.test(setR), 'setRetry须调applyAiDraftText');
  assert.ok(/setInterval/.test(setR), 'setRetry须setInterval重试');
  assert.ok(/,500\)/.test(setR), 'setRetry须500ms间隔');
  assert.ok(/attempts>=3/.test(setR), 'setRetry须3次上限');
  assert.ok(/clearInterval/.test(setR), 'setRetry须clearInterval收尾');
  const send = extractFn(coreSrc, 'sendAiDraftViaMirror');
  assert.ok(/payload=\{text:t\}/.test(send) || /payload=\{text/.test(send), 'send须组payload{text}');
  assert.ok(/docMirrorBCSend\('ai-draft'/.test(send), 'send须经BC发送ai-draft');
  assert.ok(/mirrorPush\('ai-draft'/.test(send), 'send须mirrorPush ai-draft');
  assert.ok(/mirrorBack\('ai-draft'/.test(send), 'send须mirrorBack ai-draft（双向）');
  assert.ok(/protoAPI\.doc/.test(send) && /protoAPI\.aiwin/.test(send) && /protoAPI\.docwin/.test(send), 'send须兼容doc/aiwin/docwin三通道透传');
  assert.ok(/catch\(e\)\{\}/.test(send), 'send各路须try/catch空捕获（失败不抛错）');
  const pushR = extractFn(coreSrc, 'pushAiDraftWithRetry');
  assert.ok(/sendAiDraftViaMirror/.test(pushR), 'pushRetry须调sendAiDraftViaMirror');
  assert.ok(/setInterval/.test(pushR), 'pushRetry须setInterval补发');
  assert.ok(/,500\)/.test(pushR), 'pushRetry须500ms间隔');
  assert.ok(/n>=3/.test(pushR), 'pushRetry须3次上限');
  assert.ok(/clearInterval/.test(pushR), 'pushRetry须clearInterval收尾');
  const h = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(h.includes("kind==='ai-draft'"), 'handle须有ai-draft分支');
  const aiBr = h.slice(h.indexOf("kind==='ai-draft'"), h.indexOf("kind==='ai-draft'") + 800);
  assert.ok(/setAiDraftWithRetry/.test(aiBr), 'ai-draft分支须调setAiDraftWithRetry收草稿');
  const tog = extractFn(coreSrc, 'toggleAiWin');
  assert.ok(/getAiDraftText/.test(tog), 'toggle须先getAiDraftText缓存草稿');
  assert.ok(/__fromAiWin/.test(tog), 'toggle须判__fromAiWin分流双向');
  assert.ok(/sendAiDraftViaMirror/.test(tog) && /pushAiDraftWithRetry/.test(tog), 'toggle须按归属send/push双路发送');
  for (const w of ['window.isAiTaskRunning=isAiTaskRunning', 'window.getAiDraftText=getAiDraftText', 'window.applyAiDraftText=applyAiDraftText', 'window.setAiDraftWithRetry=setAiDraftWithRetry', 'window.sendAiDraftViaMirror=sendAiDraftViaMirror', 'window.pushAiDraftWithRetry=pushAiDraftWithRetry', 'window.restoreAiBusyInMain=restoreAiBusyInMain']) {
    assert.ok(coreSrc.includes(w), '须' + w + '暴露');
  }
}

// ── F3 双向toggle忙时拒绝（前后端） ──
function testF3_BusyToggleReject() {
  const guard = extractFn(coreSrc, 'isAiTaskRunning');
  assert.ok(/aiBusy/.test(guard), '守卫须查aiBusy');
  assert.ok(/window\.aiBusy/.test(guard), '守卫须查window.aiBusy');
  assert.ok(/getElementById\('aiSend'\)/.test(guard), '守卫须查#aiSend');
  assert.ok(/stopping/.test(guard), '守卫须判stopping态');
  const togD = extractFn(coreSrc, 'toggleDocWin');
  assert.ok(/isAiTaskRunning\(\)/.test(togD), 'doc toggle须先判isAiTaskRunning');
  assert.ok(/docWinToast/.test(togD), 'doc toggle忙时须docWinToast提示');
  const togA = extractFn(coreSrc, 'toggleAiWin');
  assert.ok(/isAiTaskRunning\(\)/.test(togA), 'ai toggle须先判isAiTaskRunning');
  assert.ok(/aiWinToast/.test(togA), 'ai toggle忙时须aiWinToast提示');
  const trD = extractFn(coreSrc, '__docWinHandleToggleResult');
  assert.ok(/String\(r\.error\|\|''\)==='busy'/.test(trD), 'doc结果须判r.error===busy（后端拒绝）');
  assert.ok(/docWinToast/.test(trD), 'doc后端busy须docWinToast');
  assert.ok(/showToast/.test(trD), 'doc后端busy须showToast');
  const trA = extractFn(coreSrc, '__aiWinHandleToggleResult');
  assert.ok(/String\(r\.error\|\|''\)==='busy'/.test(trA), 'ai结果须判r.error===busy（后端拒绝）');
  assert.ok(/aiWinToast/.test(trA), 'ai后端busy须aiWinToast');
  assert.ok(/showToast/.test(trA), 'ai后端busy须showToast');
  assert.ok(/任务进行中拒绝切换/.test(mainSrc), '后端须注明任务进行中拒绝切换');
  for (const ch of ["ipcMain.handle('docwin:toggle'", "ipcMain.handle('aiwin:toggle'"]) {
    assert.ok(mainSrc.includes(ch), 'main缺' + ch);
  }
  const dTog = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('docwin:toggle'"), mainSrc.indexOf("ipcMain.handle('docwin:toggle'") + 800);
  assert.ok(/if\s*\((shared\.)?activeExecution\)/.test(dTog) && /error:\s*'busy'/.test(dTog), 'docwin:toggle忙时须返回{ok:false,error:busy}（Wave-B: shared守卫）');
  const aTog = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('aiwin:toggle'"), mainSrc.indexOf("ipcMain.handle('aiwin:toggle'") + 800);
  assert.ok(/if\s*\((shared\.)?activeExecution\)/.test(aTog) && /error:\s*'busy'/.test(aTog), 'aiwin:toggle忙时须返回{ok:false,error:busy}（Wave-B: shared守卫）');
  const askI = mainSrc.indexOf("ipcMain.handle('ai:ask'");
  assert.ok(askI >= 0, '须有ai:ask通道');
  const askBody = mainSrc.slice(askI, askI + 400);
  assert.ok(/aiAskImpl/.test(askBody) || /if\s*\((shared\.)?activeExecution\)/.test(askBody), 'ai:ask忙时须检查activeExecution（Wave-B: controller委托aiAskImpl）');
  assert.ok(/activeExecution\)[\s\S]{0,200}error:\s*'busy'/.test(mainSrc), 'ai:ask忙时须返回busy（实现见AIProcessService）');
}

// ── F4 X关确认与任务转移（继续跑转主窗/中断后关） ──
function testF4_CloseConfirmTransfer() {
  assert.ok(/关窗任务守卫/.test(mainSrc), '后端须注明关窗任务守卫');
  assert.ok(mainSrc.includes("aiWin.on('close'"), 'aiWin须监听close做关窗确认');
  assert.ok(/aiEventTarget/.test(mainSrc) && /aiTransferToMain/.test(mainSrc) && /aiWinForceClose/.test(mainSrc), '须声明aiEventTarget/aiTransferToMain/aiWinForceClose（Wave-B: shared/state）');
  const ci = mainSrc.indexOf("aiWin.on('close'");
  assert.ok(ci >= 0, '须能定位aiWin close守卫');
  const cbody = mainSrc.slice(ci, ci + 2500);
  assert.ok(/aiWinForceClose/.test(cbody), 'close须判aiWinForceClose防重入');
  assert.ok(/if\s*\((shared\.)?activeExecution\)/.test(cbody), 'close须经activeExecution检查忙时确认（Wave-B: shared）');
  assert.ok(/e\.preventDefault\(\)/.test(cbody), '忙时须preventDefault拦截关窗');
  assert.ok(/dialog\.showMessageBoxSync/.test(cbody), '忙时须dialog.showMessageBoxSync确认');
  assert.ok(/继续跑/.test(cbody) && /中断后关/.test(cbody), '按钮须继续跑/中断后关双选项');
  assert.ok(/AI任务进行中/.test(cbody), '标题须AI任务进行中');
  assert.ok(/choice\s*===\s*1/.test(cbody), '须按choice===1分流两路');
  assert.ok(/activeExecution\.cancel/.test(cbody), '中断后关须调activeExecution.cancel');
  assert.ok(/killProcessTree/.test(cbody), '中断后关须杀进程树');
  assert.ok(/activeExecution\s*=\s*null/.test(cbody), '中断后关须置空activeExecution');
  assert.ok(/aiTransferToMain\s*=\s*true/.test(cbody), '继续跑须aiTransferToMain=true转主窗');
  assert.ok(/kind:\s*'ai-busy-restore'/.test(cbody), '继续跑须向主窗发ai-busy-restore');
  assert.ok(/aiWinForceClose\s*=\s*true/.test(cbody), '两路均须forceClose后关窗');
  assert.ok(/aiEventTarget\s*=\s*ev\.sender/.test(mainSrc), 'ai:ask须记录aiEventTarget归属');
  assert.ok(/if\s*\((shared\.)?aiTransferToMain/.test(mainSrc), '事件分流须判aiTransferToMain转主窗');
  assert.ok(coreSrc.includes('function restoreAiBusyInMain('), '前端缺restoreAiBusyInMain');
  const rb = extractFn(coreSrc, 'restoreAiBusyInMain');
  assert.ok(/openAiForSwitchBack/.test(rb), '恢复须openAiForSwitchBack拉起主窗弹窗');
  assert.ok(/aiSetBusy/.test(rb), '恢复须aiSetBusy(true)置忙');
  assert.ok(/getElementById\('aiSend'\)/.test(rb) && /stopping/.test(rb), '恢复须#aiSend置stopping');
  assert.ok(/getElementById\('aiInput'\)/.test(rb), '恢复须锁定#aiInput');
  assert.ok(/showToast/.test(rb), '恢复须showToast提示已转入主窗');
  const h = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(h.includes("kind==='ai-busy-restore'"), 'handle须有ai-busy-restore分支');
  const rBr = h.slice(h.indexOf("kind==='ai-busy-restore'"), h.indexOf("kind==='ai-busy-restore'") + 300);
  assert.ok(/restoreAiBusyInMain\(\)/.test(rBr), 'ai-busy-restore分支须调restoreAiBusyInMain');
}

// ── S4 草稿读写+忙判真执行 ──
function testS4_DraftBusyRuntime() {
  const applyBody = extractFn(coreSrc, 'applyAiDraftText');
  const getBody = extractFn(coreSrc, 'getAiDraftText');
  const guardBody = extractFn(coreSrc, 'isAiTaskRunning');
  const setBody = extractFn(coreSrc, 'setAiDraftWithRetry');
  const sendBody = extractFn(coreSrc, 'sendAiDraftViaMirror');
  function runApply(hasEl, initVal, text) {
    const el = hasEl ? { value: initVal } : null;
    const sb = { document: { getElementById(id) { return id === 'aiInput' ? el : null; } }, __el: el };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(applyBody + '\nthis.__ret=applyAiDraftText(' + JSON.stringify(text) + ');\nthis.__val=(__el?__el.value:null);', sb);
    return { ret: sb.__ret, val: sb.__val };
  }
  let r = runApply(true, '', 'hello draft');
  assert.strictEqual(r.ret, true, '有#aiInput时apply须true');
  assert.strictEqual(r.val, 'hello draft', 'apply须写入草稿，实际:' + r.val);
  r = runApply(true, 'old', '');
  assert.strictEqual(r.ret, true, '空串亦须true');
  assert.strictEqual(r.val, '', '空串须清空输入框');
  r = runApply(false, '', 'x');
  assert.strictEqual(r.ret, false, '缺#aiInput时apply须false');
  function runGet(v) {
    const el = { value: v };
    const sb = { document: { getElementById(id) { return id === 'aiInput' ? el : null; } } };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(getBody + '\nthis.__r=getAiDraftText();', sb);
    return sb.__r;
  }
  assert.strictEqual(runGet('draft123'), 'draft123', 'get须原样读回草稿');
  assert.strictEqual(runGet(''), '', '空草稿须读回空串');
  function runBusy(o) {
    const sendEl = { classList: mkClassList(o.stopping ? ['stopping'] : []) };
    const sb = { document: { getElementById(id) { return id === 'aiSend' ? sendEl : null; } }, window: { aiBusy: !!o.winBusy } };
    if (o.globalBusy) sb.aiBusy = true;
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(guardBody + '\nthis.__b=isAiTaskRunning();', sb);
    return sb.__b;
  }
  assert.strictEqual(runBusy({}), false, '三路皆空闲须false');
  assert.strictEqual(runBusy({ globalBusy: true }), true, '全局aiBusy=true须判忙');
  assert.strictEqual(runBusy({ winBusy: true }), true, 'window.aiBusy=true须判忙');
  assert.strictEqual(runBusy({ stopping: true }), true, '#aiSend.stopping须判忙');
  function runSet(hasEl) {
    const el = hasEl ? { value: '' } : null;
    let nTimer = 0;
    const sb = {
      document: { getElementById(id) { return id === 'aiInput' ? el : null; } },
      setInterval(fn, ms) { nTimer++; sb.__fn = fn; sb.__ms = ms; return 123; },
      clearInterval(id) {}
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(applyBody + '\n' + setBody + "\nsetAiDraftWithRetry('retry-text');", sb);
    return { nTimer: nTimer, ms: sb.__ms, val: el ? el.value : null };
  }
  let s = runSet(true);
  assert.strictEqual(s.val, 'retry-text', '即时可写须直接写入，实际:' + s.val);
  assert.strictEqual(s.nTimer, 0, '即时成功须不设timer，实际:' + s.nTimer);
  s = runSet(false);
  assert.strictEqual(s.nTimer, 1, '缺框须设timer重试，实际:' + s.nTimer);
  assert.strictEqual(s.ms, 500, '重试间隔须500ms，实际:' + s.ms);
  function runSend() {
    const calls = { bc: [], push: [], back: [] };
    const sb = {
      docMirrorBCSend(k, p) { calls.bc.push([k, p]); },
      mirrorPush(k, p) { calls.push.push([k, p]); },
      mirrorBack(k, p) { calls.back.push([k, p]); },
      window: { protoAPI: {} }
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(sendBody + "\nsendAiDraftViaMirror('hi');\nthis.__done=true;", sb);
    return calls;
  }
  const c = runSend();
  assert.strictEqual(c.bc.length, 1, 'send须经BC发1次，实际:' + c.bc.length);
  assert.strictEqual(c.bc[0][0], 'ai-draft', 'BC kind须ai-draft');
  assert.strictEqual(c.bc[0][1].text, 'hi', 'BC payload.text须原样，实际:' + JSON.stringify(c.bc[0][1]));
  assert.strictEqual(c.push.length, 1, 'send须mirrorPush 1次');
  assert.strictEqual(c.back.length, 1, 'send须mirrorBack 1次（双向）');
}

// ── G1 草稿pull/ack往返与封顶（ACK即停、500ms×20封顶、pull一次） ──
function testG1_DraftPullAckRoundtripCap() {
  assert.ok(coreSrc.includes('function sendAiDraftAck('), '缺sendAiDraftAck');
  assert.ok(coreSrc.includes('function sendAiDraftPull('), '缺sendAiDraftPull');
  assert.ok(coreSrc.includes('function __aiDraftClearRetry('), '缺__aiDraftClearRetry');
  const ack = extractFn(coreSrc, 'sendAiDraftAck');
  assert.ok(/var n=Number\(ts\|\|0\)\|\|0/.test(ack), 'ack须归一化ts');
  assert.ok(/if\(!n\) return/.test(ack), 'ack空ts须直接返回');
  assert.ok(/payload=\{ts:n\}/.test(ack), 'ack payload须{ts}');
  assert.ok(/docMirrorBCSend\('ai-draft-ack'/.test(ack), 'ack须经BC发送');
  assert.ok(/mirrorPush\('ai-draft-ack'/.test(ack), 'ack须mirrorPush');
  assert.ok(/mirrorBack\('ai-draft-ack'/.test(ack), 'ack须mirrorBack');
  const pull = extractFn(coreSrc, 'sendAiDraftPull');
  assert.ok(/payload=\{ts:__aiDraftNowTs\(\)\}/.test(pull), 'pull payload须__aiDraftNowTs');
  assert.ok(/docMirrorBCSend\('ai-draft-pull'/.test(pull), 'pull须经BC发送');
  assert.ok(/mirrorPush\('ai-draft-pull'/.test(pull), 'pull须mirrorPush');
  assert.ok(/mirrorBack\('ai-draft-pull'/.test(pull), 'pull须mirrorBack');
  const h = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(h.includes("kind==='ai-draft-pull'"), 'handle须有ai-draft-pull分支');
  assert.ok(h.includes("kind==='ai-draft-ack'"), 'handle须有ai-draft-ack分支');
  const pullBr = h.slice(h.indexOf("kind==='ai-draft-pull'"), h.indexOf("kind==='ai-draft-pull'") + 2500);
  assert.ok(/getAiDraftText\(\)/.test(pullBr), 'pull分支须读getAiDraftText');
  assert.ok(/__aiDraftPendingText/.test(pullBr), 'pull分支须读pending草稿');
  assert.ok(/readAiDraftMirror\(\)/.test(pullBr), 'pull分支须读LS镜像');
  assert.ok(/Number\(_lm\.ts\|\|0\)>_bestTs/.test(pullBr), 'pull分支须取最大ts（LS>best才覆盖）');
  assert.ok(/sendAiDraftViaMirror\(_bestT/.test(pullBr), 'pull分支须回送最优草稿');
  const ackBr = h.slice(h.indexOf("kind==='ai-draft-ack'"), h.indexOf("kind==='ai-draft-ack'") + 1200);
  assert.ok(/_ats=Number\(\(payload&&payload\.ts/.test(ackBr), 'ack分支须解析payload.ts');
  assert.ok(/if\(_ats>__aiDraftAckedTs\) __aiDraftAckedTs=_ats/.test(ackBr), 'ack分支须前向更新AckedTs');
  assert.ok(/window\.__aiDraftAckedTs=__aiDraftAckedTs/.test(ackBr), 'ack分支须同步window可观测');
  assert.ok(/if\(_ats&&_ats>=__aiDraftRetryTs\)/.test(ackBr), 'ack达stamp须清重试（ACK即停）');
  assert.ok(/__aiDraftClearRetry\(\)/.test(ackBr), 'ack分支须调__aiDraftClearRetry');
  const pushR = extractFn(coreSrc, 'pushAiDraftWithRetry');
  assert.ok(/sendAiDraftViaMirror/.test(pushR), 'pushRetry须首发sendAiDraftViaMirror');
  assert.ok(/__aiDraftClearRetry\(\)/.test(pushR), 'pushRetry首发前须清旧timer');
  assert.ok(/__aiDraftRetryTs=stamp/.test(pushR), 'pushRetry须记RetryTs供ACK比对');
  assert.ok(/var n=0;/.test(pushR), 'pushRetry须计数n=0起');
  assert.ok(/setInterval/.test(pushR), 'pushRetry须setInterval补发');
  assert.ok(/,500\)/.test(pushR), 'pushRetry须500ms间隔');
  assert.ok(/_acked=Number\(__aiDraftAckedTs/.test(pushR), 'pushRetry须读AckedTs判停');
  assert.ok(/if\(_acked>=stamp\)/.test(pushR), 'ACK达stamp须即停（ACK即停）');
  assert.ok(/if\(n>=20\)/.test(pushR), 'pushRetry须20次封顶');
  assert.ok(/__aiDraftRetryTimer=timer/.test(pushR), 'pushRetry须记RetryTimer可观测');
  assert.ok(/n>=20 with ACK stop/.test(pushR), '须注明20次ACK停兼容语义');
  const boot = extractFn(coreSrc, 'bootAiWinMode');
  assert.ok(/restoreAiDraftFromMirror\(\)/.test(boot), 'boot须先读LS缓存');
  assert.ok(/sendAiDraftPull\(\)/.test(boot), 'boot须pull一次等镜像');
  assert.ok(/,900\)/.test(boot), 'boot pull须900ms延迟（监听挂上后）');
  assert.ok(coreSrc.includes('window.sendAiDraftAck=sendAiDraftAck'), '须window.sendAiDraftAck暴露');
  assert.ok(coreSrc.includes('window.sendAiDraftPull=sendAiDraftPull'), '须window.sendAiDraftPull暴露');
}

// ── G2 ts排序（旧ts丢弃、新ts覆盖） ──
function testG2_DraftTsOrdering() {
  assert.ok(/常驻变量\+ts覆盖\+localStorage\+20次ACK停\+pull一次\+落定三件套/.test(coreSrc), '须注明iter26 ts覆盖语义');
  assert.ok(/var __aiDraftPendingTs=0/.test(coreSrc), '须有PendingTs');
  assert.ok(/var __aiDraftLastRecvTs=0/.test(coreSrc), '须有LastRecvTs');
  assert.ok(/var __aiDraftAckedTs=0/.test(coreSrc), '须有AckedTs');
  const rem = extractFn(coreSrc, 'rememberAiDraft');
  assert.ok(/if\(n&&__aiDraftPendingTs&&n<__aiDraftPendingTs\) return/.test(rem), 'remember旧ts须丢弃（n<PendingTs直接返回）');
  const setR = extractFn(coreSrc, 'setAiDraftWithRetry');
  assert.ok(/if\(_ts&&_ts<__aiDraftLastRecvTs\) return;/.test(setR), 'set旧ts须直接返回不写框');
  assert.ok(/if\(_ts>__aiDraftLastRecvTs\) __aiDraftLastRecvTs=_ts;/.test(setR), 'set新ts须前向更新LastRecvTs');
  const rst = extractFn(coreSrc, 'restoreAiDraftFromMirror');
  assert.ok(/if\(m\.ts&&__aiDraftLastRecvTs&&m\.ts<__aiDraftLastRecvTs\) return false;/.test(rst), 'LS恢复旧ts须丢弃');
  assert.ok(/if\(m\.ts>__aiDraftLastRecvTs\) __aiDraftLastRecvTs=m\.ts;/.test(rst), 'LS恢复新ts须更新LastRecvTs');
  const h = extractFn(coreSrc, 'handleDocMirror');
  const aiBr = h.slice(h.indexOf("kind==='ai-draft'"), h.indexOf("kind==='ai-draft'") + 1200);
  assert.ok(/if\(_dts&&_dts<__aiDraftLastRecvTs\)\{ try\{ sendAiDraftAck\(_dts\);/.test(aiBr), 'ai-draft旧ts须仅回ACK不覆盖');
  assert.ok(/if\(_dts>__aiDraftLastRecvTs\) __aiDraftLastRecvTs=_dts;/.test(aiBr), 'ai-draft新ts须更新LastRecvTs');
  const pullBr = h.slice(h.indexOf("kind==='ai-draft-pull'"), h.indexOf("kind==='ai-draft-pull'") + 2500);
  assert.ok(/_pts>=_bestTs/.test(pullBr) || /Number\(_lm\.ts\|\|0\)>_bestTs/.test(pullBr), 'pull须按ts取最大（pending/LS择优）');
}

// ── G3 localStorage双保险读写 ──
function testG3_DraftLsDoubleInsurance() {
  assert.ok(/var AI_DRAFT_MIRROR_KEY='aiDraftMirror'/.test(coreSrc), '须有AI_DRAFT_MIRROR_KEY=aiDraftMirror');
  assert.ok(coreSrc.includes('function readAiDraftMirror('), '缺readAiDraftMirror');
  assert.ok(coreSrc.includes('function writeAiDraftMirror('), '缺writeAiDraftMirror');
  assert.ok(coreSrc.includes('function rememberAiDraft('), '缺rememberAiDraft');
  assert.ok(coreSrc.includes('function restoreAiDraftFromMirror('), '缺restoreAiDraftFromMirror');
  const read = extractFn(coreSrc, 'readAiDraftMirror');
  assert.ok(/localStorage\.getItem\(AI_DRAFT_MIRROR_KEY\)/.test(read), '读须localStorage.getItem(key)');
  assert.ok(/JSON\.parse\(raw\)/.test(read), '读须JSON.parse');
  assert.ok(/return \{text:t,ts:ts\}/.test(read), '读须返回{text,ts}');
  const write = extractFn(coreSrc, 'writeAiDraftMirror');
  assert.ok(/localStorage\.setItem\(AI_DRAFT_MIRROR_KEY,JSON\.stringify\(\{text:t,ts:n\}\)\)/.test(write), '写须localStorage.setItem(key,JSON{text,ts})');
  const rem = extractFn(coreSrc, 'rememberAiDraft');
  assert.ok(/writeAiDraftMirror\(t,n\)/.test(rem), 'remember须写LS双保险');
  assert.ok(/window\.__aiDraftPendingText=t/.test(rem) && /window\.__aiDraftPendingTs=n/.test(rem), 'remember须同步window可观测');
  const rst = extractFn(coreSrc, 'restoreAiDraftFromMirror');
  assert.ok(/getAiDraftText\(\)/.test(rst), '恢复须先读现框');
  assert.ok(/if\(cur\) return false;/.test(rst), '现框非空须不覆盖（防丢输入）');
  assert.ok(/readAiDraftMirror\(\)/.test(rst), '恢复须读LS镜像');
  assert.ok(/if\(!m\|\|!m\.text\) return false;/.test(rst), '空镜像须返回false');
  assert.ok(/applyAiDraftText\(m\.text\)/.test(rst), '恢复须apply写框');
  const tog = extractFn(coreSrc, 'toggleAiWin');
  assert.ok(/readAiDraftMirror\(\)/.test(tog), 'toggle空草稿须读LS回填');
  assert.ok(/rememberAiDraft\(__aiDraftCache/.test(tog), 'toggle须remember双保险');
  const boot = extractFn(coreSrc, 'bootAiWinMode');
  assert.ok(/restoreAiDraftFromMirror\(\)/.test(boot), 'boot须读LS恢复');
  assert.ok(coreSrc.includes('window.readAiDraftMirror=readAiDraftMirror'), '须window.readAiDraftMirror暴露');
  assert.ok(coreSrc.includes('window.writeAiDraftMirror=writeAiDraftMirror'), '须window.writeAiDraftMirror暴露');
  assert.ok(coreSrc.includes('window.rememberAiDraft=rememberAiDraft'), '须window.rememberAiDraft暴露');
  assert.ok(coreSrc.includes('window.restoreAiDraftFromMirror=restoreAiDraftFromMirror'), '须window.restoreAiDraftFromMirror暴露');
}

// ── G4 关窗等invoke落定（500ms兜底） ──
function testG4_CloseWaitSettle() {
  assert.ok(coreSrc.includes('function toggleAiWin('), '缺toggleAiWin');
  const tog = extractFn(coreSrc, 'toggleAiWin');
  assert.ok(/iter26 关窗竞态/.test(tog), '须注明关窗竞态');
  assert.ok(/等invoke落定后再调close，500ms超时兜底/.test(tog), '须注明等落定+500ms兜底');
  assert.ok(/if\(__fromAiWin\)\{/.test(tog), '仅aiwin切回才等落定');
  assert.ok(/_wp=\(_r0&&typeof _r0\.then==='function'\)\?_r0:\(\(_r2&&typeof _r2\.then==='function'\)\?_r2:null\)/.test(tog), '须从_r0/_r2取thenable等待');
  assert.ok(/var _settled=false;/.test(tog), '须_settled防重入');
  assert.ok(/var _to=setTimeout\(function\(\)\{ if\(!_settled\)\{ _settled=true;/.test(tog), '须setTimeout兜底置_settled');
  assert.ok(/window\.protoAPI\.aiwin\.close\(\)/.test(tog), '兜底须调aiwin.close');
  assert.ok(/,500\)/.test(tog), '兜底须500ms');
  assert.ok(/_wp\.then\(function\(\)\{ if\(!_settled\)\{ _settled=true; try\{ clearTimeout\(_to\);/.test(tog), '落定须clearTimeout取消兜底');
  assert.ok(/sendAiDraftViaMirror\(__aiDraftCache/.test(tog) && /pushAiDraftWithRetry\(__aiDraftCache/.test(tog), '切回前须先发草稿再等落定');
}

// ── G5 落定三件套（aiEnsureCur/aiRenderBubbles/aiSaveSesh与loadDesc/refreshToc） ──
function testG5_SettleTrioHeal() {
  assert.ok(coreSrc.includes('function __aiDraftHealHistory('), '缺__aiDraftHealHistory');
  assert.ok(coreSrc.includes('function __aiDraftHealDoc('), '缺__aiDraftHealDoc');
  const hh = extractFn(coreSrc, '__aiDraftHealHistory');
  assert.ok(/aiEnsureCur\(\)/.test(hh), 'healHistory须aiEnsureCur重读会话');
  assert.ok(/aiRenderBubbles\(\)/.test(hh), 'healHistory须aiRenderBubbles重画气泡');
  assert.ok(/aiSaveSesh\(\)/.test(hh), 'healHistory须aiSaveSesh落定');
  const hd = extractFn(coreSrc, '__aiDraftHealDoc');
  assert.ok(/loadDesc\(\)/.test(hd), 'healDoc须loadDesc重画文档');
  assert.ok(/refreshToc\(\)/.test(hd), 'healDoc须refreshToc重画目录');
  assert.ok(coreSrc.includes('function aiWinSelectProto('), '缺aiWinSelectProto');
  assert.ok(coreSrc.includes('function docWinSelectProto('), '缺docWinSelectProto');
  const aiSel = extractFn(coreSrc, 'aiWinSelectProto');
  assert.ok(/aiWinSyncTitleSbx\(\)/.test(aiSel), 'ai选沙箱须同步标题/沙箱');
  assert.ok(/aiEnsureCur\(\)/.test(aiSel), 'ai选沙箱须aiEnsureCur');
  assert.ok(/aiRenderBubbles\(\)/.test(aiSel), 'ai选沙箱须aiRenderBubbles');
  assert.ok(/aiSaveSesh\(\)/.test(aiSel), 'ai选沙箱须aiSaveSesh');
  const docSel = extractFn(coreSrc, 'docWinSelectProto');
  assert.ok(/loadDesc\(\)/.test(docSel), '文档选沙箱须loadDesc');
  assert.ok(/refreshToc\(\)/.test(docSel), '文档选沙箱须refreshToc');
  const h = extractFn(coreSrc, 'handleDocMirror');
  assert.ok(h.includes("kind==='source'"), 'handle须有source分支');
  assert.ok(h.includes("kind==='ai-source'"), 'handle须有ai-source分支');
  const srcBr = h.slice(h.indexOf("kind==='source'"), h.indexOf("kind==='source'") + 9000);
  assert.ok(/aiEnsureCur\(\)/.test(srcBr), 'source分支须aiEnsureCur（ai侧落定）');
  assert.ok(/aiRenderBubbles\(\)/.test(srcBr), 'source分支须aiRenderBubbles');
  assert.ok(/aiSaveSesh\(\)/.test(srcBr), 'source分支须aiSaveSesh');
  assert.ok(/loadDesc\(\)/.test(srcBr) && /refreshToc\(\)/.test(srcBr), 'source分支须loadDesc/refreshToc（文档侧落定）');
  const aiSrcBr = h.slice(h.indexOf("kind==='ai-source'"), h.indexOf("kind==='ai-source'") + 6000);
  assert.ok(/aiWinSyncTitleSbx\(\)/.test(aiSrcBr), 'ai-source须同步标题/沙箱');
  assert.ok(/aiEnsureCur\(\)/.test(aiSrcBr), 'ai-source须aiEnsureCur');
  assert.ok(/aiRenderBubbles\(\)/.test(aiSrcBr), 'ai-source须aiRenderBubbles');
  assert.ok(/aiSaveSesh\(\)/.test(aiSrcBr), 'ai-source须aiSaveSesh');
  assert.ok(coreSrc.includes('window.docWinSelectProto=docWinSelectProto'), '须window.docWinSelectProto暴露');
}

// ── S5 草稿LS+ts+ACK真执行 ──
function testS5_DraftLsTsAckRuntime() {
  const keyDecl = "var AI_DRAFT_MIRROR_KEY='aiDraftMirror';\n";
  const readBody = extractFn(coreSrc, 'readAiDraftMirror');
  const writeBody = extractFn(coreSrc, 'writeAiDraftMirror');
  const remBody = extractFn(coreSrc, 'rememberAiDraft');
  const nowBody = extractFn(coreSrc, '__aiDraftNowTs');
  const setBody = extractFn(coreSrc, 'setAiDraftWithRetry');
  const applyBody = extractFn(coreSrc, 'applyAiDraftText');
  const pushBody = extractFn(coreSrc, 'pushAiDraftWithRetry');
  const clearBody = extractFn(coreSrc, '__aiDraftClearRetry');
  function mkLs(init) {
    const store = Object.assign({}, init || {});
    return {
      _s: store,
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
      setItem(k, v) { this._s[k] = String(v); }
    };
  }
  // LS往返：写后读回一致
  (function () {
    const ls = mkLs();
    const sb = { localStorage: ls };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(keyDecl + readBody + '\n' + writeBody + "\nwriteAiDraftMirror('hello-ls',12345);\nthis.__raw=localStorage.getItem(AI_DRAFT_MIRROR_KEY);\nthis.__r=readAiDraftMirror();", sb);
    const raw = JSON.parse(sb.__raw);
    assert.strictEqual(raw.text, 'hello-ls', 'LS原文须落盘，实际:' + sb.__raw);
    assert.strictEqual(raw.ts, 12345, 'LS ts须落盘，实际:' + sb.__raw);
    assert.strictEqual(sb.__r.text, 'hello-ls', '读回text须一致');
    assert.strictEqual(sb.__r.ts, 12345, '读回ts须一致');
  })();
  // LS容错：空/坏串返回null
  (function () {
    const sb = { localStorage: mkLs() };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(keyDecl + readBody + '\nthis.__e=readAiDraftMirror();', sb);
    assert.strictEqual(sb.__e, null, '空LS须返回null');
    const sb2 = { localStorage: mkLs({ aiDraftMirror: '{bad-json' }) };
    sb2.window = sb2; sb2.globalThis = sb2;
    vm.createContext(sb2);
    vm.runInContext(keyDecl + readBody + '\nthis.__b=readAiDraftMirror();', sb2);
    assert.strictEqual(sb2.__b, null, '坏JSON须返回null');
  })();
  // ts排序：remember旧ts丢弃、新ts覆盖
  (function () {
    const ls = mkLs();
    const sb = {
      localStorage: ls,
      __aiDraftPendingText: '', __aiDraftPendingTs: 0,
      window: {}
    };
    sb.window = sb.window || {}; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(keyDecl + nowBody + '\n' + writeBody + '\n' + remBody + "\nthis.__a=rememberAiDraft('first',100);\nthis.__b=rememberAiDraft('stale',50);\nthis.__c=rememberAiDraft('newer',200);", sb);
    assert.strictEqual(sb.__a.ts, 100, '首次remember须100');
    assert.strictEqual(sb.__b.ts, 100, '旧ts50须丢弃保100，实际:' + JSON.stringify(sb.__b));
    assert.strictEqual(sb.__b.text, 'first', '旧ts须保原文，实际:' + JSON.stringify(sb.__b));
    assert.strictEqual(sb.__c.ts, 200, '新ts200须覆盖，实际:' + JSON.stringify(sb.__c));
    assert.strictEqual(sb.__c.text, 'newer', '新ts须更新文本');
  })();
  // ts排序：set旧ts不写框
  (function () {
    const el = { value: '' };
    let applied = [];
    const sb = {
      document: { getElementById(id) { return id === 'aiInput' ? el : null; } },
      localStorage: mkLs(),
      __aiDraftLastRecvTs: 100, __aiDraftPendingText: '', __aiDraftPendingTs: 0,
      window: {},
      setInterval() { assert.fail('旧ts不得设timer'); return 0; },
      clearInterval() {}
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(keyDecl + nowBody + '\n' + writeBody + '\n' + remBody + '\n' + applyBody + '\n' + setBody + "\nsetAiDraftWithRetry('stale-txt',50);\nthis.__v=(document.getElementById('aiInput')||{}).value;\nthis.__last=__aiDraftLastRecvTs;", sb);
    assert.strictEqual(sb.__v, '', '旧ts不得写框，实际:' + sb.__v);
    assert.strictEqual(sb.__last, 100, '旧ts不得更新LastRecvTs，实际:' + sb.__last);
    void applied;
  })();
  // ACK即停+500ms×20封顶：timer装配与回调语义
  (function () {
    let ms = 0, sendN = 0, cleared = 0;
    const sb = {
      __aiDraftAckedTs: 0, __aiDraftRetryTs: 0, __aiDraftRetryTimer: null,
      __aiDraftPendingText: '', __aiDraftPendingTs: 0,
      localStorage: mkLs(),
      window: {},
      __aiDraftNowTs() { return 999; },
      rememberAiDraft() {},
      sendAiDraftViaMirror() { sendN++; },
      __aiDraftClearRetry() { cleared++; try { if (this.__aiDraftRetryTimer) this.__aiDraftRetryTimer = null; } catch (e) {} },
      setInterval(fn, m) { ms = m; sb.__fn = fn; return 777; },
      clearInterval() { cleared++; }
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(pushBody + "\npushAiDraftWithRetry('cap-txt',1000);\nthis.__ts=__aiDraftRetryTs;\nthis.__tm=__aiDraftRetryTimer;\nthis.__ms=" + '0' + ';', sb);
    assert.strictEqual(ms, 500, '补发间隔须500ms，实际:' + ms);
    assert.strictEqual(sb.__ts, 1000, '须记RetryTs=stamp供ACK比对，实际:' + sb.__ts);
    assert.strictEqual(sb.__tm, 777, '须记RetryTimer可观测，实际:' + sb.__tm);
    assert.strictEqual(sendN, 1, '首发须send1次，实际:' + sendN);
    // ACK即停：置Acked>=stamp后回调须clear且不再发
    vm.runInContext('__aiDraftAckedTs=1000;', sb);
    const before = sendN;
    vm.runInContext('__fn();', sb);
    assert.ok(cleared >= 1, 'ACK达stamp回调须clearInterval，实际cleared=' + cleared);
    assert.strictEqual(sendN, before, 'ACK后回调不得再补发，实际sendN=' + sendN);
    // 封顶：无ACK连跑20次须clear
    const sb2 = {
      __aiDraftAckedTs: 0, __aiDraftRetryTs: 0, __aiDraftRetryTimer: null,
      __aiDraftPendingText: '', __aiDraftPendingTs: 0,
      localStorage: mkLs(),
      window: {},
      __aiDraftNowTs() { return 1; },
      rememberAiDraft() {},
      sendAiDraftViaMirror() {},
      __aiDraftClearRetry() {},
      setInterval(fn, m) { sb2.__fn = fn; sb2.__ms = m; return 888; },
      clearInterval(id) { sb2.__cleared = (sb2.__cleared || 0) + 1; }
    };
    sb2.globalThis = sb2;
    vm.createContext(sb2);
    vm.runInContext(pushBody + "\npushAiDraftWithRetry('x',5);", sb2);
    assert.strictEqual(sb2.__ms, 500, '封顶路径间隔亦须500ms');
    for (let i = 0; i < 20; i++) { vm.runInContext('__fn();', sb2); }
    assert.ok((sb2.__cleared || 0) >= 1, '20次后须clearInterval封顶，实际cleared=' + (sb2.__cleared || 0));
    void clearBody;
  })();
}

// ── H1 独立窗切Tab无遮罩：setDocsOpen/setReqOpen在docwin下跳过遮罩与栈 ──
function testH1_DocwinNoMaskOnTab() {
  const pae = exportSrc;
  assert.ok(/function setDocsOpen\(open\)/.test(pae), '缺setDocsOpen');
  assert.ok(/function setReqOpen\(open\)/.test(pae), '缺setReqOpen');
  const docsFn = pae.slice(pae.indexOf('function setDocsOpen(open)'), pae.indexOf('function setDocsOpen(open)') + 2200);
  const reqFn = pae.slice(pae.indexOf('function setReqOpen(open)'), pae.indexOf('function setReqOpen(open)') + 1800);
  for (const [nm, body] of [['setDocsOpen', docsFn], ['setReqOpen', reqFn]]) {
    assert.ok(/isDocWinMode|docwin-mode/.test(body), nm + '须判独立窗模式');
    assert.ok(/MaskStack\.pop\('(docsMask|reqMask)'\)/.test(body), nm + '独立窗须清残留栈顶');
  }
  assert.ok(/docsMaskEl\)docsMaskEl\.style\.display='none'/.test(pae.replace(/\s+/g, '')) || /docsMaskEl\.style\.display='none'/.test(pae), '独立窗须隐藏docs遮罩');
}

// ── H2 F12/Ctrl+Shift+I 开关控制台（主窗+doc/ai独立窗） ──
function testH2_DevToolsShortcut() {
  assert.ok(mainSrc.includes('function attachDevToolsShortcut('), '缺attachDevToolsShortcut');
  const fn = extractFn(mainSrc, 'attachDevToolsShortcut');
  assert.ok(/before-input-event/.test(fn), '须经before-input-event（先于页面按键）');
  assert.ok(/input\.type\s*!==\s*'keyDown'/.test(fn), '须只响应keyDown（防keyup二次触发）');
  assert.ok(/input\.key\s*===\s*'F12'/.test(fn), '须支持F12');
  assert.ok(/control\s*\|\|\s*input\.meta/.test(fn) && /shift/.test(fn), '须支持Ctrl/Shift+I（兼容mac Cmd）');
  assert.ok(/isDevToolsOpened\(\)/.test(fn) && /closeDevTools\(\)/.test(fn) && /openDevTools\(\{\s*mode:\s*'detach'\s*\}\)/.test(fn), '须开/关切换且detach模式');
  assert.ok(/__devToolsShortcutBound/.test(fn), '须防重绑定');
  assert.ok(/attachDevToolsShortcut\(shared\.docWin\)/.test(mainSrc), 'docWin创建须挂载');
  assert.ok(/attachDevToolsShortcut\(shared\.aiWin\)/.test(mainSrc), 'aiWin创建须挂载');
  const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
  assert.ok(/attachDevToolsShortcut\(win\)/.test(mainJs), '主窗口创建须挂载');
  assert.ok(/attachDevToolsShortcut/.test(mainJs) && /require\('.\/main\/controllers\/window-controller'\)/.test(mainJs), 'main.js须从window-controller引入');
  // 真执行：mock窗口派发按键
  const run = new Function(fn + '\nreturn attachDevToolsShortcut;')();
  function mockWin() {
    const handlers = {};
    const wc = {
      on(ev, h) { handlers[ev] = h; },
      _opened: false,
      isDevToolsOpened() { return this._opened; },
      openDevTools() { this._opened = true; },
      closeDevTools() { this._opened = false; },
    };
    return { webContents: wc, fire(input) { handlers['before-input-event']({ preventDefault() {} }, input); } };
  }
  const w = mockWin();
  assert.strictEqual(run(w), true, '挂载须返回true');
  assert.strictEqual(run(w), true, '重复挂载须幂等true');
  assert.strictEqual(run(null), false, '空窗口须返回false');
  w.fire({ type: 'keyDown', key: 'F12' });
  assert.strictEqual(w.webContents._opened, true, 'F12须打开');
  w.fire({ type: 'keyUp', key: 'F12' });
  assert.strictEqual(w.webContents._opened, true, 'keyUp不得二次触发');
  w.fire({ type: 'keyDown', key: 'F12' });
  assert.strictEqual(w.webContents._opened, false, 'F12须关闭（切换）');
  w.fire({ type: 'keyDown', key: 'I', control: true, shift: true });
  assert.strictEqual(w.webContents._opened, true, 'Ctrl+Shift+I须打开');
  w.fire({ type: 'keyDown', key: 'a', control: true });
  assert.strictEqual(w.webContents._opened, true, '普通按键不得影响');
  w.fire({ type: 'keyDown', key: 'I', meta: true, shift: true });
  assert.strictEqual(w.webContents._opened, false, 'Cmd+Shift+I须关闭（mac兼容）');
}

function runAll() {  const tests = [
    ['A1 主进程docwin三通道', testA1_DocwinChannels],
    ['A2 镜像中继透传', testA2_MirrorRelay],
    ['A3 关窗通知panel', testA3_CloseNotifyPanel],
    ['A4 主窗联带关闭', testA4_MainCloseChain],
    ['A5 preload暴露', testA5_PreloadExpose],
    ['A6 isDocWinMode', testA6_IsDocWinMode],
    ['A7 bootDocWinMode', testA7_BootDocWinMode],
    ['A8 handleDocMirror四kind', testA8_HandleFourKinds],
    ['A9 mirrorPush防环', testA9_MirrorLoopGuard],
    ['A10 双Tab与reqMode切换', testA10_DualTabs],
    ['A10b 合一单壳tab', testA10b_UnifiedReqTab],
    ['A10c 目录左侧固定列', testA10c_TocSideColumn],
    ['A11 切换按钮文案互换', testA11_ToggleBtnText],
    ['A12 apply源码语义', testA12_ApplySrc],
    ['S1 窗口判别+按钮文案真执行', testS1_IsModeAndBtnRuntime],
    ['S2 面板模式真执行(开/收/幂等/窗内禁)', testS2_ApplyRuntime],
    ['B1 Tab胶囊120px/圆角50', testB1_TabCapsule],
    ['B2 docwin恒左目录右文档220px', testB2_DocwinLeftTocRightDoc],
    ['B3 docwin maximize+默认openToc', testB3_DocwinMaximizeOpenToc],
    ['C1 aiwin主进程三通道(open带参透传)', testC1_AiwinChannels],
    ['C2 aiwin preload暴露(open带参)', testC2_AiwinPreload],
    ['C3 aiwin前端ai-head/tab后沙箱前', testC3_AiwinFrontend],
    ['C4 aiwin关窗通知+ai-mode复用', testC4_AiwinCloseNotify],
    ['C5 aiwin内隐藏aiClose+禁关', testC5_AiCloseGuard],
    ['C6 query直进+禁picker', testC6_QueryBootProject],
    ['C7 ai-source联动+防环', testC7_AiSourceMirror],
    ['C8 锁定切换入口隐藏', testC8_LockSwitchers],
    ['E1 docwin前端open带参透传', testE1_DocwinOpenArgFrontend],
    ['E2 切回显式开/X关仅同步', testE2_ExplicitReopenOnlySync],
    ['E3 API卡片隐URL模型Key', testE3_ApiCardHide],
    ['E4 行号属性存在', testE4_LineNumberAttrs],
    ['E5 微改段落格级', testE5_MicroParaCell],
    ['E6 文档窗query直进禁picker闪', testE6_DocWinQueryNoPicker],
    ['E7 AI开后关弹窗+focus独立窗', testE7_AiFocusClose],
    ['F1 高度链100vh+独立滚动', testF1_HeightChain],
    ['F2 ai-draft双向同步+重试', testF2_AiDraftSync],
    ['F3 双向toggle忙时拒绝(前后端)', testF3_BusyToggleReject],
    ['F4 X关确认+任务转移', testF4_CloseConfirmTransfer],
    ['S4 草稿读写+忙判真执行', testS4_DraftBusyRuntime],
    ['G1 pull/ack往返与封顶', testG1_DraftPullAckRoundtripCap],
    ['G2 ts排序旧丢弃', testG2_DraftTsOrdering],
    ['G3 LS双保险读写', testG3_DraftLsDoubleInsurance],
    ['G4 关窗等invoke落定', testG4_CloseWaitSettle],
    ['G5 落定三件套', testG5_SettleTrioHeal],
    ['S5 LS+ts+ACK真执行', testS5_DraftLsTsAckRuntime],
    ['D1 无渐变无emoji红线', testD1_NoGradientNoEmoji],
    ['S3 aiwin判别+按钮+boot真执行', testS3_AiwinRuntime],
    ['H1 独立窗切Tab无遮罩', testH1_DocwinNoMaskOnTab],
    ['H2 F12控制台开关', testH2_DevToolsShortcut]
  ];
  let passed = 0, failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(failed ? 'DOCWIN_FAIL' : `DOCWIN_PASS: 全部${tests.length}项独立文档窗口断言通过`);
  process.exitCode = failed ? 1 : 0;
}
runAll();
