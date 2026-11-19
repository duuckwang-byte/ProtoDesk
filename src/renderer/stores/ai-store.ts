/**
 * src/renderer/stores/ai-store.ts — AI 会话 store（J 独占，W3-07 上下文/持久化）。
 *
 * 形态：zustand 真包（`import { create } from 'zustand'`）持有全量 AiState；
 * 对外保持原 API（getAiStore/useAiStore(selector)/bindAiEvents + reducer），J 波消费方零改。
 * F2(T4-D1,P2)：sendMessage extra 已按 js/project-ai-export.js:7075 逐字补齐 13 键。
 *
 * W3-07 接线：
 * - sendMessage 从 sources-store 取当前源（sandboxDir/targetFile/uiKind/activePage），
 *   从 settings-store 取 engine；不再写死 `''` / `'mobile'` / `'cli'`（C8）。
 *   opts.activePage 非空时覆盖自动解析的作用页；缺省仍走自动解析（向后兼容）。
 * - 会话/历史落 ai_sessions_v2_* + ai_hist_*（storage-keys.sessStoreKey/aiHistKey），
 *   模型/思考落 ai_model / ai_model_reasoning（C14）；启动按当前沙箱目录恢复。
 * - 流式事件仍只走 ai:event（经 lib/events.ts onAiEvent 订阅；归属经 adapters
 *   aiEventMatchesSession 校验，规则逐字沿用旧实现）。不新增 IPC 通道；
 *   发送/取消/权限回执复用既有 protoAPI（ai:ask / ai:cancel / ai:scope-confirm）。
 */

import { create } from 'zustand';
import { onAiEvent, matchesSessionOwnership } from '@/lib/events';
import type { AiEvent } from '@/lib/events';
import { getProtoApi } from '@/lib/ipc';
import {
  AI_MODEL_KEY,
  AI_REASONING_KEY,
  aiHistKey,
  readJson,
  readText,
  removeKey,
  sessStoreKey,
  writeJson,
  writeText,
} from '@/lib/storage-keys';
import { useAppStore } from '@/stores/app-store';
import { extractPages, useSourcesStore } from '@/stores/sources-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  aiEventMatchesSession,
  aiEventToMessages,
  appendMessagesWithStreamMerge,
  closeOpenStreamMessages,
  findThoughtConfig,
  normalizeAcpConfig,
  normalizeTrace,
  parseSessionsFile,
  resetThinkingOnModelChange,
  resolveSendContext,
  resolveThoughtValue,
  serializeSessions,
} from '@/features/ai/adapters';
import type {
  AcpConfigSnapshot,
  AiMessage,
  StreamContext,
  TraceLine,
} from '@/features/ai/adapters';

/** 单个 UI 会话（旧 s.id/s.oid/s.acpSessionId 语义的 React 投影）。 */
export interface AiSession {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  agentSessionId: string;
  acpSessionId: string;
  freshSession: boolean;
  createdAt: number;
  updatedAt: number;
}

/** ACP 动态思考选项（渲染层只消费，不写死档位）。 */
export interface ThinkingOption {
  value: string;
  label: string;
  title: string;
}

/**
 * 思考档位探测状态（UI 只据此展示，不伪造档位）：
 * - idle：尚未探测（保留旧的「默认」占位语义）；
 * - probing：探测中（含 busy 延后）；
 * - ready：拿到思考选项；
 * - unsupported：模型不支持思考 / 只有布尔开关 / 无 options；
 * - error：探测失败（仅在浮层内提示，不弹全局错误）。
 */
export type ThinkingProbeStatus = 'idle' | 'probing' | 'ready' | 'unsupported' | 'error';

/** 权限请求条目（卡片数据源，带 Agent+会话复合归属）。 */
export interface PermissionItem {
  id: string;
  agentId: string;
  agentName: string;
  uiSessionId: string;
  sessionId: string;
  title: string;
  kind: string;
  command: string;
  path: string;
  cwd: string;
  risk: string;
  status: 'pending' | 'allowed' | 'denied' | 'resolved';
}

/** AI store 状态。 */
export interface AiState {
  sessions: AiSession[];
  activeSessionId: string | null;
  messages: Record<string, AiMessage[]>;
  events: AiEvent[];
  modelId: string;
  thinkingLevel: string;
  thinkingOptions: ThinkingOption[];
  /** 当前 thinkingOptions 的探测状态（null 兼容旧快照，等价 idle）。 */
  thinkingStatus: ThinkingProbeStatus;
  /** 探测失败的简短原因（只在思考浮层内展示，不写全局 error）。 */
  thinkingError: string;
  /** thinkingOptions 归属的模型（旧响应/旧模型选项不串台）。 */
  thinkingModelId: string;
  /** 探测作用域：agentId|uiSessionId|modelId（切 Agent/会话/模型即失效）。 */
  thinkingScopeKey: string;
  thoughtConfigId: string;
  acpConfig: Record<string, string>;
  acpWarnings: string[];
  trace: TraceLine[];
  busy: boolean;
  error: string | null;
}

/** reducer 动作（纯状态流转，副作用由 actions 承担）。 */
export type AiAction =
  | { type: 'ensure-session'; session: AiSession }
  | { type: 'new-session'; session: AiSession }
  | { type: 'switch-session'; sessionId: string }
  | { type: 'append-event'; event: AiEvent }
  | { type: 'append-messages'; sessionId: string; messages: AiMessage[] }
  | { type: 'stream-start'; sessionId: string }
  | { type: 'stream-end'; sessionId: string }
  | { type: 'set-model'; modelId: string }
  | { type: 'set-thinking'; level: string }
  | { type: 'thinking-probe-start'; modelId: string; scopeKey: string; resetThinking?: boolean }
  | {
      type: 'thinking-probe-fail';
      status: Exclude<ThinkingProbeStatus, 'ready'>;
      modelId: string;
      scopeKey: string;
      error?: string;
    }
  | {
      type: 'set-acp';
      thoughtConfigId: string;
      thinkingLevel: string;
      options: ThinkingOption[];
      config: Record<string, string>;
      warnings: string[];
      /** 写入来源状态；缺省按 options 是否为空推断 ready/unsupported。 */
      status?: ThinkingProbeStatus;
      modelId?: string;
      scopeKey?: string;
      error?: string;
    }
  | { type: 'set-busy'; busy: boolean }
  | { type: 'set-error'; error: string | null }
  | { type: 'push-trace'; line: TraceLine }
  | { type: 'clear-trace' }
  | { type: 'resolve-permission'; id: string; status: PermissionItem['status'] };

const DEFAULT_THINKING = 'default';

/** 会话落盘防抖（流式事件按 tick 到达，合并写一次；用户消息/切会话会立即 flush）。 */
const PERSIST_DEBOUNCE_MS = 250;

/** 旧 ai_store 语义：这些值等同“未选模型”，读取时删键、写入时删键。 */
const MODEL_DELETED_VALUES = ['', '__none__', 'default'];

/** 当前源目录（sources-store 只读；无源回空串，键名由 aiHistKey/sessStoreKey 归一）。 */
function sourceSandboxDir(): string {
  try {
    return useSourcesStore.getState().currentSource?.sandboxDir || '';
  } catch {
    return '';
  }
}

/**
 * 读持久化模型（逐字沿用 js §5751-5760 aiStoredModel）：
 * 空/`__none__`/`default` 一律视为未选；后两者同时删键，避免脏值长期驻留。
 */
export function readStoredModel(): string {
  const raw = (readText(AI_MODEL_KEY) || '').trim();
  if (!raw) return '';
  if (raw === '__none__' || raw === 'default') {
    removeKey(AI_MODEL_KEY);
    return '';
  }
  return raw;
}

/** 写持久化模型（逐字沿用 js §5761-5769 aiStoreModel：空/__none__/default 删键）。 */
export function storeModel(modelId: string): void {
  const m = String(modelId || '').trim();
  if (MODEL_DELETED_VALUES.indexOf(m) >= 0) {
    removeKey(AI_MODEL_KEY);
    return;
  }
  writeText(AI_MODEL_KEY, m);
}

/** 读持久化思考强度（旧 aiStoredReasoning + aiCurReasoning：空串回 default）。 */
export function readStoredReasoning(): string {
  const raw = (readText(AI_REASONING_KEY) || '').trim();
  return raw || DEFAULT_THINKING;
}

/** 写持久化思考强度（旧 aiStoreReasoning：原样写，空串写空串）。 */
export function storeReasoning(level: string): void {
  writeText(AI_REASONING_KEY, String(level || ''));
}

function rid(prefix: string): string {
  try {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  } catch {
    return prefix + '_local';
  }
}

function now(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

/** 空状态工厂（测试/初始化共用）。 */
export function createInitialAiState(): AiState {
  return {
    sessions: [],
    activeSessionId: null,
    messages: {},
    events: [],
    modelId: '',
    thinkingLevel: DEFAULT_THINKING,
    thinkingOptions: [],
    thinkingStatus: 'idle',
    thinkingError: '',
    thinkingModelId: '',
    thinkingScopeKey: '',
    thoughtConfigId: '',
    acpConfig: {},
    acpWarnings: [],
    trace: [],
    busy: false,
    error: null,
  };
}

/** 纯 reducer（组件/测试可直接单测，无副作用）。 */
export function aiReducer(state: AiState, action: AiAction): AiState {
  switch (action.type) {
    case 'ensure-session': {
      if (state.sessions.some((s) => s.id === action.session.id)) return state;
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        activeSessionId: state.activeSessionId ?? action.session.id,
        messages: { ...state.messages, [action.session.id]: state.messages[action.session.id] ?? [] },
      };
    }
    case 'new-session':
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        activeSessionId: action.session.id,
        messages: { ...state.messages, [action.session.id]: [] },
      };
    case 'switch-session':
      if (!state.sessions.some((s) => s.id === action.sessionId)) return state;
      return { ...state, activeSessionId: action.sessionId };
    case 'append-event':
      return { ...state, events: [...state.events, action.event] };
    case 'append-messages': {
      const prev = state.messages[action.sessionId] ?? [];
      // 唯一合并入口：相邻同 streamId 的 delta 追加到同一条助手消息。
      const next = appendMessagesWithStreamMerge(prev, action.messages);
      return {
        ...state,
        messages: { ...state.messages, [action.sessionId]: next },
      };
    }
    case 'stream-start':
    case 'stream-end': {
      // run_started 开新段 / done·error 关段：都表现为“上一条不再接受追加”。
      const prev = state.messages[action.sessionId] ?? [];
      const next = closeOpenStreamMessages(prev);
      if (next === prev) return state;
      return { ...state, messages: { ...state.messages, [action.sessionId]: next } };
    }
    case 'set-model': {
      // 模型切换立即清空旧模型档位，避免新模型短暂显示上一个模型的 low/high/max。
      // acpConfig/thoughtConfigId 同源清理：旧 config id 的保存值不能在新模型上复活。
      const nextThinking = resetThinkingOnModelChange(state.modelId, action.modelId, state.thinkingLevel);
      return {
        ...state,
        modelId: action.modelId,
        thinkingLevel: nextThinking,
        thinkingOptions: [],
        thinkingStatus: action.modelId ? 'probing' : 'idle',
        thinkingError: '',
        thinkingModelId: action.modelId,
        thinkingScopeKey: '',
        thoughtConfigId: '',
        acpConfig: {},
        acpWarnings: [],
      };
    }
    case 'set-thinking':
      return { ...state, thinkingLevel: action.level || DEFAULT_THINKING };
    case 'thinking-probe-start':
      return {
        ...state,
        thinkingStatus: 'probing',
        thinkingError: '',
        thinkingModelId: action.modelId,
        thinkingScopeKey: action.scopeKey,
        thinkingOptions: [],
        thoughtConfigId: '',
        ...(action.resetThinking
          ? { thinkingLevel: DEFAULT_THINKING, acpConfig: {} as Record<string, string> }
          : {}),
      };
    case 'thinking-probe-fail':
      return {
        ...state,
        thinkingStatus: action.status,
        thinkingError: action.error || '',
        thinkingModelId: action.modelId,
        thinkingScopeKey: action.scopeKey,
        thinkingOptions: [],
        thinkingLevel: DEFAULT_THINKING,
        thoughtConfigId: '',
        acpConfig: {},
        acpWarnings: [],
      };
    case 'set-acp':
      return {
        ...state,
        thoughtConfigId: action.thoughtConfigId,
        thinkingLevel: action.thinkingLevel,
        thinkingOptions: action.options,
        thinkingStatus:
          action.status || (action.options.length && action.thoughtConfigId ? 'ready' : 'unsupported'),
        thinkingError: action.error || '',
        thinkingModelId: action.modelId !== undefined ? action.modelId : state.thinkingModelId,
        thinkingScopeKey: action.scopeKey !== undefined ? action.scopeKey : state.thinkingScopeKey,
        acpConfig: action.config,
        acpWarnings: action.warnings,
      };
    case 'set-busy':
      return { ...state, busy: action.busy };
    case 'set-error':
      return { ...state, error: action.error };
    case 'push-trace':
      return { ...state, trace: [...state.trace, action.line].slice(-500) };
    case 'clear-trace':
      return { ...state, trace: [] };
    case 'resolve-permission': {
      const apply = (list: AiMessage[]): AiMessage[] =>
        list.map((m) => {
          if (m.kind !== 'permission' || !m.payload) return m;
          if (String((m.payload as Record<string, unknown>).id) !== action.id) return m;
          return { ...m, payload: { ...(m.payload as Record<string, unknown>), status: action.status } };
        });
      const messages: Record<string, AiMessage[]> = {};
      for (const k of Object.keys(state.messages)) messages[k] = apply(state.messages[k]);
      return { ...state, messages };
    }
    default:
      return state;
  }
}

/** 单次思考探测的缓存项（按 agentId|uiSessionId|modelId 去重）。 */
interface ThinkingProbeEntry {
  key: string;
  requestId: number;
  status: 'probing' | 'ready' | 'unsupported' | 'error';
  agentId: string;
  uiSessionId: string;
  model: string;
  configOptions: Array<Record<string, unknown>>;
  modelConfigId: string;
  code: string;
  error: string;
  /** busy 等瞬时失败允许下次触发时重试；确定性失败直接复用缓存。 */
  transient: boolean;
  ts: number;
  promise: Promise<void> | null;
}

function createAiStore() {
  // 内部状态容器：zustand 真包。模型/思考启动即恢复（键语义见 readStoredModel/readStoredReasoning）。
  const useZ = create<AiState>()(() => ({
    ...createInitialAiState(),
    modelId: readStoredModel(),
    thinkingLevel: readStoredReasoning(),
  }));

  /** 当前内存状态归属的沙箱目录（切换源时先落盘旧目录再读新目录）。 */
  let loadedDir = sourceSandboxDir();
  /** 每会话当前 runId：CLI/API 事件未带 runId 时由 store 生成并保持稳定。 */
  const activeRuns = new Map<string, string>();
  /** 历史恢复中：抑制回写，避免“读空 → 覆盖旧数据”。 */
  let loadingHistory = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** 思考探测缓存 + 请求序号（旧请求不覆盖新模型）。 */
  const probeCache = new Map<string, ThinkingProbeEntry>();
  let probeSeq = 0;
  /** busy 时跳过的探测，done/error/cancel 后补一次。 */
  let pendingProbe: { modelId: string } | null = null;

  function getState(): AiState {
    return useZ.getState();
  }

  /** 事件自带 runId 优先；缺省沿用本会话当前 run；首次见到则生成并记住（CLI/API 无 id 也能稳定合并）。 */
  function runIdFor(sessionId: string, ev: AiEvent): string {
    const explicit = String((ev as Record<string, unknown>).runId || '').trim();
    if (explicit) {
      activeRuns.set(sessionId, explicit);
      return explicit;
    }
    const cur = activeRuns.get(sessionId);
    if (cur) return cur;
    const next = rid('r');
    activeRuns.set(sessionId, next);
    return next;
  }

  /** run_started：为会话开一段新 run（即使上游没给 runId，也会生成新值，避免串上一轮）。 */
  function beginRun(sessionId: string, ev: AiEvent): void {
    const explicit = String((ev as Record<string, unknown>).runId || '').trim();
    activeRuns.set(sessionId, explicit || rid('r'));
  }

  /** done/error：关闭当前 run，晚到 chunk 会另起一段而不是污染下一轮。 */
  function endRun(sessionId: string): void {
    activeRuns.delete(sessionId);
  }

  /** 只有文本/思考流需要 run 上下文；非流式事件不消耗 run id。 */
  function streamContextOf(type: string, sessionId: string, ev: AiEvent): StreamContext | undefined {
    if (type !== 'chunk' && type !== 'text_delta' && type !== 'answer' && type !== 'thinking') {
      return undefined;
    }
    return { runId: runIdFor(sessionId, ev) };
  }

  function persistNow(): void {
    const st = getState();
    // 无会话不写：历史恢复失败/空项目时绝不清空磁盘上的旧会话。
    if (!st.sessions.length) return;
    try {
      const file = serializeSessions(st);
      writeJson(sessStoreKey(loadedDir), file);
      const active = file.activeId ? file.sessions[file.activeId] : null;
      if (active) writeJson(aiHistKey(loadedDir), active);
    } catch {
      // 配额/序列化失败静默（storage-keys 同口径），下次变更再试。
    }
  }

  function schedulePersist(): void {
    if (loadingHistory || persistTimer !== null) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** 立即落盘（发送用户消息 / 切源 / 切会话 / 卸载前调用）。 */
  function flushPersist(): void {
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistNow();
  }

  /**
   * 恢复指定沙箱目录的会话/历史（旧 ai_sessions_v2_* 优先，ai_hist_* 单会话降级）。
   * 传空参数使用当前源目录；无数据时只清内存，不动存储。
   */
  function loadHistory(dir?: string): void {
    const target = dir === undefined ? sourceSandboxDir() : String(dir);
    // 切目录前先把当前状态落回旧目录，并清掉在途定时器，避免旧目录内容写进新目录。
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (target !== loadedDir) {
      persistNow();
      // 切源可能换会话/cwd：旧目录的探测缓存不能复用。
      probeCache.clear();
      pendingProbe = null;
    }
    activeRuns.clear();
    const st = getState();
    loadingHistory = true;
    try {
      let parsed = parseSessionsFile(readJson(sessStoreKey(target), null));
      if (!parsed || parsed.sessions.length === 0) {
        const single = parseSessionsFile(readJson(aiHistKey(target), null));
        if (single && single.sessions.length > 0) parsed = single;
      }
      if (!parsed) {
        setState({ ...st, sessions: [], activeSessionId: null, messages: {}, events: [], trace: [] });
      } else {
        setState({
          ...st,
          sessions: parsed.sessions,
          activeSessionId: parsed.activeSessionId,
          messages: parsed.messages,
          events: [],
          trace: [],
        });
      }
      loadedDir = target;
    } finally {
      loadingHistory = false;
    }
  }

  function setState(next: AiState): void {
    useZ.setState(next, true);
    schedulePersist();
  }

  function dispatch(action: AiAction): void {
    useZ.setState(aiReducer(useZ.getState(), action), true);
    // 思考强度与 ACP 配置同源：ACP 公告/用户选择后同步落 ai_model_reasoning。
    if (action.type === 'set-acp') storeReasoning(getState().thinkingLevel);
    schedulePersist();
  }

  function subscribe(listener: () => void): () => void {
    return useZ.subscribe(listener);
  }

  function getActiveSession(): AiSession | null {
    const st = getState();
    if (!st.activeSessionId) return null;
    return st.sessions.find((s) => s.id === st.activeSessionId) ?? null;
  }

  function ensureActiveSession(): AiSession {
    const cur = getActiveSession();
    if (cur) return cur;
    const s: AiSession = {
      id: rid('s'),
      title: '新的对话',
      agentId: '',
      agentName: '',
      agentSessionId: '',
      acpSessionId: '',
      freshSession: true,
      createdAt: now(),
      updatedAt: now(),
    };
    dispatch({ type: 'ensure-session', session: s });
    // 旧 ensureSessions 首次即落盘；新会话也立即写，避免“打开后未发送就刷新”丢会话。
    flushPersist();
    return s;
  }

  /** 探测作用域键：agentId|uiSessionId|modelId（缓存与归属校验共用）。 */
  function probeKey(agentId: string, uiSessionId: string, modelId: string): string {
    return str(agentId) + '|' + str(uiSessionId) + '|' + str(modelId).trim();
  }

  /** 当前探测 Agent：settings-store 为主力真相；未加载时退回会话 Agent（空则不传 hint）。 */
  function currentProbeAgentId(): string {
    try {
      const settings = useSettingsStore.getState();
      const cfg = settings.config;
      if (cfg) return str(cfg.agentId || cfg.mainAgent).trim() || 'opencode';
      const list = Array.isArray(settings.agents) ? settings.agents : [];
      const enabled = list.find((a) => a && a.enabled);
      if (enabled && enabled.id) return str(enabled.id);
    } catch {
      // store 不可用（纯函数测试）时继续用会话 Agent。
    }
    const active = getActiveSession();
    return active ? str(active.agentId) : '';
  }

  /** 当前探测上下文（模型 + Agent + UI 会话 + cwd）。 */
  function probeTarget(modelId: string): {
    target: string;
    agentId: string;
    uiSessionId: string;
    key: string;
  } {
    const target = str(modelId).trim();
    const agentId = currentProbeAgentId();
    const active = getActiveSession();
    const uiSessionId = active ? active.id : '';
    return { target, agentId, uiSessionId, key: probeKey(agentId, uiSessionId, target) };
  }

  /** 切换作用域时清空旧档位；只有“曾属于别的 Agent/会话/模型”才重置已选思考值。 */
  function beginProbeScope(target: string, key: string): void {
    const st = getState();
    const prevScope = str(st.thinkingScopeKey);
    const prevModel = str(st.thinkingModelId);
    if (prevScope === key && prevModel === target && st.thinkingStatus !== 'idle') return;
    const resetThinking =
      (!!prevScope && prevScope !== key) || (!!prevModel && prevModel !== target);
    dispatch({ type: 'thinking-probe-start', modelId: target, scopeKey: key, resetThinking });
  }

  /** 结果只允许落到“当前 Agent + 当前会话 + 当前模型”，慢到的旧响应不覆盖新模型。 */
  function probeEntryIsCurrent(entry: ThinkingProbeEntry): boolean {
    const st = getState();
    if (str(st.modelId).trim() !== entry.model) return false;
    if (currentProbeAgentId() !== entry.agentId) return false;
    const active = getActiveSession();
    return (active ? active.id : '') === entry.uiSessionId;
  }

  /** 把探测缓存写入 UI（ready 走 applyAcpSnapshot，与 acp_config 事件同一归一化逻辑）。 */
  function applyProbeEntry(entry: ThinkingProbeEntry): void {
    if (!probeEntryIsCurrent(entry)) return;
    if (entry.status === 'ready') {
      applyAcpSnapshot(
        {
          agentId: entry.agentId,
          uiSessionId: entry.uiSessionId,
          acpSessionId: '',
          model: entry.model,
          thoughtConfigId: '',
          thoughtValue: '',
          configOptions: entry.configOptions,
          warnings: [],
        },
        { scopeKey: entry.key, modelId: entry.model },
      );
      return;
    }
    if (entry.status === 'unsupported') {
      dispatch({
        type: 'thinking-probe-fail',
        status: 'unsupported',
        modelId: entry.model,
        scopeKey: entry.key,
      });
      return;
    }
    if (entry.status === 'error') {
      dispatch({
        type: 'thinking-probe-fail',
        status: 'error',
        modelId: entry.model,
        scopeKey: entry.key,
        error: entry.error,
      });
    }
  }

  /** busy 延后的探测：done/error/cancel 后补一次（不阻塞发送）。 */
  function flushPendingProbe(): void {
    if (!pendingProbe) return;
    if (getState().busy) return;
    const next = pendingProbe;
    pendingProbe = null;
    void probeThinking(next.modelId);
  }

  /**
   * 选模型/开对话/切 Agent·会话时预探测思考档位（复用主进程 ai:models 的 probeModel 分支）。
   *
   * - 不伪造 ai:event：结果直接走 applyAcpSnapshot，不进入 Trace/聊天流；
   * - 缓存键 agentId|uiSessionId|modelId：loading/ready/确定性失败复用，busy 瞬时失败可重试；
   * - requestId + model + 作用域三重校验：旧请求/旧模型响应一律丢弃。
   */
  async function probeThinking(modelId: string, opts?: { force?: boolean }): Promise<void> {
    const { target, agentId, uiSessionId, key } = probeTarget(modelId);
    if (!target) return;

    const cached = probeCache.get(key);
    if (cached && !(opts && opts.force)) {
      if (cached.status === 'probing' && cached.promise) {
        beginProbeScope(target, key);
        return cached.promise;
      }
      if (cached.status !== 'error' || !cached.transient) {
        beginProbeScope(target, key);
        applyProbeEntry(cached);
        return;
      }
    }

    beginProbeScope(target, key);

    // 发送中不抢 ACP（previewModelConfig 会返回 busy）：记下目标，done 后补探。
    if (getState().busy) {
      pendingProbe = { modelId: target };
      return;
    }

    const api = getProtoApi();
    const ai = api ? (api.ai as Record<string, unknown>) : undefined;
    const listModels =
      ai && typeof ai.listModels === 'function'
        ? (ai.listModels as (hint: unknown) => Promise<unknown>)
        : null;
    if (!listModels) {
      // 纯浏览器预览等无网关场景：保持「默认」占位，不伪造失败。
      const st = getState();
      if (str(st.modelId).trim() === target && st.thinkingScopeKey === key) {
        dispatch({ type: 'thinking-probe-fail', status: 'idle', modelId: target, scopeKey: key });
      }
      return;
    }

    const requestId = ++probeSeq;
    const hint: Record<string, unknown> = {
      engine: 'cli',
      probeModel: target,
      agentId,
      uiSessionId,
      cwd: sourceSandboxDir(),
    };
    // hint 为空时交给主进程回落 cfg.agentId/mainAgent（不发明 Agent）。
    if (!agentId) delete hint.agentId;
    if (!uiSessionId) delete hint.uiSessionId;

    const entry: ThinkingProbeEntry = {
      key,
      requestId,
      status: 'probing',
      agentId,
      uiSessionId,
      model: target,
      configOptions: [],
      modelConfigId: '',
      code: '',
      error: '',
      transient: false,
      ts: now(),
      promise: null,
    };
    // 先落缓存再发请求：listModels 同步抛错时也能按 requestId 正常收尾。
    probeCache.set(key, entry);
    entry.promise = (async (): Promise<void> => {
      let raw: Record<string, unknown> = {};
      try {
        const result = await listModels.call(ai, hint);
        raw = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      } catch (e) {
        raw = {
          ok: false,
          error: 'ACP_PROBE_FAILED',
          detail: e instanceof Error ? e.message : String(e),
        };
      }
      const latest = probeCache.get(key);
      // requestId 不匹配 = 已有更新的探测（force/重试），旧响应直接丢弃。
      if (!latest || latest.requestId !== requestId) return;

      if (raw.ok === true) {
        const got = str(raw.model).trim();
        if (got && got !== target) {
          entry.status = 'error';
          entry.code = 'ACP_MODEL_MISMATCH';
          entry.error = ('ACP 返回模型不一致：' + got).slice(0, 200);
        } else {
          entry.status = 'ready';
          entry.code = '';
          entry.error = '';
          entry.configOptions = Array.isArray(raw.configOptions)
            ? (raw.configOptions as Array<Record<string, unknown>>)
            : [];
          entry.modelConfigId = str(raw.modelConfigId);
        }
      } else {
        const code = str(raw.error);
        if (code === 'busy') {
          entry.status = 'error';
          entry.code = code;
          entry.error = '';
          entry.transient = true;
          pendingProbe = { modelId: target };
        } else if (code === 'ACP_MODEL_UNSUPPORTED') {
          entry.status = 'unsupported';
          entry.code = code;
          entry.error = '';
        } else {
          entry.status = 'error';
          entry.code = code || 'ACP_PROBE_FAILED';
          entry.error = str(raw.detail || raw.error || 'ACP 配置读取失败').slice(0, 200);
        }
      }
      entry.ts = now();
      entry.promise = null;
      probeCache.set(key, entry);
      if (pendingProbe && pendingProbe.modelId === target && !entry.transient) pendingProbe = null;
      applyProbeEntry(entry);
    })();
    return entry.promise;
  }

  /**
   * ACP 快照归一（probe 结果与 acp_config 事件共用）：
   * 找思考项 → 过滤布尔开关 → thoughtOptionsFromAcp 文案 → resolveThoughtValue → dispatch。
   * 返回 false 表示快照不属于当前模型/会话（旧响应丢弃）。
   */
  function applyAcpSnapshot(
    snap: AcpConfigSnapshot,
    opts?: { modelId?: string; scopeKey?: string },
  ): boolean {
    const st = getState();
    const active = getActiveSession();
    const snapSession = str(snap.uiSessionId).trim();
    if (active && snapSession && snapSession !== active.id) return false;
    const model = str((opts && opts.modelId) || snap.model).trim();
    if (model && st.modelId && model !== st.modelId) return false;

    const thought = findThoughtConfig(snap.configOptions);
    const usable = !!thought && !thought.boolean;
    const options = usable && thought ? thought.options : [];
    const configId = usable && thought ? thought.id : '';
    const currentValue = thought ? thought.currentValue : '';
    // 无思考项/仅布尔开关：清掉旧模型保存值，避免换模型后旧档位复活。
    const saved: Record<string, string> = usable ? { ...(st.acpConfig || {}) } : {};
    let thinking = DEFAULT_THINKING;
    let status: ThinkingProbeStatus = 'unsupported';
    if (options.length && configId) {
      // 启动恢复：持久化思考档位在 ACP 首次公告时作为已选值参与解析（值是合法档位才采用）。
      // 换模型时 thinkingLevel 会被重置为占位值 default；它不能反过来压过 ACP 的 currentValue，
      // 否则每个带 default 选项的模型都会显示“默认”而不是 Agent 公告的当前档位。
      if (
        !saved[configId] &&
        st.thinkingLevel &&
        st.thinkingLevel !== DEFAULT_THINKING &&
        options.some((o) => o.value === st.thinkingLevel)
      ) {
        saved[configId] = st.thinkingLevel;
      }
      const r = resolveThoughtValue(
        options.map((o) => ({ value: o.value })),
        saved,
        configId,
        currentValue,
      );
      thinking = r.value || DEFAULT_THINKING;
      saved[configId] = thinking;
      status = 'ready';
    }
    const scopeKey =
      str(opts && opts.scopeKey).trim() ||
      probeKey(
        str(snap.agentId) || currentProbeAgentId(),
        snapSession || (active ? active.id : ''),
        model || st.modelId,
      );
    dispatch({
      type: 'set-acp',
      thoughtConfigId: configId,
      thinkingLevel: thinking,
      options: options.map((o) => ({ value: o.value, label: o.label, title: o.title })),
      config: saved,
      warnings: Array.isArray(snap.warnings) ? snap.warnings : [],
      status,
      modelId: model || st.modelId,
      scopeKey,
    });
    return true;
  }

  function applyAcpConfigEvent(ev: AiEvent): void {
    const snap = normalizeAcpConfig(ev);
    if (!snap) return;
    const active = getActiveSession();
    // 归属：acp_config 同样走会话归属校验（双方有值且不一致则只记 warning，不写状态）。
    if (active && !aiEventMatchesSession(active, ev)) return;
    // 慢到的旧事件（model 与当前选择不一致）不覆盖当前模型的思考档位。
    applyAcpSnapshot(snap, { modelId: snap.model });
  }

  function handleEvent(ev: AiEvent): void {
    if (!ev || typeof ev !== 'object') return;
    const st = getState();
    const active = getActiveSession();
    // 旧事件缺归属字段时不断连：无 active 会话则只记事件流，不投递消息。
    if (active && !matchesSessionOwnership(active, ev)) return;
    if (active && !aiEventMatchesSession(active, ev)) return;
    dispatch({ type: 'append-event', event: ev });
    const t = normalizeTrace({ type: 'trace', trace: (ev as Record<string, unknown>).trace } as AiEvent);
    if (t && (ev as Record<string, unknown>).trace) dispatch({ type: 'push-trace', line: t });
    const type = String((ev as Record<string, unknown>).type || '');
    if (type === 'acp_config') {
      applyAcpConfigEvent(ev);
      return;
    }
    if (type === 'run_started') {
      if (active) beginRun(active.id, ev);
      dispatch({ type: 'set-busy', busy: true });
      // 段边界：上一轮即使没有 done，也不接受新 run 的 chunk 追加。
      if (active) dispatch({ type: 'stream-start', sessionId: active.id });
    }
    if (type === 'done' || type === 'error' || type === 'cancel') {
      dispatch({ type: 'set-busy', busy: false });
      if (active) {
        dispatch({ type: 'stream-end', sessionId: active.id });
        endRun(active.id);
      }
      // busy 期间跳过的思考探测在收尾后补一次（不发 prompt）。
      flushPendingProbe();
    }
    if (type === 'error') {
      const msg = String(
        (ev as Record<string, unknown>).message ||
          (ev as Record<string, unknown>).error ||
          '未知错误',
      );
      dispatch({ type: 'set-error', error: msg });
    }
    if (!active) return;
    if (type === 'session') {
      // 旧 aiApplySessionEvent 语义：transport==='acp' 写 acpSessionId，oid 保留 legacy。
      const transport = String((ev as Record<string, unknown>).transport || '');
      const acpSid = String(
        (ev as Record<string, unknown>).acpSessionId ||
          (ev as Record<string, unknown>).id ||
          '',
      );
      const legacyId = String((ev as Record<string, unknown>).id || '');
      const sessions = getState().sessions.map((s) =>
        s.id === active.id
          ? {
              ...s,
              agentId: s.agentId || String((ev as Record<string, unknown>).agentId || ''),
              agentName:
                s.agentName || String((ev as Record<string, unknown>).agentName || ''),
              acpSessionId: transport === 'acp' || acpSid ? acpSid : s.acpSessionId,
              agentSessionId: legacyId || s.agentSessionId,
              freshSession: false,
              updatedAt: now(),
            }
          : s,
      );
      setState({ ...getState(), sessions });
      return;
    }
    const msgs = aiEventToMessages(ev, active.id, streamContextOf(type, active.id, ev));
    if (msgs.length) dispatch({ type: 'append-messages', sessionId: active.id, messages: msgs });
  }

  function newSession(title?: string): AiSession {
    const s: AiSession = {
      id: rid('s'),
      title: title || '新的对话',
      agentId: '',
      agentName: '',
      agentSessionId: '',
      acpSessionId: '',
      freshSession: true,
      createdAt: now(),
      updatedAt: now(),
    };
    dispatch({ type: 'new-session', session: s });
    flushPersist();
    return s;
  }

  function switchSession(sessionId: string): void {
    const prev = getState().activeSessionId;
    dispatch({ type: 'switch-session', sessionId });
    // 激活指针（activeId）立即落盘，刷新后回到同一会话。
    flushPersist();
    // 会话切换后思考作用域随之变化：清旧档位并按新会话 key 重新探测。
    if (prev !== sessionId) {
      const st = getState();
      if (st.modelId) void probeThinking(st.modelId);
    }
  }

  function setModel(modelId: string): void {
    dispatch({ type: 'set-model', modelId: str(modelId) });
    const st = getState();
    // 模型切换 reducer 会把 thinking 回落 default，二者一起落盘保持一致。
    storeModel(st.modelId);
    storeReasoning(st.thinkingLevel);
    // setModel 是选模型的唯一入口：立即后台探测，不等 AiDialog effect/下一次发送。
    if (st.modelId) void probeThinking(st.modelId);
  }

  function setThinking(level: string): void {
    const next = str(level) || DEFAULT_THINKING;
    dispatch({ type: 'set-thinking', level: next });
    const st = getState();
    // acpConfig/reasoning 同源：用户选择同时写进 ACP 配置映射，extra 两处不会打架。
    if (st.thoughtConfigId && st.acpConfig[st.thoughtConfigId] !== next) {
      setState({
        ...st,
        acpConfig: { ...(st.acpConfig || {}), [st.thoughtConfigId]: next },
      });
    }
    storeReasoning(next);
  }

  /** settings-store 尚未 load 时按只读方式补拉一次（不写配置）。 */
  async function ensureSettingsLoaded(): Promise<void> {
    const st = useSettingsStore.getState();
    if (st.config) return;
    if (st.loading) {
      // 已在加载：等它落定再取 engine，避免发送瞬间用到默认 'cli'。
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let unsub: (() => void) | null = null;
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          if (timer !== null) clearTimeout(timer);
          if (unsub) unsub();
          resolve();
        };
        unsub = useSettingsStore.subscribe(() => {
          if (!useSettingsStore.getState().loading) finish();
        });
        if (!useSettingsStore.getState().loading) finish();
        timer = setTimeout(finish, 3000);
      });
      return;
    }
    try {
      await st.load();
    } catch {
      // 设置读取失败不阻断发送：engine 保持 store 当前派生值（默认 cli）。
    }
  }

  function str(v: unknown): string {
    return v == null ? '' : String(v);
  }

  async function sendMessage(
    text: string,
    opts?: { activePage?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const content = str(text).trim();
    if (!content) return { ok: false, error: 'empty-prompt' };
    const st = getState();
    if (st.busy) return { ok: false, error: 'busy' };
    // W3-07：engine 来自 settings-store（其内部已由 config.engine/mode 派生），不写死 'cli'。
    await ensureSettingsLoaded();
    if (getState().busy) return { ok: false, error: 'busy' };
    const s = ensureActiveSession();
    // 首轮用用户输入前 24 字做会话标题（旧 aiTraceBegin 截断口径），便于持久化后回看。
    if (!s.title || s.title === '新的对话' || s.title === '新会话') {
      const title = content.replace(/\s+/g, ' ').slice(0, 24) + (content.length > 24 ? '…' : '');
      const sessions = getState().sessions.map((x) =>
        x.id === s.id ? { ...x, title, updatedAt: now() } : x,
      );
      setState({ ...getState(), sessions });
    }
    const active = getActiveSession() || s;
    // 新一次发送即新一段：先关闭可能残留的流式段，避免上一轮文本被续写。
    dispatch({ type: 'stream-end', sessionId: active.id });
    endRun(active.id);
    const userMsg: AiMessage = {
      key: rid('u'),
      sessionId: active.id,
      role: 'user',
      kind: 'text',
      text: content,
      ts: now(),
      sourceType: 'local',
    };
    dispatch({ type: 'append-messages', sessionId: active.id, messages: [userMsg] });
    dispatch({ type: 'set-busy', busy: true });
    dispatch({ type: 'set-error', error: null });
    // 用户消息立即落盘（不等流式防抖），刷新后可回看。
    flushPersist();
    const api = getProtoApi();
    const ai = api ? (api.ai as Record<string, unknown>) : undefined;
    const ask = ai && typeof ai.ask === 'function' ? (ai.ask as (...a: unknown[]) => Promise<unknown>) : null;
    if (!ask) {
      dispatch({ type: 'set-busy', busy: false });
      dispatch({ type: 'set-error', error: 'missing protoAPI.ai.ask' });
      return { ok: false, error: 'missing protoAPI.ai.ask' };
    }
    try {
      // 旧口径逐字对齐 js/project-ai-export.js:7075 extra（13 键一个不少）：
      // {history,lastHash,uiSessionId,agentSessionId,acpSessionId,freshSession,
      //  engine,activePage,targetFile,uiKind,enableTools,acpConfig,reasoning}。
      // W3-07 取值来源（不发明值）：
      // - sandboxDir/targetFile/uiKind/activePage ← sources-store 当前源（C8）；
      //   其中 activePage 可被 opts.activePage 显式覆盖，其余三键不接受外部覆盖；
      // - engine ← settings-store.engine（由 ai.get-config 的 engine/mode 派生）；
      // - acpConfig/reasoning ← 同一份 thinkingLevel/thoughtConfigId（ACP 公告 + ai_model_reasoning 恢复）；
      // - history/lastHash 保持旧缺省口径；enableTools 旧 `_enk=true` 常量。
      const sourceState = useSourcesStore.getState();
      const src = sourceState.currentSource;
      const mainHtmlFile = src ? src.mainHtmlFile || src.name : '';
      const activeSubFile = str(sourceState.activeSubFile) || str(src && src.activeSubFile);
      const subPageActive = !!src && !!activeSubFile && activeSubFile !== mainHtmlFile;
      const pages = subPageActive && sourceState.activeContent
        ? extractPages(sourceState.activeContent)
        : src?.pages ?? [];
      const appState = useAppStore.getState();
      const ctx = resolveSendContext({
        sandboxDir: src?.sandboxDir || '',
        mainHtmlFile,
        activeSubFile,
        kind: src?.kind || '',
        pages,
        hash: typeof window === 'undefined' ? '' : window.location.hash,
        fallbackKind: appState.kind,
        fallbackPage: appState.page,
      });
      // 作用页覆盖：调用方（AiDialog 选择器）显式选中时优先；空/未传保持自动解析结果。
      const pickedPage = str(opts && opts.activePage).trim();
      const activePage = pickedPage || ctx.activePage;
      const cur = getState();
      const reasoning = cur.thinkingLevel || DEFAULT_THINKING;
      const acpConfig: Record<string, string> = { ...(cur.acpConfig || {}) };
      if (cur.thoughtConfigId) acpConfig[cur.thoughtConfigId] = reasoning;
      const settings = useSettingsStore.getState();
      const extra = {
        history: (cur.messages[active.id] ?? []).slice(-20),
        lastHash: {},
        uiSessionId: active.id || '',
        agentSessionId: active.agentSessionId || '',
        acpSessionId: active.acpSessionId || '',
        freshSession: active.freshSession,
        engine: settings.engine,
        activePage,
        targetFile: ctx.targetFile,
        uiKind: ctx.uiKind,
        enableTools: true,
        acpConfig,
        reasoning,
      };
      const r = (await ask.call(
        ai,
        content,
        active.agentSessionId || '',
        ctx.sandboxDir,
        getState().modelId,
        extra,
      )) as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok === false) {
        dispatch({ type: 'set-busy', busy: false });
        dispatch({ type: 'set-error', error: String(r.error || '发送失败') });
        return { ok: false, error: String(r.error || '发送失败') };
      }
      const sessions = getState().sessions.map((x) =>
        x.id === active.id ? { ...x, freshSession: false, updatedAt: now() } : x,
      );
      setState({ ...getState(), sessions });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'set-busy', busy: false });
      dispatch({ type: 'set-error', error: msg });
      return { ok: false, error: msg };
    }
  }

  async function cancel(): Promise<void> {
    const api = getProtoApi();
    const ai = api ? (api.ai as Record<string, unknown>) : undefined;
    const fn = ai && typeof ai.cancel === 'function' ? (ai.cancel as () => Promise<unknown>) : null;
    if (fn) {
      try {
        await fn.call(ai);
      } catch {
        // 取消失败只复位本地忙态，不抛错（旧 aiSetBusy(false) 兜底口径）。
      }
    }
    dispatch({ type: 'set-busy', busy: false });
  }

  function retry(): Promise<{ ok: boolean; error?: string }> {
    const st = getState();
    const active = getActiveSession();
    if (!active) return Promise.resolve({ ok: false, error: 'no-session' });
    const list = st.messages[active.id] ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') return sendMessage(list[i].text);
    }
    return Promise.resolve({ ok: false, error: 'no-user-message' });
  }

  function resolvePermission(
    id: string,
    decision: 'allow-once' | 'allow-always' | 'deny',
    optionId?: string,
  ): void {
    const payload: Record<string, unknown> = { kind: 'acp-permission', id, decision };
    if (optionId) payload.optionId = optionId;
    try {
      const api = getProtoApi();
      const ai = api ? (api.ai as Record<string, unknown>) : undefined;
      const fn =
        ai && typeof ai.confirmScope === 'function'
          ? (ai.confirmScope as (p: unknown) => void)
          : null;
      if (fn) fn.call(ai, payload);
    } catch {
      // confirmScope 是 send 语义，无返回值；失败只记本地状态。
    }
    dispatch({
      type: 'resolve-permission',
      id: String(id),
      status: decision === 'deny' ? 'denied' : 'allowed',
    });
  }

  return {
    getState,
    subscribe,
    dispatch,
    use: useZ,
    getActiveSession,
    ensureActiveSession,
    handleEvent,
    newSession,
    switchSession,
    setModel,
    probeThinking,
    setThinking,
    sendMessage,
    cancel,
    retry,
    resolvePermission,
    /** 恢复指定沙箱目录的会话/历史（启动与切源用）。 */
    loadHistory,
    /** 立即写盘（发送/切源/卸载前）。 */
    flushPersist,
    /** 当前内存状态归属目录（测试/诊断用）。 */
    getLoadedDir: () => loadedDir,
    /** 释放防抖定时器 / 探测缓存（测试收尾）。 */
    dispose: () => {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      pendingProbe = null;
      probeCache.clear();
    },
  };
}

export type AiStore = ReturnType<typeof createAiStore>;

/** 工厂导出：单测可创建隔离实例；应用只用下方单例。 */
export { createAiStore };

let singleton: AiStore | null = null;
let sourcesHistoryBound = false;

/**
 * 当前源目录变化 → 先落盘旧目录，再恢复新目录会话。
 * 只在应用单例上绑定一次；工厂实例（测试）由调用方显式 loadHistory。
 */
function bindSourcesHistory(store: AiStore): void {
  if (sourcesHistoryBound) return;
  sourcesHistoryBound = true;
  let lastDir = sourceSandboxDir();
  try {
    useSourcesStore.subscribe(() => {
      const dir = sourceSandboxDir();
      if (dir === lastDir) return;
      lastDir = dir;
      store.flushPersist();
      store.loadHistory(dir);
    });
  } catch {
    // sources-store 不可用（纯函数测试）时跳过订阅。
  }
  try {
    window.addEventListener('beforeunload', () => store.flushPersist());
  } catch {
    // 非浏览器环境无 beforeunload。
  }
}

/** 进程内单例（工具内弹窗与未来多标签页共用一个 store，不按窗口拆分）。 */
export function getAiStore(): AiStore {
  if (!singleton) {
    singleton = createAiStore();
    // 启动恢复：按当前源目录读会话；随后跟随 sources-store 切源。
    singleton.loadHistory(sourceSandboxDir());
    bindSourcesHistory(singleton);
  }
  return singleton;
}

/** React 订阅 hook（直接透传内部 zustand hook，快照带记忆化，避免手写 getSnapshot 每次返回新引用导致的无限循环）。 */
export function useAiStore<T>(selector: (s: AiState) => T): T {
  return getAiStore().use(selector);
}

/**
 * 订阅 ai:event 到 store（AiDialog 挂载时调用一次，返回退订函数）。
 * 归属校验在 handleEvent 内完成，不符合当前会话的事件直接丢弃。
 */
export function bindAiEvents(): () => void {
  const store = getAiStore();
  store.ensureActiveSession();
  return onAiEvent((ev: AiEvent) => {
    try {
      store.handleEvent(ev);
    } catch {
      // 单事件异常不阻断后续事件（旧多播 try/catch 口径）。
    }
  });
}
