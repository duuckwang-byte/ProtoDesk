module.exports = {
  id: 'pi',
  name: 'Pi',
  bin: 'pi',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (anthropic)' },
    { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5 (anthropic)' },
    { id: 'openai/gpt-5', label: 'GPT-5 (openai)' },
    { id: 'openai/o4-mini', label: 'o4-mini (openai)' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (google)' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (google)' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}) => {
    const args = ['--mode', 'rpc'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'plain',
  // 其 RPC 会话走 stdio JSON-RPC，本工具暂未实现该协议，仅支持探测与模型展示
  needsProtocol: 'pi-rpc'
};
