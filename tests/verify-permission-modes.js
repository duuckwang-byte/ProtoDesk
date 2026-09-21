'use strict';
// options.permissionMode 档位验证（纯 Node，无 Electron 依赖，CommonJS）
// 约定：缺省（未传/非字符串/空/空白）即现状逐字一致；仅显式非空才改变 argv。
// 覆盖：claude / codebuddy / antigravity(agy) / qoder 四家 def.buildArgs。
const assert = require('node:assert');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const claudeDef = require(path.join(rootDir, 'runtimes', 'defs', 'claude'));
const codebuddyDef = require(path.join(rootDir, 'runtimes', 'defs', 'codebuddy'));
const agyDef = require(path.join(rootDir, 'runtimes', 'defs', 'antigravity'));
const qoderDef = require(path.join(rootDir, 'runtimes', 'defs', 'qoder'));

// ---------- 断言1：缺省行为与现状逐字一致 ----------
function test1_DefaultSnapshots() {
  // claude 现状：--permission-mode bypassPermissions 在 --verbose 后、--model/--resume 前
  assert.deepStrictEqual(
    claudeDef.buildArgs('hi', [], [], {}, {}),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions']
  );
  assert.deepStrictEqual(
    claudeDef.buildArgs('hi', [], [], { model: 'm1' }, {}),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--model', 'm1']
  );
  assert.deepStrictEqual(
    claudeDef.buildArgs('hi', [], [], {}, { resumeSessionId: 's1' }),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--resume', 's1']
  );
  // codebuddy 现状：--permission-mode bypassPermissions 在末尾（--model/--resume 后）
  assert.deepStrictEqual(
    codebuddyDef.buildArgs('hi', [], [], {}, {}),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions']
  );
  assert.deepStrictEqual(
    codebuddyDef.buildArgs('hi', [], [], { model: 'm1' }, {}),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'm1', '--permission-mode', 'bypassPermissions']
  );
  assert.deepStrictEqual(
    codebuddyDef.buildArgs('hi', [], [], {}, { resumeSessionId: 's1' }),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', 's1', '--permission-mode', 'bypassPermissions']
  );
  // agy 现状：首位 --dangerously-skip-permissions，后接 --model/--effort --output-format stream-json -p
  assert.deepStrictEqual(
    agyDef.buildArgs('hi', [], [], {}),
    ['--dangerously-skip-permissions', '--output-format', 'stream-json', '-p', 'hi']
  );
  assert.deepStrictEqual(
    agyDef.buildArgs('hi', [], [], { model: 'default' }),
    ['--dangerously-skip-permissions', '--output-format', 'stream-json', '-p', 'hi']
  );
  assert.deepStrictEqual(
    agyDef.buildArgs('hello', [], [], { model: 'gemini-3.8-flash-high', reasoning: 'high' }),
    ['--dangerously-skip-permissions', '--model', 'gemini-3.8-flash-high', '--effort', 'high', '--output-format', 'stream-json', '-p', 'hello']
  );
  // qoder 现状（工厂 model-cwd）：-p --output-format stream-json --yolo（+ -w/--model）
  assert.deepStrictEqual(
    qoderDef.buildArgs('hi', [], [], {}, {}),
    ['-p', '--output-format', 'stream-json', '--yolo']
  );
  assert.deepStrictEqual(
    qoderDef.buildArgs('hi', [], [], { model: 'auto' }, { cwd: 'C:/proj' }),
    ['-p', '--output-format', 'stream-json', '--yolo', '-w', 'C:/proj', '--model', 'auto']
  );
  // 缺省的多种写法（未传 options / 空对象 / 空串 / 空白 / 非字符串）都须等同现状
  assert.deepStrictEqual(claudeDef.buildArgs('hi', [], [], undefined, {}), claudeDef.buildArgs('hi', [], [], {}, {}), 'claude undefined options 应等同现状');
  assert.deepStrictEqual(claudeDef.buildArgs('hi', [], [], { permissionMode: '' }, {}), claudeDef.buildArgs('hi', [], [], {}, {}), 'claude 空串应等同现状');
  assert.deepStrictEqual(claudeDef.buildArgs('hi', [], [], { permissionMode: '   ' }, {}), claudeDef.buildArgs('hi', [], [], {}, {}), 'claude 空白应等同现状');
  assert.deepStrictEqual(codebuddyDef.buildArgs('hi', [], [], { permissionMode: '' }, {}), codebuddyDef.buildArgs('hi', [], [], {}, {}), 'codebuddy 空串应等同现状');
  assert.deepStrictEqual(agyDef.buildArgs('hi', [], [], { permissionMode: '' }), agyDef.buildArgs('hi', [], [], {}), 'agy 空串应等同现状');
  assert.deepStrictEqual(agyDef.buildArgs('hi', [], [], undefined), agyDef.buildArgs('hi', [], [], {}), 'agy undefined 应等同现状');
  assert.deepStrictEqual(qoderDef.buildArgs('hi', [], [], {}, {}), ['-p', '--output-format', 'stream-json', '--yolo'], 'qoder 空对象应等同现状');
  assert.deepStrictEqual(qoderDef.buildArgs('hi', [], [], { permissionMode: '' }, {}), qoderDef.buildArgs('hi', [], [], {}, {}), 'qoder 空串应等同现状');
  assert.deepStrictEqual(qoderDef.buildArgs('hi', [], [], { permissionMode: '  ' }, {}), qoderDef.buildArgs('hi', [], [], {}, {}), 'qoder 空白应等同现状');
  assert.deepStrictEqual(qoderDef.buildArgs('hi', [], [], undefined, {}), qoderDef.buildArgs('hi', [], [], {}, {}), 'qoder undefined 应等同现状');
}

// ---------- 断言2：显式传入时 argv 变化符合预期 ----------
function test2_ExplicitModes() {
  // claude：原位替代 bypassPermissions，顺序不动
  assert.deepStrictEqual(
    claudeDef.buildArgs('hi', [], [], { permissionMode: 'acceptEdits' }, {}),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits']
  );
  assert.deepStrictEqual(
    claudeDef.buildArgs('hi', [], [], { model: 'm1', permissionMode: 'plan' }, { resumeSessionId: 's1' }),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan', '--model', 'm1', '--resume', 's1']
  );
  // codebuddy：末尾原位替代，--model/--resume 不动
  assert.deepStrictEqual(
    codebuddyDef.buildArgs('hi', [], [], { permissionMode: 'plan' }, {}),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan']
  );
  assert.deepStrictEqual(
    codebuddyDef.buildArgs('hi', [], [], { model: 'm1', permissionMode: 'acceptEdits' }, { resumeSessionId: 's1' }),
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'm1', '--resume', 's1', '--permission-mode', 'acceptEdits']
  );
  // agy：仅 'plan' 替换首部 --dangerously-skip-permissions → --mode plan，其余顺序不动
  assert.deepStrictEqual(
    agyDef.buildArgs('hi', [], [], { permissionMode: 'plan' }),
    ['--mode', 'plan', '--output-format', 'stream-json', '-p', 'hi']
  );
  assert.deepStrictEqual(
    agyDef.buildArgs('hello', [], [], { model: 'gemini-3.8-flash-high', reasoning: 'high', permissionMode: 'plan' }),
    ['--mode', 'plan', '--model', 'gemini-3.8-flash-high', '--effort', 'high', '--output-format', 'stream-json', '-p', 'hello']
  );
  // agy 非 plan 显式值暂保持现状（本轮仅映射 plan）
  assert.deepStrictEqual(
    agyDef.buildArgs('hi', [], [], { permissionMode: 'accept-edits' }),
    ['--dangerously-skip-permissions', '--output-format', 'stream-json', '-p', 'hi']
  );
  // qoder：追加 --permission-mode <值>，默认 --yolo/-w/--model 不动
  assert.deepStrictEqual(
    qoderDef.buildArgs('hi', [], [], { permissionMode: 'accept_edits' }, {}),
    ['-p', '--output-format', 'stream-json', '--yolo', '--permission-mode', 'accept_edits']
  );
  assert.deepStrictEqual(
    qoderDef.buildArgs('hi', [], [], { model: 'auto', permissionMode: 'accept_edits' }, { cwd: 'C:/proj' }),
    ['-p', '--output-format', 'stream-json', '--yolo', '-w', 'C:/proj', '--model', 'auto', '--permission-mode', 'accept_edits']
  );
  // qoder 显式值须保留 --yolo（非替换）
  const qArgs = qoderDef.buildArgs('hi', [], [], { permissionMode: 'dont_ask' }, {});
  assert.ok(qArgs.includes('--yolo'), `qoder 显式档须保留 --yolo，实际 ${JSON.stringify(qArgs)}`);
  assert.ok(!qoderDef.buildArgs('hi', [], [], {}, {}).includes('--permission-mode'), 'qoder 缺省不得含 --permission-mode');
  // claude/codebuddy 显式后不得残留 bypassPermissions
  assert.ok(!claudeDef.buildArgs('hi', [], [], { permissionMode: 'plan' }, {}).includes('bypassPermissions'), 'claude 显式后不得残留 bypassPermissions');
  assert.ok(!codebuddyDef.buildArgs('hi', [], [], { permissionMode: 'plan' }, {}).includes('bypassPermissions'), 'codebuddy 显式后不得残留 bypassPermissions');
  // agy plan 后不得残留 --dangerously-skip-permissions
  assert.ok(!agyDef.buildArgs('hi', [], [], { permissionMode: 'plan' }).includes('--dangerously-skip-permissions'), 'agy plan 后不得残留 --dangerously-skip-permissions');
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
  await run('缺省行为与现状逐字一致', test1_DefaultSnapshots);
  await run('显式传入时 argv 变化符合预期', test2_ExplicitModes);
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
