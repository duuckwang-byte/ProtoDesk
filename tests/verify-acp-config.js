'use strict';
// T2a ACP 模型/配置纯函数层验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖 fallback 清单、模型目录归一化、白名单交集、模型优先级、configOptions 解析、
// 会话配置规划（thought_level / model_config）与错误 detail 脱敏。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  ACP_MODEL_FALLBACKS,
  normalizeModelCatalog,
  mergeVisibleModels,
  resolveModelChoice,
  normalizeConfigOptions,
  planSessionConfig,
  redactErrorDetail
} = require('../main/acp/acp-config');

const AGY_MODELS = [
  'gemini-4-argon',
  'gemini-3.8-flash',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'gpt-oss-120b-medium'
];

// ---------- 断言1：三个 Agent 的 fallback 都是 ACP id ----------
function test1_Fallbacks() {
  assert.deepStrictEqual(
    ACP_MODEL_FALLBACKS.antigravity,
    AGY_MODELS,
    'antigravity 应为 5 个 base id，且顺序固定'
  );
  assert.strictEqual(ACP_MODEL_FALLBACKS.antigravity.length, 5, 'antigravity 应恰好 5 个模型');
  for (const id of ACP_MODEL_FALLBACKS.antigravity) {
    assert.ok(!id.endsWith('-high'), `antigravity 不得包含 -high 变体：${id}`);
    assert.ok(!/^gemini-.*-(high|medium|low)$/.test(id), `antigravity 不得包含旧档位变体：${id}`);
  }
  assert.ok(
    !ACP_MODEL_FALLBACKS.antigravity.includes('gemini-3.8-flash-high'),
    'gemini-3.8-flash-high 是 legacy 变体，ACP 不接受'
  );

  assert.ok(
    ACP_MODEL_FALLBACKS.opencode.includes('opencode-go/deepseek-v4.1-flash'),
    'opencode fallback 必须包含已验证的 opencode-go/deepseek-v4.1-flash'
  );
  assert.ok(ACP_MODEL_FALLBACKS.qoder.includes('auto'), 'qoder fallback 必须包含 auto');

  for (const agentId of Object.keys(ACP_MODEL_FALLBACKS)) {
    assert.ok(ACP_MODEL_FALLBACKS[agentId].length > 0, `${agentId} fallback 不应为空`);
    for (const id of ACP_MODEL_FALLBACKS[agentId]) {
      assert.strictEqual(typeof id, 'string', `${agentId} fallback id 应为字符串`);
      assert.ok(id.length > 0, `${agentId} fallback id 不应为空`);
      assert.notStrictEqual(id, 'deepseek-chat', `${agentId} fallback 不得使用 legacy 全局模型`);
    }
  }
}

// ---------- 断言2：模型目录归一化（去重 / 大小写 / name+description / 默认来源） ----------
function test2_NormalizeCatalog() {
  const catalog = normalizeModelCatalog({
    currentModelId: 'Claude-Sonnet-5-5',
    availableModelIds: ['gemini-3.8-flash', 'Claude-Sonnet-5-5', 'gemini-3.8-flash'],
    availableModels: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', description: 'fast' },
      { id: 'Claude-Sonnet-5-5' }
    ]
  });

  assert.deepStrictEqual(
    catalog.models.map((model) => model.id),
    ['gemini-3.8-flash', 'Claude-Sonnet-5-5'],
    '模型应去重并保持首次出现顺序'
  );
  assert.strictEqual(catalog.models[1].id, 'Claude-Sonnet-5-5', '模型 id 必须保留原始大小写');
  assert.strictEqual(catalog.models[0].name, 'Gemini 3.8 Flash', '应保留 name');
  assert.strictEqual(catalog.models[0].description, 'fast', '应保留 description');
  assert.strictEqual(catalog.models[1].name, 'Claude-Sonnet-5-5', '缺失 name 时回退 id');
  assert.strictEqual(catalog.defaultModel, 'Claude-Sonnet-5-5', 'currentModelId 命中时应作为默认模型');
  assert.strictEqual(catalog.source, 'agent-current', '默认来源应为 agent-current');

  const first = normalizeModelCatalog({
    currentModelId: 'not-advertised',
    availableModelIds: ['b-model', 'a-model']
  });
  assert.strictEqual(first.defaultModel, 'b-model', 'current 不命中时应取第一个公告模型');
  assert.strictEqual(first.source, 'first-advertised', '默认来源应为 first-advertised');

  const native = normalizeModelCatalog({
    currentModelId: 'gpt-oss-120b-medium',
    availableModelIds: ['gemini-3.8-flash'],
    availableModels: [{ modelId: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B' }]
  });
  assert.strictEqual(native.models[0].id, 'gpt-oss-120b-medium', '应兼容 acpx 的 modelId 字段');
  assert.strictEqual(native.models[0].name, 'GPT-OSS 120B', '应保留 acpx 的 name');
  assert.strictEqual(native.defaultModel, 'gpt-oss-120b-medium', 'acpx 原生 currentModelId 应生效');

  const empty = normalizeModelCatalog(null);
  assert.deepStrictEqual(empty, { models: [], defaultModel: '', source: 'none' }, '空输入应安全回落');
}

// ---------- 断言3：白名单交集 / 空交集降级 ----------
function test3_MergeVisibleModels() {
  const all = mergeVisibleModels(AGY_MODELS, []);
  assert.deepStrictEqual(all.models, AGY_MODELS, '白名单为空应返回全量 advertised');
  assert.strictEqual(all.warning, null, '白名单为空不应告警');

  const hit = mergeVisibleModels(AGY_MODELS, ['gemini-3.8-flash', 'claude-opus-5-5']);
  assert.deepStrictEqual(
    hit.models,
    ['gemini-3.8-flash', 'claude-opus-5-5'],
    '白名单非空且命中时应取交集'
  );
  assert.strictEqual(hit.warning, null, '交集非空不应告警');

  const miss = mergeVisibleModels(AGY_MODELS, ['gemini-3.8-flash-high']);
  assert.deepStrictEqual(
    miss.models,
    AGY_MODELS,
    '交集为空应降级为全量 advertised，而不是空列表'
  );
  assert.strictEqual(
    miss.warning,
    'visibleModels-no-intersection',
    '交集为空应返回 visibleModels-no-intersection'
  );

  const caseMiss = mergeVisibleModels(AGY_MODELS, ['GEMINI-3.8-FLASH']);
  assert.strictEqual(
    caseMiss.warning,
    'visibleModels-no-intersection',
    '白名单匹配必须区分大小写，不做 lowercase'
  );

  const rich = [{ id: 'a', name: 'A', reasoningOptions: [{ id: 'high' }] }, { id: 'b', name: 'B' }];
  const richHit = mergeVisibleModels(rich, ['a']);
  assert.deepStrictEqual(richHit.models, [rich[0]], '命中时应保留原条目的 name/reasoningOptions 等字段');
}

// ---------- 断言4：模型选择优先级 / 全局模型忽略 / UI 非法模型 ----------
function test4_ResolveModelChoice() {
  const uiHit = resolveModelChoice({
    requestedModel: 'claude-opus-5-5',
    modelSource: 'ui',
    agentConfigModel: 'gemini-3.8-flash',
    currentModelId: 'gemini-4-argon',
    advertised: AGY_MODELS
  });
  assert.strictEqual(uiHit.model, 'claude-opus-5-5', 'UI 明确选择应最优先');
  assert.strictEqual(uiHit.source, 'ui', '来源应为 ui');
  assert.strictEqual(uiHit.warning, null, '正常选择不应告警');
  assert.deepStrictEqual(uiHit.availableModels, AGY_MODELS, '应返回完整可用模型列表');
  assert.deepStrictEqual(
    Object.keys(uiHit).sort(),
    ['availableModels', 'model', 'source', 'warning'],
    '正常返回字段应与接口一致'
  );

  const uiMiss = resolveModelChoice({
    requestedModel: 'gemini-3.8-flash-high',
    modelSource: 'ui',
    advertised: AGY_MODELS
  });
  assert.strictEqual(uiMiss.error, 'ACP_MODEL_UNSUPPORTED', 'UI 选非法模型应返回 ACP_MODEL_UNSUPPORTED');
  assert.strictEqual(uiMiss.model, undefined, '报错时不应静默改模型');
  assert.deepStrictEqual(
    Object.keys(uiMiss).sort(),
    ['availableModels', 'error'],
    '报错返回字段应与接口一致'
  );
  assert.ok(
    uiMiss.availableModels.includes('gemini-3.8-flash'),
    'ACP_MODEL_UNSUPPORTED 的 availableModels 应含合法模型'
  );

  const configHit = resolveModelChoice({
    agentConfigModel: 'claude-sonnet-5-5',
    currentModelId: 'gemini-4-argon',
    advertised: AGY_MODELS
  });
  assert.strictEqual(configHit.model, 'claude-sonnet-5-5', 'agent-config 命中应优先于 current');
  assert.strictEqual(configHit.source, 'agent-config', '来源应为 agent-config');

  const staleFallbackCurrent = resolveModelChoice({
    agentConfigModel: 'gemini-3.8-flash-high',
    currentModelId: 'gemini-4-argon',
    advertised: AGY_MODELS
  });
  assert.strictEqual(staleFallbackCurrent.model, 'gemini-4-argon', '配置过期应降级到 currentModelId');
  assert.strictEqual(staleFallbackCurrent.source, 'agent-current', '降级来源应为 agent-current');
  assert.strictEqual(staleFallbackCurrent.warning, 'config-model-stale', '配置过期应记 config-model-stale');

  const staleFallbackFirst = resolveModelChoice({
    agentConfigModel: 'gemini-3.8-flash-high',
    advertised: AGY_MODELS
  });
  assert.strictEqual(staleFallbackFirst.model, 'gemini-4-argon', '无 current 时应降级到 advertised[0]');
  assert.strictEqual(staleFallbackFirst.source, 'first-advertised', '来源应为 first-advertised');

  const currentHit = resolveModelChoice({
    currentModelId: 'gpt-oss-120b-medium',
    advertised: AGY_MODELS
  });
  assert.strictEqual(currentHit.model, 'gpt-oss-120b-medium', 'currentModelId 命中应被采用');
  assert.strictEqual(currentHit.source, 'agent-current', '来源应为 agent-current');

  const globalLeak = resolveModelChoice({
    requestedModel: 'deepseek-chat',
    modelSource: 'ui',
    agentConfigModel: 'deepseek-chat',
    currentModelId: 'gemini-3.8-flash',
    advertised: AGY_MODELS,
    globalModel: 'deepseek-chat'
  });
  assert.notStrictEqual(globalLeak.model, 'deepseek-chat', 'deepseek-chat 必须被忽略');
  assert.strictEqual(globalLeak.model, 'gemini-3.8-flash', '全局模型泄漏时应降级到 current');
  assert.strictEqual(globalLeak.warning, 'ignored-global-model', '应记 ignored-global-model');

  const noModels = resolveModelChoice({ advertised: [] });
  assert.strictEqual(noModels.model, '', '无公告模型时不应设置模型');
  assert.strictEqual(noModels.source, 'none', '无公告模型时来源应为 none');
}

// ---------- 断言5：configOptions 归一化（grouped flatten / 非法跳过 / model_config 保留） ----------
function buildStatus() {
  return {
    details: {
      configOptions: [
        {
          id: 'model',
          name: '模型',
          type: 'select',
          category: 'model',
          currentValue: 'gemini-3.8-flash',
          options: [
            { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
            { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'strong' }
          ]
        },
        {
          id: 'thought_level',
          name: '思考强度',
          type: 'select',
          category: 'thought',
          currentValue: 'high',
          options: [
            { group: 'Low', name: 'Low', options: [{ value: 'low', name: 'Low' }] },
            {
              group: 'High',
              name: 'High',
              options: [{ value: 'high', name: 'High', description: 'more thinking' }]
            }
          ]
        },
        {
          id: 'context_size',
          name: '上下文窗口',
          type: 'select',
          category: 'model_config',
          currentValue: '200000',
          options: [
            {
              group: 'Sizes',
              options: [
                { value: '200000', name: '200K' },
                { value: 400000, name: '400K' }
              ]
            }
          ]
        },
        null,
        {},
        { name: '缺少 id' },
        { id: 'broken', options: 'not-an-array' }
      ]
    }
  };
}

function test5_NormalizeConfigOptions() {
  const options = normalizeConfigOptions(buildStatus());
  assert.deepStrictEqual(
    options.map((option) => option.id),
    ['model', 'thought_level', 'context_size', 'broken'],
    '应保留合法配置项、跳过非法项，并为非法 options 补空数组'
  );

  const model = options[0];
  assert.deepStrictEqual(
    Object.keys(model).sort(),
    ['category', 'currentValue', 'description', 'id', 'name', 'options', 'type'],
    'config option 输出字段应固定'
  );
  assert.strictEqual(model.currentValue, 'gemini-3.8-flash', '应保留 currentValue');
  assert.deepStrictEqual(
    model.options[1],
    { value: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'strong' },
    'flat options 应归一化为 value/name/description'
  );

  const thought = options[1];
  assert.strictEqual(thought.options.length, 2, 'grouped options 应被 flatten');
  assert.deepStrictEqual(
    thought.options.map((option) => option.value),
    ['low', 'high'],
    'grouped options 顺序应保持 group 内顺序'
  );
  assert.deepStrictEqual(
    Object.keys(thought.options[1]).sort(),
    ['description', 'name', 'value'],
    'flatten 后选项只保留 value/name/description'
  );
  assert.strictEqual(thought.options[1].description, 'more thinking', '应保留选项 description');

  const context = options[2];
  assert.strictEqual(context.currentValue, '200000', 'model_config 的 currentValue 应原样保留');
  assert.deepStrictEqual(
    context.options.map((option) => option.value),
    ['200000', '400000'],
    '数字 option value 应转字符串并保持顺序'
  );

  const fromTopLevel = normalizeConfigOptions({
    configOptions: [{ id: 'effort', currentValue: 'medium', options: [{ value: 'medium' }] }]
  });
  assert.strictEqual(fromTopLevel.length, 1, '应兼容 status.configOptions 顶层形态');
  assert.strictEqual(fromTopLevel[0].name, 'effort', 'name 缺失时应回退 id');

  for (const input of [null, undefined, {}, { details: { configOptions: 'bad' } }]) {
    assert.deepStrictEqual(normalizeConfigOptions(input), [], `非法输入 ${String(input)} 应返回空数组`);
  }
}

// ---------- 断言6：会话配置规划（模型 / thought_level / context_size） ----------
function test6_PlanSessionConfig() {
  const plan = planSessionConfig({
    status: buildStatus(),
    requestedModel: 'claude-opus-5-5',
    modelSource: 'ui',
    requestedThought: 'high'
  });
  assert.strictEqual(plan.model, 'claude-opus-5-5', '应选中 UI 指定模型');
  assert.strictEqual(plan.thoughtConfigId, 'thought_level', '应识别 thought_level');
  assert.strictEqual(plan.thoughtValue, 'high', '合法思考强度应被选中');
  assert.strictEqual(plan.modelConfigId, 'context_size', '应识别 model_config');
  assert.deepStrictEqual(plan.warnings, [], '合法配置不应产生 warning');
  assert.deepStrictEqual(
    Object.keys(plan).sort(),
    ['configOptions', 'model', 'modelConfigId', 'thoughtConfigId', 'thoughtValue', 'warnings'],
    'plan 正常返回字段应与接口一致'
  );

  const context = plan.configOptions.find((option) => option.id === 'context_size');
  assert.strictEqual(context.currentValue, '200000', 'context_size 原值应保留，不在本轮修改');

  const invalidThought = planSessionConfig({
    status: buildStatus(),
    requestedModel: 'claude-opus-5-5',
    modelSource: 'ui',
    requestedThought: 'ultra'
  });
  assert.strictEqual(invalidThought.model, 'claude-opus-5-5', '非法思考强度不应阻断本轮');
  assert.strictEqual(invalidThought.thoughtValue, '', '非法思考强度不应被选中');
  assert.ok(
    invalidThought.warnings.includes('thought-value-not-advertised'),
    '非法思考强度应记 thought-value-not-advertised'
  );

  const defaultThought = planSessionConfig({
    status: buildStatus(),
    requestedThought: 'default'
  });
  assert.strictEqual(defaultThought.thoughtValue, '', 'default 表示不修改思考强度');
  assert.ok(!defaultThought.warnings.includes('thought-value-not-advertised'), 'default 不应告警');

  const staleConfig = planSessionConfig({
    status: buildStatus(),
    agentConfigModel: 'gemini-3.8-flash-high'
  });
  assert.strictEqual(staleConfig.model, 'gemini-3.8-flash', '配置过期应降级到模型项 currentValue');
  assert.ok(staleConfig.warnings.includes('config-model-stale'), '配置过期应记 config-model-stale');

  const uiUnsupported = planSessionConfig({
    status: buildStatus(),
    requestedModel: 'gemini-3.8-flash-high',
    modelSource: 'ui'
  });
  assert.strictEqual(uiUnsupported.error, 'ACP_MODEL_UNSUPPORTED', 'plan 应透传 UI 非法模型错误');
  assert.ok(
    uiUnsupported.availableModels.includes('gemini-3.8-flash'),
    'plan 应透传 availableModels 供 UI 重选'
  );

  const reasoningFallback = planSessionConfig({
    configOptions: [
      {
        id: 'reasoning_effort',
        name: '推理强度',
        category: 'thought',
        currentValue: 'low',
        options: [{ value: 'low' }, { value: 'medium' }]
      }
    ],
    requestedThought: 'medium'
  });
  assert.strictEqual(reasoningFallback.thoughtConfigId, 'reasoning_effort', '应支持 reasoning_effort 候选');
  assert.strictEqual(reasoningFallback.thoughtValue, 'medium', '应选中 reasoning_effort 的值');

  const missingThoughtOption = planSessionConfig({
    status: buildStatus(),
    requestedThought: 'high',
    configOptions: [{ id: 'model', category: 'model', options: [{ value: 'm1' }] }]
  });
  assert.ok(
    missingThoughtOption.warnings.includes('thought-option-missing'),
    '未公告思考项时应 warning，而不是抛错'
  );

  const modelsOnly = planSessionConfig({
    status: {
      models: {
        currentModelId: 'claude-opus-5-5',
        availableModelIds: ['gemini-3.8-flash', 'claude-opus-5-5']
      }
    }
  });
  assert.strictEqual(modelsOnly.model, 'claude-opus-5-5', '无 configOptions 时应退回 status.models');
  assert.strictEqual(modelsOnly.modelConfigId, '', '无 model_config 时应返回空 id');
  assert.strictEqual(modelsOnly.thoughtConfigId, '', '无思考项时应返回空 id');
}

// ---------- 断言7：错误 detail 脱敏与截断 ----------
function test7_RedactErrorDetail() {
  const long = redactErrorDetail(new Error('x'.repeat(2000)));
  assert.strictEqual(long.length, 800, 'detail 应截断到 800 字');
  assert.ok(long.endsWith('…'), '截断后应有省略号');

  const secret = redactErrorDetail(
    new Error('Authorization: Bearer sk-supersecret123 api_key=abc123 token: tok_999')
  );
  assert.ok(secret.includes('[REDACTED]'), '凭据应被替换为 [REDACTED]');
  assert.ok(!secret.includes('supersecret123'), 'Bearer token 不应泄漏');
  assert.ok(!secret.includes('abc123'), 'api_key 值不应泄漏');
  assert.ok(!secret.includes('tok_999'), 'token 值不应泄漏');

  const jsonSecret = redactErrorDetail({
    message: 'failed',
    detail: '{"Authorization":"Bearer topsecret","apiKey":"sk-json-secret"}'
  });
  assert.ok(!jsonSecret.includes('topsecret'), 'JSON 形态的 Authorization 也应脱敏');
  assert.ok(!jsonSecret.includes('sk-json-secret'), 'JSON 形态的 apiKey 也应脱敏');

  const basicAuth = redactErrorDetail('Authorization: Basic dXNlcjpwYXNz');
  assert.ok(!basicAuth.includes('dXNlcjpwYXNz'), 'Basic Authorization 凭据也应脱敏');

  const multiline = redactErrorDetail(new Error('line1\nline2\r\n  line3'));
  assert.strictEqual(multiline, 'line1 line2 line3', 'detail 应单行化');

  const caused = new Error('outer');
  caused.cause = new Error('inner failure');
  assert.strictEqual(redactErrorDetail(caused), 'inner failure', 'cause.message 应优先');

  assert.strictEqual(
    redactErrorDetail({ message: 'outer', detail: 'detail message' }),
    'detail message',
    'detail 应优先于 message'
  );
  assert.strictEqual(redactErrorDetail(null), '', '空错误应返回空串');

  const bareBearer = redactErrorDetail('request failed: Bearer abc.def-123');
  assert.strictEqual(bareBearer, 'request failed: Bearer [REDACTED]', '裸 Bearer 也应脱敏');
}

// ---------- 断言8：模块保持纯 Node 可测 ----------
function test8_PureModule() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'acp', 'acp-config.js'), 'utf8');
  assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(src), 'acp-config 不得依赖 electron');
  assert.ok(!/require\(\s*['"]acpx/.test(src), 'acp-config 不得直接依赖 acpx');
  const mod = require('../main/acp/acp-config');
  assert.strictEqual(typeof mod.planSessionConfig, 'function', '应导出 planSessionConfig');
  assert.strictEqual(typeof mod.redactErrorDetail, 'function', '应导出 redactErrorDetail');
}

async function main() {
  let passed = 0;
  let failed = 0;
  function run(name, fn) {
    try {
      fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    }
  }

  run('断言1 fallback 清单', test1_Fallbacks);
  run('断言2 模型目录归一化', test2_NormalizeCatalog);
  run('断言3 白名单交集', test3_MergeVisibleModels);
  run('断言4 模型选择优先级', test4_ResolveModelChoice);
  run('断言5 configOptions 归一化', test5_NormalizeConfigOptions);
  run('断言6 会话配置规划', test6_PlanSessionConfig);
  run('断言7 错误 detail 脱敏', test7_RedactErrorDetail);
  run('断言8 纯 Node 模块', test8_PureModule);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
