# Today PC 端完整协议 · 已验证可用

实测时间：2026-11-18 20:48 · 账号 `USER_ID_REDACTED`（邀请后 plan=pro）

## 0. 端到端已验证的事实

```
POST /v1/messages → 202 {"threadId":"01a1f06b-...","messageId":"...","isDuplicate":false}
GET  /v1/conversations/messages → 拿到 assistant 回复 "HELLO_FROM_PC"
```

**发送 → 接收 → 内容正确，全链路跑通。**

---

## 1. 认证（纯 Python，无需浏览器/手机）

### 1.1 换 JWT

```python
POST https://todayai.cn/api/token
Cookie: __Secure-better-auth.session_token=<cookie>
Content-Type: application/json

{"audience":"https://api.todayai.cn","expiresIn":3600}
```

响应：
```json
{"token":"eyJ...(530)","expiresAt":"2026-11-18T21:48:29.000Z",
 "expiresIn":3600,"audience":"https://api.todayai.cn","issuer":"https://auth.todayai.cn"}
```

**实测：cookie 长度 87，token 530，新 token 直接可用。**

### 1.2 session cookie 获取

登录后浏览器 cookie：
```
__Secure-better-auth.session_token=<sessionId>.<secret>
```
同时存在一个 `_multi-<sessionId>` 变体。

### 1.3 登录通道（实测结论）

| 通道 | 状态 |
|---|---|
| 手机 + 短信 OTP | ✅ 可用（`POST /api/auth/phone-number/send-otp`） |
| 邮箱 OTP | ❌ `auth.email_sign_in_disabled`（该地区不开放） |
| `190` 号段 | ❌ 服务端返回 `code sent` 但**实际收不到**（同接口 `198` 能收） |

邀请链接格式：
```
https://todayai.cn/login?utm_source=invitation&utm_id=<utmId>
```
通过 `POST /v1/growth/invitations/me/link` 获取。

---

## 2. 发消息（实测 202 成功）

```python
POST https://api.todayai.cn/v1/messages
Authorization: Bearer <JWT>
Content-Type: application/json
x-device-id: web_<uuid>
x-app-version: 2.0.0
Origin: https://todayai.cn

{
  "body": { "parts": [ { "id": "<uuid>", "type": "text", "text": "你的问题" } ] },
  "clientMessageId": "<uuid>",
  "isMainChat": true
}
```

响应 202：
```json
{"threadId":"01a1f06b-349b-77db-a427-be00b2922a54",
 "messageId":"01a1f06b-349b-7b95-9f92-0ae428023d95",
 "clientMessageId":"1937a765-...","createdAt":"...","isDuplicate":false,
 "canonicalMessage":{"id":"...","conversationId":"<accountId>","threadId":"...",
   "cursor":"eyJ2IjoxLCJ0IjoxNzk1MDM0OTIwMTI1LCJpZCI6Ii4uLiJ9",
   "role":"user","state":"completed","isFinal":true,
   "originTriggerType":"asst_response", ...}}
```

`originTriggerType:"asst_response"` 表示**助手回复已自动触发**，无需额外调用。

---

## 3. 读回复（实测成功）

```python
GET https://api.todayai.cn/v1/conversations/messages?isMainChat=true&limit=10
Authorization: Bearer <JWT>
```

响应：
```json
{"success":true,"code":"common.ok",
 "data":{"items":[...],"paging":{"nextCursor":null,"hasMore":false}}}
```

### 3.1 真实消息结构（关键）

parts 用 **`messageType` + `content`**，不是 `type` + `text`：

```json
{
  "role": "user",
  "state": "completed",
  "isFinal": true,
  "body": {
    "parts": [
      { "messageType": "text", "content": { "text": "Reply with exactly: HELLO_FROM_PC" } }
    ]
  }
}
```

助手回复同构：
```json
{ "messageType": "text", "content": { "text": "HELLO_FROM_PC" } }
```

### 3.2 其它 part 类型（实测见到）

```json
{ "messageType": "idea_recommendation_card",
  "content": { "cardId":"ic_...", "source":"onboarding", "text":"...", "items":[{ideaId,emoji,title,subtitle,prompt}] } }

{ "messageType": "tail_bubble",
  "content": { "messageSubtype":"...", "state":"...", "title":"...", "deeplink":"..." } }
```

**提取正文的正确写法**：
```python
def text_of(msg):
    out = []
    for p in msg.get("body", {}).get("parts", []):
        if p.get("messageType") == "text":
            out.append(p.get("content", {}).get("text", ""))
    return "".join(out)
```

### 3.3 发消息时的 part 兼容性

我用 `{"type":"text","text":"..."}` 提交，服务端**接受并归一化**成 `{messageType,content}`。
两种写法都能用，但读的时候只认 `messageType`。

---

## 4. 账号状态（邀请后实测）

```python
GET https://api.todayai.cn/v1/pricing/status
```

| 字段 | 邀请前（free） | 邀请后 |
|---|---|---|
| `plan` | `free` | **`pro`** |
| `subscriptionState` | `none` | `none` |
| `accessPhase` | `none` | **`normal`** |
| `serviceState` | `normal` | `normal` |
| `usage` | `null` | `{"period":"monthly","resetAt":"2026-12-18...","progress":0}` |

**邀请链接确实给了重置额度**（`inviteeResetCount: 1`），从 free 变 pro 并可发消息。

---

## 5. 模型选择

```python
PUT https://api.todayai.cn/v1/pricing/model-option
{"optionId":"model.deepseek-v4.1-flash"}
→ 200
```

可选：
- `model.deepseek-v4.1-flash`（1x）
- `model.minimax-m31-flash`（1x）
- `model.glm-5.3`（4x）
- `model.glm-5.3-flash`

---

## 6. 完整可用客户端（已验证）

```python
import json, time, urllib.request, uuid

COOKIE = "<从浏览器复制>"
DEVICE = "web_191b4c28-bdd3-449d-b113-9758104cfd2b"

def token():
    req = urllib.request.Request(
        "https://todayai.cn/api/token",
        data=json.dumps({"audience": "https://api.todayai.cn", "expiresIn": 3600}).encode(),
        headers={"content-type": "application/json",
                 "cookie": f"__Secure-better-auth.session_token={COOKIE}",
                 "origin": "https://todayai.cn"},
        method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=20).read())["token"]

def hdr(tok):
    return {"authorization": f"Bearer {tok}", "content-type": "application/json",
            "x-device-id": DEVICE, "x-app-version": "2.0.0",
            "origin": "https://todayai.cn"}

def say(tok, text):
    body = {"body": {"parts": [{"id": str(uuid.uuid4()), "type": "text", "text": text}]},
            "clientMessageId": str(uuid.uuid4()), "isMainChat": True}
    req = urllib.request.Request("https://api.todayai.cn/v1/messages",
                                 data=json.dumps(body).encode(), headers=hdr(tok), method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

def read(tok, limit=10):
    req = urllib.request.Request(
        f"https://api.todayai.cn/v1/conversations/messages?isMainChat=true&limit={limit}",
        headers=hdr(tok))
    d = json.loads(urllib.request.urlopen(req, timeout=20).read())
    return d["data"]["items"]

def text_of(msg):
    return "".join(p.get("content", {}).get("text", "")
                   for p in msg.get("body", {}).get("parts", [])
                   if p.get("messageType") == "text")

def ask(tok, q, timeout=90):
    say(tok, q)
    t0 = time.time()
    while time.time() - t0 < timeout:
        items = read(tok)
        for m in items:
            if m.get("role") == "assistant" and text_of(m):
                return text_of(m)
        time.sleep(3)
    return None
```

---

## 7. 已知限制（如实）

| 项 | 状态 |
|---|---|
| 发/收文本消息 | ✅ 已验证 |
| JWT 自动续期 | ✅ 已验证（纯 cookie） |
| 模型切换 | ✅ 已验证 |
| 原生长文本流式 | ❌ 无 SSE，只能轮询或 WS 推送 |
| tool-call（消息 API） | ❌ part 无工具类型 |
| 设备连接器工具 | 已挂载成功，未触发调用（见 CONNECTOR_FINAL_REPORT.md） |
| system prompt | ❌ 无 system role，只能拼进 user 文本 |
| 会话隔离 | ❌ `mainConversationId` = 账号 ID，单会话 |

## Z-ACK
Z-ACK · 冷咖啡 · 轮次 15 · 状态 继续
