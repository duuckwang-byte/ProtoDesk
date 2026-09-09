const { normalizeProviderBaseUrl, PROTOCOL_FALLBACK_MODELS } = require('./protocols');

/**
 * 动态获取服务商的模型列表
 * @param {Object} params
 * @param {string} params.protocol
 * @param {string} [params.apiKey]
 * @param {string} [params.baseUrl]
 * @param {number} [params.timeoutMs=10000]
 * @returns {Promise<Array<{ id: string, label: string }>>}
 */
async function fetchProviderModels({ protocol, apiKey, baseUrl, timeoutMs = 10000 }) {
  const fallback = PROTOCOL_FALLBACK_MODELS[protocol] || PROTOCOL_FALLBACK_MODELS.openai;
  const normalizedBaseUrl = normalizeProviderBaseUrl(protocol, baseUrl);

  if (protocol === 'anthropic') {
    // Anthropic 目前官方未开放通用列举端点，直接返回推荐列表
    return fallback;
  }

  let targetUrl = `${normalizedBaseUrl}/models`;
  const headers = { 'Content-Type': 'application/json' };

  if (protocol === 'google') {
    const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
    targetUrl = `${normalizedBaseUrl}/models${keyQuery}`;
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(targetUrl, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return fallback;

    const data = await res.json();
    let rawList = [];

    if (Array.isArray(data)) {
      rawList = data;
    } else if (Array.isArray(data.data)) {
      rawList = data.data; // OpenAI 格式: { data: [{ id: "..." }] }
    } else if (Array.isArray(data.models)) {
      rawList = data.models; // Google/Ollama 格式: { models: [{ name: "..." }] }
    }

    const seen = new Set();
    const models = [];

    for (const item of rawList) {
      let id = '';
      if (typeof item === 'string') id = item;
      else if (item && typeof item.id === 'string') id = item.id;
      else if (item && typeof item.name === 'string') id = item.name;

      if (!id || seen.has(id)) continue;
      // 过滤非文本类模型（如 tts, whisper, dall-e, embed）
      if (/embed|tts|whisper|dall-e|moderation|babbage|davinci/i.test(id)) continue;

      seen.add(id);
      models.push({ id, label: id });
    }

    return models.length > 0 ? models : fallback;
  } catch {
    clearTimeout(timer);
    return fallback;
  }
}

module.exports = {
  fetchProviderModels
};
