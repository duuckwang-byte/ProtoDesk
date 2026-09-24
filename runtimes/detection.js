const { getAllAgentDefs } = require('./registry');
const { resolveAgentExecutable } = require('./resolution');
const { spawn } = require('node:child_process');
const { createCommandInvocation } = require('../platform/command');
const { applyAgentLaunchEnv } = require('../platform/env');
const os = require('node:os');

/**
 * 并发探测本机所有已注册的 Agent CLI
 * @param {Record<string, string>} [customPaths] 用户手动指定的路径字典
 * @returns {Promise<Array<{ id: string, name: string, available: boolean, path: string | null, version: string | null }>>}
 */
async function detectAllAgents(customPaths = {}) {
  const defs = getAllAgentDefs();

  const probeTasks = defs.map(async (def) => {
    try {
      // 1. 寻找有效可执行文件
      const binPath = await resolveAgentExecutable(def, customPaths[def.id]);
      if (!binPath) {
        return { id: def.id, name: def.name, available: false, path: null, version: null };
      }

      // 2. 带 3000ms 超时熔断保护的版本探针
      const version = await Promise.race([
        probeCliVersion(binPath, def.versionArgs),
        new Promise(res => setTimeout(() => res(null), 3000))
      ]);

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

function probeCliVersion(binPath, versionArgs) {
  return new Promise((resolve) => {
    const invocation = createCommandInvocation({
      command: binPath,
      args: versionArgs,
      env: applyAgentLaunchEnv()
    });

    const child = spawn(invocation.command, invocation.args, {
      cwd: os.tmpdir(), // 隔离在系统临时目录，防止 Bun/OpenCode 污染当前工作区
      windowsVerbatimArguments: invocation.windowsVerbatimArguments
    });

    let out = '';
    child.stdout.on('data', d => out += d.toString('utf8'));
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (code === 0 && out.trim()) {
        resolve(out.trim().split(/\r?\n/)[0]);
      } else {
        resolve(null);
      }
    });
  });
}

module.exports = {
  detectAllAgents
};
