module.exports = {
  id: 'kimi',
  name: 'Kimi CLI',
  bin: 'kimi',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' },
    { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
    { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k' }
  ],
  buildArgs: () => ['acp'],
  promptViaStdin: false,
  streamFormat: 'plain',
  // 需 ACP 会话协议，本工具暂未实现执行通道，仅支持探测与模型展示
  needsProtocol: 'acp-json-rpc'
};
