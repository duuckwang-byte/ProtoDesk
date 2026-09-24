const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function stagePromptFile(prompt) {
  const dir = path.join(os.tmpdir(), 'pland-prompts');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const f = path.join(dir, 'prompt-' + process.pid + '-' + Date.now() + '.txt');
  fs.writeFileSync(f, String(prompt || ''), 'utf8');
  return f;
}

module.exports = {
  id: 'grok-build',
  name: 'Grok Build',
  bin: 'grok',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'grok-build', label: 'grok-build (xAI · default)' },
    { id: 'grok-4.3', label: 'grok-4.3 (xAI)' },
    { id: 'grok-4.20-reasoning', label: 'grok-4.20-reasoning (xAI · deep)' },
    { id: 'grok-4.20-non-reasoning', label: 'grok-4.20-non-reasoning (xAI · fast)' },
    { id: 'grok-4.20-multi-agent', label: 'grok-4.20-multi-agent (xAI · orchestration)' }
  ],
  // `grok models` 输出含状态行，仅收录 grok-* 具体 id
  listModels: {
    args: ['models'],
    timeoutMs: 10000,
    parse: (stdout) => {
      const out = [{ id: 'default', label: '默认推荐模型 (CLI 预设)', default: true }];
      const seen = new Set();
      String(stdout || '').split('\n').forEach((line) => {
        const m = line.trim().match(/^\*?\s*-?\s*(grok-[a-z0-9][a-z0-9._-]*)(?:\s+\(default\))?\s*$/i);
        const id = m && m[1];
        if (id && !seen.has(id)) { seen.add(id); out.push({ id, label: id }); }
      });
      return out;
    }
  },
  // 长 prompt 经临时文件传输，绕开 argv 长度限制
  buildArgs: (prompt, _images, _extra, options = {}) => {
    const args = ['--prompt-file', stagePromptFile(prompt), '--no-plan', '--always-approve'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: false,
  streamFormat: 'plain'
};
