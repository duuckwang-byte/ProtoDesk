'use strict';
// 主列表右键“导入子页面…”：多选 HTML → 去重改名 → 写入当前原型沙箱（子页面由目录 listing 自动识别）
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const sbSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
const svcSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');

// ---- 1. 主进程多选（单文件老行为不变） ----
(function testPickMulti() {
  const fn = svcSrc.match(/async function pickTextFileImpl[\s\S]*?\n\}/);
  assert.ok(fn, '缺 pickTextFileImpl');
  const body = fn[0];
  assert.ok(/multiSelections/.test(body), '须支持多选');
  assert.ok(/o\.multi\s*\|\|\s*o\.multiple/.test(body), '须认 multi/multiple 参数');
  assert.ok(/\{ files:/.test(body) || /files: \[\]/.test(body) || /return \{ files/.test(body), '多选须返回 files 数组');
  assert.ok(/8 \* 1024 \* 1024/.test(body), '超大文件须跳过读取');
  // 单选老路：只取 filePaths[0]，返回 {path,name,content}
  assert.ok(/r\.filePaths\[0\]/.test(body), '单选须保持只取第一个');
  console.log('[PASS] 主进程多选');
})();

// ---- 2. 右键菜单项 ----
(function testMenuItem() {
  assert.ok(/label:\s*'导入子页面…'/.test(sbSrc), '右键菜单须有导入子页面项');
  const idxNew = sbSrc.indexOf("label: '新建子页面…'");
  const idxImp = sbSrc.indexOf("label: '导入子页面…'");
  const idxProto = sbSrc.indexOf("label: '新建同级原型…'");
  assert.ok(idxNew >= 0 && idxImp > idxNew && idxProto > idxImp, '菜单顺序须为新建子页面/导入子页面/新建同级原型');
  assert.ok(/importSubPages\(s\)/.test(sbSrc), '菜单须调 importSubPages(s)');
  console.log('[PASS] 右键菜单项');
})();

// ---- 3. 导入流程（静态契约） ----
(function testImportFlow() {
  assert.ok(/function importSubPages\(s\)/.test(sbSrc), '缺 importSubPages');
  const fn = sbSrc.match(/function importSubPages\(s\)\{[\s\S]*?\n\} catch/);
  const body = fn ? fn[0] : sbSrc;
  assert.ok(/multi\s*:\s*true/.test(body), '须 multi 多选');
  assert.ok(/sandbox\.write/.test(body), '须经 sandbox:write 落盘（沙箱范围校验）');
  assert.ok(/sandbox\.readFile/.test(body), '重名探测须经 sandbox:read-file');
  assert.ok(/\(\s*n\s*\+\s*1\s*\)/.test(body) || /'\(\s*'/.test(body), '重名须加 (2)/(3) 后缀');
  assert.ok(/\.html\?\$/.test(body), '非 HTML 须跳过');
  assert.ok(/5\s*\*\s*1024\s*\*\s*1024/.test(body), '超 5MB 须跳过');
  assert.ok(/loadSandboxSources/.test(body), '导入后须刷新列表');
  assert.ok(/protoTreeFold/.test(body), '导入后须展开当前原型');
  console.log('[PASS] 导入流程');
})();

console.log('IMPORTSUB_PASS: 批量导入子页面全绿');
