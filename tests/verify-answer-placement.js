'use strict';
// 回答归位 + 思考/回答分流：opencode 思考在 part.type === 'reasoning' 里，顶层仍是 message/text
// 病症：思考期回答框提前出现（内容被思考污染）、定稿后回答卡在工具行上方而非底部。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const { createJsonEventStreamParser } = require(path.join(rootDir, 'runtimes', 'parsers', 'json-event-stream.js'));

function collect(lines) {
  const p = createJsonEventStreamParser('opencode');
  const out = { think: [], chunk: [], tool: [] };
  const h = {
    onThinking: (e) => out.think.push(String((e && e.text) || e || '')),
    onChunk: (e) => out.chunk.push(String((e && e.text) || e || '')),
    onToolCall: (e) => out.tool.push(e),
    onSession: () => {},
    onError: () => {},
    onClose: () => {},
  };
  lines.forEach((l) => p.push(l + '\n', h));
  p.flush(h);
  return out;
}

// 1. 嵌套 reasoning → thinking，不进回答
{
  const r = collect([
    JSON.stringify({ type: 'message', part: { type: 'reasoning', text: '先想想布局' } }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: '最终答案' } }),
  ]);
  assert.strictEqual(r.think.length, 1, '嵌套 reasoning 应走 thinking');
  assert.ok(r.think[0].includes('先想想布局'), '思考文本正确');
  assert.strictEqual(r.chunk.length, 1, '仅正文进 chunk');
  assert.ok(r.chunk[0].includes('最终答案'), '回答文本正确');
  console.log('[PASS] 嵌套 reasoning 分流正确');
}

// 2. 顶层 reasoning 照旧 + tool 不受影响
{
  const r = collect([
    JSON.stringify({ type: 'reasoning', text: '顶层思考' }),
    JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'view_file', state: { input: { path: 'a.html' } } } }),
    JSON.stringify({ type: 'message', part: { type: 'text', content: '好' } }),
  ]);
  assert.strictEqual(r.think.length, 1, '顶层 reasoning 仍走 thinking');
  assert.strictEqual(r.tool.length, 1, 'tool_use 仍走 tool');
  assert.strictEqual(r.chunk.length, 1, 'text part 走 chunk');
  console.log('[PASS] 顶层类型行为不变');
}

// 3. 渲染层定稿搬回答到底部（静态锁定）
{
  const src = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
  const m = (function () {
    // brace-matched extract
    const start = src.indexOf('function i5AnswerFinalize(ts){');
    assert.ok(start >= 0, '缺 i5AnswerFinalize');
    let i = start, depth = 0, inS = null;
    let seen = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
      if (c === '{') { depth++; seen = true; }
      if (c === '}') { depth--; if (seen && depth === 0) break; }
    }
    return src.slice(start, i + 1);
  })();
  assert.ok(/appendChild\(aiTlAnswerEl\)/.test(m), '定稿须把回答元素搬到末尾');
  assert.ok(/回答归位/.test(m), '须有归位注释');
  assert.ok(/i5-empty-note/.test(m), '零输出须落占位说明，禁静默空白');
  assert.ok(/零输出/.test(m), '占位须配 trace 说明');
  console.log('[PASS] 回答归位逻辑存在');
}

// ---- 5. 吸底防卡死：底部附近抖动不得锁死暂停，吸底时自愈 ----
(function testStickBottom() {
  const src = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
  assert.ok(/deltaY < 0 && !aiShouldAutoScroll\(cv,80\)/.test(src), '滚轮仅脱离底部才暂停');
  assert.ok(/touchmove.*aiShouldAutoScroll\(cv,80\)/.test(src), '触摸仅脱离底部才暂停');
  const m = src.match(/function i5TlScroll\(\)\{[\s\S]*?\n\}/);
  assert.ok(m && /aiUserScrolledPause=false/.test(m[0]), '吸底时须清陈旧暂停再置底');
  console.log('[PASS] 吸底防卡死存在');
})();

// ---- 4. 发送前加固：组装启动抛错直接报错复位 ----
(function testPreSendGuard() {
  const src = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
  const i = src.indexOf('开启新日志组');
  assert.ok(i >= 0, '缺发送组装段');
  const seg = src.slice(i, i + 2500);
  assert.ok(/发送前加固/.test(seg), '须有加固注释');
  assert.ok(/aiBubbleError\('发送失败/.test(seg), '抛错须报错气泡');
  console.log('[PASS] 发送前加固存在');
})();

console.log('ANSWER_PLACE_PASS: 回答归位与思考分流全绿');
