module.exports = {
  id: 'qoder',
  name: 'Qoder CLI',
  bin: 'qodercli',
  versionArgs: ['--version'],
  fallbackModels: [
    { id: 'default', label: '默认推荐模型 (CLI 预设)', default: true },
    { id: 'lite', label: 'Lite' },
    { id: 'efficient', label: 'Efficient' },
    { id: 'auto', label: 'Auto' },
    { id: 'performance', label: 'Performance' },
    { id: 'ultimate', label: 'Ultimate' }
  ],
  buildArgs: (_prompt, _images, _extra, options = {}, ctx = {}) => {
    const args = ['-p', '--output-format', 'stream-json', '--yolo'];
    if (ctx.cwd) args.push('-w', ctx.cwd);
    if (options.model && options.model !== 'default') {
      args.push('--model', options.model);
    }
    return args;
  },
  promptViaStdin: true,
  streamFormat: 'plain',
  // 其 stream-json 为私有格式，本工具暂未实现解析器，仅支持探测与模型展示
  needsProtocol: 'qoder-stream-json'
};
