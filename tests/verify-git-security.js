'use strict';
// P0 Git安全回归：URL白名单 + 脱敏 + argv/落盘/嵌套/force（纯Node/CommonJS，不启动Electron）
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const gitAuth = require('../git/auth');
const gitConfigStore = require('../git/config-store');

// Wave-B兼容：主进程已拆为 main.js + main/controllers + main/services，聚合后断言（72通道契约不变）
function readMainAggregated() {
  const files = [path.join(ROOT, 'main.js')];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const pp = path.join(d, e.name);
      if (e.isDirectory()) walk(pp);
      else if (e.isFile() && pp.endsWith('.js')) files.push(pp);
    }
  };
  walk(path.join(ROOT, 'main'));
  return files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }).join('\n');
}

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => { passed++; console.log(`[PASS] ${name}`); }, (e) => { failed++; console.log(`[FAIL] ${name}: ${e && e.message || e}`); if (e && e.stack) console.log(e.stack); });
    passed++;
    console.log(`[PASS] ${name}`);
    return Promise.resolve();
  } catch (e) {
    failed++;
    console.log(`[FAIL] ${name}: ${e && e.message || e}`);
    if (e && e.stack) console.log(e.stack);
    return Promise.resolve();
  }
}
function expectBlocked(url, label) {
  assert.throws(() => gitAuth.assertAllowedRemoteUrl(url), (e) => e && e.code === 'GIT_URL_BLOCKED', `${label} 应被拒: ${JSON.stringify(url)}`);
}
const SECRET = 'SECRET_TOKEN_9f8e7d6c5b4a forage'.replace(' forage', '');
const SECRET_B = 'ghp_ABCDEF1234567890abcdef';

async function main() {
  console.log(`GitSecurity: Node=${process.version} platform=${process.platform} root=${ROOT}`);

  // ── A. URL黑名单矩阵（≥8拒 + 正常放行）──
  await ok('A01 ext:: 拒绝', () => expectBlocked('ext::sh -c whoami', 'ext::'));
  await ok('A02 fd:: 拒绝', () => expectBlocked('fd::3', 'fd::'));
  await ok('A03 file:// 拒绝', () => expectBlocked('file:///etc/passwd', 'file://'));
  await ok('A04 -e 参数拒绝', () => expectBlocked('https://example.com/a.git -e sh', '-e'));
  await ok('A05 --upload-pack 拒绝', () => expectBlocked('https://example.com/a.git --upload-pack=whoami', '--upload-pack'));
  await ok('A06 换行拒绝', () => expectBlocked('https://example.com/a.git\nrm -rf /', '换行'));
  await ok('A07 以-开头拒绝', () => expectBlocked('-e sh -- test', '以-开头'));
  await ok('A08 非https拒绝(http)', () => expectBlocked('http://example.com/a.git', '非https'));
  await ok('A09 带用户信息拒绝', () => expectBlocked('https://user:pass123@example.com/a.git', '用户信息'));
  await ok('A10 --receive-pack 拒绝', () => expectBlocked('https://example.com/a.git --receive-pack=x', '--receive-pack'));
  await ok('A11 --exec 拒绝', () => expectBlocked('https://example.com/a.git --exec=x', '--exec'));
  await ok('A12 正常https放行', () => { assert.strictEqual(gitAuth.assertAllowedRemoteUrl('https://gitee.com/user/repo.git'), true); });

  // ── B. 脱敏矩阵（≥12）──
  await ok('B01 user:pass@ 脱敏', () => {
    const r = gitAuth.redactSecrets('clone https://user:pass123@gitee.com/a/b.git done');
    assert.ok(r.includes('https://***:***@'), `应含***:***@, 实际:${r}`);
    assert.ok(!r.includes('pass123'), '不得残留明文口令');
  });
  await ok('B02 token@ 脱敏', () => {
    const r = gitAuth.redactSecrets('clone https://' + SECRET_B + '@gitee.com/a.git done');
    assert.ok(r.includes('https://***@'), `应含***@, 实际:${r}`);
    assert.ok(!r.includes(SECRET_B), '不得残留token明文');
  });
  await ok('B03 %编码(user%3Apass%40)脱敏', () => {
    const r = gitAuth.redactSecrets('url=https://user%3Apass123%40@gitee.com/x.git end');
    assert.ok(!r.includes('pass123'), `编码口令不得残留, 实际:${r}`);
    assert.ok(/\*\*\*/.test(r), `应打码, 实际:${r}`);
  });
  await ok('B04 Bearer 脱敏', () => {
    const r = gitAuth.redactSecrets('auth Bearer ' + SECRET_B + ' end');
    assert.ok(/bearer\s+\*\*\*\*/i.test(r), `实际:${r}`);
    assert.ok(!r.includes(SECRET_B));
  });
  await ok('B05 token= 脱敏', () => {
    const r = gitAuth.redactSecrets('login token=' + SECRET_B + ' ok');
    assert.ok(/token=\*\*\*\*/i.test(r), `实际:${r}`);
    assert.ok(!r.includes(SECRET_B));
  });
  await ok('B06 token: 脱敏', () => {
    const r = gitAuth.redactSecrets('login token: ' + SECRET_B + ' ok');
    assert.ok(/token:\s*\*\*\*\*/i.test(r), `实际:${r}`);
    assert.ok(!r.includes(SECRET_B));
  });
  await ok('B07 Basic base64 脱敏', () => {
    const r = gitAuth.redactSecrets('auth Basic dXNlcjpwYXNzMTIzNDU2 end');
    assert.ok(/basic\s+\*\*\*\*/i.test(r), `实际:${r}`);
    assert.ok(!r.includes('dXNlcjpwYXNzMTIzNDU2'));
  });
  await ok('B08 GIT_HTTP_EXTRAHEADER整行脱敏', () => {
    const r = gitAuth.redactSecrets('env GIT_HTTP_EXTRAHEADER: AUTHORIZATION: Basic abcdef123456 end');
    assert.ok(r.includes('GIT_HTTP_EXTRAHEADER: ***'), `实际:${r}`);
    assert.ok(!r.includes('abcdef123456'));
  });
  await ok('B09 http.extraHeader整行脱敏', () => {
    const r = gitAuth.redactSecrets('arg -c http.extraHeader=Bearer xyz12345678 end');
    assert.ok(r.includes('http.extraHeader: ***'), `实际:${r}`);
    assert.ok(!r.includes('xyz12345678'));
  });
  await ok('B10 超长截断2000', () => {
    const r = gitAuth.redactSecrets('A'.repeat(2500));
    assert.ok(r.length <= 2010, `截断后长度应≤2010, 实际:${r.length}`);
    assert.ok(r.endsWith('...（已截断）'), `应以截断标记结尾, 实际尾:${JSON.stringify(r.slice(-20))}`);
  });
  await ok('B11 private_token= 脱敏', () => {
    const r = gitAuth.redactSecrets('x private_token=abcdef1234567890 y');
    assert.ok(/private_token=\*\*\*\*/i.test(r), `实际:${r}`);
    assert.ok(!r.includes('abcdef1234567890'));
  });
  await ok('B12 access_token: 脱敏', () => {
    const r = gitAuth.redactSecrets('x access_token: abcdef1234567890 y');
    assert.ok(/access_token:\s*\*\*\*\*/i.test(r), `实际:${r}`);
    assert.ok(!r.includes('abcdef1234567890'));
  });
  await ok('B13 oauth2双段@ 脱敏', () => {
    const r = gitAuth.redactSecrets('https://oauth2:glpat-xyz12345678@gitee.com/a.git');
    assert.ok(!r.includes('glpat-xyz12345678'), `实际:${r}`);
    assert.ok(r.includes('***'), `实际:${r}`);
  });

  // ── C. argv无Token ──
  await ok('C01 buildGitAuthUrl已删除(零残留)', () => {
    const m = readMainAggregated();
    const all = (m.match(/buildGitAuthUrl\s*\(/g) || []).length;
    // Wave-B已删除废弃拼URL函数：定义与调用均为0（新链路走gitAuth.buildGitAuthEnv + 裸URL）
    assert.strictEqual(all, 0, `buildGitAuthUrl( 应为0(已删除), 实际:${all}`);
  });
  await ok('C02 runGit含argv凭据URL红线(AUTH_URL_BLOCKED)', () => {
    const m = readMainAggregated();
    const i = m.indexOf('function runGit(');
    assert.ok(i >= 0, 'runGit缺失');
    const body = m.slice(i, i + 2500);
    assert.ok(body.includes('AUTH_URL_BLOCKED'), 'runGit应含AUTH_URL_BLOCKED');
    assert.ok(/https\?/.test(body) && body.includes('@'), 'runGit应检测argv中含@的http(s)凭据URL');
  });
  await ok('C03 buildGitAuthEnv走extraHeader不拼URL', () => {
    const auth = gitAuth.buildGitAuthEnv({ username: 'u', token: 'p@ss:特殊' });
    assert.ok(auth && auth.envAdd && auth.envAdd.GIT_HTTP_EXTRAHEADER, '应返回GIT_HTTP_EXTRAHEADER');
    assert.ok(Array.isArray(auth.argsPrefix) && auth.argsPrefix.join(' ').includes('http.extraHeader='), 'argsPrefix应含http.extraHeader=');
    assert.ok(!('url' in auth), '不得返回拼Token的url字段');
    assert.ok(!String(auth.argsPrefix.join(' ')).includes('https://u:'), 'argsPrefix不得含凭据URL');
  });

  // ── D. 落盘无Token ──
  await ok('D01 config-store落盘剥离token/username/password', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-gitsec-'));
    const configPath = path.join(tmp, 'git-config.json');
    const credPath = path.join(tmp, 'git-credentials.json');
    gitConfigStore._setPathsForTest({ configPath, credPath });
    try {
      const tok = SECRET + '_DISK_' + Date.now();
      const usr = 'diskuser_' + Date.now();
      await gitConfigStore.saveProjectGitConfig('P0Proj', { remoteUrl: 'https://gitee.com/u/r.git', branch: 'main', authorName: 'a', authorEmail: 'a@b.c', token: tok, username: usr, password: tok });
      assert.ok(fs.existsSync(configPath), '配置文件应落盘');
      const raw = fs.readFileSync(configPath, 'utf8');
      assert.ok(!raw.includes(tok), '落盘文件不得含token明文');
      assert.ok(!raw.includes(usr), '落盘文件不得含username明文');
      assert.ok(!/token|password/i.test(raw) || !raw.includes('_DISK_'), `落盘不得含token/password字段残留, 实际:${raw.slice(0, 300)}`);
      const parsed = JSON.parse(raw);
      const proj = (parsed.projects && parsed.projects.P0Proj) || {};
      assert.ok(!('token' in proj) && !('password' in proj) && !('username' in proj), `项目节只存白名单4字段, 实际keys:${Object.keys(proj).join(',')}`);
    } finally {
      try { gitConfigStore._resetForTest(); } catch (e) {}
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  });
  await ok('D02 getProjectGitConfig对外无token字段', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-gitsec2-'));
    gitConfigStore._setPathsForTest({ configPath: path.join(tmp, 'git-config.json'), credPath: path.join(tmp, 'git-credentials.json') });
    try {
      await gitConfigStore.saveProjectGitConfig('', { remoteUrl: 'https://gitee.com/u/r.git', branch: 'main' });
      const view = gitConfigStore.getProjectGitConfig('');
      assert.ok(!('token' in view), `脱敏视图不得含token字段, 实际keys:${Object.keys(view).join(',')}`);
      assert.ok('hasToken' in view && 'tokenMasked' in view, '应含hasToken/tokenMasked');
    } finally {
      try { gitConfigStore._resetForTest(); } catch (e) {}
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  });

  // ── E. 嵌套.git默认不删 ──
  await ok('E01 ensureSandboxGitRepo零rmSync(默认不删)', () => {
    const m = readMainAggregated();
    const s = m.indexOf('async function ensureSandboxGitRepo');
    assert.ok(s >= 0, 'ensureSandboxGitRepo缺失');
    const e = m.indexOf("ipcMain.handle('git:config-get'", s);
    const body = m.slice(s, e > s ? e : s + 3000);
    assert.ok(!body.includes('rmSync'), 'ensure内不得含rmSync(默认不删, 仅上报NEED_HEAL)');
    assert.ok(body.includes('needHeal') || body.includes('NEED_HEAL') || /no auto delete/i.test(body) || body.includes('不上报') || body.includes('上报'), 'ensure应走needHeal上报');
  });
  await ok('E02 checkGitHealNeeded收口嵌套/缺库/坏库', () => {
    const m = readMainAggregated();
    const s = m.indexOf('async function checkGitHealNeeded');
    assert.ok(s >= 0, 'checkGitHealNeeded缺失');
    const body = m.slice(s, s + 1500);
    assert.ok(body.includes('detectNestedGit'), '应检测嵌套');
    assert.ok(body.includes('needHeal'), '应返回needHeal');
  });
  await ok('E03 heal-repair先备份后隔离(非rm -rf)', () => {
    const m = readMainAggregated();
    assert.ok(m.includes(".heal-backup"), '应含.heal-backup备份');
    assert.ok(/\.bak-/.test(m), '应含.bak-隔离改名');
  });

  // ── G. 跨文件引用完整（git:status/fetch-diff曾报isValidBranch未定义） ──
  await ok('G01 共享函数有定义来源', () => {
    const s = fs.readFileSync(path.join(ROOT, 'main', 'services', 'git-workflow-service.js'), 'utf8');
    for (const n of ['isValidBranch', 'isSafeGitRel', 'isSubPath', 'logsDir', 'killProcessTree']) {
      assert.ok(s.includes(n), '须引用' + n);
    }
    assert.ok(/require\(['"]\.\/sandbox-storage-service['"]\)/.test(s), '须从存储服务引入');
    assert.ok(/require\(['"]\.\.\/\.\.\/platform\/process['"]\)/.test(s), '须从platform引入killProcessTree');
    const store = fs.readFileSync(path.join(ROOT, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');
    for (const n of ['isValidBranch', 'isSafeGitRel', 'isSubPath', 'logsDir']) {
      assert.ok(new RegExp('function ' + n + '\\(').test(store), '存储服务须定义' + n);
    }
  });
  await ok('G02 非法分支名在spawn前拒绝', async () => {
    const gw = require('../main/services/git-workflow-service');
    assert.strictEqual(typeof gw.gitStatusImpl, 'function', '须暴露gitStatusImpl');
    const r = await gw.gitStatusImpl(null, { project: '', branch: 'bad branch!!' });
    assert.ok(r && r.ok === false && r.error === '非法分支名', `非法分支须拒收，实际:${JSON.stringify(r)}`);
  });
  await ok('G03 推送拉取成功须同步origin追踪', () => {
    const s = fs.readFileSync(path.join(ROOT, 'main', 'services', 'git-workflow-service.js'), 'utf8');
    assert.ok(/function gitSyncOriginRef\(/.test(s), '缺追踪同步函数');
    assert.ok(/update-ref/.test(s) && /refs\/remotes\/origin\//.test(s), '须经update-ref写origin追踪');
    const pushFn = s.slice(s.indexOf('async function gitPushImpl'), s.indexOf('async function gitPushImpl') + 9000);
    assert.ok(pushFn.includes('gitSyncOriginRef(branch)'), '推送成功后须同步追踪');
    assert.ok(pushFn.includes('所选文件暂存为空'), '空暂存须诚实报错不得谎报成功');
    assert.ok(/filesCount: stagedList\.length/.test(pushFn), '上报数须为实际暂存数');
  });
  await ok('G04 失败必有文本且落盘', () => {    const s = fs.readFileSync(path.join(ROOT, 'main', 'services', 'git-workflow-service.js'), 'utf8');
    assert.ok(/function gitPushFailLog\(/.test(s), '缺失败落盘函数');
    assert.ok(s.includes('无任何返回'), '空输出须有兜底文案');
    const dom = fs.readFileSync(path.join(ROOT, 'js', 'git-ui', 'git-domain.js'), 'utf8');
    assert.ok(/详情：/.test(dom), '报错条须带出详情文本');
  });
  await ok('G05 凭证按项目无则回退默认', () => {
    const s = fs.readFileSync(path.join(ROOT, 'git', 'config-store.js'), 'utf8');
    const fn = s.slice(s.indexOf('function _readCredentialsSync'), s.indexOf('function _readCredentialsSync') + 2500);
    assert.ok(fn.includes("__default__"), '须回退默认凭证键');
  });  await ok('G06 拉取列表工作区感知', () => {
    const gw = require('../main/services/git-workflow-service');
    assert.strictEqual(typeof gw.gitPullAdjustEntries, 'function', '须暴露gitPullAdjustEntries');
    const en = (p, code, label) => {
      const ps = String(p).split('/');
      return { path: p, project: ps[0], proto: ps[1], subPath: ps.slice(2).join('/'), code, label };
    };
    const H = 'a'.repeat(40), H2 = 'b'.repeat(40);
    // 已拉取（工作区与远端同内容）须剔除
    let r = gw.gitPullAdjustEntries(
      [en('P/Q/Q.html', 'mod', '修改')],
      { 'P/Q/Q.html': H }, { 'P/Q/Q.html': H },
      () => true
    );
    assert.deepStrictEqual(r, [], '已同步须清空');
    // 未拉取须保留原标签
    r = gw.gitPullAdjustEntries(
      [en('P/Q/Q.html', 'mod', '修改')],
      { 'P/Q/Q.html': H }, { 'P/Q/Q.html': H2 },
      () => true
    );
    assert.strictEqual(r.length, 1, '未同步须保留');
    assert.strictEqual(r[0].code, 'mod', '保留原标签');
    // 本地已删但远端有 → 新增（可恢复）
    r = gw.gitPullAdjustEntries(
      [en('P/Q/Q.md', 'mod', '修改')],
      { 'P/Q/Q.md': H }, {},
      () => false
    );
    assert.strictEqual(r.length, 1, '删除须保留一条');
    assert.strictEqual(r[0].code, 'add', '删除须标新增');
    // 远端有、工作区缺、提交比对没列出 → 补新增
    r = gw.gitPullAdjustEntries(
      [],
      { 'P/Q/旧文件.html': H }, {},
      () => false
    );
    assert.strictEqual(r.length, 1, '漏列的缺失须补回');
    assert.strictEqual(r[0].code, 'add', '补回须标新增');
    // 远端无、工作区缺 → 不打扰
    r = gw.gitPullAdjustEntries(
      [en('P/Q/gone.html', 'del', '删除')],
      {}, {},
      () => false
    );
    assert.deepStrictEqual(r, [], '两边都没有须剔除');
  });
  // ── F. force无令牌/无确认不执行 ──
  await ok('F01 后端仅force显式才加--force', () => {
    const m = readMainAggregated();
    assert.ok(/if\s*\(force\)\s*pushArgs\.push\('--force'\)/.test(m), '应为 if (force) pushArgs.push(--force)');
    assert.ok(m.includes('const force = !!(o && o.force)'), 'force应来自o.force显式标志');
  });
  await ok('F02 前端强制覆盖须键入分支名一致才执行', () => {
    const s = fs.readFileSync(path.join(ROOT, 'js', 'project-ai-export.js'), 'utf8');
    assert.ok(s.includes('gitForceConfirmInput'), '应含强制确认输入框');
    assert.ok(/v !== String\(branch/.test(s), '应校验输入与分支名一致');
    assert.ok(s.includes('executeGitPush(true)'), '一致后才executeGitPush(true)');
  });

  console.log(`\nSUMMARY passed=${passed} failed=${failed} total=${passed + failed}`);
  console.log(failed ? 'GITSEC_FAIL' : 'GITSEC_PASS');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exitCode = 1; });
