const path = require('node:path');
const fs = require('node:fs');
const { assertCommandLineBudget } = require('./budget');

/**
 * 对 Windows 命令行参数进行转义
 * 1. 含有空格或特殊符号的包裹双引号
 * 2. 内部双引号变为两个双引号 ("")
 * 3. 核心：将 "%" 转换为 ""^%""，在 cmd.exe 与 CommandLineToArgvW 相互抵消下，
 *    既能阻止 cmd.exe 的变量扩展，又能让子进程原样收到 "%"
 */
function quoteWindowsCommandArg(value) {
  const str = String(value ?? '');
  if (!/[\s"&<>|^%]/.test(str)) return str;
  const escaped = str.replace(/"/g, '""').replace(/%/g, '"^%"');
  return `"${escaped}"`;
}

/**
 * 跨平台命令调用构造器
 * 如果是 Windows 下的 .cmd/.bat 脚本，必须重组为 cmd.exe /d /s /c "<line>"
 * 并开启 windowsVerbatimArguments 防止 Node 再次进行二次破坏性转义
 */
function createCommandInvocation({ command, args = [], env = process.env }) {
  let resolvedCommand = String(command ?? '');
  // T4.1: 组装期预算守卫，超限抛 AGENT_PROMPT_TOO_LARGE；正常 Stdin 任务透明无感
  assertCommandLineBudget(resolvedCommand, args);
  if (process.platform === 'win32') {
    const lower = resolvedCommand.toLowerCase();
    // 兜底防御：若传入的命令无扩展名，检查是否存在同名的 .cmd / .bat / .exe
    if (!lower.endsWith('.cmd') && !lower.endsWith('.bat') && !lower.endsWith('.exe')) {
      try {
        if (fs.existsSync(resolvedCommand + '.cmd')) {
          resolvedCommand = resolvedCommand + '.cmd';
        } else if (fs.existsSync(resolvedCommand + '.bat')) {
          resolvedCommand = resolvedCommand + '.bat';
        } else if (fs.existsSync(resolvedCommand + '.exe')) {
          resolvedCommand = resolvedCommand + '.exe';
        }
      } catch (_) {}
    }
    if (/\.(bat|cmd)$/i.test(resolvedCommand)) {
      const inner = [resolvedCommand, ...args].map(quoteWindowsCommandArg).join(' ');
      // T4.1: 按最终 cmd.exe 包装形态复核（含 ComSpec 与 /d /s /c 开销）
      assertCommandLineBudget(env.ComSpec || process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${inner}"`]);
      return {
        command: env.ComSpec || process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', `"${inner}"`],
        windowsVerbatimArguments: true
      };
    }
  }
  return {
    command: resolvedCommand,
    args,
    windowsVerbatimArguments: false
  };
}

module.exports = {
  quoteWindowsCommandArg,
  createCommandInvocation
};
