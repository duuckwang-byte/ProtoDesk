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
    // permissionMode 档位约定（缺省即现状）：仅当 options.permissionMode 为非空字符串时，
    // 用其值替代默认 bypassPermissions（`--permission-mode <值>`，位置不变）；不配即逐字保持现状。
    const _pmRaw = (options && typeof options.permissionMode === 'string') ? options.permissionMode.trim() : '';
    const _pm = _pmRaw ? _pmRaw : 'bypassPermissions';
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
    args.push('--permission-mode', _pm);
    if (options.model && options.model !== 'default') args.push('--model', options.model);
    if (ctx.resumeSessionId) args.push('--resume', ctx.resumeSessionId);
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'claude-stream-json'
};
