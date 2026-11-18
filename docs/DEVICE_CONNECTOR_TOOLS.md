# Today 设备连接器 = 真正的工具调用通道

## 0. 结论先说

**「能用所有东西包括工具」有解，但路径不是消息 API，而是"把自己伪装成 Today 的一个设备连接器"。**

Today 的模型跑在云端，它通过 WebSocket 把工具调用下发给「设备」，设备执行后回传结果。
APK 里有一整套完整协议：`ai.today.cloud.protocol.*`（35 个 DTO）。

我看到的连接器清单（`GET /v1/connectors` 实测，98 个）里，设备类就包括：

```
windows_shell      Windows 命令行
windows_desktop    Windows 桌面
windows_documents  Windows 文稿
windows_downloads  Windows 下载
windows_other_files Windows 本地文件
linux_shell / linux_desktop / linux_documents / ...
macos_shell / macos_ghost(Operate Computer) / ...
android_fs / android_sms / android_notification / ...
```

`connectable=false` 表示不能从 Web 连，只能由**对应的原生客户端**注册。

**这意味着：如果我实现一个设备连接器客户端，注册到你的账号下，
云端 agent 就能调用我声明的任意工具——这才是原生 tool-call，不是文本回灌。**

---

## 1. 设备侧协议（来自 `ai.today.cloud.protocol`）

### 1.1 注册设备（HTTP）

```
POST /v1/devices    （DeviceRegistrationRequestBody）
{
  "name": "<设备名>",
  "clientPlatform": "android",   // ← 硬编码在构造器里
  "clientType": "<类型>",
  "platform": "<平台>",
  "version": "<版本>",
  "clientMachineId": "<机器唯一ID>",
  "notificationEnabled": <bool>
}
```

必填位掩码 `39 = 0b100111` ⇒ `name`(1) + `clientPlatform`(2) + `clientType`(4) + `clientMachineId`(32)。
返回 `DeviceRegistrationResponseBody`（含 device）。

### 1.2 拿 WS ticket（HTTP）

```
POST /v1/browser/{id}/ticket     # 浏览器通道
```
或设备通道对应的 ticket 端点，返回 `WsTicketResponseBody`。

### 1.3 连接 WebSocket

```
wss://api.todayai.cn
Sec-WebSocket-Protocol: today-browser-v1, today-browser-ticket.<ticket>
```

### 1.4 握手（连上后第一帧）

**新连接** — `DeviceHelloPayload`：
```json
{
  "type": "device.hello",
  "id": "<uuid>",
  "timestamp": "<ISO-8601>",
  "deviceId": "<deviceId>",
  "tools": [ <PeerToolInfo>... ],
  "messageProtocolVersion": "canonical-v1",
  "messageReactionsUnicodeVersion": "v1"
}
```
必填位掩码 `14 = 0b1110` ⇒ `id` + `timestamp` + `deviceId`。
`tools` 可选（默认空列表）——**这就是工具注册的地方**。

**恢复** — `DeviceResumePayload`：
```json
{ "type": "device.resume", "id": "<uuid>", "timestamp": "<ISO>", "sessionId": "<...>", "lastSeq": <int> }
```

**心跳** — `DeviceHeartbeatPayload`：
```json
{ "type": "device.heartbeat", "id": "<uuid>", "timestamp": "<ISO>", "deviceId": "<...>", "load": <DeviceLoad> }
```

### 1.5 工具声明结构 `PeerToolInfo`

| 字段 | 含义 | 必填 |
|---|---|---|
| `capabilityId` | 工具 id | 否 |
| `version` | 版本 | 否 |
| `inputSchema` | JSON Schema | 否 |
| `outputSchema` | JSON Schema | 否 |
| `executorType` | 执行器类型 | 否 |
| `riskLevel` | 风险等级 | 否 |
| `enabled` | 是否启用 | 否 |

**注意：全部字段可选** ⇒ 服务端容忍度高，接口容易接。

### 1.6 云端下发调用 `InvocationRequestMessage`

| 字段 | 含义 |
|---|---|
| `type` | 消息类型 |
| `id` | 消息 id |
| `timestamp` | 时间戳 |
| `invocationId` | **调用 id（回传时对应）** |
| `capabilityId` | 要调用的工具 |
| `args` | JSON 参数 |
| `timeoutMs` | 超时（int） |
| `seq` | 序号（Integer，可选） |

必填位掩码 `127 = 0b1111111` ⇒ 前 7 个字段全部必填。

### 1.7 回传结果 `InvocationResultPayload`

```json
{
  "type": "invocation.result",
  "id": "<uuid>",
  "timestamp": "<ISO>",
  "invocationId": "<对应请求>",
  "success": true,
  "data": { ... },
  "error": { "code": "...", "message": "...", "details": {...} }
}
```
必填位掩码 `30 = 0b11110` ⇒ `id` + `timestamp` + `invocationId` + `success` 必填。

错误结构 `ErrorPayload`：`code`(必填) + `message`(必填) + `details`(可选)。

### 1.8 其它消息类型（都在 `protocol/` 目录）

```
InvocationAckPayload        调用已受理
InvocationProgressPayload   进度上报
InvocationCancelMessage     取消
ClientStatusPayload         客户端状态
ClientReceivedPayload       已收到
ResultAckMessage            结果确认
HelloAckMessage             握手确认
InboundMessageEnvelope      入站信封
PendingInvocationsMessage   待处理调用（断线重连补发）
PendingInvocationEntry      单条待处理项
ResumeOkMessage / ResumeFailedMessage   恢复结果
DevicesUpdatedMessage       设备列表变更
EventPushMessage            事件推送
CloudErrorInboundMessage    云端错误
```

### 1.9 工具热更新（HTTP）

```
POST /v1/devices/{deviceId}/tools    （UpdateToolsRequestBody）
{ "tools": [ <PeerToolInfo>... ] }
→ UpdateToolsResponseBody
```
不用重连就能增删工具。

---

## 2. 这条路的实际价值

| 对比项 | 消息 API（`/v1/messages`） | 设备连接器 |
|---|---|---|
| 原生工具调用 | ❌ 无 | ✅ 有完整 schema |
| 工具由谁执行 | — | 你的设备（本地） |
| 模型决策 | 只能文本 | 云端 agent 自主决定调用 |
| 流式 | ❌ 提交+推送 | 调用级流式（progress/result） |
| 额度消耗 | 会消耗 | 由云端会话消耗 |
| 需要改 Today | 否 | 否，只需实现设备端 |

**这条路能满足「能用所有东西包括工具」——因为工具就是我注册上去的，
我可以注册 `shell_exec`、`read_file`、`http_fetch` 等任意 DSH 能力。**

---

## 3. 落地路径

### 阶段一：验证握手（不需要额度判断）
1. `POST /v1/devices` 注册一个 `clientType=device` 的虚拟设备
2. 拿 WS ticket，连 `wss://api.todayai.cn`
3. 发 `device.hello`，`tools: []`（先空）
4. 确认收到 `hello.ack`

### 阶段二：注册工具
5. `POST /v1/devices/{id}/tools` 注册 1 个无害工具（如 `echo`）
6. 在 Web/App 里让 agent 调用它
7. 收到 `invocation.request` → 回 `invocation.result`

### 阶段三：接 DSH
8. 把 DSH 的工具（bash / read / write / web）映射成 `PeerToolInfo` 注册上去
9. 云端 agent 调用 → 本地执行 → 回传结果
10. **此时 Today 真正具备了 DSH 的工具能力**

---

## 4. 风险与限制（必须知道）

1. **`clientPlatform` 硬编码 `"android"`** — 协议层暗示设备类型被服务端校验；
   伪装成 windows 设备可能需要匹配的动作。需要实测哪些 `clientType` 被接受。
2. **设备注册可能需要客户端证明** — 目前没看到签名/attestation，
   但服务端可能校验 UA / 版本 / 平台组合。
3. **工具在你的机器上执行** — 这是本地代码执行，权限与隔离必须自己控制。
   建议只在专用账号 + 沙箱里跑，不要在主力账号上注册 shell 工具。
4. **未实测** — 以上全部来自静态还原（35 个 DTO + API 端点），
   握手/调用/回传都要真实跑一遍才能确认。
5. **注销/换号前不要接** — 先确认账号能长期用，再接设备连接器。

---

## 5. 我建议的下一步

**先做阶段一（握手验证），不碰额度、不碰工具、不改账号。**

如果握手通过，说明这条路成立，后续接 DSH 工具就能实现「原生工具调用」；
如果不通过（比如服务端要求真实设备凭证），那我再回来评估是否只能退回
「文本回灌」的受限方案。

要我现在跑阶段一吗？只做：注册设备 → 连 WS → 发 hello → 看 ack。

## Z-ACK
Z-ACK · 冷咖啡 · 轮次 6 · 状态 继续
