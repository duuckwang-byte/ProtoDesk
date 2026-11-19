'use strict';
/**
 * main/acp/acp-config.js — ACP 模型目录 / 会话配置规划（T2a）
 *
 * 纯函数层：不 require Electron，不启动进程，不做 I/O，便于单测。
 * 真实探测（inspectAgentModels / getStatus）与 setModel / setConfigOption 的副作用
 * 由调用方（ai-process-service / acp-runtime）负责。
 *
 * 关键约束：
 * - 模型 id 按 ACP 公告原样大小写精确匹配，绝不 lowercase（qoder 的 Qwen... 大小写敏感）；
 * - 不使用 legacy CLI 模型名（如 deepseek-chat）作为 ACP 默认模型；
 * - antigravity fallback 只放 base id，不放 -high/-medium/-low 变体（ACP 不接受）。
 */

/** 错误 detail 最大长度（字符数，不是字节数） */
const MAX_ERROR_DETAIL = 800;

/** 思考强度 config option 的候选 id，按优先级从高到低 */
const THOUGHT_OPTION_KEYS = ['thought_level', 'reasoning_effort', 'effort', 'thinking'];

/**
 * 四个已接入 ACP 的 Agent 的已知可用模型。
 * 仅作为 inspectAgentModels 失败/返回空时的兜底，不替代真实公告。
 * - opencode：正常会返回数百个模型，这里只保留已验证可回 OK 的 id；
 * - antigravity：5 个 base id，带 -high/-medium/-low 的是 legacy 变体，ACP 不接受；
 * - qoder：Qwen 具体 id 以 ACP 公告为准，只硬编码 auto；
 * - codebuddy：session/new 当前模型为 hy4free（与公告首项一致），仅作兜底。
 */
const ACP_MODEL_FALLBACKS = Object.freeze({
  opencode: Object.freeze(['opencode-go/deepseek-v4.1-flash']),
  antigravity: Object.freeze([
    'gemini-4-argon',
    'gemini-3.8-flash',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'gpt-oss-120b-medium'
  ]),
  qoder: Object.freeze(['auto']),
  codebuddy: Object.freeze(['hy4free'])
});

/**
 * 是否为普通对象（非 null / 非数组）。
 * @param {*} value 待判断值
 * @returns {boolean} 是否普通对象
 */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
 * 返回第一个非空字符串。
 * @param {...*} values 候选值
 * @returns {string} 第一个非空值，全部为空时返回空串
 */
function firstText(...values) {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return '';
}

/**
 * 把任意模型声明归一化为 { id, name, description }。
 * 支持字符串、数字以及 { id|modelId|value|model, name|label|displayName, description }。
 * @param {*} raw 原始模型声明
 * @returns {{id:string,name:string,description:string}|null} 归一化模型，非法时返回 null
 */
function toModelEntry(raw) {
  if (typeof raw === 'string' || typeof raw === 'number') {
    const id = asString(raw);
    return id ? { id, name: id, description: '' } : null;
  }
  if (!isPlainObject(raw)) return null;
  const id = firstText(raw.id, raw.modelId, raw.value, raw.model);
  if (!id) return null;
  const name = firstText(raw.name, raw.label, raw.displayName) || id;
  return { id, name, description: asString(raw.description) };
}

/**
 * 归一化模型数组：去重（保留首次出现顺序与原始大小写），过滤非法项。
 * @param {*} list 模型数组 / 单个模型
 * @returns {Array<{id:string,name:string,description:string}>} 归一化模型列表
 */
function normalizeModelList(list) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const model = toModelEntry(raw);
    if (!model || seen.has(model.id)) return;
    seen.add(model.id);
    out.push(model);
  };
  if (Array.isArray(list)) {
    for (const raw of list) push(raw);
  } else if (list != null) {
    push(list);
  }
  return out;
}

/**
 * 把 inspectAgentModels 的返回归一化为 UI 可消费的模型目录。
 * 输入形如 { currentModelId, availableModelIds, availableModels }。
 * availableModels 可含 name/description；availableModelIds 用于补充缺失 id。
 *
 * @param {Object} inspection inspectAgentModels 结果
 * @returns {{models:Array<{id:string,name:string,description:string}>, defaultModel:string,
 *   source:'agent-current'|'first-advertised'|'none'}} 归一化目录
 */
function normalizeModelCatalog(inspection) {
  let src = inspection;
  if (Array.isArray(src)) src = { availableModels: src };
  if (!isPlainObject(src)) src = {};
  // 兼容 status.models 包装形态；直接传入 status.models 时保持原样。
  if (
    isPlainObject(src.models) &&
    !Array.isArray(src.availableModels) &&
    !Array.isArray(src.availableModelIds)
  ) {
    src = src.models;
  }

  const models = [];
  const seen = new Set();
  const push = (raw) => {
    const model = toModelEntry(raw);
    if (!model || seen.has(model.id)) return;
    seen.add(model.id);
    models.push(model);
  };

  if (Array.isArray(src.availableModels)) for (const raw of src.availableModels) push(raw);
  if (Array.isArray(src.availableModelIds)) for (const raw of src.availableModelIds) push(raw);
  if (Array.isArray(src.models)) for (const raw of src.models) push(raw);

  const currentModelId = asString(src.currentModelId != null ? src.currentModelId : src.currentModel);
  if (currentModelId && seen.has(currentModelId)) {
    return { models, defaultModel: currentModelId, source: 'agent-current' };
  }
  if (models.length) {
    return { models, defaultModel: models[0].id, source: 'first-advertised' };
  }
  return { models, defaultModel: '', source: 'none' };
}

/**
 * 提取白名单 id：支持字符串数组、模型对象数组、Set 或单个字符串。
 * @param {*} whitelist 白名单
 * @returns {string[]} 去重后的 id 列表
 */
function extractWhitelistIds(whitelist) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    let id = '';
    if (typeof raw === 'string' || typeof raw === 'number') id = asString(raw);
    else if (isPlainObject(raw)) id = firstText(raw.id, raw.modelId, raw.value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  if (Array.isArray(whitelist)) {
    for (const raw of whitelist) push(raw);
  } else if (whitelist instanceof Set) {
    for (const raw of whitelist) push(raw);
  } else if (whitelist != null) {
    push(whitelist);
  }
  return out;
}

/**
 * 白名单过滤：非空白名单取精确交集；交集为空时降级为全量 advertised 并告警。
 * 白名单匹配与模型 id 一样区分大小写。
 * 返回值保留 advertised 的原始条目（id/name/reasoningOptions 等字段不丢），只做筛选。
 *
 * @param {Array<*>} advertised Agent 公告的模型
 * @param {*} whitelist 用户可见模型白名单（空表示不过滤）
 * @returns {{models:Array<*>, warning:string|null}} 过滤结果
 */
function mergeVisibleModels(advertised, whitelist) {
  const models = Array.isArray(advertised) ? advertised.slice() : [];
  const ids = extractWhitelistIds(whitelist);
  if (!ids.length) return { models, warning: null };

  const wanted = new Set(ids);
  const filtered = models.filter((model) => {
    let id = '';
    if (typeof model === 'string' || typeof model === 'number') id = asString(model);
    else if (isPlainObject(model)) id = firstText(model.id, model.modelId, model.value);
    return !!id && wanted.has(id);
  });
  if (!filtered.length) return { models, warning: 'visibleModels-no-intersection' };
  return { models: filtered, warning: null };
}

/**
 * 解析本轮要应用的模型。
 *
 * 优先级：UI 明确选择（命中 advertised） -> agent-config -> currentModelId -> advertised[0]。
 * globalModel（如 cfg.model='deepseek-chat'）从任何来源出现都忽略，并记 ignored-global-model。
 * UI 明确选择但不在 advertised：返回 ACP_MODEL_UNSUPPORTED，不静默改模型。
 * agent-config 不在 advertised：视为配置过期，降级 current/first 并记 config-model-stale。
 *
 * @param {Object} input 解析入参
 * @param {string} [input.requestedModel] UI / extra 传入的模型
 * @param {string} [input.modelSource] 'ui' | 'agent-config' | ''
 * @param {string} [input.agentConfigModel] cfg.acp.agents[id].model
 * @param {string} [input.currentModelId] status.models.currentModelId
 * @param {Array<*>} [input.advertised] Agent 公告的模型
 * @param {string} [input.globalModel] 需要忽略的全局 / legacy 模型（如 deepseek-chat）
 * @returns {{model:string, source:string, warning:string|null, availableModels:string[],
 *   error?:string}} 模型选择结果
 */
function resolveModelChoice(input) {
  const opts = isPlainObject(input) ? input : {};
  const advertised = normalizeModelList(opts.advertised);
  const availableModels = advertised.map((model) => model.id);
  const known = new Set(availableModels);
  const globalModel = asString(opts.globalModel);
  let warning = null;
  let globalWarned = false;

  const consumeGlobal = (value) => {
    if (!value || !globalModel || value !== globalModel) return false;
    if (!globalWarned) {
      warning = 'ignored-global-model';
      globalWarned = true;
    }
    return true;
  };

  const done = (model, source) => ({ model, source, warning, availableModels });

  const modelSource = asString(opts.modelSource).toLowerCase();
  const requestedModel = asString(opts.requestedModel);

  if (modelSource === 'ui' && requestedModel) {
    if (consumeGlobal(requestedModel)) {
      // 全局 / legacy 模型经 UI 泄漏：忽略该候选，继续按配置 / 当前 / 首个降级。
    } else if (known.has(requestedModel)) {
      return done(requestedModel, 'ui');
    } else {
      return { error: 'ACP_MODEL_UNSUPPORTED', availableModels };
    }
  }

  const agentConfigModel = asString(opts.agentConfigModel);
  if (agentConfigModel) {
    if (!consumeGlobal(agentConfigModel)) {
      if (known.has(agentConfigModel)) return done(agentConfigModel, 'agent-config');
      if (!warning) warning = 'config-model-stale';
    }
  }

  const currentModelId = asString(opts.currentModelId);
  if (currentModelId && !consumeGlobal(currentModelId) && known.has(currentModelId)) {
    return done(currentModelId, 'agent-current');
  }

  if (advertised.length) return done(advertised[0].id, 'first-advertised');
  return done('', 'none');
}

/**
 * 归一化 select options：兼容 flat（{value,name}）与 grouped（{group/name,options}）两种形态。
 * 统一输出 {value,name,description}，供 UI 直接渲染。
 * @param {*} rawOptions 原始 options
 * @returns {Array<{value:string,name:string,description:string}>} flatten 后的选项
 */
function normalizeSelectOptions(rawOptions) {
  const out = [];
  const seen = new Set();

  const push = (item) => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const value = asString(item);
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push({ value, name: value, description: '' });
      return;
    }
    if (!isPlainObject(item)) return;
    // grouped options：{group|name, options:[...]}，递归 flatten。
    if (Array.isArray(item.options)) {
      for (const child of item.options) push(child);
      return;
    }
    const value = firstText(item.value, item.id, item.key);
    if (!value || seen.has(value)) return;
    seen.add(value);
    const name = firstText(item.name, item.label) || value;
    out.push({ value, name, description: asString(item.description) });
  };

  if (Array.isArray(rawOptions)) {
    for (const item of rawOptions) push(item);
  }
  return out;
}

/**
 * 把 configOptions 映射形态转成数组（保留 key 作为 id）。
 * @param {Object} map id -> config option
 * @returns {Array<Object>} 原始 config option 数组
 */
function configOptionsFromMap(map) {
  const out = [];
  for (const key of Object.keys(map)) {
    const value = map[key];
    if (!isPlainObject(value)) continue;
    if (!value.id && !value.key) out.push({ ...value, id: key });
    else out.push(value);
  }
  return out;
}

/**
 * 从 getStatus 结果读取完整 configOptions 列表。
 * 优先 status.details.configOptions，其次 status.configOptions；均支持数组与映射。
 * @param {*} status getStatus 结果 / configOptions 数组 / 映射
 * @returns {Array<Object>} 原始 config option 数组
 */
function pickConfigOptionList(status) {
  if (Array.isArray(status)) return status;
  if (!isPlainObject(status)) return [];
  if (isPlainObject(status.details) && status.details.configOptions != null) {
    const value = status.details.configOptions;
    if (Array.isArray(value)) return value;
    if (isPlainObject(value)) return configOptionsFromMap(value);
    return [];
  }
  if (status.configOptions != null) {
    if (Array.isArray(status.configOptions)) return status.configOptions;
    if (isPlainObject(status.configOptions)) return configOptionsFromMap(status.configOptions);
  }
  return [];
}

/**
 * 归一化 getStatus 公告的 configOptions。
 * 输出 [{id,name,description,category,type,currentValue,options}]；
 * 缺失字段补空、非法条目跳过，绝不抛错。
 *
 * @param {*} status getStatus 结果；也接受 configOptions 数组或映射
 * @returns {Array<{id:string,name:string,description:string,category:string,type:string,
 *   currentValue:* ,options:Array<{value:string,name:string,description:string}>}>} 归一化配置项
 */
function normalizeConfigOptions(status) {
  const list = pickConfigOptionList(status);
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    if (!isPlainObject(raw)) continue;
    const id = firstText(raw.id, raw.key);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const currentValue = raw.currentValue;
    out.push({
      id,
      name: firstText(raw.name, raw.label) || id,
      description: asString(raw.description),
      category: asString(raw.category),
      type: asString(raw.type),
      currentValue:
        typeof currentValue === 'string'
          ? currentValue.trim()
          : (typeof currentValue === 'number' || typeof currentValue === 'boolean' ? currentValue : ''),
      options: normalizeSelectOptions(raw.options)
    });
  }
  return out;
}

/**
 * 归一化思考强度候选值：支持字符串或数组；忽略空值与 'default'（表示不修改）。
 * @param {*} raw requestedThought
 * @returns {string[]} 候选值列表
 */
function normalizeThoughtValues(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    const value = asString(item);
    if (!value || value.toLowerCase() === 'default') continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * 规划本轮会话配置：选模型、选思考强度、保留 model_config 原值。
 *
 * 不执行任何 setModel / setConfigOption，只返回计划，供 T3 应用。
 * 思考强度值必须在公告的 options 内，否则只记 warning，不阻断本轮。
 *
 * @param {Object} input 规划入参
 * @param {Object} [input.status] runtime.getStatus({handle}) 结果
 * @param {string} [input.requestedModel] UI / extra 传入的模型
 * @param {string} [input.modelSource] 'ui' | 'agent-config' | ''
 * @param {string} [input.agentConfigModel] cfg.acp.agents[id].model
 * @param {string|string[]} [input.requestedThought] extra.reasoning 或配置的 thoughtLevel
 * @param {Array<Object>|Object} [input.configOptions] 已单独取得的 configOptions（优先于 status）
 * @param {string} [input.globalModel] 可选：需要忽略的全局 / legacy 模型
 * @returns {{model:string, modelConfigId:string, thoughtConfigId:string, thoughtValue:string,
 *   configOptions:Array<Object>, warnings:string[], error?:string, availableModels?:string[]}} 会话配置计划
 */
function planSessionConfig(input) {
  const opts = isPlainObject(input) ? input : {};

  let configOptions = [];
  if (opts.configOptions != null) {
    if (Array.isArray(opts.configOptions)) {
      configOptions = normalizeConfigOptions(opts.configOptions);
    } else if (isPlainObject(opts.configOptions)) {
      const source = opts.configOptions;
      const hasKnownShape =
        Array.isArray(source.configOptions) ||
        isPlainObject(source.configOptions) ||
        isPlainObject(source.details);
      configOptions = normalizeConfigOptions(hasKnownShape ? source : { configOptions: source });
    }
  } else {
    configOptions = normalizeConfigOptions(opts.status);
  }

  const warnings = [];
  const addWarning = (warning) => {
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  };

  // 与 acpx 的 modelConfigPriority 对齐：id==='model' 优先于仅 category==='model'。
  const modelOption =
    configOptions.find((option) => option.id === 'model') ||
    configOptions.find((option) => option.category === 'model') ||
    null;
  let advertised = modelOption
    ? modelOption.options.map((option) => ({
        id: option.value,
        name: option.name,
        description: option.description
      }))
    : [];

  const statusModels = isPlainObject(opts.status) && isPlainObject(opts.status.models)
    ? opts.status.models
    : null;
  let currentModelId = statusModels ? asString(statusModels.currentModelId) : '';
  if (!currentModelId && modelOption && typeof modelOption.currentValue === 'string') {
    currentModelId = modelOption.currentValue;
  }
  // 没有 model config option 时，退回 status.models 公告；两者都没有则交给 Agent 默认。
  if (!advertised.length && statusModels) {
    const catalog = normalizeModelCatalog(statusModels);
    advertised = catalog.models;
    if (!currentModelId) currentModelId = catalog.defaultModel;
  }

  const resolved = resolveModelChoice({
    requestedModel: opts.requestedModel,
    modelSource: opts.modelSource,
    agentConfigModel: opts.agentConfigModel,
    currentModelId,
    advertised,
    globalModel: opts.globalModel
  });
  addWarning(resolved.warning);

  let thoughtOption = null;
  for (const key of THOUGHT_OPTION_KEYS) {
    thoughtOption = configOptions.find((option) => option.id === key) || null;
    if (thoughtOption) break;
  }
  if (!thoughtOption) {
    thoughtOption = configOptions.find((option) => THOUGHT_OPTION_KEYS.includes(option.category)) || null;
  }

  let thoughtValue = '';
  const thoughtCandidates = normalizeThoughtValues(opts.requestedThought);
  if (thoughtCandidates.length) {
    if (!thoughtOption) {
      addWarning('thought-option-missing');
    } else {
      const allowed = new Set(thoughtOption.options.map((option) => option.value));
      thoughtValue = thoughtCandidates.find((value) => allowed.has(value)) || '';
      if (!thoughtValue) addWarning('thought-value-not-advertised');
    }
  }

  const modelConfigOption = configOptions.find((option) => option.category === 'model_config') || null;

  const result = {
    model: resolved.model || '',
    modelConfigId: modelConfigOption ? modelConfigOption.id : '',
    thoughtConfigId: thoughtOption ? thoughtOption.id : '',
    thoughtValue,
    configOptions,
    warnings
  };
  if (resolved.error) {
    result.error = resolved.error;
    result.availableModels = resolved.availableModels || [];
  }
  return result;
}

/**
 * 把任意值转为可读文本；对象尽量 JSON 序列化，失败则 String。
 * @param {*} value 任意值
 * @returns {string} 文本
 */
function toDetailText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return asString(value.message) || String(value);
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

/**
 * 提取并脱敏错误 detail，供错误卡「展开详情」展示。
 *
 * 来源优先级：err.cause.message -> err.detail -> err.message（字符串错误直接使用）。
 * 单行化、截断 800 字、移除 Authorization / Bearer / apiKey / token / secret / sk- 等凭据。
 *
 * @param {*} err 任意错误
 * @returns {string} 可展示的 detail
 */
function redactErrorDetail(err) {
  let raw = '';
  if (err != null && typeof err === 'object') {
    const cause = err.cause;
    const causeText = isPlainObject(cause) ? toDetailText(cause.message) : toDetailText(cause);
    raw = causeText || toDetailText(err.detail) || toDetailText(err.message);
  } else {
    raw = toDetailText(err);
  }

  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Authorization / apiKey / token / secret 等键值对（兼容 JSON 引号与 Bearer/Basic 前缀）。
  text = text.replace(
    /\b(authorization|api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password|secret|token)\b(["']?\s*[:=]\s*)(["']?)(?:(?:bearer|basic|token|api[-_]?key)\s+)?[^\s"'&,;]+/gi,
    '$1$2$3[REDACTED]'
  );
  // 裸 Bearer token。
  text = text.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  // 常见厂商 token 前缀。
  text = text.replace(/\bsk-[A-Za-z0-9_-]{4,}/g, 'sk-[REDACTED]');
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9]{4,}/g, 'gh_[REDACTED]');

  if (text.length > MAX_ERROR_DETAIL) {
    text = text.slice(0, MAX_ERROR_DETAIL - 1) + '…';
  }
  return text;
}

module.exports = {
  ACP_MODEL_FALLBACKS,
  normalizeModelCatalog,
  mergeVisibleModels,
  resolveModelChoice,
  normalizeConfigOptions,
  planSessionConfig,
  redactErrorDetail
};
