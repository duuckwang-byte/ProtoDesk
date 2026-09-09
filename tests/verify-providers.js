'use strict';
// Iteration 3 providers 自动化验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖方案 3.4 节 4 项断言，win32 下全绿。
const assert = require('node:assert');
const http = require('node:http');

const { normalizeProviderBaseUrl } = require('../providers/protocols');
const { testProviderConnection } = require('../providers/connection-test');
const { fetchProviderModels } = require('../providers/model-fetcher');
const {
  BYOK_OPENCODE_API_KEY_ENV,
  buildOpenCodeByokProviderConfig,
} = require('../runtimes/byok-opencode');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

// ---------- 断言1：BaseURL 规范化 ----------
async function test1_NormalizeBaseUrl() {
  const a = normalizeProviderBaseUrl('anthropic', 'https://api.anthropic.com');
  assert.strictEqual(
    a,
    'https://api.anthropic.com/v1',
    `anthropic 规范化应==='https://api.anthropic.com/v1'，实际 ${a}`
  );

  const g = normalizeProviderBaseUrl('google', 'https://generativelanguage.googleapis.com');
  assert.ok(
    g.endsWith('/v1beta'),
    `google 规范化应以 /v1beta 结尾，实际 ${g}`
  );

  const o = normalizeProviderBaseUrl('ollama', 'http://localhost:11434');
  assert.strictEqual(
    o,
    'http://localhost:11434/v1',
    `ollama 规范化应==='http://localhost:11434/v1'，实际 ${o}`
  );

  const openai = normalizeProviderBaseUrl('openai', 'https://api.openai.com///');
  assert.ok(
    openai.includes('/v1'),
    `openai 规范化应含 /v1，实际 ${openai}`
  );
  assert.ok(
    !openai.endsWith('///') && !openai.endsWith('/'),
    `openai 规范化应去尾斜杠，实际 ${openai}`
  );
}

// ---------- 断言2：BYOK 配置编译器 ----------
async function test2_ByokConfigCompiler() {
  const ret = buildOpenCodeByokProviderConfig(
    { protocol: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com' },
    'gpt-4o'
  );
  assert.ok(ret, 'BYOK 编译器应返回非空对象');
  assert.strictEqual(
    ret.modelId,
    'pland-byok/gpt-4o',
    `modelId 应==='pland-byok/gpt-4o'，实际 ${ret.modelId}`
  );

  const json = JSON.stringify(ret.config);
  assert.ok(
    json.includes('@ai-sdk/openai'),
    `config JSON 应含 '@ai-sdk/openai'，实际 ${json.slice(0, 500)}`
  );
  assert.ok(
    json.includes('PLAND_BYOK_API_KEY'),
    `config JSON 应含 'PLAND_BYOK_API_KEY'，实际 ${json.slice(0, 500)}`
  );

  // env 含 Key（明文存 env），options 字符串不含明文
  assert.ok(ret.env, 'ret.env 应非空');
  const envJson = JSON.stringify(ret.env);
  assert.ok(
    envJson.includes('sk-test'),
    `env 应含明文 Key，实际 ${envJson}`
  );
  assert.ok(
    ret.env[BYOK_OPENCODE_API_KEY_ENV] === 'sk-test',
    `env[${BYOK_OPENCODE_API_KEY_ENV}] 应==='sk-test'，实际 ${JSON.stringify(ret.env)}`
  );
  // options 即 config 内 provider options 部分不应泄露明文
  assert.ok(
    !json.includes('sk-test'),
    `options/config JSON 不应含明文 sk-test，实际 ${json.slice(0, 800)}`
  );

  // 缺 Key 返回 null
  const noKey = buildOpenCodeByokProviderConfig(
    { protocol: 'openai', apiKey: '', baseUrl: 'https://api.openai.com' },
    'gpt-4o'
  );
  assert.strictEqual(noKey, null, `缺 Key 应返回 null，实际 ${JSON.stringify(noKey)}`);

  const noKey2 = buildOpenCodeByokProviderConfig(
    { protocol: 'openai', baseUrl: 'https://api.openai.com' },
    'gpt-4o'
  );
  assert.strictEqual(noKey2, null, `缺 Key（undefined）应返回 null，实际 ${JSON.stringify(noKey2)}`);

  // model 为 default 返回 null
  const defModel = buildOpenCodeByokProviderConfig(
    { protocol: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com' },
    'default'
  );
  assert.strictEqual(defModel, null, `model=default 应返回 null，实际 ${JSON.stringify(defModel)}`);
}

// ---------- 断言3：连通性诊断分类（本地 http 模拟，不联网） ----------
function startClassifyServer() {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    // 兼容 normalize 补 /v1：target 会是 <prefix>/v1/models，prefix 决定分类
    if (url.includes('/slow')) {
      // 超时端点：delay 600ms，配合客户端 timeoutMs=150 触发 Abort
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
    // 兜底：未知路径返回 404，便于排查
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'unknown prefix: ' + url } }));
  });
  return server;
}

async function test3_ConnectionClassify() {
  const server = startClassifyServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    // baseUrl 带完整 /v1 路径，normalize 后不变，拼接 /models 仍命中 prefix 路由
    const base = (p) => `http://127.0.0.1:${port}/${p}/v1`;

    const rSuccess = await testProviderConnection({
      protocol: 'openai',
      apiKey: 'sk-test',
      baseUrl: base('success'),
      timeoutMs: 5000,
    });
    assert.strictEqual(rSuccess.kind, 'success', `success 端点 kind 应==='success'，实际 ${JSON.stringify(rSuccess)}`);
    assert.strictEqual(rSuccess.success, true, `success 端点 success 应===true，实际 ${JSON.stringify(rSuccess)}`);

    const rAuth = await testProviderConnection({
      protocol: 'openai',
      apiKey: 'bad-key',
      baseUrl: base('unauth'),
      timeoutMs: 5000,
    });
    assert.strictEqual(rAuth.kind, 'auth_failed', `401 端点 kind 应==='auth_failed'，实际 ${JSON.stringify(rAuth)}`);

    const r404 = await testProviderConnection({
      protocol: 'openai',
      apiKey: 'sk-test',
      baseUrl: base('missing'),
      timeoutMs: 5000,
    });
    assert.strictEqual(r404.kind, 'invalid_base_url', `404 端点 kind 应==='invalid_base_url'，实际 ${JSON.stringify(r404)}`);

    const r429 = await testProviderConnection({
      protocol: 'openai',
      apiKey: 'sk-test',
      baseUrl: base('limited'),
      timeoutMs: 5000,
    });
    assert.strictEqual(r429.kind, 'rate_limited', `429 端点 kind 应==='rate_limited'，实际 ${JSON.stringify(r429)}`);

    const rTimeout = await testProviderConnection({
      protocol: 'openai',
      apiKey: 'sk-test',
      baseUrl: base('slow'),
      timeoutMs: 150,
    });
    assert.strictEqual(rTimeout.kind, 'timeout', `超时端点 kind 应==='timeout'，实际 ${JSON.stringify(rTimeout)}`);
    assert.strictEqual(rTimeout.success, false, `超时端点 success 应===false，实际 ${JSON.stringify(rTimeout)}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------- 断言4：模型拉取与降级 ----------
function startModelServer(mode) {
  // mode: 'ok' 返回混合列表；'err' 返回 500
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (!url.includes('/models')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (mode === 'err') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'inner' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4o' },
          { id: 'dall-e-3' },
          { id: 'whisper-1' },
          { id: 'my-model' },
        ],
      })
    );
  });
  return server;
}

async function listenOnLocalhost(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function test4_ModelFetchFallback() {
  // 4a. 去重 + 过滤
  {
    const server = startModelServer('ok');
    const port = await listenOnLocalhost(server);
    try {
      const models = await fetchProviderModels({
        protocol: 'openai',
        apiKey: 'sk-test',
        baseUrl: `http://127.0.0.1:${port}/ok/v1`,
        timeoutMs: 5000,
      });
      assert.ok(Array.isArray(models), `模型拉取应返回数组，实际 ${typeof models}`);
      const ids = models.map((m) => m.id);
      assert.ok(ids.includes('gpt-4o'), `应保留 gpt-4o，实际 ${JSON.stringify(ids)}`);
      assert.ok(ids.includes('my-model'), `应保留 my-model，实际 ${JSON.stringify(ids)}`);
      assert.ok(!ids.some((id) => /dall-e/i.test(id)), `应过滤 dall-e，实际 ${JSON.stringify(ids)}`);
      assert.ok(!ids.some((id) => /whisper/i.test(id)), `应过滤 whisper，实际 ${JSON.stringify(ids)}`);
      assert.strictEqual(
        ids.filter((id) => id === 'gpt-4o').length,
        1,
        `gpt-4o 应去重只剩1个，实际 ${JSON.stringify(ids)}`
      );
      assert.strictEqual(ids.length, 2, `过滤去重后应剩2个 [gpt-4o, my-model]，实际 ${JSON.stringify(ids)}`);
    } finally {
      await closeServer(server);
    }
  }

  // 4b. 500 降级：返回 fallback 非空且不抛错
  {
    const server = startModelServer('err');
    const port = await listenOnLocalhost(server);
    try {
      let models = null;
      let threw = null;
      try {
        models = await fetchProviderModels({
          protocol: 'openai',
          apiKey: 'sk-test',
          baseUrl: `http://127.0.0.1:${port}/err/v1`,
          timeoutMs: 5000,
        });
      } catch (e) {
        threw = e;
      }
      assert.strictEqual(threw, null, `500 时不应抛错，实际抛错 ${threw && threw.stack}`);
      assert.ok(Array.isArray(models) && models.length > 0, `500 时应返回 fallback 非空数组，实际 ${JSON.stringify(models)}`);
    } finally {
      await closeServer(server);
    }
  }

  // 4c. 断网降级：连不存在端口，返回 fallback 非空且不抛错
  {
    // 取一个大概率未被占用的端口：先起一个 server 拿端口再关闭
    const tmp = http.createServer(() => {});
    const deadPort = await listenOnLocalhost(tmp);
    await closeServer(tmp);
    let models = null;
    let threw = null;
    try {
      models = await fetchProviderModels({
        protocol: 'openai',
        apiKey: 'sk-test',
        baseUrl: `http://127.0.0.1:${deadPort}/dead/v1`,
        timeoutMs: 2000,
      });
    } catch (e) {
      threw = e;
    }
    assert.strictEqual(threw, null, `断网时不应抛错，实际抛错 ${threw && threw.stack}`);
    assert.ok(Array.isArray(models) && models.length > 0, `断网时应返回 fallback 非空数组，实际 ${JSON.stringify(models)}`);
  }

  // 4d. anthropic 直接返回 fallback
  {
    let models = null;
    let threw = null;
    try {
      models = await fetchProviderModels({
        protocol: 'anthropic',
        apiKey: 'sk-test',
        baseUrl: 'https://api.anthropic.com',
        timeoutMs: 2000,
      });
    } catch (e) {
      threw = e;
    }
    assert.strictEqual(threw, null, `anthropic 不应抛错，实际抛错 ${threw && threw.stack}`);
    assert.ok(Array.isArray(models) && models.length > 0, `anthropic 应返回 fallback 非空数组，实际 ${JSON.stringify(models)}`);
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

  await run('断言1 BaseURL规范化', test1_NormalizeBaseUrl);
  await run('断言2 BYOK配置编译器', test2_ByokConfigCompiler);
  await run('断言3 连通性诊断分类', test3_ConnectionClassify);
  await run('断言4 模型拉取与降级', test4_ModelFetchFallback);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
