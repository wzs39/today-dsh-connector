# Today 设备连接器 · 完整实测报告

实测时间：2026-11-18 20:21–20:25 · 账号 free

## 一、已完全打通（全部实测成功）

### 1. 认证（纯 Python，无浏览器）

```
POST https://todayai.cn/api/token
Cookie: __Secure-better-auth.session_token=<cookie>
{"audience":"https://api.todayai.cn","expiresIn":3600}
→ 200 {"token":"eyJ...(530)","expiresAt":"...","expiresIn":3600}
```
**实测：新 token 调 API 200。不需要手机。**

### 2. 设备注册

```
POST /registry/devices
{"name":"DSH Connector","clientPlatform":"windows","clientType":"desktop-app",
 "platform":"windows","version":"2.0.0","clientMachineId":"<32hex>","notificationEnabled":false}
→ 201 {"device":{"id":"DEVICE_ID_REDACTED", ...}}
```

**合法配对（穷举实测）**：
| clientPlatform | clientType | 结果 |
|---|---|---|
| `windows` | `desktop-app` | **201 ✅** |
| 其它组合 | — | 400 incompatible / Invalid input |

### 3. 工具注册（关键突破）

```
PUT /registry/devices/{deviceId}/tools
{"tools":[{"capabilityId":"dsh.echo","version":"1.0.0",
  "description":"Echo back the given text",
  "executorType":"device_node",          ← 必须是 device_node 或 cloud_sandbox
  "riskLevel":"low","enabled":true,
  "inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]},
  "outputSchema":{"type":"object","properties":{"text":{"type":"string"}}}}]}
→ 200 {"success":true,"aexSkillHash":[]}
```

**实测确认已挂载**（`GET /v1/devices/{id}`）：
```json
"tools":[{"deviceId":"DEVICE_ID_REDACTED","capabilityId":"dsh.echo",
"executorType":"device_node","riskLevel":"medium","enabled":true,
"inputSchema":{"...","additionalProperties":false}}]
```
服务端自动补 `additionalProperties:false`，`riskLevel` 归一为 `medium`。

**踩坑记录**：
- `POST` → 404（必须是 PUT）
- `executorType:"device"` → 400 `expected one of "device_node"|"cloud_sandbox"`
- 缺 `description` → 400 `expected string, received undefined`

### 4. WebSocket 握手（关键突破）

**端点与 ticket 载体**（穷举实测）：

| 载体 | 结果 |
|---|---|
| `wss://api.todayai.cn`（根） | 1006 |
| `/v1/ws`、`/v1/browser/stream` | 1006 |
| `/ws` + ticket 放**子协议** | 101 后拒：`Missing websocket ticket` |
| `/ws` + ticket 放**各种头** | 101 后拒 |
| `/ws?framesEnabled=false&ticket=<T>` | **101 + hello_ack ✅** |

```
wss://api.todayai.cn/ws?framesEnabled=false&ticket=<TICKET>
Sec-WebSocket-Protocol: today-browser-v1
Origin: https://todayai.cn
```
ticket 来源：`POST /ws-ticket {}` → `{"ticket":"eyJ...","expiresInSeconds":60}`
（HS256，payload: `kind:ws_ticket, aud:cloud-service-ws, sub:<accountId>, exp:+60s`）

**Node 内置 WebSocket 无法设自定义头，用 `node:https` 手写 Upgrade 成功。**

### 5. 握手确认

```json
{"type":"cloud.hello_ack","connectionId":"...","deviceId":"DEVICE_ID_REDACTED",
 "heartbeatIntervalMs":30000,"messageProtocolVersion":"canonical-v1",
 "sessionId":"d73581df-...","aexSkillHash":[]}
```

之后持续收到：
- `cloud.devices_updated`（每 30s 或变更时）
- `event.push`（`agent_indicator.status.v1`，status=idle）
- `cloud.heartbeat_ack`（心跳 30s，实测稳定）

### 6. 设备在线状态

`GET /v1/devices/{id}` → `online: true`（WS 连上后）

---

## 二、未打通（架构限制，如实记录）

### 阻塞点：设备不在云端 agent 的可见列表

证据：
```json
// WS 收到的 cloud.devices_updated
{"devices":[{"id":"d_cloud","clientPlatform":"cloud","clientType":"cloud-sandbox","online":true}]}
```
**只有 `d_cloud`，没有我的 `DEVICE_ID_REDACTED`（尽管它 online=true 且有工具）。**

设备详情里的连接器全是未连接：
```json
"connectors":[
 {"id":"windows_shell","connected":false},
 {"id":"windows_desktop","connected":false},
 {"id":"windows_documents","connected":false},
 {"id":"windows_downloads","connected":false},
 {"id":"windows_other_files","connected":false}]
```

试过 `POST /v1/connectors/windows_shell/device-connect-event` → **202 受理，但状态未变**。
说明「连接」还需要设备侧通过 WS 上报实际能力握手，或走 app 专属确认流程。

### 无法触发 invocation

挂 WS 5 分钟，收到 hello_ack / devices_updated / event.push / heartbeat_ack，
**没有收到任何 `invocation.request`**——符合预期：设备未进入 agent 可选列表。

### 另一条路已排除

`/v1/browser/{id}/ticket` 的 `{id}` 不是设备 ID（实测 400）；
`POST /v1/browser/sessions` → 404；Web JS 里只有 ticket/stream，**没有 create 端点**。
该 `{id}` 由 cloud sandbox 内部创建，公开 API 层没有入口。

---

## 三、结论

| 能力 | 状态 | 说明 |
|---|---|---|
| Cookie 换 JWT | ✅ 实测 | 无需手机，可长期 |
| 设备注册 | ✅ 实测 | `windows`+`desktop-app` |
| **工具注册** | ✅ 实测 | `PUT` + `device_node`，200 |
| **WS 握手** | ✅ 实测 | `/ws?...&ticket=`，hello_ack |
| 心跳保活 | ✅ 实测 | 30s，稳定 |
| 设备上线状态 | ✅ 实测 | online=true |
| **云端调用本地工具** | ❌ 未通 | 设备不在 agent 可见列表 |
| 连接器 connected 标记 | ❌ 未通 | 202 受理但状态未变 |

**「原生工具调用」协议层已完全掌握并验证到「工具已挂载 + 设备已在线」，
差最后一步：让设备进入云端 agent 的设备列表（需连接器实际握手，属于 app 内部流程）。**

---

## 四、下一步可选方向

1. **继续攻连接器握手**：找 `windows_shell` 等连接器的 device-side 确认协议
   （可能要求 WS 上报 `connector.ready` 或类似消息类型）
2. **换有额度账号**：额度与设备可见性可能是两件事，需实测对比
3. **退回受限方案**：把 Today 当纯文本模型提供方接入 DSH
   （JWT 自动续期已通，无工具无流式，标注清楚）

## 五、产出文件

| 文件 | 用途 |
|---|---|
| `connector-mvp.mjs` | 完整验证脚本（注册→工具→WS→握手） |
| `connector-listen.mjs` | 挂 WS 监听 invocation，自动回结果 |
| `ws-native.mjs` | 手写 WS Upgrade（可设自定义头） |
| `ws-ticket-carriers.mjs` | ticket 载体穷举探测 |
| `TODAY_PROTOCOL_SPEC.md` | 消息 API 协议规格 |
| `DEVICE_CONNECTOR_TOOLS.md` | 设备连接器架构分析 |
| `DEVICE_HANDSHAKE_RESULT.md` | 握手阶段记录 |

## Z-ACK
Z-ACK · 冷咖啡 · 轮次 8 · 状态 继续
