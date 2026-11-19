# Wave3 真操作功能验收报告

- 日期：2026-11-12
- 项目：`D:\文件\工具\原型工具-PlanD`
- 渲染器：React（`PLAND_RENDERER=react`）
- 环境：Electron 37.10.3 / Playwright 1.65.0 / Windows
- 构建前置：`npm run build:renderer` ✅（Vite 产物 `dist/renderer` 构建成功）
- 测试数据：项目「测试1」，原型「首页」「我的」；**未新建、未删除、未修改任何业务数据**
- 验收脚本：`e2e/electron-functional.spec.ts`
- 运行命令：

```bash
npx playwright test e2e/electron-functional.spec.ts
```

- 最终结果：**1 passed (12.3s)**，9 个步骤全部 PASS，console error 0 条；P1 移动端文档遮挡已修复并复测通过。

---

## 一、结果总览

| # | 真操作 | 结果 | 关键证据 | 截图 |
|---|---|---|---|---|
| 1 | 冷启动 + 项目选择 | PASS | `main-window`/`topbar`/`sidebar`/`stage-frame` 可见；本次冷启动未出现项目选择器，自动恢复上次项目「测试1」 | `01-main-window.png`（选择器证据保留：`01-project-picker.png`） |
| 2 | 侧栏真实数据 + 点第一个原型 | PASS | 侧栏 2 个原型：**首页 / 我的**（无「示例」文案）；点击「首页」，面包屑=`测试1 首页 —` | `02-sidebar.png` |
| 3 | 预览 iframe / srcdoc | PASS | iframe 数量=1；`srcdoc` 长度=**17423**；iframe body 文本长度=**292**（首页/分类/秒杀/我的1/活动/猜你喜欢…） | `03-preview.png` |
| 4 | 移动端 375×780 | PASS | `stage-frame[data-kind=mobile]`；`stage-viewport` 逻辑尺寸=**375px×780px**（自适应 60%，屏幕渲染 224×465） | `04-mobile-375x780.png` |
| 5 | 文档面板 + 最新需求 | PASS | `docs-panel` 可见；功能说明正文 **3786 字**；最新需求正文 **8 字**（`11121321`）；移动端「最新需求」Tab **直接点击成功**（P1 已修复） | `05-docs-desc.png`、`05b-docs-mobile-fixed.png`、`05-docs-latest.png`（修复前：`05-docs-mobile-overlap.png`） |
| 6 | 设置 6 Tab + Agent 数据 | PASS | 6 Tab：Agent / 模型 / 设计规范 / 沙箱 / 快捷键 / 关于；Agent **真实行 26 个**；无 `DEFAULT_AGENTS` 假数据文案 | `06-settings-agent.png` |
| 7 | 导出菜单 + 源码包 | PASS* | 5 个菜单项；Playwright `download` 事件未触发，但主进程重定向后文件真实落盘 **22343 bytes**，toast=`源码包已导出。` | `07-export-menu.png`、`07-export-source-toast.png`、`07-export-source-result.png` |
| 8 | AI 对话模型列表 | PASS | `ai-dialog` 可见；2 个模型级联选择器；当前模型=`opencode-go/deepseek-v4.1-flash`；可选模型 **2 个**；**未发送消息** | `08-ai-model-list.png`、`08-ai-dialog.png` |
| 9 | 关闭进程 | PASS | 主进程 `exit:0`；退出耗时 **374ms**（远小于 15s 上限） | `09-before-close.png` |

\* 步骤 7 的附加说明见下文「缺陷与观察项」，主验收目标均已达成。

---

## 二、逐项证据明细

### 1. 冷启动 / 项目选择

- 启动后 `[data-testid=main-window]`、`topbar`、`sidebar`、`stage-frame` 全部可见。
- 本次运行冷启动**未出现**项目选择器，应用自动恢复上次项目「测试1」；脚本对「选择器出现 → 选择进入」与「自动恢复」两条路径均已兼容。
- 当前项目=「测试1」。

### 2. 侧栏真实数据

- `sidebar` 内 `button[data-level=proto]` 数量=**2**。
- 可见原型名：**首页、我的**；均来自 `.devdata/sandbox/测试1` 的真实目录，不含「示例」占位文案。
- 点击第一个原型「首页」后，`stage-frame[data-has-source=1]`，面包屑显示 `测试1 首页 —`。

### 3. 预览

- `[data-testid=stage-frame]` 内 `[data-testid=preview-frame]` iframe 存在且唯一。
- `srcdoc` 长度 **17423**（包含安全桥注入），非空。
- 通过 `frameLocator` 读取 iframe body 文本长度 **292**，内容为商城首页真实页面文案，预览确实渲染。

### 4. 移动端舞台

- 点击顶栏「移动」后，`stage-frame` 的 `data-kind` 变为 `mobile`。
- `[data-testid=stage-viewport]` 内联样式宽度/高度分别为 **375px / 780px**；因窗口自适应缩放 60%，屏幕渲染尺寸为 224×465，逻辑尺寸正确。

### 5. 文档

- 点击顶栏「文档」后 `[data-testid=docs-panel]` 可见，「功能说明」Tab 存在。
- 功能说明正文长度 **3786**，首行为「商城首页 — 产品需求文档 (PRD)」。
- 切「最新需求」后正文长度 **8**，内容 `11121321`（对应沙箱 `最新需求.md`），非空。
- **移动端形态下（修复后）**：「最新需求」Tab 可直接点击，`aria-selected=true`；命中测试确认 Tab 中心点的 `elementFromPoint` 落在 `[data-testid=docs-panel]` 内部、未被 `[data-testid=overlays-toolbar]` 拦截。复测截图 `05b-docs-mobile-fixed.png`。
- 修复前证据保留：`05-docs-mobile-overlap.png`（工具栏覆盖文档面板右半侧，Tab 点击超时）。
- PC 悬浮文档面板分支未改动，Tab 切换正常。
- 收尾按 Esc 关闭文档面板成功。

### 6. 设置

- `settings-dialog` 可见，`role=tab` 数量 **6**：Agent / 模型 / 设计规范 / 沙箱 / 快捷键 / 关于。
- Agent 区真实数据：**26 行**（opencode、deepseek-harness、codebuddy、antigravity、qoder、claude、cursor-agent、codex、qwen、deepseek、mimo、amp、aider、grok-build、atomcode、amr、copilot、devin、hermes、kilo、kimi、kiro、pi、reasonix、trae-cli、vibe）。
- 校验 `settings-dialog` 文本不含 `DEFAULT_AGENTS`，也不含「示例 Agent」占位文案。
- 设置加载态 `settings-loading` 正常消失，无 `settings-error`。

### 7. 导出

- 导出菜单 5 项全部可见：
  - 导出源码包（JSON）
  - 导出独立 HTML（单文件离线）
  - 导出文档长图（PNG）
  - 导出文档（PDF）
  - 导出文档（Markdown）
- 点击「导出源码包（JSON）」后：
  - Playwright `page` 的 `download` 事件**未触发**（Electron + Playwright 的已知限制）。
  - 测试在主进程注册 `will-download` 并重定向到临时目录，文件真实落盘：**22343 bytes**。
  - toast 捕获到「源码包已导出。」，无致命 console error。
- 进一步校验落盘 JSON 内容：
  - `project: "测试1"`
  - `sources.length: 2`
  - `首页.html`：`contentLen=10980`，`mdLen=3780`
  - `我的.html`：`contentLen=418`，`mdLen=64`
- 结论：导出动作与产物均真实可用；`download` 事件缺失属于测试框架限制，不判为应用缺陷。

### 8. AI 对话

- 点击顶栏「AI 对话」后 `ai-dialog` 可见。
- 页面存在 **2 个** `ai-model-selector` 级联（顶部/底部），与设计一致。
- 当前模型显示 `opencode-go/deepseek-v4.1-flash`（来自 settings-store / ai 配置）。
- 展开模型下拉后可选模型 **2 个**：
  - `opencode-go/DeepSeek V4.1 Flash 1017`
  - `opencode-go/Muse Spark 1.3 Contributor`
- **未在输入框输入、未发送任何消息**；仅打开/收起下拉并截图。

### 9. 关闭与进程退出

- 通过 `window.close()` 走真实关窗路径（`window-all-closed → app.quit`）。
- 主进程 `exit` 事件在 **374ms** 内到达，退出码 **0**，满足 15s 断言。

---

## 三、Console Error 清单

- console error 总数：**0**
- fatal console error：**0**
- `pageerror`：**0**

本轮未出现 favicon、第三方脚本、React 警告或预览 iframe 报错。

---

## 四、缺陷与观察项

### P1（已修复）：移动端文档面板「最新需求」Tab 被预览浮层工具栏遮挡

- **复现路径**：顶栏切「移动」→ 点「文档」→ 尝试点文档面板中的「最新需求」。
- **现象**：`[data-testid=overlays-toolbar]`（预览浮层的「标注/快照/检查器/链接/多选/就地改」工具栏，`fixed right-3 top-14 z-50 w-36`）覆盖文档面板右侧，导致「最新需求」Tab 无法接收点击；Playwright 报 pointer interception，用户视角为点击无响应。
- **影响**：移动端无法从「功能说明」切换到「最新需求」，PC 端不受影响；文档面板其余功能（正文、TOC、编辑入口）正常。
- **修复前证据**：`docs/wave3-functional-shots/05-docs-mobile-overlap.png`（截图中「最新需求」位置被工具栏完全覆盖）。
- **根因**：移动端 `DocsPanelHost` 行内 `<aside>` 处于普通 Flex 流，未建立定位层级；`PreviewOverlaysHost` 的工具栏为 `position:fixed + z-50`，在根层叠上下文中压过文档面板。
- **修复**：`src/renderer/components/shell/DocsPanelHost.tsx` 的移动端 inline 分支加 `relative z-50`，与工具栏同级但 DOM 树序在 Stage 之后，文档层稳定压过工具栏；工具栏仍保留在 DOM，关闭文档面板后恢复可用。未改 `PreviewOverlaysHost`/Stage/PreviewFrame/iframe 协议；PC 悬浮分支未改。
- **复测**：`npx tsc --noEmit` ✅；`npx playwright test e2e/electron-functional.spec.ts e2e/docs.spec.ts e2e/preview.spec.ts` → **27 passed / 3 skipped**；`npx vitest run` → **187 passed**；步骤 5 移动端 Tab 由「被遮挡后切 PC」变为「直接成功」。复测截图 `docs/wave3-functional-shots/05b-docs-mobile-fixed.png`。补充检查：PC 悬浮文档前后舞台宽度 **887→887**（不挤压）、PC「最新需求」可点；关闭移动端文档后 `overlays-toolbar` 命中恢复正常。

### P2（观察项）：冷启动「上次项目自动恢复」偶发不稳定

- 试运行中曾直接恢复「测试1」；最终运行冷启动弹出项目选择器。两条路径均能进入「测试1」，不阻断使用。
- 可能与窗口快速关闭时 `localStorage` 尚未落盘有关（退出耗时仅约 0.4s）。若产品要求稳定的“上次项目恢复”，建议在进入项目后显式等待写入完成或延长关窗落盘窗口。
- 本轮未复现数据丢失，仅记录现象，暂不阻断验收。

### 观察项（未定级）：AI 历史会话存在“模型不被该 Agent 支持”的旧失败文案

- `08-ai-dialog.png` 中可见历史消息「发送失败：当前模型不被该 Agent 支持…」。
- 本轮按任务要求**未发送消息**，无法判定该失败是历史配置残留还是当前模型兼容问题；不计入本轮缺陷等级，建议产品侧确认 `opencode-go/deepseek-v4.1-flash` 与当前 opencode Agent 的兼容性。

### 非缺陷：Playwright `download` 事件缺失

- Electron + Playwright 下 `page.waitForEvent('download')` 未触发；主进程 `will-download` 重定向后文件已真实落盘且 JSON 内容正确。
- 属自动化测试框架限制，不是应用导出缺陷；报告中按“文件落盘 + toast”作为更强证据判定 PASS。

---

## 五、结论

**功能整体可用。**

- PC 主路径（冷启动 → 侧栏 → 预览 → 文档 → 设置 → 导出 → AI → 退出）全部真实操作通过，无 P0 缺陷。
- 真实数据接线正确：侧栏 2 个真实原型、文档正文 3786 字、最新需求 8 字、Agent 26 行、模型 2 个、导出 JSON 2 个源且内容完整。
- 进程退出干净（exit 0，374ms）。
- **原唯一阻断级发现 P1（移动端文档「最新需求」Tab 被预览浮层工具栏遮挡）已修复并复测通过**；PC 端与移动端其他功能不受影响。
- P2 观察项为冷启动上次项目恢复偶发不稳定，以及 AI 历史会话的模型兼容失败文案，建议排期确认。

---

## 六、复跑方式

```bash
npm run build:renderer
npx playwright test e2e/electron-functional.spec.ts
```

截图输出目录：`docs/wave3-functional-shots/`

最终运行摘要（原始输出）：

```text
[functional] STEP 1 PASS 冷启动 / 项目选择 | 项目选择器=未出现（自动恢复上次项目）；当前项目=「测试1」
[functional] STEP 2 PASS 侧栏真实数据 / 点击原型 | 原型数=2；名称=首页 / 我的；已点击「首页」
[functional] STEP 3 PASS 预览 iframe / srcdoc | srcdoc 长度=17423；iframe body 文本长度=292
[functional] STEP 4 PASS 移动端 375×780 舞台 | 逻辑尺寸=375px×780px
[functional] STEP 5 PASS 文档面板 / 最新需求 | 功能说明=3786 字；最新需求=8 字；移动端 Tab 点击=直接成功
[functional] STEP 6 PASS 设置 6 Tab / Agent 数据 | 6 Tab；Agent 真实行=26；DEFAULT_AGENTS 检查通过
[functional] STEP 7 PASS 导出菜单 / 源码包下载 | 5 菜单项；落盘=22343 bytes；toast=源码包已导出。
[functional] STEP 8 PASS AI 对话 / 模型列表 | 当前模型=opencode-go/deepseek-v4.1-flash；可选模型=2；未发送消息
[functional] STEP 9 PASS 关闭进程 / 退出耗时 | exit:0；374ms
[functional] CONSOLE_ERRORS_TOTAL=0
[functional] CONSOLE_ERRORS_FATAL=0

1 passed (12.3s)
```
