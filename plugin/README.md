# dsh-today-connector

把 **Today**（`api.todayai.cn`）注册成 DeepSeek Harness 的模型提供方。

## 这个插件能做什么

- **Cookie 自动续期 JWT**：只靠 `__Secure-better-auth.session_token` 换 API token，不需要手机验证码
- **文本对话**：发消息 → 轮询回复 → 返回给 DSH
- **模型切换**：静态清单 4 个模型，零上游轮询
- **额度受限不重试**：429 明确上报，避免撞风控
- **会话标题本地生成**：不消耗额度

## 工具调用：文本协议模拟（已验证可用）

Today 的消息 part 只有 `text` / `image` / `file` / `voice` / `link`，**没有原生 tool-call 字段**。
但实测（2026-11-18）Today 背后的模型能严格遵守自定义输出格式：

```
<<TOOL>>{"name":"get_weather","arguments":{"city":"Beijing"}}<<END>>
```

本插件据此实现了一套**文本协议模拟**，让 DSH 的 agent loop 完整工作：

1. DSH 把 `options.tools`（工具定义）传给适配器
2. 适配器把工具定义转成文本指令拼进 prompt（`simulateTools: true`，默认开启）
3. 模型按标记输出工具调用 → 适配器解析成 DSH 的 `tool-call` 事件（`finish: tool-calls`）
4. DSH 执行工具，把结果作为 `role:'tool'` 消息传回 → 适配器转成文本再发 Today
5. 循环直到模型给出最终答案

对 DSH 的 agent 来说，这是透明的工具调用循环。

**验证脚本**：`test-tool-format.mjs` 实测模型返回合法工具 JSON；`test-tool-dialects.mjs` 多方言打捞 12/12；`test-tool-loop-e2e.mjs` 完整工具循环通过。

**多方言打捞**（吸收自本机仓库 `deepseek-web-bridge/lib/tools.mjs` 与 `diag_toolcall/` 的实测经验）：模型不总按提示词指定的格式输出，解析器现在同时认七种形态——`<<TOOL>>...<<END>>`、`<tool_call>JSON</tool_call>`、`<tool_call>NAME{...}</tool_call>`、`<tool_call>NAME</tool_call>`、畸形开标签 `<NAME</tool_call>`、裸 JSON、以及 DeepSeek 原生 DSML `<｜｜DSML｜｜ invoke>` 块。

**防误报**（关键）：只有 JSON 能解析 **且** 工具名在本次真正提供过的集合里才提升为调用。未提供的工具名、代码围栏里的示例 JSON、解析失败的块——一律原样还原为文本。误报的代价是「文本看起来有点怪」，而不是「整轮丢失」。重复调用按「名字+参数」去重，避免同一动作执行多次。

**工具多导致 413 的解法（schema 瘦身）**：移植自 `C:/Users/qwe/.dsh/qwen_schema_proxy.py`（2026-11-17 写，专门解决「工具多 → 请求体过大 → 413 Payload too large」的 OpenAI 兼容代理）的 `simplify_schema()`。本适配器在 `_toolInstructions` 里对 `parameters` 做同样处理：`depth >= schemaMaxDepth` 的 object 只留 `type`+截断的 `description`，去掉 `$schema`，长描述截到 `schemaDescMax`。配置：

- `schemaMaxDepth`（默认 2）：折叠深度。设 1 更激进，设 3 保留更多结构。
- `schemaDescMax`（默认 200）：description 最大字符数。
- `maxTools`（默认 0 不限，profile 现设 80）：单次最多注入几个工具定义。工具极多时降到 40 最直接。

实测 60 个深层嵌套工具：121071 → 46435 字节（38.4%）。验证 `test-schema-slim.mjs` 9/9。

**两种错误的分工**（用户现场同时遇到，别混为一谈）：

1. `Today 发送失败 HTTP 413：{"error":"Payload too large"}` —— Today 服务端拒绝过大请求体。**由 schema 瘦身 + maxTools 解决**（本轮实现）。
2. `Cannot switch to today/model...: context compaction failed: summary is not smaller than the shadowed content (3679 >= 3639)` —— 这是 **DSH 自己的会话历史压缩失败**，与 Today 适配器无关。当前会话历史太长、压缩收益不够。最短解法：**开一个新会话**（`/new` 或新建 session），把今天的产物文件路径带过去即可；TOKEN 都在文件里，不丢。适配器侧已通过 `includeHistory`/`historyTurns` 控制带多少历史，但 DSH 层压缩不受它管。

**取舍**：这是文本模拟，不是原生结构化 tool-call——工具参数靠模型遵循格式。超长参数（几十 KB 以上）不要走工具参数通道，改为写文件传路径（这条来自 `deepseek-web-bridge/docs/reverse-proxy-playbook.md` 的真实事故：60KB 脚本在参数通道被截断，无报错、脚本从未执行）。

## 其它能力边界

| 能力 | 状态 | 原因 |
|---|---|---|
| 原生结构化 tool-call | **没有** | 协议层无此字段，用上面的文本模拟替代 |
| 真流式输出 | **没有** | 协议是「提交 → 等推送」，无 SSE token 流；本插件靠轮询，整段到手后才分片给 UI |
| 独立会话 | **没有** | `mainConversationId` = 账号 ID，所有对话共用一条主线；插件已强制串行化避免互相污染 |
| system prompt | **退化** | 协议无 system role，system 只能拼进第一条 user 文本 |

**适合**：文本问答、改写、总结、翻译，以及**通过文本模拟调用 DSH 工具**的 agent 任务。

## 安装与配置

### 1. 拿 session cookie

浏览器登录 https://todayai.cn → DevTools → Application → Cookies → 复制
`__Secure-better-auth.session_token` 的值（形如 `<sessionId>.<secret>`）。

注意：插件要的是这个 **cookie**，不是 Bearer JWT。

### 2. 配置

在插件设置里填：

```yaml
sessionCookie: "<复制到的 cookie>"
deviceId: "web_<你的 deviceId>"   # 可选，留空用内置值
```

其余保持默认即可。

### 3. 选用

模型选择器里会出现 `Today（第三方客户端）` 分组，含：
- `Today · DeepSeek V4.1 Flash`
- `Today · MiniMax M3.1 Flash`
- `Today · GLM 5.3 Flash`
- `Today · GLM 5.3（4x 额度）`

## 已验证的事实（2026-11-18）

```
POST /api/token              → 200，cookie 换 JWT，530 字符，1h 有效
POST /v1/messages            → 202，threadId 建立，originTriggerType=asst_response
GET  /v1/conversations/messages → 200，拿到 assistant 回复 "HELLO_FROM_PC"
PUT  /v1/pricing/model-option   → 200
```

完整协议见 `base_analysis/TODAY_WORKING_CLIENT.md`。

## 额度说明

Today 的免费账号会返回 `429 quota_denied`。通过邀请链接注册新账号可获得 1 次重置额度
（`POST /v1/growth/invitations/me/link` 可生成自己的邀请链接）。

这不是绕过，是平台自身的邀请机制。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `Today 未配置 session cookie` | 没填 cookie | 填 `sessionCookie` |
| `换 token 失败 HTTP 4xx` | cookie 失效 | 重新登录，复制新 cookie |
| `额度或限流` | 账号额度用尽 | 换账号或等额度重置，**不要连续重试** |
| `150s 内没有产生回复` | 上游慢或额度受限 | 调大 `replyTimeoutMs` 或检查额度 |
| 回复内容串到别的对话 | 单会话特性 | 这是协议限制，无解；一次只跑一个任务 |

## 许可

MIT
