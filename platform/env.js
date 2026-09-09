const path = require('node:path');

/**
 * 注入并修复子进程所需的环境变量
 * @param {NodeJS.ProcessEnv} baseEnv 当前环境变量
 * @param {string[]} [extraPrependDirs] 额外需要前置的路径列表（如解析出的 CLI 所在目录）
 * @returns {NodeJS.ProcessEnv}
 */
function applyAgentLaunchEnv(baseEnv = process.env, extraPrependDirs = []) {
  const env = { ...baseEnv };

  // 1. 大小写自适应定位 Path 键名
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  const existing = env[pathKey] || '';

  // 2. 强制将当前 Electron 内部的 Node 执行目录前置
  //    确保所有 .cmd 脚本内的 bare "node" 均能命中当前运行时
  const nodeBinDir = path.dirname(process.execPath);
  const prependList = [nodeBinDir, ...(extraPrependDirs || [])].filter(Boolean);

  // 3. 规范化与大小写不敏感去重
  const isWin = process.platform === 'win32';
  const normalize = p => {
    const trimmed = p.replace(/[/\\]+$/, '');
    return isWin ? trimmed.toLowerCase() : trimmed;
  };

  const seen = new Set();
  const merged = [];

  for (const dir of [...prependList, ...existing.split(path.delimiter)]) {
    if (!dir) continue;
    const n = normalize(dir);
    if (!seen.has(n)) {
      seen.add(n);
      merged.push(dir);
    }
  }

  env[pathKey] = merged.join(path.delimiter);

  // 4. 抗自签名证书拦截
  if (!env['NODE_TLS_REJECT_UNAUTHORIZED']) {
    env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  }

  return env;
}

module.exports = {
  applyAgentLaunchEnv
};
