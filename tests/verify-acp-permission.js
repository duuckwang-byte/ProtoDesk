'use strict';
// Phase 0 ACP 权限桥验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖 allow / deny / timeout / cancel / cancelSession / stats / 字符串决策别名。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  AcpPermissionBridge,
  DEFAULT_PERMISSION_TIMEOUT_MS
} = require('../main/acp/acp-permission-bridge');

const STAT_KEYS = ['allowed', 'cancelled', 'denied', 'pending', 'resolved', 'timedOut', 'total'];

// ---------- 断言1：allow / deny / selected 决策 ----------
async function test1_AllowDeny() {
  assert.strictEqual(DEFAULT_PERMISSION_TIMEOUT_MS, 120000, '默认权限超时应为 120 秒');

  const bridge = new AcpPermissionBridge();
  const payload = { sessionId: 'sess-1', uiSessionId: 's_1', title: '编辑 a.html' };
  const allowPromise = bridge.request(payload, 1000);
  assert.ok(allowPromise.id, 'request 应返回带 id 的 Promise');
  assert.strictEqual(payload.id, allowPromise.id, 'payload.id 应回写为请求 id');
  assert.strictEqual(bridge.stats().pending, 1, '发起后应有 1 个待决请求');
  assert.strictEqual(bridge.stats().total, 1, 'total 应为 1');

  assert.strictEqual(
    bridge.resolve(allowPromise.id, { outcome: 'allow_once' }),
    true,
    'resolve 命中待决请求应返回 true'
  );
  assert.deepStrictEqual(await allowPromise, { outcome: 'allow_once' }, 'allow 决策应原样返回');
  let st = bridge.stats();
  assert.strictEqual(st.pending, 0, 'allow 后 pending 应为 0');
  assert.strictEqual(st.resolved, 1, 'allow 后 resolved 应为 1');
  assert.strictEqual(st.allowed, 1, 'allow 后 allowed 应为 1');
  assert.deepStrictEqual(Object.keys(st).sort(), STAT_KEYS, `stats 字段不符：${JSON.stringify(st)}`);

  // 字符串别名 deny → reject_once
  const denyPromise = bridge.request({ sessionId: 'sess-1' }, 1000);
  assert.strictEqual(bridge.resolve(denyPromise.id, 'deny'), true, '字符串决策应可解析');
  assert.deepStrictEqual(await denyPromise, { outcome: 'reject_once' }, 'deny 应归一化为 reject_once');
  st = bridge.stats();
  assert.strictEqual(st.denied, 1, 'deny 后 denied 应为 1');
  assert.strictEqual(st.resolved, 2, 'deny 后 resolved 应为 2');

  // 带 optionId 的 selected 决策应原样透传
  const selPromise = bridge.request({ sessionId: 'sess-1' }, 1000);
  const selected = { outcome: 'selected', optionId: 'opt-1' };
  assert.strictEqual(bridge.resolve(selPromise.id, selected), true, 'selected 决策应可解析');
  assert.deepStrictEqual(await selPromise, selected, 'selected 决策应保持对象原样');
  assert.strictEqual(bridge.stats().allowed, 2, 'selected 应计入 allowed');
}

// ---------- 断言2：120s 默认值 + 超时返回 cancel ----------
async function test2_Timeout() {
  const bridge = new AcpPermissionBridge();
  const p = bridge.request({ sessionId: 'sess-timeout' }, 15);
  const r = await p;
  assert.deepStrictEqual(r, { outcome: 'cancel' }, '超时应返回 {outcome:cancel}');

  const st = bridge.stats();
  assert.strictEqual(st.pending, 0, '超时后 pending 应为 0');
  assert.strictEqual(st.timedOut, 1, '超时后 timedOut 应为 1');
  assert.strictEqual(st.resolved, 0, '超时不计入 resolved');
  assert.strictEqual(bridge.resolve(p.id, { outcome: 'allow_once' }), false, '超时后 resolve 应返回 false');

  // 构造参数可覆盖默认超时
  const custom = new AcpPermissionBridge({ defaultTimeoutMs: 5 });
  assert.strictEqual(custom.defaultTimeoutMs, 5, '构造参数应覆盖默认超时');
}

// ---------- 断言3：cancel / cancelSession ----------
async function test3_Cancel() {
  const bridge = new AcpPermissionBridge();
  const p = bridge.request({ sessionId: 'sess-a' }, 1000);
  assert.strictEqual(bridge.cancel(p.id), true, 'cancel 命中应返回 true');
  assert.deepStrictEqual(await p, { outcome: 'cancel' }, 'cancel 应返回 {outcome:cancel}');
  let st = bridge.stats();
  assert.strictEqual(st.cancelled, 1, 'cancel 后 cancelled 应为 1');
  assert.strictEqual(st.pending, 0, 'cancel 后 pending 应为 0');
  assert.strictEqual(bridge.cancel(p.id), false, '重复 cancel 应返回 false');

  const a1 = bridge.request({ sessionId: 'sess-x', uiSessionId: 's_x' }, 1000);
  const a2 = bridge.request({ sessionId: 'sess-x', uiSessionId: 's_x' }, 1000);
  const b1 = bridge.request({ sessionId: 'sess-y', uiSessionId: 's_y' }, 1000);
  assert.strictEqual(bridge.stats().pending, 3, '应有 3 个待决请求');

  assert.strictEqual(bridge.cancelSession('sess-x'), 2, 'cancelSession 应按 sessionId 取消 2 个');
  assert.deepStrictEqual(await a1, { outcome: 'cancel' }, 'a1 应收到 cancel');
  assert.deepStrictEqual(await a2, { outcome: 'cancel' }, 'a2 应收到 cancel');
  assert.strictEqual(bridge.stats().pending, 1, '其他会话请求应保留');

  assert.strictEqual(bridge.cancelSession('s_y'), 1, 'cancelSession 也应匹配 uiSessionId');
  assert.deepStrictEqual(await b1, { outcome: 'cancel' }, 'b1 应收到 cancel');
  assert.strictEqual(bridge.cancelSession(''), 0, '空 sessionId 不应误取消');
  assert.strictEqual(bridge.stats().cancelled, 4, 'cancelled 累计应为 4（含首个单条 cancel）');
}

// ---------- 断言4：id 生成 / 未知 id / 无 Electron 依赖 ----------
async function test4_IdentityAndPurity() {
  const bridge = new AcpPermissionBridge();
  const p1 = bridge.request({ title: 'one' }, 1000);
  const p2 = bridge.request({ title: 'two' }, 1000);
  assert.ok(p1.id && p2.id, '缺省 id 应自动生成');
  assert.notStrictEqual(p1.id, p2.id, '自动生成的 id 应唯一');

  assert.strictEqual(bridge.resolve('not-exist', { outcome: 'allow_once' }), false, '未知 id resolve 应返回 false');
  assert.strictEqual(bridge.cancel('not-exist'), false, '未知 id cancel 应返回 false');
  assert.strictEqual(bridge.stats().pending, 2, '未知 id 不应影响待决请求');

  bridge.cancel(p1.id);
  bridge.cancel(p2.id);
  assert.deepStrictEqual(await p1, { outcome: 'cancel' }, 'p1 应取消');
  assert.deepStrictEqual(await p2, { outcome: 'cancel' }, 'p2 应取消');

  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'acp', 'acp-permission-bridge.js'), 'utf8');
  assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(src), 'acp-permission-bridge 不得依赖 electron');
}

// ---------- 断言5：多 Agent 同 sessionId/uiSessionId 的复合键取消 ----------
async function test5_AgentScopedCancel() {
  const bridge = new AcpPermissionBridge();

  // 两个 Agent 共享同一 uiSessionId / sessionId（切换 Agent 但标签页不变）
  const a1 = bridge.request({ agentId: 'agent-a', sessionId: 'sess-shared', uiSessionId: 's_shared' }, 1000);
  const a2 = bridge.request({ agentId: 'agent-a', sessionId: 'sess-shared', uiSessionId: 's_shared' }, 1000);
  const b1 = bridge.request({ agentId: 'agent-b', sessionId: 'sess-shared', uiSessionId: 's_shared' }, 1000);
  const legacy = bridge.request({ sessionId: 'sess-shared', uiSessionId: 's_shared' }, 1000);

  const entryA = bridge.pending.get(a1.id);
  assert.ok(entryA, '应能读取待决 entry');
  assert.strictEqual(entryA.agentId, 'agent-a', 'pending entry 应记录 agentId');
  assert.strictEqual(entryA.sessionId, 'sess-shared', 'pending entry 应记录 sessionId');
  assert.strictEqual(entryA.uiSessionId, 's_shared', 'pending entry 应记录 uiSessionId');

  // 传 agentId：只取消同 Agent 的请求，同会话其他 Agent / 无 Agent 请求保留
  assert.strictEqual(bridge.cancelSession('s_shared', 'agent-a'), 2, '复合键应只取消 agent-a 的 2 个请求');
  assert.deepStrictEqual(await a1, { outcome: 'cancel' }, 'a1 应取消');
  assert.deepStrictEqual(await a2, { outcome: 'cancel' }, 'a2 应取消');
  assert.strictEqual(bridge.stats().pending, 2, '其他 Agent / 旧请求应保留');

  // Agent 不匹配或 sessionId 为空时不应误杀
  assert.strictEqual(bridge.cancelSession('sess-shared', 'agent-c'), 0, '其他 agentId 不应命中');
  assert.strictEqual(bridge.cancelSession('', 'agent-a'), 0, '空 sessionId 不应命中');

  // cancelAgent：不带 sessionId 时清空该 Agent 全部请求
  assert.strictEqual(bridge.cancelAgent('agent-b'), 1, 'cancelAgent 应取消 agent-b 的请求');
  assert.deepStrictEqual(await b1, { outcome: 'cancel' }, 'b1 应取消');
  assert.strictEqual(bridge.stats().pending, 1, '仅剩无 agentId 的旧请求');

  // cancelAgent 带 sessionId：只清该会话
  const c1 = bridge.request({ agentId: 'agent-b', sessionId: 'sess-1' }, 1000);
  const c2 = bridge.request({ agentId: 'agent-b', sessionId: 'sess-2' }, 1000);
  assert.strictEqual(bridge.cancelAgent('agent-b', 'sess-1'), 1, 'cancelAgent 带 sessionId 应只取消同会话');
  assert.deepStrictEqual(await c1, { outcome: 'cancel' }, 'c1 应取消');
  assert.strictEqual(bridge.stats().pending, 2, 'c2 与旧请求应保留');
  assert.strictEqual(bridge.cancelAgent('agent-b'), 1, 'cancelAgent 不带 sessionId 应清空 agent-b');
  assert.deepStrictEqual(await c2, { outcome: 'cancel' }, 'c2 应取消');

  // 旧调用兼容：不传 agentId 时按 sessionId/uiSessionId 全量匹配
  assert.strictEqual(bridge.cancelSession('sess-shared'), 1, '旧调用应继续取消无 agentId 的请求');
  assert.deepStrictEqual(await legacy, { outcome: 'cancel' }, 'legacy 请求应取消');
  assert.strictEqual(bridge.stats().pending, 0, '全部请求应清理');
  assert.strictEqual(bridge.cancelAgent(''), 0, '空 agentId 不应误取消');
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

  await run('断言1 allow/deny/selected 决策', test1_AllowDeny);
  await run('断言2 超时返回 cancel', test2_Timeout);
  await run('断言3 cancel/cancelSession', test3_Cancel);
  await run('断言4 id 生成与未知 id', test4_IdentityAndPurity);
  await run('断言5 多 Agent 复合键取消', test5_AgentScopedCancel);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
