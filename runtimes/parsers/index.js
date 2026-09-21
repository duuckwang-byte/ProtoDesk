const { createJsonEventStreamParser } = require('./json-event-stream');
const { createClaudeStreamParser } = require('./claude-stream');
const { createPlainStreamParser } = require('./plain-stream');
const { createQoderStreamParser } = require('./qoder-stream');
const { createAgyStreamParser } = require('./agy-stream');

/**
 * 按 streamFormat 选择流解析器，每次返回新实例
 * @param {string} streamFormat 'claude-stream-json' | 'json-event-stream' | 'plain' | 'qoder-stream-json' | 'agy-stream'
 * @param {string} [eventParser] 'opencode' | 'cursor-agent' | 'codex'
 * @returns {{ push: Function, flush: Function, hasEmittedContent: Function }}
 */
function getStreamParser(streamFormat, eventParser) {
  if (streamFormat === 'claude-stream-json') {
    return createClaudeStreamParser();
  }
  if (streamFormat === 'json-event-stream') {
    return createJsonEventStreamParser(eventParser);
  }
  if (streamFormat === 'qoder-stream-json') {
    return createQoderStreamParser();
  }
  if (streamFormat === 'agy-stream') {
    return createAgyStreamParser();
  }
  return createPlainStreamParser();
}

const getParser = getStreamParser;

module.exports = {
  getStreamParser,
  getParser
};
