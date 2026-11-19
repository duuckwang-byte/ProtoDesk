# Wave4 B 全量体验 · 主壳 / 项目 / 侧栏 + 舞台 / 预览 / 移动端 报告

- 日期：2026-11-13
- Agent / owner：Wave4 B subagent（DeepSeek V4.1 Flash 1017）
- 阶段：B 全量体验
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（工作区含大量未提交改动，未 commit）
- 构建：`dist/renderer` 构建时间 **2026-11-13 16:49:04**
  - `dist/renderer/index.html` 1,261 B / SHA256 前 12 位 `F8B78205F9AC`
  - 主 chunk `dist/renderer/assets/index-B19X480y.js` 351,027 B / SHA256 前 12 位 `F0941FCB5F36`
  - **STALE-BUILD**：构建后 shell/docs 源码仍在变（`MiniDock.tsx` 16:59:34、`MainWindow.tsx` 16:59:49、`Topbar.tsx` 17:01:33、`Stage.tsx` 17:11:01、`DocsPanelHost.tsx` 17:36:58）。本轮所有结论均针对上述构建产物，不是当前工作区源码重新构建后的行为。
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`；真实 inner viewport 1123×640
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-shell-stage`；实际 `app.getPath('userData')` 精确相同（harness 启动断言通过）
- seed：`_wave4-seed.json` present；manifest SHA256 前 12 位 `C39C46EE629F`；seed 109 files / 1,110,299 B；seed 源指纹 `17ad3a89355d…`；运行前共享 `.devdata` 指纹已漂移为 `a1e7372730fc…`（复用 Phase 0 seed，未重建、未写共享 `.devdata`）
- 运行命令：
  - `node e2e/wave4/seed.mjs --domain b-shell-stage`
  - `npx playwright test e2e/wave4-b-shell-stage.spec.ts --workers=1 --output=test-results/wave4/b-shell-stage`
- 真实请求/网络：`AI_REQUESTS=0`；`GIT_NETWORK=0`；终端按钮使用主进程 stub，仅验证点击链路
- 结果：**1 passed / 0 failed，49.8s**；两段 Electron 启动均 `window-close` exit 0
- 收尾：`.devdata-wave4-b-shell-stage` 已删除；仅保留本报告与 `docs/wave4/shots/b-shell-stage/**`

## 0. 结论先行

**可放行（B 体验）；建议外发前修 P2-1 / P2-2。** P0=0，P1=0，P2=2，P3=3，ENV=2。

- 项目切换/搜索/新建/重命名/删除 Confirm/默认项目保护、侧栏真实 4 原型、无计数/无蓝色选中、文件夹三层（根/子文件夹/嵌套）、行内重命名 Esc+Enter、原型跨组/组内排序、子页排序/折叠/递归删除、原型新建/重命名/删除 Confirm、MiniDock 三入口、顶栏刷新/终端/文档/AI/Git/导出/设置、Esc 一次只关一层全部通过。
- 舞台：PC 50/75/100/125/custom 与移动端 全貌/适宽/100/125/custom 均通过；移动端顶栏与舞台读数五模式逐一相等（68/100/100/125/135）；壳内滚动、每模式位置记忆、小地图跳转、子页切换、刷新保持均通过。
- 两个 P2：① 移动端切回 PC 后侧栏与文档保持关闭，不恢复切移动前状态；② 在非当前原型上用「新建子页面」创建成功后，页面停留在原原型并显示红色错误「子页面不存在：xxx.html」。
- 构建产物里的 MiniDock 可用；但当前源码 `MiniDock.tsx` 已改为恒 `null`（16:59），重建后该 B 验收项会消失，需确认需求口径（见 ENV-2）。
- 4 个 seed 原型 HTML 全程 SHA256 不变；页面无 crash；排除 seed 原型内容噪声后致命 console/pageerror=0。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 | 冷启动 / 隔离 / 移动端自动收侧栏 / MiniDock | PASS | `userData` 与域目录精确一致、seed present；项目选择器未弹（自动恢复 测试1）；冷启动 `loc-pill=测试1 大厅 proj-scroll`、`kind=mobile`、`sidebar=0`、`mini-dock=可见`、`docs=0`；MiniDock 三入口（展开侧栏/AI 设计对话/设置）可见；从 MiniDock 展开侧栏，真实原型 4 个：首页 / 我的 / 大厅 / 需求管理，无示例/Demo 假数据。截图 `01-cold-start-mobile-minidock.png`、`01-sidebar-expanded.png` | — |
| 2 | 项目：切换 / 搜索 / 新建 / 重命名 / 删除 Confirm / 默认项目不可删 | PASS | 项目下拉 1 项「测试1 / 4 个原型 / data-current=true」；搜索「测试」=1、无匹配=0 且显示「无匹配项目」；新建「B4-项目」→ 舞台空态、侧栏「暂无原型」；切回测试1 → 4 原型；项目选择器重命名「B4-项目」→「B4-项目-改」，删除弹 AlertDialog（含项目名，不可恢复）→ 列表移除；「默认项目」删除按钮 `disabled`、title「「默认项目」不可删除」，直接 IPC `projectRemove` 返回「不可删除」。截图 `02-project-menu.png`、`02-project-search-empty.png`、`02-project-created-empty.png`、`02-project-switched-back.png`、`02-project-renamed.png`、`02-project-delete-confirm.png`、`02-default-project-protected.png` | — |
| 3 | 侧栏：真实原型 / 无计数 / 无蓝色选中 / 子页新建与切换 | PASS | 4 原型真实数据；选中「首页」：背景 `rgb(255,255,255)`、文字 `rgb(9,9,11)`、左侧墨条 `rgb(24,24,27)` / 3.0px，无蓝色、行文本仅原型名（无计数）；在首页下新建 B4-子页A / B4-子页B（创建后自动选中最新）；侧栏子页=2；舞台工具条含 主页/B4-子页A/B4-子页B；工具条切 A、主页回「猜你喜欢」、侧栏切 B，`loc-pill` 同步。截图 `03-proto-home-selected.png`、`03-subpages-created.png`、`03-subpage-switched.png` | — |
| 4 | 文件夹 / 三层拖拽 / 跨组 / 折叠 / 删除 Confirm | PASS | 新建 B4-文件夹A、B4-父；在 A 的 ⋯ 菜单新建子文件夹 B4-子（`C.parent=A`，形成文件夹三层）；B 拖到 A 前 → 根顺序 `B4-父 / B4-文件夹A`；A 双击 → Esc 保持原名 → 双击 → Enter 改「B4-文件夹A-改」；首页/我的拖入 A（`map` 命中）；组内拖拽排序 我的→首页（`protoOrder=我的,首页`）；首页跨组到 B；A（含 C/我的）拖入 B（`A.parent=B`，`C.parent=A`）；子页拖拽 B→A（`subPageOrder=B4-子页B.html,B4-子页A.html`）；折叠 B 后首页/A 隐藏，展开恢复；删除 B Confirm（提示原型会移到未分组、不删文件）→ A/C 一并移除、首页/我的回未分组、`groups.list=[]`、`map={}`，2 个子页仍在。截图 10 张（`04-*.png`） | — |
| 5 | PC 原型 / MiniDock / 刷新 / 终端 / 文档 / AI / Git / 导出 / 设置 / Esc | PASS | 新建「B4-PC原型」（PC 端）→ kind=pc、5 个原型；双击行内改「B4-PC原型-改」，`loc-pill` 同步；刷新后 5 行无重复、当前选择保持；MiniDock 三入口可见，AI/设置打开后 Esc 关闭，展开侧栏恢复；功能说明/最新需求均为 `docs-panel[data-variant=overlay]` 且对应 Tab `aria-selected=true`；AI/Git/导出 5 项/设置均开合；终端按钮 stub 调用=1、主窗仍在；Esc 栈 `AI/设置/文档` 状态为 `-/设置/文档 → -/-/文档 → -/-/-`，一次只关一层。截图 15 张（`05-*.png`） | — |
| 6 | 舞台 PC：50/75/100/125/custom / 内部滚动 / 外部不滚动 / 刷新 | PASS | PC 100% frame=853.5×530.6；50%=426.7×265.3、75%=640.1×397.9、125%=1066.9×663.2（与 100% 比值误差 ≤0.01）；125%→放大 135%（`data-zoom=1.35`、select=135）；125% 内部 `1069×665 > 850×527`，设置 scrollTop 后 138.6；外层 `docScrollHeight=640 / clientHeight=640`、滚轮后 `scrollY=0`；刷新后 PC 原型与 125% 保持。截图 `06-pc-100/50/125/custom-135/internal-scroll/after-refresh.png` | — |
| 7 | 舞台移动端：五模式 / 位置记忆 / 小地图 / 子页 / 刷新 | PASS | 适宽=100%（壳高 532.4≈可用高、壳内 `780/532`、minimap=on）；位置记忆 适宽 179.8 ↔ 100% 89.9 切回精确恢复；全貌=68%（375×780 等比、无滚动容器、无小地图）；125%=468.75×975 双轴滚动；custom=135%；小地图点击 0→447.8（`aria-valuenow=448`）；舞台工具条 子页A/主页/侧栏子页B 与 `loc-pill` 同步；刷新保持 `B4-子页B.html`；五模式读数 `overview=68% / fit-width=100% / 100=100% / 125=125% / custom=135%`，顶栏与舞台逐一相等。截图 8 张（`07-*.png`） | — |
| 8 | 移动端自动收侧栏/文档 / 切回 PC 的恢复 / PC 原型删除 | PASS（含 P2 观察） | PC 侧栏=1、文档=1、MiniDock=0 → 切移动端：sidebar=0、docs=0、mini-dock=1；切回 PC：**sidebar=0、docs=0、mini=1（未自动恢复）**；手动 MiniDock 展开+重开文档成功；删除 PC 原型 Confirm（提示不可撤销）→ 剩 4 个 seed 原型。截图 `08-pc-before-mobile.png`、`08-mobile-auto-collapse.png`、`08-back-to-pc.png`、`08-pc-proto-deleted.png` | P2-1 |
| 9 | 关闭重开：项目 / 缩放 / 端别与移动模式边界 | PASS | 关前 `protoLastProject=测试1`、`contentZoom=1.25`、移动模式 125%/125%；无 `stageKind` / `mobileViewMode` 持久化键；关进程（window-close exit 0）重开：不弹选择器、项目=测试1、源=大厅、kind=mobile、mode=fit-width、sidebar=0、mini-dock=1；切 PC 后缩放=125%（select=125，contentZoom 已持久化）；切回移动仍 fit-width（移动模式不持久化）。截图 `09-before-restart.png`、`09-reopened-mobile.png`、`09-reopened-pc-125.png` | P3-1 |
| 10 | console / pageerror / crash 汇总 | PASS（含 ENV） | 原始 console=13、pageerror=5、crash=0；全部为 seed 原型内容带来的 Vant CDN CSP 与内联脚本 `Unexpected token '.'`；排除后 fatal console=0、pageerror=0、crash=0。截图 `10-final.png` | ENV-1 |

> 补充复现（不在主 spec 步骤内）：第 11 张截图 `11-p2-subpage-noncurrent.png` 复现 P2-2。当前源=我的，打开首页 ⋯ →「新建子页面」B4-子页C，创建成功（toast「已新建子页面」），但舞台仍为 `我的.html`，侧栏顶部出现红色「子页面不存在：B4-子页C.html」，新子页只出现在首页下。

## 2. 缺陷（P0 / P1）

**无。P0=0，P1=0。**

- 未发现：项目/文件夹/原型操作失败、拖拽错组、折叠状态丢失、选中态蓝色或带计数、MiniDock 入口缺失（构建产物）、面板开合失败、Esc 一次关多层、PC/移动缩放读数不一致、壳内滚动导致外层滚动、位置记忆丢失、小地图跳转失效、子页/刷新白屏、应用崩溃或无法退出。
- `首页/我的/大厅/需求管理` 4 个 HTML 的 SHA256 全程与 seed 相同（`2D72B71839FC / 819DA56A7546 / 99D141ECAB94 / 25CA048D0461`）；所有写操作只发生在隔离副本。

## 3. P2 缺陷（按影响 × 频率排序）

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| b-shell-stage-P2-1 | P2 | **移动端切回 PC 后侧栏与文档不恢复**。切移动端会自动收侧栏/关文档；切回 PC 后两者保持关闭，MiniDock 仍在 | 1) PC 下展开侧栏并打开「功能说明」；2) 切移动端；3) 切回 PC | 用户回到 PC 后需手动点「展开侧栏」并重开文档；文档里未保存/正在看的内容上下文丢失。不阻断，有明确手动替代路径 | 切回后 `sidebar=0 / docs=0 / mini=1`；截图 `08-back-to-pc.png`；`Stage.tsx` 只在 `kind==='mobile'` 时执行 `setSidebarOpen(false)` + `closeDocs()`，未记录/恢复进入前状态 | 产品二选一：① 记录进入移动端前的 `sidebarOpen/docsOpen`，回 PC 时恢复；② 在验收口径中明确“单向收起”，并同步修改 B 清单「切回 PC 恢复」 |
| b-shell-stage-P2-2 | P2 | **在非当前原型上「新建子页面」后不切换，页面报「子页面不存在」**。子页创建成功，但当前源仍是旧原型 | 1) 选中「我的」；2) 悬停「首页」→ ⋯ → 新建子页面；3) 输入 B4-子页C 并确定 | 用户以为会进入新子页，实际仍停在旧页，并在侧栏顶部看到红色错误；需再点父原型才能预览。功能可完成，但路径有明显误导 | 创建后 `data-subfile=我的.html`；侧栏错误 `子页面不存在：B4-子页C.html`；toast 仍显示「已新建子页面 B4-子页C」；截图 `11-p2-subpage-noncurrent.png` | `createSubPage` 成功刷新后应按父原型重新选中（`loadSources(project, parentName)` 再 `selectSubPage(file)`），或在创建前先 `selectSource(parent)`；避免成功创建与“不存在”错误同时出现 |

## 4. 观察区（P3 / ENV）

| ID | 级别 | 现象 | 复现/证据 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- | --- |
| b-shell-stage-P3-1 | P3 | **端别与移动视口模式不持久化**：重开后 `kind` 由当前源端别重新推导，移动模式回默认「适宽」；项目与 `contentZoom` 持久化 | 关前 contentZoom=1.25、mode=125；重开 kind=mobile、mode=fit-width；无 `stageKind`/`mobileViewMode` 键；截图 `09-reopened-mobile.png`、`09-reopened-pc-125.png` | 否（设计边界） | B 要求“若设计支持”；当前设计只持久化项目与缩放，按 N/A 记录 |
| b-shell-stage-P3-2 | P3 | **文档 overlay 覆盖顶栏**：PC 文档打开时遮罩 `z-40` 覆盖整屏，顶栏设备切换被拦截；移动端“自动关文档”的鼠标路径实际不可达，需先 Esc 关文档 | PC 下打开文档后直接点「移动端舞台」被 `docs-overlay` 拦截；本轮用程序化 click 验证自动关闭（与 `wave4-mobile-viewport.spec.ts` 同口径）；截图 `08-pc-before-mobile.png` | 待确认 | 若文档按模态设计则合理；否则应允许顶栏在 overlay 之上，或提供设备切换快捷键 |
| b-shell-stage-P3-3 | P3 | **PC 舞台不“粘”**：切到 PC 后，再点任意移动端原型会按源端别回到移动舞台并自动收侧栏 | 步骤 7 从 PC 点「首页」后 `kind=mobile`、sidebar=0；属 `syncSelection` 的端别推导 | 否（设计口径） | 易被用户理解为“PC 开关失效”，建议在 UI 上明示“端别跟随原型”，或把 PC/移动作为仅本次预览的临时视图 |
| b-shell-stage-ENV-1 | ENV | **seed 原型内容自带 Vant CDN / 内联脚本噪声**：13 条 console（`cdn.jsdelivr.net/npm/vant@4` 被 CSP 拒绝）+ 5 条 `pageerror: Unexpected token '.'`；“大厅/需求管理”在 CSP 下渲染为空白，冷启动当前源恰为大厅，故冷启动截图舞台为空白 | 原始 console=13、pageerror=5、crash=0；过滤后 0；截图 `01-cold-start-mobile-minidock.png`（大厅空白）、`09-reopened-pc-125.png`（大厅 PC 空白） | 否 | 与 `b-pick` 的 `b-pick-ENV-prototype-console` 同源；非 shell/stage 产品链路，切换到「首页」后舞台正常 |
| b-shell-stage-ENV-2 | ENV | **STALE-BUILD / MiniDock 需求口径冲突**：构建 16:49 仍渲染 MiniDock 并通过；当前源码 `MiniDock.tsx` 16:59 已改为恒 `null`，`Stage/DocsPanelHost` 等也在构建后继续修改 | `dist` 构建 16:49:04；源码 mtime 16:59–17:36；构建产物实测 MiniDock 三入口可用 | 需协调者确认 | 重新构建后必须复测「收起→MiniDock」及文档/移动端步骤；若 MiniDock 确已下线，B 验收清单应删除该项或改为“顶栏侧栏开关” |

## 5. 截图

目录：`docs/wave4/shots/b-shell-stage/`（60 张；59 张来自最终通过轮次，`11-*` 为补充复现）

| 步骤 | 文件 |
| --- | --- |
| 1 冷启动 / MiniDock | [`01-cold-start-mobile-minidock.png`](../shots/b-shell-stage/01-cold-start-mobile-minidock.png)、[`01-sidebar-expanded.png`](../shots/b-shell-stage/01-sidebar-expanded.png) |
| 2 项目 | [`02-project-menu.png`](../shots/b-shell-stage/02-project-menu.png)、[`02-project-search-empty.png`](../shots/b-shell-stage/02-project-search-empty.png)、[`02-project-created-empty.png`](../shots/b-shell-stage/02-project-created-empty.png)、[`02-project-switched-back.png`](../shots/b-shell-stage/02-project-switched-back.png)、[`02-project-renamed.png`](../shots/b-shell-stage/02-project-renamed.png)、[`02-project-delete-confirm.png`](../shots/b-shell-stage/02-project-delete-confirm.png)、[`02-default-project-protected.png`](../shots/b-shell-stage/02-default-project-protected.png) |
| 3 侧栏 / 子页 | [`03-proto-home-selected.png`](../shots/b-shell-stage/03-proto-home-selected.png)、[`03-subpages-created.png`](../shots/b-shell-stage/03-subpages-created.png)、[`03-subpage-switched.png`](../shots/b-shell-stage/03-subpage-switched.png) |
| 4 文件夹 / 三层拖拽 | [`04-folders-created.png`](../shots/b-shell-stage/04-folders-created.png)、[`04-folder-rename-esc.png`](../shots/b-shell-stage/04-folder-rename-esc.png)、[`04-folder-rename-enter.png`](../shots/b-shell-stage/04-folder-rename-enter.png)、[`04-proto-dragged-into-folder.png`](../shots/b-shell-stage/04-proto-dragged-into-folder.png)、[`04-proto-reordered.png`](../shots/b-shell-stage/04-proto-reordered.png)、[`04-folder-nested.png`](../shots/b-shell-stage/04-folder-nested.png)、[`04-subpage-reordered.png`](../shots/b-shell-stage/04-subpage-reordered.png)、[`04-folder-collapsed.png`](../shots/b-shell-stage/04-folder-collapsed.png)、[`04-folder-expanded.png`](../shots/b-shell-stage/04-folder-expanded.png)、[`04-folder-deleted-ungrouped.png`](../shots/b-shell-stage/04-folder-deleted-ungrouped.png) |
| 5 PC 原型 / MiniDock / 顶栏 | [`05-pc-proto-created.png`](../shots/b-shell-stage/05-pc-proto-created.png)、[`05-pc-proto-renamed.png`](../shots/b-shell-stage/05-pc-proto-renamed.png)、[`05-refreshed.png`](../shots/b-shell-stage/05-refreshed.png)、[`05-mini-dock.png`](../shots/b-shell-stage/05-mini-dock.png)、[`05-minidock-ai.png`](../shots/b-shell-stage/05-minidock-ai.png)、[`05-minidock-settings.png`](../shots/b-shell-stage/05-minidock-settings.png)、[`05-docs-desc.png`](../shots/b-shell-stage/05-docs-desc.png)、[`05-docs-latest.png`](../shots/b-shell-stage/05-docs-latest.png)、[`05-ai-panel.png`](../shots/b-shell-stage/05-ai-panel.png)、[`05-git-panel.png`](../shots/b-shell-stage/05-git-panel.png)、[`05-export-menu.png`](../shots/b-shell-stage/05-export-menu.png)、[`05-settings-panel.png`](../shots/b-shell-stage/05-settings-panel.png)、[`05-terminal-stub.png`](../shots/b-shell-stage/05-terminal-stub.png)、[`05-esc-stack-before.png`](../shots/b-shell-stage/05-esc-stack-before.png)、[`05-esc-stack-after-1.png`](../shots/b-shell-stage/05-esc-stack-after-1.png) |
| 6 舞台 PC | [`06-pc-100.png`](../shots/b-shell-stage/06-pc-100.png)、[`06-pc-50.png`](../shots/b-shell-stage/06-pc-50.png)、[`06-pc-125.png`](../shots/b-shell-stage/06-pc-125.png)、[`06-pc-custom-135.png`](../shots/b-shell-stage/06-pc-custom-135.png)、[`06-pc-internal-scroll.png`](../shots/b-shell-stage/06-pc-internal-scroll.png)、[`06-pc-after-refresh.png`](../shots/b-shell-stage/06-pc-after-refresh.png) |
| 7 舞台移动端 | [`07-mobile-fit-width.png`](../shots/b-shell-stage/07-mobile-fit-width.png)、[`07-mobile-100.png`](../shots/b-shell-stage/07-mobile-100.png)、[`07-mobile-overview.png`](../shots/b-shell-stage/07-mobile-overview.png)、[`07-mobile-125.png`](../shots/b-shell-stage/07-mobile-125.png)、[`07-mobile-minimap-jump.png`](../shots/b-shell-stage/07-mobile-minimap-jump.png)、[`07-mobile-custom-135.png`](../shots/b-shell-stage/07-mobile-custom-135.png)、[`07-mobile-subpage.png`](../shots/b-shell-stage/07-mobile-subpage.png)、[`07-mobile-after-refresh.png`](../shots/b-shell-stage/07-mobile-after-refresh.png) |
| 8 自动收起 / 切回 PC / 删除 | [`08-pc-before-mobile.png`](../shots/b-shell-stage/08-pc-before-mobile.png)、[`08-mobile-auto-collapse.png`](../shots/b-shell-stage/08-mobile-auto-collapse.png)、[`08-back-to-pc.png`](../shots/b-shell-stage/08-back-to-pc.png)、[`08-pc-proto-deleted.png`](../shots/b-shell-stage/08-pc-proto-deleted.png) |
| 9 关闭重开 | [`09-before-restart.png`](../shots/b-shell-stage/09-before-restart.png)、[`09-reopened-mobile.png`](../shots/b-shell-stage/09-reopened-mobile.png)、[`09-reopened-pc-125.png`](../shots/b-shell-stage/09-reopened-pc-125.png) |
| 10 收尾 | [`10-final.png`](../shots/b-shell-stage/10-final.png) |
| 补充 P2-2 | [`11-p2-subpage-noncurrent.png`](../shots/b-shell-stage/11-p2-subpage-noncurrent.png) |

关键截图：

![侧栏真实三层树：主页子页 + 文件夹嵌套](../shots/b-shell-stage/04-folder-nested.png)

![MiniDock 三入口](../shots/b-shell-stage/05-mini-dock.png)

![移动端 125%：顶栏/舞台读数一致，壳内滚动](../shots/b-shell-stage/07-mobile-125.png)

![切回 PC 后侧栏/文档未恢复（P2-1）](../shots/b-shell-stage/08-back-to-pc.png)

![非当前原型新建子页报错（P2-2）](../shots/b-shell-stage/11-p2-subpage-noncurrent.png)

## 6. 结论

- 结果：**可放行（B 体验）；建议外发前修 P2-1 / P2-2**
- P0 = 0；P1 = 0；P2 = 2（b-shell-stage-P2-1/2）；P3 = 3；ENV = 2
- 阻断项：无
- P2 owner / 挂账：
  - P2-1 建议归 `components/shell/MainWindow` + `stores/app-store`（进入移动端前记录并回 PC 恢复 `sidebarOpen/docsOpen`）。
  - P2-2 建议归 `features/projects/proto-actions.createSubPage`（创建后按父原型刷新并选中子页，或先切父原型）。
- 复测范围：`e2e/wave4-b-shell-stage.spec.ts` 单文件单 worker，1 passed / 49.8s；两段 Electron 均 `window-close` exit 0（首段 3053ms、末段 295ms）；4 个 seed HTML hash 不变；排除原型内容噪声后致命 console/pageerror/crash=0。
- 备注：
  - 本轮未修改 `src/**`、`main/**`、`tests/**`、`package.json`，未 commit；只新增 `e2e/wave4-b-shell-stage.spec.ts`、本报告与 `docs/wave4/shots/b-shell-stage/**`。
  - **复测前必须重新构建**：当前 `dist` 为 16:49，而 shell/docs 源码在 16:59–17:36 仍在修改；MiniDock 相关结论只对 16:49 构建成立。
  - 复跑前执行 `node e2e/wave4/seed.mjs --domain b-shell-stage`；本轮结束后已清理 `.devdata-wave4-b-shell-stage`。
  - 冷启动/重开截图中「大厅」舞台空白是 seed 原型外部 Vant CDN 被 CSP 拦截（ENV-1），不是 Stage 白屏；切到「首页」即正常。
