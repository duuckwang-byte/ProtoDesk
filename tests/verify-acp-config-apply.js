'use strict';
/* T5b acpConfig 应用验证（纯 Node / CommonJS，无 Electron 依赖）
 * 覆盖：
 * 1. requestedConfig 命中 configOptions -> setConfigOption({handle,key,value}) 被调用；
 * 2. 非法值 -> 不调用 + acp_config.warnings 含 config-value-not-advertised；
 * 3. 不存在的 key -> config-option-missing；
 * 4. model / thought_level key 被跳过，不覆盖已应用的模型 / 思考强度；
 * 5. setConfigOption 失败只 trace，不阻断本轮；
 * 6. 应用成功后重新拉取 configOptions，acp_config 带 selections / appliedConfig / warnings；
 * 7. aiAskImpl 把 extra.acpConfig 映射为 requestedConfig，且不进入 legacy executionOptions。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const acpRuntime = require('../main/acp/acp-runtime');

const ACP_DEF = {
  id: 'opencode',
  name: 'OpenCode CLI',
  transport: 'acp',
  acp: { args: ['acp'], adapter: '' },
  fallbackModels: [{ id: 'default', label: '默认推荐模型', default: true }]
};
const BASE_CFG = {
  cliPaths: {},
  cliPath: '',
  acp: { enabled: true, defaultPermissionMode: 'approve-reads', agents: {} }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  for (;;) {
    let ok = false;
    try { ok = !!predicate(); } catch (e) { ok = false; }
    if (ok) return;
    if (Date.now() - started > timeoutMs) throw new Error('等待条件超时');
    await sleep(5);
  }
}

function createFakeTurn(events) {
  let finish = () => {};
  const result = new Promise((resolve) => { finish = resolve; });
  const turn = {
    requestId: 'fake-request',
    promptStarted: Promise.resolve(),
    events: (async function* () {
      for (const event of (Array.isArray(events) ? events : [])) yield event;
      finish({ status: 'completed', stopReason: 'end_turn' });
    })(),
    result,
    cancel: async () => {},
    closeStream: async () => {}
  };
  return { turn, finish };
}

/**
 * 构造带 context_size / mode / thought_level 的 fake acpx 模块。
 * setConfigOption 会就地更新 fake status，用于验证应用后的 configOptions 刷新。
 * @param {Object} config 行为配置
 * @returns {{fake:Object,calls:Object,statusState:Object}} fake 模块与调用记录
 */
function createFakeModule(config) {
  const cfg = config || {};
  const calls = {
    runtimeCreate: 0,
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
    details: {
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'model-a',
          options: [{ value: 'model-a', name: 'Model A' }, { value: 'model-b', name: 'Model B' }]
        },
        {
          id: 'context_size',
          name: 'Context size',
          category: 'model_config',
          type: 'select',
          currentValue: '200k',
          options: [{ value: '200k', name: '200K' }, { value: '1m', name: '1M' }]
        },
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'ask',
          options: [{ value: 'ask', name: 'Ask' }, { value: 'code', name: 'Code' }]
        },
        {
          id: 'thought_level',
          name: 'Thinking',
          category: 'thought',
          type: 'select',
          currentValue: 'medium',
          options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }]
        }
      ]
    }
  };
  let handleSeq = 0;

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
    createAcpRuntime(options) {
      calls.runtimeCreate += 1;
      return {
        async ensureSession(input) {
          handleSeq += 1;
          const handle = cfg.handle || {
            sessionKey: input.sessionKey,
            backend: 'fake',
            cwd: input.cwd,
            backendSessionId: 'sess-' + handleSeq,
            acpxRecordId: 'rec-' + handleSeq
          };
          calls.ensures.push({ input: Object.assign({}, input), handle });
          if (options.processLifecycle && typeof options.processLifecycle.onSpawned === 'function') {
            options.processLifecycle.onSpawned({ pid: 4321 });
          }
          return handle;
        },
        async getStatus(input) {
          calls.statusCalls.push(Object.assign({}, input));
          if (typeof cfg.getStatus === 'function') return cfg.getStatus(input, calls, statusState);
          return statusState;
        },
        async setConfigOption(input) {
          calls.setConfigOptionCalls.push(Object.assign({}, input));
          if (typeof cfg.setConfigOption === 'function') return cfg.setConfigOption(input, calls, statusState);
          const list = statusState.details.configOptions;
          for (const option of list) {
            if (option.id === input.key) option.currentValue = input.value;
          }
        },
        async setModel(input) {
          calls.setModelCalls.push(Object.assign({}, input));
        },
        async prepareFreshSession() {},
        async close() {},
        startTurn(input) {
          calls.turns.push(input);
          const made = createFakeTurn(cfg.events || []);
          return made.turn;
        },
        async shutdown() {}
      };
    }
  };
  return { fake, calls, statusState };
}

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

/**
 * 跑一轮 ask 并等待 done。
 * @param {Object} extra ask 入参覆盖
 * @returns {Promise<{result:Object,emitted:Array<Object>}>} 结果与事件
 */
async function runAsk(extra) {
  const emitted = [];
  const input = Object.assign({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\acp-config',
    uiSessionId: 's_acp_config',
    prompt: '配置测试',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  }, extra || {});
  const result = await acpRuntime.ask(input);
  if (result.ok) await waitFor(() => emitted.some((e) => e.type === 'done'));
  return { result, emitted };
}

// ---------- 断言1：select 值命中 -> setConfigOption + appliedConfig + 刷新 ----------
async function test1_ApplySelectValue() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const { result, emitted } = await runAsk({ requestedConfig: { context_size: '1m' } });
  assert.strictEqual(result.ok, true, '合法 acpConfig 不应阻断本轮');

  const applied = calls.setConfigOptionCalls.filter((c) => c.key === 'context_size');
  assert.strictEqual(applied.length, 1, 'context_size 应调用一次 setConfigOption');
  assert.deepStrictEqual(
    applied[0],
    { handle: calls.ensures[0].handle, key: 'context_size', value: '1m' },
    'setConfigOption 应使用对象签名 {handle,key,value}'
  );

  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.ok(cfgEv, '必须发 acp_config');
  assert.deepStrictEqual(cfgEv.selections, { context_size: '1m' }, 'selections 应回显请求配置');
  assert.deepStrictEqual(cfgEv.appliedConfig, { context_size: '1m' }, 'appliedConfig 应记录成功项');
  assert.ok(Array.isArray(cfgEv.warnings), 'warnings 应为数组');
  assert.strictEqual(cfgEv.warnings.includes('config-value-not-advertised'), false, '合法值不应告警');

  assert.strictEqual(calls.statusCalls.length, 2, '应用后应重新 getStatus 刷新 configOptions');
  const refreshed = cfgEv.configOptions.find((o) => o.id === 'context_size');
  assert.strictEqual(refreshed.currentValue, '1m', 'acp_config.configOptions 应反映刷新后的值');
}

// ---------- 断言2：非法值 -> 不调用 + config-value-not-advertised ----------
async function test2_InvalidValue() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const { result, emitted } = await runAsk({ requestedConfig: { context_size: '4m' } });
  assert.strictEqual(result.ok, true, '非法值不应阻断本轮');

  assert.strictEqual(
    calls.setConfigOptionCalls.filter((c) => c.key === 'context_size').length,
    0,
    '非法值不得调用 setConfigOption'
  );
  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.ok(cfgEv.warnings.includes('config-value-not-advertised'), '应告警 config-value-not-advertised');
  assert.deepStrictEqual(cfgEv.selections, { context_size: '4m' }, 'selections 仍应回显用户选择');
  assert.deepStrictEqual(cfgEv.appliedConfig, {}, 'appliedConfig 不应记录失败项');
  assert.strictEqual(calls.statusCalls.length, 1, '未应用任何项时不应额外刷新');

  // 非 string/boolean 值同样按未公告处理
  const second = createFakeModule({});
  installFake(second.fake);
  const r2 = await runAsk({ requestedConfig: { mode: { value: 'code' } } });
  assert.strictEqual(r2.result.ok, true, '非标量值不应阻断本轮');
  assert.strictEqual(
    second.calls.setConfigOptionCalls.filter((c) => c.key === 'mode').length,
    0,
    '对象值不得调用 setConfigOption'
  );
  const cfgEv2 = r2.emitted.find((e) => e.type === 'acp_config');
  assert.ok(cfgEv2.warnings.includes('config-value-not-advertised'), '对象值应告警 config-value-not-advertised');
}

// ---------- 断言3：不存在的 key -> config-option-missing ----------
async function test3_MissingOption() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const { result, emitted } = await runAsk({ requestedConfig: { no_such_option: 'x' } });
  assert.strictEqual(result.ok, true, '未知配置项不应阻断本轮');
  assert.strictEqual(
    calls.setConfigOptionCalls.filter((c) => c.key === 'no_such_option').length,
    0,
    '未知配置项不得调用 setConfigOption'
  );
  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.ok(cfgEv.warnings.includes('config-option-missing'), '应告警 config-option-missing');
  assert.deepStrictEqual(cfgEv.appliedConfig, {}, 'appliedConfig 不应记录未知项');
}

// ---------- 断言4：model / thought_level 不覆盖已应用项 ----------
async function test4_ProtectedKeysSkipped() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const { result, emitted } = await runAsk({
    requestedModel: 'model-a',
    modelSource: 'ui',
    requestedThought: 'high',
    requestedConfig: { model: 'model-b', thought_level: 'low' }
  });
  assert.strictEqual(result.ok, true, '受保护 key 不应阻断本轮');

  const modelCalls = calls.setConfigOptionCalls.filter((c) => c.key === 'model');
  assert.strictEqual(modelCalls.length, 1, 'model 只应被 applySessionConfig 应用一次');
  assert.strictEqual(modelCalls[0].value, 'model-a', 'requestedConfig 不得覆盖已应用模型');

  const thoughtCalls = calls.setConfigOptionCalls.filter((c) => c.key === 'thought_level');
  assert.strictEqual(thoughtCalls.length, 1, 'thought_level 只应被 applySessionConfig 应用一次');
  assert.strictEqual(thoughtCalls[0].value, 'high', 'requestedConfig 不得覆盖已应用思考强度');

  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.deepStrictEqual(cfgEv.selections, { model: 'model-b', thought_level: 'low' }, 'selections 应原样回显');
  assert.deepStrictEqual(cfgEv.appliedConfig, {}, 'appliedConfig 不应包含受保护 key');
  assert.strictEqual(cfgEv.warnings.includes('config-value-not-advertised'), false, '受保护 key 应静默跳过');
}

// ---------- 断言5：setConfigOption 失败只 trace，不阻断 ----------
async function test5_ApplyFailureTolerated() {
  const { fake, calls } = createFakeModule({
    setConfigOption(input) {
      if (input.key === 'mode') {
        const err = new Error('set option failed');
        err.code = 'ACP_SET_CONFIG_FAILED';
        throw err;
      }
    }
  });
  installFake(fake);
  const { result, emitted } = await runAsk({ requestedConfig: { mode: 'code' } });
  assert.strictEqual(result.ok, true, 'setConfigOption 失败不应阻断本轮');
  assert.ok(emitted.some((e) => e.type === 'done'), '失败后仍应正常 done');

  const trace = emitted.find(
    (e) => e.type === 'trace' && e.trace && e.trace.tag === 'CONFIG' && /应用配置失败/.test(e.trace.text)
  );
  assert.ok(trace, '失败应发 CONFIG trace');
  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.deepStrictEqual(cfgEv.appliedConfig, {}, '失败项不得进入 appliedConfig');
  assert.strictEqual(calls.statusCalls.length, 1, '未成功应用时不应额外刷新');
}

// ---------- 断言6：非 plain object 的 requestedConfig 被忽略 ----------
async function test6_NonPlainObjectIgnored() {
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const { result, emitted } = await runAsk({ requestedConfig: ['context_size'] });
  assert.strictEqual(result.ok, true, '数组 acpConfig 不应阻断本轮');
  assert.strictEqual(
    calls.setConfigOptionCalls.filter((c) => c.key === 'context_size').length,
    0,
    '数组形态 acpConfig 应被忽略'
  );
  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.strictEqual(cfgEv.selections, undefined, '无有效配置项时不应带 selections');
  assert.strictEqual(cfgEv.appliedConfig, undefined, '无有效配置项时不应带 appliedConfig');
}

// ---------- 断言7：aiAskImpl 静态接线 ----------
function test7_AskWiringSource() {
  const rootDir = path.resolve(__dirname, '..');
  const servicePath = path.join(rootDir, 'main', 'services', 'ai-process-service.js');
  const source = fs.readFileSync(servicePath, 'utf8');
  const start = source.indexOf('async function aiAskImpl');
  assert.ok(start >= 0, '未找到 aiAskImpl');
  const end = source.indexOf('async function aiCancelImpl', start + 1);
  assert.ok(end > start, '未找到 aiAskImpl 结束边界');
  const askSrc = source.slice(start, end);

  assert.ok(
    /requestedConfig:\s*\(extraOpts && extraOpts\.acpConfig && typeof extraOpts\.acpConfig === 'object'\)/.test(askSrc),
    'aiAskImpl 应把 extra.acpConfig 映射为 requestedConfig'
  );
  assert.ok(/requestedThought:/.test(askSrc), 'requestedThought 映射应保持不变');
  assert.ok(/delete executionOptions\.acpConfig/.test(askSrc), 'acpConfig 不得进入 legacy executionOptions');
  assert.strictEqual(
    /executionOptions\.acpConfig\s*=/.test(askSrc),
    false,
    '不得把 acpConfig 写入 executionOptions'
  );
}

// ---------- 断言8：模型切换后按新公告补应用思考强度（首轮/freshSession）----------
async function test8_ThoughtAppliedAfterModelSwitch() {
  const newOptions = () => [
    {
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'model-b',
      options: [{ value: 'model-a', name: 'Model A' }, { value: 'model-b', name: 'Model B' }]
    },
    {
      id: 'context_size', name: 'Context size', category: 'model_config', type: 'select', currentValue: '200k',
      options: [{ value: '200k' }, { value: '1m' }]
    },
    {
      id: 'thought_level', name: 'Thinking', category: 'thought', type: 'select', currentValue: 'default',
      options: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' }, { value: 'default' }]
    }
  ];
  const { fake, calls } = createFakeModule({
    setConfigOption(input, _calls, state) {
      if (input.key === 'model') {
        /* 模拟 acpx：切换模型后 getStatus 返回新模型的 options（初始只有 low/medium/high）。 */
        state.details.configOptions = newOptions();
        state.models.currentModelId = input.value;
        return;
      }
      const option = state.details.configOptions.find((item) => item.id === input.key);
      if (option) option.currentValue = input.value;
    }
  });
  installFake(fake);

  const { result, emitted } = await runAsk({
    requestedModel: 'model-b',
    modelSource: 'ui',
    requestedThought: 'xhigh'
  });
  assert.strictEqual(result.ok, true, '模型切换轮应正常启动');

  const thoughtCalls = calls.setConfigOptionCalls.filter((c) => c.key === 'thought_level');
  assert.strictEqual(thoughtCalls.length, 1, '思考强度应在模型切换后补应用一次');
  assert.strictEqual(thoughtCalls[0].value, 'xhigh', '应按新模型公告应用 xhigh');

  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.strictEqual(cfgEv.model, 'model-b');
  assert.strictEqual(cfgEv.thoughtConfigId, 'thought_level');
  assert.strictEqual(cfgEv.thoughtValue, 'xhigh', '首轮 acp_config 应直接带回真实思考强度');
  const modelOption = cfgEv.configOptions.find((o) => o.id === 'model');
  assert.strictEqual(modelOption.currentValue, 'model-b', 'acp_config 应携带切换后的 options，而非旧模型快照');
  const thoughtOption = cfgEv.configOptions.find((o) => o.id === 'thought_level');
  assert.deepStrictEqual(
    thoughtOption.options.map((o) => o.value),
    ['low', 'high', 'xhigh', 'max', 'default'],
    'acp_config 应带新模型的完整档位'
  );
  assert.strictEqual(
    cfgEv.warnings.includes('thought-value-not-advertised'),
    false,
    '旧模型的非法判定不得带到新模型'
  );
  assert.strictEqual(calls.statusCalls.length, 2, '切换模型后应补读一次 getStatus');
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

  await run('断言1 requestedConfig select 应用与刷新', test1_ApplySelectValue);
  await run('断言2 非法值告警且不应用', test2_InvalidValue);
  await run('断言3 不存在的配置项告警', test3_MissingOption);
  await run('断言4 model / thought_level 不覆盖', test4_ProtectedKeysSkipped);
  await run('断言5 setConfigOption 失败不阻断', test5_ApplyFailureTolerated);
  await run('断言6 非 plain object 被忽略', test6_NonPlainObjectIgnored);
  await run('断言7 aiAskImpl requestedConfig 接线', test7_AskWiringSource);
  await run('断言8 模型切换后补应用思考强度', test8_ThoughtAppliedAfterModelSwitch);

  acpRuntime._resetForTest();
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
