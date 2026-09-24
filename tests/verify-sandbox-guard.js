'use strict';
// verify-sandbox-guard: 沙箱根越界守卫回归（纯 Node，不启动 Electron）
// 覆盖: diffSandboxRootAgainst 本沙箱改动不报 / 隔壁改动被报 / 点目录忽略 / 超限截断标记 / 永不抛错
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const svc = require(path.join(__dirname, '..', 'main', 'services', 'sandbox-storage-service.js'));

console.log('=== sandbox-guard 回归测试 ===');

assert.ok(typeof svc.diffSandboxRootAgainst === 'function', '须导出 diffSandboxRootAgainst');
console.log('[PASS] (0) 导出签名 diffSandboxRootAgainst(rootDir, allowedDir, beforeMap)');

function buildBefore(rootDir) {
  const m = new Map();
  for (const d of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
    const sig = svc.getProtoFileSignature(path.join(rootDir, d.name));
    for (const [rel, st] of sig) m.set(d.name + '/' + rel, st);
  }
  return m;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-guard-'));
const dirA = path.join(tmpRoot, '原型A');
const dirB = path.join(tmpRoot, '原型B');
fs.mkdirSync(dirA, { recursive: true });
fs.mkdirSync(dirB, { recursive: true });
fs.writeFileSync(path.join(dirA, 'index.html'), '<h1>A v1</h1>\n', 'utf8');
fs.writeFileSync(path.join(dirA, 'doc.md'), '# A\n', 'utf8');
fs.writeFileSync(path.join(dirB, 'index.html'), '<h1>B v1</h1>\n', 'utf8');

try {
  // (1) 无改动不报
  {
    const before = buildBefore(tmpRoot);
    const out = svc.diffSandboxRootAgainst(tmpRoot, dirA, before);
    assert.ok(Array.isArray(out), '须返回数组');
    assert.strictEqual(out.length, 0, '无改动应为空，实际 ' + JSON.stringify(out));
    assert.strictEqual(out.truncated, false, '未超限 truncated 应为 false');
    console.log('[PASS] (1) 无改动不报');
  }

  // (2) 本沙箱内改动不报（只改 allowedDir 下文件）
  {
    const before = buildBefore(tmpRoot);
    fs.writeFileSync(path.join(dirA, 'index.html'), '<h1>A v2 改动后内容明显变长!!!</h1>\n<p>more</p>\n', 'utf8');
    const out = svc.diffSandboxRootAgainst(tmpRoot, dirA, before);
    assert.strictEqual(out.length, 0, '本沙箱改动应被过滤，实际 ' + JSON.stringify(out));
    console.log('[PASS] (2) 本沙箱内改动不报');
  }

  // (3) 隔壁改动被报（modified + created），path 为相对沙箱根路径
  {
    const before = buildBefore(tmpRoot);
    fs.writeFileSync(path.join(dirB, 'index.html'), '<h1>B v2 隔壁被改动，内容变长很多很多</h1>\n<p>x</p>\n', 'utf8');
    fs.writeFileSync(path.join(dirB, 'new.html'), '<h1>new</h1>\n', 'utf8');
    const out = svc.diffSandboxRootAgainst(tmpRoot, dirA, before);
    const mod = out.find((x) => x.path === '原型B/index.html');
    assert.ok(mod && mod.action === 'modified', '隔壁 modified 应被报，实际 ' + JSON.stringify(out));
    const created = out.find((x) => x.path === '原型B/new.html');
    assert.ok(created && created.action === 'created', '隔壁 created 应被报，实际 ' + JSON.stringify(out));
    assert.ok(!out.some((x) => String(x.path).startsWith('原型A/')), '不应含 allowedDir 下路径');
    console.log('[PASS] (3) 隔壁改动被报');
  }

  // (4) 点目录忽略（.context/ 与点文件变更不报）
  {
    try { fs.rmSync(path.join(dirB, 'new.html')); } catch (e) {}
    const before = buildBefore(tmpRoot);
    const ctxDir = path.join(dirB, '.context');
    fs.mkdirSync(ctxDir, { recursive: true });
    fs.writeFileSync(path.join(ctxDir, 'ui-spec.md'), '# spec v1\n', 'utf8');
    const rootCtx = path.join(tmpRoot, '.context');
    fs.mkdirSync(rootCtx, { recursive: true });
    fs.writeFileSync(path.join(rootCtx, 'toolPrompt.md'), 'prompt\n', 'utf8');
    const out = svc.diffSandboxRootAgainst(tmpRoot, dirA, before);
    assert.ok(!out.some((x) => String(x.path).includes('.context')), '点目录变更须忽略，实际 ' + JSON.stringify(out));
    console.log('[PASS] (4) 点目录忽略');
  }

  // (5) 超限截断标记 truncated:true（单目录文件数上限保护）
  {
    const limit = svc.SANDBOX_GUARD_MAX_FILES_PER_DIR || 1000;
    assert.ok(typeof limit === 'number' && limit > 0, '须导出上限常量');
    const before = buildBefore(tmpRoot);
    const cur = fs.readdirSync(dirB).length;
    const need = (limit + 30) - cur;
    for (let i = 0; i < need; i++) {
      try { fs.writeFileSync(path.join(dirB, 'bulk-' + i + '.html'), '<h1>' + i + '</h1>\n', 'utf8'); } catch (e) {}
    }
    const out = svc.diffSandboxRootAgainst(tmpRoot, dirA, before);
    assert.strictEqual(out.truncated, true, '超限须标记 truncated:true');
    console.log('[PASS] (5) 超限截断标记 truncated:true（limit=' + limit + '）');
  }

  // (6) 永不抛错（非法入参回空数组）
  {
    assert.doesNotThrow(() => svc.diffSandboxRootAgainst(null, null, null), 'null 入参不应抛错');
    assert.doesNotThrow(() => svc.diffSandboxRootAgainst(tmpRoot, dirA, 'bad-type'), '坏快照类型不应抛错');
    assert.doesNotThrow(() => svc.diffSandboxRootAgainst(path.join(tmpRoot, 'not-exist'), dirA, new Map()), '不存在根不应抛错');
    const r1 = svc.diffSandboxRootAgainst(null, null, null);
    assert.ok(Array.isArray(r1) && r1.length === 0, '非法入参应回空数组');
    console.log('[PASS] (6) 永不抛错');
  }

  console.log('=== sandbox-guard 全部断言通过 (7/7 PASS) ===');
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
}
