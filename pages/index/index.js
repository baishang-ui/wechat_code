// index.js


const { loadSensorState, saveSensorState } = require('../../utils/storage');
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

function buildSensorTrackWidthStyle(text) {
  const widthEm = buildSensorTrackWidthEm(text);
  return `width: ${widthEm}em;`;
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

  return {
    [field]: value,
    [getSensorFieldName(field, 'display')]: displayText,
    [getSensorFieldName(field, 'frames')]: buildSensorDigitFrames(displayText, displayText),
    [getSensorFieldName(field, 'measureCurrent')]: buildSensorMeasureFrames(displayText),
    [getSensorFieldName(field, 'measureNext')]: buildSensorMeasureFrames(displayText),
    [getSensorFieldName(field, 'trackStyle')]: buildSensorTrackWidthStyle(displayText),
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
    buildSensorStatePatch(DEFAULT_SENSOR_STATE)
  ),

  onLoad() {
    this.pageDestroyed = false;
    this.aliyunConfig = resolveAliyunConfig();
    const sensorState = loadSensorState();
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
        buildSensorStatePatch(sensorState)
      )
    );

    this.initMqttClient();
    this.initBackendSocket();
    this.loadTodosFromBackend();
  },

  onReady() {
    SENSOR_FIELDS.forEach((field) => {
      this.syncSensorTrackWidth(field);
    });
  },

  onShow() {
    this.connectBackendSocket();
    const now = Date.now();
    if (this.lastBackendSyncAt && now - this.lastBackendSyncAt < 3000) {
      return;
    }
    this.lastBackendSyncAt = now;
    this.loadTodosFromBackend({ silent: true }).catch(() => {});
  },

  onHide() {
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

  upsertTodo(todo, extraState) {
    const nextItem = Object.assign({}, decorateTodos([todo])[0], extraState || {});
    const nextTodos = sortTodos([nextItem].concat(this.data.todos.filter((item) => item.id !== nextItem.id)));

    this.setData({
      todos: nextTodos,
      showEmptyState: !nextTodos.length
    });

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

  measureSensorTrackWidth(field) {
    return new Promise((resolve) => {
      const currentSelector = `#${field}MeasureCurrentTrack`;
      const nextSelector = `#${field}MeasureNextTrack`;

      wx.nextTick(() => {
        const query = wx.createSelectorQuery();
        query.select(currentSelector).boundingClientRect();
        query.select(nextSelector).boundingClientRect();
        query.exec((rects) => {
          resolve({
            currentWidth: rects && rects[0] && rects[0].width ? rects[0].width : 0,
            nextWidth: rects && rects[1] && rects[1].width ? rects[1].width : 0
          });
        });
      });
    });
  },

  syncSensorTrackWidth(field) {
    const trackStyleField = getSensorFieldName(field, 'trackStyle');
    const currentText = formatSensorDisplay(this.data[getSensorFieldName(field, 'display')]);
    const token = (this.sensorAnimationTokens && this.sensorAnimationTokens[field]) || 0;

    this.measureSensorTrackWidth(field).then(({ currentWidth }) => {
      if (this.pageDestroyed) {
        return;
      }
      if (this.sensorAnimationTokens && this.sensorAnimationTokens[field] !== token) {
        return;
      }

      const widthPx = currentWidth || Math.max(buildSensorTrackWidthEm(currentText) * 16, 0);
      this.setData({
        [trackStyleField]: `width: ${Math.max(widthPx, 0)}px;`
      });
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

    if (currentText === nextText) {
      return {
        [displayField]: nextText,
        [framesField]: buildSensorDigitFrames(nextText, nextText),
        [measureCurrentFramesField]: buildSensorMeasureFrames(nextText),
        [measureNextFramesField]: buildSensorMeasureFrames(nextText),
        [trackStyleField]: buildSensorTrackWidthStyle(nextText),
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
      [animatingField]: true
    };

    this.sensorAnimationTimers = this.sensorAnimationTimers || {};
    if (this.sensorAnimationTimers[field]) {
      clearTimeout(this.sensorAnimationTimers[field]);
      this.sensorAnimationTimers[field] = null;
    }

    setTimeout(() => {
      this.measureSensorTrackWidth(field).then(({ currentWidth, nextWidth }) => {
        if (this.pageDestroyed) {
          return;
        }
        if (this.sensorAnimationTokens[field] !== token) {
          return;
        }

        const fallbackCurrent = Math.max(buildSensorTrackWidthEm(currentText) * 16, 0);
        const fallbackNext = Math.max(buildSensorTrackWidthEm(nextText) * 16, 0);
        const holdWidth = Math.max(currentWidth || fallbackCurrent, nextWidth || fallbackNext);
        this.setData({
          [trackStyleField]: `width: ${Math.max(holdWidth, 0)}px;`
        });

        this.sensorAnimationTimers[field] = setTimeout(() => {
          if (this.pageDestroyed) {
            return;
          }
          if (this.sensorAnimationTokens[field] !== token) {
            return;
          }

          this.setData({
            [animatingField]: false,
            [framesField]: buildSensorDigitFrames(currentText, nextText, stableLength),
            [measureCurrentFramesField]: buildSensorMeasureFrames(nextText),
            [measureNextFramesField]: buildSensorMeasureFrames(nextText)
          });

          this.sensorAnimationTimers[field] = setTimeout(() => {
            if (this.pageDestroyed) {
              return;
            }
            if (this.sensorAnimationTokens[field] !== token) {
              return;
            }

            this.setData({
              [trackStyleField]: `width: ${Math.max(nextWidth || fallbackNext, 0)}px;`
            });

            this.sensorAnimationTimers[field] = setTimeout(() => {
              if (this.pageDestroyed) {
                return;
              }
              if (this.sensorAnimationTokens[field] !== token) {
                return;
              }

              this.setData({
                [framesField]: buildSensorDigitFrames(nextText, nextText)
              });
              this.sensorAnimationTimers[field] = null;
            }, 320);
          }, 16);
        }, 360);
      });
    }, 0);

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
    const nextLogs = [
      {
        id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        time: formatLogTime(),
        title,
        content
      }
    ].concat(this.data.logs || []).slice(0, 20);

    this.setData({
      logs: nextLogs
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
      if (isCloudDataTopic) {
        console.log('[MQTT recv_data]', message.topic, message.payload);
        this.appendLog('收到消息', `${message.topic}\n${message.payload}`);
      }
      const patch = {};

      if (isCloudDataTopic && cloudSensorState) {
        if (cloudSensorState.temperature !== null) {
          Object.assign(patch, this.animateSensorValue('temperature', cloudSensorState.temperature));
          patch.temperature = cloudSensorState.temperature;
        }
        if (cloudSensorState.humidity !== null) {
          Object.assign(patch, this.animateSensorValue('humidity', cloudSensorState.humidity));
          patch.humidity = cloudSensorState.humidity;
        }
        saveSensorState({
          temperature: Number(patch.temperature !== undefined ? patch.temperature : this.data.temperature),
          humidity: Number(patch.humidity !== undefined ? patch.humidity : this.data.humidity)
        });
        this.appendLog(
          '界面已更新',
          `温度 ${patch.temperature !== undefined ? patch.temperature : this.data.temperature}C / 湿度 ${patch.humidity !== undefined ? patch.humidity : this.data.humidity}%`
        );
      }

      if (Object.keys(patch).length) {
        this.setData(patch);
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
    this.setData({
      activeTab: tab
    });
    this.syncTabbarIndicator(tab);
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
    this.setData({
      temperature: this.data.temperature,
      humidity: this.data.humidity
    });
    saveSensorState({
      temperature: Number(this.data.temperature),
      humidity: Number(this.data.humidity)
    });
    this.showToast({
      title: '界面已刷新',
      icon: 'success'
    });
    this.appendLog(
      '界面刷新',
      `温度 ${this.data.temperature}C / 湿度 ${this.data.humidity}%`
    );
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
        const nextTodos = this.upsertTodo(todo, { isNew: true });

        this.setData({
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
        this.upsertTodo(todo);
        this.setData({
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
      activeTab: 'todo'
    });
    this.syncTabbarIndicator('todo');
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
