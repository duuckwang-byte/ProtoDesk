'use strict';
// T3 ACP 会话生命周期验证（纯 Node / CommonJS，无 Electron 依赖）
// 覆盖：ensureSession 不再传 sessionOptions.model；positional sessionId 不进入 ACP resume；
//       getStatus / setModel 兜底；resume 失败换新 sessionKey；freshSession / resetSession 走 prepareFreshSession。
const assert = require('node:assert');
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
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
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

/**
 * 构造自动完成的 fake turn。
 * @param {Array<Object>} [events] acpx 事件
 * @returns {Object} fake turn
 */
function createFakeTurn(events) {
  let finish = () => {};
  const result = new Promise((resolve) => { finish = resolve; });
  return {
    requestId: 'fake-request',
    promptStarted: Promise.resolve(),
    events: (async function* () {
      for (const event of (Array.isArray(events) ? events : [])) yield event;
      finish({ status: 'completed', stopReason: 'end_turn' });
    })(),
    result,
    cancel: async () => { finish({ status: 'cancelled', stopReason: 'cancelled' }); },
    closeStream: async () => {}
  };
}

/**
 * 构造最小 fake acpx 模块并记录生命周期调用。
 * @param {Object} config 行为配置
 * @returns {{fake:Object,calls:Object}} fake 模块与调用记录
 */
function createFake(config) {
  const cfg = config || {};
  const calls = {
    ensures: [],
    statusCalls: [],
    setModelCalls: [],
    setConfigOptionCalls: [],
    prepareFreshSessionCalls: [],
    closeCalls: [],
    turns: []
  };
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
      const runtime = {
        async ensureSession(input) {
          calls.ensures.push(Object.assign({}, input));
          if (typeof cfg.ensureSession === 'function') return cfg.ensureSession(input, calls);
          if (options.processLifecycle && typeof options.processLifecycle.onSpawned === 'function') {
            options.processLifecycle.onSpawned({ pid: 2468 });
          }
          return {
            sessionKey: input.sessionKey,
            backend: 'fake',
            runtimeSessionName: 'fake',
            cwd: input.cwd,
            backendSessionId: 'sess-' + input.sessionKey,
            acpxRecordId: 'rec-1'
          };
        },
        async getStatus(input) {
          calls.statusCalls.push(Object.assign({}, input));
          if (typeof cfg.getStatus === 'function') return cfg.getStatus(input, calls);
          return cfg.status || {
            models: { currentModelId: 'm1', availableModels: [{ id: 'm1' }, { id: 'm2' }] }
          };
        },
        async setModel(input) {
          calls.setModelCalls.push(Object.assign({}, input));
        },
        async setConfigOption(input) {
          calls.setConfigOptionCalls.push(Object.assign({}, input));
        },
        async prepareFreshSession(input) {
          calls.prepareFreshSessionCalls.push(Object.assign({}, input));
        },
        async close(input) {
          calls.closeCalls.push(Object.assign({}, input));
        },
        startTurn(input) {
          calls.turns.push(input);
          return createFakeTurn([]);
        },
        async shutdown() {}
      };
      if (cfg.noPrepareFreshSession) delete runtime.prepareFreshSession;
      return runtime;
    }
  };
  return { fake, calls };
}

/**
 * 安装 fake 依赖并重置单例。
 * @param {Object} fake fake acpx 模块
 * @returns {void}
 */
function install(fake) {
  acpRuntime._resetForTest();
  acpRuntime.configure({
    acpxModule: fake,
    defs: [ACP_DEF],
    resolveBin: () => 'C:\\bin\\opencode.exe',
    resolveAdapter: () => null,
    resolveCommand: () => null
  });
}

// ---------- 断言1：ensureSession 不带 sessionOptions / positional sessionId 不进入 resume ----------
async function test1_NoSessionOptionsAndPositionalIgnored() {
  const { fake, calls } = createFake({});
  install(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\session1',
    uiSessionId: 's_session1',
    prompt: 'hi',
    sessionId: 's_pos_123',
    model: 'deepseek-chat',
    globalModel: 'deepseek-chat',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, 'ask 应启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));

  const ensure = calls.ensures[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(ensure, 'sessionOptions'), 'ensureSession 不得再带 sessionOptions');
  assert.strictEqual(ensure.resumeSessionId, undefined, 'positional sessionId 不得作为 ACP resumeSessionId');
  assert.strictEqual(calls.statusCalls.length, 1, 'ensure 后应调用 getStatus({handle})');
  assert.strictEqual(calls.setModelCalls.length, 1, '无 model config option 时应回落到 setModel');
  assert.deepStrictEqual(
    calls.setModelCalls[0],
    { handle: calls.statusCalls[0].handle, model: 'm1' },
    'setModel 应使用对象签名且模型来自 currentModelId'
  );
  assert.strictEqual(calls.setConfigOptionCalls.length, 0, '没有 configOptions 时不应调用 setConfigOption');
}

// ---------- 断言2：resume 失败且无旧 handle → 换新 sessionKey，避免复用旧 record ----------
async function test2_ResumeFailureNewSessionKey() {
  const { fake, calls } = createFake({
    ensureSession(input) {
      if (input.resumeSessionId) {
        const err = new Error('session not found');
        err.code = 'ACP_SESSION_INIT_FAILED';
        throw err;
      }
      return {
        sessionKey: input.sessionKey,
        backend: 'fake',
        runtimeSessionName: 'fake',
        cwd: input.cwd,
        backendSessionId: 'sess-new',
        acpxRecordId: 'rec-new'
      };
    }
  });
  install(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\session2',
    uiSessionId: 's_session2',
    prompt: 'continue',
    resumeSessionId: 'old-session',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, 'resume 失败后应自动新建并启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));

  assert.strictEqual(calls.ensures.length, 2, '应先尝试 resume，再新建会话');
  assert.strictEqual(calls.ensures[0].resumeSessionId, 'old-session', '首次 ensure 应带 resumeSessionId');
  assert.strictEqual(calls.ensures[1].resumeSessionId, undefined, '回退 ensure 不应再带 resumeSessionId');
  assert.notStrictEqual(calls.ensures[1].sessionKey, calls.ensures[0].sessionKey, '无旧 handle 时应换新 sessionKey');
  assert.ok(/-r[0-9a-z]+$/.test(calls.ensures[1].sessionKey), '新 sessionKey 应带 -r<timestamp36> 后缀');
  assert.ok(
    emitted.some((e) => e.type === 'trace' && e.trace && e.trace.tag === 'SESSION'),
    '应发 SESSION 恢复失败 trace'
  );
  const sessionEv = emitted.find((e) => e.type === 'session');
  assert.strictEqual(sessionEv.id, 'sess-new', '应回填新 ACP session id');
  assert.strictEqual(sessionEv.acpSessionId, 'sess-new', 'session 事件应带 acpSessionId');
}

// ---------- 断言3：resetSession 无 prepareFreshSession 时回落 close ----------
async function test3_ResetCloseFallback() {
  const { fake, calls } = createFake({ noPrepareFreshSession: true });
  install(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\session3',
    uiSessionId: 's_session3',
    prompt: 'hi',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, 'ask 应启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));

  const handle = { sessionKey: 'manual' };
  const result = await acpRuntime.resetSession(handle);
  assert.deepStrictEqual(result, { ok: true, method: 'close' }, '无 prepareFreshSession 时应返回 close');
  assert.deepStrictEqual(
    calls.closeCalls[0],
    { handle, reason: 'user-reset', discardPersistentState: true },
    'close 应使用对象签名并丢弃持久状态'
  );
}

// ---------- 断言4：freshSession → prepareFreshSession 后同 key 重新 ensure ----------
async function test4_FreshSession() {
  const { fake, calls } = createFake({});
  install(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\session4',
    uiSessionId: 's_session4',
    prompt: '新会话',
    freshSession: true,
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, 'freshSession 轮应启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));

  assert.strictEqual(calls.ensures.length, 2, 'freshSession 应 ensure -> reset -> ensure');
  assert.strictEqual(calls.prepareFreshSessionCalls.length, 1, '应调用 prepareFreshSession');
  assert.strictEqual(
    calls.prepareFreshSessionCalls[0].handle.backendSessionId.startsWith('sess-'),
    true,
    'prepareFreshSession 应收到上一次 ensure 返回的 handle'
  );
  assert.strictEqual(
    calls.ensures[1].sessionKey,
    calls.ensures[0].sessionKey,
    'prepareFreshSession 成功后应复用同一 sessionKey'
  );
  assert.strictEqual(calls.turns.length, 1, 'freshSession 只应发起一轮 turn');
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

  await run('断言1 ensureSession 无 sessionOptions / positional id 不 resume', test1_NoSessionOptionsAndPositionalIgnored);
  await run('断言2 resume 失败换新 sessionKey', test2_ResumeFailureNewSessionKey);
  await run('断言3 resetSession close 兜底', test3_ResetCloseFallback);
  await run('断言4 freshSession prepareFreshSession', test4_FreshSession);

  acpRuntime._resetForTest();
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
