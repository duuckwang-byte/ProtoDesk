module.exports = {
  id: 'aider',
  name: 'Aider',
  bin: 'aider',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'sonnet', label: 'sonnet' },
    { id: 'gpt-4o', label: 'gpt-4o' },
    { id: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat' },
    { id: 'gemini/gemini-2.0-flash', label: 'gemini/gemini-2.0-flash' }
  ],
  buildArgs: (prompt, _images, _extra, options = {}) => {
    const args = [
      '--yes-always',
      '--no-pretty',
      '--no-git',
      '--no-auto-commits',
      '--no-suggest-shell-commands',
      '--no-show-model-warnings'
    ];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    args.push('--message', String(prompt || ''));
    return args;
  },
  promptViaStdin: false,
  streamFormat: 'plain'
};
