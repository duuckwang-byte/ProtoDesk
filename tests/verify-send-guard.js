'use strict';
// send-guard: PlanD 大模型对话框发送守卫回归（纯 Node，不启动 Electron）
// 根因：aiDoSend 曾调用零定义的 aiOidDirOk，有缓存 oid 时抛 ReferenceError，
// 且输入框清空在校验之前，导致“清空输入框但无气泡无发送”的静默死亡。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'project-ai-export.js'), 'utf8');

console.log('=== send-guard 回归测试 ===');

// (a) 源码含 aiOidDirOk 定义，且行为为非空 true / 空值 false
{
  const defRe = /function aiOidDirOk\(oid\)\{[^}]*\}/;
  const m = SRC.match(defRe);
  assert.ok(m, '源码必须包含 function aiOidDirOk(oid) 定义');
  const fn = new Function(m[0] + '; return aiOidDirOk;')();
  assert.strictEqual(typeof fn, 'function', 'aiOidDirOk 必须可求值出函数');
  assert.strictEqual(fn('ses_f8060dae5ffe2A02LyR1Kds4ci'), true, '非空 oid 应判 true');
  assert.strictEqual(fn('s_1741411234567_xyz'), true, '前端 tab id 形态的非空串亦判 true（非空即有效）');
  assert.strictEqual(fn(''), false, '空串应判 false');
  assert.strictEqual(fn('   '), false, '空白串应判 false');
  assert.strictEqual(fn(null), false, 'null 应判 false');
  assert.strictEqual(fn(undefined), false, 'undefined 应判 false');
  assert.strictEqual(fn(123), false, '非字符串应判 false');
  console.log('[PASS] (a) aiOidDirOk 定义存在且真值表正确');
}

// (b) 静态断言：aiDoSend 中 value='' 出现在 if(!s)return 之后
{
  const start = SRC.indexOf('function aiDoSend');
  assert.ok(start !== -1, '必须找到 function aiDoSend');
  const end = SRC.indexOf('\nfunction ', start + 1);
  const body = end === -1 ? SRC.slice(start) : SRC.slice(start, end);
  const guardMarker = 'if(!s)return';
  const clearMarker = "aiInputEl)aiInputEl.value=''";
  const busyMarker = 'if(aiBusy)';
  const iGuard = body.indexOf(guardMarker);
  const iClear = body.indexOf(clearMarker);
  const iBusy = body.indexOf(busyMarker);
  assert.ok(iGuard !== -1, 'aiDoSend 内必须有 if(!s)return 会话就绪守卫');
  assert.ok(iClear !== -1, 'aiDoSend 内必须有输入框清空语句');
  assert.ok(iBusy !== -1, 'aiDoSend 内必须保留 aiBusy 分支');
  assert.ok(iClear > iGuard, '输入框清空必须在 if(!s)return 之后（会话就绪、push 前）');
  assert.ok(iBusy < iClear, 'aiBusy 早退必须在清空之前（busy 时保留输入框）');
  // 防御校验本身也必须在清空之前：异常永不吞用户输入
  const iOidGuard = body.indexOf('aiOidDirOk(aiSession.oid)');
  assert.ok(iOidGuard !== -1, 'aiDoSend 内必须保留 oid 防御校验');
  assert.ok(iOidGuard < iClear, 'oid 防御校验必须在清空之前');
  console.log('[PASS] (b) 输入框清空位于 if(!s)return 之后，busy 分支保留输入');
}

// (c) 语义仿真：有 oid / 无 oid 两路均走完校验不抛错
{
  const fn = new Function(SRC.match(/function aiOidDirOk\(oid\)\{[^}]*\}/)[0] + '; return aiOidDirOk;')();
  function runGuard(oid) {
    var aiSession = { oid: oid };
    var saved = 0;
    function aiSaveSesh() { saved++; }
    if (aiSession && aiSession.oid && !fn(aiSession.oid)) { aiSession.oid = ''; aiSaveSesh(); }
    return aiSession;
  }
  // 有 oid：非空即有效，原样保留，不抛错
  assert.doesNotThrow(() => {
    const s = runGuard('ses_f8060dae5ffe2A02LyR1Kds4ci');
    assert.strictEqual(s.oid, 'ses_f8060dae5ffe2A02LyR1Kds4ci', '有效 oid 不应被清空');
  }, '有 oid 路径不应抛错');
  // 无 oid：空串直接跳过校验，不抛错
  assert.doesNotThrow(() => {
    const s = runGuard('');
    assert.strictEqual(s.oid, '', '空 oid 保持为空');
  }, '无 oid 路径不应抛错');
  // 空白 oid：判 false，被 healed 清空，不抛错
  assert.doesNotThrow(() => {
    const s = runGuard('   ');
    assert.strictEqual(s.oid, '', '空白 oid 应被 healed 为空串');
  }, '空白 oid 路径不应抛错');
  // 发送顺序仿真：校验异常也不吞输入（清空在守卫之后）
  function runSendOrder(s, input) {
    var box = { value: input };
    if (!s) return { kept: box.value, cleared: false };
    box.value = '';
    return { kept: box.value, cleared: true };
  }
  assert.strictEqual(runSendOrder(null, 'hello').kept, 'hello', '会话未就绪时输入必须保留');
  assert.strictEqual(runSendOrder({ id: 's_1' }, 'hello').cleared, true, '会话就绪时才清空输入');
  console.log('[PASS] (c) 有 oid / 无 oid 双路仿真均无异常，会话未就绪不吞输入');
}

console.log('=== send-guard 全部断言通过 (3/3 PASS) ===');
