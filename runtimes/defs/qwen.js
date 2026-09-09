module.exports = {
  id: 'qwen',
  name: 'Qwen Code',
  bin: 'qwen',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' },
    { id: 'qwen3-coder-flash', label: 'qwen3-coder-flash' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}) => {
    const args = ['--yolo'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'plain'
};
