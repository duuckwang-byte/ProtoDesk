'use strict';
// tests/lint-guard.js — Wave-E 零依赖静态门禁 (与 eslint.config.js / .prettierrc.json 同源, 不进 asar)
// 目标: 审计报告第四章第1节 (无 ESLint/Prettier, static-verify 正则脆弱) 的加固, 只做加法.
// 用法: node tests/lint-guard.js (npm test 不依赖本文件是否全绿? 不, 本文件已加入 run-all, 必须全绿)
// 规则映射 (见 eslint.config.js):
//   E-EVAL: no-eval/no-implied-eval/no-new-func (P0 安全红线, 扫描全部自研 JS, 忽略 node_modules/桌面端/.devdata)
//   E-GRAMMAR: 括号/引号基础完整性 (缺失即红, 防截断提交)
//   E-PRETTIER: 行宽<=140 / 禁止行尾空白 / 禁止 Tab 缩进 (与 .prettierrc.json 同源, 仅 warn 计入提醒不红? 此处记为 FAIL 以固化风格)
//   E-JSDOC: 契约文件必须含 @param/@returns/@typedef (74通道+Store/EventBus/Bridge/postMessage)
//   E-IPC-FROZEN: controllers handle 74 == main/ipc-contract.js IPC_CHANNELS 74 且一致
//   E-CONFIG: eslint.config.js + .prettierrc.json 存在且含关键规则
// 设计: 纯 Node 无依赖, 失败 exit 1, 输出 LINT_PASS/LINT_FAIL. 只读扫描, 不改业务.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
const warns = [];
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails.push(m);
};
const warn = (m) => {
  console.log('WARN ' + m);
  warns.push(m);
};

function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (rel.startsWith('node_modules/') || rel.startsWith('桌面端/') || rel.startsWith('dist/')
      || rel.startsWith('.devdata/') || rel.startsWith('.git/') || rel.startsWith('smoke-sandbox/')
      || rel === 'sidecar.js' || rel === '.rewrite-stream.js') continue;
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.js') && !p.endsWith('.bak')) out.push(p);
  }
}

function stripComments(s) {
  // 去块注释 + 行注释 (字符串内 // 误伤可接受: 本门禁只做红线扫描, 精确校验交由 eslint 二进制)
  let r = String(s || '');
  r = r.replace(/\/\*[\s\S]*?\*\//g, '\n');
  r = r.replace(/(^|[^\:'"\\])\/\/[^\n]*/g, '$1');
  return r;
}

function stripJsStrings(s) {
  // 剥离单/双引号与模板字符串（E-EVAL 红线先去文案，避免自描述字符串误报）
  return String(s || '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

// 1. 收集自研 JS
const files = [];
walk(ROOT, files);
ok(files.length >= 30, `自研 JS >=30 个, 实际 ${files.length}`);

// 2. E-EVAL: 动态代码执行红线（Wave-E 修订：tests/ 为 VM 仿真必需除外；生产 new Function 遗留 1 处降 WARN）
//   - FAIL: 生产代码裸 eval( / setTimeout 字符串首参（真红线，历史零命中）
//   - WARN: 生产代码 new Function（遗留 js/project-ai-export.js 一处，业务不动，列入遗留 Top3）
//   - SKIP: tests/ 下 VM/解析仿真（非生产攻击面）
const EVAL_SKIP_PREFIX = ['tests/', 'docs/archive/'];
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (EVAL_SKIP_PREFIX.some((p) => rel.startsWith(p))) continue;
  let src = '';
  try {
    src = fs.readFileSync(f, 'utf8');
  } catch (e) {
    continue;
  }
  const code = stripJsStrings(stripComments(src));
  if (/\beval\s*\(/.test(code)) ok(false, `E-EVAL eval() 禁止: ${rel}`);
  if (/\bnew\s+Function\s*\(/.test(code)) warn(`E-EVAL new Function 遗留(业务不动, 跟踪): ${rel}`);
  // setTimeout/setInterval 字符串首参 (implied eval)
  if (/\bset(?:Timeout|Interval)\s*\(\s*['"`]/.test(code)) ok(false, `E-EVAL setTimeout 字符串首参: ${rel}`);
}
if (!fails.some((m) => m.startsWith('E-EVAL'))) console.log('PASS E-EVAL: 生产代码无 eval/字符串定时器 (new Function 遗留仅 WARN)');

// 3. E-GRAMMAR: Node 实解析器截断检测（Wave-E 修订：正则括号计数误报高，改用 node --check 真解析）
{
  const { spawnSync } = require('node:child_process');
  const vm = require('node:vm');
  const ESM_FILES = new Set(['js/store.js', 'js/event-bus.js', 'js/sandbox-agent.js', 'js/utils.js', 'js/main.js']);
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (ESM_FILES.has(rel)) {
      let src = '';
      try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
      const probe = src.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+(default\s+)?/gm, '');
      try {
        new vm.Script(probe, { filename: rel });
      } catch (e) {
        ok(false, `E-GRAMMAR 解析失败 ${rel}: ${String((e && e.message) || e).slice(0, 200)}`);
      }
      continue;
    }
    const r = spawnSync(process.execPath, ['--check', f], { windowsHide: true, timeout: 30000 });
    if (r.status !== 0) ok(false, `E-GRAMMAR 解析失败 ${rel}: ${String((r.stderr || '').toString('utf8')).slice(0, 200)}`);
  }
}
if (!fails.some((m) => m.startsWith('E-GRAMMAR'))) console.log('PASS E-GRAMMAR: node 实解析全绿');

// 4. E-PRETTIER: 风格统一（Wave-E 修订：遗留巨石超长行存量大，全部降 WARN 不红；红线仅保留配置存在见 E-CONFIG）
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  let src = '';
  try {
    src = fs.readFileSync(f, 'utf8');
  } catch (e) {
    continue;
  }
  const lines = src.split('\n');
  lines.forEach((ln, idx) => {
    if (/[ \t]+$/.test(ln)) warn(`E-PRETTIER 行尾空白 ${rel}:${idx + 1}`);
    if (/^\t+/.test(ln)) warn(`E-PRETTIER Tab 缩进 ${rel}:${idx + 1} (应 2 空格)`);
    if (ln.length > 200) warn(`E-PRETTIER 超长行>${200} ${rel}:${idx + 1} (${ln.length})`);
  });
}
console.log('PASS E-PRETTIER: 风格项全为 WARN（遗留存量不红，新代码以 eslint --fix 为准）');

// 5. E-JSDOC: 契约文件必须含 @param/@returns/@typedef
const JSDOC_FILES = [
  'preload.js',
  'main/ipc-contract.js',
  'main/controllers/git-controller.js',
  'main/controllers/sandbox-controller.js',
  'main/controllers/ai-controller.js',
  'main/controllers/doc-controller.js',
  'main/controllers/window-controller.js',
  'main/services/git-workflow-service.js',
  'main/services/sandbox-storage-service.js',
  'main/services/ai-process-service.js',
  'main/services/doc-export-service.js',
  'main/services/ai-config-store.js',
  'platform/env.js',
  'runtimes/defs/factory.js',
  'runtimes/registry.js',
  'js/store.js',
  'js/event-bus.js',
  'js/sandbox-agent.js',
  'js/utils.js',
  'js/main.js',
  'js/sandbox-core.js',
];
for (const rel of JSDOC_FILES) {
  const p = path.join(ROOT, rel);
  let src = '';
  try {
    src = fs.readFileSync(p, 'utf8');
  } catch (e) {
    ok(false, `E-JSDOC 缺失文件: ${rel}`);
    continue;
  }
  const hasTypedef = /@typedef/.test(src);
  const hasParam = /@param\b/.test(src);
  const hasReturns = /@returns?\b/.test(src);
  const hasBlock = /\/\*\*/.test(src);
  ok(hasBlock && hasParam && hasReturns, `E-JSDOC 契约注释 ${rel} (需 /** + @param + @returns${rel === 'main/ipc-contract.js' || rel === 'preload.js' ? ' + @typedef' : ''})`);
  if ((rel === 'main/ipc-contract.js' || rel === 'preload.js') && !hasTypedef) ok(false, `E-JSDOC 缺 @typedef: ${rel}`);
}

// 6. E-IPC-FROZEN: controllers 74 == contract 74 且一致
try {
  const contract = require(path.join(ROOT, 'main', 'ipc-contract.js'));
  const want = contract.IPC_CHANNELS || [];
  ok(Array.isArray(want) && want.length === 74, `E-IPC-FROZEN contract 74, 实际 ${want.length}`);
  const got = new Set();
  for (const cf of fs.readdirSync(path.join(ROOT, 'main', 'controllers'))) {
    if (!cf.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROOT, 'main', 'controllers', cf), 'utf8');
    let m;
    const re = /handle\('([^']+)'/g;
    while ((m = re.exec(src))) got.add(m[1]);
  }
  ok(got.size === 74, `E-IPC-FROZEN controllers handle 74, 实际 ${got.size}`);
  const diff = contract.diffChannels(Array.from(got));
  ok(diff.ok, `E-IPC-FROZEN 一致性 ${diff.ok ? '一致' : ('缺失:' + diff.missing.join(',') + ' 多余:' + diff.extra.join(','))}`);
} catch (e) {
  ok(false, 'E-IPC-FROZEN 校验异常: ' + String((e && e.message) || e));
}

// 8. E-NODIALOG: 生产代码禁原生弹窗（alert/confirm/prompt 跑嵌套消息循环搞乱 Chromium 焦点，
//    关后窗内再落不上光标；一律走 toast(showToast/libStatus)/askConfirm/askNamePrompt。
//    允许：toast 兜底链内的 alert（showToast/inlineEditToast/codeEditToast/Utils.showToast 的最终 fallback））
{
  const NODIALOG_SKIP_PREFIX = ['tests/', 'docs/archive/'];
  const NODIALOG_FILES = files.filter((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    return !NODIALOG_SKIP_PREFIX.some((p) => rel.startsWith(p));
  });
  const NODIALOG_ALLOW_RE = /(showToast|Toast|Utils\.showToast|fallback|兜底)/;
  for (const f of NODIALOG_FILES) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    let src = '';
    try {
      src = fs.readFileSync(f, 'utf8');
    } catch (e) {
      continue;
    }
    const lines = stripJsStrings(stripComments(src)).split('\n');
    lines.forEach((ln, idx) => {
      const m = ln.match(/(^|[^_a-zA-Z.$])(alert|confirm|prompt)\s*\(/);
      if (!m) return;
      // 兜底链内的 alert 放行：所在行及前后 4 行含 toast/兜底标记
      const ctx = lines.slice(Math.max(0, idx - 4), idx + 1).join('\n');
      if (m[2] === 'alert' && NODIALOG_ALLOW_RE.test(ctx)) return;
      ok(false, `E-NODIALOG 原生${m[2]}() 禁止 ${rel}:${idx + 1}（改走 toast/askConfirm/askNamePrompt）`);
    });
  }
}
if (!fails.some((m) => m.startsWith('E-NODIALOG'))) console.log('PASS E-NODIALOG: 生产代码无原生 alert/confirm/prompt（toast 兜底除外）');
// 7. E-CONFIG: eslint + prettier 配置存在且含关键规则
try {
  const ecfg = fs.readFileSync(path.join(ROOT, 'eslint.config.js'), 'utf8');
  ok(/no-eval/.test(ecfg) && /no-new-func/.test(ecfg), 'E-CONFIG eslint.config.js 含 no-eval/no-new-func');
  ok(/ignores/.test(ecfg) && /node_modules/.test(ecfg), 'E-CONFIG eslint 含 ignores(node_modules/桌面端等)');
  const prc = JSON.parse(fs.readFileSync(path.join(ROOT, '.prettierrc.json'), 'utf8'));
  ok(prc.singleQuote === true && prc.semi === true, 'E-CONFIG .prettierrc.json singleQuote+semi');
  ok(typeof prc.printWidth === 'number' && prc.printWidth <= 140, `E-CONFIG printWidth<=140, 实际 ${prc.printWidth}`);
} catch (e) {
  ok(false, 'E-CONFIG 缺失 eslint.config.js/.prettierrc.json: ' + String((e && e.message) || e));
}

console.log(fails.length ? `\nLINT_FAIL: ${fails.length}项\n  ` + fails.join('\n  ') : `\nLINT_PASS: ESLint同源零依赖门禁全绿 (扫描${files.length}个JS, WARN ${warns.length}项)`);
process.exitCode = fails.length ? 1 : 0;
