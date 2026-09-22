'use strict';
// 方案二子页命名回归：统一Helper口径 + 队列htmlFile + 提交头文件一致 + 单文件零回归
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
const sb = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
const ee = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const tp = fs.readFileSync(path.join(rootDir, 'toolPrompt.md'), 'utf8');

// 断言1：统一Helper口径（sandbox-core唯一定义并暴露）
function test1_HelperUnified() {
  assert.ok(/function\s+curHtmlFile\s*\(/.test(sb), 'sandbox-core缺curHtmlFile');
  assert.ok(/function\s+isMainFile\s*\(/.test(sb), 'sandbox-core缺isMainFile');
  assert.ok(/function\s+protoLabel\s*\(/.test(sb), 'sandbox-core缺protoLabel');
  assert.ok(/activeSubFile\|\|.*mainHtmlFile\|\|.*name/.test(sb), 'Helper回退链应为activeSubFile||mainHtmlFile||name');
  assert.ok(/window\.curHtmlFile\s*=\s*curHtmlFile/.test(sb), 'curHtmlFile未暴露window');
  assert.ok(/window\.protoLabel\s*=\s*protoLabel/.test(sb), 'protoLabel未暴露window');
  assert.ok(/window\.isMainFile\s*=\s*isMainFile/.test(sb), 'isMainFile未暴露window');
  assert.ok(/function\s+editQueueCurHtmlFile\s*\(/.test(ee), 'edit-entry缺editQueueCurHtmlFile回退');
}

// 断言2：队列htmlFile落盘（含去重与持久化）
function test2_QueueHtmlFile() {
  assert.ok(/EDIT_QUEUE\.push\(\{[\s\S]{0,400}htmlFile/.test(ee), 'push缺htmlFile');
  assert.ok(/htmlFile\s*:\s*curHtml/.test(ee), 'push未取当前文件');
  assert.ok(/it\.selector===sel&&it\.page===pg&&\(!it\.htmlFile\|\|!curHtml\|\|it\.htmlFile===curHtml\)/.test(ee), '去重键未含htmlFile兼容');
  assert.ok(/if\(!dup\.htmlFile\)dup\.htmlFile=curHtml/.test(ee), '存量补齐缺失');
  assert.ok(/ei-file/.test(ee), '抽屉未显示文件段');
  assert.ok(/ei-proto/.test(ee), '抽屉未显示原型段');
}

// 断言3：提交头与逐条文件一致（含清单与约束）
function test3_SubmitHeaderConsistent() {
  const seg = ee.match(/function editQueueSubmit[\s\S]*?var t=parts\.join/);
  assert.ok(seg, '缺editQueueSubmit拼装');
  const code = seg[0];
  assert.ok(/srcFull/.test(code), '缺srcFull子页后缀');
  assert.ok(/所属文件/.test(code), '逐条未拼所属文件');
  assert.ok(/涉及文件清单/.test(code), '缺文件清单');
  assert.ok(/只在所属文件中找/.test(code), '缺跨文件定位约束');
  assert.ok(/htmlFiles\.join/.test(code), '缺多文件计数');
  assert.ok(/function effOf/.test(code), '缺effOf存量兼容');
}

// 断言5：精简拼装 + 层级/父级上下文（同文件同需求合并、单页省略页面行、防臆造保留）
function test5_CondenseSubmit() {
  const seg = ee.match(/function editQueueSubmit[\s\S]*?var t=parts\.join/);
  assert.ok(seg, '缺editQueueSubmit拼装');
  const code = seg[0];
  assert.ok(/改「/.test(code) && /共'\+_selList\.length\+'条/.test(code), '缺精简头改「/选中计数N条');
  assert.ok(/chips\.join\('、'\)/.test(code), '缺同需求合并选择器并列');
  assert.ok(/showPage/.test(code), '缺单页省略页面行');
  assert.ok(/层级：/.test(code), '缺层级链');
  assert.ok(/上级代码/.test(code), '缺父级代码片段');
  assert.ok(/定位不到就直说/.test(code), '缺防臆造约束');
  // 入列携带：live 计算 + remote 透传
  assert.ok(/ancestors:\(typeof editAncestorChain/.test(ee), 'toggle入列缺层级');
  assert.ok(/ancestors:\(info&&Array\.isArray\(info\.ancestors\)\)/.test(ee), 'remote入列缺层级透传');
  assert.ok(/parentHtml:String\(\(info&&info\.parentHtml\)/.test(ee), 'remote入列缺父级透传');
  // 帧模板双副本：点击 payload 带 ancestors/parentHtml
  const agent = fs.readFileSync(path.join(__dirname, '..', 'js', 'sandbox-agent.js'), 'utf8');
  for (const [nm, src] of [['sandbox-core', ee2core()], ['sandbox-agent', agent]]) {
    assert.ok(src.includes('ancestors:anc, parentHtml:ph'), nm + '帧模板点击payload缺层级/父级');
  }
  // 宿主白名单透传
  const core = ee2core();
  assert.ok(/pl\.ancestors/.test(core) && /pl\.parentHtml/.test(core), '宿主PICK_RESULT白名单缺透传');
  assert.ok(/mpl\.ancestors/.test(core) && /mpl\.parentHtml/.test(core), '宿主PICK_MISS白名单缺透传');
}
function ee2core() { return fs.readFileSync(path.join(__dirname, '..', 'js', 'sandbox-core.js'), 'utf8'); }
// 断言4：单文件原型零回归 + 规范同步
function test4_SingleFileZeroRegression() {
  assert.ok(/isMulti/.test(ee), '缺isMulti单文件回退');
  assert.ok(/srcName\+\(\(isMulti&&curActive&&mainFile&&curActive!==mainFile\)\?' \/ '\+curActive:''\)/.test(ee), '单文件应回退原单名');
  assert.ok(/一原型文件夹可含多 HTML/.test(tp), 'toolPrompt未同步多HTML约束');
  assert.ok(/所属文件/.test(tp) || /只改该文件/.test(tp), 'toolPrompt未约束按文件修改');
}

function runAllAssertions() {
  let passed = 0; let failed = 0;
  const tests = [
    ['断言1 统一Helper口径', test1_HelperUnified],
    ['断言2 队列htmlFile落盘', test2_QueueHtmlFile],
    ['断言3 提交头与逐条文件一致', test3_SubmitHeaderConsistent],
    ['断言4 单文件原型零回归', test4_SingleFileZeroRegression],
    ['断言5 精简拼装与层级父级', test5_CondenseSubmit],
  ];
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}\n`);
  if (failed > 0) process.exit(1);
}
runAllAssertions();
