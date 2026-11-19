// T5.1 打包完整性门禁: node tests/check-pack.js
// 遍历 build.files 白名单展开，对比生产 require 边 + HTML/EXPORT + 违禁项。缺失即 exit 1。
// Phase0(方案A §12.3/§5.4，与主进程智能体C约定)：mode-aware ——
//   legacy-only（dist/renderer/index.html 不存在）：保留旧 18 script / app.css / fetchText / EXPORT 断言；
//     白名单 dist/renderer/** 与 main 双入口新字面量缺失只报 SKIP（TODO，不计失败）。
//   react+legacy（dist 已构建）：额外断言 dist 产物与 export-assets 落位，main 双入口新字面量转硬断言。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const skip = (m) => { console.log('SKIP ' + m); };
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// 0.渲染器模式判定（Phase0 双渲染器并行 §10.1：dist 存在=react+legacy，否则 legacy-only）
const DIST_INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const HAS_DIST = fs.existsSync(DIST_INDEX);
console.log((HAS_DIST ? 'PASS ' : 'SKIP ') + `渲染器模式: ${HAS_DIST ? 'react+legacy（dist/renderer 已构建）' : 'legacy-only（dist/renderer 未构建，PoC 前预期）'}`);

// 1.读白名单（Phase0：改为“必需项存在”断言，不再硬编码总数 18；缺哪个报哪个）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const filesList = (((pkg || {}).build || {}).files || []);
console.log(`INFO 白名单共${filesList.length}条`);
const LEGACY_REQUIRED = ['main.js', 'main/**', 'preload.js', 'app.css', 'js/**',
  'runtimes/**', 'providers/**', 'platform/**', 'git/**',
  '原型+文档.html', 'toolPrompt.md', 'design-specs/**'];
for (const need of LEGACY_REQUIRED) ok(filesList.includes(need), `白名单保留legacy: ${need}`);
if (filesList.includes('dist/renderer/**')) ok(true, '白名单新增 dist/renderer/**（React 产物随包）');
else skip('白名单暂缺 dist/renderer/**（legacy-only 预期，TODO: 脚手架落地后加入 build.files）');

// 2.展开白名单 -> Set<rel>
// 负向模式两类合法：.bak 清理（历史约定）与 node_modules 瘦身剪枝（P2-2，仅允许 **/node_modules/ 前缀，
// 防止借剪枝名义排除运行时必需文件）。其余任何 `!` 条目一律失败。
const isNodeModulesPrune = n => /^!\*\*\/node_modules\/.+/.test(n);
const isLegalExclusion = n => n.includes('.bak') || isNodeModulesPrune(n);
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.add(rel(p));
  }
}
const covered = new Set();
for (const pat of filesList) {
  const n = String(pat).replace(/\\/g, '/');
  if (n.startsWith('!')) {
    ok(isLegalExclusion(n), `排除项 ${n}`);
    continue;
  }
  if (n.endsWith('/**')) {
    const d = path.join(ROOT, n.slice(0, -3));
    if (fs.existsSync(d)) walk(d, covered);
    else ok(false, `白名单目录不存在: ${n}`);
  } else {
    const f = path.join(ROOT, n);
    if (fs.existsSync(f)) covered.add(n);
    else ok(false, `白名单文件缺失: ${n}`);
  }
}

// 3.收集相对 require 边
const REQ = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
function jsFiles(dirs) {
  const out = [];
  const q = dirs.map(d => path.join(ROOT, d));
  while (q.length) {
    const cur = q.pop();
    if (!fs.existsSync(cur)) continue;
    const st = fs.statSync(cur);
    if (st.isFile() && cur.endsWith('.js')) out.push(cur);
    else if (st.isDirectory()) for (const e of fs.readdirSync(cur)) q.push(path.join(cur, e));
  }
  return out;
}
const scope = ['runtimes', 'providers', 'platform'];
const targets = [path.join(ROOT, 'main.js'), path.join(ROOT, 'preload.js'), ...jsFiles(scope)];
for (const f of targets) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = REQ.exec(src))) {
    const req = m[1];
    const abs = path.normalize(path.join(path.dirname(f), req));
    let cand = abs;
    if (!path.extname(cand)) {
      if (fs.existsSync(cand + '.js')) cand = cand + '.js';
      else if (fs.existsSync(path.join(cand, 'index.js'))) cand = path.join(cand, 'index.js');
    }
    const r = rel(cand);
    const exists = fs.existsSync(cand);
    ok(exists, `存在 ${rel(f)} -> ${req} (${r})`);
    if (exists) ok(covered.has(r), `覆盖 ${r} <= 白名单`);
  }
}

// 4.HTML 引用 vs EXPORT 清单 vs fetchText（legacy 基线保留；dist 存在时额外断言 React 产物）
const html = fs.readFileSync(path.join(ROOT, '原型+文档.html'), 'utf8');
const htmlScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(x => x[1].replace(/\\/g, '/'));
const htmlCss = [...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map(x => x[1].replace(/\\/g, '/'));
const expSrc = fs.readFileSync(path.join(ROOT, 'js', 'project-ai-export.js'), 'utf8');
const expM = expSrc.match(/var EXPORT_SCRIPT_FILES\s*=\s*(\[[^\]]*\])/);
const expList = expM ? eval(expM[1]) : [];
ok(htmlScripts.length === 18, `HTML script 18个(16经典+utils/store ESM, Wave-D/G域先于门面), 实际${htmlScripts.length}: ${htmlScripts.join(',')}`);
ok(expList.length === 2 && expList[0] === 'js/icons.js' && expList[1] === 'js/export-template.js', `EXPORT轻量2项(icons+export-template, Wave-D/G解耦), 实际${JSON.stringify(expList)}`);
ok(!expList.includes('js/core-docs.js') && !expList.includes('js/project-ai-export.js'), 'EXPORT不再内联开发巨石(core-docs/project-ai-export解耦)');
ok(expSrc.includes('window.__EXPORT_BOOT__=true'), 'EXPORT保留__EXPORT_BOOT__兼容');
ok(expSrc.includes('window.__EXPORT_SOURCES__'), 'EXPORT保留__EXPORT_SOURCES__数据注入');
ok(htmlCss.includes('app.css'), 'HTML引用app.css');
ok(/fetchText\(\s*['"]app\.css['"]\s*\)/.test(expSrc), 'fetchText加载app.css');
for (const s of [...htmlScripts, ...htmlCss, ...expList]) ok(covered.has(s), `前端覆盖 ${s}`);
// 4b.main 双入口（mode-aware：legacy-only 下新字面量缺失只 SKIP，dist 落位后转硬断言；旧绝对路径断言保留）
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
ok(mainSrc.includes("win.loadFile(path.join(app.getAppPath(), '原型+文档.html'))"), 'main.loadFile须绝对路径（getAppPath，打包后cwd不可靠）');
ok(mainSrc.includes('原型+文档.html'), 'main保留legacy入口 原型+文档.html');
const MAIN_NEW_LITS = ['PLAND_RENDERER', 'dist/renderer/index.html'];
if (HAS_DIST) {
  for (const lit of MAIN_NEW_LITS) ok(mainSrc.includes(lit), `main双入口含 ${lit}`);
} else {
  for (const lit of MAIN_NEW_LITS) {
    if (mainSrc.includes(lit)) console.log('PASS main已含 ' + lit);
    else skip(`main暂缺 ${lit}（legacy-only 预期，TODO主进程智能体C补 PLAND_RENDERER 双入口）`);
  }
}
// 注：window-controller.js 仍经 appHtmlPath() 加载 legacy（只读观察，不断言不改；TODO主进程智能体C改 ?docwin=1 React 入口）。
ok(covered.has('preload.js') && covered.has('原型+文档.html') && covered.has('toolPrompt.md'), 'preload/HTML/toolPrompt在包内');
ok(covered.has('design-specs/ui-mobile.md') && covered.has('design-specs/ui-desktop.md'), 'UI规范种子在包内(随包分发到design-specs/)');

// 4c.dist 产物（仅 react+legacy 分支额外断言；legacy-only 下 SKIP）
if (HAS_DIST) {
  ok(fs.existsSync(DIST_INDEX), 'dist产物存在 dist/renderer/index.html');
  for (const f of ['export-template.js', 'icons.js', 'export.css']) {
    ok(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'export-assets', f)), `dist产物存在 dist/renderer/export-assets/${f}`);
  }
} else {
  skip('dist/renderer 未构建，跳过 React 产物与 export-assets 断言（legacy-only 预期）');
}

// 5.违禁项不在白名单
for (const bad of ['tests/**', '.devdata', '*.log', '桌面端/', '桌面端']) {
  const exact = filesList.some(p => String(p) === bad);
  ok(!exact, `违禁未进包: ${bad}`);
}
// 5b.bak 排除项必须在白名单(6条)
for (const exc of ['!js/**/*.bak', '!runtimes/**/*.bak', '!providers/**/*.bak', '!platform/**/*.bak', '!git/**/*.bak', '!**/*.bak']) {
  ok(filesList.includes(exc), `bak排除在包外: ${exc}`);
}
// 5c.node_modules 瘦身剪枝必须登记（P2-2：9条；缺任一条安装器体积会回流）
const NM_PRUNES = [
  '!**/node_modules/**/*.map',
  '!**/node_modules/**/*.md',
  '!**/node_modules/**/{test,tests,__tests__}/**',
  '!**/node_modules/**/*.{test,spec}.js',
  '!**/node_modules/zod/src/**',
  '!**/node_modules/bare-*/prebuilds/{android-*,darwin-*,ios-*,linux-*,win32-arm64}/**',
  '!**/node_modules/@esbuild/**',
  '!**/node_modules/lightningcss-win32-x64-msvc/**',
  '!**/node_modules/@tailwindcss/oxide-win32-x64-msvc/**',
];
for (const prune of NM_PRUNES) ok(filesList.includes(prune), `node_modules瘦身剪枝在包外: ${prune}`);
// 5d.不得夹带未登记正例（与 tests/verify-inline-edit.js A10 同源口径；13正例=legacy12+dist/renderer/**）
const REGISTERED_POSITIVE = new Set([...LEGACY_REQUIRED, 'dist/renderer/**']);
const unregistered = filesList.filter(p => !String(p).startsWith('!') && !REGISTERED_POSITIVE.has(String(p)));
ok(unregistered.length === 0, `白名单不得夹带未登记正例，实际多出: ${JSON.stringify(unregistered)}`);
ok(new Set(filesList).size === filesList.length, '白名单不得有重复条目');

console.log(fails.length ? `\nPACK_FAIL: ${fails.length}项\n  ` + fails.join('\n  ') : '\nPACK_PASS: 0缺失，白名单覆盖全部运行时边');
process.exitCode = fails.length ? 1 : 0;
