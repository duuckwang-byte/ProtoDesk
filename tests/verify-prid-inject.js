'use strict';
// 稳定ID注入引号感知回归：含 '>' 的 :class/@click/v-if 属性值不再切错标签（纯 Node，不启动 Electron）
// 根因：旧三组正则用 [^>]* 定位标签结尾，Vue 写法如 :class="t.indexOf('认证')>-1?...'" 会在引号内的 '>' 处切开，
//   data-pr-id 被塞进属性值中间导致 Vue 模板 SyntaxError。现改为引号感知扫描后再套三条原规则。
// 覆盖：R1 :class/@click/v-if 含 '>'（id 落真结尾前、原值逐字节不变）/ R2 文本 '>' 非标签 / R3 script/style/注释原样跳过 /
//       R4 已有 pr-id/testid 跳过 / R5 幂等两遍零新增 / R6 表达式语法冒烟（new Function 只编译不执行）/ R7 双副本一致
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const eeSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(html\\)\\s*\\{');
  const m = re.exec(src);
  assert.ok(m, '缺函数 ' + name);
  const start = m.index;
  let lastErr = null;
  for (let j = start; j < src.length; j++) {
    if (src[j] !== '}') continue;
    const cand = src.slice(start, j + 1);
    try {
      var probe = new Function(cand + '; return ' + name + ';');
      assert.ok(typeof probe === 'function', '编译失败 ' + name);
      return cand;
    } catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error('函数 ' + name + ' 花括号未闭合');
}

function makeFn(src, name) {
  const code = extractFunction(src, name);
  const f = new Function(code + '; return ' + name + ';');
  return f();
}

const frontFn = makeFn(eeSrc, 'prIdEnsureInjected');
const mainFn = makeFn(mainSrc, 'ensurePrIdInjected');

function countIds(s) {
  return (String(s).match(/data-pr-id\s*=\s*"/g) || []).length;
}

// R0: 旧切错模式已消除（注入函数内不再用 [^>] 定位标签结尾），注释/script/style 切分逻辑保留
(function testNoOldPattern() {
  const fb = extractFunction(eeSrc, 'prIdEnsureInjected');
  const mb = extractFunction(mainSrc, 'ensurePrIdInjected');
  assert.ok(fb.indexOf('[^>]') < 0, '前端仍含 [^>] 切标签');
  assert.ok(mb.indexOf('[^>]') < 0, '主进程仍含 [^>] 切标签');
  assert.ok(fb.indexOf('<script') >= 0 && fb.indexOf('<style') >= 0, '前端切分逻辑不得动');
  assert.ok(mb.indexOf('<script') >= 0 && mb.indexOf('<style') >= 0, '主进程切分逻辑不得动');
  assert.ok(/html\|head\|body\|script\|style\|link\|meta\|title\|base\|template/.test(fb), '前端排除名单不得动');
  assert.ok(/html\|head\|body\|script\|style\|link\|meta\|title\|base\|template/.test(mb), '主进程排除名单不得动');
  console.log('[PASS] R0 旧模式消除与切分/名单保留');
})();

// R1: 含 '>' 的 Vue 属性值
(function testVueGt() {
  const cases = [
    '<div><span :class="t.indexOf(\'认证\')>-1 ? \'badge b-green\' : \'tag\'" class="tag">认证</span></div>',
    '<button @click="foo(a>b?a:c)" class="btn">点</button>',
    '<div v-if="a>b" class="box">x</div>',
    '<div v-if=\'a>b\' class=\'box2\'>y</div>',
    '<div data-page="p?a>b" class="d">w</div>',
    '<div onclick="if(a>b){go()}" class="e">v</div>'
  ];
  const verbatim = [
    ':class="t.indexOf(\'认证\')>-1 ? \'badge b-green\' : \'tag\'"',
    '@click="foo(a>b?a:c)"',
    'v-if="a>b"',
    'v-if=\'a>b\'',
    'data-page="p?a>b"',
    'onclick="if(a>b){go()}"'
  ];
  cases.forEach(function (html, k) {
    const a = frontFn(html);
    const b = mainFn(html);
    assert.strictEqual(a, b, '双副本输出须一致 case=' + k);
    assert.ok(a.indexOf(verbatim[k]) >= 0, '原属性值须逐字节不变 case=' + k + ' 实际:' + a);
    assert.strictEqual(countIds(a), 1, '须恰补1个id case=' + k + ' 实际:' + a);
    const idPos = a.indexOf('data-pr-id="');
    const gtPos = a.indexOf(verbatim[k]);
    assert.ok(idPos > gtPos, 'id须落在真正标签结尾前 case=' + k);
    assert.ok(/data-pr-id="pr-[a-z0-9]+-\d+">/.test(a), 'id须紧贴标签结尾 case=' + k + ' 实际:' + a);
    assert.ok(a.indexOf(verbatim[k] + ' data-pr-id') < 0, 'id不得塞进属性值中间 case=' + k);
  });
  console.log('[PASS] R1 含>属性值注入位置正确');
})();

// R2: 文本节点 '>' 不得当标签
(function testTextGt() {
  const html = '<div class="a">a > b</div>';
  const a = frontFn(html);
  const b = mainFn(html);
  assert.strictEqual(a, b, '双副本须一致');
  assert.ok(a.indexOf('a > b') >= 0, '文本须原样保留 实际:' + a);
  assert.strictEqual(countIds(a), 1, '文本>不得多生id 实际:' + a);
  console.log('[PASS] R2 文本>非标签');
})();

// R3: script/style/注释原样跳过
(function testSkipBlocks() {
  const comment = '<!-- <div class="skip">c</div> -->';
  const script = '<script>var s="<div class=\\"skip2\\">"; if(a>b){}</script>';
  const style = '<style>.a>b{color:red}</style>';
  const html = comment + script + style + '<div class="keep">ok</div>';
  const a = frontFn(html);
  const b = mainFn(html);
  assert.strictEqual(a, b, '双副本须一致');
  assert.ok(a.indexOf(comment) >= 0, '注释须原样 实际:' + a);
  assert.ok(a.indexOf(script) >= 0, 'script须原样 实际:' + a);
  assert.ok(a.indexOf(style) >= 0, 'style须原样 实际:' + a);
  assert.strictEqual(countIds(a), 1, '块内不得补id，仅keep补1 实际:' + a);
  assert.ok(/class="keep" data-pr-id=/.test(a), 'keep须补id');
  console.log('[PASS] R3 script/style/注释跳过');
})();

// R4: 已有 pr-id/testid 跳过
(function testSkipExisting() {
  const html = '<div class="a" data-pr-id="pr-div-7">x</div><button data-testid="t1" class="b">y</button>';
  const a = frontFn(html);
  const b = mainFn(html);
  assert.strictEqual(a, b, '双副本须一致');
  assert.strictEqual(a, html, '已有须零改动 实际:' + a);
  console.log('[PASS] R4 已有跳过');
})();

// R5+R6: 幂等 + 表达式语法冒烟（组合文档）
(function testIdempotentSyntax() {
  const doc = [
    '<div id="app">',
    '<span :class="t.indexOf(\'认证\')>-1 ? \'badge b-green\' : \'tag\'" class="tag">{{ t }}</span>',
    '<button @click="foo(a>b?a:c)" class="btn">点</button>',
    '<div v-if="a>b" class="box">{{ ok ? a : b }}</div>',
    '<div class="a">a > b</div>',
    '</div>'
  ].join('');
  const once = frontFn(doc);
  assert.strictEqual(once, mainFn(doc), '双副本须一致');
  const twice = frontFn(once);
  const twice2 = mainFn(once);
  assert.strictEqual(twice, once, '前端须幂等');
  assert.strictEqual(twice2, once, '主进程须幂等');
  assert.strictEqual(countIds(twice), countIds(once), '第二遍零新增');
  const exprs = [];
  let m;
  const re1 = /(?::class|@click|v-if)\s*=\s*"([^"]*)"/g;
  while ((m = re1.exec(once))) exprs.push(m[1]);
  const re2 = /\{\{\s*([\s\S]*?)\s*\}\}/g;
  while ((m = re2.exec(once))) exprs.push(m[1]);
  assert.ok(exprs.length >= 5, '须抽到表达式，实际' + exprs.length);
  exprs.forEach(function (ex, k) {
    try {
      var fn = new Function('return (' + ex + ')');
      assert.ok(typeof fn === 'function', '表达式须可编译');
    } catch (e) {
      assert.fail('表达式语法失败[' + k + ']' + ex + '：' + String((e && e.message) || e));
    }
  });
  console.log('[PASS] R5/R6 幂等与表达式语法冒烟(' + exprs.length + '个)');
})();

console.log('PRIDINJECT_PASS: 引号感知注入回归全绿');
