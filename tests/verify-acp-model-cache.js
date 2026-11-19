'use strict';
/* T7a ACP 模型目录缓存验证（纯 Node，不启动 Electron / Agent）
 * 覆盖：
 * 1. 默认路径 / key / TTL 契约；
 * 2. 原子写 + 读回结构（version/entries/models/defaultModel/source/ts）；
 * 3. 坏文件 / 版本不符 / 非法条目回空且不抛错；
 * 4. 过期条目仍可 get，isFresh 返回 false；
 * 5. clearAgent / clearAll / 换命令失效旧缓存。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CACHE_VERSION,
  DEFAULT_TTL_MS,
  buildCacheKey,
  createAcpModelCache
} = require('../main/acp/acp-model-cache');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pland-acp-cache-'));

/**
 * 新建一份隔离缓存实例。
 * @param {string} name 子目录名
 * @param {Object} [opts] 额外配置
 * @returns {{dir:string,file:string,cache:Object}} 测试上下文
 */
function makeCache(name, opts) {
  const dir = path.join(tempRoot, name);
  const file = path.join(dir, 'acp-model-catalog.json');
  return { dir, file, cache: createAcpModelCache(Object.assign({ filePath: file }, opts || {})) };
}

/**
 * 构造一条合法缓存值。
 * @param {string} command 启动命令全文
 * @param {string[]} ids 模型 id 列表
 * @param {Object} [extra] 附加字段
 * @returns {Object} 缓存值
 */
function makeValue(command, ids, extra) {
  return Object.assign({
    agentId: 'opencode',
    command,
    models: ids.map((id) => ({ id, name: id.toUpperCase(), description: 'd-' + id })),
    defaultModel: ids[0] || '',
    source: 'first-advertised',
    ts: Date.now()
  }, extra || {});
}

// ---------- 1. 默认契约 ----------
function test1_Defaults() {
  assert.strictEqual(DEFAULT_TTL_MS, 10 * 60 * 1000, '默认 TTL 应为 10 分钟');
  assert.strictEqual(CACHE_VERSION, 1, '缓存结构版本应为 1');
  assert.strictEqual(buildCacheKey('opencode', 'C:\\bin\\opencode.exe acp'), 'opencode::C:\\bin\\opencode.exe acp');
  const { cache } = makeCache('defaults');
  assert.strictEqual(cache.ttlMs, DEFAULT_TTL_MS, '实例 TTL 应默认 10 分钟');
  assert.ok(/acp-model-catalog\.json$/.test(cache.filePath), '文件应名为 acp-model-catalog.json');
}

// ---------- 2. 读写 / 原子写 ----------
function test2_RoundTripAtomic() {
  const t = makeCache('roundtrip');
  const command = 'C:\\bin\\opencode.exe acp';
  const key = buildCacheKey('opencode', command);
  const value = makeValue(command, ['m-a', 'm-b']);

  const realRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = function patchedRename(...args) {
    renameCalls += 1;
    return realRename.apply(fs, args);
  };
  let written = null;
  try {
    written = t.cache.set(key, value);
  } finally {
    fs.renameSync = realRename;
  }

  assert.ok(written, 'set 应返回写入记录');
  assert.ok(renameCalls >= 1, '落盘应经临时文件 + renameSync 原子替换');
  assert.ok(fs.existsSync(t.file), '缓存文件应存在');
  const leftovers = fs.readdirSync(t.dir).filter((f) => f.indexOf('.tmp-') >= 0);
  assert.strictEqual(leftovers.length, 0, '不应残留临时文件：' + JSON.stringify(leftovers));

  const doc = JSON.parse(fs.readFileSync(t.file, 'utf8'));
  assert.strictEqual(doc.version, 1, '文件结构版本应为 1');
  assert.ok(doc.entries[key], 'entries 应按 key 存放');
  assert.strictEqual(doc.entries[key].agentId, 'opencode');
  assert.strictEqual(doc.entries[key].command, command);
  assert.deepStrictEqual(doc.entries[key].models.map((m) => m.id), ['m-a', 'm-b']);
  assert.strictEqual(doc.entries[key].models[0].name, 'M-A');
  assert.strictEqual(doc.entries[key].defaultModel, 'm-a');
  assert.strictEqual(doc.entries[key].source, 'first-advertised');
  assert.ok(typeof doc.entries[key].ts === 'number' && doc.entries[key].ts > 0);

  const got = t.cache.get(key);
  assert.deepStrictEqual(got.models.map((m) => m.id), ['m-a', 'm-b']);
  got.models[0].name = 'MUTATED';
  assert.strictEqual(t.cache.get(key).models[0].name, 'M-A', 'get 应返回副本，外部修改不污染缓存');

  assert.strictEqual(t.cache.isFresh(doc.entries[key].ts), true, '刚写入应新鲜');
  assert.strictEqual(t.cache.isFresh(Date.now() - DEFAULT_TTL_MS - 1000), false, '超过 TTL 应不新鲜');

  // defaultModel 非法时归一化到首个模型
  const key2 = buildCacheKey('opencode', 'cmd-two');
  t.cache.set(key2, makeValue('cmd-two', ['x', 'y'], { defaultModel: 'not-exist' }));
  assert.strictEqual(t.cache.get(key2).defaultModel, 'x', 'defaultModel 不在列表时应回落首个模型');

  // 缺省 ts：set 补当前时间；坏文件里缺 ts 的记录则按过期处理
  const key3 = buildCacheKey('qoder', 'cmd-no-ts');
  t.cache.set(key3, {
    agentId: 'qoder',
    command: 'cmd-no-ts',
    models: [{ id: 'auto', name: 'Auto' }],
    defaultModel: 'auto',
    source: 'acp'
  });
  const noTs = t.cache.get(key3);
  assert.ok(noTs.ts > 0, 'set 缺省 ts 应补当前时间');
  assert.strictEqual(t.cache.isFresh(noTs.ts), true);
}

// ---------- 3. 坏文件 / 版本不符 / 非法条目 ----------
function test3_BadFile() {
  const t = makeCache('bad-file');
  fs.mkdirSync(t.dir, { recursive: true });

  fs.writeFileSync(t.file, '{not json', 'utf8');
  assert.deepStrictEqual(t.cache.load(), { version: 1, entries: {} }, '坏 JSON 应回空结构');
  assert.strictEqual(t.cache.get('opencode::x'), null, '坏文件 get 应为 null');

  const command = 'recover-cmd';
  assert.ok(t.cache.set(buildCacheKey('opencode', command), makeValue(command, ['ok-1'])), '坏文件后 set 应能自愈');
  assert.strictEqual(t.cache.get(buildCacheKey('opencode', command)).models[0].id, 'ok-1');

  fs.writeFileSync(t.file, JSON.stringify({ version: 99, entries: { 'opencode::old': {} } }), 'utf8');
  assert.deepStrictEqual(t.cache.load(), { version: 1, entries: {} }, '版本不符应整份作废');

  fs.writeFileSync(t.file, JSON.stringify({
    version: 1,
    entries: {
      'opencode::good': makeValue('good', ['g1']),
      'opencode::bad-models': { agentId: 'opencode', command: 'bad-models', models: [], ts: Date.now() },
      'mismatch::key': { agentId: 'other', command: 'other-cmd', models: [{ id: 'z' }], ts: Date.now() }
    }
  }), 'utf8');
  const doc = t.cache.load();
  assert.ok(doc.entries['opencode::good'], '合法条目应保留');
  assert.ok(!doc.entries['opencode::bad-models'], '空模型条目应跳过');
  assert.ok(!doc.entries['mismatch::key'], 'key 与 agentId/command 不自洽应跳过');
}

// ---------- 4. 过期 stale 仍可返回 ----------
function test4_StaleStillReadable() {
  const t = makeCache('stale');
  const command = 'stale-cmd';
  const key = buildCacheKey('qoder', command);
  const oldTs = Date.now() - 30 * 60 * 1000;
  t.cache.set(key, {
    agentId: 'qoder',
    command,
    models: [{ id: 'auto', name: 'Auto' }],
    defaultModel: 'auto',
    source: 'agent-current',
    ts: oldTs
  });
  const got = t.cache.get(key);
  assert.ok(got, '过期条目仍应可读（由调用方 SWR）');
  assert.strictEqual(got.ts, oldTs, '原始时间戳应保留');
  assert.strictEqual(t.cache.isFresh(got.ts), false, '过期条目应判定 stale');
  assert.strictEqual(t.cache.isFresh(got.ts, 60 * 60 * 1000), true, '可注入更长 TTL 判定新鲜');
}

// ---------- 5. clearAgent / clearAll / 换命令失效 ----------
function test5_ClearAndInvalidate() {
  const t = makeCache('clear');
  const k1 = buildCacheKey('opencode', 'cmd-1');
  const k2 = buildCacheKey('opencode', 'cmd-2');
  const k3 = buildCacheKey('qoder', 'cmd-q');
  t.cache.set(k1, makeValue('cmd-1', ['o1']));
  t.cache.set(k2, makeValue('cmd-2', ['o2']));
  t.cache.set(k3, { agentId: 'qoder', command: 'cmd-q', models: [{ id: 'auto' }], ts: Date.now() });

  // 同 Agent 换命令：旧命令记录应失效
  t.cache.set(buildCacheKey('opencode', 'cmd-3'), makeValue('cmd-3', ['o3']));
  assert.strictEqual(t.cache.get(k1), null, '同 Agent 旧命令缓存应失效');
  assert.strictEqual(t.cache.get(k2), null, '同 Agent 旧命令缓存应失效');
  assert.ok(t.cache.get(k3), '其他 Agent 缓存不受影响');

  assert.strictEqual(t.cache.clearAgent('opencode'), 1, 'clearAgent 应删除该 Agent 全部记录');
  assert.strictEqual(t.cache.get(k3) !== null, true, 'clearAgent 不应误删其他 Agent');
  assert.strictEqual(t.cache.clearAgent('qoder'), 1);
  assert.deepStrictEqual(t.cache.load().entries, {}, '清空后 entries 应为空');

  t.cache.set(k1, makeValue('cmd-1', ['o1']));
  assert.strictEqual(t.cache.clearAll(), true);
  assert.strictEqual(fs.existsSync(t.file), false, 'clearAll 应删除缓存文件');
  assert.deepStrictEqual(t.cache.load(), { version: 1, entries: {} });
}

async function main() {
  const tests = [
    ['1 默认路径/key/TTL', test1_Defaults],
    ['2 读写与原子写', test2_RoundTripAtomic],
    ['3 坏文件/版本/非法条目', test3_BadFile],
    ['4 过期 stale 仍可读', test4_StaleStillReadable],
    ['5 clearAgent/clearAll/换命令失效', test5_ClearAndInvalidate]
  ];
  let passed = 0;
  let failed = 0;
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
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (e) {}
  console.log('SUMMARY passed=' + passed + ' failed=' + failed);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
