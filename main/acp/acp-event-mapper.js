'use strict';
/**
 * main/acp/acp-event-mapper.js — acpx 事件 → 现有 ai:event 纯映射（Phase 0）
 * 不依赖 Electron / acpx 运行时，可直接在 Node 单测中调用。
 * 约定：
 *  - 单个 acpx 事件若只对应一个 UI 事件，mapAcpEvent 返回对象；
 *  - status 可能同时携带 plan / commands / usage，mapAcpEvents 返回全部，
 *    mapAcpEvent 仅返回其中第一个（兼容只取单事件的调用方）；
 *  - 未知事件返回 null / 空数组，调用方直接忽略。
 */
const { normalizeAcpError } = require('./acp-errors');

/**
 * 公共字段：transport 固定为 acp，uiSessionId 仅在有效时透传。
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {{transport:string, uiSessionId?:string}}
 */
function sessionFields(uiSessionId) {
  const out = { transport: 'acp' };
  if (uiSessionId != null && String(uiSessionId) !== '') out.uiSessionId = String(uiSessionId);
  return out;
}

/**
 * 流式关联字段：上游有则原样透传，没有就不写键（绝不伪造 id）。
 * - runId / seq：任意事件都可带，用于跨 chunk 归并与诊断；
 * - messageId / mode：只对文本/思考片段有意义（同一 messageId 的 chunk 属于同一条消息）。
 * @param {Object} event acpx 事件
 * @param {{text?: boolean}} [opts] 是否包含文本专属字段
 * @returns {Object} 需要透传的字段（可能为空对象）
 */
function streamFields(event, opts) {
  const out = {};
  if (event.runId != null && String(event.runId) !== '') out.runId = String(event.runId);
  if (event.seq != null && event.seq !== '') out.seq = event.seq;
  if (opts && opts.text) {
    if (event.messageId != null && String(event.messageId) !== '') {
      out.messageId = String(event.messageId);
    }
    if (event.mode != null && String(event.mode) !== '') out.mode = String(event.mode);
  }
  return out;
}

/**
 * text_delta → chunk（正文） / thinking（思考链）。
 * @param {Object} event acpx text_delta 事件
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {Object|null} ai:event 或 null（空文本）
 */
function mapTextDelta(event, uiSessionId) {
  const text = event.text == null ? '' : String(event.text);
  if (!text) return null;
  const isThought = event.stream === 'thought' || event.stream === 'thinking';
  return {
    type: isThought ? 'thinking' : 'chunk',
    text,
    ...streamFields(event, { text: true }),
    ...sessionFields(uiSessionId)
  };
}

/**
 * tool_call → 现有工具卡事件。
 * @param {Object} event acpx tool_call 事件
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {Object} ai:event
 */
function mapToolCall(event, uiSessionId) {
  const toolCallId = event.toolCallId != null
    ? String(event.toolCallId)
    : (event.id != null ? String(event.id) : '');
  const title = String(event.title || event.name || event.tool || '');
  const out = {
    type: 'tool_call',
    id: toolCallId,
    toolCallId,
    tool: title,
    title,
    status: event.status != null ? String(event.status) : '',
    kind: event.kind != null ? String(event.kind) : '',
    ...streamFields(event),
    ...sessionFields(uiSessionId)
  };
  if (Array.isArray(event.locations)) out.locations = event.locations.slice();
  if (event.rawInput !== undefined) out.input = event.rawInput;
  else if (event.input !== undefined) out.input = event.input;
  if (event.rawOutput !== undefined) out.output = event.rawOutput;
  else if (event.output !== undefined) out.output = event.output;
  if (event.content !== undefined) out.content = event.content;
  return out;
}

/**
 * status → plan / commands / usage（可能同时命中多个）。
 * @param {Object} event acpx status 事件
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {Object[]} ai:event 数组
 */
function mapStatus(event, uiSessionId) {
  const out = [];
  if (Array.isArray(event.entries)) {
    out.push({ type: 'plan', entries: event.entries.slice(), ...streamFields(event), ...sessionFields(uiSessionId) });
  }
  if (Array.isArray(event.availableCommands)) {
    out.push({
      type: 'commands',
      commands: event.availableCommands.slice(),
      ...streamFields(event),
      ...sessionFields(uiSessionId)
    });
  }
  if (event.used != null || event.size != null || event.cost != null || event.breakdown != null) {
    out.push({
      type: 'usage',
      used: event.used,
      size: event.size,
      cost: event.cost,
      breakdown: event.breakdown,
      ...streamFields(event),
      ...sessionFields(uiSessionId)
    });
  }
  return out;
}

/**
 * error → 结构化错误事件。
 * @param {Object} event acpx error 事件
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {Object} ai:event
 */
function mapError(event, uiSessionId) {
  const src = event.error && typeof event.error === 'object' ? event.error : event;
  const normalized = normalizeAcpError(src);
  return {
    type: 'error',
    code: normalized.code,
    title: normalized.title,
    message: normalized.message,
    action: normalized.action,
    retryable: normalized.retryable,
    ...streamFields(event),
    ...sessionFields(uiSessionId)
  };
}

/**
 * 把单个 acpx 事件展开为 0..N 个 ai:event。
 * @param {Object} event acpx AcpRuntimeEvent
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {Object[]} ai:event 数组
 */
function mapAcpEvents(event, uiSessionId) {
  if (!event || typeof event !== 'object') return [];
  switch (event.type) {
    case 'text_delta': {
      const one = mapTextDelta(event, uiSessionId);
      return one ? [one] : [];
    }
    case 'tool_call':
      return [mapToolCall(event, uiSessionId)];
    case 'status':
      return mapStatus(event, uiSessionId);
    case 'error':
      return [mapError(event, uiSessionId)];
    default:
      return [];
  }
}

/**
 * 单事件映射入口（纯函数）。
 * @param {Object} event acpx AcpRuntimeEvent
 * @param {string} [uiSessionId] UI 会话 id
 * @returns {Object|null} ai:event；未知事件 / 空文本返回 null
 */
function mapAcpEvent(event, uiSessionId) {
  const list = mapAcpEvents(event, uiSessionId);
  return list.length ? list[0] : null;
}

module.exports = {
  mapAcpEvent,
  mapAcpEvents
};
