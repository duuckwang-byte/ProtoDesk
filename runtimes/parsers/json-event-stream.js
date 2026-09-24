/**
 * 通用 JSONL 结构化事件流解析器（OpenCode / Cursor-Agent / Codex）
 * 接口：push(chunk, handlers) / flush(handlers) / hasEmittedContent()
 * @param {string} [eventParser] 子类别：'opencode' | 'cursor-agent' | 'codex'（行为一致，保留参数区分）
 */
function createJsonEventStreamParser(eventParser) {
  let buffer = '';
  let emitted = false;
  let pendingError = null;
  const subType = eventParser || 'opencode';

  function getText(obj) {
    if (!obj || typeof obj !== 'object') return '';
    if (typeof obj.text === 'string' && obj.text) return obj.text;
    if (typeof obj.content === 'string' && obj.content) return obj.content;
    if (typeof obj.delta === 'string' && obj.delta) return obj.delta;
    if (typeof obj.data === 'string' && obj.data) return obj.data;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (obj.part && typeof obj.part === 'object') {
      if (typeof obj.part.text === 'string' && obj.part.text) return obj.part.text;
      if (typeof obj.part.content === 'string' && obj.part.content) return obj.part.content;
    }
    if (obj.message && typeof obj.message === 'object') {
      if (typeof obj.message.content === 'string' && obj.message.content) return obj.message.content;
      if (typeof obj.message.text === 'string' && obj.message.text) return obj.message.text;
    }
    if (obj.delta && typeof obj.delta === 'object') {
      if (typeof obj.delta.text === 'string' && obj.delta.text) return obj.delta.text;
      if (typeof obj.delta.content === 'string' && obj.delta.content) return obj.delta.content;
    }
    return '';
  }

  function getSessionId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return obj.sessionID || obj.session_id || obj.sessionId || obj.session || null;
  }

  function dispatch(obj, handlers) {
    if (!obj || typeof obj !== 'object') return;
    const rawType = String(obj.type || obj.event || obj.kind || '').toLowerCase();
    const sessionId = getSessionId(obj);
    // session 优先识别（部分事件同时带 session 与内容时两者都派发）
    if (sessionId && (rawType.includes('session') || sessionId)) {
      // 仅当类型含 session 或顶层确有 session 字段且无其他内容时也派发；
      // 为兼容各 CLI，这里只要出现 session 字段即派发一次
      try { handlers.onSession && handlers.onSession({ id: String(sessionId) }); } catch (_) {}
    }

    // error 缓存，待 close 处理，不立即派发
    if (rawType.includes('error') || obj.error) {
      pendingError = obj.error || obj;
      return;
    }

    // tool_use / tool_call / function_call（opencode 实测：{type:"tool_use", part:{type:"tool", tool, state:{input}}}）
    const _part = (obj.part && typeof obj.part === 'object') ? obj.part : null;
    const _isPartTool = _part && String(_part.type || '').toLowerCase() === 'tool';
    // reasoning / thinking（含嵌套 part/message/delta.type：opencode 把思考放在 part.type === 'reasoning' 里，顶层 type 仍是 message/text，不看嵌套就会漏进回答）
    const _nestedType = String(
      ((_part && _part.type) || '') + ' '
      + ((obj.message && typeof obj.message === 'object' && obj.message.type) || '') + ' '
      + ((obj.delta && typeof obj.delta === 'object' && obj.delta.type) || '')
    ).toLowerCase();
    if (rawType.includes('reason') || rawType.includes('think') || _nestedType.includes('reason') || _nestedType.includes('think')) {
      const text = getText(obj);
      if (text) {
        emitted = true;
        try { handlers.onThinking && handlers.onThinking({ text }); } catch (_) {}
      } else if (subType) {
        // 空 thinking 事件忽略
      }
      return;
    }
    if (rawType.includes('tool') || rawType.includes('function_call') || obj.tool_use || obj.tool_call || _isPartTool) {
      emitted = true;
      try {
        const norm = { ...obj };
        try {
          const st = (_part && _part.state && typeof _part.state === 'object') ? _part.state : null;
          const inp = st && st.input != null ? st.input : (obj.input != null ? obj.input : obj.args);
          if (norm.tool == null && norm.name == null && _part && _part.tool) norm.tool = String(_part.tool);
          if ((norm.path == null && norm.file == null) && inp && typeof inp === 'object' && (inp.path || inp.file || inp.filename || inp.filePath || inp.pattern)) {
            norm.path = String(inp.path || inp.file || inp.filename || inp.filePath || inp.pattern);
          }
          if (norm.command == null && norm.cmd == null && inp && typeof inp === 'object' && (inp.command || inp.cmd)) {
            norm.command = String(inp.command || inp.cmd);
          }
          if (norm.args == null && norm.input == null && inp != null) norm.args = inp;
        } catch (_) {}
        handlers.onToolCall && handlers.onToolCall(norm);
      } catch (_) {}
      return;
    }

    // text / chunk / delta / message / content / output
    if (
      rawType.includes('text') ||
      rawType.includes('chunk') ||
      rawType.includes('delta') ||
      rawType.includes('message') ||
      rawType.includes('content') ||
      rawType.includes('output') ||
      rawType.includes('item') ||
      rawType === ''
    ) {
      // 空类型时尝试按内容字段兜底
      const text = getText(obj);
      if (text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text }); } catch (_) {}
        return;
      }
      // 纯 session 事件（无文本）已在上文派发，此处直接返回
      if (sessionId && !text) return;
      // 未知结构但非空对象：忽略，避免噪声
      return;
    }

    // 其他未知 type：若带可提取文本则透传
    const fallbackText = getText(obj);
    if (fallbackText) {
      emitted = true;
      try { handlers.onChunk && handlers.onChunk({ text: fallbackText }); } catch (_) {}
    }
  }

  function handleLine(line, handlers) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      // 容错：非 JSON 行按 plain 透传给 onChunk
      emitted = true;
      try { handlers.onChunk && handlers.onChunk({ text: line + '\n' }); } catch (_) {}
      return;
    }
    dispatch(obj, handlers);
  }

  function push(chunk, handlers) {
    const h = handlers || {};
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      handleLine(line, h);
    }
  }

  function flush(handlers) {
    const h = handlers || {};
    if (buffer && buffer.trim()) {
      handleLine(buffer, h);
    }
    buffer = '';
    // pendingError 缓存待 close 处理：此处不主动派发 onError，
    // 由 engine 在 hasEmittedContent() 为 false 时统一诊断，避免重复报错。
  }

  function hasEmittedContent() {
    return emitted;
  }

  function getPendingError() {
    return pendingError;
  }

  return { push, flush, hasEmittedContent, getPendingError, eventParser: subType };
}

module.exports = {
  createJsonEventStreamParser,
  createParser: createJsonEventStreamParser
};
