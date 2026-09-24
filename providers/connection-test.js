const { normalizeProviderBaseUrl } = require('./protocols');

/**
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} success - 是否连通成功
 * @property {'success' | 'auth_failed' | 'invalid_base_url' | 'rate_limited' | 'forbidden' | 'timeout' | 'unknown'} kind - 分类代码
 * @property {number} [status] - HTTP 状态码
 * @property {number} [latencyMs] - 耗时
 * @property {string} message - 用户友好的诊断提示
 */

/**
 * 测试服务商连接状态
 * @param {Object} params
 * @param {string} params.protocol
 * @param {string} [params.apiKey]
 * @param {string} [params.baseUrl]
 * @param {string} [params.model]
 * @param {number} [params.timeoutMs=8000]
 * @returns {Promise<ConnectionTestResult>}
 */
async function testProviderConnection({ protocol, apiKey, baseUrl, model, timeoutMs = 8000 }) {
  const normalizedBaseUrl = normalizeProviderBaseUrl(protocol, baseUrl);
  const startTime = Date.now();

  let targetUrl = '';
  const headers = { 'Content-Type': 'application/json' };

  if (protocol === 'anthropic') {
    targetUrl = `${normalizedBaseUrl}/messages`;
    if (apiKey) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }
  } else if (protocol === 'google') {
    const keyQuery = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
    targetUrl = `${normalizedBaseUrl}/models${keyQuery}`;
  } else {
    // OpenAI / Ollama / OpenAI Compatible
    targetUrl = `${normalizedBaseUrl}/models`;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: protocol === 'anthropic' ? 'POST' : 'GET',
      headers,
      body: protocol === 'anthropic' ? JSON.stringify({
        model: model || 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      }) : undefined,
      signal: controller.signal
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        success: true,
        kind: 'success',
        status: response.status,
        latencyMs,
        message: `连接成功 (延迟 ${latencyMs}ms)`
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        kind: 'auth_failed',
        status: 401,
        latencyMs,
        message: '认证失败：API Key 无效或未授权。'
      };
    }
    if (response.status === 403) {
      return {
        success: false,
        kind: 'forbidden',
        status: 403,
        latencyMs,
        message: '无权访问：账号受限或该模型无访问权限。'
      };
    }
    if (response.status === 404) {
      return {
        success: false,
        kind: 'invalid_base_url',
        status: 404,
        latencyMs,
        message: '接口地址不存在 (404)，请检查 BaseURL 路径是否正确。'
      };
    }
    if (response.status === 429) {
      return {
        success: false,
        kind: 'rate_limited',
        status: 429,
        latencyMs,
        message: '请求被限流 (429) 或账户额度已耗尽。'
      };
    }

    return {
      success: false,
      kind: 'unknown',
      status: response.status,
      latencyMs,
      message: `服务商返回异常状态码: ${response.status}`
    };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    if (err.name === 'AbortError') {
      return {
        success: false,
        kind: 'timeout',
        latencyMs,
        message: `连接超时（超过 ${timeoutMs}ms 未响应），请检查网络或代理设置。`
      };
    }

    return {
      success: false,
      kind: 'invalid_base_url',
      latencyMs,
      message: `网络连接失败: ${err.message || '无法访问该地址'}`
    };
  }
}

module.exports = {
  testProviderConnection
};
