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
  // Wave-B兼容：主进程已拆为 main.js(骨架)+main/controllers+main/services，聚合后断言（70通道契约不变）
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

// ── H2 F12/Ctrl+Shift+I 开关控制台（主窗+文档独立窗） ──
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
    ['E1 docwin前端open带参透传', testE1_DocwinOpenArgFrontend],
    ['E2 切回显式开/X关仅同步', testE2_ExplicitReopenOnlySync],
    ['E3 API卡片隐URL模型Key', testE3_ApiCardHide],
    ['E4 行号属性存在', testE4_LineNumberAttrs],
    ['E5 微改段落格级', testE5_MicroParaCell],
    ['E6 文档窗query直进禁picker闪', testE6_DocWinQueryNoPicker],
    ['F1 高度链100vh+独立滚动', testF1_HeightChain],
    ['D1 无渐变无emoji红线', testD1_NoGradientNoEmoji],
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
