'use strict';
/**
 * tests/verify-acp-process-cleanup.js — AI 探测 / ACP 子进程树清理验证（纯 Node，无网络）
 *
 * 覆盖：
 * 1. 本地假 CLI（临时 .cmd -> node 常驻子进程）超时后，cmd/node/conhost 整树清理；
 * 2. 正常探测完成后登记表归零，不遗留进程；
 * 3. ACP runtime 通过 processLifecycle 登记的进程树，在 shutdown（含 runtime 自身卡死）时被强杀；
 * 4. 清理只作用于登记 PID，不误杀无关进程。
 *
 * 约束：不联网、不调用真实 codebuddy；进程枚举只读 Get-CimInstance。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const service = require('../main/services/ai-process-service');
const acpRuntime = require('../main/acp/acp-runtime');
const lifecycle = require('../main/acp/acp-process-lifecycle');
const { createCommandInvocation } = require('../platform/command');

const IS_WIN = process.platform === 'win32';
const TMP_DIRS = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + (timeoutMs || 3000);
  for (;;) {
    let ok = false;
    try { ok = !!predicate(); } catch (e) { ok = false; }
    if (ok) return;
    if (Date.now() > deadline) throw new Error('等待超时：' + String(label || 'condition'));
    await sleep(50);
  }
}

/**
 * 只读枚举本机进程（Windows Get-CimInstance）。
 * @returns {Array<{ProcessId:number,ParentProcessId:number,Name:string,CommandLine:string}>} 进程快照
 */
function listProcesses() {
  if (!IS_WIN) return [];
  const script = [
    '$ErrorActionPreference = "Stop";',
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine |',
    'ConvertTo-Json -Compress'
  ].join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Get-CimInstance 失败：' + String(r.stderr || '').slice(0, 400));
  const text = String(r.stdout || '').trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((p) => ({
    ProcessId: Number(p.ProcessId),
    ParentProcessId: Number(p.ParentProcessId),
    Name: String(p.Name || ''),
    CommandLine: String(p.CommandLine || '')
  }));
}

/**
 * 按命令行标记找根进程，并递归收集其全部后代（含 conhost）。
 * @param {Array<Object>} procs 进程快照
 * @param {string} marker 唯一标记
 * @returns {Array<Object>} 进程树快照
 */
function collectTreeByMarker(procs, marker) {
  const byPid = new Map();
  for (const p of procs) byPid.set(p.ProcessId, p);
  const roots = procs
    .filter((p) => p.CommandLine.indexOf(marker) >= 0)
    .map((p) => p.ProcessId);
  const all = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of procs) {
      if (all.has(p.ProcessId)) continue;
      if (all.has(p.ParentProcessId)) {
        all.add(p.ProcessId);
        changed = true;
      }
    }
  }
  const out = [];
  for (const pid of all) {
    const p = byPid.get(pid);
    if (p) out.push(p);
  }
  return out;
}

function isAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

async function waitGone(pids, timeoutMs, label) {
  const deadline = Date.now() + (timeoutMs || 6000);
  for (;;) {
    const alive = pids.filter((pid) => isAlive(pid));
    if (!alive.length) return;
    if (Date.now() > deadline) {
      let detail = '';
      try {
        const procs = listProcesses().filter((p) => alive.indexOf(p.ProcessId) >= 0);
        detail = JSON.stringify(procs.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name })));
      } catch (e) { detail = String(e && e.message); }
      throw new Error(String(label || '进程树') + ' 未在 ' + timeoutMs + 'ms 内清理，残留：' + detail);
    }
    await sleep(100);
  }
}

function makeTmpDir(marker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), marker + '-'));
  TMP_DIRS.push(dir);
  return dir;
}

function killManual(pid) {
  if (!IS_WIN) {
    try { process.kill(-pid, 'SIGKILL'); } catch (e) {
      try { process.kill(pid, 'SIGKILL'); } catch (ee) {}
    }
    return;
  }
  spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 5000
  });
}

/**
 * 写一个临时 .cmd：启动常驻 node 子进程（命令行带唯一 marker）。
 * @param {string} marker 唯一标记
 * @returns {string} .cmd 绝对路径
 */
function writeHangCli(marker) {
  const dir = makeTmpDir(marker);
  const cmdPath = path.join(dir, 'fake-acp-cli.cmd');
  const lines = [
    '@echo off',
    '"' + process.execPath + '" -e "setInterval(()=>{},1000)" ' + marker,
    ''
  ];
  fs.writeFileSync(cmdPath, lines.join('\r\n'), 'utf8');
  return cmdPath;
}

/**
 * 写一个临时 .cmd：立即输出两行模型 id 后退出。
 * @param {string} marker 唯一标记（仅用于临时目录命名）
 * @returns {string} .cmd 绝对路径
 */
function writeFastCli(marker) {
  const dir = makeTmpDir(marker);
  const cmdPath = path.join(dir, 'fake-fast-cli.cmd');
  fs.writeFileSync(cmdPath, '@echo off\r\necho model-a\r\necho model-b\r\n', 'utf8');
  return cmdPath;
}

// ---------- 断言1：正常探测完成后无登记、无残留 ----------
async function test1_NormalProbeClean() {
  const marker = 'pland-cleanup-fast-' + Date.now().toString(36);
  const cmdPath = writeFastCli(marker);
  const items = await service.execCliListModels(cmdPath, {
    listModels: {
      args: [],
      timeoutMs: 3000,
      parse: (out) => String(out || '').trim().split(/\s+/).filter(Boolean)
    }
  });
  assert.deepStrictEqual(items, ['model-a', 'model-b'], '正常探测应返回解析后的模型列表');
  await waitFor(
    () => lifecycle.listTracked().filter((e) => e.kind === 'cli-list-models').length === 0,
    2000,
    '正常 close 后登记表应清空'
  );
  if (IS_WIN) {
    const left = collectTreeByMarker(listProcesses(), marker);
    assert.deepStrictEqual(left.map((p) => p.ProcessId), [], '正常探测完成后不应残留进程树');
  }
}

// ---------- 断言2：超时强杀 cmd/node/conhost 整树 ----------
async function test2_TimeoutKillsTree() {
  if (!IS_WIN) {
    console.log('[SKIP] 非 Windows 不验证 cmd/conhost 进程树');
    return;
  }
  const marker = 'pland-cleanup-hang-' + Date.now().toString(36);
  const cmdPath = writeHangCli(marker);
  const started = Date.now();
  const promise = service.execCliListModels(cmdPath, {
    listModels: { args: ['models'], timeoutMs: 1200 }
  });

  /* 等 cmd.exe 及其 node 子进程真正起来，记录整树 PID 作为取证基线。 */
  let tree = [];
  await waitFor(() => {
    tree = collectTreeByMarker(listProcesses(), marker);
    return tree.length >= 2;
  }, 5000, '假 CLI 进程树启动');
  const baseline = tree.map((p) => p.ProcessId);
  assert.ok(baseline.length >= 2, '假 CLI 应形成 cmd.exe -> node 进程树，实际 ' + JSON.stringify(tree));
  assert.ok(
    tree.some((p) => /node/i.test(p.Name)),
    '进程树应包含 node 子进程，实际 ' + JSON.stringify(tree.map((p) => p.Name))
  );

  const items = await promise;
  const elapsed = Date.now() - started;
  assert.strictEqual(items, null, '超时探测应返回 null');
  assert.ok(elapsed < 8000, '超时后应在合理时间内返回，实际 ' + elapsed + 'ms');
  await waitGone(baseline, 6000, '超时后的假 CLI 进程树');
  await waitFor(
    () => lifecycle.listTracked().filter((e) => e.kind === 'cli-list-models').length === 0,
    2000,
    '超时强杀后登记表应清空'
  );
  const left = collectTreeByMarker(listProcesses(), marker);
  assert.deepStrictEqual(left.map((p) => p.ProcessId), [], '超时后不应残留 cmd/node/conhost');
}

// ---------- 断言3：ACP runtime shutdown 强杀登记进程树（runtime 自身卡死也不阻塞） ----------
async function test3_AcpShutdownKillsTree() {
  if (!IS_WIN) {
    console.log('[SKIP] 非 Windows 不验证 ACP 进程树');
    return;
  }
  acpRuntime._resetForTest();
  const marker = 'pland-cleanup-acp-' + Date.now().toString(36);
  const cmdPath = writeHangCli(marker);
  let shutdownCalls = 0;
  let spawnedPid = 0;

  const fake = {
    createAgentRegistry: () => ({ resolve: () => null }),
    createFileSessionStore: () => ({ load: async () => undefined, save: async () => {} }),
    createAcpRuntime(options) {
      const invocation = createCommandInvocation({ command: cmdPath, args: ['acp'] });
      const child = spawn(invocation.command, invocation.args, {
        windowsHide: true,
        stdio: 'ignore',
        windowsVerbatimArguments: invocation.windowsVerbatimArguments
      });
      spawnedPid = child.pid;
      options.processLifecycle.onSpawned({
        launchId: 'test-launch',
        scope: 'agent',
        command: cmdPath,
        args: ['acp'],
        cwd: os.tmpdir(),
        pid: child.pid,
        startedAt: new Date().toISOString()
      });
      return {
        async ensureSession() {
          return {
            sessionKey: 'test-session',
            backend: 'fake',
            runtimeSessionName: 'fake',
            cwd: os.tmpdir(),
            backendSessionId: 'sess-test',
            acpxRecordId: 'rec-test'
          };
        },
        async getStatus() {
          return {
            details: {
              configOptions: [{
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: 'model-a',
                options: [{ value: 'model-a' }, { value: 'model-b' }]
              }]
            }
          };
        },
        async setConfigOption() {},
        /* 模拟 acpx 卸载卡死：不 resolve，验证 shutdown 的超时兜底仍会杀树。 */
        shutdown() {
          shutdownCalls += 1;
          return new Promise(() => {});
        }
      };
    }
  };
  acpRuntime.configure({
    acpxModule: fake,
    defs: [{ id: 'opencode', name: 'Fake ACP', transport: 'acp', acp: { args: ['acp'] } }],
    resolveBin: () => cmdPath,
    resolveAdapter: () => null,
    resolveCommand: () => null
  });

  const preview = await acpRuntime.previewModelConfig({
    def: { id: 'opencode', name: 'Fake ACP', transport: 'acp', acp: { args: ['acp'] } },
    aiCfg: { acp: { enabled: true, agents: {} } },
    cwd: os.tmpdir(),
    uiSessionId: 'cleanup-test',
    model: 'model-b'
  });
  assert.strictEqual(preview.ok, true, 'fake ACP 预览应成功，实际 ' + JSON.stringify(preview));
  assert.ok(spawnedPid > 0, 'fake ACP 应启动真实进程树');
  assert.ok(
    lifecycle.listTracked().some((e) => e.kind === 'acp' && e.pid === spawnedPid),
    'processLifecycle.onSpawned 应登记 ACP 进程'
  );

  let tree = [];
  await waitFor(() => {
    tree = collectTreeByMarker(listProcesses(), marker);
    return tree.length >= 2;
  }, 5000, 'ACP 假 CLI 进程树启动');
  const baseline = tree.map((p) => p.ProcessId);

  const started = Date.now();
  await acpRuntime.shutdown({ reason: 'cleanup-test', timeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.strictEqual(shutdownCalls, 1, '应调用一次 runtime.shutdown');
  assert.ok(elapsed < 2500, 'runtime.shutdown 卡死时超时兜底应快速返回，实际 ' + elapsed + 'ms');
  await waitGone(baseline, 6000, 'ACP shutdown 后的进程树');
  assert.strictEqual(
    lifecycle.listTracked().filter((e) => e.kind === 'acp').length,
    0,
    'ACP shutdown 后登记表应清空'
  );
}

// ---------- 断言4：AbortSignal 取消时按进程树收尾 ----------
async function test4_AbortKillsTree() {
  if (!IS_WIN) {
    console.log('[SKIP] 非 Windows 不验证 AbortSignal 进程树');
    return;
  }
  const marker = 'pland-cleanup-abort-' + Date.now().toString(36);
  const cmdPath = writeHangCli(marker);
  const controller = new AbortController();
  const promise = service.execCliListModels(cmdPath, {
    signal: controller.signal,
    listModels: { args: ['models'], timeoutMs: 30000 }
  });

  let tree = [];
  await waitFor(() => {
    tree = collectTreeByMarker(listProcesses(), marker);
    return tree.length >= 2;
  }, 5000, 'AbortSignal 假 CLI 进程树启动');
  const baseline = tree.map((p) => p.ProcessId);

  controller.abort();
  const items = await promise;
  assert.strictEqual(items, null, '取消后探测应返回 null');
  await waitGone(baseline, 6000, 'AbortSignal 取消后的假 CLI 进程树');
  await waitFor(
    () => lifecycle.listTracked().filter((e) => e.kind === 'cli-list-models').length === 0,
    2000,
    '取消后登记表应清空'
  );
}

// ---------- 断言5：后代树兜底扫描命中 --acp 进程（inspectAgentModels 路径） ----------
async function test5_SweepOrphanAcpDescendants() {
  if (!IS_WIN) {
    console.log('[SKIP] 非 Windows 不验证后代树兜底扫描');
    return;
  }
  const marker = 'pland-cleanup-sweep-' + Date.now().toString(36);
  const cmdPath = writeHangCli(marker);
  const invocation = createCommandInvocation({ command: cmdPath, args: ['--acp'] });
  const child = spawn(invocation.command, invocation.args, {
    windowsHide: true,
    stdio: 'ignore',
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });
  try {
    let tree = [];
    await waitFor(() => {
      tree = collectTreeByMarker(listProcesses(), marker);
      return tree.length >= 2;
    }, 5000, '兜底扫描假 CLI 进程树启动');
    const baseline = tree.map((p) => p.ProcessId);
    const killed = lifecycle.sweepOrphanDescendants({
      parentPid: process.pid,
      signatures: ['--acp', marker]
    });
    assert.ok(killed.length >= 1, '兜底扫描应命中 --acp 后代进程');
    await waitGone(baseline, 6000, '兜底扫描后的假 CLI 进程树');
  } finally {
    killManual(child.pid);
  }
}

// ---------- 断言6：只杀登记 PID，不误杀无关进程 ----------
async function test6_DoesNotKillUntracked() {
  const marker = 'pland-cleanup-untracked-' + Date.now().toString(36);
  const invocation = createCommandInvocation({
    command: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)', marker]
  });
  const child = spawn(invocation.command, invocation.args, {
    windowsHide: true,
    stdio: 'ignore',
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });
  try {
    await waitFor(() => isAlive(child.pid), 2000, '无关进程启动');
    await lifecycle.shutdownAll({ reason: 'test-scope', timeoutMs: 1000 });
    lifecycle.killAllSync();
    await sleep(150);
    assert.ok(isAlive(child.pid), '未登记的无关进程不得被 shutdown 误杀');
  } finally {
    killManual(child.pid);
  }
}

async function main() {
  let passed = 0;
  let failed = 0;
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log('[PASS] ' + name);
    } catch (e) {
      failed += 1;
      console.log('[FAIL] ' + name);
      console.log((e && e.stack) || String(e));
    }
  }

  if (!IS_WIN) console.log('[INFO] 当前非 Windows：仅验证登记/不误杀路径，进程树断言自动跳过');
  console.log('Platform: ' + process.platform + ' node=' + process.version);

  await run('断言1 正常探测完成后无登记/无残留', test1_NormalProbeClean);
  await run('断言2 超时强杀 cmd/node/conhost 整树', test2_TimeoutKillsTree);
  await run('断言3 ACP runtime shutdown 强杀登记进程树', test3_AcpShutdownKillsTree);
  await run('断言4 AbortSignal 取消强杀进程树', test4_AbortKillsTree);
  await run('断言5 后代树兜底扫描 --acp 进程', test5_SweepOrphanAcpDescendants);
  await run('断言6 shutdown 不误杀未登记进程', test6_DoesNotKillUntracked);

  // 兜底：本文件启动的进程树全部回收，临时目录删除。
  try { await lifecycle.shutdownAll({ reason: 'test-teardown', timeoutMs: 2000 }); } catch (e) {}
  lifecycle.clearForTest();
  acpRuntime._resetForTest();
  for (const dir of TMP_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('SUMMARY passed=' + passed + ' failed=' + failed);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
