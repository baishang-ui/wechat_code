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

function resolveTopicList(value, fallbackList = []) {
  const fromEnv = String(value || '')
    .split(',')
    .map((item) => resolveTopic(item, ''))
    .filter(Boolean);

  const merged = fromEnv.length
    ? fromEnv
    : (fallbackList || []).map((item) => resolveTopic(item, '')).filter(Boolean);

  return Array.from(new Set(merged));
}

const rootDir = path.resolve(__dirname, '..');
const dbFile = path.resolve(rootDir, process.env.DB_FILE || './data/todos.db');
const productKey = String(process.env.ALIYUN_PRODUCT_KEY || '').trim();
const deviceName = String(process.env.ALIYUN_DEVICE_NAME || '').trim();
const fallbackReportTopic = `/${productKey}/${deviceName}/user/report_data`;
const fallbackCommandTopic = `/${productKey}/${deviceName}/user/todo/command`;
const requiredReportTopic = '/k1e98mYkQSF/device/user/report_data';

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
    amqpHost: String(process.env.ALIYUN_AMQP_HOST || '').trim(),
    consumerGroupId: String(process.env.ALIYUN_AMQP_CONSUMER_GROUP_ID || 'DEFAULT_GROUP').trim(),
    amqpClientId: String(process.env.ALIYUN_AMQP_CLIENT_ID || 'todo-backend-amqp').trim(),
    amqpRejectUnauthorized: parseBoolean(process.env.ALIYUN_AMQP_REJECT_UNAUTHORIZED, true),
    productKey,
    deviceName,
    useTls: parseBoolean(process.env.ALIYUN_USE_TLS, true),
    reportTopic: resolveTopic(process.env.ALIYUN_DEVICE_REPORT_TOPIC, fallbackReportTopic),
    reportTopics: resolveTopicList(process.env.ALIYUN_DEVICE_REPORT_TOPICS, [
      process.env.ALIYUN_DEVICE_REPORT_TOPIC,
      fallbackReportTopic,
      requiredReportTopic
    ]),
    commandTopic: resolveTopic(
      process.env.ALIYUN_DEVICE_COMMAND_TOPIC,
      fallbackCommandTopic
    )
  }
};

module.exports = {
  config,
  parseBoolean
};
