module.exports = {
  id: 'vibe',
  name: 'Mistral Vibe CLI',
  bin: 'vibe-acp',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true }
  ],
  buildArgs: () => [],
  promptViaStdin: false,
  streamFormat: 'plain',
  // 需 ACP 会话协议，本工具暂未实现执行通道，仅支持探测与模型展示
  needsProtocol: 'acp-json-rpc'
};
