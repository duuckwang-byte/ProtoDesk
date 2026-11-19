'use strict';
/* T2b ACP 接入接线验证（静态/轻量，纯 Node，不启动 Electron / Agent）
 * 覆盖：
 * 1. aiModelsImpl ACP 分支：resolveAgentCommand -> inspectAgentModels -> normalizeModelCatalog
 *    -> mergeVisibleModels -> resolveModelChoice，命令失败显性 ACP_BACKEND_MISSING，10 分钟缓存；
 * 2. aiAskImpl ACP 分支：requestedModel 只认 UI 选择 normModel，targetModel 不当 ACP 模型，
 *    modelSource / agentConfigModel / requestedThought / globalModel / freshSession / resumeSessionId 映射；
 * 3. resumeSessionId 不再回落 legacy agentSessionToken；
 * 4. acp_config / permission_resolved 事件不被 ai-process-service 过滤；
 * 5. aiCheckImpl 仍返回 ACP 静态能力字段。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const servicePath = path.join(rootDir, 'main', 'services', 'ai-process-service.js');
const runtimePath = path.join(rootDir, 'main', 'acp', 'acp-runtime.js');
const source = fs.readFileSync(servicePath, 'utf8');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

/**
 * 截取一个 async 函数源码：从 `async function name` 到下一个 `async function next`。
 * 只用于静态契约断言，不执行被测代码。
 * @param {string} name 函数名
 * @param {string} nextName 下一个函数名
 * @returns {string} 源码片段
 */
function extractAsyncFunction(name, nextName) {
  const start = source.indexOf('async function ' + name);
  assert.ok(start >= 0, `未找到函数 ${name}`);
  let end = source.indexOf('async function ' + nextName, start + 1);
  if (end < 0) end = source.indexOf('\nfunction ' + nextName, start + 1);
  assert.ok(end > start, `未找到 ${name} 的结束边界 ${nextName}`);
  return source.slice(start, end);
}

const modelsSrc = extractAsyncFunction('aiModelsImpl', 'aiPickImpl');
const askSrc = extractAsyncFunction('aiAskImpl', 'aiCancelImpl');

/**
 * 取 ACP 分支（从 isAcpEnabled 判断到函数尾）。
 * @returns {string} ACP 分支源码
 */
function acpModelsBranch() {
  const at = modelsSrc.indexOf('if (isAcpEnabled(cfg, def))');
  assert.ok(at >= 0, 'aiModelsImpl 未找到 ACP 分支');
  const end = modelsSrc.indexOf('const fms =', at);
  assert.ok(end > at, 'aiModelsImpl 未找到 legacy 分支边界');
  return modelsSrc.slice(at, end);
}

/**
 * 取 acpRuntime.ask 调用参数块。
 * @returns {string} 调用源码
 */
function acpAskCall() {
  const at = askSrc.indexOf('return acpRuntime.ask({');
  assert.ok(at >= 0, 'aiAskImpl 未找到 acpRuntime.ask 调用');
  const end = askSrc.indexOf('});', at);
  assert.ok(end > at, 'acpRuntime.ask 调用未闭合');
  return askSrc.slice(at, end + 3);
}

// ---------- 断言1：aiModelsImpl 真正走 inspectAgentModels 链路 ----------
function test1_ModelsWiring() {
  assert.ok(
    /require\('\.\.\/acp\/acp-config'\)/.test(source),
    'ai-process-service 应引入 main/acp/acp-config'
  );
  assert.ok(
    /require\('\.\.\/acp\/acp-registry'\)/.test(source),
    'ai-process-service 应引入 main/acp/acp-registry'
  );

  const branch = acpModelsBranch();
  assert.ok(/resolveAcpLaunchCommand\(def, cfg\)/.test(branch), 'ACP 分支应解析选中 Agent 的启动命令');
  assert.ok(/inspectAgentModels\(\{/.test(branch), 'ACP 分支应调用 inspectAgentModels 探测目录');
  assert.ok(/normalizeModelCatalog\(inspection\)/.test(branch), '探测结果应经 normalizeModelCatalog 归一化');
  assert.ok(/mergeVisibleModels\(advertised, whitelist\)/.test(branch), '应使用 mergeVisibleModels 处理白名单');
  assert.ok(/resolveModelChoice\(\{/.test(branch), '应使用 resolveModelChoice 选默认模型');
  assert.ok(/ACP_MODEL_FALLBACKS\[def\.id\]/.test(branch), '探测失败/空应使用 ACP_MODEL_FALLBACKS');
  assert.ok(!/Array\.isArray\(def\.fallbackModels\)/.test(branch), 'ACP 分支不得再回退 legacy def.fallbackModels');

  assert.ok(/const ACP_MODELS_TIMEOUT_MS = 15000;/.test(source), 'inspectAgentModels 超时应为 15000ms');
  assert.ok(
    /inspectAgentModels\(\{[\s\S]{0,200}timeoutMs: ACP_MODELS_TIMEOUT_MS/.test(source),
    'inspectAgentModels 应传 agentCommand/cwd/timeoutMs'
  );

  // 命令解析失败：显性错误，不回退旧 fallback
  assert.ok(/error:\s*'ACP_BACKEND_MISSING'/.test(branch), '命令解析失败应返回 ACP_BACKEND_MISSING');
  assert.ok(/detail:\s*formatAcpBackendMissingDetail\(/.test(branch), 'ACP_BACKEND_MISSING 应带可读 detail');
  assert.ok(/if \(!launch \|\| !Array\.isArray\(launch\.command\)/.test(branch), '命令为空应直接失败');

  // 缓存：key 含 agentId + 完整命令，TTL 复用 10 分钟
  assert.ok(/cacheKey = 'acp:' \+ def\.id \+ ':' \+ agentCommand\.join\(' '\)/.test(branch), '缓存 key 应为 acp:<agentId>:<command>');
  assert.ok(/shared\.cliModelsCache\.(get|set)/.test(branch), '应复用 shared.cliModelsCache');
  assert.ok(/shared\.CLI_MODELS_CACHE_TTL/.test(branch), '应复用 10 分钟 TTL');
  assert.ok(/hit\.models/.test(branch) && /models: catalog\.models/.test(branch), '缓存应保存归一化模型目录');

  // 返回结构
  assert.ok(/transport:\s*'acp'/.test(branch), '返回应带 transport=acp');
  assert.ok(/configOptions:\s*null/.test(branch), '返回应带 configOptions（列表阶段可 null）');
  assert.ok(/defaultSource,/.test(branch), '返回应带 defaultSource');
  assert.ok(/warning\s*\n?\s*\}/.test(branch) || /warning$/.test(branch), '返回应带 warning 字段');
  assert.ok(/visibleModels:\s*whitelist \|\| \[\]/.test(branch), '返回应带 visibleModels');
  assert.ok(/agentId:\s*def\.id/.test(branch), '返回应带 agentId');
  assert.ok(/reasoningOptions:\s*def\.reasoningOptions \|\| null/.test(branch), '返回应带 reasoningOptions');

  // 默认模型不取 cfg.model：仅作为 globalModel 透传给 resolveModelChoice 识别/忽略
  assert.ok(
    /globalModel:\s*String\(cfg\.model \|\| cfg\.defaultModel \|\| ''\)/.test(branch),
    'globalModel 应取 cfg.model || cfg.defaultModel'
  );
  assert.ok(
    /agentConfigModel:\s*String\(agentCfg\.model \|\| ''\)/.test(branch),
    'agentConfigModel 应取 cfg.acp.agents[id].model'
  );
  assert.ok(
    /const requestedModel = String\(\(h && \(h\.model \|\| h\.requestedModel\)\) \|\| ''\)\.trim\(\)/.test(branch),
    'requestedModel 只应来自 UI hint，不取 cfg.model'
  );
  assert.ok(
    /modelSource:\s*requestedModel \? 'ui' : ''/.test(branch),
    'modelSource 应按是否有 UI 选择'
  );
  assert.ok(
    /visibleResult\.warning \|\| choice\.warning/.test(branch),
    'warning 应合并白名单警告与模型选择警告'
  );
}

// ---------- 断言2：aiAskImpl ACP 入参映射 ----------
function test2_AskWiring() {
  const call = acpAskCall();

  assert.ok(/requestedModel:\s*normModel\b/.test(call), 'requestedModel 应只传 UI 选择 normModel');
  assert.ok(!/\bmodel:\s*targetModel\b/.test(call), 'ACP 调用不得把 targetModel 当 model');
  assert.ok(!/requestedModel:\s*targetModel\b/.test(call), 'requestedModel 不得回落 targetModel');

  assert.ok(
    /modelSource:\s*normModel \? 'ui' : \(agentAcpCfg\.model \? 'agent-config' : ''\)/.test(call),
    'modelSource 应按 UI 选择 / Agent 配置区分'
  );
  assert.ok(
    /agentConfigModel:\s*String\(agentAcpCfg\.model \|\| ''\)\.trim\(\)/.test(call),
    'agentConfigModel 应取 agentAcpCfg.model'
  );
  assert.ok(/requestedThought:/.test(call), '应传 requestedThought');
  assert.ok(/agentAcpCfg\.thoughtLevel/.test(call), 'requestedThought 应回落到 Agent thoughtLevel');
  assert.ok(
    /globalModel:\s*String\(aiCfg\.model \|\| aiCfg\.defaultModel \|\| ''\)\.trim\(\)/.test(call),
    'globalModel 应取 aiCfg.model || aiCfg.defaultModel'
  );
  assert.ok(
    /freshSession:\s*!!\(\(extraOpts && \(extraOpts\.freshSession === true \|\| extraOpts\.resetSession === true\)\)\)/.test(call),
    'freshSession 应兼容 freshSession/resetSession'
  );
  assert.ok(
    /resumeSessionId:\s*String\(/.test(call) && /extraOpts\.acpSessionId \|\| extraOpts\.resumeSessionId/.test(call),
    'resumeSessionId 只认 acpSessionId/resumeSessionId'
  );
  assert.ok(!/agentSessionToken/.test(call), 'resumeSessionId 不得回落 legacy agentSessionToken');
  assert.ok(/emit:\s*emitAiEvent/.test(call), 'handlers.emit 应直连 emitAiEvent');

  // 旧 CLI 模型 / 推理参数只在非 ACP 分支写入 executionOptions
  const guardAt = askSrc.indexOf('if (!useAcp) {');
  assert.ok(guardAt >= 0, 'legacy CLI 分支应保留 if (!useAcp) 守卫');
  const guardEnd = askSrc.indexOf('\n    }', guardAt);
  const guard = askSrc.slice(guardAt, guardEnd + 6);
  assert.ok(/executionOptions\.model/.test(guard), 'legacy CLI 模型应留在 !useAcp 分支');
}

// ---------- 断言3：ACP 事件不被过滤 ----------
function test3_AcpEventsPassThrough() {
  const askCall = acpAskCall();
  assert.ok(/emit:\s*emitAiEvent/.test(askCall), 'ACP handlers.emit 应直连 emitAiEvent');

  const emitAt = askSrc.indexOf('function emitAiEvent(payload)');
  assert.ok(emitAt >= 0, 'aiAskImpl 应保留 emitAiEvent');
  const emitEnd = askSrc.indexOf('\n  }', emitAt);
  assert.ok(emitEnd > emitAt, 'emitAiEvent 边界不完整');
  const emitFn = askSrc.slice(emitAt, emitEnd + 4);
  assert.ok(/webContents\.send\('ai:event', payload\)/.test(emitFn), 'emitAiEvent 应原样转发 ai:event');
  assert.ok(!/acp_config|permission_resolved/.test(emitFn), 'emitAiEvent 不得按 ACP 事件类型过滤');
  assert.ok(!/\.filter\(/.test(emitFn), 'emitAiEvent 不得过滤事件');
  assert.ok(
    !/\.type\s*===?\s*['"](?:acp_config|permission_resolved)['"]/.test(askSrc),
    'aiAskImpl 不得判断/拦截 acp_config 或 permission_resolved'
  );

  // 上游确实会发这两类事件，接线层只需原样透传
  assert.ok(/type:\s*'acp_config'/.test(runtimeSource), 'acp-runtime 应仍发 acp_config');
  assert.ok(/type:\s*'permission_resolved'/.test(runtimeSource), 'acp-runtime 应仍发 permission_resolved');
}

// ---------- 断言4：aiCheckImpl ACP 静态能力字段 ----------
function test4_CheckAcpFields() {
  const checkSrc = extractAsyncFunction('aiCheckImpl', 'aiGetConfigImpl');
  assert.ok(/supported:\s*transport === 'acp'/.test(checkSrc), 'aiCheckImpl 应保留 acp.supported');
  assert.ok(/enabled:\s*acpEnabled/.test(checkSrc), 'aiCheckImpl 应保留 acp.enabled');
  assert.ok(/adapter:\s*!!acpDef\.adapter/.test(checkSrc), 'aiCheckImpl 应保留 adapter 布尔值');
  assert.ok(/adapterName:\s*acpDef\.adapter/.test(checkSrc), 'aiCheckImpl 应补 adapterName 静态信息');
  assert.ok(/command:\s*acpDef\.command/.test(checkSrc), 'aiCheckImpl 应补 command 静态信息');
}

function run() {
  const tests = [
    ['断言1 aiModelsImpl ACP 模型探测链路', test1_ModelsWiring],
    ['断言2 aiAskImpl ACP 入参映射', test2_AskWiring],
    ['断言3 acp_config / permission_resolved 事件透传', test3_AcpEventsPassThrough],
    ['断言4 aiCheckImpl ACP 静态字段', test4_CheckAcpFields]
  ];
  let passed = 0;
  let failed = 0;
  for (const [title, fn] of tests) {
    try {
      fn();
      console.log(`[PASS] ${title}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${title}`);
      console.error(err && err.stack ? err.stack : err);
      failed++;
    }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

run();
