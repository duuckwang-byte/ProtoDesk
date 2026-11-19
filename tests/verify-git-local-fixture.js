'use strict';
/**
 * Git 本地 bare 夹具放行回归（纯 Node/CommonJS，不启动 Electron、不联网）
 *
 * 放行条件（缺一不可）：
 *   1) !app.isPackaged（未打包开发态）
 *   2) PLAND_GIT_ALLOW_LOCAL=1
 *   3) URL 为 file:/// 绝对路径，且路径存在并形如 bare git 仓库（HEAD + objects + refs + core.bare=true）
 *
 * 生产边界：未设置 env / 打包态 / 运行态未知一律 https-only；http、ssh、裸路径始终拒绝。
 * 其他 Git 安全校验（token 不拼 URL、NEED_HEAL、凭据非交互）不变，由既有测试覆盖。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const gitAuth = require('../git/auth');
const gitConfigStore = require('../git/config-store');

const ENV_KEY = 'PLAND_GIT_ALLOW_LOCAL';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-git-local-'));
const SAVED_ENV = process.env[ENV_KEY];
const SAFE_GIT_ENV = Object.assign({}, process.env, {
  GCM_INTERACTIVE: 'never',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
});

let passed = 0;
let failed = 0;

function ok(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { passed++; console.log(`[PASS] ${name}`); },
        (e) => { failed++; console.log(`[FAIL] ${name}: ${(e && e.message) || e}`); if (e && e.stack) console.log(e.stack); }
      );
    }
    passed++;
    console.log(`[PASS] ${name}`);
    return Promise.resolve();
  } catch (e) {
    failed++;
    console.log(`[FAIL] ${name}: ${(e && e.message) || e}`);
    if (e && e.stack) console.log(e.stack);
    return Promise.resolve();
  }
}

function setAllowLocal(v) {
  if (v == null) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = v;
}
function resetGate() {
  setAllowLocal(null);
  gitAuth._setPackagedForTest(null);
}
function expectBlocked(url, label) {
  assert.throws(
    () => gitAuth.assertAllowedRemoteUrl(url),
    (e) => e && e.code === 'GIT_URL_BLOCKED',
    `${label} 应被拒: ${JSON.stringify(url)}`
  );
}
function expectAllowed(url, label) {
  assert.strictEqual(gitAuth.assertAllowedRemoteUrl(url), true, `${label} 应放行: ${JSON.stringify(url)}`);
}
function git(args, cwd) {
  return spawnSync('git', args, {
    cwd: cwd || TMP,
    env: SAFE_GIT_ENV,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
}
function initBareRepo(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const r = git(['init', '--bare', '--initial-branch=main', dir]);
  assert.strictEqual(r.status, 0, `git init --bare 失败: ${String(r.stderr || r.stdout || '').trim()}`);
  return dir;
}
function walkJs(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (rel.startsWith('node_modules/') || rel.startsWith('tests/') || rel.startsWith('docs/')
      || rel.startsWith('dist/') || rel.startsWith('.devdata') || rel.startsWith('.git/')
      || rel.startsWith('桌面端/') || rel.startsWith('smoke-sandbox/')) continue;
    if (e.isDirectory()) walkJs(p, out);
    else if (e.isFile() && p.endsWith('.js') && !p.endsWith('.bak')) out.push(p);
  }
  return out;
}

async function main() {
  console.log(`GitLocalFixture: Node=${process.version} platform=${process.platform} root=${ROOT}`);

  const repoDir = initBareRepo('repo.git');
  const spacedDir = initBareRepo('bare repo with space.git');
  const notRepoDir = path.join(TMP, 'not-a-repo');
  fs.mkdirSync(notRepoDir, { recursive: true });
  const worktreeDir = path.join(TMP, 'worktree');
  fs.mkdirSync(worktreeDir, { recursive: true });
  const wt = git(['init', worktreeDir]);
  assert.strictEqual(wt.status, 0, `git init 工作区失败: ${String(wt.stderr || '').trim()}`);
  const worktreeGitUrl = pathToFileURL(path.join(worktreeDir, '.git')).href;
  const fakeBareDir = path.join(TMP, 'fake-bare.git');
  fs.mkdirSync(path.join(fakeBareDir, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(fakeBareDir, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(fakeBareDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
  fs.writeFileSync(path.join(fakeBareDir, 'config'), '[foo]\n\tbare = true\n', 'utf8');
  const fakeBareUrl = pathToFileURL(fakeBareDir).href;
  const plainFile = path.join(TMP, 'plain.txt');
  fs.writeFileSync(plainFile, 'not a repo\n', 'utf8');

  const repoUrl = pathToFileURL(repoDir).href;
  const spacedUrl = pathToFileURL(spacedDir).href;
  const notRepoUrl = pathToFileURL(notRepoDir).href;
  const plainFileUrl = pathToFileURL(plainFile).href;
  assert.ok(/^file:\/\/\//.test(repoUrl), `夹具 URL 应为 file:///，实际 ${repoUrl}`);

  try {
    /* ── A. 默认拒绝 / 生产边界 ── */
    await ok('A01 未设置 env + 开发态：file:/// 拒绝', () => {
      setAllowLocal(null);
      gitAuth._setPackagedForTest(false);
      expectBlocked(repoUrl, '默认 file://');
    });
    await ok('A02 env=1 + 打包态：file:/// 拒绝（生产不放宽）', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(true);
      expectBlocked(repoUrl, '打包态 file://');
    });
    await ok('A03 env=1 + 运行态未知：file:/// 拒绝（fail-closed）', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(null);
      expectBlocked(repoUrl, '未知运行态 file://');
    });
    await ok('A04 env 非 1（true/yes/0/空）一律拒绝', () => {
      gitAuth._setPackagedForTest(false);
      for (const v of ['true', 'yes', '0', '', ' 1x ']) {
        setAllowLocal(v);
        expectBlocked(repoUrl, `env=${JSON.stringify(v)}`);
      }
    });
    await ok('A05 未设置 env + 打包态：file:/// 拒绝', () => {
      setAllowLocal(null);
      gitAuth._setPackagedForTest(true);
      expectBlocked(repoUrl, '打包态默认 file://');
    });

    /* ── B. 开发态 + env：本地 bare 夹具放行 ── */
    await ok('B01 开发态 + env=1：file:/// bare 仓库放行', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectAllowed(repoUrl, 'dev+env file://');
    });
    await ok('B02 含空格路径（%20）放行', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      assert.ok(spacedUrl.includes('%20'), `夹具应含 %20 编码: ${spacedUrl}`);
      expectAllowed(spacedUrl, 'dev+env 含空格 file://');
    });
    await ok('B03 放行 URL 可被真实 git 读取（不联网）', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectAllowed(repoUrl, 'dev+env file://');
      const r = git(['ls-remote', repoUrl]);
      assert.strictEqual(r.status, 0, `git ls-remote 本地 bare 应成功: ${String(r.stderr || '').trim()}`);
    });
    await ok('B04 大写 FILE:/// 等价放行（协议大小写不敏感）', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectAllowed(repoUrl.replace(/^file:/i, 'FILE:'), 'dev+env FILE:///');
    });

    /* ── C. 即使开发态 + env，file:// 仍收紧 ── */
    await ok('C01 有主机名 file://server/... 拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('file://server/share/repo.git', 'file:// 主机名');
    });
    await ok('C02 UNC/双斜杠 file:////server/... 拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('file:////server/share/repo.git', 'file:// UNC');
    });
    await ok('C03 不存在/非仓库目录拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked(notRepoUrl, '普通目录');
      expectBlocked(pathToFileURL(path.join(TMP, 'nope-' + Date.now())).href, '不存在目录');
    });
    await ok('C04 普通文件路径拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked(plainFileUrl, '普通文件');
    });
    await ok('C05 查询串/片段拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked(repoUrl + '?x=1', 'query');
      expectBlocked(repoUrl + '#frag', 'hash');
    });
    await ok('C06 点段 .. / . 与编码点段/编码斜杠拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked(repoUrl + '/../repo.git', '.. 段');
      expectBlocked(repoUrl + '/./repo.git', '. 段');
      expectBlocked('file:///C:/x/%2e%2e/y', '%2e%2e 段');
      expectBlocked('file:///C:/x%2f..%2frepo.git', '%2f 编码斜杠');
      expectBlocked('file:///C:/x%0a/y', '%0a 控制字符');
    });
    await ok('C07 反斜杠 / 两斜杠 file:// 拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('file:\\\\C:\\repo.git', '反斜杠');
      expectBlocked('file://C:/repo.git', '两斜杠');
      expectBlocked('file:///C:/repo.git\\x', '尾反斜杠');
    });
    await ok('C08 带用户名/口令的 file:// 拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('file://user:pass@/C:/repo.git', 'file userinfo');
    });
    await ok('C09 工作区 .git（非 bare）拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked(worktreeGitUrl, '工作区 .git');
    });
    await ok('C10 bare=true 不在 [core] 段拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked(fakeBareUrl, '伪造 bare 配置');
    });

    /* ── D. 其他协议/裸路径：env 不得扩大放行面 ── */
    await ok('D01 http:// 拒绝（dev+env 下同样）', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('http://example.com/repo.git', 'http');
    });
    await ok('D02 ssh:// 与 scp 形态拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('ssh://git@example.com/repo.git', 'ssh');
      expectBlocked('git@example.com:repo.git', 'scp');
    });
    await ok('D03 裸绝对/相对/UNC 路径拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      for (const p of ['C:\\repo.git', 'C:/repo.git', '\\\\server\\share\\repo.git', '/home/user/repo.git', 'repo.git', './repo.git']) {
        expectBlocked(p, '裸路径');
      }
    });
    await ok('D04 危险参数/协议仍拒绝（ext::/fd::/--upload-pack）', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('ext::sh -c whoami', 'ext::');
      expectBlocked('fd::3', 'fd::');
      expectBlocked('https://example.com/a.git --upload-pack=whoami', '--upload-pack');
    });

    /* ── E. https 不受开关影响 ── */
    await ok('E01 https 正常放行（默认/打包态均放行）', () => {
      setAllowLocal(null);
      gitAuth._setPackagedForTest(false);
      expectAllowed('https://gitee.com/user/repo.git', 'https 默认');
      setAllowLocal('1');
      gitAuth._setPackagedForTest(true);
      expectAllowed('https://gitee.com/user/repo.git', 'https 打包态');
    });
    await ok('E02 https 携带用户信息仍拒绝', () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      expectBlocked('https://user:pass@example.com/repo.git', 'https userinfo');
    });

    /* ── F. 落盘入口二次校验（config-store） ── */
    await ok('F01 默认拒绝时 config-store 不落盘 file://', async () => {
      setAllowLocal(null);
      gitAuth._setPackagedForTest(false);
      const dir = fs.mkdtempSync(path.join(TMP, 'store-deny-'));
      const configPath = path.join(dir, 'git-config.json');
      gitConfigStore._setPathsForTest({ configPath, credPath: path.join(dir, 'git-credentials.json') });
      try {
        await assert.rejects(
          () => gitConfigStore.saveProjectGitConfig('', { remoteUrl: repoUrl, branch: 'main' }),
          (e) => e && e.code === 'GIT_URL_BLOCKED',
          '默认态 file:// 应被 config-store 拒绝'
        );
        assert.ok(!fs.existsSync(configPath), '被拒配置不得落盘');
      } finally {
        gitConfigStore._resetForTest();
      }
    });
    await ok('F02 打包态 + env=1 时 config-store 仍拒绝 file://', async () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(true);
      const dir = fs.mkdtempSync(path.join(TMP, 'store-packaged-'));
      const configPath = path.join(dir, 'git-config.json');
      gitConfigStore._setPathsForTest({ configPath, credPath: path.join(dir, 'git-credentials.json') });
      try {
        await assert.rejects(
          () => gitConfigStore.saveProjectGitConfig('', { remoteUrl: repoUrl, branch: 'main' }),
          (e) => e && e.code === 'GIT_URL_BLOCKED',
          '打包态 file:// 应被 config-store 拒绝'
        );
        assert.ok(!fs.existsSync(configPath), '打包态被拒配置不得落盘');
      } finally {
        gitConfigStore._resetForTest();
      }
    });
    await ok('F03 开发态 + env=1 时 config-store 可落盘 file://', async () => {
      setAllowLocal('1');
      gitAuth._setPackagedForTest(false);
      const dir = fs.mkdtempSync(path.join(TMP, 'store-allow-'));
      const configPath = path.join(dir, 'git-config.json');
      gitConfigStore._setPathsForTest({ configPath, credPath: path.join(dir, 'git-credentials.json') });
      try {
        await gitConfigStore.saveProjectGitConfig('', { remoteUrl: repoUrl, branch: 'main' });
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(raw.defaultConfig.remoteUrl, repoUrl, '放行态应持久化夹具 URL');
      } finally {
        gitConfigStore._resetForTest();
      }
    });
    await ok('F04 config-store 对 https 不受开关影响', async () => {
      setAllowLocal(null);
      gitAuth._setPackagedForTest(true);
      const dir = fs.mkdtempSync(path.join(TMP, 'store-https-'));
      const configPath = path.join(dir, 'git-config.json');
      gitConfigStore._setPathsForTest({ configPath, credPath: path.join(dir, 'git-credentials.json') });
      try {
        await gitConfigStore.saveProjectGitConfig('', { remoteUrl: 'https://gitee.com/u/r.git', branch: 'main' });
        assert.ok(fs.existsSync(configPath), 'https 配置应正常落盘');
      } finally {
        gitConfigStore._resetForTest();
      }
    });

    /* ── G. 静态边界：开关只允许出现在 git/auth.js ── */
    await ok('G01 生产代码仅 git/auth.js 读取 PLAND_GIT_ALLOW_LOCAL', () => {
      const files = walkJs(ROOT, []);
      const hits = files
        .filter((f) => { try { return fs.readFileSync(f, 'utf8').includes(ENV_KEY); } catch (e) { return false; } })
        .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
      assert.deepStrictEqual(hits, ['git/auth.js'], `env 只允许在 git/auth.js 生效，实际: ${hits.join(',')}`);
    });
    await ok('G02 生产代码仍保留 https-only 兜底', () => {
      const src = fs.readFileSync(path.join(ROOT, 'git', 'auth.js'), 'utf8');
      assert.ok(src.includes('默认仅支持 https:// 仓库地址'), '缺 https-only 兜底');
      assert.ok(src.includes('isPackagedApp') && src.includes('LOCAL_FIXTURE_ENV'), '缺打包态/env 双闸');
      assert.ok(src.includes('looksLikeBareRepoDir'), '缺 bare 仓库结构校验');
    });

    console.log(`\nSUMMARY passed=${passed} failed=${failed} total=${passed + failed}`);
    console.log(failed ? 'GITLOCAL_FAIL' : 'GITLOCAL_PASS');
    process.exitCode = failed ? 1 : 0;
  } finally {
    resetGate();
    try { gitConfigStore._resetForTest(); } catch (e) {}
    try {
      if (SAVED_ENV == null) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = SAVED_ENV;
    } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch((e) => {
  console.error('FATAL', (e && e.stack) || e);
  process.exitCode = 1;
});
