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
const svcSrc = fs.readFileSync(path.join(__dirname, '..', 'main', 'services', 'sandbox-storage-service.js'), 'utf8');

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

// (d) 快照复制不得再直接调用 fs.cpSync（Electron37/Node22 中文路径 EPERM 运行时缺陷）
{
  assert.ok(!/fs\.cpSync\s*\(/.test(svcSrc), '快照服务不得再直接调用 fs.cpSync');
  assert.ok(/function\s+copyDirRecursive\s*\(/.test(svcSrc), '须提供 readdir + mkdir + copyFile 的递归复制实现');
  assert.ok(svcSrc.includes('fs.readdirSync(winFsPath(srcDir), { withFileTypes: true })'), '递归复制须用 readdir withFileTypes');
  assert.ok(svcSrc.includes('fs.copyFileSync(winFsPath(from), winFsPath(to))'), '单文件复制须用 copyFileSync');
  assert.ok(svcSrc.includes('copyDirRecursive(dn, dst)'), 'takeSnapshot 须走兼容复制实现');
  console.log('[PASS] (d) 快照/恢复不再依赖 fs.cpSync，改用逐文件递归复制');
}

// (e) 恢复流程：undo 备份失败明确中止；暂存 + 回滚保证失败不破坏当前文件
{
  assert.ok(svcSrc.includes('恢复前备份失败，已中止（当前文件未改动）'), 'undo 备份失败须明确报错并说明未改动');
  assert.ok(svcSrc.includes("'.restore-staging-'"), '恢复须先复制到同级暂存目录');
  assert.ok(svcSrc.includes("'.restore-old-'"), '恢复须保留旧目录副本用于回滚');
  assert.ok(svcSrc.includes('恢复失败，已回滚（当前文件未改动）'), '目录交换失败须自动回滚');
  assert.ok(!svcSrc.includes('fs.rmSync(dn, { recursive: true, force: true })'), '不得先删除当前原型再复制快照');
  console.log('[PASS] (e) 恢复采用备份→暂存→交换→回滚，失败不破坏当前文件');
}

console.log('=== snapshot-restore 全部断言通过 (5/5 PASS) ===');
