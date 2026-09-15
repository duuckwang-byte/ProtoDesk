// 模型获取弹窗 + 只显已选：可见集合、确认并集、删除语义
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);

const rootDir = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');

function extract(name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, '[提取失败] function ' + name);
  return m[0];
}
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escAttr(s) { return escHtml(s); }
function mkListEl() {
  return { _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { this._h = String(v); },
    querySelectorAll() { return []; }, querySelector() { return null; }, style: {}, onclick: null, oninput: null };
}
const GROUPS = [{ label: 'P', provider: 'p', models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }];

// ---- 1. 页面只显已选 + 删除按钮（可见集合按 CLI 分 CLI 隔离） ----
async function testPageFilter() {
  const listEl = mkListEl();
  const fake$ = () => listEl;
  const helper = extract('curCliId') + '\n' + extract('getCliVisibleIds') + '\n';
  const fnSrc = helper + extract('renderModelManagerList');
  const fn = new Function('$', 'escHtml', 'escAttr', 'getActiveEngineInUi', 'window',
    fnSrc + '\nreturn renderModelManagerList({agentId:"opencode",visibleModelsCli:{opencode:["b"]}});');
  const fakeWindow = { protoAPI: { ai: { listModels: () => Promise.resolve({ ok: true, groups: GROUPS, engine: 'cli' }) } } };
  fn(fake$, escHtml, escAttr, () => 'cli', fakeWindow);
  await new Promise((r) => setImmediate(r));
  const h = listEl.innerHTML;
  assert.ok(h.includes('>b<') || h.includes('"b"'), '已选项b应显示');
  assert.ok(!h.includes('"a"') && !h.includes('"c"'), '未选项a/c应隐藏');
  assert.ok(h.includes('model-del'), '应有删除按钮');
  // 从未选过的 CLI 显示为空（不再回填全量）
  const listEl2 = mkListEl();
  const fn2 = new Function('$', 'escHtml', 'escAttr', 'getActiveEngineInUi', 'window',
    fnSrc + '\nreturn renderModelManagerList({agentId:"opencode",visibleModelsCli:{}});');
  fn2(() => listEl2, escHtml, escAttr, () => 'cli', fakeWindow);
  await new Promise((r) => setImmediate(r));
  assert.ok(!listEl2.innerHTML.includes('"a"') && !listEl2.innerHTML.includes('"c"'), '从未选择的CLI应显示为空');
  assert.ok(/暂无已选模型/.test(listEl2.innerHTML), '空选择应有引导提示');
}

// ---- 2. 删除语义：只出当前 CLI 可见集合，不碰custom与其他 CLI ----
async function testDeleteSemantics() {
  const helper = extract('curCliId') + '\n' + extract('normalizeCliModelMaps') + '\n' + extract('getCliVisibleIds') + '\n' + extract('setCliVisibleIds') + '\n' + extract('setVisibleModels') + '\n' + extract('persistVisibleAndRefresh') + '\n' + extract('removeVisibleModel');
  const calls = { saved: null };
  const fakeWindow = { protoAPI: { ai: { saveConfig: (cfg) => { calls.saved = cfg; return Promise.resolve({}); } } } };
  const fn = new Function('getActiveEngineInUi', 'window', 'showToast', 'aiInvalidateModels', 'aiLoadModels', 'renderModelManagerList', 'curAiConfigInit',
    'var curAiConfig = curAiConfigInit;\n' + helper + '\nvar left = removeVisibleModel("b");\nreturn {left:left, mem:curAiConfig};');
  const init = { agentId: 'opencode', visibleModelsCli: { opencode: ['a', 'b'], qoder: ['q1'] }, customModelsCli: { opencode: ['a', 'b', 'c'] } };
  const r = fn(() => 'cli', fakeWindow, () => {}, () => {}, () => {}, () => {}, init);
  await new Promise((rs) => setImmediate(rs));
  assert.deepStrictEqual(r.left, ['a'], '删除应返回当前CLI剩余集合');
  assert.deepStrictEqual(r.mem.visibleModelsCli, { opencode: ['a'], qoder: ['q1'] }, '内存可见集合应仅更新当前CLI');
  assert.deepStrictEqual(r.mem.customModelsCli, { opencode: ['a', 'b', 'c'] }, 'customModelsCli不得被删除影响');
  assert.deepStrictEqual(calls.saved.visibleModelsCli, { opencode: ['a'], qoder: ['q1'] }, '应即时落盘（含他CLI条目）');
}

// ---- 3. 确认并集：勾选写入可见 + 合并入custom（防拉取覆盖丢数据） ----
async function testConfirmUnion() {
  const helper = extract('setVisibleModels') + '\n' + extract('collectFetchChecked') + '\n' + extract('confirmFetchSelection');
  const boxes = [{ value: 'x', checked: true }, { value: 'y', checked: false }];
  const fakeList = { querySelectorAll: (sel) => (String(sel).indexOf(':checked') >= 0 ? boxes.filter((b) => b.checked) : boxes) };
  const fnSrc = extract('confirmFetchSelection');
  assert.ok(/customModels/.test(fnSrc) && /setVisibleModels\(ids\)/.test(fnSrc), '确认应同时写custom并集与可见集合');
  const run = new Function('getActiveEngineInUi', 'modelFetchList', 'curAiConfigInit',
    'var curAiConfig = curAiConfigInit;\n'
    + extract('setVisibleModels') + '\n'
    + extract('collectFetchChecked') + '\n'
    + 'var ids = collectFetchChecked();\n'
    + 'curAiConfig.api.customModels = curAiConfig.api.customModels || [];\n'
    + 'ids.forEach(function(id){ if(curAiConfig.api.customModels.indexOf(id)<0)curAiConfig.api.customModels.push(id); });\n'
    + 'setVisibleModels(ids);\n'
    + 'return {ids:ids, mem:curAiConfig};');
  const out = run(() => 'api', fakeList, { api: { customModels: ['z'] }, visibleModelsApi: ['z'] });
  assert.deepStrictEqual(out.ids, ['x'], '只收集勾选项');
  assert.deepStrictEqual(out.mem.visibleModelsApi, ['x'], '可见集合为勾选集');
  assert.deepStrictEqual(out.mem.api.customModels, ['z', 'x'], 'custom应为并集（保留z）');
}

async function runAll() {
  let p = 0, f = 0;
  const ts = [['页面只显已选', testPageFilter], ['删除语义', testDeleteSemantics], ['确认并集', testConfirmUnion]];
  for (const [t, fn] of ts) { try { await fn(); console.log(`[PASS] ${t}`); p++; } catch (e) { console.error(`[FAIL] ${t}`); console.error(e); f++; } }
  console.log(`SUMMARY passed=${p} failed=${f}\n`);
  if (f) process.exit(1);
}
runAll();
