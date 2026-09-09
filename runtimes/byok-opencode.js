const { normalizeProviderBaseUrl } = require('../providers/protocols');

const BYOK_OPENCODE_AGENT_ID = 'byok-opencode';
const BYOK_OPENCODE_PROVIDER_ID = 'pland-byok';
const BYOK_OPENCODE_API_KEY_ENV = 'PLAND_BYOK_API_KEY';

const DEFAULT_CONTEXT_TOKEN_LIMIT = 128000;
const DEFAULT_OUTPUT_TOKEN_LIMIT = 16384;

/**
 * 将原始模型名转为带 provider 前缀的规范标识
 * @param {string} model
 * @returns {string | null}
 */
function opencodeByokModelId(model) {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed || trimmed.toLowerCase() === 'default') return null;
  if (trimmed.startsWith(`${BYOK_OPENCODE_PROVIDER_ID}/`)) return trimmed;
  return `${BYOK_OPENCODE_PROVIDER_ID}/${trimmed}`;
}

/**
 * 组装注入给 OpenCode 的动态配置
 * @param {Object} provider
 * @param {string} provider.protocol - 'openai' | 'anthropic' | 'google' | 'ollama' | 'azure'
 * @param {string} [provider.apiKey]
 * @param {string} [provider.baseUrl]
 * @param {string} [provider.apiVersion]
 * @param {string} model
 * @returns {{ providerId: string, modelId: string, env: Record<string, string>, config: Object } | null}
 */
function buildOpenCodeByokProviderConfig(provider, model) {
  if (!provider || typeof provider !== 'object') return null;
  const protocol = provider.protocol;
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : '';
  const rawModel = typeof model === 'string' ? model.trim() : '';
  if (!rawModel || rawModel.toLowerCase() === 'default') return null;

  const baseUrl = normalizeProviderBaseUrl(protocol, provider.baseUrl);
  const isLocalOllama = protocol === 'ollama' && /localhost|127\.0\.0\.1|::1/i.test(baseUrl);
  const needsApiKey = !isLocalOllama;

  if (needsApiKey && !apiKey) return null;

  const modelId = opencodeByokModelId(rawModel);
  const providerEntry = buildProviderEntry(protocol, baseUrl, provider.apiVersion, needsApiKey);

  const config = {
    provider: {
      [BYOK_OPENCODE_PROVIDER_ID]: {
        name: 'PlanD BYOK Provider',
        ...providerEntry,
        models: {
          [rawModel]: {
            name: rawModel,
            limit: {
              context: DEFAULT_CONTEXT_TOKEN_LIMIT,
              output: DEFAULT_OUTPUT_TOKEN_LIMIT
            }
          }
        }
      }
    }
  };

  const opencodeConfigContent = JSON.stringify(config);

  return {
    providerId: BYOK_OPENCODE_PROVIDER_ID,
    modelId,
    env: {
      ...(needsApiKey ? { [BYOK_OPENCODE_API_KEY_ENV]: apiKey } : {}),
      OPENCODE_CONFIG_CONTENT: opencodeConfigContent
    },
    config
  };
}

function buildProviderEntry(protocol, baseUrl, apiVersion, includeApiKey) {
  const apiKeyOption = includeApiKey ? { apiKey: `{env:${BYOK_OPENCODE_API_KEY_ENV}}` } : {};

  switch (protocol) {
    case 'anthropic':
      return {
        npm: '@ai-sdk/anthropic',
        options: { ...apiKeyOption, ...(baseUrl ? { baseURL: baseUrl } : {}) }
      };
    case 'google':
      return {
        npm: '@ai-sdk/google',
        options: { ...apiKeyOption, ...(baseUrl ? { baseURL: baseUrl } : {}) }
      };
    case 'ollama':
      return {
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: baseUrl, ...apiKeyOption }
      };
    case 'openai':
    default: {
      const isOfficialOpenAI = !baseUrl || /api\.openai\.com/i.test(baseUrl);
      if (isOfficialOpenAI) {
        return {
          npm: '@ai-sdk/openai',
          options: { ...apiKeyOption, ...(baseUrl ? { baseURL: baseUrl } : {}) }
        };
      }
      return {
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: baseUrl, ...apiKeyOption }
      };
    }
  }
}

module.exports = {
  BYOK_OPENCODE_AGENT_ID,
  BYOK_OPENCODE_PROVIDER_ID,
  BYOK_OPENCODE_API_KEY_ENV,
  opencodeByokModelId,
  buildOpenCodeByokProviderConfig
};
