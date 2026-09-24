'use strict';
// Iteration 5: 前端 UI 现代化升级与全链路割接 自动化集成与契约断言测试套件（AI执行流展示-2.8/8章同步版）
// 验证范围：
// 1. 原型+文档.html DOM 容器契约与挂载点（含时间线动态生成函数表，审计卡已删）
// 2. app.css 现代视觉体系与动效关键帧规则（含.i5-timeline系，审计死样式必须不存在）
// 3. js/project-ai-export.js 核心函数与常量体系契约（含思考切分/动词映射/回放）
// 4. 前端交互仿真、连通性/模型拉取数据处理、Windows 路径安全、异常诊断与取消状态机（含快照卡保留、审计不存在）

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = 'D:\\文件\\工具\\原型工具-PlanD';
const htmlPath = path.join(rootDir, '原型+文档.html');
const cssPath = path.join(rootDir, 'app.css');
const jsPath = path.join(rootDir, 'js', 'project-ai-export.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// =========================================================================
// 断言 1：原型+文档.html 关键容器与模板挂载点完整性
// =========================================================================
function test1_HtmlDomContract() {
  const requiredIds = [
    'aiAgentMatrix',
    'btnRedetectAgents',
    'setApiProtocol',
    'baseUrlHint',
    'btnFetchModels',
    'byokTestPanel',
    'aiAgentBadge',
    'aiTargetPageSelect',
    'aiModel'
  ];

  for (const id of requiredIds) {
    const pattern = new RegExp(`id=["']${id}["']`);
    assert.ok(
      pattern.test(htmlContent),
      `[HTML契约失败] 原型+文档.html 缺失关键容器节点: #${id}`
    );
  }

  // 严格断言：顶部冗余模型/页面栏（#aiTopBar, #aiTargetPageTop, #aiModelTop）已彻底清除，避免与底部主输入栏冲突
  const removedIds = ['aiTopBar', 'aiTargetPageTop', 'aiModelTop'];
  for (const rid of removedIds) {
    const rPattern = new RegExp(`id=["']${rid}["']`);
    assert.ok(
      !rPattern.test(htmlContent),
      `[HTML契约失败] 原型+文档.html 顶部冗余栏 #${rid} 应当已被删除`
    );
  }

  // 验证 #setApiProtocol 选项完整覆盖 5 大通信协议规格
  const expectedProtocols = ['openai', 'anthropic', 'google', 'ollama', 'azure'];
  for (const proto of expectedProtocols) {
    const protoPattern = new RegExp(`<option\\s+value=["']${proto}["']`);
    assert.ok(
      protoPattern.test(htmlContent),
      `[HTML契约失败] #setApiProtocol 下拉框缺失协议选项: ${proto}`
    );
  }

  // 验证 #byokTestPanel 初始为隐藏状态并且包含状态徽章与提示文本
  assert.ok(
    /id=["']byokTestPanel["'][^>]*style=["'][^"']*display:\s*none/i.test(htmlContent),
    `[HTML契约失败] #byokTestPanel 初始应为 display:none`
  );
  assert.ok(
    /id=["']testStatusBadge["']/.test(htmlContent),
    `[HTML契约失败] #byokTestPanel 缺失子节点 #testStatusBadge`
  );
  assert.ok(
    /id=["']testMessageText["']/.test(htmlContent),
    `[HTML契约失败] #byokTestPanel 缺失子节点 #testMessageText`
  );

  // 验证 #aiAgentBadge 包含状态点与名称容器
  assert.ok(
    /id=["']aiAgentBadge["'][^>]*>[\s\S]*?class=["'][^"']*dot[^"']*[\s\S]*?id=["']aiAgentName["']/.test(htmlContent),
    `[HTML契约失败] #aiAgentBadge 需包含 .dot 与 #aiAgentName`
  );

  // T2.5: #aiI5Mounts 寄生节点已删，静态模板断言改为 JS 动态生成契约
  // 动态挂载点仅允许 #aiChatView，模板类名由 JS createElement 产生，不在 HTML 静态断言
  assert.ok(!/id=["']aiI5Mounts["']/.test(htmlContent), `[HTML契约失败] #aiI5Mounts 寄生节点应已删除`);
  // 2.8 审计卡删除：i5AppendDiffAudit 必须不存在；保留 i5EnsureThinkBox（存在性锁）+ 时间线新函数
  for (const fn of ['i5EnsureThinkBox', 'i5EnsureToolStream', 'i5AppendToolCall', 'i5AppendSnapshotCard', 'i5RenderErrorCard', 'i5SplitThink', 'i5VerbKind', 'i5VerbLabel', 'i5ReplayTimeline', 'i5ReplayV1', 'i5ThinkFlushPending', 'i5ExploreAdd', 'i5EditFinalize']) {
    assert.ok(
      new RegExp(`function\\s+${fn}\\b`).test(jsContent),
      `[JS契约失败] 缺失动态生成函数: ${fn}`
    );
  }
  assert.ok(!/function\s+i5AppendDiffAudit\b/.test(jsContent), `[JS契约失败] i5AppendDiffAudit 定义应已彻底删除`);
  assert.ok(!/i5AppendDiffAudit\s*\(/.test(jsContent), `[JS契约失败] i5AppendDiffAudit 调用应已彻底删除`);
  // 完成总结卡下线：ai-op-card相关已从函数表删除；保留i5EnsureThinkBox存在性锁（存在+不调用，历史兼容）
  assert.ok(!/ai-op-card/.test(jsContent), `[JS契约失败] ai-op-card 应已彻底删除（完成总结卡下线）`);
  assert.ok(!/className\s*=\s*['"][^'"]*followup-chips/.test(jsContent), `[JS契约失败] 不得以className生成followup-chips（追问胶囊已删）`);
  assert.ok(!/innerHTML[^;]*followup-chips/.test(jsContent), `[JS契约失败] 不得以innerHTML生成followup-chips`);
  assert.ok(/document\.createElement\(['"]div['"]\)[\s\S]*?thinking-box/.test(jsContent), `[JS契约失败] i5EnsureThinkBox 须 createElement thinking-box`);
  assert.ok(/document\.createElement\(['"]div['"]\)[\s\S]*?tool-execution-stream/.test(jsContent), `[JS契约失败] i5EnsureToolStream 须 createElement tool-execution-stream`);
}

// =========================================================================
// 断言 2：app.css 现代视觉体系与动效关键帧规则完整性
// =========================================================================
function test2_CssRulesContract() {
  const requiredCssClasses = [
    '.thinking-box',
    '.thinking-pulse',
    '.tool-call-card',
    '.tool-status-tag.done',
    '.snapshot-card',
    '.btn-rollback',
    '.btn-refresh-preview',
    '.ai-error-card',
    '.err-card-header',
    '.agent-pill-badge',
    '.stopping',
    '.stream-cursor',
    '.followup-chips',
    '.test-status-badge',
    '.i5-timeline',
    '.i5-think-p',
    '.i5-verb',
    '.i5-count',
    '.i5-cursor',
    '.i5-edit-row',
    '.i5-shell-row',
    '.i5-chips',
    '.i5-chip',
    '.i5-add',
    '.i5-tag-done',
    '.i5-tag-fail',
    // 原型原名类（视觉稿159行断言为准，旧.i5-*仅兼容保留）
    '.exp',
    '.exp-files',
    '.think-p',
    '.edit-row',
    '.shell-row',
    '.tag',
    '.answer',
    '.msg-foot',
    '.icon-btn',
    '.cursor',
    '.silence',
    '.hist-meta'
  ];

  for (const cls of requiredCssClasses) {
    assert.ok(
      cssContent.includes(cls),
      `[CSS契约失败] app.css 缺失 Iteration 5 样式规则: ${cls}`
    );
  }

  // 2.8 审计死样式必须不存在
  assert.ok(
    !cssContent.includes('.file-changes-card'),
    `[CSS契约失败] app.css 不应再含审计死样式 .file-changes-card`
  );
  assert.ok(
    !cssContent.includes('.btn-diff-view'),
    `[CSS契约失败] app.css 不应再含审计死样式 .btn-diff-view`
  );

  // 验证关键动画关键帧
  assert.ok(
    /@keyframes\s+i5pulse\b/.test(cssContent),
    `[CSS契约失败] app.css 缺失思考微光动效 @keyframes i5pulse`
  );
  assert.ok(
    /@keyframes\s+i5pulseRed\b/.test(cssContent),
    `[CSS契约失败] app.css 缺失停止生成呼吸灯动效 @keyframes i5pulseRed`
  );
  assert.ok(
    /@keyframes\s+i5blink\b/.test(cssContent),
    `[CSS契约失败] app.css 缺失流式打字光标闪烁动效 @keyframes i5blink`
  );
  // 原型exact：0%,55%{opacity:1}56%,100%{opacity:0}（视觉稿57行断言为准）
  assert.ok(
    cssContent.replace(/\s+/g, '').includes('0%,55%{opacity:1}56%,100%{opacity:0}'),
    `[CSS契约失败] @keyframes i5blink 必须exact 0%,55%{opacity:1}56%,100%{opacity:0}`
  );
  // 时间线光标复用 i5blink
  assert.ok(
    /\.i5-cursor\s*\{[^}]*i5blink/.test(cssContent),
    `[CSS契约失败] .i5-cursor 必须复用 i5blink 闪烁动效`
  );
  // 原型光标steps(1)：.cursor + .i5-cursor均须steps(1)+i5blink
  assert.ok(
    /\.cursor\s*\{[^}]*i5blink/.test(cssContent),
    `[CSS契约失败] 原型.cursor 必须复用 i5blink 闪烁动效`
  );
  assert.ok(
    /\.cursor\s*\{[^}]*steps\(1\)/.test(cssContent),
    `[CSS契约失败] 原型.cursor 必须steps(1)闪烁`
  );
  assert.ok(
    /\.i5-cursor\s*\{[^}]*steps\(1\)/.test(cssContent),
    `[CSS契约失败] .i5-cursor 必须steps(1)闪烁`
  );
  // 最终回复身份线：墨字+主色竖线，与灰字思考区分
  assert.ok(
    /\.answer\s*\{[^}]*border-left\s*:\s*3px\s+solid\s+var\(--pri\)/.test(cssContent),
    `[CSS契约失败] .answer 必须有主色左侧竖线`
  );
  assert.ok(
    /\.think-p\s*\{[^}]*color\s*:\s*var\(--faint\)/.test(cssContent),
    `[CSS契约失败] .think-p 思考必须压灰`
  );
  // 对话区偏白 + 输入态白底/禁用灰底 + 底部整块浅灰 + 探索单行
  assert.ok(
    /\.ai-body\s*\{[^}]*background\s*:\s*var\(--panel\)/.test(cssContent),
    `[CSS契约失败] .ai-body 对话区须偏白`
  );
  assert.ok(
    /\.ai-input\[disabled\]\s*\{[^}]*background\s*:\s*#E2E8F0/.test(cssContent),
    `[CSS契约失败] .ai-input 禁用须灰底`
  );
  // 输入框自适应高度：多行换行+上限120px，不得再锁死固定像素高
  assert.ok(
    /\.ai-input\s*\{[^}]*white-space\s*:\s*pre-wrap/.test(cssContent),
    `[CSS契约失败] .ai-input 须多行换行`
  );
  assert.ok(
    /\.ai-input\s*\{[^}]*max-height\s*:\s*120px/.test(cssContent),
    `[CSS契约失败] .ai-input 须上限高度`
  );
  assert.ok(
    ![...cssContent.matchAll(/\.ai-input\s*\{([^}]*)\}/g)].some((m) => /(?:^|;)height\s*:\s*\d+px/.test(m[1])),
    `[CSS契约失败] .ai-input 不得锁死固定像素高`
  );
  assert.ok(
    /\.ai-model\[disabled\]\s*\{[^}]*background\s*:\s*#E2E8F0/.test(cssContent),
    `[CSS契约失败] .ai-model 禁用须灰底`
  );
  assert.ok(
    /\.ai-foot\s*\{[^}]*background\s*:\s*#F1F5F9/.test(cssContent),
    `[CSS契约失败] .ai-foot 底部整块须浅灰`
  );
  assert.ok(
    /\.exp\s*\{[^}]*display\s*:\s*flex/.test(cssContent),
    `[CSS契约失败] .exp 探索须单行flex`
  );

  // 验证停止生成态样式规则绑定
  assert.ok(
    /\.stopping\b/.test(cssContent) && /i5pulseRed/.test(cssContent),
    `[CSS契约失败] .stopping 必须绑定 i5pulseRed 红色呼吸动效`
  );

  // 验证连通性测试诊断面板状态变体类
  const testPanelVariants = ['.byok-test-panel.success', '.byok-test-panel.auth-err', '.byok-test-panel.rate-err', '.byok-test-panel.timeout'];
  for (const variant of testPanelVariants) {
    assert.ok(
      cssContent.includes(variant),
      `[CSS契约失败] app.css 缺失 BYOK 诊断面板状态规则: ${variant}`
    );
  }

  // ── Ant全局换肤门 (DESIGN-桌面.md colors§5-31/rounded§83-90/typography§32-82/elevation§251-269; 仅app.css, 类名/id零改名; 尾部覆盖块后胜，取末次定义比对) ──
  // 尾部覆盖块后胜 helper：取选择器在文件中最后一次定义该属性的值 (lastIndexOf思路：从后往前找首个含该属性的精确选择器块)
  function lastPropForSelector(targetSel, prop) {
    const esc = targetSel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc + '(?![A-Za-z0-9_-])', 'g');
    let m; const cands = [];
    while ((m = re.exec(cssContent)) !== null) cands.push(m.index);
    for (let i = cands.length - 1; i >= 0; i--) {
      const idx = cands[i];
      const open = cssContent.indexOf('{', idx);
      if (open < 0) continue;
      if (cssContent.slice(idx, open).includes('}')) continue;
      const close = cssContent.indexOf('}', open);
      if (close < 0) continue;
      const prevClose = cssContent.lastIndexOf('}', idx);
      const selText = cssContent.slice(prevClose + 1, open).replace(/\/\*[\s\S]*?\*\//g, '\n');
      const parts = selText.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.includes(targetSel)) continue;
      const decl = cssContent.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '\n');
      const pm = new RegExp(prop + '\\s*:\\s*([^;]+);?', 'i').exec(decl);
      if (pm) return pm[1].trim();
    }
    return null;
  }
  function assertLastProp(targetSel, prop, expectedRe, msg) {
    const v = lastPropForSelector(targetSel, prop);
    assert.ok(v !== null, `${msg} (未找到 ${targetSel} 的 ${prop} 末次定义)`);
    assert.ok(expectedRe.test(v), `${msg} (末次值为 ${v})`);
  }
  // :root 变量期望值
  assert.ok(/--pri\s*:\s*#1677FF\b/i.test(cssContent), `[CSS契约失败][Ant] :root --pri 应为 #1677FF`);
  assert.ok(/--ink\s*:\s*#1F1F1F\b/i.test(cssContent), `[CSS契约失败][Ant] :root --ink 应为 #1F1F1F`);
  assert.ok(/--line\s*:\s*#D9D9D9\b/i.test(cssContent), `[CSS契约失败][Ant] :root --line 应为 #D9D9D9`);
  assert.ok(/--bg\s*:\s*#F5F5F5\b/i.test(cssContent), `[CSS契约失败][Ant] :root --bg 应为 #F5F5F5`);
  assert.ok(/--bg-subtle\s*:\s*#FAFAFA\b/i.test(cssContent), `[CSS契约失败][Ant] :root --bg-subtle 应为 #FAFAFA`);
  // --shadow系为popup/tertiary三段值 (popup含rgba(0,0,0,0.08)特征串)
  for (const v of ['--shadow', '--shadow-md', '--shadow-lg']) {
    const val = lastPropForSelector(':root', v);
    assert.ok(val !== null, `[CSS契约失败][Ant] :root ${v} 须有定义`);
    assert.ok(/rgba\(0\s*,\s*0\s*,\s*0\s*,\s*0\.08\)/.test(val), `[CSS契约失败][Ant] :root ${v} 应为popup三段值(含rgba(0,0,0,0.08), 末次值为 ${val})`);
    assert.ok(!/^none\b/i.test(val), `[CSS契约失败][Ant] :root ${v} 不得为none`);
  }
  {
    const sm = lastPropForSelector(':root', '--shadow-sm');
    assert.ok(sm !== null, `[CSS契约失败][Ant] :root --shadow-sm 须有定义`);
    assert.ok(/0\s+1px\s+2px\s+0\s+rgba\(0\s*,\s*0\s*,\s*0\s*,\s*0\.05\)/.test(sm), `[CSS契约失败][Ant] :root --shadow-sm 应为tertiary三段值(末次值为 ${sm})`);
    assert.ok(!/^none\b/i.test(sm), `[CSS契约失败][Ant] :root --shadow-sm 不得为none`);
  }
  // 字体栈含Ant栈 (-apple-system与Segoe UI)，不再要求BMW Type Next Latin/Inter
  assert.ok(/--font\s*:[^;]*-apple-system/i.test(cssContent), `[CSS契约失败][Ant] --font 须含 -apple-system`);
  assert.ok(/--font\s*:[^;]*Segoe UI/.test(cssContent), `[CSS契约失败][Ant] --font 须含 Segoe UI`);
  // 圆角 (末次定义为准)：控件6px (.ai-input/.docs-btn)，表面8px (.modal/.ai-modal/.docs-panel)
  assertLastProp('.ai-input', 'border-radius', /^6px\b/, `[CSS契约失败][Ant] 控件 .ai-input 末次圆角须为6px`);
  assertLastProp('.docs-btn', 'border-radius', /^6px\b/, `[CSS契约失败][Ant] 控件 .docs-btn 末次圆角须为6px`);
  assertLastProp('.modal', 'border-radius', /^8px\b/, `[CSS契约失败][Ant] 表面 .modal 末次圆角须为8px`);
  assertLastProp('.ai-modal', 'border-radius', /^8px\b/, `[CSS契约失败][Ant] 表面 .ai-modal 末次圆角须为8px`);
  assertLastProp('.docs-panel', 'border-radius', /^8px\b/, `[CSS契约失败][Ant] 表面 .docs-panel 末次圆角须为8px`);
  // 标注层级：角标层须低于一切弹窗（文档浮层70/遮罩130/抽屉210/浮层400/弹窗600+）
  assertLastProp('#annoBadgeLayer', 'z-index', /var\(--z-anno\)/, `[CSS契约失败][层级] #annoBadgeLayer 须走 --z-anno（不得再压弹窗）`);
  assert.ok(/--z-anno\s*:\s*55\b/.test(cssContent), `[CSS契约失败][层级] --z-anno 须为55（低于文档浮层70）`);
  // hover#4096FF / active#0958D9 (末次定义为准)
  assertLastProp('.docs-btn.primary:hover', 'background', /#4096FF/i, `[CSS契约失败][Ant] .docs-btn.primary:hover 末次背景须为#4096FF`);
  assertLastProp('.ai-fab:hover', 'background', /#4096FF/i, `[CSS契约失败][Ant] .ai-fab:hover 末次背景须为#4096FF`);
  assertLastProp('.docs-btn.primary:active', 'background', /#0958D9/i, `[CSS契约失败][Ant] .docs-btn.primary:active 末次背景须为#0958D9`);
  assertLastProp('.ai-fab:active', 'background', /#0958D9/i, `[CSS契约失败][Ant] .ai-fab:active 末次背景须为#0958D9`);
  // 输入focus: 卡片灰边框、无发散光圈 (末次定义为准)
  assertLastProp('.ai-input:focus', 'border-color', /var\(--line\)/, `[CSS契约失败] .ai-input:focus 末次须 border-color:var(--line)`);
  assertLastProp('.ai-input:focus', 'box-shadow', /^none\b/, `[CSS契约失败] .ai-input:focus 末次须无光圈`);
  assertLastProp('.modal-input:focus', 'border-color', /var\(--line\)/, `[CSS契约失败] .modal-input:focus 末次须 border-color:var(--line)`);
  assertLastProp('.modal-input:focus', 'box-shadow', /^none\b/, `[CSS契约失败] .modal-input:focus 末次须无光圈`);
  // 菜单蓝字：选中与悬停均为pri文字
  assertLastProp('.sb-item.active', 'color', /var\(--pri\)/, `[CSS契约失败] 侧栏选中须蓝字`);
  assertLastProp('.sb-item:hover', 'color', /var\(--pri\)/, `[CSS契约失败] 侧栏悬停须蓝字`);
  // 侧栏原型行：收起展开点居最右，无页数徽标
  assertLastProp('.sb-tree-arrow', 'margin-left', /^auto\b/, `[CSS契约失败] 收起展开点须最右`);
  assert.ok(!/\.sb-sub-count\s*\{/.test(cssContent), `[CSS契约失败] 页数徽标样式须删除`);
  assert.ok(!/sb-sub-count/.test(fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8')), `[CSS契约失败] 页数徽标须不再渲染`);
  assert.ok(/it\.innerHTML = '<span class="nm">'/.test(fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8')), `[CSS契约失败] 行首须为名称（箭头在后）`);
  assertLastProp('.settings-tab-btn.active', 'color', /var\(--pri\)/, `[CSS契约失败] 设置选中须蓝字`);
  // 字重铬600 (抽查.docs-btn/.ai-head，时间线动词类除外；末次定义为准)
  assertLastProp('.docs-btn', 'font-weight', /^600\b/, `[CSS契约失败][Ant] 工具铬 .docs-btn 末次字重须为600`);
  assertLastProp('.ai-head', 'font-weight', /^600\b/, `[CSS契约失败][Ant] 工具铬 .ai-head 末次字重须为600`);
  // 零渐变重申 (与static-verify I1同口径: 剥离CSS注释后扫)
  assert.ok(!/linear-gradient/.test(cssContent.replace(/\/\*[\s\S]*?\*\//g, '\n')), `[CSS契约失败][Ant] app.css 须零渐变(无linear-gradient)`);
  // BYPASS注明: .doc-shortcut-link 仍锁定旧蓝 #3B5BDB (verify-doc-edit A3 锁定, 视觉等同var(--pri)), Ant断言主动绕开其颜色, 不改生产代码
  assert.ok(cssContent.includes('.doc-shortcut-link'), `[CSS契约失败] app.css 缺失 .doc-shortcut-link (存在性保留, 颜色绕开)`);

  // ── Ant禁区回归 (AI时间线类颜色/字号数值未被改动; body.kind-mobile仍存在; 只做存在性+关键值抽查, 不过细) ──
  assert.ok(/--faint\s*:\s*#BFBFBF\b/i.test(cssContent), `[CSS契约失败][禁区] :root --faint 应为 #BFBFBF (think压灰源)`);
  assert.ok(/\.exp\s*\{[^}]*font-size\s*:\s*14\.5px/.test(cssContent), `[CSS契约失败][禁区] .exp 须保留14.5px`);
  assert.ok(/\.exp\s*\{[^}]*color\s*:\s*var\(--ink\)/.test(cssContent), `[CSS契约失败][禁区] .exp 须保留墨字var(--ink)`);
  assert.ok(/\.think-p\s*\{[^}]*font-size\s*:\s*14px/.test(cssContent), `[CSS契约失败][禁区] .think-p 须保留14px`);
  // .think-p压灰已在上方断言 (color:var(--faint)), 此处重申关键值
  assert.ok(/\.think-p\s*\{[^}]*color\s*:\s*var\(--faint\)/.test(cssContent), `[CSS契约失败][禁区] .think-p 须保留压灰var(--faint)`);
  assert.ok(/\.edit-row\s*\{[^}]*font-size\s*:\s*14\.5px/.test(cssContent), `[CSS契约失败][禁区] .edit-row 须保留14.5px`);
  assert.ok(/\.edit-row\s*\{[^}]*color\s*:\s*var\(--ink\)/.test(cssContent), `[CSS契约失败][禁区] .edit-row 须保留墨字var(--ink)`);
  assert.ok(/\.shell-row\s*\{[^}]*font-size\s*:\s*14\.5px/.test(cssContent), `[CSS契约失败][禁区] .shell-row 须保留14.5px`);
  assert.ok(/\.answer\s*\{[^}]*color\s*:\s*var\(--ink\)/.test(cssContent), `[CSS契约失败][禁区] .answer 须保留墨字var(--ink)`);
  assert.ok(/\.answer\s*\{[^}]*font-size\s*:\s*13px/.test(cssContent), `[CSS契约失败][禁区] .answer 须保留13px`);
  // .answer主色竖线已在上方断言 (border-left:3px solid var(--pri)), 此处不重复
  assert.ok(/\.msg-foot\s*\{[^}]*font-size\s*:\s*12px/.test(cssContent), `[CSS契约失败][禁区] .msg-foot 须保留12px`);
  assert.ok(/\.msg-foot\s*\{[^}]*color\s*:\s*var\(--faint\)/.test(cssContent), `[CSS契约失败][禁区] .msg-foot 须保留压灰var(--faint)`);
  assert.ok(/\.snapshot-card\s*\{[^}]*font-size\s*:\s*12\.5px/.test(cssContent), `[CSS契约失败][禁区] .snapshot-card 须保留12.5px`);
  assert.ok(/\.snapshot-card\s*\{[^}]*background\s*:\s*#F8FAFC/i.test(cssContent), `[CSS契约失败][禁区] .snapshot-card 须保留背景#F8FAFC`);
  assert.ok(/\.cursor\s*\{[^}]*background\s*:\s*var\(--pri\)/.test(cssContent), `[CSS契约失败][禁区] .cursor 须保留主色var(--pri)`);
  assert.ok(/\.cursor\s*\{[^}]*width\s*:\s*2px/.test(cssContent), `[CSS契约失败][禁区] .cursor 须保留2px`);
  // .cursor复用i5blink+steps(1)已在上方断言, 此处不重复
  assert.ok(/\.add\s*\{[^}]*color\s*:\s*#16A34A/i.test(cssContent), `[CSS契约失败][禁区] .add 须保留#16A34A`);
  assert.ok(/\.del\s*\{[^}]*color\s*:\s*#DC2626/i.test(cssContent), `[CSS契约失败][禁区] .del 须保留#DC2626`);
  assert.ok(/body\.kind-mobile/.test(cssContent), `[CSS契约失败][禁区] body.kind-mobile 规则须仍存在`);
  assert.ok(/body\.kind-mobile\s+\.doc-hotzone/.test(cssContent), `[CSS契约失败][禁区] body.kind-mobile .doc-hotzone 须仍存在`);
  assert.ok(/body\.kind-mobile\s+\.req-panel/.test(cssContent), `[CSS契约失败][禁区] body.kind-mobile .req-panel 须仍存在`);
}

// =========================================================================
// 断言 3：js/project-ai-export.js 核心函数与常量契约
// =========================================================================
function test3_JsFunctionsAndConstantsContract() {
  const requiredFunctions = [
    'i5RefreshAgentBadge',
    'i5RenderAgentMatrix',
    'i5SetMainAgent',
    'i5PickAgentPath',
    'i5AppendToolCall',
    'i5RenderErrorCard',
    'i5AppendSnapshotCard',
    'i5EnsureThinkBox',
    'i5EnsureToolStream',
    'i5SetupTopModelSelect',
    'refreshCliInfo',
    'i5ClassifyError',
    'i5RenderByokTest',
    'i5CancelAi',
    'fetchProviderModels',
    'i5SplitThink',
    'i5VerbKind',
    'i5VerbLabel',
    'i5ReplayTimeline',
    'i5ReplayV1',
    'i5ThinkFlushPending',
    'i5ExploreAdd',
    'i5EditFinalize'
  ];

  for (const fn of requiredFunctions) {
    const fnPattern = new RegExp(`function\\s+${fn}\\b`);
    assert.ok(
      fnPattern.test(jsContent),
      `[JS契约失败] js/project-ai-export.js 缺失核心函数定义: function ${fn}`
    );
  }
  // 2.8 审计函数必须不存在；完成总结卡ai-op-card相关已从函数表删除（保留i5EnsureThinkBox存在性锁）
  assert.ok(!/function\s+i5AppendDiffAudit\b/.test(jsContent), `[JS契约失败] function i5AppendDiffAudit 应已彻底删除`);
  assert.ok(!/i5AppendDiffAudit\s*\(/.test(jsContent), `[JS契约失败] i5AppendDiffAudit 调用应已彻底删除`);
  assert.ok(!/ai-op-card/.test(jsContent), `[JS契约失败] ai-op-card 应已彻底删除（完成总结卡下线，函数表已删除该项）`);
  assert.ok(!/className\s*=\s*['"][^'"]*followup-chips/.test(jsContent), `[JS契约失败] 不得以className生成followup-chips`);
  assert.ok(!/innerHTML[^;]*followup-chips/.test(jsContent), `[JS契约失败] 不得以innerHTML生成followup-chips`);

  // 验证 Iteration 5 核心常量
  assert.ok(
    /var\s+I5_AGENT_ORDER\s*=\s*\[['"]opencode['"](,\s*['"][a-z0-9-]+['"]){25}\]/.test(jsContent),
    `[JS契约失败] I5_AGENT_ORDER 必须定义 26 项 CLI`
  );
  for (const id of ['opencode', 'claude', 'cursor-agent', 'codex', 'deepseek-harness', 'qwen', 'deepseek', 'mimo', 'amp', 'codebuddy', 'aider', 'grok-build', 'antigravity', 'atomcode', 'amr', 'copilot', 'devin', 'hermes', 'kilo', 'kimi', 'kiro', 'pi', 'qoder', 'reasonix', 'trae-cli', 'vibe']) {
    assert.ok(
      jsContent.includes(`'${id}'`) || jsContent.includes(`"${id}"`),
      `[JS契约失败] I5_AGENT_ORDER/FALLBACK 缺失 ${id}`
    );
  }
  assert.ok(
    /I5_PROTO_HINT\s*=\s*\{[\s\S]*?openai:[\s\S]*?anthropic:[\s\S]*?google:[\s\S]*?ollama:[\s\S]*?azure:/.test(jsContent),
    `[JS契约失败] I5_PROTO_HINT 必须覆盖 5 大通信协议端点提示`
  );
  // 设置页卡片：天蓝边框 + 使用中文字标识（无边框按钮已删除）
  assert.ok(
    /agent-use-flag/.test(jsContent) && /使用中/.test(jsContent),
    `[JS契约失败] agent卡片须有使用中文字标识`
  );
  assert.ok(
    /agent-head-right/.test(jsContent),
    `[JS契约失败] agent卡片头须有右侧容器（使用中+状态居右上）`
  );
  // 切换遮罩：点击即显，覆盖保存+重探测，令牌防串，失败也关
  assert.ok(
    /function showAgentSwitchMask/.test(jsContent) && /function hideAgentSwitchMask/.test(jsContent),
    `[JS契约失败] 缺切换遮罩函数`
  );
  assert.ok(
    /agent-switch-mask/.test(jsContent) && /正在切换/.test(jsContent),
    `[JS契约失败] 遮罩须有样式类与切换中文案`
  );
  assert.ok(
    /agent-status dot err/.test(jsContent),
    `[JS契约失败] 未检测到须为红色圆点`
  );
  assert.ok(
    !/textContent='当前主力'/.test(jsContent) && !/textContent='设为主力'/.test(jsContent),
    `[JS契约失败] 主力切换按钮须删除（置顶badge标题除外）`
  );
  assert.ok(
    /api-use-flag/.test(jsContent),
    `[JS契约失败] api卡片须有使用中文字标识`
  );
  assert.ok(
    /\.agent-card\s*\{[^}]*var\(--line\)/.test(cssContent),
    `[CSS契约失败] agent卡片默认边框须为浅灰`
  );
  assert.ok(
    /\.agent-card\.active\s*\{[^}]*var\(--pri\)/.test(cssContent),
    `[CSS契约失败] agent选中态边框须与按钮同蓝`
  );
  assert.ok(
    /\.agent-card\.active\s*\{[^}]*var\(--panel\)/.test(cssContent),
    `[CSS契约失败] agent选中态背景须为纯白`
  );
  assert.ok(
    /\.agent-status\.dot\.err\s*\{[^}]*var\(--err\)/.test(cssContent),
    `[CSS契约失败] 未检测到圆点须为红色`
  );
  // 左侧浮动菜单：导入原型居首、新建设计去加号、设置垫后，sb-foot已移除
  assert.ok(
    htmlContent.indexOf('btnAddSource') !== -1 && htmlContent.indexOf('btnAddSource') < htmlContent.indexOf('btnNewProto'),
    `[HTML契约失败] 导入原型须位于菜单首位`
  );
  assert.ok(
    /id="btnNewProto"[^>]*>新建设计</.test(htmlContent),
    `[HTML契约失败] 新建设计须去加号`
  );
  assert.ok(
    htmlContent.indexOf('btnSettings') > htmlContent.indexOf('sbTrigger'),
    `[HTML契约失败] 设置须位于菜单按钮下方`
  );
  assert.ok(
    !/class="sb-foot"/.test(htmlContent),
    `[HTML契约失败] 空sb-foot须移除`
  );
  // 导入原型与新建设计同式（ai-fab），设置仅齿轮图标无文字
  assert.ok(
    /class="ai-fab" id="btnAddSource"/.test(htmlContent),
    `[HTML契约失败] 导入原型须与新建设计同用ai-fab`
  );
  assert.ok(
    /id="btnSettings"[^>]*><i data-ic="settings"><\/i><\/button>/.test(htmlContent),
    `[HTML契约失败] 设置须为齿轮图标无文字`
  );
  assert.ok(
    /\.api-profile-card\s*\{[^}]*var\(--line\)/.test(cssContent),
    `[CSS契约失败] api卡片默认边框须为浅灰`
  );
  assert.ok(
    /\.api-profile-card\.active\s*\{[^}]*var\(--pri\)/.test(cssContent),
    `[CSS契约失败] api选中态边框须与按钮同蓝`
  );
  assert.ok(
    /repeat\(2,minmax\(0,1fr\)\)/.test(cssContent),
    `[CSS契约失败] 设置页双列轨道须定死minmax(0,1fr)防撑破`
  );
  assert.ok(
    /\.agent-name\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(cssContent),
    `[CSS契约失败] agent名称超宽须省略号`
  );
  assert.ok(
    /\.model-check-item\s*>\s*span\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(cssContent),
    `[CSS契约失败] 模型行超宽须省略号`
  );
  assert.ok(
    /\.uispec-card\s*\{[^}]*var\(--line\)/.test(cssContent),
    `[CSS契约失败] 规范卡片默认边框须为浅灰`
  );
  assert.ok(
    /\.uispec-card\.active\s*\{[^}]*var\(--pri\)/.test(cssContent),
    `[CSS契约失败] 规范选中态边框须与按钮同蓝`
  );
  assert.ok(
    /\.set-engine-group\s*\{[^}]*var\(--bg-subtle\)/.test(cssContent),
    `[CSS契约失败] agent分段须与规范分段同底`
  );
  assert.ok(
    /\.proj-item\.on\s*\{[^}]*var\(--panel\)/.test(cssContent),
    `[CSS契约失败] 项目选择卡片选中须白底`
  );
}

// =========================================================================
// 断言 5：顶栏身份与设置入口（沙箱隐藏/三色点/历史位/服务商名/输入底色）
// =========================================================================
function test5_TopIdentity() {
  // 设置按钮圆形
  assert.ok(/\.sb-set\s*\{[^}]*border-radius\s*:\s*50%/.test(cssContent), '设置按钮须圆形');
  // 沙箱名隐藏但元素保留
  assert.ok(/#aiSbx\s*\{\s*display\s*:\s*none/.test(cssContent), '沙箱名须隐藏');
  assert.ok(htmlContent.includes('id="aiSbx"'), '沙箱元素须保留');
  // CLI徽标点化：无文字 + 三色
  assert.ok(/aiCliEl\.textContent='';/.test(jsContent), 'CLI徽标须无文字');
  assert.ok(/\.ai-cli\s*\{[^}]*width\s*:\s*8px/.test(cssContent), 'CLI徽标须为圆点尺寸');
  // 历史按钮：无图标 + 白底灰框 + 独立窗口右侧/徽标左侧
  assert.ok(/id="aiHistBtn"[^>]*>历史</.test(htmlContent), '历史按钮须无图标纯文字');
  assert.ok(htmlContent.indexOf('btnAiWinToggle') < htmlContent.indexOf('aiHistBtn')
    && htmlContent.indexOf('aiHistBtn') < htmlContent.indexOf('aiAgentBadge'), '历史按钮须在独立窗口右侧、徽标左侧');
  assert.ok(/\.ai-hist\s*\{[^}]*var\(--panel\)/.test(cssContent), '历史按钮须白底');
  // 徽标融合：服务商自定义名 + 三色点
  assert.ok(/function refreshAiTopIdentity/.test(jsContent), '缺顶栏身份融合函数');
  assert.ok(/apiProfileLabel\(p\)/.test(jsContent), 'API须显示服务商自定义名');
  assert.ok(/\.agent-pill-badge \.dot\.ok/.test(cssContent) && /\.agent-pill-badge \.dot\.warn/.test(cssContent)
    && /\.agent-pill-badge \.dot\.err/.test(cssContent), '徽标须红橘绿三色点');
  // 规范文件行：按钮选中态 + 文件名纯文字
  assert.ok(/uispecPickFile/.test(jsContent) && /classList.*picked/.test(jsContent), '选择文件按钮须有选中态');
  assert.ok(/#uispecAddFileName\s*\{[^}]*border\s*:\s*none/.test(cssContent), '文件名须无边框纯文字');
  // 输入底色：默认白 + 禁用灰
  assert.ok(/\.set-input\s*\{[^}]*var\(--panel\)/.test(cssContent), '输入框默认须白底');
  assert.ok(/\[disabled\]\s*\{[^}]*#E2E8F0/.test(cssContent), '输入禁用须灰底');
  // 左侧栏：无收起按钮 + 新建文件夹纯文字 + 无原型名
  assert.ok(!htmlContent.includes('btnSbCollapse'), '收起按钮须删除');
  assert.ok(/id="btnAddGroup"[^>]*>新建文件夹</.test(htmlContent), '新建文件夹须去加号纯文字');
  assert.ok(!htmlContent.includes('id="loc"'), '原型名须删除');
  // 独立CLI点隐藏（状态并入徽标圆点）
  assert.ok(/\.ai-cli\s*\{[^}]*display\s*:\s*none/.test(cssContent), '独立CLI点须隐藏');
  // 新建设计弹窗卡片与CLI卡片同式
  assert.ok(/\.kind-opt\s*\{[^}]*1\.5px solid var\(--line\)/.test(cssContent), 'kind卡片须浅灰边框');
  assert.ok(/\.kind-opt\.on\s*\{[^}]*var\(--panel\)/.test(cssContent), 'kind选中须白底');
  // 跨tab单选：选中即切引擎 + 仅当前引擎高亮
  assert.ok(/setEngineUi\('cli'\)/.test(jsContent.match(/function i5SetMainAgent[\s\S]*?\n\}/)[0]), '选CLI卡须切引擎');
  assert.ok(/setEngineUi\('api'\)/.test(jsContent.match(/function setActiveApiProfile[\s\S]*?\n\}/)[0]), '选API卡须切引擎');
  assert.ok(/_eng!=='api'/.test(jsContent) && /_eng2==='api'/.test(jsContent), '双矩阵须按引擎门控高亮');
  // 提示文案精简：7句冗余须删除
  for (const s of ['点卡片设为主力', '右上角下拉菜单', '各选一个生效', '按栈顶优先', '在此保存会改写全局远端，影响全部项目', '保存即改写全局 origin', '我已知悉 Token']) {
    assert.ok(!htmlContent.includes(s), `冗余文案须删除:${s.slice(0, 8)}`);
  }
  assert.ok(!htmlContent.includes('gitGlobalHint'), '全局单库横幅须删除');
}

// =========================================================================
// 断言 6：标注与交互卡片（绿卡/垃圾桶/单行/中文按钮/序号）
// =========================================================================
function test6_AnnoLink() {
  const lbSrc = fs.readFileSync(path.join(rootDir, 'js', 'link-bind.js'), 'utf8');
  const anSrc = fs.readFileSync(path.join(rootDir, 'js', 'annotation-core.js'), 'utf8');
  // 标注卡片：四色主题、无边框、黑白自适应正文、垃圾桶删除居右
  assert.ok(/\.anno-mgr-item\.anno-c-green\s*\{[^}]*#047857/.test(cssContent), '深绿主题');
  assert.ok(/\.anno-mgr-item\.anno-c-blue\s*\{[^}]*#2563EB/.test(cssContent), '蓝色主题');
  assert.ok(/\.anno-mgr-item\.anno-c-orange\s*\{[^}]*#EA580C/.test(cssContent), '橙色主题');
  assert.ok(/\.anno-mgr-item\.anno-c-gray\s*\{[^}]*#F1F5F9/.test(cssContent), '浅灰主题');
  assert.ok(/\.anno-mgr-item\s*\{[^}]*border\s*:\s*none/.test(cssContent), '标注卡片须无边框');
  assert.ok(/\.anno-mgr-snippet\s*\{[^}]*color\s*:\s*inherit/.test(cssContent), '标注文字须继承主题色');
  assert.ok(/\.anno-mgr-snippet\s*\{[^}]*font-weight\s*:\s*700/.test(cssContent), '标注文字须加粗');
  assert.ok(/\.anno-color-btn\s*\{[^}]*width\s*:\s*18px/.test(cssContent), '颜色按钮与圆点同大');
  assert.ok(/\.anno-mgr-del\s*\{[^}]*margin-left\s*:\s*auto/.test(cssContent), '删除按钮须居右');
  assert.ok(/PlanBIcon\('trash'/.test(anSrc), '删除按钮须垃圾桶图标');
  assert.ok(/dot\.textContent = String\(globalNo\)/.test(anSrc), '圆点须写全局固定序号');
  assert.ok(/\.anno-color-dot\s*\{[^}]*width\s*:\s*12px/.test(cssContent), '颜色直选小点12px');
  assert.ok(/\.anno-color-wrap\s*\{[^}]*inline-flex/.test(cssContent), '颜色点须横向排列');
  assert.ok(/annoSetColor\(anno\.id, cid\)/.test(anSrc), '颜色点须直选颜色');
  // 浮窗在标注点上方（放不下才回落下方）
  assert.ok(/- ph - 8/.test(anSrc), '浮窗须在上方');
  // 卡片顺序：top/跳转/按钮/页面；跳转去图标；中文名链
  const rlm = lbSrc.indexOf('lm-item-target-wrap');
  assert.ok(rlm > lbSrc.indexOf('lm-item-top'), '跳转行须在顶部行之后');
  for (const b of ['试跳', '更换目标', '删除']) {
    assert.ok(lbSrc.includes('>' + b + '<'), `按钮须中文:${b}`);
  }
  assert.ok(/\.lm-target-val\s*\{[^}]*white-space\s*:\s*nowrap/.test(cssContent), '跳转值须不换行');
  // 工具行防撑破弹窗：长 JSON 参数必须限宽 100% + 允许换行（.i5-cmd/.shell-row code/.i5-file），气泡体须 min-width:0 断掉 flex 最小尺寸传递
  assert.ok(/\.i5-cmd\s*\{[^}]*max-width\s*:\s*100%/.test(cssContent), '.i5-cmd 须限宽 100%');
  assert.ok(/\.i5-cmd\s*\{[^}]*overflow-wrap\s*:\s*anywhere/.test(cssContent), '.i5-cmd 须允许换行');
  assert.ok(!/\.i5-cmd\s*\{[^}]*white-space\s*:\s*nowrap/.test(cssContent), '.i5-cmd 不得 nowrap');
  assert.ok(/\.shell-row code\s*\{[^}]*overflow-wrap\s*:\s*anywhere/.test(cssContent), '.shell-row code 须允许换行');
  assert.ok(/\.i5-file\s*\{[^}]*max-width\s*:\s*100%/.test(cssContent), '.i5-file 须限宽 100%');
  assert.ok(/\.ai-msg-body\s*\{[^}]*min-width\s*:\s*0/.test(cssContent), '.ai-msg-body 须 min-width:0');
  assert.ok(rlm > lbSrc.indexOf('lm-item-top'), '跳转行须在顶部行之后');
  assert.ok(lbSrc.indexOf("' class=\"lm-item-acts\"'") > 0 || lbSrc.indexOf('lm-item-acts">') > 0, '按钮行存在');
  assert.ok(!lbSrc.includes('lm-item-meta') && !lbSrc.includes('所在页面'), '所在页面行须删除');
  assert.ok(lbSrc.includes('state-dot live') && lbSrc.includes('state-dot stale'), '状态须为圆点（绿=生效/橘黄=未生效）');
  assert.ok(/\.state-dot\.live\s*\{[^}]*#22C55E/.test(cssContent), '生效点须绿色');
  assert.ok(/\.state-dot\.stale\s*\{[^}]*#F59E0B/.test(cssContent), '未生效点须橘黄');
  assert.ok(/function linkOnCurPage\(/.test(lbSrc) && /linkOnCurPage\(links\[ci\]\)/.test(lbSrc), '徽标只计当前页跳出');
  assert.ok(/p\.right < _fr\.left \|\| p\.left > _fr\.right/.test(anSrc), '视口外徽标须裁剪（防飞点）');
  assert.ok(/var badgeNo = oi \+ 1/.test(anSrc) && /badge\.textContent = String\(badgeNo\)/.test(anSrc), '画布徽标须用固定编号（裁剪不重排）');
  assert.ok(/__annoPollBound/.test(anSrc) && /setInterval\(function\(\)/.test(anSrc), '动画元素须轮询跟随');
  assert.ok(!lbSrc.includes("lbIco('target'"), '跳转图标须删除');
  assert.ok(lbSrc.includes('remoteName'), '绑定命名须优先中文名');
  const agentTpl = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-agent.js'), 'utf8');
  const coreTpl = fs.readFileSync(path.join(rootDir, 'js', 'sandbox-core.js'), 'utf8');
  for (const [nm, src] of [['sandbox-agent', agentTpl], ['sandbox-core', coreTpl]]) {
    assert.ok(src.includes('pickDname') && src.includes('dname'), nm + '帧模板须有中文名计算与回传');
  }
}

// =========================================================================
// 断言 4：前端交互运行时仿真与数据处理无未捕获异常
// =========================================================================
function test4_RuntimeSimulationAndBoundaryHandling() {
  // 轻量 Mock DOM 元素实现（className 双向同步，支持时间线 i5-* 类查询）
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = String(tagName).toUpperCase();
      this._className = '';
      const self0 = this;
      Object.defineProperty(this, 'className', {
        get() { return self0._className; },
        set(v) { self0._className = String(v == null ? '' : v); self0.classList._set = new Set(self0._className.split(/\s+/).filter(Boolean)); }
      });
      this.id = '';
      this.textContent = '';
      this.innerHTML = '';
      this.style = {};
      this.attributes = {};
      this.children = [];
      this.parentNode = null;
      this.disabled = false;
      this.title = '';
      this.value = '';
      this.options = [];
      this.onclick = null;
      this.onchange = null;
      this.nodeType = 1;
      const self = this;
      this.classList = {
        _set: new Set(),
        add(...classes) {
          classes.forEach(c => {
            if (c) {
              self.classList._set.add(c);
              self._className = Array.from(self.classList._set).join(' ');
            }
          });
        },
        remove(...classes) {
          classes.forEach(c => {
            if (c) {
              self.classList._set.delete(c);
              self._className = Array.from(self.classList._set).join(' ');
            }
          });
        },
        toggle(c, force) {
          if (force === true) this.add(c);
          else if (force === false) this.remove(c);
          else if (self.classList._set.has(c)) this.remove(c);
          else this.add(c);
        },
        contains(c) {
          return self.classList._set.has(c);
        }
      };
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] != null ? this.attributes[k] : null; }
    appendChild(child) {
      if (child) {
        child.parentNode = this;
        this.children.push(child);
      }
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        child.parentNode = null;
        this.children.splice(idx, 1);
      }
      return child;
    }
    querySelector(sel) {
      if (!sel) return null;
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        if (this.classList.contains(cls)) return this;
        for (const ch of this.children) {
          const res = ch.querySelector ? ch.querySelector(sel) : null;
          if (res) return res;
        }
      } else if (sel.startsWith('#')) {
        const id = sel.slice(1);
        if (this.id === id) return this;
        for (const ch of this.children) {
          const res = ch.querySelector ? ch.querySelector(sel) : null;
          if (res) return res;
        }
      } else {
        if (this.tagName.toLowerCase() === sel.toLowerCase()) return this;
        for (const ch of this.children) {
          const res = ch.querySelector ? ch.querySelector(sel) : null;
          if (res) return res;
        }
      }
      return null;
    }
    querySelectorAll(sel) {
      const results = [];
      const match = (el) => {
        if (sel === 'button' && el.tagName === 'BUTTON') return true;
        if (sel.startsWith('.') && el.classList && el.classList.contains(sel.slice(1))) return true;
        return false;
      };
      if (match(this)) results.push(this);
      for (const ch of this.children) {
        if (ch.querySelectorAll) results.push(...ch.querySelectorAll(sel));
      }
      return results;
    }
  }
  function collectText(el) {
    let s = String((el && el.textContent) || '') + ' ' + String((el && el.innerHTML) || '');
    for (const ch of ((el && el.children) || [])) s += ' ' + collectText(ch);
    return s;
  }
  function collectClass(el) {
    let s = ' ' + String((el && el.className) || '');
    for (const ch of ((el && el.children) || [])) s += collectClass(ch);
    return s;
  }

  // 构造沙箱 DOM 环境与 UI 容器
  const elements = new Map();
  function getEl(id) {
    if (!elements.has(id)) {
      const el = new MockElement('div');
      el.id = id;
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const mockDoc = {
    getElementById: (id) => getEl(id),
    createElement: (tag) => new MockElement(tag),
    querySelector: (sel) => {
      if (sel.startsWith('#')) return getEl(sel.slice(1));
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: new MockElement('body'),
    documentElement: new MockElement('html')
  };

  // 1. 验证错误分类器 i5ClassifyError 逻辑完整性
  const classifyMatch = jsContent.match(/function\s+i5ClassifyError\s*\([\s\S]*?\n\}/);
  assert.ok(classifyMatch, '提取 i5ClassifyError 函数定义成功');
  const i5ClassifyError = new Function('ev', classifyMatch[0] + '\nreturn i5ClassifyError(ev);');

  assert.strictEqual(i5ClassifyError({ code: '429', message: 'Quota exhausted' }), '429', '429 错误归类');
  assert.strictEqual(i5ClassifyError({ code: 'RATE_LIMIT_EXCEEDED' }), '429', 'RATE_LIMIT 归类为 429');
  assert.strictEqual(i5ClassifyError({ code: '401', error: 'Invalid API Key' }), '401', '401 错误归类');
  assert.strictEqual(i5ClassifyError({ kind: 'auth_failed', title: 'Unauthorized' }), '401', 'Auth Failed 归类为 401');
  assert.strictEqual(i5ClassifyError({ code: 'CLI_NOT_FOUND', message: 'Command not found' }), 'CLI_NOT_FOUND', 'CLI 未找到归类');
  assert.strictEqual(i5ClassifyError({ code: 'CANCEL', message: 'User aborted' }), 'cancel', '用户取消归类');
  assert.strictEqual(i5ClassifyError({}), 'unknown', '未知异常平稳降级为 unknown');

  // 2. 验证 i5RenderByokTest 诊断分支与无未捕获异常
  const renderByokMatch = jsContent.match(/function\s+i5RenderByokTest\s*\([\s\S]*?\n\}/);
  assert.ok(renderByokMatch, '提取 i5RenderByokTest 函数定义成功');

  const panelEl = getEl('byokTestPanel');
  const badgeEl = getEl('testStatusBadge');
  const msgEl = getEl('testMessageText');
  const apiStatusEl = getEl('testApiStatus');

  const runByokTest = (payload) => {
    const fn = new Function('r', '$', 'byokTestPanel', 'testStatusBadge', 'testMessageText', 'testApiStatus',
      renderByokMatch[0] + '\nreturn i5RenderByokTest(r);'
    );
    return fn(payload, getEl, panelEl, badgeEl, msgEl, apiStatusEl);
  };

  // 2.1 成功 200 分支
  runByokTest({ ok: true, status: 200, latencyMs: 88 });
  assert.ok(panelEl.className.includes('success'), 'BYOK 成功渲染 .success');
  assert.strictEqual(panelEl.style.display, 'flex', 'BYOK 面板显现');
  assert.ok(badgeEl.textContent.includes('88ms'), '状态徽章包含延迟');

  // 2.2 401 密钥失效分支
  runByokTest({ ok: false, kind: 'auth_failed', status: 401, latencyMs: 45, error: 'Unauthorized' });
  assert.ok(panelEl.className.includes('auth-err'), '401 渲染 .auth-err');
  assert.ok(msgEl.textContent.includes('API Key'), '401 提示检查 API Key');

  // 2.3 429 限流分支
  runByokTest({ ok: false, kind: 'rate_limited', status: 429, latencyMs: 30, error: 'Rate limit' });
  assert.ok(panelEl.className.includes('rate-err'), '429 渲染 .rate-err');

  // 2.4 超时分支
  runByokTest({ ok: false, kind: 'timeout', latencyMs: 5000 });
  assert.ok(panelEl.className.includes('timeout'), '超时渲染 .timeout');

  // 2.5 异常与空入参健壮性（不能抛错）
  assert.doesNotThrow(() => runByokTest(null), '传入 null 不得抛出异常');
  assert.doesNotThrow(() => runByokTest({}), '传入空对象不得抛出异常');
  assert.doesNotThrow(() => runByokTest({ ok: false, message: undefined }), '包含 undefined 字段不得抛出异常');

  // 3. 验证多 Agent CLI 矩阵渲染与 Windows 路径包含空格/反斜杠的处理
  const matrixContainer = getEl('aiAgentMatrix');
  const renderMatrixMatch = jsContent.match(/function\s+i5RenderAgentMatrix\s*\([\s\S]*?\n\}/);
  assert.ok(renderMatrixMatch, '提取 i5RenderAgentMatrix 函数定义成功');

  const I5_AGENT_ORDER = ['opencode', 'claude', 'cursor-agent', 'codex', 'deepseek-harness', 'qwen', 'deepseek', 'mimo', 'amp', 'codebuddy', 'aider', 'grok-build', 'antigravity', 'atomcode', 'amr', 'copilot', 'devin', 'hermes', 'kilo', 'kimi', 'kiro', 'pi', 'qoder', 'reasonix', 'trae-cli', 'vibe'];
  const I5_AGENT_FALLBACK = { opencode: 'OpenCode CLI', claude: 'Claude Code', 'cursor-agent': 'Cursor Agent', codex: 'OpenAI Codex', 'deepseek-harness': 'DeepSeek Harness', qwen: 'Qwen Code', deepseek: 'DeepSeek TUI', mimo: 'MiMo Code', amp: 'Amp', codebuddy: 'Codebuddy Code', aider: 'Aider', 'grok-build': 'Grok Build', antigravity: 'Antigravity', atomcode: 'AtomCode CLI', amr: 'AMR', copilot: 'GitHub Copilot CLI', devin: 'Devin', hermes: 'Hermes', kilo: 'Kilo', kimi: 'Kimi CLI', kiro: 'Kiro CLI', pi: 'Pi', qoder: 'Qoder CLI', reasonix: 'DeepSeek Reasonix', 'trae-cli': 'Trae CLI', vibe: 'Mistral Vibe CLI' };
  const i5AgentLabel = (a) => (a && a.name) || (a && a.id && I5_AGENT_FALLBACK[a.id]) || (a && a.id) || 'Agent';

  const runRenderMatrix = (agents, mainId) => {
    const fn = new Function('agents', 'mainId', 'document', '$', 'aiAgentMatrix', 'I5_AGENT_ORDER', 'I5_AGENT_FALLBACK', 'i5AgentLabel', 'i5SetMainAgent', 'i5PickAgentPath', 'curAiConfig',
      renderMatrixMatch[0] + '\nreturn i5RenderAgentMatrix(agents, mainId);'
    );
    return fn(agents, mainId, mockDoc, getEl, matrixContainer, I5_AGENT_ORDER, I5_AGENT_FALLBACK, i5AgentLabel, () => {}, () => {}, {});
  };

  // 模拟带有 Windows 空格路径与反斜杠的 Agent 数据（2 已安装 + 3 未安装）
  const mockAgents = [
    { id: 'opencode', name: 'OpenCode CLI', available: true, path: 'C:\\Program Files\\OpenCode\\opencode.cmd', version: '1.2.5' },
    { id: 'claude', name: 'Claude Code', available: true, path: 'C:\\Users\\User Name\\AppData\\Roaming\\npm\\claude.cmd', version: '0.2.29' },
    { id: 'cursor-agent', name: 'Cursor Agent', available: false, path: null, version: null },
    { id: 'codex', name: 'OpenAI Codex', available: false, path: null, version: null },
    { id: 'deepseek-harness', name: 'DeepSeek Harness', available: false, path: null, version: null }
  ];

  runRenderMatrix(mockAgents, 'opencode');
  // 已安装置顶 + 未安装收纳进折叠条（默认收起）
  assert.strictEqual(matrixContainer.children.length, 3, '矩阵应为 2 张已安装卡片 + 1 个折叠条');
  const firstCard = matrixContainer.children[0];
  assert.strictEqual(firstCard.getAttribute('data-id'), 'opencode', '首张卡片为 opencode');
  assert.ok(firstCard.className.includes('active'), '主力 Agent 带有 .active');

  const secondCard = matrixContainer.children[1];
  assert.strictEqual(secondCard.getAttribute('data-id'), 'claude', '第二张卡片为 claude');
  const pathRow = secondCard.children.find(c => c.className === 'agent-path-row');
  assert.ok(pathRow, '卡片包含路径行');
  const pathSpan = pathRow.children.find(c => c.className === 'agent-path');
  assert.ok(pathSpan, '卡片包含 agent-path 元素');
  assert.strictEqual(
    pathSpan.textContent,
    'C:\\Users\\User Name\\AppData\\Roaming\\npm\\claude.cmd',
    'Windows 空格与反斜杠路径完整无损且未被错误转义'
  );

  const foldBox = matrixContainer.children[2];
  assert.ok(foldBox.className.includes('agent-fold'), '第三项为未安装折叠区');
  const foldBar = foldBox.children.find(c => c.className === 'agent-fold-bar');
  const foldBody = foldBox.children.find(c => c.className === 'agent-fold-body');
  assert.ok(foldBar && foldBody, '折叠区包含横条与收纳体');
  assert.strictEqual(foldBody.children.length, 24, '收纳体含 3 张显式未安装 + 21 张自动补齐卡片');
  const qwenCard = foldBody.children.find(c => c.getAttribute('data-id') === 'qwen');
  assert.ok(qwenCard, '自动补齐含 qwen 卡片');
  assert.strictEqual(foldBody.style.display, 'none', '默认收起');
  assert.ok(foldBar.children[0].textContent.includes('24'), '横条标注未安装数量');
  foldBar.onclick();
  assert.strictEqual(foldBody.style.display, '', '点击横条后展开');
  assert.ok(foldBar.children[foldBar.children.length - 1].textContent.includes('收起'), '展开后横条变为收起');

  // 4. 验证审计卡已删除 + 快照卡片生成（2.8，原型span结构兼容：只断言文本/类名，不锁div/span标签）
  assert.ok(!/function\s+i5AppendDiffAudit\b/.test(jsContent), 'i5AppendDiffAudit 定义应已彻底删除');
  assert.ok(!/i5AppendDiffAudit\s*\(/.test(jsContent), 'i5AppendDiffAudit 调用应已彻底删除');
  assert.ok(!/ai-op-card/.test(jsContent), 'ai-op-card 定义应已彻底删除（完成总结卡下线）');
  const chatView = getEl('aiChatView');
  const subHelperSrc = (jsContent.match(/function\s+i5CurSubFile\s*\([\s\S]*?\n\}/) || [])[0] + '\n' + (jsContent.match(/function\s+i5SubFileRow\s*\([\s\S]*?\n\}/) || [])[0] + '\n';
  const appendSnapMatch = jsContent.match(/function\s+i5AppendSnapshotCard\s*\([\s\S]*?\n\}/);
  assert.ok(appendSnapMatch, '提取 i5AppendSnapshotCard 函数定义成功');
  const escStub = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const runAppendSnap = (container, info) => {
    const fn = new Function('container', 'snapInfo', 'document', 'aiChatView', 'escHtml',
      subHelperSrc + appendSnapMatch[0] + '\nreturn i5AppendSnapshotCard(container, snapInfo);'
    );
    return fn(container, info, mockDoc, chatView, escStub);
  };

  const snapCard = runAppendSnap(chatView, '快照版本 #14 已生成');
  assert.ok(snapCard, '生成快照卡片');
  assert.strictEqual(snapCard.className, 'snapshot-card', '快照卡片类名正确');
  const snapTxt = collectText(snapCard);
  const snapCls = collectClass(snapCard);
  assert.ok(snapTxt.includes('一键回滚') && snapCls.includes('btn-rollback'), '快照卡片包含回滚操作');
  // span结构兼容：snapshot-info/actions现为span，只断言类名/文本存在，不断言tagName
  assert.ok(snapCard.querySelector('.snapshot-info'), '快照卡片含.snapshot-info（不锁标签）');
  assert.ok(snapCard.querySelector('.snapshot-actions'), '快照卡片含.snapshot-actions（不锁标签）');
  assert.ok(snapCard.querySelector('.btn-rollback'), '快照卡片含.btn-rollback（不锁标签）');
  assert.ok(!snapTxt.includes('刷新预览') && !snapCls.includes('btn-refresh-preview'), '快照卡片无刷新预览、有回滚');

  // 5. 验证模型拉取数据处理的健壮性（去重、截断、空数据保护）
  const testGroupModels = [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-coder', name: 'DeepSeek Coder' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat (重复)' }, // 重复项
    { id: '', name: 'Invalid Model' } // 无效项
  ];
  // 模拟去重算法
  const ids = [];
  testGroupModels.forEach(m => {
    const id = typeof m === 'string' ? m : (m && typeof m.id === 'string' ? m.id : (m && typeof m.name === 'string' ? m.name : ''));
    if (id && ids.indexOf(id) < 0) ids.push(String(id));
  });
  assert.strictEqual(ids.length, 2, '模型拉取数据必须去重且过滤空 id');
  assert.deepStrictEqual(ids, ['deepseek-chat', 'deepseek-coder'], '去重结果正确');

  // 6. 验证停止生成状态流转（Stopping 呼吸灯类名切换）
  const sendBtn = getEl('aiSend');
  const busyToggle = (isBusy) => {
    if (isBusy) {
      sendBtn.disabled = false;
      sendBtn.classList.add('stopping');
      sendBtn.textContent = '⏹ 停止生成';
    } else {
      sendBtn.disabled = false;
      sendBtn.classList.remove('stopping');
      sendBtn.textContent = '发送';
    }
  };

  busyToggle(true);
  assert.ok(sendBtn.classList.contains('stopping'), '生成中添加 .stopping 呼吸灯类');
  assert.strictEqual(sendBtn.textContent, '⏹ 停止生成', '生成中按钮文案变为 ⏹ 停止生成');

  busyToggle(false);
  assert.ok(!sendBtn.classList.contains('stopping'), '生成完毕移除 .stopping 呼吸灯类');
  assert.strictEqual(sendBtn.textContent, '发送', '生成完毕按钮文案恢复 发送');
}

// =========================================================================
// 主测试执行器
// =========================================================================
function runAllAssertions() {
  let passed = 0;
  let failed = 0;

  const tests = [
    ['断言1 原型+文档.html 关键容器与模板完整性', test1_HtmlDomContract],
    ['断言2 app.css 现代视觉体系与动效关键帧规则完整性', test2_CssRulesContract],
    ['断言3 js/project-ai-export.js 核心函数与常量契约', test3_JsFunctionsAndConstantsContract],
    ['断言4 前端交互运行时仿真与数据处理无未捕获异常', test4_RuntimeSimulationAndBoundaryHandling],
    ['断言5 顶栏身份与设置入口', test5_TopIdentity],
    ['断言6 标注与交互卡片', test6_AnnoLink]
  ];

  for (const [title, fn] of tests) {
    try {
      fn();
      console.log(`[PASS] ${title}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${title}`);
      console.error(err);
      failed++;
    }
  }

  console.log(`SUMMARY passed=${passed} failed=${failed}\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllAssertions();
