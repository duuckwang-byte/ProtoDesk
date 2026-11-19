'use strict';
/**
 * main/services/ai-thinking-cache.js — 思考强度（模型 configOptions）磁盘缓存
 *
 * 目的：ACP `previewModelConfig` 冷启动要拉起 Agent 子进程（数百 ms ~ 数秒），
 * 「打开设置 / 保存模型 / 应用启动」这些 UI 动作不能等它。本模块只做持久化：
 * userData/ai-thinking-cache.json，不探测、不启动进程。
 *
 * 结构（version 固定 1，不匹配整份作废，旧结构不猜）：
 *   { version: 1,
 *     entries: { "<agentId>|<model>": {
 *       agentId, model, configOptions[], modelConfigId, status, ts, error?
 *     } } }
 *   - key 用 `agentId|model`：换 Agent / 换模型天然隔离，绝不串档；
 *   - status: 'ready' | 'unsupported' | 'error'（只有前两种算「命中」）；
 *   - ts: 写入毫秒时间戳；error: 失败摘要（已截断，最多 200 字）。
 *
 * 约束：
 *   - 只存 configOptions / modelConfigId 这类 UI 元数据，敏感键（apiKey/token/secret…）
 *     在写入前递归剔除，绝不落 token / 凭据；
 *   - 读：坏 JSON / 版本不符 / 结构非法一律回空，永不抛错；
 *   - 写：同目录临时文件 + rename 原子替换，失败不破坏旧文件；
 *   - 裁剪：prune 按 maxAgeMs 过期 + maxEntries 上限（保留最新）。
 *
 * 纯 Node 可测：filePath / maxEntries / maxAgeMs / now 均可注入，不依赖 Electron。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 磁盘结构版本；不匹配时整份作废（旧结构不猜） */
const CACHE_VERSION = 1;
/** 缓存文件名（落在 Electron userData 下） */
const CACHE_FILE_NAME = 'ai-thinking-cache.json';
/** key 分隔符：`<agentId>|<model>` */
const KEY_SEPARATOR = '|';
/** 条目上限（超出按 ts 保留最新） */
const DEFAULT_MAX_ENTRIES = 64;
/** 条目最长保留期：7 天（过期由 prune 丢弃，等于缓存有效期） */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** 合法状态集合 */
const VALID_STATUS = ['ready', 'unsupported', 'error'];
/** 单个条目的 configOptions 上限（防异常大对象撑爆文件） */
const MAX_OPTIONS = 40;
/** 递归清洗的最大深度 */
const MAX_DEPTH = 4;
/** 单个字符串字段最大长度 */
const MAX_TEXT = 400;
/** 敏感键正则：命中即丢弃，缓存文件不允许出现凭据 */
const SENSITIVE_KEY_RE = /(api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|credential|authorization)/i;

/**
 * 转字符串并 trim；null/undefined 归空串。
 * @param {*} value 任意值
 * @returns {string} 字符串
 */
function asString(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * 构造缓存 key。
 * @param {string} agentId Agent id
 * @param {string} model 模型 id
 * @returns {string} `<agentId>|<model>`
 */
function buildCacheKey(agentId, model) {
  return asString(agentId) + KEY_SEPARATOR + asString(model);
}

/**
 * 拆解缓存 key；非法返回空串字段。
 * @param {string} key `<agentId>|<model>`
 * @returns {{agentId:string, model:string}} 拆解结果
 */
function parseCacheKey(key) {
  const k = asString(key);
  const at = k.indexOf(KEY_SEPARATOR);
  if (at <= 0) return { agentId: '', model: '' };
  return { agentId: k.slice(0, at), model: k.slice(at + 1) };
}

/**
 * 递归清洗配置项：剔除敏感键、限制深度/长度/数量，保证落盘只有 UI 元数据。
 * @param {*} value 原始值
 * @param {number} [depth] 当前深度
 * @returns {*} 清洗后的值
 */
function scrubValue(value, depth) {
  const d = typeof depth === 'number' ? depth : 0;
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (d >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const cleaned = scrubValue(item, d + 1);
      if (cleaned !== undefined) out.push(cleaned);
    }
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    try {
      for (const key of Object.keys(value)) {
        if (SENSITIVE_KEY_RE.test(key)) continue;
        const cleaned = scrubValue(value[key], d + 1);
        if (cleaned !== undefined) out[key] = cleaned;
      }
    } catch (e) {
      return undefined;
    }
    return out;
  }
  return undefined;
}

/**
 * 清洗 configOptions 列表（非数组回空数组）。
 * @param {*} list 原始 configOptions
 * @returns {Array<Object>} 清洗后的列表
 */
function scrubConfigOptions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (out.length >= MAX_OPTIONS) break;
    const cleaned = scrubValue(raw, 0);
    if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)) out.push(cleaned);
  }
  return out;
}

/**
 * userData 目录：生产取 Electron app.getPath；纯 Node 回落 .devdata（与 acp-model-cache 一致）。
 * @returns {string} userData 绝对路径
 */
function resolveUserDataDir() {
  try {
    const el = require('electron');
    if (el && el.app && typeof el.app.getPath === 'function') {
      const p = el.app.getPath('userData');
      if (p) return String(p);
    }
  } catch (e) {}
  try {
    return path.join(__dirname, '..', '..', '.devdata');
  } catch (e) {
    return process.cwd();
  }
}

/**
 * 默认缓存文件绝对路径。
 * @returns {string} userData/ai-thinking-cache.json
 */
function defaultCachePath() {
  try {
    return path.join(resolveUserDataDir(), CACHE_FILE_NAME);
  } catch (e) {
    return path.join(process.cwd(), CACHE_FILE_NAME);
  }
}

/**
 * 归一化单条缓存记录；非法返回 null（读取时跳过，不拖垮整份文件）。
 * @param {*} raw 原始记录
 * @param {string} [fallbackKey] 记录所在 key，用于补全缺失的 agentId/model
 * @returns {Object|null} 归一化记录
 */
function normalizeEntry(raw, fallbackKey) {
  try {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    let agentId = asString(src.agentId);
    let model = asString(src.model);
    if ((!agentId || !model) && typeof fallbackKey === 'string') {
      const parsed = parseCacheKey(fallbackKey);
      if (!agentId) agentId = parsed.agentId;
      if (!model) model = parsed.model;
    }
    if (!agentId || !model) return null;

    const configOptions = scrubConfigOptions(src.configOptions);
    const rawStatus = asString(src.status).toLowerCase();
    let status = VALID_STATUS.indexOf(rawStatus) >= 0 ? rawStatus : '';
    if (!status) status = configOptions.length ? 'ready' : 'unsupported';
    /* ready 却没有 configOptions：按 unsupported 处理，避免把空列表当有效档位 */
    if (status === 'ready' && !configOptions.length) status = 'unsupported';

    const tsNum = Number(src.ts);
    /* 缺失 / 非法 ts 视为最旧（0），由 prune 清掉，不当成刚写入的新鲜缓存 */
    const ts = (isFinite(tsNum) && tsNum > 0) ? Math.floor(tsNum) : 0;

    const entry = {
      agentId,
      model,
      configOptions,
      modelConfigId: asString(src.modelConfigId),
      status,
      ts,
    };
    const error = asString(src.error).slice(0, 200);
    if (error) entry.error = error;
    return entry;
  } catch (e) {
    return null;
  }
}

/**
 * 裁剪文档：先按 maxAgeMs 丢过期，再按 maxEntries 保留最新 ts。
 * @param {{entries:Object}} doc 缓存文档（原地修改）
 * @param {{maxEntries:number, maxAgeMs:number, now:number}} rule 裁剪规则
 * @returns {number} 删除条数
 */
function pruneDoc(doc, rule) {
  let removed = 0;
  try {
    const entries = doc && doc.entries;
    if (!entries || typeof entries !== 'object') return 0;
    const now = rule.now;
    const maxAge = rule.maxAgeMs;
    for (const key of Object.keys(entries)) {
      const entry = entries[key];
      if (!entry || !entry.agentId || !entry.model || buildCacheKey(entry.agentId, entry.model) !== key) {
        delete entries[key];
        removed += 1;
        continue;
      }
      if (!(entry.ts > 0) || (maxAge > 0 && (now - entry.ts) > maxAge)) {
        delete entries[key];
        removed += 1;
      }
    }
    const maxEntries = rule.maxEntries;
    const keys = Object.keys(entries);
    if (maxEntries > 0 && keys.length > maxEntries) {
      keys.sort((a, b) => (entries[b].ts || 0) - (entries[a].ts || 0));
      for (const key of keys.slice(maxEntries)) {
        delete entries[key];
        removed += 1;
      }
    }
  } catch (e) {
    return removed;
  }
  return removed;
}

/**
 * 创建一份缓存实例（路径 / 上限 / 保留期 / 时钟可注入，便于单测与多目录隔离）。
 * @param {Object} [options] 配置
 * @param {string} [options.filePath] 缓存文件绝对路径，缺省 userData/ai-thinking-cache.json
 * @param {number} [options.maxEntries] 条目上限，缺省 64
 * @param {number} [options.maxAgeMs] 条目保留期毫秒，缺省 7 天
 * @param {Function} [options.now] 时钟（返回毫秒），缺省 Date.now
 * @returns {Object} 缓存实例 {filePath, load, get, set, prune, clearAll}
 */
function createThinkingCache(options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const filePath = opts.filePath ? path.resolve(String(opts.filePath)) : defaultCachePath();
  const maxEntries = (typeof opts.maxEntries === 'number' && isFinite(opts.maxEntries) && opts.maxEntries > 0)
    ? Math.floor(opts.maxEntries)
    : DEFAULT_MAX_ENTRIES;
  const maxAgeMs = (typeof opts.maxAgeMs === 'number' && isFinite(opts.maxAgeMs) && opts.maxAgeMs >= 0)
    ? Math.floor(opts.maxAgeMs)
    : DEFAULT_MAX_AGE_MS;
  const clock = (typeof opts.now === 'function') ? opts.now : Date.now;

  /**
   * 同步读取整份缓存；不存在 / 坏 JSON / 版本不符均回空结构。
   * @returns {{version:number, entries:Object<string,Object>}} 缓存文档
   */
  function load() {
    const empty = { version: CACHE_VERSION, entries: {} };
    try {
      if (!fs.existsSync(filePath)) return empty;
      const text = fs.readFileSync(filePath, 'utf8');
      if (!text || !text.trim()) return empty;
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
      if (Number(parsed.version) !== CACHE_VERSION) return empty;
      const src = parsed.entries;
      if (!src || typeof src !== 'object' || Array.isArray(src)) return empty;
      const entries = {};
      for (const key of Object.keys(src)) {
        const entry = normalizeEntry(src[key], key);
        if (!entry) continue;
        /* key 必须与 agentId/model 自洽，防止手改文件后串档 */
        if (buildCacheKey(entry.agentId, entry.model) !== key) continue;
        entries[key] = entry;
      }
      return { version: CACHE_VERSION, entries };
    } catch (e) {
      return empty;
    }
  }

  /**
   * 原子写整份文档：同目录临时文件 + rename，失败不破坏旧文件。
   * @param {{entries:Object}} doc 缓存文档
   * @returns {boolean} 是否写成功
   */
  function writeDoc(doc) {
    let tmp = '';
    try {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      tmp = filePath + '.tmp-' + process.pid + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const payload = JSON.stringify({ version: CACHE_VERSION, entries: doc.entries });
      fs.writeFileSync(tmp, payload, 'utf8');
      try {
        fs.renameSync(tmp, filePath);
      } catch (renameErr) {
        /* Windows 个别场景 rename 不能覆盖旧文件：先删旧文件再 rename（落盘仍是完整临时文件） */
        try { fs.unlinkSync(filePath); } catch (e) {}
        fs.renameSync(tmp, filePath);
      }
      return true;
    } catch (e) {
      return false;
    } finally {
      try { if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
    }
  }

  /**
   * 读取单条缓存（不判新鲜度，由调用方按 status/ts 决定是否采用）。
   * @param {string} key `<agentId>|<model>`
   * @returns {Object|null} 缓存记录副本
   */
  function get(key) {
    try {
      const k = asString(key);
      if (!k) return null;
      const entry = load().entries[k];
      if (!entry) return null;
      return Object.assign({}, entry, { configOptions: scrubConfigOptions(entry.configOptions) });
    } catch (e) {
      return null;
    }
  }

  /**
   * 裁剪过期 / 超限条目；有变化才回写。
   * @returns {number} 删除条数
   */
  function prune() {
    try {
      const doc = load();
      const removed = pruneDoc(doc, { maxEntries, maxAgeMs, now: clock() });
      if (removed > 0) writeDoc(doc);
      return removed;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 写入一条缓存（随后自动裁剪）。
   * @param {string} key `<agentId>|<model>`
   * @param {Object} value {agentId, model, configOptions, modelConfigId, status, ts?, error?}
   * @returns {Object|null} 实际写入的归一化记录
   */
  function set(key, value) {
    try {
      const k = asString(key);
      if (!k) return null;
      const raw = Object.assign({}, (value && typeof value === 'object' && !Array.isArray(value)) ? value : {});
      if (!(Number(raw.ts) > 0)) raw.ts = clock();
      const entry = normalizeEntry(raw, k);
      if (!entry) return null;
      /* key 与记录不一致：拒绝写入，避免 agentId|model 串档 */
      if (buildCacheKey(entry.agentId, entry.model) !== k) return null;
      const doc = load();
      doc.entries[k] = entry;
      pruneDoc(doc, { maxEntries, maxAgeMs, now: clock() });
      return writeDoc(doc) ? entry : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 清空整份缓存（删文件；下次 load 回空）。
   * @returns {boolean} 是否已清空
   */
  function clearAll() {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    filePath,
    maxEntries,
    maxAgeMs,
    load,
    get,
    set,
    prune,
    clearAll,
  };
}

/* ── 默认单例（真实 userData 路径）──
 * 服务层只在需要时惰性取用；这里预建一次，导出的 get/set/prune/load 直接可用。 */
let defaultInstance = null;

/**
 * 取默认缓存实例（惰性创建；创建失败回 null，调用方按无缓存处理）。
 * @returns {Object|null} 缓存实例
 */
function getDefaultCache() {
  if (defaultInstance) return defaultInstance;
  try {
    defaultInstance = createThinkingCache();
  } catch (e) {
    defaultInstance = null;
  }
  return defaultInstance;
}

/**
 * 读默认缓存整份文档。
 * @returns {{version:number, entries:Object}} 缓存文档
 */
function load() {
  const inst = getDefaultCache();
  if (!inst) return { version: CACHE_VERSION, entries: {} };
  return inst.load();
}

/**
 * 读默认缓存的单条记录。
 * @param {string} key `<agentId>|<model>`
 * @returns {Object|null} 缓存记录
 */
function get(key) {
  const inst = getDefaultCache();
  return inst ? inst.get(key) : null;
}

/**
 * 写默认缓存的单条记录。
 * @param {string} key `<agentId>|<model>`
 * @param {Object} value 缓存记录
 * @returns {Object|null} 写入结果
 */
function set(key, value) {
  const inst = getDefaultCache();
  return inst ? inst.set(key, value) : null;
}

/**
 * 裁剪默认缓存。
 * @returns {number} 删除条数
 */
function prune() {
  const inst = getDefaultCache();
  return inst ? inst.prune() : 0;
}

module.exports = {
  CACHE_VERSION,
  CACHE_FILE_NAME,
  KEY_SEPARATOR,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_AGE_MS,
  buildCacheKey,
  parseCacheKey,
  scrubConfigOptions,
  defaultCachePath,
  resolveUserDataDir,
  createThinkingCache,
  getDefaultCache,
  load,
  get,
  set,
  prune,
};
