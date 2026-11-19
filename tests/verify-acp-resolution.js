'use strict';
// ACP 命令解析验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖：agy 厂商目录解析、PATH/自定义路径优先级、command 失败回落 resolveBin、
//       codebuddy.cmd 解析、unresolved 原因与候选链、buildAcpOverridesDetailed/onUnresolved。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// resolution.js 在 require 时解构 execSync；测试固定 npm 全局根，避免空 PATH 下探测 npm 产生噪音。
const childProcess = require('node:child_process');
const realExecSync = childProcess.execSync;
childProcess.execSync = function patchedExecSync(command, options) {
  if (/^\s*npm\s+root\s+-g\s*$/.test(String(command))) return 'C:\\__pland_test_npm_root__\n';
  return realExecSync.call(this, command, options);
};
const { resolveAgentExecutable } = require('../runtimes/resolution');
childProcess.execSync = realExecSync;
const { getAgentDef } = require('../runtimes/registry');
const {
  buildAcpOverrides,
  buildAcpOverridesDetailed,
  resolveAgentCommand,
  RESOLVE_REASONS
} = require('../main/acp/acp-registry');

const ENV_KEYS = ['LOCALAPPDATA', 'APPDATA', 'ProgramData', 'ProgramFiles', 'USERPROFILE', 'HOME', 'PATH'];

function makeBin(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'x');
  return filePath;
}

function exeName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

/**
 * 在隔离的环境变量下执行 fn，结束后逐项还原。
 * @param {Object<string,string>} overrides 临时环境变量
 * @param {Function} fn 待执行逻辑
 * @returns {Promise<*>} fn 的返回值
 */
async function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  try {
    for (const key of ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) process.env[key] = overrides[key];
    }
    return await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/**
 * 构造一次性的隔离目录与环境变量。
 * @param {string} root 临时根目录
 * @returns {{env:Object<string,string>, pathDir:string, localDir:string, homeDir:string}}
 */
function isolatedEnv(root) {
  const pathDir = path.join(root, 'path');
  const localDir = path.join(root, 'local');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(pathDir, { recursive: true });
  return {
    pathDir,
    localDir,
    homeDir,
    env: {
      LOCALAPPDATA: localDir,
      APPDATA: path.join(root, 'roaming'),
      ProgramData: path.join(root, 'programdata'),
      ProgramFiles: path.join(root, 'programfiles'),
      USERPROFILE: homeDir,
      HOME: homeDir,
      PATH: pathDir
    }
  };
}

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pland-acp-${label}-`));
}

// ---------- 断言1：agy 厂商目录解析（LOCALAPPDATA\agy\bin / Programs\agy\bin） ----------
async function test1_AgyVendorDirs() {
  const def = getAgentDef('antigravity');
  assert.ok(def && def.bin === 'agy', 'antigravity def 应存在且 bin=agy');

  // 1a. %LOCALAPPDATA%\agy\bin 命中，且优先于 %APPDATA%\npm 同名文件
  {
    const root = tmpRoot('agy1');
    const env = isolatedEnv(root);
    const expected = makeBin(path.join(env.localDir, 'agy', 'bin', exeName('agy')));
    makeBin(path.join(env.env.APPDATA, 'npm', exeName('agy')));
    const got = await withEnv(env.env, () => resolveAgentExecutable(def, ''));
    assert.strictEqual(got, expected, `agy 应命中厂商目录，实际 ${got}`);
  }

  // 1b. 首个目录缺失时回落 %LOCALAPPDATA%\Programs\agy\bin
  {
    const root = tmpRoot('agy2');
    const env = isolatedEnv(root);
    const expected = makeBin(path.join(env.localDir, 'Programs', 'agy', 'bin', exeName('agy')));
    const got = await withEnv(env.env, () => resolveAgentExecutable(def, ''));
    assert.strictEqual(got, expected, `agy 应命中 Programs 厂商目录，实际 ${got}`);
  }

  // 1c. PATH 命中优先于厂商目录（厂商目录仅作 PATH 之后兜底）
  {
    const root = tmpRoot('agy3');
    const env = isolatedEnv(root);
    const expected = makeBin(path.join(env.pathDir, exeName('agy')));
    makeBin(path.join(env.localDir, 'agy', 'bin', exeName('agy')));
    const got = await withEnv(env.env, () => resolveAgentExecutable(def, ''));
    assert.strictEqual(got, expected, `PATH 命中应优先，实际 ${got}`);
  }

  // 1d. 本机真实安装时打印解析结果，避免只验证假目录
  if (process.platform === 'win32') {
    const realVendor = path.join(
      process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
      'agy',
      'bin',
      'agy.exe'
    );
    if (fs.existsSync(realVendor)) {
      const got = await resolveAgentExecutable(def, '');
      assert.strictEqual(got, realVendor, `本机 agy 应解析到 ${realVendor}，实际 ${got}`);
      console.log(`[INFO] 本机 antigravity -> ${got}`);
    }
  }
}

// ---------- 断言2：自定义路径优先且不破坏 qoder CN 私有目录 ----------
async function test2_CustomAndQoderPriority() {
  const def = getAgentDef('antigravity');

  // 2a. cliPaths 自定义路径优先于厂商目录
  {
    const root = tmpRoot('custom');
    const env = isolatedEnv(root);
    const custom = makeBin(path.join(root, 'custom', exeName('agy-custom')));
    makeBin(path.join(env.localDir, 'agy', 'bin', exeName('agy')));
    const got = await withEnv(env.env, () => resolveAgentExecutable(def, custom));
    assert.strictEqual(got, custom, `自定义路径应优先，实际 ${got}`);
  }

  // 2b. qoder CN 私有目录仍优先于 PATH（不得被新增厂商目录逻辑挤后）
  {
    const root = tmpRoot('qoder');
    const env = isolatedEnv(root);
    const cn = makeBin(
      path.join(env.homeDir, '.qoder-cn', 'bin', 'qoderclicn', 'qoderclicn-9.9.9.exe')
    );
    makeBin(path.join(env.pathDir, exeName('qodercli')));
    const got = await withEnv(env.env, () => resolveAgentExecutable(getAgentDef('qoder'), ''));
    assert.strictEqual(got, cn, `qoder CN 私有目录应优先，实际 ${got}`);
  }
}

// ---------- 断言3：resolveAgentCommand 优先级与 command 回落 ----------
async function test3_ResolveCommand() {
  const antigravity = getAgentDef('antigravity');

  // 3a. 原生 ACP：bin + args
  {
    const r = await resolveAgentCommand(antigravity, { resolveBin: () => 'C:\\bin\\agy.exe' });
    assert.deepStrictEqual(r.command, ['C:\\bin\\agy.exe', 'acp'], 'antigravity 应生成 [agy, acp]');
    assert.strictEqual(r.unresolved, null, '解析成功时 unresolved 应为 null');
  }

  // 3b. 自定义路径优先，且不再调用 resolveBin
  {
    let binCalls = 0;
    const r = await resolveAgentCommand(antigravity, {
      customPaths: { antigravity: 'C:\\custom\\agy.exe' },
      resolveBin: () => { binCalls += 1; return 'C:\\bin\\agy.exe'; }
    });
    assert.deepStrictEqual(r.command, ['C:\\custom\\agy.exe', 'acp'], '自定义路径应优先');
    assert.strictEqual(binCalls, 0, '自定义路径命中时不应调用 resolveBin');
  }

  // 3c. 适配器型 Agent
  {
    const r = await resolveAgentCommand(getAgentDef('claude'), {
      resolveAdapter: (name) => `C:\\adapter\\${name}.cmd`
    });
    assert.deepStrictEqual(r.command, ['C:\\adapter\\claude-agent-acp.cmd'], '适配器应作为启动命令');
  }

  // 3d. command 解析失败（空值）→ 回落 resolveBin
  {
    const def = { id: 'antigravity', transport: 'acp', bin: 'agy', acp: { command: 'agy_acp_server.exe', args: ['acp'], adapter: '' } };
    const calls = [];
    const r = await resolveAgentCommand(def, {
      resolveCommand: (name) => { calls.push(['command', name]); return null; },
      resolveBin: (d) => { calls.push(['bin', d.bin]); return 'C:\\bin\\agy.exe'; }
    });
    assert.deepStrictEqual(r.command, ['C:\\bin\\agy.exe', 'acp'], 'command 为空应回落 bin');
    assert.strictEqual(r.unresolved, null, '回落成功时 unresolved 应为 null');
    assert.deepStrictEqual(calls, [['command', 'agy_acp_server.exe'], ['bin', 'agy']], '应先尝试 command 再回落 bin');
  }

  // 3e. command 解析抛错 → 同样回落 resolveBin
  {
    const def = { id: 'antigravity', transport: 'acp', bin: 'agy', acp: { command: 'agy_acp_server.exe', args: ['acp'], adapter: '' } };
    const r = await resolveAgentCommand(def, {
      resolveCommand: () => { throw new Error('spawn ENOENT'); },
      resolveBin: () => 'C:\\bin\\agy.exe'
    });
    assert.deepStrictEqual(r.command, ['C:\\bin\\agy.exe', 'acp'], 'command 抛错应回落 bin');
  }

  // 3f. 未注入 resolveCommand 时沿用 resolveAdapter（兼容旧行为）
  {
    const def = { id: 'legacy', transport: 'acp', acp: { command: 'legacy-acp', args: [], adapter: '' } };
    const r = await resolveAgentCommand(def, {
      resolveAdapter: (name) => `C:\\adapter\\${name}.cmd`
    });
    assert.deepStrictEqual(r.command, ['C:\\adapter\\legacy-acp.cmd'], '缺省应复用 adapter 解析器');
  }

  // 3g. codebuddy 原生 ACP：Windows .cmd shim 解析后追加 --acp
  {
    const def = getAgentDef('codebuddy');
    assert.ok(def && def.transport === 'acp', 'codebuddy 应为 ACP Agent');
    assert.strictEqual(def.bin, 'codebuddy', 'codebuddy def 的 bin 应为 codebuddy');
    const r = await resolveAgentCommand(def, {
      resolveBin: () => 'D:\\AppFile\\codebuudy\\codebuddy.cmd'
    });
    assert.deepStrictEqual(
      r.command,
      ['D:\\AppFile\\codebuudy\\codebuddy.cmd', '--acp'],
      'codebuddy.cmd 应解析为 [codebuddy.cmd, --acp]'
    );
    assert.strictEqual(r.unresolved, null, 'codebuddy.cmd 解析成功时 unresolved 应为 null');
  }
}

// ---------- 断言4：unresolved 原因与候选链 ----------
async function test4_UnresolvedReasons() {
  // 4a. command + bin 双失败：not_found，候选链完整
  {
    const def = { id: 'antigravity', transport: 'acp', bin: 'agy', acp: { command: 'agy_acp_server.exe', args: ['acp'], adapter: '' } };
    const r = await resolveAgentCommand(def, {
      resolveCommand: () => null,
      resolveBin: () => null
    });
    assert.strictEqual(r.command, null, '双失败时 command 应为 null');
    assert.strictEqual(r.unresolved.reason, RESOLVE_REASONS.NOT_FOUND, '双失败原因应为 not_found');
    assert.deepStrictEqual(
      r.unresolved.candidates.map((c) => [c.kind, c.name, c.reason]),
      [['command', 'agy_acp_server.exe', 'not_found'], ['bin', 'agy', 'not_found']],
      `候选链不符：${JSON.stringify(r.unresolved.candidates)}`
    );
  }

  // 4b. 解析器抛错：resolve_failed 且保留错误摘要
  {
    const def = { id: 'opencode', transport: 'acp', bin: 'opencode', acp: { args: ['acp'], adapter: '' } };
    const r = await resolveAgentCommand(def, {
      resolveBin: () => { throw new Error('boom'); }
    });
    assert.strictEqual(r.command, null, '解析抛错时 command 应为 null');
    assert.strictEqual(r.unresolved.reason, RESOLVE_REASONS.RESOLVE_FAILED, '抛错原因应为 resolve_failed');
    assert.ok(String(r.unresolved.candidates[0].error).includes('boom'), '应保留错误摘要');
  }

  // 4c. 未注入任何解析器：no_resolver
  {
    const def = { id: 'opencode', transport: 'acp', bin: 'opencode', acp: { args: ['acp'], adapter: '' } };
    const r = await resolveAgentCommand(def, {});
    assert.strictEqual(r.unresolved.reason, RESOLVE_REASONS.NO_RESOLVER, '未注入解析器应为 no_resolver');
  }

  // 4d. 非 ACP / 非法 def
  {
    const legacy = await resolveAgentCommand({ id: 'deepseek', transport: 'legacy' }, {});
    assert.strictEqual(legacy.unresolved.reason, RESOLVE_REASONS.NOT_ACP, 'legacy def 应为 not_acp');
    assert.deepStrictEqual(legacy.unresolved.candidates, [], 'not_acp 不应有候选');

    const invalid = await resolveAgentCommand(null, {});
    assert.strictEqual(invalid.unresolved.reason, RESOLVE_REASONS.INVALID_DEF, '空 def 应为 invalid_def');
  }
}

// ---------- 断言5：buildAcpOverrides 回落 / detailed / onUnresolved ----------
async function test5_BuildOverrides() {
  const defs = [
    { id: 'antigravity', transport: 'acp', bin: 'agy', acp: { command: 'agy_acp_server.exe', args: ['acp'], adapter: '' } },
    { id: 'opencode', transport: 'acp', bin: 'opencode', acp: { args: ['acp'], adapter: '' } },
    { id: 'deepseek', transport: 'legacy' }
  ];

  const unresolvedEvents = [];
  const detailed = await buildAcpOverridesDetailed({
    defs,
    resolveCommand: () => null,
    resolveBin: (def) => (def.id === 'antigravity' ? 'C:\\bin\\agy.exe' : null),
    onUnresolved: (info) => unresolvedEvents.push(info)
  });

  assert.deepStrictEqual(
    detailed.overrides.antigravity,
    ['C:\\bin\\agy.exe', 'acp'],
    'buildAcpOverridesDetailed 应使用 command 失败后的 bin 回落'
  );
  assert.strictEqual(detailed.overrides.opencode, undefined, '解析失败条目不应出现在 overrides');
  assert.strictEqual(detailed.unresolved.length, 1, '应仅记录一条 unresolved');
  assert.strictEqual(detailed.unresolved[0].id, 'opencode', 'unresolved.id 应为 opencode');
  assert.strictEqual(detailed.unresolved[0].reason, RESOLVE_REASONS.NOT_FOUND, 'unresolved.reason 应为 not_found');
  assert.strictEqual(detailed.unresolved[0].command, 'opencode', 'unresolved.command 应为期望命令');
  assert.strictEqual(unresolvedEvents.length, 1, 'onUnresolved 应回调一次');
  assert.strictEqual(unresolvedEvents[0].def.id, 'opencode', 'onUnresolved 应携带 def');

  // 旧入口保持只返回 overrides
  const overrides = await buildAcpOverrides({
    defs,
    resolveCommand: () => null,
    resolveBin: (def) => (def.id === 'antigravity' ? 'C:\\bin\\agy.exe' : null)
  });
  assert.deepStrictEqual(overrides, detailed.overrides, 'buildAcpOverrides 应与 detailed.overrides 一致');

  // onUnresolved 抛错不影响整体构造
  const safe = await buildAcpOverrides({
    defs,
    resolveBin: () => 'C:\\bin\\opencode.cmd',
    onUnresolved: () => { throw new Error('trace boom'); }
  });
  assert.deepStrictEqual(safe.opencode, ['C:\\bin\\opencode.cmd', 'acp'], 'trace 回调异常不应影响结果');
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

  await run('断言1 agy 厂商目录解析', test1_AgyVendorDirs);
  await run('断言2 自定义路径与 qoder CN 优先级', test2_CustomAndQoderPriority);
  await run('断言3 resolveAgentCommand 优先级与回落', test3_ResolveCommand);
  await run('断言4 unresolved 原因与候选链', test4_UnresolvedReasons);
  await run('断言5 buildAcpOverrides 回落/detailed', test5_BuildOverrides);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
