# Today → DeepSeek Harness 连接器

把 [Today](https://todayai.cn) 注册成 DeepSeek Harness（DSH）的模型提供方，让 DSH 的工具循环（agent loop）能跑在 Today 的模型上。

## 这是什么

逆向 `ai.today.android.app.cn` / Today 1.26.1 后，用 DSH 的 `llm.registerAdapter` 接了一个自定义 provider：

- **鉴权**：Web cookie `__Secure-better-auth.session_token` → `POST /api/token` 换 1 小时 JWT；Bearer JWT 访问 `api.todayai.cn`。
- **消息**：`POST /v1/messages`（`canonical-v1`，`body.parts` 结构），轮询 `GET /v1/conversations/messages` 取回复。
- **无原生 tool-call / 无 system role / 无真流式 / 单会话** —— 这些限制都在适配器里用文本协议绕过。

## 关键实现

1. **文本模拟 tool-call**（`plugin/lib/adapter.js` 的 `_toolInstructions` + `_parseToolCalls`）
   把工具定义拼进 prompt，要求模型回 `<<TOOL>>{"name":...,"arguments":{...}}<<END>>`，解析后发 DSH `tool-call` 块 + `finish {kind:'tool-calls'}`。解析器支持 7 种方言（含 `<tool_call>`、裸 JSON、DeepSeek 原生 DSML 标记等），并用「工具名白名单 + JSON 可解析」防误报，未匹配的块原样回退为文本。

2. **工具 schema 瘦身防 413**（`plugin/lib/adapter.js` 的 `_simplifySchema`）
   移植自 `~/.dsh/qwen_schema_proxy.py` 的 `simplify_schema()`：工具多时参数 schema 过深会把请求体撑爆，Today 返回 `413 Payload too large`。现在对 `depth >= schemaMaxDepth` 的 object 折叠为 `type`+截断的 `description`，去掉 `$schema`，长描述截到 `schemaDescMax`，并用 `maxTools` 限制单轮注入数量。实测 60 个深层工具：121071 → 46435 字节（38.4%）。

## 目录

- `plugin/` — DSH 插件（`package.json` + `lib/` + 测试）。用 DSH bundle patch 装载。
- `docs/` — 逆向与交付文档（已脱敏）：
  - `TODAY_PROTOCOL_SPEC.md` — 完整协议（鉴权/消息/part 类型/模型切换/设备协议）。
  - `TODAY_WORKING_CLIENT.md` — 可直接跑的 Python 客户端。
  - `DEVICE_CONNECTOR_TOOLS.md` / `CONNECTOR_FINAL_REPORT.md` — 设备连接器路线（已证实 `TOOL_NOT_AVAILABLE`，仅作记录）。
  - `REVERSE_PROXY_ANALYSIS.md` — APK 反代防封分析。
  - `FINAL_DELIVERY.md` — 总交付报告（含 413 / context compaction 两错误分工）。

## 用法

1. 把 `plugin/` 作为 DSH 本地 bundle 安装（或按 `plugin/cordis.patch.yml` 把 patch 加进 profile 的 `cordis.patch.yml`）。
2. 在 profile 配置里填 `sessionCookie`（登录 todayai.cn 后从 Cookie 复制 `__Secure-better-auth.session_token` 的值）。
3. 可选调参：`schemaMaxDepth`（默认 2）、`schemaDescMax`（默认 200）、`maxTools`（0 不限，工具多时设 40~80）。
4. 重启 DSH，模型列表出现 `Today（第三方客户端）` 及 4 个模型。

⚠️ 不要把真实 cookie / token 提交进仓库；测试脚本从本机 `base_analysis/session_cookie.txt` 读取凭据（不随本仓库分发）。

## 限制（如实）

- 文本模拟 ≠ 原生 tool-call：极端复杂参数仍可能输出格式错误（安全降级为纯文本）。
- 单会话 + 轮询，无并发；依赖账号额度（429 时按真实限流处理，不绕过）。
- DSH 自身的 `context compaction failed` 与本连接器无关，开新会话可解。
