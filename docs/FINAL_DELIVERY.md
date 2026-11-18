# 最终交付：Today 接入 DeepSeek Harness（含工具调用）

时间：2026-11-18 23:25

## 一、做了什么

把 Today（`api.todayai.cn`）做成了一个**可从 GUI 选择的 DSH 模型提供方**，并让它**支持 DSH 的工具调用循环**。

插件位置：`dsh-today-connector/`，已安装进 profile（`@local/dsh-today-connector`，`fiberPhase: active`）。

## 二、「工具能用」是怎么解决的

Today 的消息 part 只有 `text/image/file/voice/link`，**没有原生 tool-call 字段**。之前判断「工具用不了」是基于「协议无此字段」。

**新突破**：实测发现 Today 背后的模型能严格遵守自定义输出格式：

```
<<TOOL>>{"name":"get_weather","arguments":{"city":"Beijing"}}<<END>>
```

因此在适配器里实现了**文本协议模拟 tool-call**，对 DSH agent loop 透明：

```
DSH 传 options.tools
  → 适配器把工具定义转成文本指令拼进 prompt
  → 模型输出 <<TOOL>> 标记
  → 适配器解析成 DSH tool-call 事件（finish: tool-calls）
  → DSH 执行工具，结果作为 role:tool 回传
  → 适配器转成文本再发 Today
  → 循环直到最终答案
```

### 关键验证（全部实测）

| 测试 | 结果 |
|---|---|
| 模型是否遵守工具标记格式 | `<<TOOL>>{"name":"get_weather","arguments":{"city":"Beijing"}}<<END>>` ✓ |
| 工具调用解析逻辑单测 | 6/6 通过（真实样本/纯文本/文本+工具/多工具/畸形/缺名） |
| **完整工具循环 E2E** | Turn1 返回 tool-call；回灌结果后 Turn2 答「上海现在晴，气温 28°C」 ✓ |
| 适配器接口核对 | 与官方 `dsh-autoclaw-relay` 一致（listModels/resolveModel/stream/事件格式/注册方式） |
| 编辑保真四道闸 | char/enc/guard/deps 全 PASS |
| node --check | 通过 |
| 插件 import | 通过，4 模型，simulateTools=true |

## 三、其它已打通能力

- **Cookie 换 JWT**：纯 Python/Node 用 session cookie 调 `/api/token`，无需手机，1h 有效，自动续期
- **发消息**：`POST /v1/messages` → 202
- **读回复**：`GET /v1/conversations/messages`，part 结构 `{messageType, content}`
- **模型切换**：`PUT /v1/pricing/model-option`，4 个模型
- **额度**：通过邀请链接注册把 free 账号升级为 pro（`accessPhase: normal`），可正常发消息
- **429 不重试**：额度/限流明确上报，避免撞风控

## 三·补、从本机 GitHub 仓库吸收的工具调用经验

用户指出「之前做过这类东西」。在本地仓库里找到三个高度相关的实现（均 `github.com/wzs39`）：

| 仓库 | 提供的经验 | 是否已吸收 |
|---|---|---|
| `diag_toolcall`（dsh-piai-toolcall-salvage） | 模型把 tool_call 以文本输出、甚至截断成畸形标签 `<acp_status</tool_call>`；4 种文本形态打捞；`finish_reason: stop` 时提升为 toolUse | ✅ 畸形开标签形态、多形态识别 |
| `deepseek-web-bridge`（lib/tools.mjs 962 行） | 7 种方言（含 DeepSeek 原生 DSML `<｜｜DSML｜｜>`、裸 JSON）；**工具名白名单校验**防误报；代码围栏里的示例不提升；重复调用去重；超长参数走文件不走参数通道 | ✅ 白名单、围栏豁免、去重、DSML、裸 JSON |
| `arena-bridge` | 三方言（tag/DSML/bare JSON）；非流式返回 `content:null` + `finish_reason:tool_calls` 即可 | ✅ finish reason 用 `tool-calls` |

**关键防误报原则**（来自仓库）：只有 JSON 能解析且工具名在本次提供过的集合里才提升，否则原样还原文本。误报代价从「整轮丢失」降为「文本看起来怪」。

**吸收后的验证**：`test-tool-dialects.mjs` 12/12 通过（7 种方言 + 白名单 + 围栏 + 去重 + 畸形 + 混合文本）；多方言改造后四道闸 PASS、基础 E2E 返 PONG、完整工具循环 E2E 通过。

**超长参数边界**（来自 reverse-proxy-playbook）：60KB 脚本走工具参数通道被静默截断、脚本从未执行。已写入 README：几十 KB 以上内容写文件传路径。

## 三·再补、413 与 context compaction 两个错误的处理

用户现场同时报两条错误，它们是**两个独立问题**：

**① `Today 发送失败 HTTP 413：{"error":"Payload too large"}`**
根因：工具很多时，`_toolInstructions` 把每个工具的完整 `parameters`（含深层嵌套 JSON Schema、长 description）拼进 prompt，请求体过大，Today 服务端拒收。

解法来源：用户说「之前写了一个代理解决了这个问题」——找到 `C:/Users/qwe/.dsh/qwen_schema_proxy.py`（2026-11-17，5790 字节），一个 OpenAI 兼容代理，核心 `simplify_schema()`：depth≥`MAX_SCHEMA_DEPTH`(2) 的 object 折叠成只留 type+description，description 截到 200，去掉 `$schema`。它当初就是为解决「工具多 → 413」写的，只是上游写死 qweneval，Today 用不上其网络转发部分。

已把算法移植进 `dsh-today-connector/lib/adapter.js` 的 `_simplifySchema()` + `_toolInstructions()`，新增配置项 `schemaMaxDepth`(2) / `schemaDescMax`(200) / `maxTools`(profile 设 80)。实测 60 个深层工具：121071 → 46435 字节（38.4%）。`test-schema-slim.mjs` 9/9；全套回归（多方言 12/12、基础 E2E PONG、工具循环 E2E、四道闸 char/enc/guard/deps）全 PASS；YAML 配置解析验证 27 条 patch、today-connector 唯一、四参数生效。

**② `Cannot switch to today/model...: context compaction failed: summary is not smaller than the shadowed content (3679 estimated framed tokens >= 3639)`**
这是 **DSH 自身的会话历史压缩失败**，不是 Today 适配器或 413 引起的——当前会话历史太长且压缩收益不够（摘要反而比被替换内容长）。适配器侧的 `includeHistory`/`historyTurns` 只管自己发给 Today 的上下文，管不到 DSH 层压缩。最短解法：开新会话，把产物文件路径带过去（TOKEN 都在文件里）。

**状态**：代码与配置已改并验证，需重启 DSH 使 profile 配置生效（`maxTools:80` 等）。

## 四、剩余边界（如实）

| 能力 | 状态 |
|---|---|
| 原生结构化 tool-call | 无（用文本模拟替代，已验证可用） |
| 真流式 token | 无（轮询后整段分片给 UI） |
| 会话隔离 | 无（单会话 `mainConversationId`=账号ID，已强制串行） |
| system prompt | 退化（拼进 user 文本） |
| 设备连接器工具（云端 agent 主动调本地设备） | 未通：设备注册/工具挂载/WS 握手全成功，但 agent 明确回 `TOOL_NOT_AVAILABLE` |

最后一条与「DSH 工具调用」不是一回事：DSH 工具循环走适配器文本模拟，已可用；设备连接器是 Today 自己的 device 生态，未通。

## 五、安装过程中的两个处理

1. **`dsh-purge-community` 校验和失配**：该包用浮动 URL，重新发布后 lockfile 校验和失配，导致整个 pnpm install 失败。已备份 `package.json.before-today` 后暂时移除（当时 disabled），安装成功。用户可随时装回。
2. **依赖解析 junction**：插件从工作区目录找不到 `@deepseek-ai/schemastery`，已在插件目录建 `node_modules` junction 指向 profile 依赖。

## 六、需要用户做的一步

**重启 DSH 让最新配置生效**（配置写入 23:04、工具支持代码 23:2x，晚于上次启动）。

重启后：
1. 模型选择器出现「Today（第三方客户端）」分组，4 个模型
2. 选中后即可对话；给 agent 配工具时，它会通过文本协议调用

## 七、文件清单

**插件**（`default-workspace/dsh-today-connector/`）：
- `lib/adapter.js` — 适配器核心（含工具模拟）
- `lib/index.js` — 插件入口 + Config
- `package.json` / `cordis.patch.yml` / `README.md` / `locale/`
- `test-e2e.mjs` — 基础往返（PONG）
- `test-tool-format.mjs` — 工具格式验证
- `test-tool-parse.mjs` — 解析单测 6/6
- `test-tool-loop-e2e.mjs` — 完整工具循环 E2E
- `node_modules` — junction 到 profile 依赖

**协议文档**（`base_analysis/`）：
- `TODAY_WORKING_CLIENT.md` — 消息协议（已验证）
- `TODAY_PROTOCOL_SPEC.md` — 全量协议
- `DEVICE_CONNECTOR_TOOLS.md` / `DEVICE_HANDSHAKE_RESULT.md` / `CONNECTOR_FINAL_REPORT.md` — 设备连接器
- `connector-mvp.mjs` / `connector-listen.mjs` / `ws-native.mjs` — WS 握手与监听

## Z-ACK
Z-ACK · 冷咖啡 · 轮次 17 · 状态 收口
