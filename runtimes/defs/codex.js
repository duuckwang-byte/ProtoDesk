module.exports = {
  id: 'codex',
  name: 'OpenAI Codex',
  bin: 'codex',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'gpt-4o', label: 'GPT-4o', default: true },
    { id: 'o3-mini', label: 'o3-mini' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}, ctx = {}) => {
    // 注入非交互免检参数 --skip-git-repo-check
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (ctx.cwd) args.push('-C', ctx.cwd);
    if (options.model && options.model !== 'default') args.push('--model', options.model);
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'json-event-stream',
  eventParser: 'codex'
};
