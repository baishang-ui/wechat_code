const OpenApi = require('@alicloud/openapi-client');
const Iot20180120 = require('@alicloud/iot20180120');

function encodeMessageContent(payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return Buffer.from(body, 'utf8').toString('base64');
}

function buildOpenApiClient(config) {
  const openApiConfig = new OpenApi.Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret
  });

  openApiConfig.endpoint = `iot.${config.regionId}.aliyuncs.com`;
  return new Iot20180120.default(openApiConfig);
}

class AliyunIotService {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  isEnabled() {
    return Boolean(
      this.config.enabled &&
      this.config.regionId &&
      this.config.accessKeyId &&
      this.config.accessKeySecret &&
      this.config.productKey &&
      this.config.commandTopic
    );
  }

  start() {
    if (!this.isEnabled()) {
      console.log('[iot] pub service disabled');
      return;
    }

    this.client = buildOpenApiClient(this.config);
    console.log('[iot] pub service ready');
  }

  async publish(topic, payload, options = {}) {
    if (!this.isEnabled()) {
      return { skipped: true, reason: 'disabled' };
    }

    if (!this.client) {
      this.client = buildOpenApiClient(this.config);
    }

    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const request = new Iot20180120.PubRequest({
      iotInstanceId: this.config.iotInstanceId || undefined,
      productKey: this.config.productKey,
      topicFullName: topic,
      qos: options.qos === 1 ? 1 : 0,
      messageContent: encodeMessageContent(body)
    });

    const response = await this.client.pub(request);
    const responseBody = response && response.body ? response.body : {};

    console.log(`[iot] publish ${topic} ${body}`);

    return {
      skipped: false,
      requestId: responseBody.requestId || '',
      success: responseBody.success !== false,
      code: responseBody.code || '',
      errorMessage: responseBody.errorMessage || ''
    };
  }

  publishSnapshot(todos, reason) {
    return this.publish(this.config.commandTopic, {
      type: 'todo.snapshot',
      reason,
      timestamp: Date.now(),
      todos: (todos || []).map((todo) => ({
        id: todo.id,
        title: todo.title,
        completed: Boolean(todo.completed),
        updatedAt: todo.updatedAt,
        createdAt: todo.createdAt,
        source: todo.source
      }))
    });
  }
}

module.exports = {
  AliyunIotService
};
