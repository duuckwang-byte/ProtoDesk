const { getAllAgentDefs } = require('./registry');
const { createResolutionCache, resolveAgentExecutable } = require('./resolution');
const { spawn } = require('node:child_process');
const { createCommandInvocation } = require('../platform/command');
const { applyAgentLaunchEnv } = require('../platform/env');
const os = require('node:os');

// 单个版本探针的熔断时限：超时按“版本未知”处理，并结束探针进程，避免残留子进程拖慢后续探测。
const VERSION_PROBE_TIMEOUT_MS = 3000;

// 同一进程内的结果复用窗口：设置页反复打开/列表重渲染时不再重复 spawn 最多 26 个 CLI。
// 10s 只覆盖同一交互内的重复调用；超过窗口或 customPaths 变化都会重新真实探测。
const DETECTION_CACHE_TTL_MS = 10000;

let cachedDetection = null; // { key: string, at: number, results: Array }
let inFlightDetection = null; // { key: string, promise: Promise<Array> }

/**
 * 生成探测缓存键：customPaths 为空表示“全部走自动解析”，与显式路径区分开。
 * @param {Record<string, string>} customPaths 用户手动指定的路径字典
 * @returns {string} 稳定键（键名排序，空值忽略）
 */
function buildDetectionKey(customPaths) {
  if (!customPaths || typeof customPaths !== 'object') return '';
  const entries = Object.keys(customPaths)
    .filter((k) => customPaths[k] != null && String(customPaths[k]).trim() !== '')
    .sort()
    .map((k) => [k, String(customPaths[k]).trim()]);
  return entries.length ? JSON.stringify(entries) : '';
}

/**
 * 返回结果副本，防止调用方改动污染缓存。
 * @param {Array<Object>} results 探测结果数组
 * @returns {Array<Object>} 浅拷贝后的新数组
 */
function copyResults(results) {
  return (Array.isArray(results) ? results : []).map((r) => ({ ...r }));
}

/**
 * @param {import('node:child_process').ChildProcess} child 探针子进程
 * @returns {void}
 */
function killProbe(child) {
  if (!child || typeof child.kill !== 'function' || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      // .cmd/.bat 探针由 cmd.exe 包一层，需按进程树结束，避免留下挂起的 node 子进程
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.on('error', () => {
        try { child.kill(); } catch (__) { /* 忽略 */ }
      });
      if (typeof killer.unref === 'function') killer.unref();
    } catch (_) {
      try { child.kill(); } catch (__) { /* 忽略 */ }
    }
    return;
  }
  try { child.kill('SIGKILL'); } catch (_) { /* 忽略 */ }
}

/**
 * 并发探测本机所有已注册的 Agent CLI。
 * 同一进程内默认复用 10s 内的结果，并合并同时发起的探测（in-flight），
 * 避免短时间内重复 spawn 版本探针；需要强制刷新时传 { force: true }。
 * @param {Record<string, string>} [customPaths] 用户手动指定的路径字典
 * @param {{ ttlMs?: number, force?: boolean }} [options] 复用窗口与强制刷新开关
 * @returns {Promise<Array<{ id: string, name: string, available: boolean, path: string | null, version: string | null }>>}
 */
async function detectAllAgents(customPaths = {}, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const key = buildDetectionKey(customPaths);
  const force = opts.force === true;
  const ttlMs = Number.isFinite(opts.ttlMs) ? Math.max(0, opts.ttlMs) : DETECTION_CACHE_TTL_MS;

  if (!force && ttlMs > 0 && cachedDetection && cachedDetection.key === key) {
    if (Date.now() - cachedDetection.at < ttlMs) {
      return copyResults(cachedDetection.results);
    }
  }

  // 同一键的并发探测共享一次真实探测，后来者直接等结果，不再发起第二组进程
  if (inFlightDetection && inFlightDetection.key === key) {
    return copyResults(await inFlightDetection.promise);
  }

  const promise = probeAllAgents(customPaths);
  inFlightDetection = { key, promise };
  try {
    const results = await promise;
    cachedDetection = { key, at: Date.now(), results };
    return copyResults(results);
  } finally {
    if (inFlightDetection && inFlightDetection.promise === promise) inFlightDetection = null;
  }
}

/**
 * 真实探测：解析可执行文件 + 并发版本探针（每个探针 3s 熔断）。
 * @param {Record<string, string>} customPaths 用户手动指定的路径字典
 * @returns {Promise<Array<Object>>} 26 条探测结果
 */
async function probeAllAgents(customPaths) {
  const defs = getAllAgentDefs();
  // 一次探测内共享目录项缓存：每个 PATH/兜底目录只 readdir 一次，
  // 避免 26 个 def 各自对 41 个 PATH 目录做 4 种后缀的 exists/stat（约 5000 次同步 fs 调用）。
  const resolutionCache = createResolutionCache();

  const probeTasks = defs.map(async (def) => {
    try {
      // 1. 寻找有效可执行文件
      const binPath = await resolveAgentExecutable(def, customPaths[def.id], { cache: resolutionCache });
      if (!binPath) {
        return { id: def.id, name: def.name, available: false, path: null, version: null };
      }

      // 2. 带 3000ms 超时熔断保护的版本探针（超时会结束探针进程，不遗留后台子进程）
      const version = await probeCliVersion(binPath, def.versionArgs);

      return {
        id: def.id,
        name: def.name,
        available: true,
        path: binPath,
        version: version || '已检测到'
      };
    } catch (e) {
      return { id: def.id, name: def.name, available: false, path: null, version: null };
    }
  });

  return await Promise.all(probeTasks);
}

/**
 * @param {string} binPath 已解析的可执行文件路径
 * @param {string[]} versionArgs 版本参数（如 ['--version']）
 * @returns {Promise<string|null>} 首行版本号；失败/超时返回 null
 */
function probeCliVersion(binPath, versionArgs) {
  return new Promise((resolve) => {
    const invocation = createCommandInvocation({
      command: binPath,
      args: versionArgs,
      env: applyAgentLaunchEnv()
    });

    let child = null;
    let timer = null;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      killProbe(child);
      finish(null);
    }, VERSION_PROBE_TIMEOUT_MS);

    try {
      child = spawn(invocation.command, invocation.args, {
        cwd: os.tmpdir(), // 隔离在系统临时目录，防止 Bun/OpenCode 污染当前工作区
        windowsHide: true,
        // stderr 必须显式忽略/排空：只读 stdout 时，CLI 写满 stderr 管道会阻塞到 3s 熔断
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: invocation.windowsVerbatimArguments
      });
    } catch (_) {
      finish(null);
      return;
    }

    let out = '';
    if (child.stdout) child.stdout.on('data', d => out += d.toString('utf8'));
    if (child.stderr && typeof child.stderr.resume === 'function') child.stderr.resume();
    child.on('error', () => finish(null));
    child.on('close', code => {
      if (code === 0 && out.trim()) {
        finish(out.trim().split(/\r?\n/)[0]);
      } else {
        finish(null);
      }
    });
  });
}

module.exports = {
  detectAllAgents
};
