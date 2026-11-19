'use strict';
/**
 * main/acp/acp-registry.js — ACP Agent override 构造（Phase 0）
 * 纯函数 + 可注入解析回调：本模块不 require Electron，也不直接读文件系统；
 * 真实路径解析（自定义路径 / node_modules/.bin / PATH）由调用方注入，
 * 便于单测覆盖「原生 ACP」「适配器 ACP」「解析失败」三类分支。
 */

/** 无法解析启动命令时的原因码 */
const RESOLVE_REASONS = Object.freeze({
  NOT_ACP: 'not_acp',
  INVALID_DEF: 'invalid_def',
  NO_RESOLVER: 'no_resolver',
  NOT_FOUND: 'not_found',
  RESOLVE_FAILED: 'resolve_failed'
});

function normalizeArgs(value) {
  return Array.isArray(value) ? value.map((a) => String(a)) : [];
}

function errorText(err) {
  try {
    if (err && typeof err.message === 'string' && err.message) return err.message.slice(0, 300);
    return String(err == null ? 'unknown error' : err).slice(0, 300);
  } catch (_) {
    return 'unknown error';
  }
}

/**
 * 执行一次解析尝试，异常与空结果都转成可追踪的 candidate。
 * @param {'custom'|'adapter'|'command'|'bin'} kind 解析类型
 * @param {string} name 解析目标名
 * @param {Function|null} runner 实际解析函数，未注入时为 null
 * @returns {Promise<{bin:string, candidate:Object}>} 解析结果与候选记录
 */
async function attempt(kind, name, runner) {
  const candidate = { kind, name };
  if (typeof runner !== 'function') {
    candidate.reason = RESOLVE_REASONS.NO_RESOLVER;
    return { bin: '', candidate };
  }
  try {
    const raw = await runner();
    const bin = raw == null ? '' : String(raw).trim();
    if (bin) {
      candidate.resolved = bin;
      return { bin, candidate };
    }
    candidate.reason = RESOLVE_REASONS.NOT_FOUND;
    return { bin: '', candidate };
  } catch (err) {
    candidate.reason = RESOLVE_REASONS.RESOLVE_FAILED;
    candidate.error = errorText(err);
    return { bin: '', candidate };
  }
}

/**
 * 解析单个 ACP Agent 的启动命令。
 * 优先级：customPaths[id] > adapter 解析 > command 解析 > 原生 bin 解析。
 * `acp.command` 解析失败（空值 / 抛错 / 未注入解析器）时回落到 resolveBin(def)，
 * 避免把「专用入口不存在」误判为整个 Agent 不可用。
 *
 * @param {Object} def Agent 定义（需 transport:'acp'）
 * @param {Object} [options] 解析参数
 * @param {Object<string,string>} [options.customPaths] id → 用户自定义可执行文件路径
 * @param {(def:Object)=>string|Promise<string|null>} [options.resolveBin] 原生 bin / 回落解析
 * @param {(adapter:string, agentId:string)=>string|Promise<string|null>} [options.resolveAdapter]
 * @param {(command:string, agentId:string)=>string|Promise<string|null>} [options.resolveCommand]
 *   未注入时沿用 resolveAdapter（兼容旧调用）
 * @returns {Promise<{command:string[]|null, unresolved:{reason:string, candidates:Array<Object>}|null}>}
 *   command 为 [bin, ...args]；解析失败时 command=null 并给出原因与候选链
 */
async function resolveAgentCommand(def, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const customPaths = opts.customPaths && typeof opts.customPaths === 'object' ? opts.customPaths : {};
  const resolveBin = typeof opts.resolveBin === 'function' ? opts.resolveBin : null;
  const resolveAdapter = typeof opts.resolveAdapter === 'function' ? opts.resolveAdapter : null;
  const resolveCommand = typeof opts.resolveCommand === 'function' ? opts.resolveCommand : resolveAdapter;

  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return { command: null, unresolved: { reason: RESOLVE_REASONS.INVALID_DEF, candidates: [] } };
  }
  const id = def.id != null ? String(def.id).trim() : '';
  if (!id) {
    return { command: null, unresolved: { reason: RESOLVE_REASONS.INVALID_DEF, candidates: [] } };
  }
  if (def.transport !== 'acp') {
    return { command: null, unresolved: { reason: RESOLVE_REASONS.NOT_ACP, candidates: [] } };
  }

  const acp = def.acp && typeof def.acp === 'object' ? def.acp : {};
  const args = normalizeArgs(acp.args);
  const custom = customPaths[id] != null ? String(customPaths[id]).trim() : '';
  if (custom) {
    // 自定义路径是用户显式选择，保持既有行为：不再探测，直接作为启动命令
    return { command: [custom, ...args], unresolved: null };
  }

  const candidates = [];
  let bin = '';

  if (acp.adapter) {
    const name = String(acp.adapter);
    const runner = resolveAdapter ? () => resolveAdapter(name, id) : null;
    const out = await attempt('adapter', name, runner);
    candidates.push(out.candidate);
    bin = out.bin;
  } else if (acp.command) {
    const name = String(acp.command);
    const commandRunner = resolveCommand ? () => resolveCommand(name, id) : null;
    const out = await attempt('command', name, commandRunner);
    candidates.push(out.candidate);
    bin = out.bin;
    if (!bin) {
      const fallback = await attempt(
        'bin',
        String(def.bin || id),
        resolveBin ? () => resolveBin(def) : null
      );
      candidates.push(fallback.candidate);
      bin = fallback.bin;
    }
  } else {
    const out = await attempt(
      'bin',
      String(def.bin || id),
      resolveBin ? () => resolveBin(def) : null
    );
    candidates.push(out.candidate);
    bin = out.bin;
  }

  if (bin) return { command: [bin, ...args], unresolved: null };

  const last = candidates[candidates.length - 1];
  return {
    command: null,
    unresolved: {
      reason: (last && last.reason) || RESOLVE_REASONS.NOT_FOUND,
      candidates
    }
  };
}

/**
 * 为所有 transport:'acp' 的 def 生成 overrides，并返回未解析明细。
 *
 * @param {Object} options 构造参数
 * @param {Array<Object>} options.defs Agent 定义列表（通常来自 registry.getAllAgentDefs()）
 * @param {Object<string,string>} [options.customPaths] id → 用户自定义可执行文件路径
 * @param {(def:Object)=>string|Promise<string|null>} [options.resolveBin]
 * @param {(adapter:string, agentId:string)=>string|Promise<string|null>} [options.resolveAdapter]
 * @param {(command:string, agentId:string)=>string|Promise<string|null>} [options.resolveCommand]
 * @param {(info:{id:string, def:Object, reason:string, command:string, candidates:Array<Object>})=>void} [options.onUnresolved]
 *   可选：每条解析失败时回调，供上层写 trace（回调异常不影响整体）
 * @returns {Promise<{overrides:Object<string,string[]>, unresolved:Array<{id:string, reason:string, command:string, candidates:Array<Object>}>}>}
 */
async function buildAcpOverridesDetailed(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const defs = Array.isArray(opts.defs) ? opts.defs : [];
  const onUnresolved = typeof opts.onUnresolved === 'function' ? opts.onUnresolved : null;

  const overrides = {};
  const unresolved = [];
  for (const def of defs) {
    if (!def || typeof def !== 'object' || def.transport !== 'acp') continue;
    const id = def.id != null ? String(def.id).trim() : '';
    if (!id) continue;

    const result = await resolveAgentCommand(def, opts);
    if (result.command) {
      overrides[id] = result.command;
      continue;
    }
    const acp = def.acp && typeof def.acp === 'object' ? def.acp : {};
    const expected = acp.command ? String(acp.command) : (acp.adapter ? String(acp.adapter) : String(def.bin || id));
    const info = {
      id,
      reason: result.unresolved.reason,
      command: expected,
      candidates: result.unresolved.candidates
    };
    unresolved.push(info);
    if (onUnresolved) {
      try {
        onUnresolved({ ...info, def });
      } catch (_) { /* trace 回调不得影响 override 构造 */ }
    }
  }
  return { overrides, unresolved };
}

/**
 * 为所有 transport:'acp' 的 def 生成 acpx createAgentRegistry 所需的 overrides。
 * 单条解析失败只跳过该 Agent，不影响其余条目；需要失败原因时改用
 * buildAcpOverridesDetailed（或在 options 中传 onUnresolved）。
 *
 * @param {Object} options 构造参数（同上）
 * @returns {Promise<Object<string,string[]>>} { [agentId]: [bin, ...args] }
 */
async function buildAcpOverrides(options) {
  const detailed = await buildAcpOverridesDetailed(options);
  return detailed.overrides;
}

module.exports = {
  buildAcpOverrides,
  buildAcpOverridesDetailed,
  resolveAgentCommand,
  RESOLVE_REASONS
};
