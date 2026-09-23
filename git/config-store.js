'use strict';
/**
 * git/config-store.js — 配置与凭据持久化（P0 止血）
 * - 落盘只存 remoteUrl/branch/authorName/authorEmail，剥离 token/username
 * - 凭据走 electron.safeStorage 加密独立文件；不可用时仅内存持有
 * - migratePlaintextTokensOnce 一次性迁移旧明文（先备份）
 * - 对外返回脱敏视图 {..., hasToken, tokenMasked}，无 token 字段
 */
const path = require('path');
const fs = require('fs');

let _overridePaths = null;
/** 纯内存凭据（safeStorage 不可用时的会话持有 + 有可用时的写前合并缓存） */
const _memCreds = new Map(); // key(project||'__default__') -> {username, token}
let _migratedOnce = false;

function _key(projectName) {
  const k = String(projectName || '').trim();
  return k || '__default__';
}

function _setPathsForTest(p) { _overridePaths = p || null; }
function _resetForTest() { _overridePaths = null; _memCreds.clear(); _migratedOnce = false; }

function resolveUserDataDir() {
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') {
      try { return el.app.getPath('userData'); } catch (e) {}
    }
  } catch (e) {}
  try { return path.join(__dirname, '..', '.devdata'); } catch (e) {}
  return process.cwd();
}

function resolvePaths() {
  if (_overridePaths && _overridePaths.configPath && _overridePaths.credPath) return _overridePaths;
  const base = resolveUserDataDir();
  return {
    configPath: path.join(base, 'git-config.json'),
    credPath: path.join(base, 'git-credentials.json')
  };
}

function getSafeStorage() {
  try {
    const el = require('electron');
    const ss = el && el.safeStorage;
    if (!ss || typeof ss.isEncryptionAvailable !== 'function') return null;
    try {
      if (!ss.isEncryptionAvailable()) return null;
    } catch (e) { return null; }
    if (typeof ss.encryptString !== 'function' || typeof ss.decryptString !== 'function') return null;
    return ss;
  } catch (e) { return null; }
}

function isPersistAvailable() { return !!getSafeStorage(); }

function fmtTs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/** 落盘 shape 白名单：仅这 4 字段 */
function toSafePersistedShape(cfg) {
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  const out = {};
  if (c.remoteUrl != null) out.remoteUrl = String(c.remoteUrl);
  if (c.branch != null) out.branch = String(c.branch);
  if (c.authorName != null) out.authorName = String(c.authorName);
  if (c.authorEmail != null) out.authorEmail = String(c.authorEmail);
  return out;
}

function loadGitConfigRaw() {
  try {
    const { configPath } = resolvePaths();
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        return {
          defaultConfig: (raw.defaultConfig && typeof raw.defaultConfig === 'object') ? raw.defaultConfig : {},
          projects: (raw.projects && typeof raw.projects === 'object') ? raw.projects : {}
        };
      }
    }
  } catch (e) {}
  return { defaultConfig: {}, projects: {} };
}

function _writeRawConfig(all) {
  const { configPath } = resolvePaths();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(all || {}, null, 2), 'utf8');
}

/** 同步读取凭据（文件解密优先，其次内存）。返回 {username, token, persisted} */
function _readCredentialsSync(projectName) {
  const key = _key(projectName);
  const readOne = (k) => {
  // 1. 加密文件
  try {
    const { credPath } = resolvePaths();
    if (fs.existsSync(credPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        const ent = raw && raw.entries && raw.entries[k];
        if (ent && (ent.usernameEnc || ent.tokenEnc)) {
          const ss = getSafeStorage();
          if (ss) {
            let username = '';
            let token = '';
            try { if (ent.usernameEnc) username = ss.decryptString(Buffer.from(String(ent.usernameEnc), 'base64')); } catch (e) {}
            try { if (ent.tokenEnc) token = ss.decryptString(Buffer.from(String(ent.tokenEnc), 'base64')); } catch (e) {}
            return { username, token, persisted: true };
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  // 2. 内存
  if (_memCreds.has(k)) {
    const m = _memCreds.get(k) || {};
    return {
      username: String(m.username || ''),
      token: String(m.token || ''),
      persisted: false,
      sessionOnly: !isPersistAvailable()
    };
  }
  return null;
  };
  const hit = readOne(key);
  if (hit && (hit.username || hit.token)) return hit;
  /* 项目无凭证时回退默认（与 remoteUrl/branch 的回退语义一致，避免匿名推送挂死） */
  if (key !== '__default__') {
    try {
      const fb = readOne('__default__');
      if (fb && (fb.username || fb.token)) return fb;
    } catch (e) {}
  }
  return { username: '', token: '', persisted: false };
}

/**
 * 对外脱敏视图：无 token 字段。
 * 兼容保留 username（来自安全存储解密或 ''），新增 hasToken/tokenMasked/hasUsername。
 */
function getProjectGitConfig(projectName) {
  const all = loadGitConfigRaw();
  const def = all.defaultConfig || {};
  const proj = (projectName && all.projects && all.projects[projectName]) || {};
  const remoteUrl = String(proj.remoteUrl != null ? proj.remoteUrl : (def.remoteUrl || ''));
  const branch = String(proj.branch != null ? proj.branch : (def.branch || 'main'));
  const authorName = String(proj.authorName != null ? proj.authorName : (def.authorName || '产品设计师'));
  const authorEmail = String(proj.authorEmail != null ? proj.authorEmail : (def.authorEmail || 'designer@local'));
  const cred = _readCredentialsSync(projectName);
  const persistAvail = isPersistAvailable();
  let hasToken = false;
  let tokenMasked = '';
  let hasUsername = false;
  let username = '';
  if (cred && cred.persisted) {
    hasToken = !!cred.token;
    hasUsername = !!cred.username;
    username = String(cred.username || '');
    if (cred.token && cred.token.length >= 4) tokenMasked = '****' + String(cred.token).slice(-4);
    else if (cred.token) tokenMasked = '****';
  } else {
    // safeStorage 不可用：仅内存持有，对外按未持久化口径返回 hasToken:false + 提示
    hasToken = false;
    tokenMasked = '';
    hasUsername = false;
    username = '';
  }
  const view = {
    remoteUrl, branch, authorName, authorEmail,
    username, hasUsername, hasToken, tokenMasked
  };
  if (!persistAvail) view.persistHint = '当前环境不支持安全存储，凭据仅本次会话有效，重启后需重新输入';
  return view;
}

/** 异步取凭据（供 handlers 使用；内存会话亦可取到，用于本次 extraHeader） */
function getProjectGitCredentials(projectName) {
  return Promise.resolve().then(() => {
    const c = _readCredentialsSync(projectName);
    if (!c || (!c.username && !c.token)) return null;
    return { username: String(c.username || ''), token: String(c.token || '') };
  });
}

function getProjectGitCredentialsSync(projectName) {
  const c = _readCredentialsSync(projectName);
  if (!c || (!c.username && !c.token)) return null;
  return { username: String(c.username || ''), token: String(c.token || '') };
}

/** 保存非敏感配置（自动剥离 token/username/password） */
function saveProjectGitConfig(projectName, partialConfig) {
  return Promise.resolve().then(() => {
    const safe = toSafePersistedShape(partialConfig || {});
    const all = loadGitConfigRaw();
    all.defaultConfig = Object.assign({}, all.defaultConfig || {}, safe);
    if (projectName) {
      all.projects = all.projects || {};
      all.projects[projectName] = Object.assign({}, all.projects[projectName] || {}, safe);
    }
    _writeRawConfig(all);
    return { ok: true, config: getProjectGitConfig(projectName) };
  });
}

/**
 * 保存凭据：safeStorage 可用则加密落独立文件（0600），否则仅内存持有。
 * 空串/undefined 视为不更新（前端空提交=不更新）；显式清空请调 clearProjectGitCredentials。
 */
function saveProjectGitCredentials(projectName, cred) {
  return Promise.resolve().then(() => {
    const key = _key(projectName);
    const cur = _readCredentialsSync(projectName) || { username: '', token: '' };
    let nextUsername = cur.username || '';
    let nextToken = cur.token || '';
    if (cred && cred.username != null && String(cred.username) !== '') nextUsername = String(cred.username);
    if (cred && cred.token != null && String(cred.token) !== '') nextToken = String(cred.token);
    // 若调用方两者都未传有效值，且当前无任何凭据，直接返回
    const ss = getSafeStorage();
    if (!ss) {
      _memCreds.set(key, { username: nextUsername, token: nextToken });
      return { ok: true, persisted: false, hasToken: false, hint: '当前环境不支持安全存储，凭据仅本次会话有效，重启后需重新输入' };
    }
    // 加密持久化
    const { credPath } = resolvePaths();
    let fileObj = { version: 1, entries: {} };
    try {
      if (fs.existsSync(credPath)) {
        const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') fileObj = raw;
      }
    } catch (e) {}
    fileObj.version = 1;
    fileObj.entries = fileObj.entries || {};
    const enc = {};
    try {
      if (nextUsername) enc.usernameEnc = ss.encryptString(String(nextUsername)).toString('base64');
      if (nextToken) enc.tokenEnc = ss.encryptString(String(nextToken)).toString('base64');
    } catch (e) {
      _memCreds.set(key, { username: nextUsername, token: nextToken });
      return { ok: true, persisted: false, hasToken: false, hint: '安全存储加密失败，凭据仅本次会话有效' };
    }
    // 空凭据则删除条目
    if (!enc.usernameEnc && !enc.tokenEnc) {
      try { delete fileObj.entries[key]; } catch (e) {}
    } else {
      fileObj.entries[key] = enc;
    }
    try {
      fs.mkdirSync(path.dirname(credPath), { recursive: true });
      fs.writeFileSync(credPath, JSON.stringify(fileObj, null, 2), 'utf8');
      try { fs.chmodSync(credPath, 0o600); } catch (e) {}
    } catch (e) {
      _memCreds.set(key, { username: nextUsername, token: nextToken });
      return { ok: false, persisted: false, error: String((e && e.message) || e) };
    }
    // 同步一份到内存，便于本次会话快速读取（不影响 persisted 口径）
    _memCreds.set(key, { username: nextUsername, token: nextToken });
    return { ok: true, persisted: true };
  });
}

function clearProjectGitCredentials(projectName) {
  return Promise.resolve().then(() => {
    const key = _key(projectName);
    try { _memCreds.delete(key); } catch (e) {}
    try {
      const { credPath } = resolvePaths();
      if (fs.existsSync(credPath)) {
        const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        if (raw && raw.entries && raw.entries[key]) {
          delete raw.entries[key];
          fs.writeFileSync(credPath, JSON.stringify(raw, null, 2), 'utf8');
        }
      }
    } catch (e) {}
    return { ok: true };
  });
}

/**
 * 一次性迁移旧明文 token/username：先备份 git-config.json.bak-<ts>，再剥离落盘。
 * 幂等：无明文时返回 {migrated:0}；已迁移过不再重复备份（进程内一次 + 文件无明文即 0）。
 */
function migratePlaintextTokensOnce() {
  return Promise.resolve().then(async () => {
    if (_migratedOnce) return { migrated: 0, skipped: true };
    _migratedOnce = true;
    const { configPath } = resolvePaths();
    let all = null;
    try {
      if (!fs.existsSync(configPath)) return { migrated: 0 };
      all = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) { return { migrated: 0, error: String((e && e.message) || e) }; }
    if (!all || typeof all !== 'object') return { migrated: 0 };
    const hasPlain = (o) => !!(o && typeof o === 'object' && (o.token || o.password || o.username));
    const targets = [];
    if (hasPlain(all.defaultConfig)) targets.push({ key: '__default__', cfg: all.defaultConfig });
    if (all.projects && typeof all.projects === 'object') {
      for (const k of Object.keys(all.projects)) {
        if (hasPlain(all.projects[k])) targets.push({ key: k, cfg: all.projects[k] });
      }
    }
    if (!targets.length) return { migrated: 0 };
    // 先备份
    let backupPath = '';
    try {
      const ts = fmtTs(new Date());
      backupPath = configPath + '.bak-' + ts;
      fs.copyFileSync(configPath, backupPath);
    } catch (e) { return { migrated: 0, error: '备份失败，已中止迁移：' + String((e && e.message) || e) }; }
    let migrated = 0;
    for (const t of targets) {
      const username = String(t.cfg.username || '');
      const token = String(t.cfg.token || t.cfg.password || '');
      try {
        if (username || token) {
          // 复用保存逻辑（加密可用则落盘，否则进内存）
          const projName = t.key === '__default__' ? '' : t.key;
          // 为保持 default 与项目各自独立：default 的凭据存 __default__，项目的存项目 key
          // 注意：saveProjectGitCredentials 内部以 _key 归一，'' -> __default__
          await saveProjectGitCredentials(projName, { username, token });
          migrated++;
        }
      } catch (e) {}
      // 剥离明文字段
      try { delete t.cfg.token; delete t.cfg.password; delete t.cfg.username; } catch (e) {}
    }
    // 覆写 stripped 配置（仅保留白名单字段结构，但保留其他非敏感字段原样除凭据外）
    try {
      const stripped = { defaultConfig: {}, projects: {} };
      try { stripped.defaultConfig = toSafePersistedShapeWithExtra(all.defaultConfig); } catch (e) { stripped.defaultConfig = {}; }
      stripped.projects = {};
      if (all.projects && typeof all.projects === 'object') {
        for (const k of Object.keys(all.projects)) {
          try { stripped.projects[k] = toSafePersistedShapeWithExtra(all.projects[k]); } catch (e) { stripped.projects[k] = {}; }
        }
      }
      // 保留顶层其他未知键？不保留，仅保留 defaultConfig/projects（最小化落盘面）
      _writeRawConfig(stripped);
    } catch (e) { return { migrated, backupPath, error: String((e && e.message) || e) }; }
    return { migrated, backupPath };
  });
}

function toSafePersistedShapeWithExtra(cfg) {
  // 保留白名单 4 字段；若旧文件含其他非敏感自定义键，丢弃（最小化），以满足“只存 remoteUrl/branch/author”审计
  return toSafePersistedShape(cfg);
}

module.exports = {
  resolvePaths,
  resolveUserDataDir,
  isPersistAvailable,
  toSafePersistedShape,
  loadGitConfigRaw,
  getProjectGitConfig,
  getProjectGitCredentials,
  getProjectGitCredentialsSync,
  saveProjectGitConfig,
  saveProjectGitCredentials,
  clearProjectGitCredentials,
  migratePlaintextTokensOnce,
  _setPathsForTest,
  _resetForTest
};
