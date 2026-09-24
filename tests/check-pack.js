// T5.1 打包完整性门禁: node tests/check-pack.js
// 遍历 build.files 白名单展开，对比生产 require 边 + HTML/EXPORT + 违禁项。缺失即 exit 1。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// 1.读白名单
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const filesList = (((pkg || {}).build || {}).files || []);
ok(Array.isArray(filesList) && filesList.length === 18, `白名单18条(12白+6bak排除，Wave-B新增main/**，UI规范新增design-specs/**)，实际${filesList.length}`);

// 2.展开白名单 -> Set<rel>
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
    ok(n.includes('.bak'), `排除项 ${n}`);
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

// 4.HTML 引用 vs EXPORT 清单 vs fetchText
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
ok(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8').includes("win.loadFile(path.join(app.getAppPath(), '原型+文档.html'))"), 'main.loadFile须绝对路径（getAppPath，打包后cwd不可靠）');
ok(covered.has('preload.js') && covered.has('原型+文档.html') && covered.has('toolPrompt.md'), 'preload/HTML/toolPrompt在包内');
ok(covered.has('design-specs/ui-mobile.md') && covered.has('design-specs/ui-desktop.md'), 'UI规范种子在包内(随包分发到design-specs/)');

// 5.违禁项不在白名单
for (const bad of ['tests/**', '.devdata', '*.log', '桌面端/', '桌面端']) {
  const exact = filesList.some(p => String(p) === bad);
  ok(!exact, `违禁未进包: ${bad}`);
}
// 5b.bak 排除项必须在白名单(6条)
for (const exc of ['!js/**/*.bak', '!runtimes/**/*.bak', '!providers/**/*.bak', '!platform/**/*.bak', '!git/**/*.bak', '!**/*.bak']) {
  ok(filesList.includes(exc), `bak排除在包外: ${exc}`);
}

console.log(fails.length ? `\nPACK_FAIL: ${fails.length}项\n  ` + fails.join('\n  ') : '\nPACK_PASS: 0缺失，白名单覆盖全部运行时边');
process.exitCode = fails.length ? 1 : 0;
