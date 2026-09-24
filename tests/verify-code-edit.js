'use strict';
// Ctrl+Shift 代码编辑抽屉：单元素 HTML(2/3)+关联CSS(1/3)，PC 右抽屉+遮罩，移动端嵌文档区无遮罩
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const ee = fs.readFileSync(path.join(rootDir, 'js', 'edit-entry.js'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'app.css'), 'utf8');
const agentSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-agent.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
const lbSrc = fs.readFileSync(path.join(rootDir, 'js', 'link-bind.js'), 'utf8');
const annoSrc = fs.readFileSync(path.join(rootDir, 'js', 'annotation-core.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(rootDir, 'main', 'services', 'sandbox-storage-service.js'), 'utf8');

// ---- 1. 入口改道（纯双击保留旧文字浮层） ----
(function testEntry() {
  assert.ok(/codeEditOpenFromLive\(_csT\)/.test(ee), '本地 Shift 点击须走 codeEditOpenFromLive');
  assert.ok(/codeEditOpenRemote\(res\)/.test(ee), '远端 Shift 命中须走 codeEditOpenRemote');
  assert.ok(/editDblClick\(/.test(ee), '纯双击旧链路须保留');
  console.log('[PASS] 入口改道');
})();

// ---- 2. 单选与数据链 ----
(function testSingle() {
  assert.ok(/var CODE_EDIT=/.test(ee), '缺 CODE_EDIT 状态');
  assert.ok(/function codeEditOpen\(opts\)/.test(ee), '缺 codeEditOpen');
  assert.ok(/function codeEditOpenRemote\(res\)/.test(ee), '缺 codeEditOpenRemote');
  assert.ok(/function codeEditOpenFromLive\(t\)/.test(ee), '缺 codeEditOpenFromLive');
  assert.ok(/function codeEditCollectCss\(/.test(ee), '缺关联 CSS 收集');
  assert.ok(/function codeEditParseCssBlocks\(/.test(ee), '须有文本级CSS切块');
  assert.ok(/function codeEditSplitSels\(/.test(ee), '切分须括号感知');
  assert.ok(!/\.sheet\b/.test(ee.match(/function codeEditCollectCss\(pdoc, el\)[\s\S]*?\n\}/)[0]), '不得依赖CSSOM sheet（detached文档不稳定）');
  assert.ok(/行内 style/.test(ee), '须提示行内style');
  assert.ok(/祖先 .* 命中/.test(ee), '须标注祖先命中规则');
  assert.ok(/外部样式表/.test(ee), '须提示未展开的外部表');
  assert.ok(/function codeEditSave\(/.test(ee), '缺 codeEditSave');
  assert.ok(/function codeEditClose\(/.test(ee), '缺 codeEditClose');
  // 单选：打开前先关已有
  const openFn = ee.match(/function codeEditOpen\(opts\)\{[\s\S]*?sb\.readFile\(\{dir/);
  assert.ok(openFn && /codeEditClose\(true\)/.test(openFn[0]), '打开前须关闭已有（单选替换）');
  // 磁盘为准：readFile→DOMParser→恰1命中
  assert.ok(/querySelectorAll\(selector\)/.test(ee), '须选择器定位');
  assert.ok(/hits\.length!==1/.test(ee), '须恰1命中校验');
  // CSS 覆盖块写回（无映射歧义）
  assert.ok(/data-codeedit/.test(ee), 'CSS 须经 data-codeedit 覆盖块写回');
  // 保存后静默刷新
  assert.ok(/inlineEditSilentRefresh\(saved,keepFile\)/.test(ee) || /inlineEditSilentRefresh\(/.test(ee), '保存后须静默刷新');
  console.log('[PASS] 单选与数据链');
})();

// ---- 3. 布局 2/3 + 1/3 与双端 ----
(function testLayout() {
  assert.ok(/\.code-edit-sec-html\s*\{[^}]*flex\s*:\s*2/.test(css), 'HTML 区须 flex:2');
  assert.ok(/\.code-edit-sec-css\s*\{[^}]*flex\s*:\s*1[^0-9]/.test(css), 'CSS 区须 flex:1');
  assert.ok(/#codeEditDrawer \.ed-foot,#codeEditInline \.ed-foot\s*\{[^}]*justify-content\s*:\s*flex-start/.test(css), '按钮须固定底部左下角');
  assert.ok(/\.code-edit-sec\s*\{[^}]*overflow\s*:\s*hidden/.test(css), '分区高度须锁定不跟内容走');
  assert.ok(/\.code-edit-ta\s*\{[^}]*overflow-y\s*:\s*auto/.test(css), '超量代码须分区内滚动');
  assert.ok(/#codeEditDrawer\s*\{[^}]*width\s*:\s*66vw/.test(css), '抽屉须同文档弹窗宽(66vw)');
  assert.ok(/\.code-edit-search/.test(css), '须有代码内搜索条样式');
  assert.ok(/codeEditSearchOpen\(\)/.test(ee), '须有代码内搜索打开');
  assert.ok(/codeEditSearchDo\(/.test(ee), '须有代码内搜索定位');
  assert.ok(/codeEditSearchGoto\(/.test(ee), '须有代码内搜索上下个');
  assert.ok(!/function codeEditSearchDo[\s\S]{0,900}codeEditSearchFocusPos\(\)/.test(ee), '输入只计数不得抢焦点（定位走回车）');
  assert.ok(/pointerEvents='none'/.test(ee)||/pointerEvents\s*=\s*'none'/.test(ee), '遮罩须点透以便切换选中');
  assert.ok(/codeEditIsDirty\(\)/.test(ee), '切换须脏确认');
  assert.ok(/codeEditOnlyPopup\(\)/.test(ee), '仅代码独占时允许切换');
  assert.ok(/codeEditMask/.test(ee), 'PC 须遮罩');
  // 稳定ID（对齐 PlanC data-pr-id）：宿主/帧双端优先认，写盘自动补
  assert.ok(/data-pr-id/.test(ee.match(/function generateSelector[\s\S]*?\n\}/)[0]), '宿主选择器须优先认 data-pr-id');
  assert.ok(/data-pr-id/.test(agentSrc), '帧模板 makeSel 须优先认 data-pr-id');
  assert.ok(/function prIdEnsureInjected\(/.test(ee), '前端须有补ID函数');
  assert.ok(/function ensurePrIdInjected\(/.test(mainSrc), '主进程写盘须有补ID函数');
  assert.ok(/codeEditBackfillPrIds\(dir, file, srcHtml, selector, hint, label\)/.test(ee), '多命中须走补ID迁移而非直接报错');
  assert.ok(/function codeEditLoading\(/.test(ee), '补ID须有等待loading');
  assert.ok(/pickIndex/.test(agentSrc), '帧须上报元素序号pickIndex');
  assert.ok(/pickIndex/.test(coreSrc), '宿主PICK链路须透传序号pickIndex');
  assert.ok(/保留元素现有的 data-pr-id/.test(ee), '发模型提示须要求保留 data-pr-id');
  // 内嵌模式须盖住文档头/页签/搜索（截图：头栏页签仍可见即未盖住）
  assert.ok(/headEl.*docs-head/.test(ee) || /docs-head/.test(ee.match(/var titleEl[\s\S]{0,1200}bodyEl\.insertBefore/)[0]), '内嵌须隐藏文档头');
  assert.ok(/tabsEl.*docModeTabs/.test(ee), '内嵌须隐藏功能说明/需求页签');
  assert.ok(/\.docs-body:has\(>\s*\.code-edit-inline\)/.test(css), '内嵌须占满文档体');
  // 多命中须消歧而非直接报错（重复组件如列表卡片/导航项）
  assert.ok(/function codeEditDisambiguate\(/.test(ee), '须有重复命中消歧');
  assert.ok(/matchIndex/.test(ee), '须记录命中序号供保存复用');
  assert.ok(/重复组件/.test(ee), '多命中提示须说明重复组件原因与父级容器解法');
  // ---- 4. 全链路稳定ID：需求拾取/交互绑定/标注 ----
  assert.ok(/pickIndex: \(res && typeof res\.pickIndex/.test(ee), '远端拾取项须存序号');
  assert.ok(/pickIndex: \(typeof only\.pickIndex/.test(ee), '检查器入口须透传序号');
  assert.ok(/pickIndex: \(info && typeof info\.pickIndex/.test(lbSrc), '检查器须记住远端序号');
  assert.ok(/function lbUpgradeToPrId\(/.test(lbSrc), '绑定须有升级函数');
  assert.ok(/stampEl/.test(lbSrc), '打戳须落到升级后元素');
  assert.ok(/origSel/.test(lbSrc), '升级须迁移旧选择器条目');
  assert.ok(/function prIdBackfillFileInBackground\(/.test(ee), '须有后台补ID共享函数');
  assert.ok(/function prIdPickUpgrade\(/.test(ee), '须有升级内核供三链路复用');
  assert.ok(/function prIdUpgradeParts\(/.test(ee), '发送入列前须升级部件选择器');
  assert.ok(/prIdUpgradeParts\(rawParts, _sdir, doPushBatch\)/.test(ee), '批量提交须先升级再入列');
  assert.ok(/prIdUpgradeParts\(rawInd, _sdir2, doPushInd\)/.test(ee), '独立提交须先升级再入列');
  assert.ok(/prIdUpgradeParts\(parts, _sdir, pushUpgraded\)/.test(ee), '输入条发送须先升级再入列');
  // 移动端分支无 MaskStack、无 mask 元素
  assert.ok(/else\{\s*\/\* 移动端/.test(ee), '须有移动端分支');
  const mobIdx = ee.indexOf('移动端：嵌文档面板区展示');
  const mobBlock = ee.slice(mobIdx, mobIdx + 2200);
  assert.ok(!/MaskStack\.push/.test(mobBlock), '移动端分支不得推遮罩');
  assert.ok(/setDocsOpen/.test(mobBlock), '移动端须借文档面板展示');
  assert.ok(/codeEditMask/.test(ee.match(/function isAnyPopupOpen[\s\S]*?\n\}/)[0]), '弹窗门禁须含 codeEditMask');
  console.log('[PASS] 布局与双端');
})();

console.log('CODEEDIT_PASS: 代码编辑抽屉全绿');
