'use strict';
// S5 事前范围确认 + TOOL 双行合并 + 思考占位 + 用量 + 约束行 + permissionMode 接线验证
// 纯 Node，不启动 Electron。风格对齐 verify-history/verify-task-wiring（断言抛错即红）。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const aiPath = path.join(rootDir, 'main', 'services', 'ai-process-service.js');
const ctlPath = path.join(rootDir, 'main', 'controllers', 'ai-controller.js');
const prePath = path.join(rootDir, 'preload.js');
const paePath = path.join(rootDir, 'js', 'project-ai-export.js');
const aiSrc = fs.readFileSync(aiPath, 'utf8');
const ctlSrc = fs.readFileSync(ctlPath, 'utf8');
const preSrc = fs.readFileSync(prePath, 'utf8');
const paeSrc = fs.readFileSync(paePath, 'utf8');
const svc = require(aiPath);

function extract(src, name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}'));
  assert.ok(m, '[提取失败] function ' + name);
  return m[0];
}

try { svc.resetScopeConfirmForTest(); } catch (e) {}

// ---- 1. 快检：无越界路径不触发（零打扰） ----
(function testScannerPass() {
  assert.strictEqual(typeof svc.findScopeRefs, 'function', '缺 findScopeRefs');
  assert.deepStrictEqual(svc.findScopeRefs('把首页按钮改成红色，间距 8 改 16。', 'C:\\sbx\\proj'), [], '普通中文需求须零命中');
  assert.deepStrictEqual(
    svc.findScopeRefs('动手前必须完整读取本工作目录 .context/ui-spec.md 和 .context/toolPrompt.md', 'C:\\sbx\\proj'),
    [], '沙箱内指针引用须零命中'
  );
  assert.deepStrictEqual(
    svc.findScopeRefs('请修改 C:\\sbx\\proj\\index.html 的标题', 'C:\\sbx\\proj'),
    [], '沙箱内绝对路径须零命中'
  );
  assert.deepStrictEqual(
    svc.findScopeRefs('微信/支付宝二选一，文案用 topical 风格', 'C:\\sbx\\proj'),
    [], '中文单段斜杠 prose 须零命中'
  );
  assert.deepStrictEqual(svc.findScopeRefs('', 'C:\\sbx\\proj'), [], '空串须零命中');
  console.log('[PASS] 快检无越界不触发');
})();

// ---- 1b. 快检：沙箱内正斜杠/file 链接不得误报（正式环境 agy 回答多 file:///C:/ 链接） ----
(function testScannerInsideForwardSlash() {
  const cwd = 'C:\\Users\\t\\AppData\\Roaming\\原型工具\\sandbox\\P\\Q';
  assert.deepStrictEqual(
    svc.findScopeRefs('请修改 ' + cwd + '\\Q.html', cwd),
    [], '沙箱内反斜杠绝对路径须零命中'
  );
  assert.deepStrictEqual(
    svc.findScopeRefs('请修改 C:/Users/t/AppData/Roaming/原型工具/sandbox/P/Q/Q.html', cwd),
    [], '沙箱内正斜杠绝对路径须零命中'
  );
  assert.deepStrictEqual(
    svc.findScopeRefs('已改 [Q.html](file:///C:/Users/t/AppData/Roaming/原型工具/sandbox/P/Q/Q.html)', cwd),
    [], '沙箱内 file 链接须零命中'
  );
  const out = svc.findScopeRefs('参考 [x](file:///D:/temp/a.html) 的写法', cwd);
  assert.ok(out.length === 1 && out[0].indexOf('D:') >= 0, '沙箱外 file 链接须命中且归一化，实际' + JSON.stringify(out));
  console.log('[PASS] 沙箱内正斜杠/file 链接零误报');
})();

// ---- 1c. 快检：中文枚举（含斜杠）不得误报为 posix 路径 ----
(function testScannerCjkProse() {
  const cwd = 'C:\\sbx\\proj';
  assert.deepStrictEqual(
    svc.findScopeRefs('| 修改原型、页面、原型图、prototype-ui | .context/skills/prototype-ui/SKILL.md |', cwd),
    [], '技能映射行须零命中'
  );
  assert.deepStrictEqual(
    svc.findScopeRefs('支持甲/乙/丙三种格式，见功能说明/PRD/需求文档', cwd),
    [], '中文斜杠枚举须零命中'
  );
  assert.ok(
    svc.findScopeRefs('看看 /etc/passwd 里有什么', cwd).length >= 1,
    '纯 ASCII 深路径照旧命中'
  );
  console.log('[PASS] 中文枚举零误报');
})();

// ---- 1d. 快检：被截断的自身路径（历史规模行 120 字切断）不得误报 ----
(function testScannerTruncatedSelf() {
  const cwd = 'C:\\Users\\allow\\AppData\\Roaming\\原型工具\\sandbox\\PC端系统\\企业务-PC端';
  assert.deepStrictEqual(
    svc.findScopeRefs('上次结论：已完成，仅针对 C:\\Users\\allow\\AppData\\Roaming\\原型工具\\s', cwd),
    [], '截断的自身前缀须放行'
  );
  assert.deepStrictEqual(
    svc.findScopeRefs('上次结论：见 C:\\Users\\allow\\AppData\\Roaming\\原型工具\\sandbox\\PC端系统\\企业务-PC端\\x.html', cwd),
    [], '完整的自身路径须放行'
  );
  assert.ok(
    svc.findScopeRefs('备份到 C:\\Users\\allow\\AppData\\Roaming\\原型工具', cwd).length >= 1,
    '真父目录（断点在分隔符上）照旧命中'
  );
  console.log('[PASS] 截断自身零误报');
})();

// ---- 2. 快检：越界命中 + 去重 + 上限 ----
(function testScannerHits() {
  const cwd = 'C:\\sbx\\proj';
  const h1 = svc.findScopeRefs('请读取 C:\\Windows\\System32\\drivers\\etc\\hosts', cwd);
  assert.ok(h1.length === 1 && h1[0].indexOf('C:\\Windows') === 0, '沙箱外盘符路径须命中，实际' + JSON.stringify(h1));
  const h2 = svc.findScopeRefs('看看 /etc/passwd 里有什么', cwd);
  assert.ok(h2.some((x) => x.indexOf('/etc/passwd') >= 0), 'POSIX 绝对路径须命中，实际' + JSON.stringify(h2));
  const h3 = svc.findScopeRefs('顺手看看 ../../other/a.html', cwd);
  assert.ok(h3.length >= 1 && h3[0].indexOf('..') >= 0, '.. 跳出片段须命中，实际' + JSON.stringify(h3));
  const h4 = svc.findScopeRefs('备份到 D:/secret/k.txt', cwd);
  assert.ok(h4.some((x) => x.indexOf('D:') === 0), '他盘正斜杠路径须命中，实际' + JSON.stringify(h4));
  const h5 = svc.findScopeRefs('打开 \\\\fileserver\\share\\doc.txt', cwd);
  assert.ok(h5.length >= 1, 'UNC 路径须命中，实际' + JSON.stringify(h5));
  const dup = svc.findScopeRefs('读 C:\\out\\a.txt 再读 C:\\out\\a.txt', cwd);
  assert.strictEqual(dup.length, 1, '重复引用须去重，实际' + JSON.stringify(dup));
  const many = [];
  for (let i = 0; i < 30; i++) many.push('C:\\out' + i + '\\f.txt');
  const capped = svc.findScopeRefs(many.join(' '), cwd);
  assert.strictEqual(capped.length, svc.SCOPE_HITS_MAX, '命中须上限 ' + svc.SCOPE_HITS_MAX + '，实际' + capped.length);
  const bare = svc.findScopeRefs('例如 D:\\、`C:\\` 这样的写法', cwd);
  assert.deepStrictEqual(bare, [], '裸盘符 prose 不得误报，实际' + JSON.stringify(bare));
  console.log('[PASS] 快检越界命中/去重/上限');
})();

// ---- 3. “总是”记内存（不落盘） ----
(function testAlwaysMemory() {
  assert.strictEqual(typeof svc.isScopeAlwaysAllowed, 'function', '缺 isScopeAlwaysAllowed');
  assert.strictEqual(typeof svc.setScopeAlwaysAllowed, 'function', '缺 setScopeAlwaysAllowed');
  assert.ok(svc.scopeAlwaysAllowByCwd instanceof Map, '须为进程内内存 Map');
  assert.strictEqual(svc.isScopeAlwaysAllowed('C:\\sbx\\projA'), false, '初始须 false');
  svc.setScopeAlwaysAllowed('C:\\sbx\\projA');
  assert.strictEqual(svc.isScopeAlwaysAllowed('C:\\sbx\\projA'), true, '设置后须 true');
  assert.strictEqual(svc.isScopeAlwaysAllowed('C:\\sbx\\projB'), false, '按 cwd 隔离');
  assert.ok(aiSrc.includes('不落盘'), '须注释写明不落盘');
  try { svc.resetScopeConfirmForTest(); } catch (e) {}
  assert.strictEqual(svc.isScopeAlwaysAllowed('C:\\sbx\\projA'), false, 'reset 后须清空');
  console.log('[PASS] 总是允许记内存不落盘');
})();

// ---- 4. id 配对合并纯逻辑（等价纯函数） ----
(function testPairPure() {
  const phase = new Function(extract(paeSrc, 'i5ToolPhaseOf') + '\nreturn i5ToolPhaseOf;')();
  assert.strictEqual(phase({ phase: 'start', state: 'ACTIVE', id: 'agy-1' }), 'start', 'agy ACTIVE 须 start');
  assert.strictEqual(phase({ phase: 'done', state: 'DONE', id: 'agy-1' }), 'done', 'agy DONE 须 done');
  assert.strictEqual(phase({ state: 'DONE', id: 'agy-2' }), 'done', 'state DONE 须 done');
  assert.strictEqual(phase({ id: 'tool-abc', tool: 'readFile', input: {} }), 'start', 'qoder/claude 单发须 start');
  assert.strictEqual(phase({}), 'start', '空事件回落 start');
  assert.strictEqual(phase(null), 'start', 'null 安全');
  const utok = new Function(extract(paeSrc, 'i5ToolUsageText') + '\nreturn i5ToolUsageText;')();
  assert.strictEqual(utok(undefined), '', '无 usage 不打扰');
  assert.strictEqual(utok({ input_tokens: 0, output_tokens: 0 }), '', '全 0 不打扰');
  const t1 = utok({ input_tokens: 10, output_tokens: 5 });
  assert.ok(t1.includes('10') && t1.includes('5'), '须含本步 token 数，实际' + t1);
  assert.ok(utok({ inputTokens: 3, outputTokens: 4 }).includes('3'), 'camel 兼容');
  const idle = new Function(extract(paeSrc, 'i5ThinkIdleText') + '\nreturn i5ThinkIdleText;')();
  assert.strictEqual(idle(5), '思考中(5s)', '占位文案须为思考中(Ns)');
  assert.strictEqual(idle(0), '思考中(0s)', '0s 形态');
  console.log('[PASS] 配对/用量文案/占位纯逻辑');
})();

// ---- 5. 用量累加 ----
(function testUsageAccum() {
  assert.strictEqual(typeof svc.addUsageCounts, 'function', '缺 addUsageCounts');
  assert.strictEqual(typeof svc.formatUsageLine, 'function', '缺 formatUsageLine');
  const acc = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 };
  svc.addUsageCounts(acc, { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, total_tokens: 17 });
  svc.addUsageCounts(acc, { inputTokens: 1, outputTokens: 2, thinkingTokens: 3, totalTokens: 6 });
  svc.addUsageCounts(acc, null);
  svc.addUsageCounts(acc, { input_tokens: 'x' });
  assert.deepStrictEqual(acc, { input_tokens: 11, output_tokens: 7, thinking_tokens: 5, total_tokens: 23 }, '累加错误，实际' + JSON.stringify(acc));
  assert.strictEqual(svc.formatUsageLine({ input_tokens: 0, output_tokens: 0, thinking_tokens: 0, total_tokens: 0 }), '', '全 0 跳过不打扰');
  const line = svc.formatUsageLine(acc);
  assert.ok(line.includes('11') && line.includes('7') && line.includes('23'), '总量行须含 input/output/total，实际' + line);
  assert.ok(aiSrc.includes("tag: 'USAGE'"), 'onClose 须发 USAGE trace 行');
  console.log('[PASS] 用量累加与总量行');
})();

// ---- 6. permissionMode 从配置读取 ----
(function testPermMode() {
  assert.strictEqual(typeof svc.resolveCliPermissionMode, 'function', '缺 resolveCliPermissionMode');
  assert.strictEqual(svc.resolveCliPermissionMode({ cliPermissionModes: { antigravity: 'plan' } }, 'antigravity'), 'plan', '命中 defId 须返回值');
  assert.strictEqual(svc.resolveCliPermissionMode({}, 'antigravity'), '', '没配回空串');
  assert.strictEqual(svc.resolveCliPermissionMode({ cliPermissionModes: { antigravity: 'plan' } }, 'qoder'), '', '他家 id 不得串用');
  assert.strictEqual(svc.resolveCliPermissionMode(null, 'antigravity'), '', 'null 配置安全');
  assert.ok(aiSrc.includes('cliPermissionModes'), 'aiAskImpl 须读 cliPermissionModes');
  assert.ok(aiSrc.includes('executionOptions.permissionMode'), '须透进 executionOptions');
  console.log('[PASS] permissionMode 配置读取');
})();

// ---- 7. 约束行 ----
(function testConstraintLine() {
  const ptr = svc.buildToolPromptPointer();
  assert.ok(ptr.includes('.context/toolPrompt.md'), '指针原文保留');
  assert.ok(ptr.includes('严禁全盘扫描') && ptr.includes('枚举盘符') && ptr.includes('查看进程表'), '约束行须含三禁，实际' + ptr);
  const added = '除任务必需外，只读工作目录及指针文件；严禁全盘扫描、枚举盘符、查看进程表。';
  assert.ok(added.length < 100, '新增句须 <100 字，实际' + added.length);
  assert.ok(ptr.length < 512, '指针仍短小（ui-specs 8b 上限），实际' + ptr.length);
  console.log('[PASS] 约束行');
})();

// ---- 8. 确认接线静态（主→渲复用 ai:event；回复 .on 不占 handle 冻结） ----
(function testConfirmWiring() {
  assert.strictEqual(svc.SCOPE_CONFIRM_TIMEOUT_MS, 120000, '超时须 120 秒');
  assert.ok(aiSrc.includes('findScopeRefs(finalPrompt'), 'aiAskImpl 下发前须扫描 finalPrompt');
  assert.ok(aiSrc.includes('awaitScopeConfirm'), '命中须问渲染层一次');
  assert.ok(aiSrc.includes('scopeConfirmPending'), '须有确认态忙门禁');
  assert.ok(/if\s*\(\s*shared\.activeExecution\s*\)/.test(aiSrc), '原 single-flight 门禁原文保留');
  assert.ok(aiSrc.includes("tag: 'SCOPE'"), '拒绝/超时须 SCOPE trace 注明');
  assert.ok(aiSrc.includes("error: 'scope-denied'"), '拒绝须中止下发');
  assert.ok(aiSrc.includes('仅沙箱内'), '超时须注明仅沙箱内放行');
  assert.ok(ctlSrc.includes("ipcMain.on('ai:scope-confirm'"), '回复通道须在 ai-controller（.on，不占 handle 计数）');
  assert.ok(!/handle\(['"]ai:scope-confirm/.test(ctlSrc), '不得用 handle 新增冻结通道');
  assert.ok(preSrc.includes('confirmScope'), 'preload 须暴露 confirmScope');
  assert.ok(paeSrc.includes("ev.type==='scope_confirm'"), '渲染层须接 scope_confirm 分支');
  assert.ok(paeSrc.includes("ev.type==='scope_confirm_dismiss'"), '渲染层须接撤框分支防孤儿遮罩');
  assert.ok(paeSrc.includes('function i5DismissScopeConfirm('), '缺撤框函数');
  assert.ok(paeSrc.includes('data-scope-id'), '遮罩须带 id 供精确移除');
  assert.ok(paeSrc.includes('function i5ShowScopeConfirm('), '缺确认弹窗函数');
  assert.ok(paeSrc.includes('confirmScope({ id:id'), '弹窗须经 confirmScope 回执');
  assert.ok(paeSrc.includes('允许本次') && paeSrc.includes('总是允许这类') && paeSrc.includes('拒绝'), '三选项文案');
  assert.ok(paeSrc.includes('i5PendingTools'), '须有 id 配对表');
  assert.ok(paeSrc.includes('完成·'), '完成须翻牌+耗时');
  assert.ok(paeSrc.includes('i5ThinkIdleText'), '思考占位须接计时器文案');
  assert.ok(paeSrc.includes('i5EnsureThinkIdle'), 'aiThinkTick 须确保占位行');
  // 74 冻结 intact（与 lint-guard 同口径复算）
  const contract = require(path.join(rootDir, 'main', 'ipc-contract.js'));
  assert.strictEqual(contract.IPC_CHANNELS.length, 74, 'contract 须 74（含 ai:open-terminal）');
  const got = new Set();
  for (const cf of fs.readdirSync(path.join(rootDir, 'main', 'controllers'))) {
    if (!cf.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(rootDir, 'main', 'controllers', cf), 'utf8');
    let m;
    const re = /handle\('([^']+)'/g;
    while ((m = re.exec(src))) got.add(m[1]);
  }
  assert.strictEqual(got.size, 74, 'controllers handle 须 74，实际' + got.size);
  assert.ok(contract.diffChannels(Array.from(got)).ok, '冻结一致性');
  console.log('[PASS] 确认/IPC/渲染接线（74 冻结 intact）');
})();

// ---- 9. 超时与回复（行为，短超时不卡死） ----
async function testConfirmBehavior() {
  // 生产 awaitScopeConfirm 内 timer 已 unref（不拖 Electron 退出），测试进程需自备 keepalive
  const keepAlive = setInterval(() => {}, 50);
  try {
  // 9a 无应答 → timeout（fail-open，不卡死）
  const sent = [];
  const t0 = Date.now();
  const d1 = await svc.awaitScopeConfirm((p) => sent.push(p), 'C:\\sbx\\proj', ['C:\\Windows\\x'], 30);
  assert.strictEqual(d1, 'timeout', '无应答须 timeout');
  assert.ok(Date.now() - t0 < 5000, '不得卡死');
  assert.strictEqual(sent.length, 2, '请求 + 撤框须各一次');
  assert.strictEqual(sent[0].type, 'scope_confirm', '请求复用 ai:event 信封 type=scope_confirm');
  assert.ok(Array.isArray(sent[0].hits) && sent[0].hits.length === 1, '请求须带 hits');
  assert.strictEqual(sent[1].type, 'scope_confirm_dismiss', '超时须补发撤框防遮罩孤儿');
  assert.strictEqual(sent[1].id, sent[0].id, '撤框须带同 id');
  // 9b 有回复 → 决议透传
  const d2 = await svc.awaitScopeConfirm((p) => {
    setTimeout(() => svc.handleScopeConfirmResponse({ id: p.id, decision: 'allow-always' }), 10);
  }, 'C:\\sbx\\proj', ['y'], 2000);
  assert.strictEqual(d2, 'allow-always', '回复须透传决议');
  assert.strictEqual(svc.scopeConfirmWaiters.size, 0, '解决后等待表须清空');
  // 9c 未知 id/非法值忽略
  assert.strictEqual(svc.handleScopeConfirmResponse({ id: 'no-such', decision: 'deny' }), false, '未知 id 须 false');
  assert.strictEqual(svc.handleScopeConfirmResponse(null), false, 'null 安全');
  // 9d 无发送能力 → 立即 timeout（不悬挂）
  const d4 = await svc.awaitScopeConfirm(null, 'C:\\sbx\\proj', ['z'], 120000);
  assert.strictEqual(d4, 'timeout', '无发送能力须立即 timeout');
  console.log('[PASS] 确认超时与回复行为');
  } finally {
    try { clearInterval(keepAlive); } catch (e) {}
  }
}

testConfirmBehavior().then(() => {
  try { svc.resetScopeConfirmForTest(); } catch (e) {}
  console.log('CONFIRM_PASS: 范围确认/配对/用量接线全绿');
}).catch((e) => {
  console.error('[FAIL] 确认超时与回复行为');
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});

// ---- 10. 上传文件树：仅原型三类文件 + 子页面可折叠（不同步改拉取） ----
(function testPushTreeFilterFold() {
  function ex(src, name) {
    const m = src.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
    assert.ok(m, '[提取失败] function ' + name);
    let i = m.index + m[0].length, depth = 1, q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(m.index, i + 1);
  }
  const factory = new Function(ex(paeSrc, 'gitPushVisibleFile') + '\n' + ex(paeSrc, 'gitFilterPushProjects') + '\n' + ex(paeSrc, 'gitSplitProtoFiles') + '\nreturn {gitPushVisibleFile, gitFilterPushProjects, gitSplitProtoFiles};')();
  // 过滤真值表
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/Q.html'), true, '原型html须显示');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/Q.md'), true, '原型md须显示');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/子页.html'), true, '子页面html须显示');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/links.json'), true, 'links须显示');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/annotations.json'), true, 'annotations须显示');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/最新需求.md'), true, '最新需求须显示');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/.context/history.md'), false, '会话历史md须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/.context/toolPrompt.md'), false, '提示词须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/.context/ui-spec.md'), false, '规范快照须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile('P/.pull-backup/a.html'), false, '拉取备份须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile('P/.heal-backup/a.html'), false, '自愈备份须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile('.gitignore'), false, '根gitignore须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile('P/Q/app.js'), false, '其他扩展名须隐藏');
  assert.strictEqual(factory.gitPushVisibleFile(''), false, '空路径须隐藏');
  // 整树过滤：空原型/空项目掉落
  const filtered = factory.gitFilterPushProjects([
    { project: 'P', isCurrent: true, protos: [
      { proto: 'Q', files: [{ path: 'P/Q/Q.html' }, { path: 'P/Q/.context/history.md' }] },
      { proto: '空', files: [{ path: 'P/空/.context/toolPrompt.md' }] }
    ] }
  ]);
  assert.strictEqual(filtered.length, 1, '须剩1个项目');
  assert.strictEqual(filtered[0].protos.length, 1, '须剩1个原型');
  assert.deepStrictEqual(filtered[0].protos[0].files.map(f => f.path), ['P/Q/Q.html'], '仅留原型文件');
  // 主/子拆分
  const sp = factory.gitSplitProtoFiles('Q', [{ path: 'P/Q/Q.html' }, { path: 'P/Q/Q.md' }, { path: 'P/Q/最新需求.md' }, { path: 'P/Q/links.json' }, { path: 'P/Q/子页.html' }, { path: 'P/Q/其它.md' }]);
  assert.deepStrictEqual(sp.main.map(f => f.path), ['P/Q/Q.html', 'P/Q/Q.md', 'P/Q/最新需求.md', 'P/Q/links.json'], '主文件常显');
  assert.deepStrictEqual(sp.sub.map(f => f.path), ['P/Q/子页.html', 'P/Q/其它.md'], '其余进子页面组');
  // 接线：上传走过滤+折叠，拉取不动
  assert.ok(/gitFilterPushProjects\(r\.projects\)/.test(paeSrc), '上传须先过滤再渲染');
  assert.ok(/'push', \{ ?subFold: true ?\}/.test(paeSrc), '上传须开子页面折叠');
  assert.ok(/git-sub-toggle/.test(paeSrc) && /git-sub-list/.test(paeSrc), '须有折叠行与子列表');
  const css = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
  assert.ok(/\.git-sub-toggle\s*\{/.test(css) && /\.git-sub-list \.git-tree-item/.test(css), '须有折叠样式');
  console.log('[PASS] 上传文件树过滤与子页面折叠');
})();
