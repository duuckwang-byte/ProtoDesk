'use strict';
/* T7a ACP 模型目录非阻塞（SWR）验证（纯 Node，不启动 Electron / Agent）
 * 覆盖：
 * 1. 有缓存立即返回（即使后台 ACP 探测仍在跑），返回 source=cache / refreshing=true；
 * 2. 无缓存 CLI 原生 models 优先，返回 source=cli，后台 ACP 刷新完成后发 acp_catalog；
 * 3. 刷新失败保留旧缓存，事件带 error/warning/stale=true；
 * 4. 同一 key 并发刷新去重，inspectAgentModels 只调用一次；
 * 5. 默认模型只来自 cache/CLI/fallback，cfg.model=deepseek-chat 不外泄；
 * 6. visibleModels 交集逻辑保留，刷新事件同样按白名单过滤。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const service = require('../main/services/ai-process-service');
const aiConfigStore = require('../main/services/ai-config-store');
const shared = require('../main/state');
const { ACP_MODEL_FALLBACKS } = require('../main/acp/acp-config');
const { createAcpModelCache, buildCacheKey } = require('../main/acp/acp-model-cache');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-acp-models-'));
const originalLoadAiConfigFull = aiConfigStore.loadAiConfigFull;

const fakeCfg = {
  agentId: 'opencode',
  mode: 'cli',
  acp: { enabled: true, agents: {} },
  visibleModelsCli: {},
  visibleModels: [],
  cliPaths: {},
  model: ''
};
aiConfigStore.loadAiConfigFull = () => fakeCfg;

let caseSeq = 0;

/**
 * 新建一组隔离测试上下文（独立缓存文件 + 独立启动命令）。
 * @returns {{dir:string, cache:Object, command:string, commandText:string, key:string}} 上下文
 */
function newCase() {
  caseSeq += 1;
  const dir = path.join(tempRoot, 'case-' + caseSeq);
  const cache = createAcpModelCache({ filePath: path.join(dir, 'acp-model-catalog.json') });
  const command = 'C:\\pland-fake\\opencode-' + caseSeq + '.exe';
  const commandText = command + ' acp';
  return { dir, cache, command, commandText, key: buildCacheKey('opencode', commandText) };
}

/**
 * 事件接收器（模拟 ipcMain 的 ev.sender）。
 * @returns {{events:Array, ev:Object, ofType:Function}} 接收器
 */
function makeSink() {
  const events = [];
  const ev = {
    sender: {
      send(channel, payload) { events.push({ channel, payload }); },
      isDestroyed() { return false; }
    }
  };
  return {
    events,
    ev,
    ofType(type) {
      return events.filter((e) => e.payload && e.payload.type === type).map((e) => e.payload);
    }
  };
}

/**
 * 预置磁盘缓存。
 * @param {Object} c 测试上下文
 * @param {string[]} ids 模型 id
 * @param {Object} [opts] {ts, defaultModel, source, cliVersion}
 * @returns {Object|null} 写入记录
 */
function seedCache(c, ids, opts) {
  const o = opts || {};
  return c.cache.set(c.key, {
    agentId: 'opencode',
    command: c.commandText,
    models: ids.map((id) => ({ id, name: id, description: '' })),
    defaultModel: o.defaultModel || ids[0] || '',
    source: o.source || 'first-advertised',
    ts: o.ts == null ? Date.now() : o.ts,
    cliVersion: o.cliVersion
  });
}

/**
 * 注入测试依赖。
 * @param {Object} c 测试上下文
 * @param {Object} [opts] {cli, inspect}
 * @returns {void}
 */
function installHooks(c, opts) {
  const o = opts || {};
  service.__setAcpModelsTestHooks({
    cache: c.cache,
    resolveLaunchCommand: async () => ({ command: [c.command, 'acp'], unresolved: null }),
    execCliListModels: o.cli || (async () => []),
    inspectAgentModels: o.inspect || (async () => ({ availableModelIds: ['acp-default'] }))
  });
}

/**
 * 轮询等待条件成立。
 * @param {Function} fn 判定函数
 * @param {number} timeoutMs 超时
 * @param {string} label 错误标签
 * @returns {Promise<*>} 判定返回值
 */
async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + (timeoutMs || 3000);
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('等待超时：' + (label || ''));
}

/**
 * 清空进程内缓存，避免跨用例串档（磁盘缓存各自隔离）。
 * @returns {void}
 */
function resetMemory() {
  try { shared.cliModelsCache.clear(); } catch (e) {}
}

// ---------- 1. 有缓存立即返回 + 后台刷新事件 ----------
async function test1_CacheFirst() {
  const c = newCase();
  resetMemory();
  seedCache(c, ['cache-a', 'cache-b']);
  const sink = makeSink();
  let inspectCalls = 0;
  let cliCalls = 0;
  installHooks(c, {
    cli: async () => { cliCalls += 1; return [{ id: 'cli-should-not-run' }]; },
    inspect: async () => {
      inspectCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { currentModelId: 'acp-fresh', availableModelIds: ['acp-fresh', 'acp-extra'] };
    }
  });

  const t0 = Date.now();
  const r = await service.aiModelsImpl(sink.ev, { requestId: 'req-cache' });
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 400, '缓存命中应立即返回（<400ms），实际 ' + elapsed + 'ms');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.source, 'cache', '来源应为 cache');
  assert.strictEqual(r.refreshing, true, '后台应正在刷新');
  assert.strictEqual(r.stale, false, '刚写入的缓存不应 stale');
  assert.strictEqual(cliCalls, 0, '缓存命中不得再跑 CLI');
  assert.strictEqual(inspectCalls, 1, '后台 ACP 刷新应已启动');
  assert.deepStrictEqual(r.groups[0].models.map((m) => m.id), ['cache-a', 'cache-b']);
  assert.strictEqual(r.default, 'cache-a');
  assert.strictEqual(r.requestId, 'req-cache');
  assert.strictEqual(r.transport, 'acp');
  assert.strictEqual(r.agentId, 'opencode');

  const raw = await waitFor(
    () => sink.events.find((e) => e.payload && e.payload.type === 'acp_catalog'),
    3000,
    'acp_catalog 成功事件'
  );
  assert.strictEqual(raw.channel, 'ai:event');
  const ev = raw.payload;
  assert.strictEqual(ev.type, 'acp_catalog');
  assert.strictEqual(ev.agentId, 'opencode');
  assert.strictEqual(ev.command, c.commandText);
  assert.deepStrictEqual(ev.models.map((m) => m.id), ['acp-fresh', 'acp-extra']);
  assert.strictEqual(ev.defaultModel, 'acp-fresh');
  assert.strictEqual(ev.source, 'acp');
  assert.strictEqual(ev.stale, false);
  assert.strictEqual(ev.requestId, 'req-cache');
  assert.ok(typeof ev.ts === 'number' && ev.ts > 0, '事件应带 ts');

  const cached = await waitFor(() => {
    const entry = c.cache.get(c.key);
    return entry && entry.models.some((m) => m.id === 'acp-fresh') ? entry : null;
  }, 3000, '刷新结果写盘');
  assert.strictEqual(cached.defaultModel, 'acp-fresh');
}

// ---------- 2. 无缓存 CLI 优先 + 后台 ACP 刷新 ----------
async function test2_CliFirst() {
  const c = newCase();
  resetMemory();
  const sink = makeSink();
  let cliCalls = 0;
  installHooks(c, {
    cli: async (resolvedBin, def) => {
      cliCalls += 1;
      assert.strictEqual(resolvedBin, c.command, 'CLI 应使用解析后的启动 bin');
      assert.ok(def && def.id === 'opencode', 'CLI 应拿到当前 Agent def');
      return [{ id: 'cli-a', label: 'cli-a' }, { id: 'cli-b', label: 'cli-b' }];
    },
    inspect: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { availableModelIds: ['acp-x', 'acp-y'] };
    }
  });

  const t0 = Date.now();
  const r = await service.aiModelsImpl(sink.ev, {});
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 400, 'CLI 返回后不应等待 ACP 刷新，实际 ' + elapsed + 'ms');
  assert.strictEqual(r.source, 'cli', '无缓存时应先返回 CLI 目录');
  assert.strictEqual(r.refreshing, true);
  assert.strictEqual(r.stale, false);
  assert.strictEqual(cliCalls, 1);
  assert.deepStrictEqual(r.groups[0].models.map((m) => m.id), ['cli-a', 'cli-b']);
  assert.strictEqual(r.default, 'cli-a');

  const ev = await waitFor(() => sink.ofType('acp_catalog')[0], 3000, 'acp_catalog 事件');
  assert.deepStrictEqual(ev.models.map((m) => m.id), ['acp-x', 'acp-y']);
  assert.strictEqual(ev.source, 'acp');
  assert.strictEqual(ev.stale, false);

  const cached = await waitFor(() => {
    const entry = c.cache.get(c.key);
    return entry && entry.models.some((m) => m.id === 'acp-x') ? entry : null;
  }, 3000, 'acp 目录写盘');
  assert.strictEqual(cached.source, 'first-advertised');
  assert.strictEqual(cached.defaultModel, 'acp-x');
}

// ---------- 3. 刷新失败保留旧缓存 + 事件 warning/error ----------
async function test3_RefreshFailureKeepsCache() {
  const c = newCase();
  resetMemory();
  seedCache(c, ['old-a', 'old-b'], { ts: Date.now() - 11 * 60 * 1000 });
  const sink = makeSink();
  installHooks(c, {
    cli: async () => { throw new Error('CLI 不应在缓存命中时执行'); },
    inspect: async () => {
      const err = new Error('ACP 探测炸了');
      err.code = 'ACP_MODEL_CATALOG_EMPTY';
      throw err;
    }
  });

  const r = await service.aiModelsImpl(sink.ev, {});
  assert.strictEqual(r.source, 'cache');
  assert.strictEqual(r.stale, true, '11 分钟前的缓存应标记 stale');
  assert.strictEqual(r.refreshing, true);
  assert.strictEqual(r.catalogWarning, 'catalog-stale');
  assert.deepStrictEqual(r.groups[0].models.map((m) => m.id), ['old-a', 'old-b']);
  assert.strictEqual(r.default, 'old-a');

  const ev = await waitFor(() => sink.ofType('acp_catalog')[0], 3000, '失败事件');
  assert.strictEqual(ev.type, 'acp_catalog');
  assert.strictEqual(ev.stale, true);
  assert.strictEqual(ev.error, 'ACP_MODEL_CATALOG_EMPTY');
  assert.ok(typeof ev.warning === 'string' && ev.warning.indexOf('旧缓存') >= 0, '失败事件应说明保留旧缓存');
  assert.strictEqual(ev.agentId, 'opencode');

  const cached = c.cache.get(c.key);
  assert.ok(cached, '失败不得删除旧缓存');
  assert.deepStrictEqual(cached.models.map((m) => m.id), ['old-a', 'old-b'], '失败后旧目录应原样保留');
}

// ---------- 4. 并发刷新去重 ----------
async function test4_ConcurrentDedup() {
  const c = newCase();
  resetMemory();
  seedCache(c, ['seed-1']);
  let inspectCalls = 0;
  installHooks(c, {
    inspect: async () => {
      inspectCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { availableModelIds: ['dedupe-1'] };
    }
  });

  const s1 = makeSink();
  const s2 = makeSink();
  const [r1, r2] = await Promise.all([
    service.aiModelsImpl(s1.ev, { requestId: 'req-dedupe-1' }),
    service.aiModelsImpl(s2.ev, { requestId: 'req-dedupe-2' })
  ]);
  assert.strictEqual(r1.source, 'cache');
  assert.strictEqual(r2.source, 'cache');

  await waitFor(() => inspectCalls === 1, 3000, '刷新启动');
  await waitFor(() => s1.ofType('acp_catalog').length && s2.ofType('acp_catalog').length, 3000, '双方事件');
  assert.strictEqual(inspectCalls, 1, '同一 key 并发刷新应去重，只探测一次');
  assert.strictEqual(s1.ofType('acp_catalog')[0].requestId, 'req-dedupe-1');
  assert.strictEqual(s2.ofType('acp_catalog')[0].requestId, 'req-dedupe-2');
}

// ---------- 5. 默认模型不泄漏 deepseek-chat ----------
async function test5_NoDeepseekLeak() {
  const c = newCase();
  resetMemory();
  fakeCfg.model = 'deepseek-chat';
  try {
    installHooks(c, {
      cli: async () => [{ id: 'cli-x', label: 'cli-x' }],
      inspect: async () => ({ availableModelIds: ['acp-y'] })
    });
    const sink = makeSink();
    const r = await service.aiModelsImpl(sink.ev, {});
    assert.strictEqual(r.source, 'cli');
    assert.strictEqual(r.default, 'cli-x', '默认应来自 CLI 真实列表');
    assert.notStrictEqual(r.default, 'deepseek-chat', '不得把全局 API 模型当 ACP 默认');
    assert.ok(r.groups[0].models.some((m) => m.id === r.default), '默认必须在返回列表内');
    await waitFor(() => sink.ofType('acp_catalog').length, 3000, '刷新事件');

    const c2 = newCase();
    resetMemory();
    installHooks(c2, {
      cli: async () => [],
      inspect: async () => ({ availableModelIds: ['acp-z'] })
    });
    const sink2 = makeSink();
    const r2 = await service.aiModelsImpl(sink2.ev, {});
    const fallbackIds = (ACP_MODEL_FALLBACKS.opencode || []).map((id) => String(id));
    assert.strictEqual(r2.source, 'fallback', 'CLI 不可用应显性返回 fallback');
    assert.notStrictEqual(r2.default, 'deepseek-chat');
    assert.strictEqual(r2.default, fallbackIds[0], '默认应为 ACP fallback 首项');
    assert.deepStrictEqual(r2.groups[0].models.map((m) => m.id), fallbackIds);
    assert.strictEqual(r2.catalogWarning, 'catalog-fallback');
    await waitFor(() => sink2.ofType('acp_catalog').length, 3000, '刷新事件');
  } finally {
    fakeCfg.model = '';
  }
}

// ---------- 6. visibleModels 交集 + 事件同样过滤 ----------
async function test6_VisibleModelsIntersection() {
  const c = newCase();
  resetMemory();
  seedCache(c, ['vis-a', 'vis-b']);
  fakeCfg.visibleModelsCli = { opencode: ['vis-b'] };
  try {
    installHooks(c, {
      inspect: async () => ({ availableModelIds: ['vis-a', 'vis-b', 'vis-c'] })
    });
    const sink = makeSink();
    const r = await service.aiModelsImpl(sink.ev, {});
    assert.deepStrictEqual(r.visibleModels, ['vis-b']);
    assert.deepStrictEqual(r.groups[0].models.map((m) => m.id), ['vis-b'], '返回列表应按白名单取交集');
    assert.strictEqual(r.default, 'vis-b');
    assert.strictEqual(r.warning, null);

    const ev = await waitFor(() => sink.ofType('acp_catalog')[0], 3000, '刷新事件');
    assert.deepStrictEqual(ev.models.map((m) => m.id), ['vis-b'], '后台事件也应尊重白名单');
    assert.strictEqual(ev.defaultModel, 'vis-b');
  } finally {
    fakeCfg.visibleModelsCli = {};
  }
}

// ---------- 7. CLI 版本变化：旧缓存标记 stale 并由刷新覆盖 ----------
async function test7_CliVersionInvalidates() {
  const c = newCase();
  resetMemory();
  seedCache(c, ['v1-a'], { cliVersion: '1.0.0' });
  installHooks(c, {
    inspect: async () => ({ availableModelIds: ['v2-a', 'v2-b'] }),
    cli: async () => { throw new Error('缓存命中不应跑 CLI'); }
  });
  const sink = makeSink();
  const r = await service.aiModelsImpl(sink.ev, { cliVersion: '2.0.0' });
  assert.strictEqual(r.source, 'cache');
  assert.strictEqual(r.stale, true, 'CLI 版本变化应让旧目录立即 stale');
  assert.strictEqual(r.catalogWarning, 'catalog-stale');

  const ev = await waitFor(() => sink.ofType('acp_catalog')[0], 3000, '刷新事件');
  assert.deepStrictEqual(ev.models.map((m) => m.id), ['v2-a', 'v2-b']);
  const cached = await waitFor(() => {
    const entry = c.cache.get(c.key);
    return entry && entry.cliVersion === '2.0.0' ? entry : null;
  }, 3000, '新版本写盘');
  assert.deepStrictEqual(cached.models.map((m) => m.id), ['v2-a', 'v2-b']);
}

async function main() {
  const tests = [
    ['1 有缓存立即返回 + 后台刷新事件', test1_CacheFirst],
    ['2 无缓存 CLI 优先 + 后台 ACP 刷新', test2_CliFirst],
    ['3 刷新失败保留旧缓存', test3_RefreshFailureKeepsCache],
    ['4 并发刷新去重', test4_ConcurrentDedup],
    ['5 默认模型不泄漏 deepseek-chat', test5_NoDeepseekLeak],
    ['6 visibleModels 交集 + 事件过滤', test6_VisibleModelsIntersection],
    ['7 CLI 版本变化失效旧缓存', test7_CliVersionInvalidates]
  ];
  let passed = 0;
  let failed = 0;
  try {
    for (const [title, fn] of tests) {
      try {
        await fn();
        console.log('[PASS] ' + title);
        passed += 1;
      } catch (err) {
        console.error('[FAIL] ' + title);
        console.error((err && err.stack) || err);
        failed += 1;
      }
    }
  } finally {
    try { service.__setAcpModelsTestHooks({}); } catch (e) {}
    try { shared.cliModelsCache.clear(); } catch (e) {}
    aiConfigStore.loadAiConfigFull = originalLoadAiConfigFull;
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('SUMMARY passed=' + passed + ' failed=' + failed);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
