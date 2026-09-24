module.exports = {
  id: 'cursor-agent',
  name: 'Cursor Agent',
  bin: 'cursor-agent',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', default: true },
    { id: 'gpt-4o', label: 'GPT-4o' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}, ctx = {}) => {
    // 注入非交互提权参数 --force
    const args = ['--print', '--output-format', 'stream-json', '--stream-partial-output', '--force'];
    if (ctx.cwd) args.push('--workspace', ctx.cwd);
    if (options.model && options.model !== 'default') args.push('--model', options.model);
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'json-event-stream',
  eventParser: 'cursor-agent'
};
