const { spawn } = require('node:child_process');
const { createCommandInvocation } = require('../platform/command');
const { applyAgentLaunchEnv } = require('../platform/env');
const { killProcessTree } = require('../platform/process');
const { classifyExecutionError } = require('./diagnostics');
const { getStreamParser } = require('./parsers');

// 通用模型锁接入：def.requiresModelLock === true 且 options.model 非 default 时串行化。
// 仅当非 default 模型才直写全局 settings.json（default 无互串风险），其它 def 不受影响。
function _needsModelLock(def, options) {
  try {
    if (!def || def.requiresModelLock !== true) return false;
    try {
      if (typeof def.needsModelLock === 'function') {
        try { return !!def.needsModelLock(options); } catch (_) { return false; }
      }
      if (typeof def.needsAntigravityModelLock === 'function') {
        try { return !!def.needsAntigravityModelLock(options); } catch (_) { return false; }
      }
    } catch (_) {}
    try {
      if (!options || typeof options !== 'object') return false;
      const m = options.model;
      if (m == null) return false;
      const s = String(m).trim();
      if (!s || s === 'default') return false;
      return true;
    } catch (_) {
      return false;
    }
  } catch (_) {
    return false;
  }
}

function _getModelLockAcquire(def) {
  try {
    if (def && typeof def.acquireModelLock === 'function') return def.acquireModelLock.bind(def);
    if (def && typeof def.acquireAntigravityModelLock === 'function') return def.acquireAntigravityModelLock.bind(def);
  } catch (_) {}
  try {
    const agy = require('./defs/antigravity');
    if (agy && typeof agy.acquireAntigravityModelLock === 'function') return agy.acquireAntigravityModelLock.bind(agy);
  } catch (_) {}
  return null;
}

function _startLockedExecution({ def, resolvedBin, prompt, cwd, options = {}, handlers }) {
  const state = { releaseFn: null, released: false, cancelled: false };
  const safeRelease = () => {
    if (state.released) return;
    state.released = true;
    const fn = state.releaseFn;
    state.releaseFn = null;
    try { if (typeof fn === 'function') fn(); } catch (_) {}
  };
  const handle = {
    pid: null,
    cancel: async () => {
      state.cancelled = true;
      try {
        if (handle.pid) await killProcessTree(handle.pid);
      } catch (_) {}
    }
  };
  // 同步抢链：acquire 的 promise 链拼接必须在 startAgentExecution 同步返回前完成，
  // 否则并发第二个任务的 acquire 会插到前面导致逆序/死锁。等待前驱仍在异步段。
  let _acquirePromise = null;
  try {
    const _acq = _getModelLockAcquire(def);
    if (_acq) {
      try { _acquirePromise = _acq(); } catch (_) { _acquirePromise = null; }
    }
  } catch (_) {
    _acquirePromise = null;
  }
  (async () => {
    // buildArgs 前 acquire（finally 语义，永不抛错影响主流程）
    try {
      if (_acquirePromise) {
        let rel = null;
        try {
          rel = (_acquirePromise && typeof _acquirePromise.then === 'function') ? await _acquirePromise : _acquirePromise;
        } catch (_) { rel = null; }
        if (typeof rel === 'function') state.releaseFn = rel;
      }
    } catch (_) {
      state.releaseFn = null;
    }
    if (state.cancelled) {
      safeRelease();
      try { handlers.onClose({ cancelled: true }); } catch (_) {}
      return;
    }
    // 组装期与同步路径同语义：失败走 onError，所有路径释放锁
    let args;
    try {
      args = def.buildArgs(prompt, [], [], options, { cwd, resumeSessionId: options.sessionId });
    } catch (err) {
      try { handlers.onError(classifyExecutionError((err && err.message) || String(err), -1, def)); } catch (_) {}
      try { safeRelease(); } catch (_) {}
      return;
    }
    if (state.cancelled) {
      try { safeRelease(); } catch (_) {}
      try { handlers.onClose({ cancelled: true }); } catch (_) {}
      return;
    }
    const baseEnv = { ...process.env, ...(options.env || {}) };
    let env = null;
    try {
      env = applyAgentLaunchEnv(baseEnv);
    } catch (err) {
      try { handlers.onError(classifyExecutionError((err && err.message) || String(err), -1, def)); } catch (_) {}
      try { safeRelease(); } catch (_) {}
      return;
    }
    let invocation;
    try {
      invocation = createCommandInvocation({ command: resolvedBin, args, env });
    } catch (err) {
      try {
        const diag = classifyExecutionError((err && err.message) || String(err), -1, def);
        if (err && err.code && diag && diag.code === 'EXECUTION_FAILURE') diag.code = err.code;
        handlers.onError(diag);
      } catch (_) {}
      try { safeRelease(); } catch (_) {}
      return;
    }
    if (state.cancelled) {
      try { safeRelease(); } catch (_) {}
      try { handlers.onClose({ cancelled: true }); } catch (_) {}
      return;
    }
    let child = null;
    let stderrBuffer = '';
    try {
      child = spawn(invocation.command, invocation.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: invocation.windowsVerbatimArguments
      });
    } catch (err) {
      try { handlers.onError(classifyExecutionError((err && err.message) || String(err), -1, def)); } catch (_) {}
      try { safeRelease(); } catch (_) {}
      return;
    }
    try { handle.pid = (child && child.pid) || null; } catch (_) {}
    const pid = handle.pid;
    var _startFired = false;
    function _fireStart() {
      if (_startFired) return; _startFired = true;
      try { if (handlers && typeof handlers.onStart === 'function') handlers.onStart({ pid: (child && child.pid) || pid || null, agentId: def.id, agentName: def.name || def.id }); } catch (e) {}
    }
    try { if (pid) _fireStart(); } catch (e) {}
    try { child.on('spawn', function() { _fireStart(); }); } catch (e) {}
    let parser = null;
    try {
      parser = getStreamParser(def.streamFormat, def.eventParser);
    } catch (err) {
      try { handlers.onError(classifyExecutionError((err && err.message) || String(err), -1, def)); } catch (_) {}
      try { safeRelease(); } catch (_) {}
      try { if (child && typeof child.kill === 'function') child.kill(); } catch (_) {}
      return;
    }
    try {
      if (def.promptViaStdin && child.stdin) {
        child.stdin.write(String(prompt || ''));
        child.stdin.end();
      }
    } catch (_) {}
    try { child.stdout.on('data', (chunk) => { try { parser.push(chunk, handlers); } catch (_) {} }); } catch (_) {}
    try {
      child.stderr.on('data', (chunk) => {
        try {
          stderrBuffer += chunk.toString('utf8');
          if (stderrBuffer.length > 16384) stderrBuffer = stderrBuffer.slice(-16384);
        } catch (_) {}
      });
    } catch (_) {}
    let hasErrored = false;
    try {
      child.on('error', (err) => {
        try {
          if (state.cancelled || hasErrored) return;
          hasErrored = true;
          try { handlers.onError(classifyExecutionError((err && err.message) || String(err), -1, def)); } catch (_) {}
        } finally {
          try { safeRelease(); } catch (_) {}
        }
      });
    } catch (_) {}
    try {
      child.on('close', (code) => {
        try {
          try { parser.flush(handlers); } catch (_) {}
          if (state.cancelled) {
            try { handlers.onClose({ cancelled: true }); } catch (_) {}
            return;
          }
          if (hasErrored) return;
          const pending = (typeof parser.getPendingError === 'function') ? parser.getPendingError() : null;
          const hasOutput = parser.hasEmittedContent();
          const hasStderrErr = !hasOutput && Boolean(stderrBuffer && /(?:no output produced|permission.*denied|\berror\b)/i.test(stderrBuffer));
          if ((code !== 0 && !hasOutput) || pending || hasStderrErr) {
            let errText = stderrBuffer;
            if (pending) {
              const msg = (pending.data && pending.data.message) || pending.message || (typeof pending === 'string' ? pending : JSON.stringify(pending));
              errText = msg + (stderrBuffer ? '\n' + stderrBuffer : '');
            }
            const diag = classifyExecutionError(errText, code || 1, def);
            try { handlers.onError(diag); } catch (_) {}
          } else {
            try { handlers.onClose({ cancelled: false, code }); } catch (_) {}
          }
        } finally {
          try { safeRelease(); } catch (_) {}
        }
      });
    } catch (_) {}
  })().catch(() => {
    try { safeRelease(); } catch (_) {}
  });
  return handle;
}

/**
 * 通用 Agent CLI 任务执行器
 * @param {Object} params
 * @param {RuntimeAgentDef} params.def - Agent 定义
 * @param {string} params.resolvedBin - 解析出的可执行文件绝对路径
 * @param {string} params.prompt - 用户提示词（可包含数十KB HTML）
 * @param {string} params.cwd - 沙箱工作目录
 * @param {Object} [params.options] - 选项 (model, resumeSessionId 等)
 * @param {Object} params.handlers - 回调 { onStart, onThinking, onChunk, onToolCall, onSession, onError, onClose }
 *   onStart({pid, agentId, agentName}) 在进程创建成功后触发一次，供渲染层把“启动中”切为“等待响应”
 * @returns {{ cancel: () => Promise<void>, pid: number | null }}
 */
function startAgentExecution({ def, resolvedBin, prompt, cwd, options = {}, handlers }) {
  // 发现型 CLI（特殊协议未实现执行通道）：诚实降级，不起垃圾进程
  if (def.needsProtocol) {
    try {
      handlers.onError({
        code: 'PROTOCOL_UNSUPPORTED',
        title: '该CLI暂仅支持探测展示',
        message: (def.name || def.id) + ' 使用 ' + def.needsProtocol + ' 协议，本工具暂未实现该执行通道，仅支持探测与模型展示，请切换其他本地 CLI 使用。',
        action: 'switch'
      });
    } catch (e) {}
    return { cancel: () => Promise.resolve(), pid: null };
  }
  // 模型锁通用接入：requiresModelLock === true 且非 default 模型时，buildArgs 前 acquire，close/error 后 release
  let _needsLock = false;
  try { _needsLock = _needsModelLock(def, options); } catch (_) { _needsLock = false; }
  if (_needsLock) {
    try {
      return _startLockedExecution({ def, resolvedBin, prompt, cwd, options, handlers });
    } catch (_) {
      // 锁分支永不抛错影响主流程，异常则回落同步路径
    }
  }
  let args;
  try {
    args = def.buildArgs(prompt, [], [], options, { cwd, resumeSessionId: options.sessionId });
  } catch (err) {
    try { handlers.onError(classifyExecutionError((err && err.message) || String(err), -1, def)); } catch (_) {}
    return { cancel: () => Promise.resolve(), pid: null };
  }
  const baseEnv = { ...process.env, ...(options.env || {}) };
  const env = applyAgentLaunchEnv(baseEnv);

  // 组装期失败（如 Windows 32KB 预算超限 AGENT_PROMPT_TOO_LARGE）必须走 onError，
  // 否则同步抛错导致上层收不到任何 ai:event，前端卡在“启动中/等待响应”无响应。
  let invocation;
  try {
    invocation = createCommandInvocation({
      command: resolvedBin,
      args,
      env
    });
  } catch (err) {
    try {
      const diag = classifyExecutionError((err && err.message) || String(err), -1, def);
      if (err && err.code && diag && diag.code === 'EXECUTION_FAILURE') diag.code = err.code;
      handlers.onError(diag);
    } catch (_) {}
    return { cancel: () => Promise.resolve(), pid: null };
  }

  let child;
  let hasCancelled = false;
  let stderrBuffer = '';

  try {
    child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    });
  } catch (err) {
    handlers.onError(classifyExecutionError(err.message, -1, def));
    return { cancel: () => Promise.resolve(), pid: null };
  }

  const pid = child.pid;
  /* T-CLI启动信号：spawn成功（有pid）即触发一次onStart；再绑spawn事件兜底，幂等 */
  var _startFired = false;
  function _fireStart() {
    if (_startFired) return; _startFired = true;
    try { if (handlers && typeof handlers.onStart === 'function') handlers.onStart({ pid: (child && child.pid) || pid || null, agentId: def.id, agentName: def.name || def.id }); } catch (e) {}
  }
  try { if (pid) _fireStart(); } catch (e) {}
  try { child.on('spawn', function() { _fireStart(); }); } catch (e) {}
  const parser = getStreamParser(def.streamFormat, def.eventParser);

  // 核心：严格通过标准输入 Stdin 流式灌入 Prompt，彻底绕开命令行 32KB 截断
  if (def.promptViaStdin && child.stdin) {
    child.stdin.write(String(prompt || ''));
    child.stdin.end();
  }

  // 绑定 stdout 实时流式事件
  child.stdout.on('data', (chunk) => {
    parser.push(chunk, handlers);
  });

  // 累积 stderr，用于失败诊断
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString('utf8');
    if (stderrBuffer.length > 16384) stderrBuffer = stderrBuffer.slice(-16384);
  });

  let hasErrored = false;
  child.on('error', (err) => {
    if (hasCancelled || hasErrored) return;
    hasErrored = true;
    handlers.onError(classifyExecutionError(err.message, -1, def));
  });

  child.on('close', (code) => {
    parser.flush(handlers);
    if (hasCancelled) {
      handlers.onClose({ cancelled: true });
      return;
    }
    if (hasErrored) {
      return;
    }
    const pending = (typeof parser.getPendingError === 'function') ? parser.getPendingError() : null;
    const hasOutput = parser.hasEmittedContent();
    const hasStderrErr = !hasOutput && Boolean(stderrBuffer && /(?:no output produced|permission.*denied|\berror\b)/i.test(stderrBuffer));
    if ((code !== 0 && !hasOutput) || pending || hasStderrErr) {
      let errText = stderrBuffer;
      if (pending) {
        const msg = (pending.data && pending.data.message) || pending.message || (typeof pending === 'string' ? pending : JSON.stringify(pending));
        errText = msg + (stderrBuffer ? '\n' + stderrBuffer : '');
      }
      const diag = classifyExecutionError(errText, code || 1, def);
      handlers.onError(diag);
    } else {
      handlers.onClose({ cancelled: false, code });
    }
  });

  return {
    pid,
    cancel: async () => {
      hasCancelled = true;
      if (pid) {
        await killProcessTree(pid);
      }
    }
  };
}

module.exports = {
  startAgentExecution
};
