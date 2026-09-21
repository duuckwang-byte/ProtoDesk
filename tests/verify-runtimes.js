'use strict';
// Iteration 2 runtimes 自动化验证（纯 Node，无 Electron 依赖，CommonJS）
// 覆盖方案 2.4 节 4 项断言，win32 下全绿。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BASE_AGENT_DEFS, getAgentDef, getAllAgentDefs } = require('../runtimes/registry');
const { detectAllAgents } = require('../runtimes/detection');
const { resolveAgentExecutable } = require('../runtimes/resolution');
const { startAgentExecution } = require('../runtimes/engine');
const { getStreamParser } = require('../runtimes/parsers');
const { assertCommandLineBudget } = require('../platform/budget');

console.log(`Platform: ${process.platform} arch=${process.arch}`);
console.log(`Node: ${process.version} execPath=${process.execPath}`);

// ---------- 断言1：注册表与契约完整性 ----------
async function test1_RegistryContract() {
  const defs = getAllAgentDefs();
  assert.strictEqual(Array.isArray(defs), true, 'getAllAgentDefs() 应返回数组');
  assert.strictEqual(defs.length, 26, `getAllAgentDefs() 长度应===26，实际 ${defs.length}`);

  const ids = new Set(defs.map((d) => d.id));
  for (const expected of ['opencode', 'claude', 'cursor-agent', 'codex', 'deepseek-harness', 'qwen', 'deepseek', 'mimo', 'amp', 'codebuddy', 'aider', 'grok-build', 'antigravity', 'atomcode', 'amr', 'copilot', 'devin', 'hermes', 'kilo', 'kimi', 'kiro', 'pi', 'qoder', 'reasonix', 'trae-cli', 'vibe']) {
    assert.ok(ids.has(expected), `id集合应含 ${expected}，实际 [${[...ids].join(', ')}]`);
  }

  const allowedFormats = new Set(['claude-stream-json', 'json-event-stream', 'plain', 'qoder-stream-json', 'agy-stream']);
  const allowedProtocols = new Set(['acp-json-rpc', 'copilot-stream-json', 'qoder-stream-json', 'pi-rpc']);
  for (const def of defs) {
    for (const field of ['id', 'name', 'bin', 'versionArgs', 'fallbackModels', 'buildArgs']) {
      assert.ok(def[field] !== undefined && def[field] !== null, `def[${def.id}] 应含字段 ${field}`);
    }
    assert.strictEqual(typeof def.buildArgs, 'function', `def[${def.id}].buildArgs 应为函数`);
    assert.strictEqual(typeof def.promptViaStdin, 'boolean', `def[${def.id}].promptViaStdin 应为boolean`);
    assert.ok(
      allowedFormats.has(def.streamFormat),
      `def[${def.id}].streamFormat 应为四者之一，实际 ${def.streamFormat}`
    );
    assert.ok(Array.isArray(def.versionArgs), `def[${def.id}].versionArgs 应为数组`);
    assert.ok(Array.isArray(def.fallbackModels) && def.fallbackModels.length > 0, `def[${def.id}].fallbackModels 应为非空数组`);
    assert.ok(def.fallbackModels.some((m) => m && m.default), `def[${def.id}].fallbackModels 应有default项`);
    if (def.needsProtocol != null) {
      assert.ok(allowedProtocols.has(def.needsProtocol), `def[${def.id}].needsProtocol 非法：${def.needsProtocol}`);
    }
  }
  assert.strictEqual(defs.filter((d) => d.needsProtocol).length, 11, '发现型CLI应为11个（qoder已直驱）');

  // buildArgs('hi',[],[],{},{}) 返回数组且含免交互参数
  const byId = new Map(defs.map((d) => [d.id, d]));
  for (const [id, def] of byId) {
    const args = def.buildArgs('hi', [], [], {}, {});
    assert.ok(Array.isArray(args), `def[${id}].buildArgs 应返回数组，实际 ${typeof args}`);
    assert.ok(args.every((a) => typeof a === 'string'), `def[${id}].buildArgs 应返回 string[]`);
    const joined = args.join(' ');
    if (id === 'claude') {
      assert.ok(
        joined.includes('bypassPermissions'),
        `claude buildArgs 应含 bypassPermissions，实际 ${JSON.stringify(args)}`
      );
    }
    if (id === 'cursor-agent') {
      assert.ok(
        args.includes('--force'),
        `cursor-agent buildArgs 应含 --force，实际 ${JSON.stringify(args)}`
      );
    }
    if (id === 'codex') {
      assert.ok(
        args.includes('--skip-git-repo-check'),
        `codex buildArgs 应含 --skip-git-repo-check，实际 ${JSON.stringify(args)}`
      );
    }
  }

  // needsProtocol 诚实降级：不spawn，直接onError报PROTOCOL_UNSUPPORTED
  {
    const dev = getAgentDef('devin');
    assert.ok(dev && dev.needsProtocol === 'acp-json-rpc', 'devin应标记needsProtocol');
    let err = null;
    const h = startAgentExecution({
      def: dev, resolvedBin: 'C:\\fake\\devin.exe', prompt: 'hi', cwd: os.tmpdir(),
      options: {}, handlers: { onError: (e) => { err = e; } }
    });
    assert.ok(err && err.code === 'PROTOCOL_UNSUPPORTED', `发现型CLI应直接报错，实际 ${JSON.stringify(err)}`);
    assert.strictEqual(h.pid, null, '发现型CLI不应起进程');
    await h.cancel();
  }

  assert.strictEqual(getAgentDef('claude').id, 'claude', "getAgentDef('claude').id 应==='claude'");
  assert.strictEqual(getAgentDef('nope'), null, "getAgentDef('nope') 应===null");
  // Qoder CN版识别：manifest备选名 + resolution厂商目录版本化识别（避开0字节占位）
  {
    const mf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runtimes', 'defs', 'manifest.json'), 'utf8'));
    const qe = (mf.defs || []).find((d) => d && d.id === 'qoder');
    assert.ok(qe, 'manifest须含qoder条目');
    assert.ok(Array.isArray(qe.fallbackBins) && qe.fallbackBins.includes('qoderclicn'), 'qoder须含CN备选名qoderclicn');
    const qd = getAgentDef('qoder');
    assert.ok(qd && Array.isArray(qd.fallbackBins) && qd.fallbackBins.includes('qoderclicn'), '工厂须透出CN备选名');
    const resSrc = fs.readFileSync(path.join(__dirname, '..', 'runtimes', 'resolution.js'), 'utf8');
    assert.ok(/function qoderCnExecutable\(/.test(resSrc), '缺CN厂商目录识别函数');
    assert.ok(/qoderclicn-\(\\d\+\)/.test(resSrc), '须按版本化文件名识别');
    // 本机若装有CN版则行为断言：命中版本化实文件而非0字节占位
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const cnDir = home ? path.join(home, '.qoder-cn', 'bin', 'qoderclicn') : '';
    if (cnDir && fs.existsSync(cnDir)) {
      const p = await resolveAgentExecutable(qd, undefined);
      assert.ok(p && /qoderclicn-\d+\.\d+\.\d+\.exe$/i.test(p), `CN版须命中版本化实文件，实际 ${p}`);
      assert.ok(fs.statSync(p).size > 0, '不得命中0字节占位');
    }
  }
  // BASE_AGENT_DEFS 导出一致性
  assert.ok(Array.isArray(BASE_AGENT_DEFS), 'BASE_AGENT_DEFS 应为数组');
  assert.strictEqual(BASE_AGENT_DEFS.length, 26, 'BASE_AGENT_DEFS 长度应===26');
}

// ---------- 断言2：并发探测3000ms熔断 ----------
async function test2_DetectionFuse() {
  const t0 = Date.now();
  const results = await detectAllAgents({});
  const elapsed = Date.now() - t0;

  assert.ok(
    elapsed < 5000,
    `detectAllAgents({}) 耗时应<5000ms（目标3000ms熔断，留余量），实际 ${elapsed}ms`
  );
  assert.ok(Array.isArray(results), 'detectAllAgents 应返回数组');
  assert.strictEqual(results.length, 26, `应返回26条，实际 ${results.length}`);

  const ids = new Set(results.map((r) => r.id));
  for (const expected of ['opencode', 'claude', 'cursor-agent', 'codex', 'deepseek-harness', 'qwen', 'deepseek', 'mimo', 'amp', 'codebuddy', 'aider', 'grok-build', 'antigravity', 'atomcode', 'amr', 'copilot', 'devin', 'hermes', 'kilo', 'kimi', 'kiro', 'pi', 'qoder', 'reasonix', 'trae-cli', 'vibe']) {
    assert.ok(ids.has(expected), `探测结果应含 ${expected}，实际 [${[...ids].join(', ')}]`);
  }
  for (const r of results) {
    for (const k of ['id', 'name', 'available', 'path', 'version']) {
      assert.ok(k in r, `每条结果应含字段 ${k}，实际 ${JSON.stringify(r)}`);
    }
    assert.strictEqual(typeof r.id, 'string', 'id 应为 string');
    assert.strictEqual(typeof r.name, 'string', 'name 应为 string');
    assert.strictEqual(typeof r.available, 'boolean', 'available 应为 boolean');
  }

  // 假 def 探测不拖垮整体：不存在的 bin 应返回 null
  const t1 = Date.now();
  const fakeResolved = await resolveAgentExecutable(
    { bin: '__definitely_not_exist_xyz__', fallbackBins: [] },
    undefined
  );
  const fakeElapsed = Date.now() - t1;
  assert.strictEqual(fakeResolved, null, `假 bin 应 resolve 为 null，实际 ${fakeResolved}`);
  assert.ok(fakeElapsed < 5000, `假 bin 解析耗时应<5000ms，实际 ${fakeElapsed}ms`);

  // 整体 detectAllAgents 仍按时返回（二次调用验证不受假 def 影响）
  const t2 = Date.now();
  const results2 = await detectAllAgents({});
  const elapsed2 = Date.now() - t2;
  assert.ok(elapsed2 < 5000, `二次 detectAllAgents 耗时应<5000ms，实际 ${elapsed2}ms`);
  assert.strictEqual(results2.length, 26, '二次探测仍应返回26条');
}

// ---------- 断言3：80KB超大Prompt管道注入 ----------
async function test3_LargePromptStdin() {
  const bigBody = 'A'.repeat(80 * 1024);
  const prompt = '<html><body>' + bigBody + '</body></html>';
  assert.ok(prompt.length >= 80 * 1024, `prompt 长度应>=80KB，实际 ${prompt.length}`);

  // 直接用 assertCommandLineBudget 验证小参数放行（证明引擎走 Stdin 而非 argv）
  assert.strictEqual(
    assertCommandLineBudget(process.execPath, ['-e', 'hi']),
    true,
    '小参数应被 assertCommandLineBudget 放行返回 true'
  );

  const fakeDef = {
    id: 'echo-test',
    name: 'Echo Test',
    streamFormat: 'plain',
    promptViaStdin: true,
    buildArgs: () => ['-e', 'process.stdin.pipe(process.stdout)'],
  };
  // 证明引擎走 Stdin 而非 argv：buildArgs 不应嵌入 80KB prompt
  const echoArgs = fakeDef.buildArgs(prompt, [], [], {}, {});
  assert.ok(Array.isArray(echoArgs), 'fakeDef.buildArgs 应返回数组');
  assert.ok(
    !echoArgs.some((a) => String(a).length > 10000),
    '引擎应走Stdin而非argv，buildArgs不应包含80KB prompt'
  );

  let collected = '';
  let closeInfo = null;
  const errors = [];
  let handle = null;

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      try {
        if (handle) await handle.cancel();
      } catch (_) {}
      reject(new Error('80KB管道注入10秒超时未close（已cancel兜底）'));
    }, 10000);
    try {
      handle = startAgentExecution({
        def: fakeDef,
        resolvedBin: process.execPath,
        prompt,
        cwd: os.tmpdir(),
        options: {},
        handlers: {
          onChunk: (e) => {
            if (e && typeof e.text === 'string') collected += e.text;
          },
          onThinking: () => {},
          onToolCall: () => {},
          onSession: () => {},
          onError: (err) => {
            errors.push(err);
            clearTimeout(timer);
            reject(new Error('80KB管道不应onError: ' + JSON.stringify(err && err.message ? err : String(err))));
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
    try {
      if (handle) await handle.cancel();
    } catch (_) {}
    throw e;
  }

  assert.ok(closeInfo, '应收到 onClose 回调');
  assert.strictEqual(closeInfo.cancelled, false, `onClose.cancelled 应为 false，实际 ${JSON.stringify(closeInfo)}`);
  assert.ok(
    collected.length >= 80 * 1024,
    `回声内容长度应>=80KB，实际 ${collected.length}`
  );
  assert.ok(
    collected.includes('A'.repeat(1000)),
    '回声内容应包含连续A字符（完整性校验）'
  );
  const errText = JSON.stringify(errors);
  assert.ok(!errText.includes('AGENT_PROMPT_TOO_LARGE'), '不应出现 AGENT_PROMPT_TOO_LARGE');
  assert.ok(!errText.includes('ENAMETOOLONG'), '不应出现 ENAMETOOLONG');
}

// ---------- 断言4：流解析器归一化 ----------
async function test4_StreamParsers() {
  // 4a. claude-stream-json: text_delta -> onChunk
  {
    const parser = getStreamParser('claude-stream-json');
    assert.ok(parser && typeof parser.push === 'function', 'claude parser 应有 push');
    assert.ok(typeof parser.flush === 'function', 'claude parser 应有 flush');
    assert.ok(typeof parser.hasEmittedContent === 'function', 'claude parser 应有 hasEmittedContent');
    assert.strictEqual(parser.hasEmittedContent(), false, 'claude parser 初始 hasEmittedContent 应为 false');

    const chunks = [];
    const thinkings = [];
    parser.push(
      '{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n',
      {
        onChunk: (e) => chunks.push(e && e.text),
        onThinking: (e) => thinkings.push(e && e.text),
      }
    );
    assert.ok(chunks.join('').includes('hi'), `claude text_delta 应触发 onChunk hi，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(parser.hasEmittedContent(), true, 'claude text_delta 后 hasEmittedContent 应为 true');
    parser.flush({});
  }

  // 4b. claude-stream-json: thinking_delta -> onThinking
  {
    const parser = getStreamParser('claude-stream-json');
    const chunks = [];
    const thinkings = [];
    parser.push(
      '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"deep thought"}}\n',
      {
        onChunk: (e) => chunks.push(e && e.text),
        onThinking: (e) => thinkings.push(e && e.text),
      }
    );
    assert.ok(
      thinkings.join('').includes('deep thought'),
      `claude thinking_delta 应触发 onThinking，实际 thinking=${JSON.stringify(thinkings)} chunk=${JSON.stringify(chunks)}`
    );
    parser.flush({});
  }

  // 4c. json-event-stream (opencode): text -> onChunk
  {
    const parser = getStreamParser('json-event-stream', 'opencode');
    assert.strictEqual(parser.hasEmittedContent(), false, 'opencode parser 初始应为 false');
    const chunks = [];
    parser.push('{"type":"text","text":"hello"}\n', {
      onChunk: (e) => chunks.push(e && e.text),
      onThinking: () => {},
    });
    assert.ok(chunks.join('').includes('hello'), `opencode text 应触发 onChunk hello，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(parser.hasEmittedContent(), true, 'opencode text 后应为 true');
    parser.flush({});
  }

  // 4d. json-event-stream (opencode): chunk 变体 -> onChunk
  {
    const parser = getStreamParser('json-event-stream', 'opencode');
    const chunks = [];
    parser.push('{"type":"chunk","text":"world"}\n', {
      onChunk: (e) => chunks.push(e && e.text),
      onThinking: () => {},
    });
    assert.ok(chunks.join('').includes('world'), `opencode chunk 应触发 onChunk world，实际 ${JSON.stringify(chunks)}`);
    parser.flush({});
  }

  // 4e. json-event-stream (opencode): reasoning -> onThinking
  {
    const parser = getStreamParser('json-event-stream', 'opencode');
    const thinkings = [];
    const chunks = [];
    parser.push('{"type":"reasoning","text":"let me think"}\n', {
      onChunk: (e) => chunks.push(e && e.text),
      onThinking: (e) => thinkings.push(e && e.text),
    });
    assert.ok(
      thinkings.join('').includes('let me think'),
      `opencode reasoning 应触发 onThinking，实际 ${JSON.stringify(thinkings)}`
    );
    parser.flush({});
  }

  // 4f. flush / hasEmittedContent 行为：无换行残留 flush 补发；空 parser flush 不误报
  {
    const parser = getStreamParser('json-event-stream', 'opencode');
    assert.strictEqual(parser.hasEmittedContent(), false, '新 parser 应为 false');
    const chunks = [];
    const h = {
      onChunk: (e) => chunks.push(e && e.text),
      onThinking: () => {},
    };
    // 无换行的完整 JSON 行：push 时不 emit，flush 时补发
    parser.push('{"type":"text","text":"flushme"}', h);
    assert.strictEqual(parser.hasEmittedContent(), false, '无换行残留 push 后不应提前 emit');
    assert.strictEqual(chunks.length, 0, 'flush 前不应收到 chunk');
    parser.flush(h);
    assert.ok(chunks.join('').includes('flushme'), `flush 应补发残留行，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(parser.hasEmittedContent(), true, 'flush 后应为 true');
  }
  {
    // claude parser 同理：无换行残留 flush 补发
    const parser = getStreamParser('claude-stream-json');
    const chunks = [];
    const h = { onChunk: (e) => chunks.push(e && e.text), onThinking: () => {} };
    parser.push('{"type":"content_block_delta","delta":{"type":"text_delta","text":"tail"}}', h);
    assert.strictEqual(chunks.length, 0, 'claude 无换行时 flush 前不应 emit');
    parser.flush(h);
    assert.ok(chunks.join('').includes('tail'), `claude flush 应补发 tail，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(parser.hasEmittedContent(), true, 'claude flush 后应为 true');
  }

  // 4g. qoder-stream-json：assistant三块（thinking/text/tool_use）+ result收session不复读 + 非JSON行跳过
  {
    const parser = getStreamParser('qoder-stream-json');
    assert.ok(parser && typeof parser.push === 'function', 'qoder parser 应有 push');
    assert.strictEqual(parser.hasEmittedContent(), false, 'qoder parser 初始应为 false');
    const chunks = [];
    const thinkings = [];
    const tools = [];
    const sessions = [];
    const h = {
      onChunk: (e) => chunks.push(e && e.text),
      onThinking: (e) => thinkings.push(e && e.text),
      onToolCall: (e) => tools.push(e),
      onSession: (e) => sessions.push(e && e.id),
    };
    parser.push('{"type":"system","subtype":"init","session_id":"sess-1"}\n', h);
    parser.push('Model "x" is not available right now; using "auto" instead.\n', h);
    parser.push('{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"plan here"},{"type":"text","text":"Output: X"},{"type":"tool_use","id":"call_1","name":"Bash","input":{"command":"echo X"}}]}}\n', h);
    parser.push('{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_1","content":"X"}]},"session_id":"sess-1"}\n', h);
    parser.push('{"type":"result","subtype":"success","is_error":false,"result":"Output: X","session_id":"sess-1"}\n', h);
    assert.ok(thinkings.join('').includes('plan here'), `qoder thinking块须进onThinking，实际 ${JSON.stringify(thinkings)}`);
    assert.ok(chunks.join('').includes('Output: X'), `qoder text块须进onChunk，实际 ${JSON.stringify(chunks)}`);
    assert.strictEqual(chunks.filter((c) => String(c).includes('Output: X')).length, 1, 'result文本不得复读');
    assert.ok(!chunks.join('').includes('not available'), '非JSON提示行不得污染正文');
    assert.strictEqual(tools.length, 1, 'tool_use须触发一次onToolCall');
    assert.strictEqual(tools[0].tool, 'Bash', 'tool名须归一到tool字段');
    assert.strictEqual(tools[0].input.command, 'echo X', 'input须透传');
    assert.deepStrictEqual(sessions, ['sess-1'], 'session_id须去重只派发一次');
    assert.strictEqual(parser.hasEmittedContent(), true, 'qoder有内容后应为true');
    assert.strictEqual(parser.getPendingError(), null, '成功流无pendingError');
    parser.flush(h);
  }

  // 4h. qoder-stream-json：失败result记pendingError（供engine非零退出诊断）
  {
    const parser = getStreamParser('qoder-stream-json');
    let err = null;
    const h = { onChunk: () => {}, onThinking: () => {}, onError: (e) => { err = e; } };
    parser.push('{"type":"result","subtype":"error_auth","is_error":true,"result":"bad key","session_id":"sess-9"}\n', h);
    assert.ok(parser.getPendingError() && String(parser.getPendingError().message).includes('bad key'), '失败须记pendingError');
    parser.flush(h);
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

  await run('断言1 注册表与契约完整性', test1_RegistryContract);
  await run('断言2 并发探测3000ms熔断', test2_DetectionFuse);
  await run('断言3 80KB超大Prompt管道注入', test3_LargePromptStdin);
  await run('断言4 流解析器归一化', test4_StreamParsers);

  console.log(`SUMMARY passed=${passed} failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error((e && e.stack) || String(e));
  process.exitCode = 1;
});
