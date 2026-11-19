'use strict';
/* T5c ACP 模型配置预探测验证（纯 Node / CommonJS，无 Electron、无真实 Agent）
 * 覆盖：
 * 1. ai:models 的 hint.probeModel 分支只回单模型 configOptions，不跑 inspectAgentModels；
 * 2. 成功返回该模型完整 configOptions（含思考强度 4 档）与 modelConfigId；
 * 3. 模型不支持 -> ok:false / ACP_MODEL_UNSUPPORTED / availableModels；
 * 4. 有进行中的 ACP turn -> ok:false / busy，且不改会话配置；
 * 5. 预探测不启动 turn，也不污染 shared.activeExecution；
 * 6. runtime 缺少 setConfigOption 时回退 setModel。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const acpRuntime = require('../main/acp/acp-runtime');
const service = require('../main/services/ai-process-service');
const aiConfigStore = require('../main/services/ai-config-store');
const shared = require('../main/state');

const ACP_DEF = {
  id: 'opencode',
  name: 'OpenCode CLI',
  transport: 'acp',
  acp: { args: ['acp'], adapter: '' },
  fallbackModels: [{ id: 'default', label: '默认推荐模型', default: true }]
};
const BASE_CFG = {
  agentId: 'opencode',
  mode: 'cli',
  model: '',
  cliPaths: {},
  cliPath: '',
  visibleModelsCli: {},
  visibleModels: [],
  acp: { enabled: true, defaultPermissionMode: 'approve-reads', agents: {} }
};

const originalLoadAiConfigFull = aiConfigStore.loadAiConfigFull;
aiConfigStore.loadAiConfigFull = () => BASE_CFG;

/**
 * 构造某模型的 configOptions（模型 A 3 档、模型 B 4 档，验证切换后读取的是目标模型真值）。
 * @param {string} model 模型 id
 * @returns {Array<Object>} configOptions
 */
function buildConfigOptions(model) {
  const isB = model === 'model-b';
  return [
    {
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model,
      options: [{ value: 'model-a', name: 'Model A' }, { value: 'model-b', name: 'Model B' }]
    },
    {
      id: 'context_size', name: 'Context size', category: 'model_config', type: 'select',
      currentValue: isB ? '1m' : '200k',
      options: [{ value: '200k', name: '200K' }, { value: '1m', name: '1M' }]
    },
    {
      id: 'thought_level', name: 'Thinking', category: 'thought_level', type: 'select',
      currentValue: isB ? 'xhigh' : 'medium',
      options: isB
        ? [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' }]
        : [{ value: 'low' }, { value: 'medium' }, { value: 'high' }]
    }
  ];
}

/**
 * 悬停中的 fake turn：promptStarted 已 resolve，但事件流不结束，用于制造 busy。
 * @returns {Object} fake turn
 */
function createPendingTurn() {
  return {
    requestId: 'pending-request',
    promptStarted: Promise.resolve(),
    events: (async function* () {
      await new Promise(() => {});
    })(),
    result: new Promise(() => {}),
    cancel: async () => {},
    closeStream: async () => {}
  };
}

/**
 * 构造 fake acpx 模块。
 * @param {Object} config {noSetConfigOption?:boolean,setConfigOption?:Function}
 * @returns {{fake:Object,calls:Object,statusState:Object}} fake 模块与调用记录
 */
function createFakeModule(config) {
  const cfg = config || {};
  const calls = {
    ensures: [],
    turns: [],
    statusCalls: [],
    setConfigOptionCalls: [],
    setModelCalls: []
  };
  const statusState = {
    models: {
      currentModelId: 'model-a',
      availableModels: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }]
    },
    details: { configOptions: buildConfigOptions('model-a') }
  };
  let handleSeq = 0;

  const runtime = {
    async ensureSession(input) {
      handleSeq += 1;
      const handle = {
        sessionKey: input.sessionKey,
        backend: 'fake',
        cwd: input.cwd,
        backendSessionId: 'probe-sess-' + handleSeq,
        acpxRecordId: 'probe-rec-' + handleSeq
      };
      calls.ensures.push({ input: Object.assign({}, input), handle });
      return handle;
    },
    async getStatus(input) {
      calls.statusCalls.push(Object.assign({}, input));
      return {
        models: statusState.models,
        details: {
          configOptions: statusState.details.configOptions.map((option) => Object.assign({}, option, {
            options: (option.options || []).map((item) => Object.assign({}, item))
          }))
        }
      };
    },
    async setModel(input) {
      calls.setModelCalls.push(Object.assign({}, input));
      statusState.models.currentModelId = input.model;
      statusState.details.configOptions = buildConfigOptions(input.model);
    },
    startTurn(input) {
      calls.turns.push(input);
      return createPendingTurn();
    },
    async prepareFreshSession() {},
    async close() {},
    async shutdown() {}
  };
  if (!cfg.noSetConfigOption) {
    runtime.setConfigOption = async (input) => {
      calls.setConfigOptionCalls.push(Object.assign({}, input));
      if (typeof cfg.setConfigOption === 'function') return cfg.setConfigOption(input, calls, statusState);
      statusState.models.currentModelId = input.value;
      statusState.details.configOptions = buildConfigOptions(input.value);
      return { configOptions: statusState.details.configOptions };
    };
  }

  const fake = {
    createAgentRegistry(params) {
      return {
        resolve: (id) => (params.overrides || {})[id],
        list: () => Object.keys(params.overrides || {})
      };
    },
    createFileSessionStore() {
      return { load: async () => undefined, save: async () => {} };
    },
    createAcpRuntime() {
      return runtime;
    }
  };
  return { fake, calls, statusState };
}

/**
 * 安装 fake 模块并清空 runtime 单例。
 * @param {Object} fake fake acpx 模块
 * @returns {void}
 */
function installFake(fake) {
  acpRuntime._resetForTest();
  acpRuntime.configure({
    acpxModule: fake,
    defs: [ACP_DEF],
    resolveBin: () => 'C:\\bin\\opencode.exe',
    resolveAdapter: () => null,
    resolveCommand: () => null
  });
}

/** @returns {Object} 事件接收器 */
function makeSink() {
  return {
    sender: {
      send() {},
      isDestroyed() { return false; }
    }
  };
}

/**
 * 安装 ai:models 测试钩子：inspect / CLI 一旦被调用就让用例失败。
 * @returns {void}
 */
function installForbidCatalogHooks() {
  service.__setAcpModelsTestHooks({
    inspectAgentModels: async () => { throw new Error('probe 分支不得调用 inspectAgentModels'); },
    execCliListModels: async () => { throw new Error('probe 分支不得执行 CLI models'); },
    resolveLaunchCommand: async () => { throw new Error('probe 分支不得解析 launch command'); }
  });
}

const TMP_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-acp-probe-'));

// ---------- 断言1：probe 分支成功返回目标模型 configOptions，且不跑目录探测 ----------
async function test1_ProbeReturnsConfigOptions() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  installForbidCatalogHooks();

  const started = Date.now();
  const r = await service.aiModelsImpl(makeSink(), {
    engine: 'cli',
    probeModel: 'model-b',
    agentId: 'opencode',
    uiSessionId: 'ui-probe-1',
    cwd: TMP_CWD
  });
  const elapsed = Date.now() - started;

  assert.strictEqual(r.ok, true, 'probe 应成功');
  assert.strictEqual(r.probe, true, '返回应标记 probe:true');
  assert.strictEqual(r.engine, 'cli');
  assert.strictEqual(r.transport, 'acp');
  assert.strictEqual(r.agentId, 'opencode');
  assert.strictEqual(r.model, 'model-b', '返回模型应为目标模型');
  assert.strictEqual(r.modelConfigId, 'context_size', '应返回 model_config 配置项 id');
  assert.strictEqual(Array.isArray(r.configOptions), true, 'configOptions 应为数组');
  const thought = r.configOptions.find((item) => item.id === 'thought_level');
  assert.ok(thought, '必须包含思考强度项');
  assert.deepStrictEqual(
    thought.options.map((item) => item.value),
    ['low', 'high', 'xhigh', 'max'],
    '必须返回 model-b 的完整 4 档，而不是 model-a 的旧档位'
  );
  assert.strictEqual(r.configOptions.find((item) => item.id === 'model').currentValue, 'model-b');
  assert.ok(!r.groups, 'probe 分支不得返回完整模型列表');
  assert.ok(elapsed < 3000, 'probe 不应等待 15s 目录探测，实际 ' + elapsed + 'ms');

  assert.strictEqual(calls.turns.length, 0, 'probe 不得启动 turn');
  assert.strictEqual(calls.ensures.length, 1, 'probe 应 ensureSession 一次');
  assert.strictEqual(calls.setConfigOptionCalls.length, 1, 'probe 应 setConfigOption 一次');
  assert.deepStrictEqual(calls.setConfigOptionCalls[0], {
    handle: calls.ensures[0].handle,
    key: 'model',
    value: 'model-b'
  }, 'setConfigOption 必须使用 {handle,key:model,value}');
  assert.strictEqual(calls.statusCalls.length, 2, '设置模型前后各 getStatus 一次');
}

// ---------- 断言2：模型不支持 -> ACP_MODEL_UNSUPPORTED + availableModels ----------
async function test2_ModelUnsupported() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  installForbidCatalogHooks();

  const r = await service.aiModelsImpl(makeSink(), {
    engine: 'cli',
    probeModel: 'model-nope',
    agentId: 'opencode',
    uiSessionId: 'ui-probe-2',
    cwd: TMP_CWD
  });

  assert.strictEqual(r.ok, false, '不支持的模型必须失败');
  assert.strictEqual(r.probe, true);
  assert.strictEqual(r.error, 'ACP_MODEL_UNSUPPORTED');
  assert.deepStrictEqual(r.availableModels, ['model-a', 'model-b'], '应回传可用模型列表');
  assert.strictEqual(calls.setConfigOptionCalls.length, 0, '不支持时不得切换模型');
  assert.strictEqual(calls.turns.length, 0, '不支持时不得启动 turn');

  /* 失败不污染共享执行槽 */
  const legacyExecution = { kind: 'legacy', pid: 4321 };
  shared.activeExecution = legacyExecution;
  const r2 = await service.aiModelsImpl(makeSink(), {
    engine: 'cli', probeModel: 'model-nope', agentId: 'opencode', uiSessionId: 'ui-probe-2b', cwd: TMP_CWD
  });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(shared.activeExecution, legacyExecution, 'probe 失败不得改写共享 activeExecution');
  shared.activeExecution = null;
}

// ---------- 断言3：有进行中的 ACP turn -> busy，且不改模型 ----------
async function test3_BusyDuringTurn() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);

  const asked = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: TMP_CWD,
    uiSessionId: 'ui-probe-busy',
    prompt: '正在执行',
    requestedModel: 'model-a',
    modelSource: 'ui',
    aiCfg: BASE_CFG,
    handlers: { emit: () => {} }
  });
  assert.strictEqual(asked.ok, true, 'ask 应先启动');
  assert.strictEqual(calls.turns.length, 1, 'ask 应启动 turn');

  const before = calls.setConfigOptionCalls.length;
  const r = await acpRuntime.previewModelConfig({
    def: ACP_DEF,
    aiCfg: BASE_CFG,
    cwd: TMP_CWD,
    uiSessionId: 'ui-probe-busy',
    model: 'model-b'
  });
  assert.strictEqual(r.ok, false, '进行中的 turn 必须拒绝探测');
  assert.strictEqual(r.error, 'busy');
  assert.strictEqual(calls.setConfigOptionCalls.length, before, 'busy 时不得改会话配置');

  const viaModels = await service.aiModelsImpl(makeSink(), {
    engine: 'cli', probeModel: 'model-b', agentId: 'opencode', uiSessionId: 'ui-probe-busy', cwd: TMP_CWD
  });
  assert.strictEqual(viaModels.ok, false, 'ai:models probe 也应拒绝');
  assert.strictEqual(viaModels.error, 'busy');

  acpRuntime._resetForTest();
}

// ---------- 断言4：不启动 turn（直接预览成功/失败两种路径） ----------
async function test4_NoTurnStarted() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);

  const ok = await acpRuntime.previewModelConfig({
    def: ACP_DEF, aiCfg: BASE_CFG, cwd: TMP_CWD, uiSessionId: 'ui-probe-4', model: 'model-b'
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(calls.turns.length, 0, '成功预览不得启动 turn');

  const bad = await acpRuntime.previewModelConfig({
    def: ACP_DEF, aiCfg: BASE_CFG, cwd: TMP_CWD, uiSessionId: 'ui-probe-4', model: 'nope'
  });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(calls.turns.length, 0, '失败预览不得启动 turn');
  assert.strictEqual(shared.activeExecution, null, '预览不得占用共享执行槽');
}

// ---------- 断言5：runtime 无 setConfigOption 时回退 setModel ----------
async function test5_SetModelFallback() {
  const { fake, calls } = createFakeModule({ noSetConfigOption: true });
  installFake(fake);

  const r = await acpRuntime.previewModelConfig({
    def: ACP_DEF, aiCfg: BASE_CFG, cwd: TMP_CWD, uiSessionId: 'ui-probe-5', model: 'model-b'
  });
  assert.strictEqual(r.ok, true, '缺少 setConfigOption 时应回退 setModel');
  assert.strictEqual(calls.setModelCalls.length, 1, '应调用 setModel');
  assert.strictEqual(calls.setModelCalls[0].model, 'model-b');
  const thought = r.configOptions.find((item) => item.id === 'thought_level');
  assert.deepStrictEqual(thought.options.map((item) => item.value), ['low', 'high', 'xhigh', 'max']);
}

// ---------- 断言6：AI 配置关闭 ACP -> 明确失败，不拉起 runtime ----------
async function test6_AcpDisabled() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const disabledCfg = Object.assign({}, BASE_CFG, { acp: { enabled: false, agents: {} } });
  aiConfigStore.loadAiConfigFull = () => disabledCfg;
  try {
    const r = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-b', agentId: 'opencode', uiSessionId: 'ui-probe-6', cwd: TMP_CWD
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'ACP_DISABLED');
    assert.strictEqual(calls.ensures.length, 0, 'ACP 关闭时不得 ensureSession');
  } finally {
    aiConfigStore.loadAiConfigFull = () => BASE_CFG;
  }
}

// ---------- 断言7：静态接线（probe 分支早于 inspectAgentModels） ----------
function test7_SourceWiring() {
  const rootDir = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(rootDir, 'main', 'services', 'ai-process-service.js'), 'utf8');
  const modelsStart = source.indexOf('async function aiModelsImpl');
  assert.ok(modelsStart >= 0, '未找到 aiModelsImpl');
  const modelsSrc = source.slice(modelsStart, source.indexOf('async function aiPickImpl', modelsStart));
  const probeAt = modelsSrc.indexOf('if (probeModel) return probeAcpModelConfig');
  const acpAt = modelsSrc.indexOf('if (isAcpEnabled(cfg, def))');
  assert.ok(probeAt >= 0, 'aiModelsImpl 必须有 probeModel 分支');
  assert.ok(acpAt > probeAt, 'probe 分支必须早于 ACP 模型目录探测');

  const helperStart = source.indexOf('async function probeAcpModelConfig');
  assert.ok(helperStart >= 0, '缺少 probeAcpModelConfig');
  const helper = source.slice(helperStart, modelsStart);
  assert.ok(/previewModelConfig\(/.test(helper), 'probe 应调用 acp-runtime.previewModelConfig');
  assert.strictEqual(/inspectAgentModels/.test(helper), false, 'probe 分支不得调用 inspectAgentModels');
  assert.ok(/availableModels/.test(helper), '失败应回传 availableModels');

  const runtime = fs.readFileSync(path.join(rootDir, 'main', 'acp', 'acp-runtime.js'), 'utf8');
  assert.ok(/async function previewModelConfigImpl/.test(runtime), 'acp-runtime 应实现 previewModelConfigImpl');
  const implStart = runtime.indexOf('async function previewModelConfigImpl');
  const impl = runtime.slice(implStart, runtime.indexOf('function buildTurnInput', implStart));
  assert.ok(/ensureSession\(\{ sessionKey/.test(impl), '预览应复用 ensureSession');
  assert.ok(/setConfigOption\(\{ handle, key: modelOption\.id, value: model \}\)/.test(impl), '预览应切换目标模型');
  assert.ok(/normalizeConfigOptions\(status2\)/.test(impl), '预览应 getStatus 后归一化 configOptions');
  assert.strictEqual(/runtime\.startTurn|\.startTurn\(/.test(impl), false, '预览体内不得启动 turn');
  assert.strictEqual(/prompt:\s*ctx\.prompt/.test(impl), false, '预览体内不得发送 prompt');
  assert.ok(/error: 'busy'/.test(impl), '有进行中轮次时应返回 busy');
}

async function main() {
  let passed = 0;
  let failed = 0;
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    }
  }

  await run('断言1 probe 返回目标模型完整 configOptions / 不跑目录探测', test1_ProbeReturnsConfigOptions);
  await run('断言2 模型不支持 / availableModels / 不污染执行槽', test2_ModelUnsupported);
  await run('断言3 进行中 turn -> busy 且不改配置', test3_BusyDuringTurn);
  await run('断言4 预览不启动 turn', test4_NoTurnStarted);
  await run('断言5 setConfigOption 缺失时回退 setModel', test5_SetModelFallback);
  await run('断言6 ACP 关闭时明确失败', test6_AcpDisabled);
  await run('断言7 probe 分支静态接线', test7_SourceWiring);

  service.__setAcpModelsTestHooks({});
  aiConfigStore.loadAiConfigFull = originalLoadAiConfigFull;
  acpRuntime._resetForTest();
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
