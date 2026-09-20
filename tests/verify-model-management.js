'use strict';
// 模型显示管理与动态获取链路重构 自动化测试套件
// 覆盖：自定义模型合并、动态探测与降级、空过滤防呆、free独立模型
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

const rootDir = path.resolve(__dirname, '..');
// Wave-B兼容：主进程已拆为 main.js(骨架)+main/controllers+main/services，聚合后断言（契约不变）
function readMainAggregated() {
  const files = [path.join(rootDir, 'main.js')];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(rootDir, 'main'));
  return files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }).join('\n');
}
const mainContent = readMainAggregated();
const jsContent = fs.readFileSync(path.join(rootDir, 'js', 'project-ai-export.js'), 'utf8');
const preloadContent = fs.readFileSync(path.join(rootDir, 'preload.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(rootDir, '原型+文档.html'), 'utf8');
const opencodeDef = require(path.join(rootDir, 'runtimes', 'defs', 'opencode.js'));
const antigravityDef = require(path.join(rootDir, 'runtimes', 'defs', 'antigravity.js'));

// 断言1：opencode 与 antigravity def动态探测契约 + 解析器去噪/兼容多格式（free 为独立模型，不再合并）
function test1_DefListModelsContract() {
  assert.ok(opencodeDef.listModels, 'opencode def应含listModels');
  assert.ok(Array.isArray(opencodeDef.listModels.args) && opencodeDef.listModels.args.length, 'listModels.args应为非空数组');
  assert.ok(opencodeDef.listModels.timeoutMs <= 5000, `timeoutMs应<=5000，实际${opencodeDef.listModels.timeoutMs}`);
  assert.strictEqual(typeof opencodeDef.listModels.parse, 'function', 'listModels.parse应为函数');
  // fallback零-free
  const fbIds = (opencodeDef.fallbackModels || []).map((m) => String(m.id || ''));
  assert.ok(!fbIds.some((id) => /-free$/i.test(id)), `fallbackModels不得含-free，实际${JSON.stringify(fbIds)}`);
  assert.ok((opencodeDef.fallbackModels || []).some((m) => m && m.default), 'fallbackModels应有default项');
  // parse：纯文本行（free 独立保留，与base并存）
  const r1 = opencodeDef.listModels.parse('opencode/mimo-v2.5\nopencode/deepseek-v4-flash-free\nopencode/deepseek-v4-flash\n', '');
  const ids1 = r1.map((m) => m.id);
  assert.ok(ids1.includes('opencode/mimo-v2.5'), `应保留mimo-v2.5，实际${JSON.stringify(ids1)}`);
  assert.ok(ids1.includes('opencode/deepseek-v4-flash-free'), `应保留free独立模型，实际${JSON.stringify(ids1)}`);
  assert.ok(ids1.includes('opencode/deepseek-v4-flash'), `base与free应并存，实际${JSON.stringify(ids1)}`);
  // parse：{data:[]} 去重过滤
  const r2 = opencodeDef.listModels.parse(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { id: 'whisper-1' }, { id: 'my-model' }] }), '');
  const ids2 = r2.map((m) => m.id);
  assert.ok(ids2.includes('gpt-4o') && ids2.includes('my-model'), `应保留gpt-4o/my-model，实际${JSON.stringify(ids2)}`);
  assert.ok(!ids2.some((id) => /whisper/i.test(id)), `应过滤whisper，实际${JSON.stringify(ids2)}`);
  assert.strictEqual(ids2.filter((id) => id === 'gpt-4o').length, 1, `gpt-4o应去重，实际${JSON.stringify(ids2)}`);
  // parse：{models:[]} 兼容
  const r3 = opencodeDef.listModels.parse(JSON.stringify({ models: ['a-model', 'b-model'] }), '');
  assert.strictEqual(r3.length, 2, `models数组应解析2项，实际${JSON.stringify(r3)}`);
  // parse：空输出不抛错
  assert.doesNotThrow(() => opencodeDef.listModels.parse('', 'error'), '空输出不得抛错');

  // antigravity def契约：含 listModels、包含最新 3.7/3.8 模型、支持 --model 参数
  assert.ok(antigravityDef.listModels, 'antigravity def应含listModels');
  assert.ok(Array.isArray(antigravityDef.listModels.args) && antigravityDef.listModels.args.includes('models'), 'antigravity listModels.args应含models');
  assert.strictEqual(typeof antigravityDef.listModels.parse, 'function', 'antigravity listModels.parse应为函数');
  const agyFbIds = (antigravityDef.fallbackModels || []).map((m) => String(m.id || ''));
  assert.ok(agyFbIds.includes('gemini-3.8-flash-high'), 'antigravity fallbackModels应包含gemini-3.8-flash-high');
  assert.ok(agyFbIds.includes('gemini-3.7-flash-high'), 'antigravity fallbackModels应包含gemini-3.7-flash-high');
  // antigravity parse契约测试
  const agySampleOut = 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.7-flash-high\tGemini 3.7 Flash (High)\n';
  const agyParsed = antigravityDef.listModels.parse(agySampleOut, '');
  assert.strictEqual(agyParsed.length, 2, 'antigravity应滤除Fetching行并解析2项');
  assert.strictEqual(agyParsed[0].id, 'gemini-3.8-flash-high');
  assert.strictEqual(agyParsed[0].label, 'Gemini 3.8 Flash (High)');
  // antigravity buildArgs 透传 --model
  const agyArgs = antigravityDef.buildArgs('test prompt', [], [], { model: 'gemini-3.8-flash-high' });
  assert.ok(agyArgs.includes('--model') && agyArgs.includes('gemini-3.8-flash-high'), 'buildArgs应透传--model');
  const agyDefaultArgs = antigravityDef.buildArgs('test prompt', [], [], { model: 'default' });
  assert.ok(!agyDefaultArgs.includes('--model'), 'default模型不应携带--model参数');
}

// 断言2：main.js动态探测链路（执行+缓存+融合+降级）
function test2_MainDynamicEngine() {
  for (const needle of ['execCliListModels', 'cliModelsCache', 'CLI_MODELS_CACHE_TTL', 'resolveAgentExecutable', 'customModelsCli', 'stripFreeSuffix', 'normalizeCliModelIds']) {
    assert.ok(mainContent.includes(needle), `main.js缺失动态链路关键实现: ${needle}`);
  }
  assert.ok(/createCommandInvocation/.test(mainContent), 'main.js应使用createCommandInvocation防cmd变量展开');
  assert.ok(/applyAgentLaunchEnv/.test(mainContent), 'main.js应使用applyAgentLaunchEnv修复PATH');
  assert.ok(/os\.tmpdir\(\)/.test(mainContent), '探测进程cwd应隔离至os.tmpdir');
  assert.ok(/1000/.test(mainContent) && /cliModelsCache\.set/.test(mainContent), '应有缓存写入逻辑');
  assert.ok(/降级|fallback/i.test(mainContent), '应有降级保护注释或逻辑');
  // save-config即时清缓存，保证切换Agent/添加模型后重拉（Wave-B：通道在 controller，实现在 service，分开断言）
  assert.ok(mainContent.includes('ai:save-config'), '须保留ai:save-config通道');
  assert.ok(/cliModelsCache\.clear/.test(mainContent), 'save-config后应清空模型缓存');
  // ai:models融合customModelsCli
  assert.ok(/cfg\.customModelsCli/.test(mainContent), 'ai:models应融合cfg.customModelsCli');
  // 26 defs fallback均非空且有default项（ai:models永不返回空组）
  const { getAllAgentDefs } = require(path.join(rootDir, 'runtimes', 'registry'));
  const allDefs = getAllAgentDefs();
  assert.strictEqual(allDefs.length, 26, `注册表应为26项，实际${allDefs.length}`);
  for (const d of allDefs) {
    assert.ok(Array.isArray(d.fallbackModels) && d.fallbackModels.length > 0, `def[${d.id}]fallbackModels非空`);
    assert.ok(d.fallbackModels.some((m) => m && m.default), `def[${d.id}]应有default项`);
  }
  // UI引擎hint优先：设置面板按Tab显式请求，不依赖落盘引擎（切回本地不再串API）
  assert.ok(/hintEngine/.test(mainContent), 'ai:models应支持UI引擎hint优先');
  assert.ok(/h\.api \|\| h\.byok \|\| h\.apiConfig/.test(mainContent), 'ai:models API分支应接受hint直连配置');
  // save显式切引擎时清理历史遗留mode/providerType，避免永久误判isApi
  assert.ok(/delete next\.mode; delete next\.providerType/.test(mainContent), '切回cli应清理遗留mode/providerType');
  // preload透传hint
  assert.ok(/listModels:\s*\(hint\)\s*=>\s*ipcRenderer\.invoke\('ai:models', hint\)/.test(preloadContent), 'preload listModels应透传hint');
  // 管理列表按UI引擎请求
  assert.ok(/listModels\(engHint\)/.test(jsContent), '管理列表应按UI引擎显式请求');
  assert.ok(/r\.engine&&r\.engine!==engHint/.test(jsContent), '管理列表应有引擎失配提示');
  // 拉取不再落盘翻转引擎
  assert.ok(!/engine:'api', mode:'api', providerType:'api'/.test(jsContent), '拉取不应再落盘翻转引擎');
  assert.ok(/listModels\(\{ engine:'api', api:byokUi/.test(jsContent), '拉取应改走hint透传直连配置');
}

// 断言3：前端添加模型全模式+即时持久化
function test3_FrontendAddModel() {
  const seg = jsContent.match(/btnAddCustomModel\.onclick=function\(\)\{[\s\S]*?\n\};/) || jsContent.match(/btnAddCustomModel\.onclick[\s\S]{0,2000}newModelInput\.value=''/);
  assert.ok(seg, '应找到btnAddCustomModel.onclick实现');
  const code = String((seg && seg[0]) || '');
  assert.ok(/getActiveEngineInUi/.test(code), '添加逻辑应区分cli/api模式');
  assert.ok(/addCliCustomId|customModelsCli/.test(code), 'CLI模式应写入customModelsCli（分CLI隔离）');
  assert.ok(/setCliVisibleIds|visibleModelsCli/.test(code), 'CLI模式应自动勾选visibleModelsCli（分CLI隔离）');
  assert.ok(/saveConfig/.test(code), '添加后应立即saveConfig物理落盘');
  assert.ok(/showToast/.test(code), '添加后应弹出成功Toast');
  assert.ok(/aiInvalidateModels/.test(code) && /aiLoadModels/.test(code), '添加后应刷新顶部下拉');
  assert.ok(!/\.replace\(\/\[-_\]free/.test(code), '添加时不得清洗-free后缀（free独立模型原样保留）');
}

// 断言4：空过滤防呆+free独立展示+Agent联动
function test4_FilterFailsafe() {
  assert.ok(/function aiRenderModelOptions/.test(jsContent), '应存在aiRenderModelOptions');
  assert.ok(/默认推荐模型 \(CLI 预设\)/.test(jsContent), '空兜底应为default推荐项');
  assert.ok(!/deepseek-v4-flash-free/.test(jsContent), '前端不得残留deepseek-v4-flash-free废弃字符串');
  const cleanSeg = jsContent.match(/var cleanId=function\(s\)\{[^}]*\}/);
  assert.ok(cleanSeg && !/free/i.test(cleanSeg[0]), 'cleanId仅去空白，不得清洗-free后缀');
  const intoSeg = jsContent.match(/function aiRenderModelOptionsInto[\s\S]*?\n\}/);
  const stripDef = jsContent.match(/var stripFree=function\(id\)\{[^}]*\}/);
  assert.ok(stripDef && !/\.replace\(/.test(stripDef[0]), 'stripFree不得再清洗后缀（仅原样返回）');
  assert.ok(/function i5SetMainAgent/.test(jsContent), '应存在i5SetMainAgent');
  const setMain = jsContent.match(/function i5SetMainAgent[\s\S]*?\n\}/);
  assert.ok(setMain && /aiInvalidateModels/.test(setMain[0]), '切换Agent应清空模型缓存');
  assert.ok(setMain && /renderModelManagerList/.test(setMain[0]), '切换Agent应刷新管理面板');
}

// 断言5：推理强度(Reasoning Effort)探测与级联交互契约
function test5_ReasoningEffortContract() {
  // 1. antigravity 契约：定义 reasoningOptions 且 buildArgs 支持 --effort
  assert.ok(Array.isArray(antigravityDef.reasoningOptions) && antigravityDef.reasoningOptions.length >= 3, 'antigravityDef须提供reasoningOptions');
  const effortHighArgs = antigravityDef.buildArgs('test prompt', [], [], { model: 'gemini-3.8-flash-high', reasoning: 'high' });
  assert.ok(effortHighArgs.includes('--effort') && effortHighArgs.includes('high'), 'buildArgs应透传--effort high');
  const defaultEffortArgs = antigravityDef.buildArgs('test prompt', [], [], { model: 'gemini-3.8-flash-high', reasoning: 'default' });
  assert.ok(!defaultEffortArgs.includes('--effort'), 'default思考强度不应携带--effort参数');

  // 2. 主进程契约：aiModelsImpl 返回携带 reasoningOptions
  assert.ok(/reasoningOptions/.test(mainContent), '主进程aiModelsImpl应携带reasoningOptions');

  // 3. 前端契约：project-ai-export.js 状态与级联交互
  assert.ok(/function aiCurReasoning/.test(jsContent), '前端应实现aiCurReasoning');
  assert.ok(/function aiStoreReasoning/.test(jsContent), '前端应实现aiStoreReasoning');
  assert.ok(/function aiRenderCascader/.test(jsContent), '前端应实现aiRenderCascader');
  assert.ok(/reasoning:\s*\(typeof aiCurReasoning/.test(jsContent), 'window.protoAPI.ai.ask应透传reasoning');

  // 4. HTML 契约：级联选择器容器完整性
  assert.ok(/id="aiModelCascader"/.test(htmlContent), 'HTML须包含级联选择器容器 #aiModelCascader');
  assert.ok(/id="aiModelBtn"/.test(htmlContent), 'HTML须包含级联触发按钮 #aiModelBtn');
  assert.ok(/id="aiCascaderPopover"/.test(htmlContent), 'HTML须包含级联弹出面板 #aiCascaderPopover');
  assert.ok(/id="aiCascaderPrimary"/.test(htmlContent), 'HTML须包含一级模型面板 #aiCascaderPrimary');
  assert.ok(/id="aiCascaderSub"/.test(htmlContent), 'HTML须包含二级思考强度面板 #aiCascaderSub');
}

function runAllAssertions() {
  let passed = 0; let failed = 0;
  const tests = [
    ['断言1 def动态探测契约与解析器独立模型', test1_DefListModelsContract],
    ['断言2 主进程动态引擎与缓存融合', test2_MainDynamicEngine],
    ['断言3 前端添加全模式与即时落盘', test3_FrontendAddModel],
    ['断言4 空过滤防呆与Agent联动', test4_FilterFailsafe],
    ['断言5 推理强度(Reasoning Effort)探测与级联交互契约', test5_ReasoningEffortContract],
  ];
  for (const [title, fn] of tests) {
    try { fn(); console.log(`[PASS] ${title}`); passed++; }
    catch (err) { console.error(`[FAIL] ${title}`); console.error(err); failed++; }
  }
  console.log(`SUMMARY passed=${passed} failed=${failed}\n`);
  if (failed > 0) process.exit(1);
}
runAllAssertions();
