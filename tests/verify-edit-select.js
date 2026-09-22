'use strict';
// P1.7 待提交选中提交 + P1.4 刷新三态（静态断言；渲染需 DOM，以源码契约为准）
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const ee = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const pae = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const html = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');

// ---- 1. 选中态默认全选 ----
(function testSelDefault() {
  const pushes = ee.match(/EDIT_QUEUE\.push\(\{[^}]*\}\)/g) || [];
  assert.ok(pushes.length >= 2, '须有两个入列 push，实际' + pushes.length);
  pushes.forEach(function (p, i) {
    assert.ok(/sel\s*:\s*true/.test(p), '第' + (i + 1) + '个 push 须默认 sel:true');
  });
  assert.ok(/function editQueueSelected\(/.test(ee), '缺 editQueueSelected');
  assert.ok(/it\.sel\s*!==\s*false/.test(ee), '选中语义须 sel!==false（存量无字段按选中计）');
  assert.ok(/function editQueueIsAllSel\(/.test(ee), '缺 editQueueIsAllSel');
  assert.ok(/function editQueueSetAll\(/.test(ee), '缺 editQueueSetAll');
  assert.ok(/function editQueueToggleSel\(/.test(ee), '缺 editQueueToggleSel');
  console.log('[PASS] 选中态默认全选');
})();

// ---- 2. 条目边框高亮 + 点击切换（操作区除外） + 左下角同位互斥按钮 ----
(function testSelUI() {
  assert.ok(/ed-item'\+.*sel/.test(ee) || /ed-item.*sel/.test(ee), '条目须带 sel 类');
  assert.ok(/\.ed-item\.sel\s*\{[^}]*border/.test(css), '.ed-item.sel 须边框高亮');
  assert.ok(/\.ei-x,\.ei-edit/.test(ee), '切换须排除操作区点击');
  assert.ok(/querySelectorAll\('\.ed-item'\)/.test(ee), '须绑定条目点击切换');
  assert.ok(html.includes('id="editQueueSelAll"'), '左下角须有全选按钮');
  assert.ok(/editQueueSelAllEl\.onclick=function\(\)\{[^}]*editQueueSetAll\(!editQueueIsAllSel\(\)\)/.test(ee), '按钮须按状态互斥切换');
  assert.ok(/取消全选/.test(ee) && /全选/.test(ee), '须有全选/取消全选文案');
  assert.ok(/\.ed-foot-left\s*\{[^}]*margin-right\s*:\s*auto/.test(css), '按钮须左下（margin-right:auto）');
  console.log('[PASS] 选中 UI 与同位按钮');
})();

// ---- 3. 提交只发选中，未选中保留；done 只清已提交 ----
(function testSubmitSelected() {
  const seg = ee.match(/function editQueueSubmit[\s\S]*?var t=parts\.join/);
  assert.ok(seg, '缺editQueueSubmit拼装');
  const code = seg[0];
  assert.ok(/editQueueSelected\(\)/.test(code), '提交须取选中列表');
  assert.ok(/请先选中至少一条/.test(ee), '零选中须提示并保留队列');
  assert.ok(/EDIT_SUBMITTED_IDS=_selList/.test(ee) || /EDIT_SUBMITTED_IDS\s*=/.test(ee), '须记录本轮已提交 id');
  const done = ee.match(/function __editOnAiDone\(\)\{[\s\S]*?\n\}/);
  assert.ok(done && /EDIT_SUBMITTED_IDS/.test(done[0]), 'done 须按 EDIT_SUBMITTED_IDS 只清已提交');
  assert.ok(/function editQueueRollback\(/.test(ee), '缺回滚函数');
  console.log('[PASS] 选中提交与保留');
})();

// ---- 3b. 提交即移除已选项（不等 done） ----
(function testDropOnSubmit() {
  const eeSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  assert.ok(/function editQueueDropSubmitted\(\)/.test(eeSrc), '缺 editQueueDropSubmitted');
  const calls = eeSrc.match(/editQueueDropSubmitted\(\)/g) || [];
  assert.ok(calls.length >= 3, '两条提交路径均须调用移除（定义+2处调用），实际' + calls.length);
  console.log('[PASS] 提交即移除');
})();

// ---- 5. P1.4 刷新三态 ----
(function testRefreshStates() {
  assert.ok(/window\._refreshManual=true/.test(pae), '按钮须置手动标记');
  assert.ok(/function setRefreshBusy\(/.test(pae), '缺按钮忙态函数');
  assert.ok(/刷新中…/.test(pae), '忙态须换文案');
  assert.ok(/\.disabled=true/.test(pae), '忙态须禁用防连点');
  assert.ok(/沙箱已刷新，共 /.test(pae), '完成须 toast 带原型数');
  assert.ok(/_refreshDone\(true/.test(pae) && /_refreshDone\(false\)/.test(pae), '成功/失败须统一复位');
  console.log('[PASS] 刷新三态');
})();

// ---- 5. 条目展示：去元素行 + 文字区浅灰加粗两行起 ----
(function testItemPresent() {
  const eeSrc = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  assert.ok(!eeSrc.includes('ei-sel'), '抽屉不得再渲染元素类型行');
  const m = css.match(/\.ed-item \.ei-text\s*\{([^}]*)\}/);
  assert.ok(m, '缺 .ei-text 规则');
  const rule = m[1];
  assert.ok(/background\s*:\s*#F3F5F7/i.test(rule), '文字区须浅灰底');
  assert.ok(/font-weight\s*:\s*700/.test(rule), '文字须加粗');
  assert.ok(/min-height\s*:\s*3\.2em/.test(rule), '文字区最小两行');
  assert.ok(!/max-height/.test(rule), '文字区高度须随内容走（无上限）');
  console.log('[PASS] 条目展示');
})();

// ---- 6. 条目标题字号 11px ----
(function testItemTitleSize() {
  const css2 = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
  const m = css2.match(/\.ed-item \.ei-proto,\.ed-item \.ei-file\s*\{([^}]*)\}/);
  assert.ok(m, '缺标题字号规则');
  assert.ok(/font-size\s*:\s*11px/.test(m[1]), '标题须 11px');
  console.log('[PASS] 条目标题字号');
})();

console.log('EDITSEL_PASS: 选中提交与刷新三态全绿');
