'use strict';
/**
 * tests/verify-preview-csp.js — 预览层网络策略静态门禁（纯 Node，不启动 Electron）。
 *
 * 背景：预览 iframe 使用 srcdoc + sandbox，会继承父文档（dist/renderer/index.html）的 CSP。
 * 因此 `src/renderer/index.html` 的 CSP meta 就是预览内容可访问的网络边界。
 *
 * 本脚本锁定当前已确认的策略：
 * 1. script/style/font/img/connect/frame/media/worker/form-action 放行任意 http: 与 https:；
 * 2. script-src 放行 'unsafe-inline'（Vite preamble / 帧桥内联脚本）与 'unsafe-eval'（Vue 2/3 DOM 内运行时模板编译 new Function）；
 * 3. Vite dev 的 localhost:5173（script + ws）例外保留；
 * 4. 不允许 `*` / `http://*` / `https://*` 这类通配主机，避免比“按 scheme 放行”更宽；
 * 5. object-src / frame-ancestors 等危险指令不得写入 http:/https:（当前未声明这些指令）；
 * 6. 预览 iframe 的 sandbox 仍为 allow-scripts allow-forms（不含 allow-same-origin）；
 * 7. 主进程安全开关 webSecurity / contextIsolation / allowRunningInsecureContent 未被放宽。
 *
 * 运行：node tests/verify-preview-csp.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'src', 'renderer', 'index.html');
const SRCDOC_FILE = path.join(ROOT, 'src', 'renderer', 'features', 'preview', 'lib', 'secure-srcdoc.ts');
const PREVIEW_FRAME_FILE = path.join(ROOT, 'src', 'renderer', 'features', 'preview', 'PreviewFrame.tsx');
const MAIN_FILE = path.join(ROOT, 'main.js');
const DOC_FILE = path.join(ROOT, 'docs', 'preview-network-policy.md');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractCsp(html) {
  const meta = /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i.exec(html);
  assert.ok(meta, 'index.html 必须保留 CSP meta（http-equiv="Content-Security-Policy"）');
  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(meta[0]);
  const value = content ? (content[1] !== undefined ? content[1] : content[2]) : '';
  assert.ok(value && value.trim(), 'CSP meta 必须包含非空 content');
  return value.trim();
}

function parseDirectives(csp) {
  const map = new Map();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    assert.ok(!map.has(name), `CSP 指令重复：${name}`);
    map.set(name, tokens);
  }
  return map;
}

function hasToken(tokens, token) {
  return tokens.some((t) => t.toLowerCase() === token.toLowerCase());
}

const PASS = [];
function pass(label) {
  PASS.push(label);
  console.log('[PASS] ' + label);
}

console.log('=== 预览层 CSP / sandbox 静态门禁 ===');

const html = read(INDEX_FILE);
const csp = extractCsp(html);
const directives = parseDirectives(csp);
console.log('[CSP] ' + csp);

/* ── 1. 网络类指令必须同时放行 http: 与 https: ── */
const NETWORK_DIRECTIVES = [
  'script-src',
  'style-src',
  'font-src',
  'img-src',
  'connect-src',
  'frame-src',
  'media-src',
  'worker-src',
  'form-action',
];
for (const name of NETWORK_DIRECTIVES) {
  const tokens = directives.get(name);
  assert.ok(tokens, `CSP 缺少指令 ${name}`);
  assert.ok(hasToken(tokens, 'https:'), `${name} 必须放行 https:`);
  assert.ok(hasToken(tokens, 'http:'), `${name} 必须放行 http:`);
}
pass('1) 九个网络类指令均同时包含 https: 与 http:');

/* ── 2. 保留 Vite dev 与现有资源协议例外 ── */
const script = directives.get('script-src');
assert.ok(hasToken(script, "'self'"), "script-src 必须保留 'self'");
assert.ok(hasToken(script, "'unsafe-inline'"), "script-src 必须保留 'unsafe-inline'（Vite preamble / 帧桥内联脚本）");
assert.ok(hasToken(script, 'http://localhost:5173'), 'script-src 必须保留 http://localhost:5173（Vite dev）');
assert.ok(
  hasToken(script, "'unsafe-eval'"),
  "script-src 必须放行 'unsafe-eval'（Vue 2/3 DOM 内运行时模板编译需要 new Function，缺失会导致 [v-cloak] 原型白屏）",
);
const style = directives.get('style-src');
assert.ok(hasToken(style, "'self'") && hasToken(style, "'unsafe-inline'"), "style-src 必须保留 'self' 与 'unsafe-inline'");
const connect = directives.get('connect-src');
assert.ok(hasToken(connect, "'self'"), "connect-src 必须保留 'self'");
assert.ok(hasToken(connect, 'wss:'), 'connect-src 必须保留 wss:');
assert.ok(hasToken(connect, 'ws://localhost:5173'), 'connect-src 必须保留 ws://localhost:5173（Vite HMR）');
const img = directives.get('img-src');
for (const token of ["'self'", 'data:', 'blob:', 'proto-asset:']) {
  assert.ok(hasToken(img, token), `img-src 必须保留 ${token}`);
}
assert.ok(hasToken(directives.get('font-src'), 'data:'), 'font-src 必须保留 data:');
assert.ok(hasToken(directives.get('frame-src'), 'data:') && hasToken(directives.get('frame-src'), 'blob:'), 'frame-src 必须保留 data: 与 blob:');
assert.ok(hasToken(directives.get('media-src'), 'data:') && hasToken(directives.get('media-src'), 'blob:'), 'media-src 必须保留 data: 与 blob:');
assert.ok(hasToken(directives.get('worker-src'), 'blob:'), 'worker-src 必须保留 blob:');
assert.ok(hasToken(directives.get('form-action'), "'self'"), "form-action 必须保留 'self'");
pass('2) Vite localhost / data: / blob: / proto-asset: 例外均保留');

/* ── 3. 不允许比 scheme 放行更宽的主机通配 ── */
for (const [name, tokens] of directives) {
  for (const token of tokens) {
    assert.notStrictEqual(token, '*', `${name} 不允许使用 * 通配`);
    assert.ok(!/^https?:\/\/\*/i.test(token), `${name} 不允许主机通配：${token}`);
    assert.ok(!/^wss?:\/\/\*/i.test(token), `${name} 不允许主机通配：${token}`);
    if (/^https?:\/\//i.test(token)) {
      assert.ok(/^https?:\/\/localhost(?::\d+)?$/i.test(token), `${name} 只允许 localhost 显式源，不允许其他主机白名单：${token}`);
    }
  }
}
pass('3) 无 * / 主机通配；显式源仅 localhost');

/* ── 4. 危险指令不得被 http:/https: 放大 ── */
const DANGEROUS = ['object-src', 'frame-ancestors', 'base-uri', 'sandbox', 'navigate-to'];
for (const name of DANGEROUS) {
  const tokens = directives.get(name);
  if (!tokens) continue;
  for (const token of tokens) {
    assert.ok(!/^https?:$/i.test(token), `${name} 不得放行 ${token}`);
    assert.notStrictEqual(token, '*', `${name} 不得使用 *`);
  }
  console.log(`[INFO] 危险指令 ${name} 存在且未被 http/https 放大：${tokens.join(' ')}`);
}
if (!directives.get('object-src')) {
  console.log('[INFO] object-src 未声明（未主动放大；仍建议后续评估 object-src \'none\'）');
}
pass('4) object-src / frame-ancestors / base-uri 等危险指令未写入 http:/https:');

/* ── 5. 预览 iframe sandbox 未放宽 ── */
const srcdoc = read(SRCDOC_FILE);
const sandboxMatch = /export\s+const\s+SANDBOX_ATTR\s*=\s*['"]([^'"]+)['"]/.exec(srcdoc);
assert.ok(sandboxMatch, 'secure-srcdoc.ts 必须保留导出的 SANDBOX_ATTR');
const sandbox = sandboxMatch[1];
assert.strictEqual(sandbox, 'allow-scripts allow-forms', `SANDBOX_ATTR 必须精确为 allow-scripts allow-forms，实际 ${sandbox}`);
assert.ok(!/allow-same-origin/i.test(sandbox), 'SANDBOX_ATTR 不得包含 allow-same-origin');
const previewFrame = read(PREVIEW_FRAME_FILE);
assert.ok(/sandbox=\{SANDBOX_ATTR\}/.test(previewFrame), 'PreviewFrame.tsx 必须继续使用 sandbox={SANDBOX_ATTR}');
pass('5) 预览 iframe sandbox 仍为 allow-scripts allow-forms（无 allow-same-origin）');

/* ── 6. 主进程安全开关未放宽 ── */
const main = read(MAIN_FILE);
assert.ok(/webSecurity:\s*true/.test(main), 'main.js 必须保留 webSecurity: true');
assert.ok(/contextIsolation:\s*true/.test(main), 'main.js 必须保留 contextIsolation: true');
assert.ok(/nodeIntegration:\s*false/.test(main), 'main.js 必须保留 nodeIntegration: false');
assert.ok(
  /allowRunningInsecureContent:\s*false/.test(main),
  'main.js 的 allowRunningInsecureContent 仍须为 false；如需改 true 放行混合内容，必须先按 docs/preview-network-policy.md 确认并同步更新本断言',
);
pass('6) main.js 安全开关未被放宽（webSecurity/contextIsolation/allowRunningInsecureContent）');

/* ── 7. 策略文档存在且写明风险与回滚 ── */
assert.ok(fs.existsSync(DOC_FILE), '缺少 docs/preview-network-policy.md');
const doc = read(DOC_FILE);
for (const needle of ['https:', 'http:', 'allowRunningInsecureContent', 'webSecurity', '回滚', '明文', '中间人']) {
  assert.ok(doc.includes(needle), `策略文档必须包含 ${needle}`);
}
pass('7) docs/preview-network-policy.md 已写明 HTTP 风险、主进程开关与回滚');

console.log(`\n=== 预览层 CSP / sandbox 静态门禁全部通过（${PASS.length}/${PASS.length}） ===`);
