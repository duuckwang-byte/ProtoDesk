'use strict';
// Phase 0 ACP 事件映射验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖 text_delta（正文/思考）、tool_call、status（plan/usage/commands）、error、未知事件。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { mapAcpEvent, mapAcpEvents } = require('../main/acp/acp-event-mapper');

const SID = 's_test_1';

// ---------- 断言1：text_delta → chunk / thinking ----------
function test1_TextDelta() {
  const chunk = mapAcpEvent({ type: 'text_delta', stream: 'output', text: 'hello' }, SID);
  assert.deepStrictEqual(
    chunk,
    { type: 'chunk', text: 'hello', transport: 'acp', uiSessionId: SID },
    `output 流应映射 chunk，实际 ${JSON.stringify(chunk)}`
  );

  // 缺省 stream 按正文处理
  const noStream = mapAcpEvent({ type: 'text_delta', text: 'plain' }, SID);
  assert.strictEqual(noStream.type, 'chunk', '缺省 stream 应映射 chunk');

  const thought = mapAcpEvent({ type: 'text_delta', stream: 'thought', text: 'think' }, SID);
  assert.deepStrictEqual(
    thought,
    { type: 'thinking', text: 'think', transport: 'acp', uiSessionId: SID },
    `thought 流应映射 thinking，实际 ${JSON.stringify(thought)}`
  );
  const thinkingAlias = mapAcpEvent({ type: 'text_delta', stream: 'thinking', text: 'hmm' }, SID);
  assert.strictEqual(thinkingAlias.type, 'thinking', 'thinking 别名也应映射 thinking');

  // 空文本不产生空气泡
  assert.strictEqual(mapAcpEvent({ type: 'text_delta', text: '' }, SID), null, '空文本应返回 null');

  // uiSessionId 缺省时不写该字段
  const noSid = mapAcpEvent({ type: 'text_delta', text: 'x' });
  assert.strictEqual(noSid.uiSessionId, undefined, '无 uiSessionId 时不应写该字段');
  assert.strictEqual('uiSessionId' in noSid, false, '无 uiSessionId 时不应存在该键');

  // 流式关联字段：有则原样保留（messageId 优先由前端合并使用）
  const withMeta = mapAcpEvent(
    { type: 'text_delta', text: 'a', messageId: 'm1', runId: 'r1', seq: 2, mode: 'delta' },
    SID
  );
  assert.strictEqual(withMeta.messageId, 'm1', 'messageId 应透传');
  assert.strictEqual(withMeta.runId, 'r1', 'runId 应透传');
  assert.strictEqual(withMeta.seq, 2, 'seq 应透传');
  assert.strictEqual(withMeta.mode, 'delta', 'mode 应透传');

  const thoughtMeta = mapAcpEvent(
    { type: 'text_delta', stream: 'thought', text: 't', messageId: 'm2' },
    SID
  );
  assert.strictEqual(thoughtMeta.type, 'thinking', '思考流仍映射 thinking');
  assert.strictEqual(thoughtMeta.messageId, 'm2', '思考流也应保留 messageId');

  // 无上游 id 时不伪造任何关联字段（前端走 run 兜底）
  const noMeta = mapAcpEvent({ type: 'text_delta', text: 'x' }, SID);
  for (const key of ['messageId', 'runId', 'seq', 'mode']) {
    assert.strictEqual(key in noMeta, false, `无上游 ${key} 时不应存在该键`);
  }
  const noToolMeta = mapAcpEvent({ type: 'tool_call', toolCallId: 'tc_x', title: 'X' }, SID);
  for (const key of ['messageId', 'runId', 'seq', 'mode']) {
    assert.strictEqual(key in noToolMeta, false, `tool_call 无上游 ${key} 时不应存在该键`);
  }
}

// ---------- 断言2：tool_call → tool_call ----------
function test2_ToolCall() {
  const rawInput = { path: 'a.html', line: 3 };
  const rawOutput = { ok: true };
  const content = [{ type: 'text', text: 'done' }];
  const locations = [{ path: 'a.html', line: 3 }];
  const ev = mapAcpEvent(
    {
      type: 'tool_call',
      toolCallId: 'tc_1',
      title: 'Read file',
      status: 'running',
      kind: 'read',
      locations,
      rawInput,
      rawOutput,
      content
    },
    SID
  );

  assert.strictEqual(ev.type, 'tool_call', 'type 应为 tool_call');
  assert.strictEqual(ev.id, 'tc_1', 'id 应取 toolCallId');
  assert.strictEqual(ev.toolCallId, 'tc_1', 'toolCallId 应透传');
  assert.strictEqual(ev.tool, 'Read file', 'tool 应取 title');
  assert.strictEqual(ev.title, 'Read file', 'title 应透传');
  assert.strictEqual(ev.status, 'running', 'status 应透传');
  assert.strictEqual(ev.kind, 'read', 'kind 应透传');
  assert.deepStrictEqual(ev.locations, locations, 'locations 应透传');
  assert.deepStrictEqual(ev.input, rawInput, 'input 应取 rawInput');
  assert.deepStrictEqual(ev.output, rawOutput, 'output 应取 rawOutput');
  assert.deepStrictEqual(ev.content, content, 'content 应透传');
  assert.strictEqual(ev.transport, 'acp', 'transport 应为 acp');
  assert.strictEqual(ev.uiSessionId, SID, 'uiSessionId 应透传');

  // 兼容 name/tool 与 input/output 别名
  const alt = mapAcpEvent({ type: 'tool_call', id: 'tc_2', name: 'Bash', input: { cmd: 'ls' } }, SID);
  assert.strictEqual(alt.id, 'tc_2', '缺 toolCallId 时应回落 id');
  assert.strictEqual(alt.tool, 'Bash', '缺 title 时应回落 name');
  assert.deepStrictEqual(alt.input, { cmd: 'ls' }, '缺 rawInput 时应回落 input');
}

// ---------- 断言3：status → plan / usage / commands ----------
function test3_Status() {
  const entries = [
    { content: '读取文件', status: 'completed' },
    { content: '修改样式', status: 'pending' }
  ];
  const plan = mapAcpEvent({ type: 'status', entries }, SID);
  assert.deepStrictEqual(
    plan,
    { type: 'plan', entries, transport: 'acp', uiSessionId: SID },
    `entries 应映射 plan，实际 ${JSON.stringify(plan)}`
  );

  const commands = [{ name: 'init', description: '初始化' }];
  const cmd = mapAcpEvent({ type: 'status', availableCommands: commands }, SID);
  assert.deepStrictEqual(
    cmd,
    { type: 'commands', commands, transport: 'acp', uiSessionId: SID },
    `availableCommands 应映射 commands，实际 ${JSON.stringify(cmd)}`
  );

  const breakdown = [{ model: 'x', input: 10 }];
  const usage = mapAcpEvent(
    { type: 'status', used: 100, size: 1000, cost: 0.02, breakdown },
    SID
  );
  assert.deepStrictEqual(
    usage,
    { type: 'usage', used: 100, size: 1000, cost: 0.02, breakdown, transport: 'acp', uiSessionId: SID },
    `用量字段应映射 usage，实际 ${JSON.stringify(usage)}`
  );

  // 单事件只取第一个；mapAcpEvents 保留全部
  const combined = { type: 'status', entries, availableCommands: commands, used: 1, size: 2 };
  assert.strictEqual(mapAcpEvent(combined, SID).type, 'plan', 'mapAcpEvent 应返回第一个分片');
  assert.deepStrictEqual(
    mapAcpEvents(combined, SID).map((e) => e.type),
    ['plan', 'commands', 'usage'],
    'mapAcpEvents 应返回 plan/commands/usage 三个事件'
  );

  assert.strictEqual(mapAcpEvent({ type: 'status' }, SID), null, '无有效字段的 status 应返回 null');
  assert.deepStrictEqual(mapAcpEvents({ type: 'status' }, SID), [], '无有效字段的 status 应返回空数组');
}

// ---------- 断言4：error 与未知事件 ----------
function test4_ErrorAndUnknown() {
  const err = mapAcpEvent({ type: 'error', code: 'ACP_TURN_FAILED', message: 'boom' }, SID);
  assert.strictEqual(err.type, 'error', 'error 事件应映射 error');
  assert.strictEqual(err.code, 'ACP_TURN_FAILED', '错误码应透传');
  assert.strictEqual(err.action, 'retry', 'ACP_TURN_FAILED 应可重试');
  assert.strictEqual(err.retryable, true, 'ACP_TURN_FAILED.retryable 应为 true');
  assert.ok(String(err.message).length > 0, '错误消息不应为空');
  assert.strictEqual(err.transport, 'acp', '错误事件 transport 应为 acp');
  assert.strictEqual(err.uiSessionId, SID, '错误事件 uiSessionId 应透传');

  // 未知事件 / 空输入
  assert.strictEqual(mapAcpEvent({ type: 'session_update' }, SID), null, '未知事件应返回 null');
  assert.strictEqual(mapAcpEvent({}, SID), null, '无 type 事件应返回 null');
  assert.strictEqual(mapAcpEvent(null, SID), null, 'null 事件应返回 null');
  assert.deepStrictEqual(mapAcpEvents({ type: 'plan_update' }, SID), [], '未知事件应返回空数组');

  // 本模块必须保持纯 Node 可测：不得 require electron
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'acp', 'acp-event-mapper.js'), 'utf8');
  assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(src), 'acp-event-mapper 不得依赖 electron');
}

async function main() {
  let passed = 0;
  let failed = 0;
  function run(name, fn) {
    try {
      fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    }
  }

  run('断言1 text_delta 正文/思考映射', test1_TextDelta);
  run('断言2 tool_call 映射', test2_ToolCall);
  run('断言3 status 映射 plan/usage/commands', test3_Status);
  run('断言4 error 与未知事件', test4_ErrorAndUnknown);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
