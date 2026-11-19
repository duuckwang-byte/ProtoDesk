'use strict';
/**
 * main/acp/acp-service.js — acpx 运行时薄壳（Phase 0）
 * 只负责动态 import ESM-only 的 acpx/runtime 并维护主进程内单例；
 * 不引用 Electron，不处理窗口广播、权限路由或具体执行流程，
 * 这些接入点留给 Phase 1 的 ai-process-service / controller。
 */
let runtimePromise = null;

/**
 * 构造可读的后端缺失错误。
 * @param {*} [cause] 原始异常
 * @returns {Error & {code:string}}
 */
function backendMissingError(cause) {
  const err = new Error(
    'ACP 运行时不可用：未安装 acpx，或 acpx/runtime 无法加载。请先安装 acpx 及对应 Agent 适配器。'
  );
  err.code = 'ACP_BACKEND_MISSING';
  if (cause) err.cause = cause;
  return err;
}

/**
 * 获取进程内唯一的 acpx runtime。
 * 首次调用创建，后续调用直接复用；创建失败会清空缓存，允许下一次重试。
 * 传入的 options 仅首次调用生效（cwd / sessionStore / agentRegistry / 权限策略等）。
 * @param {Object} [options] createAcpRuntime 配置
 * @returns {Promise<Object>} acpx runtime
 */
async function getRuntime(options) {
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    let mod = null;
    try {
      mod = await import('acpx/runtime');
    } catch (e) {
      throw backendMissingError(e);
    }
    const create = mod && (mod.createAcpRuntime || (mod.default && mod.default.createAcpRuntime));
    if (typeof create !== 'function') throw backendMissingError();
    return create(options && typeof options === 'object' ? options : {});
  })();

  try {
    return await runtimePromise;
  } catch (e) {
    runtimePromise = null;
    throw e;
  }
}

/**
 * 关闭并释放 runtime 单例；异常吞掉，保证退出流程不中断。
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (!runtimePromise) return;
  const pending = runtimePromise;
  runtimePromise = null;
  try {
    const runtime = await pending;
    if (runtime && typeof runtime.shutdown === 'function') await runtime.shutdown();
  } catch (_) {}
}

module.exports = {
  getRuntime,
  shutdown
};
