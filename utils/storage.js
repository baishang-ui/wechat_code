const TODO_KEY = 'todo-items';
const SENSOR_KEY = 'sensor-state';
const SENSOR_HISTORY_KEY = 'sensor-history';
const SENSOR_HISTORY_LIMIT = 5;

function loadTodos() {
  try {
    return wx.getStorageSync(TODO_KEY) || [];
  } catch (error) {
    return [];
  }
}

function saveTodos(items) {
  wx.setStorageSync(TODO_KEY, items);
}

function loadSensorState() {
  try {
    return (
      wx.getStorageSync(SENSOR_KEY) || {
        temperature: 26.5,
        humidity: 58
      }
    );
  } catch (error) {
    return {
      temperature: 26.5,
      humidity: 58
    };
  }
}

function saveSensorState(sensorState) {
  wx.setStorageSync(SENSOR_KEY, sensorState);
}

function normalizeSensorNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeSensorHistory(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
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

function loadSensorHistory() {
  try {
    return normalizeSensorHistory(wx.getStorageSync(SENSOR_HISTORY_KEY));
  } catch (error) {
    return [];
  }
}

function saveSensorHistory(items) {
  wx.setStorageSync(SENSOR_HISTORY_KEY, normalizeSensorHistory(items));
}

module.exports = {
  loadTodos,
  saveTodos,
  loadSensorState,
  saveSensorState,
  loadSensorHistory,
  saveSensorHistory
};
