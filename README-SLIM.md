# dsh-today-slim (dsh-today 1.2.2 + 两项本地移植)

本分支基于上游 [xuemei-wintersweet/dsh-today](https://github.com/xuemei-wintersweet/dsh-today) `v1.2.2`，把本机 DeepSeek Harness 实际需要、但上游未内置的两项改动固化下来，便于用稳定的 git 来源安装，不再依赖临时工作区路径。

> 本分支内容与包名 `dsh-today` 一致；`main` 分支是 `today-dsh-connector`（Android APK 逆向版）的原始资料，两组内容互不影响。

## 移植内容

### 1. 强 schema 压缩（防 Today HTTP 413）

上游自带 `compactSchemaParameters` 只做字段级清理（depth 12 / desc 240），工具很多时仍会把 prompt 撑到 Today 的 `413 Payload too large`。本分支在 `dist/src/dsml-recovery.js` 增加 `slimSchemaForPrompt()` 并在 `buildToolProtocolSection()` 使用：

- `SCHEMA_SLIM_MAX_DEPTH = 2`：depth >= 2 的 object 折叠成 `type` + 截断后的 `description`
- `SCHEMA_SLIM_DESC_MAX = 200`
- `SCHEMA_SLIM_MAX_TOOLS = 80`：单轮最多注入 80 个工具
- 去掉 `$schema`

算法移植自 `wzs39/today-dsh-connector` 的 `plugin/lib/adapter.js::_simplifySchema`（源自 `qwen_schema_proxy.py`）。实测 60 个深层工具 121071 -> 46435 字节（38.4%）。验证：`buildConversationPrompt` 深层叶子属性被丢弃、100 工具声明区只留 80 个。

### 2. 凭据区域自动回退（修 "Today credentials not found in ...\\Roaming\\Today"）

上游同时注册 `today`（CN）与 `today-global`（Global）两个 provider。只登录了 `Today CN` 桌面端时，UI 若选中 `today-global`，会去读 `%APPDATA%\\Today`（空目录）并抛：

```
Today credentials not found in C:\Users\qwe\AppData\Roaming\Today.
Please sign in to Today desktop client first.
```

本分支在 `dist/src/index.js`：

- `pickAdapter()`：目标 provider 无本地凭据、CN 有凭据时自动回退到 CN adapter
- `registerConfigurableProviders()`：只注册磁盘上确实有 `account-credentials.head` 的 provider，从源头不暴露无凭据的 `today-global`

实测：`apply()` 只暴露 `["today"]`，`today-global` 不在候选列表；CN 凭据 `signed-in (slot=1, gen=7)` 正常加载。

## 安装（DSH profile）

```bash
# 克隆到稳定目录（示例）
git clone -b dsh-today-slim https://github.com/wzs39/today-dsh-connector.git <stable-dir>/dsh-today

# profile/package.json
#   "dsh-today": "link:<stable-dir>/dsh-today"
# profile/cordis.patch.yml
#   - id: dsh-today
#     name: dsh-today
#     config:
#       region: cn
#       defaultModel: model.deepseek-v4.1-flash
#       enableNativeDeviceTools: true
```

凭据来自 `Today CN` 桌面客户端的 DPAPI 登录态（`%APPDATA%\\Today CN\\account-credentials.*`），无需手填 cookie。改完重启 DSH 生效。

## 校验

改动文件均通过 edit-fidelity 四道闸（char/enc/guard/deps）与 `node --check`。

## License

继承上游 MIT（见 `LICENSE` / `THIRD_PARTY_NOTICES.md`）。本分支改动同样 MIT。
