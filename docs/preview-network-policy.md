# 预览层网络策略（任意 HTTP/HTTPS）

> 适用范围：`src/renderer/index.html` 的 CSP meta，以及由其 srcdoc 继承策略的预览 iframe。
> 最近更新：2026-11-18。变更原因：在放行任意 HTTP/HTTPS（2026-11-17）基础上，补充放行 `script-src 'unsafe-eval'` 以支持单文件 Vue 2/3 原型的运行时 DOM 模板编译（`new Function`），修复 `[v-cloak]` 页面白屏问题。
> 本文只描述现状、风险与回滚，不代表主进程安全基线或 iframe sandbox 隔离被放宽。

## 1. 结论

- **任意 `https:` 与 `http:` 资源均已放行**：脚本、样式、字体、图片、连接、iframe、音视频、Worker、表单提交目标。
- **`script-src` 显式放行 `'unsafe-eval'`**：单文件 HTML 原型普遍在浏览器端通过 CDN 加载完整版 Vue 2/3（含 runtime compiler），将 `<div id="app">` 模板编译为渲染函数时依赖 `new Function(...)`；若缺少 `'unsafe-eval'`，Vue 编译抛出 CSP 异常、`[v-cloak]` 无法卸载，导致 PC/Vue 原型白屏。
- **Vite dev 例外保留**：`http://localhost:5173`（脚本）与 `ws://localhost:5173`（HMR）继续显式列出；`http:`/`https:` 本身已覆盖 localhost，但显式项用于表达开发态依赖，避免后续收紧时误删。
- **没有放开主进程安全开关**：`webSecurity: true`、`contextIsolation: true`、`nodeIntegration: false`、`allowRunningInsecureContent: false` 均保持不变。
- **预览 iframe 仍保持强隔离**：`sandbox="allow-scripts allow-forms"`，不含 `allow-same-origin`；预览内容处于 opaque origin，即使允许 `new Function`/`eval`，仍不能直接读取父窗 DOM / localStorage / Cookie，也无法绕过 `contextIsolation: true` 访问 Node/Electron API。
- **HTTP 不再被 CSP 拦截**。在当前 `file://` 主窗形态下，真机验证显示 HTTP 资源可以实际加载；如果未来主窗改为 `https://` 承载，Chromium 混合内容策略可能重新拦截 HTTP，届时才涉及 `main.js` 的 `webPreferences.allowRunningInsecureContent`（见 §5）。

## 2. CSP 变更前后

### 2.1 变更前

```text
img-src 'self' data: blob: proto-asset:;
frame-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';
connect-src 'self' ws://localhost:5173;
```

未声明 `script-src`（等同不限制脚本源），外部 http/https 资源基本被 img/frame/style/connect 的缺省限制挡住；预览里的 CDN 样式/脚本通常无法加载。

### 2.2 变更后（当前）

```text
script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: http://localhost:5173;
style-src 'self' 'unsafe-inline' https: http:;
font-src 'self' data: https: http:;
img-src 'self' data: blob: proto-asset: https: http:;
connect-src 'self' https: http: wss: ws://localhost:5173;
frame-src 'self' data: blob: https: http:;
media-src 'self' data: blob: https: http:;
worker-src 'self' blob: https: http:;
form-action 'self' https: http:;
```

要点：

- 仅对**网络类指令**写入 `http:`/`https:`；`object-src`、`frame-ancestors`、`base-uri` 等危险指令没有被写入 scheme，也没有新增主机通配 `*`。
- `script-src` 保留 `'unsafe-inline'`（Vite dev preamble、帧桥内联脚本需要），并显式放行 `'unsafe-eval'`：单文件 Vue 2/3 原型在 `<div id="app" v-cloak>` 中直接写模板并在浏览器端用完整版 Vue 编译渲染函数，Vue 编译器内部通过 `new Function(...)` 生成 render 函数；未放行 `'unsafe-eval'` 时该调用被 CSP 拦截，导致应用不挂载、`[v-cloak]` 一直保持 `display: none` 呈现白屏。
- 预览隔离未因 `'unsafe-eval'` 而退化：预览 iframe 的 `sandbox` 依然是 `allow-scripts allow-forms`（不含 `allow-same-origin`），代码只能在 opaque origin 沙箱内执行；主进程 `webPreferences.contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true` 保持不变。
- `img-src` 保留 `data:`、`blob:`、`proto-asset:`，避免破坏沙箱图片协议。
- `connect-src` 保留 `wss:` 与 `ws://localhost:5173`；`http:`/`https:` 覆盖普通 fetch/XHR。
- `form-action` 放行外部 http/https，意味着预览表单可以把数据 POST 到任意站点（风险见 §4）。

### 2.3 为什么改 `index.html` 就能影响预览

预览 iframe 使用 `srcdoc` 注入原型 HTML。按 CSP 继承规则，`srcdoc` 文档会继承父文档的 CSP；预览 iframe 的 sandbox 又不含 `allow-same-origin`，因此：

- 预览内容不能通过同源能力读取父窗数据；
- 但预览内的 `<script>`、`<link>`、`<img>`、`fetch`、`<iframe>`、表单提交等网络请求，**受父文档 CSP 约束**。

所以 `src/renderer/index.html` 的 CSP 是预览层网络边界的唯一入口；`secure-srcdoc.ts` 继续只负责注入帧桥和保持 sandbox，不单独下发 CSP。

## 3. 验证口径

### 3.1 静态断言

```powershell
node tests/verify-preview-csp.js
```

覆盖：

- 九个网络类指令均含 `http:` 与 `https:`；
- `script-src` 保留 `'self'`、`'unsafe-inline'`、`'unsafe-eval'`（Vue 2/3 DOM 内运行时模板编译 `new Function`）与 `http://localhost:5173`；
- 无 `*` / `http://*` / `https://*` 主机通配，显式 host 仅 localhost；
- Vite localhost、`data:`、`blob:`、`proto-asset:` 例外保留；
- `object-src` 等危险指令未被 scheme 放大；
- `SANDBOX_ATTR` 仍精确为 `allow-scripts allow-forms`，且 `PreviewFrame.tsx` 继续使用它；
- `main.js` 的 `webSecurity` / `contextIsolation` / `nodeIntegration` / `allowRunningInsecureContent` 未被放宽；
- 本文档存在并包含风险与回滚关键词。

### 3.2 真机 E2E

```powershell
npm run build:renderer
node e2e/wave4/seed.mjs --domain preview-network
npx playwright test e2e/wave4-preview-network.spec.ts --workers=1
```

用例在隔离域 `.devdata-wave4-preview-network` 内创建临时原型：

1. **HTTPS/CDN**：引入 `https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/theme-chalk/index.css`、Vue 2 与 Element UI UMD；断言 `.el-button` 背景/边框生效、`window.Vue`/`window.ELEMENT` 存在、帧内 `securitypolicyviolation` 为空、控制台无 CSP violation。
2. **HTTP**：启动本地 `http://127.0.0.1:<port>` 服务提供 CSS/JS，断言样式与 `window.__HTTP_PROBE__` 生效；同时用 sandbox iframe 请求 `http://example.com/`，记录响应状态与 load 事件。
3. 若 CDN 网络不可用，记录 `ENV_SKIP`，不把网络故障伪造成 CSP 通过或失败；若 HTTP 被混合内容拦截，记录控制台/网络证据，并只在报告中说明需要调整 `main.js` 的哪个开关，不擅自改主进程配置。

证据与截图落在 `docs/wave4/shots/preview-network/`，报告见 `docs/wave4/reports/preview-network.md`。

## 4. 风险（必须知情）

1. **HTTP 明文可篡改 / 中间人注入**：任意 `http:` 脚本、样式、iframe 都可能被同一网络路径上的代理、热点或恶意中间人替换；预览页会执行被替换的脚本。
2. **远程代码供应链风险**：CDN 上的脚本可在上游被替换/投毒；当前 CSP 不做域名/SRI 限制，预览内容引用任意 CDN 都会执行。HTTPS 只保证传输链路，不保证 CDN 包内容可信。
3. **页面数据外泄**：预览 iframe 虽不能读父窗 DOM/Storage，但可以读取自身原型内容、表单输入、URL 参数，并通过 `fetch`/`img`/`form-action` 发往任意 http/https 站点。原型中若包含真实业务数据、姓名、金额、链接等，存在外泄面。
4. **预览内容仍不可信**：放行网络不等于信任原型。恶意/被投毒的原型 HTML 可以在预览域内执行脚本、发起网络请求、诱导表单提交；sandbox 只阻断其读取父窗，不阻断其向外发起请求。
5. **form-action 外发**：预览表单可 POST 到外部站点，可能被用于钓鱼或数据回传。
6. **HTTP 的额外风险高于 HTTPS**：明文响应可被篡改，HTTPS 至少提供传输机密性与完整性；本次按用户要求同时放行 HTTP，属于明确接受该风险。
7. **`'unsafe-eval'` 动态代码执行面扩大**：`script-src` 放行 `'unsafe-eval'` 后，主窗渲染进程与继承该 CSP 的预览 iframe 均可调用 `eval` / `new Function`。在**主窗渲染进程**侧，本地源码已启用 `contextIsolation: true`、`nodeIntegration: false` 且不渲染不可信第三方 HTML，不会因预览原型而暴露 Node 能力；在**预览 iframe** 侧，由于 `sandbox="allow-scripts allow-forms"` 不含 `allow-same-origin`，即便原型内脚本执行动态字符串，也仍被限制在 opaque origin 沙箱内，无法访问父窗 DOM、Storage、Cookie 或 Electron IPC，但原型自身的内存数据与发起网络请求的能力仍存在（对应风险 3、4）。

## 5. 主进程 / 混合内容说明

当前 `main.js`：

```js
webPreferences: {
  webSecurity: true,
  allowFileAccessFromFiles: false,
  allowRunningInsecureContent: false,
  nodeIntegration: false,
  contextIsolation: true,
  preload: path.join(__dirname, 'preload.js')
}
```

- **不要为了放行 HTTP 而关闭 `webSecurity` 或 `contextIsolation`**；这两项与 CSP 放行是两件事。
- 当前主窗由 `file://` 加载 `dist/renderer/index.html`，真机验证中 HTTP 资源可以加载，未触发混合内容拦截，因此**当前不需要修改 `allowRunningInsecureContent`**。
- 如果未来主窗改为 `https://` 承载（或 Vite dev 改为 https），Chromium 的混合内容策略可能拦截 `http:` 子资源。此时唯一相关开关是 `main.js` 的 `webPreferences.allowRunningInsecureContent`；把它改为 `true` 会全局放宽混合内容限制，**必须经过确认**，并优先考虑更安全的替代方案（本地 https 反代、把资源缓存/代理到 https、或维持 HTTP 资源不可用）。
- 预览 iframe 的 `sandbox` 仍固定为 `allow-scripts allow-forms`，不要添加 `allow-same-origin`；否则预览内容将获得父窗同源能力，风险显著高于网络放行。

## 6. 回滚方法

### 6.1 只回滚 CSP

把 `src/renderer/index.html` 的 CSP meta 恢复为变更前内容：

```html
<meta
  http-equiv="Content-Security-Policy"
  content="img-src 'self' data: blob: proto-asset:; frame-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:5173;"
/>
```

然后重新构建并复验：

```powershell
npm run build:renderer
node tests/verify-preview-csp.js
npx playwright test e2e/wave4-preview-network.spec.ts --workers=1
```

注意：静态测试 `tests/verify-preview-csp.js` 锁定的是“放行 http/https”的当前策略；如果决定永久回滚，需要同步更新该测试的期望值，否则它会继续报错（这是有意的门禁行为）。

### 6.2 只收紧 `'unsafe-eval'` 或 HTTP

- **仅回滚 `'unsafe-eval'`**（若未来所有单文件原型改为预编译/不依赖运行时模板编译）：从 `script-src` 删除 `'unsafe-eval'`，并将 `tests/verify-preview-csp.js` 中 `'unsafe-eval'` 断言改回 `!hasToken(script, "'unsafe-eval'")` 后重构建复验。
- **只收紧 HTTP、保留 HTTPS**：按指令删除 `http:`，并保留 localhost 显式项（若仍需 Vue 运行时模板编译，保留 `'unsafe-eval'`）：

```text
script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http://localhost:5173;
style-src 'self' 'unsafe-inline' https:;
font-src 'self' data: https:;
img-src 'self' data: blob: proto-asset: https:;
connect-src 'self' https: wss: ws://localhost:5173;
frame-src 'self' data: blob: https:;
media-src 'self' data: blob: https:;
worker-src 'self' blob: https:;
form-action 'self' https:;
```

同时把静态测试中的 `http:` 断言改回“HTTP 不得出现（localhost 除外）”，并复跑 E2E 的 HTTP 拦截分支。

### 6.3 主进程开关

本次没有修改 `main.js`，无需回滚主进程配置。若后续有人把 `allowRunningInsecureContent` 改为 `true`，回滚为 `false` 即可；`webSecurity` 应始终保持 `true`，`contextIsolation` 应始终保持 `true`。

## 7. 后续建议

- 评估为 `object-src` 增加 `'none'`（当前未声明，未被本次变更放大）。
- 如需降低 CDN 供应链风险，考虑域名白名单 + SRI/完整性校验，或把常用库缓存到本地/`proto-asset:`。
- 如需彻底避免 HTTP 明文风险，优先收紧为 HTTPS-only，或通过本地 https 反代提供 HTTP 资源。
- 任何放宽 `allowRunningInsecureContent` / `webSecurity` 的改动都必须单独评审并更新本文档与静态门禁。
