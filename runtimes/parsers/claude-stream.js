/**
 * Claude Code stream-json 协议解析器
 * 接口：push(chunk, handlers) / flush(handlers) / hasEmittedContent()
 */
function createClaudeStreamParser() {
  let buffer = '';
  let emitted = false;

  function handleObject(obj, handlers) {
    if (!obj || typeof obj !== 'object') return;
    const type = String(obj.type || '');

    // content_block_delta：文本 / 思考增量
    if (type === 'content_block_delta' && obj.delta && typeof obj.delta === 'object') {
      const dType = String(obj.delta.type || '');
      if (dType === 'text_delta' && typeof obj.delta.text === 'string' && obj.delta.text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text: obj.delta.text }); } catch (_) {}
        return;
      }
      if (dType === 'thinking_delta') {
        const thinking = obj.delta.thinking || obj.delta.text || '';
        if (thinking) {
          emitted = true;
          try { handlers.onThinking && handlers.onThinking({ text: thinking }); } catch (_) {}
        }
        return;
      }
      // 其他 delta 兜底
      if (typeof obj.delta.text === 'string' && obj.delta.text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text: obj.delta.text }); } catch (_) {}
        return;
      }
      if (typeof obj.delta.thinking === 'string' && obj.delta.thinking) {
        emitted = true;
        try { handlers.onThinking && handlers.onThinking({ text: obj.delta.thinking }); } catch (_) {}
        return;
      }
      return;
    }

    // content_block_start 含 tool_use
    if (type === 'content_block_start' && obj.content_block && typeof obj.content_block === 'object') {
      const block = obj.content_block;
      const bType = String(block.type || '');
      if (bType === 'tool_use' || block.name) {
        emitted = true;
        try { handlers.onToolCall && handlers.onToolCall({ name: block.name || 'tool_use', id: block.id, input: block.input, raw: obj }); } catch (_) {}
        return;
      }
      if (bType === 'thinking') {
        const thinking = block.thinking || block.text || '';
        if (thinking) {
          emitted = true;
          try { handlers.onThinking && handlers.onThinking({ text: thinking }); } catch (_) {}
        }
        return;
      }
      if (typeof block.text === 'string' && block.text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text: block.text }); } catch (_) {}
        return;
      }
      return;
    }

    // 直接 tool_use 事件
    if (type === 'tool_use' || obj.tool_use) {
      emitted = true;
      const payload = obj.tool_use && typeof obj.tool_use === 'object' ? obj.tool_use : obj;
      try { handlers.onToolCall && handlers.onToolCall(payload); } catch (_) {}
      return;
    }

    // message_start 或含 session_id
    if (type === 'message_start' || obj.session_id || obj.sessionId || obj.sessionID) {
      const sid = obj.session_id || obj.sessionId || obj.sessionID ||
        (obj.message && (obj.message.id || obj.message.session_id)) || null;
      try { handlers.onSession && handlers.onSession({ id: sid ? String(sid) : 'claude-session' }); } catch (_) {}
      // message_start 可能同时无内容，直接返回
      if (type === 'message_start' && !obj.delta) return;
    }

    // message_delta 文本增量
    if (type === 'message_delta' && obj.delta) {
      if (typeof obj.delta.text === 'string' && obj.delta.text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text: obj.delta.text }); } catch (_) {}
        return;
      }
      if (obj.delta && typeof obj.delta === 'object' && typeof obj.delta.content === 'string' && obj.delta.content) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text: obj.delta.content }); } catch (_) {}
        return;
      }
    }

    // result 事件带最终文本
    if (type === 'result') {
      const text = obj.result || obj.text || obj.content || '';
      if (typeof text === 'string' && text) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text }); } catch (_) {}
      }
      return;
    }

    // 通用兜底：顶层 text / content 字符串
    if (typeof obj.text === 'string' && obj.text && !type) {
      emitted = true;
      try { handlers.onChunk && handlers.onChunk({ text: obj.text }); } catch (_) {}
    }
  }

  function handleLine(line, handlers) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      if (trimmed) {
        emitted = true;
        try { handlers.onChunk && handlers.onChunk({ text: line + '\n' }); } catch (_) {}
      }
      return;
    }
    handleObject(obj, handlers);
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
  }

  function hasEmittedContent() {
    return emitted;
  }

  return { push, flush, hasEmittedContent };
}

module.exports = {
  createClaudeStreamParser,
  createParser: createClaudeStreamParser
};
