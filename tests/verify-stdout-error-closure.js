const assert = require('assert');
const path = require('path');
const { createJsonEventStreamParser } = require('../runtimes/parsers/json-event-stream');
const { classifyExecutionError } = require('../runtimes/diagnostics');
const opencodeDef = require('../runtimes/defs/opencode');

console.log('=== 开始执行 stdout 错误闭环与模型清洗验证测试 ===');

// 断言 1: 解析器 getPendingError 正常捕获 stdout JSON 错误
const parser = createJsonEventStreamParser('opencode');
const rawErrorEvent = JSON.stringify({
  type: 'error',
  timestamp: Date.now(),
  error: {
    name: 'UnknownError',
    data: { message: 'Unexpected server error. Check server logs for details.' }
  }
}) + '\n';
parser.push(rawErrorEvent, {});
parser.flush({});
assert.strictEqual(parser.hasEmittedContent(), false, '未发生正文吐字');
const pending = parser.getPendingError();
assert.ok(pending && pending.data && pending.data.message.includes('Unexpected server error'), '成功捕获 pendingError');
console.log('[PASS] 断言 1: 解析器 getPendingError 结构化捕获通过');

// 断言 2: 诊断器精准识别服务端异常并输出 MODEL_UNAVAILABLE 分类
const diag = classifyExecutionError(pending.data.message, 1, opencodeDef);
assert.strictEqual(diag.code, 'MODEL_UNAVAILABLE', '精准分类为 MODEL_UNAVAILABLE');
assert.strictEqual(diag.action, 'switch_model', '建议动作指定为 switch_model');
assert.ok(!diag.message.includes('进程异常退出，请检查本地环境。'), '成功告别黑盒掩码文案');
console.log('[PASS] 断言 2: 诊断器精准识别分类与友好动作建议通过');

// 断言 3: free 独立模型原样透传（不再剥离后缀，由服务商做免费路由）
const argsWithFree = opencodeDef.buildArgs('hi', [], [], { model: 'opencode/deepseek-v4-flash-free' }, {});
const modelIdx = argsWithFree.indexOf('-m');
assert.ok(modelIdx !== -1, '包含 -m 参数');
assert.strictEqual(argsWithFree[modelIdx + 1], 'opencode/deepseek-v4-flash-free', 'free后缀须原样透传');
console.log('[PASS] 断言 3: free模型参数原样透传通过');

// 断言 4: default 模型缺省不追加 -m 参数
const argsDefault = opencodeDef.buildArgs('hi', [], [], { model: 'default' }, {});
assert.strictEqual(argsDefault.includes('-m'), false, 'default 模型坚决不追加 -m');
console.log('[PASS] 断言 4: default 模型避让规则通过');

// 断言 5: Insufficient balance 精准识别分类为 QUOTA_EXHAUSTED
const balanceDiag = classifyExecutionError('Insufficient balance. Manage your billing here: https://opencode.ai/billing', 1, opencodeDef);
assert.strictEqual(balanceDiag.code, 'QUOTA_EXHAUSTED', '精准分类为 QUOTA_EXHAUSTED');
assert.strictEqual(balanceDiag.action, 'switch_model', '建议动作指定为 switch_model');
console.log('[PASS] 断言 5: Insufficient balance 余额不足精准分类通过');

console.log('\n=== 全部 5 项 stdout 错误闭环与模型清洗断言通过 (5/5 PASS) ===');
