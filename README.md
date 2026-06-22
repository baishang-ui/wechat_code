# 智能桌面盒子 · 微信小程序

基于微信小程序开发的 IoT 桌面控制面板，提供**云端传感器监测**、**待办事项管理**及**后端服务同步**三大核心能力，适配明/暗双主题。

---

## 功能概览

### 监测页

- **MQTT 连接状态** — 通过 MQTT over WebSocket 接入阿里云物联网平台，实时展示连接状态并支持一键重连
- **温湿度传感器** — 展示云端温度（°C）与湿度（%），数值变更时带有数字滚动动画
- **最近五次折线图** — 纯 CSS 定位折线（无 canvas），保留数据过渡动画，图例同步显示最新值
- **运行日志** — 实时记录 MQTT 连接、后端同步、待办操作等事件，按时间倒序展示

### 待办页

- **待办增删改查** — 通过后端 REST API 创建、编辑、勾选及删除待办事项（上限 5 条）
- **WebSocket 实时推送** — 监听后端 `todo.snapshot`、`todo.upsert`、`todo.delete` 消息，列表自动刷新
- **行内编辑** — 点击待办进入行内编辑模式，支持修改标题
- **乐观更新** — 勾选/删除操作先更新 UI，后端响应后再校准，保证交互即时性
- **后端同步** — 手动触发按钮从后端拉取最新待办列表

### 全局特性

- **明暗双主题** — 右下角悬浮按钮一键切换，主题偏好持久化到本地缓存
- **磨砂玻璃 UI** — 全局毛玻璃效果（`backdrop-filter`）+ 渐变光晕背景，适配 iOS 风格 tabbar
- **Toast 提示** — 支持叠层显示、进入/离开动画，溢出自动回收
- **自适应导航栏** — 根据胶囊按钮位置动态计算 status bar 与导航栏高度
- **离线容错** — 传感器数据与历史记录本地缓存，网络恢复后自动同步

---

## 目录结构

```
wechat_code/
├── app.js                          # 小程序入口（空 App 壳）
├── app.json                        # 全局窗口 & 页面注册
├── app.wxss                        # 全局样式（当前未使用）
├── project.config.json             # 微信开发者工具项目配置
├── jsconfig.json                   # VSCode 智能提示配置
├── sitemap.json                    # 站点地图索引配置
│
├── assets/
│   └── icons/                      # SVG 图标（14 枚）
│       ├── mqtt.svg                # MQTT 连接图标
│       ├── sensor.svg              # 传感器图标
│       ├── temperature.svg         # 温度图标
│       ├── humidity.svg            # 湿度图标
│       ├── logs.svg                # 日志图标
│       ├── todo-list.svg           # 待办图标
│       ├── add.svg                 # 添加按钮
│       ├── edit.svg                # 编辑按钮
│       ├── delete.svg              # 删除按钮
│       ├── save.svg                # 保存按钮
│       ├── close.svg               # 关闭/取消按钮
│       ├── refresh.svg             # 刷新/重连按钮
│       ├── sun.svg                 # 亮色主题
│       └── moon.svg                # 暗色主题
│
├── pages/
│   └── index/                      # 唯一页面（监测 + 待办双面板）
│       ├── index.js                # 页面全部业务逻辑（~1670 行）
│       ├── index.wxml              # 双面板 + tabbar + toast 模板
│       ├── index.wxss              # 完整样式（~1770 行，含动画）
│       └── index.json              # 页面配置
│
└── utils/                          # 工具模块
    ├── aliyunConfig.js             # 阿里云 IoT 三元组 & Topic 配置
    ├── mqttClient.js               # 轻量 MQTT 客户端（WebSocket 协议）
    ├── sha256.js                   # 纯 JS 实现的 SHA-256 & HMAC-SHA256
    ├── storage.js                  # 本地缓存读写（传感器 & 待办数据）
    └── backendConfig.js            # 后端地址解析与自动探测
```

---

## 快速开始

### 1. 配置阿里云 IoT

编辑 [`utils/aliyunConfig.js`](utils/aliyunConfig.js)：

```js
const aliyunConfig = {
  regionId: 'cn-shanghai',          // 物联网平台地域
  productKey: '<你的ProductKey>',
  deviceName: '<你的DeviceName>',
  deviceSecret: '<你的DeviceSecret>',
  publishTopic: '/sys/<ProductKey>/<DeviceName>/thing/event/property/post',
  subscribeTopic: '',               // 留空则仅订阅自定义接收 Topic
  useTls: true                      // 开启 WSS 加密
};
```

订阅 Topic 默认使用：

```
/<ProductKey>/<DeviceName>/user/recv_data
```

> 云端设备向该 Topic 下发 JSON 格式数据（含 `temp` / `humi` 字段），小程序即可实时展示温湿度。

### 2. 配置后端服务

编辑 [`utils/backendConfig.js`](utils/backendConfig.js)：

```js
const backendConfig = {
  baseUrl: '',                      // 留空则自动探测局域网地址
  protocol: 'http',
  port: 3000,
  apiToken: 'wechat-todo-sync-2026',
  socketRetryMs: 2000               // WebSocket 断线重连间隔
};
```

**自动探测逻辑**：
1. 优先使用 `baseUrl`（如手动填入 `http://192.168.1.100:3000`）
2. 回退到上次成功连接的缓存地址
3. 调用 `wx.getLocalIPAddress()` 获取当前设备局域网 IP 并构建地址
4. 最后尝试 `127.0.0.1` 与 `localhost`

**后端 API 参考**：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/todos` | 获取待办列表 `{ items: Todo[] }` |
| `POST` | `/api/todos` | 创建待办 `{ title }` → 返回完整 `Todo` |
| `PATCH` | `/api/todos/:id` | 更新待办 `{ title?, completed? }` → 返回完整 `Todo` |
| `DELETE` | `/api/todos/:id` | 删除待办 |
| `WS` | `/ws/todos` | WebSocket 推送（`todo.snapshot` / `todo.upsert` / `todo.delete`） |

### 3. 在微信开发者工具中打开

1. 打开**微信开发者工具**
2. 导入项目 → 选择 `wechat_code/` 目录
3. 填入自有 AppID 或选择「测试号」
4. 编译运行 → 在模拟器或真机上预览

---

## 数据格式

### 云端传感器下行（阿里云 → 小程序）

设备通过 `/<ProductKey>/<DeviceName>/user/recv_data` 下发如下 JSON：

```json
{
  "temp": 26.5,
  "humi": 58
}
```

小程序自动解析并更新界面（支持温度/湿度独立更新）。

### 待办实体

```ts
interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}
```

---

## 技术实现

| 模块 | 方案 |
|------|------|
| **MQTT 协议** | 纯 JS 实现 MQTT 3.1.1，通过 `wx.connectSocket` 建立 WSS 连接，含 CONNECT / PUBLISH / SUBSCRIBE / PINGREQ 等报文编解码 |
| **认证鉴权** | 阿里云 IoT 一机一密 HMAC-SHA256 签名，后端请求使用 Bearer Token |
| **传感器动画** | 数字滚动使用 CSS `@keyframes` 逐帧变换，折线图使用纯 DOM 定位 + CSS transition 避免 canvas 重绘 |
| **数据持久化** | `wx.setStorageSync` / `wx.getStorageSync` 保存传感器读数与历史记录 |
| **状态管理** | 单页面 `setData` 驱动，按需 `patch` 合并减少渲染开销 |
| **样式主题** | CSS 变量通过顶层 `theme-{light|dark}` class 切换，无运行时计算 |

---

## 依赖

- **零 NPM 依赖** — 所有核心模块（SHA-256、MQTT 客户端）均为内置纯 JS 实现
- 微信基础库版本：`3.15.0`（最低要求 `>= 2.0.0`）
- 需要启用微信开发者工具的「增强编译」(ES6→ES5) 与「不校验合法域名」选项（开发阶段）

---

## 注意事项

1. 阿里云物模型建议提前创建 `temp`（温度）和 `humi`（湿度）属性，否则物模型可视化面板无法自动解析
2. 微信小程序要求 `wss://` 域名已加入 **socket 合法域名** 白名单，正式环境需在 MP 后台配置 `*.iot-as-mqtt.cn-shanghai.aliyuncs.com`
3. 后端 API Token 为简单鉴权方案，生产环境建议替换为更安全的认证机制
4. 本示例适用于课程设计、原型验证及 IoT 基础联调场景
5. 传感器历史记录仅保留最近 5 条，折线图 Y 轴带有 12% 内边距防止数据点贴边

---

## License

MIT（仅供学习与研究使用）
