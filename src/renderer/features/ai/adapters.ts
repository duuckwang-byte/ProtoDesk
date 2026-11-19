/**
 * src/renderer/features/ai/adapters.ts — 旧 ai:event → 新消息模型的纯函数适配器。
 *
 * 只读来源（转适配器，不搬 UI）：
 * - js/project-ai-export.js : aiEventMatchesSession / aiBindSessionAgent /
 *   aiApplySessionEvent / permNormalize / permOptionId / permRequest 归属分支 /
 *   question-form 契约 / trace 归一 / snapshot 语义 / acp_config 归一
 * - src/renderer/lib/events.ts : AiEvent / matchesSessionOwnership（桥层只读校验）
 *
 * 约束：本文件为纯函数，无 DOM / 无 window / 无 IPC / 无 React；
 * 归属规则逐字沿用旧逻辑（双方都有值且不一致才拒绝，旧事件缺字段不断连）。
 */

/** 会话引用（只取 id/agentId，不碰会话其它状态）。 */
export interface SessionRef {
  id?: string;
  agentId?: string;
}

/** 旧 ai:event 载荷（开放字段，归属只看 agentId/uiSessionId）。 */
export interface AiEventLike {
  type?: string;
  agentId?: string;
  agentName?: string;
  uiSessionId?: string;
  sessionId?: string;
  acpSessionId?: string;
  id?: string;
  [key: string]: unknown;
}

/** 流式片段语义：delta 追加到当前段，full 替换当前段。 */
export type StreamMode = 'delta' | 'full';

/** 单事件 → 消息的流上下文（store 按会话维护；缺省时用事件自带 id）。 */
export interface StreamContext {
  /** 当前运行的稳定 id（CLI/API 事件无 runId 时由 store 生成）。 */
  runId?: string;
}

/** 新消息模型（一轮内按事件顺序追加，渲染层只消费本模型）。 */
export interface AiMessage {
  /** 稳定键（事件 id 或自增回退，纯展示用）。 */
  key: string;
  /** 归属会话 id（投递时由调用方填入，不做推断）。 */
  sessionId: string;
  /** 角色：用户 / 助手 / 系统。 */
  role: 'user' | 'assistant' | 'system';
  /** 消息种类（旧事件 type 的归一化投影）。 */
  kind:
    | 'text'
    | 'thinking'
    | 'tool_call'
    | 'plan'
    | 'usage'
    | 'permission'
    | 'question'
    | 'error'
    | 'trace'
    | 'snapshot'
    | 'status'
    | 'info';
  /** 正文（已做 String() 归一，未做 HTML 转义，转义归渲染层）。 */
  text: string;
  /** 落款时间戳（事件自带 ts 优先，否则 Date.now()，与旧 aiSessNow 口径一致）。 */
  ts: number;
  /** 原事件 type（调试/回放用）。 */
  sourceType: string;
  /** 工具/权限等结构化载荷（渲染卡片用，原样透传子集）。 */
  payload?: Record<string, unknown>;
  /** 同一段流的稳定 id（messageId 优先，其次 runId，最后按会话兜底）。 */
  streamId?: string;
  /** 是否仍在流式中（run_started/done/error 关闭，恢复历史一律 false）。 */
  streaming?: boolean;
  /** delta 追加 / full 替换；非流式消息缺省。 */
  streamMode?: StreamMode;
  /** 上游消息 id（ACP messageId，有则保留，不伪造）。 */
  messageId?: string;
  /** 上游运行 id（事件自带或 store 生成，用于跨 chunk 合并与诊断）。 */
  runId?: string;
  /** 同一 run 内的单调序号（上游有则保留）。 */
  seq?: number;
}

/** 权限请求归一化结果（旧 permNormalize 口径的子集，纯数据）。 */
export interface PermissionRequest {
  id: string;
  agentId: string;
  agentName: string;
  uiSessionId: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  kind: string;
  command: string;
  path: string;
  cwd: string;
  risk: string;
  locations: Array<{ path?: string; line?: number | string }>;
  options: Array<Record<string, unknown>>;
}

/** 问答表单（旧 <question-form>/<ask-question> 行内契约）。 */
export interface QuestionForm {
  id: string;
  title: string;
  questions: Array<{
    id: string;
    label: string;
    type: string;
    options: string[];
    recommended: string;
  }>;
}

/** Trace 行（旧 aiAppendTrace 归一：string → {text,tag INFO,level info}）。 */
export interface TraceLine {
  time: string;
  tag: string;
  level: string;
  text: string;
}

/** ACP 会话配置归一（旧 aiHandleAcpConfig 入参侧投影，不写缓存）。 */
export interface AcpConfigSnapshot {
  agentId: string;
  uiSessionId: string;
  acpSessionId: string;
  model: string;
  thoughtConfigId: string;
  thoughtValue: string;
  configOptions: Array<Record<string, unknown>>;
  warnings: string[];
}

/** 思考选项（ACP 动态下发，绝不写死档位）。 */
export interface ThoughtOption {
  id: string;
  value: string;
  label: string;
  title: string;
}

/** ACP 思考项归一结果（强度档位；boolean 项由调用方排除，不当作档位）。 */
export interface AcpThoughtConfig {
  id: string;
  currentValue: string;
  options: ThoughtOption[];
  boolean: boolean;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function now(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

function tsOf(ev: AiEventLike): number {
  const raw = (ev as Record<string, unknown>).ts;
  return typeof raw === 'number' && raw > 0 ? raw : now();
}

/** 数字字段原样保留（缺失/非数字返回 undefined，绝不造值）。 */
function numOf(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 流式模式：只有显式 full/replace/snapshot 才算“整段快照”，其余一律按增量。
 * 旧 `answer` 事件在旧渲染层也是追加口径（js/project-ai-export.js:5333），
 * 所以缺省 delta 才能与历史行为一致；真要整段替换必须在事件上显式标记。
 */
function streamModeOf(e: Record<string, unknown>): StreamMode {
  const raw = str(e.streamMode || e.mode).trim().toLowerCase();
  if (raw === 'full' || raw === 'replace' || raw === 'snapshot') return 'full';
  if (e.full === true || e.replace === true || e.isFull === true) return 'full';
  return 'delta';
}

/**
 * 同一段流的稳定 id：messageId 优先，其次 runId，最后按会话兜底。
 * 正文与思考使用不同命名空间，保证 thinking 永远不会并进正文气泡。
 */
function streamIdOf(
  e: Record<string, unknown>,
  kind: 'text' | 'thinking',
  sessionId: string,
  ctx?: StreamContext,
): string {
  const prefix = kind === 'thinking' ? 'thought' : 'text';
  const messageId = str(e.messageId).trim();
  if (messageId) return prefix + ':msg:' + messageId;
  const runId = str(e.runId).trim() || str(ctx && ctx.runId).trim();
  if (runId) return prefix + ':run:' + runId;
  return prefix + ':local:' + sessionId;
}

/**
 * 归属校验：逐字沿用 js/project-ai-export.js aiEventMatchesSession。
 * 仅在双方都有值且不一致时拒绝；旧事件缺字段不断连。
 * 纯函数化说明：旧实现中 `sid` 为空时会回退读全局 aiAgentIdNow()；
 * 本函数把该回退显式化为第三参 currentAgentId（调用方传入当前 Agent，无全局依赖）。
 */
export function aiEventMatchesSession(
  s: SessionRef | null | undefined,
  ev: AiEventLike | null | undefined,
  currentAgentId = '',
): boolean {
  if (!s || !ev) return false;
  const aid = str((ev as Record<string, unknown>).agentId);
  let sid = str((s as Record<string, unknown>).agentId);
  if (!sid) sid = str(currentAgentId);
  if (aid && sid && aid !== sid) return false;
  const ui = str((ev as Record<string, unknown>).uiSessionId);
  if (ui && (s as Record<string, unknown>).id && ui !== str((s as Record<string, unknown>).id)) return false;
  return true;
}

/**
 * 空事件判定（非对象 / 无 type 且无文本，调用方直接丢弃）。
 * 空事件不崩：所有归一函数对 null/undefined/非对象都返回安全默认值。
 */
export function isEmptyEvent(ev: unknown): boolean {
  if (!ev || typeof ev !== 'object') return true;
  const e = ev as Record<string, unknown>;
  if (e.type != null && str(e.type).trim() !== '') return false;
  if (e.text != null && str(e.text).trim() !== '') return false;
  if (e.trace != null) return false;
  return true;
}

/** 权限复合键（Agent + 会话 + 请求三元组，旧 permRequest 缓存键口径）。 */
export function permissionScopeKey(p: {
  agentId?: string;
  uiSessionId?: string;
  sessionId?: string;
  id?: string;
}): string {
  return (
    str(p.agentId) + '|' + str(p.uiSessionId || p.sessionId) + '|' + str(p.id)
  );
}

/** 权限事件归一（旧 permNormalize：白名单键透传 + id 回退生成占位）。 */
export function normalizePermissionEvent(ev: AiEventLike | null | undefined): PermissionRequest | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;
  const pick = (k: string): unknown => e[k];
  const id = str(pick('id')).trim() || 'perm_pending';
  const asArray = (v: unknown): Array<{ path?: string; line?: number | string }> =>
    Array.isArray(v) ? (v as Array<{ path?: string; line?: number | string }>) : [];
  const asOpts = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  return {
    id,
    agentId: str(pick('agentId')),
    agentName: str(pick('agentName')),
    uiSessionId: str(pick('uiSessionId')),
    sessionId: str((pick('sessionId') as string) ?? ''),
    toolCallId: str(pick('toolCallId')),
    title: str(pick('title')),
    kind: str(pick('kind')),
    command: str(pick('command')),
    path: str(pick('path')),
    cwd: str((pick('cwd') as string) ?? (pick('workdir') as string) ?? ''),
    risk: str(pick('risk')),
    locations: asArray(pick('locations')),
    options: asOpts(pick('options')),
  };
}

/**
 * 权限 option 选择（旧 permOptionId：按 decision 在 options 中找同 kind）。
 * decision: 'allow-once' | 'allow-always' | 'deny'（旧 confirmScope 口径）。
 */
export function permissionOptionId(
  payload: PermissionRequest | null | undefined,
  decision: string,
): string {
  if (!payload || !Array.isArray(payload.options)) return '';
  const d = str(decision);
  const want =
    d === 'deny'
      ? ['reject_once', 'reject_always', 'deny', 'reject']
      : d === 'allow-always'
        ? ['allow_always', 'allow-always', 'always']
        : ['allow_once', 'allow-once', 'allow'];
  for (const o of payload.options) {
    if (!o || typeof o !== 'object') continue;
    const k = str((o as Record<string, unknown>).kind).trim().toLowerCase().replace(/-/g, '_');
    if (want.indexOf(k) >= 0) {
      const rec = o as Record<string, unknown>;
      const v = rec.optionId != null ? rec.optionId : rec.id;
      return v == null ? '' : str(v);
    }
  }
  return '';
}

/** question-form 属性解析（id/title，旧 qform 契约）。 */
function parseFormAttrs(attrText: string): { id: string; title: string } {
  const idm = /id\s*=\s*"([^"]*)"/i.exec(attrText);
  const tm = /title\s*=\s*"([^"]*)"/i.exec(attrText);
  return { id: idm ? idm[1] : '', title: tm ? tm[1] : '' };
}

/**
 * 行内问答提取（旧 <question-form>/<ask-question> 契约）。
 * 空输入返回 []，不抛错。
 */
export function extractQuestionForms(text: unknown): QuestionForm[] {
  const s = str(text);
  if (!s) return [];
  const out: QuestionForm[] = [];
  const re = /<(question-form|ask-question)\b([^>]*)>([\s\S]*?)<\/(question-form|ask-question)\s*>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(s)) !== null) {
    idx += 1;
    const attrs = parseFormAttrs(m[2] || '');
    const body = m[3] || '';
    const questions: QuestionForm['questions'] = [];
    const qre = /\{[^}]*\}/g;
    let qm: RegExpExecArray | null;
    let qi = 0;
    while ((qm = qre.exec(body)) !== null) {
      qi += 1;
      try {
        const o = JSON.parse(qm[0]) as Record<string, unknown>;
        questions.push({
          id: str(o.id) || 'q' + String(qi),
          label: str(o.label || o.title),
          type: str(o.type) || 'radio',
          options: Array.isArray(o.options) ? (o.options as unknown[]).map((x) => str(x)) : [],
          recommended: str(o.recommended),
        });
      } catch {
        // 单个问题解析失败只跳过该项，不影响整轮（旧 qformRoundDone 容错口径）。
      }
    }
    out.push({
      id: attrs.id || 'form' + String(idx),
      title: attrs.title || '请确认',
      questions,
    });
  }
  return out;
}

/** 工具调用归一（旧 i5AppendToolCall / aiAppendSessEvent tool 字段口径）。 */
export function normalizeToolCall(ev: AiEventLike | null | undefined): {
  id: string;
  tool: string;
  title: string;
  status: string;
  kind: string;
  command: string;
} | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;
  const tool = str(e.tool || e.name || e.toolName || e.call || e.title);
  if (!tool && str(e.text).trim() === '' && (e as Record<string, unknown>).file == null) return null;
  return {
    id: str(e.id || e.toolCallId),
    tool,
    title: str(e.title || tool),
    status: str(e.status || e.state || e.phase),
    kind: str(e.kind),
    command: typeof e.command === 'string' ? str(e.command) : typeof e.cmd === 'string' ? str(e.cmd) : '',
  };
}

/** 计划归一（旧 status.entries → plan 卡）。 */
export function normalizePlan(ev: AiEventLike | null | undefined): Array<{ title: string; status: string }> {
  if (!ev || typeof ev !== 'object') return [];
  const e = ev as Record<string, unknown>;
  const list = e.entries;
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).map((it) => {
    if (typeof it === 'string') return { title: it, status: '' };
    const o = (it || {}) as Record<string, unknown>;
    return { title: str(o.title || o.text || o.name), status: str(o.status || o.state) };
  });
}

/** 用量归一（旧 i5ToolUsageText 蛇形/camel 双兼容）。 */
export function normalizeUsage(ev: AiEventLike | null | undefined): {
  inputTokens: number;
  outputTokens: number;
  text: string;
} {
  const num = (v: unknown): number => {
    const n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  if (!ev || typeof ev !== 'object') return { inputTokens: 0, outputTokens: 0, text: '' };
  const e = ev as Record<string, unknown>;
  const u = (e.usage && typeof e.usage === 'object' ? e.usage : e) as Record<string, unknown>;
  const i = num(u.input_tokens != null ? u.input_tokens : u.inputTokens);
  const o = num(u.output_tokens != null ? u.output_tokens : u.outputTokens);
  return {
    inputTokens: i,
    outputTokens: o,
    text: i <= 0 && o <= 0 ? '' : ' · tokens 输入' + String(i) + '/输出' + String(o),
  };
}

/** Trace 归一（旧 aiAppendTrace：string → {text,tag INFO,level info}，tag 大写）。 */
export function normalizeTrace(ev: AiEventLike | null | undefined): TraceLine | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;
  const raw = e.trace;
  const t =
    typeof raw === 'string'
      ? { text: raw, tag: 'INFO', level: 'info' }
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : null;
  if (!t) {
    if (e.text == null) return null;
    return {
      time: new Date().toTimeString().split(' ')[0] || '',
      tag: 'LOG',
      level: 'info',
      text: str(e.text),
    };
  }
  let time = str(t.time);
  if (!time) {
    try {
      time = new Date().toTimeString().split(' ')[0] || '';
    } catch {
      time = '';
    }
  }
  return {
    time,
    tag: str(t.tag || 'LOG').toUpperCase(),
    level: str(t.level || 'info'),
    text: str(t.text),
  };
}

/**
 * 内部控制事件：只更新会话 / ACP 配置 / 权限 / 运行状态等 UI 状态，
 * 旧渲染层对它们从不 append 到对话气泡，新适配层同口径过滤。
 *
 * 原始事件仍由 ai-store 的 `events` 保留（不丢事件）；需要展示的诊断摘要
 * 通过 {@link internalEventTrace} 进入执行日志（TraceView），不进入聊天流。
 */
export const AI_INTERNAL_EVENT_TYPES = [
  'acp_catalog',
  'acp_config',
  'run_started',
  'done',
  'session',
  'commands',
  'permission_resolved',
  'question_resolved',
  'scope_confirm',
  'scope_confirm_dismiss',
] as const;

/**
 * 允许生成聊天消息的事件白名单（会话内容 + 明确的状态类）。
 * 白名单之外的未知 type 一律按内部控制事件过滤，避免把事件名或原始载荷
 * 当作聊天正文渲染（例如 `acp_catalog` / `scope_confirm` 泄漏成文本）。
 */
const AI_CHAT_EVENT_TYPES = new Set<string>([
  'thinking',
  'chunk',
  'text_delta',
  'answer',
  'tool_call',
  'plan',
  'usage',
  'permission_request',
  'question_request',
  'error',
  'trace',
  'agent_status',
  'snapshot',
]);

const AI_INTERNAL_EVENT_SET = new Set<string>(AI_INTERNAL_EVENT_TYPES);

/** 是否内部控制事件（空 type 也不应渲染）。 */
export function isInternalAiEvent(type: unknown): boolean {
  const t = str(type).trim();
  if (!t) return true;
  return AI_INTERNAL_EVENT_SET.has(t) || !AI_CHAT_EVENT_TYPES.has(t);
}

function eventClock(e: Record<string, unknown>): string {
  const raw = e.ts;
  try {
    const d = typeof raw === 'number' && raw > 0 ? new Date(raw) : new Date();
    return d.toTimeString().split(' ')[0] || '';
  } catch {
    return '';
  }
}

function clipText(v: unknown, max = 160): string {
  const s = str(v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 控制事件 → 执行日志行（保留诊断信息，不产生聊天消息）。
 * 非控制事件返回 null；空输入不崩。
 */
export function internalEventTrace(ev: AiEventLike | null | undefined): TraceLine | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;
  const type = str(e.type).trim();
  if (!type || !isInternalAiEvent(type)) return null;

  const parts: string[] = [];
  let level = 'info';
  switch (type) {
    case 'acp_catalog': {
      parts.push('agent=' + (str(e.agentId) || '—'));
      const models = Array.isArray(e.models) ? e.models.length : 0;
      if (models) parts.push('models=' + String(models));
      if (str(e.source)) parts.push('source=' + str(e.source));
      if (e.stale === true) parts.push('stale');
      if (str(e.error)) {
        parts.push('error=' + clipText(e.error, 80));
        level = 'error';
      }
      if (str(e.warning)) {
        parts.push(clipText(e.warning, 160));
        if (level !== 'error') level = 'warn';
      }
      break;
    }
    case 'acp_config': {
      if (str(e.model)) parts.push('model=' + clipText(e.model, 80));
      const cfgId = str(e.thoughtConfigId);
      const cfgVal = str(e.thoughtValue);
      if (cfgId || cfgVal) parts.push('thought=' + (cfgId || '?') + (cfgVal ? ':' + cfgVal : ''));
      const opts = Array.isArray(e.configOptions) ? e.configOptions.length : 0;
      if (opts) parts.push('configOptions=' + String(opts));
      const warnings = Array.isArray(e.warnings) ? e.warnings : [];
      if (warnings.length) {
        parts.push('warnings=' + String(warnings.length) + ':' + clipText(warnings[0], 120));
        level = 'warn';
      }
      break;
    }
    case 'run_started': {
      if (str(e.engine)) parts.push('engine=' + str(e.engine));
      if (str(e.agentId) || str(e.agentName)) {
        parts.push('agent=' + (str(e.agentId) || str(e.agentName)));
      }
      if (e.pid != null) parts.push('pid=' + str(e.pid));
      break;
    }
    case 'done': {
      const status = str(e.status || e.reason || e.result);
      if (status) parts.push('status=' + clipText(status, 60));
      const files = Array.isArray(e.fileChanges) ? e.fileChanges.length : 0;
      if (files) parts.push('fileChanges=' + String(files));
      break;
    }
    case 'session': {
      const acpSid = str(e.acpSessionId || e.sessionId || e.id);
      if (acpSid) parts.push('acpSessionId=' + clipText(acpSid, 80));
      if (str(e.transport)) parts.push('transport=' + str(e.transport));
      break;
    }
    case 'commands': {
      const list = Array.isArray(e.commands) ? e.commands : [];
      parts.push('commands=' + String(list.length));
      const names = list
        .slice(0, 3)
        .map((c) =>
          typeof c === 'string'
            ? c
            : str((c as Record<string, unknown>)?.name || (c as Record<string, unknown>)?.id),
        )
        .filter(Boolean);
      if (names.length) parts.push(names.join(', '));
      break;
    }
    case 'permission_resolved':
    case 'question_resolved':
    case 'scope_confirm':
    case 'scope_confirm_dismiss': {
      if (str(e.id)) parts.push('id=' + clipText(e.id, 80));
      if (type === 'scope_confirm') {
        const hits = Array.isArray(e.hits) ? e.hits.length : 0;
        if (hits) parts.push('hits=' + String(hits));
        level = 'warn';
      }
      if (str(e.transport)) parts.push('transport=' + str(e.transport));
      break;
    }
    default: {
      const detail = str(e.text || e.message || e.status);
      if (detail) parts.push(clipText(detail, 120));
      break;
    }
  }

  return {
    time: eventClock(e),
    tag: type.toUpperCase(),
    level,
    text: parts.length ? parts.join(' · ') : '已处理',
  };
}

/** 快照时间格式化（旧 fmtTsText：20260824-101530 → 2026-08-24 10:15:30）。 */
export function formatSnapshotTs(ts: unknown): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(str(ts));
  if (!m) return str(ts);
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
}

/** ACP 配置事件归一（旧 aiHandleAcpConfig 入参侧，不写任何缓存）。 */
export function normalizeAcpConfig(ev: AiEventLike | null | undefined): AcpConfigSnapshot | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>;
  if (str(e.type) !== '' && str(e.type) !== 'acp_config') return null;
  const warnings = Array.isArray(e.warnings) ? (e.warnings as unknown[]).map((w) => str(w)).filter(Boolean) : [];
  const configOptions = Array.isArray(e.configOptions)
    ? (e.configOptions as Array<Record<string, unknown>>)
    : [];
  return {
    agentId: str(e.agentId),
    uiSessionId: str(e.uiSessionId),
    acpSessionId: str(e.sessionId || e.acpSessionId),
    model: str(e.model),
    thoughtConfigId: str(e.thoughtConfigId),
    thoughtValue: str(e.thoughtValue),
    configOptions,
    warnings,
  };
}

/**
 * ACP 思考项解析（旧 aiAcpThoughtResolve：已选合法保留 → currentValue → 首项）。
 * 选项来自 ACP 动态下发，本函数不内置任何档位。
 */
export function resolveThoughtValue(
  options: Array<{ value: string }> | null | undefined,
  saved: Record<string, string> | null | undefined,
  configId: string,
  currentValue: string,
): { value: string; stale: boolean } {
  const vals = Array.isArray(options) ? options.map((o) => str(o && o.value)) : [];
  const has =
    !!saved && typeof saved === 'object' && !Array.isArray(saved) && !!configId &&
    Object.prototype.hasOwnProperty.call(saved, configId);
  const picked = has && saved ? str((saved as Record<string, unknown>)[configId]) : '';
  if (picked && vals.indexOf(picked) >= 0) return { value: picked, stale: false };
  const cur = str(currentValue).trim();
  if (cur && vals.indexOf(cur) >= 0) return { value: cur, stale: !!picked };
  return { value: vals[0] || '', stale: !!picked };
}

/** ACP 思考项识别键：id 或 category 命中其一即视为思考强度。 */
export const ACP_THOUGHT_KEYS = [
  'thought_level',
  'reasoning_effort',
  'effort',
  'thinking',
  'thought',
] as const;

/** 布尔式思考开关的原值（这些值只表达开/关，不是强度档位）。 */
const ACP_BOOLEAN_THOUGHT_VALUES = new Set([
  'true',
  'false',
  'enabled',
  'disabled',
  'on',
  'off',
]);

function isBooleanThoughtValue(value: unknown): boolean {
  return ACP_BOOLEAN_THOUGHT_VALUES.has(str(value).trim().toLowerCase());
}

/**
 * ACP 选项展开：兼容主进程已 flatten 的 `{value,name}` 与原始 grouped
 * `{name, options:[...]}` 两种形态；只取叶子项，不重复。
 */
function flattenThoughtOptionRecords(
  raw: unknown,
  out: Array<Record<string, unknown>>,
  seen: Set<string>,
): void {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (Array.isArray(rec.options)) {
      flattenThoughtOptionRecords(rec.options, out, seen);
      continue;
    }
    const value = str(rec.value || rec.id || rec.key);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(rec);
  }
}

/**
 * ACP 思考选项归一（旧 aiReasoningOptsFromAcp：保留 Agent 原值，不裁剪）。
 * 文案优先 `label`，其次主进程 `normalizeSelectOptions` 输出的 `name`，
 * 再退 `title` / 原始 value；有可读文案时绝不把 low/high 直接当标签显示。
 */
export function thoughtOptionsFromAcp(
  raw: Array<Record<string, unknown>> | null | undefined,
): ThoughtOption[] {
  const records: Array<Record<string, unknown>> = [];
  flattenThoughtOptionRecords(raw, records, new Set<string>());
  const out: ThoughtOption[] = [];
  for (const o of records) {
    const value = str(o.value || o.id || o.key);
    if (!value) continue;
    out.push({
      id: value,
      value,
      label: str(o.label || o.name || o.title || value),
      title: str(o.title || o.label || o.name || value),
    });
  }
  return out;
}

/**
 * 从 ACP `configOptions` 中找思考项（probe 结果与 acp_config 事件共用）。
 *
 * - id / category 命中 {@link ACP_THOUGHT_KEYS} 都算（兼容 thought_level /
 *   reasoning_effort / effort）；
 * - `type === 'boolean'` 或全部选项值都是 enabled/disabled/on/off 的布尔开关
 *   不算强度档位：`boolean` 标记为 true，由调用方展示“不支持”而不是伪造 low/high；
 * - 返回 `null` 表示没有思考项（模型不支持）。
 */
export function findThoughtConfig(rawOptions: unknown): AcpThoughtConfig | null {
  if (!Array.isArray(rawOptions)) return null;
  let booleanFallback: AcpThoughtConfig | null = null;
  for (const item of rawOptions) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = str(rec.id || rec.key).trim();
    const category = str(rec.category).trim().toLowerCase();
    const lowerId = id.toLowerCase();
    const keys: readonly string[] = ACP_THOUGHT_KEYS;
    if (keys.indexOf(lowerId) < 0 && keys.indexOf(category) < 0) continue;
    const options = thoughtOptionsFromAcp(
      Array.isArray(rec.options) ? (rec.options as Array<Record<string, unknown>>) : [],
    );
    if (!options.length) continue;
    const boolean =
      str(rec.type).trim().toLowerCase() === 'boolean' ||
      options.every((o) => isBooleanThoughtValue(o.value));
    const found: AcpThoughtConfig = {
      id,
      currentValue: str(rec.currentValue),
      options,
      boolean,
    };
    if (!boolean) return found;
    if (!booleanFallback) booleanFallback = found;
  }
  return booleanFallback;
}

/**
 * 模型切换重置 thinking（旧 aiRefreshCascaderReasoning/切换语义：
 * 模型变化后旧档位不再透传，思考回落 Agent 默认）。
 */
export function resetThinkingOnModelChange(
  prevModel: unknown,
  nextModel: unknown,
  thinking: unknown,
): string {
  if (str(prevModel).trim() !== str(nextModel).trim()) return 'default';
  return str(thinking) || 'default';
}

let msgSeq = 0;

/** 单事件 → 消息（空事件返回 []，不抛错）。 */
export function aiEventToMessages(
  ev: AiEventLike | null | undefined,
  sessionId: string,
  ctx?: StreamContext,
): AiMessage[] {
  if (!ev || typeof ev !== 'object') return [];
  const e = ev as Record<string, unknown>;
  const type = str(e.type);
  if (!type) return [];
  // 控制事件不生成聊天消息：原始事件仍由 store.events 保留，
  // internalEventTrace 将其摘要送入执行日志，诊断不丢、聊天流不脏。
  if (isInternalAiEvent(type)) return [];
  const sid = str(sessionId);
  const mk = (
    role: AiMessage['role'],
    kind: AiMessage['kind'],
    text: string,
    payload?: Record<string, unknown>,
    stream?: { streamId: string; streamMode: StreamMode },
  ): AiMessage => {
    msgSeq += 1;
    const messageId = str(e.messageId).trim();
    const runId = str(e.runId).trim() || str(ctx && ctx.runId).trim();
    const seq = numOf(e.seq);
    return {
      key: str(e.id) || type + '_' + String(msgSeq),
      sessionId: sid,
      role,
      kind,
      text,
      ts: tsOf(ev as AiEventLike),
      sourceType: type,
      payload,
      ...(stream ? { streamId: stream.streamId, streaming: true, streamMode: stream.streamMode } : {}),
      ...(messageId ? { messageId } : {}),
      ...(runId ? { runId } : {}),
      ...(seq !== undefined ? { seq } : {}),
    };
  };
  /** 文本/思考片段：空串跳过；纯空白片段保留（空格/换行属于正文），由归约层决定能否追加。 */
  const streamText = (kind: 'text' | 'thinking'): AiMessage[] => {
    const text = str(e.text);
    if (text === '') return [];
    return [
      mk('assistant', kind, text, undefined, {
        streamId: streamIdOf(e, kind, sid, ctx),
        streamMode: streamModeOf(e),
      }),
    ];
  };
  switch (type) {
    case 'thinking':
      return streamText('thinking');
    case 'chunk':
    case 'answer':
      return streamText('text');
    case 'text_delta': {
      // 兼容原始 ACP 事件名（正常情况下已由 main/acp/acp-event-mapper 转成 chunk/thinking）。
      const isThought = str(e.stream) === 'thought' || str(e.stream) === 'thinking';
      return streamText(isThought ? 'thinking' : 'text');
    }
    case 'tool_call': {
      const t = normalizeToolCall(ev as AiEventLike);
      if (!t) return [];
      return [mk('assistant', 'tool_call', t.title || t.tool, { ...(t as unknown as Record<string, unknown>) })];
    }
    case 'plan': {
      const entries = normalizePlan(ev as AiEventLike);
      if (!entries.length) return [];
      return [
        mk('assistant', 'plan', entries.map((p) => p.title).join('\n'), {
          entries: entries as unknown as Record<string, unknown>,
        }),
      ];
    }
    case 'usage': {
      const u = normalizeUsage(ev as AiEventLike);
      return [mk('assistant', 'usage', u.text || '用量已更新', { ...(u as unknown as Record<string, unknown>) })];
    }
    case 'permission_request': {
      const p = normalizePermissionEvent(ev as AiEventLike);
      if (!p) return [];
      return [mk('assistant', 'permission', p.title || '权限请求', { ...(p as unknown as Record<string, unknown>) })];
    }
    case 'question_request': {
      const forms = extractQuestionForms(str(e.text || e.body));
      return [
        mk('assistant', 'question', str(e.title || e.text || '请确认'), {
          forms: forms as unknown as Record<string, unknown>,
          raw: e,
        }),
      ];
    }
    case 'error':
      return [mk('assistant', 'error', str(e.message || e.text || e.error || '未知错误'), { raw: e })];
    case 'trace': {
      const t = normalizeTrace(ev as AiEventLike);
      if (!t) return [];
      return [mk('system', 'trace', '[' + t.tag + '] ' + t.text, { ...(t as unknown as Record<string, unknown>) })];
    }
    case 'agent_status':
      return [mk('system', 'status', str(e.status || e.message || 'agent_status'), { raw: e })];
    case 'snapshot':
      return [mk('system', 'snapshot', str(e.text || e.ts), { raw: e })];
    default:
      // 白名单之外的 type 已在入口按控制事件过滤；这里只做兜底，
      // 绝不把事件名/原始载荷当聊天正文渲染。
      return [];
  }
}

/** 流式边界事件：关闭当前段，下一段文本另起气泡（不跨 run 拼接）。 */
const AI_STREAM_BOUNDARY_EVENTS = new Set<string>(['run_started', 'done', 'cancel', 'error']);

/** 消息的合并键：优先 streamId；旧数据/手工构造缺 streamId 时按 runId 还原同一种格式。 */
function streamKeyOf(m: AiMessage | null | undefined): string {
  if (!m || typeof m !== 'object') return '';
  if (m.streamId) return m.streamId;
  if (m.runId && (m.kind === 'text' || m.kind === 'thinking')) {
    return (m.kind === 'thinking' ? 'thought:run:' : 'text:run:') + m.runId;
  }
  return '';
}

/** 可合并的相邻流式消息判定：只认同会话 + 相邻 + 同 kind + 同 streamId + 仍在流式。 */
export function canMergeStreamMessage(
  last: AiMessage | null | undefined,
  incoming: AiMessage | null | undefined,
): boolean {
  if (!last || !incoming || typeof last !== 'object' || typeof incoming !== 'object') return false;
  if (last.sessionId !== incoming.sessionId) return false;
  if (last.role !== 'assistant' || incoming.role !== 'assistant') return false;
  if (last.kind !== 'text' && last.kind !== 'thinking') return false;
  if (last.kind !== incoming.kind) return false;
  if (last.streaming === false) return false;
  const incomingKey = streamKeyOf(incoming);
  return !!incomingKey && incomingKey === streamKeyOf(last);
}

function isStreamTextMessage(m: AiMessage | null | undefined): boolean {
  return !!m && m.role === 'assistant' && (m.kind === 'text' || m.kind === 'thinking');
}

/**
 * 追加一条消息（唯一合并入口）：
 * - 相邻且同 streamId 的 delta 追加到上一条，full 替换当前段；
 * - 合并时保留首条消息 key（消息 id 稳定），ts 跟随最新片段；
 * - 无段可追加的纯空白 delta 丢弃（避免开头空白气泡），其余空白原样保留。
 */
export function appendMessageWithStreamMerge(
  prev: AiMessage[] | null | undefined,
  incoming: AiMessage | null | undefined,
): AiMessage[] {
  const base = Array.isArray(prev) ? prev : [];
  if (!incoming || typeof incoming !== 'object') return base.slice();
  const last = base.length ? base[base.length - 1] : null;
  const mergeable = canMergeStreamMessage(last, incoming);
  if (
    !mergeable &&
    isStreamTextMessage(incoming) &&
    incoming.streamMode !== 'full' &&
    incoming.text !== '' &&
    incoming.text.trim() === ''
  ) {
    return base.slice();
  }
  if (!mergeable) return last ? [...base, incoming] : [incoming];
  const merged: AiMessage = {
    ...(last as AiMessage),
    text: incoming.streamMode === 'full' ? incoming.text : str((last as AiMessage).text) + str(incoming.text),
    ts: incoming.ts,
    streaming: incoming.streaming !== false,
    ...(incoming.streamMode ? { streamMode: incoming.streamMode } : {}),
    ...(incoming.seq !== undefined ? { seq: incoming.seq } : {}),
  };
  return [...base.slice(0, -1), merged];
}

/** 批量追加（同一事件可能展开多条），逐条走同一合并规则。 */
export function appendMessagesWithStreamMerge(
  prev: AiMessage[] | null | undefined,
  incoming: AiMessage[] | null | undefined,
): AiMessage[] {
  let out = Array.isArray(prev) ? prev.slice() : [];
  for (const m of Array.isArray(incoming) ? incoming : []) out = appendMessageWithStreamMerge(out, m);
  return out;
}

/** 关闭最后一条仍在流式中的消息（run_started/done/error 段边界；无可关闭项返回原数组）。 */
export function closeOpenStreamMessages(prev: AiMessage[] | null | undefined): AiMessage[] {
  const base = Array.isArray(prev) ? prev : [];
  if (!base.length) return base;
  const last = base[base.length - 1];
  if (!last || last.streaming !== true) return base;
  return [...base.slice(0, -1), { ...last, streaming: false }];
}

/** 事件流折叠为消息列表（纯 reducer 底座，空输入不崩；跨 run 由边界事件断开）。 */
export function reduceAiEventsToMessages(
  prev: AiMessage[] | null | undefined,
  ev: AiEventLike | null | undefined,
  sessionId: string,
  ctx?: StreamContext,
): AiMessage[] {
  const base = Array.isArray(prev) ? prev.slice() : [];
  if (!ev || typeof ev !== 'object') return base;
  const type = str((ev as Record<string, unknown>).type);
  const closed = AI_STREAM_BOUNDARY_EVENTS.has(type) ? closeOpenStreamMessages(base) : base;
  const next = aiEventToMessages(ev, sessionId, ctx);
  if (!next.length) return closed;
  return appendMessagesWithStreamMerge(closed, next);
}

/* ═══════════ W3-07 发送上下文：当前源 → ai:ask 的 sandboxDir/targetFile/uiKind/activePage ═══════════ */

/** 发送上下文（ai:ask 第 3 参与 extra 的落点字段）。 */
export interface SendContext {
  /** 当前原型沙箱目录（禁止空串落回工具级 SANDBOX_ROOT）。 */
  sandboxDir: string;
  /** 目标 html 文件：子页优先，其次主 html。 */
  targetFile: string;
  /** 端别：当前源 kind 优先，其次舞台端别（不再写死 mobile）。 */
  uiKind: string;
  /** 当前页面 key：hash 命中优先，否则页面清单首个。 */
  activePage: string;
}

/** 发送上下文的输入（全部可选，缺省不发明值）。 */
export interface SendContextInput {
  sandboxDir?: string;
  mainHtmlFile?: string;
  activeSubFile?: string;
  kind?: string;
  pages?: string[];
  /** 当前窗口 hash（含 # 或不含均可）。 */
  hash?: string;
  /** 无当前源时的舞台端别（app-store.kind）。 */
  fallbackKind?: string;
  /** 无页面清单时的舞台页（app-store.page）。 */
  fallbackPage?: string;
}

/**
 * 从页面清单 + hash 解析当前页（旧 `aiDetectCurrentPage` 的静态等价物）。
 * 规则：hash 精确命中 → 该页；hash 前缀命中 → 该页；hash 未命中任何页 → hash 本身；
 * 无 hash → 页面清单首个（无清单回空串）。
 */
export function pickActivePage(pages: string[] | null | undefined, hash: string | null | undefined): string {
  const list = Array.isArray(pages) ? pages.map((p) => str(p)).filter((p) => p.length > 0) : [];
  const h = str(hash).replace(/^#/, '').trim();
  if (h) {
    const exact = list.find((p) => p === h);
    if (exact) return exact;
    // 仅按路径/查询边界前缀匹配，避免 page-a 误命中 page-ab。
    const prefixed = list.find(
      (p) =>
        h.indexOf(p + '/') === 0 ||
        h.indexOf(p + '?') === 0 ||
        p.indexOf(h + '/') === 0 ||
        p.indexOf(h + '?') === 0,
    );
    if (prefixed) return prefixed;
    return h;
  }
  return list[0] || '';
}

/**
 * 组装 ai:ask 的源上下文（纯函数）。
 * 禁止写死：uiKind 不再回落 'mobile'，sandboxDir 不再回落 '' 之外的值（'' 仅在无当前源时合法）。
 */
export function resolveSendContext(input: SendContextInput | null | undefined): SendContext {
  const i = input || {};
  return {
    sandboxDir: str(i.sandboxDir).trim(),
    targetFile: str(i.activeSubFile).trim() || str(i.mainHtmlFile).trim(),
    uiKind: str(i.kind).trim() || str(i.fallbackKind).trim(),
    activePage: pickActivePage(i.pages, i.hash) || str(i.fallbackPage).trim(),
  };
}

/* ═══════════ W3-07 模型清单：settings-store modelGroups + visibleModels → 级联选项 ═══════════ */

/** 级联选择器选项（ModelSelector props 口径，稳定结构）。 */
export interface AiModelOption {
  value: string;
  label: string;
}

/** 模型组的最小结构（与 settings-store ModelGroup 结构兼容，不 import UI 模块）。 */
export interface ModelGroupLike {
  models?: Array<string | { id?: string; name?: string; label?: string }>;
}

/**
 * 从模型组 + 可见白名单派生级联选项（旧菜单“只显示已选”语义）。
 * - visibleModels = null：白名单未落盘 → 全选；
 * - visibleModels = []：明确全不选 → 空清单；
 * - 其余：只保留命中的 id。
 * 去重保序，不返回输入数组引用（每次调用新数组，调用方用 useMemo 固定）。
 */
export function deriveModelOptions(
  groups: ModelGroupLike[] | null | undefined,
  visibleModels: string[] | null | undefined,
): AiModelOption[] {
  const allow = Array.isArray(visibleModels) ? new Set(visibleModels.map((v) => str(v))) : null;
  const out: AiModelOption[] = [];
  const seen = new Set<string>();
  for (const group of Array.isArray(groups) ? groups : []) {
    const models = group && Array.isArray(group.models) ? group.models : [];
    for (const model of models) {
      const id =
        typeof model === 'string'
          ? model.trim()
          : str(model && (model.id || model.name || model.label)).trim();
      if (!id || seen.has(id)) continue;
      if (allow && !allow.has(id)) continue;
      seen.add(id);
      const label =
        typeof model === 'string' ? model : str(model && (model.name || model.label || model.id)) || id;
      out.push({ value: id, label });
    }
  }
  return out;
}

/* ═══════════ W3-07 会话持久化：旧 ai_hist_* / ai_sessions_v2_* 兼容形状 ═══════════ */

/** 单会话最多保存的消息条数（防 localStorage 配额无限增长）。 */
export const AI_HISTORY_MAX_MESSAGES = 200;

/** 单沙箱最多保存的会话数（旧面板亦按 updatedAt 排序取最近使用）。 */
export const AI_HISTORY_MAX_SESSIONS = 50;

/** 旧渲染层消息行（`{r,t,ts,think}`）；新层只作为降级投影写入 `m`。 */
export interface LegacyAiMessage {
  r: 'u' | 'a' | 'tool' | 's';
  t: string;
  ts?: number;
  think?: string;
}

/** 恢复出的会话（结构等同 stores/ai-store 的 AiSession，避免 adapters 反向依赖 store）。 */
export interface RestoredAiSession {
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

/** 落盘的单会话记录（旧字段 + W3-07 加法字段 msgs）。 */
export interface PersistedSessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 旧 CLI 会话 id（兼容字段，等价 agentSessionId）。 */
  oid: string;
  acpSessionId: string;
  agentId: string;
  agentName: string;
  /** 旧首轮 freshSession 标记。 */
  _freshSession?: boolean;
  /** 旧渲染层可读的粗投影（用户/助手/工具）。 */
  m: LegacyAiMessage[];
  /** 新渲染层完整消息（含权限/计划/工具载荷）；旧渲染层忽略该字段。 */
  msgs: AiMessage[];
}

/** ai_sessions_v2_* 的落盘形状（逐字沿用旧 `{activeId,sessions}`，不写 v/events）。 */
export interface PersistedSessionsFile {
  activeId: string;
  sessions: Record<string, PersistedSessionRecord>;
}

/** 序列化输入（AiState 的结构子集）。 */
export interface AiPersistState {
  sessions: RestoredAiSession[];
  activeSessionId: string | null;
  messages: Record<string, AiMessage[]>;
}

/** 解析结果（AiState 可直接合并）。 */
export interface ParsedSessions {
  sessions: RestoredAiSession[];
  activeSessionId: string | null;
  messages: Record<string, AiMessage[]>;
}

/** 完整消息 → 旧 `m` 投影（旧面板/旧历史读取不崩）。 */
export function toLegacyMessages(messages: AiMessage[] | null | undefined): LegacyAiMessage[] {
  const out: LegacyAiMessage[] = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue;
    const text = str(m.text);
    const ts = typeof m.ts === 'number' && m.ts > 0 ? m.ts : undefined;
    const tsPart = ts ? { ts } : {};
    if (m.role === 'user') {
      out.push({ r: 'u', t: text, ...tsPart });
      continue;
    }
    if (m.kind === 'thinking') {
      if (!text.trim()) continue;
      out.push({ r: 'a', t: '', think: text, ...tsPart });
      continue;
    }
    if (m.kind === 'tool_call') {
      out.push({ r: 'tool', t: text, ...tsPart });
      continue;
    }
    if (!text.trim()) continue;
    out.push({ r: m.role === 'system' ? 's' : 'a', t: text, ...tsPart });
  }
  return out;
}

/** 旧 `m` 投影 → 完整消息（无 msgs 字段时的降级读，只读不迁移）。 */
export function messagesFromLegacy(
  list: unknown,
  sessionId: string,
): AiMessage[] {
  if (!Array.isArray(list)) return [];
  const out: AiMessage[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const r = str(rec.r);
    const ts = typeof rec.ts === 'number' && rec.ts > 0 ? rec.ts : now();
    const text = str(rec.t);
    const think = str(rec.think);
    const key = str(rec.id) || 'restored_' + String(i) + '_' + String(ts);
    if (think.trim()) {
      out.push({
        key: key + '_think',
        sessionId,
        role: 'assistant',
        kind: 'thinking',
        text: think,
        ts,
        sourceType: 'restore',
      });
    }
    if (r === 'u') {
      out.push({ key, sessionId, role: 'user', kind: 'text', text, ts, sourceType: 'restore' });
      continue;
    }
    if (r === 'tool') {
      out.push({ key, sessionId, role: 'assistant', kind: 'tool_call', text, ts, sourceType: 'restore' });
      continue;
    }
    if (!text.trim()) continue;
    // 旧 m 投影里的 system 控制事件伪消息（如 acp_catalog）不再恢复成聊天正文。
    if (r === 's' && AI_INTERNAL_EVENT_SET.has(text.trim())) continue;
    out.push({
      key,
      sessionId,
      role: r === 's' ? 'system' : 'assistant',
      kind: 'text',
      text,
      ts,
      sourceType: 'restore',
    });
  }
  return out.slice(-AI_HISTORY_MAX_MESSAGES);
}

const AI_MESSAGE_KINDS: AiMessage['kind'][] = [
  'text',
  'thinking',
  'tool_call',
  'plan',
  'usage',
  'permission',
  'question',
  'error',
  'trace',
  'snapshot',
  'status',
  'info',
];

/** 旧版本落盘的控制事件伪消息判定（sourceType 命中或 system/info 正文就是事件名）。 */
function isControlEventArtifact(role: unknown, kind: unknown, text: unknown, sourceType: unknown): boolean {
  const src = str(sourceType).trim();
  if (src && AI_INTERNAL_EVENT_SET.has(src)) return true;
  if (str(role) === 'system' && str(kind) === 'info') {
    const t = str(text).trim();
    return t !== '' && AI_INTERNAL_EVENT_SET.has(t);
  }
  return false;
}

/**
 * 旧历史迁移：把相邻的流式 delta 合并回一段。
 * 只合并 `sourceType` 为 chunk / thinking 的片段（answer 视为完整回答，保持独立）；
 * 两端都有 streamId 且不同时不合并，避免把不同 run 拼在一起。
 */
function coalesceStoredStreams(list: AiMessage[]): AiMessage[] {
  const out: AiMessage[] = [];
  for (const m of list) {
    const last = out.length ? out[out.length - 1] : null;
    const lastKey = streamKeyOf(last);
    const curKey = streamKeyOf(m);
    const mergeable =
      !!last &&
      last.sessionId === m.sessionId &&
      last.role === 'assistant' &&
      m.role === 'assistant' &&
      last.kind === m.kind &&
      (m.kind === 'text' || m.kind === 'thinking') &&
      last.sourceType === m.sourceType &&
      (m.sourceType === 'chunk' || m.sourceType === 'thinking') &&
      (!lastKey || !curKey || lastKey === curKey);
    if (!mergeable) {
      out.push(m);
      continue;
    }
    out[out.length - 1] = {
      ...last,
      text: m.streamMode === 'full' ? m.text : last.text + m.text,
      ts: m.ts,
      streaming: false,
    };
  }
  return out;
}

/** 落盘完整消息校验（坏条目跳过，不整包丢弃）。 */
function normalizeStoredMessages(list: unknown, sessionId: string): AiMessage[] {
  if (!Array.isArray(list)) return [];
  const out: AiMessage[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const role =
      rec.role === 'user' || rec.role === 'assistant' || rec.role === 'system'
        ? rec.role
        : 'assistant';
    const kindRaw = str(rec.kind) as AiMessage['kind'];
    const kind = AI_MESSAGE_KINDS.indexOf(kindRaw) >= 0 ? kindRaw : 'text';
    const text = str(rec.text);
    // 旧版本曾把控制事件落成 kind=info 的文本消息（acp_catalog 等）；
    // 恢复时丢弃，避免修复后历史会话仍把事件名渲染成聊天正文。
    if (isControlEventArtifact(role, kind, text, rec.sourceType)) continue;
    const payload =
      rec.payload && typeof rec.payload === 'object' && !Array.isArray(rec.payload)
        ? (rec.payload as Record<string, unknown>)
        : undefined;
    const streamId = str(rec.streamId).trim();
    const streamModeRaw = str(rec.streamMode).trim();
    const streamMode: StreamMode | undefined =
      streamModeRaw === 'full' || streamModeRaw === 'delta' ? streamModeRaw : undefined;
    const messageId = str(rec.messageId).trim();
    const runId = str(rec.runId).trim();
    const seq = numOf(rec.seq);
    out.push({
      key: str(rec.key) || 'restored_' + String(i),
      sessionId,
      role,
      kind,
      text,
      ts: typeof rec.ts === 'number' && rec.ts > 0 ? rec.ts : now(),
      sourceType: str(rec.sourceType) || 'restore',
      ...(payload ? { payload } : {}),
      // 恢复后不再处于流式中，避免历史消息被 live chunk 继续追加。
      streaming: false,
      ...(streamId ? { streamId } : {}),
      ...(streamMode ? { streamMode } : {}),
      ...(messageId ? { messageId } : {}),
      ...(runId ? { runId } : {}),
      ...(seq !== undefined ? { seq } : {}),
    });
  }
  // 先合并再按条数裁剪：旧会话里“一词一条”不会挤掉更早的对话。
  return coalesceStoredStreams(out).slice(-AI_HISTORY_MAX_MESSAGES);
}

function parseSessionRecord(
  value: unknown,
  fallbackId: string,
): { session: RestoredAiSession; messages: AiMessage[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const id = str(rec.id).trim() || str(fallbackId).trim();
  if (!id) return null;
  const createdAt = typeof rec.createdAt === 'number' && rec.createdAt > 0 ? rec.createdAt : now();
  const updatedAt = typeof rec.updatedAt === 'number' && rec.updatedAt > 0 ? rec.updatedAt : createdAt;
  const messages = Array.isArray(rec.msgs)
    ? normalizeStoredMessages(rec.msgs, id)
    : messagesFromLegacy(rec.m, id);
  return {
    session: {
      id,
      title: str(rec.title).trim() || '新的对话',
      agentId: str(rec.agentId),
      agentName: str(rec.agentName),
      agentSessionId: str(rec.oid || rec.agentSessionId),
      acpSessionId: str(rec.acpSessionId),
      freshSession: rec._freshSession === true || rec.freshSession === true,
      createdAt,
      updatedAt,
    },
    messages,
  };
}

function updatedAtOf(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const n = Number((value as Record<string, unknown>).updatedAt);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 解析 ai_sessions_v2_*（多会话）或 ai_hist_*（单会话）落盘值。
 * 无法识别或空数据返回 null；非法会话/消息逐条跳过，绝不整包清空。
 */
export function parseSessionsFile(raw: unknown): ParsedSessions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const root =
    rec.sessions && typeof rec.sessions === 'object' && !Array.isArray(rec.sessions)
      ? (rec.sessions as Record<string, unknown>)
      : null;

  const sessions: RestoredAiSession[] = [];
  const messages: Record<string, AiMessage[]> = {};

  if (root) {
    const keys = Object.keys(root).sort((a, b) => updatedAtOf(root[b]) - updatedAtOf(root[a]));
    for (const key of keys.slice(0, AI_HISTORY_MAX_SESSIONS)) {
      const parsed = parseSessionRecord(root[key], key);
      if (!parsed || messages[parsed.session.id] !== undefined) continue;
      sessions.push(parsed.session);
      messages[parsed.session.id] = parsed.messages;
    }
  } else if (Array.isArray(rec.m) || Array.isArray(rec.msgs)) {
    // ai_hist_* 单会话形状：值本身就是一个 session 对象。
    const parsed = parseSessionRecord(rec, str(rec.id));
    if (parsed) {
      sessions.push(parsed.session);
      messages[parsed.session.id] = parsed.messages;
    }
  } else {
    return null;
  }

  if (!sessions.length) return { sessions: [], activeSessionId: null, messages: {} };
  const activeRaw = str(rec.activeId).trim();
  const activeSessionId =
    activeRaw && messages[activeRaw] !== undefined ? activeRaw : sessions[0].id;
  return { sessions, activeSessionId, messages };
}

/** 落盘前瘦身：payload.raw 原样事件可能很大（含整段 prompt/output），只保留展示所需子集。 */
function slimPersistedMessage(m: AiMessage): AiMessage {
  if (!m.payload) return m;
  const copy: AiMessage = { ...m };
  const payload = { ...copy.payload };
  delete payload.raw;
  if (Object.keys(payload).length) copy.payload = payload;
  else delete copy.payload;
  return copy;
}

/** AiState → 落盘形状（会话按 updatedAt 裁剪，消息按条数裁剪）。 */
export function serializeSessions(state: AiPersistState | null | undefined): PersistedSessionsFile {
  const sessions = Array.isArray(state && state.sessions)
    ? state!.sessions
        .slice()
        .sort((a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0))
        .slice(-AI_HISTORY_MAX_SESSIONS)
    : [];
  const sourceMessages = (state && state.messages) || {};
  const out: Record<string, PersistedSessionRecord> = {};
  for (const s of sessions) {
    if (!s || !str(s.id)) continue;
    const full = Array.isArray(sourceMessages[s.id])
      ? sourceMessages[s.id].slice(-AI_HISTORY_MAX_MESSAGES).map(slimPersistedMessage)
      : [];
    out[s.id] = {
      id: s.id,
      title: str(s.title) || '新的对话',
      createdAt: typeof s.createdAt === 'number' && s.createdAt > 0 ? s.createdAt : now(),
      updatedAt: typeof s.updatedAt === 'number' && s.updatedAt > 0 ? s.updatedAt : now(),
      oid: str(s.agentSessionId),
      acpSessionId: str(s.acpSessionId),
      agentId: str(s.agentId),
      agentName: str(s.agentName),
      ...(s.freshSession === true ? { _freshSession: true } : {}),
      m: toLegacyMessages(full),
      msgs: full,
    };
  }
  const activeId =
    state && state.activeSessionId && out[state.activeSessionId]
      ? state.activeSessionId
      : Object.keys(out).sort((a, b) => out[b].updatedAt - out[a].updatedAt)[0] || '';
  return { activeId, sessions: out };
}
