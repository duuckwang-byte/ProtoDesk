module.exports = {
  id: 'opencode',
  name: 'OpenCode CLI',
  bin: 'opencode-cli',
  fallbackBins: ['opencode'],
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'opencode/deepseek-v4-flash', label: 'DeepSeek V4 Flash' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}, ctx = {}) => {
    // V2 兼容：`opencode run` 已删除 --dir（未知旗直接 usage 报错），工作目录由进程 cwd 承载
    //（engine spawn 时 cwd=沙箱目录，实测 V2 以 cwd 解析项目配置），此处不再拼目录参数。
    const args = ['run', '--format', 'json', '--thinking'];
    if (ctx.resumeSessionId && typeof ctx.resumeSessionId === 'string') {
      const sid = ctx.resumeSessionId.trim();
      if (sid.startsWith('ses_')) {
        args.push('-s', sid);
      }
    }
    if (options.model && options.model !== 'default') {
      let m = String(options.model).trim();
      /* free 独立模型：原样透传后缀，由服务商做免费路由，不再剥离 */
      if (m && m !== 'default') {
        args.push('-m', m);
      }
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'json-event-stream',
  eventParser: 'opencode',
  listModels: {
    args: ['models'],
    timeoutMs: 5000,
    parse: (stdout, stderr) => {
      /* free 独立模型：保留原始 id（含 -free 后缀），按全 id 去重，不再合并 */
      const isNoise = (s) => /embed|tts\b|text-to-speech|stt\b|whisper|dall-?e|text-embedding|image-?gen/i.test(s);
      const pickId = (v) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') return v.id || v.name || v.model || v.slug || v.value || '';
        return '';
      };
      let raw = [];
      const text = String(stdout || '').trim();
      if (text) {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
        if (Array.isArray(parsed)) raw = parsed;
        else if (parsed && typeof parsed === 'object') raw = parsed.data || parsed.models || parsed.items || [];
        if (!raw.length) {
          raw = text.split(/\r?\n/)
            .flatMap((l) => String(l).split(/[\s,;|]+/))
            .map((s) => String(s || '').trim().replace(/^[-*•\d.)\s]+/, '').replace(/^["']|["']$/g, ''))
            .filter(Boolean)
            .filter((s) => !/^(model|id|name|provider|available|---|===|loading|warn|error)/i.test(s));
        }
      }
      const seen = new Set(); const out = [];
      for (const v of raw) {
        let id = String(pickId(v) || '').trim();
        if (!id || id === 'default') continue;
        if (isNoise(id)) continue;
        if (id.length > 128 || /\s/.test(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, label: id });
      }
      return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
  }
};
