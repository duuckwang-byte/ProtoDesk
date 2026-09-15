'use strict';
// Iteration 1 L0 平台层自动化验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖方案文档 2.2 节 4 个断言，win32 下全绿，兼容非 win 平台分支。
const assert = require('node:assert');
const path = require('node:path');
const childProcess = require('node:child_process');

const { quoteWindowsCommandArg, createCommandInvocation } = require('../platform/command');
const { assertCommandLineBudget } = require('../platform/budget');
const { applyAgentLaunchEnv } = require('../platform/env');
const { killProcessTree } = require('../platform/process');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 测试1：特殊字符与环境变量转义 ----------
async function test1_QuoteAndInvocation() {
  // 1a. 含空格路径被双引号包裹
  const spaced = quoteWindowsCommandArg('C:\\Program Files\\tool.exe');
  assert.ok(
    spaced.startsWith('"') && spaced.endsWith('"'),
    `含空格路径应被双引号包裹，实际: ${spaced}`
  );

  // 1b. 含双引号转义为 ""
  const withQuote = quoteWindowsCommandArg('a"b');
  assert.ok(
    withQuote.includes('""'),
    `含双引号应转义为""，实际: ${withQuote}`
  );

  // 1c. 含 %PATH% 生成 "^%" 子串（防 cmd 变量扩展）
  const withPct = quoteWindowsCommandArg('%PATH%');
  assert.ok(
    withPct.includes('^%'),
    `含%应生成"^%"子串，实际: ${withPct}`
  );

  // 1d. createCommandInvocation 分支断言
  const cmdInv = createCommandInvocation({ command: 'C:\\tools\\opencode.cmd', args: ['--help'] });
  const nodeInv = createCommandInvocation({ command: 'node.exe', args: ['--version'] });

  if (process.platform === 'win32') {
    // .cmd 必须重组为 ComSpec/cmd.exe + /d /s /c + verbatim true
    const expectedComSpec = process.env.ComSpec || 'cmd.exe';
    assert.strictEqual(
      cmdInv.command, expectedComSpec,
      `.cmd 应经 ComSpec 启动，期望 ${expectedComSpec}，实际 ${cmdInv.command}`
    );
    assert.deepStrictEqual(
      cmdInv.args.slice(0, 3), ['/d', '/s', '/c'],
      `.cmd args[0..2] 应为 /d /s /c，实际 ${JSON.stringify(cmdInv.args)}`
    );
    assert.strictEqual(
      cmdInv.windowsVerbatimArguments, true,
      '.cmd 应 windowsVerbatimArguments===true'
    );
    // 非 .cmd 命令返回 verbatim false
    assert.strictEqual(nodeInv.command, 'node.exe', '非.cmd 应保持原 command');
    assert.strictEqual(
      nodeInv.windowsVerbatimArguments, false,
      '非.cmd 应 windowsVerbatimArguments===false'
    );
  } else {
    // 非 win：一律直通、verbatim false
    assert.strictEqual(cmdInv.windowsVerbatimArguments, false, '非win下 verbatim 应为 false');
    assert.strictEqual(nodeInv.windowsVerbatimArguments, false, '非win下 verbatim 应为 false');
    assert.strictEqual(cmdInv.command, 'C:\\tools\\opencode.cmd');
    assert.strictEqual(nodeInv.command, 'node.exe');
  }
}

// ---------- 测试2：32KB 预算守卫 ----------
async function test2_BudgetGuard() {
  const hugeArg = 'x'.repeat(33000);
  const smallArg = 'y'.repeat(1000); // 远小于 30KB

  if (process.platform === 'win32') {
    // 超长参数必须抛错且 code 为 AGENT_PROMPT_TOO_LARGE
    let threw = null;
    try {
      assertCommandLineBudget('node.exe', [hugeArg]);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'win32 下 33000 字符参数应抛错，但未抛错');
    assert.strictEqual(
      threw.code, 'AGENT_PROMPT_TOO_LARGE',
      `错误码应为 AGENT_PROMPT_TOO_LARGE，实际 ${threw.code}: ${threw.message}`
    );
    // 30KB 以下正常放行返回 true
    const ok = assertCommandLineBudget('node.exe', [smallArg]);
    assert.strictEqual(ok, true, '30KB 以下应返回 true 放行');
  } else {
    // 非 win 直接放行亦算 PASS
    assert.strictEqual(assertCommandLineBudget('node.exe', [hugeArg]), true);
    assert.strictEqual(assertCommandLineBudget('node.exe', [smallArg]), true);
  }
}

// ---------- 测试3：PATH 前置与大小写兼容 ----------
async function test3_EnvPathPrepend() {
  const base = { Path: 'C:\\Windows;C:\\Windows\\System32' }; // 只有 Path 键
  const result = applyAgentLaunchEnv(base);

  // 保留原键名 Path，无新增 PATH/path 键
  assert.ok('Path' in result, '结果应保留原键名 Path');
  assert.ok(!('PATH' in result), '不应新增大写 PATH 键');
  assert.ok(!('path' in result), '不应新增小写 path 键');

  // 当前 Node 目录在结果首位
  const nodeBinDir = path.dirname(process.execPath);
  const parts = String(result.Path).split(path.delimiter);
  assert.strictEqual(
    parts[0], nodeBinDir,
    `PATH 首位应为当前 Node 目录 ${nodeBinDir}，实际首位 ${parts[0]}，完整 ${result.Path}`
  );

  // 原有条目仍保留
  assert.ok(
    parts.includes('C:\\Windows'),
    `原 PATH 条目应保留，实际 ${result.Path}`
  );

  // P0-B 默认安全+显式可选：默认不注入 NODE_TLS_REJECT_UNAUTHORIZED
  assert.strictEqual(
    result.NODE_TLS_REJECT_UNAUTHORIZED, undefined,
    '默认不应注入 NODE_TLS_REJECT_UNAUTHORIZED（默认安全，显式 opt-in 才放行）'
  );
  assert.strictEqual(
    result.NODE_EXTRA_CA_CERTS, undefined,
    '默认不应注入 NODE_EXTRA_CA_CERTS'
  );

  // 显式 opt-in（PLAN_D_ALLOW_INSECURE_TLS=1）才注入 '0'，且必须 console.warn
  let warned = [];
  const origWarn = console.warn;
  try {
    console.warn = (...a) => { warned.push(a.join(' ')); };
    const insecure = applyAgentLaunchEnv({ Path: 'C:\\Windows', PLAN_D_ALLOW_INSECURE_TLS: '1' });
    assert.strictEqual(
      insecure.NODE_TLS_REJECT_UNAUTHORIZED, '0',
      'PLAN_D_ALLOW_INSECURE_TLS=1 时应显式注入 NODE_TLS_REJECT_UNAUTHORIZED=0'
    );
    assert.ok(
      warned.some((m) => /WARNING/.test(m) && /PLAN_D_ALLOW_INSECURE_TLS/.test(m)),
      `不安全模式必须打 warning 日志，实际 warn=${JSON.stringify(warned)}`
    );
  } finally {
    console.warn = origWarn;
  }

  // 非 opt-in 取值（'0'/''/未设）不得放行，且默认路径下无 warn 污染
  {
    const off = applyAgentLaunchEnv({ Path: 'C:\\Windows', PLAN_D_ALLOW_INSECURE_TLS: '0' });
    assert.strictEqual(
      off.NODE_TLS_REJECT_UNAUTHORIZED, undefined,
      "PLAN_D_ALLOW_INSECURE_TLS='0' 不应放行"
    );
  }

  // 自签 CA：PLAN_D_EXTRA_CA_CERTS 别名透传为标准 NODE_EXTRA_CA_CERTS，且不降级校验
  {
    const ca = applyAgentLaunchEnv({ Path: 'C:\\Windows', PLAN_D_EXTRA_CA_CERTS: 'C:\\certs\\ca.pem' });
    assert.strictEqual(
      ca.NODE_EXTRA_CA_CERTS, 'C:\\certs\\ca.pem',
      'PLAN_D_EXTRA_CA_CERTS 应透传为 NODE_EXTRA_CA_CERTS'
    );
    assert.strictEqual(
      ca.NODE_TLS_REJECT_UNAUTHORIZED, undefined,
      '仅配置自签 CA 时不应顺带关闭证书校验'
    );
  }

  // 标准 NODE_EXTRA_CA_CERTS 本身透传；已显式设置时别名不得覆盖
  {
    const direct = applyAgentLaunchEnv({ Path: 'C:\\Windows', NODE_EXTRA_CA_CERTS: 'D:\\ca\\direct.pem' });
    assert.strictEqual(
      direct.NODE_EXTRA_CA_CERTS, 'D:\\ca\\direct.pem',
      'NODE_EXTRA_CA_CERTS 应原样透传'
    );
    const both = applyAgentLaunchEnv({
      Path: 'C:\\Windows',
      NODE_EXTRA_CA_CERTS: 'D:\\ca\\direct.pem',
      PLAN_D_EXTRA_CA_CERTS: 'C:\\certs\\alias.pem',
    });
    assert.strictEqual(
      both.NODE_EXTRA_CA_CERTS, 'D:\\ca\\direct.pem',
      'NODE_EXTRA_CA_CERTS 已显式设置时，PLAN_D_EXTRA_CA_CERTS 不得覆盖'
    );
  }
}

// ---------- 测试4：进程树递归强杀 ----------
function isAliveWin32(pid) {
  // 主判定：tasklist；若 tasklist 明确无此 PID 则判死
  try {
    const out = childProcess.execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (/No tasks/i.test(out) || /INFO:/i.test(out)) return false;
    if (!out.includes(`"${pid}"`)) return false;
    return true; // tasklist 仍能看到 -> 存活
  } catch (_e) {
    // tasklist 出错时回退到 process.kill 探测
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false; // 不存在 -> 已死
    if (e && e.code === 'EPERM') return true; // 存在但无权限 -> 存活
    return false;
  }
}

function isAliveGeneric(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false;
    if (e && e.code === 'EPERM') return true;
    return false;
  }
}

async function test4_KillProcessTree() {
  // 4a. 非法 pid 直接 resolve false
  assert.strictEqual(await killProcessTree(null), false, 'null 应 resolve false');
  assert.strictEqual(await killProcessTree(undefined), false, 'undefined 应 resolve false');
  assert.strictEqual(await killProcessTree('123'), false, '字符串 pid 应 resolve false');

  // 4b. 启动嵌套常驻进程树并强杀
  // 注：方案示例 `node -e "setTimeout(()=>{},30000)"` 经 cmd.exe 解析时，
  // `()` 会被 cmd 当作批处理元字符导致常驻子树秒退（已实测 tasklist/ESRCH 确认）。
  // 按任务书“或类似常驻子进程”改用等效常驻命令 `ping -n 30 127.0.0.1 > nul`：
  // 同样是 cmd.exe 父进程 + ping 子进程的嵌套树，且无 cmd 元字符，可靠常驻约 30s。
  let child = null;
  let pid = null;
  try {
    if (process.platform === 'win32') {
      child = childProcess.spawn('cmd.exe', ['/d', '/s', '/c', 'ping -n 30 127.0.0.1 > nul'], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child = childProcess.spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], {
        detached: false,
        stdio: 'ignore',
      });
    }
    assert.ok(child && typeof child.pid === 'number', '子进程启动失败，无有效 pid');
    pid = child.pid;
    // 给子树一点启动时间
    await sleep(500);
    // 若启动即退出则直接失败（环境问题）
    const earlyAlive = process.platform === 'win32' ? isAliveWin32(pid) : isAliveGeneric(pid);
    assert.ok(earlyAlive, `子进程树 pid=${pid} 启动后应存活，但探测已死`);

    const ret = await killProcessTree(pid);
    assert.strictEqual(ret, true, 'killProcessTree(有效pid) 应 resolve true');

    // 轮询确认 2 秒内消失（间隔 100ms）
    const deadline = Date.now() + 2000;
    let dead = false;
    while (Date.now() <= deadline) {
      const alive = process.platform === 'win32' ? isAliveWin32(pid) : isAliveGeneric(pid);
      if (!alive) {
        dead = true;
        break;
      }
      await sleep(100);
    }
    assert.ok(dead, `进程树 pid=${pid} 应在 2 秒内消失，但轮询后仍存活`);
  } finally {
    // 超时兜底：失败时也要 kill，防止残留
    try {
      if (pid) {
        const stillAlive = process.platform === 'win32' ? isAliveWin32(pid) : isAliveGeneric(pid);
        if (stillAlive) {
          try {
            if (process.platform === 'win32') {
              childProcess.execSync(`taskkill /pid ${pid} /T /F`, { windowsHide: true, timeout: 5000, stdio: 'ignore' });
            } else {
              try { process.kill(-pid, 'SIGKILL'); } catch (_e) { try { process.kill(pid, 'SIGKILL'); } catch (_e2) {} }
            }
          } catch (_e) {}
        }
      }
    } catch (_e) {}
    try { if (child) child.kill('SIGKILL'); } catch (_e) {}
    try { if (child) child.unref && child.unref(); } catch (_e) {}
  }
}

async function main() {
  let passed = 0;
  let failed = 0;
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    }
  }

  await run('测试1 特殊字符与环境变量转义', test1_QuoteAndInvocation);
  await run('测试2 32KB预算守卫', test2_BudgetGuard);
  await run('测试3 PATH前置与大小写兼容', test3_EnvPathPrepend);
  await run('测试4 进程树递归强杀', test4_KillProcessTree);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e && e.stack || String(e));
  process.exitCode = 1;
});
