const backendConfig = {
  // 留空时会根据当前网络自动生成后端地址，避免 Wi-Fi 切换后继续使用旧 IP。
  baseUrl: '',
  protocol: 'http',
  port: 3000,
  apiToken: 'wechat-todo-sync-2026',
  socketRetryMs: 2000
};

const BACKEND_BASE_URL_CACHE_KEY = 'backend-base-url';

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

function pushUniqueBackendBaseUrl(list, url) {
  const baseUrl = normalizeBackendBaseUrl(url);
  if (baseUrl && list.indexOf(baseUrl) < 0) {
    list.push(baseUrl);
  }
}

function getBackendProtocol() {
  const protocol = String(backendConfig.protocol || 'http').replace(/:$/, '').trim();
  return protocol === 'https' ? 'https' : 'http';
}

function getBackendPort() {
  return Number(backendConfig.port) || 3000;
}

function buildBackendBaseUrl(host) {
  const normalizedHost = String(host || '').trim();
  if (!normalizedHost) {
    return '';
  }

  return `${getBackendProtocol()}://${normalizedHost}:${getBackendPort()}`;
}

function readCachedBackendBaseUrl() {
  // 读取上一次成功连接的地址，作为自动探测前的优先候选。
  if (typeof wx === 'undefined' || !wx.getStorageSync) {
    return '';
  }

  try {
    return normalizeBackendBaseUrl(wx.getStorageSync(BACKEND_BASE_URL_CACHE_KEY));
  } catch (error) {
    return '';
  }
}

function cacheBackendBaseUrl(url) {
  const baseUrl = normalizeBackendBaseUrl(url);
  if (!baseUrl || typeof wx === 'undefined' || !wx.setStorageSync) {
    return;
  }

  try {
    wx.setStorageSync(BACKEND_BASE_URL_CACHE_KEY, baseUrl);
  } catch (error) {
    // 缓存失败不影响当前请求，下一次再重新自动解析。
  }
}

function getCurrentLocalIPAddress() {
  // 微信运行环境支持时，直接取当前网络下设备的局域网 IP。
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.getLocalIPAddress) {
      resolve('');
      return;
    }

    wx.getLocalIPAddress({
      success(result) {
        resolve(result && (result.localip || result.localIp || result.ip) || '');
      },
      fail() {
        resolve('');
      }
    });
  });
}

function resolveBackendBaseUrlCandidates(preferredUrl) {
  return getCurrentLocalIPAddress().then((localIp) => {
    const candidates = [];

    pushUniqueBackendBaseUrl(candidates, preferredUrl);
    pushUniqueBackendBaseUrl(candidates, backendConfig.baseUrl);
    pushUniqueBackendBaseUrl(candidates, readCachedBackendBaseUrl());
    pushUniqueBackendBaseUrl(candidates, buildBackendBaseUrl(localIp));
    pushUniqueBackendBaseUrl(candidates, buildBackendBaseUrl('127.0.0.1'));
    pushUniqueBackendBaseUrl(candidates, buildBackendBaseUrl('localhost'));

    return candidates;
  });
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
  cacheBackendBaseUrl,
  normalizeBackendBaseUrl,
  normalizeBackendSocketUrl,
  resolveBackendBaseUrlCandidates,
  resolveBackendConfig
};
