/**
 * src/renderer/lib/storage-keys.ts — 本地键名契约（常量 + 读写 helpers，原样读写，不迁移）。
 *
 * Wave2（业务迁移阶段）直接用本模块读写 localStorage；旧 js/** 的读写逻辑不动，
 * 本模块只是把键名收敛到一处，避免新代码各写各的键导致分组/折叠/缩放丢失。
 * 关键原则（见 docs 方案 §10.3 与 tests/verify-groups.js）：
 * 1) 作用域键必须含项目（encodeURIComponent 编码），裸全局键只做一次性迁移，永不再写；
 * 2) 读取不到就是空（回空对象/回退值），绝不清空用户已有数据；
 * 3) 本模块不做老→新迁移；裸键一次性迁移统一放 `lib/legacy-migrate.ts`（旧代码
 *    `js/sandbox-core.js loadGroups` 的同口径实现），本模块只提供键/读写原语。
 */

/** 分组裸全局键（老版本键）：仅做一次性迁移来源，永不再直接读写（见 js/sandbox-core.js）。 */
export const GROUPS_KEY_BASE = 'protoGroups_v1';

/** 折叠裸全局键（老版本键）：仅做一次性迁移来源，永不再直接读写。 */
export const GROUPS_FOLD_KEY_BASE = 'protoGroupsFold_v1';

/**
 * 本项目分组键（逐字沿用 js/sandbox-core.js groupsKey）。
 * @param {string} project 当前项目名（空串回 _default，与旧代码一致）
 * @returns {string} 形如 protoGroups_v1__<encodeURIComponent(project)> 的作用域键
 */
export function groupsKey(project: string): string {
  try {
    return GROUPS_KEY_BASE + '__' + encodeURIComponent(project || '_default');
  } catch {
    return GROUPS_KEY_BASE;
  }
}

/**
 * 本项目折叠键（逐字沿用 js/sandbox-core.js groupsFoldKey）。
 * @param {string} project 当前项目名（空串回 _default，与旧代码一致）
 * @returns {string} 形如 protoGroupsFold_v1__<encodeURIComponent(project)> 的作用域键
 */
export function groupsFoldKey(project: string): string {
  try {
    return GROUPS_FOLD_KEY_BASE + '__' + encodeURIComponent(project || '_default');
  } catch {
    return GROUPS_FOLD_KEY_BASE;
  }
}

/** 舞台内容缩放键（逐字沿用 js/nav-zoom.js contentZoom）。 */
export const CONTENT_ZOOM_KEY = 'contentZoom';

/** 缩放回退值（旧代码无有效值时回 0.85，见 js/nav-zoom.js CONTENT_SCALE 初始化）。 */
export const CONTENT_ZOOM_FALLBACK = 0.85;

/** 缩放下限（逐字沿用 js/nav-zoom.js clampZoom：0.2..3）。 */
export const CONTENT_ZOOM_MIN = 0.2;

/** 缩放上限（逐字沿用 js/nav-zoom.js clampZoom：0.2..3）。 */
export const CONTENT_ZOOM_MAX = 3;

/** 上次进入的项目键（逐字沿用 js/project-ai-export.js enterProject 写、启动读）。 */
export const PROTO_LAST_PROJECT = 'protoLastProject';

/** AI 当前模型键（逐字沿用 js/project-ai-export.js:5697）。 */
export const AI_MODEL_KEY = 'ai_model';

/** AI 思考强度键（逐字沿用 js/project-ai-export.js:5698）。 */
export const AI_REASONING_KEY = 'ai_model_reasoning';

/** 标注显隐键（逐字沿用 js/annotation-core.js:1007）。 */
export const PROTO_ANNO_VISIBLE = 'proto_anno_visible';

/** 链接检查器折叠键（逐字沿用 js/link-bind.js:900）。 */
export const LINK_INSP_FOLD = 'linkInspFold_v1';

/** 待提交队列键（逐字沿用 js/store.js:83 / js/edit-entry.js:2347）。 */
export const EDIT_QUEUE_KEY = 'edit_queue_v1';

/** 待提交队列备份键（逐字沿用 js/edit-entry.js:2347）。 */
export const EDIT_QUEUE_BACKUP_KEY = 'edit_queue_backup';

/** 文档窗重开标记键（逐字沿用 js/core-docs.js:4589）。 */
export const DOC_WIN_REOPEN = 'docWinReopen';

/** 原型排序键（逐字沿用 js/sandbox-core.js ORDER_KEY，拖拽排序持久化）。 */
export const ORDER_KEY = 'protoOrder_v1';

/** 子页面排序键（逐字沿用 js/sandbox-core.js SUB_ORDER_KEY，拖拽排序持久化）。 */
export const SUB_ORDER_KEY = 'subPageOrder_v1';

/** AI 单会话历史键前缀（逐字沿用 js/project-ai-export.js aiHistKey）。 */
export const AI_HIST_PREFIX = 'ai_hist_';

/**
 * 单会话历史键（逐字沿用旧规则：有目录取编码目录，无目录取 ROOT）。
 * @param {string} dir 沙箱目录标识（aiSbxDir 口径）
 * @returns {string} 形如 ai_hist_<encodeURIComponent(dir)> 或 ai_hist_ROOT
 */
export function aiHistKey(dir: string): string {
  try {
    return AI_HIST_PREFIX + (dir ? encodeURIComponent(dir) : 'ROOT');
  } catch {
    return AI_HIST_PREFIX + 'ROOT';
  }
}

/** AI 多会话存储键前缀（逐字沿用 js/project-ai-export.js SESS_KEY）。 */
export const SESS_STORE_PREFIX = 'ai_sessions_v2_';

/**
 * 多会话存储键（逐字沿用旧规则：前缀 + 编码目录）。
 * @param {string} dir 沙箱目录标识
 * @returns {string} 形如 ai_sessions_v2_<encodeURIComponent(dir)>
 */
export function sessStoreKey(dir: string): string {
  try {
    return SESS_STORE_PREFIX + encodeURIComponent(dir || '');
  } catch {
    return SESS_STORE_PREFIX;
  }
}

/**
 * 会话激活指针键（逐字沿用旧规则：SESS_KEY + # + 编码会话 id）。
 * @param {string} sessionId 会话 id
 * @returns {string} 形如 ai_sessions_v2_#<encodeURIComponent(sessionId)>
 */
export function sessActiveKey(sessionId: string): string {
  try {
    return SESS_STORE_PREFIX + '#' + encodeURIComponent(sessionId || '');
  } catch {
    return SESS_STORE_PREFIX + '#';
  }
}

/** 文档缓存键前缀（逐字沿用 js/core-docs.js DOCS_KEY_PREFIX）。 */
export const DOCS_KEY_PREFIX = 'protoDoc_v2_';

/**
 * 单源文档缓存键（逐字沿用 js/core-docs.js sourceDocKey：前缀 + 源名 + _ + 端别）。
 * @param {string} name 源文件名
 * @param {string} kind 端别（mobile/pc）
 * @returns {string} 形如 protoDoc_v2_<name>_<kind>
 */
export function sourceDocKey(name: string, kind: string): string {
  return DOCS_KEY_PREFIX + String(name || '') + '_' + String(kind || 'mobile');
}

/** 文档草稿键前缀（逐字沿用 js/core-docs.js protoDocDraft_ 口径）。 */
export const DOC_DRAFT_PREFIX = 'protoDocDraft_';

/**
 * 文档草稿键（逐字沿用旧规则：需求态追加 __req__，异常回 protoDocDraft_default）。
 * @param {string} scope 草稿作用域（通常为 sourceDocKey 结果）
 * @param {boolean} inReq 是否处于需求态
 * @returns {string} 草稿键
 */
export function docDraftKey(scope: string, inReq?: boolean): string {
  try {
    if (inReq) return DOC_DRAFT_PREFIX + String(scope || '') + '__req__';
    return DOC_DRAFT_PREFIX + String(scope || '');
  } catch {
    return DOC_DRAFT_PREFIX + 'default';
  }
}

/**
 * 安全读文本（读不到回 null，不抛错；沿用旧代码 try/catch 静默口径）。
 * @param {string} key localStorage 键
 * @returns {string | null} 文本值或 null
 */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 安全写文本（写失败静默跳过，不抛错）。
 * @param {string} key localStorage 键
 * @param {string} value 文本值
 * @returns {void} 无返回
 */
export function writeText(key: string, value: string): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 配额/隐私模式写失败时静默跳过，与旧代码口径一致。
  }
}

/**
 * 安全删键（不存在或删失败都不抛错）。
 * @param {string} key localStorage 键
 * @returns {void} 无返回
 */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 忽略。
  }
}

/**
 * 安全读 JSON（解析失败回 fallback，不抛错）。
 * @param {string} key localStorage 键
 * @param {null} fallback 解析失败时的回退值
 * @returns {unknown} 解析结果或回退值
 */
export function readJson(key: string, fallback: null): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 安全写 JSON（序列化/写失败静默跳过，不抛错）。
 * @param {string} key localStorage 键
 * @param {unknown} value 可序列化值
 * @returns {void} 无返回
 */
export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额/隐私模式写失败时静默跳过，与旧代码口径一致。
  }
}

/**
 * 读本项目分组（只读作用域键，不读裸全局键、不做迁移；无数据回空分组）。
 * @param {string} project 当前项目名
 * @returns {{ list: Array<{ id: string; name: string; parent: string | null }>; map: Record<string, string> }} 分组数据
 */
export function loadGroupsData(project: string): {
  list: Array<{ id: string; name: string; parent: string | null }>;
  map: Record<string, string>;
} {
  const empty = { list: [], map: {} } as {
    list: Array<{ id: string; name: string; parent: string | null }>;
    map: Record<string, string>;
  };
  const parsed = readJson(groupsKey(project), null) as {
    list?: Array<{ id?: unknown; name?: unknown; parent?: unknown }>;
    map?: Record<string, unknown>;
  } | null;
  if (!parsed || !Array.isArray(parsed.list)) return empty;
  return {
    list: parsed.list.map((g) => ({
      id: String(g.id),
      name: String(g.name || '未命名'),
      parent: g.parent != null ? String(g.parent) : null,
    })),
    map:
      parsed.map && typeof parsed.map === 'object'
        ? (parsed.map as Record<string, string>)
        : {},
  };
}

/**
 * 写本项目分组（只写作用域键，永不写裸全局键）。
 * @param {string} project 当前项目名
 * @param {unknown} groupsData 分组数据（含 list/map）
 * @returns {void} 无返回
 */
export function saveGroupsData(project: string, groupsData: unknown): void {
  writeJson(groupsKey(project), groupsData);
}

/**
 * 读缩放（沿用旧 guards：非数字/越界回回退值，不抛错；有效值收敛到 0.2..3）。
 * @param {number} fallback 无有效值时的回退（默认 0.85，与旧代码一致）
 * @returns {number} 缩放值
 */
export function readContentZoom(fallback: number = CONTENT_ZOOM_FALLBACK): number {
  try {
    const raw = localStorage.getItem(CONTENT_ZOOM_KEY);
    const v = raw === null ? NaN : parseFloat(raw);
    if (isNaN(v) || v <= 0 || v > CONTENT_ZOOM_MAX) return fallback;
    return Math.min(CONTENT_ZOOM_MAX, Math.max(CONTENT_ZOOM_MIN, v));
  } catch {
    return fallback;
  }
}

/**
 * 写缩放（原样存字符串，不做 clamp，clamp 归调用方舞台逻辑）。
 * @param {number | string} value 缩放值
 * @returns {void} 无返回
 */
export function writeContentZoom(value: number | string): void {
  writeText(CONTENT_ZOOM_KEY, String(value));
}
