'use strict';
// T5b-frontend ACP 配置选择器验证（纯 Node / CommonJS，无 Electron、无真实 DOM）
// 覆盖：category 映射与 model 跳过 / configOptions 归一化 / 底栏渲染函数 /
//       s.acpConfig 落盘与恢复 / aiDoSend extra.acpConfig / 思考强度 reasoning 映射 /
//       CSS 纯色无渐变无 emoji。
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

// ---------- 轻量 DOM 桩：只覆盖选择器渲染所需的最小能力 ----------
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    className: '',
    title: '',
    textContent: '',
    value: '',
    disabled: false,
    style: {},
    children: [],
    parentNode: null,
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      const idx = el.children.indexOf(ref);
      if (idx < 0) el.children.push(child);
      else el.children.splice(idx, 0, child);
      child.parentNode = el;
      return child;
    },
    setAttribute(key, value) { el[key] = value; },
    getAttribute(key) { return el[key] == null ? null : el[key]; },
    querySelector() { return null; },
    classList: { add() {}, remove() {}, contains() { return false; } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(value) {
      el._html = String(value || '');
      if (value === '') {
        for (const child of el.children) child.parentNode = null;
        el.children.length = 0;
      }
    }
  });
  return el;
}

function selectOf(box) {
  return box.children.find((child) => child.tagName === 'SELECT') || null;
}

// ---------- 断言1：category 映射与 model 跳过 ----------
function test1_CategoryMapping() {
  const kindSrc = extractFn(jsContent, 'aiAcpConfigKind');
  assert.ok(/category===\s*'model_config'/.test(kindSrc), 'model_config 应有独立映射');
  assert.ok(/category===\s*'thought_level'/.test(kindSrc), 'thought_level 应映射思考强度');
  assert.ok(/reasoning_effort/.test(kindSrc), 'reasoning_effort 应映射思考强度');
  assert.ok(/category===\s*'mode'/.test(kindSrc), 'mode 应映射模式');
  assert.ok(/category===\s*'model'/.test(kindSrc) && /idLower===\s*'model'/.test(kindSrc), 'model 与 id=model 均应跳过');
  assert.ok(/key:\s*'generic'/.test(kindSrc), '未知 category 应回落通用选择器');

  const kind = new Function(kindSrc + '\nreturn aiAcpConfigKind;')();
  assert.strictEqual(kind({ id: 'model', category: 'model' }), null, 'category=model 应跳过');
  assert.strictEqual(kind({ id: 'model', category: 'anything' }), null, 'id=model 应跳过');
  assert.strictEqual(kind({ category: 'model_config' }), null, '缺少 id 的配置项应跳过');

  const context = kind({ id: 'context_size', category: 'model_config', name: '上下文大小' });
  assert.strictEqual(context.key, 'model_config', 'model_config 应保留独立类型');
  assert.strictEqual(context.label, '上下文大小', 'model_config 应优先使用 Agent 返回的名称');

  const thought = kind({ id: 'thought_level', category: 'thought_level' });
  assert.strictEqual(thought.key, 'thought_level', 'thought_level 应映射思考强度');
  assert.strictEqual(thought.label, '思考强度');
  assert.strictEqual(kind({ id: 'reasoning_effort' }).key, 'thought_level', '无 category 时 reasoning_effort 也应识别');

  const mode = kind({ id: 'mode', category: 'mode' });
  assert.strictEqual(mode.key, 'mode', 'mode 应映射模式');
  assert.strictEqual(mode.label, '模式');

  const custom = kind({ id: 'speed_quality', category: 'speed', name: '速度质量' });
  assert.strictEqual(custom.key, 'generic', '未知 category 应走通用选择器');
  assert.strictEqual(custom.label, '速度质量', '通用选择器应显示 Agent 名称');
}

// ---------- 断言2：configOptions 归一化、跳过 model、去重 ----------
function test2_ConfigItems() {
  const src = extractFn(jsContent, 'aiAcpConfigSource') + '\n' + extractFn(jsContent, 'aiAcpConfigKind')
    + '\n' + extractFn(jsContent, 'aiAcpBoolValue') + '\n' + extractFn(jsContent, 'aiAcpConfigNormalizeItem')
    + '\n' + extractFn(jsContent, 'aiAcpConfigItems');
  const make = new Function('window', src + '\nreturn aiAcpConfigItems;');
  const win = {};
  const items = make(win)({
    id: 'ui1',
    acpConfigOptions: [
      { id: 'model', category: 'model', options: [{ value: 'm1' }] },
      {
        id: 'context_size', category: 'model_config', name: '上下文大小', currentValue: '200000',
        options: [{ value: '200000', name: '200K' }, { value: 200000, name: '重复值' }, { value: '1000000', name: '1M' }]
      },
      { id: 'thought_level', category: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] },
      { id: 'mode', category: 'mode', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] },
      { id: 'weird', category: 'unknown_category', name: '自定义', options: [{ value: 'a', label: 'A' }] },
      { id: 'empty', category: 'unknown_category', options: [] },
      { id: '', category: 'mode', options: [{ value: 'x' }] }
    ]
  });
  assert.deepStrictEqual(items.map((item) => item.id), ['context_size', 'thought_level', 'mode', 'weird'], '只保留有 id/options 的非模型项');
  assert.strictEqual(items[0].options.length, 2, '数值 currentValue/option 不应重复');
  assert.strictEqual(items[0].options[0].label, '200K', '应保留 Agent 返回的 option 名称');
  assert.strictEqual(items[0].options[1].value, '1000000', '去重后应保留其他合法选项');
  assert.strictEqual(items[1].options[2].label, 'Max', '思考强度应显示 Agent 返回的 max');

  // configOptions 缺失时从 window.__acpConfig 按 uiSessionId 找回
  const win2 = {
    __acpConfig: {
      __latest: { configOptions: [{ id: 'mode', category: 'mode', options: [{ value: 'ask' }] }] },
      'agent:agy|ui:ui2': {
        uiSessionId: 'ui2',
        configOptions: [{ id: 'thought_level', category: 'thought_level', options: [{ value: 'max' }] }]
      }
    }
  };
  const restored = make(win2)({ id: 'ui2' });
  assert.strictEqual(restored.length, 1, '应从 window.__acpConfig 恢复配置项');
  assert.strictEqual(restored[0].id, 'thought_level', '应按 uiSessionId 命中对应会话配置');

  // 新会话不得复用其他会话的 __latest
  const win3 = {
    __acpConfig: {
      __latest: { uiSessionId: 'other', configOptions: [{ id: 'mode', category: 'mode', options: [{ value: 'ask' }] }] }
    }
  };
  assert.strictEqual(make(win3)({ id: 'fresh-session' }).length, 0, '新会话不得复用其他会话的可选项');
}

// ---------- 断言3：渲染函数存在、插入底栏、不触发立即请求 ----------
function test3_RenderFunction() {
  const render = extractFn(jsContent, 'aiRenderAcpConfig');
  assert.ok(/document\.querySelector\('\.ai-foot-actions'\)/.test(render), '选择器容器应挂到 .ai-foot-actions');
  assert.ok(/insertBefore\(wrap,anchor\.nextSibling\)/.test(render), '应插在模型级联右侧');
  assert.ok(/className='ai-acp-config'/.test(render), '容器应使用 ai-acp-config 类');
  assert.ok(/className='ai-acp-config-select'/.test(render), '应渲染紧凑 select');
  assert.ok(/data-acp-config-id/.test(render), '每个选择器应带 configId');
  assert.ok(/sel\.onchange=function\(\)/.test(render), '选择器应绑定 onchange');
  assert.ok(/cur\.acpConfig\[item\.id\]=v/.test(render), '选择值应写入当前会话 acpConfig');
  assert.ok(!/protoAPI|\.ask\(|aiDoSend\(/.test(render), '选择器不得触发立即请求');
}

// ---------- 断言4：s.acpConfig 落盘 ----------
function test4_Persist() {
  assert.ok(/sess\.acpConfig=aiSession\.acpConfig/.test(jsContent), 'aiSaveSesh 应持久化 acpConfig');
  assert.ok(/aiSession\.acpConfig&&typeof aiSession\.acpConfig==='object'/.test(jsContent), '只持久化 plain object');
  const render = extractFn(jsContent, 'aiRenderAcpConfig');
  assert.ok(/typeof aiSaveSesh==='function'\)aiSaveSesh\(\)/.test(render), '选择变更后应调用 aiSaveSesh');
}

// ---------- 断言5：aiDoSend extra.acpConfig + 思考强度 reasoning ----------
function test5_SendExtra() {
  const doSrc = extractFn(jsContent, 'aiDoSend');
  assert.ok(/acpConfig:\s*s\.acpConfig\s*\|\|\s*\{\}/.test(doSrc), 'ask extra 应传 acpConfig: s.acpConfig || {}');
  assert.ok(/reasoning:\(typeof aiCurReasoning==='function'\?aiAcpReasoning\(s\)/.test(doSrc), 'reasoning 应优先使用 ACP 思考强度选择');
  const reasonSrc = extractFn(jsContent, 'aiAcpReasoning');
  assert.ok(/cfg\.thought_level\|\|cfg\.reasoning_effort\|\|cfg\.effort\|\|cfg\.thinking/.test(reasonSrc), '思考强度 key 应覆盖后端候选');
  assert.ok(/aiCurReasoning\(\)/.test(reasonSrc), '无 ACP 选择时应沿用级联选择器记录');
  assert.ok(/acpSessionId:_acpSid/.test(doSrc), '既有 acpSessionId 透传不得回退');
}

// ---------- 断言6：会话切换/重开恢复 + currentValue 回落 ----------
function test6_Restore() {
  const calls = (jsContent.match(/typeof aiRenderAcpConfig==='function'\)aiRenderAcpConfig\(\)/g) || []).length;
  assert.ok(calls >= 6, `acp_config 事件/会话切换/重开均应恢复选择器，实测 ${calls} 处`);

  const setSess = jsContent.slice(jsContent.indexOf('function setActiveSession'), jsContent.indexOf('function createSession'));
  assert.ok(/aiRenderAcpConfig/.test(setSess), '会话切换应恢复选择器');
  const createSess = jsContent.slice(jsContent.indexOf('function createSession'), jsContent.indexOf('function deleteSession'));
  assert.ok(/aiRenderAcpConfig/.test(createSess), '新建会话应恢复选择器');
  const openSrc = jsContent.slice(jsContent.indexOf('function openAi()'), jsContent.indexOf('function closeAi'));
  assert.ok(/aiRenderAcpConfig/.test(openSrc), '重开 AI 弹窗应恢复选择器');
  const handler = extractFn(jsContent, 'aiHandleAcpConfig');
  assert.ok(/s\.acpConfigOptions=entry\.configOptions/.test(handler), 'acp_config 应更新会话可选项');
  assert.ok(/aiRenderAcpConfig/.test(handler), 'acp_config 到达后应刷新选择器');

  const resolveSrc = extractFn(jsContent, 'aiAcpConfigResolve');
  assert.ok(/currentValue/.test(resolveSrc), '应回落 currentValue');
  const resolve = new Function(resolveSrc + '\nreturn aiAcpConfigResolve;')();
  const item = { id: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }, { value: 'max' }] };
  assert.deepStrictEqual(resolve(item, { thought_level: 'max' }), { value: 'max', stale: false }, '合法已选值应保留');
  assert.deepStrictEqual(resolve(item, { thought_level: 'removed' }), { value: 'high', stale: true }, '非法已选值应回落 currentValue');
  assert.deepStrictEqual(resolve(item, {}), { value: 'high', stale: false }, '未选择时显示 currentValue');
  const noCurrent = { id: 'mode', options: [{ value: 'ask' }, { value: 'code' }] };
  assert.deepStrictEqual(resolve(noCurrent, { mode: 'gone' }), { value: 'ask', stale: true }, '无 currentValue 时回落第一项');
}

// ---------- 断言7：CSS 纯色、无渐变、无 emoji ----------
function test7_Css() {
  const start = cssContent.indexOf('/* T5b ACP');
  const end = cssContent.indexOf('/* 主弹层', start + 1);
  assert.ok(start >= 0 && end > start, 'app.css 应提供 T5b 选择器样式块');
  const block = cssContent.slice(start, end);
  for (const cls of ['.ai-acp-config{', '.ai-acp-config-item{', '.ai-acp-config-label{', '.ai-acp-config-select{']) {
    assert.ok(block.includes(cls), `缺少样式 ${cls}`);
  }
  assert.ok(!/gradient/i.test(block), 'T5b 样式不得使用渐变');
  const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/[^\x00-\x7F]/.test(codeOnly), 'T5b 样式不得包含 emoji 或非 ASCII 装饰字符');
  assert.ok(!/gradient/i.test(cssContent), 'app.css 整体不得引入渐变');
}

// ---------- 断言8：VM 行为（恢复、回落、保存、隐藏空态） ----------
function test8_Behavior() {
  const win = {};
  const cascader = makeEl('div');
  cascader.id = 'aiModelCascader';
  const foot = makeEl('div');
  foot.className = 'ai-foot-actions';
  foot.appendChild(cascader);
  const byId = { aiModelCascader: cascader };
  const $ = (id) => byId[id] || null;
  const doc = {
    querySelector(selector) { return selector === '.ai-foot-actions' ? foot : null; },
    createElement(tag) { return makeEl(tag); }
  };

  let saves = 0;
  const session = {
    id: 'ui1',
    acpConfigOptions: [
      { id: 'thought_level', category: 'thought_level', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] },
      { id: 'context_size', category: 'model_config', name: '上下文大小', currentValue: '200000', options: [{ value: '200000', name: '200K' }, { value: '1000000', name: '1M' }] },
      { id: 'mode', category: 'mode', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] },
      { id: 'model', category: 'model', options: [{ value: 'm1' }] }
    ],
    acpConfig: { thought_level: 'max', context_size: '999999' }
  };

  const src = [extractFn(jsContent, 'aiAcpConfigSource'), extractFn(jsContent, 'aiAcpConfigKind'),
    extractFn(jsContent, 'aiAcpBoolValue'), extractFn(jsContent, 'aiAcpConfigNormalizeItem'),
    extractFn(jsContent, 'aiAcpConfigItems'), extractFn(jsContent, 'aiAcpConfigResolve'),
    extractFn(jsContent, 'aiRenderAcpConfig')].join('\n');
  const make = new Function('window', 'document', '$', 'aiCurSesh', 'aiSaveSesh',
    src + '\nreturn aiRenderAcpConfig;');
  const render = make(win, doc, $, () => session, () => { saves += 1; });

  render();
  const wrap = foot.children.find((child) => child.id === 'aiAcpConfig');
  assert.ok(wrap, '首次渲染应创建 #aiAcpConfig');
  assert.strictEqual(wrap.className, 'ai-acp-config');
  assert.strictEqual(wrap.style.display, 'inline-flex');
  assert.strictEqual(wrap.children.length, 2, '思考项已并入级联，底栏只保留 2 个非思考选择器');

  const boxes = {};
  for (const box of wrap.children) boxes[box.getAttribute('data-acp-config-id')] = box;
  assert.ok(!boxes.model, 'model 不得渲染');
  assert.ok(!boxes.thought_level, 'thought_level 不得在底栏重复渲染（唯一入口在模型级联）');
  assert.strictEqual(selectOf(boxes.context_size).value, '200000', '失效上下文值应回落 currentValue');
  assert.strictEqual(session.acpConfig.context_size, '200000', '回落值应写回会话状态');
  assert.strictEqual(selectOf(boxes.mode).value, 'ask', '未选择时显示 currentValue');
  assert.ok(saves >= 1, '回落值应落盘');

  const before = saves;
  const modeSel = selectOf(boxes.mode);
  modeSel.value = 'code';
  modeSel.onchange();
  assert.strictEqual(session.acpConfig.mode, 'code', '选择后应写入 acpConfig');
  assert.ok(saves > before, '选择后应 aiSaveSesh');

  // acp_config 更新可选项：已选值不再合法 -> 回落新的 currentValue
  byId.aiAcpConfig = wrap;
  session.acpConfigOptions[1] = {
    id: 'context_size', category: 'model_config', name: '上下文大小', currentValue: '1000000',
    options: [{ value: '200000', name: '200K' }, { value: '1000000', name: '1M' }]
  };
  session.acpConfig.context_size = '999999';
  render();
  const contextBox = wrap.children.find((child) => child.getAttribute('data-acp-config-id') === 'context_size');
  assert.strictEqual(selectOf(contextBox).value, '1000000', 'options 更新后失效值应回落 currentValue');
  assert.strictEqual(session.acpConfig.context_size, '1000000', '回落值应同步会话状态');

  // 无可用配置项时隐藏容器
  session.acpConfigOptions = [];
  render();
  assert.strictEqual(wrap.style.display, 'none', '无配置项时应隐藏容器');
  assert.strictEqual(wrap.children.length, 0, '无配置项时应清空选择器');
}

// ---------- 断言9：T9 回归（session → acp_config 首次归属 / 空归属采用 / 跨 Agent 仅缓存） ----------
function test9_FirstConfigOwnership() {
  function makeRuntime(session, opts) {
    const win = (opts && opts.win) || {};
    const src = [
      extractFn(jsContent, 'aiEventMatchesSession'),
      extractFn(jsContent, 'aiBindSessionAgent'),
      extractFn(jsContent, 'aiApplySessionEvent'),
      extractFn(jsContent, 'aiAcpConfigKey'),
      extractFn(jsContent, 'aiAcpOptionsModel'),
      extractFn(jsContent, 'aiAcpModelMatches'),
      extractFn(jsContent, 'aiHandleAcpConfig'),
      extractFn(jsContent, 'aiRefreshCascaderReasoning')
    ].join('\n');
    const make = new Function('window', 'aiCurSesh', 'aiAgentIdNow', 'aiAgentNameOf', 'aiCurModel',
      'aiStoreModel', 'aiModelEl', 'aiSyncModelBtn', 'aiAppendTrace',
      'var __renders=0,__saves=0,__cascades=0; var aiModelCache={groups:[]};'
      + 'function aiRenderAcpConfig(){__renders++;} function aiSaveSesh(){__saves++;} function aiRenderCascader(){__cascades++;}'
      + src + '\nreturn { apply:aiApplySessionEvent, run:aiHandleAcpConfig,'
      + ' renders:function(){return __renders;}, saves:function(){return __saves;}, cascades:function(){return __cascades;} };');
    return make(
      win, () => session, () => ((opts && opts.agentIdNow) || ''), (id) => (id === 'opencode' ? 'OpenCode CLI' : id),
      () => 'm-current', () => {}, { value: 'm-current' }, () => {}, () => {}
    );
  }

  const options = [
    { id: 'mode', category: 'mode', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }] },
    { id: 'thought_level', category: 'thought_level', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }, { value: 'max' }] },
    { id: 'effort', category: 'reasoning_effort', currentValue: 'medium', options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] }
  ];

  // 9.1 正常顺序：session 绑定 opencode -> acp_config 保存配置并渲染
  const s1 = { id: 'ui1' };
  const api1 = makeRuntime(s1, { agentIdNow: 'qoder' });
  api1.apply(s1, {
    type: 'session', id: 'acp-1', acpSessionId: 'acp-1', agentId: 'opencode', agentName: 'OpenCode CLI',
    workdir: 'D:\\w1', uiSessionId: 'ui1', transport: 'acp'
  });
  assert.strictEqual(s1.agentId, 'opencode', 'session 事件应覆盖为空归属（优先事件 Agent）');
  assert.strictEqual(s1.acpSessionId, 'acp-1', 'session 事件应写入 acpSessionId');

  api1.run({
    type: 'acp_config', agentId: 'opencode', agentName: 'OpenCode CLI', acpSessionId: 'acp-1',
    uiSessionId: 'ui1', workdir: 'D:\\w1', configOptions: options, transport: 'acp'
  });
  assert.deepStrictEqual(s1.acpConfigOptions.map((item) => item.id), ['mode', 'thought_level', 'effort'],
    '当前会话应保存完整 configOptions');
  assert.strictEqual(api1.renders(), 1, 'acp_config 到达后应调用选择器渲染');
  assert.strictEqual(api1.cascades(), 1, 'acp_config 到达后应立即刷新级联思考项');
  assert.ok(api1.saves() >= 1, '当前会话配置应落盘');

  // 9.2 首次 acp_config 先到：会话 agentId 为空时采用事件 agentId 并渲染
  const s2 = { id: 'ui2' };
  const api2 = makeRuntime(s2, { agentIdNow: 'qoder' });
  api2.run({
    type: 'acp_config', agentId: 'opencode', agentName: 'OpenCode CLI', acpSessionId: 'acp-2',
    uiSessionId: 'ui2', configOptions: options, transport: 'acp'
  });
  assert.strictEqual(s2.agentId, 'opencode', '会话 agentId 为空时应先采用事件 agentId');
  assert.strictEqual(s2.acpConfigOptions.length, 3, '空归属首次配置也应保存 options');
  assert.strictEqual(api2.renders(), 1, '空归属首次配置也应渲染选择器');
  assert.strictEqual(api2.cascades(), 1, '空归属首次配置也应刷新级联');

  // 9.3 不同 agentId：只写缓存，不写当前会话、不渲染
  const s3 = { id: 'ui3', agentId: 'claude', agentName: 'Claude Code' };
  const win3 = {};
  const api3 = makeRuntime(s3, { agentIdNow: 'claude', win: win3 });
  api3.run({
    type: 'acp_config', agentId: 'opencode', uiSessionId: 'ui3', configOptions: options, transport: 'acp'
  });
  assert.ok(!s3.acpConfigOptions, '跨 Agent 事件不得写当前会话');
  assert.strictEqual(api3.renders(), 0, '跨 Agent 事件不得触发当前选择器渲染');
  assert.strictEqual(api3.cascades(), 0, '跨 Agent 事件不得刷新当前级联');
  assert.ok(win3.__acpConfig['agent:opencode|ui:ui3'], '跨 Agent 事件应只写缓存');

  // 9.4 空归属但 uiSessionId 不一致：只写缓存，不采用 Agent、不渲染
  const s4 = { id: 'ui4' };
  const api4 = makeRuntime(s4, { agentIdNow: '' });
  api4.run({
    type: 'acp_config', agentId: 'opencode', uiSessionId: 'ui-other', configOptions: options, transport: 'acp'
  });
  assert.ok(!s4.agentId, '跨 uiSession 事件不得绑定当前会话 Agent');
  assert.strictEqual(api4.renders(), 0, '跨 uiSession 事件不得触发渲染');
}

// ---------- 断言10：级联思考项统一数据源（ACP 优先 / 完整 option / 非法回落 / 静态兜底） ----------
function test10_CascaderReasoningSource() {
  const acpSrc = [
    extractFn(jsContent, 'aiAcpConfigKind'),
    extractFn(jsContent, 'aiAcpConfigSource'),
    extractFn(jsContent, 'aiAcpBoolValue'),
    extractFn(jsContent, 'aiAcpConfigNormalizeItem'),
    extractFn(jsContent, 'aiAcpConfigItems'),
    extractFn(jsContent, 'aiAcpOptionsModel'),
    extractFn(jsContent, 'aiAcpModelMatches'),
    extractFn(jsContent, 'aiAcpReasoningTarget'),
    extractFn(jsContent, 'aiAcpThoughtState'),
    extractFn(jsContent, 'aiAcpThoughtConfig'),
    extractFn(jsContent, 'aiAcpBooleanThought'),
    extractFn(jsContent, 'aiAcpThoughtResolve'),
    extractFn(jsContent, 'aiReasoningOptsFromAcp'),
    extractFn(jsContent, 'aiCascaderReasoning'),
    extractFn(jsContent, 'aiAcpReasoning')
  ].join('\n');
  const standard = [
    { id: 'default', label: '默认推荐 (CLI 预设)' },
    { id: 'high', label: '高强度 (High)' },
    { id: 'medium', label: '中强度 (Medium)' },
    { id: 'low', label: '低强度 (Low)' }
  ];
  const make = new Function('window', 'aiStandardReasoningOptions', 'aiCurReasoning', 'aiCurModel',
    acpSrc + '\nreturn { items:aiAcpConfigItems, thought:aiAcpThoughtConfig, boolThought:aiAcpBooleanThought,'
    + ' cascader:aiCascaderReasoning, reasoning:aiAcpReasoning };');
  const api = make({}, standard, () => 'default', () => 'm1');

  const acpOptions = [
    { id: 'model', category: 'model', currentValue: 'm1', options: [{ value: 'm1', name: 'M1' }] },
    {
      id: 'thought_level', category: 'thought_level', name: '思考强度', currentValue: 'high',
      options: [
        { value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' },
        { value: 'xhigh', name: 'XHigh' }, { value: 'max', name: 'Max' }
      ]
    },
    { id: 'context_size', category: 'model_config', currentValue: '200000', options: [{ value: '200000', name: '200K' }] }
  ];
  const staticR = { groups: [], reasoningOptions: [{ id: 'default' }, { id: 'high' }, { id: 'medium' }, { id: 'low' }] };
  const modelOpts = { reasoningOptions: [{ id: 'default' }, { id: 'high' }] };

  // 10.1 ACP 思考项优先，完整展示 max/xhigh，当前值取 acpConfig
  const s1 = { id: 'ui1', agentId: 'opencode', acpConfigOptions: acpOptions, acpConfig: { thought_level: 'max' } };
  const r1 = api.cascader(staticR, s1, modelOpts);
  assert.strictEqual(r1.source, 'acp', 'ACP 思考项应优先于模型/静态 reasoningOptions');
  assert.deepStrictEqual(r1.options.map((o) => o.id), ['low', 'medium', 'high', 'xhigh', 'max'], 'ACP options 必须完整保留 max/xhigh');
  assert.strictEqual(r1.value, 'max', '当前值应取 s.acpConfig[configId]');
  assert.strictEqual(r1.stale, false, '合法已选值不应标记失效');

  // 10.2 已选旧值在新 options 中非法 -> 回落 currentValue
  const s2 = { id: 'ui1', agentId: 'opencode', acpConfigOptions: acpOptions, acpConfig: { thought_level: 'turbo' } };
  const r2 = api.cascader(staticR, s2, modelOpts);
  assert.strictEqual(r2.value, 'high', '非法旧值应回落 currentValue');
  assert.strictEqual(r2.stale, true, '非法旧值应标记 stale 以便写回');

  // 10.3 未选择时显示 currentValue，且不误判 stale
  const s3 = { id: 'ui1', agentId: 'opencode', acpConfigOptions: acpOptions, acpConfig: {} };
  const r3 = api.cascader(staticR, s3, modelOpts);
  assert.strictEqual(r3.value, 'high', '未选择时应显示 currentValue');
  assert.strictEqual(r3.stale, false, '未选择不应标记 stale');
  assert.strictEqual(api.reasoning(s3), 'high', 'extra.reasoning 应解析为 ACP currentValue');

  // 10.4 无 ACP 思考项才回退：模型级 -> r 级 -> 静态
  const noThought = { id: 'ui2', agentId: 'opencode', acpConfigOptions: [{ id: 'mode', category: 'mode', options: [{ value: 'ask' }] }] };
  const r4 = api.cascader(staticR, noThought, modelOpts);
  assert.strictEqual(r4.source, 'model', '无 ACP 项时优先模型自带 reasoningOptions');
  assert.deepStrictEqual(r4.options.map((o) => o.id), ['default', 'high'], '模型级 reasoningOptions 应保留');
  const r5 = api.cascader(staticR, noThought, null);
  assert.strictEqual(r5.source, 'static', '无 ACP 且无模型级选项时用静态 reasoningOptions');
  assert.deepStrictEqual(r5.options.map((o) => o.id), ['default', 'high', 'medium', 'low'], '静态兜底应保持旧行为');
  const r6 = api.cascader({ groups: [] }, { id: 'ui3' }, null);
  assert.strictEqual(r6.source, 'static', '空会话无 ACP 项时用静态兜底');
  assert.strictEqual(api.thought(noThought), null, '只有 mode 时不得伪造思考项');

  // 10.5 模型切换：旧模型 ACP 选项不得串到新模型
  const acpR = { transport: 'acp', groups: [] };
  const sStale = { id: 'ui7', agentId: 'opencode', acpConfigOptions: acpOptions, acpConfig: { thought_level: 'max' } };
  assert.strictEqual(api.thought(sStale, 'm1').id, 'thought_level', '目标模型与 options 归属一致时应返回 ACP 项');
  assert.strictEqual(api.thought(sStale, 'm2'), null, '目标模型不一致时不得返回旧 ACP 思考项');
  const rStale = api.cascader(acpR, sStale, modelOpts, 'm2');
  assert.strictEqual(rStale.source, 'acp-wait', '切换模型后旧 ACP 选项应进入等待态');
  assert.deepStrictEqual(rStale.options.map((o) => o.id), ['__acp_wait__'], '等待态不得再展示旧模型档位');
  assert.strictEqual(rStale.waiting, true, '等待态应标记 waiting');
  assert.strictEqual(rStale.ownerModel, 'm1', '等待态应保留旧 options 归属，便于说明原因');
  const api2 = make({}, standard, () => 'default', () => 'm2');
  assert.strictEqual(api2.reasoning(sStale), '', '旧模型思考值不得下发给新模型');

  // 10.6 ACP 已公告配置但该模型没有思考项：等待态，不再用静态表伪装
  const noThoughtOpts = { id: 'ui8', acpConfigOptions: [{ id: 'mode', category: 'mode', currentValue: 'build', options: [{ value: 'build' }] }] };
  const rNoThought = api.cascader(acpR, noThoughtOpts, modelOpts, 'm2');
  assert.strictEqual(rNoThought.source, 'acp-wait', 'ACP 已公告但无思考项时应进入等待态');
  assert.ok(/未提供思考档位/.test(rNoThought.options[0].label), '无思考项应明确提示，而非展示静态档位');
  assert.strictEqual(api2.reasoning(noThoughtOpts), '', '无思考项时不得下发旧值');

  // 10.7 从未收到 ACP 配置：静态兜底仍可用
  const rFirst = api.cascader(acpR, { id: 'ui9' }, null, 'm2');
  assert.strictEqual(rFirst.source, 'static', '首轮 acp_config 前允许静态兜底');
  assert.deepStrictEqual(rFirst.options.map((o) => o.id), ['default', 'high', 'medium', 'low'], '静态兜底保持旧行为');

  // 10.8 布尔思考项不得伪装成强度档位
  const boolOpts = [{
    id: 'thought_level', category: 'thought_level', type: 'boolean', currentValue: 'enabled',
    options: [{ value: 'enabled', name: 'Enabled' }, { value: 'disabled', name: 'Disabled' }]
  }];
  const sb = { id: 'ui4', agentId: 'codebuddy', acpConfigOptions: boolOpts, acpConfig: {} };
  assert.strictEqual(api.thought(sb), null, '布尔思考项不得进入强度列表');
  assert.strictEqual(api.boolThought(sb).boolean, true, '布尔思考项应单独识别');
  const rb = api.cascader(staticR, sb, modelOpts);
  assert.strictEqual(rb.source, 'acp-boolean', '布尔项应走开关语义而非强度');
  assert.deepStrictEqual(rb.options.map((o) => o.id), ['enabled', 'disabled'], '开关值应原样保留');
  assert.ok(rb.options.every((o) => /^思考：/.test(o.label)), '布尔项应显式标注为思考开关');
  assert.ok(!rb.options.some((o) => ['low', 'medium', 'high', 'xhigh', 'max'].includes(String(o.id).toLowerCase())), '布尔项不得生成强度档位');
  assert.strictEqual(api.reasoning(sb), 'enabled', '布尔思考值应可下发');

  const sbStale = { id: 'ui5', acpConfigOptions: boolOpts, acpConfig: { thought_level: 'off' } };
  const rbStale = api.cascader(staticR, sbStale, modelOpts);
  assert.strictEqual(rbStale.value, 'enabled', '布尔项非法旧值应回落 currentValue');
  assert.strictEqual(rbStale.stale, true, '布尔项非法旧值应标记 stale');

  // 10.6 无 type 且只有 enabled 值也应识别为布尔
  const sbNoType = { id: 'ui6', acpConfigOptions: [{ id: 'thinking', currentValue: 'enabled', options: [{ value: 'enabled' }] }] };
  assert.strictEqual(api.thought(sbNoType), null, '无 type 的 enabled 单值也应识别为布尔');
  assert.strictEqual(api.boolThought(sbNoType).boolean, true, '无 type 的 enabled 单值不应进入强度列表');
}

// ---------- 断言12：选中模型即探测（静态接线 / 去重 / 归属校验 / 失败不退回静态） ----------
function test12_ModelProbeWiring() {
  const start = extractFn(jsContent, 'aiAcpProbeStart');
  assert.ok(/probeModel:target/.test(start), '应经 ai:models 的 probeModel 触发配置探测');
  assert.ok(/agentId:aid/.test(start), '应带当前 Agent');
  assert.ok(/if\(sid\)hint\.uiSessionId=sid/.test(start), '应带当前 uiSessionId');
  assert.ok(/hint\.cwd=String\(dir\)/.test(start), '应带与 ai:ask 一致的 cwd，才能复用同一 ACP 会话');
  assert.ok(/prev\.status==='loading'\|\|prev\.status==='ready'/.test(start),
    '同一 Agent+会话+模型进行中/成功都不应重复请求');
  assert.ok(/prev\.status==='error'&&!prev\.transient/.test(start),
    '普通失败不重复请求；busy 等瞬时失败允许重试');
  assert.ok(/now\.requestId!==rid/.test(start), '旧响应应按 requestId 丢弃');
  assert.ok(/got&&got!==target/.test(start), '服务端回传其它模型时应丢弃');
  assert.ok(/configOptions:opts/.test(start) && /modelConfigId:String\(r\.modelConfigId/.test(start),
    '成功应保存 configOptions / modelConfigId');

  const apply = extractFn(jsContent, 'aiAcpProbeApply');
  assert.ok(/entry\.uiSessionId&&s\.id&&String\(entry\.uiSessionId\)!==String\(s\.id\)/.test(apply),
    '切换会话后不得应用旧响应');
  assert.ok(/entry\.agentId!==aid/.test(apply), '切换 Agent 后不得应用旧响应');
  assert.ok(/entry\.model\|\|''\)!==current/.test(apply), '切换模型后不得应用旧响应');
  assert.ok(/s\.acpConfigOptions=entry\.configOptions/.test(apply), '成功应更新 s.acpConfigOptions');
  assert.ok(/s\.acpConfigOptionsModel=aiAcpOptionsModel/.test(apply), '成功应更新 options 归属模型');
  assert.ok(/s\.acpConfig\[picked\.id\]=rr\.value/.test(apply), '成功应写入思考项当前值');

  const casc = extractFn(jsContent, 'aiRenderCascader');
  assert.ok(/aiAcpProbeStart\(targetModel\)/.test(casc), '点击/展开模型应触发探测');
  assert.ok(/正在读取该模型配置/.test(casc), '请求期间应显示“正在读取该模型配置…”');
  assert.ok(/__acp_default__/.test(casc) && /使用默认（配置读取失败）/.test(casc),
    '失败应显示“使用默认”，不得退回旧静态档位冒充');
  assert.ok(/probeReady\?aiCascaderReasoning\(r,sess,null,targetModel,probeState\.configOptions\)/.test(casc),
    '探测成功后应按该模型的 configOptions 渲染完整档位');
  assert.ok(/isModelAcp\?modelAcp\.options/.test(casc), '成功探测仍应走 ACP options');

  assert.ok(/\.ai-model-acp-probe\{/.test(cssContent), 'app.css 应提供读取中/失败徽标样式');
}

// ---------- 断言13：探测行为（去重 / 归属 / 失败不污染 / 旧响应） ----------
async function test13_ModelProbeBehavior() {
  const src = [
    extractFn(jsContent, 'aiAcpProbeAgentId'),
    extractFn(jsContent, 'aiAcpProbeKey'),
    extractFn(jsContent, 'aiAcpProbeSessionId'),
    extractFn(jsContent, 'aiAcpProbeState'),
    extractFn(jsContent, 'aiAcpProbeStart'),
    extractFn(jsContent, 'aiAcpProbeApply'),
    extractFn(jsContent, 'aiAcpConfigKind'),
    extractFn(jsContent, 'aiAcpBoolValue'),
    extractFn(jsContent, 'aiAcpConfigNormalizeItem'),
    extractFn(jsContent, 'aiAcpOptionsModel'),
    extractFn(jsContent, 'aiAcpThoughtResolve')
  ].join('\n');
  const make = new Function(
    'window', 'aiAgentIdNow', 'aiCurSesh', 'aiSbxDir', 'aiCurModel', 'aiSaveSesh', 'aiRenderAcpConfig', 'aiRefreshCascaderReasoning',
    'var aiAcpProbeSeq=0;var aiAcpProbeCache={};\n' + src
    + '\nreturn {start:aiAcpProbeStart,state:aiAcpProbeState,apply:aiAcpProbeApply};'
  );

  const calls = [];
  const pending = [];
  const win = {
    protoAPI: {
      ai: {
        listModels(hint) {
          calls.push(hint);
          return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        }
      }
    }
  };
  let agentId = 'opencode';
  let currentModel = 'model-a';
  const session = { id: 'ui1', agentId: 'opencode', acpConfig: {} };
  let saves = 0;
  let refreshes = 0;
  const api = make(win, () => agentId, () => session, () => 'C:\\sandbox', () => currentModel,
    () => { saves += 1; }, () => {}, () => { refreshes += 1; });

  const optionsOf = (model) => [
    {
      id: 'model', category: 'model', currentValue: model,
      options: [{ value: 'model-a' }, { value: 'model-b' }]
    },
    {
      id: 'thought_level', category: 'thought_level', currentValue: model === 'model-b' ? 'xhigh' : 'medium',
      options: model === 'model-b'
        ? [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }, { value: 'xhigh', name: 'XHigh' }, { value: 'max', name: 'Max' }]
        : [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }]
    }
  ];
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  // 13.1 同一模型不重复请求，请求 hint 完整
  const first = api.start('model-a');
  assert.strictEqual(first.status, 'loading', '首次探测应进入 loading');
  api.start('model-a');
  assert.strictEqual(calls.length, 1, '同一模型重复选中不得重复请求');
  assert.deepStrictEqual(calls[0], {
    engine: 'cli', probeModel: 'model-a', agentId: 'opencode', uiSessionId: 'ui1', cwd: 'C:\\sandbox'
  }, 'probe hint 应带 engine/probeModel/agentId/uiSessionId/cwd');

  pending[0].resolve({ ok: true, model: 'model-a', modelConfigId: 'context_size', configOptions: optionsOf('model-a') });
  await tick();
  assert.strictEqual(api.state('model-a').status, 'ready', '成功响应应缓存为 ready');
  assert.strictEqual(session.acpConfigOptionsModel, 'model-a', '当前模型匹配时应写入会话 options');
  assert.strictEqual(session.acpConfig.thought_level, 'medium', '应写入该模型的 currentValue');
  assert.ok(refreshes >= 1 && saves >= 1, '成功应刷新级联并落盘');

  // 13.2 响应到达时用户已切到别的模型：只缓存，不污染当前会话
  currentModel = 'model-a';
  const second = api.start('model-b');
  currentModel = 'model-a';
  pending[1].resolve({ ok: true, model: 'model-b', modelConfigId: 'context_size', configOptions: optionsOf('model-b') });
  await tick();
  assert.strictEqual(api.state('model-b').status, 'ready', '其它模型的结果应留在缓存');
  assert.strictEqual(session.acpConfigOptionsModel, 'model-a', '未选中 model-b 时不得覆盖会话 options');
  currentModel = 'model-b';
  assert.strictEqual(api.apply(api.state('model-b')), true, '用户真正选中后应应用缓存结果');
  assert.strictEqual(session.acpConfigOptionsModel, 'model-b');
  assert.deepStrictEqual(
    session.acpConfigOptions.find((item) => item.id === 'thought_level').options.map((item) => item.value),
    ['low', 'high', 'xhigh', 'max'],
    '应用后应显示 model-b 的完整 4 档'
  );

  // 13.3 服务端回传模型不一致：丢弃，不写会话
  const before = JSON.stringify(session.acpConfigOptions);
  api.start('model-c');
  pending[2].resolve({ ok: true, model: 'model-x', configOptions: optionsOf('model-x') });
  await tick();
  assert.strictEqual(api.state('model-c').status, 'error', '回传模型不一致应按失败处理');
  assert.strictEqual(JSON.stringify(session.acpConfigOptions), before, '不一致响应不得写会话');

  // 13.4 失败保留 error，不退回静态：会话 configOptions 不被替换
  api.start('model-d');
  pending[3].resolve({ ok: false, error: 'ACP_PROBE_FAILED', detail: 'boom' });
  await tick();
  assert.strictEqual(api.state('model-d').status, 'error');
  assert.ok(/boom/.test(api.state('model-d').error), '失败应保留可展示的 detail');
  assert.strictEqual(JSON.stringify(session.acpConfigOptions), before, '失败不得改写会话 options');

  // 13.5 切换 Agent：旧缓存不命中，新 Agent 重新请求
  agentId = 'claude';
  assert.strictEqual(api.state('model-b'), null, '切换 Agent 后不得命中旧 Agent 的探测缓存');
  api.start('model-b');
  assert.strictEqual(calls.length, 5, '切换 Agent 后应重新发请求');
  assert.strictEqual(calls[4].agentId, 'claude', '新请求应带新 Agent');
  assert.strictEqual(api.apply(api.state('model-b')), false, '未完成的请求不得提前应用');
}


// ---------- 断言11：级联渲染/点击契约（ACP 值写 acpConfig，底栏不再重复） ----------
function test11_CascaderWiring() {
  const casc = extractFn(jsContent, 'aiRenderCascader');
  assert.ok(/aiCascaderReasoning\(r,sess,null\)/.test(casc), '级联必须走统一取数 aiCascaderReasoning');
  assert.ok(/aiCascaderReasoning\(r,sess,null,targetModel\)/.test(casc), '每个模型必须按自身 id 取思考项，防止旧模型 ACP 选项串用');
  assert.ok(/acpReasoning\.source==='acp'\|\|acpReasoning\.source==='acp-boolean'/.test(casc), 'ACP 与布尔开关都应视为 ACP 来源');
  assert.ok(/modelAcp\.source==='acp'\|\|modelAcp\.source==='acp-boolean'/.test(casc), '模型级取数应识别 ACP 来源');
  assert.ok(/modelAcp\.source==='acp-wait'/.test(casc), '模型切换后旧 ACP 选项应以等待态隔离');
  assert.ok(/sess\.acpConfig\[acpReasoning\.configId\]=acpReasoning\.value/.test(casc), '非法回落值应写回会话 acpConfig');
  assert.ok(/isModelAcp\?modelAcp\.options/.test(casc), 'ACP 存在时必须使用 ACP options，不得回落静态表');
  assert.ok(/cs\.acpConfig\[modelAcp\.configId\]=opt\.id/.test(casc), '级联选择应写入 s.acpConfig[configId]');
  assert.ok(/cs\.acpThoughtValue=opt\.id/.test(casc), '级联选择应同步 acpThoughtValue');
  assert.ok(/aiRefreshCascaderReasoning/.test(extractFn(jsContent, 'aiHandleAcpConfig')), 'acp_config 到达后应刷新级联');

  const render = extractFn(jsContent, 'aiRenderAcpConfig');
  assert.ok(/kind!=='thought_level'/.test(render), '底栏应排除思考项，避免重复入口');
}


const cases = [
  ['category 映射 / 跳过 model', test1_CategoryMapping],
  ['configOptions 归一化 / 跳过 model', test2_ConfigItems],
  ['底栏渲染函数 / 不触发请求', test3_RenderFunction],
  ['s.acpConfig 落盘', test4_Persist],
  ['aiDoSend extra.acpConfig / reasoning', test5_SendExtra],
  ['会话恢复 / currentValue 回落', test6_Restore],
  ['CSS 纯色无渐变无 emoji', test7_Css],
  ['渲染/选择/更新行为', test8_Behavior],
  ['session → acp_config 首次归属 / 空归属采用 / 跨 Agent 仅缓存', test9_FirstConfigOwnership],
  ['级联思考项统一数据源 / ACP 优先 / 布尔项', test10_CascaderReasoningSource],
  ['级联渲染/点击契约 / 底栏不重复思考项', test11_CascaderWiring],
  ['选中模型即探测 / 去重 / 归属 / 失败不退回静态', test12_ModelProbeWiring],
  ['探测行为 / 缓存归属 / 旧响应', test13_ModelProbeBehavior]
];

let passed = 0;
let failed = 0;
(async () => {
  for (const [title, fn] of cases) {
    try {
      await fn();
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
})();
