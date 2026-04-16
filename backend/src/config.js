const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveTopic(value, fallback) {
  const topic = String(value || fallback || '').trim();
  if (!topic) {
    return '';
  }
  return topic.startsWith('/') ? topic : `/${topic}`;
}

const rootDir = path.resolve(__dirname, '..');
const dbFile = path.resolve(rootDir, process.env.DB_FILE || './data/todos.db');

const config = {
  port: Number(process.env.PORT || 3000),
  rootDir,
  dbFile,
  miniappApiToken: String(process.env.MINIAPP_API_TOKEN || '').trim(),
  deviceApiToken: String(process.env.DEVICE_API_TOKEN || '').trim(),
  aliyun: {
    enabled: parseBoolean(process.env.ALIYUN_IOT_ENABLED, false),
    regionId: String(process.env.ALIYUN_REGION_ID || 'cn-shanghai').trim(),
    accessKeyId: String(process.env.ALIYUN_ACCESS_KEY_ID || '').trim(),
    accessKeySecret: String(process.env.ALIYUN_ACCESS_KEY_SECRET || '').trim(),
    iotInstanceId: String(process.env.ALIYUN_IOT_INSTANCE_ID || '').trim(),
    productKey: String(process.env.ALIYUN_PRODUCT_KEY || '').trim(),
    deviceName: String(process.env.ALIYUN_DEVICE_NAME || '').trim(),
    useTls: parseBoolean(process.env.ALIYUN_USE_TLS, true),
    reportTopic: resolveTopic(process.env.ALIYUN_DEVICE_REPORT_TOPIC, ''),
    commandTopic: resolveTopic(
      process.env.ALIYUN_DEVICE_COMMAND_TOPIC,
      `/${process.env.ALIYUN_PRODUCT_KEY || ''}/${process.env.ALIYUN_DEVICE_NAME || ''}/user/todo/command`
    )
  }
};

module.exports = {
  config,
  parseBoolean
};
