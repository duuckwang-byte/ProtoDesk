'use strict';
// T7c 前端验证（纯 Node / CommonJS，无 Electron、无真实 DOM）
// 覆盖：acp_catalog 事件分支与 agentId 过滤 / 模型列表与默认值更新 /
//       refreshing-stale 按钮文案 / 会话 agentId 持久化与回填 /
//       acp_config 跨 Agent、跨 uiSession 不写当前 UI / 缓存 key 含 agent+ui+acp /
//       权限卡 agentId 归属 / CSS 纯色无渐变无 emoji。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const jsContent = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const cssContent = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version}`);

function extractFn(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, `[提取失败] function ${name}`);
  return m[0];
}
function escHtmlStub(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 断言1：acp_catalog 路由、agentId 过滤、状态字段 ----------
function test1_CatalogEvent() {
  const branch = jsContent.match(/ev\.type==='acp_catalog'[\s\S]{0,220}aiApplyCatalogEvent/);
  assert.ok(branch, 'onEvent 应存在 acp_catalog 分支');
  assert.ok(!/ev\.type==='acp_catalog'[\s\S]{0,220}acp_config/.test(branch[0]), 'acp_catalog 不得落入 acp_config 分支');

  const apply = extractFn(jsContent, 'aiApplyCatalogEvent');
  assert.ok(/ev\.agentId/.test(apply), 'acp_catalog 应读取 ev.agentId');
  assert.ok(/aid!==cur/.test(apply) && /aiModelCatalogByAgent/.test(apply), '跨 Agent 事件应仅写按 agent 的缓存');
  assert.ok(/defaultModel/.test(apply), '应读取 defaultModel 更新默认模型');
  assert.ok(/stale/.test(apply) && /source/.test(apply), '应更新 stale/source 状态');
  assert.ok(/warning/.test(apply) && /error/.test(apply), '应读取 warning/error');
  assert.ok(/refreshing:false/.test(apply), '刷新完成后应清除 refreshing');
  assert.ok(/parsed\.count/.test(apply), '空模型列表应走保护分支');
  assert.ok(!/deepseek-chat/.test(apply), '不得回落硬编码模型');

  const load = extractFn(jsContent, 'aiLoadModels');
  assert.ok(/r\.refreshing/.test(load), 'aiLoadModels 应读取 refreshing');
  assert.ok(/r\.stale/.test(load), 'aiLoadModels 应读取 stale');
  assert.ok(/r\.source/.test(load), 'aiLoadModels 应读取 source');
  assert.ok(/r\.catalogWarning/.test(load), 'aiLoadModels 应读取 catalogWarning');
  assert.ok(/正在读取模型列表…/.test(load), '加载慢时应显示正在读取模型列表…');
  assert.ok(/模型目录不可用/.test(extractFn(jsContent, 'aiApplyModelsFailure')), 'ok:false 应显示模型目录不可用');
}

// ---------- 断言2：目录更新保留已选合法模型、空列表不退化 ----------
function test2_CatalogBehavior() {
  const catalogSrc = [extractFn(jsContent, 'aiCatalogGroups'), extractFn(jsContent, 'aiApplyCatalogEvent')].join('\n');
  const renderSrc = extractFn(jsContent, 'aiRenderModelOptions')
    .replace('function aiRenderModelOptions', 'function aiRenderModelOptionsReal');
  const initial = {
    ok: true,
    transport: 'acp',
    groups: [{ label: 'Agent', models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }] }],
    default: 'm1'
  };
  const harness = `
    var aiModelCache = __initial;
    var aiModelTransport = 'acp';
    var aiModelCatalog = { refreshing:false, stale:false, source:'', warning:'', error:'', agentId:'opencode' };
    var aiModelCatalogByAgent = {};
    var aiModelError = '';
    var aiModelErrorDetail = '';
    var aiModelEl = { innerHTML:'', value:'m2', disabled:false, title:'' };
    var aiBusy = false;
    var selectedModel = 'm2';
    var rendered = null, syncCount = 0, traces = [];
    function aiAgentIdNow(){ return 'opencode'; }
    function aiSyncModelBtn(){ syncCount++; }
    function aiAppendTrace(t){ traces.push(t); }
    function aiStoredModel(){ return selectedModel; }
    function aiStoreModel(m){ selectedModel = String(m || ''); }
    function aiRenderCascader(){}
    ${renderSrc}
    function aiRenderModelOptions(r){ rendered = r; aiRenderModelOptionsReal(r); }
    ${catalogSrc}
    return {
      run: aiApplyCatalogEvent,
      groups: aiCatalogGroups,
      cache: function(){ return aiModelCache; },
      state: function(){ return aiModelCatalog; },
      rendered: function(){ return rendered; },
      html: function(){ return aiModelEl.innerHTML; },
      value: function(){ return aiModelEl.value; },
      traces: function(){ return traces; },
      syncs: function(){ return syncCount; },
      byAgent: function(){ return aiModelCatalogByAgent; }
    };
  `;
  const api = new Function('__initial', 'escHtml', harness)(initial, escHtmlStub);

  assert.strictEqual(api.groups({ models: ['a', 'b'] }).count, 2, '字符串/对象模型应归一化');
  assert.strictEqual(api.run({ type: 'acp_catalog', agentId: 'claude', models: [{ id: 'c1' }] }), false, '跨 Agent 事件不得更新当前 UI');
  assert.strictEqual(api.rendered(), null, '跨 Agent 事件不得重渲染模型列表');
  assert.ok(api.byAgent().claude, '跨 Agent 事件应仅写入按 agent 缓存');

  const changed = api.run({
    type: 'acp_catalog', agentId: 'opencode', defaultModel: 'm1', stale: true, source: 'cache',
    models: [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }, { id: 'm3', name: 'M3' }]
  });
  assert.strictEqual(changed, true, '当前 Agent 事件应更新 UI');
  assert.strictEqual(api.rendered().groups[0].models.length, 3, '模型列表应更新为 3 项');
  assert.strictEqual(api.rendered().default, 'm1', '默认模型应跟随 defaultModel');
  assert.ok(api.html().includes('m3') && api.html().includes('m1'), '下拉应包含新模型');
  assert.strictEqual(api.value(), 'm2', '用户已选且仍合法的模型应保留');
  assert.ok(/value="m2" selected/.test(api.html()), '保留下来的模型应保持 selected');
  assert.strictEqual(api.state().stale, true, 'stale 状态应更新');
  assert.strictEqual(api.state().source, 'cache', 'source 状态应更新');
  assert.ok(api.syncs() > 0, '目录更新后应刷新按钮状态');

  const before = api.cache();
  const empty = api.run({ type: 'acp_catalog', agentId: 'opencode', models: [], error: '目录刷新失败', stale: false });
  assert.strictEqual(empty, true, '当前 Agent 的空目录事件仍被消费');
  assert.strictEqual(api.cache(), before, '空模型列表不得清空/替换既有列表');
  assert.strictEqual(api.state().error, '目录刷新失败', 'error 应反映到按钮状态');
  assert.ok(api.traces().some((t) => t && /目录刷新失败/.test(t.text)), 'error 应写 trace');
  assert.ok(!/<option value="default">/.test(api.html()), '不得静默退化成单模型 fallback');

  /* 无旧列表 + 空目录：显式不可用，不伪造单模型 */
  const emptyApi = new Function('__initial', 'escHtml', harness)(null, escHtmlStub);
  emptyApi.run({ type: 'acp_catalog', agentId: 'opencode', models: [], warning: '空目录' });
  assert.ok(/模型目录不可用/.test(emptyApi.html()), '无旧列表时应显示模型目录不可用');
  assert.ok(!/<option value="default">/.test(emptyApi.html()), '无旧列表时不得伪造默认单模型');
  assert.strictEqual(emptyApi.state().warning, '空目录', 'warning 应保留到按钮状态');
}

// ---------- 断言3：模型按钮 refreshing / stale 文案 ----------
function test3_ButtonState() {
  const src = extractFn(jsContent, 'aiSyncModelBtn');
  assert.ok(/刷新中…/.test(src), '按钮应显示刷新中…');
  assert.ok(/缓存/.test(src), '按钮应显示缓存');
  assert.ok(/目录异常/.test(src), '按钮应显示目录异常');
  assert.ok(/aiModelCatalogState/.test(src), '状态徽标应有独立元素');

  function makeEl(id) {
    return {
      id: id || '', className: '', textContent: '', title: '', style: {}, disabled: false,
      children: [], parentNode: null,
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      insertBefore(c) { c.parentNode = this; this.children.push(c); return c; }
    };
  }
  const btn = makeEl('aiModelBtn'), txt = makeEl('aiModelNameTxt'), badge = makeEl('aiModelEffortBadge');
  const acp = makeEl('aiModelAcpBadge'), state = makeEl('aiModelCatalogState');
  txt.parentNode = btn; acp.parentNode = btn; state.parentNode = btn;
  const cache = { groups: [{ models: [{ id: 'm2', name: 'M2' }] }] };
  const make = new Function('$', 'document', 'aiBusy', 'aiModelCache', 'aiModelCatalog', 'aiModelError',
    'aiModelErrorDetail', 'aiModelTransport', 'aiCurModel', 'aiCurReasoning', 'aiReasoningBadgeText',
    src + '\nreturn aiSyncModelBtn;');
  const run = make(
    (id) => ({ aiModelBtn: btn, aiModelNameTxt: txt, aiModelEffortBadge: badge, aiModelAcpBadge: acp, aiModelCatalogState: state }[id] || null),
    { createElement: () => makeEl() }, false, cache, { refreshing: true, stale: false, source: '', warning: '', error: '' },
    '', '', 'acp', () => 'm2', () => 'default', () => '默认'
  );

  run();
  assert.strictEqual(state.textContent, '刷新中…', '刷新中状态应显示在按钮');
  assert.strictEqual(state.style.display, 'inline-block');

  const later = make(
    (id) => ({ aiModelBtn: btn, aiModelNameTxt: txt, aiModelEffortBadge: badge, aiModelAcpBadge: acp, aiModelCatalogState: state }[id] || null),
    { createElement: () => makeEl() }, false, cache, { refreshing: false, stale: true, source: 'cache', warning: '', error: '' },
    '', '', 'acp', () => 'm2', () => 'default', () => '默认'
  );
  later();
  assert.strictEqual(state.textContent, '缓存', '缓存目录应显示缓存状态');

  const broken = make(
    (id) => ({ aiModelBtn: btn, aiModelNameTxt: txt, aiModelEffortBadge: badge, aiModelAcpBadge: acp, aiModelCatalogState: state }[id] || null),
    { createElement: () => makeEl() }, false, cache, { refreshing: false, stale: false, source: '', warning: '', error: 'boom' },
    '', '', 'acp', () => 'm2', () => 'default', () => '默认'
  );
  broken();
  assert.strictEqual(state.textContent, '目录异常', '目录错误应显示目录异常');
  assert.ok(/err/.test(state.className), '错误状态应使用 err 样式');
  assert.strictEqual(state.title, 'boom', '错误详情应写入 title');

  const loading = make(
    (id) => ({ aiModelBtn: btn, aiModelNameTxt: txt, aiModelEffortBadge: badge, aiModelAcpBadge: acp, aiModelCatalogState: state }[id] || null),
    { createElement: () => makeEl() }, false, null, { refreshing: true, stale: false, source: '', warning: '', error: '' },
    '', '', '', () => '', () => 'default', () => '默认'
  );
  loading();
  assert.strictEqual(txt.textContent, '正在读取模型列表…', '无缓存且加载慢时应显示正在读取模型列表…');
}

// ---------- 断言4：会话 agentId 持久化 / 回填 / 不跟随切换 ----------
function test4_SessionAgent() {
  assert.ok(/sess\.agentId=aiSession\.agentId/.test(jsContent), 'aiSaveSesh 应持久化 agentId');
  assert.ok(/sess\.agentName=aiSession\.agentName/.test(jsContent), 'aiSaveSesh 应持久化 agentName');
  const doSrc = extractFn(jsContent, 'aiDoSend');
  assert.ok(/aiBindSessionAgent\(s,null\)/.test(doSrc), '首次发送应写入会话 Agent 归属');
  const apply = extractFn(jsContent, 'aiApplySessionEvent');
  assert.ok(/aiBindSessionAgent\(s,ev\)/.test(apply), 'session 事件应写入 Agent 归属');
  assert.ok(/aiEventMatchesSession\(s,ev\)/.test(apply), 'session 事件应校验归属');

  const bindSrc = extractFn(jsContent, 'aiBindSessionAgent');
  const make = new Function('aiAgentIdNow', 'aiAgentNameOf', bindSrc + '\nreturn aiBindSessionAgent;');
  const bind = make(() => 'opencode', (id) => (id === 'opencode' ? 'OpenCode CLI' : id));

  const s = {};
  bind(s, { agentId: 'claude', agentName: 'Claude Code', workdir: 'D:\\w1' });
  assert.strictEqual(s.agentId, 'claude', '会话首次收到事件时应采用事件里的 agentId');
  assert.strictEqual(s.agentName, 'Claude Code');
  assert.strictEqual(s.agentWorkdir, 'D:\\w1', 'workdir 应随会话记录');

  bind(s, { agentId: 'opencode', agentName: 'OpenCode CLI' });
  assert.strictEqual(s.agentId, 'claude', '已有归属不跟随其他 Agent 事件切换');
  assert.strictEqual(s.agentName, 'Claude Code', '已有归属的 agentName 不应被覆盖');

  const empty = {};
  const bindNoCfg = make(() => '', (id) => id);
  bindNoCfg(empty, { agentId: 'codex', agentName: 'OpenAI Codex' });
  assert.strictEqual(empty.agentId, 'codex', '无当前配置时应从事件写入');
  assert.strictEqual(empty.agentName, 'OpenAI Codex');

  const fallback = {};
  bind(fallback, null);
  assert.strictEqual(fallback.agentId, 'opencode', '事件无归属时才用当前 Agent 回填');
}

// ---------- 断言5：acp_config 跨 Agent / 跨 uiSession 只写缓存 ----------
function test5_AcpConfigIsolation() {
  const keySrc = extractFn(jsContent, 'aiAcpConfigKey');
  const handlerSrc = extractFn(jsContent, 'aiHandleAcpConfig');
  const helperSrc = extractFn(jsContent, 'aiAcpOptionsModel') + '\n' + extractFn(jsContent, 'aiAcpModelMatches');
  const refreshSrc = extractFn(jsContent, 'aiRefreshCascaderReasoning');
  const make = new Function('window', 'aiCurSesh', 'aiCurModel', 'aiStoreModel', 'aiModelEl',
    'aiSyncModelBtn', 'aiAppendTrace', 'aiSaveSesh',
    'var __cascades=0; var aiModelCache={groups:[]}; function aiRenderCascader(){__cascades++;}'
    + keySrc + '\n' + helperSrc + '\n' + handlerSrc + '\n' + refreshSrc
    + '\nreturn { key: aiAcpConfigKey, run: aiHandleAcpConfig, cascades:function(){return __cascades;} };');
  const win = {};
  const session = { id: 'ui1', agentId: 'opencode', agentName: 'OpenCode CLI' };
  const traces = [];
  let saves = 0;
  const modelEl = { value: 'm-current' };
  const api = make(win, () => session, () => modelEl.value, () => {}, modelEl, () => {}, (t) => traces.push(t), () => { saves += 1; });

  const key = api.key({ agentId: 'opencode', uiSessionId: 'ui1', sessionId: 'acp-1' });
  assert.strictEqual(key, 'agent:opencode|ui:ui1|acp:acp-1', '缓存 key 应含 agent+ui+acp');
  assert.notStrictEqual(key, 'ui1', '缓存 key 不得只按 sessionId');

  const foreign = api.run({
    type: 'acp_config', agentId: 'claude', agentName: 'Claude Code', uiSessionId: 'ui1', sessionId: 'acp-9',
    model: 'claude/new', configOptions: [{ id: 'mode', category: 'mode', options: [{ value: 'code' }] }],
    warnings: ['跨 Agent 警告'], transport: 'acp'
  });
  assert.ok(win.__acpConfig['agent:claude|ui:ui1|acp:acp-9'], '跨 Agent 配置应写入缓存');
  assert.strictEqual(win.__acpConfig.__latest, foreign, '__latest 仍指向最近事件');
  assert.ok(!session.acpConfigOptions, '跨 Agent 事件不得写当前会话 UI');
  assert.strictEqual(modelEl.value, 'm-current', '跨 Agent 事件不得改当前模型');
  assert.strictEqual(saves, 0, '跨 Agent 事件不得落当前会话');
  assert.strictEqual(traces.length, 0, '跨 Agent warnings 不得污染当前 trace');
  assert.strictEqual(api.cascades(), 0, '跨 Agent 事件不得刷新当前级联');

  const foreignUi = api.run({
    type: 'acp_config', agentId: 'opencode', uiSessionId: 'ui-other', model: 'm-other',
    configOptions: [{ id: 'mode', category: 'mode', options: [{ value: 'ask' }] }]
  });
  assert.ok(win.__acpConfig['agent:opencode|ui:ui-other'], '跨 uiSession 配置应写入缓存');
  assert.ok(!session.acpConfigOptions, '跨 uiSession 事件不得写当前会话 UI');
  assert.strictEqual(modelEl.value, 'm-current', '跨 uiSession 事件不得改当前模型');

  const own = api.run({
    type: 'acp_config', agentId: 'opencode', agentName: 'OpenCode CLI', uiSessionId: 'ui1', sessionId: 'acp-1',
    model: 'own/model', thoughtConfigId: 'thought_level', thoughtValue: 'max',
    configOptions: [{ id: 'thought_level', category: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }, { value: 'max' }] }],
    warnings: ['模型未能验证'], transport: 'acp'
  });
  assert.ok(own, '当前事件应返回 entry');
  assert.strictEqual(session.acpConfigOptions.length, 1, '当前事件应更新会话 configOptions');
  assert.strictEqual(session.acpThoughtConfigId, 'thought_level', '当前事件应记录思考 configId');
  assert.strictEqual(session.acpThoughtValue, 'max', '当前事件应记录思考值');
  assert.strictEqual(api.cascades(), 1, 'acp_config 到达后应刷新模型级联思考项');
  assert.strictEqual(modelEl.value, 'own/model', '当前事件应更新模型');
  assert.ok(saves >= 1, '当前事件应保存会话');
  assert.ok(traces.some((t) => t && /模型未能验证/.test(t.text)), '当前 warnings 应写 trace');
}

// ---------- 断言6：aiAcpConfigSource 先按 agentId 过滤 ----------
function test6_ConfigSourceAgentFilter() {
  const src = extractFn(jsContent, 'aiAcpConfigSource');
  assert.ok(/sesAgent/.test(src), 'aiAcpConfigSource 应先解析当前 Agent');
  assert.ok(/agentOk/.test(src), 'aiAcpConfigSource 应按 agentId 过滤');
  assert.ok(/usable\(latest\)/.test(src), '__latest 也应做 agentId 过滤');
  assert.ok(!/aiAgentIdNow/.test(src), '会话 agentId 为空时不得用全局配置 Agent 过滤候选');

  const make = new Function('window', src + '\nreturn aiAcpConfigSource;');
  const win = {
    __acpConfig: {
      'agent:opencode|ui:ui1': { agentId: 'opencode', uiSessionId: 'ui1', configOptions: [{ id: 'oc' }] },
      'agent:agy|ui:ui1': { agentId: 'agy', uiSessionId: 'ui1', configOptions: [{ id: 'agy' }] },
      __latest: { agentId: 'agy', uiSessionId: 'ui1', configOptions: [{ id: 'agy-latest' }] }
    }
  };
  const source = make(win);
  assert.deepStrictEqual(source({ id: 'ui1', agentId: 'opencode' }), [{ id: 'oc' }], '同 uiSession 也必须按 agentId 命中');
  assert.deepStrictEqual(source({ id: 'ui1', agentId: 'agy' }), [{ id: 'agy' }], '另一个 Agent 应命中自己的缓存');
  assert.deepStrictEqual(source({ id: 'ui-miss', agentId: 'opencode' }), [], '跨 Agent __latest 不得作为当前会话兜底');
  assert.deepStrictEqual(source({ id: 'ui1' }), [{ id: 'oc' }], '会话 agentId 为空时不得被 agentId 过滤排除，应按 uiSessionId 命中');
}

// ---------- 断言7：权限卡 agentId 归属 ----------
function test7_PermissionAgent() {
  const normalize = extractFn(jsContent, 'permNormalize');
  assert.ok(/['"]agentId['"],\s*['"]agentName['"],\s*['"]workdir['"]/.test(normalize), '权限 payload 应记录 agentId/agentName/workdir');
  const build = extractFn(jsContent, 'permBuildCard');
  assert.ok(/data-agent-id/.test(build), '权限卡应写 data-agent-id');
  assert.ok(/perm-agent/.test(build), '权限卡应展示 Agent 归属行');
  const request = extractFn(jsContent, 'permRequest');
  assert.ok(/aiEventMatchesSession/.test(request), '权限请求应校验当前 Agent/会话');
  assert.ok(/__acpPendingPermissions/.test(request), '跨 Agent 权限请求应只入缓存');

  const make = new Function('window', 'aiCurSesh', 'aiEventMatchesSession', 'aiAppendTrace', `
    var permLive = {}, permResolvedEarly = {}, permSeq = 0;
    var built = 0, pushed = 0;
    function permNormalize(ev){ return { id: String(ev.id || ''), agentId: String(ev.agentId || '') }; }
    function permHost(){ return null; }
    function permBuildCard(){ built++; return { wrap: {}, entry: { state: 'pending' } }; }
    function permPushEvent(){ pushed++; }
    function permMergeState(p){ return p; }
    function i5TlScroll(){}
    ${request}
    return { run: permRequest, built: function(){ return built; }, pushed: function(){ return pushed; }, live: permLive };
  `);
  const win = {};
  const session = { id: 'ui1', agentId: 'opencode' };
  const match = (s, ev) => {
    if (String(ev.agentId || '') && s.agentId && String(ev.agentId) !== String(s.agentId)) return false;
    if (String(ev.uiSessionId || '') && s.id && String(ev.uiSessionId) !== String(s.id)) return false;
    return true;
  };
  const traces = [];
  const api = make(win, () => session, match, (t) => traces.push(t));

  assert.strictEqual(api.run({ id: 'p-foreign', agentId: 'claude', uiSessionId: 'ui1' }), false, '跨 Agent 权限请求不得弹当前卡');
  assert.strictEqual(api.built(), 0, '跨 Agent 权限请求不得构建卡片');
  assert.ok(win.__acpPendingPermissions && win.__acpPendingPermissions['claude|ui1|p-foreign'], '跨 Agent 权限请求应入缓存');
  assert.ok(traces.some((t) => t && /权限请求/.test(t.text)), '跨 Agent 权限请求应有提示');

  assert.strictEqual(api.run({ id: 'p-own', agentId: 'opencode', uiSessionId: 'ui1' }), true, '当前 Agent 权限请求应弹卡');
  assert.strictEqual(api.built(), 1, '当前 Agent 应构建一张卡');
  assert.ok(api.live['p-own'], '当前权限卡应进入 permLive');
}

// ---------- 断言8：CSS 纯色、无渐变、无 emoji ----------
function test8_Css() {
  const start = cssContent.indexOf('/* T7c');
  const end = cssContent.indexOf('/* 主弹层', start + 1);
  assert.ok(start >= 0 && end > start, 'app.css 应提供 T7c 状态样式块');
  const block = cssContent.slice(start, end);
  for (const cls of ['.ai-model-catalog-state{', '.ai-model-catalog-state.warn', '.ai-model-catalog-state.err', '.perm-agent{']) {
    assert.ok(block.includes(cls), `缺少样式 ${cls}`);
  }
  assert.ok(!/gradient/i.test(block), 'T7c 样式不得使用渐变');
  const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/[^\x00-\x7F]/.test(codeOnly), 'T7c 样式不得包含 emoji 或非 ASCII 装饰字符');
  assert.ok(!/gradient/i.test(cssContent), 'app.css 整体不得引入渐变');
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(cssContent), 'app.css 不得包含 emoji');
}

const cases = [
  ['acp_catalog 分支 / agentId 过滤 / 状态字段', test1_CatalogEvent],
  ['目录更新保留已选模型 / 空列表不退化', test2_CatalogBehavior],
  ['模型按钮刷新中 / 缓存 / 异常文案', test3_ButtonState],
  ['会话 agentId 持久化 / 回填 / 不跟随切换', test4_SessionAgent],
  ['acp_config 跨 Agent / 跨 uiSession 隔离', test5_AcpConfigIsolation],
  ['aiAcpConfigSource 按 agentId 过滤', test6_ConfigSourceAgentFilter],
  ['权限卡 agentId 归属 / 跨 Agent 不弹卡', test7_PermissionAgent],
  ['CSS 纯色无渐变无 emoji', test8_Css]
];

let passed = 0;
let failed = 0;
for (const [title, fn] of cases) {
  try {
    fn();
    console.log(`[PASS] ${title}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${title}`);
    console.error(err);
    failed++;
  }
}
console.log(`SUMMARY passed=${passed} failed=${failed}\n`);
if (failed > 0) process.exit(1);
