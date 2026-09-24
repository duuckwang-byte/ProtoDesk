/**
 * 纯文本逐行解析器（Aider / DeepSeek TUI / 备用容错）
 * 接口：push(chunk, handlers) / flush(handlers) / hasEmittedContent()
 * flush 时用正则提取 <artifact identifier="..." type="text/html">...</artifact>
 */
const ARTIFACT_RE = /<artifact[^>]*identifier="([^"]+)"[^>]*type="text\/html"[^>]*>([\s\S]*?)<\/artifact>/g;

function createPlainStreamParser() {
  let lineBuffer = '';
  let fullText = '';
  let emitted = false;
  let artifactEmitted = false;

  function push(chunk, handlers) {
    const h = handlers || {};
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    if (!text) return;
    fullText += text;
    lineBuffer += text;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop();
    for (const line of lines) {
      emitted = true;
      try { h.onChunk && h.onChunk({ text: line + '\n' }); } catch (_) {}
    }
  }

  function flush(handlers) {
    const h = handlers || {};
    if (lineBuffer) {
      emitted = true;
      try { h.onChunk && h.onChunk({ text: lineBuffer }); } catch (_) {}
      lineBuffer = '';
    }
    // flush 时提取 artifact 块
    ARTIFACT_RE.lastIndex = 0;
    let m = null;
    let found = false;
    const source = fullText || '';
    while ((m = ARTIFACT_RE.exec(source)) !== null) {
      found = true;
      artifactEmitted = true;
      emitted = true;
      try {
        h.onToolCall && h.onToolCall({
          name: 'artifact',
          identifier: m[1],
          html: m[2],
          content: m[2],
          type: 'text/html',
          raw: m[0]
        });
      } catch (_) {}
    }
    // 若无 artifact 且从未派发过内容，但有累积文本，则回填一次
    if (!found && !emitted && source) {
      emitted = true;
      try { h.onChunk && h.onChunk({ text: source }); } catch (_) {}
    }
  }

  function hasEmittedContent() {
    return emitted;
  }

  return { push, flush, hasEmittedContent };
}

module.exports = {
  createPlainStreamParser,
  createParser: createPlainStreamParser
};
