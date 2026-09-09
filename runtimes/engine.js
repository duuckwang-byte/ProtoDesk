const { spawn } = require('node:child_process');
const { createCommandInvocation } = require('../platform/command');
const { applyAgentLaunchEnv } = require('../platform/env');
const { killProcessTree } = require('../platform/process');
const { classifyExecutionError } = require('./diagnostics');
const { getStreamParser } = require('./parsers');

/**
 * 通用 Agent CLI 任务执行器
 * @param {Object} params
 * @param {RuntimeAgentDef} params.def - Agent 定义
 * @param {string} params.resolvedBin - 解析出的可执行文件绝对路径
 * @param {string} params.prompt - 用户提示词（可包含数十KB HTML）
 * @param {string} params.cwd - 沙箱工作目录
 * @param {Object} [params.options] - 选项 (model, resumeSessionId 等)
 * @param {Object} params.handlers - 回调 { onThinking, onChunk, onToolCall, onSession, onError, onClose }
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
  const args = def.buildArgs(prompt, [], [], options, { cwd, resumeSessionId: options.sessionId });
  const baseEnv = { ...process.env, ...(options.env || {}) };
  const env = applyAgentLaunchEnv(baseEnv);

  const invocation = createCommandInvocation({
    command: resolvedBin,
    args,
    env
  });

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
    if (code !== 0 && !parser.hasEmittedContent()) {
      let errText = stderrBuffer;
      if (typeof parser.getPendingError === 'function') {
        const pending = parser.getPendingError();
        if (pending) {
          const msg = (pending.data && pending.data.message) || pending.message || (typeof pending === 'string' ? pending : JSON.stringify(pending));
          errText = msg + (stderrBuffer ? '\n' + stderrBuffer : '');
        }
      }
      const diag = classifyExecutionError(errText, code, def);
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
