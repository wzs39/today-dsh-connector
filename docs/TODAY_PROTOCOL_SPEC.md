# Today · PC 端协议复现规格（实测 + 静态还原）

生成时间：2026-11-18 · 账号：+86 198****3938（free）

## 0. 能力边界（必须先读）

| 能力 | 状态 | 依据 |
|---|---|---|
| PC 端登录 / 保持会话 | **已验证** | session cookie 换 JWT 实测 200 |
| JWT 续期（无需手机） | **已验证** | 纯 Python + cookie 刷新成功 |
| 读历史消息 / 会话 | **已验证** | `GET /v1/conversations/messages` 200 |
| 读账号/定价/模型 | **已验证** | `/v1/users/me`、`/v1/pricing/status` 200 |
| 设置模型偏好 | **已验证** | `PUT /v1/pricing/model-option` 200 |
| 发消息（提交文本） | **协议已验证，被额度拦截** | `POST /v1/messages` → 429 `quota_denied` |
| 接收回复 | **协议已知，未实测** | WS push 或 history 轮询 |
| WebSocket 直连 | **未实测** | 需有额度账号 |
| **工具调用（tool-call）** | **不存在** | 消息 part 类型无 tool 通道 |
| 附件上传 | 端点已知，未实测 | `/v1/files` |

> **重要**：Today 不是 agent 运行时。它的消息体只有 `text` / `image` / `file` / `voice` / `link` 五种 part，
> 没有 `tool-call` / `tool-result`。因此**无法把 DSH 的工具调用循环映射到 Today 内部**。
> DSH 的工具能力只能在 DSH 本地循环里实现（DSH 执行工具，把结果作为普通文本再喂给模型），
> 这是「文本回灌」而非原生工具调用，能力与延迟都有本质差别。这一点不在文档里含糊。

## 1. 认证

### 1.1 两级凭据

| 层 | 内容 | 生命周期 |
|---|---|---|
| Web 会话 | Cookie `__Secure-better-auth.session_token` | 长期（better-auth） |
| API 访问 | ES256 JWT（`Authorization: Bearer`） | 1 小时 |

### 1.2 换 JWT

```
POST https://todayai.cn/api/token
Content-Type: application/json
Cookie: __Secure-better-auth.session_token=<cookie>
Origin: https://todayai.cn

{"audience":"https://api.todayai.cn","expiresIn":3600}
```

响应：`{"token":"eyJ...","expiresAt":"...","expiresIn":3600,"audience":"...","issuer":"https://auth.todayai.cn"}`

**实测（纯 Python，无浏览器）**：status 200，token 长度 530，新 token 调 API 200。

### 1.3 JWT payload

```
sub / id  : USER_ID_REDACTED
aud       : https://api.todayai.cn
iss       : https://auth.todayai.cn
email     : 3938-ad207b96@p.todayai.internal
role      : user
iat / exp : 1 小时
```

### 1.4 登录方式

Web 端：手机号 + 短信 OTP
- `POST /api/auth/phone-number/send-otp`
- `POST /api/auth/phone-number/verify`

App 端另有 OAuth（`/api/auth/oauth2/token`，`client_id=Bh2VwEojzfuJw4kBGuLQf3wxGEoupUnx`）。

## 2. 必需请求头

```http
Authorization: Bearer <jwt>
x-device-id:    web_<uuid>          # 首次启动生成，与账号绑定
x-app-version:  2.0.0
x-client-platform: web
x-client-capabilities: chat.browser.v1,...,pricing.usage_breakdown_tags.v1
x-timezone:     Europe/Kiev
accept-language: zh-CN,zh;q=0.9
Origin:         https://todayai.cn
```

**实测**：HTTP 层只校验 `Authorization`。我用裸 token + 仅 x-device-id 就拿到 200。
但服务端风控会看全部头，长期调用应完整复刻。

## 3. 发送消息

### 3.1 端点与参数（来自 JS 生成的 API client）

```
POST /v1/messages
```
（Web 端经 fetch 拦截器重写为 `https://todayai.cn/api/cloud/v1/messages`；
直连 `https://api.todayai.cn/v1/messages` 同样有效）

Query（可选，canonical 客户端会带）：
```
conversation_id=<id>   |  isMainChat=true
client_message_id=<uuid>
task_id=<id>
```

### 3.2 Body（canonical-v1）

```json
{
  "body": {
    "parts": [
      { "id": "<uuid>", "type": "text", "text": "你好" }
    ]
  },
  "clientMessageId": "<uuid>",
  "isMainChat": true
}
```

Part 类型（严格 schema，`strict()`）：
```
{ id, type: "text",  text }                                    # text ≤ 1e6
{ id, type: "image"|"file"|"voice", uploadedFile }             # 需先上传
{ id, type: "link",  url, displayName? }
```
约束：`parts` 1..100 条；**无 tool-call 类型**。

### 3.3 实测结果

| body | 结果 |
|---|---|
| `{clientMessageId, content}` | 429 `quota_denied` |
| `{clientMessageId, message, content}` | 429 `quota_denied` |
| canonical `{body:{parts:[...]}, clientMessageId, isMainChat}` | 429 `quota_denied` |

**429 而非 400 ⇒ body 结构已被接受，拦截点在额度。**

## 4. 接收回复

### 4.1 账号能力位（`GET /v1/users/me/protocol-capabilities` 实测 200）

```json
{
  "architecture": "canonical",
  "messageCapabilities": {
    "messageProtocolVersion": "canonical-v1",
    "authSubject": "<accountId>",
    "mainConversationId": "<accountId>",
    "supportsTypedBody": true,
    "messageReactionsVersion": "v1",
    "supportsSequencePull": true,
    "supportsLongPoll": true,
    "longPollWaitMaxMs": 25000,
    "supportsAtomicCardContinuation": false
  },
  "fileCapabilities": {
    "linkProtocolVersion": "file-links-v1",
    "supportedLinkTypes": ["public_share"]
  }
}
```

注意：**没有 tools / function-calling 能力位。**

### 4.2 拉历史（实测 200）

```
GET /v1/conversations/messages?isMainChat=true&limit=5
→ {"success":true,"code":"common.ok","data":{"items":[],"paging":{"nextCursor":null,"hasMore":false}}}
```

可用参数：`isMainChat=true`、`limit`、`before`（更早）、`after`（更新，即长轮询语义）。
`direction=latest` 会被拒（400 `common.invalid_request`）。

另有一条旧式接口（实测 200，结构不同）：
```
GET /v2/messages  → {"object":"list","data":[],"total":0,"hasMore":false,"nextCursor":null}
```

### 4.3 推送

WS 事件：`chat.messageReadyV2` / `chat.messageUpdatedV2`，
WSS 地址 `wss://api.todayai.cn`（子协议 `today-browser-v1`）。
**未实测**（需有额度账号触发真实回复）。

## 5. 模型选择

```
PUT /v1/pricing/model-option
{"optionId":"model.deepseek-v4.1-flash"}
→ 200，返回完整 modelOptions
```

可用模型（`/v1/pricing/status` 实测）：`model.deepseek-v4.1-flash`（1x）、
`model.minimax-m31-flash`（1x）、`model.glm-5.3`（4x）、`model.glm-5.3-flash` 等。

## 6. 附件

```
POST /v1/files                  # 上传
POST /v1/files/share-links      # 分享链接
GET  /v1/files/{fileId}/versions/{versionId}/links
```
上传后把返回的 `fileRef` 塞进 part 的 `uploadedFile`。

## 7. 邀请与注销（收集到的服务端规则）

### 7.1 邀请奖励（`GET /v1/growth/invitations/config` 实测 200）

原文规则：
> 邀请 1 / 3 / 7 位好友注册成功，每到一个档位可获得一次**重置机会**，最多 3 次。
> 通过有效邀请首次注册的新用户可获得 **1 次重置机会**，老用户不重复赠送。
> 仅分享链接或二维码给好友，不会发放奖励。

端点：`GET /v1/growth/invitations/me/link`、`POST /v1/growth/invitations/me/link`

**关键**：奖励是「重置额度」，不是「新增额度」。新用户走邀请链接注册 = 拿到 1 次重置。

### 7.2 注销三步（`defpackage/y4.java`）

```
POST /v1/account/otp/send      {"purpose":"account_delete"}
POST /v1/account/otp/verify    {challengeId, code}
POST /v1/account/delete/confirm {"challengeId"}
→ {"deleted":true,"userId":"..."}
```

### 7.3 同号重注：**仍未知**

代码里没有「注销后同号冷却」的客户端逻辑，但这属于服务端策略，
只读手段无法证明。**只有实际发 OTP 才能看到服务端反应。**

## 8. 挂到 DSH 的可行方案（如实版）

### 8.1 能做
- 注册成 DSH 模型提供方（`LlmAdapter` + `ctx.llm.registerAdapter`）
- JWT 自动续期（cookie → `/api/token`），进程内无可感知中断
- 模型目录静态化，零上游轮询
- 文本对话（有额度时）
- 429 `quota_denied` 明确上报为 PROVIDER 错误，不重试（避免撞风控）

### 8.2 做不到 / 有重大妥协
- **原生工具调用**：Today 没有 tool-call 通道。DSH 工具只能本地执行后把结果拼进文本再发，
  模型看不到结构化工具定义，无法自己决定调用、无法流式返回工具参数。
  → 这会显著降低工具使用质量，且和 DSH 的 tool loop 语义不一致。
- **流式**：协议是「提交后等推送」，不是 SSE token 流。DSH 侧只能整段返回或按 history 增量伪造流。
- **system prompt**：canonical body 没有 system role，只能拼进第一条 user 文本。
- **会话隔离**：`mainConversationId` = 账号 ID，所有对话共用一条主线，
  无法像 API 那样每次请求独立上下下文。并发会互相污染。

### 8.3 结论
建议按「**受限模型提供方**」接入：
- 明确标注：无原生工具调用、无真流式、单会话串行
- 适合：文本问答、改写、总结这类不需要工具的任务
- 不适合：需要 agentic 工具循环的工作流

## Z-ACK
Z-ACK · 冷咖啡 · 轮次 5 · 状态 继续
