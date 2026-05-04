// index.js


const { loadSensorState, saveSensorState, loadSensorHistory, saveSensorHistory } = require('../../utils/storage');
const { resolveAliyunConfig } = require('../../utils/aliyunConfig');
const { resolveBackendConfig, normalizeBackendBaseUrl } = require('../../utils/backendConfig');
const { MiniProgramMqttClient } = require('../../utils/mqttClient');

const THEME_KEY = 'page-theme';
const TOAST_LIMIT = 3;
const TOAST_STEP_RPX = 92;
const SENSOR_DIGIT_WIDTH_EM = 0.72;
const SENSOR_DOT_WIDTH_EM = 0.42;
const SENSOR_EMPTY_WIDTH_EM = 0.34;
const DEFAULT_SENSOR_STATE = {
  temperature: 26.5,
  humidity: 58
};
const SENSOR_HISTORY_LIMIT = 5;
const SENSOR_CHART_ANIMATION_MS = 420;
const SENSOR_CHART_RETRY_DELAY_MS = 80;
const SENSOR_CHART_MAX_RETRY = 8;
const SENSOR_CHART_SERIES = [
  {
    key: 'temperature',
    label: '温度',
    unit: 'C'
  },
  {
    key: 'humidity',
    label: '湿度',
    unit: '%'
  }
];
const SENSOR_FIELDS = Object.keys(DEFAULT_SENSOR_STATE);
const SENSOR_FIELD_SUFFIXES = {
  display: 'DisplayText',
  frames: 'DigitFrames',
  measureCurrent: 'MeasureCurrentFrames',
  measureNext: 'MeasureNextFrames',
  trackStyle: 'NumberTrackStyle',
  animating: 'Animating'
};
const MAX_TODO_COUNT = 5;
const BACKEND_CONFIG = resolveBackendConfig();
const BACKEND_BASE_URL = BACKEND_CONFIG.baseUrl;
const BACKEND_API_TOKEN = BACKEND_CONFIG.apiToken;
const BACKEND_SOCKET_RETRY_MS = BACKEND_CONFIG.socketRetryMs;

function buildBackendHeaders() {
  const headers = {
    'content-type': 'application/json'
  };

  if (BACKEND_API_TOKEN) {
    headers.Authorization = `Bearer ${BACKEND_API_TOKEN}`;
  }

  return headers;
}

function requestPromise(options) {
  return new Promise((resolve, reject) => {
    wx.request(
      Object.assign({}, options, {
        success: resolve,
        fail: reject
      })
    );
  });
}

function normalizeRequestError(error) {
  if (!error) {
    return '请求失败';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  if (error.errMsg) {
    return error.errMsg;
  }

  if (error.data && error.data.message) {
    return error.data.message;
  }

  return '请求失败';
}

function padTime(value) {
  return String(value).padStart(2, '0');
}

function formatTodoTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((todayStart - targetStart) / 86400000);
  const timePart = `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;

  if (diffDays === 0) {
    return `今天 ${timePart}`;
  }

  if (diffDays === 1) {
    return `昨天 ${timePart}`;
  }

  if (diffDays > 1 && diffDays < 7) {
    return `${diffDays}天前 ${timePart}`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${timePart}`;
  }

  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())} ${timePart}`;
}

function formatLogTime(value = Date.now()) {
  const date = new Date(value);
  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;
}

function createLogEntry(title, content) {
  return {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    time: formatLogTime(),
    title,
    content
  };
}

function mergeLogEntries(logs, entries) {
  return (entries || []).slice().reverse().concat(logs || []).slice(0, 20);
}

function formatSensorDisplay(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = typeof value === 'number' ? String(value) : String(value).trim();
  return text === 'NaN' ? '' : text;
}

function buildSensorDigitFrames(previousText, nextText, fixedLength) {
  const prev = formatSensorDisplay(previousText);
  const next = formatSensorDisplay(nextText);
  const length = Math.max(fixedLength || 0, prev.length, next.length, 1);
  const prevChars = prev.padEnd(length, ' ').split('');
  const nextChars = next.padEnd(length, ' ').split('');

  return prevChars.map((prevChar, index) => {
    const nextChar = nextChars[index];
    const isDot = prevChar === '.' || nextChar === '.';
    const isEmpty = prevChar === ' ' && nextChar === ' ';
    const prevClass = prevChar === ' ' ? 'is-empty' : '';
    const nextClass = nextChar === ' ' ? 'is-empty' : '';

    return {
      id: `sensor-digit-${index}-${prevChar}-${nextChar}`,
      prevChar,
      nextChar,
      isDot,
      isEmpty,
      prevClass,
      nextClass,
      slotClass: ['sensor-digit-slot', isDot ? 'is-dot' : '', isEmpty ? 'is-empty' : ''].filter(Boolean).join(' '),
      charStyle: `animation-delay: ${index * 26}ms;`,
      animate: prevChar !== nextChar
    };
  });
}

function buildSensorMeasureFrames(text) {
  return buildSensorDigitFrames(text, text);
}

function getSensorCharWidthEm(char) {
  if (!char || char === ' ') {
    return SENSOR_EMPTY_WIDTH_EM;
  }

  if (char === '.') {
    return SENSOR_DOT_WIDTH_EM;
  }

  return SENSOR_DIGIT_WIDTH_EM;
}

function buildSensorTrackWidthStyleByEm(widthEm) {
  return `width: ${Number(Math.max(widthEm, SENSOR_EMPTY_WIDTH_EM).toFixed(3))}em;`;
}

function buildSensorTrackWidthEm(text) {
  const value = formatSensorDisplay(text);
  const widthEm = value.split('').reduce((total, char) => total + getSensorCharWidthEm(char), 0);
  return Number(Math.max(widthEm, SENSOR_EMPTY_WIDTH_EM).toFixed(3));
}

function getSensorFieldName(field, key) {
  return `${field}${SENSOR_FIELD_SUFFIXES[key]}`;
}

function buildSensorFieldState(field, value) {
  const displayText = formatSensorDisplay(value);
  const trackWidthEm = buildSensorTrackWidthEm(displayText);

  return {
    [field]: value,
    [getSensorFieldName(field, 'display')]: displayText,
    [getSensorFieldName(field, 'frames')]: buildSensorDigitFrames(displayText, displayText),
    [getSensorFieldName(field, 'measureCurrent')]: buildSensorMeasureFrames(displayText),
    [getSensorFieldName(field, 'measureNext')]: buildSensorMeasureFrames(displayText),
    [getSensorFieldName(field, 'trackStyle')]: buildSensorTrackWidthStyleByEm(trackWidthEm),
    [getSensorFieldName(field, 'animating')]: false
  };
}

function buildSensorStatePatch(sensorState) {
  return SENSOR_FIELDS.reduce((patch, field) => {
    const nextValue =
      sensorState && sensorState[field] !== undefined ? sensorState[field] : DEFAULT_SENSOR_STATE[field];

    return Object.assign(patch, buildSensorFieldState(field, nextValue));
  }, {});
}

function normalizeSensorNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatSensorChartNumber(value) {
  const numberValue = normalizeSensorNumber(value);

  if (numberValue === null) {
    return '--';
  }

  return Number.isInteger(numberValue) ? String(numberValue) : String(Number(numberValue.toFixed(1)));
}

function formatSensorChartTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

function createSensorHistoryEntry(sensorState, timestamp = Date.now()) {
  const temperature = normalizeSensorNumber(sensorState && sensorState.temperature);
  const humidity = normalizeSensorNumber(sensorState && sensorState.humidity);

  if (temperature === null && humidity === null) {
    return null;
  }

  return {
    id: `sensor-history-${timestamp}`,
    timestamp,
    temperature,
    humidity
  };
}

function normalizeSensorHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((item, index) => {
      const temperature = normalizeSensorNumber(item && item.temperature);
      const humidity = normalizeSensorNumber(item && item.humidity);

      if (temperature === null && humidity === null) {
        return null;
      }

      const timestampValue = Number(item && item.timestamp);
      const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now() - index;

      return {
        id: (item && item.id) || `sensor-history-${timestamp}-${index}`,
        timestamp,
        temperature,
        humidity
      };
    })
    .filter(Boolean)
    .slice(-SENSOR_HISTORY_LIMIT);
}

function buildSensorHistorySeed(history, sensorState) {
  const normalizedHistory = normalizeSensorHistory(history);

  if (normalizedHistory.length) {
    return normalizedHistory;
  }

  const seed = createSensorHistoryEntry(sensorState);
  return seed ? [seed] : [];
}

function buildSensorChartDisplayState(history) {
  const normalizedHistory = normalizeSensorHistory(history);
  const latest = normalizedHistory[normalizedHistory.length - 1] || {};
  const emptyAxisCount = Math.max(SENSOR_HISTORY_LIMIT - normalizedHistory.length, 0);
  const emptyAxisLabels = Array.from({ length: emptyAxisCount }, (_, index) => ({
    id: `sensor-chart-axis-empty-${index}`,
    label: ''
  }));

  return {
    sensorChartLegend: SENSOR_CHART_SERIES.map((series) => ({
      key: series.key,
      label: series.label,
      valueText: `${formatSensorChartNumber(latest[series.key])}${series.unit}`
    })),
    sensorChartAxisLabels: emptyAxisLabels.concat(
      normalizedHistory.map((item, index) => ({
        id: `sensor-chart-axis-${item.timestamp}-${index}`,
        label: formatSensorChartTime(item.timestamp)
      }))
    )
  };
}

function buildSensorHistoryState(history) {
  const normalizedHistory = normalizeSensorHistory(history);

  return Object.assign(
    {
      sensorHistory: normalizedHistory
    },
    buildSensorChartDisplayState(normalizedHistory)
  );
}

function appendSensorHistory(history, sensorState) {
  const nextEntry = createSensorHistoryEntry(sensorState);
  const normalizedHistory = normalizeSensorHistory(history);

  if (!nextEntry) {
    return normalizedHistory;
  }

  return normalizedHistory.concat(nextEntry).slice(-SENSOR_HISTORY_LIMIT);
}

function buildNextSensorHistoryPatch(history, sensorState) {
  return buildSensorHistoryState(appendSensorHistory(history, sensorState));
}

function getCanvasPixelRatio() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Number(info && info.pixelRatio) || 1;
  } catch (error) {
    return 1;
  }
}

function setCanvasStrokeStyle(ctx, color) {
  if (typeof ctx.setStrokeStyle === 'function') {
    ctx.setStrokeStyle(color);
    return;
  }

  ctx.strokeStyle = color;
}

function setCanvasFillStyle(ctx, color) {
  if (typeof ctx.setFillStyle === 'function') {
    ctx.setFillStyle(color);
    return;
  }

  ctx.fillStyle = color;
}

function setCanvasLineWidth(ctx, width) {
  if (typeof ctx.setLineWidth === 'function') {
    ctx.setLineWidth(width);
    return;
  }

  ctx.lineWidth = width;
}

function setCanvasLineCap(ctx, lineCap) {
  if (typeof ctx.setLineCap === 'function') {
    ctx.setLineCap(lineCap);
    return;
  }

  ctx.lineCap = lineCap;
}

function setCanvasLineJoin(ctx, lineJoin) {
  if (typeof ctx.setLineJoin === 'function') {
    ctx.setLineJoin(lineJoin);
    return;
  }

  ctx.lineJoin = lineJoin;
}

function flushCanvasDraw(ctx) {
  if (typeof ctx.draw === 'function') {
    ctx.draw();
  }
}

function buildToastStyle(toast) {
  let translateX = '-50%';
  let translateY = -(toast.stackIndex || 0) * TOAST_STEP_RPX;
  let scale = 1;
  let opacity = 1;

  if (toast.entering) {
    translateY += 28;
    scale = 0.94;
    opacity = 0;
  } else if (toast.shifting) {
    translateY += 16;
    scale = 0.992;
  }

  if (toast.leaving && toast.leaveMode === 'overflow') {
    opacity = 0;
    scale = 0.96;
    translateY += 16;
  } else if (toast.leaving) {
    translateY += 16;
    opacity = 0;
    scale = 0.96;
  }

  return `transform: translate3d(${translateX}, ${translateY}rpx, 0) scale(${scale}); opacity: ${opacity};`;
}

function withToastStyles(toasts) {
  return (toasts || []).map((toast) =>
    Object.assign({}, toast, {
      style: buildToastStyle(toast)
    })
  );
}

function decorateTodos(todos) {
  return (todos || [])
    .filter((item) => !item.deleted)
    .map((item) => {
      const displayTime = formatTodoTime(item.updatedAt || item.createdAt);

      return Object.assign(
        {
          isRemoving: false,
          isToggling: false,
          isNew: false
        },
        item,
        {
          displayTime
        }
      );
    });
}

function findTodoIndexById(todos, id) {
  return (todos || []).findIndex((item) => item.id === id);
}

function sortTodos(todos) {
  return (todos || []).slice().sort((a, b) => {
    if (Boolean(a.completed) !== Boolean(b.completed)) {
      return a.completed ? 1 : -1;
    }

    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
  });
}

function extractCloudSensorState(payload) {
  if (!payload) {
    return null;
  }

  let parsed = payload;
  if (typeof payload === 'string') {
    try {
      const normalized = payload.trim();
      const jsonStart = normalized.indexOf('{');
      const jsonEnd = normalized.lastIndexOf('}');
      const jsonText =
        jsonStart >= 0 && jsonEnd >= jsonStart
          ? normalized.slice(jsonStart, jsonEnd + 1)
          : normalized;
      parsed = JSON.parse(jsonText);
    } catch (error) {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const temperature = Number(parsed.temp);
  const humidity = Number(parsed.humi);

  if (Number.isNaN(temperature) && Number.isNaN(humidity)) {
    return null;
  }

  return {
    temperature: Number.isNaN(temperature) ? null : temperature,
    humidity: Number.isNaN(humidity) ? null : humidity
  };
}

function normalizeTopic(topic) {
  return String(topic || '').trim();
}

function resolveNavigationLayout() {
  const systemInfo =
    typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const statusBarHeight = Number(systemInfo.statusBarHeight || 0);
  const windowWidth = Number(systemInfo.windowWidth || 375);
  let menuButtonRect = null;

  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      menuButtonRect = wx.getMenuButtonBoundingClientRect();
    }
  } catch (error) {
    menuButtonRect = null;
  }

  if (!menuButtonRect || !menuButtonRect.top || !menuButtonRect.height) {
    const titleHeight = 24;
    const titleTop = statusBarHeight + 10;
    const navBarHeight = titleTop + titleHeight;

    return {
      navBarStyle: `height: ${navBarHeight}px;`,
      navTitleStyle: `top: ${titleTop}px; height: ${titleHeight}px; line-height: ${titleHeight}px; left: 24rpx; right: 24rpx;`,
      contentLayerStyle: `padding-top: ${navBarHeight + 12}px;`
    };
  }

  const capsuleTop = Number(menuButtonRect.top || 0);
  const capsuleHeight = Number(menuButtonRect.height || 32);
  const capsuleBottom = Number(menuButtonRect.bottom || capsuleTop + capsuleHeight);
  const capsuleInset = Math.max(windowWidth - Number(menuButtonRect.left || windowWidth), 24);
  const titleInset = Math.max(capsuleInset + 16, 112);
  const titleHeight = 24;
  const titleTop = capsuleTop + Math.max(Math.round((capsuleHeight - titleHeight) / 2), 0);
  const navBarHeight = capsuleBottom;

  return {
    navBarStyle: `height: ${navBarHeight}px;`,
    navTitleStyle: `top: ${titleTop}px; height: ${titleHeight}px; line-height: ${titleHeight}px; left: ${titleInset}px; right: ${titleInset}px;`,
    contentLayerStyle: `padding-top: ${navBarHeight + 12}px;`
  };
}

Page({
  data: Object.assign(
    {
      activeTab: 'monitor',
      tabbarIndicatorStyle: '--tabbar-translate: 0%;',
      tabbarPressing: false,
      navBarStyle: '',
      navTitleStyle: '',
      contentLayerStyle: '',
      themeAnimating: false,
      showEmptyState: false,
      toasts: [],
      theme: 'light',
      mqttStatusText: 'MQTT 未连接',
      mqttConnected: false,
      todoInput: '',
      editingId: '',
      editingInput: '',
      todos: [],
      logs: []
    },
    buildSensorStatePatch(DEFAULT_SENSOR_STATE),
    buildSensorHistoryState(buildSensorHistorySeed([], DEFAULT_SENSOR_STATE))
  ),

  onLoad() {
    this.pageDestroyed = false;
    this.aliyunConfig = resolveAliyunConfig();
    const sensorState = loadSensorState();
    const sensorHistory = buildSensorHistorySeed(loadSensorHistory(), sensorState);
    const theme = this.loadTheme();
    const navigationLayout = resolveNavigationLayout();

    this.setData(
      Object.assign(
        {
          navBarStyle: navigationLayout.navBarStyle,
          navTitleStyle: navigationLayout.navTitleStyle,
          contentLayerStyle: navigationLayout.contentLayerStyle,
          theme,
          todos: [],
          showEmptyState: false
        },
        buildSensorStatePatch(sensorState),
        buildSensorHistoryState(sensorHistory)
      )
    );
    saveSensorHistory(sensorHistory);

    this.initMqttClient();
    this.initBackendSocket();
    this.loadTodosFromBackend();
  },

  onReady() {
    const sensorTrackPatch = SENSOR_FIELDS.reduce((patch, field) => {
      const trackStyleField = getSensorFieldName(field, 'trackStyle');
      const currentText = formatSensorDisplay(this.data[getSensorFieldName(field, 'display')]);
      const widthEm = buildSensorTrackWidthEm(currentText);
      this.sensorTrackWidthEm = this.sensorTrackWidthEm || {};
      this.sensorTrackWidthEm[field] = Math.max(this.sensorTrackWidthEm[field] || 0, widthEm);
      patch[trackStyleField] = buildSensorTrackWidthStyleByEm(this.sensorTrackWidthEm[field]);
      return patch;
    }, {});

    this.setData(sensorTrackPatch);
    this.sensorChartReady = true;
    this.scheduleSensorChartDraw(this.pendingSensorChartDraw || {
      animate: false
    }, 60);
    this.pendingSensorChartDraw = null;
  },

  onShow() {
    this.connectBackendSocket();
    this.sensorChartCanvasState = null;
    this.scheduleSensorChartDraw({
      animate: false
    }, 120);
    const now = Date.now();
    if (this.lastBackendSyncAt && now - this.lastBackendSyncAt < 3000) {
      return;
    }
    this.lastBackendSyncAt = now;
    this.loadTodosFromBackend({ silent: true }).catch(() => {});
  },

  onHide() {
    this.resetSensorChartRuntime();
    this.disconnectBackendSocket();
  },

  onUnload() {
    this.pageDestroyed = true;
    this.disconnectBackendSocket();
    if (this.toastTimers) {
      Object.keys(this.toastTimers).forEach((key) => {
        clearTimeout(this.toastTimers[key]);
      });
    }
    if (this.emptyStateTimer) {
      clearTimeout(this.emptyStateTimer);
    }
    if (this.toggleTodoTimer) {
      clearTimeout(this.toggleTodoTimer);
    }
    if (this.themeAnimationTimer) {
      clearTimeout(this.themeAnimationTimer);
    }
    if (this.removeTodoTimers) {
      Object.keys(this.removeTodoTimers).forEach((key) => {
        clearTimeout(this.removeTodoTimers[key]);
      });
    }
    if (this.sensorAnimationTimers) {
      Object.keys(this.sensorAnimationTimers).forEach((key) => {
        clearTimeout(this.sensorAnimationTimers[key]);
      });
    }
    if (this.sensorChartAnimationTimer) {
      clearTimeout(this.sensorChartAnimationTimer);
      this.sensorChartAnimationTimer = null;
    }
    if (this.sensorChartDrawTimer) {
      clearTimeout(this.sensorChartDrawTimer);
      this.sensorChartDrawTimer = null;
    }
    this.sensorChartCanvasState = null;
    if (this.mqttClient) {
      this.mqttClient.disconnect();
    }
  },

  requestBackend(options) {
    const path = String((options && options.path) || '').trim();
    const baseUrl = normalizeBackendBaseUrl(BACKEND_BASE_URL);

    return requestPromise({
      url: `${baseUrl}${path}`,
      method: (options && options.method) || 'GET',
      data: options && options.data,
      timeout: 10000,
      header: buildBackendHeaders()
    }).then((response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return response.data;
      }

      const data = response.data || {};
      const error = new Error(data.message || `请求失败 (${response.statusCode})`);
      error.statusCode = response.statusCode;
      error.data = data;
      throw error;
    });
  },

  applyTodoList(todos, extraPatch) {
    const nextTodos = sortTodos(decorateTodos(todos));
    const patch = Object.assign(
      {
        todos: nextTodos,
        showEmptyState: !nextTodos.length
      },
      extraPatch || {}
    );

    if (patch.editingId && findTodoIndexById(nextTodos, patch.editingId) < 0) {
      patch.editingId = '';
      patch.editingInput = '';
    }

    this.setData(patch);
    return nextTodos;
  },

  upsertTodo(todo, extraState, extraPatch) {
    const nextItem = Object.assign({}, decorateTodos([todo])[0], extraState || {});
    const nextTodos = sortTodos([nextItem].concat(this.data.todos.filter((item) => item.id !== nextItem.id)));

    this.setData(
      Object.assign(
        {
          todos: nextTodos,
          showEmptyState: !nextTodos.length
        },
        extraPatch || {}
      )
    );

    return nextTodos;
  },

  loadTodosFromBackend(options) {
    const config = options || {};

    return this.requestBackend({
      path: '/api/todos',
      method: 'GET'
    })
      .then((data) => {
        const nextTodos = this.applyTodoList((data && data.items) || []);
        this.lastBackendSyncAt = Date.now();

        if (config.showToast) {
          this.showToast({
            title: '同步成功',
            icon: 'success'
          });
        }

        if (!config.silent) {
          this.appendLog('后端同步', `已同步 ${nextTodos.length} 条待办`);
        }

        return nextTodos;
      })
      .catch((error) => {
        if (!config.silent) {
          this.showToast({
            title: '同步失败',
            icon: 'none'
          });
          this.appendLog('后端同步失败', normalizeRequestError(error));
        }

        throw error;
      });
  },

  initBackendSocket() {
    this.backendSocketUrl = BACKEND_CONFIG.socketUrl;
    this.backendSocketTask = null;
    this.backendSocketClosing = false;
    this.backendSocketReconnectTimer = null;
  },

  connectBackendSocket() {
    if (this.pageDestroyed || !this.backendSocketUrl || this.backendSocketTask) {
      return;
    }

    const headers = {};
    let socketUrl = this.backendSocketUrl;
    if (BACKEND_API_TOKEN) {
      headers.Authorization = `Bearer ${BACKEND_API_TOKEN}`;
      socketUrl = `${this.backendSocketUrl}?token=${encodeURIComponent(BACKEND_API_TOKEN)}`;
    }

    this.backendSocketClosing = false;
    this.backendSocketTask = wx.connectSocket({
      url: socketUrl,
      header: headers
    });

    this.backendSocketTask.onOpen(() => {
      this.appendLog('待办推送已连接', this.backendSocketUrl);
    });

    this.backendSocketTask.onMessage((message) => {
      this.handleBackendSocketMessage(message);
    });

    this.backendSocketTask.onError((error) => {
      const errorText = normalizeRequestError(error);
      this.appendLog('待办推送异常', errorText);
    });

    this.backendSocketTask.onClose((event) => {
      this.backendSocketTask = null;

      if (this.pageDestroyed || this.backendSocketClosing) {
        this.backendSocketClosing = false;
        return;
      }

      this.appendLog(
        '待办推送断开',
        event && event.code ? `${event.code}${event.reason ? ` ${event.reason}` : ''}` : '连接已关闭'
      );
      this.scheduleBackendSocketReconnect();
    });
  },

  disconnectBackendSocket() {
    if (this.backendSocketReconnectTimer) {
      clearTimeout(this.backendSocketReconnectTimer);
      this.backendSocketReconnectTimer = null;
    }

    if (!this.backendSocketTask) {
      return;
    }

    this.backendSocketClosing = true;
    this.backendSocketTask.close({});
    this.backendSocketTask = null;
  },

  scheduleBackendSocketReconnect() {
    if (this.backendSocketReconnectTimer || this.pageDestroyed) {
      return;
    }

    this.backendSocketReconnectTimer = setTimeout(() => {
      this.backendSocketReconnectTimer = null;
      this.connectBackendSocket();
    }, BACKEND_SOCKET_RETRY_MS);
  },

  handleBackendSocketMessage(message) {
    let parsed = null;

    try {
      parsed = JSON.parse(message.data);
    } catch (error) {
      this.appendLog('待办推送解析失败', String(message.data || ''));
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    if (parsed.type === 'todo.snapshot') {
      this.applyTodoList(parsed.todos || []);
      this.lastBackendSyncAt = Date.now();
      this.appendLog('待办已同步', '收到全量待办推送');
      return;
    }

    if (parsed.type === 'todo.upsert' && parsed.todo) {
      this.upsertTodo(parsed.todo);
      this.lastBackendSyncAt = Date.now();
      this.appendLog(
        '待办已刷新',
        `${parsed.todo.id} ${parsed.todo.completed ? '已完成' : '未完成'} ${formatTodoTime(parsed.todo.updatedAt)}`
      );
      return;
    }

    if (parsed.type === 'todo.delete' && parsed.todo) {
      const nextTodos = (this.data.todos || []).filter((item) => item.id !== parsed.todo.id);
      this.setData({
        todos: nextTodos,
        showEmptyState: !nextTodos.length
      });
      this.lastBackendSyncAt = Date.now();
      this.appendLog('待办已删除', parsed.todo.id);
    }
  },

  resolveSensorChartCanvas() {
    if (
      this.sensorChartCanvasState &&
      this.data.activeTab === 'monitor' &&
      this.sensorChartCanvasState.ctx &&
      this.sensorChartCanvasState.width &&
      this.sensorChartCanvasState.height
    ) {
      return Promise.resolve(this.sensorChartCanvasState);
    }

    return new Promise((resolve) => {
      wx.nextTick(() => {
        let query = wx.createSelectorQuery();
        if (typeof query.in === 'function') {
          query = query.in(this);
        }
        query.select('#sensorTrendCanvas').fields({
          node: true,
          size: true
        });
        query.select('#sensorTrendPlot').boundingClientRect();
        query.exec((results) => {
          const canvasInfo = results && results[0];
          const plotRect = results && results[1];
          const width = Number((canvasInfo && canvasInfo.width) || (plotRect && plotRect.width) || 0);
          const height = Number((canvasInfo && canvasInfo.height) || (plotRect && plotRect.height) || 0);

          if (canvasInfo && canvasInfo.node && typeof canvasInfo.node.getContext === 'function' && width && height) {
            const dpr = getCanvasPixelRatio();
            const canvas = canvasInfo.node;
            canvas.width = Math.max(Math.round(width * dpr), 1);
            canvas.height = Math.max(Math.round(height * dpr), 1);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.scale(dpr, dpr);
              const canvasState = {
                ctx,
                width,
                height
              };
              this.sensorChartCanvasState = canvasState;
              resolve(canvasState);
              return;
            }
          }

          const canvasState = {
            ctx: wx.createCanvasContext('sensorTrendCanvas', this),
            width,
            height
          };
          if (width && height && canvasState.ctx) {
            this.sensorChartCanvasState = canvasState;
          }
          resolve(canvasState);
        });
      });
    });
  },

  getSensorChartColors() {
    if (this.data.theme === 'dark') {
      return {
        grid: 'rgba(159, 176, 194, 0.18)',
        temperature: 'rgba(255, 126, 170, 0.92)',
        humidity: 'rgba(73, 219, 255, 0.92)',
        pointFill: 'rgba(19, 24, 32, 0.96)'
      };
    }

    return {
      grid: 'rgba(115, 129, 147, 0.16)',
      temperature: 'rgba(255, 112, 126, 0.92)',
      humidity: 'rgba(76, 169, 229, 0.92)',
      pointFill: 'rgba(247, 250, 255, 0.96)'
    };
  },

  buildSensorCanvasSeriesPoints(history, seriesKey, rect) {
    const normalizedHistory = normalizeSensorHistory(history);
    const values = normalizedHistory
      .map((item) => normalizeSensorNumber(item && item[seriesKey]))
      .filter((value) => value !== null);

    if (!values.length || !rect.width || !rect.height) {
      return [];
    }

    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    const valueRange = maxValue - minValue || 1;
    const paddedMin = minValue - valueRange * 0.12;
    const paddedMax = maxValue + valueRange * 0.12;
    const paddedRange = paddedMax - paddedMin || 1;
    const paddingX = 14;
    const paddingTop = 10;
    const paddingBottom = 14;
    const usableWidth = Math.max(rect.width - paddingX * 2, 1);
    const usableHeight = Math.max(rect.height - paddingTop - paddingBottom, 1);
    const itemCount = Math.max(normalizedHistory.length, 1);
    const slotCount = SENSOR_HISTORY_LIMIT;
    const slotOffset = Math.max(slotCount - itemCount, 0);

    return normalizedHistory
      .map((item, index) => {
        const value = normalizeSensorNumber(item && item[seriesKey]);

        if (value === null) {
          return null;
        }

        const slotIndex = slotOffset + index;
        const x = paddingX + (usableWidth * slotIndex) / (slotCount - 1);
        const y = paddingTop + (1 - (value - paddedMin) / paddedRange) * usableHeight;

        return {
          x,
          y,
          latest: index === normalizedHistory.length - 1
        };
      })
      .filter(Boolean);
  },

  buildSensorChartPointMap(history, rect) {
    return SENSOR_CHART_SERIES.reduce((pointMap, series) => {
      pointMap[series.key] = this.buildSensorCanvasSeriesPoints(history, series.key, rect);
      return pointMap;
    }, {});
  },

  interpolateSensorChartPoints(fromPoints, toPoints, progress) {
    return (toPoints || []).map((point, index) => {
      const fromPoint = (fromPoints || [])[index] || point;

      return {
        x: fromPoint.x + (point.x - fromPoint.x) * progress,
        y: fromPoint.y + (point.y - fromPoint.y) * progress,
        latest: point.latest
      };
    });
  },

  drawSmoothSensorLine(ctx, points, color, pointFill) {
    if (!points.length) {
      return;
    }

    setCanvasStrokeStyle(ctx, color);
    setCanvasLineWidth(ctx, 2.2);
    setCanvasLineCap(ctx, 'round');
    setCanvasLineJoin(ctx, 'round');

    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const controlX = (current.x + next.x) / 2;
        ctx.bezierCurveTo(controlX, current.y, controlX, next.y, next.x, next.y);
      }
      ctx.stroke();
    } else {
      const point = points[0];
      ctx.beginPath();
      ctx.moveTo(Math.max(point.x - 18, 0), point.y);
      ctx.lineTo(point.x + 18, point.y);
      ctx.stroke();
    }

    points.forEach((point) => {
      const radius = point.latest ? 3.8 : 3;
      ctx.beginPath();
      setCanvasFillStyle(ctx, pointFill);
      ctx.arc(point.x, point.y, radius + 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      setCanvasFillStyle(ctx, color);
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  },

  drawSensorChartFrame(ctx, rect, fromPointMap, toPointMap, progress) {
    const colors = this.getSensorChartColors();
    const width = rect.width;
    const height = rect.height;
    const paddingX = 14;
    const paddingTop = 10;
    const paddingBottom = 14;
    const gridTop = paddingTop;
    const gridMiddle = paddingTop + (height - paddingTop - paddingBottom) / 2;
    const gridBottom = height - paddingBottom;

    ctx.clearRect(0, 0, width, height);
    setCanvasStrokeStyle(ctx, colors.grid);
    setCanvasLineWidth(ctx, 1);
    [gridTop, gridMiddle, gridBottom].forEach((gridY) => {
      ctx.beginPath();
      ctx.moveTo(paddingX, gridY);
      ctx.lineTo(width - paddingX, gridY);
      ctx.stroke();
    });

    SENSOR_CHART_SERIES.forEach((series) => {
      const fromPoints = (fromPointMap && fromPointMap[series.key]) || [];
      const toPoints = (toPointMap && toPointMap[series.key]) || [];
      const points = this.interpolateSensorChartPoints(fromPoints, toPoints, progress);
      this.drawSmoothSensorLine(ctx, points, colors[series.key], colors.pointFill);
    });

    flushCanvasDraw(ctx);
  },

  scheduleSensorChartDraw(options = {}, delay = 0) {
    if (this.pageDestroyed) {
      return;
    }

    const nextOptions = Object.assign({}, options);
    if (this.sensorChartDrawTimer) {
      clearTimeout(this.sensorChartDrawTimer);
      this.sensorChartDrawTimer = null;
    }

    if (!delay) {
      this.drawSensorChart(nextOptions);
      return;
    }

    this.sensorChartDrawTimer = setTimeout(() => {
      this.sensorChartDrawTimer = null;
      this.drawSensorChart(nextOptions);
    }, delay);
  },

  resetSensorChartRuntime() {
    if (this.sensorChartAnimationTimer) {
      clearTimeout(this.sensorChartAnimationTimer);
      this.sensorChartAnimationTimer = null;
    }
    if (this.sensorChartDrawTimer) {
      clearTimeout(this.sensorChartDrawTimer);
      this.sensorChartDrawTimer = null;
    }
    this.sensorChartAnimationToken = (this.sensorChartAnimationToken || 0) + 1;
    this.sensorChartCanvasState = null;
  },

  drawSensorChart(options = {}) {
    if (this.pageDestroyed) {
      return;
    }

    if (!this.sensorChartReady || this.data.activeTab !== 'monitor') {
      this.pendingSensorChartDraw = options;
      return;
    }

    if (this.sensorChartAnimationTimer) {
      clearTimeout(this.sensorChartAnimationTimer);
      this.sensorChartAnimationTimer = null;
    }

    const toHistory = normalizeSensorHistory(options.history || this.data.sensorHistory);
    const fromHistory = normalizeSensorHistory(options.fromHistory || toHistory);
    const shouldAnimate = Boolean(options.animate && fromHistory.length && toHistory.length);
    const retryCount = Number(options.retryCount || 0);
    const token = (this.sensorChartAnimationToken || 0) + 1;
    this.sensorChartAnimationToken = token;

    this.resolveSensorChartCanvas().then((canvasState) => {
      if (this.pageDestroyed || this.sensorChartAnimationToken !== token) {
        return;
      }
      if (this.data.activeTab !== 'monitor') {
        return;
      }

      if (!canvasState.width || !canvasState.height || !canvasState.ctx) {
        if (retryCount < SENSOR_CHART_MAX_RETRY) {
          this.scheduleSensorChartDraw(
            Object.assign({}, options, {
              animate: false,
              retryCount: retryCount + 1
            }),
            SENSOR_CHART_RETRY_DELAY_MS
          );
        }
        return;
      }

      const ctx = canvasState.ctx;
      const rect = {
        width: canvasState.width,
        height: canvasState.height
      };
      const fromPointMap = this.buildSensorChartPointMap(fromHistory, rect);
      const toPointMap = this.buildSensorChartPointMap(toHistory, rect);

      if (!shouldAnimate) {
        this.drawSensorChartFrame(ctx, rect, toPointMap, toPointMap, 1);
        return;
      }

      const startTime = Date.now();
      const drawFrame = () => {
        if (this.pageDestroyed || this.sensorChartAnimationToken !== token) {
          return;
        }
        if (this.data.activeTab !== 'monitor') {
          return;
        }

        const elapsed = Date.now() - startTime;
        const rawProgress = Math.min(elapsed / SENSOR_CHART_ANIMATION_MS, 1);
        const progress = 1 - Math.pow(1 - rawProgress, 3);
        this.drawSensorChartFrame(ctx, rect, fromPointMap, toPointMap, progress);

        if (rawProgress < 1) {
          this.sensorChartAnimationTimer = setTimeout(drawFrame, 16);
        } else {
          this.sensorChartAnimationTimer = null;
        }
      };

      drawFrame();
    });
  },

  animateSensorValue(field, nextValue) {
    const valueField = field;
    const displayField = getSensorFieldName(field, 'display');
    const framesField = getSensorFieldName(field, 'frames');
    const measureCurrentFramesField = getSensorFieldName(field, 'measureCurrent');
    const measureNextFramesField = getSensorFieldName(field, 'measureNext');
    const trackStyleField = getSensorFieldName(field, 'trackStyle');
    const animatingField = getSensorFieldName(field, 'animating');
    const currentValue = this.data[valueField];
    const nextText = formatSensorDisplay(nextValue);
    const currentText = formatSensorDisplay(this.data[displayField] || currentValue);
    const stableLength = Math.max(currentText.length, nextText.length, 1);
    const currentWidthEm = buildSensorTrackWidthEm(currentText);
    const nextWidthEm = buildSensorTrackWidthEm(nextText);
    this.sensorTrackWidthEm = this.sensorTrackWidthEm || {};
    const stableWidthEm = Math.max(this.sensorTrackWidthEm[field] || 0, currentWidthEm, nextWidthEm);
    this.sensorTrackWidthEm[field] = stableWidthEm;

    if (currentText === nextText) {
      return {
        [displayField]: nextText,
        [framesField]: buildSensorDigitFrames(nextText, nextText),
        [measureCurrentFramesField]: buildSensorMeasureFrames(nextText),
        [measureNextFramesField]: buildSensorMeasureFrames(nextText),
        [trackStyleField]: buildSensorTrackWidthStyleByEm(stableWidthEm),
        [animatingField]: false
      };
    }

    this.sensorAnimationTokens = this.sensorAnimationTokens || {};
    const token = (this.sensorAnimationTokens[field] || 0) + 1;
    this.sensorAnimationTokens[field] = token;

    const patch = {
      [displayField]: nextText,
      [framesField]: buildSensorDigitFrames(currentText, nextText, stableLength),
      [measureCurrentFramesField]: buildSensorMeasureFrames(currentText),
      [measureNextFramesField]: buildSensorMeasureFrames(nextText),
      [trackStyleField]: buildSensorTrackWidthStyleByEm(stableWidthEm),
      [animatingField]: true
    };

    this.sensorAnimationTimers = this.sensorAnimationTimers || {};
    if (this.sensorAnimationTimers[field]) {
      clearTimeout(this.sensorAnimationTimers[field]);
      this.sensorAnimationTimers[field] = null;
    }

    this.sensorAnimationTimers[field] = setTimeout(() => {
      if (this.pageDestroyed) {
        return;
      }
      if (this.sensorAnimationTokens[field] !== token) {
        return;
      }

      this.setData({
        [animatingField]: false,
        [framesField]: buildSensorDigitFrames(nextText, nextText),
        [measureCurrentFramesField]: buildSensorMeasureFrames(nextText),
        [measureNextFramesField]: buildSensorMeasureFrames(nextText),
        [trackStyleField]: buildSensorTrackWidthStyleByEm(stableWidthEm)
      });
      this.sensorAnimationTimers[field] = null;
    }, 360);

    return patch;
  },

  showToast(options) {
    const config = typeof options === 'string' ? { title: options } : options || {};
    const duration = config.duration || 1800;
    const existingToasts = (this.data.toasts || []).filter((item) => !item.leaving);
    const currentToasts = existingToasts.map((item, index) =>
      Object.assign({}, item, {
        stackIndex: index + 1,
        shifting: true,
        entering: false
      })
    );
    const toast = {
      id: `toast-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      text: config.title || '',
      type: config.icon === 'success' ? 'success' : 'info',
      entering: true,
      leaving: false,
      shifting: false,
      stackIndex: 0,
      leaveMode: ''
    };

    this.toastTimers = this.toastTimers || {};
    this.setData({
      toasts: withToastStyles([toast].concat(currentToasts))
    });

    if (existingToasts.length >= TOAST_LIMIT) {
      const overflowToast = existingToasts[TOAST_LIMIT - 1];
      if (overflowToast) {
        const overflowIndex = [toast].concat(currentToasts).findIndex((item) => item.id === overflowToast.id);
        if (overflowIndex >= 0) {
          if (this.toastTimers[overflowToast.id]) {
            clearTimeout(this.toastTimers[overflowToast.id]);
          }
          this.setData({
            toasts: withToastStyles(
              (this.data.toasts || []).map((item) =>
                item.id === overflowToast.id
                  ? Object.assign({}, item, { leaving: true, leaveMode: 'overflow', shifting: false })
                  : item
              )
            )
          });
          this.toastTimers[overflowToast.id] = setTimeout(() => {
            this.setData({
              toasts: withToastStyles((this.data.toasts || []).filter((item) => item.id !== overflowToast.id))
            });
            delete this.toastTimers[overflowToast.id];
          }, 180);
        }
      }
    }

    setTimeout(() => {
      this.setData({
        toasts: withToastStyles(
          (this.data.toasts || []).map((item) =>
            item.id === toast.id
              ? Object.assign({}, item, { entering: false })
              : Object.assign({}, item, { shifting: false })
          )
        )
      });
    }, 34);

    this.toastTimers[toast.id] = setTimeout(() => {
      const toastIndex = (this.data.toasts || []).findIndex((item) => item.id === toast.id);
      if (toastIndex < 0) {
        delete this.toastTimers[toast.id];
        return;
      }

      this.setData({
        toasts: withToastStyles(
          (this.data.toasts || []).map((item) =>
            item.id === toast.id
              ? Object.assign({}, item, { leaving: true, leaveMode: 'timeout' })
              : item
          )
        )
      });

      this.toastTimers[toast.id] = setTimeout(() => {
        this.setData({
          toasts: withToastStyles((this.data.toasts || []).filter((item) => item.id !== toast.id))
        });
        delete this.toastTimers[toast.id];
      }, 180);
    }, duration);
  },

  appendLog(title, content) {
    this.setData({
      logs: mergeLogEntries(this.data.logs, [createLogEntry(title, content)])
    });
  },

  scheduleEmptyState(visible, delay = 0) {
    if (this.emptyStateTimer) {
      clearTimeout(this.emptyStateTimer);
      this.emptyStateTimer = null;
    }

    if (!delay) {
      this.setData({
        showEmptyState: visible
      });
      return;
    }

    this.emptyStateTimer = setTimeout(() => {
      this.setData({
        showEmptyState: visible
      });
      this.emptyStateTimer = null;
    }, delay);
  },

  loadTheme() {
    try {
      return wx.getStorageSync(THEME_KEY) || 'light';
    } catch (error) {
      return 'light';
    }
  },

  saveTheme(theme) {
    try {
      wx.setStorageSync(THEME_KEY, theme);
    } catch (error) {
      return;
    }
  },

  toggleTheme() {
    const nextTheme = this.data.theme === 'light' ? 'dark' : 'light';
    if (this.themeAnimationTimer) {
      clearTimeout(this.themeAnimationTimer);
    }
    this.setData({
      theme: nextTheme,
      themeAnimating: true
    }, () => {
      this.scheduleSensorChartDraw({
        animate: false
      }, 60);
    });
    this.saveTheme(nextTheme);
    this.themeAnimationTimer = setTimeout(() => {
      this.setData({
        themeAnimating: false
      });
      this.themeAnimationTimer = null;
    }, 420);
  },

  initMqttClient() {
    this.mqttClient = new MiniProgramMqttClient(this.aliyunConfig);

    this.mqttClient.on('connect', () => {
      this.mqttClient.subscribe(this.aliyunConfig.customRecvTopic);
      this.appendLog('MQTT 已连接', `订阅 ${this.aliyunConfig.customRecvTopic}`);
      this.showToast({
        title: '连接成功',
        icon: 'success'
      });
    });

    this.mqttClient.on('message', (message) => {
      const cloudSensorState = extractCloudSensorState(message.payload);
      const messageTopic = normalizeTopic(message.topic);
      const targetTopic = normalizeTopic(this.aliyunConfig.customRecvTopic);
      const isCloudDataTopic = messageTopic === targetTopic;
      const logEntries = [];
      if (isCloudDataTopic) {
        console.log('[MQTT recv_data]', message.topic, message.payload);
        logEntries.push(createLogEntry('收到消息', `${message.topic}\n${message.payload}`));
      }
      const patch = {};
      let previousSensorHistory = null;
      let nextSensorHistory = null;

      if (isCloudDataTopic && cloudSensorState) {
        if (cloudSensorState.temperature !== null) {
          Object.assign(patch, this.animateSensorValue('temperature', cloudSensorState.temperature));
          patch.temperature = cloudSensorState.temperature;
        }
        if (cloudSensorState.humidity !== null) {
          Object.assign(patch, this.animateSensorValue('humidity', cloudSensorState.humidity));
          patch.humidity = cloudSensorState.humidity;
        }
        const nextSensorState = {
          temperature: Number(patch.temperature !== undefined ? patch.temperature : this.data.temperature),
          humidity: Number(patch.humidity !== undefined ? patch.humidity : this.data.humidity)
        };
        previousSensorHistory = this.data.sensorHistory || [];
        const historyPatch = buildNextSensorHistoryPatch(previousSensorHistory, nextSensorState);
        nextSensorHistory = historyPatch.sensorHistory;
        Object.assign(patch, historyPatch);
        saveSensorState(nextSensorState);
        saveSensorHistory(nextSensorHistory);
        logEntries.push(createLogEntry('界面已更新', `温度 ${nextSensorState.temperature}C / 湿度 ${nextSensorState.humidity}%`));
      }

      if (logEntries.length) {
        patch.logs = mergeLogEntries(this.data.logs, logEntries);
      }

      if (Object.keys(patch).length) {
        this.setData(patch, () => {
          if (nextSensorHistory) {
            this.scheduleSensorChartDraw({
              animate: true,
              fromHistory: previousSensorHistory,
              history: nextSensorHistory
            }, 40);
          }
        });
      }
    });

    this.mqttClient.on('error', (error) => {
      const errorText =
        (error && (error.errMsg || error.message)) ||
        (typeof error === 'string' ? error : 'MQTT 连接失败');
      this.showToast({
        title: '连接失败',
        icon: 'none'
      });
      this.appendLog('连接失败', errorText);
    });

    this.mqttClient.on('close', (event) => {
      const closeText =
        event && event.code
          ? `连接关闭: ${event.code}${event.reason ? ` ${event.reason}` : ''}`
          : '连接已关闭';
      this.appendLog('连接关闭', closeText);
    });

    this.mqttClient.on('state', (state) => {
      if (this.data.mqttConnected === state.connected && this.data.mqttStatusText === state.text) {
        return;
      }

      this.setData({
        mqttConnected: state.connected,
        mqttStatusText: state.text
      });
      this.appendLog('状态更新', state.text);
    });
  },

  syncTabbarIndicator(tab) {
    const safeProgress = tab === 'todo' ? 1 : 0;

    this.setData({
      tabbarIndicatorStyle: `--tabbar-translate: ${safeProgress * 100}%;`
    });
  },

  setActiveTab(tab) {
    const previousTab = this.data.activeTab;
    const leavingMonitor = previousTab === 'monitor' && tab !== 'monitor';
    const enteringMonitor = previousTab !== 'monitor' && tab === 'monitor';
    if (leavingMonitor || enteringMonitor) {
      this.resetSensorChartRuntime();
    }
    const safeProgress = tab === 'todo' ? 1 : 0;
    this.setData({
      activeTab: tab,
      tabbarIndicatorStyle: `--tabbar-translate: ${safeProgress * 100}%;`
    }, () => {
      if (tab === 'monitor') {
        this.scheduleSensorChartDraw({
          animate: false
        }, enteringMonitor ? 180 : 100);
      }
    });
  },

  switchTab(event) {
    const { tab } = event.currentTarget.dataset;
    if (!tab || tab === this.data.activeTab) {
      return;
    }

    this.setActiveTab(tab);
  },

  handleTabPressStart() {
    this.setData({
      tabbarPressing: true
    });
  },

  handleTabPressEnd() {
    if (!this.data.tabbarPressing) {
      return;
    }

    this.setData({
      tabbarPressing: false
    });
  },

  forceRefreshCloudData() {
    const sensorState = {
      temperature: Number(this.data.temperature),
      humidity: Number(this.data.humidity)
    };
    const previousSensorHistory = this.data.sensorHistory || [];
    const historyPatch = buildNextSensorHistoryPatch(previousSensorHistory, sensorState);
    historyPatch.logs = mergeLogEntries(this.data.logs, [
      createLogEntry('界面刷新', `温度 ${sensorState.temperature}C / 湿度 ${sensorState.humidity}%`)
    ]);

    saveSensorState(sensorState);
    saveSensorHistory(historyPatch.sensorHistory);
    this.setData(historyPatch, () => {
      this.scheduleSensorChartDraw({
        animate: true,
        fromHistory: previousSensorHistory,
        history: historyPatch.sensorHistory
      }, 40);
    });
    this.showToast({
      title: '界面已刷新',
      icon: 'success'
    });
  },

  handleTodoInput(event) {
    this.setData({
      todoInput: event.detail.value
    });
  },

  handleEditTodoInput(event) {
    this.setData({
      editingInput: event.detail.value
    });
  },

  addTodo() {
    const title = (this.data.todoInput || '').trim();
    if (!title) {
      this.showToast({
        title: '请输入内容',
        icon: 'none'
      });
      return;
    }

    if ((this.data.todos || []).length >= MAX_TODO_COUNT) {
      this.showToast({
        title: `最多 ${MAX_TODO_COUNT} 条待办`,
        icon: 'none'
      });
      return;
    }

    this.requestBackend({
      path: '/api/todos',
      method: 'POST',
      data: {
        title
      }
    })
      .then((todo) => {
        const nextTodos = this.upsertTodo(todo, { isNew: true }, {
          todoInput: '',
          showEmptyState: false
        });

        this.showToast({
          title: '添加成功',
          icon: 'success'
        });
        this.appendLog('后端新增', `已新增待办: ${todo.title}`);

        setTimeout(() => {
          const targetIndex = findTodoIndexById(this.data.todos, nextTodos[0] && nextTodos[0].id);
          if (targetIndex < 0) {
            return;
          }
          this.setData({
            [`todos[${targetIndex}].isNew`]: false
          });
        }, 360);
      })
      .catch((error) => {
        this.showToast({
          title: '添加失败',
          icon: 'none'
        });
        this.appendLog('后端新增失败', normalizeRequestError(error));
      });
  },

  updateTodo() {
    const title = (this.data.editingInput || '').trim();
    const { editingId } = this.data;

    if (!title || !editingId) {
      this.showToast({
        title: '请输入内容',
        icon: 'none'
      });
      return;
    }

    this.requestBackend({
      path: `/api/todos/${editingId}`,
      method: 'PATCH',
      data: {
        title
      }
    })
      .then((todo) => {
        this.upsertTodo(todo, null, {
          editingId: '',
          editingInput: '',
          showEmptyState: false
        });

        this.showToast({
          title: '更新成功',
          icon: 'success'
        });
        this.appendLog('后端更新', `已更新待办: ${todo.title}`);
      })
      .catch((error) => {
        this.showToast({
          title: '更新失败',
          icon: 'none'
        });
        this.appendLog('后端更新失败', normalizeRequestError(error));
      });
  },

  startEditTodo(event) {
    const { id } = event.currentTarget.dataset;
    const target = this.data.todos.find((item) => item.id === id);
    if (!target) {
      return;
    }

    this.setData({
      editingId: id,
      editingInput: target.title,
      activeTab: 'todo',
      tabbarIndicatorStyle: '--tabbar-translate: 100%;'
    });
  },

  cancelEdit() {
    this.setData({
      editingId: '',
      editingInput: ''
    });
  },

  toggleTodo(event) {
    const { id } = event.currentTarget.dataset;
    const targetIndex = findTodoIndexById(this.data.todos, id);
    const target = targetIndex >= 0 ? this.data.todos[targetIndex] : null;

    if (!target || target.isRemoving) {
      return;
    }

    const nextCompleted = !target.completed;
    const request = this.requestBackend({
      path: `/api/todos/${id}`,
      method: 'PATCH',
      data: {
        completed: nextCompleted
      }
    });

    this.setData({
      [`todos[${targetIndex}].completed`]: nextCompleted,
      [`todos[${targetIndex}].isToggling`]: true,
      [`todos[${targetIndex}].updatedAt`]: Date.now(),
      [`todos[${targetIndex}].displayTime`]: formatTodoTime(Date.now())
    });

    if (this.toggleTodoTimer) {
      clearTimeout(this.toggleTodoTimer);
    }

    this.toggleTodoTimer = setTimeout(() => {
      request
        .then((todo) => {
          this.upsertTodo(todo, { isToggling: false });
          this.appendLog('后端勾选', `${todo.title} ${todo.completed ? '已完成' : '未完成'}`);
        })
        .catch((error) => {
          this.showToast({
            title: '状态更新失败',
            icon: 'none'
          });
          this.appendLog('后端勾选失败', normalizeRequestError(error));
          this.loadTodosFromBackend({ silent: true }).catch(() => {});
        })
        .finally(() => {
          this.toggleTodoTimer = null;
        });
    }, 280);
  },

  deleteTodo(event) {
    const { id } = event.currentTarget.dataset;
    const targetIndex = findTodoIndexById(this.data.todos, id);
    const target = targetIndex >= 0 ? this.data.todos[targetIndex] : null;
    if (!target || target.isRemoving) {
      return;
    }

    if (this.data.editingId === id) {
      this.cancelEdit();
    }

    const request = this.requestBackend({
      path: `/api/todos/${id}`,
      method: 'DELETE'
    });

    const todos = (this.data.todos || []).map((item) =>
      item.id === id
        ? Object.assign({}, item, {
            isRemoving: true
          })
        : item
    );

    this.setData({
      todos
    });

    this.removeTodoTimers = this.removeTodoTimers || {};
    if (this.removeTodoTimers[id]) {
      clearTimeout(this.removeTodoTimers[id]);
    }

    this.removeTodoTimers[id] = setTimeout(() => {
      request
        .then(() => {
          const nextTodos = this.data.todos.filter((item) => item.id !== id);
          this.setData({
            todos: nextTodos,
            showEmptyState: false
          });
          this.scheduleEmptyState(!nextTodos.length, nextTodos.length ? 0 : 320);
          this.showToast({
            title: '删除成功',
            icon: 'success'
          });
          this.appendLog('后端删除', `已删除待办: ${target.title}`);
        })
        .catch((error) => {
          this.showToast({
            title: '删除失败',
            icon: 'none'
          });
          this.appendLog('后端删除失败', normalizeRequestError(error));
          this.loadTodosFromBackend({ silent: true }).catch(() => {});
        })
        .finally(() => {
          delete this.removeTodoTimers[id];
        });
    }, 240);
  },

  connectMqtt() {
    this.mqttClient.connect();
  },

  reconnectMqtt() {
    if (!this.mqttClient) {
      return;
    }

    this.appendLog('手动重连', '准备重新建立 MQTT 连接');
    this.mqttClient.disconnect();
    setTimeout(() => {
      this.mqttClient.connect();
    }, 160);
  },

  disconnectMqtt() {
    this.mqttClient.disconnect();
  },

  submitTodosToAliyun() {
    this.loadTodosFromBackend({ showToast: true, silent: true })
      .then((todos) => {
        const message = `小程序已同步后端 ${todos.length} 条待办\n${normalizeBackendBaseUrl(BACKEND_BASE_URL)}`;
        this.appendLog('手动同步后端', message);
      })
      .catch((error) => {
        this.appendLog('手动同步失败', normalizeRequestError(error));
      });
  }
});
