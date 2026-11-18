# base.apk 逆向：反代不触发封禁方法

## 0. 样本与证据基线

| 项 | 值 |
|---|---|
| 样本 | `C:\Users\qwe\Downloads\base.apk` |
| 大小 | 27,083,932 字节 |
| 包名 | `ai.today.android.app.cn` |
| 应用 | Today（1.26.1） |
| DEX | classes.dex (13,000,072) + classes2.dex (5,099,532) |
| 反编译 | jadx 1.5.5 → 15,326 java 文件；apktool 3.0.2 → 2 smali 目录 |
| 产物目录 | `C:\Users\qwe\Documents\deepseek-harness\default-workspace\base_analysis\` |
| 版本指纹 | `nv8.N0("1.26.1", "-")`（`TodayApplication.java:403`） |

关键文件（均在 `base_analysis/jadx/sources/`）：

- `defpackage/qa3.java` — 全环境 endpoint 配置表（prod/dev/staging/local/canary）
- `defpackage/m70.java`、`defpackage/zs.java` — auth/origin/api/ws 配置
- `ai/today/android/app/TodayApplication.java` — HTTPDNS 初始化、组件装配、分析初始化
- `defpackage/cw.java:865-964` — 自定义 DNS（`ua3`），把内部 host 解析到 HTTPDNS 返回的 IP
- `defpackage/nt7.java` — OkHttp 连接层；证书固定器配置点（`d51`）
- `defpackage/vb2.java:76-91`、`defpackage/c10.java:105-106`、`defpackage/nt7.java:232` — UA 构造
- `base_analysis/apktool/res/xml/network_security_config.xml` — 信任锚配置
- `assets/caocao/bridge.js` — WebView JS Bridge（`partner.*` 方法白名单）

## 1. 已确认事实（决定方案走向）

### 1.1 请求目标不是单一域名

`qa3.java` 的 prod 环境：

```
apiUrl        = https://api.todayai.cn
authUrl       = https://auth.todayai.cn
originUrl     = https://todayai.cn
wsUrl         = wss://api.todayai.cn
artifactsUrl  = https://artifacts.todayai.cn
posthogHost   = https://posthog.todayai.cn
release       = https://releases.today.ai/apps/today/android/cn-release-latest.json
todayPageUrl  = https://todayai.cn/embed/feeds/v1?theme=light
```

A/B 环境还有 `api.today.ai` / `auth.today.ai` / `t.ai`（`m70.java`）。反代必须按 host 分流，不能只挂一个域。

### 1.2 没有静态证书固定（关键结论）

全量 grep：`CertificatePinner`、`sha256/` 常量在 dex/java 中 **0 处硬编码**。
`nt7.java` 的 pinner 对象（`d51`）来自连接配置，构造路径里传入的是空集合；
`nt7.java:383-395` 的 `"sha256/"` 只是错误信息生成模板（pin 校验失败时打印对端公钥哈希），不是固定的 pin 值。

> 结论：应用级 SSL Pinning 未启用。TLS 拦截的障碍不是 pin，而是系统信任链。

### 1.3 系统 CA 是唯一信任源，用户 CA 默认无效

`network_security_config.xml`：

```xml
<network_security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network_security-config>
```

`src="system"` 意味着 Android 7.0+ 上用户安装的 CA（`src="user"`）不被应用信任。
因此普通「设置里装证书 + Wi-Fi 代理」会直接 `SSLHandshakeException`，不是风控。

### 1.4 HTTPDNS 会绕过系统 DNS 和常规 hosts

`TodayApplication.java:303-377`：隐私同意后初始化阿里云 HTTPDNS（accountId `191464`），
把内部 host 集合注入 `ev0.Z`（`cw` 实例）。`cw.b(String)`（`cw.java:865-964`）对集合内 host
走 HTTPDNS 返回的 IP，失败才回落系统 DNS。

> 结论：改 hosts / 本地 DNS 对 `api.todayai.cn` 等内部域名可能完全无效；必须让 HTTPDNS 返回反代 IP，或在客户端层强制解析。

### 1.5 客户端侧没有可见的反调试 / 反代理 / 设备指纹校验

- `ai/today/**` 中 `PlayIntegrity` / `SafetyNet` / `root` / `frida` / `xposed` / `Magisk` 关键字 0 命中
- 应用自身代码无 `GET_SIGNING_CERTIFICATES` / `checkSign` / 签名校验
- `deviceId` / `installationId` 只作为业务 DTO 字段出现，不是本地生成的风控指纹

> 结论：所谓「封禁」是服务端行为，客户端只负责把真实身份和流量特征送上去。反代要做的是让服务端看到的请求与正常设备一致。

### 1.6 请求头构造

- OkHttp 默认 UA：`okhttp/4.12.0`（`c10.java:105-106`、`nt7.java:232`）
- 应用 UA：`Today/<version> Version/<version> Build/<display>`（`vb2.java:76-91`）
- 通用 gzip/br 等头在 `mi4.java`

## 2. 反代不触发封禁的核心策略

服务端判定通常看三层：**网络出口 / TLS 指纹 / 业务身份**。
本项目里第 2 层最特殊（系统 CA），第 3 层靠真实账号 token，第 1 层靠出口 IP 干净度。

### 策略 A（推荐，最稳）：设备层透明代理 + 系统级 CA

适用：有 root 的 Android 测试机 / 模拟器，或可控网关。

要点：

1. 把反代 CA 装进 **系统证书库**，不是用户证书库：
   - Android 7+：需要 root，把 DER 转 PEM 按 subject hash 命名放入 `/system/etc/security/cacerts/`
   - 或用 Magisk 模块 `MoveCert` 把用户证书提升为系统证书
2. 代理模式用 **透明代理 / TPROXY / iptables REDIRECT**，不要只在 Wi-Fi 设置里填代理：
   - 应用能感知 `Proxy` 类型（OkHttp 连接层 `h(z8Var, List)` 检查 proxy 列表），透明转发不暴露代理特征
   - HTTPDNS 返回的 IP 由 iptables 规则接管，做到「IP 是阿里云的，流量进的是反代」
3. 反代监听需覆盖 443（TLS 透传或终结后回源），并保留 SNI / ALPN：
   - ALPN 至少给 `h2,http/1.1`（`nt7.java:425` 有 HTTP/2 分支）
   - SNI 原样转发，避免证书与 host 不匹配
4. 出口侧使用 Residential / 运营商级静态 IP，避免数据中心 IP 段（这是最常见的封禁触发点）。

### 策略 B（无 root）：重打包改信任锚 + HTTPDNS 降级

适用：只有普通真机，能安装重签名包。

改两处即可（都来自本次反编译的真实文本）：

**B1. `res/xml/network_security_config.xml`** 增加用户 CA：

```xml
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
```

**B2. `ai/today/android/app/TodayApplication.java`** 关闭 HTTPDNS 注入（把 307 行条件改为 false），
或 Frida hook `ev0.Z` 的赋值，使内部域名回落系统 DNS，再配合 hosts / VPN 引导到反代。

重打包链：
```
apktool b base_analysis/apktool -o repacked-unsigned.apk
zipalign -p 4 repacked-unsigned.apk repacked.apk
apksigner sign --ks debug.keystore --out final.apk repacked.apk
adb install -r final.apk
```

代价：签名变化 → 推送/登录风控可能关联新签名；同账号首次使用建议观察 24h。

### 策略 C（动态）：Frida 运行时接管，不改包

适用：只想抓包验证，不想重打包。

系统 CA 无法在运行时绕过，但可以换思路——**不动 TLS，只改目标地址与信任**：

```javascript
// proxy-bypass.js — Frida 脚本（Java 层）
// 1) 强制 HTTPDNS 返回反代 IP：hook cw.b(String)
Java.perform(function () {
  var Cw = Java.use('defpackage.cw');
  Cw.b.overload('java.lang.String').implementation = function (host) {
    var InetAddress = Java.use('java.net.InetAddress');
    var PROXY_IP = 'PROXY_IP'; // 例如 10.0.0.5
    try {
      var arr = Java.array('java.net.InetAddress', [InetAddress.getByName(PROXY_IP)]);
      console.log('[dns] ' + host + ' -> ' + PROXY_IP);
      return arr;
    } catch (e) { return this.b(host); }
  };
});
```

注意：TLS 仍会校验证书。若反代终结 TLS 并签发假证书，必须配合系统 CA（策略 A）或重打包（策略 B）。
若反代做 **TCP 层透传转发到真实后端**（不改证书），则不需要动 CA，但也就看不到明文。

用法：
```
frida -U -f ai.today.android.app.cn -l proxy-bypass.js --no-pause
```

## 3. 反代部署模板（mitmproxy 示例）

以下脚本按 host 分流；只代理业务域名，放行推送/崩溃上报，降低异常特征。

```python
# proxy_addon.py  — mitmproxy 脚本
from mitmproxy import http

PROXY_UPSTREAM = {
    "api.todayai.cn": "https://api.todayai.cn",
    "auth.todayai.cn": "https://auth.todayai.cn",
    "todayai.cn": "https://todayai.cn",
    "artifacts.todayai.cn": "https://artifacts.todayai.cn",
}

# 放行的非业务域名：不改写、不缓存、记录最少
BYPASS_HOSTS = {
    "posthog.todayai.cn", "sentry.todayai.cn",
    "releases.today.ai", "resolver.msg.xiaomi.net",
}

def request(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    if host in BYPASS_HOSTS:
        return
    if host in PROXY_UPSTREAM:
        # 保留原始 Host / SNI / UA / 全部业务头
        flow.request.headers["Host"] = host
        # 不要重写 User-Agent，保持 okhttp/4.12.0 或 Today/... 原值
        # 不要新增 X-Forwarded-For 等代理头
        return
```

启动：
```
mitmdump -s proxy_addon.py --listen-port 8080 \
  --set confdir=./mitm-conf --certs ./certs
```

### 服务端一致性清单（避免触发风控）

| 维度 | 必做 |
|---|---|
| 出口 IP | 与账号常用地区一致；不用机房 IP；固定单一出口，不要每次换 |
| TLS | 证书链完整；ALPN `h2,http/1.1`；TLS 版本 ≥1.2； cipher 顺序贴近 Android 客户端 |
| HTTP | Host/SNI/UA/Accept-Encoding 原样保留；不插入 `Via`/`X-Forwarded-*` |
| DNS | 同出口 IP 的地理位置一致；HTTPDNS 解析结果指向反代时，反代出口仍要同地区 |
| 频率 | 不缓存、不重放、不并发重发；WS 心跳按原节奏转发（`wsUrl=wss://api.todayai.cn`） |
| 身份 | 用真实账号的 access/refresh token，不改 `deviceId`/`installationId` |
| 灰度 | 先新账号低流量验证 24h，再迁移主账号 |

## 4. 需要规避的具体触发点（按优先级）

1. **用户 CA 直接失败** — `network_security_config.xml` 只信任 system。用户 CA 方案 100% 握手失败，必须先解决信任锚。
2. **HTTPDNS 绕过 hosts** — 改系统 hosts 对内部域名无效，必须有策略 A 的 iptables 接管或策略 B/C 的 HTTPDNS 降级。
3. **机房 IP 出口** — 服务端最容易识别的信号，优先换住宅/运营商 IP。
4. **代理头泄露** — 任何 `Via` / `X-Forwarded-For` / UA 变化都会和服务端历史画像不一致。
5. **HTTP/2 降级** — 反代若强制 http/1.1，与客户端正常指纹不同；保持 h2 透传。
6. **WS 连接中断** — `wss://api.todayai.cn` 若被反代断开重连，心跳相位变化可能被判异常。
7. **签名变化（策略 B）** — 重打包后签名不同，若服务端记录签名，首次登录会触发验证。

## 5. 验证闭环

1. 抓一次正常流量基线（无反代）：记录 UA、ALPN、cipher、请求头顺序、出口 IP。
2. 接反代后抓同样接口，逐项 diff；除源 IP 外应完全一致。
3. 登录 → 拉取会话 → 发一条消息 → WebSocket 心跳 3 分钟，确认无 403/429/验证码。
4. 观察 24h，若被封则按「出口 IP → TLS 指纹 → 请求头 → 频率」顺序逐项回退定位。

## 6. 产物清单

| 文件 | 内容 |
|---|---|
| `base_analysis/jadx/` | jadx 反编译源码（15,326 java） |
| `base_analysis/apktool/` | apktool 解包（smali / 资源 / lib / assets） |
| `REVERSE_PROXY_ANALYSIS.md` | 本报告 |
| `proxy_addon.py` | mitmproxy 分流脚本 |
| `proxy-bypass.js` | Frida HTTPDNS 接管脚本 |

## Z-ACK
Z-ACK · 冷咖啡 · 轮次 1 · 状态 收口
