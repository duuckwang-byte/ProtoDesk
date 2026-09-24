const DEFAULT_BASE_URL_BY_PROTOCOL = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434/v1',
  azure: ''
};

const PROTOCOL_FALLBACK_MODELS = {
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o', default: true },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o3-mini', label: 'o3-mini' }
  ],
  anthropic: [
    { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', default: true },
    { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', default: true },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
  ],
  ollama: [
    { id: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', default: true },
    { id: 'deepseek-r1:8b', label: 'DeepSeek R1 8B' }
  ]
};

/**
 * 智能规范化用户输入的 BaseURL
 * @param {string} protocol
 * @param {string} [inputUrl]
 * @returns {string}
 */
function normalizeProviderBaseUrl(protocol, inputUrl) {
  const defaultUrl = DEFAULT_BASE_URL_BY_PROTOCOL[protocol] || '';
  const trimmed = typeof inputUrl === 'string' && inputUrl.trim() ? inputUrl.trim() : defaultUrl;
  if (!trimmed) return '';

  const cleanUrl = trimmed.replace(/\/+$/, '');

  try {
    const url = new URL(cleanUrl);
    const pathname = url.pathname.replace(/\/+$/, '');

    if (protocol === 'anthropic') {
      if (!/\/v\d+/.test(pathname)) url.pathname = `${pathname}/v1`;
      return url.toString().replace(/\/+$/, '');
    }

    if (protocol === 'google') {
      if (!/\/v\d+(alpha|beta)?/.test(pathname)) url.pathname = `${pathname}/v1beta`;
      return url.toString().replace(/\/+$/, '');
    }

    if (protocol === 'openai' || protocol === 'ollama') {
      if (!/\/v\d+/.test(pathname)) url.pathname = `${pathname}/v1`;
      return url.toString().replace(/\/+$/, '');
    }

    return cleanUrl;
  } catch {
    return cleanUrl;
  }
}

module.exports = {
  DEFAULT_BASE_URL_BY_PROTOCOL,
  PROTOCOL_FALLBACK_MODELS,
  normalizeProviderBaseUrl
};
