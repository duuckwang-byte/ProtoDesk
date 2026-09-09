module.exports = {
  id: 'devin',
  name: 'Devin for Terminal',
  bin: 'devin',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'adaptive', label: 'adaptive' },
    { id: 'swe', label: 'swe' },
    { id: 'opus', label: 'opus' },
    { id: 'sonnet', label: 'sonnet' },
    { id: 'codex', label: 'codex' },
    { id: 'gpt', label: 'gpt' },
    { id: 'gemini', label: 'gemini' }
  ],
  buildArgs: () => ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false', 'acp'],
  promptViaStdin: false,
  streamFormat: 'plain',
  // 需 ACP 会话协议，本工具暂未实现执行通道，仅支持探测与模型展示
  needsProtocol: 'acp-json-rpc'
};
