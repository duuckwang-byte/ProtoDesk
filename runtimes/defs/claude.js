module.exports = {
  id: 'claude',
  name: 'Claude Code',
  bin: 'claude',
  fallbackBins: ['claude-code'],
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', default: true },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}, ctx = {}) => {
    // 注入非交互免审批参数 bypassPermissions
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
    args.push('--permission-mode', 'bypassPermissions');
    if (options.model && options.model !== 'default') args.push('--model', options.model);
    if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'claude-stream-json'
};
