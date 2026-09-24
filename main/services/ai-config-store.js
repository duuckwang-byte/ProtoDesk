'use strict';
/**
 * main/services/ai-config-store.js — AI 配置与凭据持久化（Wave-D 硬件加密）
 * 对齐 git/config-store.js（safeStorage/DPAPI，配置与密文分离）：
 * - ai-config.json 仅存非敏感配置（剥离一切 apiKey/token/password/secret）
 * - 凭据走 electron.safeStorage 加密独立文件 ai-credentials.json（0600）；不可用时仅内存持有
 * - 原子写：写 tmp 再 rename，防断电空文件
 * - IPC 永不返回明文：getMaskedAiConfig 仅返回掩码 + hasApiKey；明文仅内存按需解密
 * - migratePlaintextOnce：旧明文首次读取后转加密（先备份 ai-config.json.bak-<ts>）
 *
 * 敏感面：api.apiKey / byok.apiKey / apiConfig.apiKey / apiProfiles[].apiKey
 * （兼容历史字段 api_key/token/password/secret，一并剥离迁移）
 *
 * Wave-E 契约补记 (只加注释, 实现不变):
 * @typedef {Object} SaveAiArgs {engine?:string, api?:{provider?:string, baseUrl?:string, apiKey?:string, model?:string}}
 * @typedef {Object} SaveAiResult {ok:boolean, config:MaskedAiConfig, persisted:boolean, hint?:string}
 * @param {SaveAiArgs} cfg 入参 (apiKey 为明文仅此一跳, 落盘前即剥离加密; 空串表不冲旧值)
 * @returns {Promise<SaveAiResult>} 保存结果 (config 恒为掩码形态, 明文永不经 IPC)
 */

const path = require('path');
const fs = require('fs');

let _overridePaths = null;
const _memCreds = { apiKey: '', byokApiKey: '', apiConfigApiKey: '', profiles: {} }; // id -> apiKey
let _migratedOnce = false;

function _setPathsForTest(p) { _overridePaths = p || null; }
function _resetForTest() {
  _overridePaths = null;
  _memCreds.apiKey = ''; _memCreds.byokApiKey = ''; _memCreds.apiConfigApiKey = ''; _memCreds.profiles = {};
  _migratedOnce = false;
}

function resolveUserDataDir() {
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') {
      try { return el.app.getPath('userData'); } catch (e) {}
    }
  } catch (e) {}
  try { return path.join(__dirname, '..', '..', '.devdata'); } catch (e) {}
  return process.cwd();
}

function resolvePaths() {
  if (_overridePaths && _overridePaths.configPath && _overridePaths.credPath) return _overridePaths;
  const base = resolveUserDataDir();
  return {
    configPath: path.join(base, 'ai-config.json'),
    credPath: path.join(base, 'ai-credentials.json'),
  };
}

function getSafeStorage() {
  try {
    const el = require('electron');
    const ss = el && el.safeStorage;
    if (!ss || typeof ss.isEncryptionAvailable !== 'function') return null;
    try { if (!ss.isEncryptionAvailable()) return null; } catch (e) { return null; }
    if (typeof ss.encryptString !== 'function' || typeof ss.decryptString !== 'function') return null;
    return ss;
  } catch (e) { return null; }
}

function isPersistAvailable() { return !!getSafeStorage(); }

function maskKey(k) {
  const s = String(k || '');
  if (!s) return '';
  if (s.length < 4) return '****';
  return '****' + s.slice(-4);
}

function defaultAiCfg() {
  return {
    cliPath: '',
    cliPaths: {},
    agentId: 'opencode',
    mainAgent: 'opencode',
    engine: 'cli',
    api: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      customModels: ['deepseek-chat', 'deepseek-reasoner'],
      enableTools: true,
    },
    customModelsCli: [],
    visibleModels: [],
    visibleModelsCli: null,
    visibleModelsApi: null,
  };
}

const SENSITIVE_KEYS = ['apiKey', 'api_key', 'token', 'password', 'secret'];

/* CLI 模型列表分 CLI 隔离存放 {agentId:[modelId]}；旧版为全局数组（读时兼容，写时已迁）。
 * isCliModelMap/sanitizeCliModelMap 供 load/save 双向清洗，防脏数据落盘。 */
function isCliModelMap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  try {
    return Object.keys(v).every(function (k) { return Array.isArray(v[k]); });
  } catch (e) { return false; }
}
function sanitizeCliModelMap(v) {
  if (Array.isArray(v)) return v.filter(function (x) { return typeof x === 'string' && x; });
  if (!isCliModelMap(v)) return {};
  var out = {};
  try {
    Object.keys(v).forEach(function (k) {
      out[String(k)] = (v[k] || []).filter(function (x) { return typeof x === 'string' && x; });
    });
  } catch (e) {}
  return out;
}

function _stripSensitiveFromSection(sec) {
  if (!sec || typeof sec !== 'object') return sec;
  const out = Array.isArray(sec) ? sec.slice() : Object.assign({}, sec);
  for (const k of SENSITIVE_KEYS) { try { if (k in out) delete out[k]; } catch (e) {} }
  // 显式归零 apiKey，避免旧文件残留被直接展开
  if ('apiKey' in out) { try { out.apiKey = ''; } catch (e) {} }
  return out;
}

/** 落盘 shape 白名单：剥离一切敏感键，保留其余业务字段原样 */
function toSafePersistedShape(cfg) {
  const c = (cfg && typeof cfg === 'object') ? cfg : {};
  const out = {};
  // 标量白名单透传（未知键透传，但敏感键除外）
  for (const k of Object.keys(c)) {
    if (SENSITIVE_KEYS.indexOf(k) >= 0) continue;
    if (k === 'api' || k === 'byok' || k === 'apiConfig') continue;
    if (k === 'apiProfiles') continue;
    out[k] = c[k];
  }
  if (c.api && typeof c.api === 'object') {
    out.api = _stripSensitiveFromSection(c.api);
    try { out.api.apiKey = ''; } catch (e) {}
  }
  if (c.byok && typeof c.byok === 'object') {
    out.byok = _stripSensitiveFromSection(c.byok);
    try { out.byok.apiKey = ''; } catch (e) {}
  }
  if (c.apiConfig && typeof c.apiConfig === 'object') {
    out.apiConfig = _stripSensitiveFromSection(c.apiConfig);
    try { out.apiConfig.apiKey = ''; } catch (e) {}
  }
  if (Array.isArray(c.apiProfiles)) {
    out.apiProfiles = c.apiProfiles.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const q = _stripSensitiveFromSection(p);
      try { q.apiKey = ''; } catch (e) {}
      return q;
    });
  }
  return out;
}

/** 原子写：写 tmp 再 rename，防断电/崩溃空文件；凭据文件 chmod 0600 */
function _atomicWriteJson(targetPath, obj, chmod0600) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = targetPath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  if (chmod0600) { try { fs.chmodSync(tmp, 0o600); } catch (e) {} }
  fs.renameSync(tmp, targetPath);
  if (chmod0600) { try { fs.chmodSync(targetPath, 0o600); } catch (e) {} }
}

function _readConfigRaw() {
  try {
    const { configPath } = resolvePaths();
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (e) {}
  return null;
}

function _extractPlainKeys(cfg) {
  // 从配置对象中提取各位置明文（用于迁移 + 保存时合并）
  const out = { apiKey: '', byokApiKey: '', apiConfigApiKey: '', profiles: {} };
  try {
    if (cfg && cfg.api && typeof cfg.api === 'object') {
      for (const k of SENSITIVE_KEYS) {
        const v = cfg.api[k];
        if (v != null && String(v).trim() !== '') { out.apiKey = String(v); break; }
      }
      if (!out.apiKey && cfg.api.apiKey) out.apiKey = String(cfg.api.apiKey);
    }
    if (cfg && cfg.byok && typeof cfg.byok === 'object') {
      for (const k of SENSITIVE_KEYS) {
        const v = cfg.byok[k];
        if (v != null && String(v).trim() !== '') { out.byokApiKey = String(v); break; }
      }
    }
    if (cfg && cfg.apiConfig && typeof cfg.apiConfig === 'object') {
      for (const k of SENSITIVE_KEYS) {
        const v = cfg.apiConfig[k];
        if (v != null && String(v).trim() !== '') { out.apiConfigApiKey = String(v); break; }
      }
    }
    if (cfg && Array.isArray(cfg.apiProfiles)) {
      for (const p of cfg.apiProfiles) {
        if (!p || typeof p !== 'object' || !p.id) continue;
        for (const k of SENSITIVE_KEYS) {
          const v = p[k];
          if (v != null && String(v).trim() !== '') { out.profiles[String(p.id)] = String(v); break; }
        }
      }
    }
  } catch (e) {}
  return out;
}

/** 同步读取凭据：加密文件解密优先，其次内存。返回 {apiKey, byokApiKey, apiConfigApiKey, profiles, persisted} */
function _readCredentialsSync() {
  let fileCred = null;
  try {
    const { credPath } = resolvePaths();
    if (fs.existsSync(credPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        const ent = raw && raw.entries && raw.entries.default;
        if (ent) {
          const ss = getSafeStorage();
          if (ss) {
            const dec = (v) => {
              if (!v) return '';
              try { return ss.decryptString(Buffer.from(String(v), 'base64')); } catch (e) { return ''; }
            };
            fileCred = {
              apiKey: dec(ent.apiEnc),
              byokApiKey: dec(ent.byokEnc),
              apiConfigApiKey: dec(ent.apiConfigEnc),
              profiles: {},
              persisted: true,
            };
            try {
              const pe = ent.profilesEnc || {};
              for (const id of Object.keys(pe)) fileCred.profiles[id] = dec(pe[id]);
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  if (fileCred) {
    // 内存作为写前合并缓存：文件有值以文件为准，内存仅补文件缺失项（会话内未落盘的新键）
    try {
      if (!fileCred.apiKey && _memCreds.apiKey) fileCred.apiKey = _memCreds.apiKey;
      if (!fileCred.byokApiKey && _memCreds.byokApiKey) fileCred.byokApiKey = _memCreds.byokApiKey;
      if (!fileCred.apiConfigApiKey && _memCreds.apiConfigApiKey) fileCred.apiConfigApiKey = _memCreds.apiConfigApiKey;
      for (const id of Object.keys(_memCreds.profiles || {})) {
        if (!fileCred.profiles[id]) fileCred.profiles[id] = _memCreds.profiles[id];
      }
    } catch (e) {}
    return fileCred;
  }
  return {
    apiKey: String(_memCreds.apiKey || ''),
    byokApiKey: String(_memCreds.byokApiKey || ''),
    apiConfigApiKey: String(_memCreds.apiConfigApiKey || ''),
    profiles: Object.assign({}, _memCreds.profiles || {}),
    persisted: false,
    sessionOnly: !isPersistAvailable(),
  };
}

/**
 * 后端内部全量读取（含解密后明文，仅内存，永不经 IPC 直接返回）。
 * 语义对齐旧 loadAiCfg()：defaults 合并 + visible/cliPaths/agentId 回填。
 */
function loadAiConfigFull() {
  const def = defaultAiCfg();
  let raw = null;
  try { raw = _readConfigRaw(); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object') {
    // 无文件：仍需叠加内存凭据（safeStorage 不可用会话）
    try {
      const cred = _readCredentialsSync();
      const res = Object.assign({}, def);
      res.api = Object.assign({}, def.api);
      if (cred.apiKey) res.api.apiKey = cred.apiKey;
      if (cred.byokApiKey) { res.byok = Object.assign({}, res.byok || {}, { apiKey: cred.byokApiKey }); }
      if (cred.apiConfigApiKey) { res.apiConfig = Object.assign({}, res.apiConfig || {}, { apiKey: cred.apiConfigApiKey }); }
      return res;
    } catch (e) { return def; }
  }
  let res;
  try {
    res = Object.assign({}, def, raw, { api: Object.assign({}, def.api, raw && raw.api) });
  } catch (e) { res = Object.assign({}, def); }
  try {
    if (raw && (Array.isArray(raw.visibleModelsCli) || isCliModelMap(raw.visibleModelsCli))) res.visibleModelsCli = sanitizeCliModelMap(raw.visibleModelsCli);
    if (raw && Array.isArray(raw.visibleModelsApi)) res.visibleModelsApi = raw.visibleModelsApi;
    if (raw && (Array.isArray(raw.customModelsCli) || isCliModelMap(raw.customModelsCli))) res.customModelsCli = sanitizeCliModelMap(raw.customModelsCli);
    if (raw && typeof raw.agentId === 'string' && raw.agentId) res.agentId = raw.agentId;
    if (raw && typeof raw.mainAgent === 'string' && raw.mainAgent) res.mainAgent = raw.mainAgent;
    if (raw && typeof raw.cliPaths === 'object' && raw.cliPaths) res.cliPaths = raw.cliPaths;
    if (raw && raw.byok && typeof raw.byok === 'object') res.byok = Object.assign({}, raw.byok);
    if (raw && raw.apiConfig && typeof raw.apiConfig === 'object') res.apiConfig = Object.assign({}, raw.apiConfig);
    if (raw && Array.isArray(raw.apiProfiles)) res.apiProfiles = raw.apiProfiles;
    if (raw && raw.activeApiProfileId != null) res.activeApiProfileId = raw.activeApiProfileId;
  } catch (e) {}
  // 叠加解密凭据（文件优先，内存补齐）
  try {
    const cred = _readCredentialsSync();
    try { if (cred.apiKey) res.api.apiKey = cred.apiKey; } catch (e) {}
    try {
      if (cred.byokApiKey) {
        res.byok = res.byok && typeof res.byok === 'object' ? res.byok : {};
        if (!res.byok.apiKey) res.byok.apiKey = cred.byokApiKey;
      }
    } catch (e) {}
    try {
      if (cred.apiConfigApiKey) {
        res.apiConfig = res.apiConfig && typeof res.apiConfig === 'object' ? res.apiConfig : {};
        if (!res.apiConfig.apiKey) res.apiConfig.apiKey = cred.apiConfigApiKey;
      }
    } catch (e) {}
    try {
      if (Array.isArray(res.apiProfiles) && cred.profiles) {
        for (const p of res.apiProfiles) {
          if (p && typeof p === 'object' && p.id && cred.profiles[String(p.id)] && !p.apiKey) {
            p.apiKey = cred.profiles[String(p.id)];
          }
        }
      }
    } catch (e) {}
  } catch (e) {}
  return res;
}

/**
 * IPC 对外掩码视图：永不含明文 apiKey。
 * - api/byok/apiConfig.apiKey 恒为 ''；附 apiKeyMasked/hasApiKey
 * - apiProfiles[].apiKey 恒为 ''；附 apiKeyMasked/hasApiKey
 */
function _maskSection(sec, plainKey) {
  const s = (sec && typeof sec === 'object') ? Object.assign({}, sec) : {};
  for (const k of SENSITIVE_KEYS) { try { if (k in s) delete s[k]; } catch (e) {} }
  const pk = String(plainKey || '');
  s.apiKey = '';
  s.apiKeyMasked = maskKey(pk);
  s.hasApiKey = !!pk;
  return s;
}

function getMaskedAiConfig() {
  const full = loadAiConfigFull();
  const out = Object.assign({}, full);
  let cred = null;
  try { cred = _readCredentialsSync(); } catch (e) { cred = null; }
  const apiPlain = (full && full.api && full.api.apiKey) || (cred && cred.apiKey) || '';
  const byokPlain = (full && full.byok && full.byok.apiKey) || (cred && cred.byokApiKey) || '';
  const apiCfgPlain = (full && full.apiConfig && full.apiConfig.apiKey) || (cred && cred.apiConfigApiKey) || '';
  try { out.api = _maskSection(full.api, apiPlain); } catch (e) {}
  try { if (full.byok) out.byok = _maskSection(full.byok, byokPlain); } catch (e) {}
  try { if (full.apiConfig) out.apiConfig = _maskSection(full.apiConfig, apiCfgPlain); } catch (e) {}
  try {
    if (Array.isArray(full.apiProfiles)) {
      out.apiProfiles = full.apiProfiles.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const id = p.id != null ? String(p.id) : '';
        const plain = (p.apiKey) || (cred && cred.profiles && cred.profiles[id]) || '';
        return _maskSection(p, plain);
      });
    }
  } catch (e) {}
  if (!isPersistAvailable()) {
    out.persistHint = '当前环境不支持安全存储，凭据仅本次会话有效，重启后需重新输入';
  }
  return out;
}

/**
 * 保存配置：非敏感直写（原子），敏感非空才更新加密存储，空串视为不更新（防掩码回写冲掉真凭据）。
 * 返回掩码视图（供 IPC 直接返回，永不泄明文）。
 */
function maskedSave(cfg) {
  return Promise.resolve().then(() => {
    const incoming = (cfg && typeof cfg === 'object') ? cfg : {};
    const curFull = loadAiConfigFull();
    // 1) 提取 incoming 非空敏感 → 新凭据（空=不更新）
    const incKeys = _extractPlainKeys(incoming);
    const curCred = _readCredentialsSync();
    let nextApiKey = curCred.apiKey || '';
    let nextByokKey = curCred.byokApiKey || '';
    let nextApiCfgKey = curCred.apiConfigApiKey || '';
    const nextProfiles = Object.assign({}, curCred.profiles || {});
    if (incKeys.apiKey && String(incKeys.apiKey).trim() !== '') nextApiKey = String(incKeys.apiKey);
    if (incKeys.byokApiKey && String(incKeys.byokApiKey).trim() !== '') nextByokKey = String(incKeys.byokApiKey);
    if (incKeys.apiConfigApiKey && String(incKeys.apiConfigApiKey).trim() !== '') nextApiCfgKey = String(incKeys.apiConfigApiKey);
    try {
      for (const id of Object.keys(incKeys.profiles || {})) {
        const v = incKeys.profiles[id];
        if (v != null && String(v).trim() !== '') nextProfiles[String(id)] = String(v);
      }
    } catch (e) {}
    // incoming.apiProfiles 中显式空 apiKey 不得删除已有：以上已保证（仅非空覆盖）

    // 2) 合并非敏感配置（沿用旧 ai:save-config 语义：Object.assign + 引擎切换清理）
    const next = Object.assign({}, curFull, incoming);
    try {
      // api 需深合并但剔除敏感（空回写不冲）
      const curApi = (curFull && curFull.api && typeof curFull.api === 'object') ? curFull.api : {};
      const incApi = (incoming.api && typeof incoming.api === 'object') ? incoming.api : null;
      if (incApi) {
        const mergedApi = Object.assign({}, curApi, incApi);
        // 空 apiKey 回写=不更新：恢复旧值占位（落盘前会被剥离，内存全量由凭据叠加）
        if (incApi.apiKey == null || String(incApi.apiKey) === '') {
          try { delete mergedApi.apiKey; } catch (e) {}
        }
        for (const k of SENSITIVE_KEYS) { if (k !== 'apiKey') { try { delete mergedApi[k]; } catch (e) {} } }
        next.api = mergedApi;
      }
    } catch (e) {}
    try {
      if (incoming.byok && typeof incoming.byok === 'object') {
        const merged = Object.assign({}, curFull.byok || {}, incoming.byok);
        if (incoming.byok.apiKey == null || String(incoming.byok.apiKey) === '') { try { delete merged.apiKey; } catch (e) {} }
        for (const k of SENSITIVE_KEYS) { if (k !== 'apiKey') { try { delete merged[k]; } catch (e) {} } }
        next.byok = merged;
      }
      if (incoming.apiConfig && typeof incoming.apiConfig === 'object') {
        const merged = Object.assign({}, curFull.apiConfig || {}, incoming.apiConfig);
        if (incoming.apiConfig.apiKey == null || String(incoming.apiConfig.apiKey) === '') { try { delete merged.apiKey; } catch (e) {} }
        for (const k of SENSITIVE_KEYS) { if (k !== 'apiKey') { try { delete merged[k]; } catch (e) {} } }
        next.apiConfig = merged;
      }
      if (Array.isArray(incoming.apiProfiles)) {
        // profiles 数组整体替换非敏感部分，但每项空 apiKey 保留旧凭据映射
        next.apiProfiles = incoming.apiProfiles.map((p) => {
          if (!p || typeof p !== 'object') return p;
          const q = Object.assign({}, p);
          try { delete q.apiKey; } catch (e) {}
          for (const k of SENSITIVE_KEYS) { try { if (k in q) delete q[k]; } catch (e) {} }
          // 保留 id/name 等，其余透传
          return Object.assign({}, p, q, { apiKey: '' });
        });
        // 注意：nextProfiles 已在步骤1按 id 合并非空键
      }
    } catch (e) {}
    if (incoming && (Array.isArray(incoming.visibleModelsCli) || isCliModelMap(incoming.visibleModelsCli))) next.visibleModelsCli = sanitizeCliModelMap(incoming.visibleModelsCli);
    if (incoming && Array.isArray(incoming.visibleModelsApi)) next.visibleModelsApi = incoming.visibleModelsApi;
    if (incoming && Array.isArray(incoming.visibleModels)) next.visibleModels = incoming.visibleModels;
    if (incoming && (Array.isArray(incoming.customModelsCli) || isCliModelMap(incoming.customModelsCli))) next.customModelsCli = sanitizeCliModelMap(incoming.customModelsCli);
    if (incoming && typeof incoming.agentId === 'string') next.agentId = incoming.agentId;
    if (incoming && typeof incoming.mainAgent === 'string') next.mainAgent = incoming.mainAgent;
    if (incoming && typeof incoming.cliPaths === 'object' && incoming.cliPaths) next.cliPaths = incoming.cliPaths;
    if (incoming && (incoming.engine === 'cli' || incoming.engine === 'api')) {
      next.engine = incoming.engine;
      if (incoming.engine === 'cli') { try { delete next.mode; delete next.providerType; } catch (e) {} }
      else { next.mode = 'api'; next.providerType = 'api'; }
    }

    // 3) 持久化凭据（加密可用则落独立文件，否则仅内存）
    const ss = getSafeStorage();
    let persisted = false;
    let hint = '';
    if (!ss) {
      _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
      _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
      hint = '当前环境不支持安全存储，凭据仅本次会话有效，重启后需重新输入';
    } else {
      const { credPath } = resolvePaths();
      let fileObj = { version: 1, entries: { default: {} } };
      try {
        if (fs.existsSync(credPath)) {
          const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
          if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object') fileObj = raw;
        }
      } catch (e) {}
      fileObj.version = 1;
      fileObj.entries = fileObj.entries || {};
      try {
        const enc = {};
        if (nextApiKey) enc.apiEnc = ss.encryptString(String(nextApiKey)).toString('base64');
        if (nextByokKey) enc.byokEnc = ss.encryptString(String(nextByokKey)).toString('base64');
        if (nextApiCfgKey) enc.apiConfigEnc = ss.encryptString(String(nextApiCfgKey)).toString('base64');
        const profEnc = {};
        for (const id of Object.keys(nextProfiles || {})) {
          const v = nextProfiles[id];
          if (v) { try { profEnc[String(id)] = ss.encryptString(String(v)).toString('base64'); } catch (e) {} }
        }
        if (Object.keys(profEnc).length) enc.profilesEnc = profEnc;
        if (!enc.apiEnc && !enc.byokEnc && !enc.apiConfigEnc && !enc.profilesEnc) {
          try { delete fileObj.entries.default; } catch (e) {}
        } else {
          fileObj.entries.default = enc;
        }
        _atomicWriteJson(credPath, fileObj, true);
        persisted = true;
      } catch (e) {
        _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
        _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
        persisted = false;
        hint = '安全存储加密失败，凭据仅本次会话有效';
      }
      // 同步内存缓存，便于本次会话快速读取
      try {
        _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
        _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
      } catch (e) {}
    }

    // 4) 落盘非敏感配置（原子写，剥离敏感）
    try {
      const { configPath } = resolvePaths();
      const safe = toSafePersistedShape(next);
      _atomicWriteJson(configPath, safe, false);
    } catch (e) {}

    const masked = getMaskedAiConfig();
    return { ok: true, config: masked, persisted, hint: hint || undefined };
  });
}

/** 兼容旧同步 saveAiCfg(c) 签名：内部走加密保存（fire-and-forget，保留 cliPath 等非敏感语义） */
function saveAiCfgSyncCompat(c) {
  try {
    // 同步路径：非敏感部分原子写；敏感部分同步加密（如可用）否则进内存
    const incoming = (c && typeof c === 'object') ? c : {};
    const curFull = loadAiConfigFull();
    const incKeys = _extractPlainKeys(incoming);
    const curCred = _readCredentialsSync();
    let nextApiKey = curCred.apiKey || '';
    let nextByokKey = curCred.byokApiKey || '';
    let nextApiCfgKey = curCred.apiConfigApiKey || '';
    const nextProfiles = Object.assign({}, curCred.profiles || {});
    if (incKeys.apiKey) nextApiKey = String(incKeys.apiKey);
    if (incKeys.byokApiKey) nextByokKey = String(incKeys.byokApiKey);
    if (incKeys.apiConfigApiKey) nextApiCfgKey = String(incKeys.apiConfigApiKey);
    for (const id of Object.keys(incKeys.profiles || {})) nextProfiles[String(id)] = String(incKeys.profiles[id]);
    const ss = getSafeStorage();
    if (!ss) {
      _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
      _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
    } else {
      try {
        const { credPath } = resolvePaths();
        let fileObj = { version: 1, entries: { default: {} } };
        try {
          if (fs.existsSync(credPath)) {
            const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            if (raw && raw.entries && raw.entries.default) fileObj = raw;
          }
        } catch (e) {}
        fileObj.version = 1; fileObj.entries = fileObj.entries || {};
        const enc = {};
        if (nextApiKey) enc.apiEnc = ss.encryptString(String(nextApiKey)).toString('base64');
        if (nextByokKey) enc.byokEnc = ss.encryptString(String(nextByokKey)).toString('base64');
        if (nextApiCfgKey) enc.apiConfigEnc = ss.encryptString(String(nextApiCfgKey)).toString('base64');
        const profEnc = {};
        for (const id of Object.keys(nextProfiles || {})) {
          if (nextProfiles[id]) { try { profEnc[String(id)] = ss.encryptString(String(nextProfiles[id])).toString('base64'); } catch (e) {} }
        }
        if (Object.keys(profEnc).length) enc.profilesEnc = profEnc;
        if (!enc.apiEnc && !enc.byokEnc && !enc.apiConfigEnc && !enc.profilesEnc) {
          try { delete fileObj.entries.default; } catch (e) {}
        } else fileObj.entries.default = enc;
        _atomicWriteJson(credPath, fileObj, true);
      } catch (e) {
        _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
        _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
      }
      try {
        _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
        _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
      } catch (e) {}
    }
    // 合并 + 剥离落盘（保留旧 Object.assign 语义，但敏感不落）
    const next = Object.assign({}, curFull, incoming);
    try {
      if (incoming.api) next.api = Object.assign({}, curFull.api || {}, incoming.api);
      try { if (next.api) delete next.api.apiKey; } catch (e) {}
      for (const k of SENSITIVE_KEYS) { try { if (next.api && k in next.api) delete next.api[k]; } catch (e) {} }
    } catch (e) {}
    try {
      if (incoming.byok) next.byok = Object.assign({}, curFull.byok || {}, incoming.byok);
      try { if (next.byok) delete next.byok.apiKey; } catch (e) {}
      if (incoming.apiConfig) next.apiConfig = Object.assign({}, curFull.apiConfig || {}, incoming.apiConfig);
      try { if (next.apiConfig) delete next.apiConfig.apiKey; } catch (e) {}
      if (Array.isArray(incoming.apiProfiles)) next.apiProfiles = incoming.apiProfiles.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const q = Object.assign({}, p);
        try { delete q.apiKey; } catch (e) {}
        return q;
      });
    } catch (e) {}
    const { configPath } = resolvePaths();
    _atomicWriteJson(configPath, toSafePersistedShape(next), false);
  } catch (e) {}
}

/**
 * 一次性迁移旧明文：先备份 ai-config.json.bak-<ts>，再提取明文进加密存储并剥离落盘。
 * 幂等：无明文返回 {migrated:0}；进程内一次 + 文件无明文即 0。
 */
function migratePlaintextOnce() {
  return Promise.resolve().then(async () => {
    if (_migratedOnce) return { migrated: 0, skipped: true };
    _migratedOnce = true;
    const { configPath } = resolvePaths();
    let raw = null;
    try {
      if (!fs.existsSync(configPath)) return { migrated: 0 };
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) { return { migrated: 0, error: String((e && e.message) || e) }; }
    if (!raw || typeof raw !== 'object') return { migrated: 0 };
    const keys = _extractPlainKeys(raw);
    const hasPlain = !!(keys.apiKey || keys.byokApiKey || keys.apiConfigApiKey || Object.keys(keys.profiles || {}).length);
    // 额外检查顶层敏感键残留
    let topPlain = false;
    try {
      for (const k of SENSITIVE_KEYS) {
        if (raw[k] != null && String(raw[k]).trim() !== '') { topPlain = true; break; }
      }
    } catch (e) {}
    if (!hasPlain && !topPlain) return { migrated: 0 };
    // 先备份
    let backupPath = '';
    try {
      const d = new Date();
      const p = require('../state').pad2;
      const ts = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
      backupPath = configPath + '.bak-' + ts;
      fs.copyFileSync(configPath, backupPath);
    } catch (e) { return { migrated: 0, error: '备份失败，已中止迁移：' + String((e && e.message) || e) }; }
    // 合并进凭据存储（复用保存逻辑：非空覆盖）
    try {
      const curCred = _readCredentialsSync();
      let nextApiKey = curCred.apiKey || keys.apiKey || '';
      let nextByokKey = curCred.byokApiKey || keys.byokApiKey || '';
      let nextApiCfgKey = curCred.apiConfigApiKey || keys.apiConfigApiKey || '';
      const nextProfiles = Object.assign({}, curCred.profiles || {}, keys.profiles || {});
      // 若三位置同值仅存一处仍需全补（保持旧语义：三处互为 fallback）
      try {
        const anyKey = nextApiKey || nextByokKey || nextApiCfgKey || Object.values(nextProfiles)[0] || '';
        if (anyKey) {
          if (!nextApiKey) nextApiKey = anyKey;
          if (!nextByokKey) nextByokKey = anyKey;
          if (!nextApiCfgKey) nextApiCfgKey = anyKey;
        }
      } catch (e) {}
      const ss = getSafeStorage();
      if (!ss) {
        _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
        _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
      } else {
        const { credPath } = resolvePaths();
        let fileObj = { version: 1, entries: { default: {} } };
        try {
          if (fs.existsSync(credPath)) {
            const r2 = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            if (r2 && r2.entries && typeof r2.entries === 'object') fileObj = r2;
          }
        } catch (e) {}
        fileObj.version = 1; fileObj.entries = fileObj.entries || {};
        const enc = {};
        try {
          if (nextApiKey) enc.apiEnc = ss.encryptString(String(nextApiKey)).toString('base64');
          if (nextByokKey) enc.byokEnc = ss.encryptString(String(nextByokKey)).toString('base64');
          if (nextApiCfgKey) enc.apiConfigEnc = ss.encryptString(String(nextApiCfgKey)).toString('base64');
          const profEnc = {};
          for (const id of Object.keys(nextProfiles || {})) {
            if (nextProfiles[id]) { try { profEnc[String(id)] = ss.encryptString(String(nextProfiles[id])).toString('base64'); } catch (e) {} }
          }
          if (Object.keys(profEnc).length) enc.profilesEnc = profEnc;
        } catch (e) {
          _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
          _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
          return { migrated: 0, backupPath, error: '加密失败，已备份未剥离' };
        }
        fileObj.entries.default = enc;
        _atomicWriteJson(credPath, fileObj, true);
        try {
          _memCreds.apiKey = nextApiKey; _memCreds.byokApiKey = nextByokKey;
          _memCreds.apiConfigApiKey = nextApiCfgKey; _memCreds.profiles = nextProfiles;
        } catch (e) {}
      }
    } catch (e) {}
    // 剥离落盘（原子）
    try {
      const stripped = toSafePersistedShape(raw);
      // 顶层敏感一并丢弃（toSafe 已丢）
      _atomicWriteJson(configPath, stripped, false);
    } catch (e) { return { migrated: 0, backupPath, error: String((e && e.message) || e) }; }
    const nProf = Object.keys(keys.profiles || {}).length;
    return { migrated: 1 + nProf, backupPath };
  });
}

module.exports = {
  resolvePaths,
  resolveUserDataDir,
  isPersistAvailable,
  maskKey,
  defaultAiCfg,
  toSafePersistedShape,
  loadAiConfigFull,
  getMaskedAiConfig,
  saveAiConfig: maskedSave,
  saveAiCfgSyncCompat,
  migratePlaintextOnce,
  _readCredentialsSync,
  _setPathsForTest,
  _resetForTest,
};
