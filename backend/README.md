# Todo IoT Backend

这个后端现在采用下面这套结构：

- 小程序 -> 后端 REST -> SQLite
- 后端 -> 阿里云 IoT `Pub` 接口 -> 设备下行 Topic

后端不再用设备三元组登录 MQTT，因此不会和硬件抢同一个设备连接。

## 当前 Topic

- 上行 Topic：`/k1e98mYkQSF/device/user/report_data`
- 下行 Topic：`/k1e98mYkQSF/device/user/recv_data`

说明：
- 现在后端只负责数据库、REST 和下行发布
- 设备上报仍然走阿里云 Topic，但不再由当前后端通过设备 MQTT 连接来订阅
- 后端下发改为阿里云官方 `Pub` 接口

## 当前能力

- SQLite 作为待办唯一数据源
- 小程序通过 REST 接口增删改查待办
- 每次待办变更后，后端自动调用阿里云 `Pub` 接口
- 后端将最新 `todo.snapshot` 发布到 `/k1e98mYkQSF/device/user/recv_data`
- 硬件只需要订阅下行 Topic 即可收到完整快照

## 目录

- `src/server.js` HTTP 服务入口
- `src/db.js` SQLite 初始化
- `src/services/todoService.js` 待办业务
- `src/services/iotService.js` 阿里云 `Pub` 下发服务

## 启动

```bash
cd backend
copy .env.example .env
npm install
npm run dev
```

或者直接双击：

- `start-backend.bat`

## 关键环境变量

- `MINIAPP_API_TOKEN` 小程序访问后端接口时带的 token
- `ALIYUN_IOT_ENABLED=true`
- `ALIYUN_REGION_ID=cn-shanghai`
- `ALIYUN_ACCESS_KEY_ID=你的阿里云 AccessKeyId`
- `ALIYUN_ACCESS_KEY_SECRET=你的阿里云 AccessKeySecret`
- `ALIYUN_IOT_INSTANCE_ID=` 可留空；如果你是企业版实例，则填实例 ID
- `ALIYUN_PRODUCT_KEY=k1e98mYkQSF`
- `ALIYUN_DEVICE_NAME=device`
- `ALIYUN_USE_TLS=false`
- `ALIYUN_DEVICE_COMMAND_TOPIC=/k1e98mYkQSF/device/user/recv_data`
- `ALIYUN_DEVICE_REPORT_TOPIC=/k1e98mYkQSF/device/user/report_data`

说明：
- `ALIYUN_USE_TLS` 现在只保留为兼容字段，当前 `Pub` 接口方案不会再用设备 MQTT 登录
- `ALIYUN_DEVICE_SECRET` 不再是后端必需项

## 小程序接口

### 读取待办

```http
GET /api/todos
Authorization: Bearer <MINIAPP_API_TOKEN>
```

### 新增待办

```http
POST /api/todos
Authorization: Bearer <MINIAPP_API_TOKEN>
Content-Type: application/json

{
  "title": "买电池"
}
```

### 更新待办

```http
PATCH /api/todos/:id
Authorization: Bearer <MINIAPP_API_TOKEN>
Content-Type: application/json

{
  "title": "买 5 号电池",
  "completed": true
}
```

### 删除待办

```http
DELETE /api/todos/:id
Authorization: Bearer <MINIAPP_API_TOKEN>
```

## 后端下发到硬件

后端会在这些场景自动发布：

- 小程序新增待办
- 小程序修改待办
- 小程序删除待办

发布目标：

```text
/k1e98mYkQSF/device/user/recv_data
```

## 下发消息格式

```json
{
  "type": "todo.snapshot",
  "reason": "miniapp.update",
  "timestamp": 1713250010000,
  "todos": [
    {
      "id": "todo-1713250000000-1234",
      "title": "买电池",
      "completed": false,
      "updatedAt": 1713250000000,
      "createdAt": 1713250000000,
      "source": "miniapp"
    }
  ]
}
```

## 说明

- 硬件平台不会直接读取 `todos.db`
- 硬件拿数据的方式是订阅 `/k1e98mYkQSF/device/user/recv_data`
- 后端现在不再作为设备建立 MQTT 长连接
- 这样可以避免后端和硬件共用同一设备证书时反复互踢下线
