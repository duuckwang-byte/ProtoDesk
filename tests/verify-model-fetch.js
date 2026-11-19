// 模型获取弹窗 + 模型管理全量展示：可见集合、勾选态、删除语义
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
const GROUPS_ALL = [{ label: 'P', provider: 'p', models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }];
// 模拟 ACP 后端：groups 已按 visibleModelsCli 裁剪，allGroups 保留完整目录
const GROUPS_FILTERED = [{ label: 'P', provider: 'p', models: [{ id: 'b' }] }];

// ---- 1. 管理菜单只显示已选：详情仍来自 allGroups；未选不进菜单 ----
async function testManagerShowsSelected() {
  const listEl = mkListEl();
  const fake$ = () => listEl;
  const helper = 'var modelManagerListCtx=null;\nvar managerCacheGroups=[];\n' + extract('curCliId') + '\n' + extract('getCliVisibleIds') + '\n'
    + extract('modelManagerVisibleIds') + '\n' + extract('buildModelManagerHtml') + '\n'
    + extract('bindModelManagerToggles') + '\n';
  const fnSrc = helper + extract('renderModelManagerList');
  const fn = new Function('$', 'escHtml', 'escAttr', 'getActiveEngineInUi', 'window',
    fnSrc + '\nreturn renderModelManagerList({agentId:"opencode",visibleModelsCli:{opencode:["b"]}});');
  const fakeWindow = { protoAPI: { ai: { listModels: () => Promise.resolve({ ok: true, groups: GROUPS_FILTERED, allGroups: GROUPS_ALL, engine: 'cli' }) } } };
  fn(fake$, escHtml, escAttr, () => 'cli', fakeWindow);
  await new Promise((r) => setImmediate(r));
  const h = listEl.innerHTML;
  assert.ok(h.includes('data-id="b"'), '菜单应显示已选模型 b');
  assert.ok(!h.includes('data-id="a"') && !h.includes('data-id="c"'), '菜单不得显示未选模型 a/c');
  assert.ok(/value="b"[^>]*checked/.test(h), '已选项 b 应为勾选态');
  assert.ok(!h.includes('model-del'), '菜单仍不使用删除按钮');
  // 空可见集合：不显示任何模型，给出明确空态
  const listEl2 = mkListEl();
  const fn2 = new Function('$', 'escHtml', 'escAttr', 'getActiveEngineInUi', 'window',
    fnSrc + '\nreturn renderModelManagerList({agentId:"opencode",visibleModelsCli:{}});');
  fn2(() => listEl2, escHtml, escAttr, () => 'cli', fakeWindow);
  await new Promise((r) => setImmediate(r));
  const h2 = listEl2.innerHTML;
  assert.ok(!/data-id="[abc]"/.test(h2), '空可见集合时菜单不得显示未选模型');
  assert.ok(/暂未选择模型/.test(h2), '空可见集合应显示“暂未选择模型”');
  // 已选但不在当前目录：菜单保留并标注
  const listEl3 = mkListEl();
  const fn3 = new Function('$', 'escHtml', 'escAttr', 'getActiveEngineInUi', 'window',
    fnSrc + '\nreturn renderModelManagerList({agentId:"opencode",visibleModelsCli:{opencode:["b","ghost"]}});');
  fn3(() => listEl3, escHtml, escAttr, () => 'cli', fakeWindow);
  await new Promise((r) => setImmediate(r));
  const h3 = listEl3.innerHTML;
  assert.ok(h3.includes('data-id="b"') && h3.includes('data-id="ghost"'), '目录外已选项应保留');
  assert.ok(/已选（不在当前目录）/.test(h3), '目录外已选项应有分组标注');
}

// ---- 2. 菜单搜索只过滤显示，不改勾选状态 ----
function testSearchUnselected() {
  const items = ['a', 'b', 'c'].map((id) => ({ id, textContent: id, style: {}, checked: id === 'b' }));
  const listEl = mkListEl();
  listEl.querySelectorAll = (sel) => (String(sel).indexOf('.model-check-item') >= 0 ? items : []);
  const fn = new Function('$', extract('filterModelManagerList') + '\nreturn filterModelManagerList("a");');
  fn(() => listEl);
  assert.strictEqual(items[0].style.display, 'flex', '搜索 a 应命中 a');
  assert.strictEqual(items[1].style.display, 'none', '搜索 a 不应命中 b');
  assert.strictEqual(items[2].style.display, 'none', '搜索 a 不应命中 c');
  assert.deepStrictEqual(items.map((i) => i.checked), [false, true, false], '搜索不得改变勾选状态');
}

// ---- 3. 管理页勾选：只改可见集合，不动自定义列表 ----
function testManagerToggle() {
  const helper = extract('curCliId') + '\n' + extract('normalizeCliModelMaps') + '\n'
    + extract('getCliVisibleIds') + '\n' + extract('setCliVisibleIds') + '\n' + extract('applyManagerToggle');
  let persistCalls = 0;
  let config = null;
  const fn = new Function('getActiveEngineInUi', 'curAiConfigInit', 'scheduleFetchPersist', 'aiInvalidateModels', 'aiLoadModels',
    'var curAiConfig = curAiConfigInit;\n' + helper
    + '\napplyManagerToggle("a", true);\n'
    + 'var afterAdd = curAiConfig.visibleModelsCli.opencode.slice();\n'
    + 'applyManagerToggle("b", false);\n'
    + 'var afterRemove = curAiConfig.visibleModelsCli.opencode.slice();\n'
    + 'return { afterAdd: afterAdd, afterRemove: afterRemove, mem: curAiConfig };');
  const out = fn(() => 'cli', { agentId: 'opencode', visibleModelsCli: { opencode: ['b'] }, customModelsCli: { opencode: ['b'] } }, () => { persistCalls++; }, () => {}, () => {});
  assert.deepStrictEqual(out.afterAdd, ['b', 'a'], '勾选未选项应加入可见集合');
  assert.deepStrictEqual(out.afterRemove, ['a'], '取消勾选应从可见集合移除');
  assert.deepStrictEqual(out.mem.customModelsCli, { opencode: ['b'] }, '勾选/取消不应增删自定义模型列表');
  assert.strictEqual(persistCalls, 2, '每次勾选都应触发持久化调度');
  // API 侧未落盘白名单（默认全勾）：取消一项应保留其余，而非变成空数组
  const boxes = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
  const fnApi = new Function('getActiveEngineInUi', 'curAiConfigInit', 'scheduleFetchPersist', 'aiInvalidateModels', 'aiLoadModels', '$',
    'var curAiConfig = curAiConfigInit;\n' + helper
    + '\napplyManagerToggle("b", false);\nreturn (curAiConfig.visibleModelsApi||[]).slice();');
  const apiOut = fnApi(() => 'api', {}, () => {}, () => {}, () => {}, () => ({ querySelectorAll: () => boxes }));
  assert.deepStrictEqual(apiOut, ['a', 'c'], 'API 默认全勾时取消一项应得到其余模型');
}

// ---- 4. 切换 Agent 时旧列表勾选不得写入新 Agent ----
function testSyncRespectsAgent() {
  const helper = 'var modelManagerListCtx=null;\n' + extract('curCliId') + '\n' + extract('getSelectedModelIds') + '\n'
    + extract('setCliVisibleIds') + '\n' + extract('syncCurrentChecklistToMemory');
  const fakeList = {
    querySelector() { return {}; },
    querySelectorAll() { return [{ value: 'a' }]; }
  };
  const fn = new Function('$', 'getActiveEngineInUi', 'curAiConfigInit',
    'var curAiConfig=curAiConfigInit;\n' + helper
    + '\nmodelManagerListCtx={engine:"cli",agentId:"opencode"};\n'
    + 'syncCurrentChecklistToMemory();\n'
    + 'var afterOld=JSON.parse(JSON.stringify(curAiConfig.visibleModelsCli));\n'
    + 'modelManagerListCtx={engine:"cli",agentId:"claude"};\n'
    + 'syncCurrentChecklistToMemory();\n'
    + 'return {afterOld:afterOld, afterNew:JSON.parse(JSON.stringify(curAiConfig.visibleModelsCli))};');
  const out = fn(() => fakeList, () => 'cli', { agentId: 'claude', visibleModelsCli: { opencode: ['old'], claude: ['c'] } });
  assert.deepStrictEqual(out.afterOld, { opencode: ['old'], claude: ['c'] }, '切换Agent后旧列表勾选不得写入新Agent');
  assert.deepStrictEqual(out.afterNew, { opencode: ['old'], claude: ['a'] }, '当前列表勾选应写回当前Agent');
}

// ---- 5. 删除语义：只出当前 CLI 可见集合，不碰custom与其他 CLI ----
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

// ---- 6. 获取模型弹窗读取全量目录（allGroups 优先） ----
function testFetchUsesAllGroups() {
  const openSrc = extract('openModelFetch');
  assert.ok(/r\.allGroups/.test(openSrc), '获取模型弹窗应优先使用 allGroups 全量目录');
  assert.ok(/fetchCacheGroups=groups/.test(openSrc), '应把全量分组写入 fetchCacheGroups');
  const rerenderSrc = extract('renderFetchList');
  assert.ok(/fetchCacheGroups/.test(rerenderSrc), '弹窗列表应遍历 fetchCacheGroups');
  assert.ok(/type="checkbox"/.test(rerenderSrc), '弹窗应有勾选框');
}

// ---- 7. 确认并集：勾选写入可见 + 合并入custom（防拉取覆盖丢数据） ----
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
  const ts = [
    ['管理菜单只显示已选 + 空态/目录外保留', testManagerShowsSelected],
    ['菜单搜索只过滤显示、不改勾选', testSearchUnselected],
    ['管理菜单勾选只改可见集合', testManagerToggle],
    ['切换Agent不串写勾选', testSyncRespectsAgent],
    ['删除语义', testDeleteSemantics],
    ['获取模型弹窗使用全量目录', testFetchUsesAllGroups],
    ['确认并集', testConfirmUnion],
  ];
  for (const [t, fn] of ts) { try { await fn(); console.log(`[PASS] ${t}`); p++; } catch (e) { console.error(`[FAIL] ${t}`); console.error(e); f++; } }
  console.log(`SUMMARY passed=${p} failed=${f}\n`);
  if (f) process.exit(1);
}
runAll();
