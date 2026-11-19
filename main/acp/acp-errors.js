'use strict';
/**
 * main/acp/acp-errors.js — acpx 错误码 → 用户可读错误（Phase 0）
 * 纯函数，不依赖 Electron；错误码来源支持 err.code / err.detailCode /
 * err.data.code / err.cause.code / err.cause.detailCode / err.error.code，
 * 以及错误文本中的已知码与 spawn 上下文 ENOENT。
 */

const ERROR_DEFS = {
  ACP_BACKEND_MISSING: {
    title: 'Agent 启动失败或未找到',
    message: '未安装、未找到命令或启动失败，没有可用的 ACP Agent 可执行文件；请在设置中指定路径，或先安装对应 CLI / 适配器。',
    action: 'install',
    retryable: false
  },
  ACP_BACKEND_UNAVAILABLE: {
    title: 'ACP Agent 无法启动',
    message: 'Agent 进程启动失败或提前退出，请测试连接、检查安装路径，并查看执行日志。',
    action: 'retry',
    retryable: true
  },
  ACP_SESSION_INIT_FAILED: {
    title: 'ACP 会话初始化失败',
    message: '无法建立 ACP 会话，请新建会话或切换 Agent 后重试。',
    action: 'reset_session',
    retryable: true
  },
  ACP_TURN_FAILED: {
    title: 'ACP 本轮执行失败',
    message: 'Agent 执行本轮任务失败，工作区保留执行前状态，可重试或查看日志。',
    action: 'retry',
    retryable: true
  },
  PERMISSION_DENIED: {
    title: '操作未获授权',
    message: 'Agent 请求的操作被拒绝，本轮已停止；如属误拒，可重试并在权限卡中选择允许。',
    action: 'retry',
    retryable: true
  },
  PERMISSION_PROMPT_UNAVAILABLE: {
    title: '该 Agent 的提问形式暂不支持',
    message: '当前 Agent 以权限请求形式发起提问，无法在现有界面作答，请切换 Agent 或改用兼容模式。',
    action: 'switch',
    retryable: false
  },
  ACP_MODEL_UNSUPPORTED: {
    title: '模型不受支持',
    message: '当前模型不被该 Agent 支持，请切换到该 Agent 可用的模型，或改用其他 Agent。',
    action: 'switch',
    retryable: false
  },
  TIMEOUT: {
    title: '执行超时',
    message: 'Agent 长时间未返回结果，已按超时结束；可重试，或在设置中适当加大超时时间。',
    action: 'retry',
    retryable: true
  },
  AUTH_REQUIRED: {
    title: '未登录或凭据失效',
    message: 'Agent 需要登录后才能继续，请先在终端完成登录，或检查对应环境变量 / 设置。',
    action: 'login',
    retryable: false
  }
};

const KNOWN_CODES = Object.keys(ERROR_DEFS);

/** 底层进程错误码 → 对用户更有意义的已知错误码 */
const CODE_ALIASES = {
  ENOENT: 'ACP_BACKEND_MISSING',
  AGENT_SPAWN_ENOENT: 'ACP_BACKEND_MISSING',
  AGENT_SPAWN_FAILED: 'ACP_BACKEND_MISSING'
};

/** 未知错误的通用回落文案 */
const UNKNOWN_ERROR = {
  code: 'ACP_UNKNOWN',
  title: 'ACP 调用失败',
  message: 'Agent 运行时返回未知错误，工作区完好无损；请查看执行日志后重试。',
  action: 'retry',
  retryable: true
};

/**
 * 在文本中查找已知错误码（不区分大小写）。
 * @param {*} text 待扫描文本
 * @returns {string} 命中的错误码，未命中返回空字符串
 */
function findCodeInText(text) {
  const upper = String(text || '').toUpperCase();
  if (!upper) return '';
  for (const code of KNOWN_CODES) {
    if (upper.includes(code)) return code;
  }
  return '';
}

/**
 * 在文本中查找底层进程错误别名（不区分大小写）。
 * 仅把 spawn 上下文中的 ENOENT 视为「命令未找到」；
 * 会话目录 rename 等文件操作的 ENOENT 不应误报为未安装 Agent。
 * @param {*} text 待扫描文本
 * @returns {string} 映射后的已知错误码，未命中返回空字符串
 */
function findAliasInText(text) {
  const upper = String(text || '').toUpperCase();
  if (!upper) return '';
  if (/\bAGENT_SPAWN_(ENOENT|FAILED)\b/.test(upper)) return CODE_ALIASES.AGENT_SPAWN_FAILED;
  if (/\bENOENT\b/.test(upper) && /\bSPAWN\b/.test(upper)) return CODE_ALIASES.ENOENT;
  return '';
}

/**
 * 将任意原始码归一化为已知错误码（含底层进程错误别名）。
 * @param {*} raw 原始码（err.code / detailCode 等）
 * @returns {string} 已知错误码，未命中返回空字符串
 */
function normalizeCode(raw) {
  if (raw == null) return '';
  const text = String(raw).trim();
  if (!text) return '';
  if (ERROR_DEFS[text]) return text;
  const upper = text.toUpperCase();
  if (ERROR_DEFS[upper]) return upper;
  if (CODE_ALIASES[upper]) return CODE_ALIASES[upper];
  return findCodeInText(text) || findAliasInText(text);
}

/**
 * 从错误对象中提取已知错误码。
 * 优先取 detailCode（顶层 / cause），再取 cause.code，最后取外层 code，
 * 便于把「ACP_SESSION_INIT_FAILED 外壳 + AGENT_SPAWN_ENOENT 根因」还原为
 * ACP_BACKEND_MISSING；无法识别的嵌套码会自动跳过。
 * @param {*} err 任意错误（Error / 字符串 / 普通对象）
 * @returns {string} 已知错误码，未命中返回空字符串
 */
function extractCode(err) {
  if (err == null) return '';
  if (typeof err === 'string') return normalizeCode(err);

  const obj = typeof err === 'object' ? err : {};
  const candidates = [
    obj.detailCode,
    obj.cause && obj.cause.detailCode,
    obj.cause && obj.cause.code,
    obj.code,
    obj.errorCode,
    obj.data && obj.data.code,
    obj.error && obj.error.code
  ];
  for (const raw of candidates) {
    const code = normalizeCode(raw);
    if (code) return code;
  }

  const text = [obj.message, obj.detail, obj.stack].filter(Boolean).join('\n');
  return findAliasInText(text) || findCodeInText(text);
}

/**
 * 把 acpx / ACP SDK 错误归一化为 UI 可直接消费的结构。
 * @param {*} err 任意错误（Error / 字符串 / 普通对象）
 * @returns {{code:string, title:string, message:string, action:string, retryable:boolean}}
 */
function normalizeAcpError(err) {
  const code = extractCode(err);
  const def = ERROR_DEFS[code];
  if (!def) return { ...UNKNOWN_ERROR };
  return {
    code,
    title: def.title,
    message: def.message,
    action: def.action,
    retryable: def.retryable
  };
}

module.exports = {
  normalizeAcpError,
  // 供诊断 / 设置页展示完整错误码清单
  ACP_ERROR_CODES: KNOWN_CODES.slice()
};
