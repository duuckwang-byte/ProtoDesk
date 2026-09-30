'use strict';
// question-form 提示词契约校验（子任务A 产出，纯 Node 可跑：node tests/verify-question-contract.js）
// 目标：断言 toolPrompt.md 第六节含关键句；兼顾第五节不断链（已有门禁 task-wiring / ui-specs 的真相源）。
// 不碰 tests/run-all.js（属子任务B）。
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

var rootDir = path.resolve(__dirname, '..');
var tpPath = path.join(rootDir, 'toolPrompt.md');
var tpText = fs.readFileSync(tpPath, 'utf8');

var secIdx = tpText.indexOf('## 六');
assert.ok(secIdx >= 0, 'toolPrompt 缺第六节标题（## 六）');
var sec6 = tpText.slice(secIdx);

// 关键句（与任务书一一对应，含 contiguous 短语以防分词断言漂移）
var mustContain = [
  '不准调提问类工具',
  '停住本轮',
  'ask-question',
  'radio/text',
  '无人值守默认',
  'question-form',
  'recommended',
  '默认选中'
];
mustContain.forEach(function (s) {
  assert.ok(sec6.indexOf(s) >= 0, '第六节缺关键句：' + s);
});

// 任务书第1条细则：字段与推荐写法、后台反话
assert.ok(sec6.indexOf('id') >= 0 && sec6.indexOf('options') >= 0 && sec6.indexOf('required') >= 0, '第六节须列出 id/options/required 字段');
assert.ok(sec6.indexOf('（推荐）') >= 0, '第六节须写明 label 后缀（推荐）');
assert.ok(sec6.indexOf('按合理默认完成') >= 0, '第六节须写明无人值守按合理默认完成');
assert.ok(sec6.indexOf('不写文件不调工具') >= 0, '第六节须写明停住本轮不写文件不调工具');

// 第五节真相源不断链（verify-task-wiring / verify-ui-specs 依赖）
assert.ok(tpText.indexOf('命中表内触发关键词') >= 0, '第五节“命中表内触发关键词”不得被破坏');
assert.ok(tpText.indexOf('可跳过不读') >= 0, '第五节“可跳过不读”不得被破坏');
assert.ok(tpText.indexOf('以用户需求为准') >= 0, '第五节“以用户需求为准”不得被破坏');

// 样本文件基础形状（只读不断言业务，仅防 B/C 引用时缺键）
var samples = require(path.join(rootDir, 'tests', 'cases', 'question-form-samples.js'));
var keys = ['FLAT_QUESTION_EVENT', 'TOOL_USE_WRAPPED', 'FALSE_POSITIVE_SURVEY_DATA', 'FALSE_POSITIVE_DOC_EXAMPLE', 'FRAGMENT_PART1', 'FRAGMENT_PART2'];
keys.forEach(function (k) {
  assert.ok(typeof samples[k] === 'string' && samples[k].length > 0, '样本缺字符串键：' + k);
});
assert.strictEqual(samples.FRAGMENT_PART1 + samples.FRAGMENT_PART2, samples.CANONICAL_FORM_BLOCK, '分片两段拼完须等于完整块');
assert.ok(samples.CANONICAL_FORM_BLOCK.indexOf('</question-form>') >= 0, '完整块须闭合');

console.log('[PASS] toolPrompt 第六节关键句齐全（' + mustContain.length + ' 项）');
console.log('[PASS] 第五节真相源未破坏 + 样本 4 类齐全（扁平/tool_use/误伤 x2/分片 x2）');
console.log('QUESTION_CONTRACT_PASS: 提示词契约与录制样本全绿');
