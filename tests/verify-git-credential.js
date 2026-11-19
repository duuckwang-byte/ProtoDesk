'use strict';
/**
 * Git 凭据弹窗回归（独立测试，不联网、不真实 push）：
 * A. 所有 git 子进程强制 `-c credential.helper=`，即使本地配置了 helper 也不会被调用；
 * B. push 不再使用 `-u <url>`，不会把 branch.<name>.remote 写成 URL；
 * C. branch.*.remote=URL / 缺 merge 的 upstream 自愈；
 * D. 无 Token 时 list-branches/status/push/pull/fetch-diff/test-connection 均不触发凭据交互；
 * E. 源码红线（runGit 统一空 helper、status 零远端命令、ensure 自愈）。
 * 只使用本地临时仓库与本地 bare 仓库，不访问任何远端。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVICE = path.join(ROOT, 'main', 'services', 'git-workflow-service.js');
const gitConfigStore = require('../git/config-store');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-gitcred-'));
const ORIGINAL_CWD = process.cwd();

/* 测试隔离：忽略本机全局/系统 gitconfig，避免本机 credential.helper=manager 在“正向对照”里被拉起 */
const EMPTY_GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(EMPTY_GITCONFIG, '', 'utf8');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = EMPTY_GITCONFIG;

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

/** 同步执行 git（只用于搭临时仓库；业务路径统一走 service.runGit） */
function git(cwd, args, extra) {
  const env = Object.assign({}, process.env, {
    GCM_INTERACTIVE: 'never',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    SSH_ASKPASS: 'echo',
  }, (extra && extra.env) || {});
  return spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    input: extra && extra.input != null ? extra.input : undefined,
  });
}
function gitText(cwd, args) {
  const r = git(cwd, args);
  return { status: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}
function mustGit(cwd, args, label) {
  const r = gitText(cwd, args);
  assert.strictEqual(r.status, 0, `${label || 'git ' + args.join(' ')} 应成功，实际: ${r.err || r.out}`);
  return r.out;
}
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  mustGit(dir, ['init', '-b', 'main'], 'git init');
  mustGit(dir, ['config', 'user.name', 'Test User'], 'git config user.name');
  mustGit(dir, ['config', 'user.email', 'test@local'], 'git config user.email');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n', 'utf8');
  mustGit(dir, ['add', 'a.txt'], 'git add');
  mustGit(dir, ['commit', '-m', 'init'], 'git commit');
}
function configGet(cwd, key) {
  const r = gitText(cwd, ['config', '--local', '--get', key]);
  return r.status === 0 ? r.out : '';
}
function configSet(cwd, key, value) {
  mustGit(cwd, ['config', '--local', key, value], 'git config ' + key);
}
function exists(p) {
  try { return fs.existsSync(p); } catch (e) { return false; }
}

async function main() {
  console.log(`GitCredential: Node=${process.version} platform=${process.platform} root=${ROOT}`);

  /* ── 准备：临时 sandbox（service 的 paths.SANDBOX_ROOT 在 require 时取 process.cwd()/sandbox） ── */
  const sandbox = path.join(TMP, 'sandbox');
  initRepo(sandbox);
  mustGit(sandbox, ['remote', 'add', 'origin', 'https://example.com/repo.git'], 'remote add origin');
  /* 复现线上 bug：branch.main.remote 被历史 `push -u <url>` 写成 URL */
  configSet(sandbox, 'branch.main.remote', 'https://example.com/repo.git');
  configSet(sandbox, 'branch.main.merge', 'refs/heads/main');

  process.chdir(TMP);
  gitConfigStore._setPathsForTest({
    configPath: path.join(TMP, 'git-config.json'),
    credPath: path.join(TMP, 'git-credentials.json'),
  });
  await gitConfigStore.saveProjectGitConfig('', {
    remoteUrl: 'https://example.com/repo.git',
    branch: 'main',
    authorName: 'Test User',
    authorEmail: 'test@local',
  });

  /* 必须在 chdir 之后 require，让 paths.SANDBOX_ROOT 指向临时 sandbox */
  const gw = require('../main/services/git-workflow-service');

  try {
    /* ── A. credential.helper 覆盖 ── */
    await ok('A01 buildGitSpawnArgs 统一注入空 credential.helper', () => {
      const args = gw.buildGitSpawnArgs(['ls-remote', '--heads', 'https://example.com/repo.git']);
      assert.deepStrictEqual(args.slice(0, 5), ['-c', 'core.quotepath=false', '-c', 'credential.helper=', 'ls-remote'],
        `argv 前缀不正确: ${JSON.stringify(args)}`);
      const withAuth = gw.buildGitSpawnArgs(['-c', 'http.extraHeader=AUTHORIZATION: Basic eA==', 'push', 'https://example.com/r.git', 'HEAD:refs/heads/main']);
      assert.strictEqual(withAuth[3], 'credential.helper=', '带 token 的 argv 也必须含空 helper');
      assert.ok(withAuth.indexOf('credential.helper=') < withAuth.indexOf('http.extraHeader=AUTHORIZATION: Basic eA=='),
        '空 helper 必须排在 extraHeader 之前，不能被覆盖');
    });

    await ok('A02 非交互环境不可被调用方覆盖', () => {
      const env = gw.buildGitChildEnv({ GCM_INTERACTIVE: 'always', GIT_TERMINAL_PROMPT: '1' });
      assert.strictEqual(env.GCM_INTERACTIVE, 'never', 'GCM_INTERACTIVE 必须强制 never');
      assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0', 'GIT_TERMINAL_PROMPT 必须强制 0');
      assert.strictEqual(env.GIT_ASKPASS, 'echo', 'GIT_ASKPASS 必须强制 echo');
      assert.strictEqual(env.SSH_ASKPASS, 'echo', 'SSH_ASKPASS 必须强制 echo');
    });

    await ok('A03 真实 git 语义：空 helper 后本地 helper 不再被调用', () => {
      const repo = path.join(TMP, 'cred-repo');
      initRepo(repo);
      const marker = path.join(repo, 'helper-called.txt');
      mustGit(repo, ['config', '--local', 'credential.helper', '!echo called >> helper-called.txt'], '配置假 helper');
      const fillInput = 'protocol=https\nhost=example.com\n\n';

      /* 正向对照：不注入空 helper 时 helper 会被调用（证明假 helper 生效） */
      const raw = git(repo, ['credential', 'fill'], { input: fillInput });
      assert.ok(raw.status === 0 || raw.status === 128, `对照命令应结束，实际 status=${raw.status}`);
      assert.ok(exists(marker), '对照：未注入空 helper 时 helper 应被调用');

      try { fs.unlinkSync(marker); } catch (e) {}
      /* 业务 argv：与 runGit 完全一致（buildGitSpawnArgs） */
      const args = gw.buildGitSpawnArgs(['credential', 'fill']);
      const r = git(repo, args, { input: fillInput });
      assert.ok(r.status === 0 || r.status === 128, `凭据填充应快速结束，实际 status=${r.status}`);
      assert.ok(!exists(marker), '注入空 helper 后不得再调用 credential helper（GCM 不会被拉起）');
    });

    /* ── B. push 不再 -u URL ── */
    await ok('B01 显式 URL push 不写 branch.remote（本地 bare 仓库）', () => {
      const repo = path.join(TMP, 'push-repo');
      const bare = path.join(TMP, 'push-remote.git');
      initRepo(repo);
      mustGit(TMP, ['init', '--bare', bare], 'git init --bare');
      const r = spawnSync('git', gw.buildGitSpawnArgs(['push', bare, 'HEAD:refs/heads/main']), {
        cwd: repo,
        env: gw.buildGitChildEnv({}),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      });
      assert.strictEqual(r.status, 0, `本地 push 应成功，实际: ${String(r.stderr || '')}`);
      assert.strictEqual(configGet(repo, 'branch.main.remote'), '', '不得把 URL 写入 branch.main.remote');
      assert.strictEqual(configGet(repo, 'branch.main.merge'), '', '不得隐式写 branch.main.merge');
    });

    await ok('B02 根因对照：旧写法 push -u <url> 会把 URL 写进 branch.remote', () => {
      const repo = path.join(TMP, 'push-u-repo');
      const bare = path.join(TMP, 'push-u-remote.git');
      initRepo(repo);
      mustGit(TMP, ['init', '--bare', bare], 'git init --bare');
      const r = gitText(repo, ['push', '-u', bare, 'HEAD:refs/heads/main']);
      assert.strictEqual(r.status, 0, `旧写法本地 push 应成功，实际: ${r.err}`);
      assert.strictEqual(configGet(repo, 'branch.main.remote'), bare, '旧写法确实把地址写进了 branch.main.remote');
    });

    await ok('B03 gitPushImpl 源码不再出现 push -u', () => {
      const src = fs.readFileSync(SERVICE, 'utf8');
      const s = src.indexOf('async function gitPushImpl');
      assert.ok(s >= 0, 'gitPushImpl 缺失');
      const body = src.slice(s, src.indexOf('function gitPushFailLog', s));
      assert.ok(!/pushArgs\s*=\s*\[\.\.\.auth\.argsPrefix,\s*'push',\s*'-u'\]/.test(body), 'pushArgs 不得含 -u');
      assert.ok(!/'push',\s*'-u'/.test(body), '不得以 -u 形式 push');
      assert.ok(/pushArgs\.push\(plainUrl,\s*`HEAD:refs\/heads\/\$\{branch\}`\)/.test(body), '应保留显式 URL + refspec 推送');
    });

    /* ── C. upstream 自愈 ── */
    await ok('C01 URL 形态 branch.remote 改写为 origin 并补齐 merge', async () => {
      const repo = path.join(TMP, 'heal-repo');
      initRepo(repo);
      mustGit(repo, ['remote', 'add', 'origin', 'https://example.com/repo.git'], 'remote add origin');
      configSet(repo, 'branch.main.remote', 'https://example.com/repo.git');
      configSet(repo, 'branch.main.merge', 'refs/heads/main');
      const r = await gw.healGitUpstream(repo, 'main', 'https://example.com/repo.git');
      assert.strictEqual(r.healed, true, `应报告 healed，实际: ${JSON.stringify(r)}`);
      assert.ok(r.branches.indexOf('main') >= 0, `应包含 main，实际: ${JSON.stringify(r.branches)}`);
      assert.strictEqual(configGet(repo, 'branch.main.remote'), 'origin', 'branch.main.remote 应为 origin');
      assert.strictEqual(configGet(repo, 'branch.main.merge'), 'refs/heads/main', 'merge 应保持 refs/heads/main');
      assert.strictEqual(mustGit(repo, ['remote', 'get-url', 'origin'], 'remote get-url'), 'https://example.com/repo.git', 'origin 应指向配置 URL');
    });

    await ok('C02 upstream 缺失 merge 时补齐（恢复 @{u} 解析）', async () => {
      const repo = path.join(TMP, 'heal-merge-repo');
      initRepo(repo);
      mustGit(repo, ['remote', 'add', 'origin', 'https://example.com/repo.git'], 'remote add origin');
      configSet(repo, 'branch.main.remote', 'origin');
      mustGit(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'], 'update-ref origin/main');
      const r = await gw.healGitUpstream(repo, 'main', 'https://example.com/repo.git');
      assert.strictEqual(r.healed, true, `应补 merge，实际: ${JSON.stringify(r)}`);
      assert.strictEqual(configGet(repo, 'branch.main.merge'), 'refs/heads/main');
      const up = gitText(repo, ['rev-parse', '--abbrev-ref', '@{u}']);
      assert.strictEqual(up.status, 0, `@{u} 应可解析，实际: ${up.err}`);
      assert.strictEqual(up.out, 'origin/main', `@{u} 应为 origin/main，实际: ${up.out}`);
    });

    await ok('C03 自愈幂等且无仓库时不抛错', async () => {
      const repo = path.join(TMP, 'heal-idem-repo');
      initRepo(repo);
      mustGit(repo, ['remote', 'add', 'origin', 'https://example.com/repo.git'], 'remote add origin');
      configSet(repo, 'branch.main.remote', 'origin');
      configSet(repo, 'branch.main.merge', 'refs/heads/main');
      const r1 = await gw.healGitUpstream(repo, 'main', 'https://example.com/repo.git');
      assert.strictEqual(r1.healed, false, '已健康配置不应重复改写');
      const r2 = await gw.healGitUpstream(path.join(TMP, 'not-a-repo'), 'main', 'https://example.com/repo.git');
      assert.strictEqual(r2.healed, false, '不存在仓库应安全返回');
    });

    await ok('C04 URL 形态识别覆盖 https / scp / 本地路径', () => {
      assert.strictEqual(gw.isGitRemoteUrlValue('https://gitee.com/u/r.git'), true);
      assert.strictEqual(gw.isGitRemoteUrlValue('git@github.com:u/r.git'), true);
      assert.strictEqual(gw.isGitRemoteUrlValue('D:\\repos\\r.git'), true);
      assert.strictEqual(gw.isGitRemoteUrlValue('/srv/git/r.git'), true);
      assert.strictEqual(gw.isGitRemoteUrlValue('origin'), false);
      assert.strictEqual(gw.isGitRemoteUrlValue('upstream'), false);
    });

    /* ── D. 无 Token 通道行为 ── */
    await ok('D01 无凭据判定只在有 token 时为真', () => {
      assert.strictEqual(gw.hasUsableGitCredential(null), false);
      assert.strictEqual(gw.hasUsableGitCredential({ username: 'u' }), false);
      assert.strictEqual(gw.hasUsableGitCredential({ token: '   ' }), false);
      assert.strictEqual(gw.hasUsableGitCredential({ username: 'u', token: 't' }), true);
    });

    await ok('D02 git:status 本地可用且入口自愈 URL upstream', async () => {
      /* 再次制造 bug 配置，验证 status 入口（ensureSandboxGitRepo）会自愈 */
      configSet(sandbox, 'branch.main.remote', 'https://example.com/repo.git');
      const t0 = Date.now();
      const r = await gw.gitStatusImpl(null, { project: '', branch: 'main' });
      const elapsed = Date.now() - t0;
      assert.strictEqual(r.ok, true, `status 应返回本地结果，实际: ${JSON.stringify(r)}`);
      assert.strictEqual(r.branch, 'main');
      assert.ok(typeof r.totalCount === 'number', 'status 应返回 totalCount');
      assert.strictEqual(configGet(sandbox, 'branch.main.remote'), 'origin', 'status 入口应自愈 branch.main.remote');
      assert.ok(elapsed < 15000, `status 不应有远端等待，实际 ${elapsed}ms`);
    });

    await ok('D03 git:list-branches 无 Token 直接返回 NEED_AUTH 且不发网络', async () => {
      const t0 = Date.now();
      const r = await gw.gitListBranchesImpl(null, { project: '', branch: 'main' });
      const elapsed = Date.now() - t0;
      assert.strictEqual(r.ok, false, `无凭据应返回错误，实际: ${JSON.stringify(r)}`);
      assert.strictEqual(r.code, 'NEED_AUTH', `应为 NEED_AUTH，实际: ${r.code}`);
      assert.ok(String(r.error || '').length > 0, '应有明确错误文案');
      assert.strictEqual(r.remoteConfigured, true, '应保持 remoteConfigured=true');
      assert.ok(Array.isArray(r.branches) && r.branches.indexOf('main') >= 0, '应仍附本地分支');
      assert.ok(elapsed < 5000, `无凭据时不得等待 ls-remote，实际 ${elapsed}ms`);
    });

    await ok('D04 无 Token 时 test-connection/fetch-diff/pull/push 全部 NEED_AUTH 且不提交', async () => {
      const t = await gw.gitTestConnectionImpl(null, { project: '', remoteUrl: 'https://example.com/repo.git' });
      assert.strictEqual(t.code, 'NEED_AUTH', `test-connection: ${JSON.stringify(t)}`);

      const f = await gw.gitFetchDiffImpl(null, { project: '', branch: 'main' });
      assert.strictEqual(f.code, 'NEED_AUTH', `fetch-diff: ${JSON.stringify(f)}`);

      const p = await gw.gitPullImpl(null, { project: '', branch: 'main' });
      assert.strictEqual(p.code, 'NEED_AUTH', `pull: ${JSON.stringify(p)}`);

      const headBefore = mustGit(sandbox, ['rev-parse', 'HEAD'], 'rev-parse HEAD');
      const push = await gw.gitPushImpl(null, { project: '', branch: 'main', files: ['a.txt'] });
      assert.strictEqual(push.code, 'NEED_AUTH', `push: ${JSON.stringify(push)}`);
      const headAfter = mustGit(sandbox, ['rev-parse', 'HEAD'], 'rev-parse HEAD');
      assert.strictEqual(headAfter, headBefore, '无凭据 push 不应产生本地提交');
    });

    await ok('D05 无 Token 时 status 不调用 credential helper', async () => {
      const marker = path.join(sandbox, 'helper-called.txt');
      try { fs.unlinkSync(marker); } catch (e) {}
      configSet(sandbox, 'credential.helper', '!echo called >> helper-called.txt');
      try {
        const r = await gw.gitStatusImpl(null, { project: '', branch: 'main' });
        assert.strictEqual(r.ok, true, `status 应成功，实际: ${JSON.stringify(r)}`);
        assert.ok(!exists(marker), 'status 不应调用任何 credential helper');
      } finally {
        mustGit(sandbox, ['config', '--local', '--unset', 'credential.helper'], '清理假 helper');
        try { fs.unlinkSync(marker); } catch (e) {}
      }
    });

    await ok('D06 保存配置时自愈 URL upstream', async () => {
      configSet(sandbox, 'branch.main.remote', 'https://example.com/repo.git');
      const r = await gw.gitConfigSaveImpl(null, {
        project: '',
        config: { remoteUrl: 'https://example.com/repo.git', branch: 'main' },
      });
      assert.strictEqual(r.ok, true, `config-save 应成功，实际: ${JSON.stringify(r)}`);
      assert.strictEqual(configGet(sandbox, 'branch.main.remote'), 'origin', '保存配置应自愈 branch.main.remote');
      assert.strictEqual(configGet(sandbox, 'branch.main.merge'), 'refs/heads/main', '保存配置应保留 merge');
    });

    /* ── E. 源码红线 ── */
    await ok('E01 runGit 统一走 buildGitSpawnArgs（空 helper 单源）', () => {
      const src = fs.readFileSync(SERVICE, 'utf8');
      assert.ok(/const GIT_CREDENTIAL_HELPER_ARGS\s*=\s*Object\.freeze\(\['-c',\s*'credential\.helper='\]\)/.test(src),
        '应定义空 credential helper 参数常量');
      const s = src.indexOf('function runGit(');
      const body = src.slice(s, src.indexOf('async function healGitUpstream', s));
      assert.ok(body.includes('buildGitSpawnArgs(args)'), 'runGit 必须使用 buildGitSpawnArgs 构造 argv');
      assert.ok(body.includes('windowsHide: true'), 'runGit 必须保持 windowsHide');
    });

    await ok('E02 list-branches 在 ls-remote 之前做凭据前置', () => {
      const src = fs.readFileSync(SERVICE, 'utf8');
      const s = src.indexOf('async function gitListBranchesImpl');
      const body = src.slice(s, src.indexOf('async function gitTestConnectionImpl', s));
      const guard = body.indexOf('hasUsableGitCredential');
      const net = body.indexOf("'ls-remote'");
      assert.ok(guard >= 0, 'list-branches 应含凭据前置');
      assert.ok(net > guard, '凭据前置必须早于 ls-remote');
      assert.ok(body.includes('gitAuthRequiredResult'), '无凭据应返回 NEED_AUTH');
    });

    await ok('E03 status 通道零远端命令（不会被 GCM 波及）', () => {
      const src = fs.readFileSync(SERVICE, 'utf8');
      const s = src.indexOf('async function gitStatusImpl');
      const body = src.slice(s, src.indexOf('async function gitPushImpl', s));
      assert.ok(!/['"](ls-remote|fetch|push|pull)['"]/.test(body), 'status 不得包含远端 git 子命令');
      assert.ok(body.includes('不发起任何远端请求'), '应保留无网络说明');
    });

    await ok('E04 ensureSandboxGitRepo / heal-repair 均调用 upstream 自愈', () => {
      const src = fs.readFileSync(SERVICE, 'utf8');
      const ensureStart = src.indexOf('async function ensureSandboxGitRepo');
      const ensureBody = src.slice(ensureStart, src.indexOf('async function gitConfigGetImpl', ensureStart));
      assert.ok(ensureBody.includes('healGitUpstream(paths.SANDBOX_ROOT'), 'ensureSandboxGitRepo 应调用 healGitUpstream');
      const healStart = src.indexOf('async function gitHealRepairImpl');
      const healBody = src.slice(healStart, src.indexOf('module.exports', healStart));
      assert.ok(healBody.includes('healGitUpstream(paths.SANDBOX_ROOT'), 'heal-repair 应调用 healGitUpstream');
    });
  } finally {
    try { process.chdir(ORIGINAL_CWD); } catch (e) {}
    try { gitConfigStore._resetForTest(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\nSUMMARY passed=${passed} failed=${failed} total=${passed + failed}`);
  console.log(failed ? 'GITCRED_FAIL' : 'GITCRED_PASS');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error('FATAL', (e && e.stack) || e);
  process.exitCode = 1;
});
