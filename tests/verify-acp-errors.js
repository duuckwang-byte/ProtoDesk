'use strict';
// Phase 0 ACP 错误归一化验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖 9 个约定错误码、嵌套 code 提取、文本扫描、未知错误通用回落。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeAcpError, ACP_ERROR_CODES } = require('../main/acp/acp-errors');

const CASES = [
  ['ACP_BACKEND_MISSING', 'install', false],
  ['ACP_BACKEND_UNAVAILABLE', 'retry', true],
  ['ACP_SESSION_INIT_FAILED', 'reset_session', true],
  ['ACP_TURN_FAILED', 'retry', true],
  ['PERMISSION_DENIED', 'retry', true],
  ['PERMISSION_PROMPT_UNAVAILABLE', 'switch', false],
  ['ACP_MODEL_UNSUPPORTED', 'switch', false],
  ['TIMEOUT', 'retry', true],
  ['AUTH_REQUIRED', 'login', false]
];

const RESULT_KEYS = ['action', 'code', 'message', 'retryable', 'title'];

// ---------- 断言1：9 个错误码逐一映射 ----------
function test1_MappedCodes() {
  assert.strictEqual(ACP_ERROR_CODES.length, 9, '应暴露 9 个已知错误码');

  for (const [code, action, retryable] of CASES) {
    const r = normalizeAcpError({ code });
    assert.strictEqual(r.code, code, `${code} 应原样返回`);
    assert.strictEqual(r.action, action, `${code}.action 应为 ${action}，实际 ${r.action}`);
    assert.strictEqual(r.retryable, retryable, `${code}.retryable 应为 ${retryable}`);
    assert.ok(String(r.title).length > 0, `${code}.title 不应为空`);
    assert.ok(String(r.message).length > 0, `${code}.message 不应为空`);
    assert.notStrictEqual(r.title, 'ACP 调用失败', `${code} 不应落入通用文案`);
    assert.deepStrictEqual(Object.keys(r).sort(), RESULT_KEYS, `${code} 返回结构不符：${JSON.stringify(r)}`);
  }

  // 文案抽查：可操作提示必须能指导用户
  assert.ok(normalizeAcpError({ code: 'AUTH_REQUIRED' }).message.includes('登录'), 'AUTH_REQUIRED 应提示登录');
  assert.ok(normalizeAcpError({ code: 'TIMEOUT' }).message.includes('超时'), 'TIMEOUT 应提示超时');
  assert.ok(
    normalizeAcpError({ code: 'PERMISSION_PROMPT_UNAVAILABLE' }).message.includes('切换 Agent'),
    'PERMISSION_PROMPT_UNAVAILABLE 应提示切换 Agent'
  );
  assert.ok(
    normalizeAcpError({ code: 'ACP_MODEL_UNSUPPORTED' }).message.includes('当前模型不被该 Agent 支持'),
    'ACP_MODEL_UNSUPPORTED 应提示模型不被支持'
  );
  const missing = normalizeAcpError({ code: 'ACP_BACKEND_MISSING' });
  assert.ok(missing.title.includes('启动失败') && missing.title.includes('未找到'), 'ACP_BACKEND_MISSING 文案应覆盖启动失败/未找到');
  assert.ok(missing.message.includes('未找到命令'), 'ACP_BACKEND_MISSING 应提示未找到命令');
}

// ---------- 断言2：错误码提取（code / 文本 / 嵌套 cause/data/error） ----------
function test2_CodeExtraction() {
  // Error 对象上的 code
  const e1 = new Error('failed');
  e1.code = 'ACP_BACKEND_UNAVAILABLE';
  assert.strictEqual(normalizeAcpError(e1).code, 'ACP_BACKEND_UNAVAILABLE', 'err.code 应被提取');

  // 错误文本中的 code
  const e2 = new Error('AcpRuntimeError: ACP_SESSION_INIT_FAILED: initialize timeout');
  assert.strictEqual(normalizeAcpError(e2).code, 'ACP_SESSION_INIT_FAILED', '错误文本中的 code 应被提取');

  // 纯字符串
  assert.strictEqual(normalizeAcpError('PERMISSION_DENIED: user rejected').code, 'PERMISSION_DENIED', '字符串错误应可解析');

  // 嵌套 cause / data / error
  assert.strictEqual(
    normalizeAcpError({ message: 'outer', cause: { code: 'TIMEOUT' } }).code,
    'TIMEOUT',
    'cause.code 应被提取'
  );
  assert.strictEqual(
    normalizeAcpError({ data: { code: 'ACP_TURN_FAILED' } }).code,
    'ACP_TURN_FAILED',
    'data.code 应被提取'
  );
  assert.strictEqual(
    normalizeAcpError({ error: { code: 'PERMISSION_PROMPT_UNAVAILABLE' } }).code,
    'PERMISSION_PROMPT_UNAVAILABLE',
    'error.code 应被提取'
  );

  // 新增模型不支持码：顶层 / cause / error 三种来源都应识别
  assert.strictEqual(
    normalizeAcpError({ code: 'ACP_MODEL_UNSUPPORTED' }).code,
    'ACP_MODEL_UNSUPPORTED',
    'ACP_MODEL_UNSUPPORTED 应可从 err.code 提取'
  );
  assert.strictEqual(
    normalizeAcpError({ message: 'outer', cause: { code: 'ACP_MODEL_UNSUPPORTED' } }).code,
    'ACP_MODEL_UNSUPPORTED',
    'ACP_MODEL_UNSUPPORTED 应可从 cause.code 提取'
  );
  assert.strictEqual(
    normalizeAcpError({ error: { code: 'ACP_MODEL_UNSUPPORTED' } }).code,
    'ACP_MODEL_UNSUPPORTED',
    'ACP_MODEL_UNSUPPORTED 应可从 error.code 提取'
  );

  // 小写 code 应归一化为大写
  assert.strictEqual(normalizeAcpError({ code: 'timeout' }).code, 'TIMEOUT', '小写 code 应归一化');

  // detailCode：外壳 ACP_SESSION_INIT_FAILED + 根因 spawn 错误时，应还原为后端缺失
  assert.strictEqual(
    normalizeAcpError({ code: 'ACP_SESSION_INIT_FAILED', detailCode: 'AGENT_SPAWN_ENOENT' }).code,
    'ACP_BACKEND_MISSING',
    'detailCode 应优先于外层壳码'
  );
  assert.strictEqual(
    normalizeAcpError({ code: 'ACP_SESSION_INIT_FAILED', cause: { detailCode: 'AGENT_SPAWN_FAILED' } }).code,
    'ACP_BACKEND_MISSING',
    'cause.detailCode 应被提取并映射'
  );

  // 底层进程码：顶层 / cause / 文本三种来源
  assert.strictEqual(normalizeAcpError({ code: 'ENOENT' }).code, 'ACP_BACKEND_MISSING', 'ENOENT 应映射为后端缺失');
  assert.strictEqual(
    normalizeAcpError({ code: 'ACP_SESSION_INIT_FAILED', cause: { code: 'ENOENT' } }).code,
    'ACP_BACKEND_MISSING',
    'cause.code=ENOENT 应优先于外层壳码'
  );
  assert.strictEqual(
    normalizeAcpError({ code: 'ACP_SESSION_INIT_FAILED', cause: { code: 'AGENT_SPAWN_FAILED' } }).code,
    'ACP_BACKEND_MISSING',
    'AGENT_SPAWN_FAILED 应映射为后端缺失'
  );
  assert.strictEqual(
    normalizeAcpError(new Error('spawn C:\\Users\\allow\\AppData\\Local\\agy\\bin\\agy.exe ENOENT')).code,
    'ACP_BACKEND_MISSING',
    'spawn 上下文中的文本 ENOENT 应映射为后端缺失'
  );
  assert.strictEqual(
    normalizeAcpError('AGENT_SPAWN_ENOENT: agy').code,
    'ACP_BACKEND_MISSING',
    '字符串 AGENT_SPAWN_ENOENT 应映射为后端缺失'
  );

  // 非 spawn 的文件操作 ENOENT（如会话目录 rename）不得误报为未安装 Agent
  assert.strictEqual(
    normalizeAcpError(new Error('ACP_SESSION_INIT_FAILED: rename session dir ENOENT')).code,
    'ACP_SESSION_INIT_FAILED',
    'rename ENOENT 不应误报为后端缺失'
  );
}

// ---------- 断言3：未知错误通用回落 ----------
function test3_UnknownFallback() {
  const r = normalizeAcpError(new Error('some random backend explosion'));
  assert.strictEqual(r.code, 'ACP_UNKNOWN', '未知错误 code 应为 ACP_UNKNOWN');
  assert.strictEqual(r.title, 'ACP 调用失败', '未知错误 title 应为通用文案');
  assert.strictEqual(r.action, 'retry', '未知错误应可重试');
  assert.strictEqual(r.retryable, true, '未知错误 retryable 应为 true');
  assert.ok(String(r.message).length > 0, '未知错误 message 不应为空');
  assert.ok(!String(r.message).includes('random backend explosion'), '未知错误 message 不应直接暴露原始异常');

  for (const input of [null, undefined, {}, 0]) {
    const u = normalizeAcpError(input);
    assert.strictEqual(u.code, 'ACP_UNKNOWN', `输入 ${String(input)} 应回落 ACP_UNKNOWN`);
    assert.ok(u.title && u.message, '回落文案不应为空');
  }

  // 本模块必须保持纯 Node 可测
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'acp', 'acp-errors.js'), 'utf8');
  assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(src), 'acp-errors 不得依赖 electron');
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

  run('断言1 9 个错误码映射', test1_MappedCodes);
  run('断言2 错误码提取', test2_CodeExtraction);
  run('断言3 未知错误回落', test3_UnknownFallback);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
