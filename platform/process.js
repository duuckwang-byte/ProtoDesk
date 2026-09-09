const { exec } = require('node:child_process');

/**
 * 彻底销毁指定 PID 及其全部子进程树
 * @param {number} pid 根进程 PID
 * @returns {Promise<boolean>}
 */
function killProcessTree(pid) {
  if (!pid || typeof pid !== 'number') return Promise.resolve(false);

  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows 原生 taskkill /T (递归整树) /F (强制强杀)
      exec(`taskkill /pid ${pid} /T /F`, (err) => {
        // 退出码 0 为成功，128 为进程已不在，均视为成功结束
        resolve(true);
      });
    } else {
      try {
        // POSIX 环境优先给进程组发送 SIGKILL
        process.kill(-pid, 'SIGKILL');
        resolve(true);
      } catch (e) {
        try {
          process.kill(pid, 'SIGKILL');
          resolve(true);
        } catch (ee) {
          resolve(false);
        }
      }
    }
  });
}

module.exports = {
  killProcessTree
};
