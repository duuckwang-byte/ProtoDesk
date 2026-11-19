# React 版启动与回滚

> 适用版本：Wave3 / W3-09 之后。React renderer 为默认入口，legacy 渲染层完整保留，可随时一键回退。
> 本文只描述启动、验收、回滚，不涉及 `src/renderer/**` 与 `tests/**` 的修改。

## 1. 入口规则

主进程与文档窗使用同一套判定（`main.js` 与 `main/controllers/window-controller.js` 各有一份同规则实现，不跨文件 import）：

| 条件 | 结果 |
|---|---|
| 默认（未设置任何开关） | React：`dist/renderer/index.html` |
| `PLAND_RENDERER=react` | React |
| `PLAND_RENDERER=legacy` | legacy：`原型+文档.html` |
| 启动参数含 `renderer=legacy`（即深链 `?renderer=legacy`） | legacy |
| `PLAND_RENDERER` 为其他未知值 | React（未知值不阻断默认入口） |
| React 模式下 `dist/renderer/index.html` 不存在 | 打印告警后自动回退 legacy，防白屏 |

- 主窗与 `?docwin=1` 文档窗都走同一入口：React 模式加载 `dist/renderer/index.html`，legacy 模式加载 `原型+文档.html`。
- 安全配置不变：`webSecurity: true`、`contextIsolation: true`、`nodeIntegration: false`。
- 文档窗 query 继续透传：`docwin=1&project=...&proto=...`。

## 2. 启动命令

```bash
npm install               # 仅首次
npm run build:renderer    # 生成 dist/renderer/（React 默认入口必需）
npm start                 # 默认 React
npm run start:react       # 显式 React
npm run start:legacy      # 显式 legacy
```

Windows PowerShell 等价写法（不依赖 cross-env，未新增任何依赖）：

```powershell
$env:PLAND_RENDERER='react';  npx electron .
$env:PLAND_RENDERER='legacy'; npx electron .
Remove-Item Env:PLAND_RENDERER   # 恢复默认 React
```

`start:react` / `start:legacy` 的实现是 `node -e` 内设置 `PLAND_RENDERER` 后 `spawn` Electron，跨平台可用，不需要 `cross-env`。

## 3. 验收清单

按顺序执行，全部通过即视为默认入口切换完成：

```bash
node --check main.js
node --check main/controllers/window-controller.js
npm run build:renderer
node tests/check-pack.js
node tests/lint-guard.js
node tests/static-verify.js
node tests/verify-docwin.js
node tests/verify-ipc.js
```

预期：

1. `check-pack`：`PACK_PASS`，且白名单含 `dist/renderer/**`、`main.js` 保留 legacy 字面量分支。
2. `lint-guard`：`LINT_PASS`，`E-IPC-FROZEN` 通道数 70/70 不变。
3. `static-verify`、`verify-docwin`、`verify-ipc` 全绿。
4. 手工冒烟（默认 React）：`npm start` 后主窗加载 `dist/renderer/index.html`，文档窗 `docwin:open` 同样加载 React 入口。
5. 手工冒烟（legacy）：`npm run start:legacy` 后主窗加载 `原型+文档.html`，功能与切换前一致。
6. 产物缺失回退：临时改名 `dist/renderer` 后 `npm start`，控制台出现 `[renderer] ... 自动回退 legacy`，窗口正常显示 legacy 页面（验证后改回）。

## 4. 回滚步骤

### 4.1 临时回滚（单次启动，推荐排查用）

```bash
npm run start:legacy
```

或：

```powershell
$env:PLAND_RENDERER='legacy'; npx electron .
# 或
npx electron . --renderer=legacy
```

### 4.2 版本级回滚（发布包默认回到 legacy）

1. 将 `main.js` 的 `getRendererMode()` 默认值从 `'react'` 改回 `'legacy'`（`String(process.env.PLAND_RENDERER || 'react')` 中的 `'react'`）。
2. 将 `main/controllers/window-controller.js` 中同名默认值做相同修改。
3. 保留 `dist/renderer/**` 与 `build.files` 不动，legacy 分支与产物不受影响。
4. 重新执行第 3 节命令并打包：`npm run build`。

> 不建议删除 `dist/renderer/**` 或回退 `build.files`：保留产物才能继续用 `npm run start:react` 做灰度对照。

### 4.3 回滚后的确认

- `npm run start:legacy` 与版本级回滚后，主窗、文档窗均应加载 `原型+文档.html`。
- `node tests/verify-docwin.js`、`node tests/verify-ipc.js` 仍应全绿（legacy 分支字面量与 70 通道契约未变）。

## 5. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动后看到旧界面 | 设置了 `PLAND_RENDERER=legacy` 或启动参数含 `renderer=legacy` | 清除环境变量/参数，或执行 `npm run start:react` |
| 启动打印“自动回退 legacy” | `dist/renderer/index.html` 不存在或路径不对 | 执行 `npm run build:renderer` |
| 打包后白屏 | 打包前未构建 React 产物 | 先 `npm run build:renderer` 再 `npm run build`；`build.files` 已含 `dist/renderer/**` |
| 文档窗空白 | 文档窗同样依赖 React 产物 | 同上，构建后重开文档窗 |
