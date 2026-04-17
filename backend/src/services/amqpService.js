const crypto = require('node:crypto');
const container = require('rhea');

function buildUsername(config, timestamp) {
  const parts = [
    `${config.amqpClientId}|authMode=aksign,signMethod=hmacsha1,timestamp=${timestamp},authId=${config.accessKeyId}`
  ];

  if (config.iotInstanceId) {
    parts.push(`iotInstanceId=${config.iotInstanceId}`);
  }

  parts.push(`consumerGroupId=${config.consumerGroupId}|`);
  return parts.join(',');
}

function buildPassword(config, timestamp) {
  return Buffer.from(
    crypto.createHmac('sha1', config.accessKeySecret).update(`authId=${config.accessKeyId}&timestamp=${timestamp}`).digest()
  ).toString('base64');
}

function decodeMessageBody(message) {
  const body = message && message.body ? message.body : {};
  const content = body.content !== undefined ? body.content : body;

  if (Buffer.isBuffer(content)) {
    return content.toString('utf8');
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content).toString('utf8');
  }

  if (typeof content === 'string') {
    return content;
  }

  return JSON.stringify(content || {});
}

function tryParseJsonPayload(payloadText) {
  const text = String(payloadText || '').trim();
  if (!text) {
    return {
      ok: false,
      error: new Error('empty payload')
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text)
    };
  } catch (firstError) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const candidate = text.slice(start, end + 1);
      try {
        return {
          ok: true,
          value: JSON.parse(candidate)
        };
      } catch (secondError) {
        return {
          ok: false,
          error: secondError
        };
      }
    }

    return {
      ok: false,
      error: firstError
    };
  }
}

class AliyunAmqpService {
  constructor(config) {
    this.config = config;
    this.connection = null;
    this.receiver = null;
    this.messageHandler = null;
    this.boundMessageHandler = this.handleMessage.bind(this);
  }

  isEnabled() {
    return Boolean(
      this.config.enabled &&
      this.config.amqpHost &&
      this.config.accessKeyId &&
      this.config.accessKeySecret &&
      this.config.consumerGroupId
    );
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  start() {
    if (!this.isEnabled()) {
      console.log('[amqp] disabled');
      return;
    }

    const timestamp = Date.now();
    const username = buildUsername(this.config, timestamp);
    const password = buildPassword(this.config, timestamp);

    this.connection = container.connect({
      host: this.config.amqpHost,
      port: 5671,
      transport: 'tls',
      reconnect: true,
      idle_time_out: 60000,
      username,
      password,
      rejectUnauthorized: this.config.amqpRejectUnauthorized !== false
    });

    this.receiver = this.connection.open_receiver();

    container.on('connection_open', (context) => {
      if (context.connection === this.connection) {
        console.log(`[amqp] connected ${this.config.amqpHost}`);
      }
    });

    container.on('connection_error', (context) => {
      if (context.connection === this.connection) {
        const error = context.connection && context.connection.error;
        console.error('[amqp] connection error', (error && error.description) || error || 'unknown');
      }
    });

    container.on('transport_error', (context) => {
      if (context.connection === this.connection) {
        console.error('[amqp] transport error', context.error || 'unknown');
      }
    });

    container.on('disconnected', (context) => {
      if (context.connection === this.connection) {
        console.log('[amqp] disconnected', context.error || (context.connection && context.connection.error) || '');
      }
    });

    container.on('message', this.boundMessageHandler);
  }

  async handleMessage(context) {
    if (!context || context.connection !== this.connection) {
      return;
    }

    const message = context.message || {};
    const topic = message.application_properties && message.application_properties.topic
      ? String(message.application_properties.topic)
      : '';
    const payloadText = decodeMessageBody(message);
    const parsedPayload = tryParseJsonPayload(payloadText);

    try {
      let handlerResult;

      if (this.messageHandler) {
        handlerResult = await this.messageHandler({
          topic,
          payloadText,
          parsed: parsedPayload.ok ? parsedPayload.value : null,
          parseError: parsedPayload.ok ? null : parsedPayload.error
        });
      }

      if (handlerResult !== false) {
        console.log(`[amqp] recv ${topic} ${payloadText}`);
      }

      context.delivery.accept();
    } catch (error) {
      console.error('[amqp] handle message failed', error.message);
      context.delivery.accept();
    }
  }
}

module.exports = {
  AliyunAmqpService
};
