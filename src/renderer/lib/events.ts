/**
 * src/renderer/lib/events.ts — 事件桥（订阅/退订 helpers + 归属校验桩，无业务逻辑）。
 *
 * 事件名与旧通道名一致，不发明新通道：
 * - ai:event：主进程 → 渲染层 AI/ACP 事件（preload.js 经 ipcRenderer.on 多播，见 onAiEvent）。
 * - doc:mirror：独立文档窗口镜像（preload.js 经 ipcRenderer.on 多播，见 onDocMirror）。
 * 旧代码另有一条 BroadcastChannel 回退路径（js/core-docs.js docMirrorBC，频道名 doc-mirror）；
 * 本桥只走 protoAPI 主路径，回退路径保留在旧代码中不动。
 */

/** 主进程 AI/ACP 事件通道名（与 preload.js ipcRenderer.on 入参逐字一致）。 */
export const AI_EVENT_CHANNEL = 'ai:event' as const;

/** 独立文档窗口镜像通道名（与 preload.js ipcRenderer.on 入参逐字一致）。 */
export const DOC_MIRROR_CHANNEL = 'doc:mirror' as const;

/** ai:event 事件载荷（本桥不收紧：旧事件字段开放，归属只看 agentId/uiSessionId）。 */
export interface AiEvent {
  /** 事件类型（如 session/acp_config/tool_call/thinking 等，旧代码按 type 分发）。 */
  type?: string;
  /** 事件归属 Agent（旧代码事件自带）。 */
  agentId?: string;
  /** 事件归属 Agent 展示名。 */
  agentName?: string;
  /** 触发该事件的 UI 会话 id（旧代码用它匹配当前会话）。 */
  uiSessionId?: string;
  /** 其它旧字段透传。 */
  [key: string]: unknown;
}

/** 归属校验用的会话引用（只取 id/agentId，不碰会话其它状态）。 */
export interface SessionRef {
  /** 会话 id（旧代码比对 ev.uiSessionId 的目标）。 */
  id?: string;
  /** 会话归属 Agent。 */
  agentId?: string;
}

/** doc:mirror 镜像消息（kind + payload 信封，沿用旧 mirrorPush/mirrorBack 形态）。 */
export interface DocMirrorMessage {
  /** 镜像类型（如内容/模式切换，旧代码 mirrorPush(kind, payload) 首参）。 */
  kind?: string;
  /** 镜像载荷。 */
  payload?: unknown;
  /** 其它旧字段透传。 */
  [key: string]: unknown;
}

/** ai:event 回调。 */
export type AiEventHandler = (ev: AiEvent) => void;

/** doc:mirror 回调。 */
export type DocMirrorHandler = (msg: DocMirrorMessage) => void;

/** 退订函数。 */
export type Unsubscribe = () => void;

/**
 * 读取预加载网关（内部用，不导出网关本身，避免组件直连 ipcRenderer）。
 * @returns {Record<string, unknown> | null} window.protoAPI；不存在时返回 null
 */
function getBridgeApi(): Record<string, unknown> | null {
  try {
    const w = window as unknown as { protoAPI?: Record<string, unknown> };
    return w && typeof w.protoAPI === 'object' && w.protoAPI !== null ? w.protoAPI : null;
  } catch {
    return null;
  }
}

/**
 * 订阅 ai:event（委托 window.protoAPI.ai.onEvent）。
 * 旧网关 onAiEvent 无退订能力（只进数组，见 preload.js），本函数用存活 flag 实现退订语义，
 * 退订后不再向回调投递；网关缺失时返回空退订函数，不抛错。
 * @param {AiEventHandler} cb 事件回调
 * @returns {() => void} 退订函数
 */
export function onAiEvent(cb: AiEventHandler): Unsubscribe {
  let alive = true;
  const api = getBridgeApi();
  const space: unknown = api ? api.ai : undefined;
  const sub: unknown =
    space && typeof space === 'object'
      ? (space as Record<string, unknown>).onEvent
      : undefined;
  if (typeof sub !== 'function') {
    return () => {
      alive = false;
    };
  }
  try {
    (sub as (fn: (ev: AiEvent) => void) => void).call(space, (ev: AiEvent) => {
      if (alive) cb(ev);
    });
  } catch {
    return () => {
      alive = false;
    };
  }
  return () => {
    alive = false;
  };
}

/**
 * 订阅 doc:mirror（委托 window.protoAPI.doc.onMirror，缺失时回退 docwin.onMirror，两者同源见 preload.js）。
 * 旧网关返回解绑函数，本函数退订时一并调用；网关缺失时返回空退订函数，不抛错。
 * @param {DocMirrorHandler} cb 镜像消息回调
 * @returns {() => void} 退订函数
 */
export function onDocMirror(cb: DocMirrorHandler): Unsubscribe {
  const api = getBridgeApi();
  const pick = (name: string): { space: unknown; fn: unknown } => {
    const space: unknown = api ? api[name] : undefined;
    const fn: unknown =
      space && typeof space === 'object'
        ? (space as Record<string, unknown>).onMirror
        : undefined;
    return { space, fn };
  };
  let target = pick('doc');
  if (typeof target.fn !== 'function') target = pick('docwin');
  if (typeof target.fn !== 'function') return () => undefined;
  let off: unknown = null;
  try {
    off = (target.fn as (fn: (msg: DocMirrorMessage) => void) => unknown).call(
      target.space,
      (msg: DocMirrorMessage) => cb(msg)
    );
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      if (typeof off === 'function') (off as () => void)();
    } catch {
      // 旧网关解绑不抛契约，吞错保持退订语义。
    }
  };
}

/**
 * 事件归属校验桩：逐字沿用旧规则（js/project-ai-export.js aiEventMatchesSession）。
 * 仅在双方都有值且不一致时拒绝；旧事件缺字段不断连。会话 agentId 为空时的回填
 * （旧 aiBindSessionAgent 首写采用事件值）属于 store 写入行为，不在本桥做，只做只读校验。
 * @param {SessionRef} session 当前会话引用（含 id/agentId）
 * @param {AiEvent} event 待校验事件（含 agentId/uiSessionId）
 * @returns {boolean} 可投递返回 true；任一为空引用返回 false
 */
export function matchesSessionOwnership(session: SessionRef, event: AiEvent): boolean {
  if (!session || !event) return false;
  const evAid = String(event.agentId || '');
  const sessAid = String(session.agentId || '');
  if (evAid && sessAid && evAid !== sessAid) return false;
  const ui = String(event.uiSessionId || '');
  if (ui && session.id && ui !== String(session.id)) return false;
  return true;
}
