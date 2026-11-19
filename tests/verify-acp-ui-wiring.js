'use strict';
// T5a ACP UI 闭环验证（纯 Node / CommonJS，无 Electron、无真实 DOM）
// 覆盖：session 事件写 acpSessionId / aiDoSend 透传 acpSessionId + freshSession /
//       aiClear 清 ACP 会话并置 freshSession / acp_config 存 window.__acpConfig + configOptions /
//       错误卡展示 detail 与 availableModels / 模型列表按 r.default 选择且不回落 deepseek-chat。
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
function makeEl() {
  return {
    className: '', innerHTML: '', style: {}, children: [], scrollTop: 0, scrollHeight: 100,
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {},
    querySelector() { return null; }
  };
}

// ---------- 断言1：session 事件写 acpSessionId，oid 仅保留兼容 ----------
function test1_SessionAcpId() {
  const branch = jsContent.match(/if\(ev\.type==='session'\)[\s\S]{0,500}aiWriteSeshFor/);
  assert.ok(branch, 'onEvent 应存在 session 分支并落盘');
  assert.ok(/aiApplySessionEvent/.test(branch[0]), 'session 分支应委托 aiApplySessionEvent');
  assert.ok(/indexOf\(SESS_KEY\)===0/.test(branch[0]), 'session 分支须保留 SESS_KEY 守卫');

  const apply = extractFn(jsContent, 'aiApplySessionEvent');
  assert.ok(/ev\.transport==='acp'\s*\|\|\s*ev\.acpSessionId/.test(apply), 'ACP 会话判定应为 transport 或 acpSessionId');
  assert.ok(/s\.acpSessionId=String\(ev\.acpSessionId\|\|ev\.id\|\|''\)/.test(apply), '应写 s.acpSessionId = ev.acpSessionId || ev.id');
  assert.ok(/s\.oid=ev\.id\|\|''/.test(apply), 'oid 兼容字段应继续写入');
  assert.ok(/s\._freshSession=false/.test(apply), 'ACP 会话建立后应清除 freshSession 标记');
  assert.ok(/sess\.acpSessionId=aiSession\.acpSessionId/.test(jsContent), 'aiSaveSesh 应持久化 acpSessionId');
}

// ---------- 断言2：aiDoSend 透传 acpSessionId / freshSession ----------
function test2_AskExtra() {
  const doSrc = extractFn(jsContent, 'aiDoSend');
  assert.ok(/String\(s\.acpSessionId\|\|''\)/.test(doSrc), 'aiDoSend 应读取 s.acpSessionId');
  assert.ok(/acpSessionId\s*:\s*_acpSid/.test(doSrc), 'ask extra 应传 acpSessionId');
  assert.ok(/freshSession\s*:\s*_freshSession/.test(doSrc), 'ask extra 应传 freshSession');
  assert.ok(/s\._freshSession===true/.test(doSrc), 'freshSession 应来自会话标记');
  assert.ok(/delete s\._freshSession/.test(doSrc), '读取后应清除 freshSession 标记');
  assert.ok(!/acpSessionId\s*:\s*s\.oid/.test(doSrc), '不得再用 s.oid 作为 ACP resume id');
}

// ---------- 断言3：手动清空清 acpSessionId 并置 freshSession ----------
function test3_ClearSession() {
  const clear = jsContent.match(/if\(aiClearEl\)aiClearEl\.onclick=function\(\)\{[\s\S]{0,1400}aiSaveSesh\(\)/);
  assert.ok(clear, '应找到 aiClear 点击处理');
  assert.ok(/acpSessionId=''/.test(clear[0]), '清空对话应清 acpSessionId');
  assert.ok(/_freshSession=true/.test(clear[0]), '清空对话应设置下一次发送 freshSession');
  assert.ok(/aiSession\.oid=''/.test(clear[0]), '清空对话应保留 oid 清理');
  assert.ok(/_freshSession:true/.test(jsContent), '新建会话应标记 freshSession');
}

// ---------- 断言4：acp_config 分支 + window.__acpConfig + configOptions ----------
function test4_AcpConfigEvent() {
  assert.ok(/ev\.type==='acp_config'[\s\S]{0,160}aiHandleAcpConfig/.test(jsContent), 'onEvent 应接 acp_config 分支');

  const handler = extractFn(jsContent, 'aiHandleAcpConfig');
  assert.ok(/window\.__acpConfig/.test(handler), 'acp_config 应保存到 window.__acpConfig');
  assert.ok(/aiAcpConfigKey/.test(handler), 'acp_config 应按 agent/session 分组保存');
  assert.ok(/configOptions:Array\.isArray\(ev\.configOptions\)\?ev\.configOptions\.slice\(\):\[\]/.test(handler), '应预留 configOptions 存储');
  assert.ok(/s\.acpConfigOptions=entry\.configOptions/.test(handler), 'configOptions 应挂到当前会话供 T5b 使用');
  assert.ok(/aiModelEl\.value=entry\.model/.test(handler), '模型按钮值应跟随 ev.model');
  assert.ok(/tag:'ACP'/.test(handler) && /entry\.warnings/.test(handler), 'warnings 应以 ACP 标签写 trace');

  // VM 轻量行为验证：按 agent/uiSession 分组、模型同步、warnings 落 trace
  const keyFn = extractFn(jsContent, 'aiAcpConfigKey');
  const helperFn = extractFn(jsContent, 'aiAcpOptionsModel') + '\n' + extractFn(jsContent, 'aiAcpModelMatches');
  const make = new Function('window', 'aiCurSesh', 'aiCurModel', 'aiStoreModel', 'aiModelEl',
    'aiSyncModelBtn', 'aiAppendTrace',
    keyFn + '\n' + helperFn + '\n' + handler + '\nreturn aiHandleAcpConfig;');
  const win = {};
  const session = {};
  const traces = [];
  let stored = '';
  let synced = 0;
  const modelEl = { value: 'old/model' };
  const run = make(win, () => session, () => 'old/model', (v) => { stored = v; }, modelEl,
    () => { synced++; }, (t) => traces.push(t));
  const entry = run({
    type: 'acp_config', agentId: 'opencode', uiSessionId: 'ui1', model: 'acp/new',
    modelConfigId: 'model-config', thoughtConfigId: 'thought', thoughtValue: 'high',
    configOptions: [{ id: 'thought', value: 'high' }], warnings: ['模型未能验证'], transport: 'acp'
  });
  assert.strictEqual(win.__acpConfig.__latest, entry, '__latest 应指向最新配置');
  assert.strictEqual(win.__acpConfig['agent:opencode|ui:ui1'].configOptions.length, 1, '应按 agent/session 分组保存');
  assert.strictEqual(session.acpConfigOptions[0].id, 'thought', 'configOptions 应落到会话');
  assert.strictEqual(modelEl.value, 'acp/new', 'aiModel 值应更新为 ev.model');
  assert.strictEqual(stored, 'acp/new', '模型选择应持久化');
  assert.strictEqual(synced, 1, '模型按钮应刷新');
  assert.ok(traces.some((t) => t && t.tag === 'ACP' && /模型未能验证/.test(t.text)), 'warnings 应以 ACP 标签写 trace');
}

// ---------- 断言5：错误卡使用 detail / availableModels ----------
function test5_ErrorCard() {
  const classify = extractFn(jsContent, 'i5ClassifyError');
  const card = extractFn(jsContent, 'i5RenderErrorCard');
  assert.ok(/ACP_MODEL_UNSUPPORTED/.test(classify), 'ACP_MODEL_UNSUPPORTED 应单独分类');
  assert.ok(/ev\.detail/.test(card), '错误卡应读取 ev.detail');
  assert.ok(/availableModels/.test(card), '错误卡应读取 availableModels');
  assert.ok(/请重新选择模型/.test(card), '模型不支持时应提示重新选择模型');
  assert.ok(/err-card-detail/.test(card) && /err-card-hint/.test(card), '错误卡应保留 body 并追加 detail/hint 行');

  // 行为验证：detail 截断单行 + availableModels 前 5 个
  const chat = makeEl();
  const doc = { createElement: () => makeEl() };
  const run = new Function('ev', 'document', 'aiChatView', 'escHtml', 'scrubAiChatView',
    classify + '\n' + card + '\nreturn i5RenderErrorCard(ev);');
  run({
    code: 'ACP_MODEL_UNSUPPORTED',
    message: '模型 x 不在当前 Agent 的可用模型内',
    detail: 'requestedModel=x;\n availableModels=a, b',
    availableModels: ['a', 'b', 'c', 'd', 'e', 'f']
  }, doc, chat, escHtmlStub, () => {});
  assert.strictEqual(chat.children.length, 1, '应渲染一张错误卡');
  const html = chat.children[0].innerHTML;
  assert.ok(html.includes('err-card-header') && html.includes('err-card-body') && html.includes('err-card-actions'), '错误卡结构应保持不变');
  assert.ok(html.includes('err-card-detail'), 'detail 应渲染为单行详情');
  assert.ok(!/requestedModel=x;\n/.test(html), 'detail 应压成单行');
  assert.ok(html.includes('可用模型：a、b、c、d、e') && !html.includes('f。'), 'availableModels 只展示前 5 个');
  assert.ok(html.includes('请重新选择模型'), '应追加重新选择模型提示');
}

// ---------- 断言6：模型列表按 r.default 选择，不回落 deepseek-chat ----------
function test6_ModelList() {
  const load = extractFn(jsContent, 'aiLoadModels');
  const render = extractFn(jsContent, 'aiRenderModelOptions');
  const cascader = extractFn(jsContent, 'aiRenderCascader');
  const failure = extractFn(jsContent, 'aiApplyModelsFailure');
  assert.ok(/aiRenderModelOptions\(r\)/.test(load), 'aiLoadModels 应使用 ai:models 结果渲染');
  assert.ok(/\(r&&r\.groups\)\|\|\[\]/.test(render), '模型列表应读取 r.groups');
  assert.ok(/\(g&&g\.models\)\|\|\[\]/.test(render), '模型列表应读取 groups[].models');
  assert.ok(/r&&r\.default/.test(render), '默认模型应读取 r.default');
  assert.ok(/allIds\[0\]/.test(render), 'r.default 不在列表时应取第一项');
  assert.ok(!/['"]deepseek-chat['"]/.test(load + render + failure), '模型列表不得回落 deepseek-chat');
  assert.ok(/ACP 启动命令不可用/.test(failure), 'ok:false 时应显示 ACP 启动命令不可用');
  assert.ok(/r\.detail\|\|r\.error/.test(failure), 'ok:false 时应把 detail 写 trace');
  assert.ok(/ai-model-acp-badge/.test(jsContent), '模型按钮/级联应带 ACP 徽标');
  assert.ok(/r&&r\.transport==='acp'/.test(cascader), '级联徽标应仅对 transport:acp 展示');
}

// ---------- 断言7：CSS 极少量必要样式 ----------
function test7_Css() {
  assert.ok(/\.ai-model-acp-badge\{/.test(cssContent), 'app.css 应提供 ACP 徽标样式');
  assert.ok(/\.ai-cascader-empty\{/.test(cssContent), 'app.css 应提供模型错误空态样式');
  assert.ok(/\.err-card-detail\{/.test(cssContent) && /\.err-card-hint\{/.test(cssContent), 'app.css 应提供错误卡详情样式');
}

const cases = [
  ['session 写 acpSessionId / oid 兼容', test1_SessionAcpId],
  ['aiDoSend 透传 acpSessionId / freshSession', test2_AskExtra],
  ['aiClear 清 ACP 会话并置 freshSession', test3_ClearSession],
  ['acp_config 保存 __acpConfig / configOptions', test4_AcpConfigEvent],
  ['错误卡展示 detail / availableModels', test5_ErrorCard],
  ['模型列表 r.default 且不回落 deepseek-chat', test6_ModelList],
  ['ACP 徽标 / 错误卡 CSS', test7_Css]
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
