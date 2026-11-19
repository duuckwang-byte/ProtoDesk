'use strict';
// verify-prid-guard: v-for 复制拾取护栏回归（纯 Node，不启动 Electron）
// 手段：源文静态断言 + 轻量 FakeDOM 运行时仿真（本仓无 jsdom，不引入新依赖）
// 覆盖：重复 pr-id（模拟 v-for 复制）→ prIdPickUpgrade 必须返回 null 且绝不返回 nth-of-type；
//       唯一 pr-id 仍能定位；输入已是 pr-id 且重复亦返回 null；主进程无重复实现；调用方 null 安全。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const ee = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const lb = fs.readFileSync(path.join(rootDir, 'js', 'link-bind.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');

function extractFn(srcText, name) {
  const i = srcText.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = srcText.indexOf('{', i);
  if (b < 0) return null;
  let depth = 0;
  for (let j = b; j < srcText.length; j++) {
    if (srcText[j] === '{') depth++;
    else if (srcText[j] === '}') { depth--; if (depth === 0) return srcText.slice(i, j + 1); }
  }
  return null;
}

// ── G1 静态护栏存在：解析 pr-id 计数恰1，否则 null，禁 nth-of-type 回退 ──
function testG1_StaticGuard() {
  const fn = extractFn(ee, 'prIdPickUpgrade');
  assert.ok(fn, '须能提取 prIdPickUpgrade');
  assert.ok(fn.includes('chk.length!==1'), '须有解析 pr-id 计数护栏 chk.length!==1');
  assert.ok(fn.includes('return null'), '护栏失败须返回 null');
  assert.ok(/v-for/.test(fn), '须有 v-for 复制护栏注释');
  assert.ok(!/nth-of-type\(/.test(fn), '升级内核内禁止出现 nth-of-type(...) 回退代码（注释提及除外）');
  // 输入已是 pr-id 亦计数（重复直接 null，不升级不回退）
  assert.ok(fn.includes('nsIn') && fn.includes('cIn.length!==1'), '输入 pr-id 分支须解析计数（nsIn/cIn.length!==1）');
  // 静态原文档复核（注入新增ID为0属正常，仅拦截>1）
  assert.ok(fn.includes('chk0.length>1'), '须有静态原文档复核 chk0.length>1（新增ID为0放行，>1拦截）');
  console.log('[PASS] G1 静态护栏存在且禁 nth-of-type 回退');
}

// ── G2 主进程无重复实现（仅前端一份，逻辑一致） ──
function testG2_MainNoDup() {
  assert.ok(!/function prIdPickUpgrade\(/.test(mainSrc), '主进程不得有 prIdPickUpgrade 重复实现（仅前端 js/edit-entry.js 一份）');
  assert.ok(/function ensurePrIdInjected\(/.test(mainSrc), '主进程须保留 ensurePrIdInjected 注入函数（与前端同规则）');
  const lbDef = /function prIdPickUpgrade\(/.test(lb);
  assert.ok(!lbDef, 'link-bind 不得重复定义 prIdPickUpgrade（仅调用全局前端实现）');
  assert.ok(lb.includes('prIdPickUpgrade(srcHtml, sel, liveIndex, text)'), 'link-bind 须复用全局 prIdPickUpgrade');
  console.log('[PASS] G2 主进程无重复实现，前端唯一');
}

// ── G3 调用方 null 安全（只看不改：失败路径非崩溃） ──
function testG3_CallersNullSafe() {
  const upParts = extractFn(ee, 'prIdUpgradeParts');
  assert.ok(upParts, '须能提取 prIdUpgradeParts');
  assert.ok(upParts.includes('if(up&&up.sel)'), 'prIdUpgradeParts 须以 if(up&&up.sel) 守卫（null 时保留原 sel 走 done，不崩溃）');
  assert.ok(ee.includes('if(!up||!up.sel)'), 'codeEditBackfill/pickBarAnnoGo 须有 !up||!up.sel 失败分支');
  assert.ok(lb.includes('if (!up || !up.sel)'), 'link-bind 须有 !up||!up.sel 失败分支（后台补ID+toast，不崩溃）');
  console.log('[PASS] G3 调用方 null 安全（失败路径非崩溃，无需改调用方）');
}

// ── FakeDOM：仅支撑本回归的扁平测试文档（class/tag/pr-id 三类选择器） ──
function makeHarness() {
  const ensureSrc = extractFn(ee, 'prIdEnsureInjected');
  const pickSrc = extractFn(ee, 'prIdPickUpgrade');
  assert.ok(ensureSrc && pickSrc, '须能提取 prIdEnsureInjected + prIdPickUpgrade');
  const factory = new Function(
    ensureSrc + '\n' + pickSrc + '\n' +
    'return { prIdEnsureInjected: prIdEnsureInjected, prIdPickUpgrade: prIdPickUpgrade };'
  );
  // FakeDOM 注入为全局 DOMParser（prIdPickUpgrade 内部 new DOMParser 用）
  function FakeEl(tag, attrs, text) {
    const clsM = /class\s*=\s*"([^"]*)"/i.exec(attrs) || /class\s*=\s*'([^']*)'/i.exec(attrs);
    const idM = /data-pr-id\s*=\s*"([^"]*)"/i.exec(attrs) || /data-pr-id\s*=\s*'([^']*)'/i.exec(attrs);
    return {
      tagName: String(tag || '').toUpperCase(),
      className: clsM ? clsM[1] : '',
      textContent: String(text || ''),
      _prid: idM ? idM[1] : null,
      getAttribute(k) {
        if (String(k) === 'data-pr-id') return this._prid;
        if (String(k) === 'class') return this.className || null;
        return null;
      },
    };
  }
  function parseFlat(html) {
    const els = [];
    const re = /<([a-z][a-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>([^<]*)/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      const tag = m[1], attrs = m[2] || '', text = m[3] || '';
      if (/^(html|head|body|script|style|link|meta|title|base|template)$/i.test(tag)) continue;
      els.push(FakeEl(tag, attrs, text));
    }
    return els;
  }
  function matchSel(el, sel) {
    const s = String(sel || '').trim();
    let mPid = /\[data-pr-id="([^"]+)"\]/.exec(s);
    if (mPid) return el._prid === mPid[1];
    if (/^\.[A-Za-z0-9_-]+$/.test(s)) {
      const c = s.slice(1);
      return String(el.className || '').split(/\s+/).indexOf(c) >= 0;
    }
    if (/^[a-z][a-z0-9]*$/i.test(s)) return el.tagName === s.toUpperCase();
    return false;
  }
  function FakeDoc(els) {
    return {
      _els: els,
      querySelectorAll(sel) {
        const out = [];
        for (const el of els) { try { if (matchSel(el, sel)) out.push(el); } catch (e) {} }
        out.length = out.length;
        return out;
      },
    };
  }
  function FakeParser() {}
  FakeParser.prototype.parseFromString = function (html) {
    return FakeDoc(parseFlat(html));
  };
  const prev = global.DOMParser;
  global.DOMParser = FakeParser;
  let api;
  try { api = factory(); } finally { if (prev === undefined) delete global.DOMParser; else global.DOMParser = prev; }
  // 运行时调用需再次挂载 FakeDOM（函数体内 new DOMParser 走全局）
  function callPick(srcHtml, selector, liveIndex, text) {
    const prev2 = global.DOMParser;
    global.DOMParser = FakeParser;
    try { return api.prIdPickUpgrade(srcHtml, selector, liveIndex, text); }
    finally { if (prev2 === undefined) delete global.DOMParser; else global.DOMParser = prev2; }
  }
  return { api, callPick };
}

// ── G4 运行时：重复 pr-id（v-for 复制）必须 null，且绝不返回 nth-of-type ──
function testG4_DupReturnsNull() {
  const { callPick } = makeHarness();
  const dupHtml = '<div class="card" data-pr-id="pr-dup-1">A</div><div class="card" data-pr-id="pr-dup-1">B</div>';
  const r0 = callPick(dupHtml, '.card', 0, 'A');
  assert.strictEqual(r0, null, '重复 pr-id 按序号0定位必须返回 null（停下不猜），实际:' + JSON.stringify(r0));
  const r1 = callPick(dupHtml, '.card', 1, 'B');
  assert.strictEqual(r1, null, '重复 pr-id 按序号1定位必须返回 null，实际:' + JSON.stringify(r1));
  const rIn = callPick(dupHtml, '[data-pr-id="pr-dup-1"]', -1, '');
  assert.strictEqual(rIn, null, '输入已是重复 pr-id 选择器必须返回 null，实际:' + JSON.stringify(rIn));
  console.log('[PASS] G4 重复 pr-id（v-for 复制）一律 null，不回退');
}

// ── G5 运行时：唯一 pr-id 仍能定位，且选择器非 nth-of-type ──
function testG5_UniqueStillWorks() {
  const { api, callPick } = makeHarness();
  const uniqHtml = '<div class="card">A</div><div class="card">B</div>';
  const injected = api.prIdEnsureInjected(uniqHtml);
  assert.ok(injected !== uniqHtml, '唯一用例须触发注入（补 data-pr-id）');
  const r = callPick(uniqHtml, '.card', 1, 'B');
  assert.ok(r && r.sel, '唯一 pr-id 应返回升级结果，实际:' + JSON.stringify(r));
  assert.ok(/^\[data-pr-id="[^"]+"\]/.test(r.sel), '返回须为 pr-id 选择器，实际:' + r.sel);
  assert.ok(!/nth-of-type/.test(r.sel), '返回绝不得是 nth-of-type 全路径，实际:' + r.sel);
  assert.ok(r.el && String(r.el.textContent || '').indexOf('B') >= 0, '返回元素应为所点序号项（B）');
  console.log('[PASS] G5 唯一 pr-id 正常升级：' + r.sel);
}

function runAll() {
  const tests = [
    ['G1 静态护栏存在且禁 nth-of-type 回退', testG1_StaticGuard],
    ['G2 主进程无重复实现', testG2_MainNoDup],
    ['G3 调用方 null 安全', testG3_CallersNullSafe],
    ['G4 重复 pr-id 一律 null', testG4_DupReturnsNull],
    ['G5 唯一 pr-id 正常升级', testG5_UniqueStillWorks],
  ];
  let passed = 0, failed = 0;
  for (const [title, fn] of tests) {
    try { fn(); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err && err.stack || String(err)); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  console.log(failed ? 'PRID_GUARD_FAIL' : 'PRID_GUARD_PASS: v-for 复制护栏全绿（重复null/唯一可定/无nth回退）');
  process.exitCode = failed ? 1 : 0;
}
runAll();
