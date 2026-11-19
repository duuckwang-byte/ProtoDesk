# PlanD shadcn/ui 全量改造开发实施方案（方案 A）

> 版本：v1.1（方案稿，不涉及代码实施；已按 2026-11-12 方案审查结果修订）
> 日期：2026-11-12
> 视觉基线：`docs/shadcn-redesign-preview.html`
> 参考：https://ui.shadcn.com/docs/installation、https://ui.shadcn.com/docs/ai-elements

---

## 0. 本次修订说明

v1.0 的总体方向正确，但审查发现 5 类会直接引发报错/门禁红灯/功能断链的问题，以及 5 处与最新效果图不一致的设计偏差。v1.1 已修订：

- 修正 shadcn 依赖：`clsx + tailwind-merge`，移除错误的 `cn` 包；`shadcn` 只作为 CLI。
- 去掉重复/过重选型：不强制 TanStack Table、React Hook Form、Zod、react-resizable-panels、cmdk。
- 补齐独立文档窗口 `docwin`、`proto-asset:` CSP、iframe 拾取、单文件导出、打包路径。
- 拆分测试门禁：`core`（主进程/IPC/ACP/安全）与 `legacy-ui`（旧 HTML 静态断言）分离。
- 修正 UI 偏差：PC 文档为右侧悬浮弹窗、移动端 375×780 自适应、侧栏去蓝/去数字/三层拖拽、Git 卡片树、AI 居中 Dialog、微改 Popover/mini-dock/loc-pill。
- 增加 1 周 Phase 0 PoC；工期从 11–12 周调整为 13–15 周，PoC 后重新校准。

---

## 1. 方案定义

**方案 A = 渲染层全量 React 化**：

- 使用 **React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui** 重写整个渲染层。
- AI 对话使用 shadcn **AI Elements** 模式（Chat / Message / Reasoning / Tool / Plan / Confirmation / Model Selector / Prompt Input / Terminal / Trace 等）。
- **不重写** Electron 主进程、preload、ACP 运行时、IPC 契约、Agent 探测、模型目录缓存；这些只做接口适配。
- **不把 React 打进导出的单文件原型**；导出仍使用轻量 vanilla 模板。

> 这是“前端渲染层重写”，不是“整个应用重写”。

---

## 2. 目标与验收标准

### 2.1 总目标

1. 全站 UI 与 `shadcn-redesign-preview.html` 的 New York 视觉一致。
2. 现有功能 100% 保留：原型预览、文档、独立文档窗口 `docwin`、拾取、标注、跳转、Git、导出、快照、AI/ACP、设置。
3. 70 个 IPC 通道不变，主进程接口不破坏。
4. ACP 四 Agent（qoder/opencode/agy/codebuddy）连通、模型/思考/上下文选择正常。
5. 单文件导出离线可用，不依赖 React/CDN；`proto-asset:` 图片、iframe 拾取、`docwin` 镜像不回归。
6. 可访问性、键盘操作、窄窗适配达到可交付标准。
7. 关键交互按最新效果图落地：PC 文档悬浮弹层、移动端 375×780 自适应、侧栏三层拖拽/去蓝/去数字、Git 卡片树、AI 居中 Dialog。

### 2.2 功能对等清单（Definition of Done）

- [ ] 顶栏：项目、端别、缩放、交互、标注、刷新、Git、终端、导出、待提交、`.loc-pill` 当前位置
- [ ] 左侧原型列表：分组、子页、选中、右键菜单、底部操作、文件夹/一级/二级三层拖拽排序、无数字计数、无蓝色选中
- [ ] 舞台：移动/PC 预览、缩放、拾取、就地编辑、多选、批量修改；移动端 375×780 自适应
- [ ] 文档：功能说明/最新需求、目录、搜索、编辑、保存、导出、段落 `✎ 微改` Popover、PC 悬浮弹层、移动端 Flex 挤压
- [ ] 独立文档窗口：`?docwin=1`、镜像同步、关闭通知、项目/原型直进
- [ ] AI：会话列表、消息流、思考、工具卡、计划、权限、提问、代码、错误、快照、Trace、居中 Dialog、模型/思考级联
- [ ] 模型：模型级联、思考强度、ACP 配置、模型管理、获取模型、富信息清单卡片
- [ ] 设置：Agent、模型、设计规范、沙箱、快捷键、关于、API 配置
- [ ] Git：上传发布、拉取同步、仓库设置、可折叠项目卡片 + 树形文件复选框 + 行级统计
- [ ] 浮层：检查器、标注、多选、待提交、快照、确认、Toast、`.mini-dock`
- [ ] 导出：源码、独立 HTML、文档 PNG/PDF/MD；`export-assets` 路径与 `__EXPORT_BOOT__` 契约
- [ ] 快捷键、Esc 栈、焦点管理、窄窗适配
- [ ] 拆分后的 `core` 门禁 + `legacy-ui` 基线 + 新增 React/Playwright/视觉测试全绿

### 2.3 审查问题闭环

| 审查问题 | 方案调整 |
|---|---|
| 依赖包名错误 `cn` | 改为 `clsx + tailwind-merge`；`shadcn` 只作 CLI，不进生产依赖 |
| 组件选型重叠/过重 | 移除强制 TanStack Table、RHF、Zod、react-resizable-panels、cmdk |
| ESLint/TS 未对齐 | 新增 5.5：flat config、TSX 解析、`lint-guard` 扩展 |
| 工期偏乐观 | 核心 JS 超 1MB；增加 1 周 PoC，暂定 13–15 周 |
| 漏掉 `docwin` | 5.2/10.3/Phase 0 补 `window-controller.js` + React `?docwin=1` + mirror |
| 单文件导出失效 | 5.3/5.4 增加 `export-assets/` 复制与路径改造；保持 `__EXPORT_BOOT__` |
| CSP/`proto-asset:`/iframe | 5.2 放行 `proto-asset:`、`data:`、`blob:`；预览保持 `srcdoc`/同源 |
| 63 项门禁冲突 | 12.3 拆 `core` / `legacy-ui` / `react-ui`，更新 `check-pack`/`static-verify`/`lint-guard` |
| 本地数据丢失 | 10.3 保留 `protoGroups_v1__*`、`protoGroupsFold_v1__*`、`contentZoom` |
| 效果图 5 处偏差 | 8.1/9 明确 PC 悬浮文档、移动 375×780、侧栏三层拖拽、Git 卡片树、AI Dialog、微改/mini-dock/loc-pill |

---

## 3. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 渲染 | React 19 + TypeScript | shadcn 官方主路径 |
| 构建 | Vite 7 | 只构建 renderer，不动 Electron main |
| 样式 | Tailwind CSS v4 + `@tailwindcss/vite` | shadcn 当前安装方式 |
| 组件 | shadcn/ui（New York 视觉） | CLI 安装基础组件 |
| AI 模式 | shadcn AI Elements | 复制模式代码，不是 npm 包 |
| 图标 | lucide-react | shadcn 默认 |
| 状态 | Zustand + React Context | 轻量，不引入 Redux |
| 表单 | 受控组件 + 轻量校验 | 不强制 React Hook Form / Zod |
| 列表/树 | 现有数据结构 + 轻量卡片/树组件 | 不强制 TanStack Table；Git 用分组卡片树 |
| 布局 | CSS Grid/Flex | PC 文档为悬浮弹层，不做分栏挤压 |
| 通知 | shadcn `sonner` | 底层 sonner，由 shadcn 组件封装 |
| 命令面板 | shadcn `command`（可选） | 底层 cmdk，不单独引入 |
| 依赖工具 | `clsx` + `tailwind-merge` | shadcn `cn()` 的正确依赖，不使用 npm 的 `cn` 包 |
| 测试 | Vitest + React Testing Library + Playwright | 组件/集成/视觉 |
| Electron | 保持 37.10.3 | 主进程不变 |

### 3.1 不引入的东西

- 不引入 Next.js：Electron 本地应用不需要 SSR/RSC。
- 不引入 Redux：状态复杂度不需要。
- 不引入 Tailwind UI/付费模板：只用 shadcn。
- 不把 React 放进导出单文件；导出仍用轻量模板。
- 不做微前端/多框架混跑。
- 不强制 `@tanstack/react-table`、`react-hook-form`、`zod`、`react-resizable-panels`；只有后续确有需求再加。
- 不安装 npm 上名为 `cn` 的第三方包；`cn()` 由 `clsx` + `tailwind-merge` 实现。

---

## 4. 目标目录结构

```text
src/
├── renderer/
│   ├── index.html
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── providers.tsx
│   │   └── modes/
│   │       ├── MainWindow.tsx       # 主窗口
│   │       └── DocWindow.tsx        # ?docwin=1 独立文档窗口
│   ├── components/
│   │   ├── ui/                     # shadcn 生成组件
│   │   ├── ai-elements/            # AI Elements 复制/定制
│   │   ├── shell/                  # Topbar / Sidebar / Stage / DocsPanel
│   │   └── overlays/               # Dialog / Sheet / Popover / Command
│   ├── features/
│   │   ├── workspace/
│   │   ├── preview/
│   │   ├── docs/
│   │   ├── ai/
│   │   ├── models/
│   │   ├── settings/
│   │   ├── annotations/
│   │   ├── links/
│   │   ├── git/
│   │   ├── snapshot/
│   │   └── export/
│   ├── lib/
│   │   ├── ipc.ts                  # window.protoAPI 类型化封装
│   │   ├── events.ts               # ai:event / doc mirror
│   │   ├── format.ts
│   │   ├── sanitize.ts
│   │   └── utils.ts                # cn()
│   ├── stores/
│   │   ├── app-store.ts
│   │   ├── ai-store.ts
│   │   ├── docs-store.ts
│   │   └── ui-store.ts
│   ├── styles/
│   │   ├── globals.css             # Tailwind + shadcn tokens
│   │   └── export.css              # 导出单文件用的轻量子集
│   └── types/
│       └── ipc.d.ts
├── preload.js                      # 不变
├── main.js                         # renderer 加载路径/模式切换
├── 原型+文档.html                  # 旧渲染器 fallback（保留一个版本）
└── ...

scripts/
└── copy-export-assets.mjs          # 复制 export-template/icons/export.css 到 src/renderer/public/export-assets/（构建自动带入 dist）
```

保留：

- `main/**`、`preload.js`、`runtimes/**`、`providers/**`、`platform/**`、`git/**`
- `js/export-template.js`、`js/icons.js`（导出单文件仍用）
- `runtimes/**` 的 ACP/检测逻辑
- `main/controllers/window-controller.js` 的 `docwin` 生命周期与 mirror 通道

开发启动/构建前需把 `js/export-template.js`、`js/icons.js`、`app.css` 或 `export.css` 复制到 `src/renderer/public/export-assets/`（Vite 自动透传到 `dist/renderer/export-assets/`），保证开发与打包导出逻辑一致且不依赖旧根目录。

---

## 5. 构建与 Electron 接入

### 5.1 Vite 配置

```ts
// vite.config.ts
import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src/renderer") } },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
})
```

### 5.2 Electron 加载与双窗口

- 开发：Vite dev server（`http://localhost:5173`），Electron `loadURL`。
- 生产：`loadFile(dist/renderer/index.html)`。
- 旧版 `原型+文档.html` 保留为 fallback，通过 `PLAND_RENDERER=legacy` 回滚；开发期 `?renderer=legacy` 由主进程拦截并改用 `loadFile(原型+文档.html)` 切换，不要在 Vite dev server 内部路由。
- `preload.js` 路径不变；`contextIsolation`、`webSecurity` 配置不变。
- **独立文档窗口必须同步改造**：`window-controller.js` 目前硬编码加载 `原型+文档.html?docwin=1`；改为加载 React renderer 的 `?docwin=1` 模式，React 入口识别该参数，只渲染文档面板，并继续使用 `doc:mirror-push` / `doc:mirror-back` 同步。`createDocWindow` 的尺寸、`closed` 通知、主窗 fallback 逻辑保持不变。
- **CSP 必须放行现有资源（区分开发态与生产态）**：
  - `img-src 'self' data: blob: proto-asset:`
  - `frame-src 'self' data: blob:`
  - `style-src 'self' 'unsafe-inline'`（Tailwind）
  - `script-src`：生产态严格 `'self'`；仅开发态允许 Vite HMR / `@vitejs/plugin-react` Fast Refresh 注入的内联 preamble（`'unsafe-inline'` 或 nonce）
  - `connect-src 'self' ws://localhost:5173`（仅开发态）
  - 不放行外部字体/CDN。
- **iframe 拾取必须保持同源/srcdoc**：`edit-entry.js` 依赖 `iframe.contentDocument`、准星注入、标注定位；开发态 Vite 与 `srcdoc` 组合下要验证不触发 `SecurityError`。不要把预览 iframe 改成跨域 URL。
- 预览缩略图/文档图片继续走 `proto-asset://`，不能只写 `img-src 'self'`。

### 5.3 构建脚本

```json
{
  "scripts": {
    "dev:renderer": "node scripts/copy-export-assets.mjs && vite --config vite.config.ts",
    "build:renderer": "node scripts/copy-export-assets.mjs && vite build --config vite.config.ts",
    "start": "electron .",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "build": "npm run build:renderer && electron-builder --win --x64"
  }
}
```

`scripts/copy-export-assets.mjs` 负责把 `js/export-template.js`、`js/icons.js`、`export.css` 复制到 `src/renderer/public/export-assets/`（加入 `.gitignore`，Vite 构建时自动带入 `dist/renderer/export-assets/`，且开发态 `http://localhost:5173/export-assets/` 同样可直接访问）。这是构建步骤，不是运行时依赖；不要依赖 Vite 自动把根目录旧文件带进产物。

### 5.4 打包与导出资源

- `build.files` 增加 `dist/renderer/**`；过渡版本保留旧 `原型+文档.html` 作为 `PLAND_RENDERER=legacy` 回滚入口时，**须同步继续保留根目录 `app.css` 与 `js/**`**（旧 HTML 仍直接引用它们），待下一版本下线 legacy fallback 后再一并剔除。
- `asar` 保持开启；`acpx`/adapter 继续 `asarUnpack`。
- 构建时把 `js/export-template.js`、`js/icons.js`、`export.css` 复制到 `dist/renderer/export-assets/`；单文件导出只读取这些资源，不再假设根目录存在 `app.css`。
- `buildExportHtml` 的 `fetchText('app.css')` 必须改为读取 `export-assets/export.css` 或构建时注入的字符串；`window.__EXPORT_BOOT__`、`window.__EXPORT_SOURCES__` 契约保持不变。
- `tests/check-pack.js` 当前硬断言 `build.files` 18 条、旧 HTML 18 个 script、`main.js` 的 `loadFile(原型+文档.html)` 字面量；改造时要同步拆分/更新这些断言，不能直接宣称“63 项全绿”。
- 安装包冷启动、离线启动、`file://` 资源路径、单文件导出必须逐项验证。

### 5.5 TypeScript 与 ESLint 对齐

- 新增 `tsconfig.json`：`jsx: "react-jsx"`、`moduleResolution: "bundler"`、`allowJs: true`、`checkJs: false`、`noEmit: true`、`paths: { "@/*": ["src/renderer/*"] }`。
- 现有 `eslint@9` 改为 flat config（`eslint.config.js`），加入 `typescript-eslint`、`eslint-plugin-react-hooks`、`eslint-plugin-react-refresh`。
- 保留 `.prettierrc.json`；新增 `.tsx` 文件纳入格式化与 lint。
- 现有 `lint-guard.js` 只扫根目录 `.js`，改造后要同时覆盖 `src/**/*.{ts,tsx}`，并保留对主进程 `.js` 的扫描。
- `npm run lint:eslint` 不能在加入 TSX 后解析失败；CI 门禁要先过 lint 再跑测试。

---

## 6. shadcn 初始化

### 6.1 依赖

```bash
npm i react react-dom
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/node
npm i -D typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh
npm i -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
npm i tailwindcss @tailwindcss/vite
npm i class-variance-authority clsx tailwind-merge lucide-react tw-animate-css
# shadcn 只作为 CLI 使用，不放入生产依赖
npx shadcn@latest init
```

> 不要安装 npm 上名为 `cn` 的包；`cn()` 由 `clsx` + `tailwind-merge` 实现。`shadcn` 是 CLI，不是运行时依赖。

### 6.2 初始化

```bash
npx shadcn@latest init
npx shadcn@latest add button card dialog sheet tabs select input textarea checkbox switch badge tooltip dropdown-menu popover command alert-dialog sonner scroll-area separator skeleton spinner empty sidebar collapsible progress
```

> 不在首轮安装 `resizable` / `table`：PC 文档是悬浮弹层不是分栏；Git/模型管理用卡片树/卡片清单，不用二维表格。命令面板 `command` 为可选，先装不影响。

`components.json`：

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

> 当前 shadcn 文档默认 style 可能是 `base-nova`；效果图是 New York。若 CLI 不再提供 New York，按效果图 token 覆盖，不改变组件结构。

### 6.3 AI Elements

AI Elements 不是 npm 包，是复制进项目的模式。按 AI Elements 官方的 shadcn registry 命令安装基础件（命令以官方当前文档为准），首轮至少加入 `trace`、`code-block`。

然后按需复制：

- Chat、Message、Message Scroller
- Reasoning、Tool、Plan、Task、Trace
- Confirmation、Questionnaire
- Model Selector、Prompt Input、Terminal、Context
- Checkpoint、Queue、Suggestion、Subagent

建议先做 `Chat + Message + Reasoning + Tool + Plan + Confirmation + Model Selector + Prompt Input`，其余按页面需要补。

---

## 7. 状态与 IPC 适配

### 7.1 IPC 类型化

- 新建 `lib/ipc.ts`，包装 `window.protoAPI`，保持 70 通道不变。
- 从 `main/ipc-contract.js` 生成/维护 `types/ipc.d.ts`。
- 所有调用统一错误处理：`{ok,error,cancelled}`。
- 不把 `ipcRenderer` 暴露给组件；只通过 `protoAPI`。

### 7.2 全局状态

- `app-store`：当前项目、原型列表、当前源、端别、缩放、面板状态。
- `docs-store`：文档内容、编辑态、TOC、搜索、请求版本。
- `ai-store`：会话、消息、事件、模型、ACP 配置、权限/提问、Trace。
- `ui-store`：弹层栈、Toast、命令面板、快捷键。

### 7.3 事件桥

- `ai:event` → `useAcpEvents` → `ai-store` reducer。
- `doc:mirror` → 文档窗口同步。
- `store/EventBus` 旧事件 → React 事件适配器。
- 事件必须带 `agentId` / `uiSessionId` 归属校验（沿用现有逻辑）。

---

## 8. 页面组件映射

### 8.1 主壳层

| 区域 | shadcn 组件 | 说明 |
|---|---|---|
| 顶栏 | Button、DropdownMenu、Tooltip、Separator、Badge、Breadcrumb/自定义 loc-pill | 项目/端别/缩放/交互/标注/Git/终端/导出；保留当前位置面包屑胶囊 |
| 左侧栏 | Sidebar、ScrollArea、Collapsible、ContextMenu + 自定义拖拽手柄 | 原型列表、分组、子页；三层拖拽排序 |
| 舞台 | Tooltip、ToggleGroup、Popover、Sheet | 预览、拾取、就地编辑、多选；移动端固定 375×780 自适应缩放 |
| 文档 | Tabs、ScrollArea、Input、Button、DropdownMenu、Dialog（PC） | PC 为右侧悬浮弹层；移动端为 Flex 挤压缩放，不用 Sheet 分栏 |
| AI | Dialog、Chat/Message、Reasoning、Tool、Plan、Confirmation、Model Selector、Prompt Input、Terminal、Trace | 居中大型模态框，不是 Sheet/Resizable |
| 设置 | Dialog、Tabs、Card、Field、Input、Select、Switch、RadioGroup、Separator、ScrollArea | 6 个 Tab |
| Git | Dialog/Sheet、自定义可折叠项目卡片 + 树形复选框行、Checkbox、Input、AlertDialog | 不用二维 Table；保留项目分组与行级增删统计 |
| 浮层 | Dialog、Sheet、Popover、DropdownMenu、AlertDialog、Command | 检查器/标注/多选/待提交/快照；文档段落 `✎ 微改` Popover |

**补充硬性 UI 约束：**

1. **PC 文档面板**：右侧独立悬浮弹窗（含遮罩与 Esc 关闭），**绝不挤压 PC 原型**；移动端才用 Flex 并排压缩舞台。不要用 `Resizable` 做 PC 分栏。
2. **移动端视窗**：固定 375×780 逻辑视窗，默认「自适应」模式；外层等比缩放盒 + `ResizeObserver` 随窗口/文档挤压实时缩放，避免外层滚轮上下翻。
3. **左侧原型列表**：
   - 使用 shadcn `sidebar` 时将默认 `--sidebar-width` 覆写为 `236px`，与效果图比例一致；
   - 去掉文件夹右侧计数数字；
   - 选中态去蓝色，改为纯白卡片 + 深墨左指示条，或灰底 + 深墨圆点；
   - 文件夹、一级原型（含跨组移动）、二级子页三层都支持上下拖拽改序，悬停显示 6 点手柄。
4. **Git**：可折叠项目卡片 + 树形文件复选框行，目录前缀弱化、行级增删行数、三态勾选、顶部等高筛选栏；不要用 Table。
5. **模型管理**：富信息清单卡片，含搜索、自定义输入 32px 等高按钮、描述文案、标签与计数；菜单只显示已选，弹窗全量 + 勾选。
6. **AI 形态**：居中大型 Dialog，顶部/底部含模型 + 思考强度两级级联；不要归为 Sheet。
7. **补充遗漏**：文档段落悬停 `✎ 微改` Popover、侧栏收起后的左下角 `.mini-dock`、顶栏 `.loc-pill` 面包屑必须纳入组件清单。

### 8.2 AI 对话

使用 AI Elements 模式，但数据源仍是现有 `ai:event`：

- `Chat`：会话消息流
- `Message`：用户/AI 消息、附件
- `Reasoning`：思考块，可折叠
- `Tool`：工具调用卡
- `Plan`：任务计划
- `Confirmation`：权限请求
- `Questionnaire`：问题/表单
- `Model Selector`：模型 + 思考强度
- `Prompt Input`：输入/附件/发送/停止
- `Terminal`：终端输出
- `Trace`：执行日志
- `Context`：上下文用量

承载形态：居中大型 `Dialog`，打开后不挤压原型；**不要用 Sheet 或 Resizable 作为 AI 对话主容器**。模型 + 思考强度在顶部/底部做两级级联，ACP 返回的 thinking 选项必须动态渲染，不能写死。

### 8.3 设置与模型管理

- `Tabs` 6 个 Tab。
- `Card` 分区（Agent 矩阵、ACP 设置、权限模式）。
- `Field` + `Input/Select/Switch` 表单（受控组件，不强制 RHF/Zod）。
- 模型管理使用富信息清单卡片，不用 Data Table；菜单只显示已选，弹窗全量 + 勾选，搜索不改勾选。
- `AlertDialog` 删除/覆盖确认。

### 8.4 浮层

- `Dialog`：设置、Git、新建、确认、AI 对话（居中大型模态）。
- `Sheet`：检查器、多选、标注（不是 AI 对话）。
- `Popover`：模型级联、颜色、文档段落微改。
- `DropdownMenu`：Git/导出/更多。
- `Command`：命令面板（可选）。
- `sonner`：Toast。
- `.mini-dock`：侧栏收起后的左下角悬浮入口。
- `.loc-pill`：顶栏当前位置面包屑胶囊。

---

## 9. 视觉令牌

直接使用效果图的 shadcn New York 令牌：

- `--background: #ffffff`
- `--foreground: #09090b`
- `--canvas: #f4f4f5`
- `--chrome: #fafafa`
- `--primary: #18181b`
- `--muted-foreground: #71717a`
- `--border: #e4e4e7`
- `--cobalt: #2563eb`
- `--radius: 0.625rem`（10px）
- 阴影 sm/md/lg
- 字体：系统 sans + mono
- 基础字号 13px；按钮 12.5px；小字 11–12px

要求：

- 不引入外部字体/CDN。
- 支持 `.dark` token，但首期只验收 light；dark 单独排期。
- 统一 focus ring、hover、disabled、loading、empty。
- 全局滚动条 6px、细、圆角。
- `--cobalt` 只用于链接、焦点、少量强调；**左侧原型列表选中态不用蓝色**。
- 侧栏选中态使用纯白卡片 + 深墨左指示条，或灰底 + 深墨圆点；文件夹不显示右侧计数数字。
- PC 文档浮层使用遮罩 + 阴影，移动端文档为挤压式 Flex，不使用同一套分栏规则。

---

## 10. 迁移策略

### 10.1 双渲染器并行

- 新 React renderer 挂在 `src/renderer`。
- 旧 `原型+文档.html` 保留。
- 迁移期默认 `legacy`，完成功能对等后默认 `react`。
- `PLAND_RENDERER=react|legacy` 显式切换；发布包保留一个版本的 legacy fallback。
- 开发期 `?renderer=legacy` 可切回旧版（由主进程拦截后改用 `loadFile(原型+文档.html)`，不走 Vite 路由）。

### 10.2 分阶段替换

1. 先搭 React 壳（顶栏/侧栏/舞台占位），不接业务。
2. 接项目/原型/预览 iframe。
3. 接文档渲染与编辑。
4. 接 AI 对话（最复杂）。
5. 接设置/模型管理。
6. 接浮层/Git/导出。
7. 旧渲染器降级为 fallback，最后删除。

### 10.3 保留旧逻辑与数据迁移

- `js/project-ai-export.js` 的 AI 事件/权限/模型逻辑不要直接搬；先包成 `features/ai` 的纯函数/适配器。
- `js/core-docs.js` 的 Markdown 渲染、TOC、搜索可先保留为框架无关模块，React 只接管容器/工具栏；避免重写 contenteditable/undo。
- `js/export-template.js` 保持不变；导出单文件不加载 React。
- `runtimes/**`、`main/**` 不动。
- **独立文档窗口**：React 入口识别 `?docwin=1`，保留 `doc:mirror-push/back`、关闭通知、项目/原型 query 直进；`window-controller.js` 只改加载路径，不重写生命周期。
- **本地数据兼容**：`protoGroups_v1__<proj>`、`protoGroupsFold_v1__<proj>`、`contentZoom`、会话 localStorage 键名必须原样读写或一次性迁移；不得清空用户的分组/折叠/缩放。
- **单文件导出**：`buildExportHtml` 的资源路径改为 `export-assets/`，保持 `window.__EXPORT_BOOT__` / `window.__EXPORT_SOURCES__` 契约；导出 HTML 不加载 React。

---

## 11. 分阶段实施计划

### Phase 0：PoC 与门禁拆分（1 周）

**先 PoC，再锁排期；PoC 不通过不进入业务迁移。**

- 建 Vite/React/TS/Tailwind/shadcn 脚手架。
- 跑通：Electron + Vite + iframe `srcdoc` 拾取 + `?docwin=1` 独立文档窗口 + `proto-asset:` 图片 + 单文件导出 + `electron-builder` 打包。
- 修正 `window-controller.js` 的 renderer 加载入口，React 识别 `?docwin=1`。
- 配置 CSP：`img-src`/`frame-src` 放行 `proto-asset:`、`data:`、`blob:`；开发态放行 `ws://localhost:5173`。
- 拆分测试门禁：`core`（主进程/70 IPC/ACP/Git 安全）与 `legacy-ui`（旧 HTML 静态断言）分离；`check-pack`、`static-verify`、`lint-guard` 按新结构更新。
- 建立截图基线与 feature flag。
- 产出：可启动的空壳 React renderer + PoC 报告 + 重新校准的工期。

**PoC 通过标准（全部满足才进 Phase 1）：**

- [ ] Vite dev + 生产 `loadFile` 都能启动，无白屏。
- [ ] iframe `srcdoc` 内可 `contentDocument` 注入拾取，无 `SecurityError`。
- [ ] `?docwin=1` 能独立打开并完成一次 `doc:mirror-push/back` 往返。
- [ ] `proto-asset:` 图片在文档/缩略图正常显示。
- [ ] 单文件导出可离线打开，样式/交互/`__EXPORT_BOOT__` 正常。
- [ ] `electron-builder` 安装包可启动，asar 内资源路径正常。
- [ ] `core`/`legacy-ui` 门禁拆分后，旧基线不全红。

> 如果 PoC 失败（iframe 拾取、docwin、导出、CSP 任一不通），先修通再进入 Phase 1，不并行铺业务页面。

### Phase 1：设计系统与主壳（1.5 周）

- 安装基础 shadcn 组件。
- 顶栏、侧栏、舞台布局；侧栏去数字、去蓝选中、三层拖拽骨架。
- 文档面板：PC 右侧悬浮弹层、移动端 Flex 挤压（文档内容 Phase 3 接）。
- 响应式/窄窗/缩放；移动端 375×780 自适应盒。
- 产出：无业务数据的完整壳层。

### Phase 2：项目/原型/预览（1.5 周）

- 项目选择、原型列表、分组/子页；三层拖拽排序与跨组移动。
- iframe 预览、缩放、端别切换、刷新；移动端 375×780 自适应。
- 拾取态/就地编辑/多选壳层。
- 产出：可预览原型。

### Phase 3：文档（1.5 周）

- 功能说明/最新需求、TOC、搜索。
- Markdown 渲染、编辑、保存、导出菜单；段落 `✎ 微改` Popover。
- PC 悬浮弹层 + 移动端 Flex 挤压；`?docwin=1` 独立窗口与镜像同步。
- 产出：文档全流程可用。

### Phase 4：AI 对话（3 周）

- Chat/Message/Reasoning/Tool/Plan/Confirmation/Questionnaire。
- 居中大型 Dialog；顶部/底部模型 + 思考强度两级级联。
- 会话列表、流式事件、停止/重试、Trace。
- 模型选择、思考强度、ACP 配置、权限卡、快照。
- 产出：四 Agent 全链路可用。

### Phase 5：设置/模型管理（1.5 周）

- 6 个设置 Tab。
- Agent 矩阵、ACP 开关、权限模式。
- 模型管理富信息清单卡片、菜单已选、弹窗全量 + 勾选、API 配置。
- 产出：设置与模型管理全功能。

### Phase 6：浮层/Git/导出（2 周）

- 检查器、标注、多选、待提交、快照、`.mini-dock`。
- Git 可折叠项目卡片 + 树形文件复选框 + 行级增删统计。
- 导出源码/HTML/文档 PNG/PDF/MD；`export-assets` 与 `__EXPORT_BOOT__` 契约验证。
- 产出：功能对等。

### Phase 7：回归/性能/发布（2 周）

- 全量功能回归、视觉回归、键盘/可访问性。
- 安装包/离线/单文件导出。
- 旧渲染器 fallback 验证。
- 产出：可发布版本。

**总周期：约 13–15 周（2 前端 + 1 QA），以 Phase 0 PoC 结果重新校准。**

> 旧代码体量：`js/project-ai-export.js` 约 493KB、`core-docs.js` 约 202KB、`edit-entry.js` 约 163KB，合计核心 JS 超过 1MB。v1.0 的 11–12 周偏乐观；v1.1 增加 PoC、门禁拆分与文档/AI 缓冲。

---

## 12. 测试计划

### 12.1 单元/组件

- Vitest + React Testing Library。
- Button/Input/Dialog/Sheet/Tabs/Select/Toast。
- AI 事件 reducer、权限卡、模型选择、ACP 配置。
- 文档 TOC/搜索/渲染适配。

### 12.2 集成/E2E

- Playwright Electron：
  - 启动、项目选择、原型预览、拾取、三层拖拽排序。
  - PC 文档悬浮弹层 + 移动端 375×780 自适应。
  - 文档编辑/保存/导出；`?docwin=1` 独立窗口与镜像同步。
  - AI 四 Agent 发送、权限、模型/思考、停止；AI 为居中 Dialog。
  - 模型管理：菜单仅已选、弹窗全量、搜索不改勾选；ACP thinking 选项动态。
  - 设置/模型管理（卡片清单）/Git（卡片树）。
- 视觉截图对比效果图（1440/1024/600）；视觉基线包含去蓝/去数字/拖拽手柄/行级统计。

### 12.3 门禁拆分与更新

- **不能直接沿用旧 63 项全绿承诺**：`check-pack.js` 硬断言 `build.files` 18 条、旧 HTML 18 个 script、`main.js` 的 `loadFile(原型+文档.html)` 字面量、导出 `fetchText('app.css')`；`static-verify.js` 硬编码旧颜色/40px 顶栏/旧 DOM；`lint-guard.js` 扫描根目录 `.js`。
- 将 `tests/run-all.js` 拆为：
  - `core`：主进程、70 IPC、ACP、Git 安全、runtimes、providers、sandbox。
  - `legacy-ui`：旧 `原型+文档.html` 的静态断言、旧 class/颜色/脚本数量。
  - `react-ui`：新的 Vitest/RTL/Playwright 套件。
- `check-pack.js`、`static-verify.js`、`lint-guard.js` 按新结构更新：
  - `build.files` 增加 `dist/renderer/**`；断言改为“必需项存在”，不再硬编码 18 条；
  - 允许 `main.js` 在 React/legacy 两个加载入口间切换；`check-pack` 改为断言模式开关/两个入口存在，不再强制旧 `loadFile(原型+文档.html)` 字面量；旧 HTML 脚本数量断言只留在 `legacy-ui`；
  - 导出资源改到 `export-assets/`，不再断言 `fetchText('app.css')`；
  - ESLint 增加 TSX/React 配置，`lint-guard` 同时扫描 `src/**/*.tsx`。
- 迁移期间旧 UI 测试保留在 `legacy-ui`，不能因为 React 改造第一天就全红。
- `verify-ipc` 仍必须 70 通道；`verify-runtimes`/ACP 测试不动。

### 12.4 视觉与可访问性

- 截图对比：1440×1080、1024×768、600×900、缩放 50/100/150。
- 键盘全流程：打开弹层 → Tab → Esc → 焦点回归。
- 对比度、focus ring、reduced motion、窄窗。
- 安装包冷启动、离线、导出单文件。

### 12.5 性能

- 首屏 JS/CSS 预算；AI/设置按需 lazy load。
- 弹层打开/关闭 < 100ms。
- 大模型列表 500+ 项虚拟滚动。
- 无内存泄漏（事件订阅/定时器清理）。

---

## 13. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 全量重写回归 | 功能丢失 | 双渲染器 + 分阶段 + 功能对等清单 |
| 核心 JS 超 1MB | 事件/权限/编辑器错乱 | 先抽适配器/纯函数，不直接搬 UI；PoC 后重估 |
| 独立文档窗口 `docwin` 漏改 | 点“独立窗口”界面错乱/镜像断联 | Phase 0 改 `window-controller.js` + React `?docwin=1` + mirror 联调 |
| 单文件导出路径失效 | 导出 HTML 无样式/报错 | 构建复制 `export-assets/`；保持 `__EXPORT_BOOT__` 契约；导出 E2E |
| 测试门禁误伤 | 第一天全红，阻塞集成 | 拆 `core` / `legacy-ui` / `react-ui`；更新 `check-pack`/`static-verify`/`lint-guard` |
| CSP 拦 `proto-asset:` | 文档/缩略图空白 | `img-src`/`frame-src` 放行 `data: blob: proto-asset:` |
| iframe 跨域 | 拾取/标注 `SecurityError` | 预览保持 `srcdoc`/同源；不改跨域 URL |
| 本地数据键名变化 | 分组/折叠/缩放丢失 | 原样读写 `protoGroups_v1__*`、`protoGroupsFold_v1__*`、`contentZoom` |
| 效果图偏差 | 返工 | PC 文档悬浮、移动 375×780、侧栏三层拖拽、Git 卡片树、AI Dialog |
| IPC 契约 | 70 通道破坏 | 只包装，不改 contract；类型化 |
| 构建链 | Electron 启动白屏 | dev URL/生产 loadFile 双验证 |
| 周期超期 | 交付压力 | 先做 P0 页面，AI/设置可分批合并；PoC 后重排 |

---

## 14. 团队与分工

| 角色 | 职责 |
|---|---|
| 前端 A | 脚手架、设计系统、主壳、文档、浮层 |
| 前端 B | AI 对话、模型/设置、Git/导出 |
| QA | 视觉回归、E2E、键盘/导出/安装包 |
| 主进程/ACP 负责人 | 只做接口答疑与 IPC 回归，不参与 UI 重写 |
| 产品/设计 | 效果图验收、交互决策 |

---

## 15. 发布与回滚

- 默认启用 React renderer；旧 HTML 保留一个版本。
- 设置/环境变量 `PLAND_RENDERER=legacy` 可回滚。
- 发布前跑完整功能对等清单与视觉基线。
- 发布后收集渲染错误/性能；保留旧包一个版本。
- 单文件导出与旧版保持兼容，不要求用户升级。

---

## 16. 最终建议

1. **按方案 A 执行时，先做 Phase 0 PoC，再做 Phase 1–2**，验证 Vite/React/shadcn/Electron/iframe/docwin/export 这条链路，再投入 AI 重写。
2. **AI 对话最后做**，但设计 token/组件先冻结；AI 依赖 Chat/Reasoning/Tool/Confirmation 模式，前期先把基础组件装好。
3. **不要重写主进程/ACP**；渲染层只消费现有 IPC。
4. **不要重写导出运行时**；导出继续用轻量模板。
5. 如果 13–15 周周期不可接受，退回方案 B（4–6 周）先统一视觉，再按模块迁移 A；不要压缩 Phase 0、导出和门禁拆分。
