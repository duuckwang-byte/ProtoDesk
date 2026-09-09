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
  id: 'atomcode',
  name: 'AtomCode CLI',
  bin: 'atomcode',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'glm-5.2', label: 'GLM-5.2' },
    { id: 'deepseek-v4', label: 'DeepSeek V4' }
  ],
  buildArgs: (prompt, _images, _extra, options = {}) => {
    const args = ['--prompt-file', stagePromptFile(prompt), '-y'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: false,
  streamFormat: 'plain'
};
