'use strict';
/**
 * main/acp/acp-runtime.js — ACP 执行链路（Phase 1）
 * 职责：把一次 ai:ask 落到 acpx runtime（ensureSession / startTurn / 事件映射），
 * 并把权限请求桥接到现有 ai:event + ai:scope-confirm 通道。
 *
 * 约束：
 * - 默认关闭：只有 isAcpEnabled(cfg, def) 为真才会被 ai-process-service 调用；
 * - 不引用窗口对象：事件统一经注入的 emit(payload) 回调发出，便于纯 Node 单测；
 * - acpx 为 ESM-only，默认动态 import('acpx/runtime')，单测可注入 fake 模块；
 * - 主进程内 runtime 单例复用，避免同一会话出现多个 owner / 进程。
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const shared = require('../state');
const paths = require('../paths');
const { buildAcpOverrides } = require('./acp-registry');
const { mapAcpEvents } = require('./acp-event-mapper');
const { AcpPermissionBridge, normalizeDecision } = require('./acp-permission-bridge');
const { normalizeAcpError } = require('./acp-errors');
const { planSessionConfig, normalizeConfigOptions, redactErrorDetail } = require('./acp-config');
const { getAllAgentDefs } = require('../../runtimes/registry');
const { resolveAgentExecutable } = require('../../runtimes/resolution');
const acpProcessLifecycle = require('./acp-process-lifecycle');

const ACP_TIMEOUT_MS = 30 * 60 * 1000;
const CANCEL_KILL_GRACE_MS = 2000;
const PERMISSION_TIMEOUT_MS = 120000;
const PERMISSION_MODES = ['approve-all', 'approve-reads', 'deny-all'];

/** @type {Object|null} 注入的 acpx 模块（测试 / 宿主替换） */
let acpxModule = null;
/** @type {Promise<Object>|null} 默认动态 import 缓存 */
let modulePromise = null;
/** @type {Object|null} { mod, runtime, agentRegistry, sessionStore, overrides, options } */
let runtimeState = null;
/** @type {Promise<Object>|null} runtime 创建中的并发去重 */
let runtimeCreating = null;
/** @type {Object|null} 当前进行中的 ACP 轮次上下文 */
let activeAsk = null;
/** @type {Map<string,Object>} ACP 会话标识 → 当前轮次上下文 */
const sessionContexts = new Map();
/** @type {Map<string,Object>} sessionKey → 最近一次 ensureSession 句柄（跨轮复用 / fresh 重置） */
const sessionHandles = new Map();
/** @type {Promise<any>} 配置预探测串行链：避免并发 setConfigOption 交错导致读到其它模型的 options */
let previewChain = Promise.resolve();
/** @type {AcpPermissionBridge} 权限等待桥（暴露给 controller 回传决策） */
let permissionBridge = new AcpPermissionBridge({ defaultTimeoutMs: PERMISSION_TIMEOUT_MS });
/** @type {{defs:Array<Object>|null, resolveBin:Function|null, resolveAdapter:Function|null, resolveCommand:Function|null}} */
let injected = {
  defs: null,
  resolveBin: null,
  resolveAdapter: null,
  resolveCommand: null
};

/**
 * ACP 分流开关：只有显式开启且 Agent 声明 transport:'acp' 才走 ACP。
 * @param {Object} cfg AI 配置（loadAiConfigFull 形态）
 * @param {Object} def Agent 定义
 * @returns {boolean} 是否走 ACP
 */
function isAcpEnabled(cfg, def) {
  try {
    return !!(cfg && cfg.acp && cfg.acp.enabled === true && def && def.transport === 'acp');
  } catch (e) {
    return false;
  }
}

/**
 * 稳定会话键：cwd 与 UI 会话 id 各取 sha1 前 12 位（同一 cwd/标签页跨轮复用）。
 * 只输出定长哈希，不把原始 id 拼进 acpx 落盘文件名：acpx 的 FileSessionStore
 * 会对 sessionKey 再做 encodeURIComponent 转文件名，长路径型 uiSessionId 二次编码后
 * 可能超过 Windows 255 字符上限，导致 rename ENOENT（表现为 ACP_SESSION_INIT_FAILED）。
 * @param {string} cwd 沙箱工作目录
 * @param {string} [uiSessionId] 前端标签页 / 会话 id（可能本身是 URL 编码的完整路径）
 * @returns {string} acpx sessionKey，形如 pland-<cwdHash>-<sidHash>，固定 31 字符（<= 64）
 */
function sessionKeyFor(cwd, uiSessionId) {
  const cwdHash = crypto.createHash('sha1').update(String(cwd || '')).digest('hex').slice(0, 12);
  const sid = String(uiSessionId == null ? '' : uiSessionId).trim() || 'default';
  const sidHash = crypto.createHash('sha1').update(sid).digest('hex').slice(0, 12);
  return 'pland-' + cwdHash + '-' + sidHash;
}

/**
 * userData 目录：生产取 Electron app.getPath，纯 Node 测试回落 .devdata。
 * @returns {string} userData 绝对路径
 */
function userDataDir() {
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') {
      const p = el.app.getPath('userData');
      if (p) return String(p);
    }
  } catch (e) {}
  try { return path.join(__dirname, '..', '..', '.devdata'); } catch (e) { return process.cwd(); }
}

/**
 * 应用根目录：打包后 app.getAppPath()，开发态仓库根。
 * @returns {string} 根目录
 */
function appRootDir() {
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getAppPath === 'function') {
      const p = el.app.getAppPath();
      if (p) return String(p);
    }
  } catch (e) {}
  return path.join(__dirname, '..', '..');
}

/**
 * 解析 node_modules/.bin 内的可执行文件（Windows 优先 .cmd / .exe）。
 * @param {string} name 命令名
 * @returns {string|null} 绝对路径或 null
 */
function resolveLocalBin(name) {
  const base = String(name || '').trim();
  if (!base) return null;
  const roots = [];
  try { roots.push(appRootDir()); } catch (e) {}
  try { roots.push(process.cwd()); } catch (e) {}
  const isWin = process.platform === 'win32';
  const suffixes = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  const seen = new Set();
  for (const root of roots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const dir = path.join(String(root), 'node_modules', '.bin');
    for (const suffix of suffixes) {
      try {
        const full = path.join(dir, base + suffix);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch (e) {}
    }
  }
  return null;
}

/**
 * 默认 adapter / command 解析：node_modules/.bin → PATH → npm/scoop 兜底。
 * @param {string} name 适配器或启动命令名
 * @returns {Promise<string|null>} 可执行文件路径
 */
async function resolveAdapterDefault(name) {
  const local = resolveLocalBin(name);
  if (local) return local;
  try {
    return await resolveAgentExecutable({ bin: String(name || ''), fallbackBins: [] }, '');
  } catch (e) {
    return null;
  }
}

/**
 * 汇总用户自定义 CLI 路径（cliPaths 优先，旧 cliPath 兜底 opencode）。
 * @param {Object} aiCfg AI 配置
 * @returns {Object<string,string>} id → 自定义路径
 */
function collectCustomPaths(aiCfg) {
  const out = {};
  try {
    const map = aiCfg && aiCfg.cliPaths;
    if (map && typeof map === 'object') {
      for (const id of Object.keys(map)) {
        const v = map[id] == null ? '' : String(map[id]).trim();
        if (v) out[String(id)] = v;
      }
    }
  } catch (e) {}
  try {
    const legacy = aiCfg && aiCfg.cliPath ? String(aiCfg.cliPath).trim() : '';
    if (legacy && !out.opencode) out.opencode = legacy;
  } catch (e) {}
  return out;
}

/**
 * 构造 acpx Agent overrides（全部 transport:'acp' 的 def）。
 * @param {Object} aiCfg AI 配置
 * @returns {Promise<Object<string,string[]>>} id → [bin, ...args]
 */
async function buildOverrides(aiCfg) {
  const defs = injected.defs || getAllAgentDefs();
  const customPaths = collectCustomPaths(aiCfg);
  const resolveBin = injected.resolveBin || ((def) => {
    const custom = customPaths[def.id] || (def.id === 'opencode' ? customPaths.opencode : '');
    return resolveAgentExecutable(def, custom);
  });
  const resolveAdapter = injected.resolveAdapter || resolveAdapterDefault;
  const resolveCommand = injected.resolveCommand || resolveAdapterDefault;
  return buildAcpOverrides({ defs, customPaths, resolveBin, resolveAdapter, resolveCommand });
}

/**
 * 读取运行级权限模式（acp.defaultPermissionMode，非法值回落 approve-reads）。
 * @param {Object} aiCfg AI 配置
 * @returns {'approve-all'|'approve-reads'|'deny-all'} 权限模式
 */
function resolvePermissionMode(aiCfg) {
  try {
    const v = String((aiCfg && aiCfg.acp && aiCfg.acp.defaultPermissionMode) || '').trim();
    if (PERMISSION_MODES.indexOf(v) >= 0) return v;
  } catch (e) {}
  return 'approve-reads';
}

/**
 * 加载 acpx 模块（默认 ESM 动态 import，失败转 ACP_BACKEND_MISSING）。
 * @returns {Promise<Object>} acpx/runtime 模块
 */
function loadAcpxModule() {
  if (acpxModule) return Promise.resolve(acpxModule);
  if (!modulePromise) {
    modulePromise = import('acpx/runtime').then((mod) => {
      if (!mod || typeof mod.createAcpRuntime !== 'function') {
        const err = new Error('acpx/runtime 未导出 createAcpRuntime');
        err.code = 'ACP_BACKEND_MISSING';
        throw err;
      }
      return mod;
    }).catch((e) => {
      modulePromise = null;
      if (e && e.code === 'ACP_BACKEND_MISSING') throw e;
      const err = new Error('ACP 运行时不可用：未安装 acpx，或 acpx/runtime 无法加载。');
      err.code = 'ACP_BACKEND_MISSING';
      err.cause = e;
      throw err;
    });
  }
  return modulePromise;
}

/**
 * 记录 ACP 协议流量（仅 acp.logJsonRpc 开启时以 trace 事件下发）。
 * @param {string} direction outbound / inbound
 * @param {Object} message JSON-RPC 消息
 * @returns {void}
 */
function handleAcpMessage(direction, message) {
  const ctx = activeAsk;
  if (!ctx || !ctx.logJsonRpc) return;
  try {
    const method = message && (message.method || (message.result && message.result.method) || '');
    safeEmit(ctx, {
      type: 'trace',
      trace: {
        tag: 'ACP',
        level: 'info',
        text: String(direction || '') + (method ? ' ' + String(method) : '')
      },
      transport: 'acp',
      ...(ctx.uiSessionId ? { uiSessionId: ctx.uiSessionId } : {})
    });
  } catch (e) {}
}

/**
 * 创建/复用进程内唯一 acpx runtime。
 * @param {Object} aiCfg AI 配置（首次创建时读取 cliPaths / 权限模式）
 * @returns {Promise<Object>} { mod, runtime, agentRegistry, sessionStore, overrides, options }
 */
async function getRuntimeState(aiCfg) {
  if (runtimeState) return runtimeState;
  if (runtimeCreating) return runtimeCreating;

  runtimeCreating = (async () => {
    const mod = await loadAcpxModule();
    const overrides = await buildOverrides(aiCfg);
    const agentRegistry = mod.createAgentRegistry({ overrides });
    const statusDir = path.join(userDataDir(), 'acp', 'sessions');
    const sessionStore = mod.createFileSessionStore({ stateDir: statusDir });
    const options = {
      cwd: paths.SANDBOX_ROOT,
      sessionStore,
      agentRegistry,
      permissionMode: resolvePermissionMode(aiCfg),
      nonInteractivePermissions: 'deny',
      fs: true,
      terminal: true,
      timeoutMs: ACP_TIMEOUT_MS,
      onPermissionRequest: (request, context) => handlePermissionRequest(request, context),
      onAcpMessage: (direction, message) => handleAcpMessage(direction, message),
      processLifecycle: {
        onSpawned: (proc) => {
          try {
            if (!proc || !Number.isFinite(Number(proc.pid))) return;
            const pid = Number(proc.pid);
            /* 只登记带 command 的真实启动记录：acpx 的 AcpProcessStarted 必带 command，
             * 测试/异常路径的伪 PID（无 command）不进入清理集合，避免误杀。 */
            if (proc.command) {
              acpProcessLifecycle.trackPid(pid, {
                kind: 'acp',
                label: String(proc.command),
                command: String(proc.command),
                startedAt: proc.startedAt,
                scope: proc.scope
              });
            }
            if (shared.activeExecution && shared.activeExecution.kind === 'acp') {
              shared.activeExecution.pid = pid;
            }
          } catch (e) {}
        },
        onExit: (proc) => {
          try {
            if (proc && Number.isFinite(Number(proc.pid))) {
              acpProcessLifecycle.untrackPid(Number(proc.pid));
            }
            if (shared.activeExecution && shared.activeExecution.kind === 'acp' && proc && shared.activeExecution.pid === proc.pid) {
              shared.activeExecution.pid = null;
            }
          } catch (e) {}
        }
      }
    };
    const runtime = mod.createAcpRuntime(options);
    runtimeState = { mod, runtime, agentRegistry, sessionStore, overrides, options, stateDir: statusDir };
    return runtimeState;
  })();

  try {
    return await runtimeCreating;
  } finally {
    runtimeCreating = null;
  }
}

/**
 * 安全发事件：emit 缺失/抛错都不影响执行链路。
 * @param {Object} ctx 轮次上下文
 * @param {Object} payload ai:event 负载
 * @returns {void}
 */
function safeEmit(ctx, payload) {
  try {
    if (ctx && typeof ctx.emit === 'function') ctx.emit(payload);
  } catch (e) {}
}

/**
 * 出错时补充默认错误码，保留 acpx 已知 code。
 * @param {string} fallbackCode 默认错误码
 * @param {*} cause 原始异常
 * @returns {*} 原异常或补充 code 后的 Error
 */
function withFallbackCode(fallbackCode, cause) {
  if (cause && cause.code && normalizeAcpError(cause).code !== 'ACP_UNKNOWN') return cause;
  const err = cause instanceof Error ? cause : new Error(String(cause == null ? fallbackCode : cause));
  try { err.code = fallbackCode; } catch (e) {}
  return err;
}

/**
 * 发一条 ACP 内部 trace（默认 warn），emit 异常不影响执行链路。
 * @param {Object} ctx 轮次上下文
 * @param {string} tag trace 标签（SESSION / CONFIG 等）
 * @param {string} text trace 文本
 * @param {'info'|'warn'|'error'} [level] 级别，默认 warn
 * @returns {void}
 */
function traceAcp(ctx, tag, text, level) {
  safeEmit(ctx, {
    type: 'trace',
    trace: { tag: String(tag || 'ACP'), level: String(level || 'warn'), text: String(text || '') },
    transport: 'acp',
    ...(ctx && ctx.uiSessionId ? { uiSessionId: ctx.uiSessionId } : {})
  });
}

/**
 * 错误对象 → 单行文本（用于 trace，限制长度避免刷屏）。
 * @param {*} err 任意错误
 * @returns {string} 文本
 */
function errText(err) {
  const text = err && err.message != null ? String(err.message) : String(err == null ? '' : err);
  return text.length > 300 ? text.slice(0, 299) + '…' : text;
}

/**
 * 解析出的 Agent 可执行文件（错误详情用）。
 * @param {string} agentId Agent id
 * @returns {string} 命令路径，未知时返回空串
 */
function agentCommandOf(agentId) {
  try {
    const id = String(agentId || '');
    if (!id) return '';
    const overrides = runtimeState && runtimeState.overrides;
    const argv = overrides && overrides[id];
    if (Array.isArray(argv) && argv.length) return String(argv[0] || '');
  } catch (e) {}
  return '';
}

/**
 * 组装 ai:event 错误负载。
 * @param {*} err 原始错误
 * @param {string} fallbackCode 默认错误码
 * @param {string} [uiSessionId] UI 会话 id
 * @param {{agentId?:string,command?:string,availableModels?:string[],reason?:string}} [meta] 诊断补充
 * @returns {Object} ai:event error
 */
function errorPayload(err, fallbackCode, uiSessionId, meta) {
  let normalized = normalizeAcpError(err);
  if (normalized.code === 'ACP_UNKNOWN' && fallbackCode) normalized = normalizeAcpError({ code: fallbackCode });
  const info = meta && typeof meta === 'object' ? meta : {};
  const out = {
    type: 'error',
    code: normalized.code,
    title: normalized.title,
    message: normalized.message,
    action: normalized.action,
    retryable: normalized.retryable,
    detail: redactErrorDetail(err),
    transport: 'acp'
  };
  const agentId = info.agentId ? String(info.agentId) : '';
  if (agentId) out.agentId = agentId;
  const command = info.command ? String(info.command) : '';
  if (command) out.command = command;
  const available = Array.isArray(err && err.availableModels)
    ? err.availableModels.slice()
    : (Array.isArray(info.availableModels) ? info.availableModels.slice() : []);
  if (available.length) out.availableModels = available;
  const reason = (err && err.reason) || info.reason;
  if (reason) out.reason = String(reason);
  if (uiSessionId) out.uiSessionId = String(uiSessionId);
  return out;
}

/**
 * 登记会话标识 → 轮次上下文，供 onPermissionRequest 路由。
 * @param {Object} ctx 轮次上下文
 * @returns {void}
 */
function registerSessionContext(ctx) {
  const handle = ctx.handle || {};
  const ids = [ctx.acpSessionId, handle.sessionKey, handle.backendSessionId, handle.agentSessionId, handle.acpxRecordId];
  for (const id of ids) {
    try {
      if (id) sessionContexts.set(String(id), ctx);
    } catch (e) {}
  }
}

/**
 * 注销会话上下文（只删仍指向本 ctx 的键）。
 * @param {Object} ctx 轮次上下文
 * @returns {void}
 */
function unregisterSessionContext(ctx) {
  for (const [key, value] of sessionContexts) {
    if (value === ctx) sessionContexts.delete(key);
  }
}

/**
 * 权限请求 → ai:event permission_request，等待 ai:scope-confirm 回传。
 * 无 UI（无 emit）或 emit 抛错时按 deny 处理，避免 Agent 悬挂。
 * @param {Object} request acpx AcpPermissionRequest
 * @param {{signal?:AbortSignal}} [context] acpx 权限上下文
 * @returns {Promise<Object>} acpx 决策对象
 */
function handlePermissionRequest(request, context) {
  const ctx = findAskContext(request);
  if (!ctx || ctx.settled || !ctx.acceptPermissions || typeof ctx.emit !== 'function') {
    return Promise.resolve({ outcome: 'reject_once' });
  }

  let payload = null;
  try {
    payload = buildPermissionPayload(request, ctx);
  } catch (e) {
    return Promise.resolve({ outcome: 'reject_once' });
  }

  let promise = null;
  try {
    promise = permissionBridge.request(payload, ctx.permissionTimeoutMs);
  } catch (e) {
    return Promise.resolve({ outcome: 'reject_once' });
  }
  const id = String(payload.id || promise.id || '');
  if (!id) return Promise.resolve({ outcome: 'reject_once' });
  ctx.permissionIds.add(id);

  try {
    ctx.emit(payload);
  } catch (e) {
    try { permissionBridge.cancel(id); } catch (_) {}
    ctx.permissionIds.delete(id);
    return Promise.resolve({ outcome: 'reject_once' });
  }

  const signal = context && context.signal;
  if (signal && typeof signal.addEventListener === 'function') {
    try {
      if (signal.aborted) {
        cancelPermissionRequest(ctx, id);
      } else {
        signal.addEventListener('abort', () => {
          cancelPermissionRequest(ctx, id);
        }, { once: true });
      }
    } catch (e) {}
  }

  return promise.then((decision) => {
    ctx.permissionIds.delete(id);
    return normalizePermissionDecision(decision);
  });
}

/**
 * 按 sessionId 找轮次上下文，找不到回落当前 activeAsk。
 * @param {Object} request 权限请求
 * @returns {Object|null} 轮次上下文
 */
function findAskContext(request) {
  try {
    const sid = request && request.sessionId != null ? String(request.sessionId) : '';
    if (sid && sessionContexts.has(sid)) return sessionContexts.get(sid);
    if (activeAsk) {
      if (!sid) return activeAsk;
      if (activeAsk.acpSessionId === sid || activeAsk.sessionKey === sid) return activeAsk;
    }
  } catch (e) {}
  return null;
}

/**
 * 构造 ui:event 权限卡负载（字段对齐技术方案 7.1）。
 * @param {Object} request acpx AcpPermissionRequest
 * @param {Object} ctx 轮次上下文
 * @returns {Object} permission_request 负载
 */
function buildPermissionPayload(request, ctx) {
  const req = request && typeof request === 'object' ? request : {};
  const raw = req.raw && typeof req.raw === 'object' ? req.raw : {};
  const toolCall = raw.toolCall && typeof raw.toolCall === 'object' ? raw.toolCall : {};
  const toolKind = String(toolCall.kind || req.inferredKind || '');
  const input = toolCall.rawInput && typeof toolCall.rawInput === 'object' ? toolCall.rawInput : {};
  const command = input.command != null ? String(input.command) : (input.cmd != null ? String(input.cmd) : '');
  const filePath = input.path != null ? String(input.path)
    : (input.file != null ? String(input.file)
      : (input.filePath != null ? String(input.filePath) : ''));
  const options = [];
  if (Array.isArray(raw.options)) {
    for (const o of raw.options) {
      if (!o || o.optionId == null) continue;
      options.push({
        optionId: String(o.optionId),
        name: String(o.name || o.optionId),
        kind: String(o.kind || '')
      });
    }
  }
  const agentId = ctx.def && ctx.def.id ? String(ctx.def.id) : '';
  const payload = {
    type: 'permission_request',
    sessionId: String(req.sessionId == null ? '' : req.sessionId),
    /* 权限桥按 agentId + sessionId/uiSessionId 复合键收尾，避免多 Agent 同会话误杀 */
    agentId,
    agentName: String((ctx.def && ctx.def.name) || agentId),
    acpSessionId: ctx.acpSessionId ? String(ctx.acpSessionId) : '',
    workdir: ctx.cwd ? String(ctx.cwd) : '',
    uiSessionId: ctx.uiSessionId,
    toolCallId: toolCall.toolCallId != null ? String(toolCall.toolCallId) : '',
    title: String(toolCall.title || raw.title || toolKind || '权限请求'),
    kind: toolKind,
    toolKind,
    command,
    path: filePath,
    locations: Array.isArray(toolCall.locations) ? toolCall.locations.slice() : [],
    options,
    risk: riskForKind(toolKind),
    transport: 'acp'
  };
  if (!payload.agentId) { delete payload.agentId; delete payload.agentName; }
  if (!payload.acpSessionId) delete payload.acpSessionId;
  if (!payload.workdir) delete payload.workdir;
  if (!payload.uiSessionId) delete payload.uiSessionId;
  return payload;
}

/**
 * 工具类型 → 风险级别（仅用于卡片展示，不是安全边界）。
 * @param {string} kind ToolKind
 * @returns {'low'|'medium'|'high'} 风险级别
 */
function riskForKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'read' || k === 'search') return 'low';
  if (k === 'delete' || k === 'move' || k === 'execute') return 'high';
  return 'medium';
}

/**
 * 归一化 UI 决策：带 optionId 的对象直接转 selected。
 * @param {*} decision UI 回传决策
 * @returns {Object|string} bridge 可消费的决策
 */
function normalizeUiDecision(decision) {
  if (decision && typeof decision === 'object') {
    if (decision.outcome == null && decision.optionId != null) {
      return { outcome: 'selected', optionId: String(decision.optionId) };
    }
    return decision;
  }
  return decision;
}

/**
 * 保证返回结构是 acpx 可消费的决策对象。
 * @param {*} decision bridge 结果
 * @returns {Object} acpx 决策
 */
function normalizePermissionDecision(decision) {
  if (decision && typeof decision === 'object' && decision.outcome) return decision;
  return { outcome: 'cancel' };
}

/**
 * 发 permission_resolved，通知 UI 关闭待决权限卡。
 * @param {Object} ctx 轮次上下文
 * @param {string} id 权限请求 id
 * @param {*} [decision] 归一化决策（cancel 时省略或 {outcome:'cancel'}）
 * @returns {void}
 */
function emitPermissionResolved(ctx, id, decision) {
  if (!ctx || !id) return;
  const payload = { type: 'permission_resolved', id: String(id), transport: 'acp' };
  if (decision !== undefined) payload.decision = decision;
  if (ctx.def && ctx.def.id) payload.agentId = String(ctx.def.id);
  if (ctx.uiSessionId) payload.uiSessionId = ctx.uiSessionId;
  safeEmit(ctx, payload);
}

/**
 * 取消单个待决权限并回发 permission_resolved。
 * @param {Object} ctx 轮次上下文
 * @param {string} id 权限请求 id
 * @returns {boolean} 是否命中待决请求
 */
function cancelPermissionRequest(ctx, id) {
  let hit = false;
  try { hit = permissionBridge.cancel(id); } catch (e) { hit = false; }
  if (hit) emitPermissionResolved(ctx, id, { outcome: 'cancel' });
  return hit;
}

/**
 * 按权限 id 找所属轮次上下文（activeAsk 优先，其次 sessionContexts 去重）。
 * @param {string} id 权限请求 id
 * @returns {Object|null} 轮次上下文
 */
function findContextByPermissionId(id) {
  const key = id != null ? String(id) : '';
  if (!key) return null;
  try {
    if (activeAsk && activeAsk.permissionIds && activeAsk.permissionIds.has(key)) return activeAsk;
    for (const ctx of sessionContexts.values()) {
      if (ctx && ctx.permissionIds && ctx.permissionIds.has(key)) return ctx;
    }
  } catch (e) {}
  return null;
}

/**
 * UI 决策回传入口（ai-controller 的 ai:scope-confirm kind==='acp-permission' 路由到此）。
 * 命中后回发 permission_resolved，避免其他标签页残留权限卡。
 * @param {string} id 权限请求 id
 * @param {Object|string} decision 'allow-once'|'allow-always'|'deny' 或 {outcome, optionId}
 * @returns {boolean} 是否命中待决请求
 */
function resolvePermission(id, decision) {
  const normalized = normalizeUiDecision(decision);
  let hit = false;
  try { hit = permissionBridge.resolve(id, normalized); } catch (e) { hit = false; }
  if (!hit) return false;
  const ctx = findContextByPermissionId(id);
  if (ctx) {
    try { ctx.permissionIds.delete(String(id)); } catch (e) {}
    emitPermissionResolved(ctx, id, normalizeDecision(normalized));
  }
  return true;
}

/**
 * 记录 sessionKey → handle（persistent 会话跨轮复用，供 fresh 重置）。
 * @param {string} key 稳定会话键
 * @param {Object} handle acpx 会话句柄
 * @returns {void}
 */
function rememberSessionHandle(key, handle) {
  try {
    if (key && handle && typeof handle === 'object') sessionHandles.set(String(key), handle);
  } catch (e) {}
}

/**
 * 按对象身份清理 sessionHandles 中的句柄。
 * @param {Object} handle acpx 会话句柄
 * @returns {void}
 */
function forgetSessionHandle(handle) {
  if (!handle) return;
  try {
    for (const [key, value] of sessionHandles) {
      if (value === handle) sessionHandles.delete(key);
    }
  } catch (e) {}
}

/**
 * 安全读取 runtime.getStatus（缺失 / 失败都不阻断本轮）。
 * @param {Object} runtime acpx runtime
 * @param {Object} handle 会话句柄
 * @param {Object} ctx 轮次上下文
 * @returns {Promise<Object|null>} status 或 null
 */
async function readSessionStatus(runtime, handle, ctx) {
  if (!runtime || typeof runtime.getStatus !== 'function') return null;
  try {
    return await runtime.getStatus({ handle });
  } catch (e) {
    traceAcp(ctx, 'CONFIG', '读取 ACP 会话状态失败：' + errText(e));
    return null;
  }
}

/**
 * 取本轮用于切换模型的 config option key。
 * 优先 id==='model'，其次 category==='model'；都没有时才回落到 plan.modelConfigId
 * （acp-config 的 modelConfigId 指向 model 子配置，如 context_size）。
 * @param {Object} plan planSessionConfig 结果
 * @returns {string} config option key，空串表示无可用配置项
 */
function modelOptionKeyOf(plan) {
  const list = plan && Array.isArray(plan.configOptions) ? plan.configOptions : [];
  const option =
    list.find((item) => item && item.id === 'model') ||
    list.find((item) => item && item.category === 'model') ||
    null;
  if (option && option.id) return String(option.id);
  return plan && plan.modelConfigId ? String(plan.modelConfigId) : '';
}

/** 已由 applySessionConfig 处理的配置项类别 / id（requestedConfig 不得覆盖） */
const CONFIG_PROTECTED_CATEGORIES = ['model', 'thought'];
const CONFIG_PROTECTED_IDS = ['model', 'thought_level', 'reasoning_effort', 'effort', 'thinking'];

/**
 * 归一化 ai:ask 传入的 extra.acpConfig：只接受 plain object，
 * key 去空白，value 保留 string/boolean（其他类型留待应用阶段告警）。
 * @param {*} raw 前端 acpConfig
 * @returns {Object<string,string|boolean>} 归一化后的配置项
 */
function normalizeRequestedConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    const id = String(key == null ? '' : key).trim();
    if (!id) continue;
    const value = raw[key];
    if (value === undefined || value === null) continue;
    out[id] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/**
 * 判断配置项是否已由模型 / 思考强度链路处理，requestedConfig 必须跳过。
 * @param {Object} option 归一化 config option
 * @returns {boolean} 是否受保护
 */
function isProtectedConfigOption(option) {
  if (!option) return false;
  const category = String(option.category || '').toLowerCase();
  if (CONFIG_PROTECTED_CATEGORIES.indexOf(category) >= 0) return true;
  return CONFIG_PROTECTED_IDS.indexOf(String(option.id || '')) >= 0;
}

/**
 * 校验并归一化单个配置值：
 * - boolean 类型：接受 boolean 或 'true'/'false'；
 * - select 类型：值必须命中公告 options；
 * - 无 options 的其它类型：只接受 boolean。
 * @param {Object} option 归一化 config option
 * @param {*} rawValue 请求值
 * @returns {string|boolean|null} 可应用值，非法时返回 null
 */
function resolveConfigValue(option, rawValue) {
  const type = String((option && option.type) || '').toLowerCase();
  const list = option && Array.isArray(option.options) ? option.options : [];

  if (type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    const text = String(rawValue == null ? '' : rawValue).trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return null;
  }

  if (!list.length) return typeof rawValue === 'boolean' ? rawValue : null;
  if (typeof rawValue !== 'string') return null;
  const value = rawValue.trim();
  if (!value) return null;
  const allowed = new Set();
  for (const item of list) {
    if (item && item.value != null && String(item.value) !== '') allowed.add(String(item.value));
  }
  return allowed.has(value) ? value : null;
}

/**
 * 应用前端下一轮 ai:ask 带来的非模型 / 非思考配置（model_config / mode 等）。
 * 顺序：模型 / 思考强度之后，逐项 setConfigOption；单点失败只 trace，不阻断本轮。
 * @param {Object} runtime acpx runtime
 * @param {Object} handle 会话句柄
 * @param {Object} plan planSessionConfig 结果（提供当前 configOptions）
 * @param {Object} requestedConfig 归一化后的配置项
 * @param {Object} ctx 轮次上下文
 * @returns {Promise<{appliedConfig:Object,warnings:string[],applied:boolean}>} 应用结果
 */
async function applyRequestedConfig(runtime, handle, plan, requestedConfig, ctx) {
  const appliedConfig = {};
  const warnings = [];
  const requested = requestedConfig && typeof requestedConfig === 'object' ? requestedConfig : {};
  const keys = Object.keys(requested);
  if (!keys.length || !runtime) return { appliedConfig, warnings, applied: false };

  const pushWarning = (warning) => {
    if (warnings.indexOf(warning) < 0) warnings.push(warning);
  };
  const options = plan && Array.isArray(plan.configOptions) ? plan.configOptions : [];
  const setOption = typeof runtime.setConfigOption === 'function'
    ? (input) => runtime.setConfigOption(input)
    : null;

  for (const key of keys) {
    const option = options.find((item) => item && item.id === key) || null;
    if (!option) {
      pushWarning('config-option-missing');
      traceAcp(ctx, 'CONFIG', '未找到配置项，已跳过：' + key);
      continue;
    }
    if (isProtectedConfigOption(option)) continue;

    const value = resolveConfigValue(option, requested[key]);
    if (value === null) {
      pushWarning('config-value-not-advertised');
      traceAcp(ctx, 'CONFIG', '配置项取值不在公告范围内，已跳过：' + key + '=' + String(requested[key]));
      continue;
    }
    if (!setOption) {
      traceAcp(ctx, 'CONFIG', '运行时缺少 setConfigOption，已跳过配置项：' + key);
      continue;
    }

    try {
      await setOption({ handle, key, value });
      appliedConfig[key] = value;
    } catch (e) {
      traceAcp(ctx, 'CONFIG', '应用配置失败（' + key + '=' + String(value) + '）：' + errText(e));
    }
  }

  return { appliedConfig, warnings, applied: Object.keys(appliedConfig).length > 0 };
}

/**
 * 应用 requestedConfig 后刷新 configOptions（getStatus 失败保留原列表）。
 * @param {Object} runtime acpx runtime
 * @param {Object} handle 会话句柄
 * @param {Object} plan planSessionConfig 结果（刷新成功时原地替换 configOptions）
 * @param {Object} ctx 轮次上下文
 * @returns {Promise<boolean>} 是否刷新成功
 */
async function refreshConfigOptions(runtime, handle, plan, ctx) {
  const status = await getSessionStatus(handle, { runtime });
  if (!status || !status.ok) {
    traceAcp(ctx, 'CONFIG', '刷新 ACP 配置项失败：' + String((status && status.error) || 'unknown'));
    return false;
  }
  if (!Array.isArray(status.configOptions) || !status.configOptions.length) return false;
  if (plan && typeof plan === 'object') plan.configOptions = status.configOptions;
  return true;
}

/**
 * 只应用思考强度配置项（模型已在 applySessionConfig 中切换）。
 * @param {Object} runtime acpx runtime
 * @param {Object} handle 会话句柄
 * @param {Object} plan planSessionConfig 结果
 * @param {Object} ctx 轮次上下文
 * @returns {Promise<void>}
 */
async function applyThoughtConfig(runtime, handle, plan, ctx) {
  if (!plan || !plan.thoughtConfigId || !plan.thoughtValue) return;
  if (!runtime || typeof runtime.setConfigOption !== 'function') {
    traceAcp(ctx, 'CONFIG', '运行时缺少 setConfigOption，已跳过思考强度设置：' + plan.thoughtConfigId);
    return;
  }
  try {
    await runtime.setConfigOption({ handle, key: plan.thoughtConfigId, value: plan.thoughtValue });
  } catch (e) {
    traceAcp(ctx, 'CONFIG', '应用思考强度失败（' + plan.thoughtConfigId + '=' + plan.thoughtValue + '）：' + errText(e));
  }
}

/**
 * 按 planSessionConfig 计划应用模型与思考强度。
 * 顺序：模型（model config option 优先）-> setModel 兜底 -> thought_level。
 * 所有失败只 trace warning，不阻断本轮。
 * @param {Object} runtime acpx runtime
 * @param {Object} handle 会话句柄
 * @param {Object} plan planSessionConfig 结果
 * @param {Object} ctx 轮次上下文
 * @returns {Promise<void>}
 */
async function applySessionConfig(runtime, handle, plan, ctx) {
  if (!plan || !runtime) return;
  const setOption = typeof runtime.setConfigOption === 'function'
    ? (input) => runtime.setConfigOption(input)
    : null;
  const setModel = typeof runtime.setModel === 'function'
    ? (input) => runtime.setModel(input)
    : null;
  const modelKey = modelOptionKeyOf(plan);

  if (plan.model && modelKey) {
    if (setOption) {
      try {
        await setOption({ handle, key: modelKey, value: plan.model });
      } catch (e) {
        traceAcp(ctx, 'CONFIG', '应用模型失败（' + modelKey + '=' + plan.model + '）：' + errText(e));
      }
    } else if (setModel) {
      try {
        await setModel({ handle, model: plan.model });
      } catch (e) {
        traceAcp(ctx, 'CONFIG', 'setModel 失败（' + plan.model + '）：' + errText(e));
      }
    } else {
      traceAcp(ctx, 'CONFIG', '运行时缺少模型控制接口，已跳过模型设置：' + plan.model);
    }
  } else if (plan.model && setModel) {
    try {
      await setModel({ handle, model: plan.model });
    } catch (e) {
      traceAcp(ctx, 'CONFIG', 'setModel 失败（' + plan.model + '）：' + errText(e));
    }
  }

  if (plan.thoughtConfigId && plan.thoughtValue) {
    await applyThoughtConfig(runtime, handle, plan, ctx);
  }
}

/**
 * 组装 acp_config 事件（UI 首次拿到模型 / 思考强度 / 全部 configOptions）。
 * @param {Object} plan planSessionConfig 结果
 * @param {Object} ctx 轮次上下文
 * @param {{warnings?:string[],error?:string,availableModels?:string[],selections?:Object,
 *   appliedConfig?:Object}} [extra] 追加信息
 * @returns {Object} ai:event acp_config
 */
function buildAcpConfigEvent(plan, ctx, extra) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const warnings = Array.isArray(p.warnings) ? p.warnings.slice() : [];
  const more = extra && Array.isArray(extra.warnings) ? extra.warnings : [];
  for (const w of more) {
    if (w && warnings.indexOf(w) < 0) warnings.push(w);
  }
  const payload = {
    type: 'acp_config',
    model: p.model ? String(p.model) : '',
    modelConfigId: p.modelConfigId ? String(p.modelConfigId) : '',
    thoughtConfigId: p.thoughtConfigId ? String(p.thoughtConfigId) : '',
    thoughtValue: p.thoughtValue ? String(p.thoughtValue) : '',
    configOptions: Array.isArray(p.configOptions) ? p.configOptions : [],
    warnings,
    transport: 'acp'
  };
  if (extra && extra.selections && typeof extra.selections === 'object') {
    payload.selections = { ...extra.selections };
    payload.appliedConfig = extra.appliedConfig && typeof extra.appliedConfig === 'object'
      ? { ...extra.appliedConfig }
      : {};
  }
  if (extra && extra.error) payload.error = String(extra.error);
  if (extra && Array.isArray(extra.availableModels) && extra.availableModels.length) {
    payload.availableModels = extra.availableModels.slice();
  }
  /* ACP 协议事件本身只有 sessionId，事件信封在此补齐 Agent / 工作目录维度，
   * 供前端按 agentId + uiSessionId 分组缓存，避免多 Agent 切换时串配置。 */
  const agentId = ctx && ctx.def && ctx.def.id ? String(ctx.def.id) : '';
  if (agentId) {
    payload.agentId = agentId;
    payload.agentName = String((ctx.def && ctx.def.name) || agentId);
  }
  if (ctx && ctx.acpSessionId) payload.acpSessionId = String(ctx.acpSessionId);
  if (ctx && ctx.cwd) payload.workdir = String(ctx.cwd);
  if (ctx && ctx.uiSessionId) payload.uiSessionId = ctx.uiSessionId;
  return payload;
}

/**
 * 构造 ACP_MODEL_UNSUPPORTED 错误（detail 带可用模型，供错误卡展开）。
 * @param {string} requestedModel UI 明确选择但不受支持的模型
 * @param {Object} plan planSessionConfig 结果（含 availableModels）
 * @returns {Error} 带 code / detail / availableModels 的错误
 */
function modelUnsupportedError(requestedModel, plan) {
  const available = Array.isArray(plan && plan.availableModels) ? plan.availableModels.slice() : [];
  const err = new Error('模型 ' + String(requestedModel || '') + ' 不在当前 Agent 的可用模型内');
  err.code = 'ACP_MODEL_UNSUPPORTED';
  err.availableModels = available;
  err.detail = 'requestedModel=' + String(requestedModel || '')
    + '; availableModels=' + (available.length ? available.join(', ') : '(none)');
  return err;
}

/**
 * 重置会话：优先 prepareFreshSession，其次 close(discardPersistentState)。
 * 失败只 trace，不抛错。
 * @param {Object} handle acpx 会话句柄
 * @param {{runtime?:Object,ctx?:Object}} [options] 注入 runtime / trace 上下文
 * @returns {Promise<{ok:boolean,method:string}>} 重置结果
 */
async function resetSession(handle, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const runtime = opts.runtime || (runtimeState && runtimeState.runtime) || null;
  const ctx = opts.ctx || activeAsk || null;
  if (!handle) {
    traceAcp(ctx, 'SESSION', '没有可重置的 ACP 会话句柄');
    return { ok: false, method: 'none' };
  }
  if (!runtime) {
    traceAcp(ctx, 'SESSION', 'ACP 运行时尚未创建，无法重置会话');
    return { ok: false, method: 'none' };
  }
  if (typeof runtime.prepareFreshSession === 'function') {
    try {
      await runtime.prepareFreshSession({ handle });
      forgetSessionHandle(handle);
      return { ok: true, method: 'prepareFreshSession' };
    } catch (e) {
      traceAcp(ctx, 'SESSION', 'prepareFreshSession 失败，尝试 close：' + errText(e));
    }
  }
  if (typeof runtime.close === 'function') {
    try {
      await runtime.close({ handle, reason: 'user-reset', discardPersistentState: true });
      forgetSessionHandle(handle);
      return { ok: true, method: 'close' };
    } catch (e) {
      traceAcp(ctx, 'SESSION', '关闭 ACP 会话失败：' + errText(e));
    }
  }
  traceAcp(ctx, 'SESSION', '运行时未提供 prepareFreshSession / close，无法重置会话');
  return { ok: false, method: 'none' };
}

/**
 * 读取会话状态（模型目录 / configOptions / 可用命令 / 用量）。
 * @param {Object} handle acpx 会话句柄
 * @param {{runtime?:Object}} [options] 注入 runtime（默认复用进程内单例）
 * @returns {Promise<{ok:boolean,models:Object|null,configOptions:Array<Object>,
 *   availableCommands:Array<Object>,usage:Object|null,error?:string}>} 归一化状态
 */
async function getSessionStatus(handle, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const runtime = opts.runtime || (runtimeState && runtimeState.runtime) || null;
  const empty = { ok: false, models: null, configOptions: [], availableCommands: [], usage: null };
  if (!runtime || typeof runtime.getStatus !== 'function') {
    return Object.assign({}, empty, { error: 'getStatus-unavailable' });
  }
  try {
    const status = await runtime.getStatus({ handle });
    const src = status && typeof status === 'object' ? status : {};
    return {
      ok: true,
      models: src.models && typeof src.models === 'object' ? src.models : null,
      configOptions: normalizeConfigOptions(src),
      availableCommands: Array.isArray(src.availableCommands) ? src.availableCommands.slice() : [],
      usage: src.usage && typeof src.usage === 'object' ? src.usage : null
    };
  } catch (e) {
    return Object.assign({}, empty, { error: errText(e) });
  }
}

/**
 * 取 configOptions 中真正的模型配置项（id==='model' 优先，其次 category==='model'）。
 * 与 modelOptionKeyOf 不同：不回落到 model_config，避免把 context_size 当成模型 key。
 * @param {Array<Object>} list 归一化 configOptions
 * @returns {Object|null} 模型配置项
 */
function findModelConfigOption(list) {
  const options = Array.isArray(list) ? list : [];
  return options.find((item) => item && item.id === 'model')
    || options.find((item) => item && item.category === 'model')
    || null;
}

/**
 * 从 configOptions 读取模型配置项当前值（真正生效的模型）。
 * @param {Array<Object>} list 归一化 configOptions
 * @returns {string} 模型 id，缺失时返回空串
 */
function currentModelOf(list) {
  const option = findModelConfigOption(list);
  if (!option || option.currentValue == null) return '';
  return String(option.currentValue).trim();
}

/**
 * 读取 setConfigOption 返回值里的 configOptions（不同 acpx 版本形态不一）。
 * @param {*} applied setConfigOption 返回值
 * @returns {Array<Object>} 归一化 configOptions（可能为空）
 */
function configOptionsFromControl(applied) {
  if (!applied) return [];
  try {
    if (Array.isArray(applied)) return normalizeConfigOptions(applied);
    if (typeof applied === 'object') {
      if (applied.configOptions != null) return normalizeConfigOptions(applied);
      if (applied.details && applied.details.configOptions != null) return normalizeConfigOptions(applied);
    }
  } catch (e) {}
  return [];
}

/**
 * 预读取指定模型的 configOptions（不启动 turn / 不发 prompt）。
 *
 * 复用进程内 runtime 与同一 sessionKey 的持久会话：ensureSession → 切换模型 →
 * getStatus → normalizeConfigOptions。失败不改写 shared.activeExecution，
 * 也不会把上一轮 ask 的轮次状态挂到共享槽位上。
 *
 * 并发安全：同进程内的探测通过 previewChain 串行执行，避免 A 模型 setConfigOption
 * 与 B 模型 getStatus 交错，把 B 的 options 误当成 A 的结果。
 *
 * @param {Object} options 入参
 * @param {Object} options.def Agent 定义
 * @param {Object} options.aiCfg AI 配置
 * @param {string} options.cwd 工作目录（需与 ai:ask 的 cwd 一致才能复用会话）
 * @param {string} [options.uiSessionId] 前端会话 id
 * @param {string} options.model 目标模型 id（ACP 公告原样大小写）
 * @returns {Promise<{ok:boolean,model?:string,configOptions?:Array<Object>,modelConfigId?:string,
 *   error?:string,detail?:string,availableModels?:string[]}>} 探测结果
 */
function previewModelConfig(options) {
  const run = () => previewModelConfigImpl(options);
  const next = previewChain.then(run, run);
  /* 链本身永不 rejected，避免一次失败阻断后续探测；调用方拿到真实结果。 */
  previewChain = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * previewModelConfig 的实际执行体（由 previewChain 串行调度）。
 * @param {Object} options 同 previewModelConfig
 * @returns {Promise<Object>} 探测结果
 */
async function previewModelConfigImpl(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const def = opts.def;
  const aiCfg = opts.aiCfg;
  if (!isAcpEnabled(aiCfg, def)) return { ok: false, error: 'acp-disabled' };
  /* 有进行中的轮次时绝不改会话配置：追问 / 流式输出期间切模型会污染正在执行的 turn。 */
  if (activeAsk) return { ok: false, error: 'busy' };
  try {
    if (shared.activeExecution && shared.activeExecution.kind === 'acp') return { ok: false, error: 'busy' };
  } catch (e) {}

  const model = String(opts.model == null ? '' : opts.model).trim();
  const cwd = String(opts.cwd || paths.SANDBOX_ROOT || '');
  const uiSessionId = opts.uiSessionId != null ? String(opts.uiSessionId) : '';
  const sessionKey = sessionKeyFor(cwd, uiSessionId);
  const ctx = {
    def,
    cwd,
    uiSessionId,
    sessionKey,
    emit: null,
    logJsonRpc: false,
    acceptPermissions: false,
    settled: false,
    permissionIds: new Set()
  };
  if (!model) return { ok: false, error: 'ACP_MODEL_UNSUPPORTED', availableModels: [] };

  let handle = null;
  try {
    const state = await getRuntimeState(aiCfg);
    try {
      handle = await state.runtime.ensureSession({ sessionKey, agent: def.id, mode: 'persistent', cwd });
    } catch (e) {
      return {
        ok: false,
        error: String((normalizeAcpError(e) || {}).code || 'ACP_SESSION_INIT_FAILED'),
        detail: redactErrorDetail(e)
      };
    }
    if (!handle || typeof handle !== 'object') {
      return { ok: false, error: 'ACP_SESSION_INIT_FAILED', detail: 'ACP 会话初始化未返回有效句柄' };
    }
    rememberSessionHandle(sessionKey, handle);

    /* ensureSession 之后 / setConfigOption 之前再确认一次：等待 runtime 期间可能已有 ask 启动。 */
    if (activeAsk) return { ok: false, error: 'busy' };

    const status = await readSessionStatus(state.runtime, handle, ctx);
    const plan = planSessionConfig({ status });
    const options = Array.isArray(plan.configOptions) ? plan.configOptions : [];
    const modelOption = findModelConfigOption(options);
    const advertised = modelOption
      ? modelOption.options.map((item) => String(item.value)).filter(Boolean)
      : (Array.isArray(plan.availableModels) ? plan.availableModels.slice() : []);
    if (!modelOption || (advertised.length && advertised.indexOf(model) < 0)) {
      return { ok: false, error: 'ACP_MODEL_UNSUPPORTED', availableModels: advertised };
    }

    let applied = null;
    try {
      if (typeof state.runtime.setConfigOption === 'function') {
        applied = await state.runtime.setConfigOption({ handle, key: modelOption.id, value: model });
      } else if (typeof state.runtime.setModel === 'function') {
        await state.runtime.setModel({ handle, model });
      } else {
        return { ok: false, error: 'ACP_MODEL_UNSUPPORTED', availableModels: advertised };
      }
    } catch (e) {
      const normalized = normalizeAcpError(e);
      if (normalized && normalized.code === 'ACP_MODEL_UNSUPPORTED') {
        return {
          ok: false,
          error: 'ACP_MODEL_UNSUPPORTED',
          availableModels: Array.isArray(e && e.availableModels) ? e.availableModels.slice() : advertised,
          detail: redactErrorDetail(e)
        };
      }
      return {
        ok: false,
        error: String((normalized && normalized.code) || 'ACP_SET_MODEL_FAILED'),
        detail: redactErrorDetail(e)
      };
    }

    const status2 = await readSessionStatus(state.runtime, handle, ctx);
    let configOptions = normalizeConfigOptions(status2);
    if (!configOptions.length) configOptions = configOptionsFromControl(applied);
    if (!configOptions.length) {
      return { ok: false, error: 'ACP_PROBE_FAILED', detail: 'ACP 未返回该模型的 configOptions' };
    }
    const refreshedModel = currentModelOf(configOptions) || model;
    const modelConfigOption = configOptions.find((item) => item && item.category === 'model_config') || null;
    return {
      ok: true,
      model: refreshedModel,
      configOptions,
      modelConfigId: modelConfigOption ? String(modelConfigOption.id) : ''
    };
  } catch (e) {
    return {
      ok: false,
      error: String((normalizeAcpError(e) || {}).code || 'ACP_PROBE_FAILED'),
      detail: redactErrorDetail(e)
    };
  }
}

/**
 * 组装 turn 输入。
 * @param {Object} ctx 轮次上下文
 * @returns {Object} acpx startTurn 入参
 */
function buildTurnInput(ctx) {
  return {
    handle: ctx.handle,
    requestId: ctx.requestId,
    mode: 'prompt',
    text: ctx.prompt,
    onPermissionRequest: (request, context) => handlePermissionRequest(request, context)
  };
}

/**
 * 后台消费 turn.events / turn.result，映射为 ai:event。
 * @param {Object} ctx 轮次上下文
 * @returns {Promise<void>}
 */
async function runTurn(ctx) {
  let result = null;
  let sawError = false;

  try {
    try {
      await ctx.turn.promptStarted;
    } catch (e) {
      throw withFallbackCode('ACP_TURN_FAILED', e);
    }

    safeEmit(ctx, {
      type: 'run_started',
      pid: ctx.execution.pid || null,
      agentId: ctx.def.id,
      agentName: ctx.def.name || ctx.def.id,
      engine: 'cli',
      transport: 'acp',
      ...(ctx.uiSessionId ? { uiSessionId: ctx.uiSessionId } : {})
    });

    for await (const event of ctx.turn.events) {
      if (event && event.type === 'error') sawError = true;
      if (event && event.type === 'text_delta' && event.text) {
        const thought = event.stream === 'thought' || event.stream === 'thinking';
        if (!thought) ctx.answer += String(event.text);
      }
      let mapped = [];
      try { mapped = mapAcpEvents(event, ctx.uiSessionId); } catch (e) { mapped = []; }
      for (const payload of mapped) safeEmit(ctx, payload);
    }

    result = await ctx.turn.result;
  } catch (e) {
    result = { status: 'failed', error: e };
  }

  if (result && result.status === 'failed') {
    const payload = errorPayload(result.error || result, 'ACP_TURN_FAILED', ctx.uiSessionId, {
      agentId: ctx.def && ctx.def.id,
      command: agentCommandOf(ctx.def && ctx.def.id)
    });
    if (!sawError) safeEmit(ctx, payload);
    try {
      if (typeof ctx.handlers.onError === 'function') ctx.handlers.onError({ error: payload, result });
    } catch (e) {}
  } else {
    const cancelled = !!(result && result.status === 'cancelled');
    let fileChanges = [];
    try {
      if (typeof ctx.handlers.getFileChanges === 'function') {
        const r = ctx.handlers.getFileChanges();
        if (Array.isArray(r)) fileChanges = r;
      }
    } catch (e) { fileChanges = []; }
    const done = {
      type: 'done',
      cancelled,
      stopReason: result ? result.stopReason : undefined,
      fileChanges,
      permissionStats: permissionBridge.stats(),
      transport: 'acp'
    };
    if (ctx.uiSessionId) done.uiSessionId = ctx.uiSessionId;
    safeEmit(ctx, done);
    try {
      if (typeof ctx.handlers.onDone === 'function') {
        ctx.handlers.onDone({
          cancelled,
          stopReason: done.stopReason,
          fileChanges,
          answer: ctx.answer,
          result
        });
      }
    } catch (e) {}
  }

  finishAsk(ctx);
}

/**
 * 轮次收尾：清共享执行槽、权限等待者与事件路由。
 * @param {Object} ctx 轮次上下文
 * @returns {void}
 */
function finishAsk(ctx) {
  ctx.settled = true;
  try {
    if (shared.activeExecution === ctx.execution) shared.activeExecution = null;
  } catch (e) {}
  if (activeAsk === ctx) activeAsk = null;
  unregisterSessionContext(ctx);
  const waiters = ctx.settleWaiters.splice(0);
  for (const fn of waiters) { try { fn(); } catch (e) {} }
  try {
    for (const id of Array.from(ctx.permissionIds)) cancelPermissionRequest(ctx, id);
  } catch (e) {}
  try { ctx.permissionIds.clear(); } catch (e) {}
  /* 按 agentId + 会话 id 复合收尾：同一 uiSessionId 下切到其他 Agent 时，
   * 不得误杀仍在等待其他 Agent 的权限请求。 */
  const agentId = ctx.def && ctx.def.id ? String(ctx.def.id) : '';
  try { permissionBridge.cancelSession(ctx.acpSessionId, agentId); } catch (e) {}
  try { permissionBridge.cancelSession(ctx.uiSessionId, agentId); } catch (e) {}
}

/**
 * 等待轮次 settled（取消后的 2 秒兜底窗口）。
 * @param {Object} ctx 轮次上下文
 * @param {number} ms 等待毫秒
 * @param {{setTimeout:Function,clearTimeout:Function}} timers 定时器实现
 * @returns {Promise<boolean>} 是否在窗口内结束
 */
function waitSettled(ctx, ms, timers) {
  if (ctx.settled) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const timer = timers.setTimeout(() => {
      if (done) return;
      done = true;
      resolve(false);
    }, ms);
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (e) {}
    }
    ctx.settleWaiters.push(() => {
      if (done) return;
      done = true;
      try { timers.clearTimeout(timer); } catch (e) {}
      resolve(true);
    });
  });
}

/**
 * 发起一轮 ACP 执行（非阻塞：turn 在后台消费，事件经 emit 下发）。
 * 模型 / 思考强度在 ensureSession 之后经 getStatus + planSessionConfig 应用，
 * 不再写入 ensureSession.sessionOptions（对已有持久会话无效且会在 session/new 抛错）。
 * @param {Object} options 入参
 * @param {Object} options.def Agent 定义
 * @param {string} options.cwd 沙箱工作目录
 * @param {string} [options.uiSessionId] 前端会话 id
 * @param {string} options.prompt 已拼接前缀的完整 prompt
 * @param {string} [options.requestedModel] UI 明确选择的模型
 * @param {string} [options.modelSource] 'ui' | 'agent-config' | ''
 * @param {string} [options.agentConfigModel] cfg.acp.agents[id].model
 * @param {string|string[]} [options.requestedThought] 思考强度（extra.reasoning / thoughtLevel）
 * @param {Object<string,string|boolean>} [options.requestedConfig] 非模型/非思考配置项（extra.acpConfig）
 * @param {string} [options.globalModel] cfg.model / cfg.defaultModel，仅用于识别并忽略泄漏
 * @param {string} [options.model] 旧入参兼容（仅作为 requestedModel 候选）
 * @param {boolean} [options.freshSession] 是否先清空上下文再执行
 * @param {Object} [options.extra] 额外执行参数（保留）
 * @param {Object} options.aiCfg AI 配置
 * @param {Object} options.handlers {emit,getFileChanges,onDone,onError}
 * @param {string} [options.resumeSessionId] 恢复的 ACP 会话 id（只认此字段）
 * @param {number} [options.permissionTimeoutMs] 权限等待超时
 * @returns {Promise<{ok:boolean,success:boolean,pid?:number|null,error?:string}>} 启动结果
 */
async function ask(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const def = opts.def;
  const aiCfg = opts.aiCfg;
  if (!isAcpEnabled(aiCfg, def)) return { ok: false, success: false, error: 'acp-disabled' };
  if (activeAsk) return { ok: false, success: false, error: 'busy' };
  try {
    if (shared.activeExecution && shared.activeExecution.kind !== 'acp') {
      return { ok: false, success: false, error: 'busy' };
    }
  } catch (e) {}

  const handlers = opts.handlers && typeof opts.handlers === 'object' ? opts.handlers : {};
  const emit = typeof handlers.emit === 'function' ? handlers.emit
    : (typeof opts.emit === 'function' ? opts.emit : null);
  const cwd = String(opts.cwd || paths.SANDBOX_ROOT || '');
  const uiSessionId = opts.uiSessionId != null ? String(opts.uiSessionId) : '';
  const sessionKey = sessionKeyFor(cwd, uiSessionId);
  const requestId = (uiSessionId || 'default') + ':' + Date.now().toString(36) + ':' + crypto.randomUUID();
  const execution = { kind: 'acp', pid: null, cancel: () => cancel() };
  const nTimeout = Number(opts.permissionTimeoutMs);
  const requestedModel = String(
    opts.requestedModel == null ? (opts.model == null ? '' : opts.model) : opts.requestedModel
  ).trim();
  const explicitRequested = opts.requestedModel != null && String(opts.requestedModel).trim() !== '';
  const modelSource = opts.modelSource != null
    ? String(opts.modelSource).trim()
    : (explicitRequested ? 'ui' : '');
  const agentConfigModel = String(opts.agentConfigModel == null ? '' : opts.agentConfigModel).trim();
  const requestedThought = opts.requestedThought;
  const requestedConfig = normalizeRequestedConfig(opts.requestedConfig);
  const globalModel = String(opts.globalModel == null ? '' : opts.globalModel).trim();
  const ctx = {
    def,
    cwd,
    uiSessionId,
    sessionKey,
    requestId,
    prompt: String(opts.prompt == null ? '' : opts.prompt),
    emit,
    handlers,
    aiCfg,
    execution,
    answer: '',
    permissionTimeoutMs: Number.isFinite(nTimeout) && nTimeout >= 0 ? nTimeout : PERMISSION_TIMEOUT_MS,
    logJsonRpc: !!(aiCfg && aiCfg.acp && aiCfg.acp.logJsonRpc === true),
    acceptPermissions: true,
    cancelled: false,
    settled: false,
    settleWaiters: [],
    permissionIds: new Set(),
    turn: null,
    handle: null,
    runtime: null,
    acpSessionId: ''
  };

  activeAsk = ctx;
  try { shared.activeExecution = execution; } catch (e) {}

  let handle = null;
  try {
    const state = await getRuntimeState(aiCfg);
    ctx.runtime = state.runtime;
    const resumeSessionId = String(opts.resumeSessionId || '').trim();
    const makeEnsureInput = (key, resume) => {
      const input = { sessionKey: key, agent: def.id, mode: 'persistent', cwd };
      if (resume) input.resumeSessionId = resume;
      return input;
    };
    const requireHandle = (candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        const err = new Error('ACP 会话初始化未返回有效句柄');
        err.code = 'ACP_SESSION_INIT_FAILED';
        throw err;
      }
      return candidate;
    };

    try {
      handle = await state.runtime.ensureSession(makeEnsureInput(sessionKey, resumeSessionId));
    } catch (e) {
      if (!resumeSessionId) throw withFallbackCode('ACP_SESSION_INIT_FAILED', e);
      /* 恢复失败：先清理旧 handle；没有可清理的旧 handle 时换新 key，避免 acpx 复用旧 record */
      traceAcp(ctx, 'SESSION', 'ACP 会话恢复失败，已自动新建会话：' + errText(e));
      const previous = sessionHandles.get(sessionKey) || null;
      let reused = false;
      if (previous) {
        const rr = await resetSession(previous, { runtime: state.runtime, ctx });
        reused = !!rr.ok;
      }
      const retryKey = reused ? sessionKey : sessionKey + '-r' + Date.now().toString(36);
      try {
        handle = await state.runtime.ensureSession(makeEnsureInput(retryKey, ''));
      } catch (e2) {
        throw withFallbackCode('ACP_SESSION_INIT_FAILED', e2);
      }
    }
    handle = requireHandle(handle);

    if (opts.freshSession === true) {
      /* 用户点「新会话」：ensure 拿到 handle 后先 prepareFreshSession / close，再重新 ensure。 */
      const rr = await resetSession(handle, { runtime: state.runtime, ctx });
      const freshKey = rr.ok ? sessionKey : sessionKey + '-r' + Date.now().toString(36);
      if (!rr.ok) traceAcp(ctx, 'SESSION', '清空会话失败，改用新 sessionKey 重建：' + rr.method);
      try {
        handle = await state.runtime.ensureSession(makeEnsureInput(freshKey, ''));
      } catch (e) {
        throw withFallbackCode('ACP_SESSION_INIT_FAILED', e);
      }
      handle = requireHandle(handle);
    }

    if (ctx.cancelled) {
      finishAsk(ctx);
      return { ok: false, success: false, error: 'cancelled' };
    }
    ctx.handle = handle;
    rememberSessionHandle(sessionKey, handle);
    ctx.acpSessionId = String(
      handle.backendSessionId || handle.agentSessionId || handle.acpxRecordId || handle.sessionKey || ''
    );
    registerSessionContext(ctx);
    if (ctx.acpSessionId) {
      const sessionEvent = {
        type: 'session',
        id: ctx.acpSessionId,
        sessionId: ctx.acpSessionId,
        acpSessionId: ctx.acpSessionId,
        recordId: handle.acpxRecordId != null ? String(handle.acpxRecordId) : '',
        agentSessionId: handle.agentSessionId != null
          ? String(handle.agentSessionId)
          : (handle.backendSessionId != null ? String(handle.backendSessionId) : ''),
        agentId: def.id,
        agentName: String(def.name || def.id),
        workdir: cwd,
        transport: 'acp'
      };
      if (uiSessionId) sessionEvent.uiSessionId = uiSessionId;
      safeEmit(ctx, sessionEvent);
    }

    const status = await readSessionStatus(state.runtime, handle, ctx);
    const plan = planSessionConfig({
      status,
      requestedModel,
      modelSource,
      agentConfigModel,
      requestedThought,
      globalModel
    });
    if (plan.error === 'ACP_MODEL_UNSUPPORTED'
      && Array.isArray(plan.availableModels) && plan.availableModels.length) {
      safeEmit(ctx, buildAcpConfigEvent(plan, ctx, {
        error: plan.error,
        availableModels: plan.availableModels
      }));
      throw modelUnsupportedError(requestedModel, plan);
    }
    const extraWarnings = [];
    if (plan.error) extraWarnings.push('model-unverified');
    await applySessionConfig(state.runtime, handle, plan, ctx);
    /* 模型切换后 configOptions 才会变成新模型的公告。首轮 / freshSession / 直接切模型时，
     * 上面的 plan 用的是切换前的 options：思考强度会被旧档位判非法而丢弃，acp_config 也会
     * 带着旧模型的 options 让 UI 进入“待刷新”。这里补一次 getStatus，按新公告重算并补应用
     * 思考强度，同时让本轮 acp_config 直接携带新模型的完整档位。 */
    if (plan.model && !plan.error) {
      const thoughtDropped = plan.warnings.indexOf('thought-value-not-advertised') >= 0
        || plan.warnings.indexOf('thought-option-missing') >= 0;
      const beforeModel = currentModelOf(plan.configOptions);
      if (thoughtDropped && beforeModel && beforeModel !== plan.model) {
        const refreshed = await getSessionStatus(handle, { runtime: state.runtime });
        if (refreshed && refreshed.ok && refreshed.configOptions.length) {
          const nextPlan = planSessionConfig({
            configOptions: refreshed.configOptions,
            requestedModel,
            modelSource,
            agentConfigModel,
            requestedThought,
            globalModel
          });
          if (!nextPlan.error) {
            plan.configOptions = nextPlan.configOptions;
            plan.thoughtConfigId = nextPlan.thoughtConfigId;
            plan.thoughtValue = nextPlan.thoughtValue;
            /* 旧模型上的“档位缺失/不合法”结论已被新公告取代，不带到 UI。 */
            plan.warnings = plan.warnings.filter(
              (w) => w !== 'thought-value-not-advertised' && w !== 'thought-option-missing'
            );
            for (const w of nextPlan.warnings) {
              if (plan.warnings.indexOf(w) < 0) plan.warnings.push(w);
            }
            await applyThoughtConfig(state.runtime, handle, plan, ctx);
          }
        }
      }
    }
    /* 模型 / 思考强度应用完后，再应用前端下发的 model_config / mode 等配置项；
     * 单点失败只 trace，不阻断本轮；应用成功后尽量刷新 configOptions。 */
    const configResult = await applyRequestedConfig(state.runtime, handle, plan, requestedConfig, ctx);
    if (configResult.applied) await refreshConfigOptions(state.runtime, handle, plan, ctx);
    for (const w of configResult.warnings) {
      if (extraWarnings.indexOf(w) < 0) extraWarnings.push(w);
    }
    const hasSelections = Object.keys(requestedConfig).length > 0;
    safeEmit(ctx, buildAcpConfigEvent(plan, ctx, {
      warnings: extraWarnings,
      error: plan.error,
      selections: hasSelections ? requestedConfig : undefined,
      appliedConfig: hasSelections ? configResult.appliedConfig : undefined
    }));

    let turn = null;
    try {
      turn = state.runtime.startTurn(buildTurnInput(ctx));
    } catch (e) {
      throw withFallbackCode('ACP_TURN_FAILED', e);
    }
    if (!turn || typeof turn !== 'object') {
      const err = new Error('ACP 未返回有效 turn');
      err.code = 'ACP_TURN_FAILED';
      throw err;
    }
    ctx.turn = turn;
    void runTurn(ctx);
    return { ok: true, success: true, pid: execution.pid || null };
  } catch (e) {
    if (shared.activeExecution === execution) shared.activeExecution = null;
    if (activeAsk === ctx) activeAsk = null;
    unregisterSessionContext(ctx);
    ctx.settled = true;
    const waiters = ctx.settleWaiters.splice(0);
    for (const fn of waiters) { try { fn(); } catch (_) {} }
    const payload = errorPayload(e, 'ACP_SESSION_INIT_FAILED', uiSessionId, {
      agentId: def && def.id,
      command: agentCommandOf(def && def.id)
    });
    safeEmit(ctx, payload);
    try {
      if (typeof handlers.onError === 'function') handlers.onError({ error: payload, result: null });
    } catch (_) {}
    return { ok: false, success: false, error: payload.message };
  }
}

/**
 * 取消当前 ACP 轮次：turn.cancel → 2 秒兜底杀进程树 → 清理权限等待者。
 * @param {Object} [options] 可注入 graceMs / timers / killProcessTree（测试）
 * @returns {Promise<boolean>} 是否有进行中的 ACP 轮次
 */
async function cancel(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const timers = opts.timers && typeof opts.timers.setTimeout === 'function'
    ? opts.timers
    : { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const kill = typeof opts.killProcessTree === 'function' ? opts.killProcessTree : acpProcessLifecycle.killPidTree;
  const ctx = activeAsk;
  const execution = (shared.activeExecution && shared.activeExecution.kind === 'acp')
    ? shared.activeExecution
    : (ctx && ctx.execution) || null;

  if (ctx) {
    ctx.acceptPermissions = false;
    ctx.cancelled = true;
    if (ctx.turn && typeof ctx.turn.cancel === 'function') {
      try { await ctx.turn.cancel({ reason: 'user' }); } catch (e) {}
    }
    const nGrace = Number(opts.graceMs);
    const grace = Number.isFinite(nGrace) ? Math.max(0, nGrace) : CANCEL_KILL_GRACE_MS;
    let settled = ctx.settled;
    if (!settled) settled = await waitSettled(ctx, grace, timers);
    if (!settled) {
      const pid = (execution && execution.pid) || ctx.execution.pid || null;
      if (pid) {
        try { await kill(pid); } catch (e) {}
        try { if (ctx.execution) ctx.execution.pid = null; } catch (e) {}
      }
    }
    try {
      for (const id of Array.from(ctx.permissionIds)) cancelPermissionRequest(ctx, id);
    } catch (e) {}
    try { ctx.permissionIds.clear(); } catch (e) {}
    const agentId = ctx.def && ctx.def.id ? String(ctx.def.id) : '';
    try { permissionBridge.cancelSession(ctx.acpSessionId, agentId); } catch (e) {}
    try { permissionBridge.cancelSession(ctx.uiSessionId, agentId); } catch (e) {}
  } else if (execution && execution.pid) {
    try { await kill(execution.pid); } catch (e) {}
  }

  try {
    if (shared.activeExecution && shared.activeExecution.kind === 'acp') shared.activeExecution = null;
  } catch (e) {}
  if (activeAsk === ctx) activeAsk = null;
  return !!ctx;
}

/**
 * 依赖注入（测试 / 宿主）：acpx 模块、defs 与路径解析器。
 * @param {Object} options {acpxModule,defs,resolveBin,resolveAdapter,resolveCommand}
 * @returns {void}
 */
function configure(options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (Object.prototype.hasOwnProperty.call(opts, 'acpxModule')) {
    acpxModule = opts.acpxModule || null;
    modulePromise = null;
    runtimeState = null;
    runtimeCreating = null;
  }
  if (opts.defs !== undefined) injected.defs = Array.isArray(opts.defs) ? opts.defs : null;
  if (typeof opts.resolveBin === 'function') injected.resolveBin = opts.resolveBin;
  if (typeof opts.resolveAdapter === 'function') injected.resolveAdapter = opts.resolveAdapter;
  if (typeof opts.resolveCommand === 'function') injected.resolveCommand = opts.resolveCommand;
}

/**
 * 等待 Promise 至多 ms 毫秒（超时后继续退出流程，不把异常抛给调用方）。
 * @param {Promise<*>|*} value 待等待对象
 * @param {number} ms 超时毫秒
 * @returns {Promise<void>}
 */
function waitWithTimeout(value, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(1, ms));
    if (timer && typeof timer.unref === 'function') {
      try { timer.unref(); } catch (e) {}
    }
    Promise.resolve(value).then(finish, finish);
  });
}

/**
 * 关闭 runtime 单例；异常吞掉，保证退出流程不中断。
 * 顺序：取消当前轮次 -> runtime.shutdown（限时）-> 强杀仍登记的 ACP 进程树。
 * @param {{reason?:string,timeoutMs?:number,timers?:Object,killProcessTree?:Function}} [options] 收尾选项
 * @returns {Promise<void>}
 */
async function shutdown(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(1, Number(opts.timeoutMs)) : 3000;
  const state = runtimeState;
  runtimeState = null;
  runtimeCreating = null;
  sessionHandles.clear();
  /* 先取消当前轮次：turn.cancel 正常结束则无需强杀；不结束则由 cancel 的兜底逻辑收树。
   * cancel 自身也可能被 agent 拖住，加限时避免退出流程悬挂。 */
  try {
    await waitWithTimeout(cancel({ graceMs: 0, timers: opts.timers, killProcessTree: opts.killProcessTree }), Math.min(1000, timeoutMs));
  } catch (e) {}
  if (state && state.runtime && typeof state.runtime.shutdown === 'function') {
    try { await waitWithTimeout(state.runtime.shutdown(), timeoutMs); } catch (e) {}
  }
  try {
    await acpProcessLifecycle.shutdownAll({ kind: 'acp', reason: String(opts.reason || 'acp-shutdown'), timeoutMs });
  } catch (e) {}
}

/**
 * 同步收尾（window-all-closed / process exit 兜底）：直接强杀已登记的 ACP 进程树。
 * 不等待 acpx 的异步 shutdown，避免退出流程被悬挂会话拖住。
 * @returns {void}
 */
function shutdownSync() {
  runtimeState = null;
  runtimeCreating = null;
  sessionHandles.clear();
  try { activeAsk = null; } catch (e) {}
  try {
    if (shared.activeExecution && shared.activeExecution.kind === 'acp') shared.activeExecution = null;
  } catch (e) {}
  try { acpProcessLifecycle.killAllSync({ kind: 'acp' }); } catch (e) {}
}

/**
 * 获取权限桥（诊断 / 测试）。
 * @returns {AcpPermissionBridge} 单例权限桥
 */
function getPermissionBridge() {
  return permissionBridge;
}

/**
 * 测试用重置：清空模块注入、runtime 单例、轮次与权限等待。
 * @returns {void}
 */
function _resetForTest() {
  try {
    if (activeAsk) {
      const waiters = activeAsk.settleWaiters.splice(0);
      for (const fn of waiters) { try { fn(); } catch (e) {} }
    }
  } catch (e) {}
  activeAsk = null;
  sessionContexts.clear();
  sessionHandles.clear();
  previewChain = Promise.resolve();
  runtimeState = null;
  runtimeCreating = null;
  modulePromise = null;
  acpxModule = null;
  injected = { defs: null, resolveBin: null, resolveAdapter: null, resolveCommand: null };
  permissionBridge = new AcpPermissionBridge({ defaultTimeoutMs: PERMISSION_TIMEOUT_MS });
  try {
    if (shared.activeExecution && shared.activeExecution.kind === 'acp') shared.activeExecution = null;
  } catch (e) {}
  try { acpProcessLifecycle.clearForTest('acp'); } catch (e) {}
}

module.exports = {
  isAcpEnabled,
  sessionKeyFor,
  ask,
  cancel,
  resetSession,
  getSessionStatus,
  previewModelConfig,
  resolvePermission,
  getPermissionBridge,
  configure,
  shutdown,
  shutdownSync,
  _resetForTest,
  ACP_TIMEOUT_MS,
  CANCEL_KILL_GRACE_MS,
  PERMISSION_TIMEOUT_MS
};
