# PlanD shadcn/ui 全面改造实施方案

> 版本：v1.0（方案稿，不涉及代码实施）
> 日期：2026-11-12
> 视觉基线：`docs/shadcn-redesign-preview.html`
> 参考：https://ui.shadcn.com/docs/installation

---

## 1. 结论先行

1. **效果图是“shadcn/ui New York 视觉”的静态 HTML/CSS 复刻**，覆盖顶栏、侧栏、舞台、文档、AI 对话、设置、Git、抽屉/弹层，可作为视觉与交互的单一基线。
2. **shadcn 不是纯 CSS 组件库**：官方形态是 React + Tailwind CSS + Radix/Base UI 的“复制进项目”的组件代码。当前 PlanD 是 Electron + 原生 HTML/CSS/JS，没有 React、Tailwind、Vite，直接执行 `shadcn init` 不能落到现有页面上。
3. 因此有两条路线：
   - **方案 A：全量迁移到 React + Vite + Tailwind + shadcn/ui**。能真正使用官方组件和 AI Elements，但等于重写渲染层，周期长、风险高。
   - **方案 B：采用 shadcn 设计令牌 + 组件外观 + 行为规范，保留现有原生渲染层**。视觉可与效果图一致，改动可控，适合当前 Electron/单文件导出架构。
4. **建议先走方案 B**，把“视觉与交互”全面统一；后续如果确实需要官方 AI Elements/Radix 行为，再按模块渐进迁移到方案 A。不要“半 React 半原生”混跑。

---

## 2. 效果图解读

### 2.1 视觉基线

`shadcn-redesign-preview.html` 使用的是 shadcn/ui **New York** 风格的令牌与组件外观：

- 背景：`#ffffff` / canvas `#f4f4f5` / chrome `#fafafa`
- 前景：`#09090b`，次要文字 `#71717a`
- 主色：`#18181b`（近黑），强调色：`#2563eb`（cobalt）
- 状态色：emerald `#059669`、amber `#d97706`、sky `#0284c7`、rose `#e11d48`
- 边框：`#e4e4e7`，输入边框同色，focus ring 近黑
- 圆角：4 / 6 / 10 / 14px
- 阴影：sm/md/lg 三档，低对比、短扩散
- 字体：系统 sans，基础字号 13px；按钮 12–12.5px；代码/数字用 mono
- 布局：44px 顶栏、左侧栏、中央舞台、右侧文档、底部 AI 输入条
- 风格：纯色、无渐变、弱阴影、清晰边框、紧凑间距

### 2.2 覆盖的页面/组件

效果图已经覆盖：

1. 顶部全局工具栏（项目、端别、缩放、交互、标注、刷新、Git、终端、导出、待提交）
2. 左侧原型列表（分组、子页、选中态、底部操作）
3. 中央舞台（移动/PC 预览、拾取态、就地编辑、多选面板）
4. 右侧文档面板（功能说明/最新需求、目录、搜索、编辑、导出）
5. AI 对话弹窗（会话列表、消息流、思考、工具调用、权限卡、提问卡、计划、代码块、错误卡、快照、输入条、模型/思考强度级联、ACP 配置）
6. 设置弹窗（Agent、模型管理、设计规范、沙箱、快捷键、关于）
7. Git 上传/拉取、仓库设置、选择树
8. 新建原型、文档快捷键、AlertDialog、Toast、抽屉/Sheet
9. 模型管理/获取模型弹窗、API 配置弹窗

### 2.3 效果图的定位

- 它是**静态视觉稿**，交互用模拟函数实现，不是生产代码。
- 它的 CSS 令牌和组件样式可以直接抽成设计系统。
- 它没有覆盖真实的 iframe 预览、IPC、ACP 事件、权限桥、导出流水线；这些必须保留现有实现。

---

## 3. shadcn 官方安装方法摘要

### 3.1 标准路径

官方推荐：

```bash
# 新项目
pnpm dlx shadcn@latest init -t vite

# 已有 Vite 项目
pnpm add tailwindcss @tailwindcss/vite
# 配置 @ 别名、tailwind、tsconfig
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card dialog
```

`components.json` 关键项：

```json
{
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  },
  "iconLibrary": "lucide"
}
```

> 当前 shadcn 文档默认样式可能是 `base-nova`；效果图是 New York 视觉。落地时以效果图令牌为准，CLI 的 style 只作为起点。

### 3.2 手工安装的关键依赖

```bash
pnpm add shadcn class-variance-authority cn lucide-react tw-animate-css
```

全局 CSS：

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
```

并定义 `--background`、`--foreground`、`--card`、`--popover`、`--primary`、`--secondary`、`--muted`、`--accent`、`--destructive`、`--border`、`--input`、`--ring`、`--radius` 等 CSS 变量。

### 3.3 AI Elements

shadcn 现在提供 **AI Elements** 模式，专门用于 Agent 界面：

- Chat / Message / Message Scroller
- Reasoning / Tool / Plan / Task / Trace
- Confirmation / Questionnaire
- Model Selector / Prompt Input
- Terminal / File Tree / Context / Sources
- Checkpoint / Queue / Suggestion / Subagent

它们不是 npm 包，而是“复制进项目”的组合模式；需要先安装 `trace`、`code-block` 等基础组件，再复制模式代码。

### 3.4 对 PlanD 的直接结论

PlanD 当前没有 React、Tailwind、Vite，且渲染层是 400KB+ 的原生 JS 与 150KB+ 的单体 CSS。**不能直接把 shadcn CLI 装到现有页面上**；必须先决定是否重写渲染层。

---

## 4. 现状与差距

### 4.1 现有架构

- Electron 37 + 原生 HTML/CSS/JS
- `原型+文档.html` 单页挂载所有弹窗/抽屉/浮层
- `app.css` 约 150KB，单文件、历史样式多、硬编码颜色/圆角/阴影
- `js/project-ai-export.js` 约 420KB，包含 AI 会话、模型、权限、Trace、导出等大量逻辑
- `js/core-docs.js` 约 250KB，文档渲染/编辑/搜索
- 无 React、无 Tailwind、无组件构建链
- `window.protoAPI` + 70 个 IPC 通道，主进程/预加载保持稳定
- iframe 预览、单文件导出、离线运行是硬约束

### 4.2 主要差距

| 维度 | 现状 | 目标 |
|---|---|---|
| 设计令牌 | 颜色/圆角/阴影分散，存在历史重复 | 统一 shadcn token |
| 组件 | `.docs-btn`、`.btn`、`.modal` 等多套样式 | 一套 Button/Input/Dialog/Sheet 变体 |
| 弹层 | 多种 mask/drawer/modal，z-index 分散 | Dialog/Sheet/Popover/Dropdown 统一层级 |
| 表单 | 原生 input/select 与自定义样式混用 | Field/Input/Select/Switch/Checkbox |
| AI 消息 | 自定义气泡/工具卡/思考块 | Chat/Message/Reasoning/Tool/Plan |
| 空态/加载 | 文案不统一 | Empty/Skeleton/Spinner |
| 可访问性 | 部分弹窗 focus/ARIA 不完整 | focus ring、focus trap、键盘操作 |
| 响应式 | 600px/窄窗有专门逻辑 | 统一断点与侧栏折叠 |

---

## 5. 路线选择

### 5.1 方案 A：全量 React + Tailwind + shadcn/ui

**做法**

1. 新建 `src/renderer`（Vite + React + TypeScript）。
2. 安装 Tailwind v4、`@tailwindcss/vite`、`shadcn`。
3. `npx shadcn@latest init`，配置 `components.json`、`@` 别名、CSS 变量。
4. 用 `npx shadcn@latest add ...` 安装基础组件。
5. 把现有 UI 逐页重写为 React 组件；Electron 主进程/preload/IPC 不变。
6. iframe 预览保留；导出单文件逻辑需要重新处理 CSS 内联。
7. AI 对话直接用 AI Elements 的 Chat/Reasoning/Tool/Plan/Confirmation/Model Selector/Prompt Input。

**优点**

- 真正使用官方 shadcn 组件、Radix/Base UI 行为、AI Elements。
- 组件可维护性、可访问性、主题化最好。
- 长期看是最干净的架构。

**缺点**

- 等于重写整个渲染层：420KB AI 逻辑 + 250KB 文档逻辑 + 所有浮层/快捷键。
- 现有测试大量依赖 DOM id/class，需要重写。
- 单文件导出、iframe、Electron 文件协议、CSP 都要重新验证。
- 周期约 10–12 周，风险高。

**适用**：愿意接受渲染层重写，且未来要长期做复杂 Agent UI。

### 5.2 方案 B：shadcn 设计令牌 + 组件外观（保留原生渲染层）

**做法**

1. 从效果图抽取 `tokens.css`：颜色、字体、圆角、阴影、间距、z-index。
2. 新建 `components.css`：Button/Input/Select/Dialog/Sheet/Popover/Tabs/Badge/Card 等 shadcn 外观。
3. 新建 `js/ui/*` 原生组件层：负责打开/关闭、焦点、键盘、ARIA、状态。
4. 逐页替换旧 class，保留 DOM id/事件绑定；旧 class 做别名兼容。
5. 保留现有 IPC、ACP、iframe、导出逻辑；只改视觉与基础交互。

**优点**

- 改动可控，不引入 React 构建链，不影响 Electron 主进程。
- 可以完整复刻效果图视觉。
- 保留现有 63 个测试和导出流水线。
- 周期约 3–5 周。

**缺点**

- 不是官方 shadcn 组件代码，没有 Radix 行为；焦点/键盘要自己补。
- 长期维护仍是原生组件。
- 不能直接使用 AI Elements 源码，只能按视觉模式仿写。

**适用**：当前项目、需要快速统一 UI、不能承担重写风险。

### 5.3 方案 C：混合（React 岛）

只把 AI 对话/设置做成 React，其余保留原生。**不建议**：构建链、状态、事件、样式会分裂成两套，维护成本高于 A 或 B。

### 5.4 推荐

**先做 B，视觉统一后再评估 A。**

- B 能把效果图落地，且不破坏 Electron/导出/ACP。
- 如果后续确定要官方 AI Elements，可以在 B 的令牌基础上，把 AI 对话模块单独迁到 React，作为 A 的第一步。
- 不要在没有设计系统的情况下直接开始 React 重写。

---

## 6. 方案 B 目标架构

```text
css/
├── shadcn/
│   ├── tokens.css        # 颜色/字体/圆角/阴影/z-index
│   ├── base.css          # reset、排版、focus、滚动条
│   ├── components.css    # Button/Input/Dialog/Sheet/...
│   ├── patterns.css      # AI 消息/工具卡/计划/权限卡
│   └── overrides.css     # 旧类名兼容层
js/
├── ui/
│   ├── button.js         # 变体/尺寸/loading/disabled
│   ├── field.js          # label/hint/error
│   ├── select.js         # 原生 select 包装 + 键盘
│   ├── dialog.js         # 基于现有 MaskStack
│   ├── sheet.js          # 侧滑抽屉
│   ├── popover.js        # 锚点定位/点外关闭
│   ├── dropdown.js       # 菜单/分组/快捷键
│   ├── tabs.js           # 键盘左右切换
│   ├── toast.js          # 复用现有 showToast，统一外观
│   └── command.js        # 命令面板（可选）
└── ...
```

约束：

- 不改 `main/*`、`preload.js`、`main/ipc-contract.js`（仍 70 通道）。
- 不改 ACP 事件、权限桥、模型探测逻辑。
- iframe 预览内容不套 shadcn；只改宿主 chrome。
- 单文件导出必须内联新 CSS；不能依赖 CDN/外部字体。

---

## 7. 设计令牌

### 7.1 颜色

| Token | 值 | 用途 |
|---|---|---|
| `--background` | `#ffffff` | 页面背景 |
| `--canvas` | `#f4f4f5` | 舞台/画布 |
| `--chrome` | `#fafafa` | 顶栏/侧栏 |
| `--foreground` | `#09090b` | 主文字 |
| `--muted-foreground` | `#71717a` | 次要文字 |
| `--card` | `#ffffff` | 卡片 |
| `--popover` | `#ffffff` | 弹层 |
| `--primary` | `#18181b` | 主按钮 |
| `--primary-foreground` | `#fafafa` | 主按钮文字 |
| `--secondary` | `#f4f4f5` | 次级按钮 |
| `--muted` | `#f4f4f5` | 弱背景 |
| `--accent` | `#f4f4f5` | hover |
| `--destructive` | `#dc2626` | 危险 |
| `--border` | `#e4e4e7` | 边框 |
| `--input` | `#e4e4e7` | 输入边框 |
| `--ring` | `#18181b` | focus ring |
| `--cobalt` | `#2563eb` | ACP/强调 |
| `--emerald` | `#059669` | 成功 |
| `--amber` | `#d97706` | 警告 |
| `--rose` | `#e11d48` | 错误/删除 |

### 7.2 字体与字号

- 字体：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`
- 基础：13px / 1.5
- 按钮：12.5px / 500
- 小字/标签：11–12px
- 标题：14–16px / 600
- 代码/数字：`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

### 7.3 圆角/阴影/间距

- 圆角：4 / 6 / 10 / 14px
- 阴影：sm `0 1px 2px rgba(9,9,11,.05)`；md `0 4px 12px -2px rgba(9,9,11,.08)`；lg `0 16px 36px -8px rgba(9,9,11,.14)`
- 间距：4 / 8 / 12 / 16 / 24
- 顶栏 44px；按钮 30px；小按钮 26px；输入 30–32px
- focus ring：2px `--ring` + 2px offset

### 7.4 兼容策略

- 保留旧变量别名：`--panel` → `--card`，`--ink` → `--foreground`，`--line` → `--border`，`--pri` → `--cobalt`。
- 新 CSS 放旧 `app.css` 之后，按页面逐步替换；不要一次性删除旧样式。
- 旧 class 做别名，例如 `.docs-btn` 映射到 `.ui-btn .ui-btn-outline .ui-btn-sm`，迁移后再清理。

---

## 8. 组件落地清单

### 8.1 基础组件

| shadcn | PlanD 用途 | 落地方式 |
|---|---|---|
| Button | 全站按钮/图标按钮 | CSS 变体 + `js/ui/button.js` |
| Input / Textarea | 搜索、名称、API Key、提示词 | CSS + 原生元素 |
| Select | 模型、端别、目标页面、权限 | 原生 select + 自定义触发器 |
| Checkbox | 模型管理、Git 文件树 | 原生 input + CSS |
| Switch | ACP/权限/开关项 | 原生 checkbox + CSS |
| Badge | Agent/ACP/状态/数量 | CSS |
| Card | 设置分区、工具卡、快照 | CSS |
| Dialog | 设置、Git、新建、确认 | 复用 MaskStack + 新外观 |
| Sheet | AI 对话、检查器、多选、标注 | 复用 side-drawer + 新外观 |
| Popover | 模型级联、颜色、更多菜单 | 现有 popover + 定位 |
| DropdownMenu | Git/导出/更多 | CSS + `js/ui/dropdown.js` |
| Tabs | 设置、文档、Trace | CSS + 键盘 |
| Tooltip | 图标按钮/状态 | CSS + 延迟 |
| AlertDialog | 删除/覆盖/强制 | 复用 confirm modal |
| Toast | 全局提示 | 复用 showToast，统一外观 |
| Separator | 分区 | CSS |
| ScrollArea | 侧栏/消息/模型列表 | CSS overflow + 细滚动条 |
| Command | 命令面板（可选） | `js/ui/command.js` |
| Collapsible | 分组/折叠 | CSS + `details`/JS |
| Progress | 上下文/任务进度 | CSS |
| Skeleton / Spinner / Empty | 加载/空态 | CSS + 文案 |
| Sidebar | 左侧原型列表 | CSS 布局 |
| Resizable | 舞台/文档分栏 | CSS grid + drag handle |
| Table / Data Table | Git 文件树/模型管理 | CSS + 现有渲染 |

### 8.2 AI 对话模式（按 AI Elements 视觉）

| 模式 | PlanD 对应 |
|---|---|
| Chat / Message | 消息流、用户气泡、AI 气泡 |
| Reasoning | 思考块（可折叠） |
| Tool | 工具调用卡 |
| Plan | 计划/待办 |
| Confirmation | 权限请求卡 |
| Questionnaire | 问题/表单卡 |
| Model Selector | 模型 + 思考强度级联 |
| Prompt Input | 输入条 + 附件 + 发送/停止 |
| Terminal | 终端输出卡 |
| Context | 上下文用量 |
| Task / Queue | 计划/队列 |
| Trace | 执行日志 |
| Checkpoint | 快照/回滚 |

> 方案 B 只复刻这些模式的视觉与交互，不引入 React 组件代码。

---

## 9. 页面改造顺序

### Phase 0：基线与开关（1–2 天）

- 冻结效果图为视觉基线。
- 增加 `?ui=next` 或本地开关，新旧样式可切换。
- 截图基线：1440×1080、1024×768、600px 窄窗、缩放 50/85/100/125/150。
- 建立组件清单与 class 映射表。

### Phase 1：令牌与基础组件（3–5 天）

- 新增 `tokens.css`、`base.css`、`components.css`。
- 先改全局：背景、文字、边框、圆角、阴影、按钮、输入、滚动条、focus。
- 旧 class 别名兼容，不删旧样式。
- 验收：全站视觉无明显跳变；按钮/输入/弹层基本统一。

### Phase 2：主壳层（5–7 天）

- 顶栏：项目、端别、缩放、交互、标注、Git、终端、导出。
- 左侧原型列表：分组、子页、选中态、右键菜单、底部操作。
- 舞台：移动/PC、缩放、拾取提示、就地编辑、多选面板。
- 文档面板：Tab、目录、搜索、编辑/保存、导出。
- 响应式：600px 以下侧栏折叠、文档改 Sheet。
- 验收：主工作流无回归，快捷键正常。

### Phase 3：AI 对话（7–10 天）

- 会话列表、消息流、思考、工具卡、计划、权限卡、问题卡、代码块、错误卡、快照、输入条。
- 模型级联：模型 + 思考强度 + ACP 配置（`model_config` / `thought_level` / `mode`）。
- 模型加载/刷新状态、缓存提示、错误 detail。
- Trace 日志、独立窗口（已删除，不再做）。
- 验收：四 Agent 连通、权限/模型/思考选择全可用。

### Phase 4：设置与模型管理（5–7 天）

- 设置 6 个 Tab：Agent、模型管理、设计规范、沙箱、快捷键、关于。
- 模型管理：菜单只显示已选；获取模型弹窗显示全部；搜索不改勾选。
- API 配置弹窗、Git 仓库设置。
- 验收：模型勾选、ACP 开关、权限模式、Agent 徽标正常。

### Phase 5：浮层与协同（4–6 天）

- 元素检查器、标注抽屉、多选编辑、待提交列表、快照、Git 上传/拉取、导出菜单。
- 统一 Dialog/Sheet/Popover/Dropdown 的层级、焦点、Esc、遮罩。
- 验收：所有弹层键盘可操作，关闭/恢复状态正确。

### Phase 6：打磨（3–5 天）

- 空态/加载/错误态、Toast、Tooltip、快捷键提示。
- 对比度、焦点环、 reduced motion、窄窗。
- 删除旧 class 与重复 CSS，更新导出内联 CSS。
- 验收：视觉与效果图一致，63 项测试全绿，导出离线可用。

---

## 10. 交互与可访问性

- 所有按钮/输入/选项有可见 focus ring（2px `--ring`）。
- Dialog/Sheet：打开时 focus 首个可操作项，Tab 循环，Esc 关闭，关闭后焦点回到触发元素。
- Dropdown/Popover：方向键导航、Enter 选择、Esc 关闭、点外关闭。
- Tabs：左右箭头切换，Home/End 首尾。
- 表单：label 关联、错误提示 `aria-describedby`、必填标识。
- 颜色对比：正文/背景 ≥ 4.5:1；次要文字 ≥ 4.5:1（必要时加深）。
- `prefers-reduced-motion`：关闭非必要动画。
- 保留现有快捷键：Ctrl+单击、Ctrl+Enter、Esc 关闭栈、Ctrl+F 文档搜索等。

---

## 11. 测试与验收

### 11.1 功能回归

- `node tests/run-all.js` 全绿（当前 63）。
- `verify-ipc` 70 通道不变。
- ACP 四 Agent 冒烟：qoder / opencode / agy / codebuddy。
- 模型管理：菜单只显示已选；弹窗全量；搜索不改勾选。
- 思考强度：选中模型立即探测；MuseSpark 6 档；Xhigh 能下发。
- 权限卡/问题卡/计划/Trace/快照/导出。

### 11.2 视觉回归

- Playwright 截图：1440×1080、1024×768、600×900、缩放 50/100/150。
- 对比效果图：间距、字号、圆角、阴影、颜色、对齐。
- 覆盖：顶栏、侧栏、舞台、文档、AI、设置、Git、抽屉、Toast。

### 11.3 可用性

- 键盘全流程：打开弹窗 → Tab → Esc → 焦点回归。
- 200% 缩放不溢出、不遮挡。
- 窄窗 600px：侧栏折叠、文档 Sheet、输入条不挤压。
- 导出单文件：无外链、无 CDN、离线打开样式一致。

### 11.4 性能

- CSS 体积不高于当前 +15%。
- 首屏渲染不慢于当前 10%。
- 弹层打开/关闭 < 100ms（视觉感知）。
- 无 Tailwind runtime（方案 B）或按需构建（方案 A）。

---

## 12. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| shadcn 需要 React/Tailwind | 不能直接装到现有页面 | 先走 B；A 作为独立重写项目 |
| CSS 冲突/重复 | 样式错乱 | 新 CSS 后置 + 旧类别名；逐页替换 |
| z-index/弹层层级 | 遮挡/焦点错乱 | 统一 z-index token 与 MaskStack |
| iframe 预览 | 宿主样式渗透 | 只改宿主 chrome，iframe 内容不套 shadcn |
| 单文件导出 | 新 CSS/字体丢失 | 导出内联 tokens/components；禁止外部字体 |
| 测试依赖旧 class | 门禁红灯 | 保留别名，分阶段更新断言 |
| React 重写 | 功能回归 | 不在 B 中混入；A 单独分支/开关 |
| 设计漂移 | 越改越不统一 | 效果图 + token + 组件清单为单一基线 |
| 暗色模式 | 未在效果图覆盖 | 先 light，token 预留 `.dark`，后续单独验收 |

---

## 13. 工作量估算

| 方案 | 人力 | 周期 |
|---|---|---|
| B：令牌 + 组件外观 + 逐页替换 | 1 前端 + 0.5 QA | 4–6 周（约 20–25 人日） |
| A：React + Vite + Tailwind + shadcn 全量重写 | 2 前端 + 1 QA | 10–12 周（约 50–60 人日） |

方案 B 的分阶段投入：

- Phase 0–1：4–6 人日
- Phase 2：6–8 人日
- Phase 3：8–10 人日
- Phase 4–5：8–10 人日
- Phase 6：4–6 人日

---

## 14. 建议决策

1. **先执行方案 B**：用效果图的 token + 组件外观统一全站，保留 Electron/ACP/导出。
2. **Phase 1 完成后冻结旧样式新增**：所有新 UI 必须用新 token/组件。
3. **Phase 3 完成后再评估方案 A**：如果 AI Elements 的官方行为（Chat/Reasoning/Confirmation）确实必要，再单独把 AI 模块迁 React，而不是全站重写。
4. **不要直接运行 `shadcn init` 到当前项目**：没有 React/Tailwind 会失败或产生无效配置；方案 A 必须在独立 `src/renderer` 中做。
5. **以效果图为唯一视觉基线**：任何组件差异先改效果图/token，再改代码，避免实现与设计分叉。

---

## 15. 附录：方案 A 的落地命令（仅备查）

```bash
# 1. 新建 renderer
npm create vite@latest src/renderer -- --template react-ts
cd src/renderer

# 2. Tailwind v4
npm i tailwindcss @tailwindcss/vite
npm i -D @types/node

# 3. 配置 @ 别名、vite.config.ts、tsconfig
# 4. 初始化 shadcn
npx shadcn@latest init

# 5. 基础组件
npx shadcn@latest add button card dialog sheet tabs select input textarea checkbox switch badge tooltip dropdown-menu popover command alert-dialog sonner scroll-area separator skeleton spinner empty resizable sidebar collapsible progress

# 6. AI Elements 基础
npx shadcn@latest add trace code-block
# 再按需复制 Chat / Reasoning / Tool / Plan / Confirmation / Model Selector / Prompt Input / Terminal
```

当前项目不执行以上命令；仅作为方案 A 的参考。
