'use strict';
// agy stream-json 解析器 + antigravity assembly 验证（纯 Node，无 Electron 依赖，CommonJS）
// 不调真实 agy：用实测形状样本行断言事件序列，再断言 buildArgs 装配。
const assert = require('node:assert');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const antigravityDef = require(path.join(rootDir, 'runtimes', 'defs', 'antigravity'));
const { getStreamParser } = require(path.join(rootDir, 'runtimes', 'parsers'));

// ---------- 断言1：实测样本行事件序列 ----------
function test1_AgyEventSequence() {
  const parser = getStreamParser('agy-stream');
  assert.ok(parser && typeof parser.push === 'function', 'agy parser 应有 push');
  assert.ok(typeof parser.flush === 'function', 'agy parser 应有 flush');
  assert.ok(typeof parser.hasEmittedContent === 'function', 'agy parser 应有 hasEmittedContent');
  assert.ok(typeof parser.getPendingError === 'function', 'agy parser 应有 getPendingError');
  assert.ok(typeof parser.getUsage === 'function', 'agy parser 应有 getUsage');
  assert.strictEqual(parser.hasEmittedContent(), false, '初始 hasEmittedContent 应为 false');
  assert.strictEqual(parser.getPendingError(), null, '初始 pendingError 应为 null');
  assert.deepStrictEqual(parser.getUsage(), { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 }, '初始 usage 累计应为全 0');

  const chunks = [];
  const tools = [];
  const h = {
    onChunk: (e) => chunks.push(e && e.text),
    onThinking: () => {},
    onToolCall: (e) => tools.push(e),
    onSession: () => {},
  };
  const lines = [
    // 1. init → 忽略，不发事件
    '{"event":"init","init":{"cwd":"C:/proj","tools":["view_file"],"permission_mode":"acceptEdits"}}',
    // 2. tool ACTIVE → onToolCall 开始（AbsolutePath 归一到 path）
    '{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:/proj/a.html"}}}}',
    // 3. agent_response ACTIVE 含 text_delta → onChunk
    '{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello "}}',
    // 4. agent_response DONE 含 text_delta → onChunk（同样透传）
    '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"world"}}',
    // 5. agent_response DONE 无 text_delta → 忽略（无文本思考步）
    '{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"agent_response"}}',
    // 6. tool DONE 含 output → onToolCall 完成
    '{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:/proj/a.html"},"output":"<html>hi</html>"}}}',
    // 7. result FAILED → 记 pendingError，不发 chunk
    '{"event":"result","result":{"status":"FAILED","error":"boom"}}',
    // 8. 非 JSON 行 → onChunk 纯文本容错
    'some plain log line',
  ];
  parser.push(lines.join('\n') + '\n', h);
  parser.flush(h);

  assert.strictEqual(tools.length, 2, `tool 开始/完成应触发2次 onToolCall，实际 ${tools.length}`);
  assert.strictEqual(tools[0].tool, 'view_file', `开始 tool 应为 view_file，实际 ${tools[0].tool}`);
  assert.strictEqual(tools[0].input && tools[0].input.AbsolutePath, 'C:/proj/a.html', '开始 input 应透传 parameters');
  assert.strictEqual(tools[0].path, 'C:/proj/a.html', `开始须归一 path（AbsolutePath），实际 ${tools[0].path}`);
  assert.strictEqual(tools[1].tool, 'view_file', `完成 tool 应为 view_file，实际 ${tools[1].tool}`);
  assert.ok(String(tools[1].output).includes('<html>hi</html>'), `完成须带 output 摘要，实际 ${JSON.stringify(tools[1].output)}`);
  assert.strictEqual(tools[0].stepIndex, 1, `开始 stepIndex 应透传为数字 1，实际 ${JSON.stringify(tools[0].stepIndex)}`);
  assert.strictEqual(tools[1].stepIndex, 1, `完成 stepIndex 应透传为数字 1，实际 ${JSON.stringify(tools[1].stepIndex)}`);
  assert.strictEqual(tools[0].id, 'agy-1', `开始 id 应为 agy-1，实际 ${JSON.stringify(tools[0].id)}`);
  assert.strictEqual(tools[1].id, 'agy-1', `完成 id 应为 agy-1，实际 ${JSON.stringify(tools[1].id)}`);
  assert.strictEqual(tools[0].id, tools[1].id, '同一工具 ACTIVE 与 DONE 步号相同故同 id');
  assert.deepStrictEqual(tools[1].usage, { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 }, `无 usage 事件应附全 0 usage，实际 ${JSON.stringify(tools[1].usage)}`);
  assert.deepStrictEqual(parser.getUsage(), { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 }, `无 usage 事件累计应为全 0，实际 ${JSON.stringify(parser.getUsage())}`);
  assert.strictEqual(chunks.length, 3, `应收到3段 chunk（Hello/world/非JSON行），实际 ${JSON.stringify(chunks)}`);
  assert.strictEqual(chunks[0], 'Hello ', `首段应为 'Hello '，实际 ${JSON.stringify(chunks[0])}`);
  assert.strictEqual(chunks[1], 'world', `次段应为 'world'，实际 ${JSON.stringify(chunks[1])}`);
  assert.ok(String(chunks[2]).includes('some plain log line'), `末段应为非JSON行透传，实际 ${JSON.stringify(chunks[2])}`);
  assert.ok(!chunks.join('').includes('boom'), '失败 result 不得复读进正文');
  const pend = parser.getPendingError();
  assert.ok(pend && String(pend.message).includes('boom'), `失败须记 pendingError，实际 ${JSON.stringify(pend)}`);
  assert.strictEqual(parser.hasEmittedContent(), true, '有内容后 hasEmittedContent 应为 true');
}

// ---------- 断言2：SUCCESS 不复读 + 输出截断 + flush 补发 ----------
function test2_SuccessNoDupTruncateFlush() {
  // 2a. SUCCESS 不额外发 chunk
  {
    const parser = getStreamParser('agy-stream');
    const chunks = [];
    const h = { onChunk: (e) => chunks.push(e && e.text), onThinking: () => {}, onToolCall: () => {}, onSession: () => {} };
    parser.push('{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"done-text"}}\n', h);
    parser.push('{"event":"result","result":{"status":"SUCCESS","response":"done-text"}}\n', h);
    parser.flush(h);
    assert.strictEqual(chunks.length, 1, `SUCCESS 不得复读正文，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(chunks[0], 'done-text', '正文应仅来自 text_delta');
    assert.strictEqual(parser.getPendingError(), null, 'SUCCESS 不得记 pendingError');
    assert.strictEqual(parser.hasEmittedContent(), true, 'SUCCESS 流有内容后应为 true');
  }
  // 2b. DONE output 超 2000 字符截断
  {
    const parser = getStreamParser('agy-stream');
    const tools = [];
    const h = { onChunk: () => {}, onThinking: () => {}, onToolCall: (e) => tools.push(e), onSession: () => {} };
    const big = 'X'.repeat(5000);
    parser.push(JSON.stringify({ event: 'step_update', step_update: { step_index: 7, state: 'DONE', step_type: 'tool', tool_name: 'run_shell', tool_info: { name: 'run_shell', parameters: { command: 'echo hi' }, output: big } } }) + '\n', h);
    parser.flush(h);
    assert.strictEqual(tools.length, 1, 'DONE 完成应触发一次 onToolCall');
    assert.strictEqual(tools[0].command, 'echo hi', `command 须归一，实际 ${tools[0].command}`);
    assert.strictEqual(String(tools[0].output).length, 2000, `output 应截断至 2000 字符，实际 ${String(tools[0].output).length}`);
  }
  // 2c. 无换行残留 flush 补发
  {
    const parser = getStreamParser('agy-stream');
    const chunks = [];
    const h = { onChunk: (e) => chunks.push(e && e.text), onThinking: () => {}, onToolCall: () => {}, onSession: () => {} };
    parser.push('{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"tail"}}', h);
    assert.strictEqual(chunks.length, 0, '无换行时 flush 前不应 emit');
    assert.strictEqual(parser.hasEmittedContent(), false, '残留未补发前应为 false');
    parser.flush(h);
    assert.ok(chunks.join('').includes('tail'), `flush 应补发残留行，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(parser.hasEmittedContent(), true, 'flush 后应为 true');
  }
}

// ---------- 断言3：stepIndex 稳定键 + usage 透传与累计 ----------
function test3_StepIndexAndUsage() {
  const parser = getStreamParser('agy-stream');
  assert.ok(typeof parser.getUsage === 'function', 'agy parser 应有 getUsage');
  assert.deepStrictEqual(parser.getUsage(), { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 }, '初始累计应全 0');

  const tools = [];
  const chunkObjs = [];
  const h = {
    onChunk: (e) => chunkObjs.push(e),
    onThinking: () => {},
    onToolCall: (e) => tools.push(e),
    onSession: () => {},
  };
  const lines = [
    // tool ACTIVE step 5，带完整 usage
    JSON.stringify({ event: 'step_update', step_update: { step_index: 5, state: 'ACTIVE', step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: 'C:/p/a.html' } }, usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, total_tokens: 17 } } }),
    // agent_response DONE step 6，带完整 usage
    JSON.stringify({ event: 'step_update', step_update: { step_index: 6, state: 'DONE', step_type: 'agent_response', text_delta: 'hi', usage: { input_tokens: 1, output_tokens: 2, thinking_tokens: 3, total_tokens: 6 } } }),
    // tool DONE step 5，同一步号，部分 usage（缺失按 0）
    JSON.stringify({ event: 'step_update', step_update: { step_index: 5, state: 'DONE', step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: 'C:/p/a.html' }, output: 'ok' }, usage: { input_tokens: 7 } } }),
    // agent_response DONE step 7 无文本但带 usage：不发 chunk，但计入累计
    JSON.stringify({ event: 'step_update', step_update: { step_index: 7, state: 'DONE', step_type: 'agent_response', usage: { input_tokens: 4, output_tokens: 4, thinking_tokens: 4, total_tokens: 12 } } }),
    // result SUCCESS 带 usage：不发 chunk，但计入累计
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'hi', usage: { input_tokens: 100, output_tokens: 200, thinking_tokens: 50, total_tokens: 350 } } }),
  ];
  parser.push(lines.join('\n') + '\n', h);
  parser.flush(h);

  // tool 开始/完成各一次，同一步号同 id
  assert.strictEqual(tools.length, 2, `tool ACTIVE/DONE 应各一次，实际 ${tools.length}`);
  assert.strictEqual(tools[0].stepIndex, 5, `ACTIVE stepIndex 应为 5，实际 ${JSON.stringify(tools[0].stepIndex)}`);
  assert.strictEqual(tools[1].stepIndex, 5, `DONE stepIndex 应为 5，实际 ${JSON.stringify(tools[1].stepIndex)}`);
  assert.strictEqual(typeof tools[0].stepIndex, 'number', 'stepIndex 应为数字');
  assert.strictEqual(tools[0].id, 'agy-5', `ACTIVE id 应为 agy-5，实际 ${JSON.stringify(tools[0].id)}`);
  assert.strictEqual(tools[1].id, 'agy-5', `DONE id 应为 agy-5，实际 ${JSON.stringify(tools[1].id)}`);
  assert.strictEqual(tools[0].id, tools[1].id, 'DONE 与 ACTIVE 同一步号须同 id');
  assert.ok(String(tools[1].output).includes('ok'), 'DONE 须带 output 摘要');
  assert.deepStrictEqual(tools[0].usage, { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, total_tokens: 17 }, `ACTIVE usage 应为 per-step 值，实际 ${JSON.stringify(tools[0].usage)}`);
  assert.deepStrictEqual(tools[1].usage, { input_tokens: 7, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 }, `DONE 缺失数字按 0，实际 ${JSON.stringify(tools[1].usage)}`);

  // agent_response 有文本仅一段 chunk，且附 per-step usage
  assert.strictEqual(chunkObjs.length, 1, `有文本 agent_response 仅一段 chunk（无文本步/result 不发），实际 ${JSON.stringify(chunkObjs.map((c) => c && c.text))}`);
  assert.strictEqual(chunkObjs[0].text, 'hi', 'chunk 文本应为 hi');
  assert.deepStrictEqual(chunkObjs[0].usage, { input_tokens: 1, output_tokens: 2, thinking_tokens: 3, total_tokens: 6 }, `chunk usage 应为 per-step 值，实际 ${JSON.stringify(chunkObjs[0].usage)}`);
  assert.strictEqual(chunkObjs[0].stepIndex, 6, 'chunk stepIndex 应透传');
  assert.strictEqual(chunkObjs[0].id, 'agy-6', 'chunk id 应为 agy-6');

  // 累计 = ACTIVE(10/5/2/17) + agent hi(1/2/3/6) + DONE(7/0/0/0) + 无文本步(4/4/4/12) + result(100/200/50/350)
  assert.deepStrictEqual(parser.getUsage(), { input_tokens: 122, output_tokens: 211, thinking_tokens: 59, total_tokens: 385 }, `累计 usage 错误，实际 ${JSON.stringify(parser.getUsage())}`);
  assert.strictEqual(parser.getPendingError(), null, 'SUCCESS 不得记 pendingError');
  assert.strictEqual(parser.hasEmittedContent(), true, '有内容后应为 true');
}

// ---------- 断言4：assembly（buildArgs 装配 + def 契约） ----------
function test3_Assembly() {
  assert.strictEqual(antigravityDef.streamFormat, 'agy-stream', `streamFormat 应为 agy-stream，实际 ${antigravityDef.streamFormat}`);
  assert.strictEqual(antigravityDef.promptViaStdin, false, 'promptViaStdin 应保持 false');
  // --model/--effort 逻辑不动，--output-format stream-json 加在 -p 之前
  const args = antigravityDef.buildArgs('hello', [], [], { model: 'gemini-3.8-flash-high', reasoning: 'high' });
  assert.ok(Array.isArray(args) && args.every((a) => typeof a === 'string'), 'buildArgs 应返回 string[]');
  const iModel = args.indexOf('--model');
  const iEffort = args.indexOf('--effort');
  const iFmt = args.indexOf('--output-format');
  const iP = args.indexOf('-p');
  assert.ok(iFmt !== -1 && args[iFmt + 1] === 'stream-json', `--output-format 后应跟 stream-json，实际 ${JSON.stringify(args)}`);
  assert.ok(iP !== -1 && args[iP + 1] === 'hello', `-p 后应跟 prompt，实际 ${JSON.stringify(args)}`);
  assert.ok(iFmt < iP && iFmt + 1 !== iP, '--output-format stream-json 应紧挨在 -p 之前（占两槽）');
  assert.strictEqual(iP, args.length - 2, `-p 应仍是倒数第二个（最后一个 flag 位），实际 ${JSON.stringify(args)}`);
  assert.ok(iModel !== -1 && iModel < iEffort && iEffort < iFmt, `--model/--effort 顺序不动且在 stream-json 之前，实际 ${JSON.stringify(args)}`);
  // default 模型：无 --model，但仍有 stream-json
  const dArgs = antigravityDef.buildArgs('hi', [], [], { model: 'default' });
  assert.ok(!dArgs.includes('--model'), 'default 不应带 --model');
  assert.ok(dArgs.includes('--output-format') && dArgs.includes('stream-json'), 'default 也应带 stream-json');
  assert.strictEqual(dArgs[dArgs.length - 2], '-p', 'default 装配 -p 仍在末 flag 位');
  assert.strictEqual(dArgs[dArgs.length - 1], 'hi', 'default 装配 prompt 仍在末位');
}

async function main() {
  let passed = 0;
  let failed = 0;
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    }
  }
  await run('断言1 agy实测事件序列', test1_AgyEventSequence);
  await run('断言2 SUCCESS去重/截断/flush补发', test2_SuccessNoDupTruncateFlush);
  await run('断言3 stepIndex与usage累计', test3_StepIndexAndUsage);
  await run('断言4 assembly装配与def契约', test3_Assembly);
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
