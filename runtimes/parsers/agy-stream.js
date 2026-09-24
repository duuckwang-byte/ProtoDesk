/**
 * agy (Antigravity CLI) stream-json 解析器（agy -p --output-format stream-json）
 * 实测事件词汇（JSONL，每行一事件）：
 *   init: {"event":"init","init":{cwd, tools, permission_mode}} → 忽略记账，不发事件
 *   step_update/tool ACTIVE: {step_index, state:"ACTIVE", step_type:"tool", tool_name, tool_info:{name, parameters}} → onToolCall 开始
 *     （tool=tool_name，input=parameters，并归一 path/file/command 供现有渲染层提取，兼容 AbsolutePath 等 PascalCase 键）
 *   step_update/tool DONE: 同上且 tool_info 含 output → onToolCall 完成（output 摘要，截断 2000 字符）
 *   step_update/agent_response: 含 text_delta → onChunk 逐段透传（ACTIVE 与 DONE 均透传）
 *   step_update/agent_response DONE 无 text_delta → 忽略（无文本思考步，但其 usage 仍计入累计）
 *   result: {status:"SUCCESS"} → 不复读正文（已随 text_delta 流出，防重复）；非 SUCCESS → 记 pendingError，close 时由 engine 统一诊断
 *   非 JSON 行 → onChunk 纯文本透传（容错）
 * 稳定键：tool 事件 payload 透传 stepIndex（数字，由 step_update.step_index 归一，缺失按 0）
 *   与 id:'agy-'+stepIndex；同一工具的 ACTIVE/DONE 步号相同故同 id，供渲染层关联开始/完成。
 *   为兼容旧字段同步保留 step_index（与 stepIndex 同值）。
 * 用量：每步 step_update 与 result 可能携带 usage{input_tokens,output_tokens,thinking_tokens,total_tokens}。
 *   DONE 的 tool 事件 payload 与有文本的 agent_response chunk payload 上附 per-step usage（数字缺失按 0）；
 *   无文本步与 result 事件不发 handler（result SUCCESS 仍不复读防重复），但其 usage 计入累计。
 *   累计经 getUsage() 返回（供渲染层/后续接线读取）。flush 时不发 tool:'usage' 事件（会污染操作行），
 *   也不把 usage 塞进 getPendingError；不新增 handler 类型、不改 engine。
 * 接口：push(chunk, handlers) / flush(handlers) / hasEmittedContent() / getPendingError() / getUsage()
 */
'use strict';

const OUTPUT_TRUNCATE_LEN = 2000;

const PATH_KEYS = [
  'path', 'Path', 'AbsolutePath', 'absolutePath', 'absolute_path',
  'file', 'File', 'filename', 'Filename', 'FileName', 'fileName',
  'filePath', 'FilePath', 'filepath', 'file_path',
  'pattern', 'Pattern'
];
const CMD_KEYS = ['command', 'Command', 'cmd', 'Cmd'];

function createAgyStreamParser() {
  let buf = '';
  let emitted = false;
  let pendingError = null;
  let totalUsage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 };

  function toCount(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  function normalizeUsage(src) {
    if (!src || typeof src !== 'object') return { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 };
    return {
      input_tokens: toCount(src.input_tokens != null ? src.input_tokens : src.inputTokens),
      output_tokens: toCount(src.output_tokens != null ? src.output_tokens : src.outputTokens),
      thinking_tokens: toCount(src.thinking_tokens != null ? src.thinking_tokens : src.thinkingTokens),
      total_tokens: toCount(src.total_tokens != null ? src.total_tokens : src.totalTokens)
    };
  }

  function looksLikeUsage(o) {
    if (!o || typeof o !== 'object') return false;
    return ('input_tokens' in o || 'output_tokens' in o || 'thinking_tokens' in o || 'total_tokens' in o ||
      'inputTokens' in o || 'outputTokens' in o || 'thinkingTokens' in o || 'totalTokens' in o);
  }

  function pickUsageFromContainer(c) {
    if (!c || typeof c !== 'object') return null;
    if (looksLikeUsage(c)) return normalizeUsage(c);
    for (const k of ['usage', 'tokens', 'token_usage', 'tokenUsage']) {
      let v = null;
      try { v = c[k]; } catch (_) { v = null; }
      if (looksLikeUsage(v)) return normalizeUsage(v);
    }
    return null;
  }

  function extractUsage(...containers) {
    for (const c of containers) {
      const u = pickUsageFromContainer(c);
      if (u) return u;
    }
    return { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 };
  }

  function addUsage(u) {
    if (!u) return;
    totalUsage.input_tokens += toCount(u.input_tokens);
    totalUsage.output_tokens += toCount(u.output_tokens);
    totalUsage.thinking_tokens += toCount(u.thinking_tokens);
    totalUsage.total_tokens += toCount(u.total_tokens);
  }

  function normalizeStepIndex(raw) {
    if (raw == null || raw === '') return 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.floor(n);
  }

  function pickParam(params, keys) {
    if (!params || typeof params !== 'object') return '';
    for (const k of keys) {
      let v = null;
      try { v = params[k]; } catch (_) { v = null; }
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return '';
  }

  function getTextDelta(su, obj) {
    if (su && typeof su.text_delta === 'string' && su.text_delta) return su.text_delta;
    if (su && su.delta && typeof su.delta === 'object' &&
        typeof su.delta.text === 'string' && su.delta.text) return su.delta.text;
    if (su && typeof su.text === 'string' && su.text) return su.text;
    if (obj && typeof obj.text_delta === 'string' && obj.text_delta) return obj.text_delta;
    return '';
  }

  function dispatch(obj, handlers) {
    const h = handlers || {};
    if (!obj || typeof obj !== 'object') return;
    const event = String(obj.event || obj.type || '');

    /* init：记账位，不发事件 */
    if (event === 'init') return;

    if (event === 'step_update') {
      const su = (obj.step_update && typeof obj.step_update === 'object') ? obj.step_update : {};
      const stepType = String(su.step_type || su.stepType || '');
      const state = String(su.state || '').toUpperCase();
      const stepIndex = normalizeStepIndex(su.step_index != null ? su.step_index : su.stepIndex);
      const id = 'agy-' + stepIndex;

      if (stepType === 'tool') {
        const toolInfo = (su.tool_info && typeof su.tool_info === 'object') ? su.tool_info : {};
        const toolName = String(su.tool_name || su.toolName || toolInfo.name || 'tool');
        const params = (toolInfo.parameters != null ? toolInfo.parameters
          : toolInfo.params != null ? toolInfo.params
          : toolInfo.input != null ? toolInfo.input
          : su.parameters != null ? su.parameters : {});
        const stepUsage = extractUsage(su, toolInfo, obj);
        const isDone = (state === 'DONE');
        if (isDone) {
          const hasOutput = (toolInfo.output != null && String(toolInfo.output) !== '');
          if (!hasOutput) { addUsage(stepUsage); return; } /* DONE 无 output：无完成摘要可派发，忽略，但 usage 仍计入累计 */
          const outFull = String(toolInfo.output);
          const truncated = outFull.length > OUTPUT_TRUNCATE_LEN;
          const payload = {
            tool: toolName,
            name: toolName,
            id,
            stepIndex,
            step_index: stepIndex,
            input: params,
            args: params,
            output: truncated ? outFull.slice(0, OUTPUT_TRUNCATE_LEN) : outFull,
            output_truncated: truncated,
            state: 'DONE',
            phase: 'done',
            usage: stepUsage,
            raw: obj
          };
          const p = pickParam(params, PATH_KEYS);
          if (p) payload.path = p;
          const c = pickParam(params, CMD_KEYS);
          if (c) payload.command = c;
          addUsage(stepUsage);
          emitted = true;
          try { h.onToolCall && h.onToolCall(payload); } catch (_) {}
          return;
        }
        /* ACTIVE（及其他非 DONE 状态）→ 开始 */
        const payload = {
          tool: toolName,
          name: toolName,
          id,
          stepIndex,
          step_index: stepIndex,
          input: params,
          args: params,
          state: state || 'ACTIVE',
          phase: 'start',
          usage: stepUsage,
          raw: obj
        };
        const p = pickParam(params, PATH_KEYS);
        if (p) payload.path = p;
        const c = pickParam(params, CMD_KEYS);
        if (c) payload.command = c;
        addUsage(stepUsage);
        emitted = true;
        try { h.onToolCall && h.onToolCall(payload); } catch (_) {}
        return;
      }

      if (stepType === 'agent_response') {
        const text = getTextDelta(su, obj);
        const stepUsage = extractUsage(su, obj);
        if (!text) { addUsage(stepUsage); return; } /* 无文本思考步不发 chunk，但 usage 仍计入累计 */
        addUsage(stepUsage);
        emitted = true;
        try { h.onChunk && h.onChunk({ text, usage: stepUsage, stepIndex, step_index: stepIndex, id, state: state || 'ACTIVE' }); } catch (_) {}
        return;
      }

      /* 未知 step_type：其 usage 仍计入累计后静默忽略 */
      try { addUsage(extractUsage(su, obj)); } catch (_) {}
      return;
    }

    if (event === 'result') {
      const r = (obj.result && typeof obj.result === 'object') ? obj.result : {};
      const status = String(r.status || obj.status || '');
      try { addUsage(extractUsage(r, obj)); } catch (_) {}
      if (status.toUpperCase() !== 'SUCCESS') {
        const msg = String(r.error || r.message || r.response || obj.error || 'agy 执行失败');
        pendingError = { message: msg, raw: obj };
      }
      return; /* SUCCESS 不复读正文，防重复；用量经 getUsage() 累计读取 */
    }

    /* 未知事件：静默忽略 */
  }

  function handleLine(line, handlers) {
    const h = handlers || {};
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      /* 容错：非 JSON 行按纯文本透传 */
      emitted = true;
      try { h.onChunk && h.onChunk({ text: String(line) + '\n' }); } catch (_) {}
      return;
    }
    dispatch(obj, h);
  }

  function push(chunk, handlers) {
    const h = handlers || {};
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk == null ? '' : chunk);
    if (!text) return;
    buf += text;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) handleLine(line, h);
  }

  function flush(handlers) {
    const h = handlers || {};
    if (buf && buf.trim()) {
      handleLine(buf, h);
      buf = '';
    }
  }

  function hasEmittedContent() {
    return emitted;
  }

  function getPendingError() {
    return pendingError;
  }

  function getUsage() {
    return { input_tokens: totalUsage.input_tokens, output_tokens: totalUsage.output_tokens, thinking_tokens: totalUsage.thinking_tokens, total_tokens: totalUsage.total_tokens };
  }

  return { push, flush, hasEmittedContent, getPendingError, getUsage };
}

module.exports = {
  createAgyStreamParser,
  createParser: createAgyStreamParser
};
