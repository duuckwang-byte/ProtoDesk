// T7 门禁总控：串行跑全部 verify（纯 Node，无 Electron），任一失败 exitCode=1
// Phase0(方案A §12.3)：增加分组维度 core / legacy-ui / react-ui，PLAND_SUITE=core|legacy-ui|react-ui|all（默认 all）。
//   core      —— 主进程/IPC/ACP/安全/事件管线（pack、lint-guard、git-security、git-credential、static-verify、platform、
//                runtimes、acp-*、providers、ipc、model-management、session/事件/模型相关 verify）
//   legacy-ui —— 旧 原型+文档.html 渲染器断言（ui-integration、ui-specs、spec-uilib、doc-edit、docwin、
//                inline-edit、link-stamp、ctrl-release、history、sandbox-guard、rename、project-switch、
//                groups、terminal、edit-select、import-subpage、code-edit、prid、question-form 及其他旧渲染器断言）
//   react-ui  —— 新 Vitest/Playwright 套件；PoC 阶段为空，打印 SKIP 且不计失败。
// 加法原则：全部现有 suite 一律保留（不删不改名）；只增加分组映射、分组汇总与总汇总。
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

const SUITES = [
  ['pack', 'check-pack.js'],
  ['lint-guard', 'lint-guard.js'],
  ['git-security', 'verify-git-security.js'],
  ['git-credential', 'verify-git-credential.js'],
  ['static-verify', 'static-verify.js'],
  ['platform', 'verify-platform.js'],
  ['runtimes', 'verify-runtimes.js'],
  ['acp-capabilities', 'verify-acp-capabilities.js'],
  ['acp-mapper', 'verify-acp-mapper.js'],
  ['acp-permission', 'verify-acp-permission.js'],
  ['acp-errors', 'verify-acp-errors.js'],
  ['acp-runtime', 'verify-acp-runtime.js'],
  ['acp-resolution', 'verify-acp-resolution.js'],
  ['acp-config', 'verify-acp-config.js'],
  ['acp-config-apply', 'verify-acp-config-apply.js'],
  ['acp-config-ui', 'verify-acp-config-ui.js'],
  ['acp-session', 'verify-acp-session.js'],
  ['acp-wiring', 'verify-acp-wiring.js'],
  ['acp-ui-wiring', 'verify-acp-ui-wiring.js'],
  ['acp-permission-ui', 'verify-acp-permission-ui.js'],
  ['acp-settings-ui', 'verify-acp-settings-ui.js'],
  ['acp-model-cache', 'verify-acp-model-cache.js'],
  ['acp-models-nonblocking', 'verify-acp-models-nonblocking.js'],
  ['acp-catalog-ui', 'verify-acp-catalog-ui.js'],
  ['acp-model-probe', 'verify-acp-model-probe.js'],
  ['ai-thinking-cache', 'verify-ai-thinking-cache.js'],
  ['providers', 'verify-providers.js'],
  ['ipc', 'verify-ipc.js'],
  ['model-management', 'verify-model-management.js'],
  ['ui-integration', 'verify-ui-integration.js'],
  ['session-healing', 'verify-session-healing.js'],
  ['send-guard', 'verify-send-guard.js'],
  ['subpage-naming', 'verify-subpage-naming.js'],
  ['stdout-error-closure', 'verify-stdout-error-closure.js'],
  ['event-pipeline', 'verify-event-pipeline.js'],
  ['model-fetch', 'verify-model-fetch.js'],
  ['snapshot-restore', 'verify-snapshot-restore.js'],
  ['md-p1', 'verify-md-p1.js'],
  ['md-p2', 'verify-md-p2.js'],
  ['md-p3', 'verify-md-p3.js'],
  ['md-p4', 'verify-md-p4.js'],
  ['doc-edit', 'verify-doc-edit.js'],
  ['docwin', 'verify-docwin.js'],
  ['inline-edit', 'verify-inline-edit.js'],
  ['link-stamp', 'verify-link-stamp.js'],
  ['spec-uilib', 'verify-spec-uilib.js'],
  ['ui-specs', 'verify-ui-specs.js'],
  ['ctrl-release', 'verify-ctrl-release.js'],
  ['history', 'verify-history.js'],
  ['sandbox-guard', 'verify-sandbox-guard.js'],
  ['rename', 'verify-rename.js'],
  ['project-switch', 'verify-project-switch.js'],
  ['groups', 'verify-groups.js'],
  ['antigravity-lock', 'verify-antigravity-lock.js'],
  ['agy-stream', 'verify-agy-stream.js'],
  ['task-wiring', 'verify-task-wiring.js'],
  ['confirm-wiring', 'verify-confirm-wiring.js'],
  ['answer-placement', 'verify-answer-placement.js'],
  ['permission-modes', 'verify-permission-modes.js'],
  ['terminal', 'verify-terminal.js'],
  ['edit-select', 'verify-edit-select.js'],
  ['import-subpage', 'verify-import-subpage.js'],
  ['code-edit', 'verify-code-edit.js'],
  ['prid-inject', 'verify-prid-inject.js'],
  ['question-form', 'verify-question-form.js'],
];

// ---- Phase0 分组表（与实施方案 §12.3 对齐） ----
// acp-* 统一归 core（前缀判定，不逐条枚举）；以下为非 acp- 套件的显式归属。
// core 含 session/事件/模型相关：session-healing、send-guard、stdout-error-closure（进程边）、
// event-pipeline、model-fetch，以及 Agent/权限管线：antigravity-lock、agy-stream、task-wiring、
// confirm-wiring、permission-modes。
const CORE_EXACT = new Set([
  'pack', 'lint-guard', 'git-security', 'git-credential', 'static-verify', 'platform', 'runtimes',
  'providers', 'ipc', 'model-management', 'ai-thinking-cache',
  'session-healing', 'send-guard', 'stdout-error-closure', 'event-pipeline', 'model-fetch',
  'antigravity-lock', 'agy-stream', 'task-wiring', 'confirm-wiring', 'permission-modes',
]);
// legacy-ui：任务书点名 suite + 其他旧渲染器断言（md 文档管线、子页命名、快照、答案落位均为旧 HTML DOM 断言）。
const LEGACY_EXACT = new Set([
  'ui-integration', 'ui-specs', 'spec-uilib',
  'doc-edit', 'docwin', 'inline-edit', 'link-stamp', 'ctrl-release', 'history',
  'sandbox-guard', 'rename', 'project-switch', 'groups', 'terminal',
  'edit-select', 'import-subpage', 'code-edit', 'prid-inject', 'question-form',
  'subpage-naming', 'snapshot-restore', 'answer-placement',
  'md-p1', 'md-p2', 'md-p3', 'md-p4',
]);
// react-ui：新 Vitest/Playwright 套件登记处。PoC 阶段为空 → 打印 SKIP 且不计失败。
// TODO(Phase0 PoC)：脚手架落地后在此登记，如 ['renderer-unit', 'react-unit.js']，
// 以 node 垫片形式再调 vitest / playwright（runOne 保持 node 单通道）。
const REACT_SUITES = [];

function groupOf(name) {
  if (name.startsWith('acp-')) return 'core';
  if (CORE_EXACT.has(name)) return 'core';
  if (LEGACY_EXACT.has(name)) return 'legacy-ui';
  // 兜底：未知新 suite 暂归 legacy-ui，只 WARN 不失败（Karpathy：不确定的不断言失败）。
  console.log(`[WARN] 未登记分组的 suite，暂归 legacy-ui: ${name}（TODO：补分组表）`);
  return 'legacy-ui';
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function runOne(name, file) {
  const script = path.join(__dirname, file);
  console.log(`\n===== [${name}] node tests/${file} =====`);
  const r = spawnSync(NODE, [script], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120000,
  });
  let code;
  let note = '';
  if (r.error) {
    code = 1;
    note = String((r.error && r.error.message) || r.error);
    console.log(`[ERROR] ${name}: ${note}`);
  } else if (typeof r.status === 'number') {
    code = r.status;
    if (r.signal) note = `signal=${r.signal}`;
  } else {
    code = 1;
    note = r.signal ? `signal=${r.signal}` : 'no-status';
  }
  console.log(`----- [${name}] exit=${code}${note ? ' ' + note : ''} -----`);
  return { name, file, code };
}

function printTable(title, results) {
  const failed = results.filter((r) => r.code !== 0);
  console.log(`\n================ ${title} ================`);
  console.log(`| ${pad('suite', 22)} | ${pad('script', 32)} | ${pad('exit', 6)} | RESULT |`);
  console.log(`|${'-'.repeat(24)}|${'-'.repeat(34)}|${'-'.repeat(8)}|--------|`);
  for (const r of results) {
    const ok = r.code === 0;
    console.log(`| ${pad(r.name, 22)} | ${pad('tests/' + r.file, 32)} | ${pad(r.code, 6)} | ${ok ? 'PASS  ' : 'FAIL  '} |`);
  }
  console.log('========================================');
  console.log(`SUMMARY ${title}: total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) {
    console.log(`FAIL_SUITES(${title}): ` + failed.map((r) => `${r.name}(exit=${r.code})`).join(' '));
  }
  return failed;
}

function main() {
  const want = String(process.env.PLAND_SUITE || 'all').trim().toLowerCase();
  console.log(`run-all: Node=${process.version} platform=${process.platform} root=${ROOT} PLAND_SUITE=${want}`);
  if (want !== 'all' && want !== 'core' && want !== 'legacy-ui' && want !== 'react-ui') {
    console.log(`FAIL 未知分组 PLAND_SUITE=${JSON.stringify(process.env.PLAND_SUITE)}，允许 all|core|legacy-ui|react-ui`);
    process.exitCode = 1;
    return;
  }
  // 分组装配（自检覆盖：core + legacy-ui 必须等于全部现有 SUITES，只做加法不漏分）
  const groups = { 'core': [], 'legacy-ui': [], 'react-ui': REACT_SUITES.map(([n, f]) => [n, f]) };
  for (const [name, file] of SUITES) groups[groupOf(name)].push([name, file]);
  const mapped = groups['core'].length + groups['legacy-ui'].length;
  console.log(`GROUP_MAP core=${groups['core'].length} legacy-ui=${groups['legacy-ui'].length} react-ui=${groups['react-ui'].length} mapped=${mapped}/${SUITES.length}`);

  const order = want === 'all' ? ['core', 'legacy-ui', 'react-ui'] : [want];
  let allResults = [];
  let reactSkipped = false;
  for (const g of order) {
    if (g === 'react-ui' && groups['react-ui'].length === 0) {
      console.log('\n===== [react-ui] 新 Vitest/Playwright 套件 =====');
      console.log('SKIP react-ui: PoC 阶段套件为空，不计失败（TODO: Phase0 落实后在 REACT_SUITES 登记）');
      reactSkipped = true;
      continue;
    }
    console.log(`\n########## GROUP [${g}] (${groups[g].length} suites) ##########`);
    const results = groups[g].map(([name, file]) => runOne(name, file));
    printTable(`分组 ${g}`, results);
    allResults = allResults.concat(results);
  }

  const failed = allResults.filter((r) => r.code !== 0);
  console.log('\n================ 总览 ================');
  console.log(`| ${pad('suite', 22)} | ${pad('script', 32)} | ${pad('exit', 6)} | RESULT |`);
  console.log(`|${'-'.repeat(24)}|${'-'.repeat(34)}|${'-'.repeat(8)}|--------|`);
  for (const r of allResults) {
    const ok = r.code === 0;
    console.log(`| ${pad(r.name, 22)} | ${pad('tests/' + r.file, 32)} | ${pad(r.code, 6)} | ${ok ? 'PASS  ' : 'FAIL  '} |`);
  }
  console.log('========================================');
  console.log(`SUMMARY total=${allResults.length} pass=${allResults.length - failed.length} fail=${failed.length} react-ui=${reactSkipped ? 'SKIP' : 'run'}`);
  if (failed.length) {
    console.log('FAIL_SUITES: ' + failed.map((r) => `${r.name}(exit=${r.code})`).join(' '));
  } else if (reactSkipped) {
    console.log('ALL_PASS(core+legacy) + react-ui SKIP');
  } else {
    console.log('ALL_PASS');
  }
  process.exitCode = failed.length ? 1 : 0;
}

main();
