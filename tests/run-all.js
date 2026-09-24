// T7 门禁总控：串行跑全部 verify（纯 Node，无 Electron），任一失败 exitCode=1
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

const SUITES = [
  ['pack', 'check-pack.js'],
  ['lint-guard', 'lint-guard.js'],
  ['git-security', 'verify-git-security.js'],
  ['static-verify', 'static-verify.js'],
  ['platform', 'verify-platform.js'],
  ['runtimes', 'verify-runtimes.js'],
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
  ['groups', 'verify-groups.js'],
  ['antigravity-lock', 'verify-antigravity-lock.js'],
  ['agy-stream', 'verify-agy-stream.js'],
  ['task-wiring', 'verify-task-wiring.js'],
  ['confirm-wiring', 'verify-confirm-wiring.js'],
  ['answer-placement', 'verify-answer-placement.js'],
  ['permission-modes', 'verify-permission-modes.js'],
  ['terminal', 'verify-terminal.js'],
  ['remote-send', 'verify-remote-send.js'],
  ['edit-select', 'verify-edit-select.js'],
  ['import-subpage', 'verify-import-subpage.js'],
  ['code-edit', 'verify-code-edit.js'],
];

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

function main() {
  console.log(`run-all: Node=${process.version} platform=${process.platform} root=${ROOT}`);
  const results = SUITES.map(([name, file]) => runOne(name, file));
  const failed = results.filter((r) => r.code !== 0);

  console.log('\n================ 总览 ================');
  console.log(`| ${pad('suite', 22)} | ${pad('script', 32)} | ${pad('exit', 6)} | RESULT |`);
  console.log(`|${'-'.repeat(24)}|${'-'.repeat(34)}|${'-'.repeat(8)}|--------|`);
  for (const r of results) {
    const ok = r.code === 0;
    console.log(`| ${pad(r.name, 22)} | ${pad('tests/' + r.file, 32)} | ${pad(r.code, 6)} | ${ok ? 'PASS  ' : 'FAIL  '} |`);
  }
  console.log('========================================');
  console.log(`SUMMARY total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) {
    console.log('FAIL_SUITES: ' + failed.map((r) => `${r.name}(exit=${r.code})`).join(' '));
  } else {
    console.log('ALL_PASS');
  }
  process.exitCode = failed.length ? 1 : 0;
}

main();
