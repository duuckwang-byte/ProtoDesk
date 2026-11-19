'use strict';
/**
 * main/acp/acp-model-cache.js — ACP 模型目录磁盘缓存（T7a）
 *
 * 目的：ACP initialize / session-new 冷启动需 15-22s，打开模型弹窗不能等它。
 * 本模块只负责目录的持久化（userData/acp-model-catalog.json），不探测、不启动进程：
 * - 读：同步读，坏文件 / 版本不符一律回空，绝不抛错；
 * - 写：临时文件 + rename 原子替换，避免半截 JSON；
 * - 过期：条目过期仍可返回（stale-while-revalidate），是否新鲜由 isFresh 判断；
 * - key：`<agentId>::<command>`，换 Agent / 换启动命令天然隔离。
 *
 * 纯 Node 可测：filePath / ttlMs / now 均可注入，不依赖 Electron。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 磁盘结构版本；不匹配时整份作废（旧结构不猜） */
const CACHE_VERSION = 1;
/** 缓存文件名（落在 Electron userData 下） */
const CACHE_FILE_NAME = 'acp-model-catalog.json';
/** 默认 TTL：10 分钟，与 shared.CLI_MODELS_CACHE_TTL 对齐 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * userData 目录：生产取 Electron app.getPath；纯 Node 回落 .devdata（与 acp-runtime 一致）。
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
  try { return path.join(__dirname, '..', '..', '.devdata'); } catch (e) { return process.cwd(); }
}

/**
 * 默认缓存文件绝对路径。
 * @returns {string} userData/acp-model-catalog.json
 */
function defaultCatalogPath() {
  try {
    return path.join(resolveUserDataDir(), CACHE_FILE_NAME);
  } catch (e) {
    return path.join(process.cwd(), CACHE_FILE_NAME);
  }
}

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
 * @param {string} command 启动命令全文（agentCommand.join(' ')）
 * @returns {string} `<agentId>::<command>`
 */
function buildCacheKey(agentId, command) {
  return asString(agentId) + '::' + asString(command);
}

/**
 * 归一并去重模型数组，保留首次出现顺序与原始大小写。
 * @param {*} list 原始模型数组
 * @returns {Array<{id:string,name:string,description:string}>} 归一化模型列表
 */
function normalizeModelList(list) {
  const out = [];
  const seen = new Set();
  const arr = Array.isArray(list) ? list : [];
  for (const raw of arr) {
    let id = '';
    let name = '';
    let description = '';
    if (typeof raw === 'string' || typeof raw === 'number') {
      id = asString(raw);
      name = id;
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      id = asString(raw.id != null ? raw.id : (raw.modelId != null ? raw.modelId : raw.value));
      name = asString(raw.name) || asString(raw.label) || id;
      description = asString(raw.description);
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name || id, description });
  }
  return out;
}

/**
 * 归一化单条缓存记录；非法返回 null（读取时跳过，不拖垮整份文件）。
 * @param {*} raw 原始记录
 * @param {string} [fallbackKey] 记录所在 key，用于补全缺失的 agentId/command
 * @returns {Object|null} 归一化记录
 */
function normalizeEntry(raw, fallbackKey) {
  try {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    let agentId = asString(src.agentId);
    let command = asString(src.command);
    if ((!agentId || !command) && typeof fallbackKey === 'string') {
      const at = fallbackKey.indexOf('::');
      if (at > 0) {
        if (!agentId) agentId = fallbackKey.slice(0, at);
        if (!command) command = fallbackKey.slice(at + 2);
      }
    }
    if (!agentId || !command) return null;

    const models = normalizeModelList(src.models);
    if (!models.length) return null;
    const ids = new Set(models.map((m) => m.id));
    let defaultModel = asString(src.defaultModel);
    if (!defaultModel || !ids.has(defaultModel)) defaultModel = models[0].id;

    const tsNum = Number(src.ts);
    /* 缺失 / 非法 ts 视为过期（0），避免坏记录被当成刚写入的新鲜缓存 */
    const ts = (isFinite(tsNum) && tsNum > 0) ? Math.floor(tsNum) : 0;
    const entry = {
      agentId,
      command,
      models,
      defaultModel,
      source: asString(src.source) || 'acp',
      ts
    };
    const cliVersion = asString(src.cliVersion);
    if (cliVersion) entry.cliVersion = cliVersion;
    return entry;
  } catch (e) {
    return null;
  }
}

/**
 * 创建一份缓存实例（路径 / TTL / 时钟可注入，便于单测与多目录隔离）。
 * @param {Object} [options] 配置
 * @param {string} [options.filePath] 缓存文件绝对路径，缺省 userData/acp-model-catalog.json
 * @param {number} [options.ttlMs] 新鲜期毫秒，缺省 10 分钟
 * @param {Function} [options.now] 时钟（返回毫秒），缺省 Date.now
 * @returns {Object} 缓存实例
 */
function createAcpModelCache(options) {
  const opts = (options && typeof options === 'object') ? options : {};
  const filePath = opts.filePath ? path.resolve(String(opts.filePath)) : defaultCatalogPath();
  const ttlMs = (typeof opts.ttlMs === 'number' && isFinite(opts.ttlMs) && opts.ttlMs > 0)
    ? Math.floor(opts.ttlMs)
    : DEFAULT_TTL_MS;
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
        /* key 必须与 agentId/command 自洽，防止手改文件后串档 */
        if (buildCacheKey(entry.agentId, entry.command) !== key) continue;
        entries[key] = entry;
      }
      return { version: CACHE_VERSION, entries };
    } catch (e) {
      return empty;
    }
  }

  /**
   * 读取单条缓存（过期也返回，由 isFresh 判断新鲜度）。
   * @param {string} key `<agentId>::<command>`
   * @returns {Object|null} 缓存记录副本
   */
  function get(key) {
    try {
      const k = asString(key);
      if (!k) return null;
      const entry = load().entries[k];
      if (!entry) return null;
      return Object.assign({}, entry, { models: entry.models.map((m) => Object.assign({}, m)) });
    } catch (e) {
      return null;
    }
  }

  /**
   * 时间戳是否仍在 TTL 内。
   * @param {number} ts 写入时间戳（毫秒）
   * @param {number} [customTtl] 覆盖实例 TTL
   * @returns {boolean} 是否新鲜
   */
  function isFresh(ts, customTtl) {
    try {
      const n = Number(ts);
      if (!isFinite(n) || n <= 0) return false;
      const ttl = (typeof customTtl === 'number' && isFinite(customTtl) && customTtl > 0)
        ? customTtl
        : ttlMs;
      return (clock() - n) < ttl;
    } catch (e) {
      return false;
    }
  }

  /**
   * 原子写整份文档：同目录临时文件 + rename，失败不破坏旧文件。
   * @param {{version:number, entries:Object}} doc 缓存文档
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
   * 写入一条缓存；同 Agent 的旧命令 / 旧 CLI 版本记录一并失效。
   * @param {string} key `<agentId>::<command>`
   * @param {Object} value {agentId, command, models, defaultModel, source, ts?, cliVersion?}
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
      const doc = load();
      doc.entries[k] = entry;
      for (const other of Object.keys(doc.entries)) {
        if (other === k) continue;
        const old = doc.entries[other];
        if (!old || old.agentId !== entry.agentId) continue;
        if (old.command !== entry.command) {
          delete doc.entries[other];
          continue;
        }
        if (entry.cliVersion && old.cliVersion && old.cliVersion !== entry.cliVersion) {
          delete doc.entries[other];
        }
      }
      return writeDoc(doc) ? entry : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 清掉某个 Agent 的全部命令缓存。
   * @param {string} agentId Agent id
   * @returns {number} 删除条数
   */
  function clearAgent(agentId) {
    try {
      const id = asString(agentId);
      if (!id) return 0;
      const doc = load();
      let removed = 0;
      for (const key of Object.keys(doc.entries)) {
        const entry = doc.entries[key];
        if (!entry || entry.agentId !== id) continue;
        delete doc.entries[key];
        removed += 1;
      }
      if (removed) writeDoc(doc);
      return removed;
    } catch (e) {
      return 0;
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
    ttlMs,
    load,
    get,
    set,
    isFresh,
    clearAgent,
    clearAll
  };
}

module.exports = {
  CACHE_VERSION,
  CACHE_FILE_NAME,
  DEFAULT_TTL_MS,
  buildCacheKey,
  defaultCatalogPath,
  resolveUserDataDir,
  normalizeModelList,
  createAcpModelCache
};
