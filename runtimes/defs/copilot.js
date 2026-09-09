module.exports = {
  id: 'copilot',
  name: 'GitHub Copilot CLI',
  bin: 'copilot',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { id: 'gpt-5.2', label: 'GPT-5.2' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}) => {
    const args = ['--allow-all-tools', '--output-format', 'json'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'plain',
  // 其 JSON 流为 copilot 私有格式，本工具暂未实现解析器，仅支持探测与模型展示
  needsProtocol: 'copilot-stream-json'
};
