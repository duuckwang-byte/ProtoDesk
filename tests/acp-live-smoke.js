#!/usr/bin/env node
'use strict';
/**
 * tests/acp-live-smoke.js — T4 真实 Agent live smoke（纯 Node，不依赖 Electron / UI）
 *
 * 直接调用 main/acp/acp-runtime.ask，验证本机 qoder / opencode / antigravity(agy)
 * 三个 Agent 的 ACP 连通性；不经过 ai-process-service，也不改动业务代码。
 *
 * 用法：
 *   node tests/acp-live-smoke.js --agent <qoder|opencode|antigravity> [--model <id>]
 *        [--thought <level>] [--prompt "<text>"] [--timeout <秒>] [--json]
 *   node tests/acp-live-smoke.js --agent <id> --list-models [--json]
 *   node tests/acp-live-smoke.js --help
 *
 * 退出码：0 通过，1 失败（live 失败不降级为 skip），2 参数错误。
 *
 * 说明：
 * - 命令解析走 runtimes/registry.getAgentDef + main/acp/acp-registry.resolveAgentCommand，
 *   cliPaths 只读自 .devdata/ai-config.json；
 * - 会话存储重定向到临时目录（不改 .devdata 配置，也不复用历史会话）；
 * - 权限请求在本 harness 内一律 deny（只读场景不应触发），避免无 UI 时挂起到超时。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
/* main/paths.js 用 process.cwd() 推导 SANDBOX_ROOT；固定到仓库根，
 * 避免从任意目录执行时 acpx runtime 的默认 cwd 落到不存在的位置。 */
try { process.chdir(REPO_ROOT); } catch (_) {}

const DEV_DATA_DIR = path.join(REPO_ROOT, '.devdata');
const AI_CONFIG_PATH = path.join(DEV_DATA_DIR, 'ai-config.json');
const PREFERRED_CWD = path.join(DEV_DATA_DIR, 'sandbox', '测试1', '首页');

const { getAgentDef } = require('../runtimes/registry');
const { resolveAgentExecutable } = require('../runtimes/resolution');
const { resolveAgentCommand } = require('../main/acp/acp-registry');
const acpRuntime = require('../main/acp/acp-runtime');

const DEFAULT_PROMPT = '只回复 OK，不要读取或修改任何文件';
const DEFAULT_TIMEOUT_SEC = 120;
const FORCE_DENY_PERMISSION = true;

const AGENT_ALIASES = {
  agy: 'antigravity',
  antigravity: 'antigravity',
  opencode: 'opencode',
  qoder: 'qoder'
};

/** live 必须出现的事件类型（顺序另判 session < run_started） */
const REQUIRED_EVENTS = ['session', 'run_started', 'chunk', 'done'];

/** 致命错误码：出现即失败 */
const FATAL_ERROR_CODES = [
  'ACP_SESSION_INIT_FAILED',
  'ACP_MODEL_UNSUPPORTED',
  'ACP_BACKEND_MISSING',
  'ACP_TURN_FAILED'
];

/** --list-models 期望（按 Agent 区分；未列出的 Agent 只要求非空） */
const MODEL_EXPECTATIONS = {
  antigravity: {
    count: 5,
    includes: ['gemini-3.8-flash'],
    excludes: ['gemini-3.8-flash-high'],
    note: '5 个 base id，不含 -high 变体'
  },
  opencode: {
    includes: ['opencode-go/deepseek-v4.1-flash'],
    excludes: [],
    note: '含 opencode-go/deepseek-v4.1-flash，且不只是 deepseek-chat'
  },
  qoder: {
    includes: ['auto'],
    excludes: [],
    note: '含 auto'
  }
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/**
 * 单行化并截断文本（打印用）。
 * @param {*} value 任意值
 * @param {number} [max] 最大长度
 * @returns {string} 单行文本
 */
function oneLine(value, max) {
  const limit = Number.isFinite(max) && max > 0 ? max : 300;
  let text = value == null ? '' : String(value);
  if (value instanceof Error) text = value.message || String(value);
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/**
 * 单参数引用（含空格时加双引号）。
 * @param {string} arg 参数
 * @returns {string} 展示文本
 */
function quoteArg(arg) {
  const text = arg == null ? '' : String(arg);
  return /[\s"]/.test(text) ? '"' + text.replace(/"/g, '\\"') + '"' : text;
}

/**
 * argv → 单行命令文本。
 * @param {string[]} argv 命令
 * @returns {string} 展示文本
 */
function formatArgv(argv) {
  return Array.isArray(argv) ? argv.map(quoteArg).join(' ') : '';
}

/**
 * 长 id 列表摘要（人读输出用，完整列表见 --json）。
 * @param {string[]} ids id 列表
 * @param {number} [max] 最多展示个数
 * @returns {string} 摘要文本
 */
function summarizeIds(ids, max) {
  const list = Array.isArray(ids) ? ids : [];
  const limit = Number.isFinite(max) && max > 0 ? max : 12;
  if (list.length <= limit) return list.join(',');
  return list.slice(0, limit).join(',') + ',…(+' + (list.length - limit) + ' more)';
}

/**
 * 延迟。
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => { globalThis.setTimeout(resolve, Math.max(0, ms)); });
}

/**
 * 给 Promise 加超时（超时后不再等待，原 Promise 继续后台执行）。
 * @param {Promise<*>} promise 原 Promise
 * @param {number} ms 超时毫秒
 * @returns {Promise<*>} 原结果或 null
 */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = globalThis.setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, Math.max(0, ms));
    Promise.resolve(promise).then(
      (value) => { if (!done) { done = true; globalThis.clearTimeout(timer); resolve(value); } },
      () => { if (!done) { done = true; globalThis.clearTimeout(timer); resolve(null); } }
    );
  });
}

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

/**
 * 解析命令行参数（支持 `--k v` 与 `--k=v`）。
 * @param {string[]} argv process.argv.slice(2)
 * @returns {Object} 参数对象（errors 收集缺失值）
 */
function parseArgs(argv) {
  const opts = {
    agent: '',
    model: '',
    thought: '',
    prompt: DEFAULT_PROMPT,
    listModels: false,
    json: false,
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    help: false,
    errors: []
  };
  const list = Array.isArray(argv) ? argv : [];

  for (let i = 0; i < list.length; i += 1) {
    const raw = String(list[i] == null ? '' : list[i]);
    if (!raw) continue;
    let key = raw;
    let inline = null;
    const eq = raw.indexOf('=');
    if (raw.startsWith('--') && eq > 2) {
      key = raw.slice(0, eq);
      inline = raw.slice(eq + 1);
    }
    const takeValue = () => {
      if (inline != null) return inline;
      const next = list[i + 1];
      if (next == null || String(next).startsWith('--')) return null;
      i += 1;
      return String(next);
    };

    switch (key) {
      case '--agent': {
        const v = takeValue();
        if (v == null) opts.errors.push('--agent 缺少值');
        else opts.agent = v.trim();
        break;
      }
      case '--model': {
        const v = takeValue();
        if (v == null) opts.errors.push('--model 缺少值');
        else opts.model = v.trim();
        break;
      }
      case '--thought': {
        const v = takeValue();
        if (v == null) opts.errors.push('--thought 缺少值');
        else opts.thought = v.trim();
        break;
      }
      case '--prompt': {
        const v = takeValue();
        if (v == null) opts.errors.push('--prompt 缺少值');
        else opts.prompt = v;
        break;
      }
      case '--timeout': {
        const v = takeValue();
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) opts.errors.push('--timeout 需要正数秒');
        else opts.timeoutSec = n;
        break;
      }
      case '--list-models':
        opts.listModels = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        opts.errors.push('未知参数: ' + raw);
        break;
    }
  }
  return opts;
}

/**
 * 打印用法。
 * @returns {void}
 */
function printUsage() {
  console.log([
    '用法:',
    '  node tests/acp-live-smoke.js --agent <qoder|opencode|antigravity|agy> [选项]',
    '',
    '选项:',
    '  --agent <id>       必填；agy 为 antigravity 的别名',
    '  --model <id>       可选；作为 requestedModel（modelSource=ui）下发',
    '  --thought <level>  可选；作为 requestedThought 下发（如 high）',
    '  --prompt "<text>"  默认 "' + DEFAULT_PROMPT + '"',
    '  --list-models      只探测模型目录，不发 prompt',
    '  --timeout <秒>     默认 ' + DEFAULT_TIMEOUT_SEC,
    '  --json             输出机器可读 JSON',
    '  --help             显示本帮助',
    '',
    '示例:',
    '  node tests/acp-live-smoke.js --agent opencode --model opencode-go/deepseek-v4.1-flash',
    '  node tests/acp-live-smoke.js --agent antigravity --model gemini-3.8-flash --thought high',
    '  node tests/acp-live-smoke.js --agent qoder --model auto',
    '  node tests/acp-live-smoke.js --agent antigravity --list-models'
  ].join('\n'));
}

/* ------------------------------------------------------------------ */
/* 配置 / 命令解析                                                     */
/* ------------------------------------------------------------------ */

/**
 * 只读加载 .devdata/ai-config.json。
 * @returns {{value:Object|null,error:string}} 配置与读取错误
 */
function readAiConfig() {
  try {
    if (!fs.existsSync(AI_CONFIG_PATH)) return { value: null, error: 'not-found' };
    const raw = fs.readFileSync(AI_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: 'invalid-shape' };
    }
    return { value: parsed, error: '' };
  } catch (e) {
    return { value: null, error: oneLine(e && e.message ? e.message : e, 200) };
  }
}

/**
 * 汇总用户自定义 CLI 路径（与 acp-runtime.collectCustomPaths 同源逻辑）。
 * @param {Object|null} fileCfg ai-config.json 内容
 * @returns {Object<string,string>} id → 自定义路径
 */
function collectCustomPaths(fileCfg) {
  const out = {};
  const cfg = fileCfg && typeof fileCfg === 'object' ? fileCfg : {};
  if (cfg.cliPaths && typeof cfg.cliPaths === 'object') {
    for (const id of Object.keys(cfg.cliPaths)) {
      const v = cfg.cliPaths[id] == null ? '' : String(cfg.cliPaths[id]).trim();
      if (v) out[String(id)] = v;
    }
  }
  const legacy = cfg.cliPath == null ? '' : String(cfg.cliPath).trim();
  if (legacy && !out.opencode) out.opencode = legacy;
  return out;
}

/**
 * 构造测试用 AI 配置（不改动磁盘配置；acp 显式开启）。
 * @param {Object|null} fileCfg ai-config.json 内容
 * @returns {Object} aiCfg
 */
function buildAiCfg(fileCfg) {
  return {
    cliPaths: collectCustomPaths(fileCfg),
    model: 'deepseek-chat',
    defaultModel: 'deepseek-chat',
    acp: {
      enabled: true,
      defaultPermissionMode: 'approve-reads'
    }
  };
}

/**
 * 仓库 node_modules/.bin 内查找可执行文件（Windows 优先 .cmd/.exe/.bat）。
 * @param {string} name 命令名
 * @returns {string|null} 绝对路径或 null
 */
function resolveLocalBin(name) {
  const base = String(name || '').trim();
  if (!base) return null;
  const dir = path.join(REPO_ROOT, 'node_modules', '.bin');
  const isWin = process.platform === 'win32';
  const suffixes = isWin ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const suffix of suffixes) {
    const full = path.join(dir, base + suffix);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch (_) {}
  }
  return null;
}

/**
 * 默认 adapter / command 解析（与 acp-runtime.resolveAdapterDefault 同源逻辑）。
 * @param {string} name 名称
 * @returns {Promise<string|null>} 路径
 */
async function resolveAdapterDefault(name) {
  const local = resolveLocalBin(name);
  if (local) return local;
  try {
    return await resolveAgentExecutable({ bin: String(name || ''), fallbackBins: [] }, '');
  } catch (_) {
    return null;
  }
}

/**
 * 解析 Agent 的 ACP 启动命令（T1 契约）。
 * @param {Object} def Agent 定义
 * @param {Object} aiCfg 测试配置（读取 cliPaths）
 * @returns {Promise<{command:string[]|null, unresolved:Object|null, customPaths:Object}>} 解析结果
 */
async function resolveCommandFor(def, aiCfg) {
  const customPaths = aiCfg && aiCfg.cliPaths && typeof aiCfg.cliPaths === 'object'
    ? aiCfg.cliPaths
    : {};
  const resolveBin = (d) => resolveAgentExecutable(d, customPaths[d && d.id] || '');
  const resolveAdapter = (name) => resolveAdapterDefault(name);
  const result = await resolveAgentCommand(def, {
    customPaths,
    resolveBin,
    resolveAdapter,
    resolveCommand: resolveAdapter
  });
  return {
    command: result && Array.isArray(result.command) ? result.command : null,
    unresolved: result ? result.unresolved : null,
    customPaths
  };
}

/**
 * 选择工作目录：优先已存在的沙箱目录，否则创建临时目录。
 * @returns {{cwd:string,tempDirs:string[]}} cwd 与需清理的目录
 */
function pickCwd() {
  try {
    if (fs.existsSync(PREFERRED_CWD) && fs.statSync(PREFERRED_CWD).isDirectory()) {
      return { cwd: PREFERRED_CWD, tempDirs: [] };
    }
  } catch (_) {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-acp-live-cwd-'));
  return { cwd: dir, tempDirs: [dir] };
}

/* ------------------------------------------------------------------ */
/* 事件打印 / 断言                                                     */
/* ------------------------------------------------------------------ */

/**
 * 逐条打印事件（--json 时不打印）。
 * @param {Object} payload ai:event
 * @returns {void}
 */
function printEvent(payload) {
  const type = String(payload.type || '');
  let extra = '';
  switch (type) {
    case 'session':
      extra = 'id=' + oneLine(payload.id || payload.sessionId, 120);
      break;
    case 'run_started':
      extra = 'agent=' + oneLine(payload.agentId, 40) + ' pid=' + String(payload.pid == null ? '-' : payload.pid);
      break;
    case 'chunk':
      extra = '+' + String(payload.text == null ? '' : String(payload.text).length) + ' "' + oneLine(payload.text, 60) + '"';
      break;
    case 'thinking':
      extra = '+' + String(payload.text == null ? '' : String(payload.text).length);
      break;
    case 'acp_config':
      extra = 'model=' + oneLine(payload.model, 80)
        + ' thoughtConfig=' + oneLine(payload.thoughtConfigId, 40)
        + ' thoughtValue=' + oneLine(payload.thoughtValue, 20)
        + ' warnings=' + (Array.isArray(payload.warnings) && payload.warnings.length ? payload.warnings.join('|') : '-');
      break;
    case 'done':
      extra = 'cancelled=' + String(payload.cancelled) + ' stopReason=' + oneLine(payload.stopReason, 40);
      break;
    case 'error':
      extra = 'code=' + oneLine(payload.code, 40) + ' detail="' + oneLine(payload.detail || payload.message, 240) + '"';
      break;
    case 'permission_request':
      extra = 'id=' + oneLine(payload.id, 60) + ' title=' + oneLine(payload.title, 80);
      break;
    case 'tool_call':
      extra = 'tool=' + oneLine(payload.tool, 60) + ' status=' + oneLine(payload.status, 20);
      break;
    case 'trace':
      extra = oneLine(payload.trace && payload.trace.text, 200);
      break;
    default:
      break;
  }
  console.log('  [evt] ' + type + (extra ? ' ' + extra : ''));
}

/**
 * 把错误码映射到失败阶段。
 * @param {string} code 错误码
 * @param {Object} run 运行结果
 * @returns {'resolve-command'|'session'|'config'|'prompt'} 阶段
 */
function stageForCode(code, run) {
  if (code === 'ACP_BACKEND_MISSING') return 'resolve-command';
  if (code === 'ACP_MODEL_UNSUPPORTED') return 'config';
  if (code === 'ACP_SESSION_INIT_FAILED') {
    return run && run.types && run.types.indexOf('session') >= 0 ? 'prompt' : 'session';
  }
  return 'prompt';
}

/**
 * 评估 live 结果。
 * @param {Object} params 运行参数（model/thought/timeoutMs/prompt）
 * @param {Object} run runLive 结果
 * @param {string[]} commandArgv 解析出的命令
 * @returns {{ok:boolean, failures:Array<Object>, answer:string}} 评估结果
 */
function evaluateLive(params, run, commandArgv) {
  const failures = [];
  const addFailure = (code, stage, detail) => {
    failures.push({ code: String(code || 'ACP_UNKNOWN'), stage: String(stage || 'prompt'), detail: oneLine(detail, 600) });
  };

  const cmdText = formatArgv(commandArgv);
  if (/agy_acp_server/i.test(cmdText)) {
    addFailure('ACP_BACKEND_MISSING', 'resolve-command', '命令仍指向已废弃的 agy_acp_server');
  }

  if (run.errorPayload) {
    const code = String(run.errorPayload.code || 'ACP_UNKNOWN');
    addFailure(
      FATAL_ERROR_CODES.indexOf(code) >= 0 ? code : 'ACP_ERROR',
      stageForCode(code, run),
      run.errorPayload.detail || run.errorPayload.message || ''
    );
  }

  if (run.timedOut) {
    addFailure('TIMEOUT', 'prompt', params.timeoutMs + 'ms 内未收到 done');
  }

  const types = Array.isArray(run.types) ? run.types : [];
  for (const required of REQUIRED_EVENTS) {
    if (types.indexOf(required) < 0) {
      addFailure('ACP_EVENT_MISSING', required === 'session' ? 'session' : 'prompt',
        '缺少事件 ' + required + '（实际: ' + (types.join(',') || '(none)') + '）');
    }
  }

  const idxSession = types.indexOf('session');
  const idxStarted = types.indexOf('run_started');
  if (idxSession >= 0 && idxStarted >= 0 && idxSession > idxStarted) {
    addFailure('ACP_EVENT_ORDER', 'session', 'session 事件晚于 run_started');
  }

  if (run.donePayload && run.donePayload.cancelled !== false) {
    addFailure('ACP_CANCELLED', 'prompt', 'done.cancelled=' + String(run.donePayload.cancelled));
  }

  const answer = String(run.answer == null ? '' : run.answer);
  if (answer.indexOf('OK') < 0) {
    addFailure('ACP_ANSWER_MISMATCH', 'prompt', 'answer=' + JSON.stringify(oneLine(answer, 200)));
  }

  const usedModel = run.configEvent && run.configEvent.model ? String(run.configEvent.model) : '';
  if (usedModel === 'deepseek-chat') {
    addFailure('ACP_MODEL_LEAK', 'config', 'acp_config.model=deepseek-chat（全局 legacy 模型泄漏）');
  } else if (usedModel && params.model && usedModel !== params.model) {
    addFailure('ACP_MODEL_MISMATCH', 'config', 'acp_config.model=' + usedModel + ' != requested=' + params.model);
  }

  return { ok: failures.length === 0, failures, answer };
}

/* ------------------------------------------------------------------ */
/* 运行器                                                              */
/* ------------------------------------------------------------------ */

/**
 * 会话存储重定向到临时目录（不改 .devdata；每次全新会话）。
 * @param {string} tempRoot 临时根目录
 * @returns {Promise<void>}
 */
async function prepareRuntime(tempRoot) {
  const mod = await import('acpx/runtime');
  const stateDir = path.join(tempRoot, 'acp-sessions');
  fs.mkdirSync(stateDir, { recursive: true });
  /* configure 是 acp-runtime 自带的测试 / 宿主注入口：只替换 sessionStore 落盘位置，
   * createAcpRuntime / createAgentRegistry 仍为真实 acpx 实现。 */
  const wrapped = Object.assign({}, mod, {
    createFileSessionStore: (options) => mod.createFileSessionStore(
      Object.assign({}, options || {}, { stateDir })
    )
  });
  acpRuntime.configure({ acpxModule: wrapped });
}

/**
 * 处理权限请求：无 UI 场景一律 deny，避免挂到超时。
 * @param {Object} payload permission_request 事件
 * @param {boolean} quiet 是否 --json
 * @returns {void}
 */
function autoDenyPermission(payload, quiet) {
  if (!FORCE_DENY_PERMISSION) return;
  const id = String(payload && payload.id ? payload.id : '');
  if (!id) return;
  let hit = false;
  try { hit = acpRuntime.resolvePermission(id, 'deny'); } catch (_) { hit = false; }
  if (!quiet) console.log('  [evt] permission_request → auto-deny ' + (hit ? 'ok' : 'miss') + ' id=' + oneLine(id, 60));
}

/**
 * 发起一轮真实 ACP 执行并收集事件。
 * @param {Object} params def/aiCfg/cwd/model/thought/prompt/timeoutMs/quiet
 * @returns {Promise<Object>} 运行结果
 */
async function runLive(params) {
  const startedAt = Date.now();
  const events = [];
  const types = [];
  let answerChunks = '';
  let donePayload = null;
  let doneInfo = null;
  let errorPayload = null;
  let configEvent = null;
  let timedOut = false;
  let settled = false;
  let resolveFinished = null;
  let timer = null;

  const finished = new Promise((resolve) => { resolveFinished = resolve; });

  const finish = (reason) => {
    if (settled) return;
    settled = true;
    if (timer) { globalThis.clearTimeout(timer); timer = null; }
    resolveFinished(reason);
  };

  const emit = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const type = String(payload.type || '');
    if (!type) return;
    events.push(payload);
    if (types.indexOf(type) < 0) types.push(type);
    if (type === 'chunk') answerChunks += String(payload.text == null ? '' : payload.text);
    if (!params.quiet) printEvent(payload);
    if (type === 'permission_request') { autoDenyPermission(payload, params.quiet); return; }
    if (type === 'acp_config') { configEvent = payload; return; }
    if (type === 'done') { donePayload = payload; finish('done'); return; }
    if (type === 'error') { errorPayload = payload; finish('error'); }
  };

  timer = globalThis.setTimeout(() => {
    if (settled) return;
    timedOut = true;
    if (!params.quiet) console.log('[INFO] 超时 ' + params.timeoutMs + 'ms，正在取消 ACP 轮次…');
    finish('timeout');
  }, params.timeoutMs);

  let askResult = null;
  let askThrew = null;
  try {
    askResult = await acpRuntime.ask({
      def: params.def,
      cwd: params.cwd,
      uiSessionId: 'live-smoke-' + params.def.id,
      prompt: params.prompt,
      requestedModel: params.model || '',
      modelSource: params.model ? 'ui' : '',
      requestedThought: params.thought || '',
      globalModel: 'deepseek-chat',
      aiCfg: params.aiCfg,
      handlers: {
        emit,
        onDone: (info) => { doneInfo = info || null; },
        onError: (info) => {
          if (info && info.error && !errorPayload) errorPayload = info.error;
        },
        getFileChanges: () => []
      }
    });
  } catch (e) {
    askThrew = e;
  }

  if (!settled && askThrew) {
    errorPayload = {
      type: 'error',
      code: 'ACP_TURN_FAILED',
      detail: oneLine(askThrew && askThrew.message ? askThrew.message : askThrew, 600),
      message: oneLine(askThrew && askThrew.message ? askThrew.message : askThrew, 600)
    };
    finish('ask-threw');
  }
  if (!settled && askResult && askResult.ok === false) {
    const reason = String(askResult.error || 'ask-failed');
    errorPayload = {
      type: 'error',
      code: reason === 'acp-disabled' ? 'ACP_DISABLED' : (reason === 'busy' ? 'ACP_BUSY' : 'ACP_ASK_REJECTED'),
      detail: reason,
      message: reason
    };
    finish('ask-failed');
  }

  const reason = await finished;

  /* 给 done / error 之后的清理留一点时间，避免漏掉尾部事件与 onDone 回填。 */
  await delay(120);

  if (timedOut) {
    await withTimeout(acpRuntime.cancel(), 5000);
  }

  return {
    reason,
    events,
    types,
    answer: doneInfo && doneInfo.answer != null ? String(doneInfo.answer) : answerChunks,
    answerChunks,
    donePayload,
    doneInfo,
    errorPayload,
    configEvent,
    timedOut,
    askResult,
    durationMs: Date.now() - startedAt
  };
}

/**
 * --list-models：直接调用 acpx/runtime.inspectAgentModels，不发 prompt。
 * @param {Object} params def/commandArgv/cwd/agentId/timeoutMs/quiet
 * @returns {Promise<Object>} 结果
 */
async function runListModels(params) {
  const startedAt = Date.now();
  const mod = await import('acpx/runtime');
  let inspection = null;
  let error = null;
  try {
    inspection = await mod.inspectAgentModels({
      agentCommand: params.commandArgv,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs
    });
  } catch (e) {
    error = e;
  }

  const src = inspection && typeof inspection === 'object' ? inspection : {};
  const ids = [];
  const seen = new Set();
  const push = (raw) => {
    let id = '';
    if (typeof raw === 'string' || typeof raw === 'number') id = String(raw).trim();
    else if (raw && typeof raw === 'object') id = String(raw.modelId || raw.id || raw.value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (Array.isArray(src.availableModelIds)) for (const raw of src.availableModelIds) push(raw);
  if (Array.isArray(src.availableModels)) for (const raw of src.availableModels) push(raw);

  const entries = Array.isArray(src.availableModels) ? src.availableModels.slice() : [];
  const expected = MODEL_EXPECTATIONS[params.agentId] || {};
  const expectations = [];
  if (expected.count != null) {
    expectations.push({
      name: 'count=' + expected.count,
      ok: ids.length === expected.count,
      detail: '实际 ' + ids.length + ' 个'
    });
  }
  for (const id of expected.includes || []) {
    expectations.push({ name: 'contains ' + id, ok: ids.indexOf(id) >= 0, detail: '' });
  }
  for (const id of expected.excludes || []) {
    expectations.push({ name: 'excludes ' + id, ok: ids.indexOf(id) < 0, detail: '' });
  }
  if (ids.length === 0) {
    expectations.push({ name: 'non-empty', ok: false, detail: '模型列表为空' });
  }

  const failures = [];
  if (error) {
    failures.push({
      code: 'ACP_MODEL_CATALOG',
      stage: 'models',
      detail: oneLine(error && error.message ? error.message : error, 600)
    });
  } else if (!inspection) {
    failures.push({ code: 'ACP_MODEL_CATALOG', stage: 'models', detail: 'inspectAgentModels 返回空结果' });
  }
  for (const item of expectations) {
    if (!item.ok) {
      failures.push({
        code: 'ACP_MODEL_CATALOG',
        stage: 'models',
        detail: item.name + (item.detail ? '（' + item.detail + '）' : '')
      });
    }
  }

  return {
    ids,
    entries,
    currentModelId: src.currentModelId ? String(src.currentModelId) : '',
    expectations,
    failures,
    ok: failures.length === 0,
    error,
    durationMs: Date.now() - startedAt
  };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

/**
 * 主流程。
 * @returns {Promise<number>} 退出码
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printUsage(); return 0; }
  if (opts.errors.length) {
    for (const msg of opts.errors) console.error('[ERR] ' + msg);
    printUsage();
    return 2;
  }
  if (!opts.agent) {
    console.error('[ERR] 缺少 --agent <qoder|opencode|antigravity>');
    printUsage();
    return 2;
  }

  const agentId = AGENT_ALIASES[opts.agent.toLowerCase()] || opts.agent;
  const def = getAgentDef(agentId);
  if (!def) {
    console.error('[ERR] 未知 Agent: ' + opts.agent + '（可用: qoder / opencode / antigravity / agy）');
    return 2;
  }
  if (def.transport !== 'acp') {
    console.error('[ERR] Agent ' + agentId + ' 未声明 transport:acp（transport=' + String(def.transport) + '）');
    return 2;
  }

  const quiet = !!opts.json;
  const timeoutMs = Math.round(opts.timeoutSec * 1000);
  const cfgInfo = readAiConfig();
  const aiCfg = buildAiCfg(cfgInfo.value);
  const resolved = await resolveCommandFor(def, aiCfg);
  const commandArgv = resolved.command;

  if (!quiet) {
    console.log('[INFO] agent=' + agentId + (agentId !== opts.agent ? '（来自 ' + opts.agent + '）' : ''));
    console.log('[INFO] ai-config=' + AI_CONFIG_PATH
      + (cfgInfo.error ? '（读取失败: ' + cfgInfo.error + '）' : '')
      + ' cliPaths=' + (Object.keys(aiCfg.cliPaths).length ? JSON.stringify(aiCfg.cliPaths) : '{}'));
  }

  if (!commandArgv || !commandArgv.length) {
    const unresolved = resolved.unresolved || {};
    const candidates = Array.isArray(unresolved.candidates) ? unresolved.candidates : [];
    const detail = 'reason=' + String(unresolved.reason || 'unknown')
      + ' candidates=' + JSON.stringify(candidates);
    if (quiet) {
      console.log(JSON.stringify({
        ok: false,
        mode: opts.listModels ? 'list-models' : 'live',
        agent: agentId,
        command: '',
        failures: [{ code: 'ACP_BACKEND_MISSING', stage: 'resolve-command', detail }],
        durationMs: 0
      }, null, 2));
    } else {
      console.log('[FAIL] agent=' + agentId + ' code=ACP_BACKEND_MISSING stage=resolve-command detail="' + oneLine(detail, 600) + '"');
      console.log('[INFO] 解析候选链:');
      for (const c of candidates) console.log('  - ' + JSON.stringify(c));
    }
    return 1;
  }

  const commandText = formatArgv(commandArgv);
  if (!quiet) console.log('[INFO] command="' + commandText + '"');

  const cwdInfo = pickCwd();
  const cwd = cwdInfo.cwd;
  const tempDirs = cwdInfo.tempDirs.slice();
  if (!quiet) {
    console.log('[INFO] cwd=' + cwd + (cwd === PREFERRED_CWD ? '（沙箱）' : '（临时目录）'));
    console.log('[INFO] mode=' + (opts.listModels ? 'list-models' : 'live')
      + ' model=' + (opts.model || '-')
      + ' thought=' + (opts.thought || '-')
      + (opts.listModels ? '' : ' prompt="' + oneLine(opts.prompt, 120) + '"'));
  }

  let exitCode = 1;
  try {
    if (opts.listModels) {
      const run = await runListModels({
        agentId,
        commandArgv,
        cwd,
        timeoutMs,
        quiet
      });
      if (!quiet) {
        console.log('[INFO] models=' + run.ids.length
          + ' current=' + (run.currentModelId || '-')
          + (MODEL_EXPECTATIONS[agentId] && MODEL_EXPECTATIONS[agentId].note
            ? '（期望: ' + MODEL_EXPECTATIONS[agentId].note + '）'
            : ''));
        run.ids.forEach((id, index) => {
          if (index >= 40) return;
          console.log('  ' + String(index + 1) + '. ' + id);
        });
        if (run.ids.length > 40) {
          console.log('  …(+' + (run.ids.length - 40) + ' more，完整列表见 --json)');
        }
        for (const item of run.expectations) {
          console.log('  [' + (item.ok ? 'ok' : 'FAIL') + '] ' + item.name + (item.detail ? ' — ' + item.detail : ''));
        }
      }
      if (run.ok) {
        if (!quiet) {
          console.log('[PASS] agent=' + agentId
            + ' command="' + commandText + '"'
            + ' models=' + run.ids.length
            + ' current=' + (run.currentModelId || '-')
            + ' ids=' + summarizeIds(run.ids, 12)
            + ' durationMs=' + run.durationMs);
        } else {
          console.log(JSON.stringify({
            ok: true,
            mode: 'list-models',
            agent: agentId,
            command: commandText,
            cwd,
            models: {
              count: run.ids.length,
              currentModelId: run.currentModelId,
              ids: run.ids,
              entries: run.entries
            },
            expectations: run.expectations,
            failures: [],
            durationMs: run.durationMs
          }, null, 2));
        }
        exitCode = 0;
      } else {
        if (!quiet) {
          const first = run.failures[0] || { code: 'ACP_MODEL_CATALOG', stage: 'models', detail: '' };
          console.log('[FAIL] agent=' + agentId
            + ' code=' + first.code
            + ' stage=' + first.stage
            + ' detail="' + oneLine(first.detail, 600) + '"'
            + ' durationMs=' + run.durationMs);
          console.log('[INFO] 模型列表(' + run.ids.length + '): ' + (summarizeIds(run.ids, 40) || '(none)'));
          for (const f of run.failures.slice(1)) {
            console.log('[INFO] 其他失败: code=' + f.code + ' stage=' + f.stage + ' detail="' + oneLine(f.detail, 300) + '"');
          }
        } else {
          console.log(JSON.stringify({
            ok: false,
            mode: 'list-models',
            agent: agentId,
            command: commandText,
            cwd,
            models: {
              count: run.ids.length,
              currentModelId: run.currentModelId,
              ids: run.ids,
              entries: run.entries
            },
            expectations: run.expectations,
            failures: run.failures,
            durationMs: run.durationMs
          }, null, 2));
        }
        exitCode = 1;
      }
      return exitCode;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-acp-live-'));
    tempDirs.push(tempRoot);
    await prepareRuntime(tempRoot);

    const run = await runLive({
      def,
      aiCfg,
      cwd,
      model: opts.model,
      thought: opts.thought,
      prompt: opts.prompt,
      timeoutMs,
      quiet
    });

    const evaluated = evaluateLive(
      { model: opts.model, thought: opts.thought, timeoutMs, prompt: opts.prompt },
      run,
      commandArgv
    );

    const sessionEvent = run.events.find((e) => e && e.type === 'session') || null;
    const sessionId = sessionEvent ? String(sessionEvent.id || sessionEvent.sessionId || '') : '';
    const stopReason = run.donePayload && run.donePayload.stopReason ? String(run.donePayload.stopReason) : '';
    const failedCode = run.errorPayload ? String(run.errorPayload.code || 'ACP_UNKNOWN') : '';
    const detail = run.errorPayload
      ? String(run.errorPayload.detail || run.errorPayload.message || '')
      : (evaluated.failures[0] ? evaluated.failures[0].detail : '');

    if (evaluated.ok) {
      if (!quiet) {
        console.log('[PASS] agent=' + agentId
          + ' command="' + commandText + '"'
          + ' model=' + (opts.model || '-')
          + ' thought=' + (opts.thought || '-')
          + ' session=' + (sessionId || '-')
          + ' events=' + run.types.join(',')
          + ' answer=' + JSON.stringify(oneLine(evaluated.answer, 60))
          + ' stopReason=' + (stopReason || '-')
          + ' durationMs=' + run.durationMs);
      } else {
        console.log(JSON.stringify({
          ok: true,
          mode: 'live',
          agent: agentId,
          command: commandText,
          cwd,
          requested: { model: opts.model || '', thought: opts.thought || '', prompt: opts.prompt },
          sessionId,
          events: run.types,
          eventCount: run.events.length,
          answer: evaluated.answer,
          stopReason,
          cancelled: run.donePayload ? run.donePayload.cancelled : null,
          config: run.configEvent ? {
            model: run.configEvent.model || '',
            thoughtConfigId: run.configEvent.thoughtConfigId || '',
            thoughtValue: run.configEvent.thoughtValue || '',
            warnings: Array.isArray(run.configEvent.warnings) ? run.configEvent.warnings : []
          } : null,
          failures: [],
          durationMs: run.durationMs
        }, null, 2));
      }
      exitCode = 0;
    } else {
      const first = evaluated.failures[0] || { code: 'ACP_UNKNOWN', stage: 'prompt', detail: 'unknown' };
      if (!quiet) {
        console.log('[FAIL] agent=' + agentId
          + ' code=' + first.code
          + ' stage=' + first.stage
          + ' detail="' + oneLine(detail || first.detail, 600) + '"'
          + ' durationMs=' + run.durationMs);
        console.log('[INFO] 事件序列: ' + (run.types.join(',') || '(none)') + '（共 ' + run.events.length + ' 条）');
        console.log('[INFO] 解析命令: "' + commandText + '"');
        if (run.askResult) console.log('[INFO] ask 返回: ' + JSON.stringify(run.askResult));
        if (run.errorPayload) {
          console.log('[INFO] error.code=' + (run.errorPayload.code || '')
            + ' error.agentId=' + (run.errorPayload.agentId || '-')
            + ' error.command=' + (run.errorPayload.command || '-'));
          console.log('[INFO] error.detail="' + oneLine(run.errorPayload.detail || run.errorPayload.message, 800) + '"');
          if (Array.isArray(run.errorPayload.availableModels) && run.errorPayload.availableModels.length) {
            console.log('[INFO] availableModels=' + run.errorPayload.availableModels.join(','));
          }
        }
        if (run.configEvent) {
          console.log('[INFO] acp_config.model=' + (run.configEvent.model || '-')
            + ' warnings=' + (Array.isArray(run.configEvent.warnings) && run.configEvent.warnings.length
              ? run.configEvent.warnings.join('|')
              : '-'));
          if (Array.isArray(run.configEvent.availableModels) && run.configEvent.availableModels.length) {
            console.log('[INFO] acp_config.availableModels=' + run.configEvent.availableModels.join(','));
          }
        }
        console.log('[INFO] answer=' + JSON.stringify(oneLine(evaluated.answer, 400)));
        for (const f of evaluated.failures.slice(1)) {
          console.log('[INFO] 其他失败: code=' + f.code + ' stage=' + f.stage + ' detail="' + oneLine(f.detail, 300) + '"');
        }
      } else {
        console.log(JSON.stringify({
          ok: false,
          mode: 'live',
          agent: agentId,
          command: commandText,
          cwd,
          requested: { model: opts.model || '', thought: opts.thought || '', prompt: opts.prompt },
          sessionId,
          events: run.types,
          eventCount: run.events.length,
          answer: evaluated.answer,
          stopReason,
          cancelled: run.donePayload ? run.donePayload.cancelled : null,
          config: run.configEvent ? {
            model: run.configEvent.model || '',
            thoughtConfigId: run.configEvent.thoughtConfigId || '',
            thoughtValue: run.configEvent.thoughtValue || '',
            warnings: Array.isArray(run.configEvent.warnings) ? run.configEvent.warnings : []
          } : null,
          error: run.errorPayload ? {
            code: run.errorPayload.code || '',
            detail: run.errorPayload.detail || run.errorPayload.message || '',
            availableModels: Array.isArray(run.errorPayload.availableModels) ? run.errorPayload.availableModels : []
          } : null,
          askResult: run.askResult || null,
          failures: evaluated.failures,
          durationMs: run.durationMs
        }, null, 2));
      }
      exitCode = 1;
    }
  } catch (e) {
    const detail = oneLine(e && e.stack ? e.stack : e, 900);
    if (quiet) {
      console.log(JSON.stringify({
        ok: false,
        mode: opts.listModels ? 'list-models' : 'live',
        agent: agentId,
        command: commandText,
        cwd,
        failures: [{ code: 'ACP_HARNESS_ERROR', stage: 'harness', detail }],
        durationMs: 0
      }, null, 2));
    } else {
      console.error('[FAIL] agent=' + agentId + ' code=ACP_HARNESS_ERROR stage=harness detail="' + detail + '"');
    }
    exitCode = 1;
  } finally {
    try { await withTimeout(acpRuntime.shutdown(), 8000); } catch (_) {}
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  return exitCode;
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => {
    console.error('[FAIL] 未捕获异常: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
);
