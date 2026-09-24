const path = require('node:path');

/**
 * Wave-E 契约补记 (只加注释, 实现不变): TLS 默认安全 P0-B.
 * @typedef {Object} AgentEnv 子进程环境变量表 (含 PATH/PLAN_D_ALLOW_INSECURE_TLS/PLAN_D_EXTRA_CA_CERTS 透传)
 * @param {NodeJS.ProcessEnv} baseEnv 当前环境变量
 * @param {string[]} [extraPrependDirs] 额外前置路径 (CLI 所在目录)
 * @returns {NodeJS.ProcessEnv} 注入并修复后的环境 (默认不设 NODE_TLS_REJECT_UNAUTHORIZED; 显式 opt-in 才注 0 并告警)
 */

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

  // 4. TLS 证书校验：默认安全（P0-B 修复）。
  //    旧行为：无条件注入 NODE_TLS_REJECT_UNAUTHORIZED='0'，所有子进程放弃证书校验（MITM 风险）。
  //    新行为：默认不设置该变量；仅显式 opt-in 才放行：
  //      - PLAN_D_ALLOW_INSECURE_TLS=1/true  -> 注入 NODE_TLS_REJECT_UNAUTHORIZED='0' + console.warn
  //      - 自签 CA 请用 PLAN_D_EXTRA_CA_CERTS 或标准 NODE_EXTRA_CA_CERTS（透传，不降级校验）
  const insecureOptIn = isInsecureTlsOptIn(env['PLAN_D_ALLOW_INSECURE_TLS']);
  if (insecureOptIn) {
    env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    console.warn(
      '[platform/env] WARNING: PLAN_D_ALLOW_INSECURE_TLS 已启用，' +
      '子进程将设置 NODE_TLS_REJECT_UNAUTHORIZED=0（跳过 TLS 证书校验）。' +
      '仅建议在受信内网/调试时使用，公网环境下可能泄露 API Key。'
    );
  } else if (env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0') {
    // 调用方/外部环境显式传入的 '0' 做透传，但同样告警，避免静默不安全。
    console.warn(
      '[platform/env] WARNING: 检测到 NODE_TLS_REJECT_UNAUTHORIZED=0 透传，' +
      '子进程将跳过 TLS 证书校验。如需自签 CA 请改用 PLAN_D_EXTRA_CA_CERTS/NODE_EXTRA_CA_CERTS。'
    );
  }

  // 5. 自签 CA 支持：PLAN_D_EXTRA_CA_CERTS 别名 -> 标准 NODE_EXTRA_CA_CERTS（不覆盖显式已设的值）。
  const extraCa = env['PLAN_D_EXTRA_CA_CERTS'];
  if (typeof extraCa === 'string' && extraCa.trim() !== '' && !env['NODE_EXTRA_CA_CERTS']) {
    env['NODE_EXTRA_CA_CERTS'] = extraCa;
  }

  return env;
}

/**
 * 是否显式开启不安全 TLS（仅 '1' / 'true' 大小写不敏感算 opt-in）。
 * @param {unknown} value
 * @returns {boolean}
 */
function isInsecureTlsOptIn(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true';
}

module.exports = {
  applyAgentLaunchEnv
};
