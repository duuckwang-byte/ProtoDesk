/* UI 回归：启动 electron（隔离 .devdata）→ 顺序跑 cases → 杀进程树 → PASS/FAIL 汇总 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { connect } = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startElectron() {
  /* 直接启动 electron.exe（而非 cmd /c npx 链）：child.pid 即 electron 主进程，
     结束时 taskkill /T 才能可靠杀净整棵进程树，避免残留实例占用调试端口 */
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(exe)) throw new Error('未找到 electron.exe：' + exe);
  const child = spawn(exe, ['.', '--remote-debugging-port=' + PORT],
    { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
  return child;
}
function killTree(pid) {
  try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); } catch (e) {}
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, '.devdata'))) fs.mkdirSync(path.join(ROOT, '.devdata'), { recursive: true });
  const child = startElectron();
  let api = null;
  const results = [];
  try {
    await sleep(2500);
    api = await connect({ port: PORT });
    await sleep(2000); /* 等项目选择弹窗渲染 */
    const cases = [
      ['diag-first-screen', require('./cases/diag-first-screen')],
      ['project-flow', require('./cases/project-flow')],
      ['title-toc', require('./cases/title-toc')],
      ['snapshot', require('./cases/snapshot')],
      ['guard-and-rename', require('./cases/guard-and-rename')],
      ['export-verify', require('./cases/export-verify')],
      ['full-simulation', require('./cases/full-simulation')],
      ['new-features-upgrade', require('./cases/new-features-upgrade')],
      ['ctrl-pick', require('./cases/ctrl-pick')],
      ['git-flow', require('./cases/git-flow')],
      ['anno-features', require('./cases/anno-features')]
    ];
    for (const [name, fn] of cases) {
      try {
        await fn(api);
        results.push({ name, pass: true });
        console.log('PASS', name);
      } catch (e) {
        results.push({ name, pass: false });
        console.log('FAIL', name, '-', (e && e.message) || e);
      }
    }
  } catch (e) {
    console.log('FATAL', (e && e.message) || e);
    process.exitCode = 2;
  } finally {
    if (api) api.close();
    killTree(child.pid);
  }
  await sleep(1200);
  const failed = results.filter((r) => !r.pass).length;
  console.log('SUMMARY', results.map((r) => r.name + '=' + (r.pass ? 'PASS' : 'FAIL')).join(' '), '| failed:', failed);
  if (failed > 0 || process.exitCode === 2) process.exitCode = 1;
}
main().then(() => process.exit(process.exitCode || 0));
