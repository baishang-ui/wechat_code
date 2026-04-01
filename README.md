# 温湿度待办微信小程序

这是一个从零搭建的微信小程序示例，包含以下能力：

- 显示温度和湿度
- 待办事项增删改查
- 本地缓存待办数据和温湿度数据
- 通过 MQTT over WebSocket 连接阿里云物联网平台
- 将温湿度和待办列表一起发布到阿里云 Topic

## 目录结构

- `pages/index/`: 首页 UI 与业务逻辑
- `utils/storage.js`: 本地缓存
- `utils/aliyunConfig.js`: 阿里云三元组配置
- `utils/mqttClient.js`: 微信小程序下的轻量 MQTT 客户端

## 接入阿里云

打开 `utils/aliyunConfig.js`，替换以下内容：

- `regionId`
- `productKey`
- `deviceName`
- `deviceSecret`
- `publishTopic`
- `subscribeTopic`

推荐默认发布 Topic 使用阿里云物模型上报 Topic，例如：

```text
/sys/${productKey}/${deviceName}/thing/event/property/post
```

## 发布到阿里云的数据格式

```json
{
  "id": 1710000000000,
  "version": "1.0",
  "method": "thing.event.property.post",
  "params": {
    "temperature": 26.5,
    "humidity": 58,
    "todoList": [
      {
        "id": "todo-1",
        "title": "检查传感器",
        "completed": false,
        "updatedAt": "2026-04-01T08:00:00.000Z"
      }
    ]
  }
}
```

## 注意事项

1. 阿里云物模型如果没有 `todoList` 这类属性，平台端可能不会按物模型属性解析，但消息仍然可以被订阅端收到。
2. 如果你准备严格按物模型上报，建议把 `temperature`、`humidity`、`todoList` 对应的属性提前在阿里云产品物模型中创建好。
3. 当前示例为了避免依赖第三方 npm 包，内置了一个简化 MQTT 客户端，适合课程设计、原型和基础联调场景。
