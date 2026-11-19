# Wave4 A 冒烟 · 主壳 / 项目 / 侧栏 报告

- 日期：2026-11-13（最后一次运行 12:48–12:49）
- Agent / owner：Wave4 A1 shell 子代理（DeepSeek V4.1 Flash 1017）
- 阶段：A 冒烟（只判 P0/P1；文案/像素/间距不报）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（main）
- 构建：`dist/renderer/assets/index-BHMDlo45.js`，329,649 B，mtime 2026-11-13 12:36:16，SHA-256 `d525c677f6bb…`；`dist/renderer/index.html` SHA-256 `198725714478…`（与冻结报告一致）
- 环境：Windows / Node 24.15.0 / Electron 37.10.3 / Playwright 1.65.0
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-shell`
  - 实际 `app.getPath('userData')` = 同一路径（精确相等，非后缀匹配）
  - `seedPresent=true`；`_wave4-seed.json` 存在；`app.isPackaged=false`（harness 断言通过）
- Seed：`node e2e/wave4/seed.mjs --domain shell --force`，107 文件 / 526,712 B，源指纹 `0c11ddd5…`
- 运行命令：
  `npx playwright test e2e/wave4-shell.spec.ts --workers=1 --output=test-results/wave4/shell`
- 真实请求 / 网络：`AI_REQUESTS=0`；`GIT_NETWORK=无`（Git 只打开面板，未执行网络/写操作）；终端 `ai:open-terminal` 用主进程 stub，未真实拉起 shell
- 关闭：`window-close`，exit 0，3,610 ms；测试总耗时 18.6 s
- 结论速览：**PASS**；P0=0，P1=0，P2=1（Esc 栈观察），SKIP=1（子页排序，seed 无子页）

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 | 冷启动 / 项目下拉（项目与原型数、搜索过滤、新建、切换） | **PASS** | `main-window`/`topbar`/`sidebar`/`stage-frame` 可见；未弹项目选择器，自动恢复「测试1」；项目下拉 1 项，`测试1` 显示「2 个原型」；搜索「测试」=1 项，搜索不存在项目=0 项且显示「无匹配项目」；新建 `W4-临时-124849` 并进入（侧栏「暂无原型」、`stage-frame[data-has-source=0]`）；下拉切回「测试1」后侧栏 2 个原型。截图：`docs/wave4/shots/shell/01-cold-start.png`、`01-project-menu.png`、`01-project-search-empty.png`、`01-project-created-empty.png`、`01-project-switched-back.png` | — |
| 2 | 侧栏真实原型 / 选中态 / 子页 | **PASS** | 原型=2（`我的`/`首页`），无「示例」假数据；点击后 `loc-pill` 同步；选中行唯一，`background=rgb(255, 255, 255)`、`color=rgb(9, 9, 11)`，无蓝色；选中行文本严格等于原型名（无计数）；子页按钮=0、子页折叠按钮=0（seed 无子页）。截图：`02-proto-home-selected.png`、`02-proto-mine-selected.png` | — |
| 3 | 新建文件夹 / 行内重命名（Enter+Esc）/ 原型与文件夹跨组拖拽 / 折叠 | **PASS** | 新建「W4-文件夹」；双击 → `Esc` 取消（名称不变）→ 双击 → `Enter` 提交为「W4-改名」，`localStorage.protoGroups_v1__测试1` 已写入；`首页` 拖入文件夹时 `data-dragging=true`，分组 `map[首页]` 指向该文件夹；折叠后 `首页` 隐藏，展开后恢复；拖到 tail 回到未分组，map 键清除并出现「空文件夹 · 可拖入原型」；「W4-改名」拖入「W4-父」，localStorage 中 `parent` 指向父文件夹 id。截图：`03-folder-created.png`、`03-rename-esc-cancelled.png`、`03-rename-enter-committed.png`、`03-proto-dragged-into-folder.png`、`03-folder-collapsed.png`、`03-folder-expanded.png`、`03-proto-dragged-out.png`、`03-folder-dragged-into-parent.png` | — |
| 3b | 子页排序 | **SKIP** | seed 的「首页」「我的」目录均只有主 html（`subPages=0`），无可排序子页；未伪造数据。原因符合 A 阶段允许的 SKIP 口径 | — |
| 4 | 侧栏收起 → MiniDock（展开 / AI 设计 / 设置） | **PASS** | 收起后 `sidebar` 数量=0，`mini-dock` 可见，含「展开侧栏 / AI 设计对话 / 设置」三入口；AI 设计→`ai-dialog` 可见、Esc 关闭；设置→`settings-dialog` 可见、Esc 关闭；展开侧栏→`sidebar` 恢复、dock 消失。截图：`04-mini-dock.png`、`04-minidock-ai-opened.png`、`04-minidock-settings-opened.png`、`04-sidebar-restored.png` | — |
| 5 | 顶栏刷新 / 功能说明 / 最新需求 / AI / Git / 导出 / 设置 / 终端 / Esc | **PASS** | 刷新后原型仍为 2（`我的`/`首页`，无重复），当前选择保持「测试1 / 我的 / —」；功能说明→`docs-panel[data-variant=overlay]` 且「功能说明」Tab `aria-selected=true`，Esc 关闭；最新需求→`docs-panel` 且「最新需求」Tab 选中，Esc 关闭；AI→`ai-dialog`、Git→`git-sheet`、导出→5 项菜单（source/html/png/pdf/md）、设置→`settings-dialog`，均 Esc 关闭；终端按钮点击→stub 调用 1 次、主窗仍可见、无崩溃。截图：`05-topbar-refreshed.png`、`05-docs-desc.png`、`05-docs-latest.png`、`05-ai-panel.png`、`05-git-panel.png`、`05-export-menu.png`、`05-settings-panel.png`、`05-terminal-stub-click.png`；Esc 栈见 `05-esc-stack-before.png`、`05-esc-stack-after-1.png`（P2 观察，不阻断本步） | — |
| 6 | console / pageerror 观察 | **PASS** | console error=0（原始 0，致命 0）；pageerror=0；crash=0。截图：`06-final.png` | — |

> 截图目录：`docs/wave4/shots/shell/`；表中未写全路径的 `.png` 均位于该目录下。

## 2. 缺陷（P0/P1）

**P0 = 0；P1 = 0。** 未发现崩溃、白屏、项目无法进入、侧栏丢原型、面板打不开、进程无法退出等功能阻断项。

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | 无 | — | — | — | — |

## 3. 观察区（A 阶段 P2/P3 只记录，不阻断）

| ID | 级别 | 现象 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- |
| shell-P2-1 | P2 | 文档 + 设置 + AI 三层同时打开时，按 **1 次 Esc**，AI 与设置同时关闭，只保留文档；DOM 计数从 `ai/settings/docs = 1/1/1` 变为 `0/0/1`，不符合「一次只关一层」 | 是（B2 键盘/Esc 栈；仅合成路径可复现） | 位置：`src/renderer/app/modes/MainWindow.tsx:80-88` 的 window `keydown` 调 `closeTopmost()`；`src/renderer/stores/ui-store.ts:130-153` 按 AI > 设置 > Git > 导出 > 文档依次关。推测 Radix Dialog 先在同一 Escape 事件里关闭 AI（`closeAi`），事件继续冒泡到 window，`closeTopmost()` 又关闭设置。复现：打开文档 →（文档遮罩拦截顶栏，测试用 DOM `click()`）打开设置 → 打开 AI → 按 1 次 Esc。证据：`docs/wave4/shots/shell/05-esc-stack-before.png`（设置+AI 可见）、`05-esc-stack-after-1.png`（只剩文档）。真实 UI 下文档遮罩覆盖顶栏，该三层状态需程序化点击才能到达，故不判 P1 |

## 4. 结论

- 结果：**可放行（本域）**
- P0 = 0；P1 = 0；P2 = 1；P3 = 0；ENV = 0；SKIP = 1（子页排序，seed 无子页）
- 阻断项：无
- 复测范围：`e2e/wave4-shell.spec.ts` 全量 1 test，18.6 s，exit 0；进程 `window-close` exit 0
- 备注：
  - `W4-临时-*` 临时项目、`W4-文件夹/改名/父` 分组只写入隔离目录 `.devdata-wave4-shell`，测试结束已删除，不影响真实 `.devdata`。
  - 终端未真实拉起：主进程 stub `ai:open-terminal` 返回 `{ok:true}` 并计数 1 次，满足“按钮可点/不崩溃、不占用 shell”。
  - AI/Git 仅验证面板打开与 Esc 关闭；未发送真实 AI 请求、未执行 Git 网络/写操作。
  - 子页排序 SKIP 的原因已在 `3b` 写明；未创建假子页数据。
  - 运行产生的 `test-results/wave4/shell/**` 与临时运行日志已清理，未纳入证据；证据只使用 `docs/wave4/shots/shell/**`。
