const AMP_MODES = new Set(['deep', 'smart', 'rush']);

module.exports = {
  id: 'amp',
  name: 'Amp',
  bin: 'amp',
  versionArgs: ['--version'],
  // Amp 无 --model 旗标，模型选择器实际选择其 agent --mode
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'smart', label: 'Smart (mode)' },
    { id: 'deep', label: 'Deep (mode)' },
    { id: 'rush', label: 'Rush (mode)' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}) => {
    const args = ['-x', '--stream-json', '--dangerously-allow-all'];
    if (options.model && options.model !== 'default' && AMP_MODES.has(options.model)) {
      args.push('--mode', options.model);
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'claude-stream-json'
};
