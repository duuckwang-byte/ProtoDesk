# Wave4 · 预览层任意 HTTP/HTTPS 网络报告（preview-network）

- 日期：2026-11-17
- 范围：`src/renderer/index.html` CSP meta（预览 srcdoc 继承）；不改业务源码与主进程安全配置
- 结论：**PASS**。任意 `https:` 与 `http:` 资源已在预览层放行；HTTPS CDN 样式/JS 实际生效；HTTP 本地资源与远程 `http://example.com/` 均实际加载；帧内 `securitypolicyviolation` 与 CSP console violation 均为 0。
- 主进程：`webSecurity: true`、`contextIsolation: true`、`nodeIntegration: false`、`allowRunningInsecureContent: false` 均未修改。
- 预览 iframe：`sandbox="allow-scripts allow-forms"`，仍无 `allow-same-origin`。

## 1. 变更摘要

### 1.1 变更前

```text
img-src 'self' data: blob: proto-asset:;
frame-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';
connect-src 'self' ws://localhost:5173;
```

未声明 `script-src`（等同不限制脚本源）；外部 http/https 样式、图片、iframe、connect 基本不可用，CDN 预览常见失败。

### 1.2 变更后（当前）

```text
script-src 'self' 'unsafe-inline' https: http: http://localhost:5173;
style-src 'self' 'unsafe-inline' https: http:;
font-src 'self' data: https: http:;
img-src 'self' data: blob: proto-asset: https: http:;
connect-src 'self' https: http: wss: ws://localhost:5173;
frame-src 'self' data: blob: https: http:;
media-src 'self' data: blob: https: http:;
worker-src 'self' blob: https: http:;
form-action 'self' https: http:;
```

- 只对网络类指令放行 scheme；`object-src` / `frame-ancestors` / `base-uri` 等危险指令没有被 `http:`/`https:` 放大（当前 `object-src` 未声明，未主动放大；后续可评估 `object-src 'none'`）。
- 未新增 `*` / `http://*` / `https://*` 主机通配；显式 host 仅 `localhost:5173`。
- `script-src` 保留 `'unsafe-inline'`（Vite preamble、帧桥内联脚本），未加入 `'unsafe-eval'`。
- `img-src` 保留 `data:`、`blob:`、`proto-asset:`；`connect-src` 保留 `wss:` 与 Vite HMR `ws://localhost:5173`。

## 2. 验证结果

环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`。
数据目录：`D:\文件\工具\原型工具-PlanD\.devdata-wave4-preview-network`（隔离域，seed 存在；临时原型跑完后删除）。

| # | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | `node tests/verify-preview-csp.js` | **PASS 7/7** | 九个网络指令均含 `http:`/`https:`；无主机通配；sandbox 精确 `allow-scripts allow-forms`；main.js 四项安全开关未放宽；策略文档存在 |
| 2 | `npx tsc --noEmit` | **PASS** | exit 0，无输出 |
| 3 | `npm run build:renderer` | **PASS** | `dist/renderer/index.html` 已包含新 CSP；bundle 构建成功 |
| 4 | `npx playwright test e2e/wave4-preview-network.spec.ts --workers=1` | **PASS 1/1**（14.3s） | 1 passed；Electron `window-close` exit 0；无 CSP violation |
| 5 | HTTPS/CDN 样式 | **PASS** | `.el-button--primary` computed `background-color: rgb(64, 158, 255)`，`border: 0.877193px solid rgb(64, 158, 255)`（舞台 zoom 导致小数像素；颜色/线型正确） |
| 6 | HTTPS/CDN JS 全局 | **PASS** | 帧内 `typeof window.Vue === 'function'`、`typeof window.ELEMENT === 'object'` |
| 7 | HTTPS CDN 资源 | **PASS** | 帧内 Performance 记录到 jsDelivr 的 Element UI CSS、Vue 2.6.14、Element UI 2.15.14 三个 URL（duration 4/5/7ms，transferSize 0，命中缓存）；样式/全局已证明实际执行 |
| 8 | HTTP 本地 CSS/JS | **PASS** | `http://127.0.0.1:52504/probe.css` / `probe.js`：`.http-probe` computed `background-color: rgb(11, 22, 33)`、`border: 8.77193px solid rgb(44, 55, 66)`；`window.__HTTP_PROBE__ === "loaded"` |
| 9 | HTTP 远程资源 | **PASS** | `http://example.com/` 在 sandbox iframe 中加载：iframe `onload` 触发、Performance 记录存在；上一跑次 `page.on('response')` 捕获状态 200；本次 response 事件未上报（资源事件缺失，非拦截） |
| 10 | CSP violation | **PASS（0 条）** | HTTPS 帧 `__CSP_VIOLATIONS__=[]`；HTTP 帧 `__CSP_VIOLATIONS__=[]`；console 过滤 `content security policy` / `refused to ...` 为空 |
| 11 | sandbox / 主进程 | **PASS（未变）** | `SANDBOX_ATTR='allow-scripts allow-forms'`；`PreviewFrame.tsx` 仍 `sandbox={SANDBOX_ATTR}`；main.js 四项安全开关未改 |

### 2.1 E2E 原始证据（节选，最近一跑）

```json
{
  "https": {
    "status": "PASS",
    "probe": {
      "cdnBg": "rgb(64, 158, 255)",
      "cdnBorder": "0.877193px solid rgb(64, 158, 255)",
      "vue": "function",
      "element": "object",
      "violations": [],
      "resources": [
        { "name": "https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/theme-chalk/index.css", "duration": 4, "size": 0 },
        { "name": "https://cdn.jsdelivr.net/npm/vue@2.6.14/dist/vue.min.js", "duration": 5, "size": 0 },
        { "name": "https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/index.js", "duration": 7, "size": 0 }
      ]
    },
    "cdnResponses": [],
    "cdnFailures": []
  },
  "http": {
    "status": "PASS",
    "probe": {
      "httpBg": "rgb(11, 22, 33)",
      "httpBorder": "8.77193px solid rgb(44, 55, 66)",
      "httpProbe": "loaded",
      "remoteHttpLoaded": true,
      "violations": []
    },
    "remoteResponses": []
  },
  "console": { "csp": [], "mixedContent": [] }
}
```

### 2.2 HTTP 是否被 Electron 拦截

- **当前未拦截**：主窗由 `file://` 加载 `dist/renderer/index.html`，Electron `allowRunningInsecureContent: false` 没有阻止 `http://127.0.0.1` 与 `http://example.com/` 的实际加载；也没有出现混合内容 console 证据。
- **未修改任何主进程开关**。如果未来主窗改为 `https://` 承载，Chromium 可能重新按混合内容策略拦截 HTTP；此时唯一对应开关是 `main.js` 的：

```js
webPreferences: {
  // ...
  allowRunningInsecureContent: false // 改成 true 可全局放宽混合内容限制，但必须经确认
}
```

- 不建议为此关闭 `webSecurity` 或 `contextIsolation`；更安全的替代是：本地 https 反代、把资源代理/缓存到 `https:` 或 `proto-asset:`、或继续维持 HTTP-only 资源不可用。

### 2.3 既有噪声说明

E2E 的 `pageerror` 记录了 3 次 `Unexpected token '.'`。诊断结果：

- 第 1 次发生在应用启动约 300ms、**早于临时原型创建**；后续两次随页面重载出现。
- 临时移除 `dist/renderer/index.html` 的 CSP meta 后重新启动，仍复现同样的 `Unexpected token '.'`，说明不是本次 CSP 或网络放行引入。
- 与预览网络无关，未计入 CSP/HTTP 结论；建议由主壳 owner 后续单独排查。

另外，HTTP 探针内嵌套的 `http://example.com/` iframe 带 `sandbox`（不含 `allow-scripts`），Chromium 会提示 “Blocked script execution … because the document's frame is sandboxed”；这是探针 iframe 的预期行为，不是 CSP violation。

## 3. 风险（已接受，需知情）

1. **HTTP 明文可篡改 / 中间人注入**：任意 `http:` 脚本、样式、iframe 都可能被同一网络路径上的代理、热点或恶意中间人替换；预览会执行被替换的脚本。
2. **远程代码供应链风险**：CDN 脚本可能被上游投毒/替换；当前 CSP 不做域名白名单或 SRI 校验，HTTPS 只保护链路，不保证包内容可信。
3. **页面数据外泄**：预览 iframe 不能读父窗 DOM/Storage（opaque origin + 无 `allow-same-origin`），但可读取自身原型内容、表单输入、URL 参数，并通过 `fetch`/`img`/`form-action` 发往任意 http/https 站点。
4. **form-action 外发**：预览表单可 POST 到外部站点，存在钓鱼/数据回传面。
5. **预览内容仍不可信**：放行网络不等于信任原型；sandbox 只阻断读取父窗，不阻断对外请求。
6. **HTTP 风险高于 HTTPS**：HTTPS 至少提供传输机密性与完整性；HTTP 为本次按需求明确接受的额外风险。

完整策略、风险与回滚见 `docs/preview-network-policy.md`。

## 4. 回滚

1. 恢复 `src/renderer/index.html` 的 CSP meta 为变更前内容（见 §1.1）。
2. `npm run build:renderer`
3. `node tests/verify-preview-csp.js`（若永久回滚，还需同步修改该测试的期望值）
4. `npx playwright test e2e/wave4-preview-network.spec.ts --workers=1`

若只需收紧 HTTP、保留 HTTPS：删除各网络指令中的 `http:`，保留 `http://localhost:5173` 与 `ws://localhost:5173` 两个 Vite 例外；同步更新静态测试并复跑 E2E 的 HTTP 拦截分支。主进程本次未改，无需回滚。

## 5. 截图

目录：`docs/wave4/shots/preview-network/`

| 文件 | 说明 |
| --- | --- |
| `01-https-cdn.png` | 临时原型引用 jsDelivr Element UI CSS + Vue/Element JS；按钮为 Element UI 主色 `#409EFF`，证明 CDN 样式生效 |
| `02-http-resource.png` | 本地 HTTP CSS/JS 生效（深色按钮），并嵌入 `http://example.com/` iframe；证明 HTTP 实际加载 |

## 6. 收尾

- 未执行 `npm install`，未新增依赖。
- 未修改业务源码、主进程安全配置、`secure-srcdoc.ts` / `PreviewFrame.tsx` 的 sandbox。
- 未 commit。
- 临时原型已在 E2E finally 中删除；隔离域 `.devdata-wave4-preview-network` 保留用于复跑，可随时删除重建。
