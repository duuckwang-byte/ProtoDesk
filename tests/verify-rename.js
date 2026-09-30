'use strict';
// verify-rename: 原型重命名回归（纯 Node，不启动 Electron）
// 覆盖: sanitize 校验矩阵（前后端同口径：非法字符/超长/空格点结尾/保留设备名）
//       真实改名（文件夹+同名html/md同步）/ 仅大小写改名（Windows两步改名）/ 真重名拒绝 / 测试目录零残留
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const svc = require(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'));
const paths = require(path.join(rootDir, 'main', 'paths.js'));

console.log('=== rename 回归测试 ===');

// 安全绳：测试目录必须落在仓库内沙箱下，绝不碰正式 %APPDATA%
const sbRoot = path.normalize(paths.SANDBOX_ROOT);
assert.ok(sbRoot.indexOf(path.normalize(rootDir)) === 0, 'SANDBOX_ROOT 须在仓库内，实际 ' + sbRoot);
console.log('[PASS] (0) 沙箱根定位仓库内：' + sbRoot);

// ---- 1. sanitize 校验矩阵（前后端同口径） ----
{
  assert.ok(typeof svc.sanitizeProtoName === 'function', '须导出 sanitizeProtoName');
  const bad = ['', '   ', 'a'.repeat(61), 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b',
    'a..b', 'abc.', 'CON', 'con', 'prn', 'PRN.txt', 'COM1', 'lpt9', 'nul.md', 'aux.html'];
  for (const b of bad) {
    assert.strictEqual(svc.sanitizeProtoName(b), null, '应拒绝: ' + JSON.stringify(b));
  }
  const good = [['正常名称', '正常名称'], ['my-con', 'my-con'], ['mycon', 'mycon'], ['x.html', 'x'], ['A B', 'A B'], ['a.b', 'a.b'], ['abc ', 'abc']];
  for (const [inp, want] of good) {
    assert.strictEqual(svc.sanitizeProtoName(inp), want, '应通过: ' + JSON.stringify(inp));
  }
  console.log('[PASS] (1) sanitize 矩阵（坏 ' + bad.length + ' / 好 ' + good.length + '）');
}

// ---- 2/3/4. 真实文件改名（沙箱内隔离项目，用完即删） ----
const proj = '__rename_test_' + process.pid + '__';
const projDir = path.join(sbRoot, proj);
function mkProto(name) {
  const dir = path.join(projDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(dir, name + '.md'), '# md', 'utf8');
  return dir;
}
function actualName(dir) {
  return fs.readdirSync(path.dirname(dir)).find((n) => n.toLowerCase() === path.basename(dir).toLowerCase());
}
try {
  // (2) 正常改名：文件夹+同名 html/md 同步
  {
    const d = mkProto('protoN');
    const r = svc.sandboxRenameImpl(null, { dir: d, name: 'protoN2' });
    assert.ok(r && r.ok, '正常改名须 ok，实际 ' + JSON.stringify(r));
    assert.ok(fs.existsSync(path.join(projDir, 'protoN2', 'protoN2.html')), 'html 须同步改名');
    assert.ok(fs.existsSync(path.join(projDir, 'protoN2', 'protoN2.md')), 'md 须同步改名');
    assert.ok(!fs.existsSync(d), '旧目录须消失');
    console.log('[PASS] (2) 正常改名（文件夹+html/md同步）');
  }
  // (3) 仅大小写改名：Windows 下 existsSync 恒真，须两步改名成功
  {
    const d = mkProto('casedemo');
    const r = svc.sandboxRenameImpl(null, { dir: d, name: 'CaseDemo' });
    assert.ok(r && r.ok, '仅大小写改名须 ok，实际 ' + JSON.stringify(r));
    assert.strictEqual(actualName(path.join(projDir, 'CaseDemo')), 'CaseDemo', '目录大小写须落地');
    const files = fs.readdirSync(path.join(projDir, 'CaseDemo'));
    assert.ok(files.includes('CaseDemo.html') && files.includes('CaseDemo.md'), '内部文件大小写须同步，实际 ' + JSON.stringify(files));
    console.log('[PASS] (3) 仅大小写改名');
  }
  // (4) 真重名拒绝
  {
    mkProto('dupA'); mkProto('dupB');
    const r = svc.sandboxRenameImpl(null, { dir: path.join(projDir, 'dupA'), name: 'dupB' });
    assert.ok(r && !r.ok && /同名/.test(String(r.error || '')), '真重名须拒绝，实际 ' + JSON.stringify(r));
    console.log('[PASS] (4) 真重名拒绝');
  }
} finally {
  try { fs.rmSync(projDir, { recursive: true, force: true }); } catch (e) {}
}
assert.ok(!fs.existsSync(projDir), '测试目录须零残留');
console.log('[PASS] (5) 测试目录零残留');

// ---- 6. fsRenameRetry：transient EBUSY 重试后成功 / 常驻占用给人话 / 非重试错误直返 ----
{
  assert.ok(typeof svc.fsRenameRetry === 'function', '须导出 fsRenameRetry');
  let calls = 0;
  const flaky = () => { calls++; if (calls < 3) { const e = new Error('flaky'); e.code = 'EBUSY'; throw e; } };
  const r1 = svc.fsRenameRetry('a', 'b', { tries: 5, sleepMs: 0, rename: flaky });
  assert.ok(r1.ok && r1.attempts === 3 && calls === 3, '两次 EBUSY 后应成功，实际 ' + JSON.stringify(r1));
  const r2 = svc.fsRenameRetry('a', 'b', { tries: 5, sleepMs: 0, rename: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } });
  assert.ok(!r2.ok && r2.attempts === 5 && /占用/.test(String(r2.error || '')), '常驻占用须人话报错，实际 ' + JSON.stringify(r2));
  let once = 0;
  const r3 = svc.fsRenameRetry('a', 'b', { tries: 5, sleepMs: 0, rename: () => { once++; const e = new Error('no such file'); e.code = 'ENOENT'; throw e; } });
  assert.ok(!r3.ok && once === 1 && r3.attempts === 1, '非重试错误须一次直返，实际 ' + JSON.stringify(r3));
  console.log('[PASS] (6) fsRenameRetry（重试成功/占位人话/非重试直返）');
}

console.log('=== rename 全部断言通过 (7/7 PASS) ===');
