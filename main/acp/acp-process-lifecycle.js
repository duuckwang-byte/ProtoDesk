'use strict';
/**
 * main/acp/acp-process-lifecycle.js — AI 探测 / ACP 子进程统一看护
 *
 * 背景：设置面板的 CLI 模型探测与 ACP runtime 都会拉起 `cmd.exe -> node -> conhost`
 * 进程树。只调用 ChildProcess.kill() 仅结束 cmd.exe，node/conhost 会继续存活并继承
 * Electron 的 stdio 句柄，导致退出/收尾阶段挂起。本模块只登记“本进程亲手拉起或由
 * acpx 回调明确告知”的 PID，超时 / 取消 / 失败 / 应用退出时按进程树强杀
 * （Windows: taskkill /pid <pid> /T /F），并销毁 stdio；绝不按镜像名全盘清杀。
 *
 * 安全边界：
 * - 本地子进程必须由 registerChild 登记，退出后立即注销；
 * - 外部 PID（acpx processLifecycle.onSpawned）必须带 command 元数据才登记，
 *   避免测试/异常路径传入的伪 PID 被当成真实进程；
 * - killPidTree 只处理已登记 PID；未登记 PID 仅在调用方明确给出时走平台兜底。
 */

const { spawnSync } = require('node:child_process');
const { killProcessTree } = require('../../platform/process');

/** @type {Map<number, Object>} pid → 看护条目 */
const entries = new Map();
/** @type {Promise<void>|null} 正在进行的全量收尾（并发去重） */
let shutdownTask = null;

/**
 * 判断 PID 是否仍存活（不发送信号，仅探活）。
 * @param {number} pid 进程号
 * @returns {boolean} 是否存活
 */
function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

/**
 * 销毁子进程 stdio，释放 Electron / Playwright 继承的管道写端。
 * @param {import('node:child_process').ChildProcess|null} child 子进程
 * @returns {void}
 */
function destroyStdio(child) {
  if (!child) return;
  for (const key of ['stdin', 'stdout', 'stderr']) {
    try {
      const stream = child[key];
      if (stream && typeof stream.destroy === 'function') stream.destroy();
    } catch (e) {
      /* 管道可能已随进程退出关闭 */
    }
  }
}

/**
 * 规范化登记元数据，保证后续诊断只含短字符串。
 * @param {Object} [meta] 原始元数据
 * @returns {Object} 规范化元数据
 */
function normalizeMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return {
    kind: String(m.kind || 'ai-process'),
    label: String(m.label || m.command || '').slice(0, 300),
    command: String(m.command || '').slice(0, 300),
    startedAt: m.startedAt ? String(m.startedAt) : new Date().toISOString(),
    scope: m.scope ? String(m.scope) : ''
  };
}

/**
 * 从登记表移除 PID（只删仍指向同一条目的键）。
 * @param {number} pid 进程号
 * @returns {boolean} 是否命中
 */
function untrackPid(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  return entries.delete(n);
}

/**
 * 登记一个本地 ChildProcess（AI 探测 / 其它主进程直接 spawn 的子进程）。
 * 子进程 exit/close 时自动注销；返回的 release 可用于提前注销。
 * @param {import('node:child_process').ChildProcess} child 子进程
 * @param {Object} [meta] {kind,label,command,startedAt}
 * @returns {Function} 注销函数
 */
function registerChild(child, meta) {
  if (!child || !Number.isFinite(Number(child.pid)) || Number(child.pid) <= 0) {
    return () => {};
  }
  const pid = Number(child.pid);
  const entry = Object.assign({ pid, child, external: false }, normalizeMeta(meta));
  entries.set(pid, entry);
  const release = () => {
    if (entries.get(pid) === entry) entries.delete(pid);
  };
  try {
    child.once('exit', () => {
      /* 根进程已退出；保留到 close 以等待 stdio 关闭，避免过早丢失诊断信息。 */
      entry.exited = true;
    });
    child.once('close', release);
    child.once('error', release);
  } catch (e) {
    release();
  }
  return release;
}

/**
 * 登记一个外部 PID（acpx processLifecycle.onSpawned 回调）。
 * 必须有 command 元数据，避免测试/异常路径的伪 PID 进入清理集合。
 * @param {number} pid 进程号
 * @param {Object} [meta] {kind,label,command,startedAt,scope}
 * @returns {Function} 注销函数
 */
function trackPid(pid, meta) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return () => {};
  const info = normalizeMeta(meta);
  if (!info.command) return () => {};
  const existing = entries.get(n);
  if (existing && existing.external) {
    return () => untrackPid(n);
  }
  const entry = Object.assign({ pid: n, child: null, external: true, exited: false }, info);
  entries.set(n, entry);
  return () => {
    if (entries.get(n) === entry) entries.delete(n);
  };
}

/**
 * 仅注销登记，不杀进程（正常 close / onExit 使用）。
 * @param {import('node:child_process').ChildProcess|null} child 子进程
 * @returns {boolean} 是否命中
 */
function releaseChild(child) {
  if (!child || !Number.isFinite(Number(child.pid))) return false;
  destroyStdio(child);
  return untrackPid(Number(child.pid));
}

/**
 * 结束单条登记项：按进程树强杀（Windows taskkill /T /F），并销毁 stdio。
 * 调用前先从登记表摘除，避免并发重复 kill。
 * @param {Object} entry 登记条目
 * @param {string} [reason] 收尾原因（诊断用）
 * @returns {Promise<boolean>} 是否发出了强杀
 */
async function killEntry(entry, reason) {
  if (!entry) return false;
  if (entries.get(entry.pid) === entry) entries.delete(entry.pid);
  const child = entry.child;
  const rootAlive = child ? (child.exitCode === null && child.signalCode === null) : isPidAlive(entry.pid);
  let killed = false;
  if (rootAlive) {
    try { killed = await killProcessTree(entry.pid); } catch (e) { killed = false; }
  }
  destroyStdio(child);
  return killed;
}

/**
 * 结束指定 PID 的进程树。仅用于调用方明确持有“本进程拉起”的 PID（如 ACP cancel）。
 * 已登记条目走统一清理；未登记 PID 回落平台 killProcessTree，保持旧取消语义。
 * @param {number} pid 进程号
 * @param {string} [reason] 收尾原因
 * @returns {Promise<boolean>} 是否发出强杀
 */
async function killPidTree(pid, reason) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  const entry = entries.get(n);
  if (entry) return killEntry(entry, reason);
  try {
    return await killProcessTree(n);
  } catch (e) {
    return false;
  }
}

/**
 * 等待若干清理任务，超时后不再阻塞退出流程。
 * @param {Promise<*>[]} tasks 清理任务
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<void>}
 */
function settleWithTimeout(tasks, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(1, timeoutMs));
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (e) {}
    }
    Promise.allSettled(tasks).then(finish, finish);
  });
}

/**
 * 按 kind 批量收尾（默认全部 AI 看护项）。
 * @param {{kind?:string, reason?:string, timeoutMs?:number}} [options] 收尾选项
 * @returns {Promise<number>} 命中并尝试清理的进程数
 */
async function shutdownAll(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const kind = opts.kind ? String(opts.kind) : '';
  const snapshot = [];
  for (const entry of Array.from(entries.values())) {
    if (kind && entry.kind !== kind) continue;
    snapshot.push(entry);
  }
  if (!snapshot.length) return 0;
  const reason = String(opts.reason || 'shutdown');
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(1, Number(opts.timeoutMs)) : 3000;
  await settleWithTimeout(snapshot.map((entry) => killEntry(entry, reason)), timeoutMs);
  return snapshot.length;
}

/**
 * 全量收尾的并发去重入口（应用退出时调用）。
 * @param {Object} [options] 同 shutdownAll
 * @returns {Promise<number>} 命中进程数
 */
function shutdownAllOnce(options) {
  if (shutdownTask) return shutdownTask;
  shutdownTask = shutdownAll(options).finally(() => { shutdownTask = null; });
  return shutdownTask;
}

/**
 * 同步强杀所有登记项（process.on('exit') / window-all-closed 兜底）。
 * Windows 直接 spawnSync taskkill /T /F；POSIX 先杀进程组再杀单进程。
 * @param {{kind?:string}} [options] 可选 kind 过滤
 * @returns {number} 命中进程数
 */
function killAllSync(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const kind = opts.kind ? String(opts.kind) : '';
  const snapshot = [];
  for (const entry of Array.from(entries.values())) {
    if (kind && entry.kind !== kind) continue;
    snapshot.push(entry);
    entries.delete(entry.pid);
  }
  for (const entry of snapshot) {
    const child = entry.child;
    const rootAlive = child ? (child.exitCode === null && child.signalCode === null) : isPidAlive(entry.pid);
    if (rootAlive) {
      if (process.platform === 'win32') {
        try {
          spawnSync('taskkill', ['/pid', String(entry.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 5000
          });
        } catch (e) {}
      } else {
        try { process.kill(-entry.pid, 'SIGKILL'); } catch (e) {
          try { process.kill(entry.pid, 'SIGKILL'); } catch (ee) {}
        }
      }
    }
    destroyStdio(child);
  }
  return snapshot.length;
}

/**
 * 列出当前登记项（诊断 / 测试，返回副本，不含 ChildProcess）。
 * @returns {Array<Object>} 登记快照
 */
function listTracked() {
  const out = [];
  for (const entry of entries.values()) {
    out.push({
      pid: entry.pid,
      kind: entry.kind,
      label: entry.label,
      command: entry.command,
      startedAt: entry.startedAt,
      scope: entry.scope,
      external: !!entry.external
    });
  }
  return out;
}

/**
 * 测试用：清空登记表（不杀真实进程；调用方应先 shutdownAll）。
 * @param {string} [kind] 只清指定 kind，缺省全清
 * @returns {void}
 */
function clearForTest(kind) {
  const k = kind ? String(kind) : '';
  for (const [pid, entry] of Array.from(entries.entries())) {
    if (k && entry.kind !== k) continue;
    destroyStdio(entry.child);
    entries.delete(pid);
  }
  shutdownTask = null;
}

/**
 * 只读枚举本机进程（Windows Get-CimInstance；其它平台返回空数组）。
 * 仅用于退出阶段的兜底扫描，不参与常规探测路径。
 * @returns {Array<{pid:number,ppid:number,name:string,cmd:string}>} 进程快照
 */
function queryWindowsProcesses() {
  if (process.platform !== 'win32') return [];
  const script = [
    '$ErrorActionPreference = "SilentlyContinue";',
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine |',
    'ConvertTo-Json -Compress'
  ].join(' ');
  let text = '';
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    });
    if (!r || r.status !== 0) return [];
    text = String(r.stdout || '').trim();
  } catch (e) {
    return [];
  }
  if (!text) return [];
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { return []; }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((p) => ({
    pid: Number(p.ProcessId),
    ppid: Number(p.ParentProcessId),
    name: String(p.Name || ''),
    cmd: String(p.CommandLine || '')
  })).filter((p) => Number.isFinite(p.pid) && p.pid > 0);
}

/**
 * 退出阶段兜底：清理本进程后代中仍匹配 ACP 探测特征的孤儿进程树。
 *
 * 仅解决 acpx `inspectAgentModels` 这类不暴露 processLifecycle 的探测：
 * - 只扫描 parentPid（默认当前 Electron 主进程）的后代；
 * - 只命中命令行含 `--acp` 或调用方登记的 Agent 命令签名；
 * - 命中后按进程树 taskkill /T /F，连同 conhost 一起结束；
 * - 用户手动通过 ai:open-terminal 拉起的独立终端不在后代树内，不受影响。
 *
 * @param {{parentPid?:number, signatures?:string[]}} [options] 扫描选项
 * @returns {number[]} 实际命中并尝试结束的 PID
 */
function sweepOrphanDescendants(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (process.platform !== 'win32') return [];
  const parentPid = Number.isFinite(Number(opts.parentPid)) ? Number(opts.parentPid) : process.pid;
  const signatures = [];
  for (const raw of (Array.isArray(opts.signatures) ? opts.signatures : [])) {
    const s = String(raw || '').trim().toLowerCase();
    if (s.length >= 4) signatures.push(s);
  }
  const procs = queryWindowsProcesses();
  if (!procs.length) return [];

  const descendants = new Set([parentPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of procs) {
      if (descendants.has(p.pid)) continue;
      if (descendants.has(p.ppid)) {
        descendants.add(p.pid);
        changed = true;
      }
    }
  }

  const roots = [];
  for (const p of procs) {
    if (!descendants.has(p.pid)) continue;
    if (p.pid === parentPid) continue;
    const name = p.name.toLowerCase();
    const cmd = p.cmd.toLowerCase();
    /* 跳过 Electron 自身子进程（renderer/gpu/utility）与本次扫描用的 shell；
     * conhost 由命中根进程的后代展开一并处理，避免按镜像名误杀。 */
    if (name === 'conhost.exe' || name === 'electron.exe' || name === 'powershell.exe'
      || name === 'pwsh.exe' || name === 'taskkill.exe') continue;
    if (cmd.indexOf('--type=') >= 0) continue;
    if (cmd.indexOf('--acp') >= 0 || signatures.some((s) => cmd.indexOf(s) >= 0)) roots.push(p);
  }
  if (!roots.length) return [];

  const killSet = new Set(roots.map((p) => p.pid));
  changed = true;
  while (changed) {
    changed = false;
    for (const p of procs) {
      if (killSet.has(p.pid)) continue;
      if (killSet.has(p.ppid)) {
        killSet.add(p.pid);
        changed = true;
      }
    }
  }

  for (const pid of killSet) {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000
      });
    } catch (e) {}
  }
  return Array.from(killSet);
}

module.exports = {
  registerChild,
  trackPid,
  untrackPid,
  releaseChild,
  killPidTree,
  shutdownAll,
  shutdownAllOnce,
  killAllSync,
  sweepOrphanDescendants,
  listTracked,
  isPidAlive,
  clearForTest
};
