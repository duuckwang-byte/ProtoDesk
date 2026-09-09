module.exports = {
  id: 'reasonix',
  name: 'DeepSeek Reasonix',
  bin: 'reasonix',
  fallbackBins: ['dsnix'],
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' }
  ],
  buildArgs: () => ['acp'],
  promptViaStdin: false,
  streamFormat: 'plain',
  // 需 ACP 会话协议，本工具暂未实现执行通道，仅支持探测与模型展示
  needsProtocol: 'acp-json-rpc'
};
