const backendConfig = {
  // Default LAN backend address for phone + PC on the same Wi-Fi.
  baseUrl: 'http://10.232.5.182:3000',
  apiToken: 'wechat-todo-sync-2026',
  socketRetryMs: 2000
};

function normalizeBackendBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function normalizeBackendSocketUrl(url) {
  const baseUrl = normalizeBackendBaseUrl(url);
  if (!baseUrl) {
    return '';
  }

  if (baseUrl.startsWith('https://')) {
    return `wss://${baseUrl.slice('https://'.length)}/ws/todos`;
  }

  if (baseUrl.startsWith('http://')) {
    return `ws://${baseUrl.slice('http://'.length)}/ws/todos`;
  }

  return `${baseUrl}/ws/todos`;
}

function resolveBackendConfig() {
  const baseUrl = normalizeBackendBaseUrl(backendConfig.baseUrl);

  return {
    baseUrl,
    socketUrl: normalizeBackendSocketUrl(baseUrl),
    apiToken: String(backendConfig.apiToken || '').trim(),
    socketRetryMs: Number(backendConfig.socketRetryMs) || 2000
  };
}

module.exports = {
  backendConfig,
  normalizeBackendBaseUrl,
  normalizeBackendSocketUrl,
  resolveBackendConfig
};
