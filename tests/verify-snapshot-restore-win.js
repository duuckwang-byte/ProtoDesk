'use strict';
// snapshot-restore-win: 快照恢复 Windows 实测回归（纯 Node，不启动 Electron）
// 背景：Electron 37 / Node 22.21.1 的 fs.cpSync 在中文路径复制目录返回 EPERM「函数不正确」，
// 系统 Node 24 正常。本用例在含中文/空格的临时目录中真实执行 takeSnapshot → 修改 → restore，
// 校验：不再出现 EPERM、恢复后逐字节一致、undo 备份存在、失败路径不破坏当前文件与快照。
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OLD_CWD = process.cwd();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), '快照恢复 EPERM 回归-'));

function long(p) {
  const s = String(p);
  if (process.platform !== 'win32' || s.length < 240 || s.startsWith('\\\\?\\')) return s;
  if (s.startsWith('\\\\')) return '\\\\?\\UNC\\' + s.slice(2);
  if (/^[A-Za-z]:[\\/]/.test(s)) return '\\\\?\\' + path.normalize(s);
  return s;
}
function writeFile(p, data) {
  fs.mkdirSync(long(path.dirname(p)), { recursive: true });
  fs.writeFileSync(long(p), data);
}
function hashTree(root) {
  const out = new Map();
  const walk = (dir, rel) => {
    const entries = fs.readdirSync(long(dir), { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(full, r);
      else if (ent.isFile()) out.set(r, crypto.createHash('sha256').update(fs.readFileSync(long(full))).digest('hex'));
    }
  };
  walk(root, '');
  return out;
}
function assertSameTree(actualRoot, expected, label) {
  const actual = hashTree(actualRoot);
  assert.deepStrictEqual([...actual.keys()].sort(), [...expected.keys()].sort(), label + ' 文件清单不一致');
  for (const rel of expected.keys()) {
    assert.strictEqual(actual.get(rel), expected.get(rel), label + ' 内容不一致：' + rel);
  }
}
function sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {}
}

console.log('=== snapshot-restore Windows 实测 ===');
console.log('[INFO] Node=' + process.version + ' platform=' + process.platform + ' tmp=' + TMP);

let svc = null;
let paths = null;
try {
  // paths.SANDBOX_ROOT 在 require 时取 process.cwd()，必须先切到临时目录再加载服务
  process.chdir(TMP);
  svc = require(path.join(ROOT, 'main', 'services', 'sandbox-storage-service.js'));
  paths = require(path.join(ROOT, 'main', 'paths.js'));
  const sbRoot = path.normalize(paths.SANDBOX_ROOT);
  assert.ok(sbRoot.startsWith(path.normalize(TMP)), 'SANDBOX_ROOT 须落在临时目录，实际 ' + sbRoot);

  const proto = path.join(paths.SANDBOX_ROOT, '测试 项目', '首页 原型');
  const initial = new Map([
    ['首页.html', Buffer.from('<html><body>版本一 ✓ 中文</body></html>', 'utf8')],
    ['首页.md', Buffer.from('# 需求 第一版\n\n- 条目甲\n', 'utf8')],
    ['assets/图片 资源/图标.svg', Buffer.from('<svg><text>图标</text></svg>', 'utf8')],
    ['assets/二进制.dat', Buffer.from([0, 1, 2, 3, 255, 254, 10, 13])],
  ]);
  for (const [rel, buf] of initial) writeFile(path.join(proto, rel), buf);
  const before = hashTree(proto);

  // (1) 创建快照（旧实现 takeSnapshot 同样受 fs.cpSync EPERM 影响）
  const snap = svc.takeSnapshot(proto);
  assert.ok(snap, 'takeSnapshot 应成功返回快照目录');
  assert.ok(fs.existsSync(long(snap)), '快照目录应存在：' + snap);
  const ts = path.basename(snap);
  assert.ok(/^\d{8}-\d{6}$/.test(ts), '快照标识应为数字时间戳，实际 ' + ts);
  assertSameTree(snap, before, '快照');
  console.log('[PASS] (1) 中文/空格路径创建快照成功：' + ts);

  // (2) 修改当前原型：改文件、删文件、加文件、改二进制
  fs.writeFileSync(long(path.join(proto, '首页.html')), '<html><body>版本二 已修改</body></html>', 'utf8');
  fs.rmSync(long(path.join(proto, '首页.md')));
  writeFile(path.join(proto, '新增 文件.txt'), '快照之后新增的内容');
  writeFile(path.join(proto, 'assets', '二进制.dat'), Buffer.from([9, 8, 7, 0, 255]));
  const modified = hashTree(proto);
  assert.notDeepStrictEqual([...modified.keys()].sort(), [...before.keys()].sort(), '修改后文件清单应变化');
  console.log('[PASS] (2) 当前原型已修改（改/删/增）');

  // (3) 恢复快照：不得出现 EPERM，内容须逐字节一致
  const r = svc.snapshotRestoreImpl(null, { dir: proto, ts });
  assert.strictEqual(r && r.ok, true, '恢复应成功，实际 ' + JSON.stringify(r));
  assert.ok(!/EPERM|函数不正确/i.test(String((r && r.error) || '')), '恢复结果不得含 EPERM/函数不正确');
  assertSameTree(proto, before, '恢复后');
  console.log('[PASS] (3) 恢复成功且内容逐字节一致（无 EPERM）');

  // (4) undo 备份存在，且保存的是恢复前（已修改）状态
  const snapRoot = path.dirname(snap);
  const undoDirs = () => fs.readdirSync(long(snapRoot)).filter((n) => n.startsWith('undo-'));
  const undos = undoDirs();
  assert.strictEqual(undos.length, 1, '应存在 1 份 undo 备份，实际 ' + JSON.stringify(undos));
  assertSameTree(path.join(snapRoot, undos[0]), modified, 'undo 备份');
  console.log('[PASS] (4) undo 备份存在且内容为恢复前状态：' + undos[0]);

  // (5) 快照源保持只读；列表契约不变，undo- 不展示
  assertSameTree(snap, before, '快照源');
  const list = svc.snapshotListImpl(null, proto);
  assert.strictEqual(list && list.ok, true, 'snapshot:list 契约应保持 ok');
  assert.ok(Array.isArray(list.items) && list.items.some((it) => it.ts === ts), '列表应含当前快照');
  assert.ok(!list.items.some((it) => String(it.ts).startsWith('undo-')), 'undo- 不应出现在列表');
  console.log('[PASS] (5) 快照源未变，snapshot:list 契约不变');

  // (6) 不存在的时间戳：失败返回，当前文件不变
  const missing = svc.snapshotRestoreImpl(null, { dir: proto, ts: '00000000-000000' });
  assert.strictEqual(missing && missing.ok, false, '不存在的快照应失败');
  assertSameTree(proto, before, '非法快照失败后');
  console.log('[PASS] (6) 快照不存在时失败且不破坏当前文件');

  // (7) undo 备份创建失败：明确报错并中止，当前文件一个字节都不动
  const undoCount = undoDirs().length;
  const origMkdir = fs.mkdirSync;
  fs.mkdirSync = function patchedMkdir(p, opts) {
    if (String(p).includes('undo-')) {
      const e = new Error('EPERM: simulated mkdir failure');
      e.code = 'EPERM';
      throw e;
    }
    return origMkdir.call(fs, p, opts);
  };
  let backupFail = null;
  try {
    backupFail = svc.snapshotRestoreImpl(null, { dir: proto, ts });
  } finally {
    fs.mkdirSync = origMkdir;
  }
  assert.strictEqual(backupFail && backupFail.ok, false, '备份失败时恢复必须中止');
  assert.ok(String(backupFail.error).includes('恢复前备份失败'), '错误须说明恢复前备份失败，实际 ' + backupFail.error);
  assert.ok(String(backupFail.error).includes('当前文件未改动'), '错误须说明当前文件未改动，实际 ' + backupFail.error);
  assert.ok(String(backupFail.error).includes('EPERM'), '错误须带可定位的 EPERM 错误码，实际 ' + backupFail.error);
  assert.ok(!String(backupFail.error).includes('函数不正确'), '错误文案不得是乱码系统文本');
  assertSameTree(proto, before, '备份失败后');
  assert.strictEqual(undoDirs().length, undoCount, '备份失败不得留下半份 undo 目录');
  console.log('[PASS] (7) undo 创建失败明确中止，当前文件未改动');

  // (8) 快照复制到暂存失败：当前文件与快照源均不变，暂存目录清理干净
  const origCopy = fs.copyFileSync;
  fs.copyFileSync = function patchedCopy(from, to) {
    if (String(to).includes('.restore-staging')) {
      const e = new Error('EPERM: simulated copy failure');
      e.code = 'EPERM';
      throw e;
    }
    return origCopy.call(fs, from, to);
  };
  let copyFail = null;
  try {
    copyFail = svc.snapshotRestoreImpl(null, { dir: proto, ts });
  } finally {
    fs.copyFileSync = origCopy;
  }
  assert.strictEqual(copyFail && copyFail.ok, false, '快照复制失败时恢复必须中止');
  assert.ok(String(copyFail.error).includes('读取快照失败'), '错误须说明读取快照失败，实际 ' + copyFail.error);
  assert.ok(String(copyFail.error).includes('当前文件未改动'), '错误须说明当前文件未改动，实际 ' + copyFail.error);
  assertSameTree(proto, before, '快照复制失败后');
  assertSameTree(snap, before, '快照复制失败后源快照');
  const siblings = fs.readdirSync(long(path.dirname(proto)));
  assert.ok(!siblings.some((n) => n.startsWith('.restore-staging-')), '暂存目录须清理，实际 ' + JSON.stringify(siblings));
  assert.ok(!siblings.some((n) => n.startsWith('.restore-old-')), '旧目录副本须清理，实际 ' + JSON.stringify(siblings));
  console.log('[PASS] (8) 暂存复制失败不破坏当前文件与快照，临时目录已清理');

  // (9) 目录交换第二步失败：自动回滚，当前文件恢复为操作前状态，无残留
  const origRename = fs.renameSync;
  fs.renameSync = function patchedRename(from, to) {
    if (path.normalize(String(to)) === path.normalize(proto) && String(from).includes('.restore-staging')) {
      const e = new Error('EPERM: simulated final rename failure');
      e.code = 'EPERM';
      throw e;
    }
    return origRename.call(fs, from, to);
  };
  let renameFail = null;
  try {
    renameFail = svc.snapshotRestoreImpl(null, { dir: proto, ts });
  } finally {
    fs.renameSync = origRename;
  }
  assert.strictEqual(renameFail && renameFail.ok, false, '目录交换失败时恢复必须失败');
  assert.ok(String(renameFail.error).includes('已回滚'), '失败后须自动回滚，实际 ' + renameFail.error);
  assertSameTree(proto, before, '目录交换失败回滚后');
  assertSameTree(snap, before, '目录交换失败后的源快照');
  const afterRenameFail = fs.readdirSync(long(path.dirname(proto)));
  assert.ok(!afterRenameFail.some((n) => n.startsWith('.restore-')), '回滚后不得残留 .restore-*，实际 ' + JSON.stringify(afterRenameFail));
  console.log('[PASS] (9) 目录交换失败自动回滚，当前文件与快照未损坏');

  // (10) 长路径：原型内嵌超过 260 字符的深层目录，快照/恢复仍逐字节一致
  const seg = '长路径目录_abcdefghij';
  let deepDir = proto;
  for (let i = 0; i < 12; i++) deepDir = path.join(deepDir, seg + '_' + i);
  const deepFile = path.join(deepDir, '深层 文件.html');
  assert.ok(deepFile.length > 260, '用例路径须超过 260 字符，实际 ' + deepFile.length);
  writeFile(deepFile, '<html><body>长路径 版本一</body></html>');
  const beforeLong = hashTree(proto);
  sleepMs(1100); // 快照按秒命名，避免同一秒覆盖
  const snap2 = svc.takeSnapshot(proto);
  assert.ok(snap2, '长路径原型创建快照应成功');
  assert.ok(path.basename(snap2) !== ts, '第二份快照标识应不同');
  assertSameTree(snap2, beforeLong, '长路径快照');
  fs.writeFileSync(long(deepFile), '<html><body>长路径 版本二</body></html>', 'utf8');
  const r2 = svc.snapshotRestoreImpl(null, { dir: proto, ts: path.basename(snap2) });
  assert.strictEqual(r2 && r2.ok, true, '长路径恢复应成功，实际 ' + JSON.stringify(r2));
  assert.strictEqual(fs.readFileSync(long(deepFile), 'utf8'), '<html><body>长路径 版本一</body></html>', '长路径文件内容须恢复');
  assertSameTree(proto, beforeLong, '长路径恢复后');
  console.log('[PASS] (10) 长路径（' + deepFile.length + ' 字符）快照/恢复逐字节一致');

  // (11) 全流程结束后无暂存/旧目录残留
  const finalSiblings = fs.readdirSync(long(path.dirname(proto)));
  assert.ok(!finalSiblings.some((n) => n.startsWith('.restore-')), '不得残留 .restore-* 目录，实际 ' + JSON.stringify(finalSiblings));
  console.log('[PASS] (11) 无暂存/回滚目录残留');

  console.log('=== snapshot-restore Windows 全部断言通过 (11/11 PASS) ===');
} catch (e) {
  console.error('[FAIL] ' + ((e && e.stack) || e));
  process.exitCode = 1;
} finally {
  try { process.chdir(OLD_CWD); } catch (e) {}
  try { fs.rmSync(long(TMP), { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
}
