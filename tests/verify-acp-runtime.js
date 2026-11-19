'use strict';
// Phase 1 ACP 执行链路验证（纯 Node / CommonJS，无 Electron 依赖）
// 覆盖：默认关闭分流、事件契约（run_started/chunk/thinking/tool_call/done）、
//       权限请求与 resolvePermission 回传、取消 turn.cancel + 2 秒兜底、sessionKey 稳定。
const assert = require('node:assert');
const acpRuntime = require('../main/acp/acp-runtime');
const aiConfigStore = require('../main/services/ai-config-store');
const shared = require('../main/state');
const paths = require('../main/paths');

const ACP_DEF = {
  id: 'opencode',
  name: 'OpenCode CLI',
  transport: 'acp',
  acp: { args: ['acp'], adapter: '' },
  fallbackModels: [{ id: 'default', label: '默认推荐模型', default: true }]
};
const LEGACY_DEF = { id: 'deepseek', name: 'DeepSeek CLI', transport: 'legacy' };
const BASE_CFG = { cliPaths: {}, cliPath: '', acp: { enabled: true, defaultPermissionMode: 'approve-reads', agents: {} } };

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

/**
 * 构造 fake turn：events 异步迭代，result 由 finish 控制。
 * @param {Array<Object>} events acpx 事件数组
 * @param {{autoFinish?:boolean,result?:Object,onCancel?:Function}} [options] 行为开关
 * @returns {{turn:Object,finish:Function,cancelCalls:number}} fake turn
 */
function createFakeTurn(events, options) {
  const opts = options || {};
  let finish = () => {};
  let cancelCalls = 0;
  const result = new Promise((resolve) => { finish = resolve; });
  const turn = {
    requestId: 'fake-request',
    promptStarted: Promise.resolve(),
    events: (async function* () {
      for (const event of (Array.isArray(events) ? events : [])) yield event;
      if (opts.autoFinish !== false) finish(opts.result || { status: 'completed', stopReason: 'end_turn' });
    })(),
    result,
    cancel: async () => {
      cancelCalls += 1;
      if (typeof opts.onCancel === 'function') opts.onCancel(finish);
    },
    closeStream: async () => {}
  };
  return {
    turn,
    finish,
    get cancelCalls() { return cancelCalls; }
  };
}

/**
 * 构造 fake acpx 模块，记录 create / ensure / startTurn 调用。
 * @param {Object} config 行为配置
 * @returns {{fake:Object,calls:Object}} fake 模块与调用记录
 */
function createFakeModule(config) {
  const cfg = config || {};
  const calls = {
    runtimeCreate: 0,
    runtimeOptions: null,
    registryParams: null,
    storeParams: null,
    ensures: [],
    turns: [],
    lastTurn: null,
    statusCalls: [],
    setConfigOptionCalls: [],
    setModelCalls: [],
    prepareFreshSessionCalls: [],
    closeCalls: []
  };
  const defaultStatus = {
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
          currentValue: '200000',
          options: [{ value: '200000' }, { value: '400000' }]
        },
        {
          id: 'thought_level',
          name: 'Thinking',
          category: 'thought',
          type: 'select',
          currentValue: 'medium',
          options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }]
        }
      ]
    }
  };
  const fake = {
    createAgentRegistry(params) {
      calls.registryParams = params;
      return {
        resolve: (id) => (params.overrides || {})[id],
        list: () => Object.keys(params.overrides || {})
      };
    },
    createFileSessionStore(params) {
      calls.storeParams = params;
      return { load: async () => undefined, save: async () => {} };
    },
    createAcpRuntime(options) {
      calls.runtimeCreate += 1;
      calls.runtimeOptions = options;
      const runtime = {
        async ensureSession(input) {
          calls.ensures.push(Object.assign({}, input));
          if (typeof cfg.ensureSession === 'function') return cfg.ensureSession(input, calls);
          if (options.processLifecycle && typeof options.processLifecycle.onSpawned === 'function') {
            options.processLifecycle.onSpawned({ pid: cfg.pid || 4321 });
          }
          return cfg.handle || {
            sessionKey: input.sessionKey,
            backend: 'fake',
            runtimeSessionName: 'fake',
            cwd: input.cwd,
            backendSessionId: 'sess-1',
            acpxRecordId: 'rec-1'
          };
        },
        async getStatus(input) {
          calls.statusCalls.push(Object.assign({}, input));
          if (typeof cfg.getStatus === 'function') return cfg.getStatus(input, calls);
          return cfg.status || defaultStatus;
        },
        async setConfigOption(input) {
          calls.setConfigOptionCalls.push(Object.assign({}, input));
          if (typeof cfg.setConfigOption === 'function') return cfg.setConfigOption(input, calls);
        },
        async setModel(input) {
          calls.setModelCalls.push(Object.assign({}, input));
          if (typeof cfg.setModel === 'function') return cfg.setModel(input, calls);
        },
        async prepareFreshSession(input) {
          calls.prepareFreshSessionCalls.push(Object.assign({}, input));
          if (typeof cfg.prepareFreshSession === 'function') return cfg.prepareFreshSession(input, calls);
        },
        async close(input) {
          calls.closeCalls.push(Object.assign({}, input));
          if (typeof cfg.close === 'function') return cfg.close(input, calls);
        },
        startTurn(input) {
          calls.turns.push(input);
          const made = cfg.turnFactory
            ? cfg.turnFactory(input)
            : createFakeTurn(cfg.events || []);
          calls.lastTurn = made;
          return made.turn;
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
 * 安装 fake 依赖（每个用例前重置单例）。
 * @param {Object} fake fake acpx 模块
 * @returns {void}
 */
function installFake(fake) {
  acpRuntime._resetForTest();
  acpRuntime.configure({
    acpxModule: fake,
    defs: [ACP_DEF, LEGACY_DEF],
    resolveBin: () => 'C:\\bin\\opencode.exe',
    resolveAdapter: () => null,
    resolveCommand: () => null
  });
}

// ---------- 断言1：默认关闭 / 分流条件 / 配置默认值 ----------
async function test1_IsAcpEnabled() {
  assert.strictEqual(acpRuntime.isAcpEnabled({}, ACP_DEF), false, '空配置应默认关闭');
  assert.strictEqual(
    acpRuntime.isAcpEnabled({ acp: { enabled: false } }, ACP_DEF),
    false,
    'acp.enabled=false 应关闭'
  );
  assert.strictEqual(
    acpRuntime.isAcpEnabled({ acp: { enabled: true } }, LEGACY_DEF),
    false,
    'transport=legacy 不应走 ACP'
  );
  assert.strictEqual(
    acpRuntime.isAcpEnabled({ acp: { enabled: true } }, ACP_DEF),
    true,
    'enabled=true 且 transport=acp 才走 ACP'
  );

  const defCfg = aiConfigStore.defaultAiCfg();
  assert.deepStrictEqual(
    defCfg.acp,
    { enabled: false, defaultPermissionMode: 'approve-reads', agents: {} },
    '默认配置应内置关闭的 acp 块'
  );
  assert.strictEqual(acpRuntime.isAcpEnabled(defCfg, ACP_DEF), false, '默认配置下 ACP 必须关闭');

  const persisted = aiConfigStore.toSafePersistedShape({
    acp: {
      enabled: true,
      defaultPermissionMode: 'approve-all',
      agents: {
        opencode: { transport: 'acp', apiKey: 'secret-key', token: 'secret-token', env: { API_KEY: 'x' } }
      }
    }
  });
  assert.strictEqual(persisted.acp.enabled, true, 'acp.enabled 应保留');
  assert.strictEqual(persisted.acp.agents.opencode.transport, 'acp', 'agents 非敏感字段应保留');
  assert.strictEqual(persisted.acp.agents.opencode.apiKey, undefined, 'acp 内 apiKey 不得落盘');
  assert.strictEqual(persisted.acp.agents.opencode.token, undefined, 'acp 内 token 不得落盘');
  assert.strictEqual(persisted.acp.agents.opencode.env, undefined, 'acp 内 env 不得落盘');

  // 关闭时 ask 直接拒绝，不创建 runtime
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\proj',
    uiSessionId: 's_off',
    prompt: 'hi',
    aiCfg: { acp: { enabled: false } },
    handlers: { emit: () => {} }
  });
  assert.strictEqual(r.ok, false, 'ACP 关闭时 ask 应失败');
  assert.strictEqual(r.error, 'acp-disabled', '错误应为 acp-disabled');
  assert.strictEqual(calls.runtimeCreate, 0, '关闭时不得创建 runtime');
}

// ---------- 断言2：事件契约与 runtime 构造参数 ----------
async function test2_EventContract() {
  const { fake, calls } = createFakeModule({
    events: [
      { type: 'text_delta', text: '你好', stream: 'output' },
      { type: 'text_delta', text: '思考中', stream: 'thought' },
      { type: 'tool_call', toolCallId: 'tc-1', title: 'Read file', status: 'completed', kind: 'read' }
    ]
  });
  installFake(fake);

  const emitted = [];
  const cwd = 'C:\\sandbox\\proj';
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd,
    uiSessionId: 's_evt',
    prompt: '生成页面',
    model: '',
    aiCfg: BASE_CFG,
    handlers: {
      emit: (payload) => emitted.push(payload),
      getFileChanges: () => [{ path: 'a.html', action: 'modified', added: 2, deleted: 1 }]
    }
  });
  assert.strictEqual(r.ok, true, 'ask 应启动成功');
  assert.strictEqual(r.success, true, 'ask success 应为 true');

  await waitFor(() => emitted.some((e) => e.type === 'done'));
  const types = emitted.map((e) => e.type);
  const at = (t) => types.indexOf(t);
  const sessionEv = emitted.find((e) => e.type === 'session');
  assert.ok(sessionEv, '必须发 session 事件回填 ACP 会话 id');
  assert.strictEqual(sessionEv.id, 'sess-1', 'session.id 应为 ensureSession 返回的 ACP session id');
  assert.strictEqual(sessionEv.acpSessionId, 'sess-1', 'session 应带 acpSessionId');
  assert.strictEqual(sessionEv.recordId, 'rec-1', 'session 应带 acpx recordId');
  assert.strictEqual(sessionEv.agentSessionId, 'sess-1', 'session 应带 agentSessionId');
  assert.strictEqual(sessionEv.agentId, 'opencode', 'session 应带 agentId');
  assert.strictEqual(sessionEv.agentName, 'OpenCode CLI', 'session 应带 agentName');
  assert.strictEqual(sessionEv.workdir, cwd, 'session 应带 workdir');
  assert.strictEqual(sessionEv.transport, 'acp', 'session 应带 transport=acp');
  assert.ok(at('run_started') >= 0, '必须发 run_started');
  assert.ok(at('chunk') >= 0, '必须发 chunk');
  assert.ok(at('thinking') >= 0, '必须发 thinking');
  assert.ok(at('tool_call') >= 0, '必须发 tool_call');
  assert.ok(at('done') >= 0, '必须发 done');
  assert.ok(at('run_started') < at('chunk'), 'run_started 应在 chunk 之前');
  assert.ok(at('chunk') < at('thinking'), 'chunk/thinking 顺序应稳定');
  assert.ok(at('tool_call') < at('done'), 'done 应在最后');

  const started = emitted.find((e) => e.type === 'run_started');
  assert.strictEqual(started.transport, 'acp', 'run_started 应带 transport=acp');
  assert.strictEqual(started.uiSessionId, 's_evt', 'run_started 应透传 uiSessionId');
  assert.strictEqual(started.pid, 4321, 'run_started 应带 processLifecycle 补的 pid');

  const chunk = emitted.find((e) => e.type === 'chunk');
  assert.strictEqual(chunk.text, '你好', 'chunk 文本应透传');
  assert.strictEqual(chunk.transport, 'acp', 'chunk 应带 transport=acp');
  const thinking = emitted.find((e) => e.type === 'thinking');
  assert.strictEqual(thinking.text, '思考中', 'thinking 文本应透传');
  const tool = emitted.find((e) => e.type === 'tool_call');
  assert.strictEqual(tool.id, 'tc-1', 'tool_call id 应透传');
  assert.strictEqual(tool.tool, 'Read file', 'tool_call 名称应透传');

  const done = emitted.find((e) => e.type === 'done');
  assert.strictEqual(done.cancelled, false, 'done.cancelled 应为 false');
  assert.strictEqual(done.transport, 'acp', 'done 应带 transport=acp');
  assert.deepStrictEqual(
    done.fileChanges,
    [{ path: 'a.html', action: 'modified', added: 2, deleted: 1 }],
    'done.fileChanges 应来自注入的 diff 回调'
  );

  // runtime 构造参数
  const opts = calls.runtimeOptions;
  assert.strictEqual(opts.cwd, paths.SANDBOX_ROOT, 'runtime.cwd 应为沙箱根');
  assert.strictEqual(opts.permissionMode, 'approve-reads', 'permissionMode 应读默认配置');
  assert.strictEqual(opts.nonInteractivePermissions, 'deny', 'nonInteractivePermissions 应为 deny');
  assert.strictEqual(opts.fs, true, 'fs 能力应开启');
  assert.strictEqual(opts.terminal, true, 'terminal 能力应开启');
  assert.strictEqual(opts.timeoutMs, 30 * 60 * 1000, 'timeoutMs 应为 30 分钟');
  assert.ok(/acp[\\/]sessions$/.test(String(calls.storeParams.stateDir)), '会话目录应落在 userData/acp/sessions');
  assert.deepStrictEqual(
    calls.registryParams.overrides.opencode,
    ['C:\\bin\\opencode.exe', 'acp'],
    'overrides 应拼接原生 bin 与 acp 参数'
  );

  const ensure = calls.ensures[0];
  assert.strictEqual(ensure.agent, 'opencode', 'ensureSession.agent 应为 def.id');
  assert.strictEqual(ensure.mode, 'persistent', 'ensureSession.mode 应为 persistent');
  assert.strictEqual(ensure.cwd, cwd, 'ensureSession.cwd 应为沙箱目录');
  assert.strictEqual(ensure.sessionKey, acpRuntime.sessionKeyFor(cwd, 's_evt'), 'sessionKey 应稳定');
  assert.strictEqual(calls.turns[0].mode, 'prompt', 'startTurn.mode 应为 prompt');
  assert.strictEqual(calls.turns[0].text, '生成页面', 'startTurn.text 应为完整 prompt');
  assert.strictEqual(typeof calls.turns[0].onPermissionRequest, 'function', 'startTurn 应挂权限回调');
}

// ---------- 断言3：权限请求发出 + resolvePermission 继续 ----------
async function test3_Permission() {
  const { fake, calls } = createFakeModule({
    turnFactory: () => createFakeTurn([], { autoFinish: false })
  });
  installFake(fake);

  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\perm',
    uiSessionId: 's_perm',
    prompt: '改文件',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload), getFileChanges: () => [] }
  });
  assert.strictEqual(r.ok, true, 'ask 应启动');
  await waitFor(() => calls.turns.length === 1);

  const onPermission = calls.turns[0].onPermissionRequest;
  let handlerDone = false;
  const decisionPromise = onPermission({
    sessionId: 'sess-1',
    inferredKind: 'edit',
    raw: {
      toolCall: {
        toolCallId: 'tc-9',
        title: 'Edit a.html',
        kind: 'edit',
        rawInput: { path: 'a.html' },
        locations: [{ path: 'a.html', line: 3 }]
      },
      options: [
        { optionId: 'allow', name: '允许一次', kind: 'allow_once' },
        { optionId: 'deny', name: '拒绝', kind: 'reject_once' }
      ]
    }
  }, { signal: new AbortController().signal }).then((d) => { handlerDone = true; return d; });

  await waitFor(() => emitted.some((e) => e.type === 'permission_request'));
  const perm = emitted.find((e) => e.type === 'permission_request');
  assert.ok(perm.id, 'permission_request 应带 id');
  assert.strictEqual(perm.uiSessionId, 's_perm', '权限卡应透传 uiSessionId');
  assert.strictEqual(perm.sessionId, 'sess-1', '权限卡应带 ACP sessionId');
  assert.strictEqual(perm.agentId, 'opencode', '权限卡应带 agentId');
  assert.strictEqual(perm.agentName, 'OpenCode CLI', '权限卡应带 agentName');
  assert.strictEqual(perm.acpSessionId, 'sess-1', '权限卡应带 acpSessionId');
  assert.strictEqual(perm.workdir, 'C:\\sandbox\\perm', '权限卡应带 workdir');
  assert.strictEqual(perm.toolCallId, 'tc-9', '权限卡应带 toolCallId');
  assert.strictEqual(perm.title, 'Edit a.html', '权限卡标题应透传');
  assert.strictEqual(perm.kind, 'edit', '权限卡 kind 应为工具类型');
  assert.strictEqual(perm.path, 'a.html', '权限卡应带目标路径');
  assert.strictEqual(perm.options.length, 2, '权限卡应带 Agent 提供的 options');
  assert.strictEqual(perm.risk, 'medium', 'edit 风险应为 medium');
  assert.strictEqual(handlerDone, false, '未回传前 handler 应保持等待');

  // 权限桥 entry 必须记录 Agent / 会话复合键，供 runtime 收尾精确取消
  const entry = acpRuntime.getPermissionBridge().pending.get(perm.id);
  assert.ok(entry, '权限桥应有对应待决 entry');
  assert.strictEqual(entry.agentId, 'opencode', 'pending entry 应记录 agentId');
  assert.strictEqual(entry.sessionId, 'sess-1', 'pending entry 应记录 sessionId');
  assert.strictEqual(entry.uiSessionId, 's_perm', 'pending entry 应记录 uiSessionId');

  assert.strictEqual(acpRuntime.resolvePermission(perm.id, 'allow-once'), true, 'resolvePermission 应命中');
  const decision = await decisionPromise;
  assert.deepStrictEqual(decision, { outcome: 'allow_once' }, 'allow-once 应归一化为 allow_once');
  await waitFor(() => emitted.some((e) => e.type === 'permission_resolved' && e.id === perm.id));
  const resolvedEv = emitted.find((e) => e.type === 'permission_resolved' && e.id === perm.id);
  assert.ok(resolvedEv, 'resolvePermission 后应发 permission_resolved');
  assert.strictEqual(resolvedEv.transport, 'acp', 'permission_resolved 应带 transport=acp');
  assert.strictEqual(resolvedEv.agentId, 'opencode', 'permission_resolved 应带 agentId');
  assert.deepStrictEqual(resolvedEv.decision, { outcome: 'allow_once' }, 'permission_resolved 应回传归一化决策');

  // optionId 形式：直接转 selected
  const p2 = onPermission({
    sessionId: 'sess-1',
    inferredKind: 'read',
    raw: { toolCall: { toolCallId: 'tc-10', title: 'Read', kind: 'read' }, options: [{ optionId: 'opt-x', name: '允许', kind: 'allow_once' }] }
  }, { signal: new AbortController().signal });
  await waitFor(() => emitted.filter((e) => e.type === 'permission_request').length === 2);
  const perm2 = emitted.filter((e) => e.type === 'permission_request')[1];
  assert.strictEqual(acpRuntime.resolvePermission(perm2.id, { optionId: 'opt-x' }), true, 'optionId 应命中');
  assert.deepStrictEqual(await p2, { outcome: 'selected', optionId: 'opt-x' }, 'optionId 应转 selected');

  calls.lastTurn.finish({ status: 'completed', stopReason: 'end_turn' });
  await waitFor(() => emitted.some((e) => e.type === 'done'));
}

// ---------- 断言4：取消 turn.cancel + 2 秒兜底可注入 ----------
async function test4_Cancel() {
  // 4a：turn.cancel 生效，不触发 kill
  {
    const { fake, calls } = createFakeModule({
      turnFactory: () => createFakeTurn([], {
        autoFinish: false,
        onCancel: (finish) => finish({ status: 'cancelled', stopReason: 'cancelled' })
      })
    });
    installFake(fake);
    const emitted = [];
    const r = await acpRuntime.ask({
      def: ACP_DEF,
      cwd: 'C:\\sandbox\\cancel',
      uiSessionId: 's_cancel',
      prompt: '取消我',
      aiCfg: BASE_CFG,
      handlers: { emit: (payload) => emitted.push(payload), getFileChanges: () => [] }
    });
    assert.strictEqual(r.ok, true, 'ask 应启动');
    assert.strictEqual(shared.activeExecution && shared.activeExecution.kind, 'acp', 'activeExecution 应为 acp');

    const killed = [];
    const canceled = await acpRuntime.cancel({
      graceMs: 100,
      killProcessTree: async (pid) => { killed.push(pid); }
    });
    assert.strictEqual(canceled, true, 'cancel 应命中当前 ACP 轮次');
    assert.strictEqual(calls.lastTurn.cancelCalls, 1, '应调用 turn.cancel 一次');
    assert.deepStrictEqual(killed, [], 'turn 正常结束不应 kill');
    await waitFor(() => emitted.some((e) => e.type === 'done' && e.cancelled === true));
    assert.strictEqual(shared.activeExecution, null, '取消后应清理 activeExecution');
  }

  // 4b：turn.cancel 不结束 → 注入 timer / kill 回调验证兜底
  {
    const { fake, calls } = createFakeModule({
      pid: 9876,
      turnFactory: () => createFakeTurn([], { autoFinish: false })
    });
    installFake(fake);
    const emitted = [];
    const r = await acpRuntime.ask({
      def: ACP_DEF,
      cwd: 'C:\\sandbox\\cancel2',
      uiSessionId: 's_cancel2',
      prompt: '取消兜底',
      aiCfg: BASE_CFG,
      handlers: { emit: (payload) => emitted.push(payload), getFileChanges: () => [] }
    });
    assert.strictEqual(r.ok, true, 'ask 应启动');
    const killed = [];
    let timerUsed = false;
    const canceled = await acpRuntime.cancel({
      graceMs: 20,
      timers: {
        setTimeout: (fn) => { timerUsed = true; return { id: setTimeout(fn, 5) }; },
        clearTimeout: (handle) => clearTimeout(handle && handle.id)
      },
      killProcessTree: async (pid) => { killed.push(pid); }
    });
    assert.strictEqual(canceled, true, 'cancel 应命中');
    assert.strictEqual(calls.lastTurn.cancelCalls, 1, '应调用 turn.cancel 一次');
    assert.strictEqual(timerUsed, true, '应使用注入的定时器等待 2 秒兜底');
    assert.deepStrictEqual(killed, [9876], '未结束时应按 pid 兜底杀进程树');
    assert.strictEqual(shared.activeExecution, null, '兜底后应清理 activeExecution');
    calls.lastTurn.finish({ status: 'failed', error: { code: 'ACP_TURN_FAILED', message: 'cancelled' } });
    await waitFor(() => emitted.some((e) => e.type === 'error'));
  }
}

// ---------- 断言5：sessionKey 稳定 ----------
async function test5_SessionKey() {
  const a1 = acpRuntime.sessionKeyFor('C:\\sandbox\\a', 's_1');
  const a2 = acpRuntime.sessionKeyFor('C:\\sandbox\\a', 's_1');
  assert.strictEqual(a1, a2, '同 cwd + 同 uiSessionId 的 sessionKey 应稳定');
  assert.ok(/^pland-[0-9a-f]{12}-/.test(a1), 'sessionKey 应含 cwd 哈希前缀');
  assert.notStrictEqual(a1, acpRuntime.sessionKeyFor('C:\\sandbox\\b', 's_1'), 'cwd 变化应换 key');
  assert.notStrictEqual(a1, acpRuntime.sessionKeyFor('C:\\sandbox\\a', 's_2'), 'uiSessionId 变化应换 key');
  assert.strictEqual(
    acpRuntime.sessionKeyFor('C:\\sandbox\\a', ''),
    acpRuntime.sessionKeyFor('C:\\sandbox\\a', '   '),
    '空 uiSessionId 应统一回落 default'
  );

  // 长路径型 uiSessionId（前端可能直接传 URL 编码的完整路径）：必须生成定长短 key
  const longUiSessionId = encodeURIComponent(
    'C:\\Users\\allow\\AppData\\Roaming\\PlanD\\sandbox\\2026-11-11\\原型工具-PlanD\\会话\\tab-0123456789abcdef'
  );
  assert.ok(longUiSessionId.length > 150, `构造的长路径型 uiSessionId 应足够长，实际 ${longUiSessionId.length}`);
  const longKey = acpRuntime.sessionKeyFor('C:\\sandbox\\a', longUiSessionId);
  assert.ok(longKey.length <= 64, `长路径型 uiSessionId 生成的 key 长度应 <= 64，实际 ${longKey.length}`);
  assert.ok(
    /^pland-[0-9a-f]{12}-[0-9a-f]{12}$/.test(longKey),
    `长路径型 key 应为 pland-<cwdHash>-<sidHash> 定长格式，实际 ${longKey}`
  );
  assert.strictEqual(
    longKey,
    acpRuntime.sessionKeyFor('C:\\sandbox\\a', longUiSessionId),
    '长路径型 uiSessionId 同输入应生成稳定 key'
  );
  assert.notStrictEqual(
    longKey,
    acpRuntime.sessionKeyFor('C:\\sandbox\\a', longUiSessionId + '%20x'),
    '长路径型 uiSessionId 不同输入应生成不同 key'
  );
  assert.ok(
    acpRuntime.sessionKeyFor('C:\\sandbox\\a', longUiSessionId).indexOf('%') < 0,
    'key 不应包含 URL 转义字符，避免 acpx 落盘文件名再次膨胀'
  );

  // 两轮 ask 复用同一 sessionKey，但 requestId 每轮不同
  const { fake, calls } = createFakeModule({});
  installFake(fake);
  const args = {
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\key',
    uiSessionId: 's_key',
    prompt: 'one',
    aiCfg: BASE_CFG,
    handlers: { emit: () => {} }
  };
  assert.strictEqual((await acpRuntime.ask(args)).ok, true, '首轮应启动');
  await waitFor(() => calls.ensures.length === 1);
  await waitFor(() => shared.activeExecution === null);
  assert.strictEqual((await acpRuntime.ask(Object.assign({}, args, { prompt: 'two' }))).ok, true, '次轮应启动');
  await waitFor(() => calls.ensures.length === 2);
  assert.strictEqual(calls.ensures[0].sessionKey, calls.ensures[1].sessionKey, '跨轮 sessionKey 应复用');
  assert.notStrictEqual(calls.turns[0].requestId, calls.turns[1].requestId, 'requestId 每轮应不同');
}

// ---------- 断言6：恢复失败自动新建会话 ----------
async function test6_ResumeFallback() {
  let failFirst = true;
  const { fake, calls } = createFakeModule({
    ensureSession(input, ensureCalls) {
      if (input.resumeSessionId && failFirst) {
        failFirst = false;
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
    },
    events: [{ type: 'text_delta', text: 'ok', stream: 'output' }]
  });
  installFake(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\resume',
    uiSessionId: 's_resume',
    prompt: 'continue',
    aiCfg: BASE_CFG,
    resumeSessionId: 'old-session',
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, '恢复失败后应回退新会话并启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));
  assert.strictEqual(calls.ensures.length, 2, '应先尝试恢复，再新建会话');
  assert.strictEqual(calls.ensures[0].resumeSessionId, 'old-session', '首次 ensure 应带 resumeSessionId');
  assert.strictEqual(calls.ensures[1].resumeSessionId, undefined, '回退 ensure 不应再带 resumeSessionId');
  assert.ok(emitted.some((e) => e.type === 'trace' && e.trace && e.trace.tag === 'SESSION'), '应发 SESSION 恢复失败 trace');
  assert.ok(emitted.some((e) => e.type === 'session' && e.id === 'sess-new'), '应回填新 ACP 会话 id');
}

// ---------- 断言7：会话建立后按 getStatus 应用模型/思考强度 ----------
async function test7_SessionConfigApply() {
  const { fake, calls } = createFakeModule({
    events: [{ type: 'text_delta', text: 'ok', stream: 'output' }]
  });
  installFake(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\cfg',
    uiSessionId: 's_cfg',
    prompt: '配置模型',
    requestedModel: 'model-b',
    modelSource: 'ui',
    agentConfigModel: 'model-a',
    requestedThought: 'high',
    globalModel: 'deepseek-chat',
    model: 'deepseek-chat',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, '配置轮应启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));

  const ensure = calls.ensures[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(ensure, 'sessionOptions'), 'ensureSession 不得再传 sessionOptions');
  assert.strictEqual(ensure.sessionKey, acpRuntime.sessionKeyFor('C:\\sandbox\\cfg', 's_cfg'), 'sessionKey 应稳定');
  assert.strictEqual(calls.statusCalls.length, 1, 'ensure 后应调用一次 getStatus');
  assert.strictEqual(calls.statusCalls[0].handle.backendSessionId, 'sess-1', 'getStatus 应收到 ensure 返回的 handle');

  assert.deepStrictEqual(
    calls.setConfigOptionCalls[0],
    { handle: calls.statusCalls[0].handle, key: 'model', value: 'model-b' },
    '模型应优先 setConfigOption(model)，且使用对象签名'
  );
  assert.deepStrictEqual(
    calls.setConfigOptionCalls[1],
    { handle: calls.statusCalls[0].handle, key: 'thought_level', value: 'high' },
    '思考强度应 setConfigOption(thought_level, high)'
  );
  assert.strictEqual(calls.setModelCalls.length, 0, '有 model config option 时不应回落到 setModel');

  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.ok(cfgEv, '必须发 acp_config 事件');
  assert.strictEqual(cfgEv.model, 'model-b', 'acp_config.model 应为 UI 选择');
  assert.strictEqual(cfgEv.modelConfigId, 'context_size', 'acp_config 应带 model_config id');
  assert.strictEqual(cfgEv.thoughtConfigId, 'thought_level', 'acp_config 应带 thought_level id');
  assert.strictEqual(cfgEv.thoughtValue, 'high', 'acp_config 应带思考强度值');
  assert.strictEqual(cfgEv.configOptions.length, 3, 'acp_config 应带归一化 configOptions');
  assert.strictEqual(cfgEv.transport, 'acp', 'acp_config 应带 transport=acp');
  assert.strictEqual(cfgEv.uiSessionId, 's_cfg', 'acp_config 应透传 uiSessionId');
  assert.strictEqual(cfgEv.agentId, 'opencode', 'acp_config 应带 agentId');
  assert.strictEqual(cfgEv.agentName, 'OpenCode CLI', 'acp_config 应带 agentName');
  assert.strictEqual(cfgEv.acpSessionId, 'sess-1', 'acp_config 应带 acpSessionId');
  assert.strictEqual(cfgEv.workdir, 'C:\\sandbox\\cfg', 'acp_config 应带 workdir');

  // 全局 / legacy 模型经 UI 泄漏：忽略并降级到 current，不阻断
  const second = createFakeModule({ events: [{ type: 'text_delta', text: 'ok', stream: 'output' }] });
  installFake(second.fake);
  const emitted2 = [];
  const r2 = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\cfg2',
    uiSessionId: 's_cfg2',
    prompt: '泄漏模型',
    requestedModel: 'deepseek-chat',
    modelSource: 'ui',
    globalModel: 'deepseek-chat',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted2.push(payload) }
  });
  assert.strictEqual(r2.ok, true, '全局模型泄漏不应阻断本轮');
  await waitFor(() => emitted2.some((e) => e.type === 'done'));
  const cfgEv2 = emitted2.find((e) => e.type === 'acp_config');
  assert.strictEqual(cfgEv2.model, 'model-a', '泄漏模型应忽略并降级到 currentModelId');
  assert.ok(cfgEv2.warnings.includes('ignored-global-model'), '应记录 ignored-global-model 警告');
  assert.strictEqual(
    second.calls.setConfigOptionCalls[0].value,
    'model-a',
    '实际应用的模型也应是降级后的 currentModelId'
  );
}

// ---------- 断言8：UI 选择不受支持模型 → 不发送 prompt ----------
async function test8_ModelUnsupported() {
  const { fake, calls } = createFakeModule({
    events: [{ type: 'text_delta', text: '不应执行', stream: 'output' }]
  });
  installFake(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\unsupported',
    uiSessionId: 's_unsupported',
    prompt: '不应发送',
    requestedModel: 'model-x',
    modelSource: 'ui',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, false, '不受支持模型应使 ask 失败');
  assert.strictEqual(calls.turns.length, 0, 'ACP_MODEL_UNSUPPORTED 时不得 startTurn');

  const errEv = emitted.find((e) => e.type === 'error');
  assert.ok(errEv, '应发 error 事件');
  assert.strictEqual(errEv.code, 'ACP_MODEL_UNSUPPORTED', '错误码应为 ACP_MODEL_UNSUPPORTED');
  assert.deepStrictEqual(errEv.availableModels, ['model-a', 'model-b'], 'error 应带 availableModels');
  assert.ok(/requestedModel=model-x/.test(errEv.detail), 'error.detail 应包含请求模型');
  assert.ok(/model-b/.test(errEv.detail), 'error.detail 应包含可用模型列表');
  assert.strictEqual(errEv.agentId, 'opencode', 'error 应带 agentId');
  assert.ok(/opencode\.exe$/.test(errEv.command), 'error 应带解析出的命令');
  const cfgEv = emitted.find((e) => e.type === 'acp_config');
  assert.ok(cfgEv, '失败前也应发 acp_config 供 UI 刷新模型列表');
  assert.strictEqual(cfgEv.error, 'ACP_MODEL_UNSUPPORTED', 'acp_config 应标记模型不受支持');
}

// ---------- 断言9：resetSession / freshSession 走 prepareFreshSession ----------
async function test9_ResetAndFresh() {
  const { fake, calls } = createFakeModule({
    events: [{ type: 'text_delta', text: 'ok', stream: 'output' }]
  });
  installFake(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\fresh',
    uiSessionId: 's_fresh',
    prompt: '新会话',
    freshSession: true,
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, true, 'freshSession 轮应启动');
  await waitFor(() => emitted.some((e) => e.type === 'done'));
  assert.strictEqual(calls.ensures.length, 2, 'freshSession 应 ensure -> reset -> ensure');
  assert.strictEqual(calls.prepareFreshSessionCalls.length, 1, 'freshSession 应调用 prepareFreshSession');
  assert.strictEqual(
    calls.prepareFreshSessionCalls[0].handle.backendSessionId,
    'sess-1',
    'prepareFreshSession 应收到对象签名 { handle }'
  );
  assert.strictEqual(
    calls.ensures[1].sessionKey,
    calls.ensures[0].sessionKey,
    'prepareFreshSession 成功后应复用同一 sessionKey 重建'
  );
  assert.strictEqual(calls.ensures[1].resumeSessionId, undefined, '重建时不得带 resumeSessionId');
  assert.strictEqual(calls.turns.length, 1, 'freshSession 只应发起一轮 turn');

  const status = await acpRuntime.getSessionStatus({ sessionKey: 'manual' });
  assert.strictEqual(status.ok, true, 'getSessionStatus 应成功');
  assert.strictEqual(status.models.currentModelId, 'model-a', 'getSessionStatus.models 应透传 currentModelId');
  assert.deepStrictEqual(
    status.configOptions.map((o) => o.id),
    ['model', 'context_size', 'thought_level'],
    'getSessionStatus.configOptions 应归一化为数组'
  );
  assert.deepStrictEqual(status.availableCommands, [], 'availableCommands 缺省应为空数组');
  assert.strictEqual(status.usage, null, 'usage 缺省应为 null');

  const reset = await acpRuntime.resetSession({ sessionKey: 'manual' });
  assert.deepStrictEqual(reset, { ok: true, method: 'prepareFreshSession' }, 'resetSession 应优先 prepareFreshSession');
  assert.strictEqual(calls.prepareFreshSessionCalls.length, 2, '公开 resetSession 也应调用 prepareFreshSession');

  // 无 prepareFreshSession 时回落 close({reason:'user-reset',discardPersistentState:true})
  const second = createFakeModule({ noPrepareFreshSession: true, events: [] });
  installFake(second.fake);
  const r2 = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\fresh2',
    uiSessionId: 's_fresh2',
    prompt: 'close 兜底',
    aiCfg: BASE_CFG,
    handlers: { emit: () => {} }
  });
  assert.strictEqual(r2.ok, true, 'close 兜底轮应启动');
  const reset2 = await acpRuntime.resetSession({ sessionKey: 'manual' });
  assert.deepStrictEqual(reset2, { ok: true, method: 'close' }, '无 prepareFreshSession 时应回落 close');
  assert.strictEqual(second.calls.closeCalls.length, 1, '应调用一次 close');
  assert.deepStrictEqual(
    second.calls.closeCalls[0],
    {
      handle: { sessionKey: 'manual' },
      reason: 'user-reset',
      discardPersistentState: true
    },
    'close 应使用对象签名并丢弃持久状态'
  );
}

// ---------- 断言10：errorPayload 带脱敏 detail / agentId / command ----------
async function test10_ErrorDetail() {
  const { fake } = createFakeModule({
    ensureSession() {
      const err = new Error('ACP 会话初始化失败');
      err.code = 'ACP_SESSION_INIT_FAILED';
      err.cause = { code: 'ENOENT', message: 'spawn agy_acp_server.exe ENOENT' };
      throw err;
    }
  });
  installFake(fake);
  const emitted = [];
  const r = await acpRuntime.ask({
    def: ACP_DEF,
    cwd: 'C:\\sandbox\\detail',
    uiSessionId: 's_detail',
    prompt: 'hi',
    aiCfg: BASE_CFG,
    handlers: { emit: (payload) => emitted.push(payload) }
  });
  assert.strictEqual(r.ok, false, '会话初始化失败应使 ask 失败');
  const errEv = emitted.find((e) => e.type === 'error');
  assert.ok(errEv, '应发 error 事件');
  assert.strictEqual(errEv.code, 'ACP_BACKEND_MISSING', '根因 ENOENT 应归一化为 ACP_BACKEND_MISSING');
  assert.strictEqual(typeof errEv.detail, 'string', 'errorPayload.detail 应为字符串');
  assert.ok(/ENOENT/.test(errEv.detail), 'detail 应保留原始 spawn 错误');
  assert.ok(/agy_acp_server\.exe/.test(errEv.detail), 'detail 应包含可执行文件名');
  assert.strictEqual(errEv.agentId, 'opencode', 'error 应带 agentId');
  assert.ok(errEv.command, 'error 应带解析出的命令');
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

  await run('断言1 ACP 默认关闭与分流条件', test1_IsAcpEnabled);
  await run('断言2 run_started/chunk/thinking/tool_call/done 事件契约', test2_EventContract);
  await run('断言3 权限请求与 resolvePermission 回传', test3_Permission);
  await run('断言4 cancel 与 2 秒兜底', test4_Cancel);
  await run('断言5 sessionKey 稳定', test5_SessionKey);
  await run('断言6 恢复失败自动新建会话', test6_ResumeFallback);
  await run('断言7 会话建立后应用模型/思考强度', test7_SessionConfigApply);
  await run('断言8 不受支持模型不发送 prompt', test8_ModelUnsupported);
  await run('断言9 resetSession / freshSession 生命周期', test9_ResetAndFresh);
  await run('断言10 errorPayload detail 透传', test10_ErrorDetail);

  acpRuntime._resetForTest();
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
