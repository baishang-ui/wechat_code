const { loadTodos, saveTodos, loadSensorState, saveSensorState } = require('../../utils/storage');
const { resolveAliyunConfig } = require('../../utils/aliyunConfig');
const { MiniProgramMqttClient } = require('../../utils/mqttClient');

const THEME_KEY = 'page-theme';
const TOAST_LIMIT = 3;
const TOAST_STEP_RPX = 92;

function createId() {
  return `todo-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function createTodoStruct(todos) {
  const latestTodo = (todos && todos[0]) || {};

  return {
    id: latestTodo.id || '',
    title: latestTodo.title || '',
    completed: latestTodo.completed ? 1 : 0,
    updateAt: latestTodo.updatedAt || ''
  };
}

function sanitizeTodos(todos) {
  return (todos || []).map((item) => ({
    id: item.id,
    title: item.title,
    completed: item.completed,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
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

function buildTodoStyle(todo) {
  let translateY = 0;
  let scale = 1;
  let opacity = 1;

  if (todo.isEntering) {
    translateY -= 16;
    scale = 0.96;
    opacity = 0;
  }

  if (todo.isRemoving) {
    translateY += 16;
    scale = 0.96;
    opacity = 0;
  }

  return `transform: translate3d(0, ${translateY}rpx, 0) scale(${scale}); opacity: ${opacity};`;
}

function withTodoStyles(todos) {
  return (todos || []).map((item) =>
    Object.assign({}, item, {
      style: buildTodoStyle(item)
    })
  );
}

function decorateTodos(todos) {
  return withTodoStyles(
    (todos || []).map((item) =>
      Object.assign(
        {
          isRemoving: false,
          isToggling: false,
          isNew: false,
          isEntering: false,
          displayTime: formatTodoTime(item.updatedAt || item.createdAt)
        },
        item,
        {
          displayTime: formatTodoTime(item.updatedAt || item.createdAt)
        }
      )
    )
  );
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

Page({
  data: {
    activeTab: 'monitor',
    tabbarProgress: 0,
    tabbarIndicatorStyle: '--tabbar-translate: 0%;',
    tabbarPressing: false,
    themeAnimating: false,
    showEmptyState: false,
    toasts: [],
    theme: 'light',
    temperature: 26.5,
    humidity: 58,
    temperaturePrev: 26.5,
    temperatureNext: 26.5,
    humidityPrev: 58,
    humidityNext: 58,
    temperatureAnimating: false,
    humidityAnimating: false,
    mqttStatusText: 'MQTT 未连接',
    mqttConnected: false,
    todoInput: '',
    editingId: '',
    editingInput: '',
    todos: [],
    pressingTodoId: '',
    incomingMessage: '',
    logs: []
  },

  onLoad() {
    this.aliyunConfig = resolveAliyunConfig();
    const sensorState = loadSensorState();
    const todos = sortTodos(decorateTodos(loadTodos()));
    const theme = this.loadTheme();

    this.setData({
      theme,
      temperature: sensorState.temperature,
      humidity: sensorState.humidity,
      temperaturePrev: sensorState.temperature,
      temperatureNext: sensorState.temperature,
      humidityPrev: sensorState.humidity,
      humidityNext: sensorState.humidity,
      todos,
      showEmptyState: !todos.length
    });

    this.initMqttClient();
  },

  onUnload() {
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
    if (this.addTodoMotionTimer) {
      clearTimeout(this.addTodoMotionTimer);
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
    this.todoPressAnchor = null;
    if (this.mqttClient) {
      this.mqttClient.disconnect();
    }
  },

  animateSensorValue(field, nextValue) {
    const isTemperature = field === 'temperature';
    const currentValue = this.data[field];

    if (Number(currentValue) === Number(nextValue)) {
      return {};
    }

    const patch = isTemperature
      ? {
          temperaturePrev: currentValue,
          temperatureNext: nextValue,
          temperatureAnimating: true
        }
      : {
          humidityPrev: currentValue,
          humidityNext: nextValue,
          humidityAnimating: true
        };

    this.sensorAnimationTimers = this.sensorAnimationTimers || {};
    if (this.sensorAnimationTimers[field]) {
      clearTimeout(this.sensorAnimationTimers[field]);
    }

    this.sensorAnimationTimers[field] = setTimeout(() => {
      this.setData(
        isTemperature
          ? {
              temperatureAnimating: false,
              temperaturePrev: this.data.temperature,
              temperatureNext: this.data.temperature
            }
          : {
              humidityAnimating: false,
              humidityPrev: this.data.humidity,
              humidityNext: this.data.humidity
            }
      );
      this.sensorAnimationTimers[field] = null;
    }, 260);

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
      const patch = {
        incomingMessage: `${message.topic}\n${message.payload}`
      };

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

      this.setData(patch);
    });

    this.mqttClient.on('error', (error) => {
      const errorText =
        (error && (error.errMsg || error.message)) ||
        (typeof error === 'string' ? error : 'MQTT 连接失败');
      this.showToast({
        title: '连接失败',
        icon: 'none'
      });
      this.setData({
        incomingMessage: errorText
      });
      this.appendLog('连接失败', errorText);
    });

    this.mqttClient.on('close', (event) => {
      const closeText =
        event && event.code
          ? `连接关闭: ${event.code}${event.reason ? ` ${event.reason}` : ''}`
          : '连接已关闭';
      this.setData({
        incomingMessage: closeText
      });
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
      tabbarProgress: safeProgress,
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

  clearTodoPressState() {
    this.todoPressAnchor = null;
    if (!this.data.pressingTodoId) {
      return;
    }
    this.setData({
      pressingTodoId: ''
    });
  },

  handleTodoPressStart(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.editingId === id) {
      return;
    }

    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    this.todoPressAnchor = touch
      ? {
          id,
          x: Number(touch.pageX || touch.clientX || 0),
          y: Number(touch.pageY || touch.clientY || 0)
        }
      : null;

    if (this.data.pressingTodoId === id) {
      return;
    }

    this.setData({
      pressingTodoId: id
    });
  },

  handleTodoPressMove(event) {
    const { id } = event.currentTarget.dataset;
    if (!id || this.data.pressingTodoId !== id) {
      return;
    }

    const anchor = this.todoPressAnchor;
    const touch = event.touches && event.touches[0];
    if (!anchor || anchor.id !== id || !touch) {
      return;
    }

    const moveX = Number(touch.pageX || touch.clientX || 0) - anchor.x;
    const moveY = Number(touch.pageY || touch.clientY || 0) - anchor.y;
    if (moveX * moveX + moveY * moveY > 196) {
      this.clearTodoPressState();
    }
  },

  handleTodoPressEnd() {
    this.clearTodoPressState();
  },

  handleTodoPressCancel() {
    this.clearTodoPressState();
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

    const now = new Date().toISOString();
    const createdId = createId();
    let todos = this.data.todos.slice();
    todos.unshift({
      id: createdId,
      title,
      completed: false,
      createdAt: now,
      updatedAt: now,
      displayTime: formatTodoTime(now),
      isRemoving: false,
      isToggling: false,
      isNew: true,
      isEntering: true
    });

    todos = sortTodos(todos);

    saveTodos(sanitizeTodos(todos));
    this.setData({
      todos: withTodoStyles(todos),
      todoInput: '',
      showEmptyState: false
    });

    this.showToast({
      title: '添加成功',
      icon: 'success'
    });

    const startEnterTransition = () => {
      if (this.addTodoMotionTimer) {
        clearTimeout(this.addTodoMotionTimer);
      }
      this.addTodoMotionTimer = setTimeout(() => {
        const nextTodos = this.data.todos.map((item) =>
          Object.assign({}, item, {
            isNew: item.id === createdId ? false : item.isNew,
            isEntering: item.id === createdId ? false : item.isEntering
          })
        );
        this.setData({
          todos: withTodoStyles(nextTodos)
        });
        this.addTodoMotionTimer = null;
      }, 16);
    };

    if (typeof wx.nextTick === 'function') {
      wx.nextTick(startEnterTransition);
    } else {
      startEnterTransition();
    }
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

    const updatedAt = new Date().toISOString();
    const todos = sortTodos(
      this.data.todos.map((item) =>
        item.id === editingId
          ? Object.assign({}, item, {
              title,
              updatedAt,
              isRemoving: false,
              isToggling: false,
              isNew: false,
              isEntering: false,
              displayTime: formatTodoTime(updatedAt)
            })
          : item
      )
    );

    saveTodos(sanitizeTodos(todos));
    this.setData({
      todos: withTodoStyles(todos),
      editingId: '',
      editingInput: '',
      showEmptyState: false
    });

    this.showToast({
      title: '更新成功',
      icon: 'success'
    });
  },

  startEditTodo(event) {
    const { id } = event.currentTarget.dataset;
    const target = this.data.todos.find((item) => item.id === id);
    if (!target) {
      return;
    }

    this.clearTodoPressState();
    this.setData({
      editingId: id,
      editingInput: target.title,
      activeTab: 'todo'
    });
    this.syncTabbarIndicator('todo');
  },

  cancelEdit() {
    this.clearTodoPressState();
    this.setData({
      editingId: '',
      editingInput: ''
    });
  },

  toggleTodo(event) {
    const { id } = event.currentTarget.dataset;
    this.clearTodoPressState();
    const todos = this.data.todos.map((item) =>
      item.id === id
        ? Object.assign({}, item, {
            completed: !item.completed,
            updatedAt: new Date().toISOString(),
            isRemoving: false,
            isToggling: true,
            isNew: false,
            isEntering: false
          })
        : item
    );
    this.setData({ todos: withTodoStyles(todos) });

    if (this.toggleTodoTimer) {
      clearTimeout(this.toggleTodoTimer);
    }

    this.toggleTodoTimer = setTimeout(() => {
      const nextTodos = sortTodos(
        this.data.todos.map((item) =>
          item.id === id
            ? Object.assign({}, item, {
                isToggling: false,
                displayTime: formatTodoTime(item.updatedAt || item.createdAt)
              })
            : item
        )
      );

      saveTodos(sanitizeTodos(nextTodos));
      this.setData({
        todos: withTodoStyles(nextTodos),
        showEmptyState: !nextTodos.length
      });
      this.toggleTodoTimer = null;
    }, 320);
  },

  deleteTodo(event) {
    const { id } = event.currentTarget.dataset;
    this.clearTodoPressState();
    const targetIndex = findTodoIndexById(this.data.todos, id);
    const target = targetIndex >= 0 ? this.data.todos[targetIndex] : null;
    if (!target || target.isRemoving) {
      return;
    }

    if (this.data.editingId === id) {
      this.cancelEdit();
    }

    const todos = this.data.todos.map((item, index) => {
      if (item.id === id) {
        return Object.assign({}, item, {
          isRemoving: true,
          isEntering: false
        });
      }
      return item;
    });

    this.setData({
      todos: withTodoStyles(todos)
    });

    this.removeTodoTimers = this.removeTodoTimers || {};
    if (this.removeTodoTimers[id]) {
      clearTimeout(this.removeTodoTimers[id]);
    }

    this.removeTodoTimers[id] = setTimeout(() => {
      const nextTodos = this.data.todos
        .filter((item) => item.id !== id);
      saveTodos(sanitizeTodos(nextTodos));
      this.setData({
        todos: withTodoStyles(nextTodos),
        showEmptyState: false
      });
      this.scheduleEmptyState(!nextTodos.length, nextTodos.length ? 0 : 320);
      delete this.removeTodoTimers[id];
    }, 280);

    this.showToast({
      title: '删除成功',
      icon: 'success'
    });
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
    if (!this.data.mqttConnected) {
      this.showToast({
        title: '请先连接 MQTT',
        icon: 'none'
      });
      return;
    }

    const payload = JSON.stringify({
      id: Date.now(),
      version: '1.0',
      method: 'thing.event.property.post',
      params: {
        todolist: createTodoStruct(this.data.todos)
      }
    });

    try {
      this.mqttClient.publish(this.aliyunConfig.publishTopic, payload);
      this.showToast({
        title: '提交成功',
        icon: 'success'
      });
      this.setData({
        incomingMessage: `已发布到 Topic:\n${this.aliyunConfig.publishTopic}\n\n${payload}`
      });
      this.appendLog('提交成功', `${this.aliyunConfig.publishTopic}\n${payload}`);
    } catch (error) {
      this.showToast({
        title: '提交失败',
        icon: 'none'
      });
      this.appendLog('提交失败', (error && (error.errMsg || error.message)) || '发布异常');
    }
  }
});
