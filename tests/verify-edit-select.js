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

// ---- 7. 拾取标签输入条 + 面板增宽 + 批量合单条 ----
(function testPickFab() {
  const ee2 = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  const html2 = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
  const css2 = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
  const lb2 = fs.readFileSync(path.join(rootDir, 'js', 'link-bind.js'), 'utf8');
  assert.ok(html2.includes('id="pickBar"') && html2.includes('id="pickBarTags"') && html2.includes('id="pickBarInput"') && html2.includes('id="pickBarSend"'), '缺底部标签输入条（标签区+输入框+发送）');
  assert.ok(html2.includes('id="pickBarAnno"') && html2.includes('id="pickBarLink"') && html2.includes('id="pickBarPop"'), '缺标注/交互按钮与上方悬浮窗');
  assert.ok(!html2.includes('id="pickFab"'), '旧悬浮球须移除');
  assert.ok(/showFab/.test(ee2) && /hideFab/.test(ee2), '缺显隐函数');
  assert.ok(/renderPickBar/.test(ee2) && /removeById/.test(ee2), '标签须可渲染可删');
  assert.ok(/\.pick-bar-tag\s*\{[^}]*background\s*:\s*#F3F5F7/i.test(css2), '标签背景须浅灰');
  assert.ok(/pick-bar-tag-no/.test(ee2) && /\.pick-bar-tag-no\s*\{[^}]*font-weight\s*:\s*700/.test(css2), '序号须加粗');
  assert.ok(/createTextNode\(' '\)/.test(ee2), '序号与文字须空一格');
  assert.ok(/ctrlPickBuildParts\(CTRL_PICK\.selected\)/.test(ee2), '发送与批量提交须共用部件拼装');
  assert.ok(/pickBarSendGo[\s\S]{0,3000}EDIT_QUEUE\.push/.test(ee2), '发送须直达待提交列表');
  assert.ok(!/pickBarSendGo\(\)[\s\S]{0,400}openPanel\(\)/.test(ee2), '发送不得再进中间面板');
  assert.ok(/\.pick-bar\s*\{[^}]*width\s*:\s*560px/.test(css2), '输入条须固定宽度');
  assert.ok(/\.pick-bar-main[\s\S]*?flex-direction\s*:\s*column/.test(css2), '须上标签下输入纵向布局');
  assert.ok(/\.pick-bar-pop\s*\{[^}]*bottom\s*:\s*calc\(100% \+ 8px\)/.test(css2), '悬浮窗须在按钮上方');
  assert.ok(html2.includes('data-ic="target"') && html2.includes('data-ic="link"'), '标注/交互须用点位/链接图标');
  assert.ok(/pick-bar-iconbtn/.test(html2) && !/pickBarAnno" class="pick-bar-btn/.test(html2), '按钮须图标化无文字');
  assert.ok(/\.pick-bar-iconbtn:hover \.nm/.test(css2), '悬浮须展开按钮名字');
  assert.ok(/\.pick-bar-side\s*\{[^}]*flex-direction\s*:\s*row/.test(css2), '按钮须横排在发送左侧');
  assert.ok(/<textarea[^>]*id="pickBarInput"[^>]*rows="1"/.test(html2), '需求输入须多行textarea');
  assert.ok(/function pickBarInputAuto\(\)/.test(ee2) && /function autoEditTa\(/.test(ee2), '两处输入须按内容自增高');
  assert.ok(/\.pick-bar-input\s*\{[^}]*max-height\s*:\s*120px/.test(css2), '输入条超量须内滚封顶');
  assert.ok(/\.ed-item \.ei-editta\s*\{[^}]*max-height\s*:\s*none/.test(css2), '待提交编辑框须不限制高度');
  assert.ok(/ev\.ctrlKey\|\|ev\.metaKey\)\)\{ ev\.preventDefault\(\); pickBarSendGo/.test(ee2), '输入条须Ctrl+回车发送（回车换行）');
  assert.ok(/pickBarTogglePop\(/g.test(ee2) && /pickBarOpenLink\(\)/.test(ee2), '须有悬浮窗切换/交互');
  assert.ok(/function pickBarAnnoGo\(\)/.test(ee2) && !/function pickBarOpenAnno\(\)/.test(ee2), '标注须直存输入框文字（无弹窗）');
  assert.ok(/annoContentInput/.test(ee2.match(/function pickBarAnnoGo\(\)[\s\S]*?\n\}/)[0]) && /saveCurrentAnno\(\)/.test(ee2), '直存须经标注模块保存');
  assert.ok(/CTRL_PICK\.clear\(\)/.test(ee2.match(/function pickBarAnnoGo\(\)[\s\S]*?\n\}/)[0]), '直存后须收条清选中');
  assert.ok(/__pickBarEscBound/.test(ee2) && /pickBarEscArmed/.test(ee2) && /pickBarEscTip\(/.test(ee2), '须有Esc两段退出');
  assert.ok(/再次按 Esc 退出输入条？/.test(ee2), '首次Esc须小吐司确认');
  assert.ok(/\.pick-bar-esc-tip/.test(css2), '须有输入条下方小吐司样式');
  assert.ok(/function quickBind\(/.test(lb2) && /quickBind: quickBind/.test(lb2) && /removeJumpBinding: removeJumpBinding/.test(lb2), 'LinkBind须暴露快绑/解绑');
  assert.ok(/#multiEditDrawer\s*\{[^}]*width\s*:\s*760px/.test(css2), '需求弹窗须增宽一倍到760px');
  assert.ok(/batchParts/.test(ee2), '批量须合并部件');
  assert.ok(/批量修改（/.test(ee2), '合并条目须标批量个数');
  console.log('[PASS] 标签输入条与批量合单');
})();

// ---- 6. 条目标题字号 11px ----
(function testItemTitleSize() {
  const css2 = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
  const m = css2.match(/\.ed-item \.ei-proto,\.ed-item \.ei-file\s*\{([^}]*)\}/);
  assert.ok(m, '缺标题字号规则');
  assert.ok(/font-size\s*:\s*11px/.test(m[1]), '标题须 11px');
  console.log('[PASS] 条目标题字号');
})();

// ---- 7. 拾取链路禁原生 alert（alert 嵌套循环搞乱 Chromium 焦点，窗内再落不上光标；一律走 toast+回焦） ----
(function testNoNativeAlertInPickFlows() {
  const ee2 = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
  const ae2 = fs.readFileSync(path.join(rootDir, 'js', 'annotation-core.js'), 'utf8');
  function seg(src, name) {
    let i = src.indexOf('function ' + name);
    if (i < 0) i = src.indexOf(name + ': function');
    assert.ok(i >= 0, '缺 function ' + name);
    const j = src.indexOf('\nfunction ', i + 10);
    return j > i ? src.slice(i, j) : src.slice(i, i + 6000);
  }
  for (const nm of ['pickBarSendGo', 'pickBarAnnoGo', 'pickBarOpenLink', 'submitBatch', 'editQueueSubmit', 'editQueueAdd', 'editQueueAddRemote', 'editQueueRollback']) {
    const body = seg(ee2, nm);
    assert.ok(!/[^_a-zA-Z.$]alert\(/.test(body), nm + ' 不得用原生 alert（改走 libStatus/toast+回焦）');
  }
  const saveBody = seg(ae2, 'saveCurrentAnno');
  assert.ok(!/[^_a-zA-Z.$]alert\(/.test(saveBody), 'saveCurrentAnno 不得用原生 alert');
  // 空输入提示须回焦输入框
  assert.ok(/libStatus\('请输入统一修改诉求。'\)/.test(ee2), '空诉求须 toast 提示');
  assert.ok(/libStatus\('请先在输入框输入标注内容。'\)/.test(ee2), '空标注须 toast 提示');
  console.log('[PASS] 拾取链路无原生alert');
})();

console.log('EDITSEL_PASS: 选中提交与刷新三态全绿');
