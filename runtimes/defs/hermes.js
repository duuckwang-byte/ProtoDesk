module.exports = {
  id: 'hermes',
  name: 'Hermes',
  bin: 'hermes',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'grok-4.3', label: 'grok-4.3 (xAI · default)' },
    { id: 'grok-4.20-reasoning', label: 'grok-4.20-reasoning (xAI · deep)' },
    { id: 'grok-4.20-non-reasoning', label: 'grok-4.20-non-reasoning (xAI · fast)' },
    { id: 'grok-4.20-multi-agent', label: 'grok-4.20-multi-agent (xAI · orchestration)' },
    { id: 'openai-codex:gpt-5.5', label: 'gpt-5.5 (openai-codex:gpt-5.5)' },
    { id: 'openai-codex:gpt-5.4', label: 'gpt-5.4 (openai-codex:gpt-5.4)' },
    { id: 'openai-codex:gpt-5.4-mini', label: 'gpt-5.4-mini (openai-codex:gpt-5.4-mini)' }
  ],
  buildArgs: () => ['acp', '--accept-hooks'],
  promptViaStdin: false,
  streamFormat: 'plain',
  // 需 ACP 会话协议，本工具暂未实现执行通道，仅支持探测与模型展示
  needsProtocol: 'acp-json-rpc'
};
