// 一次性静态验证：对照 tests/ 用例断言逐项检查改后代码仍满足（环境无法跑 GUI 回归时的替代佐证）
const fs = require('fs');
const path = require('path');
const fails = [];

const html = fs.readFileSync(path.join(__dirname, '..', '原型+文档.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
const js = {};
for (const f of ['core-docs', 'nav-zoom', 'sandbox-core', 'project-ai-export', 'edit-entry', 'link-bind', 'icons', 'annotation-core', 'mask-manager']) {
  js[f] = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
}

// ── full-simulation.js 断言 ──
// Sim1: 侧栏 Docked 收起宽0 / 展开≥200 / 遮罩 none / 文档面板收展
if (!/body\.sb-open \.sb\{width:220px/.test(css) && !/body\.sb-open \.sb\{width:200px/.test(css)) fails.push('full-sim: 侧栏展开宽度规则缺失');
if (!/\.sb\{flex:none;width:0/.test(css)) fails.push('full-sim: 侧栏收起宽度规则缺失');
if (!/body\.kind-pc \.docs-panel\{position:fixed/.test(css)) fails.push('full-sim: PC 文档面板需 fixed');
if (!/body\.kind-pc \.req-panel\{position:fixed/.test(css)) fails.push('full-sim: PC req 面板需 fixed');
if (!/body\.kind-pc\.docs-open \.docs-panel\{transform:translateX\(0\)/.test(css)) fails.push('full-sim: docs-open 打开规则缺失');
if (!/\.sheet-mask\{/.test(css)) fails.push('full-sim: sheet-mask 存在');
// Sim2: 检查器卡片
if (!/jump-card/.test(css) || !/jump-card/.test(html)) fails.push('full-sim: jump-card 缺失');
if (!/anno-card/.test(css) || !/anno-card/.test(html)) fails.push('full-sim: anno-card 缺失');
if (!/req-card/.test(css) || !/req-card/.test(html)) fails.push('full-sim: req-card 缺失');
if (!/\.li-divider/.test(css)) fails.push('full-sim: li-divider 缺失');
if (!/id="liTitle"/.test(html)) fails.push('full-sim: liTitle 缺失');
if (!/id="liReqText"/.test(html)) fails.push('full-sim: liReqText 缺失');
if (!/id="projNewName"/.test(html)) fails.push('full-sim: projNewName 缺失');
// Sim4: 导出 HTML 必须含 Docked 侧栏样式 + 卡片 + 核心函数
if (!/buildExportHtml/.test(js['project-ai-export'])) fails.push('full-sim: buildExportHtml 缺失');
if (!/function setSbOpen/.test(js['project-ai-export'])) fails.push('full-sim: setSbOpen 缺失');
if (!/function extractElementText/.test(js['edit-entry'])) fails.push('full-sim: extractElementText 缺失');
// Sim5: 最新需求编辑保存
if (!/id="btnEditDoc"/.test(html) || !/id="docEditArea"/.test(html) || !/id="btnSaveDoc"/.test(html)) fails.push('full-sim: 需求编辑控件缺失');

// ── title-toc.js ──
if (!/id="btnToc"/.test(html)) fails.push('title-toc: btnToc 缺失');
if (!/bind-flash/.test(css)) fails.push('title-toc: bind-flash 缺失');

// ── project-flow / guard-and-rename ──
for (const id of ['projMask', 'projList', 'projNewName', 'projNewBtn', 'projOk', 'sbProject', 'sbList', 'btnAddSource', 'btnSettings', 'sbTrigger']) {
  if (!new RegExp('id="' + id + '"').test(html)) fails.push('DOM 缺失: #' + id);
}

// ── 新改动核心 ──
if (!/js\/icons\.js/.test(html)) fails.push('icons: HTML 未引入 icons.js');
if (!/EXPORT_SCRIPT_FILES=\['js\/icons\.js'/.test(js['project-ai-export'])) fails.push('icons: 导出清单未含 icons.js');
if (!/window\.PlanBIcon/.test(js['icons'])) fails.push('icons: PlanBIcon 未定义');
if (!/initPlanbIcons/.test(js['icons'])) fails.push('icons: initPlanbIcons 未定义');
for (const tab of ['tabNavAi', 'tabNavModels', 'tabNavSandbox', 'tabNavAbout']) {
  if (!new RegExp('id="' + tab + '"').test(html)) fails.push('settings: 设置 Tab 缺失 #' + tab);
}
for (const pane of ['paneSetAi', 'paneSetModels', 'paneSetSandbox', 'paneSetAbout']) {
  if (!new RegExp('id="' + pane + '"').test(html)) fails.push('settings: 设置 Pane 缺失 #' + pane);
}
// T4.3 用户决策：主题系统彻底剥离，此处翻转为零残留断言
if (/themeAuto/.test(html) || /themeDark/.test(html)) fails.push('theme残留: 设置 radio 未清除');
if (/function applyTheme/.test(js['project-ai-export'])) fails.push('theme残留: applyTheme 未剥离');
if (/planb-theme/.test(js['project-ai-export'])) fails.push('theme残留: planb-theme 未剥离');
if (/data-theme/.test(css)) fails.push('theme残留: css data-theme 未剥离');
if (/prefers-color-scheme/.test(html) || /prefers-color-scheme/.test(js['project-ai-export']) || /prefers-color-scheme/.test(css)) fails.push('theme残留: prefers-color-scheme 未剥离');
if (!/\.workbench-narrow-tip/.test(css)) fails.push('narrow: 窄屏提示样式缺失');
if (!/id="workbenchNarrowTip"/.test(html)) fails.push('narrow: 窄屏提示元素缺失');
if (!/height:40px/.test(css)) fails.push('header: 顶栏应为 40px');
// 用户需求变更：全局 Ctrl+B / Ctrl+\ 快捷键已移除（不应存在全局 keydown 绑定）
if (/keydown\b[\s\S]{0,200}ctrlKey/.test(js['sandbox-core'])) fails.push('shortcut: 不应存在 Ctrl 快捷键监听');
// emoji 清零（HTML 与 JS，保留 ✕ 排版字符）
const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
for (const [name, content] of [['html', html], ...Object.entries(js)]) {
  const m = (content.match(emojiRe) || []).filter(ch => !'✕✎▾«＋'.includes(ch));
  if (m.length) fails.push('emoji 残留[' + name + ']: ' + m.join(''));
}
// 渐变清零
if (/linear-gradient/.test(css)) fails.push('css 仍有 linear-gradient');

// ── 模块一 Ctrl 即时拾取（01 开发规格）断言 ──
const ee = js['edit-entry'];
if (!/var CTRL_PICK = \{/.test(ee)) fails.push('ctrl-pick: CTRL_PICK 命名空间缺失');
if (!/window\.CTRL_PICK = CTRL_PICK/.test(ee)) fails.push('ctrl-pick: window.CTRL_PICK 未暴露');
if (!/function bindCtrlInspectListeners/.test(ee)) fails.push('ctrl-pick: bindCtrlInspectListeners 缺失');
if (!/__ctrlPickBound/.test(ee)) fails.push('ctrl-pick: 防重标志 __ctrlPickBound 缺失');
if (!/__ctrlScrollBound/.test(ee)) fails.push('ctrl-pick: 滚动防重标志 __ctrlScrollBound 缺失');
if (!/function renderMultiEditPanel/.test(ee)) fails.push('ctrl-pick: renderMultiEditPanel 缺失');
if (!/function switchMultiEditTab/.test(ee)) fails.push('ctrl-pick: switchMultiEditTab 缺失');
if (!/function ensurePickOverlay/.test(ee)) fails.push('ctrl-pick: ensurePickOverlay 缺失');
if (!/submitBatch/.test(ee)) fails.push('ctrl-pick: submitBatch 缺失');
if (!/CTRL_PICK\.submitBatch\(isIndiv\?'individual':'batch'\)/.test(ee)) fails.push('ctrl-pick: 提交模式应动态感知 Tab');
if (!/__EXPORT_BOOT__===true\)return/.test(ee)) fails.push('ctrl-pick: 导出隔离缺失');
if (!/targetWindow\.document/.test(ee) || !/activeElement/.test(ee)) fails.push('ctrl-pick: 焦点检测应从目标窗口自身 document 读取');
if (!/ctrlPickCrosshairStyle/.test(ee)) fails.push('ctrl-pick: iframe 内准星注入缺失');
if (!/targetEl\.tagName/.test(ee) && !/tag === 'html' \|\| tag === 'body'/.test(ee)) fails.push('ctrl-pick: html/body 过滤缺失');
// HTML 容器
if (!/id="selectionOverlay"/.test(html)) fails.push('ctrl-pick: #selectionOverlay 缺失');
if (!/id="ctrlPickTip"/.test(html)) fails.push('ctrl-pick: #ctrlPickTip 缺失');
if (!/id="multiEditDrawer"/.test(html)) fails.push('ctrl-pick: #multiEditDrawer 缺失');
if (!/id="multiEditMask"/.test(html)) fails.push('ctrl-pick: #multiEditMask 缺失');
for (const id of ['tabBatchMode','tabIndividualMode','viewBatchMode','viewIndividualMode','selChipsList','batchReqInput','individualItemsList','btnCancelMultiEdit','btnSubmitMultiEdit']) {
  if (!new RegExp('id="' + id + '"').test(html)) fails.push('ctrl-pick: DOM 缺失 #' + id);
}
// CSS
if (!/body\.ctrl-inspecting/.test(css)) fails.push('ctrl-pick: ctrl-inspecting 样式缺失');
if (!/#editHover\.ctrl-hover/.test(css)) fails.push('ctrl-pick: ctrl-hover 蓝色化样式缺失');
if (!/#selectionOverlay\{/.test(css)) fails.push('ctrl-pick: #selectionOverlay 样式缺失');
if (!/\.selection-box-overlay/.test(css) || !/\.selection-badge/.test(css)) fails.push('ctrl-pick: 覆盖层框/角标样式缺失');
if (!/\.sel-chip/.test(css) || !/\.indiv-item/.test(css)) fails.push('ctrl-pick: 批量面板内容样式缺失');

// ── 编辑按钮移除 + 待提交列表常驻显隐 ──
if (/id="modeSeg"/.test(html) || /id="btnModePrev"/.test(html) || /id="btnModeEdit"/.test(html)) fails.push('editbtn: 预览/编辑切换按钮未移除');
if (!/btnSubmitEditEl\s*\)\s*btnSubmitEditEl\.style\.display=n\?'':'none'/.test(ee) && !/btnSubmitEditEl\.style\.display=n\?'':'none'/.test(ee)) fails.push('editbtn: 待提交按钮应按队列内容显隐缺失');
if (!/id="btnSubmitEdit"/.test(html)) fails.push('editbtn: 待提交列表按钮缺失');

// ── 幽灵变量零引用（未声明变量在 if 中直接抛 ReferenceError，会中断整文件加载致全部按钮失效） ──
for (const [fname, content] of Object.entries(js)) {
  const m = (content.match(/\b(sbFabEl|kindTagEl|btnPickCli|btnAutoCli|cliPathInfoEl|btnSelectRecModels|aiTargetPageTop|aiModelTop|btnResetDoc|editDrawerTipEl)\b/g) || []).filter((v, i, a) => a.indexOf(v) === i);
  if (m.length) fails.push('ghostref[' + fname + ']: 幽灵变量残留 ' + m.join(','));
}

// ── 模型获取弹窗 + 全选移除 ──
for (const id of ['modelFetchMask', 'modelFetchModal', 'modelFetchList', 'fetchSearchInput', 'fetchSelectCount', 'btnFetchModels2', 'modelFetchClose', 'modelFetchCancel', 'modelFetchOk']) {
  if (!new RegExp('id="' + id + '"').test(html)) fails.push('modelfetch: DOM 缺失 #' + id);
}
if (/id="btnSelectAllModels"/.test(html) || /btnSelectAllModels/.test(js['project-ai-export'])) fails.push('modelfetch: 全选按钮未彻底移除');
if (!/function openModelFetch/.test(js['project-ai-export']) || !/function closeModelFetch/.test(js['project-ai-export'])) fails.push('modelfetch: 获取弹窗 open/close 缺失');
if (!/function setVisibleModels/.test(js['project-ai-export']) || !/model-del/.test(js['project-ai-export'])) fails.push('modelfetch: 可见集合/删除按钮逻辑缺失');
if (!/scrollbar-gutter:\s*stable/.test(css)) fails.push('settings: 防挤压 scrollbar-gutter 缺失');

// ── AI 弹窗：游离遮罩清除（灰罩残留修复） ──
const pae = js['project-ai-export'];
if (!/function sweepStrayMasks/.test(pae)) fails.push('mask: sweepStrayMasks 缺失');
if (!/\.drawer-mask/.test(pae)) fails.push('mask: 应扫描全部 .drawer-mask');
if (!/closeAi\(\)\{/.test(pae) || !/sweepStrayMasks\(\)/.test(pae.split('function closeAi')[1] || '')) fails.push('mask: closeAi 未清除游离遮罩');

// ── 模型输出转义（XSS / 借用样式根治） ──
if (!/escHtml\(withPlaceholder\)/.test(pae)) fails.push('xss: formatAiText 未对代码块外原文转义');
if (!/function scrubAiChatView/.test(pae)) fails.push('xss: scrubAiChatView 兜底清扫缺失');
if (!/drawer-mask,\.ai-mask,\.modal-mask,\.sheet-mask/.test(pae)) fails.push('xss: scrub 未覆盖工具遮罩类名');
// ── 菜单栏流畅与防闪烁：收敛定时器 + 防文字变形 ──
if (!/sbFitTimer/.test(pae)) fails.push('sb: setSbOpen 未使用收敛定时器');
if (/setTimeout\(fitPhone,120\)/.test(pae)) fails.push('sb: 仍在动画中途强制重排');
if (!/transitionend/.test(pae)) fails.push('sb: 未监听 transitionend 收敛');
if (!/\.sb-head,\.sb-list,\.sb-foot\{width:220px/.test(css)) fails.push('sb: 侧栏子容器宽度未固定 220px（将导致收起时文字换行挤压变形）');

console.log(fails.length ? 'STATIC_FAIL:\n  ' + fails.join('\n  ') : 'STATIC_PASS: 全部静态约束校验通过（' + Object.keys(js).length + ' 个 JS + HTML + CSS）');
process.exitCode = fails.length ? 1 : 0;