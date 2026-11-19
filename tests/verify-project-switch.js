'use strict';
// verify-project-switch: 空项目切换回归（纯 Node，不启动 Electron）
// 背景：新建空项目进入后，预览帧与文档面板残留上个项目的页面（currentSource/帧/文档未清）
// 覆盖：(a) 空分支静态含全套清理 (b) 真实 loadSandboxSources 在 vm 中跑空项目：旧源清零/帧srcdoc摘除→about:blank/文档重载/标题复位
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const paeSrc = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');

console.log('=== project-switch 回归测试 ===');

// ---------- helpers（与 verify-ctrl-release.js 同口径的括号提取） ----------
function braceExtract(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  assert.ok(m, '[提取失败] function ' + name);
  let i = m.index + m[0].length; let depth = 1; let inS = null; let inL = false; let inB = false;
  for (; i < src.length; i++) {
    const c = src[i]; const n = src[i + 1];
    if (inL) { if (c === '\n') inL = false; continue; }
    if (inB) { if (c === '*' && n === '/') { inB = false; i++; } continue; }
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { inL = true; i++; continue; }
    if (c === '/' && n === '*') { inB = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(depth === 0, '[括号失衡] function ' + name);
  return src.slice(m.index, i + 1);
}

// ---------- (a) 空分支静态含全套清理 ----------
{
  const seg = paeSrc.match(/if\(!sources\.length\)\{[\s\S]{0,2200}?_refreshDone\(\); return; \}/);
  assert.ok(seg, '须能定位 !sources.length 空分支');
  const code = seg[0];
  assert.ok(/currentSource\s*=\s*null/.test(code), '空分支须 currentSource=null');
  assert.ok(/setCurrentSource\)\s*window\.Store\.setCurrentSource\(null\)/.test(code) || /setCurrentSource\(null\)/.test(code), '空分支须同步 Store');
  assert.ok(/removeAttribute\('srcdoc'\)/.test(code), '空分支须摘除帧 srcdoc');
  assert.ok(/setAttribute\('src'\s*,\s*'about:blank'\)/.test(code), '空分支须帧指向 about:blank');
  assert.ok(/loadDesc\(\)/.test(code), '空分支须重载文档面板');
  assert.ok(/暂无原型/.test(code), '空分支须文档标题置暂无原型');
  assert.ok(/document\.title\s*=\s*'原型预览'/.test(code), '空分支须复位窗口标题');
  console.log('[PASS] (a) 空分支静态含全套清理');
}

// ---------- (b) 真实函数 vm 仿真：空项目清残留 ----------
async function runEmptySwitch() {
  const calls = { loadDesc: 0, renderList: 0, storeNull: 0, closeInsp: 0, closeAnno: 0, hideHover: 0 };
  const frameCalls = [];
  const stale = { displayName: '旧项目原型', name: 'old.html' };
  const ctx = {
    console,
    setTimeout: (fn) => 0, clearTimeout: () => {},
    currentProject: '新空项目',
    currentSource: stale,
    sources: [],
    frame: {
      hasAttribute: (k) => k === 'srcdoc',
      removeAttribute: (k) => { frameCalls.push('rm:' + k); },
      setAttribute: (k, v) => { frameCalls.push('set:' + k + '=' + v); },
    },
    document: { title: '原型预览 · 旧项目原型', getElementById: (id) => (id === 'docTitle' ? { set textContent(v) { calls.docTitle = v; } } : null) },
    window: {
      _refreshManual: false,
      protoAPI: { sandbox: { list: () => Promise.resolve({ folders: [] }) } },
      Store: { setCurrentSource: (v) => { if (v === null) calls.storeNull++; } },
      LinkBind: { closeInspector: () => { calls.closeInsp++; } },
      AnnotationEngine: { closeAll: () => { calls.closeAnno++; } },
    },
    $: () => null,
    renderSourceList: () => { calls.renderList++; },
    libStatus: () => {},
    loadDesc: () => { calls.loadDesc++; },
    editHideHover: () => { calls.hideHover++; },
    reportError: () => { throw new Error('不应走到报错分支'); },
  };
  ctx.window.__aiQuietRefresh = false;
  // 浏览器经典脚本全局（与 loadSource 同约定）：裸标识须可解析
  ctx.LinkBind = ctx.window.LinkBind;
  ctx.AnnotationEngine = ctx.window.AnnotationEngine;
  vm.createContext(ctx);
  const code = braceExtract(paeSrc, 'loadSandboxSources') + '\nloadSandboxSources(undefined, true);';
  vm.runInContext(code, ctx, { filename: 'loadSandboxSources.js' });
  for (let i = 0; i < 10 && ctx.currentSource !== null; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(ctx.currentSource, null, '旧 currentSource 须清零');
  assert.strictEqual(calls.storeNull, 1, 'Store 须同步 null');
  assert.ok(frameCalls.includes('rm:srcdoc'), '帧须摘除 srcdoc，实际' + JSON.stringify(frameCalls));
  assert.ok(frameCalls.includes('set:src=about:blank'), '帧须指向 about:blank');
  assert.strictEqual(calls.loadDesc, 1, '文档面板须重载');
  assert.strictEqual(calls.docTitle, '暂无原型', '文档标题须置暂无原型');
  assert.strictEqual(ctx.document.title, '原型预览', '窗口标题须复位');
  assert.strictEqual(calls.renderList, 1, '源列表须重绘（暂无源文件）');
  assert.strictEqual(calls.closeInsp, 1, '检查器浮窗须收');
  assert.strictEqual(calls.closeAnno, 1, '标注须收');
  assert.strictEqual(calls.hideHover, 1, '悬停须收');
  console.log('[PASS] (b) 空项目切换清残留全链路');
}

runEmptySwitch().then(
  () => console.log('=== project-switch 全部断言通过 ==='),
  (e) => { console.error('[FAIL] project-switch'); console.error(e && e.stack || String(e)); process.exit(1); }
);
