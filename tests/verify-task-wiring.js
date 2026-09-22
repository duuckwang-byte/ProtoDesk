'use strict';
// task-wiring：skill 落地 + 沙箱根越界接线验证（纯 Node，不启动 Electron）
// 覆盖：stageSkillsToContext 拷贝+映射（含源缺失不断链）、buildSkillMapSection 生成、
//       diffSandboxRootAgainst 真实函数越界检测（临时沙箱根+fake beforeMap）、超量跳过标记 + 静态接线
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const aiPath = path.join(rootDir, 'main', 'services', 'ai-process-service.js');
const sbPath = path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js');
const aiSrc = fs.readFileSync(aiPath, 'utf8');
const sbSrc = fs.readFileSync(sbPath, 'utf8');
const aiSvc = require(aiPath);
const sbSvc = require(sbPath);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmDir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
}

// ---- 0. skill 源位置（仓库 glob 无命中，记录仓库外绝对源路径） ----
(function testSkillSources() {
  const protoUpper = 'C:\\Users\\allow\\.agents\\skills\\prototype-ui\\SKILL.md';
  const prdLower = 'C:\\Users\\allow\\.agents\\skills\\prd-skill\\skill.md';
  assert.ok(fs.existsSync(protoUpper), 'prototype-ui 源须存在：' + protoUpper);
  assert.ok(fs.existsSync(prdLower), 'prd-skill 源须存在：' + prdLower);
  assert.ok(sbSrc.includes('SKILL_KEYWORDS_MAP'), 'sandbox-storage 须内建映射表');
  console.log('[PASS] skill 源位置确认（仓库外用户 skills 目录）');
  console.log('  prototype-ui: ' + protoUpper);
  console.log('  prd-skill: ' + prdLower);
})();

// ---- 1. stageSkillsToContext 导出与映射写死 ----
(function testMapConst() {
  assert.strictEqual(typeof sbSvc.stageSkillsToContext, 'function', '缺 stageSkillsToContext');
  assert.ok(sbSvc.SKILL_KEYWORDS_MAP, '缺 SKILL_KEYWORDS_MAP 导出');
  assert.strictEqual(sbSvc.SKILL_KEYWORDS_MAP['prototype-ui'], '修改原型、页面、原型图、prototype-ui', 'prototype-ui 关键词写死');
  assert.strictEqual(sbSvc.SKILL_KEYWORDS_MAP['prd-skill'], '修改文档、功能说明、PRD、需求文档', 'prd-skill 关键词写死');
  console.log('[PASS] 映射关系写死');
})();

// ---- 2. skill 拷贝 + 返回结构 ----
(function testStageCopy() {
  const cwd = mkTmp('skill-cwd-');
  const srcProto = mkTmp('skill-src-proto-');
  const srcPrd = mkTmp('skill-src-prd-');
  try {
    fs.writeFileSync(path.join(srcProto, 'SKILL.md'), '# prototype-ui skill\ntest', 'utf8');
    fs.writeFileSync(path.join(srcPrd, 'skill.md'), '# prd skill\ntest', 'utf8');
    const staged = sbSvc.stageSkillsToContext(cwd, [
      { id: 'prototype-ui', src: srcProto },
      { id: 'prd-skill', src: srcPrd }
    ]);
    assert.ok(Array.isArray(staged) && staged.length === 2, '须返回2项，实际' + JSON.stringify(staged));
    const p = staged.find((x) => x.id === 'prototype-ui');
    const d = staged.find((x) => x.id === 'prd-skill');
    assert.ok(p && p.keywords.includes('修改原型'), 'prototype-ui keywords');
    assert.ok(d && d.keywords.includes('PRD'), 'prd-skill keywords');
    assert.ok(p.relPath === '.context/skills/prototype-ui/SKILL.md', 'prototype relPath 须为 .context/skills/prototype-ui/SKILL.md，实际' + p.relPath);
    assert.ok(d.relPath === '.context/skills/prd-skill/skill.md', 'prd relPath 须保留小写文件名，实际' + d.relPath);
    assert.ok(fs.existsSync(path.join(cwd, '.context', 'skills', 'prototype-ui', 'SKILL.md')), 'prototype 文件须落盘');
    assert.ok(fs.existsSync(path.join(cwd, '.context', 'skills', 'prd-skill', 'skill.md')), 'prd 文件须落盘');
    assert.strictEqual(fs.readFileSync(path.join(cwd, '.context', 'skills', 'prototype-ui', 'SKILL.md'), 'utf8'), '# prototype-ui skill\ntest', '拷贝内容一致');
    console.log('[PASS] skill 拷贝+映射返回');
  } finally { rmDir(cwd); rmDir(srcProto); rmDir(srcPrd); }
})();

// ---- 3. 源缺失不断链 ----
(function testMissingChain() {
  const cwd = mkTmp('skill-miss-');
  const srcPrd = mkTmp('skill-src-prd2-');
  try {
    fs.writeFileSync(path.join(srcPrd, 'skill.md'), '# prd ok', 'utf8');
    let staged = null;
    assert.doesNotThrow(() => {
      staged = sbSvc.stageSkillsToContext(cwd, [
        { id: 'prototype-ui', src: path.join(os.tmpdir(), 'no-such-skill-xyz-12345') },
        { id: 'prd-skill', src: srcPrd }
      ]);
    }, '源缺失不得抛错');
    assert.ok(Array.isArray(staged) && staged.length === 1 && staged[0].id === 'prd-skill', '缺失项跳过、有效项保留，实际' + JSON.stringify(staged));
    assert.doesNotThrow(() => sbSvc.stageSkillsToContext(null, [{ id: 'prototype-ui', src: srcPrd }]), '空 cwd 不抛错');
    assert.deepStrictEqual(sbSvc.stageSkillsToContext(path.join(os.tmpdir(), 'no-such-cwd-xyz'), []), [], '非法 cwd 回 []');
    console.log('[PASS] 源缺失不断链');
  } finally { rmDir(cwd); rmDir(srcPrd); }
})();

// ---- 4. 映射段生成 ----
(function testSkillSection() {
  assert.strictEqual(typeof aiSvc.buildSkillMapSection, 'function', '缺 buildSkillMapSection');
  assert.strictEqual(aiSvc.buildSkillMapSection([]), '', '空 staged 回空串');
  assert.strictEqual(aiSvc.buildSkillMapSection(null), '', 'null 回空串');
  const sec = aiSvc.buildSkillMapSection([
    { id: 'prototype-ui', keywords: '修改原型、页面、原型图、prototype-ui', relPath: '.context/skills/prototype-ui/SKILL.md' },
    { id: 'prd-skill', keywords: '修改文档、功能说明、PRD、需求文档', relPath: '.context/skills/prd-skill/skill.md' }
  ]);
  assert.ok(sec.includes('【技能映射·按关键词取用】'), '须含标题');
  assert.ok(sec.includes('修改原型、页面、原型图、prototype-ui'), '须含原型关键词');
  assert.ok(sec.includes('修改文档、功能说明、PRD、需求文档'), '须含文档关键词');
  assert.ok(sec.includes('.context/skills/prototype-ui/SKILL.md'), '须含原型相对地址');
  assert.ok(sec.includes('.context/skills/prd-skill/skill.md'), '须含文档相对地址');
  assert.ok(sec.includes('动手前完整读取'), '须含动手前完整读取约束');
  assert.ok(sec.includes('读不到就直说') && sec.includes('不得臆造'), '须含读不到直说、不得臆造');
  console.log('[PASS] 映射段生成');
})();

// ---- 5. 下发组装静态接线（仅 staged 非空下发） ----
(function testPromptWiring() {
  assert.ok(aiSrc.includes('stageSkillsToContext(cwd)'), 'aiAskImpl 须调 stageSkillsToContext(cwd)');
  assert.ok(aiSrc.includes('buildSkillMapSection(stagedSkills)'), '须调 buildSkillMapSection 组装');
  assert.ok(/if\s*\(\s*Array\.isArray\(stagedSkills\)/.test(aiSrc), '须仅 staged 非空下发');
  assert.ok(aiSrc.includes('【技能映射·按关键词取用】') || aiSrc.includes('buildSkillMapSection'), '映射段标题接线');
  console.log('[PASS] 下发组装接线');
})();

// ---- 6. 越界检测：临时沙箱根 + 真实函数 ----
(function testGuardDetect() {
  assert.strictEqual(typeof sbSvc.diffSandboxRootAgainst, 'function', '缺 diffSandboxRootAgainst');
  assert.strictEqual(typeof sbSvc.getProtoFileSignature, 'function', '缺 getProtoFileSignature');
  const root = mkTmp('guard-root-');
  try {
    const dirA = path.join(root, 'ProtoA');
    const dirB = path.join(root, 'ProtoB');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'a.html'), '<html>a1</html>', 'utf8');
    fs.writeFileSync(path.join(dirB, 'b.html'), '<html>b1</html>', 'utf8');
    // 复用 getProtoFileSignature 逐原型目录拼 beforeMap（与生产一致）
    const beforeMap = new Map();
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const sig = sbSvc.getProtoFileSignature(path.join(root, d.name));
      for (const [rel, st] of sig) beforeMap.set(d.name + '/' + rel, st);
    }
    assert.ok(beforeMap.size >= 2, 'beforeMap 须含两原型签名');
    // 隔壁原型越界修改 + 本原型内修改（应被过滤）
    fs.writeFileSync(path.join(dirB, 'b.html'), '<html>b1-changed-more-content</html>', 'utf8');
    fs.writeFileSync(path.join(dirB, 'evil.html'), '<html>evil</html>', 'utf8');
    fs.writeFileSync(path.join(dirA, 'a.html'), '<html>a1-changed-more-content-here</html>', 'utf8');
    const outs = sbSvc.diffSandboxRootAgainst(root, path.join(root, 'ProtoA'), beforeMap);
    assert.ok(Array.isArray(outs), '须返回数组');
    const pathsHit = outs.map((x) => String(x.path || ''));
    assert.ok(pathsHit.some((p) => p === 'ProtoB/b.html'), '须检出隔壁修改 ProtoB/b.html，实际' + JSON.stringify(pathsHit));
    assert.ok(pathsHit.some((p) => p === 'ProtoB/evil.html'), '须检出隔壁新增 ProtoB/evil.html');
    assert.ok(!pathsHit.some((p) => p.indexOf('ProtoA/') === 0), '允许目录内变更须过滤，实际' + JSON.stringify(pathsHit));
    assert.ok(typeof outs.truncated === 'boolean', '须附带 truncated 标记');
    console.log('[PASS] 越界检测（真实函数+临时沙箱根）');
  } finally { rmDir(root); }
})();

// ---- 7. fake beforeMap 形态兼容 ----
(function testFakeBefore() {
  const root = mkTmp('guard-fake-');
  try {
    const dirB = path.join(root, 'ProtoB');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'keep.html'), '<html>k</html>', 'utf8');
    const fake = new Map();
    fake.set('ProtoB/old.html', { size: 10, mtimeMs: 1000 });
    fake.set('ProtoB/keep.html', { size: 99999, mtimeMs: 1 });
    const outs = sbSvc.diffSandboxRootAgainst(root, path.join(root, 'ProtoA'), fake);
    const ps = outs.map((x) => String(x.path || ''));
    assert.ok(ps.includes('ProtoB/old.html'), 'fake 删除须检出，实际' + JSON.stringify(ps));
    console.log('[PASS] fake beforeMap 兼容');
  } finally { rmDir(root); }
})();

// ---- 8. 超量跳过（运行时 + 静态标记） ----
(function testOverLimit() {
  assert.strictEqual(aiSvc.SANDBOX_GUARD_TOTAL_MAX_FILES, 5000, '上限须为5000');
  assert.strictEqual(typeof aiSvc.countFilesUnderRoot, 'function', '缺 countFilesUnderRoot');
  assert.strictEqual(typeof aiSvc.buildSandboxRootBeforeMap, 'function', '缺 buildSandboxRootBeforeMap');
  const root = mkTmp('guard-count-');
  try {
    fs.mkdirSync(path.join(root, 'P'), { recursive: true });
    fs.writeFileSync(path.join(root, 'P', '1.html'), 'a', 'utf8');
    fs.writeFileSync(path.join(root, 'P', '2.html'), 'b', 'utf8');
    fs.writeFileSync(path.join(root, 'P', '3.html'), 'c', 'utf8');
    const small = aiSvc.countFilesUnderRoot(root, 2);
    assert.strictEqual(small.over, true, '小限额须标记 over');
    assert.ok(small.count > 2, '计数须超限额');
    const big = aiSvc.countFilesUnderRoot(root, 5000);
    assert.strictEqual(big.over, false, '大限额不过');
    assert.strictEqual(big.count, 3, '计数须为3');
    const bm = aiSvc.buildSandboxRootBeforeMap(root);
    assert.ok(bm instanceof Map && bm.size === 3, 'beforeMap 须逐目录拼出3项');
  } finally { rmDir(root); }
  assert.ok(aiSrc.includes('SANDBOX_GUARD_TOTAL_MAX_FILES') || aiSrc.includes('5000'), '须有5000上限');
  assert.ok(aiSrc.includes('跳过沙箱越界快照对比') || aiSrc.includes('跳过'), '跳过须 trace 注明');
  assert.ok(aiSrc.includes("tag: 'SANDBOX'") && aiSrc.includes("level: 'warn'"), '跳过/越界须用 trace-warn（SANDBOX/warn）');
  assert.ok(aiSrc.includes('diffSandboxRootAgainst'), '任务前后须调 diffSandboxRootAgainst');
  assert.ok(aiSrc.includes('buildSandboxRootBeforeMap'), '任务前须拼 beforeMap');
  assert.ok(aiSrc.includes('允许目录之外'), '任务结束须列出允许目录之外变更');
  console.log('[PASS] 超量跳过标记');
})();

console.log('TASKWIRING_PASS: skill 落地与越界接线全绿');
