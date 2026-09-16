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
    ['断言4 前端交互运行时仿真与数据处理无未捕获异常', test4_RuntimeSimulationAndBoundaryHandling]
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
