const TODO_KEY = 'todo-items';
const SENSOR_KEY = 'sensor-state';

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

module.exports = {
  loadTodos,
  saveTodos,
  loadSensorState,
  saveSensorState
};
