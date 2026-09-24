const WINDOWS_COMMAND_LINE_CAP = 32767;

/**
 * 校验命令行总字符预算
 * @param {string} command 可执行文件
 * @param {string[]} args 参数列表
 * @throws {Error} 超过预算时抛出友好错误
 */
function assertCommandLineBudget(command, args = []) {
  if (process.platform !== 'win32') return true;

  // 测算实际组装为 cmd.exe 命令后的总字符长度
  const totalLength = [command, ...args]
    .map(a => `"${String(a).replace(/"/g, '""')}"`)
    .join(' ').length;

  if (totalLength >= WINDOWS_COMMAND_LINE_CAP) {
    const err = new Error(
      `命令行字符总数超出 Windows 32KB 限制 (${totalLength} >= ${WINDOWS_COMMAND_LINE_CAP})。` +
      `当前任务包含过大上下文，必须通过 Stdin 管道流式传输，请检查适配器配置。`
    );
    err.code = 'AGENT_PROMPT_TOO_LARGE';
    err.totalLength = totalLength;
    throw err;
  }

  return true;
}

module.exports = {
  assertCommandLineBudget,
  WINDOWS_COMMAND_LINE_CAP
};
