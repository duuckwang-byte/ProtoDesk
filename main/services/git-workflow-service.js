'use strict';
/**
 * main/services/git-workflow-service.js — GitWorkflowService（Wave-B）
 * 职责：命令封装（runGit argv 红线）、读写锁（withGitLock）、凭据（git/config-store 分离）、自愈备份。
 * 已删除冗余：saveGitConfig / buildGitAuthUrl / loadGitConfig（废弃明文/拼 URL）；pad 收敛 shared.pad2。
 *
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} GitStatusResult {code:'add'|'mod'|'del'|'conflict', label:string}
 * @typedef {Object} GitOpResult {ok:boolean, error?:string, cancelled?:boolean}
 * @param {string} projectName 项目名 (gitConfigGetImpl/status 等首参, 空串表默认项目)
 * @param {Object} [opts] 操作选项 (push/pull 的 force/branch 等, 由各 Impl 做防御性清洗)
 * @returns {Promise<GitOpResult>} Git 操作结果 (凭据永不回显, 错误经 sanitizeGitError 脱敏)
 */
const path = require('path');
const fs = require('fs');
const os = require('node:os');
const { spawn } = require('child_process');
const gitAuth = require('../../git/auth');
const gitConfigStore = require('../../git/config-store');
const shared = require('../state');
const paths = require('../paths');
/* 分支名/路径/日志目录校验单源复用（sandbox-storage-service、platform/process 已导出；此前漏引导致 git:status/fetch-diff 等通道 ReferenceError） */
const { isValidBranch, isSafeGitRel, isSubPath, logsDir } = require('./sandbox-storage-service');
const { killProcessTree } = require('../../platform/process');

const GIT_STATUS_MAP={M:'mod',A:'add',D:'del',R:'mod',C:'mod',U:'add',T:'mod','?':'add'};
function gitHandledPath(handledSet, relPath){ if(!relPath||handledSet.has(relPath)) return true; handledSet.add(relPath); return false; }
function gitStatusCode(flag){ var f=String(flag||'').trim(); if(f==='UU'||f==='AA') return 'conflict'; var ch=f.charAt(0); return GIT_STATUS_MAP[ch]||GIT_STATUS_MAP['?']||'mod'; }
function gitStatusLabel(code){ return code==='add'?'新增':code==='del'?'删除':code==='conflict'?'冲突':'修改'; }
function gitStatusInfo(flag){ var code=gitStatusCode(flag); return {code:code, label:gitStatusLabel(code)}; }
function gitIsBusy() { return !!shared.gitState.busy; }
async function withGitLock(mode, opName, fn) {
  if (mode === 'write') {
    if (shared.gitState.busy) return { ok: false, error: 'git-busy', currentOp: shared.gitState.busy.op };
    shared.gitState.busy = { op: opName, startedAt: Date.now() };
    try { return await fn(); } finally { shared.gitState.busy = null; }
  }
  // read：写忙时最多等待 2s，否则返回 git-busy（避免 UI 卡死）
  if (shared.gitState.busy) {
    const t0 = Date.now();
    while (shared.gitState.busy && (Date.now() - t0) < 2000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (shared.gitState.busy) return { ok: false, error: 'git-busy', currentOp: shared.gitState.busy.op };
  }
  return await fn();
}
function detectNestedGit() {
  const nested = [];
  try {
    const entries = fs.readdirSync(paths.SANDBOX_ROOT, { withFileTypes: true });
    for (const d of entries) {
      try {
        if (!d.isDirectory()) continue;
        if (d.name === '.git' || d.name === '.heal-backup' || d.name === '.pull-backup') continue;
        const p = path.join(paths.SANDBOX_ROOT, d.name, '.git');
        if (fs.existsSync(p)) nested.push(d.name + '/.git');
      } catch (e) {}
    }
  } catch (e) {}
  return nested;
}
async function checkSandboxRepoHealth() {
  const gitDir = path.join(paths.SANDBOX_ROOT, '.git');
  try {
    if (!fs.existsSync(gitDir)) return { healthy: false, reason: 'missing' };
  } catch (e) { return { healthy: false, reason: 'missing' }; }
  try {
    const r = await runGit(paths.SANDBOX_ROOT, ['rev-parse', '--git-dir'], 5000);
    if (r && r.status === 0) return { healthy: true };
    let detail = '';
    try { detail = gitAuth.redactSecrets(String((r && (r.stderr || r.stdout)) || '')); } catch (e) {}
    return { healthy: false, reason: 'broken', detail };
  } catch (e) {
    return { healthy: false, reason: 'broken', detail: String((e && e.message) || e) };
  }
}
function fmtGitTs(d) {
  const p = shared.pad2;
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
/** P0-D4 自愈检查：嵌套 .git / 缺库 / 坏库统一收口，调用方据此返回 NEED_HEAL（不做任何删除） */
async function checkGitHealNeeded() {
  let nested = [];
  try { nested = detectNestedGit(); } catch (e) {}
  if (nested && nested.length) return { needHeal: true, reason: 'nested', nested };
  try {
    const h = await checkSandboxRepoHealth();
    if (!h.healthy) return { needHeal: true, reason: h.reason || 'missing', nested: [], detail: h.detail || '' };
  } catch (e) {}
  return { needHeal: false, nested: [] };
}
/** P0-D3 拉取备份：把本次 files 中本地现存文件拷贝到 sandbox/.pull-backup/<时间>-<branch>/ */
function backupPullFiles(files, branch) {
  const safeBranch = String(branch || 'main').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40) || 'main';
  const backupDir = path.join(paths.SANDBOX_ROOT, '.pull-backup', fmtGitTs(new Date()) + '-' + safeBranch);
  try { fs.mkdirSync(backupDir, { recursive: true }); } catch (e) {}
  try {
    for (const rel of (files || [])) {
      try {
        if (!rel || typeof rel !== 'string') continue;
        const src = path.join(paths.SANDBOX_ROOT, rel);
        let st = null;
        try { st = fs.statSync(src); } catch (e) { continue; }
        if (!st || !st.isFile()) continue;
        const dst = path.join(backupDir, rel);
        try { fs.mkdirSync(path.dirname(dst), { recursive: true }); } catch (e) {}
        try { fs.copyFileSync(src, dst); } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}
  return backupDir;
}
/** 取项目凭据（同步优先，兼容新旧两套入参：o.username/o.token 显式覆盖 > 安全存储） */
function resolveGitCredentials(projName, o) {
  let username = '';
  let token = '';
  try {
    const saved = gitConfigStore.getProjectGitCredentialsSync(projName);
    if (saved) { username = String(saved.username || ''); token = String(saved.token || ''); }
  } catch (e) {}
  try {
    if (o && o.username != null && String(o.username) !== '') username = String(o.username);
    if (o && o.token != null && String(o.token) !== '') token = String(o.token);
  } catch (e) {}
  return { username, token };
}

/**
 * @deprecated 旧直读写保留（回滚影子），新代码请走 git/config-store.js
 * 保留签名，仅用于存量迁移兜底；正常链路不再调用本函数写 token。
 */
function getProjectGitConfig(projectName) {
  return gitConfigStore.getProjectGitConfig(projectName);
}
function sanitizeGitError(errText) {
  try { return gitAuth.sanitizeGitError(errText); } catch (e) {}
  if (!errText) return '操作失败';
  let t = String(errText).trim();
  t = t.replace(/https:\/\/[^:@]+:[^@]+@/g, 'https://***:***@');
  if (/Authentication failed|401|403|not authorized|could not read Username|Invalid username or password/i.test(t)) {
    return 'Git 鉴权失败：账号密码或 Access Token 错误或已过期（请确保 Token 已开启 write_repository 读写权限）';
  }
  if (/Could not resolve host|Connection refused|timed out|Failed to connect/i.test(t)) {
    return '网络连接失败：无法访问 Git 远程仓库，请检查网络或仓库地址';
  }
  if (/Repository not found|remote: Not Found/i.test(t)) {
    return '远程仓库不存在或无访问权限，请核对仓库 URL';
  }
  if (/fetch first|non-fast-forward|Updates were rejected/i.test(t)) {
    return '远程仓库存在未同步的新版本，请先执行拉取同步后再上传';
  }
  return t;
}

function decodeGitOctal(str) {
  if (!str) return '';
  let s = String(str).trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  if (s.indexOf('\\') >= 0) {
    try {
      const bytes = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i + 3 < s.length && /^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
          bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
          i += 3;
        } else if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '\\') {
          bytes.push(92);
          i += 1;
        } else {
          bytes.push(s.charCodeAt(i));
        }
      }
      return Buffer.from(bytes).toString('utf8');
    } catch (e) {}
  }
  return s;
}

function runGit(cwd, args, timeoutMs = 30000, extraEnv) {
  // 兼容新签名：第三参可为 {timeoutMs, envAdd}，第四参可为 envAdd
  let timeout = 30000;
  let envAdd = {};
  try {
    if (timeoutMs && typeof timeoutMs === 'object') {
      timeout = (timeoutMs.timeoutMs != null ? timeoutMs.timeoutMs : 30000);
      envAdd = timeoutMs.envAdd || timeoutMs.extraEnv || {};
    } else {
      timeout = (timeoutMs == null ? 30000 : timeoutMs);
      if (extraEnv && typeof extraEnv === 'object') envAdd = extraEnv;
    }
  } catch (e) {}
  // P0 安全红线：argv 含凭据 URL 直接抛错（倒逼上层走 extraHeader + 裸 URL）
  try {
    const list = Array.isArray(args) ? args : [];
    const hit = list.some((a) => typeof a === 'string' && /https?:\/\/[^\s]*@[^\s]*/.test(a));
    if (hit) {
      const err = new Error('AUTH_URL_BLOCKED: argv 中禁止携带凭据 URL，须走 http.extraHeader');
      err.code = 'AUTH_URL_BLOCKED';
      return Promise.reject(err);
    }
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return Promise.reject(e);
  }
  return new Promise((resolve) => {
    try {
      const gitArgs = ['-c', 'core.quotepath=false', ...args];
      const child = spawn('git', gitArgs, {
        cwd,
        env: Object.assign({}, process.env, {
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C.UTF-8'
        }, envAdd || {}),
        windowsHide: true
      });
      try { shared.gitCurrentChild = child; } catch (e) {}
      let stdout = '', stderr = '';
      let timer = null;
      let settled = false;
      const done = (obj) => { if (settled) return; settled = true; try { if (timer) clearTimeout(timer); } catch (e) {} try { if (shared.gitCurrentChild === child) shared.gitCurrentChild = null; } catch (e) {} resolve(obj); };
      if (timeout > 0) {
        timer = setTimeout(async () => {
          if (settled) return;
          try { await killProcessTree(child.pid); } catch (e) {}
          try { child.kill('SIGKILL'); } catch (e) {}
          done({ status: 124, stdout, stderr: 'Git 操作超时 (' + timeout + 'ms，已整树终止)', timedOut: true });
        }, timeout);
      }
      child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      child.on('error', (err) => {
        done({ status: -1, stdout, stderr: String(err && err.message || err), timedOut: false });
      });
      child.on('close', (status) => {
        done({ status: status != null ? status : 0, stdout, stderr, timedOut: false });
      });
    } catch (e) {
      resolve({ status: -1, stdout: '', stderr: String(e && e.message || e), timedOut: false });
    }
  });
}

/**
 * @deprecated 静默 rm -rf 已废止（P0-D4）。保留签名，内部改为检测上报，不做任何删除。
 * 新链路：先 checkGitHealNeeded()，需修复走 git:heal-repair（备份后隔离）。
 */
async function ensureSandboxGitRepo(cfg) {
  try{
  if (!fs.existsSync(paths.SANDBOX_ROOT)) fs.mkdirSync(paths.SANDBOX_ROOT, { recursive: true });

  // P0-D4：不再 rm -rf 嵌套 .git，仅检测上报（调用方据此返回 NEED_HEAL）
  let nested = [];
  try { nested = detectNestedGit(); } catch (e) {}
  if (nested && nested.length) {
    try { console.warn('[git] detect nested .git (no auto delete):', nested.join(',')); } catch (e) {}
    return { ok: false, needHeal: true, reason: 'nested', nested };
  }
  // 缺库 / 坏库同样上报，不自动 init（由 git:heal-repair 经确认后修复）
  try {
    const h = await checkSandboxRepoHealth();
    if (!h.healthy) return { ok: false, needHeal: true, reason: h.reason || 'missing', nested: [], detail: h.detail || '' };
  } catch (e) {}

  const branch = (cfg && cfg.branch) || 'main';
  const gitDir = path.join(paths.SANDBOX_ROOT, '.git');
  if (!fs.existsSync(gitDir)) {
    // 健康检查已拦截缺库，此处仅为极端竞态兜底：仍需确认才 init，故直接返回 NEED_HEAL
    return { ok: false, needHeal: true, reason: 'missing', nested: [] };
  }

  await runGit(paths.SANDBOX_ROOT, ['config', 'core.quotepath', 'false']);

  if (cfg && cfg.remoteUrl) {
    // P0 安全：改写 origin 前先过白名单
    try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
      throw Object.assign(new Error(String((e && e.message) || e)), { code: (e && e.code) || 'GIT_URL_BLOCKED' });
    }
    const remotes = await runGit(paths.SANDBOX_ROOT, ['remote']);
    if (remotes.stdout.indexOf('origin') >= 0) {
      await runGit(paths.SANDBOX_ROOT, ['remote', 'set-url', 'origin', String(cfg.remoteUrl).trim()]);
    } else {
      await runGit(paths.SANDBOX_ROOT, ['remote', 'add', 'origin', String(cfg.remoteUrl).trim()]);
    }
  }
  if (cfg && cfg.authorName) {
    await runGit(paths.SANDBOX_ROOT, ['config', 'user.name', cfg.authorName]);
  }
  if (cfg && cfg.authorEmail) {
    await runGit(paths.SANDBOX_ROOT, ['config', 'user.email', cfg.authorEmail]);
  }
  return { ok: true, nested: [] };
  }catch(e){ try{ dialog.showMessageBoxSync({type:'error', title:'Git初始化失败', message: gitAuth.redactSecrets(String(e.message))}); }catch(_e){} throw e; }
}

function gitConfigGetImpl(ev, projectName) {
  // P0：返回脱敏视图（无 token 字段，token 已脱敏；签名不变）
  const cfg = getProjectGitConfig(projectName);
  return { ok: true, config: cfg };

}
async function gitConfigSaveImpl(ev, o) {
  const projName = (o && o.project) || '';
  const cfg = (o && o.config) || {};
  // P0 安全：入口先过 URL 白名单（含 remoteUrl 时）
  try {
    if (cfg.remoteUrl != null && String(cfg.remoteUrl).trim() !== '') {
      gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl));
    }
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  // P0 凭据分离：非敏感走 config-store 剥离落盘；凭据走 safeStorage/内存（空提交=不更新）
  try {
    await gitConfigStore.saveProjectGitConfig(projName, cfg);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  try {
    if ((cfg.token != null && String(cfg.token) !== '') || (cfg.username != null && String(cfg.username) !== '')) {
      await gitConfigStore.saveProjectGitCredentials(projName, { username: cfg.username, token: cfg.token });
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }

  const effCfg = getProjectGitConfig(projName);
  // 自愈：嵌套/缺库/坏库返回 NEED_HEAL（不自动修）
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) {
      return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '', config: effCfg };
    }
  } catch (e) {}
  try {
    await ensureSandboxGitRepo(effCfg);
  } catch (e) {
    if (e && (e.code === 'GIT_URL_BLOCKED')) return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: gitAuth.sanitizeGitError(String((e && e.message) || e)) };
  }
  return { ok: true, config: getProjectGitConfig(projName) };

}
async function gitListBranchesImpl(ev, o) {
  const projName = (o && o.project) || '';
  const cfg = getProjectGitConfig(projName);
  const remoteUrl = String((o && o.remoteUrl) || cfg.remoteUrl || '').trim();
  const cred = resolveGitCredentials(projName, o);
  const username = cred.username;
  const token = cred.token;
  const branches = new Set();
  if (cfg.branch) branches.add(cfg.branch);
  branches.add('main');
  branches.add('master');

  // P1-1（顺带）：无远端返回本地分支 + remoteConfigured:false（不调远端）
  if (!remoteUrl) {
    if (fs.existsSync(path.join(paths.SANDBOX_ROOT, '.git'))) {
      try {
        const locRes = await runGit(paths.SANDBOX_ROOT, ['branch', '--list']);
        if (locRes.status === 0 && locRes.stdout) {
          locRes.stdout.split(/\r?\n/).forEach((b) => {
            const name = b.replace(/^[\*\s]+/, '').trim();
            if (name && name !== '(HEAD' && !name.startsWith('(')) branches.add(name);
          });
        }
      } catch (e) {}
    }
    return { ok: true, branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main', remoteConfigured: false };
  }
  // P0 安全：远端先过白名单
  try { gitAuth.assertAllowedRemoteUrl(remoteUrl); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  // P0-D4：嵌套/坏库上报（list-branches 同样守门，但无远端时已提前返回本地分支）
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) {
      // 仍附带本地分支，便于前端展示；主体 code 为 NEED_HEAL
      if (fs.existsSync(path.join(paths.SANDBOX_ROOT, '.git'))) {
        try {
          const locRes = await runGit(paths.SANDBOX_ROOT, ['branch', '--list']);
          if (locRes.status === 0 && locRes.stdout) {
            locRes.stdout.split(/\r?\n/).forEach((b) => {
              const name = b.replace(/^[\*\s]+/, '').trim();
              if (name && name !== '(HEAD' && !name.startsWith('(')) branches.add(name);
            });
          }
        } catch (e) {}
      }
      return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main', remoteConfigured: true };
    }
  } catch (e) {}

  if (remoteUrl) {
    // P0：extraHeader + 裸 URL（特殊字符 Token 免编码，绝不拼 Token URL）
    const auth = gitAuth.buildGitAuthEnv({ username, token });
    const plainUrl = remoteUrl;
    try {
      const remRes = await runGit(paths.SANDBOX_ROOT, [...auth.argsPrefix, 'ls-remote', '--heads', plainUrl], { timeoutMs: 15000, envAdd: auth.envAdd });
      if (remRes.status === 0 && remRes.stdout) {
        remRes.stdout.split(/\r?\n/).forEach((line) => {
          const parts = line.split(/\s+/);
          const ref = parts[1] || '';
          if (ref.startsWith('refs/heads/')) {
            branches.add(ref.replace('refs/heads/', '').trim());
          }
        });
      }
    } catch (e) {
      if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
      throw e;
    }
  }

  if (fs.existsSync(path.join(paths.SANDBOX_ROOT, '.git'))) {
    const locRes = await runGit(paths.SANDBOX_ROOT, ['branch', '--list']);
    if (locRes.status === 0 && locRes.stdout) {
      locRes.stdout.split(/\r?\n/).forEach((b) => {
        const name = b.replace(/^[\*\s]+/, '').trim();
        if (name && name !== '(HEAD' && !name.startsWith('(')) branches.add(name);
      });
    }
  }

  return { ok: true, branches: Array.from(branches).filter(Boolean), currentBranch: cfg.branch || 'main', remoteConfigured: true };

}
async function gitTestConnectionImpl(ev, cfg) {
  if (!cfg || !cfg.remoteUrl) return { ok: false, error: '请先填写远程仓库地址' };
  const remoteUrl = String(cfg.remoteUrl).trim();
  try { gitAuth.assertAllowedRemoteUrl(remoteUrl); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  // 兼容：显式传入优先，否则回读安全存储（特殊字符免编码）
  let username = (cfg.username != null ? String(cfg.username) : '');
  let token = (cfg.token != null ? String(cfg.token) : '');
  try {
    const projName = (cfg && cfg.project) || '';
    const saved = gitConfigStore.getProjectGitCredentialsSync(projName);
    if ((username === '' || username == null) && saved && saved.username) username = String(saved.username);
    if ((token === '' || token == null) && saved && saved.token) token = String(saved.token);
  } catch (e) {}
  const auth = gitAuth.buildGitAuthEnv({ username, token });
  const t0 = Date.now();
  let res = null;
  try {
    res = await runGit(process.cwd(), [...auth.argsPrefix, 'ls-remote', '--heads', remoteUrl], { timeoutMs: 15000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const latency = Date.now() - t0;
  if (res.status === 0) {
    return { ok: true, latency };
  }
  if (res.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(res.stderr || res.stdout) };
  return { ok: false, error: sanitizeGitError(res.stderr || res.stdout) };

}
async function gitStatusImpl(ev, o) {
  return withGitLock('read', 'status', async () => {
  const projName = (typeof o === 'string' ? o : (o && o.project)) || '';
  const targetBranch = (o && o.branch) || (getProjectGitConfig(projName).branch) || 'main';
  if (!isValidBranch(targetBranch)) return { ok: false, error: '非法分支名' };
  const cfg = getProjectGitConfig(projName);
  // P0-D4：嵌套/缺库/坏库直接返回 NEED_HEAL（不自动修）
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }

  const handledPaths = new Set();
  const tree = {};
  let totalCount = 0;
  // D-G1 已归一：复用顶层 GIT_STATUS_MAP（原 statusMap 合并至 GIT_STATUS_MAP，handledPaths 通过 gitHandledPath 共享去重逻辑）

  // 1. 工作区未提交变更
  const res = await runGit(paths.SANDBOX_ROOT, ['status', '--porcelain=v1', '-uall']);
  if (res.status === 0 && res.stdout) {
    const lines = res.stdout.split(/\r?\n/).filter(Boolean);
    lines.forEach((line) => {
      const flag = line.slice(0, 2);
      const relRaw = decodeGitOctal(line.slice(3).trim());
      // L02: R/C 重命名场景下 relRaw 为 "old -> new"，需双路径入库
      const relRaws = relRaw.split(" -> ").map(s => s.trim()).filter(Boolean);
      relRaws.forEach((singleRaw) => {
        const relPath = singleRaw.replace(/\\/g, '/');
        if (!relPath || relPath === '.git' || relPath.startsWith('.git/') || gitHandledPath(handledPaths, relPath)) return;
        const st = gitStatusInfo(flag);
        const parts = relPath.split('/');
        const pProject = parts.length > 2 ? parts[0] : (parts.length > 1 ? parts[0] : '默认项目');
        const pProto = parts.length > 2 ? parts[1] : (parts.length > 1 ? parts[1] : parts[0]);
        const pSub = parts.length > 2 ? parts.slice(2).join('/') : (parts.length > 1 ? parts.slice(1).join('/') : relPath);
        tree[pProject] = tree[pProject] || {};
        tree[pProject][pProto] = tree[pProject][pProto] || [];
        tree[pProject][pProto].push({
          path: relPath,
          project: pProject,
          proto: pProto,
          subPath: pSub,
          code: st.code,
          label: st.label
        });
        totalCount++;
      });
    });
  }

  // 2. 本地已提交但未推送到目标分支的变更
  try {
    const headCheck = await runGit(paths.SANDBOX_ROOT, ['rev-parse', 'HEAD']);
    if (headCheck.status === 0 && headCheck.stdout.trim()) {
      let remoteExists = false;
      const remoteCheck = await runGit(paths.SANDBOX_ROOT, ['rev-parse', '--verify', 'origin/' + targetBranch]);
      if (remoteCheck.status === 0) remoteExists = true;

      let unpushedLines = [];
      if (remoteExists) {
        const diffRes = await runGit(paths.SANDBOX_ROOT, ['diff', '--name-status', 'origin/' + targetBranch + '..HEAD']);
        if (diffRes.status === 0) unpushedLines = diffRes.stdout.split(/\r?\n/).filter(Boolean);
      } else {
        const lsRes = await runGit(paths.SANDBOX_ROOT, ['ls-tree', '-r', '--name-only', 'HEAD']);
        if (lsRes.status === 0) unpushedLines = lsRes.stdout.split(/\r?\n/).filter(Boolean).map((f) => 'A\t' + f);
      }

      unpushedLines.forEach((line) => {
        const parts = line.split(/\t+|\s+/);
        const flag = parts[0] ? parts[0].slice(0, 1) : 'A';
        var _si=gitStatusInfo(flag); const stCode=_si.code; const label=_si.label;
        // L02: --name-status 重命名时 parts[1] 为 old, parts[2] 为 new，需双入库
        const candidates = [];
        if (parts[1]) candidates.push(parts[1]);
        if (parts[2]) candidates.push(parts[2]);
        if (!candidates.length) candidates.push(line);
        candidates.forEach((rawPath) => {
          const relPath = decodeGitOctal(rawPath).replace(/\\/g, '/');
          if (!relPath || relPath === '.git' || relPath.startsWith('.git/') || gitHandledPath(handledPaths, relPath)) return;
          const pathParts = relPath.split('/');
          const pProject = pathParts.length > 2 ? pathParts[0] : (pathParts.length > 1 ? pathParts[0] : '默认项目');
          const pProto = pathParts.length > 2 ? pathParts[1] : (pathParts.length > 1 ? pathParts[1] : pathParts[0]);
          const pSub = pathParts.length > 2 ? pathParts.slice(2).join('/') : (pathParts.length > 1 ? pathParts.slice(1).join('/') : relPath);
          tree[pProject] = tree[pProject] || {};
          tree[pProject][pProto] = tree[pProject][pProto] || [];
          tree[pProject][pProto].push({
            path: relPath,
            project: pProject,
            proto: pProto,
            subPath: pSub,
            code: stCode,
            label
          });
          totalCount++;
        });
      });
    }
  } catch (e) {}

  const projectList = Object.keys(tree).map((pName) => {
    const protoList = Object.keys(tree[pName]).map((prName) => ({
      proto: prName,
      files: tree[pName][prName]
    })).sort((a, b) => a.proto.localeCompare(b.proto, 'zh-CN'));
    return {
      project: pName,
      isCurrent: (pName === projName),
      protos: protoList
    };
  }).sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return a.project.localeCompare(b.project, 'zh-CN');
  });

  return { ok: true, projects: projectList, totalCount, branch: targetBranch };
  });

}
async function gitPushImpl(ev, o) {
  return withGitLock('write', 'push', async () => {
  const projName = (o && o.project) || '';
  const files = (o && Array.isArray(o.files)) ? o.files : [];
  const message = (o && o.message && o.message.trim()) || '更新原型与文档数据';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };
  const force = !!(o && o.force);

  if (!cfg.remoteUrl) return { ok: false, code: 'NEED_CONFIG', error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  if (!files.length) return { ok: false, error: '请勾选需要上传的文件' };
  try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const cred = resolveGitCredentials(projName, o);
  const auth = gitAuth.buildGitAuthEnv(cred);
  const plainUrl = String(cfg.remoteUrl).trim();

  // 1. 重置当前暂存区
  await runGit(paths.SANDBOX_ROOT, ['reset']);

  // 2. 依次暂存选中的工作区文件
  for (const rel of files) {
    const joined = path.join(paths.SANDBOX_ROOT, rel);
    if (!isSafeGitRel(rel) || !isSubPath(joined, paths.SANDBOX_ROOT)) { // G03 git:push isSafeGitRel + isSubPath double check, -- retained
      try {
        const dir = logsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const d = new Date(); const p2 = shared.pad2;
        const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
        const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
        try { var st = fs.statSync(path.join(dir, 'app-' + ymd + '.log')); if (st.size > 5*1024*1024) fs.renameSync(path.join(dir, 'app-' + ymd + '.log'), path.join(dir, 'app-' + ymd + '.1.log')); } catch (e) {}
        fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][WARN][git:push] skip unsafe rel: ' + String(rel) + '\n', 'utf8');
      } catch (e) {}
      try { console.warn('[WARN][git:push] skip unsafe rel', rel); } catch (e) {}
      continue;
    }
    const full = joined;
    if (fs.existsSync(full)) {
      await runGit(paths.SANDBOX_ROOT, ['add', '--', rel]);
    } else {
      await runGit(paths.SANDBOX_ROOT, ['rm', '--cached', '--ignore-unmatch', '--', rel]);
    }
  }

  // 3. 检查是否有需要新提交的内容
  const stagedCheck = await runGit(paths.SANDBOX_ROOT, ['diff', '--cached', '--name-only']);
  const stagedList = (stagedCheck.status === 0 && stagedCheck.stdout) ? stagedCheck.stdout.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean) : [];
  if (!stagedList.length) {
    return { ok: false, error: '所选文件暂存为空，未能提交（可能文件不存在或与HEAD无差异）。请检查勾选后再试。' };
  }
  {
    const commitRes = await runGit(paths.SANDBOX_ROOT, ['commit', '-m', message]);
    if (commitRes.status !== 0 && commitRes.stdout.indexOf('nothing to commit') < 0) {
      const ce = sanitizeGitError(commitRes.stderr || commitRes.stdout) || ('提交失败且git无任何返回（分支[' + branch + ']）');
      try { gitPushFailLog('commit', commitRes.stderr || commitRes.stdout); } catch (e) {}
      return { ok: false, error: ce };
    }
  }

  // 4. 推送到远程分支（HEAD:refs/heads/${branch}，支持 --force 覆盖远程清空/分叉）
  // P0：extraHeader + 裸 URL（特殊字符 Token 免编码）
  const pushArgs = [...auth.argsPrefix, 'push', '-u'];
  if (force) pushArgs.push('--force');
  pushArgs.push(plainUrl, `HEAD:refs/heads/${branch}`);

  let pushRes = null;
  try {
    pushRes = await runGit(paths.SANDBOX_ROOT, pushArgs, { timeoutMs: 35000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  if (pushRes.timedOut) {
    try { gitPushFailLog('push-timeout', pushRes.stderr || pushRes.stdout); } catch (e) {}
    return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(pushRes.stderr || pushRes.stdout) || '推送远端35秒无响应且无任何返回，请检查网络/VPN后重试' };
  }
  if (pushRes.status !== 0) {
    const rawErr = pushRes.stderr || pushRes.stdout;
    try { gitPushFailLog('push', rawErr); } catch (e) {}
    const needPull = /fetch first|non-fast-forward|Updates were rejected/i.test(rawErr);
    if (needPull) {
      return {
        ok: false,
        needPull,
        canForce: needPull,
        error: '远程仓库存在不一致的历史版本（如远端被清空或重置）。您可以先执行拉取同步，或点击「强制覆盖上传」将本地沙箱完整发布至远程。'
      };
    }
    return { ok: false, error: sanitizeGitError(rawErr) || '推送失败且远端无任何返回，请检查网络/凭证后重试' };
  }
  /* 推送成功即远端==HEAD：同步追踪，下次状态比对不再把已推文件算成新增 */
  try { await gitSyncOriginRef(branch); } catch (e) {}

  return { ok: true, message: force ? '强制覆盖发布成功' : '发布成功', filesCount: stagedList.length, branch, forced: force };
  });

}
/* 推送/提交失败落盘（脱敏）：app-<日期>.log，供下次报错时直接定位 */
function gitPushFailLog(step, raw) {
  try {
    const dir = logsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const d = new Date(); const p2 = shared.pad2;
    const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    let txt = '';
    try { txt = gitAuth.redactSecrets(String(raw == null ? '' : raw)).slice(0, 500); } catch (e) { txt = ''; }
    fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][git:push] ' + step + ' failed: ' + txt + '\n', 'utf8');
  } catch (e) {}
}
/* 推送/拉取成功后同步本地 origin/<branch> 追踪到已知远端位置：
 * 本工具推送走显式 URL、拉取只动 FETCH_HEAD，origin/* 从不自动前进，
 * 会导致状态比对永远拿旧锚点算“未推送”（已推文件反复显示为新增）。 */
async function gitSyncOriginRef(branch, sha) {
  try {
    const b = String(branch || 'main');
    if (!isValidBranch(b)) return;
    let shaOut = String(sha || '').trim();
    if (!shaOut) {
      try {
        const r = await runGit(paths.SANDBOX_ROOT, ['rev-parse', 'HEAD']);
        if (!r || r.status !== 0) return;
        shaOut = String(r.stdout || '').trim();
      } catch (e) { return; }
    }
    if (!/^[0-9a-f]{40}$/i.test(shaOut)) return;
    try { await runGit(paths.SANDBOX_ROOT, ['update-ref', 'refs/remotes/origin/' + b, shaOut]); } catch (e) {}
  } catch (e) {}
}
/* 拉取列表工作区修正（纯函数，可单测）：
 * diffEntries: 提交比对条目 [{path,project,proto,subPath,code,label}]
 * remoteSha: {path: blobSha}（远端 FETCH_HEAD 全树）
 * workHash: {path: sha}（工作区现存文件的哈希）
 * exists: (relPath) => bool（工作区是否存在）
 * 规则：工作区缺失但远端有 → 新增（可恢复）；内容与远端一致 → 剔除（已拉取）；其余保留提交标签 */
function gitPullAdjustEntries(diffEntries, remoteSha, workHash, exists) {
  const out = [];
  const seen = {};
  try {
    (diffEntries || []).forEach((en) => {
      if (!en || !en.path || seen[en.path]) return;
      seen[en.path] = 1;
      let alive = true;
      try { alive = !!exists(en.path); } catch (e) { alive = true; }
      if (!alive) {
        if (remoteSha && remoteSha[en.path]) {
          out.push({ path: en.path, project: en.project, proto: en.proto, subPath: en.subPath, code: 'add', label: '新增' });
        }
        return;
      }
      try {
        const rs = remoteSha && remoteSha[en.path];
        const ws = workHash && workHash[en.path];
        if (rs && ws && String(rs).toLowerCase() === String(ws).toLowerCase()) return;
      } catch (e) {}
      out.push(en);
    });
    /* 远端有、工作区缺、且提交比对没列出的 → 补新增 */
    if (remoteSha) {
      Object.keys(remoteSha).forEach((p) => {
        if (seen[p]) return;
        let alive = true;
        try { alive = !!exists(p); } catch (e) { alive = true; }
        if (alive) return;
        const parts = String(p).split('/');
        const pProject = parts.length > 2 ? parts[0] : (parts.length > 1 ? parts[0] : '默认项目');
        const pProto = parts.length > 2 ? parts[1] : (parts.length > 1 ? parts[1] : parts[0]);
        const pSub = parts.length > 2 ? parts.slice(2).join('/') : (parts.length > 1 ? parts.slice(1).join('/') : p);
        out.push({ path: p, project: pProject, proto: pProto, subPath: pSub, code: 'add', label: '新增' });
      });
    }
  } catch (e) { return diffEntries; }
  return out;
}
/* 工作区修正外壳：批量取远端 blob（1次）+ 工作区 hash（1次），失败回退原列表 */
async function gitPullAdjustForWorkdir(diffEntries) {
  try {
    if (!diffEntries || !diffEntries.length) return diffEntries;
    const lsR = await runGit(paths.SANDBOX_ROOT, ['ls-tree', '-r', 'FETCH_HEAD']);
    const remoteSha = {};
    if (lsR && lsR.status === 0 && lsR.stdout) {
      lsR.stdout.split('\n').forEach((ln) => {
        const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/.exec(ln);
        if (m && m[2] === 'blob') remoteSha[m[4].replace(/\\/g, '/')] = m[3];
      });
    }
    if (!Object.keys(remoteSha).length) return diffEntries;
    const existPaths = [];
    diffEntries.forEach((en) => {
      try { if (en && en.path && fs.existsSync(path.join(paths.SANDBOX_ROOT, en.path))) existPaths.push(en.path); } catch (e) {}
    });
    const workHash = {};
    if (existPaths.length) {
      /* hash-object 多文件输出只有 sha 无文件名：按参数顺序逐行回填，行数对不上则整体放弃修正 */
      try {
        const hr = await runGit(paths.SANDBOX_ROOT, ['hash-object'].concat(existPaths));
        if (hr && hr.status === 0 && hr.stdout) {
          const lines = String(hr.stdout).split('\n').map((s) => String(s || '').trim()).filter(Boolean);
          if (lines.length === existPaths.length) {
            for (let hi = 0; hi < lines.length; hi++) {
              const sha = lines[hi].split(/\s+/)[0] || '';
              if (/^[0-9a-f]{40}$/i.test(sha)) workHash[existPaths[hi]] = sha;
            }
          }
        }
      } catch (e) {}
    }
    const existsFn = (p) => { try { return fs.existsSync(path.join(paths.SANDBOX_ROOT, p)); } catch (e) { return true; } };
    return gitPullAdjustEntries(diffEntries, remoteSha, workHash, existsFn);
  } catch (e) { return diffEntries; }
}
async function gitFetchDiffImpl(ev, o) {  return withGitLock('read', 'fetch-diff', async () => {
  const projName = (typeof o === 'string' ? o : (o && o.project)) || '';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };

  // P1-1：无远端返回 NEED_CONFIG（不调远端，避免误以为已同步）
  if (!cfg.remoteUrl) return { ok: false, code: 'NEED_CONFIG', error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const cred = resolveGitCredentials(projName, o);
  const auth = gitAuth.buildGitAuthEnv(cred);
  const plainUrl = String(cfg.remoteUrl).trim();

  // 静默 Fetch 目标分支
  let fetchRes = null;
  try {
    fetchRes = await runGit(paths.SANDBOX_ROOT, [...auth.argsPrefix, 'fetch', plainUrl, branch], { timeoutMs: 30000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  if (fetchRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  if (fetchRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  }

  const hasHead = (await runGit(paths.SANDBOX_ROOT, ['rev-parse', 'HEAD'])).status === 0;
  let diffRes = null;
  if (hasHead) {
    diffRes = await runGit(paths.SANDBOX_ROOT, ['diff', '--name-status', 'HEAD...FETCH_HEAD']);
  } else {
    diffRes = await runGit(paths.SANDBOX_ROOT, ['ls-tree', '-r', '--name-only', 'FETCH_HEAD']);
  }

  if (diffRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(diffRes.stderr) };
  }

  const handledPaths = new Set(); // D-G1 与 git:status 共享去重逻辑（通过 gitHandledPath 工具函数复用）
  // 复用顶层 GIT_STATUS_MAP

  const rawLines = diffRes.stdout.split(/\r?\n/).filter(Boolean);
  const diffEntries = [];
  rawLines.forEach((line) => {
    let stCode = 'add', label = '新增', relPath = '';
    if (hasHead) {
      const parts = line.split(/\t+|\s+/);
      const flag = parts[0] ? parts[0].slice(0, 1) : 'M';
      var _si2=gitStatusInfo(flag); stCode=_si2.code; label=_si2.label;
      relPath = decodeGitOctal(parts[1] || '').replace(/\\/g, '/');
    } else {
      relPath = decodeGitOctal(line).replace(/\\/g, '/');
    }

    if (!relPath || relPath === '.git' || relPath.startsWith('.git/') || gitHandledPath(handledPaths, relPath)) return;
    const pathParts = relPath.split('/');
    const pProject = pathParts.length > 2 ? pathParts[0] : (pathParts.length > 1 ? pathParts[0] : '默认项目');
    const pProto = pathParts.length > 2 ? pathParts[1] : (pathParts.length > 1 ? pathParts[1] : pathParts[0]);
    const pSub = pathParts.length > 2 ? pathParts.slice(2).join('/') : (pathParts.length > 1 ? pathParts.slice(1).join('/') : relPath);

    diffEntries.push({
      path: relPath,
      project: pProject,
      proto: pProto,
      subPath: pSub,
      code: stCode,
      label
    });
  });

  /* 工作区感知修正：已与远端同内容的不再列（拉过即清）；本地已删但远端有的标新增可恢复 */
  let finalEntries = diffEntries;
  try {
    const adjusted = await gitPullAdjustForWorkdir(diffEntries);
    if (Array.isArray(adjusted)) finalEntries = adjusted;
  } catch (e) {}

  const tree = {};
  let totalCount = 0;
  finalEntries.forEach((en) => {
    const pProject = en.project, pProto = en.proto;
    tree[pProject] = tree[pProject] || {};
    tree[pProject][pProto] = tree[pProject][pProto] || [];
    tree[pProject][pProto].push(en);
    totalCount++;
  });

  const projectList = Object.keys(tree).map((pName) => {
    const protoList = Object.keys(tree[pName]).map((prName) => ({
      proto: prName,
      files: tree[pName][prName]
    })).sort((a, b) => a.proto.localeCompare(b.proto, 'zh-CN'));
    return {
      project: pName,
      isCurrent: (pName === projName),
      protos: protoList
    };
  }).sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return a.project.localeCompare(b.project, 'zh-CN');
  });

  return { ok: true, projects: projectList, totalCount, branch };
  });

}
async function gitPullImpl(ev, o) {
  return withGitLock('write', 'pull', async () => {
  const projName = (o && o.project) || '';
  const files = (o && Array.isArray(o.files)) ? o.files : null;
  const wantBackup = !!(o && o.backup);
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && o.branch.trim()) || cfg.branch || 'main';
  if (!isValidBranch(branch)) return { ok: false, error: '非法分支名' };

  if (!cfg.remoteUrl) return { ok: false, code: 'NEED_CONFIG', error: '未配置 Git 远程仓库地址，请先进行仓库设置' };
  try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
    return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e) };
  }
  try {
    const heal = await checkGitHealNeeded();
    if (heal && heal.needHeal) return { ok: false, code: 'NEED_HEAL', reason: heal.reason, nested: heal.nested || [], detail: heal.detail || '' };
  } catch (e) {}
  try { await ensureSandboxGitRepo(cfg); } catch (e) {
    if (e && e.code === 'GIT_URL_BLOCKED') return { ok: false, code: 'GIT_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  const cred = resolveGitCredentials(projName, o);
  const auth = gitAuth.buildGitAuthEnv(cred);
  const plainUrl = String(cfg.remoteUrl).trim();

  // 1. Fetch
  let fetchRes = null;
  try {
    fetchRes = await runGit(paths.SANDBOX_ROOT, [...auth.argsPrefix, 'fetch', plainUrl, branch], { timeoutMs: 30000, envAdd: auth.envAdd });
  } catch (e) {
    if (e && e.code === 'AUTH_URL_BLOCKED') return { ok: false, code: 'AUTH_URL_BLOCKED', error: String(e.message) };
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)) };
  }
  if (fetchRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  if (fetchRes.status !== 0) {
    return { ok: false, error: sanitizeGitError(fetchRes.stderr || fetchRes.stdout) };
  }

  const affectedProjects = new Set();
  const failed = [];
  let backupPath = null;
  // P0-D3：o.backup=true 时先备份本次 files 交集的本地现存文件
  if (wantBackup && files && files.length) {
    try { backupPath = backupPullFiles(files, branch); } catch (e) { backupPath = null; }
  }

  // 2. 选择性检出指定的目录/文件（逐文件判 status，不吞错）
  if (files && files.length) {
    for (const rel of files) {
      const fullPath = path.join(paths.SANDBOX_ROOT, rel);
      if (!isSafeGitRel(rel) || !isSubPath(fullPath, paths.SANDBOX_ROOT)) { // G03 git:pull isSafeGitRel + isSubPath double check, -- retained
        try {
          const dir = logsDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const d = new Date(); const p2 = shared.pad2;
          const ymd = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
          const hms = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
          try { var st = fs.statSync(path.join(dir, 'app-' + ymd + '.log')); if (st.size > 5*1024*1024) fs.renameSync(path.join(dir, 'app-' + ymd + '.log'), path.join(dir, 'app-' + ymd + '.1.log')); } catch (e) {}
          fs.appendFileSync(path.join(dir, 'app-' + ymd + '.log'), '[' + hms + '][WARN][git:pull] skip unsafe rel: ' + String(rel) + '\n', 'utf8');
        } catch (e) {}
        try { console.warn('[WARN][git:pull] skip unsafe rel', rel); } catch (e) {}
        failed.push({ path: rel, error: '非法路径，已跳过' });
        continue;
      }
      // 保证本地沙箱父级文件夹递归自动创建
      try { fs.mkdirSync(path.dirname(fullPath), { recursive: true }); } catch (e) {}

      const parts = rel.split('/');
      if (parts.length > 0) affectedProjects.add(parts[0]);

      // 从 FETCH_HEAD 检出该文件
      try {
        const co = await runGit(paths.SANDBOX_ROOT, ['checkout', 'FETCH_HEAD', '--', rel]);
        if (co.timedOut) { failed.push({ path: rel, error: sanitizeGitError(co.stderr || co.stdout), code: 'TIMEOUT' }); continue; }
        if (co.status !== 0) failed.push({ path: rel, error: sanitizeGitError(co.stderr || co.stdout) });
      } catch (e) {
        if (e && e.code === 'AUTH_URL_BLOCKED') failed.push({ path: rel, error: String(e.message), code: 'AUTH_URL_BLOCKED' });
        else failed.push({ path: rel, error: sanitizeGitError(String((e && e.message) || e)) });
      }
    }
    if (failed.length) {
      return {
        ok: false,
        error: '部分文件拉取失败（' + failed.length + '/' + files.length + '），未失败文件已检出，详见 failed 清单',
        failed,
        backupPath,
        affectedProjects: Array.from(affectedProjects),
        branch,
        filesCount: (files && files.length) || 0
      };
    }
  } else {
    // 全量合并拉取
    let mergeRes = null;
    try {
      mergeRes = await runGit(paths.SANDBOX_ROOT, ['merge', 'FETCH_HEAD']);
    } catch (e) {
      return { ok: false, error: sanitizeGitError(String((e && e.message) || e)), backupPath, branch };
    }
    if (mergeRes.timedOut) return { ok: false, code: 'TIMEOUT', error: sanitizeGitError(mergeRes.stderr || mergeRes.stdout), backupPath, branch };
    if (mergeRes.status !== 0) {
      return { ok: false, error: sanitizeGitError(mergeRes.stderr || mergeRes.stdout), backupPath, branch };
    }
  }

  /* 拉取成功即远端位置==FETCH_HEAD：同步追踪，避免拉回内容被状态比对误算成未推送 */
  try {
    const fr = await runGit(paths.SANDBOX_ROOT, ['rev-parse', 'FETCH_HEAD']);
    const fsha = (fr && fr.status === 0) ? String(fr.stdout || '').trim() : '';
    if (/^[0-9a-f]{40}$/i.test(fsha)) await gitSyncOriginRef(branch, fsha);
  } catch (e) {}

  return {
    ok: true,
    message: '同步完成',
    filesCount: (files && files.length) || 0,
    affectedProjects: Array.from(affectedProjects),
    branch,
    failed,
    backupPath
  };
  });

}
function gitIsBusyImpl() {
  return { busy: gitIsBusy(), currentOp: (shared.gitState.busy && shared.gitState.busy.op) || null };

}
async function gitCancelImpl() {
  try {
    if (!shared.gitState.busy) return { ok: true, cancelled: false };
    const op = shared.gitState.busy.op;
    try { if (shared.gitCurrentChild && shared.gitCurrentChild.pid) await killProcessTree(shared.gitCurrentChild.pid); } catch (e) {}
    try { if (shared.gitCurrentChild) shared.gitCurrentChild.kill('SIGKILL'); } catch (e) {}
    shared.gitState.busy = null;
    try { shared.gitCurrentChild = null; } catch (e) {}
    return { ok: true, cancelled: true, op };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }

}
async function gitHealRepairImpl(ev, o) {
  const projName = (o && o.project) || '';
  const cfg = getProjectGitConfig(projName);
  const branch = (o && o.branch && String(o.branch).trim()) || cfg.branch || 'main';
  let nested = [];
  try { nested = detectNestedGit(); } catch (e) {}
  const ts = fmtGitTs(new Date());
  const backupRoot = path.join(paths.SANDBOX_ROOT, '.heal-backup', ts);
  const healed = [];
  try { fs.mkdirSync(backupRoot, { recursive: true }); } catch (e) {}
  // 先备份嵌套 .git 到 sandbox/.heal-backup/<时间>/ 再隔离（改名，不 rm -rf）
  for (const rel of (nested || [])) {
    try {
      const src = path.join(paths.SANDBOX_ROOT, rel);
      const dst = path.join(backupRoot, rel);
      try { fs.mkdirSync(path.dirname(dst), { recursive: true }); } catch (e) {}
      try {
        if (fs.existsSync(src)) {
          const st = fs.statSync(src);
          if (st.isDirectory()) fs.cpSync(src, dst, { recursive: true });
          else fs.copyFileSync(src, dst);
        }
      } catch (e) {}
      try {
        if (fs.existsSync(src)) {
          const bakName = src + '.bak-' + ts;
          try { fs.renameSync(src, bakName); healed.push(rel); } catch (e) {
            // 改名失败（如跨盘）则在已备份前提下删除原目录
            try { fs.rmSync(src, { recursive: true, force: true }); healed.push(rel); } catch (ee) {}
          }
        }
      } catch (e) {}
    } catch (e) {}
  }
  // 再重建总根库（缺库/坏库修复）
  try {
    const gitDir = path.join(paths.SANDBOX_ROOT, '.git');
    let needInit = false;
    try { if (!fs.existsSync(gitDir)) needInit = true; } catch (e) { needInit = true; }
    if (!needInit) {
      try {
        const h = await checkSandboxRepoHealth();
        if (!h.healthy) {
          // 备份坏库后重建
          try {
            const badBak = path.join(backupRoot, '.git-broken-' + ts);
            try { fs.cpSync(gitDir, badBak, { recursive: true }); } catch (e) {}
            try { fs.renameSync(gitDir, gitDir + '.bak-' + ts); } catch (e) {}
          } catch (e) {}
          needInit = true;
        }
      } catch (e) {}
    }
    if (needInit) {
      await runGit(paths.SANDBOX_ROOT, ['init', '-b', branch]);
      const gi = path.join(paths.SANDBOX_ROOT, '.gitignore');
      try { if (!fs.existsSync(gi)) fs.writeFileSync(gi, '.DS_Store\nThumbs.db\ndesktop.ini\n*.tmp\ntemp/\n', 'utf8'); } catch (e) {}
    }
    await runGit(paths.SANDBOX_ROOT, ['config', 'core.quotepath', 'false']);
    if (cfg && cfg.remoteUrl) {
      try { gitAuth.assertAllowedRemoteUrl(String(cfg.remoteUrl)); } catch (e) {
        return { ok: false, code: (e && e.code) || 'GIT_URL_BLOCKED', error: String((e && e.message) || e), backupDir: backupRoot, healed };
      }
      try {
        const remotes = await runGit(paths.SANDBOX_ROOT, ['remote']);
        if (String(remotes.stdout || '').indexOf('origin') >= 0) await runGit(paths.SANDBOX_ROOT, ['remote', 'set-url', 'origin', String(cfg.remoteUrl).trim()]);
        else await runGit(paths.SANDBOX_ROOT, ['remote', 'add', 'origin', String(cfg.remoteUrl).trim()]);
      } catch (e) {}
    }
    if (cfg && cfg.authorName) { try { await runGit(paths.SANDBOX_ROOT, ['config', 'user.name', cfg.authorName]); } catch (e) {} }
    if (cfg && cfg.authorEmail) { try { await runGit(paths.SANDBOX_ROOT, ['config', 'user.email', cfg.authorEmail]); } catch (e) {} }
  } catch (e) {
    return { ok: false, error: sanitizeGitError(String((e && e.message) || e)), backupDir: backupRoot, healed };
  }
  return { ok: true, backupDir: backupRoot, healed, nested };

}
module.exports = {
  GIT_STATUS_MAP,
  gitHandledPath,
  gitStatusCode,
  gitStatusLabel,
  gitStatusInfo,
  gitIsBusy,
  withGitLock,
  detectNestedGit,
  checkSandboxRepoHealth,
  fmtGitTs,
  checkGitHealNeeded,
  backupPullFiles,
  resolveGitCredentials,
  getProjectGitConfig,
  sanitizeGitError,
  decodeGitOctal,
  runGit,
  ensureSandboxGitRepo,
  gitConfigGetImpl,
  gitConfigSaveImpl,
  gitListBranchesImpl,
  gitTestConnectionImpl,
  gitStatusImpl,
  gitPushImpl,
  gitFetchDiffImpl,
  gitPullAdjustEntries,
  gitPullImpl,
  gitIsBusyImpl,
  gitCancelImpl,
  gitHealRepairImpl,
};
