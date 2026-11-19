# Wave4 A 冒烟 · Ctrl 拾取 / 就地编辑 / 多选 报告

- 日期：2026-11-13
- Agent / owner：A2 子代理（wave4 pick）
- 阶段：A 冒烟
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer` 构建时间 2026-11-13 12:36:16；主 chunk `assets/index-BHMDlo45.js` 329,649 B，SHA256 前 12 位 `D525C677F6BB`
- 环境：Windows / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；截图实际输出 2560×1459
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-pick`；实际 `app.getPath('userData')` 精确相同（harness 启动断言 + 用例内二次断言）
- seed：`_wave4-seed.json` present；manifest SHA256 前 12 位 `8446403CA23B`；seed 源项目 `测试1`（`首页` / `我的`）
- 运行命令：
  `npx playwright test e2e/wave4-pick.spec.ts --workers=1 --output=test-results/wave4/pick`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无

## 0. 结论先行

**PASS / 可放行（A 冒烟）**：P0=0，P1=0。

Ctrl 拾取（悬停准星/`pick-hover`/点选 selector）、就地改（Ctrl+Enter 入队、Esc 放弃）、多选（Ctrl/Ctrl+Shift、批量/逐个校验）、检查器（三板块、需求入队、跳转写盘）、标注面板（2 条、定位、删除 Confirm）、链接面板、待提交条（显示条件、移除/清空 Confirm、`[]` 持久化）全部通过。`首页.html` 全程 SHA256 不变；console/pageerror/crash 均为 0；进程 `window-close` exit 0。

另有 2 条非阻断 P2 观察（见 §4），不计入 A 结论。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离 + 进入 `测试1/首页` | PASS | `userData` 与 `.devdata-wave4-pick` 精确一致；项目选择器未弹（自动恢复「测试1」）；`stage-frame[data-kind=mobile][data-fit=on]`；清空旧 `edit_queue_v1` 后队列=0；基线：`首页.html` SHA256 前 12 位 `2D72B71839FC`、annotations=2、links=2 | — |
| 1 | Ctrl 按住悬停 + 点选 + selector | PASS | 悬停：`pick-status`=「拾取中」；帧内注入 `style#ctrlPickCrosshairStyle`，元素命中点 `cursor=crosshair`；`pick-hover` bbox=`72.999×21.998 @ (581.997, 491.996)`，与元素换算值（scale=0.6008，frame 375×780→屏幕）误差 ≤0.01px；松开后 `pick-status`/准星样式均为 0。点选：`overlays-selection-count`=1、`.selection-box-overlay`=1、`.selection-badge`=1；检查器 selector=`[data-pr-id="pr-p-39"]`（非空，命中 data-pr-id）、徽标「页面: 首页」「文件: 首页.html」 | — |
| 2 | 就地改：Ctrl+Enter / Esc | PASS | 编辑条预填原文「轻薄透气运动跑鞋 春秋季新款」；改为 `W4-就地改-文字` 后 Ctrl+Enter：编辑条关闭、`multi-edit-count`=1、`edit_queue_v1` 条目=`将该元素内容改为：W4-就地改-文字`（selector=`[data-pr-id="pr-p-39"]`）；`ai-dialog`=0。再次打开改 `W4-Esc-应放弃` → Esc 出现条内二次确认 → 「放弃修改」后编辑条关闭、队列仍=1 且文本未变；`首页.html` hash 不变 | — |
| 3 | 多选 2 元素 + 批量/逐个校验 + 入队 | PASS | Ctrl 点第 2 个商品名（`pr-p-43`）+ Ctrl+Shift 点第 3 个（`pr-p-47`）：计数=2、选中框=2；`multi-edit-drawer` 标题「已选中 2 个元素」、2 个 chip；批量空提交被拦截「请输入统一修改诉求。」；切「逐个修改」`aria-selected=true`、2 个逐项输入，空提交被拦截「请至少为一个元素填写修改诉求。」；回批量填 `W4-批量：统一加大行高` 提交 → 抽屉关闭、选择清空、队列 1→3，新增 2 条 selector 分别为 `pr-p-43` / `pr-p-47` 且默认选中 | — |
| 4 | 检查器：三板块 + 需求 + 跳转写盘 | PASS | 选中 `[data-pr-id="pr-div-35"]` 后打开 `overlays-sheet-inspector`：`inspector-sec-req` / `inspector-sec-jump` / `inspector-sec-anno` 均可见；填需求「W4-需求：统一增加页面留白」→ 队列 3→4；「跳转交互」展开选目标「我的」→ 保存后 `inspector-jump-state`=「已绑定」，`links.json` 2→3，新条目 `selector=[data-pr-id="pr-div-35"]`、`target=我的`、`htmlFile=首页.html`、`page=""`（主页口径，与 seed 既有 2 条一致）；「需求标注」展开可见且为「未标注」 | — |
| 5 | 标注面板 2 条 / 定位 / 删除 + 链接面板 | PASS | 打开标注面板：`anno-panel-count`=2、2 个 `anno-panel-item`；删除第 2 条（`[data-pr-id="pr-span-24"]` / 「进入秒杀」）→ Confirm「删除标注」→ `annotations.json` 2→1，被删 selector 不再落盘；点第 1 条定位 → 切到检查器并回显「已标注」+ 标注内容「标注111」（selector=`[data-pr-id="pr-input-1"]`）；链接面板可打开且列出 3 条（含步骤 4 新增的 `pr-div-35 → 我的`） | — |
| 6 | 待提交条：显示 / 移除 / 清空 | PASS | 空队列时 `multi-edit-bar` 数量=0；有 4 条时显示且 `multi-edit-count`=4；点条内 × → Confirm「移除待提交项」→ 4→3；点「清空」→ Confirm「清空待提交」→ 条消失、队列 0、`edit_queue_v1` 持久化为 `[]`；toast「已清空待提交列表。」 | — |
| 7 | 数据完整性 / console / 退出 | PASS | `首页.html` SHA256 与基线一致（`2D72B71839FC`）；annotations=1（2→1）、links=3（2→3）、queue=0；`consoleErrors=[]`、`pageErrors=[]`、`crashes=[]`、致命项=0；`close`=`window-close` / exitCode 0 / 295ms；测试 1 passed（25.3s） | — |

> 口径说明（非缺陷）：本构建的就地改按设计**只入待提交队列**，不直接改写原型 HTML（`src/renderer/features/preview/PreviewOverlaysHost.tsx:719-745`，`handleInlineSubmit` 只 `enqueue`）。因此“页面文本立即变化”不会发生；这与 `docs/wave4-smoke-plan.md` §3.2 第 5 步（toast「已加入待提交队列」、队列 +1）一致。本轮以计划口径判定 PASS，并以 `首页.html` hash 不变作为数据安全证据。

## 2. 截图

目录：`docs/wave4/shots/pick/`（18 张）

| 文件 | 内容 |
| --- | --- |
| [`01-ctrl-hover.png`](../shots/pick/01-ctrl-hover.png) | Ctrl 按住、悬停商品名：`拾取中` + 帧内准星（悬停框 DOM 存在） |
| [`01-ctrl-pick.png`](../shots/pick/01-ctrl-pick.png) | 点选后计数=1、`.selection-box-overlay`=1 |
| [`01-selector-inspector.png`](../shots/pick/01-selector-inspector.png) | 检查器 selector `[data-pr-id="pr-p-39"]` + 页面/文件徽标 + 三板块 |
| [`02-inline-edit-open.png`](../shots/pick/02-inline-edit-open.png) | 就地改编辑条（预填原文，Ctrl+Enter 保存提示） |
| [`02-inline-edit-queued.png`](../shots/pick/02-inline-edit-queued.png) | 提交后队列条出现（计数 1） |
| [`02-inline-edit-esc-discard.png`](../shots/pick/02-inline-edit-esc-discard.png) | Esc 后条内二次确认「确定放弃本次就地改吗？」 |
| [`03-multi-selected.png`](../shots/pick/03-multi-selected.png) | Ctrl+Shift 多选 2 个元素，计数=2 |
| [`03-multi-validation.png`](../shots/pick/03-multi-validation.png) | 逐个修改 Tab + 空提交校验提示 |
| [`03-multi-queued.png`](../shots/pick/03-multi-queued.png) | 批量提交后队列=3 |
| [`04-inspector-jump.png`](../shots/pick/04-inspector-jump.png) | 检查器：需求已入队、跳转已绑定「我的」、三板块 |
| [`05-anno-panel.png`](../shots/pick/05-anno-panel.png) | 标注面板 seed 2 条（标注111 / 进入秒杀） |
| [`05-anno-delete-confirm.png`](../shots/pick/05-anno-delete-confirm.png) | 删除标注 Confirm（居中正常） |
| [`05-anno-locate.png`](../shots/pick/05-anno-locate.png) | 标注定位：检查器「已标注」+ 内容「标注111」 |
| [`05-links-panel.png`](../shots/pick/05-links-panel.png) | 链接面板 3 条（含新增 `pr-div-35 → 我的`） |
| [`06-queue-bar.png`](../shots/pick/06-queue-bar.png) | 待提交条：计数 4、预览、提交/清空 |
| [`06-queue-remove-confirm.png`](../shots/pick/06-queue-remove-confirm.png) | 移除待提交 Confirm（位置异常，见 §4 OBS-2） |
| [`06-queue-clear-confirm.png`](../shots/pick/06-queue-clear-confirm.png) | 清空待提交 Confirm（同上） |
| [`06-queue-cleared.png`](../shots/pick/06-queue-cleared.png) | 清空后条消失、toast、队列 badge=0 |

关键截图：

![Ctrl 拾取检查器](../shots/pick/01-selector-inspector.png)

![多选校验](../shots/pick/03-multi-validation.png)

![待提交条](../shots/pick/06-queue-bar.png)

## 3. 缺陷（P0 / P1）

**无。P0=0，P1=0。**

- 未发现：Ctrl 悬停无反应、点选 selector 为空、就地改写错元素、多选计数错、检查器/标注/链接保存失败、待提交丢失、原型 HTML 被改写、应用崩溃或进程无法退出。
- `annotations.json` / `links.json` 仅在隔离副本内按预期变化（2→1 / 2→3）；`首页.html` 全程 hash 不变。

## 4. 观察区（非阻断，A 不计入结论）

| ID | 级别 | 现象 | 复现 | 证据 | 是否进 B |
| --- | --- | --- | --- | --- | --- |
| pick-OBS-1 | P2（视觉/反馈） | Ctrl 拾取时**悬停框/选中框没有可见样式**：`pick-hover` 与 `.selection-box-overlay` 只有内联 left/top/size，无 border/background；界面只能靠帧内准星、「拾取中」和计数/裸数字角标判断。DOM 断言全部通过 | 1) 进入 `测试1/首页`；2) 按住 Ctrl 悬停商品名 → 只见「拾取中」和准星，无悬停高亮；3) Ctrl+点击 → 工具条计数=1、元素左上出现裸文本「1」，无选中描边 | `src/renderer/features/preview/PickOverlay.tsx:41-52` 只渲染裸 div；`src/renderer/**/*.css` 与 `dist/renderer/assets/*.css` 均无 `#editHover` / `.selection-box-overlay` / `.selection-badge` 样式。截图 `01-ctrl-hover.png`、`01-ctrl-pick.png`；DOM bbox 证据见步骤 1 | 是（建议补 legacy `edit-entry.js` 的悬停/选中样式；不影响 A 判定） |
| pick-OBS-2 | P2（布局） | 待提交条的 **Confirm 弹窗锚定在底部条内并被窗口下缘裁切**：遮罩与弹窗相对 72px 高的条定位，而非整个视口；「取消/移除(清空)」按钮贴底、部分在视口外。删除标注/链接的 Confirm 正常居中 | 1) 队列 ≥1 条；2) 点条内 ×（移除）或「清空」；3) 观察弹窗位置与按钮可见性 | `src/renderer/components/overlays/MultiEditBar.tsx:46-48` 根节点含 `-translate-x-1/2`（transform 建立 containing block），`Confirm` 在其内部（`:96-116`）；`src/renderer/components/ui/alert-dialog.tsx:56` 用 `fixed inset-0` → 相对条而非视口。截图 `06-queue-remove-confirm.png`、`06-queue-clear-confirm.png`；功能仍可点击完成，且可从「待提交」Sheet 的居中式 Confirm 走替代路径 | 是（建议 Confirm 统一 portal 到 body，或去掉条上的 transform） |

## 5. 结论

- 结果：**可放行（A 冒烟）**
- P0 = 0；P1 = 0；P2 = 2（观察区，非阻断）；P3 = 0；ENV = 0
- 阻断项：无
- 复测范围：`e2e/wave4-pick.spec.ts` 单文件单 worker，1 passed / 25.3s；`window-close` exit 0；致命 console/pageerror/crash = 0
- 备注：
  - 就地改按设计只入待提交队列，不直写 `首页.html`；若后续产品口径改为“立即改页面”，需另立需求，不属本轮缺陷。
  - 主页（非子页）的 `page` 为空串，是 seed 既有 `annotations.json` / `links.json` 的既有约定；三键中的 `htmlFile` 已写为 `首页.html`。
  - 本轮未修改 `src/**`、`main/**`、`tests/**`、`package.json`，未 commit；`.devdata-wave4-pick` 已在报告完成后清理，复跑前执行 `node e2e/wave4/seed.mjs --domain pick`。
