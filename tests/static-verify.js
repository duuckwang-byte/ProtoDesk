// Wave-E 加固版静态验证：对照 tests/ 用例断言逐项检查改后代码仍满足（环境无法跑 GUI 回归时的替代佐证）
// 相对上一版改进（审计报告第四章第1节 static-verify 脆弱 → 消除误报，只做加法，原有门禁全部保留）：
//   I1 stripJs/stripCss/stripHtmlComment: 残留类门禁（theme/gradient/shortcut/ghost）先剥离注释再扫，
//      注释里提及“已移除 theme/渐变/快捷键”不再误报；真实代码残留仍能命中（注释外全文保留）。
//   I2 ghost 门禁剥离字符串字面量：文档/提示文案里出现保留字不再误报，真实裸引用仍命中。
//   I3 emoji 白名单擴充：保留“彩色 emoji 清零”红线，仅放行单色 UI 排版符（✔✓★☆○●◆◇■□▲△▶▷◁→←↑↓↔··…—– + 原有 ✕✎▾«＋▸）。
//   I4 覆盖 Wave-C/F/G 新模块：emoji/ghost 同步扫描 js/store.js·event-bus.js·sandbox-agent.js·utils.js·main.js（ESM），
//      经典 9 文件断言一行未动。
//   I5 新增 Wave-E 契约门（E-前缀）：eslint.config.js / .prettierrc.json / JSDoc(@param/@returns/@typedef) / 72通道冻结。
//      任一缺失即 STATIC_FAIL，但全部为“存在性”检查，不改业务逻辑。
const fs = require('fs');
const path = require('path');
const fails = [];

const html = fs.readFileSync(path.join(__dirname, '..', '原型+文档.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
const js = {};
for (const f of ['core-docs', 'nav-zoom', 'sandbox-core', 'project-ai-export', 'edit-entry', 'link-bind', 'icons', 'annotation-core', 'mask-manager']) {
  js[f] = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
}
// I4: 新模块同步扫描（只用于 emoji/ghost/JS 契约门，不参与旧断言，避免行为漂移）
const jsNew = {};
for (const f of ['store', 'event-bus', 'sandbox-agent', 'utils', 'main']) {
  try { jsNew[f] = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'); } catch (e) { jsNew[f] = ''; }
}

// ── Wave-E I1/I2 剥离 helpers（仅残留类门禁使用；存在性断言仍用原文，避免假阴性） ──
function stripJs(s) {
  let r = String(s || '');
  r = r.replace(/\/\*[\s\S]*?\*\//g, '\n'); // 块注释（含 JSDoc）
  r = r.replace(/(^|[^\:'"\\])\/\/[^\n]*/g, '$1'); // 行注释（字符串内 // 误伤可接受：红线扫描用）
  return r;
}
function stripCss(s) {
  return String(s || '').replace(/\/\*[\s\S]*?\*\//g, '\n');
}
function stripJsStrings(s) {
  // 剥离单/双引号与模板字符串（保留代码标识符，文案误报消除）
  return String(s || '').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
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
// 检查器三板块：修改需求首位默认展开（浅橙），跳转/标注默认收起（浅绿/浅蓝）
if (!(html.indexOf('id="liSecReq"') < html.indexOf('id="liSecJump"') && html.indexOf('id="liSecJump"') < html.indexOf('id="liSecAnno"'))) fails.push('full-sim: 板块顺序须 修改需求/跳转交互/需求标注');
if (!/id="liSecReq"[^>]*class="[^"]*open/.test(html) && !/class="[^"]*open"[^>]*id="liSecReq"/.test(html)) fails.push('full-sim: 修改需求须默认展开');
if (/id="liSecJump"[^>]*class="[^"]*open/.test(html) || /class="[^"]*open"[^>]*id="liSecJump"/.test(html)) fails.push('full-sim: 跳转交互须默认收起');
if (/id="liSecAnno"[^>]*class="[^"]*open/.test(html) || /class="[^"]*open"[^>]*id="liSecAnno"/.test(html)) fails.push('full-sim: 需求标注须默认收起');
if (!/\.li-card\.req-card\s*\{[^}]*#FED7AA/.test(css)) fails.push('full-sim: 修改需求须浅橙色');
if (!/\.li-card\.jump-card\s*\{[^}]*#BBF7D0/.test(css)) fails.push('full-sim: 跳转交互须浅绿色');
if (!/\.li-card\.anno-card\s*\{[^}]*#BAE6FD/.test(css)) fails.push('full-sim: 需求标注须浅蓝色');
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
// T4.3 用户决策：主题系统彻底剥离，此处翻转为零残留断言（I1: 剥离注释后扫，注释提及不再误报）
{
  const htmlCode = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const paeCode = stripJs(js['project-ai-export']);
  const cssCode = stripCss(css);
  if (/themeAuto/.test(htmlCode) || /themeDark/.test(htmlCode)) fails.push('theme残留: 设置 radio 未清除');
  if (/function applyTheme/.test(paeCode)) fails.push('theme残留: applyTheme 未剥离');
  if (/planb-theme/.test(paeCode)) fails.push('theme残留: planb-theme 未剥离');
  if (/data-theme/.test(cssCode)) fails.push('theme残留: css data-theme 未剥离');
  if (/prefers-color-scheme/.test(htmlCode) || /prefers-color-scheme/.test(paeCode) || /prefers-color-scheme/.test(cssCode)) fails.push('theme残留: prefers-color-scheme 未剥离');
}
if (!/\.workbench-narrow-tip/.test(css)) fails.push('narrow: 窄屏提示样式缺失');
if (!/id="workbenchNarrowTip"/.test(html)) fails.push('narrow: 窄屏提示元素缺失');
if (!/height:40px/.test(css)) fails.push('header: 顶栏应为 40px');
// 用户需求变更：全局 Ctrl+B / Ctrl+\ 快捷键已移除（不应存在全局 keydown 绑定）（I1: 剥离注释后扫）
if (/keydown\b[\s\S]{0,200}ctrlKey/.test(stripJs(js['sandbox-core']))) fails.push('shortcut: 不应存在 Ctrl 快捷键监听');
// emoji 清零（HTML 与 JS，保留单色排版符；I3 白名单擴充，I4 新模块同步扫）
{
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;
  const allow = new Set(Array.from('✕✎▾«＋▸✔✓★☆○●◆◇■□▲△▶▷◁→←↑↓↔·…—–'));
  const pools = [['html', html], ...Object.entries(js), ...Object.entries(jsNew).map(([k, v]) => ['js/' + k, v])];
  for (const [name, content] of pools) {
    const m = (String(content).match(emojiRe) || []).filter((ch) => !allow.has(ch));
    if (m.length) fails.push('emoji 残留[' + name + ']: ' + m.join(''));
  }
}
// 渐变清零（I1: 剥离 CSS 注释后扫，注释说明不再误报）
if (/linear-gradient/.test(stripCss(css))) fails.push('css 仍有 linear-gradient');

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

// ── 幽灵变量零引用（I2: 剥离注释+字符串后扫，文案/注释提及不再误报，真实裸引用仍命中；I4 新模块同步扫） ──
{
  const allJs = Object.assign({}, js, jsNew);
  for (const [fname, content] of Object.entries(allJs)) {
    const code = stripJsStrings(stripJs(content));
    const m = (code.match(/\b(sbFabEl|kindTagEl|btnPickCli|btnAutoCli|cliPathInfoEl|btnSelectRecModels|aiTargetPageTop|aiModelTop|btnResetDoc|editDrawerTipEl)\b/g) || []).filter((v, i, a) => a.indexOf(v) === i);
    if (m.length) fails.push('ghostref[' + fname + ']: 幽灵变量残留 ' + m.join(','));
  }
}

// ── 模型获取弹窗 + 全选/取消全选 ──
for (const id of ['modelFetchMask', 'modelFetchModal', 'modelFetchList', 'fetchSearchInput', 'fetchSelectCount', 'btnFetchModels2', 'modelFetchClose', 'modelFetchCancel', 'modelFetchOk', 'btnFetchSelectAll', 'btnFetchDeselectAll']) {
  if (!new RegExp('id="' + id + '"').test(html)) fails.push('modelfetch: DOM 缺失 #' + id);
}
if (/id="btnSelectAllModels"/.test(html) || /btnSelectAllModels/.test(js['project-ai-export'])) fails.push('modelfetch: 旧全选按钮未彻底移除');
if (!/function batchFetchCheck\(want\)/.test(js['project-ai-export'])) fails.push('modelfetch: 批量勾选 batchFetchCheck 缺失');
if (!/batchFetchCheck\(true\)/.test(js['project-ai-export']) || !/batchFetchCheck\(false\)/.test(js['project-ai-export'])) fails.push('modelfetch: 全选/取消全选未接 batchFetchCheck');
// ── 下拉：在用模型被移除后不再显示，自动落首个 ──
if (!/被移出配置/.test(js['project-ai-export']) || !/aiStoreModel\(cur\)/.test(js['project-ai-export'])) fails.push('modeldropdown: 移除回落逻辑缺失');
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

// ── Wave-E 契约门（I5: 只做存在性加法，不改旧断言语义） ──
{
  // E1: ESLint flat config + Prettier 规则存在
  let ecfg = '';
  try { ecfg = fs.readFileSync(path.join(__dirname, '..', 'eslint.config.js'), 'utf8'); } catch (e) { ecfg = ''; }
  if (!ecfg || !/no-eval/.test(ecfg) || !/no-new-func/.test(ecfg)) fails.push('E-eslint: eslint.config.js 缺失或缺少 no-eval/no-new-func 红线');
  let prc = null;
  try { prc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.prettierrc.json'), 'utf8')); } catch (e) { prc = null; }
  if (!prc || prc.singleQuote !== true) fails.push('E-prettier: .prettierrc.json 缺失或 singleQuote 非 true');
  // E2: JSDoc 契约覆盖（重点文件必须含 /** + @param + @returns；契约源另需 @typedef）
  const needJsdoc = ['preload.js', 'main/ipc-contract.js', 'main/controllers/git-controller.js', 'main/controllers/sandbox-controller.js', 'main/controllers/ai-controller.js', 'main/controllers/doc-controller.js', 'main/controllers/window-controller.js', 'main/services/ai-config-store.js', 'platform/env.js', 'runtimes/defs/factory.js', 'js/store.js', 'js/event-bus.js', 'js/sandbox-agent.js', 'js/utils.js'];
  for (const rel of needJsdoc) {
    let src = '';
    try { src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); } catch (e) { src = ''; }
    if (!src || !/\/\*\*/.test(src) || !/@param\b/.test(src) || !/@returns?\b/.test(src)) fails.push('E-jsdoc: 契约注释缺失 ' + rel);
  }
  for (const rel of ['main/ipc-contract.js', 'preload.js']) {
    let src = '';
    try { src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); } catch (e) { src = ''; }
    if (!/@typedef/.test(src)) fails.push('E-jsdoc: 缺 @typedef ' + rel);
  }
  // E3: 74 通道冻结（controllers handle 去重 74 且与 contract 一致，含 ai:open-terminal）
  try {
    const contract = require(path.join(__dirname, '..', 'main', 'ipc-contract.js'));
    const want = (contract && contract.IPC_CHANNELS) || [];
    if (!Array.isArray(want) || want.length !== 74) fails.push('E-ipc: contract 非 74（实际 ' + (want && want.length) + '）');
    else {
      const got = new Set();
      const cdir = path.join(__dirname, '..', 'main', 'controllers');
      for (const cf of fs.readdirSync(cdir)) {
        if (!cf.endsWith('.js')) continue;
        const src = fs.readFileSync(path.join(cdir, cf), 'utf8');
        let m;
        const re = /handle\('([^']+)'/g;
        while ((m = re.exec(src))) got.add(m[1]);
      }
      if (got.size !== 74) fails.push('E-ipc: controllers 非 74（实际 ' + got.size + '）');
      else {
        const diff = contract.diffChannels(Array.from(got));
        if (!diff.ok) fails.push('E-ipc: 冻结不一致 缺失:' + diff.missing.join(',') + ' 多余:' + diff.extra.join(','));
      }
    }
  } catch (e) { fails.push('E-ipc: 冻结校验异常 ' + String((e && e.message) || e)); }
}

// ── P0: Store 空值洗全局回归门（只做加法，不动原有断言） ──
{
  const paeSrc = js['project-ai-export'] || '';
  const storeSrc = (jsNew && jsNew.store) || '';
  // E-p0a: enterProject 必须写穿 Store（置全局后 guarded 调用 setCurrentProject）
  const epIdx = paeSrc.indexOf('function enterProject');
  const scIdx = paeSrc.indexOf('setCurrentProject', epIdx >= 0 ? epIdx : 0);
  if (epIdx < 0 || scIdx < 0 || scIdx < epIdx) fails.push('E-p0a: enterProject 未写穿 Store.setCurrentProject');
  else {
    const seg = paeSrc.slice(epIdx, scIdx + 64);
    if (!/window\.Store\.setCurrentProject/.test(seg)) fails.push('E-p0a: enterProject 未经 window.Store.setCurrentProject 写穿');
  }
  // E-p0b: syncWindow 绝不用 Store 空值覆盖 window 真值（_project 守卫 + _queue 空数组语义）
  const swIdx = storeSrc.indexOf('function syncWindow');
  const swSeg = swIdx >= 0 ? storeSrc.slice(swIdx, swIdx + 1600) : '';
  if (!swSeg || !/if\s*\(\s*_project\s*\|\|/.test(swSeg) || !/!window\.currentProject/.test(swSeg)) fails.push('E-p0b: syncWindow 缺 _project 空值不覆盖守卫');
  if (!swSeg || !/_queue\s*!==\s*undefined/.test(swSeg) || !/_queue\s*!==\s*null/.test(swSeg)) fails.push('E-p0b: syncWindow 缺 _queue 空数组语义守卫（仅 undefined/null 不覆盖）');
  // E-p0c: 拾取看门狗不得在焦点位于原型帧内时退出（沙箱跨进程帧下 document.hasFocus 不可靠，误杀悬停框）
  const eeSrc = js['edit-entry'] || '';
  const wdIdx = eeSrc.indexOf('document.hasFocus');
  const wdSeg = wdIdx >= 0 ? eeSrc.slice(Math.max(0, wdIdx - 600), wdIdx + 200) : '';
  if (!wdSeg || !/activeElement\s*===\s*frame/.test(wdSeg)) fails.push('E-p0c: 拾取看门狗缺 intoFrame 守卫（焦点在帧内时不得 exit）');
}

console.log(fails.length ? 'STATIC_FAIL:\n  ' + fails.join('\n  ') : 'STATIC_PASS: 全部静态约束校验通过（9 经典 JS + 5 新模块 + HTML + CSS + Wave-E 契约门）');
process.exitCode = fails.length ? 1 : 0;
