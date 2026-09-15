'use strict';
// snapshot-restore: 快照恢复静默失败回归（纯 Node，不启动 Electron）
// 根因：snapshot:restore 首行引用已删除的旧变量 aiChild（全仓库零定义），读即 ReferenceError；
// 且前端 restore().then 无 .catch，rejection 被无声吞掉。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainSrc = (() => {
  // Wave-B兼容：主进程已拆为 main.js + main/controllers + main/services，聚合后断言
  const files = [path.join(__dirname, '..', 'main.js')];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(__dirname, '..', 'main'));
  return files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }).join('\n');
})();
const frontSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'project-ai-export.js'), 'utf8');

console.log('=== snapshot-restore 回归测试 ===');

// (a) main.js 无 aiChild 引用（幽灵变量清零，读即 ReferenceError 的根源）
{
  const hits = mainSrc.match(/\baiChild\b/g) || [];
  assert.strictEqual(hits.length, 0, 'main.js 不应再引用已删除的 aiChild，实际命中 ' + hits.length + ' 处');
  console.log('[PASS] (a) main.js 无 aiChild 引用');
}

// (b) snapshot:restore 含 activeExecution 守卫，失败返回保持原文案
// Wave-B：通道注册在 controller，实现在 service（shared.activeExecution），聚合后分开断言
{
  assert.ok(mainSrc.includes("ipcMain.handle('snapshot:restore'"), '必须找到 snapshot:restore 通道注册');
  assert.ok(mainSrc.includes("shared.activeExecution") || mainSrc.includes("activeExecution"), 'snapshot:restore 必须含 activeExecution 守卫');
  assert.ok(mainSrc.includes('AI 正在生成中，请先停止再恢复历史版本'), '忙时拒绝文案必须保持不变');
  assert.ok(mainSrc.includes("if (!/^\\d{8}-\\d{6}$/.test(ts))"), '非法 ts 参数校验必须保留（修复后可达）');
  console.log('[PASS] (b) snapshot:restore 含 activeExecution 守卫且参数校验可达');
}

// (c) 前端 restore 调用含 .catch，失败走 reportError('snapshot-restore', ...)
{
  const marker = 'window.protoAPI.snapshot.restore(';
  const i = frontSrc.indexOf(marker);
  assert.ok(i !== -1, '必须找到前端 snapshot.restore 调用');
  const seg = frontSrc.slice(i, i + 800);
  assert.ok(/\.catch\s*\(\s*function\s*\(\s*e\s*\)/.test(seg), 'restore 调用后必须追加 .catch');
  assert.ok(seg.includes("reportError('snapshot-restore'"), '.catch 内必须走 reportError(snapshot-restore)');
  console.log('[PASS] (c) 前端 restore 调用含 .catch 且上报 snapshot-restore');
}

console.log('=== snapshot-restore 全部断言通过 (3/3 PASS) ===');
