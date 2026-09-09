module.exports = {
  id: 'codebuddy',
  name: 'Codebuddy Code',
  bin: 'codebuddy',
  fallbackBins: ['cbc'],
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true }
  ],
  // Codebuddy 无 models 子命令，从 --help 公告目录解析版本本地模型表
  listModels: {
    args: ['--help'],
    timeoutMs: 10000,
    parse: (stdout) => {
      const out = [{ id: 'default', label: '默认推荐模型 (CLI 预设)', default: true }];
      try {
        const m = String(stdout || '').match(/--model <model>[\s\S]*?Currently supported:\s*\(([^)]*)\)/i);
        if (!m) return out;
        const seen = new Set(['default']);
        m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => {
          if (!seen.has(id)) { seen.add(id); out.push({ id, label: id }); }
        });
      } catch (_) {}
      return out;
    }
  },
  buildArgs: (_prompt, _images, _extra, options = {}, ctx = {}) => {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    if (ctx.resumeSessionId && typeof ctx.resumeSessionId === 'string' && ctx.resumeSessionId) {
      args.push('--resume', ctx.resumeSessionId);
    }
    args.push('--permission-mode', 'bypassPermissions');
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'claude-stream-json'
};
