'use strict';
// Phase 0 ACP 能力表与 registry 挂载验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖：20 个 ACP Agent 全覆盖、adapter 合法、registry 补字段正确、非 ACP 不误标。
const assert = require('node:assert');

const { ACP_CAPABILITIES, ACP_CAPABLE } = require('../runtimes/acp-capabilities');
const { BASE_AGENT_DEFS, getAgentDef, getAllAgentDefs } = require('../runtimes/registry');
const { buildAcpOverrides } = require('../main/acp/acp-registry');

const EXPECTED_ACP_IDS = [
  'opencode',
  'claude',
  'codex',
  'cursor-agent',
  'deepseek-harness',
  'qwen',
  'codebuddy',
  'grok-build',
  'antigravity',
  'copilot',
  'devin',
  'hermes',
  'kilo',
  'kimi',
  'kiro',
  'pi',
  'qoder',
  'reasonix',
  'trae-cli',
  'vibe'
];

const NON_ACP_IDS = ['deepseek', 'mimo', 'amp', 'aider', 'atomcode', 'amr'];

const EXPECTED_DEF_ORDER = [
  'opencode',
  'claude',
  'cursor-agent',
  'codex',
  'deepseek-harness',
  'qwen',
  'deepseek',
  'mimo',
  'amp',
  'codebuddy',
  'aider',
  'grok-build',
  'antigravity',
  'atomcode',
  'amr',
  'copilot',
  'devin',
  'hermes',
  'kilo',
  'kimi',
  'kiro',
  'pi',
  'qoder',
  'reasonix',
  'trae-cli',
  'vibe'
];

const ALLOWED_ADAPTERS = new Set(['', 'claude-agent-acp', 'codex-acp', 'pi-acp']);

// ---------- 断言1：能力表 20 个 id 全覆盖、字段合法 ----------
function test1_CapabilityTable() {
  assert.strictEqual(EXPECTED_ACP_IDS.length, 20, 'ACP 期望清单应为 20 个');
  assert.strictEqual(ACP_CAPABLE, ACP_CAPABILITIES, 'ACP_CAPABLE 应为 ACP_CAPABILITIES 的兼容别名');

  const keys = Object.keys(ACP_CAPABILITIES);
  assert.strictEqual(keys.length, 20, `能力表应恰好 20 项，实际 ${keys.length}`);
  assert.deepStrictEqual(
    [...keys].sort(),
    [...EXPECTED_ACP_IDS].sort(),
    `能力表 id 集合不符，实际 [${keys.join(', ')}]`
  );

  for (const id of EXPECTED_ACP_IDS) {
    const cap = ACP_CAPABILITIES[id];
    assert.ok(cap && typeof cap === 'object', `${id} 应有能力声明`);
    assert.ok(Array.isArray(cap.args), `${id}.args 应为数组`);
    assert.ok(cap.args.every((a) => typeof a === 'string'), `${id}.args 应全部为 string`);
    assert.strictEqual(typeof cap.adapter, 'string', `${id}.adapter 应为 string`);
    assert.ok(ALLOWED_ADAPTERS.has(cap.adapter), `${id}.adapter 非法：${cap.adapter}`);
  }

  // 适配器型 Agent 必须指向唯一合法适配器，且启动参数为空（由适配器自行拉起底层 CLI）
  assert.strictEqual(ACP_CAPABILITIES.claude.adapter, 'claude-agent-acp', 'claude 应使用 claude-agent-acp');
  assert.strictEqual(ACP_CAPABILITIES.codex.adapter, 'codex-acp', 'codex 应使用 codex-acp');
  assert.strictEqual(ACP_CAPABILITIES.pi.adapter, 'pi-acp', 'pi 应使用 pi-acp');
  for (const id of ['claude', 'codex', 'pi']) {
    assert.strictEqual(ACP_CAPABILITIES[id].args.length, 0, `${id} 为适配器型，args 应为空`);
  }

  // 原生 ACP 的关键启动参数抽查
  assert.deepStrictEqual(ACP_CAPABILITIES.opencode.args, ['acp'], 'opencode 应为 acp 子命令');
  assert.deepStrictEqual(ACP_CAPABILITIES['cursor-agent'].args, ['acp'], 'cursor-agent 应为 acp 子命令');
  assert.deepStrictEqual(ACP_CAPABILITIES.qwen.args, ['--acp'], 'qwen 应为 --acp');
  assert.deepStrictEqual(ACP_CAPABILITIES.codebuddy.args, ['--acp'], 'codebuddy 应为 --acp');
  assert.strictEqual(ACP_CAPABILITIES.codebuddy.adapter, '', 'codebuddy 应使用 CLI 原生 ACP');
  assert.deepStrictEqual(ACP_CAPABILITIES.copilot.args, ['--acp', '--stdio'], 'copilot 应为 --acp --stdio');
  assert.deepStrictEqual(ACP_CAPABILITIES.qoder.args, ['--acp'], 'qoder 应为 --acp');
  assert.deepStrictEqual(ACP_CAPABILITIES['trae-cli'].args, ['acp', 'serve'], 'trae-cli 应为 acp serve');
  assert.deepStrictEqual(ACP_CAPABILITIES.antigravity.args, ['acp'], 'antigravity 应为 agy acp');
  assert.strictEqual(ACP_CAPABILITIES.antigravity.adapter, '', 'antigravity 应使用 CLI 原生 ACP');
  assert.strictEqual(ACP_CAPABILITIES.antigravity.command, undefined, 'antigravity 不应再声明独立 ACP 二进制');
}

// ---------- 断言2：registry 补字段且保持 26 个 def / 顺序 / id 唯一 ----------
function test2_RegistryMount() {
  const defs = getAllAgentDefs();
  assert.strictEqual(defs.length, 26, `def 数量应保持 26，实际 ${defs.length}`);
  assert.deepStrictEqual(defs.map((d) => d.id), EXPECTED_DEF_ORDER, 'def 顺序应与既有注册表一致');
  assert.strictEqual(new Set(defs.map((d) => d.id)).size, 26, 'id 应唯一');
  assert.strictEqual(BASE_AGENT_DEFS.length, 26, 'BASE_AGENT_DEFS 长度应保持 26');

  for (const id of EXPECTED_ACP_IDS) {
    const def = getAgentDef(id);
    assert.ok(def, `registry 应含 ${id}`);
    assert.strictEqual(def.transport, 'acp', `${id}.transport 应为 acp`);
    assert.ok(def.acp && typeof def.acp === 'object', `${id}.acp 应存在`);
    assert.deepStrictEqual(def.acp.args, ACP_CAPABILITIES[id].args, `${id}.acp.args 应来自能力表`);
    assert.strictEqual(def.acp.adapter, ACP_CAPABILITIES[id].adapter, `${id}.acp.adapter 应来自能力表`);
    assert.strictEqual(def.acp.command, undefined, `${id}.acp.command 不应再声明专用入口`);
  }

  // 任务明确点名的读取路径
  assert.strictEqual(getAgentDef('opencode').transport, 'acp', "getAgentDef('opencode').transport 应为 acp");
  assert.strictEqual(getAgentDef('claude').acp.adapter, 'claude-agent-acp', 'claude 应挂适配器');
  assert.strictEqual(getAgentDef('codex').acp.adapter, 'codex-acp', 'codex 应挂适配器');
  assert.deepStrictEqual(getAgentDef('antigravity').acp.args, ['acp'], 'antigravity 应复用 agy 并追加 acp 子命令');
  assert.strictEqual(getAgentDef('antigravity').acp.command, undefined, 'antigravity 不应残留 command');
}

// ---------- 断言3：非 ACP Agent 不误标 ----------
function test3_NonAcpUntouched() {
  for (const id of NON_ACP_IDS) {
    const def = getAgentDef(id);
    assert.ok(def, `registry 应含非 ACP Agent ${id}`);
    assert.notStrictEqual(def.transport, 'acp', `${id} 不应被标为 acp`);
    assert.strictEqual(def.transport, 'legacy', `${id}.transport 应为 legacy`);
    assert.strictEqual(def.acp, undefined, `${id} 不应挂 acp 字段`);
  }
  assert.strictEqual(
    getAllAgentDefs().filter((d) => d.transport === 'acp').length,
    20,
    'transport=acp 的 def 应恰好 20 个'
  );
}

// ---------- 断言4：buildAcpOverrides 纯函数与异常隔离 ----------
async function test4_AcpOverrides() {
  const defs = [
    { id: 'opencode', transport: 'acp', acp: { args: ['acp'], adapter: '' } },
    { id: 'qwen', transport: 'acp', acp: { args: ['--acp'], adapter: '' } },
    { id: 'claude', transport: 'acp', acp: { args: [], adapter: 'claude-agent-acp' } },
    { id: 'codex', transport: 'acp', acp: { args: [], adapter: 'codex-acp' } },
    { id: 'antigravity', transport: 'acp', acp: { args: ['acp'], adapter: '' } },
    { id: 'command-agent', transport: 'acp', acp: { command: 'legacy_acp_server.exe', args: ['serve'], adapter: '' } },
    { id: 'broken', transport: 'acp', acp: { args: ['x'], adapter: '' } },
    { id: 'deepseek', transport: 'legacy' }
  ];
  const calls = [];
  const overrides = await buildAcpOverrides({
    defs,
    customPaths: { opencode: 'C:\\custom\\opencode.exe' },
    resolveBin: (def) => {
      calls.push(['bin', def.id]);
      if (def.id === 'broken') throw new Error('boom');
      return `C:\\bin\\${def.id}.exe`;
    },
    resolveAdapter: (name, id) => {
      calls.push(['adapter', name, id]);
      return name === 'codex-acp' ? '' : `C:\\adapter\\${name}.cmd`;
    },
    resolveCommand: (name, id) => {
      calls.push(['command', name, id]);
      return `C:\\bin\\${name}`;
    }
  });

  assert.deepStrictEqual(
    overrides.opencode,
    ['C:\\custom\\opencode.exe', 'acp'],
    'customPaths 应优先于 bin/adapter 解析'
  );
  assert.deepStrictEqual(overrides.qwen, ['C:\\bin\\qwen.exe', '--acp'], '原生 ACP 应拼接 bin 与 args');
  assert.deepStrictEqual(
    overrides.claude,
    ['C:\\adapter\\claude-agent-acp.cmd'],
    '适配器 ACP 应拼接 adapter 与 args'
  );
  assert.deepStrictEqual(
    overrides.antigravity,
    ['C:\\bin\\antigravity.exe', 'acp'],
    'antigravity 应走原生 bin 解析并追加 acp 子命令'
  );
  assert.deepStrictEqual(
    overrides['command-agent'],
    ['C:\\bin\\legacy_acp_server.exe', 'serve'],
    'command 型 ACP 应走 resolveCommand 并拼接 args'
  );
  assert.strictEqual(overrides.codex, undefined, '适配器解析为空应跳过该 Agent');
  assert.strictEqual(overrides.broken, undefined, '单条解析异常应跳过而不影响整体');
  assert.strictEqual('deepseek' in overrides, false, '非 ACP def 不应出现在 overrides');
  assert.ok(!calls.some((c) => c[0] === 'bin' && c[1] === 'opencode'), '自定义路径命中时不应再调 resolveBin');
  assert.ok(calls.some((c) => c[0] === 'bin' && c[1] === 'broken'), 'broken 应尝试解析并隔离异常');

  const empty = await buildAcpOverrides({ defs });
  assert.deepStrictEqual(empty, {}, '未注入解析回调时应返回空对象而非抛错');
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

  await run('断言1 ACP 能力表 20 项全覆盖', test1_CapabilityTable);
  await run('断言2 registry 统一补 transport/acp', test2_RegistryMount);
  await run('断言3 非 ACP Agent 不误标', test3_NonAcpUntouched);
  await run('断言4 buildAcpOverrides 纯函数', test4_AcpOverrides);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
