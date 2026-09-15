# platform/env — TLS 安全说明（P0-B）

## 旧行为（已移除，高危）
`applyAgentLaunchEnv()` 曾无条件注入：

```js
if (!env['NODE_TLS_REJECT_UNAUTHORIZED']) {
  env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
}
```

所有子进程/API 请求放弃证书校验，公网下可被 MITM 窃取 API Key。

## 新行为（默认安全 + 显式可选）
- 默认：不设置 `NODE_TLS_REJECT_UNAUTHORIZED`，不设置 `NODE_EXTRA_CA_CERTS`（证书校验保持开启）。
- 不安全调试开关：`PLAN_D_ALLOW_INSECURE_TLS=1`（或 `true`，大小写不敏感）时才注入
  `NODE_TLS_REJECT_UNAUTHORIZED=0`，并输出 `console.warn`。仅用于受信内网/调试。
  取值 `'0'` / `''` / 未设均视为不放行。
- 自签 CA（推荐，不降级校验）：
  - 标准 `NODE_EXTRA_CA_CERTS=<pem路径>` 原样透传给子进程；
  - 别名 `PLAN_D_EXTRA_CA_CERTS=<pem路径>` 在 `NODE_EXTRA_CA_CERTS` 未设时自动映射过去（已显式设置则不覆盖）。
- 外部直接传入的 `NODE_TLS_REJECT_UNAUTHORIZED=0` 做透传但同样 `console.warn`，避免静默不安全。

## 示例
```bat
:: 默认安全（推荐）
node app.js

:: 内网自签 CA（推荐）
set PLAN_D_EXTRA_CA_CERTS=C:\certs\internal-ca.pem

:: 不安全模式（仅调试，公网禁用）
set PLAN_D_ALLOW_INSECURE_TLS=1
```
