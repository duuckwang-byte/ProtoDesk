function classifyExecutionError(errText, code, def) {
  const raw = String(errText || '').trim();
  const clean = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();

  // 任务超长：Windows 命令行 32KB 预算超限（argv 型 CLI 长任务，常见于 agy/aider/deepseek 携带 UI 规范时）
  if (/AGENT_PROMPT_TOO_LARGE|命令行字符总数超出/i.test(clean)) {
    return {
      code: 'AGENT_PROMPT_TOO_LARGE',
      title: '任务内容超长，当前 CLI 无法一次下发',
      message: '本次任务（含注入的 UI 规范）超过 Windows 命令行 32KB 限制，而该 CLI 仅支持命令行传参。请精简修改描述、分多次下发，或切换到走 Stdin 管道的 CLI（如 OpenCode / Qwen）后重试。',
      action: 'retry'
    };
  }

  // 会话不存在 / 会话失效 (OpenCode: Error: Session not found)
  if (/session not found/i.test(clean)) {
    return {
      code: 'SESSION_NOT_FOUND',
      title: '会话已失效或不存在',
      message: '底层 Agent 历史会话已过期或已被清理，系统已自动重置为新会话。',
      action: 'reset_session'
    };
  }

  // 未登录 / 凭据丢失
  if (/login|authenticate|not logged in|API key missing|UNAUTHENTICATED/i.test(clean)) {
    return {
      code: 'AUTH_REQUIRED',
      title: `${def.name} 未登录或凭据失效`,
      message: `请在终端中执行 \`${def.bin} login\` 或检查对应环境变量/设置。`,
      action: 'login'
    };
  }
  // 配额耗尽 / 429 速率限制 / 余额不足
  if (/quota|rate limit|429|exceeded your current quota|insufficient_quota|balance/i.test(clean)) {
    return {
      code: 'QUOTA_EXHAUSTED',
      title: '模型配额耗尽或余额不足 (429)',
      message: clean.slice(0, 300) || '当前服务商账户余额不足或并发过高，建议切换模型或检查额度。',
      action: 'switch_model'
    };
  }
  // 代理与证书拦截
  if (/certificate|self-signed|unable to verify/i.test(clean)) {
    return {
      code: 'CERT_ERROR',
      title: '网络代理 SSL 证书异常',
      message: '检测到本地抓包工具或企业代理拦截，已自动尝试放宽证书校验。',
      action: 'check_proxy'
    };
  }

  // 模型不可用或服务端异常 (OpenCode: Unexpected server error / model not found / unknown model)
  if (/model.*not found|unknown model|invalid model|unsupported model|Unexpected server error/i.test(clean)) {
    return {
      code: 'MODEL_UNAVAILABLE',
      title: '所选模型不可用或名称不匹配',
      message: clean.slice(0, 300) || '当前选择的模型在服务提供商处不可用或已下线，建议在设置中切换为默认模型或其他可用模型。',
      action: 'switch_model'
    };
  }

  return {
    code: 'EXECUTION_FAILURE',
    title: `调用失败（退出码 ${code}）`,
    message: clean.slice(0, 300) || '进程异常退出，请检查本地环境。',
    action: 'retry'
  };
}

module.exports = {
  classifyExecutionError
};
