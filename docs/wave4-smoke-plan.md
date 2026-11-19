# Wave4 真机模拟冒烟 + 全量体验执行矩阵

- 日期：2026-11-13
- 项目：`D:\文件\工具\原型工具-PlanD`
- 状态：**只读规划**。本文件是唯一产出；未启动 Electron、未改业务代码、未执行 `npm install`、未 commit。
- 依据：`docs/wave3-functional-report.md`、`docs/final-gate-report.md`、`docs/ai-streaming-diagnosis.md`、`e2e/*.spec.ts`、`src/renderer` 主要 feature 入口。
- 适用：React 渲染器（`PLAND_RENDERER=react`）+ 开发态 `_electron` 真机。legacy 只做回退 sanity，不进 8 域主矩阵。

---

## 0. 一页结论

本轮把真机验证拆成 **8 个功能域**，分 **A 冒烟**、**B 全量体验** 两阶段执行；A 只报 P0/P1 功能阻断，B 在 A 修复并通过复测后启动，按 P2 优先级排序体验问题。

| 项 | 结论 |
| --- | --- |
| 功能域 | AI 对话；Ctrl 拾取/就地编辑/多选；文档查看与交互；主壳/项目/侧栏；舞台/预览/移动端；设置/模型/Agent；Git；导出/标注/快照/链接 |
| 执行隔离 | 每个域一个 `PLAND_DEV_DATA_DIR` 副本；每域独立 Electron 进程、独立 Playwright 输出、独立截图/报告目录 |
| 并发上限 | 常规 3 个 Electron 实例；UI 并行开发占用机器时降到 2 |
| 独占通道 | `AI-LIVE`（AI 真实发送）、`GIT-WRITE`（Git 写/网络）、`DOC-WIN`（文档独立窗）；三者之间严格串行 |
| 硬前置 | UI 冻结并统一 `build:renderer`；`PLAND_DEV_DATA_DIR` 可用并在启动后校验 `app.getPath('userData')`；seed 副本就绪；AI Agent/模型配对预检；Git 本地 bare 远程就绪 |
| 静态预判风险 | ① React 侧未检索到 `Ctrl+F` 的 keydown 绑定，仅 `ShortcutTab.tsx:25` 声明了该快捷键；② 现有 `.devdata/ai-config.json` 的 Agent 与模型可能不匹配；③ Electron + Playwright 下 `page` 的 `download` 事件不可靠，需主进程 `will-download` 重定向 |

> 说明：本文中的具体数字（Agent 26 行、文档 3353 字、模型 7 个等）是当前 seed 的实测基线。执行时以“不变量”判定（如 Agent 行数 ≥ 10、文档正文 > 3000 字），不要把数字写死成回归断言。

---

## 1. 基线与判级

### 1.1 当前基线（final-gate，执行前重跑一次）

| 门禁 | 当前结果 |
| --- | --- |
| `npx tsc --noEmit` | PASS，exit 0 |
| `npx vitest run` | 14 文件 / 250 passed / 0 failed |
| `npx playwright test` | 93 passed / 10 skipped / 0 failed（workers=1） |
| `node tests/run-all.js` | 64/64（core 38 + legacy-ui 26） |
| `npm run build:renderer` | PASS |
| `npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts` | 4 passed（live 2 + functional 2） |

Wave3 九步真机路径（冷启动 → 侧栏 → 预览 → 移动端 → 文档 → 设置 → 导出 → AI 只读 → 退出）已 PASS；本轮不是重复九步，而是按域加深“真实操作 + 真实写入 + 真实失败路径”。

### 1.2 缺陷级别

| 级别 | 定义 | A 阶段处理 |
| --- | --- | --- |
| **P0** | 崩溃、白屏、数据损坏/丢失、项目无法进入、进程无法退出、整域不可用 | 立即停止该域；全局阻断 |
| **P1** | 核心用户路径不可用或结果错误，且没有可用替代路径 | A 阻断，必须修复 + 复测 |
| **P2** | 局部功能异常、状态不对、明显体验问题，但有替代路径 | A 只记录，不阻断；B 优先排序 |
| **P3** | 文案、像素、间距、图标、动效、排序、提示语、轻微延迟 | A 不记录到阻断表；B 末尾处理 |
| **ENV** | 环境/配额/网络/远程仓库/Agent 未安装等非产品问题 | 不计缺陷，标 `ENV-BLOCKED` 并说明证据 |

A 阶段明确过滤：文案错别字、1–2px 间距、颜色差异、图标风格、动画时长、toast 措辞、非阻断的排序偏好、<300ms 的视觉延迟。只有“功能不可用 / 结果错误 / 数据风险”才进入 A 缺陷表。

### 1.3 阶段门槛

| 阶段 | 入口条件 | 覆盖 | 出口条件 |
| --- | --- | --- | --- |
| **A 冒烟** | UI 冻结；`dist/renderer` 与源码一致；8 个数据目录 seed 完成；无其他 Electron 占用 `.devdata` | 8 域核心路径；每域 3–8 步；只判 P0/P1 | 8 份域报告；P0=0 且 P1=0；致命 console error=0；进程均 exit 0 |
| **B 全量体验** | **A 的 P0/P1 已修复并复测通过**；A 报告签字 | A 全路径 + P2/P3 + 视口/键盘/空态/错误态/长内容/重启持久化 | P0/P1=0；P2 已分级、有 owner/挂账结论；P3 有 backlog；给出可放行/需修复结论 |

### 1.4 证据标准

每步至少一种强证据，禁止只写“看起来正常”：

- 截图：`docs/wave4/shots/<domain>/<NN>-<slug>.png`；失败追加 `-FAIL.png`。
- DOM：testid + 可见文本 + 数量（如 `[data-slot="ai-message-ai"]` 数量、`overlays-selection-count` 文本）。
- 文件：绝对路径 + 字节数 + `Get-FileHash -Algorithm SHA256` 前 12 位；导出文件校验魔数/JSON 可解析。
- IPC/主进程：`app.evaluate` 读取 `app.getPath('userData')`、`git log`、`ipcMain` 调用计数。
- Console：保留原始 error 文本；过滤 favicon/third-party/devtools/ResizeObserver/autofill 后统计致命项。
- AI：真实请求次数、首次/末次事件时间、流式采样点、气泡数量与文本长度。

---

## 2. 环境隔离与通用数据前置

### 2.1 `PLAND_DEV_DATA_DIR` 语义（当前工作树已支持）

`main.js:14-29` 已实现：

- 仅开发态（`!app.isPackaged`）生效；打包态忽略，行为不变。
- 值可为绝对路径；相对路径以仓库根目录（`__dirname`）为基准。
- 目录不可用时静默回退 `.devdata`——**这是并行测试最大的风险**，必须用启动后断言兜底。

每个 spec 的 harness 必须做三件事：

1. 启动前要求 `process.env.PLAND_DEV_DATA_DIR` 非空，否则直接 FAIL，禁止落到共享 `.devdata`。
2. 启动后 `app.evaluate(({ app }) => app.getPath('userData'))`，与期望目录 `path.resolve` 比较，不一致立即退出。
3. 报告头记录实际 userData 路径 + `git rev-parse HEAD` + `dist/renderer` 构建时间。

### 2.2 通用 seed

`.devdata` 约 12 MB，可直接整份复制；复制前必须关闭所有 Electron/开发实例，避免 LevelDB 锁。

```powershell
$root = Join-Path $env:TEMP "pland-wave4"
$seed = Join-Path $root "seed"
Remove-Item $seed -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $seed | Out-Null
Copy-Item ".devdata\*" $seed -Recurse -Force
# 清掉 Chromium 缓存/单例锁，保留 Local Storage、sandbox、snapshots、配置
foreach ($d in @("Cache","GPUCache","Code Cache","DawnGraphiteCache","DawnWebGPUCache","Shared Dictionary","blob_storage","Network")) {
  Remove-Item (Join-Path $seed $d) -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem $seed -Force | Where-Object { $_.Name -match '^(Singleton|DevToolsActivePort|lockfile)' } | Remove-Item -Force -ErrorAction SilentlyContinue
```

seed 包含：

- 项目 `测试1`，原型 `首页`（移动端 kind、PRD、2 条标注、2 条链接）与 `我的`。
- `首页.md`（>3000 字、Markdown 表格 ≥4）、`最新需求.md`（`11121321`，8 字）。
- `.devdata/snapshots` 下 106 个历史快照文件（含 `测试1/首页`）。
- `ai-config.json` / `ai-credentials.json` / `git-config.json` / `git-credentials.json`。
- `Local Storage` 中的 `protoLastProject`（若缺失，由 harness 兜底选择 `测试1`）。

每个 agent 复制一份：

```powershell
$dst = Join-Path $root "ai"
Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $seed $dst -Recurse
```

### 2.3 单域启动模板

```powershell
$env:PLAND_DEV_DATA_DIR = Join-Path $env:TEMP "pland-wave4\ai"
$env:PLAND_RENDERER = "react"
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "never"
$env:GIT_ASKPASS = "echo"
$env:SSH_ASKPASS = "echo"
npx playwright test e2e/wave4-ai.spec.ts --workers=1 --output=test-results/wave4/ai
```

### 2.4 硬规则

- 不允许 `npx playwright test` 裸跑全量；每个 agent 只跑自己的 spec，否则会串行跑别人的用例并抢数据目录。
- 不允许任何 agent 执行 `npm install` / `npm run build` / `npm run build:renderer`；构建只在 Phase 0 由协调者做一次。
- 不允许改 `playwright.config.ts`（`workers:1` 是仓库既有约束）；跨进程并发通过多个独立命令实现。
- 不允许读写共享 `.devdata`；所有写入只发生在 `%TEMP%\pland-wave4\<domain>`。
- 不允许打印/提交 `ai-credentials.json`、`git-credentials.json`、token、API Key；报告只写“已配置/掩码状态”。
- 每域结束后保留数据目录与截图到报告签字；确认后再删除，便于复现。

---

## 3. 八域矩阵

> 每域表格的“失败判级”是该步不符合预期时的级别；域末再给出本域 P0/P1 的具体边界。所有路径默认在 `PLAND_RENDERER=react`、独立数据目录下执行。

### 3.1 域 1：AI 对话

**目标**：验证真实 Agent 链路可用、流式回复合并为单气泡、模型/思考/停止/重试/权限/Trace/会话持久化均可达。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\ai`。
- 清空 AI 历史，避免旧失败文案干扰气泡计数：打开页面后删除 localStorage 中 `ai_sessions_v2_*`、`ai_hist_*`、`ai_model`、`ai_model_reasoning`，再 reload。
- **Agent/模型配对预检**：读取 `ai-dialog-session` 的 Agent 与 `ai-model-select` 的模型；若历史错误含“当前模型不被该 Agent 支持”，先在隔离副本的 `ai-config.json` 调整为已知可用配对（记录 agentId/modelId），不要直接真实发送。
- 真实请求预算：本域 A 阶段 **1 次** `ai:ask`；失败在流开始前可修配置后重试 1 次，最多 2 次。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 顶栏打开「AI 对话」 | `ai-dialog` 可见；`ai-dialog-session` 显示会话/Agent；`ai-model-selector` 恰 1 个；`ai-model-select`、`ai-thinking-select` 可见；无 `ai-dialog-error` | P1 |
| 2 | 切换模型与思考强度，关闭再打开 | 选择值保持；未发送消息；模型清单来自 settings（非写死） | P2 |
| 3 | 真实发送 1 条短 prompt（如「请用一句话（20~40 字）说明当前原型页面的用途，不要调用工具」） | 用户气泡出现；发送按钮变停止按钮（若流太快未捕获，记 N/A）；无立即报错 | P1 |
| 4 | 流式期间每 200ms 采样，最多 12s | 若捕获中间态：assistant 文本气泡数保持 **1**，文本长度增长；若流在首次采样前结束：记录 `fast-stream`，只要求最终气泡数=1 | P1 |
| 5 | 等待本轮结束 | 停止按钮回到发送按钮；`ai-dialog-error` 不存在；Trace 有控制事件行；聊天正文无 `acp_catalog`/`run_started` 等内部事件名 | P1（失败/报错）；P2（Trace 为空） |
| 6 | 关闭 AI → reload → 重开 | 同一会话仍在；assistant 气泡仍为 1；文本完整；无重复历史 | P1 |
| 7 | mock：`run_started` + `chunk` + `permission_request` + `done`，期间点停止/允许/拒绝 | 停止按钮在 busy 时可见；权限卡出现且按钮可点；`ai:scope-confirm` 捕获到 decision；UI 状态回落 | P2（mock 专属） |
| 8 | mock：stub `ai:ask` 后点「重试」 | `ai:ask` 调用 +1；新 run 产生新气泡；不把上一轮文本拼到新气泡 | P2（mock 专属） |

**失败判级边界**

- P0：打开 AI 崩溃/白屏；发送导致主进程异常退出；会话文件损坏。
- P1：真实发送失败；一条回复被拆成多个文本气泡；刷新后消息丢失/重复；模型选择器不可用；权限请求阻断整轮且无替代。
- P2：思考流未出现（模型本就不支持时记 N/A）；Trace 为空；mock 下停止/重试状态不对；权限卡样式/措辞。
- P3：气泡间距、按钮文案、耗时显示。

**e2e**

- 复用：`e2e/ai.spec.ts`（静态契约）、`e2e/electron-functional.spec.ts` STEP 8（只读模型列表）。
- 新增：`e2e/wave4-ai.spec.ts`
  - `A1 打开/单选择器/模型思考可切换（不发送）`
  - `A2 真实发送一次：单气泡 + 文本增长 + done`
  - `A3 关闭重开 + reload：会话/消息持久化`
  - `A4 mock：stop + permission + trace`
  - `A5 mock：retry 与 run 边界`

**独占文件**

- 产出：`e2e/wave4-ai.spec.ts`、`docs/wave4/reports/ai.md`、`docs/wave4/shots/ai/**`、`docs/wave4/logs/ai.log`、数据目录 `%TEMP%\pland-wave4\ai`。
- 源码归属（本轮只读，后续修复排班）：`src/renderer/features/ai/**`、`src/renderer/components/ai-elements/**`、`src/renderer/stores/ai-store.ts`。

---

### 3.2 域 2：Ctrl 拾取 / 就地编辑 / 多选

**目标**：验证“Ctrl 悬停 → 点选 → selector 非空 → 就地改/多选 → 检查器 → 标注/链接 → 待提交”整条编辑链路，且不误触 AI。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\pick`；项目 `测试1` / 原型 `首页`。
- `annotations.json` 现有 2 条、`links.json` 现有 2 条；记录初始数组长度与文件 hash。
- 选择非跳转元素（如 `.banner`、`.search-bar`），避免 Ctrl+点击触发页面跳转。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 进入 `测试1/首页`，等待预览 iframe 渲染 | `stage-frame`、`preview-frame` 可见；iframe body 有真实页面文本 | P1 |
| 2 | 按住 Ctrl，在 iframe 内悬停元素 | `pick-status` 出现；`pick-hover` 有非零 bbox；松开 Ctrl 后消失 | P1 |
| 3 | Ctrl+点击元素 | `overlays-selection-count`=1；`.selection-box-overlay` ≥1；打开检查器后 selector 非空（含 `[data-pr-id]`/`nth-of-type`/`#id` 之一），页面/htmlFile 徽标非空 | P1 |
| 4 | 再点同一元素取消，再重新点选 | 计数回 0，再回 1；overlay 不残留 | P2 |
| 5 | 点「就地改」，修改文本，Ctrl+Enter | 编辑框预填原文；提交后 toast「已加入待提交队列」；队列计数 +1；不打开 `ai-dialog` | P1 |
| 6 | Ctrl+点击 A，Ctrl+Shift+点击 B | 计数=2；打开「多选」出现 `multi-edit-drawer`；批量填写并提交后队列增加 | P1（多选不可用）；P2（批量文案） |
| 7 | 打开检查器：加需求、绑定跳转到「我的」、加标注 | `inspector` 三个板块可见；保存后 toast 成功；隔离副本的 `annotations.json`/`links.json` 计数 +1 | P1（写失败）；P2（入口难找） |
| 8 | 打开「待提交」：移除 1 项、清空全部（均经 Confirm） | `multi-edit-bar` 计数正确；Confirm 出现；清空后条消失；`edit_queue_v1` 持久化为 `[]` | P1（数据未落盘）；P2（确认文案） |

**失败判级边界**

- P0：拾取/就地改导致原型 HTML 或文档损坏；应用崩溃。
- P1：Ctrl 悬停无反应；点选后 selector 为空；就地改写错元素；多选计数错；检查器/标注/链接保存失败；待提交丢失。
- P2：取消选择不干净、overlay 残留、批量校验提示弱、检查器折叠态不持久。
- P3：overlay 颜色/角标位置/按钮图标。

**e2e**

- 复用：`e2e/overlays.spec.ts`（装配/契约）、`e2e/preview.spec.ts`（拾取协议/selector）。
- 新增：`e2e/wave4-pick.spec.ts`
  - `A1 Ctrl hover + click：selector 非空`
  - `A2 就地改：Ctrl+Enter 入队，不触发 AI`
  - `A3 多选：Ctrl+Shift 累加 + 批量入队`
  - `A4 检查器：需求/跳转/标注写盘`
  - `A5 待提交：移除/清空 Confirm + 持久化`

**独占文件**

- 产出：`e2e/wave4-pick.spec.ts`、`docs/wave4/reports/pick.md`、`docs/wave4/shots/pick/**`、`docs/wave4/logs/pick.log`、数据目录 `%TEMP%\pland-wave4\pick`。
- 源码归属（本轮只读）：`src/renderer/features/preview/{PreviewOverlaysHost,PickOverlay,InlineEdit,MultiSelect}.tsx`、`src/renderer/components/overlays/{MultiEditBar,Inspector,Confirm}.tsx`。
- 与域 8 的边界：`PreviewOverlaysHost.tsx` 的标注/链接/快照入口由本域验“可达 + 能写”；计数/删除/恢复的深度验证归域 8。跨域改动必须由协调者裁决。

### 3.3 域 3：文档查看与交互

**目标**：验证文档面板 PC 悬浮/移动端行内两种形态、目录跳转、查找、微改/整篇保存、独立窗 mirror、文档导出。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\docs`；`测试1/首页/首页.md` 与 `最新需求.md` 备份 hash。
- 记录 `首页.md` 初始内容与行数；微改/整篇保存后必须还原，避免影响后续域。
- 独立窗需要 `docwin` 功能正常；不要在 AI/Git busy 时打开。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | PC 形态点「文档」 | `docs-panel[data-variant=overlay]` 可见；舞台宽度前后不变（实测 887→887）；`doc-toc-sidebar` 可见，目录 ≥6 条 | P1 |
| 2 | 点击目录第 2 条；在 `doc-search` 输入「商品」再清空 | 正文滚动容器 `scrollTop` 增大且目标标题进入视口；搜索只过滤目录，不破坏正文 | P1（跳转失败）；P2（搜索只过滤标题） |
| 3 | 按 `Ctrl+F` | 期望焦点进入 `doc-search` 或打开可用的正文查找；至少能输入并定位 | P1（若完全无反应且产品要求该快捷键）；P2（仅原生查找/不能搜正文） |
| 4 | 悬停正文段落 → 「微改」→ 追加 `W4` → 应用 | Popover 预填本段；应用后正文出现 `W4`；toast 保存成功；磁盘文件内容包含 `W4` | P0（写坏文件）；P1（未保存） |
| 5 | 用微改删除 `W4` 还原；再「进入编辑」追加 `\n\nW4-smoke` → 保存 | 两次保存均落盘；`未保存` Badge 消失；最终 hash 与基线一致 | P0（内容损坏）；P1（保存失败） |
| 6 | 点「独立窗口」 | 新窗口 `doc-window` 可见；无 `main-window` 主壳；标题/文档内容正确 | P1 |
| 7 | 主窗切「最新需求」；独立窗切「功能说明」；关闭独立窗 | 主→独 mirror 同步；独→主 mirror-back 同步；关闭后主窗回 panel，`独立窗口` 按钮恢复 | P1（不同步）；P2（关闭后状态） |
| 8 | 移动端打开文档，切「最新需求」；打开目录抽屉 | `docs-panel[data-variant=inline]`；Tab 可直接点击（`aria-selected=true`）；抽屉可见且不遮挡 Tab | P1（旧 P1 回归）；P2（抽屉动画） |
| 9 | 文档导出菜单：Markdown / PNG / PDF | A 只验 Markdown 下载 + 一种图片/PDF；B 验三种均有文件/ toast；文件非 0 字节 | P1（全部失败）；P2（单格式失败） |

**失败判级边界**

- P0：保存导致 Markdown 截断/乱码/丢失；独立窗导致主窗崩溃。
- P1：文档打不开；目录不能跳转；微改/保存不落盘；mirror 单向或错源；移动端 Tab 再次被遮挡；导出完全不可用。
- P2：`Ctrl+F` 仅能过滤目录不能搜正文；目录高亮缺失；独立窗关闭后按钮状态慢；单种导出格式失败。
- P3：目录缩进、字号、Popover 位置、toast 文案。

**e2e**

- 复用：`e2e/docs.spec.ts`（双形态/保存分流/mirror 契约）、`e2e/electron-functional.spec.ts` STEP 5（移动端 Tab）。
- 新增：`e2e/wave4-docs.spec.ts`
  - `A1 PC 悬浮 + 目录跳转`
  - `A2 Ctrl+F 焦点/查找行为（按实际判级）`
  - `A3 微改落盘 + hash 还原`
  - `A4 整篇编辑保存 + 还原`
  - `A5 docwin 打开/mirror 双向/关闭回 panel`
  - `A6 移动端 Tab + 目录抽屉`
  - `A7 文档 Markdown/PNG/PDF 导出`

**独占文件**

- 产出：`e2e/wave4-docs.spec.ts`、`docs/wave4/reports/docs.md`、`docs/wave4/shots/docs/**`、`docs/wave4/logs/docs.log`、数据目录 `%TEMP%\pland-wave4\docs`。
- 源码归属（本轮只读）：`src/renderer/features/docs/**`、`src/renderer/stores/docs-store.ts`、`src/renderer/app/modes/DocWindow.tsx`、`src/renderer/components/shell/DocsPanelHost.tsx`。

---

### 3.4 域 4：主壳 / 项目 / 侧栏

**目标**：验证冷启动、项目切换/创建、侧栏真实数据、文件夹拖拽、刷新、Esc 栈。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\shell`；`测试1` 下 2 个原型：`首页`、`我的`。
- 备份 `protoGroups_v1__测试1`、`protoGroupsFold_v1__测试1`、`protoOrder_v1`、`subPageOrder_v1` 等 localStorage 键；测试结束丢弃目录即可，不改真实 `.devdata`。
- 临时项目名 `W4-临时-<HHmmss>`；A 阶段只创建/进入，不强制删除（隔离目录直接丢弃）。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 冷启动（seed 含 `protoLastProject=测试1`） | `main-window`/`topbar`/`sidebar`/`stage-frame` 可见；项目=`测试1`；若弹选择器则可选 `测试1` 进入 | P0（无法进入）；P1（骨架缺失） |
| 2 | 打开项目下拉，搜索「测试」 | `project-menu` 可见；搜索框/新建输入存在；至少 1 个真实项目；搜索过滤不崩 | P1 |
| 3 | 新建临时项目并进入 | 新项目出现在列表；进入后侧栏空态/舞台空态合理；无示例假数据 | P1 |
| 4 | 回 `测试1`，点击 `首页`、`我的` | 侧栏 2 行；点击后 `loc-pill`/面包屑更新；舞台源切换 | P1 |
| 5 | 新建文件夹，拖 `首页` 进文件夹；折叠/展开；拖出还原 | 拖拽中 `data-dragging=true`；行进入文件夹；折叠/展开不丢行；顺序键更新 | P1（丢原型）；P2（顺序/手柄） |
| 6 | 顶栏刷新 | sources 重新加载；无重复行；当前选择不丢或明确回到首个 | P1（重复/清空） |
| 7 | 依次打开 文档 → 设置 → Git → AI，连按 Esc | Esc 按栈顶顺序关闭（AI > 设置 > Git > 导出 > 文档）；一次只关一层 | P2 |

**失败判级边界**

- P0：冷启动白屏/无法进入项目；项目创建/切换导致应用崩溃。
- P1：项目下拉不可用；侧栏点击不换源；拖拽丢原型；刷新后列表重复/为空；Esc 卡死。
- P2：文件夹命名/折叠态不持久；拖拽手柄难用；空态文案。
- P3：行高、图标、缩进、面包屑分隔符。

**e2e**

- 复用：`e2e/shell.spec.ts`（三层/拖拽/375×780）、`e2e/electron-functional.spec.ts` STEP 1–2 + 用例 B 顶栏。
- 新增：`e2e/wave4-shell.spec.ts`
  - `A1 冷启动/项目恢复`
  - `A2 项目下拉/搜索/新建`
  - `A3 侧栏双原型切换`
  - `A4 文件夹创建/拖入/折叠/还原`
  - `A5 刷新无重复 + Esc 栈`

**独占文件**

- 产出：`e2e/wave4-shell.spec.ts`、`docs/wave4/reports/shell.md`、`docs/wave4/shots/shell/**`、`docs/wave4/logs/shell.log`、数据目录 `%TEMP%\pland-wave4\shell`。
- 源码归属（本轮只读）：`src/renderer/components/shell/{Topbar,Sidebar,MiniDock}.tsx`、`src/renderer/features/projects/**`、`src/renderer/stores/{app,sources}-store.ts`。

---

### 3.5 域 5：舞台 / 预览 / 移动端

**目标**：验证 iframe 真实渲染、375×780 移动舞台、PC/移动切换、缩放、子页、文档与舞台互不遮挡、刷新清理。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\stage`；`测试1/首页`（移动 kind）、`我的`。
- 可选子页：在隔离副本的 `首页/` 下复制 `首页.html` 为 `详情.html`（或通过侧栏「新建子页面」创建），用于 `stage-subpages` 路径；没有子页时该步记 `SKIP`，不判失败。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 点击 `首页` | `preview-frame` iframe 唯一；`srcdoc` 长度 >10k；frame body 文本 >100 字；无白屏 | P0（白屏）；P1（无 iframe） |
| 2 | 观察舞台 kind 与尺寸 | `data-kind=mobile`；`stage-viewport` 逻辑尺寸 **375×780**；缩放自适应不裁切 | P1 |
| 3 | 顶栏切「PC」 | `data-kind=pc`；舞台重新布局；预览仍可见 | P1 |
| 4 | 点放大/缩小到 125% / 50%，再「自适应」 | `stage-zoom-readout` 与操作一致；无横向溢出/内容裁切；自适应恢复 | P2（读数偏差） |
| 5 | 点击子页（若 seed 有） | `activeSubFile` 变化；iframe 内容/标题变化；面包屑更新；返回主页正常 | P1（子页无反应）；P2（面包屑） |
| 6 | 移动端打开文档，再关闭；PC 打开文档 | 移动端 inline 挤压但 375×780 逻辑尺寸不变；PC overlay 不挤压舞台；关闭后恢复 | P1（遮挡/尺寸变化） |
| 7 | 顶栏刷新/重新进入源 | iframe 重载；拾取选择清空；无旧 srcdoc 残留；console fatal=0 | P1（旧内容残留）；P2（选择未清） |

**失败判级边界**

- P0：舞台白屏/崩溃；iframe 注入导致主窗不可用。
- P1：iframe 缺失/空 srcdoc；移动舞台不是 375×780；PC/移动切换失效；文档遮挡舞台；刷新后仍显示旧源。
- P2：缩放读数偏差、子页面包屑、选择状态清理慢。
- P3：工具栏图标、缩放按钮排版、过渡动画。

**e2e**

- 复用：`e2e/preview.spec.ts`（Stage/PreviewFrame/selector）、`e2e/headless-render.spec.ts`（视口截图）。
- 新增：`e2e/wave4-stage.spec.ts`
  - `A1 首页 iframe/srcdoc/body 文本`
  - `A2 移动 375×780`
  - `A3 PC/移动切换`
  - `A4 缩放/自适应`
  - `A5 子页（有则跑，无则 SKIP）`
  - `A6 文档与舞台互不遮挡`
  - `A7 刷新/重进源清理`

**独占文件**

- 产出：`e2e/wave4-stage.spec.ts`、`docs/wave4/reports/stage.md`、`docs/wave4/shots/stage/**`、`docs/wave4/logs/stage.log`、数据目录 `%TEMP%\pland-wave4\stage`。
- 源码归属（本轮只读）：`src/renderer/components/shell/Stage.tsx`、`src/renderer/features/preview/{PreviewFrame.tsx,lib/**}`。
- 与域 2 边界：`PreviewFrame` 的拾取协议由域 2 深验；本域只验渲染/尺寸/切换。

### 3.6 域 6：设置 / 模型 / Agent

**目标**：验证 6 Tab、Agent 真实探测、CLI/API 切换、模型可见性、设计规范/沙箱/快捷键/关于，并确认配置写入隔离副本。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\settings`；备份 `ai-config.json`、`ai-credentials.json`、`specs/index.json`、`uilibs/index.json`。
- 当前基线：Agent 26 行、模型 7 个可见、设计规范 2 个、版本 1.2.0；断言用“≥10 行 / ≥5 模型 / ≥1 规范”。
- 测试连接/模型拉取涉及网络，A 只用无效地址验错误处理，不调用真实付费接口。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 打开设置 | `settings-dialog` 可见；6 个 `role=tab`：Agent/模型/设计规范/沙箱/快捷键/关于；`settings-loading` 消失；无 `settings-error` | P1 |
| 2 | Agent Tab：查看行数、当前标记、`engine-cli`/`engine-api` 高度 | Agent 行 ≥10（真实数据，无 `DEFAULT_AGENTS`）；当前 Agent 有标记；两个引擎按钮高度 32/32px | P1（无数据）；P2（高度） |
| 3 | 点「重新探测」 | loading 出现后消失；行数刷新；无 console error；不误改配置 | P1（卡死）；P2（探测失败文案） |
| 4 | CLI ↔ API 切换；填 API Base URL/Key（掩码）并保存/取消 | 引擎徽标切换；保存后重开仍生效；Key 不回显明文；取消不写入 | P1（保存不生效）；P2（掩码/提示） |
| 5 | 模型 Tab：搜索「deepseek」；勾选/取消一个模型；关闭重开 | `model-manager` 可见；计数正确；搜索只过滤显示不改勾选；重开后可见性持久化 | P1（清单空/保存失败）；P2（计数） |
| 6 | 添加自定义模型 `w4/test-model`，再移除 | 添加后出现；移除后回落 default/首个；无重复项 | P1（增删失败）；P2（回落顺序） |
| 7 | 设计规范绑定/解绑；沙箱根路径；快捷键列表；关于版本 | 规范 ≥1、绑定成功；沙箱路径可见；快捷键含 Ctrl+F/Ctrl+Enter；版本=1.2.0 | P2 |
| 8 | 用无效 Base URL 点「测试连接」 | ≤10s 返回错误 toast；无长时间 busy/崩溃；不改已保存配置 | P1（卡死）；P2（错误文案） |

**失败判级边界**

- P0：设置打开/保存导致应用崩溃或配置损坏。
- P1：6 Tab 缺失；Agent 清单为空/写死；引擎切换不生效；模型可见性无法保存；测试连接永久卡死。
- P2：32px 高度偏差；掩码/回落/空态/错误文案；快捷键列表不全。
- P3：Tab 图标、卡片间距、Badge 颜色。

**e2e**

- 复用：`e2e/settings-models.spec.ts`（6 Tab/模型清单/32px）。
- 新增：`e2e/wave4-settings.spec.ts`
  - `A1 6 Tab + Agent 真实行`
  - `A2 重新探测`
  - `A3 CLI/API 切换 + 保存`
  - `A4 模型搜索/勾选/持久化`
  - `A5 自定义模型增删/回落`
  - `A6 无效连接超时`

**独占文件**

- 产出：`e2e/wave4-settings.spec.ts`、`docs/wave4/reports/settings.md`、`docs/wave4/shots/settings/**`、`docs/wave4/logs/settings.log`、数据目录 `%TEMP%\pland-wave4\settings`。
- 源码归属（本轮只读）：`src/renderer/features/settings/**`、`src/renderer/features/models/**`、`src/renderer/stores/settings-store.ts`。

---

### 3.7 域 7：Git

**目标**：验证 Git Dialog 660px、状态/差异、分支、仓库配置、提交发布、同步、自愈/取消入口；默认离线，不碰真实 gitee。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\git`；复制 seed 后，在 `%TEMP%\pland-wave4\git-remote.git` 建本地 bare 仓库，并把隔离副本 `sandbox` 的 `origin` 指向它。
- 预置 2–3 个未提交变更（改一个 md、删/改一个 html），保证 `git-total` ≥1；设置 `user.name`/`user.email`。
- 将隔离副本 `git-config.json` 的 `测试1` 远程地址改为本地 bare 路径，分支 `main`；不写真实 token。
- 真实 gitee 网络验证只作为 `GIT-NET` 独占项，默认 A 不执行。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 打开 Git 管理 | `git-sheet[data-surface=dialog]` 可见；宽度 660px；`git-panel`/分支选择/变更总数可见 | P1 |
| 2 | 状态列表、搜索过滤、切换 diff | `git-file-row` ≥1；搜索缩小列表；diff 模式有文件/差异提示；无空白崩溃 | P1（列表空）；P2（diff 展示） |
| 3 | 仓库设置：本地 bare URL、分支、作者；测试连接；保存；重开 | `git-config-dialog` 可见；连接返回延迟/成功；保存后重开仍在；token 掩码 | P1（保存失败）；P2（延迟展示） |
| 4 | 勾选 1–2 个文件，填提交信息，点「发布」 | toast 成功；本地 bare 仓库 `git log -1` 含该信息；状态变更数下降 | P1 |
| 5 | 从第二个临时 clone 向 bare 提交一个新文件；主窗点「同步」并 Confirm | toast 同步成功；新文件出现在沙箱/侧栏；备份路径提示（如有） | P1 |
| 6 | 自愈入口：点「自愈修复」看 Confirm；取消 | Confirm 出现；取消不写盘；A 不实际执行（避免破坏 seed） | P2 |
| 7 | 慢操作取消（可选）：推送/同步中点「取消操作」 | busy 徽标出现；取消后 toast 并回到空闲；无悬挂子进程 | P2 |

**失败判级边界**

- P0：Git 操作损坏仓库/丢文件；应用退出被 Git 子进程挂住。
- P1：Dialog 打不开；状态/分支读不出；配置保存失败；本地 push/pull 失败；同步后文件丢失。
- P2：diff 排版、分支列表刷新慢、取消按钮时机、自愈文案。
- P3：图标、表格列宽、空态文案。

**e2e**

- 复用：`e2e/git-export.spec.ts`（面板/配置字段/destructive Confirm）、`e2e/electron-live.spec.ts`（660 Dialog + Esc）。
- 新增：`e2e/wave4-git.spec.ts`
  - `A1 660 Dialog + 状态列表`
  - `A2 diff/搜索/选择`
  - `A3 本地 bare 配置 + 测试连接`
  - `A4 push 到本地 bare + log 验证`
  - `A5 pull 新提交 + 文件出现`
  - `A6 自愈/取消入口（不执行破坏操作）`

**独占文件**

- 产出：`e2e/wave4-git.spec.ts`、`docs/wave4/reports/git.md`、`docs/wave4/shots/git/**`、`docs/wave4/logs/git.log`、数据目录 `%TEMP%\pland-wave4\git`、远程 `%TEMP%\pland-wave4\git-remote.git`。
- 源码归属（本轮只读）：`src/renderer/features/git/**`。

---

### 3.8 域 8：导出 / 标注 / 快照 / 链接

**目标**：验证 5 种导出真实落盘、标注/链接读写、快照列表/恢复 Confirm、待提交跨刷新持久化。

**测试数据前置**

- 独立目录 `%TEMP%\pland-wave4\export`；输出目录 `%TEMP%\pland-wave4\exports`，每次先清空。
- `首页` 现有 2 条标注、2 条链接、≥1 个快照；记录 `annotations.json`/`links.json` 初始长度与 `首页.html` hash。
- 原生保存对话框用主进程 stub 指向输出目录；JSON/MD/HTML 下载用 `will-download` 重定向。
- 队列可选预置：`edit_queue_v1` 写 1 条 `{id,selector,page,htmlFile,text,selected:true}`；不预置则第 8 步 SKIP。
- 快照恢复是破坏性操作：只在隔离副本执行，执行后该域目录直接丢弃，不做“恢复回滚”。

**用户路径**

| # | 步骤 | 预期结果 | 失败判级 |
| --- | --- | --- | --- |
| 1 | 打开导出菜单 | 5 项：源码包 JSON / 独立 HTML / 文档 PNG / PDF / Markdown；菜单可 Esc 关闭 | P1（缺项） |
| 2 | 导出源码包 | 文件 >20KB；JSON 可解析；`project=测试1`；`sources.length≥2`；toast 成功 | P1（无文件/坏 JSON） |
| 3 | 导出独立 HTML | 文件 >0；包含 `__EXPORT_BOOT__`、`__EXPORT_SOURCES__`；离线打开有样式/可切换（B 深验） | P1（无文件）；P2（离线样式） |
| 4 | 文档 PNG/PDF/Markdown | A 验 Markdown + 一种图片/PDF；B 全验；文件魔数正确（PNG `89 50 4E 47`、PDF `%PDF`）；无 0 字节 | P1（全部失败）；P2（单格式） |
| 5 | 标注：打开面板 → 选中元素加标注 → 切显隐 → 删除（Confirm） | 面板显示 2 条起；新增后 `annotations.json` 3 条；角标显隐刷新后保持；删除 Confirm 后回 2 条 | P1（写失败）；P2（显隐持久化） |
| 6 | 链接：打开面板 → 点已有链接「预览跳转」→ 选中元素绑定「我的」→ 删除 | 跳转触发 NAV_JUMP 并切换目标；`links.json` 3 条且 selector/page/htmlFile 非空；删除 Confirm 后回 2 条 | P1（跳转/写失败）；P2（列表排序） |
| 7 | 快照：打开面板 → 筛选 → 点恢复 → Confirm → 确认 | 列表 ≥1；Confirm 出现；恢复后 toast；`首页.html` hash 等于快照文件；列表刷新 | P1（恢复失败/无 Confirm）；P2（时间格式） |
| 8 | 待提交（可选）：在本域 seed 预置一条 `edit_queue_v1`，reload 后打开 | 队列仍在；`multi-edit-bar` 计数正确；清空后持久化为 `[]`；无预置则 SKIP | P1（丢失）；P2（计数） |

**失败判级边界**

- P0：导出/标注/快照写坏源文件或文档；恢复导致不可逆数据丢失（在隔离副本外发生才算 P0）。
- P1：5 项菜单缺失；源码 JSON/HTML 无文件或坏文件；标注/链接保存失败；快照恢复无 Confirm 或恢复错快照；队列刷新丢失。
- P2：单种导出格式失败；离线样式缺失；标注显隐不持久；链接列表排序；时间格式。
- P3：菜单图标、文件名、toast 文案、面板间距。

**e2e**

- 复用：`e2e/export.spec.ts`（payload/模板契约）、`e2e/git-export.spec.ts`（导出/确认）、`e2e/overlays.spec.ts`（标注/快照/队列装配）。
- 新增：`e2e/wave4-export.spec.ts`
  - `A1 5 项菜单 + 源码 JSON 落盘`
  - `A2 独立 HTML 契约`
  - `A3 文档 MD/PNG/PDF`
  - `A4 标注增删/显隐`
  - `A5 链接跳转/绑定/删除`
  - `A6 快照列表/Confirm/恢复`
  - `A7 队列持久化（可选 seed）`

**独占文件**

- 产出：`e2e/wave4-export.spec.ts`、`docs/wave4/reports/export.md`、`docs/wave4/shots/export/**`、`docs/wave4/logs/export.log`、数据目录 `%TEMP%\pland-wave4\export`、输出 `%TEMP%\pland-wave4\exports`。
- 源码归属（本轮只读）：`src/renderer/features/export/**`、`src/renderer/features/annotations/**`、`src/renderer/features/links/**`、`src/renderer/features/snapshot/**`、`src/renderer/components/overlays/{AnnoPanel,SnapshotPanel}.tsx`。

## 4. 两阶段：A 冒烟 / B 全量体验

### 4.1 A 冒烟（只报 P0/P1）

**目标**：用最短路径证明“8 个域的核心功能真的可用”，不追求覆盖所有分支，不评价视觉。每域只跑 3–8 步，失败即停在该域，保留现场，跳到下一个独立域。

| 域 | A 阶段必测 | A 阶段明确不测（推迟 B） |
| --- | --- | --- |
| AI | 打开、单选择器、真实 1 次发送、单气泡、done、持久化、mock 停止/权限/Trace | 多模型矩阵、思考档位全枚举、长回复、真实停止/重试 |
| Ctrl 拾取 | 悬停、点选 selector、就地改、多选、检查器、待提交 | 标注/链接/快照深度增删、跨页面绑定 |
| 文档 | 打开、目录跳转、Ctrl+F 记录、微改、保存、docwin mirror、移动 Tab、MD 导出 | PNG/PDF 全量、长文档、离线导出、编辑态 undo |
| 主壳 | 冷启动、项目切换/新建、双原型、文件夹拖拽、刷新、Esc 栈 | 三层文件夹极限、项目删除、终端真实拉起、多项目批量 |
| 舞台 | iframe、375×780、PC/移动、缩放、文档互不遮挡、刷新 | 子页全路径、长页面滚动、极端窗口尺寸 |
| 设置 | 6 Tab、Agent 行、引擎切换、模型搜索/持久化、自定义模型、无效连接 | 真实模型拉取、真实 API 测试、全部 Agent 探测 |
| Git | 660 Dialog、状态、diff、本地 bare 配置、push、pull | 真实 gitee 网络、冲突、自愈执行、慢操作取消 |
| 导出/标注/快照/链接 | 5 项菜单、源码 JSON、MD、标注增删、链接跳转、快照 Confirm | 独立 HTML 离线打开、PNG/PDF 全量、快照多版本、队列跨域 |

A 的执行口径：

- 只把 P0/P1 写进“阻断缺陷表”；P2/P3 写在域报告“观察区”，不汇总进 A 结论。
- 每一步必须留截图或文件证据；失败步骤额外保存 DOM/console 摘录。
- 域内失败即停止后续步骤，避免在错误状态上继续制造脏数据；域间独立，可继续跑其他域。
- SKIP 只允许：环境无网络、Agent 未安装、快照为空、子页未 seed；必须写原因，不能把 SKIP 当 PASS。

### 4.2 A 的修复门槛

A 汇总后进入修复窗口：

1. 协调者把 P0/P1 按“域 + 步骤 + 证据”去重，指定 owner。
2. 修复只允许改对应域源码；跨域改动（如 `PreviewOverlaysHost`）由协调者裁决。
3. 修复后只复跑该域 spec + 受影响的相邻域 smoke（例如改 `Stage` 复跑舞台 + 拾取；改 `DocsPanelHost` 复跑文档 + 移动端）。
4. **A 的 P0/P1 全部关闭并复测通过，才允许开 B**；未关闭的 P1 必须有书面 waiver（owner/日期/风险/替代路径），否则 B 不启动。

### 4.3 B 全量体验（含 P2，按优先级排序）

B 不是把 A 再跑一遍，而是在 A 已稳定的版本上做“真实用户会遇到的边界与质感”：

| 批次 | 内容 | 判定 |
| --- | --- | --- |
| **B1 P2 功能** | 错误态、空态、保存失败、单格式导出失败、mirror 边界、Git 冲突/取消、权限拒绝、会话切换 | 影响功能的 P2 优先修 |
| **B2 P2 体验** | 键盘路径、焦点、滚动、溢出、长文本、窗口 1024×768/600×900、移动 390×844、加载反馈 | 影响可用性的 P2 排期 |
| **B3 P3 质感** | 文案、间距、像素、图标、颜色、动画、排序、toast 措辞 | 记录 backlog，不阻断 |

B 的额外矩阵：

- 视口：1440×900、1024×768、600×900、移动 390×844 @2x；检查遮挡、横向滚动、按钮溢出。
- 键盘：Tab 顺序、Esc 栈、Ctrl+F、Ctrl+Enter、Shift+Enter、Enter 发送、焦点回到输入框。
- 空/错：无项目、空侧栏、无文档、无标注、无链接、无快照、无模型、Agent 未安装、Git 无变更/无远程。
- 长内容：长 PRD、长 AI 回复、多原型、多文件变更、长项目名。
- 持久化：重启应用/刷新后会话、队列、Tab、设置、窗口状态。
- 交叉：移动端文档 + 浮层工具栏、AI 打开时舞台/文档、Git busy 时切项目、导出时切文档。

B 的报告要按“影响 × 频率”排序 P2，不能按发现顺序堆砌；P3 只放附录。

---

## 5. 并行策略与冲突隔离

### 5.1 全局槽位

| 槽位 | 数量 | 说明 |
| --- | --- | --- |
| 常规 UI 槽 | 3 个 Electron 实例 | shell / stage / settings / pick / docs-read 可占用；UI 并行开发占机器时降到 2 |
| `AI-LIVE` | 1，且独占 | 只跑一次真实发送；期间不启动第二个 AI 实例、不跑 Git 写、不跑 docwin |
| `GIT-WRITE` | 1，且独占 | 本地 bare push/pull；与 `AI-LIVE`、`DOC-WIN` 串行；真实 gitee 需额外审批 |
| `DOC-WIN` | 1，且独占 | 独立文档窗 + mirror；与 `AI-LIVE`、`GIT-WRITE` 串行 |
| `EXPORT-NATIVE` | 1 | PNG/PDF/HTML 原生保存对话框；域内串行，避免对话框抢焦点 |

锁文件约定（可选但推荐）：

```text
%TEMP%\pland-wave4\locks\ai.live.lock
%TEMP%\pland-wave4\locks\git.write.lock
%TEMP%\pland-wave4\locks\docwin.lock
%TEMP%\pland-wave4\locks\export.native.lock
```

锁内容写 `domain / pid / start / owner`；超过 30 分钟视为 stale，仅协调者可删除。

### 5.2 并行/串行矩阵

| 域 | A 槽位 | 可并行 | 必须串行于 | 原因 |
| --- | --- | --- | --- | --- |
| AI 对话 | `AI-LIVE` → `AI-MOCK` | mock 阶段可与 UI 槽并行 | 真实发送时独占；不与 Git 写/docwin 同时 | 额度、事件流、焦点 |
| Ctrl 拾取 | `UI-1` | shell/stage/settings/docs-read | 域内步骤串行 | 同一 iframe 状态 |
| 文档 | `DOC-READ` / `DOC-WIN` | 只读文档可与 UI 槽并行 | docwin 独占；不与 AI/Git 写同时 | 多窗口/焦点/mirror |
| 主壳 | `UI-2` | pick/stage/settings | 域内项目/拖拽步骤串行 | localStorage/项目状态 |
| 舞台 | `UI-3` | shell/pick/settings | 域内切换/缩放串行 | 同一舞台实例 |
| 设置 | `UI-4`（动态） | shell/stage/pick | 模型拉取/测试连接单独串行 | 配置写入/网络 |
| Git | `GIT-READ` / `GIT-WRITE` | 只读状态可与 UI 槽并行 | 写/网络独占 | 共享远程/仓库锁 |
| 导出/标注/快照/链接 | `EXPORT-NATIVE` | 可与 UI 槽并行（读隔离副本） | 原生对话框串行；不与文档编辑同时 | 文件句柄/对话框焦点 |

推荐并发组合：

- **A1**：`shell` + `stage` + `settings`（3 槽）。
- **A2**：`pick` + `docs-read`（2 槽）；`export` 只跑源码 JSON（1 槽，避开原生对话框）。
- **A3**：`AI-LIVE`（独占，15 分钟内）→ `GIT-WRITE`（独占）→ `DOC-WIN`（独占）→ `AI-MOCK`（可与 UI 槽并行）。
- **B1**：8 域按 3 槽滚动；`AI/Git/docwin/原生导出` 仍走独占窗口。
- **B2**：视口/键盘/空态可 2 槽并行；长内容/重启持久化串行。

### 5.3 文件命名与独占产出

每个域只用下表的名字，禁止跨域写：

| 域 | spec | 报告 | 截图 | 数据目录 |
| --- | --- | --- | --- | --- |
| AI | `e2e/wave4-ai.spec.ts` | `docs/wave4/reports/ai.md` | `docs/wave4/shots/ai/` | `%TEMP%\pland-wave4\ai` |
| Ctrl 拾取 | `e2e/wave4-pick.spec.ts` | `docs/wave4/reports/pick.md` | `docs/wave4/shots/pick/` | `%TEMP%\pland-wave4\pick` |
| 文档 | `e2e/wave4-docs.spec.ts` | `docs/wave4/reports/docs.md` | `docs/wave4/shots/docs/` | `%TEMP%\pland-wave4\docs` |
| 主壳 | `e2e/wave4-shell.spec.ts` | `docs/wave4/reports/shell.md` | `docs/wave4/shots/shell/` | `%TEMP%\pland-wave4\shell` |
| 舞台 | `e2e/wave4-stage.spec.ts` | `docs/wave4/reports/stage.md` | `docs/wave4/shots/stage/` | `%TEMP%\pland-wave4\stage` |
| 设置 | `e2e/wave4-settings.spec.ts` | `docs/wave4/reports/settings.md` | `docs/wave4/shots/settings/` | `%TEMP%\pland-wave4\settings` |
| Git | `e2e/wave4-git.spec.ts` | `docs/wave4/reports/git.md` | `docs/wave4/shots/git/` | `%TEMP%\pland-wave4\git` |
| 导出/标注/快照/链接 | `e2e/wave4-export.spec.ts` | `docs/wave4/reports/export.md` | `docs/wave4/shots/export/` | `%TEMP%\pland-wave4\export` |

协调者独占：

- `docs/wave4-smoke-plan.md`（本文件，不再由域 agent 改）。
- `docs/wave4/reports/00-summary.md`（A 汇总）。
- `docs/wave4-smoke-report.md`（A 最终报告）。
- `docs/wave4-experience-report.md`（B 最终报告）。
- `e2e/wave4/_harness.ts`（共享启动/隔离/截图/断言工具；Phase 0 冻结，域 agent 只读引用）。

### 5.4 防冲突规则

1. **一个域只写自己的 spec/report/shots/log/data**；不要改别人的 spec，不要复用同一个截图名。
2. **不共享 Electron 实例**；每个 spec 自己 `_electron.launch`，自己关闭并断言 exit 0。
3. **不共享 `test-results`**；每条命令带 `--output=test-results/wave4/<domain>`。
4. **不共享 seed**；每个 agent 从只读 seed 复制，运行后不写回 seed。
5. **不并行跑两个 AI 真实发送**；mock 阶段可并行，但必须用独立数据目录。
6. **不并行跑两个 Git 写/网络**；只读状态可以在不同数据目录并行。
7. **docwin 同一时刻只允许一个**；其他域不得打开独立文档窗。
8. **导出原生对话框同一时刻只允许一个**；PNG/PDF/HTML 串行，JSON/MD 下载可并行。
9. 代码/构建冲突：Phase 0 后不再 `build`；若 UI 并行开发改了 `src/**`，当前轮次立即标记 `STALE-BUILD` 并停止，不得边改边测。
10. 报告冲突：域报告只写自己的文件；汇总由协调者做，域 agent 不写 `00-summary.md`。

## 6. AI 对话专项（额度敏感）

### 6.1 真实 / mock 分工

| 项 | 真实链路（1 次请求） | mock 链路（0 次请求） |
| --- | --- | --- |
| 目的 | 证明 Agent/模型/流式事件真的通 | 证明 UI 状态机/权限/重试/停止完整 |
| 覆盖 | 发送、流式合并单气泡、done、Trace、模型显示、会话持久化 | 停止按钮、permission 卡、scope-confirm、retry、run 边界、thinking 分段 |
| 次数 | 1 次 `ai:ask`；失败在流开始前可修配置重试 1 次（最多 2） | 0 次真实网络 |
| 数据 | 隔离目录 + 清空旧 AI 历史 | 同一隔离目录，stub `ipcMain.handle('ai:ask')` |

**不要用真实请求去测停止/重试**：这两项需要可控的长流，真实 Agent 的延迟和输出不可控，容易连续烧额度。停止/重试/权限统一走 mock；真实链路只证明“一条短 prompt 能完整走通且合并为一个气泡”。

> 如果产品坚持要真实停止/重试：只在 B 阶段用 1 条长 prompt 做“停止 1 次 + 重试 1 次”，额外 2 次请求，需额度审批并写入报告；A 阶段不做。

### 6.2 真实发送步骤（唯一一次）

1. 打开 AI，记录 `ai-dialog-session` 文本（Agent）和 `ai-model-select` 当前值（模型）；记录 `ai-thinking-select` 当前档位。
2. 若历史已有「当前模型不被该 Agent 支持」：**不要发送**。在隔离副本调整 `ai-config.json` 的 `agentId/mainAgent/model` 为已知可用配对，重启后再试；报告记录调整前后值。
3. 输入短 prompt：`请用一句话（20~40 字）说明当前原型页面的用途，不要调用工具`，点击发送。
4. 每 200ms 采样一次，最多 12s：
   - `[data-slot="ai-message-ai"]` 数量；
   - 最后一个 assistant 气泡的 `innerText.length`；
   - `ai-stop-btn` 是否可见；
   - `ai-dialog-error` 是否出现。
5. 期望：若捕获中间态，assistant 文本气泡数量始终为 **1**，文本长度单调增长；若流在首次采样前结束，记 `fast-stream`，只要求最终气泡数=1；`ai-stop-btn` 捕获到则必须可见，未捕获记 N/A。
6. 等待 `ai-send-btn` 恢复可见（上限 120s）；记录总耗时；截图 mid/done。
7. 打开 `ai-trace-toggle`，确认 `ai-trace-view` 有行；确认聊天正文不含 `acp_catalog`、`run_started`、`done` 等内部事件名。
8. 关闭 AI → `page.reload()` → 重开 AI；确认同一会话、assistant 气泡仍 1 个、文本完整；截图。
9. 记录本次真实 `ai:ask` 次数（应为 1）；报告头写 `AI_REQUESTS=1`。

**单气泡判定**（针对 `docs/ai-streaming-diagnosis.md` 的回归）：

```text
assistantText = page.locator('[data-slot="ai-message-ai"]')
若捕获到多个采样点：各点 count 必须相等且为 1；
若流过快只有 done 后一个采样点：最终 count 必须为 1；
若捕获到中间态：最后一个气泡的 innerText 长度必须递增；
不允许出现连续多个 assistant 文本气泡，每个只有 1–3 个字符。
```

如果 Agent 在本轮插入了 `thinking` 或 `tool_call`，允许出现“文本 → 思考/工具 → 文本”的多段结构；此时断言“每个文本段内部不按词拆分”，而不是整个 run 只有 1 个文本气泡。纯短 prompt 默认不应有工具调用；出现工具调用要在报告说明。

### 6.3 mock 事件序列

在主进程拦截 `ai:ask`，向渲染器发事件；不产生真实网络：

```ts
await app.evaluate(({ ipcMain, BrowserWindow }, payload) => {
  const win = BrowserWindow.getAllWindows()[0]
  const send = (e: unknown) => win.webContents.send('ai:event', e)
  ;(globalThis as any).__w4AskCount = 0
  ipcMain.removeHandler('ai:ask')
  ipcMain.handle('ai:ask', async () => {
    ;(globalThis as any).__w4AskCount += 1
    setTimeout(() => {
      send({ type: 'run_started', runId: 'r1', engine: 'cli' })
      send({ type: 'chunk', runId: 'r1', seq: 0, mode: 'delta', text: '收到' })
      send({ type: 'chunk', runId: 'r1', seq: 1, mode: 'delta', text: '，' })
      send({ type: 'chunk', runId: 'r1', seq: 2, mode: 'delta', text: '正在处理。' })
      send({ type: 'done', runId: 'r1' })
    }, 30)
    return { ok: true }
  })
}, null)
```

断言：

- busy 期间 `ai-stop-btn` 可见；点击后 `ai:cancel` 被调用（可 `ipcMain.handle('ai:cancel')` 记录），UI 在收到 `done/cancel` 后回 idle。
- `permission_request`：发送带 `id/title/command/options` 的事件；`ai-permission-card` 出现；点「允许一次」后主进程 `ipcMain.once('ai:scope-confirm')` 捕获 `{ decision: 'allow-once' }`；卡状态变「已允许」。
- `retry`：首轮 done 后点 `ai-session-retry`；`__w4AskCount` 从 1 变 2；第二次 mock 发新 `runId`；新 assistant 气泡与首轮不拼接。
- `thinking`：发送 `{type:'thinking', runId:'r1', text:'...'}`，确认 `ai-reasoning` 单独渲染，不并入正文。

### 6.4 通过标准与 N/A

| 项 | PASS | N/A / 降级 |
| --- | --- | --- |
| 真实发送 | 有 assistant 文本、无错误、done | Agent 未安装/配额耗尽 → `ENV-BLOCKED`，不算产品 P1 |
| 单气泡 | 纯文本 run 的 assistant 文本气泡=1 | 有 tool/thinking 时按“段内不拆词”判定 |
| 思考 | 选了 thinking 且 `ai-reasoning` 出现 | 模型/Agent 不返回 thinking → N/A，记录模型能力 |
| 模型 | 选择器显示当前模型，切换后持久化 | 模型目录为空 → P1（配置/设置问题） |
| 停止/重试/权限 | mock 下状态正确 | 只能 mock 验证，报告注明 |
| Trace | 打开后有行，正文无内部事件名 | 无控制事件 → N/A |
| 会话持久化 | reload 后 1 条完整回复 | 会话文件损坏 → P1 |

---

## 7. Ctrl 拾取专项

### 7.1 修饰键语义（必须按产品实现验）

- `Ctrl`（macOS `Meta`）按住：进入拾取态；`pick-status` 出现，`pick-hover` 跟随。
- `Ctrl+点击`：单选；已选中同一元素时再点 = 取消。
- `Ctrl+Shift+点击`：累加/移除多选；`overlays-selection-count` 应为 2。
- 松开 Ctrl：拾取态退出，hover 消失；已选中的 selection box 保留。
- 在 iframe 内点击时，父窗的 Ctrl 状态通过 `CTRL_STATE` 同步；Playwright 必须在父页面 `keyboard.down('Control')`，不要在 iframe 内单独按。

### 7.2 selector 非空判定

点选后打开检查器，读取 `[data-testid="inspector"]` 顶部 selector 文本，必须满足：

- 长度 > 3；
- 含 `[data-pr-id=`、`#`、`.`、`>`、`nth-of-type` 中至少一种；
- 不是 `body`/`html` 这类兜底选择器（除非点选的确实是根节点，需在报告说明）；
- 页面徽标非空；`htmlFile` 以 `.html` 结尾。

同时检查 `PickOverlay`：`#selectionOverlay` 存在，`.selection-box-overlay` 数量 = 选中数，`.selection-badge` 编号从 1 开始。

### 7.3 就地改 / 多选 / 待提交

| 操作 | 期望 | 关键断言 |
| --- | --- | --- |
| 就地改 | 编辑器预填选中元素文本；`Ctrl+Enter` 提交；`Esc` 放弃 | `inline-edit` 可见；`inline-edit-input` 值=原文；提交后 `multi-edit-bar` 计数 +1；toast「已加入待提交队列」 |
| 放弃 | `Esc` 或「放弃」→ 二次确认 | `inline-edit-discard` 出现；确认后不写队列 |
| 多选 | 选中 2 个元素 → 多选抽屉 | `multi-edit-drawer` 可见；每行有 selector/文本；提交后队列 +2 或合并同 selector |
| 批量校验 | 空需求/超长文本 | `multi-edit-status` 给出明确错误；不静默入队 |
| 待提交 | 移除单项/清空全部 | 均出现 `confirm-dialog`；确认后 `multi-edit-bar` 消失；`edit_queue_v1` 为 `[]` |
| 持久化 | reload 后再开 | 队列仍在；计数一致；顺序稳定 |

**严禁**：就地改/多选直接调用 `ai:ask` 或打开 AI 对话框。检查 `page.getByTestId('ai-dialog').count()===0`，并可在主进程记录 `ai:ask` 调用次数为 0。

### 7.4 检查器 / 标注 / 链接（本域只验入口与写盘）

- 检查器三板块：修改需求 / 跳转交互 / 需求标注；默认首板块展开；折叠态写 `linkInspFold_v1`。
- 加需求：`inspector-req-input` + `inspector-req-add` → 入待提交队列（不是直接改 HTML）。
- 绑定跳转：目标下拉 `inspector-jump-target-pick` 选「我的」；保存后 `links.json` 新增一条，三键 `selector/page/htmlFile` 非空。
- 加标注：`inspector-anno-input` + `inspector-anno-save`；写 `annotations.json`；角标 `overlay-anno-badge` 出现。
- 所有删除必须走 `Confirm`，禁止原生 `confirm()`。

### 7.5 失败特征

| 现象 | 优先判级 | 说明 |
| --- | --- | --- |
| Ctrl 悬停无 `pick-hover` | P1 | 拾取态未武装；查 `CTRL_STATE`/`PICK_REQUEST` |
| 点选后 selector 空 | P1 | `generateSelector` 失败或事件载荷丢失；不能继续就地改 |
| 就地改写错元素/写坏 HTML | P0 | 立即停止，保留文件 hash 与截图 |
| 多选计数与 selection box 不一致 | P1 | Stage 状态与 overlay 不同步 |
| 待提交刷新丢失 | P1 | `edit_queue_v1` 未写/被覆盖 |
| 检查器保存后 JSON 未变 | P1 | 写盘/IPC 失败；检查 toast 与文件 |
| 标注角标不显示但数据已写 | P2 | 渲染/rect 计算问题 |

---

## 8. 文档专项

### 8.1 打开与形态

- PC：`docs-panel[data-variant=overlay]`，`fixed bottom-4 right-4 top-12 w-[400px] z-50`；打开前后 `stage-frame` 宽度不变（基线 887→887）。
- 移动：`docs-panel[data-variant=inline]`，`relative z-50 w-[320px] max-w-[45%] border-l`；舞台逻辑尺寸仍 375×780。
- 关闭：Esc 或头部 X；关闭后 `overlays-toolbar` 命中恢复正常，不残留遮罩。

### 8.2 目录跳转与 Ctrl+F

- 目录：`doc-toc-item` ≥6；点击后 `[data-doc-scroll]` 的 `scrollTop` 增大，目标 `[data-toc-id]` 进入视口；移动端目录是抽屉 `doc-toc-drawer`，打开/关闭不拦截 Tab。
- 搜索框：`doc-search` 只过滤目录（当前实现），不清空正文；输入「商品」后条目减少，清空恢复。
- `Ctrl+F`：
  - 规范来源：`ShortcutTab.tsx:25` 声明 `Ctrl+F = 搜索`。
  - 静态预判：`src/renderer` 仅见该声明，未见 `keydown` 绑定；执行时先按实际记录。
  - 判定：焦点进入 `doc-search` 且可输入 → PASS；完全无反应 → P1（快捷键契约缺失）或按产品确认降 P2；打开 Electron 原生查找但不能搜正文 → P2。

### 8.3 微改 / 保存守卫

- 微改：hover 段落 → `doc-micro-edit` → Popover 预填 → 修改 → 「应用」→ `docs-store.save()`；成功 toast；失败保留草稿并进入编辑态。
- 整篇：`进入编辑` → `doc-edit-area` contenteditable → 修改 → `保存`；`未保存` Badge 消失；`saving` 不卡死。
- 保存守卫：切换原型/版本变化时，`sourceDir`/`sourceVer` 不匹配要阻断并 toast「保存已阻断/已切换原型/版本已变化」；不能把 A 原型的草稿写到 B。
- 还原：微改/整篇保存后，必须用同样方式还原到基线内容，最终 `Get-FileHash` 与备份一致；否则后续域会拿到脏文档。

### 8.4 独立窗 mirror

1. 在主窗打开文档，记录当前 Tab/内容。
2. 先注册 `const winPromise = app.waitForEvent('window')`，再点「独立窗口」。
3. 新页 `doc-window` 可见，无 `main-window`；标题/内容与主窗一致。
4. 主窗切「最新需求」→ 独立窗内容同步；独立窗切「功能说明」→ 主窗 Tab/内容同步（mirror-back）。
5. 关闭独立窗（X 或 `page.close()`）→ 主窗回 panel；「独立窗口」按钮重新可用；再次打开成功。
6. 失败判级：不同步 P1；关闭后主窗卡死/白屏 P0；按钮状态慢 P2。

### 8.5 移动端文档

- 顶栏切「移动」→ 点「文档」→ `docs-panel[data-variant=inline]`。
- 点「最新需求」：`aria-selected=true`，Tab 中心 `elementFromPoint` 命中 `docs-panel-content` 内部，不能被 `overlays-toolbar` 拦截（Wave3 P1 回归点）。
- 目录抽屉：打开后可见 `doc-toc-drawer`，背景遮罩 `doc-toc-backdrop`；点条目跳转后抽屉关闭。
- 关闭文档后，`overlays-toolbar` 按钮恢复可点。

### 8.6 文档导出

| 格式 | 触发 | 验证 |
| --- | --- | --- |
| Markdown | `docs-export-md` | Blob 下载；文件内容=当前 `docContent`；文件名安全 |
| PNG | `docs-export-png` | 主进程保存对话框 stub；文件头 `89 50 4E 47`；非 0 字节；toast |
| PDF | `docs-export-pdf` | 文件头 `%PDF`；非 0 字节；toast |

A 阶段只要求 Markdown + 一种图片/PDF；B 阶段三种全验。若保存对话框未 stub，Electron 原生对话框会阻塞 Playwright，必须按 §2.3 的 harness 处理。

### 8.7 文档失败特征

| 现象 | 判级 | 说明 |
| --- | --- | --- |
| 保存后文件截断/乱码 | P0 | 立即停止，保留原文件备份与 hash |
| 保存 toast 成功但磁盘未变 | P1 | 假成功，最危险 |
| 微改 Popover 打开但应用无效 | P1 | `apply()`/save 链路断 |
| 移动端 Tab 被工具栏遮挡 | P1 | Wave3 P1 回归 |
| mirror 单向 | P1 | 主/独窗状态分叉 |
| 目录跳转不滚动 | P1 | `data-toc-id`/scroll 容器不匹配 |
| Ctrl+F 无反应 | P1/P2 | 按 §8.2 判定 |
| 导出文件 0 字节 | P1 | 全部格式失败；单格式 P2 |

## 9. 报告模板（每域一份）

文件：`docs/wave4/reports/<domain>.md`；A/B 共用模板，只改阶段字段。

```markdown
# Wave4 <阶段 A/B> · <域名称> 报告

- 日期：
- Agent / owner：
- 阶段：A 冒烟 / B 全量体验
- 代码版本：`git rev-parse HEAD` =
- 构建：`dist/renderer` 构建时间 / 入口 hash =
- 环境：Windows / Node / Electron / Playwright
- 数据目录：`PLAND_DEV_DATA_DIR` =（实际 `app.getPath('userData')` =）
- 运行命令：
  `npx playwright test e2e/wave4-<domain>.spec.ts --workers=1 --output=test-results/wave4/<domain>`
- 真实请求/网络：AI_REQUESTS=0/1；GIT_NETWORK=无/本地 bare/真实远端

## 1. 步骤结果

| # | 步骤 | 结果（PASS/FAIL/SKIP） | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 |  |  | 截图/文件/DOM/日志 | — / P0 / P1 / P2 / P3 |
| 2 |  |  |  |  |

> 证据写法：`docs/wave4/shots/<domain>/01-xxx.png`；`%TEMP%\pland-wave4\...\file` + size + sha256 前 12 位；`[data-testid=...]` + 文本/数量；console 原文摘录。

## 2. 缺陷

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| <domain>-P1-1 | P1 |  |  |  |  |  |

## 3. 观察区（A 阶段 P2/P3 只记录，不阻断）

| ID | 级别 | 现象 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- |

## 4. 结论

- 结果：**可放行 / 需修复**
- P0 = 0；P1 = 0；P2 = n；P3 = n；ENV = n
- 阻断项：
- 复测范围：
- 备注：
```

### 9.1 汇总报告模板（协调者）

`docs/wave4-smoke-report.md`（A）：

```markdown
# Wave4 A 冒烟汇总

| 域 | 结果 | P0 | P1 | P2(观察) | 关键证据 | owner |
| --- | --- | --- | --- | --- | --- | --- |
| AI |  |  |  |  |  |  |
| ... |  |  |  |  |  |  |

## 阻断缺陷
| ID | 域 | 现象 | 证据 | 修复状态 |
## 放行结论
- A：可进入 B / 需修复（列出 P0/P1）
- 复测命令与结果：
- 致命 console error 总数：
```

`docs/wave4-experience-report.md`（B）额外列：

```markdown
## P2 优先级（按影响 × 频率）
| 排名 | ID | 域 | 影响 | 频率 | 建议 | 状态 |
## P3 backlog
## 最终建议：可放行 / 外发前修 / 需返工
```

### 9.2 结论判定

| 结论 | 条件 |
| --- | --- |
| **可放行** | A：P0=P1=0；B：P0=P1=0，P2 已分级且有 owner/waiver |
| **需修复** | 存在未关闭 P0/P1；或 P2 影响核心路径且无替代 |
| **需返工** | 多域 P0/P1 连锁、构建/数据隔离本身不可靠 |
| **ENV-BLOCKED** | 环境不满足（Agent 未装/无网络/配额/构建 stale）；不算产品结论，重排环境后重跑 |

---

## 10. 预计执行顺序

### 10.1 排程（1 协调者 + 8 域 agent，3 并发槽）

| 时间 | 动作 | 并发 | 产出 |
| --- | --- | --- | --- |
| T+0:00–0:30 | **Phase 0**：UI 冻结、`build:renderer`、seed、harness、空白报告骨架；跑一次 `--list` 验证 spec 可发现 | 1 | `dist/renderer`、`%TEMP%\pland-wave4\seed`、`e2e/wave4/_harness.ts` |
| T+0:30–1:15 | **A1**：shell + stage + settings | 3 | 3 份域报告 |
| T+1:15–2:00 | **A2**：pick + docs（只读/微改/docwin 分开）+ export（源码 JSON） | 2–3 | 3 份域报告 |
| T+2:00–2:20 | **A3a**：AI 真实发送（独占） | 1 | AI 报告真实段 |
| T+2:20–2:40 | **A3b**：Git 本地 bare 写（独占） | 1 | Git 报告 |
| T+2:40–3:00 | **A3c**：文档独立窗 mirror（独占） | 1 | Docs 报告 docwin 段 |
| T+3:00–3:20 | **A3d**：AI mock 停止/权限/重试（可与 UI 槽并行） | 1–2 | AI 报告 mock 段 |
| T+3:20–3:50 | **A4**：汇总、去重、P0/P1 分派、A 报告 | 1 | `docs/wave4-smoke-report.md` |
| 修复窗口 | 只修 P0/P1；每修一项复跑该域 + 相邻 smoke | 按 owner | 修复记录/复测 |
| B 启动 | A 的 P0/P1 全关闭且复测通过 | — | B 入口签字 |
| B1 | 8 域 P2 功能/体验，3 槽滚动；独占项排窗口 | 3 | 8 份 B 报告 |
| B2 | 视口/键盘/空态/长内容/重启交叉 | 2 | 交叉矩阵 |
| B3 | P2 排序、P3 backlog、最终报告 | 1 | `docs/wave4-experience-report.md` |

### 10.2 建议的最短路径（时间紧时）

1. Phase 0 + A1 shell/stage/settings（45 min）。
2. A2 pick + docs 核心 + export JSON（45 min）。
3. A3 AI 真实 1 次 + Git 本地 push/pull + docwin（45 min，串行）。
4. A4 汇总；只修 P1；复测。
5. B 只做 P2 功能 + 视口/键盘，P3 全部进 backlog。

### 10.3 执行前检查清单

- [ ] UI 并行开发已冻结/合并；`git status` 中的 `src/**` 不再变化；记录 HEAD + dist hash。
- [ ] `npx tsc --noEmit`、`npx vitest run`、`npx playwright test`（基线）通过；或明确记录已知失败。
- [ ] `main.js:14-29` 的 `PLAND_DEV_DATA_DIR` 在当前运行版本中存在；启动后 `app.getPath('userData')` 断言通过。
- [ ] 8 个数据目录从同一 seed 复制；seed 未被写；无共享 `.devdata` 写入。
- [ ] AI Agent/模型配对预检通过；真实请求预算=1；旧失败会话已清。
- [ ] Git 本地 bare 远程可 push/pull；真实 gitee 未配置为默认。
- [ ] 原生保存对话框已 stub；`will-download` 重定向目录已清空。
- [ ] Playwright 只跑单域 spec，`--output` 独立；无裸跑全量。
- [ ] 每域截图/报告/日志目录已创建；命名符合 §5.3。

### 10.4 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| UI 并行开发边改边测 | 结果不可复现、testid 漂移 | Phase 0 冻结；发现 `src/**` 变化立即 `STALE-BUILD` 停止 |
| `PLAND_DEV_DATA_DIR` 未生效/回退 `.devdata` | 多 agent 互抢项目/凭据 | harness 启动后断言 userData；失败即 FAIL，禁止继续 |
| AI Agent 与模型不匹配 | 真实发送必失败，浪费额度 | 发送前预检；历史错误出现即修隔离配置；最多 2 次请求 |
| AI 连续发送烧额度 | 成本/限流 | 真实只 1 次；停止/重试/权限走 mock；报告记 `AI_REQUESTS` |
| Git 真实远端副作用 | 污染测试仓库/冲突 | 默认本地 bare；真实 gitee 仅 `GIT-NET` 独占且需审批 |
| docwin 多窗口抢焦点 | 点击错窗/超时 | `DOC-WIN` 独占；先注册 `waitForEvent('window')` 再点 |
| 原生保存对话框阻塞 | 测试挂起 | `dialog.showSaveDialog` stub 到输出目录；超时 10s |
| `page` download 事件不触发 | 误判导出失败 | 主进程 `will-download` 重定向 + 文件落盘/魔数作为强证据 |
| React 侧 `Ctrl+F` 未绑定 | 快捷键契约缺失 | 先记录实际；按 §8.2 判 P1/P2；不阻塞文档主路径 |
| 数据漂移（Agent 数/文档字数） | 假失败 | 断言不变量/范围，不写死 26/3353 |
| `.devdata` 复制时被占用 | seed 损坏/锁 | 复制前关所有 Electron；清 `Singleton*`/`DevToolsActivePort` |
| Playwright workers=1 被误解 | 无法并行 | 不改 config；多个独立命令/进程并行，单命令内串行 |

### 10.5 完成定义（DoD）

- 8 份域报告齐全，均有步骤表、证据、缺陷表、结论。
- A：P0=0、P1=0；所有域进程 exit 0；致命 console error=0；A 汇总报告签字。
- B：P0/P1=0；P2 有优先级/owner/waiver；P3 有 backlog；最终报告给出“可放行/外发前修/需返工”。
- 所有写入只发生在隔离数据目录与 `docs/wave4/**`、`e2e/wave4-*.spec.ts`、`e2e/wave4/_harness.ts`；未改产品代码、未 commit、未 `npm install`。

---

## 附录 A：域与关键 testid 速查

| 域 | 关键锚点 |
| --- | --- |
| AI | `ai-dialog`、`ai-dialog-session`、`ai-model-selector`、`ai-model-select`、`ai-thinking-select`、`ai-prompt-textarea`、`ai-send-btn`、`ai-stop-btn`、`ai-chat`、`[data-slot="ai-message-ai"]`、`ai-trace-toggle`、`ai-trace-view`、`ai-permission-card`、`ai-session-new/stop/retry` |
| Ctrl 拾取 | `stage-frame`、`preview-frame`、`pick-status`、`pick-hover`、`pick-overlay`、`.selection-box-overlay`、`overlays-selection-count`、`overlays-open-inspector`、`overlays-open-inline`、`overlays-open-multi`、`multi-edit-drawer`、`multi-edit-bar`、`overlays-open-queue` |
| 文档 | `docs-panel`、`docs-panel-content`、`doc-toc-sidebar`、`doc-toc-item`、`doc-search`、`doc-preview`、`doc-micro-edit`、`doc-edit-area`、`docs-export-menu`、`docs-export-md/png/pdf`、`doc-window`、`doc-toc-drawer` |
| 主壳 | `main-window`、`topbar`、`sidebar`、`sidebar-tree`、`project-switch`、`project-menu`、`project-search`、`project-create`、`project-create-input`、`topbar-refresh`、`topbar-terminal`、`loc-pill`、`mini-dock` |
| 舞台 | `stage-frame`、`stage-empty`、`stage-viewport`、`stage-subpages`、`stage-zoom-readout`、`preview-frame`、`stage-toolbar` |
| 设置 | `settings-dialog`、6 个 tab、`agent-matrix`、`agent-row-*`、`engine-cli`、`engine-api`、`model-manager`、`model-manager-count`、`settings-loading`、`settings-error`、`about-version` |
| Git | `git-sheet`、`git-panel`、`git-branch-select`、`git-total`、`git-mode-status/diff`、`git-file-row`、`git-message`、`git-push`、`git-pull`、`git-refresh`、`git-config-open`、`git-config-dialog`、`git-test-connection`、`git-cancel` |
| 导出/标注/快照/链接 | `export-menu`、`export-source/html/png/pdf/md`、`overlays-open-anno`、`anno-panel`、`anno-visible-switch`、`overlays-open-snapshot`、`snapshot-panel`、`snapshot-item`、`snapshot-restore`、`confirm-dialog`、`overlays-open-links`、`overlays-link-item`、`overlays-link-jump`、`overlays-queue-*` |

## 附录 B：本文未覆盖

- legacy 渲染器全量回归（只做启动/骨架/退出 sanity；见 `e2e/electron-live.spec.ts` B 用例）。
- 安装包/asar 打包（见 `docs/final-gate-report.md` §1.2；本轮不重复 `npm run build`）。
- 性能基准/长稳测试（B 只做主观延迟记录，不做硬性 SLA）。
- 真实 gitee 远端写操作、真实付费模型矩阵、真实多用户并发（需单独审批/配额）。
