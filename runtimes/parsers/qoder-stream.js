/**
 * Qoder CN CLI stream-json 解析器（qoderclicn -p -o stream-json）
 * 实测事件词汇（v1.1.58，类 Claude Code 帧）：
 *   assistant: message.content[] = thinking{thinking} / text{text} / tool_use{id,name,input}
 *   user: tool_result 回声（执行侧已落盘，此处跳过不复读）
 *   result: subtype=success + result文本 + session_id（文本已随assistant流出，不复读；只收session）
 *           is_error=true 或 subtype含error → 记pendingError，待close由engine统一诊断
 *   system/*: 仅取 session_id（含init帧），其余跳过
 * 非JSON行（如"Model X不可用，已用auto代替"提示）：跳过不进正文，stderr由engine另行累积
 * 接口：push(chunk, handlers) / flush(handlers) / hasEmittedContent() / getPendingError()
 */
function createQoderStreamParser() {
  let buf = '';
  let emitted = false;
  let pendingError = null;
  const seenSessions = new Set();

  function emitSession(handlers, sid) {
    const id = String(sid == null ? '' : sid).trim();
    if (!id || seenSessions.has(id)) return;
    seenSessions.add(id);
    try { handlers.onSession && handlers.onSession({ id }); } catch (_) {}
  }

  function dispatch(obj, handlers) {
    if (!obj || typeof obj !== 'object') return;
    const h = handlers || {};
    if (obj.session_id) emitSession(h, obj.session_id);
    const t = String(obj.type || '');
    if (t === 'assistant') {
      const raw = ((obj.message || {}).content) || [];
      const blocks = Array.isArray(raw) ? raw : [raw];
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        const bt = String(b.type || '');
        if (bt === 'thinking') {
          const text = String(b.thinking || '').trim();
          if (text) {
            emitted = true;
            try { h.onThinking && h.onThinking({ text }); } catch (_) {}
          }
        } else if (bt === 'text') {
          const text = String(b.text == null ? '' : b.text);
          if (text) {
            emitted = true;
            try { h.onChunk && h.onChunk({ text }); } catch (_) {}
          }
        } else if (bt === 'tool_use') {
          const name = String(b.name || '');
          const input = (b.input != null ? b.input : {});
          emitted = true;
          try {
            h.onToolCall && h.onToolCall({
              ...b,
              tool: name,
              name,
              id: String(b.id || ''),
              input,
              args: input
            });
          } catch (_) {}
        }
      }
      return;
    }
    if (t === 'result') {
      const bad = obj.is_error === true || /error/i.test(String(obj.subtype || ''));
      if (bad) {
        const msg = String(obj.result || obj.error || obj.message || 'Qoder 执行失败');
        pendingError = { message: msg, raw: obj };
      }
      return;
    }
    /* user（tool_result回声）/ system（hooks/init心跳）：session已收，其余静默跳过 */
  }

  function handleLine(line, handlers) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      return;
    }
    dispatch(obj, handlers);
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

  return { push, flush, hasEmittedContent, getPendingError };
}

module.exports = {
  createQoderStreamParser,
  createParser: createQoderStreamParser
};
