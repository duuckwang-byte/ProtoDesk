module.exports = {
  id: 'deepseek',
  name: 'DeepSeek TUI',
  bin: 'deepseek',
  fallbackBins: ['codewhale'],
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' }
  ],
  // exec 模式要求 prompt 为位置参数（不支持 stdin 哨兵），超长由预算守卫拦截
  buildArgs: (prompt, _images, _extra, options = {}) => {
    const args = ['exec', '--auto'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    args.push(String(prompt || ''));
    return args;
  },
  promptViaStdin: false,
  streamFormat: 'plain'
};
