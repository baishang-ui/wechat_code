const { hmacSha256 } = require('./sha256');

const PACKET_TYPE = {
  CONNECT: 0x10,
  CONNACK: 0x20,
  PUBLISH: 0x30,
  SUBSCRIBE: 0x82,
  PINGREQ: 0xc0,
  PINGRESP: 0xd0,
  DISCONNECT: 0xe0
};

function utf8Encode(value) {
  const bytes = [];

  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (nextCode - 0xdc00) + 0x10000;
        index += 1;
      }
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18));
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }

  return bytes;
}

function utf8Decode(bytes) {
  let output = '';

  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];

    if (first < 0x80) {
      output += String.fromCharCode(first);
      index += 1;
    } else if ((first & 0xe0) === 0xc0) {
      const codePoint = ((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
      output += String.fromCharCode(codePoint);
      index += 2;
    } else if ((first & 0xf0) === 0xe0) {
      const codePoint =
        ((first & 0x0f) << 12) |
        ((bytes[index + 1] & 0x3f) << 6) |
        (bytes[index + 2] & 0x3f);
      output += String.fromCharCode(codePoint);
      index += 3;
    } else {
      const codePoint =
        ((first & 0x07) << 18) |
        ((bytes[index + 1] & 0x3f) << 12) |
        ((bytes[index + 2] & 0x3f) << 6) |
        (bytes[index + 3] & 0x3f);
      const adjusted = codePoint - 0x10000;
      output += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
      index += 4;
    }
  }

  return output;
}

function encodeString(value) {
  const bytes = utf8Encode(value);
  return [(bytes.length >> 8) & 0xff, bytes.length & 0xff].concat(bytes);
}

function encodeLength(length) {
  const bytes = [];
  let rest = length;

  do {
    let digit = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) {
      digit |= 0x80;
    }
    bytes.push(digit);
  } while (rest > 0);

  return bytes;
}

function toArrayBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}

function readUtf8(bytes, start) {
  const length = (bytes[start] << 8) + bytes[start + 1];
  const slice = bytes.slice(start + 2, start + 2 + length);

  return {
    value: utf8Decode(slice),
    nextIndex: start + 2 + length
  };
}

function buildAliyunOptions(config) {
  const timestamp = String(Date.now());
  const mqttClientId = `${config.deviceName}|securemode=2,signmethod=hmacsha256,timestamp=${timestamp}|`;
  const username = `${config.deviceName}&${config.productKey}`;
  const signContent =
    `clientId${config.deviceName}` +
    `deviceName${config.deviceName}` +
    `productKey${config.productKey}` +
    `timestamp${timestamp}`;
  const password = hmacSha256(config.deviceSecret, signContent);
  const protocol = config.useTls ? 'wss' : 'ws';
  const host = `${config.productKey}.iot-as-mqtt.${config.regionId}.aliyuncs.com`;

  return {
    host,
    url: `${protocol}://${host}:443/mqtt`,
    clientId: mqttClientId,
    username,
    password
  };
}

function formatSocketError(error) {
  if (!error) {
    return '未知错误';
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.errMsg || error.message || JSON.stringify(error);
}

class MiniProgramMqttClient {
  constructor(config) {
    this.baseConfig = config;
    this.aliyunOptions = buildAliyunOptions(config);
    this.socketTask = null;
    this.packetId = 1;
    this.pingTimer = null;
    this.handlers = {
      connect: () => {},
      message: () => {},
      error: () => {},
      close: () => {},
      state: () => {}
    };
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
  }

  connect() {
    if (this.socketTask) {
      return;
    }

    this.handlers.state({ connected: false, text: '正在连接 MQTT...' });
    this.socketTask = wx.connectSocket({
      url: this.aliyunOptions.url,
      protocols: ['mqtt'],
      tcpNoDelay: true
    });

    this.socketTask.onOpen(() => {
      this.sendPacket(this.buildConnectPacket());
    });

    this.socketTask.onMessage((event) => {
      this.handleIncomingPacket(event.data);
    });

    this.socketTask.onError((error) => {
      this.handlers.error(error);
      this.handlers.state({
        connected: false,
        text: `MQTT 连接失败: ${formatSocketError(error)}`
      });
    });

    this.socketTask.onClose((event) => {
      this.clearPingTimer();
      this.socketTask = null;
      this.handlers.close(event);
      this.handlers.state({
        connected: false,
        text:
          event && event.code
            ? `MQTT 已断开: ${event.code}${event.reason ? ` ${event.reason}` : ''}`
            : 'MQTT 已断开'
      });
    });
  }

  disconnect() {
    if (!this.socketTask) {
      return;
    }

    this.sendPacket(toArrayBuffer([PACKET_TYPE.DISCONNECT, 0x00]));
    this.socketTask.close({});
  }

  publish(topic, payload) {
    if (!this.socketTask) {
      throw new Error('MQTT 未连接');
    }

    const topicBytes = encodeString(topic);
    const payloadBytes = utf8Encode(payload);
    const variableHeader = topicBytes;
    const fixedHeader = [PACKET_TYPE.PUBLISH].concat(
      encodeLength(variableHeader.length + payloadBytes.length)
    );

    this.sendPacket(toArrayBuffer(fixedHeader.concat(variableHeader, payloadBytes)));
  }

  subscribe(topic) {
    if (!this.socketTask) {
      return;
    }

    const id = this.nextPacketId();
    const variableHeader = [(id >> 8) & 0xff, id & 0xff];
    const payload = encodeString(topic).concat([0x00]);
    const fixedHeader = [PACKET_TYPE.SUBSCRIBE].concat(
      encodeLength(variableHeader.length + payload.length)
    );

    this.sendPacket(toArrayBuffer(fixedHeader.concat(variableHeader, payload)));
  }

  buildConnectPacket() {
    const variableHeader = []
      .concat(encodeString('MQTT'))
      .concat([0x04])
      .concat([0xc2])
      .concat([0x00, 0x3c]);
    const payload = []
      .concat(encodeString(this.aliyunOptions.clientId))
      .concat(encodeString(this.aliyunOptions.username))
      .concat(encodeString(this.aliyunOptions.password));
    const fixedHeader = [PACKET_TYPE.CONNECT].concat(
      encodeLength(variableHeader.length + payload.length)
    );

    return toArrayBuffer(fixedHeader.concat(variableHeader, payload));
  }

  handleIncomingPacket(rawData) {
    const bytes = new Uint8Array(rawData);
    const type = bytes[0] & 0xf0;

    if (type === PACKET_TYPE.CONNACK) {
      const returnCode = bytes[3];

      if (returnCode === 0) {
        this.handlers.connect();
        this.handlers.state({ connected: true, text: 'MQTT 已连接阿里云' });
        if (this.baseConfig.subscribeTopic) {
          this.subscribe(this.baseConfig.subscribeTopic);
        }
        this.startPingTimer();
      } else {
        this.handlers.error({ message: `CONNACK 返回错误码 ${returnCode}` });
        this.handlers.state({ connected: false, text: `连接被拒绝，错误码 ${returnCode}` });
      }
      return;
    }

    if (type === PACKET_TYPE.PUBLISH) {
      const topicInfo = readUtf8(bytes, 2);
      const payloadBytes = bytes.slice(topicInfo.nextIndex);
      const payload = utf8Decode(payloadBytes);

      this.handlers.message({
        topic: topicInfo.value,
        payload
      });
      return;
    }

    if (type === PACKET_TYPE.PINGRESP) {
      return;
    }
  }

  sendPacket(packet) {
    if (!this.socketTask) {
      return;
    }

    this.socketTask.send({
      data: packet
    });
  }

  startPingTimer() {
    this.clearPingTimer();
    this.pingTimer = setInterval(() => {
      this.sendPacket(toArrayBuffer([PACKET_TYPE.PINGREQ, 0x00]));
    }, 30000);
  }

  clearPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  nextPacketId() {
    this.packetId += 1;
    if (this.packetId > 65535) {
      this.packetId = 1;
    }
    return this.packetId;
  }
}

module.exports = {
  MiniProgramMqttClient,
  buildAliyunOptions
};
