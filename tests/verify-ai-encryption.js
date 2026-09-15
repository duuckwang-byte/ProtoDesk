'use strict';
// verify-ai-encryption: AI凭据硬件加密单测（Wave-D，不进run-all门禁，手动执行：node tests/verify-ai-encryption.js）
// 覆盖：落盘无明文 / IPC掩码 / 空回写不冲 / 原子写无tmp残留无空文件 / 旧明文迁移（备份+剥离+恢复）
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../main/services/ai-config-store');

async function main() {
  let passed = 0;
  const ok = (n, c) => { assert.ok(c, n); passed++; console.log('[PASS] ' + n); };

  // 1. 落盘无明文 + 掩码
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aienc-'));
    store._setPathsForTest({ configPath: path.join(tmp, 'ai-config.json'), credPath: path.join(tmp, 'ai-credentials.json') });
    try {
      const sk = 'sk-test-UNIT-' + Date.now();
      const r = await store.saveAiConfig({ engine: 'api', api: { provider: 'openai', baseUrl: 'https://x', apiKey: sk, model: 'm' } });
      ok('save-ok', r && r.ok);
      ok('masked-empty', r.config.api.apiKey === '');
      ok('masked-shape', r.config.api.apiKeyMasked === '****' + sk.slice(-4) && r.config.api.hasApiKey === true);
      const raw = fs.readFileSync(path.join(tmp, 'ai-config.json'), 'utf8');
      ok('disk-no-plain', !raw.includes(sk));
      ok('disk-no-keyfield', !JSON.parse(raw).api.apiKey);
      const full = store.loadAiConfigFull();
      ok('full-memory', full.api.apiKey === sk);
      const masked = store.getMaskedAiConfig();
      ok('ipc-never-plain', masked.api.apiKey === '' && !JSON.stringify(masked).includes(sk));
      // 空回写不冲
      const r2 = await store.saveAiConfig({ engine: 'api', api: { provider: 'openai', baseUrl: 'https://x', apiKey: '', model: 'm2' } });
      ok('empty-keeps-key', store.loadAiConfigFull().api.apiKey === sk && r2.config.api.hasApiKey === true);
      // 原子写：无tmp残留、无空文件
      const files = fs.readdirSync(tmp);
      ok('no-tmp', !files.some((f) => f.includes('.tmp-')));
      ok('no-empty', fs.statSync(path.join(tmp, 'ai-config.json')).size > 10);
    } finally { store._resetForTest(); fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // 2. 旧明文迁移
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aimig-'));
    const cp = path.join(tmp, 'ai-config.json');
    const sk = 'sk-OLD-' + Date.now();
    fs.writeFileSync(cp, JSON.stringify({ engine: 'cli', api: { provider: 'deepseek', baseUrl: 'https://x', apiKey: sk, model: 'm' }, byok: { apiKey: sk }, apiConfig: { apiKey: sk }, apiProfiles: [{ id: 'p1', apiKey: sk }] }));
    store._setPathsForTest({ configPath: cp, credPath: path.join(tmp, 'ai-credentials.json') });
    try {
      const m = await store.migratePlaintextOnce();
      ok('migrated', m.migrated >= 1 && !!m.backupPath && fs.existsSync(m.backupPath));
      ok('backup-has-plain', fs.readFileSync(m.backupPath, 'utf8').includes(sk));
      ok('stripped', !fs.readFileSync(cp, 'utf8').includes(sk));
      ok('recovered', store.loadAiConfigFull().api.apiKey === sk);
      const m2 = await store.migratePlaintextOnce();
      ok('idempotent', m2.migrated === 0);
    } finally { store._resetForTest(); fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  console.log('AIENC_PASS: ' + passed + '项全绿（safeStorage不可用时走内存，会话有效；Electron内走DPAPI持久化）');
}

main().catch((e) => { console.error('AIENC_FAIL', (e && e.stack) || e); process.exitCode = 1; });
