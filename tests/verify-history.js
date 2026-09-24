'use strict';
// history 切 tab 归档 + 100KB 告警接线验证（纯 Node，不启动 Electron，cwd=临时目录）
// 覆盖：归档命名清洗 / 切 tab 旧文件被归档且新文件从第1轮开始 / alarm 超限为 true / 并发单 flight 不交错（说明性）
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const aiSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'ai-process-service.js'), 'utf8');
const svc = require(path.join(rootDir, 'main', 'services', 'ai-process-service.js'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmDir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
}

// ---- 1. 归档命名清洗 ----
(function testSanitize() {
  assert.strictEqual(typeof svc.sanitizeArchiveTabId, 'function', '缺 sanitizeArchiveTabId');
  assert.strictEqual(svc.sanitizeArchiveTabId('s_abc-123'), 's_abc-123', '合法 tab 原样');
  assert.strictEqual(svc.sanitizeArchiveTabId('s_abc_123-XYZ'), 's_abc_123-XYZ', '字母数字-_保留');
  // 非法字符全剥离（路径穿越/冒号/问号/点/斜杠）
  assert.strictEqual(svc.sanitizeArchiveTabId('../../evil:tab?id=1'), 'eviltabid1', '非法字符剥离');
  assert.strictEqual(svc.sanitizeArchiveTabId('a/b\\c:d.e?f*g'), 'abcdefg', '分隔符剥离');
  assert.strictEqual(svc.sanitizeArchiveTabId('s_123 中文!@#'), 's_123', '中文/符号剥离');
  // 截断 64
  const long = svc.sanitizeArchiveTabId('a'.repeat(100));
  assert.strictEqual(long.length, 64, '超长截断64，实际' + long.length);
  assert.strictEqual(svc.sanitizeArchiveTabId('').length > 0, true, '空回落非空');
  assert.strictEqual(svc.sanitizeArchiveTabId(''), 'unknown', '空回落 unknown');
  assert.strictEqual(svc.sanitizeArchiveTabId('***'), 'unknown', '全非法回落 unknown');
  assert.strictEqual(svc.sanitizeArchiveTabId(null), 'unknown', 'null 回落 unknown');
  // 归档路径拼装
  const p = svc.historyArchivePath('/tmp/cwdX', 's_old');
  assert.ok(p && p.endsWith(path.join('.context', 'archive', 's_old.md')), '归档路径须为 .context/archive/<tab>.md，实际' + p);
  console.log('[PASS] 归档命名清洗');
})();

// ---- 2. 切 tab 旧文件被归档且新文件从第1轮开始（直调临时目录） ----
(function testArchiveSwitch() {
  try { svc.lastTabByCwd.clear(); } catch (e) {}
  const cwd = mkTmp('hist-arch-');
  try {
    assert.ok(svc.buildHistoryPointer(cwd).includes('暂无历史记录'), '新盘须空指针');
    svc.appendHistoryRound(cwd, { user: 'u1', answer: 'a1', fileChanges: [] });
    // 首次见 tabA：只建映射，不归档
    let r1 = svc.maybeArchiveHistoryOnTabSwitch(cwd, 's_tabA');
    assert.strictEqual(r1.archived, false, '首次 tab 不归档');
    assert.strictEqual(svc.readHistoryScale(cwd).rounds, 1, '仍1轮');
    svc.appendHistoryRound(cwd, { user: 'u2', answer: 'a2', fileChanges: [] });
    assert.strictEqual(svc.readHistoryScale(cwd).rounds, 2, '应计2轮');
    // 切到 tabB：旧 history 归档到 archive/s_tabA.md
    const r2 = svc.maybeArchiveHistoryOnTabSwitch(cwd, 's_tabB');
    assert.strictEqual(r2.archived, true, '切 tab 须归档');
    const hist = path.join(cwd, '.context', 'history.md');
    const arch = path.join(cwd, '.context', 'archive', 's_tabA.md');
    assert.ok(!fs.existsSync(hist), '归档后 history.md 须消失（新任务从空开始）');
    assert.ok(fs.existsSync(arch), '归档文件须存在');
    const archText = fs.readFileSync(arch, 'utf8');
    assert.ok(archText.includes('## 第1轮') && archText.includes('## 第2轮'), '归档须含旧2轮');
    assert.strictEqual(svc.readHistoryScale(cwd).rounds, 0, '新盘规模须归零');
    // 新 tab 首轮 append 从第1轮开始
    svc.appendHistoryRound(cwd, { user: 'u3', answer: 'a3', fileChanges: [] });
    const sc = svc.readHistoryScale(cwd);
    assert.strictEqual(sc.rounds, 1, '新文件须从第1轮开始，实际' + sc.rounds);
    const nt = fs.readFileSync(hist, 'utf8');
    assert.ok(nt.includes('## 第1轮') && !nt.includes('## 第2轮') && !nt.includes('## 第3轮'), '新文件轮号须从1重计');
    // 同 tab 重复下发不归档
    const r3 = svc.maybeArchiveHistoryOnTabSwitch(cwd, 's_tabB');
    assert.strictEqual(r3.archived, false, '同 tab 不归档');
    assert.ok(fs.existsSync(hist), '同 tab 不得删除 history');
    // 无 tabId / 空 history 不归档不抛错
    const cwd2 = mkTmp('hist-empty-');
    try {
      svc.maybeArchiveHistoryOnTabSwitch(cwd2, 's_A');
      const r4 = svc.maybeArchiveHistoryOnTabSwitch(cwd2, 's_B');
      assert.strictEqual(r4.archived, false, '空 history 不归档');
      assert.doesNotThrow(() => svc.maybeArchiveHistoryOnTabSwitch(cwd2, ''), '空 tab 不抛错');
      assert.doesNotThrow(() => svc.maybeArchiveHistoryOnTabSwitch(cwd2, null), 'null tab 不抛错');
    } finally { rmDir(cwd2); }
    console.log('[PASS] 切 tab 旧文件被归档且新文件从第1轮开始');
  } finally { rmDir(cwd); try { svc.lastTabByCwd.clear(); } catch (e) {} }
})();

// ---- 2b. 子进程（cwd=临时目录）验证：不启动 Electron 照样归档 ----
(function testSubprocess() {
  const tmp = mkTmp('hist-sub-');
  const child = `
const path=require('path'),fs=require('fs'),assert=require('assert');
const ROOT=process.env.PLAND_ROOT;
const svc=require(path.join(ROOT,'main/services/ai-process-service.js'));
assert.strictEqual(svc.sanitizeArchiveTabId('s_a/../b'), 's_ab', '清洗');
svc.appendHistoryRound(process.cwd(),{user:'u',answer:'a',fileChanges:[]});
svc.maybeArchiveHistoryOnTabSwitch(process.cwd(),'s_first');
svc.appendHistoryRound(process.cwd(),{user:'u2',answer:'a2',fileChanges:[]});
const r=svc.maybeArchiveHistoryOnTabSwitch(process.cwd(),'s_second');
assert.strictEqual(r.archived,true,'子进程切 tab 须归档');
assert.ok(!fs.existsSync(path.join(process.cwd(),'.context','history.md')),'子进程归档后须空');
assert.ok(fs.existsSync(path.join(process.cwd(),'.context','archive','s_first.md')),'子进程归档文件须在');
svc.appendHistoryRound(process.cwd(),{user:'u3',answer:'a3',fileChanges:[]});
assert.strictEqual(svc.readHistoryScale(process.cwd()).rounds,1,'子进程新文件从1开始');
console.log('CHILD_ALL_PASS');
`;
  const r = spawnSync(process.execPath, ['-e', child], {
    cwd: tmp, env: { ...process.env, PLAND_ROOT: rootDir }, encoding: 'utf8', timeout: 60000,
  });
  rmDir(tmp);
  try { svc.lastTabByCwd.clear(); } catch (e) {}
  assert.strictEqual(r.status, 0, '子进程退出码\nSTDOUT:\n' + (r.stdout || '') + '\nSTDERR:\n' + (r.stderr || ''));
  assert.ok((r.stdout || '').includes('CHILD_ALL_PASS'), '子进程须全过\n' + (r.stdout || '') + (r.stderr || ''));
  console.log('[PASS] 子进程临时目录归档');
})();

// ---- 3. alarm 标志超限为 true（小文件 false） ----
(function testAlarm() {
  assert.strictEqual(svc.HISTORY_ALARM_BYTES, 100 * 1024, '观测线须为100KB');
  const cwd = mkTmp('hist-alarm-');
  try {
    const s1 = svc.appendHistoryRound(cwd, { user: 'hi', answer: 'ok', fileChanges: [] });
    assert.strictEqual(s1.ok, true, '小文件 append ok');
    assert.strictEqual(s1.alarm, false, '小文件 alarm 须 false');
    // 垫大到超限再 append
    const f = svc.historyFilePath(cwd);
    fs.appendFileSync(f, 'x'.repeat(110 * 1024), 'utf8');
    const s2 = svc.appendHistoryRound(cwd, { user: 'big', answer: 'big', fileChanges: [] });
    assert.strictEqual(s2.ok, true, '超限 append ok');
    assert.strictEqual(s2.alarm, true, '超限 alarm 须 true');
    assert.ok(fs.statSync(f).size > 100 * 1024, '文件确超100KB');
    console.log('[PASS] alarm 超限为 true');
  } finally { rmDir(cwd); }
})();

// ---- 3c. 摘要不断句：120 目标、波动到句末、上限 170 ----
(function testSummaryCut() {
  assert.strictEqual(typeof svc.cutSummaryLine, 'function', '缺 cutSummaryLine');
  assert.strictEqual(svc.SUMMARY_SOFT_LEN, 120, '目标须 120');
  assert.strictEqual(svc.SUMMARY_HARD_LEN, 170, '上限须 170');
  assert.strictEqual(svc.cutSummaryLine('短句。'), '短句。', '短文本原样');
  const longNoPunct = 'x'.repeat(200);
  assert.strictEqual(svc.cutSummaryLine(longNoPunct).length, 120, '无标点超长在目标处硬切');
  // 句末在波动窗内：收到句末含标点
  const s = '前'.repeat(120) + '中。' + '后'.repeat(60);
  const cut = svc.cutSummaryLine(s);
  assert.ok(cut.endsWith('中。'), '须收到波动窗内句末，实际尾部' + cut.slice(-8));
  assert.ok(cut.length > 120 && cut.length <= 170, '长度须在波动窗内，实际' + cut.length);
  // 句末超出上限：回落硬切
  const far = '前'.repeat(120) + '无标点' + 'x'.repeat(80) + '。尾';
  assert.strictEqual(svc.cutSummaryLine(far).length, 120, '窗外无句末回落硬切');
  console.log('[PASS] 摘要不断句');
})();

// ---- 3b. 告警接线静态：消费 alarm、复用 trace、无新通道、一次性 ----
(function testAlarmWiring() {
  assert.ok(aiSrc.includes('maybeArchiveHistoryOnTabSwitch(cwd, extraOpts && extraOpts.uiSessionId)'), 'aiAskImpl 须在下发前调归档（uiSessionId）');
  assert.ok(aiSrc.includes('historyAlarmWarned'), '须有一文件一次集合');
  assert.ok(/hr\s*&&\s*hr\.alarm/.test(aiSrc), 'onClose 须消费 appendHistoryRound 的 alarm');
  assert.ok(aiSrc.includes("type: 'trace'") && aiSrc.includes('HISTORY'), '告警须复用 ai:event trace 通道（HISTORY）');
  assert.ok(aiSrc.includes("level: 'warn'") || aiSrc.includes('level:"warn"'), '告警须为 warn 级');
  assert.ok(aiSrc.includes('选择理由') || aiSrc.includes('通道选择理由'), '须在注释写明通道选择理由');
  assert.ok(!/ipcMain\.handle\(['"]ai:history/.test(aiSrc), '不得新增 IPC 通道');
  assert.ok(!/ipcMain\.handle\(['"]history/.test(aiSrc), '不得新增 history 通道');
  console.log('[PASS] 告警接线（trace 复用/一次性/无新通道）');
})();

// ---- 4. 并发单 flight 不交错（说明性断言） ----
(function testSingleFlight() {
  // 4a 单 flight 门禁仍在：忙时直接回 busy，不会并发下发导致 history 交错
  assert.ok(/if\s*\(\s*shared\.activeExecution\s*\)/.test(aiSrc), 'aiAskImpl 须保留 single-flight 忙门禁');
  // 4b 落盘原子性：appendHistoryRound 用 appendFileSync 同步追加（单线程内不可交错）
  assert.ok(aiSrc.includes('appendFileSync'), 'history 落盘须用同步追加（appendFileSync）');
  // 4c 行为：10 次快速连续 append 轮号严格 1..10 有序、无丢失无交错
  const cwd = mkTmp('hist-conc-');
  try {
    for (let i = 0; i < 10; i++) svc.appendHistoryRound(cwd, { user: 'u' + i, answer: 'a' + i, fileChanges: [] });
    const sc = svc.readHistoryScale(cwd);
    assert.strictEqual(sc.rounds, 10, '10 次连续 append 应计10轮，实际' + sc.rounds);
    const text = fs.readFileSync(svc.historyFilePath(cwd), 'utf8');
    const seq = [...text.matchAll(/^## 第(\d+)轮/mg)].map((m) => Number(m[1]));
    assert.deepStrictEqual(seq, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '轮号须严格有序 1..10，实际' + JSON.stringify(seq));
    console.log('[PASS] 并发单 flight 不交错（说明性：忙门禁+同步追加+轮号有序）');
  } finally { rmDir(cwd); }
})();

console.log('HISTORY_PASS: 切 tab 归档与告警接线全绿');
