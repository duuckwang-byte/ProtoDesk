'use strict';
/* 思考强度缓存验证（纯 Node / CommonJS，无 Electron、无网络、不启动真实 Agent）
 * 覆盖：
 * 1. 缓存模块：key=`agentId|model`、结构 version:1、原子写（无 .tmp 残留）、读失败/坏 JSON/版本不符容错；
 * 2. 敏感信息：configOptions 内的 apiKey/token/secret 等键不落盘；
 * 3. aiModelsImpl 命中缓存 → 立即 {ok:true,cached:true}，不调用 ACP；
 * 4. hint.background → 立即 {status:'probing'}，后台探测完成后回写缓存，同 key 单飞去重；
 * 5. 启动预热 warmThinkingCache：ACP 启用 + 模型非空才探测；禁用/无模型跳过；只跑一次；
 * 6. Agent / 模型切换不串档（key 隔离）；
 * 7. 保存触发/静态接线：settings-store 保存后 fire-and-forget、ai-controller 启动预热只排一次。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const thinkingCache = require('../main/services/ai-thinking-cache');
const service = require('../main/services/ai-process-service');
const aiConfigStore = require('../main/services/ai-config-store');

const ROOT = path.resolve(__dirname, '..');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-thinking-cache-'));
let seq = 0;

/**
 * 新建一棵独立的缓存文件路径（每个用例互不影响）。
 * @returns {string} 缓存文件绝对路径
 */
function tmpCachePath() {
  seq += 1;
  return path.join(TMP_ROOT, 'case-' + seq, 'ai-thinking-cache.json');
}

/**
 * 构造 configOptions（含思考强度 4 档）。
 * @param {string} model 模型 id
 * @returns {Array<Object>} configOptions
 */
function buildOptions(model) {
  return [
    {
      id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model,
      options: [{ value: model, name: model }]
    },
    {
      id: 'thought_level', name: 'Thinking', category: 'thought_level', type: 'select',
      currentValue: 'high',
      options: [{ value: 'low' }, { value: 'high' }, { value: 'max' }]
    }
  ];
}

/**
 * 构造 AI 配置（ACP 默认开启）。
 * @param {Object} [overrides] 覆盖字段
 * @returns {Object} 配置
 */
function makeCfg(overrides) {
  const base = {
    agentId: 'opencode',
    mainAgent: 'opencode',
    engine: 'cli',
    model: '',
    cliPaths: {},
    visibleModels: [],
    visibleModelsCli: {},
    acp: { enabled: true, defaultPermissionMode: 'approve-reads', agents: {} }
  };
  return Object.assign(base, overrides || {});
}

/** @returns {Object} ai:models 事件接收器 */
function makeSink() {
  return {
    sender: {
      send() {},
      isDestroyed() { return false; }
    }
  };
}

/**
 * 写入一条 ready 缓存。
 * @param {Object} cache 缓存实例
 * @param {string} agentId Agent id
 * @param {string} model 模型 id
 * @param {Array<Object>} [configOptions] 配置项
 * @returns {Object|null} 写入记录
 */
function seedReady(cache, agentId, model, configOptions) {
  return cache.set(thinkingCache.buildCacheKey(agentId, model), {
    agentId,
    model,
    configOptions: configOptions || buildOptions(model),
    modelConfigId: 'model_config',
    status: 'ready'
  });
}

const originalLoadAiConfigFull = aiConfigStore.loadAiConfigFull;

async function main() {
  let passed = 0;
  let failed = 0;

  /**
   * 跑一个用例并汇总结果。
   * @param {string} name 用例名
   * @param {Function} fn 用例体
   * @returns {Promise<void>} 无返回值
   */
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    } finally {
      aiConfigStore.loadAiConfigFull = originalLoadAiConfigFull;
      service.__setAcpModelsTestHooks({});
    }
  }

  /* ---------- 1. 缓存模块：结构 / 原子写 / 读写 ---------- */
  await run('缓存模块：version:1 + `agentId|model` 结构、原子写无 .tmp 残留', () => {
    const filePath = tmpCachePath();
    const cache = thinkingCache.createThinkingCache({ filePath });
    const key = thinkingCache.buildCacheKey('opencode', 'model-a');
    assert.strictEqual(key, 'opencode|model-a', 'key 必须是 agentId|model');

    const written = seedReady(cache, 'opencode', 'model-a');
    assert.ok(written, '写入应成功');
    assert.strictEqual(written.status, 'ready');
    assert.ok(written.ts > 0, 'ts 应自动补时间戳');

    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(onDisk.version, 1, '磁盘结构 version 必须为 1');
    assert.ok(onDisk.entries[key], 'entries 必须以 agentId|model 为键');
    assert.deepStrictEqual(
      Object.keys(onDisk.entries[key]).sort(),
      ['agentId', 'configOptions', 'model', 'modelConfigId', 'status', 'ts'],
      '条目字段必须稳定'
    );
    const leftovers = fs.readdirSync(path.dirname(filePath)).filter((n) => n.indexOf('.tmp-') >= 0);
    assert.deepStrictEqual(leftovers, [], '原子写不得留下 .tmp 文件');

    const got = cache.get(key);
    assert.ok(got, '读回应命中');
    assert.strictEqual(got.model, 'model-a');
    assert.strictEqual(got.configOptions.length, 2, 'configOptions 应完整回读');
    assert.strictEqual(got.configOptions[1].currentValue, 'high');

    /* 覆盖写：旧文件被完整替换，不是追加 */
    assert.ok(seedReady(cache, 'opencode', 'model-a', buildOptions('model-a').slice(0, 1)), '覆盖写应成功');
    const again = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(again.entries[key].configOptions.length, 1, '覆盖写应替换整份文档');
  });

  /* ---------- 2. 读失败容错 ---------- */
  await run('缓存容错：坏 JSON / 版本不符 / 结构非法 / key 与记录不一致', () => {
    const filePath = tmpCachePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const cache = thinkingCache.createThinkingCache({ filePath });

    fs.writeFileSync(filePath, '{ not-json', 'utf8');
    assert.deepStrictEqual(cache.load(), { version: 1, entries: {} }, '坏 JSON 回空结构');
    assert.strictEqual(cache.get('opencode|model-a'), null, '坏 JSON 时读空');

    fs.writeFileSync(filePath, JSON.stringify({ version: 2, entries: { 'a|b': {} } }), 'utf8');
    assert.deepStrictEqual(cache.load().entries, {}, '版本不符整份作废');

    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      entries: {
        'opencode|model-a': { agentId: 'opencode', model: 'model-a', status: 'ready', ts: Date.now(),
          configOptions: buildOptions('model-a') },
        'other|model-b': { agentId: 'opencode', model: 'model-a', status: 'ready', ts: Date.now(),
          configOptions: buildOptions('model-a') }
      }
    }), 'utf8');
    const loaded = cache.load();
    assert.ok(loaded.entries['opencode|model-a'], '自洽记录应保留');
    assert.ok(!loaded.entries['other|model-b'], 'key 与 agentId/model 不一致必须丢弃（防串档）');

    /* 写入失败不抛错、不破坏旧文件 */
    const badPath = path.join(filePath + '.not-a-dir', 'x.json');
    fs.writeFileSync(filePath + '.not-a-dir', 'x', 'utf8');
    const broken = thinkingCache.createThinkingCache({ filePath: badPath });
    assert.strictEqual(broken.set('opencode|m', { agentId: 'opencode', model: 'm' }), null, '写入失败回 null');
    assert.strictEqual(fs.readFileSync(filePath + '.not-a-dir', 'utf8'), 'x', '写入失败不得破坏既有文件');
  });

  /* ---------- 3. 敏感信息不落盘 ---------- */
  await run('缓存不含敏感信息：configOptions 内 apiKey/token/secret 递归剔除', () => {
    const filePath = tmpCachePath();
    const cache = thinkingCache.createThinkingCache({ filePath });
    cache.set('opencode|model-a', {
      agentId: 'opencode',
      model: 'model-a',
      status: 'ready',
      modelConfigId: 'model_config',
      configOptions: [{
        id: 'thought_level',
        name: 'Thinking',
        apiKey: 'sk-should-never-land',
        nested: { access_token: 'tok-should-never-land', password: 'pwd', keep: 'ok' },
        options: [{ value: 'high', name: 'High', secret: 'sec-should-never-land' }]
      }]
    });
    const text = fs.readFileSync(filePath, 'utf8');
    for (const bad of ['sk-should-never-land', 'tok-should-never-land', 'pwd', 'sec-should-never-land']) {
      assert.strictEqual(text.indexOf(bad), -1, `缓存文件不得出现敏感值：${bad}`);
    }
    assert.ok(text.indexOf('"keep":"ok"') >= 0, '非敏感字段应保留');
    const got = cache.get('opencode|model-a');
    assert.ok(!('apiKey' in got.configOptions[0]), '读回也不得带 apiKey');
    assert.ok(!('access_token' in got.configOptions[0].nested), '读回也不得带 access_token');
  });

  /* ---------- 4. prune：过期 + 超限 ---------- */
  await run('prune：按保留期过期 + 超上限保留最新', () => {
    let now = 1000000;
    const cache = thinkingCache.createThinkingCache({
      filePath: tmpCachePath(),
      maxEntries: 2,
      maxAgeMs: 1000,
      now: () => now
    });
    const write = (model, ts) => {
      cache.set(thinkingCache.buildCacheKey('opencode', model), {
        agentId: 'opencode', model, status: 'ready', ts, configOptions: buildOptions(model)
      });
    };
    write('m1', 999000);
    write('m2', 999500);
    write('m3', 999900);
    const kept = Object.keys(cache.load().entries).sort();
    assert.deepStrictEqual(kept, ['opencode|m2', 'opencode|m3'], '超上限应保留 ts 最新的 2 条');

    now = 1002000;
    const removed = cache.prune();
    assert.strictEqual(removed, 2, '过期条目应被清掉');
    assert.deepStrictEqual(cache.load().entries, {}, '全部过期后缓存为空');
  });

  /* ---------- 5. 命中缓存不调用 ACP ---------- */
  await run('aiModelsImpl：命中缓存立即返回 cached 且不启动 ACP', async () => {
    aiConfigStore.loadAiConfigFull = () => makeCfg();
    const cache = thinkingCache.createThinkingCache({ filePath: tmpCachePath() });
    seedReady(cache, 'opencode', 'model-a');
    let acpCalls = 0;
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async () => { acpCalls += 1; throw new Error('命中缓存不得启动 ACP'); },
      inspectAgentModels: async () => { throw new Error('probe 分支不得跑目录探测'); },
      resolveLaunchCommand: async () => { throw new Error('命中缓存不得解析启动命令'); }
    });

    const started = Date.now();
    const r = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'opencode', uiSessionId: 'ui-1', cwd: TMP_ROOT
    });
    const elapsed = Date.now() - started;
    assert.strictEqual(r.ok, true, '命中应成功');
    assert.strictEqual(r.cached, true, '命中应标记 cached:true');
    assert.strictEqual(r.status, 'ready');
    assert.strictEqual(r.model, 'model-a');
    assert.strictEqual(r.modelConfigId, 'model_config');
    assert.strictEqual(r.configOptions.length, 2, '应回缓存里的 configOptions');
    assert.strictEqual(acpCalls, 0, '命中缓存不得调用 ACP');
    assert.ok(elapsed < 200, `命中应秒回，实际 ${elapsed}ms`);

    /* force 绕过缓存 → 必须真探测（仍不联网，注入 hook） */
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async () => {
        acpCalls += 1;
        return { ok: true, model: 'model-a', modelConfigId: 'model_config', configOptions: buildOptions('model-a') };
      }
    });
    const forced = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'opencode', force: true, cwd: TMP_ROOT
    });
    assert.strictEqual(forced.cached, undefined, 'force 不得走缓存');
    assert.strictEqual(acpCalls, 1, 'force 应真正探测一次');
  });

  /* ---------- 5b. 缓存里的 unsupported 命中：保持 ACP_MODEL_UNSUPPORTED 语义 ---------- */
  await run('命中 unsupported 缓存：回 ACP_MODEL_UNSUPPORTED 且不再探测', async () => {
    aiConfigStore.loadAiConfigFull = () => makeCfg();
    const cache = thinkingCache.createThinkingCache({ filePath: tmpCachePath() });
    cache.set('opencode|model-x', {
      agentId: 'opencode', model: 'model-x', status: 'unsupported',
      configOptions: [], modelConfigId: '', error: 'ACP_MODEL_UNSUPPORTED'
    });
    let acpCalls = 0;
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async () => { acpCalls += 1; return { ok: false, error: 'ACP_MODEL_UNSUPPORTED' }; }
    });
    const r = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-x', agentId: 'opencode', cwd: TMP_ROOT
    });
    assert.strictEqual(r.ok, false, 'unsupported 命中应回 ok:false');
    assert.strictEqual(r.error, 'ACP_MODEL_UNSUPPORTED');
    assert.strictEqual(r.cached, true, '应标记 cached:true');
    assert.deepStrictEqual(r.availableModels, [], '缓存命中不再回可用模型列表');
    assert.strictEqual(acpCalls, 0, 'unsupported 命中不得再启动 ACP');
  });

  /* ---------- 6. background：立即返回 + 后台写缓存 + 单飞 ---------- */  await run('background：立即 probing，后台回写缓存，同 key 单飞', async () => {
    aiConfigStore.loadAiConfigFull = () => makeCfg();
    const cache = thinkingCache.createThinkingCache({ filePath: tmpCachePath() });
    let acpCalls = 0;
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async () => {
        acpCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { ok: true, model: 'model-a', modelConfigId: 'model_config', configOptions: buildOptions('model-a') };
      }
    });

    const hint = { engine: 'cli', probeModel: 'model-a', agentId: 'opencode', background: true, cwd: TMP_ROOT };
    const started = Date.now();
    const first = await service.aiModelsImpl(makeSink(), hint);
    const elapsed = Date.now() - started;
    assert.strictEqual(first.ok, true, 'background 应返回 ok');
    assert.strictEqual(first.status, 'probing', 'background 应返回 probing 占位');
    assert.deepStrictEqual(first.configOptions, [], '占位 configOptions 必须为空');
    assert.ok(elapsed < 40, `background 不得等待探测，实际 ${elapsed}ms`);
    assert.strictEqual(cache.get('opencode|model-a'), null, '探测未完成前不得写缓存');

    const second = await service.aiModelsImpl(makeSink(), hint);
    assert.strictEqual(second.status, 'probing', '第二次仍是占位（探测未完成）');

    await service.waitForThinkingProbes();
    assert.strictEqual(acpCalls, 1, '同 key 后台探测必须单飞');
    const cached = cache.get('opencode|model-a');
    assert.ok(cached, '后台探测完成应写入缓存');
    assert.strictEqual(cached.status, 'ready');
    assert.strictEqual(cached.configOptions.length, 2);

    /* 后台探测完成后，普通探测直接命中缓存 */
    const hit = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'opencode', cwd: TMP_ROOT
    });
    assert.strictEqual(hit.cached, true, '后台结果应被后续探测命中');
    assert.strictEqual(acpCalls, 1, '命中后不得再调 ACP');
  });

  /* ---------- 7. Agent / 模型切换不串档 ---------- */
  await run('Agent / 模型变化按 key 隔离，不串档', async () => {
    const cache = thinkingCache.createThinkingCache({ filePath: tmpCachePath() });
    seedReady(cache, 'opencode', 'model-a');
    const cfg = makeCfg();
    aiConfigStore.loadAiConfigFull = () => cfg;
    const probed = [];
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async (args) => {
        probed.push({ agentId: args.def.id, model: args.model });
        return { ok: true, model: args.model, modelConfigId: 'mc', configOptions: buildOptions(args.model) };
      }
    });

    const sameAgentSameModel = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'opencode', cwd: TMP_ROOT
    });
    assert.strictEqual(sameAgentSameModel.cached, true, '同 agent 同模型应命中');

    const otherModel = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-b', agentId: 'opencode', cwd: TMP_ROOT
    });
    assert.strictEqual(otherModel.cached, undefined, '换模型不得命中旧缓存');
    assert.strictEqual(probed.length, 1, '换模型应真探测一次');
    assert.strictEqual(probed[0].model, 'model-b');

    const otherAgent = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'codebuddy', cwd: TMP_ROOT
    });
    assert.strictEqual(otherAgent.cached, undefined, '换 Agent 不得命中旧缓存');
    assert.strictEqual(probed.length, 2, '换 Agent 应真探测一次');
    assert.strictEqual(probed[1].agentId, 'codebuddy');
  });

  /* ---------- 8. 启动预热 ---------- */
  await run('warmThinkingCache：ACP 启用 + 模型非空才探测，且只跑一次', async () => {
    const cache = thinkingCache.createThinkingCache({ filePath: tmpCachePath() });
    let acpCalls = 0;
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async (args) => {
        acpCalls += 1;
        return { ok: true, model: args.model, modelConfigId: 'mc', configOptions: buildOptions(args.model) };
      }
    });

    /* 无模型 → 跳过 */
    aiConfigStore.loadAiConfigFull = () => makeCfg({ model: '', visibleModelsCli: {} });
    service.__resetThinkingWarmForTest();
    const noModel = await service.warmThinkingCache();
    assert.strictEqual(noModel.skipped, 'no-model', '无模型应跳过');
    assert.strictEqual(acpCalls, 0, '无模型不得探测');

    /* ACP 关闭 → 跳过 */
    aiConfigStore.loadAiConfigFull = () => makeCfg({
      visibleModelsCli: { opencode: ['model-a'] },
      acp: { enabled: false, defaultPermissionMode: 'approve-reads', agents: {} }
    });
    service.__resetThinkingWarmForTest();
    const off = await service.warmThinkingCache();
    assert.strictEqual(off.skipped, 'acp-disabled', 'ACP 关闭应跳过');
    assert.strictEqual(acpCalls, 0, 'ACP 关闭不得探测');
    assert.strictEqual(cache.get('opencode|model-a'), null, 'ACP 关闭不得写缓存');

    /* 正常：可见模型首个作为当前模型，后台探测并写缓存 */
    aiConfigStore.loadAiConfigFull = () => makeCfg({ visibleModelsCli: { opencode: ['model-a'] } });
    service.__resetThinkingWarmForTest();
    const warm = await service.warmThinkingCache();
    assert.strictEqual(warm.ok, true, '预热应成功');
    assert.strictEqual(warm.agentId, 'opencode');
    assert.strictEqual(warm.model, 'model-a', '当前模型应取 CLI 可见首个');
    assert.strictEqual(warm.scheduled, true, '预热应排后台任务');
    await warm.task;
    assert.strictEqual(acpCalls, 1, '预热应后台探测一次');
    const cached = cache.get('opencode|model-a');
    assert.ok(cached && cached.status === 'ready', '预热结果应写入缓存');

    /* 只跑一次：重复调用复用同一 promise，且不再探测 */
    const again = await service.warmThinkingCache({ force: true });
    assert.strictEqual(again, warm, '重复调用必须复用第一次的 promise（只跑一次）');
    assert.strictEqual(acpCalls, 1, '重复调用不得再探测');

    /* 已有缓存时预热直接命中，不再探测 */
    service.__resetThinkingWarmForTest();
    const viaCache = await service.warmThinkingCache();
    assert.strictEqual(viaCache.cached, true, '已有缓存时预热应命中');
    assert.strictEqual(acpCalls, 1, '命中缓存不得再探测');
  });

  /* ---------- 9. 前台失败写 error 记录，不作为命中 ---------- */
  await run('失败结果写 error 记录但不参与命中（下次仍重探）', async () => {
    const cache = thinkingCache.createThinkingCache({ filePath: tmpCachePath() });
    aiConfigStore.loadAiConfigFull = () => makeCfg();
    service.__setAcpModelsTestHooks({
      thinkingCache: cache,
      previewModelConfig: async () => ({ ok: false, error: 'ACP_PROBE_FAILED', detail: 'boom' })
    });
    const first = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'opencode', cwd: TMP_ROOT
    });
    assert.strictEqual(first.ok, false);
    const rec = cache.get('opencode|model-a');
    assert.ok(rec, '失败也应留痕');
    assert.strictEqual(rec.status, 'error');
    assert.ok(String(rec.error || '').indexOf('ACP_PROBE_FAILED') >= 0, 'error 应记录失败码');

    const second = await service.aiModelsImpl(makeSink(), {
      engine: 'cli', probeModel: 'model-a', agentId: 'opencode', cwd: TMP_ROOT
    });
    assert.strictEqual(second.cached, undefined, 'error 记录不得当命中');
    assert.strictEqual(second.ok, false, '未命中应重新探测');
  });

  /* ---------- 10. 静态接线 ---------- */
  await run('静态接线：controller 启动预热 / settings-store 保存后 fire-and-forget', () => {
    const controller = fs.readFileSync(path.join(ROOT, 'main', 'controllers', 'ai-controller.js'), 'utf8');
    assert.ok(/function scheduleThinkingCacheWarm\(/.test(controller), 'controller 应有预热排期函数');
    assert.ok(/app\.whenReady\(\)/.test(controller), '预热必须挂在 app.whenReady 之后');
    assert.ok(/warmThinkingCache\(\)/.test(controller), '预热应调用 aiProcess.warmThinkingCache');
    assert.ok(/thinkingWarmScheduled/.test(controller), '预热只排一次需有幂等标记');
    const registerIdx = controller.indexOf('function registerAIController');
    const callIdx = controller.indexOf('scheduleThinkingCacheWarm();', registerIdx);
    assert.ok(callIdx > registerIdx, '注册控制器时应排一次预热');

    const svc = fs.readFileSync(path.join(ROOT, 'main', 'services', 'ai-process-service.js'), 'utf8');
    assert.ok(/readThinkingCacheHit\(/.test(svc), 'probe 分支应读缓存');
    assert.ok(/startBackgroundThinkingProbe\(/.test(svc), 'probe 分支应支持后台单飞');
    const probeIdx = svc.indexOf('async function probeAcpModelConfig');
    const probeBody = svc.slice(probeIdx, svc.indexOf('async function aiModelsImpl', probeIdx));
    assert.ok(/readThinkingCacheHit\(cache, cacheKey\)/.test(probeBody), '缓存读取必须在探测前');
    assert.ok(probeBody.indexOf('readThinkingCacheHit') < probeBody.indexOf('previewModelConfig'),
      '缓存命中应早于 ACP 探测');

    const aiCache = fs.readFileSync(path.join(ROOT, 'main', 'services', 'ai-thinking-cache.js'), 'utf8');
    assert.ok(/ai-thinking-cache\.json/.test(aiCache), '缓存文件名固定');
    assert.ok(/version: CACHE_VERSION/.test(aiCache), '写盘应带 version');
    assert.ok(/renameSync/.test(aiCache), '写盘应原子替换');
    for (const fn of ['load', 'get', 'set', 'prune']) {
      assert.ok(new RegExp('function ' + fn + '\\(').test(aiCache), `必须导出 ${fn}`);
    }

    const settings = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'stores', 'settings-store.ts'), 'utf8');
    assert.ok(/warmThinkingCache\(saved, models\.engine/.test(settings), '保存成功后应触发预热');
    assert.ok(/background: true/.test(settings), '预热 hint 必须 background:true');
    assert.strictEqual(/await\s+warmThinkingCache/.test(settings), false, '预热不得被 await（不阻塞保存）');
    const saveIdx = settings.indexOf('warmThinkingCache(saved');
    const fetchIdx = settings.lastIndexOf('const models = await fetchModels(saved, warnings)', saveIdx);
    assert.ok(fetchIdx > 0 && saveIdx > fetchIdx, '应复用已取到的模型目录（预热在 fetchModels 之后）');
    assert.ok(saveIdx - fetchIdx < 1600, '预热应紧跟在保存成功后');
  });

  aiConfigStore.loadAiConfigFull = originalLoadAiConfigFull;
  service.__setAcpModelsTestHooks({});
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) {}
  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.log('[FAIL] 用例框架异常');
  console.log((e && e.stack) || String(e));
  process.exitCode = 1;
});
