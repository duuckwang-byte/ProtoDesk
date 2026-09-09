'use strict';
// Iteration 4 IPC 统一链路自动化验证（纯 Node/CommonJS，不启动 Electron，用 Mock 验证新链路）
// 覆盖方案 4.4 节 4 项断言，win32 下全绿。只新增本文件，不改 main.js/runtimes/providers 实现。
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');

const { detectAllAgents } = require('../runtimes/detection');
const { resolveAgentExecutable } = require('../runtimes/resolution');
const { getAgentDef } = require('../runtimes/registry');
const { startAgentExecution } = require('../runtimes/engine');
const { buildOpenCodeByokProviderConfig } = require('../runtimes/byok-opencode');
const { testProviderConnection } = require('../providers/connection-test');
const { fetchProviderModels } = require('../providers/model-fetcher');
const { killProcessTree } = require('../platform/process');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

// ---------- 断言1 ai:check 并发探测格式兼容 ----------
async function test1_CheckDetect() {
  const t0 = Date.now();
  const results = await detectAllAgents({});
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 5000, `detectAllAgents({}) 耗时应<5000ms，实际 ${elapsed}ms`);
  assert.ok(Array.isArray(results), 'detectAllAgents 应返回数组');
  assert.ok(
    results.length >= 4,
    `返回数组长度应>=4（兼容===4），实际 ${results.length}`
  );
  for (const r of results) {
    for (const k of ['id', 'name', 'available', 'path', 'version']) {
      assert.ok(k in r, `每条结果应含字段 ${k}，实际 ${JSON.stringify(r)}`);
    }
    assert.strictEqual(typeof r.id, 'string', 'id 应为 string');
    assert.strictEqual(typeof r.name, 'string', 'name 应为 string');
    assert.strictEqual(typeof r.available, 'boolean', 'available 应为 boolean');
  }

  // 假 bin 验证：返回 null 且不拖垮整体
  const t1 = Date.now();
  const fakeResolved = await resolveAgentExecutable(
    { bin: '__definitely_not_exist_xyz__', fallbackBins: [] },
    undefined
  );
  const fakeElapsed = Date.now() - t1;
  assert.strictEqual(fakeResolved, null, `假 bin 应 resolve 为 null，实际 ${fakeResolved}`);
  assert.ok(fakeElapsed < 5000, `假 bin 解析耗时应<5000ms，实际 ${fakeElapsed}ms`);

  // 整体仍按时返回（不受假 bin 影响）
  const t2 = Date.now();
  const results2 = await detectAllAgents({});
  const elapsed2 = Date.now() - t2;
  assert.ok(elapsed2 < 5000, `二次 detectAllAgents 耗时应<5000ms，实际 ${elapsed2}ms`);
  assert.ok(Array.isArray(results2) && results2.length >= 4, '二次探测仍应返回>=4条');
}

// ---------- 断言2 ai:test-connection 诊断精准 ----------
function startClassifyServer() {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url.includes('/slow')) {
      setTimeout(() => {
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
        } catch (_) {}
      }, 600);
      return;
    }
    if (url.includes('/success')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (url.includes('/unauth')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid key' } }));
      return;
    }
    if (url.includes('/missing')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    if (url.includes('/limited')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'unknown prefix: ' + url } }));
  });
  return server;
}

async function test2_TestConnection() {
  const server = startClassifyServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    const base = (p) => `http://127.0.0.1:${port}/${p}/v1`;

    const rSuccess = await testProviderConnection({
      protocol: 'openai', apiKey: 'sk-test', baseUrl: base('success'), timeoutMs: 5000,
    });
    assert.strictEqual(rSuccess.kind, 'success', `200 端点 kind 应==='success'，实际 ${JSON.stringify(rSuccess)}`);

    const rAuth = await testProviderConnection({
      protocol: 'openai', apiKey: 'bad-key', baseUrl: base('unauth'), timeoutMs: 5000,
    });
    assert.strictEqual(rAuth.kind, 'auth_failed', `401 端点 kind 应==='auth_failed'，实际 ${JSON.stringify(rAuth)}`);

    const r404 = await testProviderConnection({
      protocol: 'openai', apiKey: 'sk-test', baseUrl: base('missing'), timeoutMs: 5000,
    });
    assert.strictEqual(r404.kind, 'invalid_base_url', `404 端点 kind 应==='invalid_base_url'，实际 ${JSON.stringify(r404)}`);

    const r429 = await testProviderConnection({
      protocol: 'openai', apiKey: 'sk-test', baseUrl: base('limited'), timeoutMs: 5000,
    });
    assert.strictEqual(r429.kind, 'rate_limited', `429 端点 kind 应==='rate_limited'，实际 ${JSON.stringify(r429)}`);

    const rTimeout = await testProviderConnection({
      protocol: 'openai', apiKey: 'sk-test', baseUrl: base('slow'), timeoutMs: 150,
    });
    assert.strictEqual(rTimeout.kind, 'timeout', `超时端点 kind 应==='timeout'，实际 ${JSON.stringify(rTimeout)}`);
    assert.strictEqual(rTimeout.success, false, `超时端点 success 应===false，实际 ${JSON.stringify(rTimeout)}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------- 断言3 ai:models 分流与 Fallback ----------
function startModelServer() {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (!url.includes('/models')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: 'gpt-4o' },
        { id: 'gpt-4o' },
        { id: 'dall-e-3' },
        { id: 'whisper-1' },
        { id: 'my-model' },
      ],
    }));
  });
  return server;
}

async function test3_ModelsSplitFallback() {
  // CLI 模式：opencode fallbackModels 非空且有 default 项
  const def = getAgentDef('opencode');
  assert.ok(def, "getAgentDef('opencode') 应非空");
  assert.ok(Array.isArray(def.fallbackModels) && def.fallbackModels.length > 0, `opencode.fallbackModels 应非空，实际 ${JSON.stringify(def.fallbackModels)}`);
  const hasDefault = def.fallbackModels.some((m) => m && m.default);
  assert.ok(hasDefault, `opencode.fallbackModels 应有 default 项，实际 ${JSON.stringify(def.fallbackModels)}`);

  // API 模式：本地模拟 OpenAI {data:[...]} 去重过滤
  {
    const server = startModelServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    try {
      const models = await fetchProviderModels({
        protocol: 'openai', apiKey: 'sk-test',
        baseUrl: `http://127.0.0.1:${port}/ok/v1`, timeoutMs: 5000,
      });
      assert.ok(Array.isArray(models), `模型拉取应返回数组，实际 ${typeof models}`);
      const ids = models.map((m) => m.id);
      assert.ok(ids.includes('gpt-4o'), `应保留 gpt-4o，实际 ${JSON.stringify(ids)}`);
      assert.ok(ids.includes('my-model'), `应保留 my-model，实际 ${JSON.stringify(ids)}`);
      assert.ok(!ids.some((id) => /dall-e/i.test(id)), `应过滤 dall-e，实际 ${JSON.stringify(ids)}`);
      assert.ok(!ids.some((id) => /whisper/i.test(id)), `应过滤 whisper，实际 ${JSON.stringify(ids)}`);
      assert.strictEqual(ids.filter((id) => id === 'gpt-4o').length, 1, `gpt-4o 应去重只剩1个，实际 ${JSON.stringify(ids)}`);
      assert.strictEqual(ids.length, 2, `过滤去重后应剩2个 [gpt-4o, my-model]，实际 ${JSON.stringify(ids)}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // API 模式：不可达端口返回 fallback 非空不抛错
  {
    const tmp = http.createServer(() => {});
    await new Promise((resolve, reject) => {
      tmp.once('error', reject);
      tmp.listen(0, '127.0.0.1', resolve);
    });
    const deadPort = tmp.address().port;
    await new Promise((resolve) => tmp.close(resolve));
    let models = null;
    let threw = null;
    try {
      models = await fetchProviderModels({
        protocol: 'openai', apiKey: 'sk-test',
        baseUrl: `http://127.0.0.1:${deadPort}/dead/v1`, timeoutMs: 2000,
      });
    } catch (e) {
      threw = e;
    }
    assert.strictEqual(threw, null, `不可达端口不应抛错，实际抛错 ${threw && threw.stack}`);
    assert.ok(Array.isArray(models) && models.length > 0, `不可达端口应返回 fallback 非空数组，实际 ${JSON.stringify(models)}`);
  }
}

// ---------- 断言4 ai:ask 流式分发与 Cancel 整树终止（核心） ----------
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false;
    if (e && e.code === 'EPERM') return true;
    return false;
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function test4_AskStreamAndCancel() {
  // 4a. 流式分发：20KB 回声经 engine + plain 解析器
  {
    const fakeDef = {
      id: 'echo-test',
      name: 'Echo Test',
      bin: 'node',
      streamFormat: 'plain',
      promptViaStdin: true,
      buildArgs: () => ['-e', 'process.stdin.pipe(process.stdout)'],
    };
    const prompt = 'P'.repeat(20 * 1024);
    assert.ok(prompt.length >= 20 * 1024, `prompt 长度应>=20KB，实际 ${prompt.length}`);

    let thinkingCollected = '';
    let chunkCollected = '';
    let closeInfo = null;
    let handle = null;

    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        try { if (handle) await handle.cancel(); } catch (_) {}
        reject(new Error('20KB回声10秒超时未close（已cancel兜底）'));
      }, 10000);
      try {
        handle = startAgentExecution({
          def: fakeDef,
          resolvedBin: process.execPath,
          prompt,
          cwd: os.tmpdir(),
          options: {},
          handlers: {
            onThinking: (e) => {
              const t = e && typeof e.text === 'string' ? e.text : String((e && e.text) || e || '');
              thinkingCollected += t;
            },
            onChunk: (e) => {
              const t = e && typeof e.text === 'string' ? e.text : String((e && e.text) || e || '');
              chunkCollected += t;
            },
            onToolCall: () => {},
            onSession: () => {},
            onError: (err) => {
              clearTimeout(timer);
              reject(new Error('20KB回声不应onError: ' + JSON.stringify(err && err.message ? err.message : String(err))));
            },
            onClose: (info) => {
              closeInfo = info;
              clearTimeout(timer);
              resolve(info);
            },
          },
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });

    try {
      await done;
    } catch (e) {
      try { if (handle) await handle.cancel(); } catch (_) {}
      throw e;
    }

    const total = thinkingCollected.length + chunkCollected.length;
    assert.ok(closeInfo, '应收到 onClose 回调');
    assert.ok(total >= 20 * 1024, `收到内容应>=20KB（thinking+chunk），实际 thinking=${thinkingCollected.length} chunk=${chunkCollected.length} total=${total}`);
    assert.strictEqual(closeInfo.cancelled, false, `onClose.cancelled 应为 false，实际 ${JSON.stringify(closeInfo)}`);
  }

  // 4b. BYOK 分支输入合法性
  {
    const ret = buildOpenCodeByokProviderConfig(
      { protocol: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com' },
      'gpt-4o'
    );
    assert.ok(ret, 'BYOK 编译器应返回非空对象');
    assert.strictEqual(ret.modelId, 'pland-byok/gpt-4o', `modelId 应==='pland-byok/gpt-4o'，实际 ${ret.modelId}`);
    assert.ok(ret.env, 'ret.env 应非空');
    assert.ok('OPENCODE_CONFIG_CONTENT' in ret.env, `env 应含 OPENCODE_CONFIG_CONTENT，实际 ${JSON.stringify(Object.keys(ret.env))}`);
    assert.ok('PLAND_BYOK_API_KEY' in ret.env, `env 应含 PLAND_BYOK_API_KEY，实际 ${JSON.stringify(Object.keys(ret.env))}`);
    // 真正断言如下：
    assert.strictEqual(ret.env.PLAND_BYOK_API_KEY, 'sk-test', `env.PLAND_BYOK_API_KEY 应==='sk-test'，实际 ${JSON.stringify(ret.env)}`);
    const json = JSON.stringify(ret.config);
    assert.ok(json.includes('@ai-sdk/openai'), `config JSON 应含 '@ai-sdk/openai'，实际 ${json.slice(0, 500)}`);
  }

  // 4c. Cancel 整树终止：常驻 fake 任务经 engine 启动，cancel()+killProcessTree 后 2s 内消失
  {
    const hangDef = {
      id: 'hang-test',
      name: 'Hang Test',
      bin: 'node',
      streamFormat: 'plain',
      promptViaStdin: true,
      buildArgs: () => ['-e', 'setInterval(()=>{},1000)'],
    };
    let closed = null;
    const handle = startAgentExecution({
      def: hangDef,
      resolvedBin: process.execPath,
      prompt: 'hi',
      cwd: os.tmpdir(),
      options: {},
      handlers: {
        onThinking: () => {},
        onChunk: () => {},
        onToolCall: () => {},
        onSession: () => {},
        onError: () => {},
        onClose: (info) => { closed = info; },
      },
    });
    const pid = handle && handle.pid;
    assert.ok(typeof pid === 'number' && pid > 0, `常驻任务 pid 应为正整数，实际 ${pid}`);
    await sleep(300);
    assert.ok(isAlive(pid), `cancel 前进程应存活 pid=${pid}`);

    // 模拟 main.js ai:cancel：先 cancel() 再 killProcessTree 兜底
    try { await handle.cancel(); } catch (_) {}
    try { await killProcessTree(pid); } catch (_) {}

    const deadline = Date.now() + 2000;
    let dead = !isAlive(pid);
    while (!dead && Date.now() < deadline) {
      await sleep(50);
      dead = !isAlive(pid);
    }
    assert.ok(dead, `cancel 后 2s 内进程应消失 pid=${pid} alive=${isAlive(pid)} closed=${JSON.stringify(closed)}`);
  }
}

async function main() {
  let passed = 0;
  let failed = 0;
  async function run(name, fn) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${name}`);
      console.log((e && e.stack) || String(e));
    }
  }

  await run('断言1 ai:check并发探测格式兼容', test1_CheckDetect);
  await run('断言2 ai:test-connection诊断精准', test2_TestConnection);
  await run('断言3 ai:models分流与Fallback', test3_ModelsSplitFallback);
  await run('断言4 ai:ask流式分发与Cancel整树终止', test4_AskStreamAndCancel);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
