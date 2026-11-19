# Wave4 · 待提交 / 标注收敛复测报告

- 日期：2026-11-16
- Agent / owner：待提交/标注收敛子 agent（DeepSeek V4.1 Flash 1017）
- 范围：`PreviewOverlaysHost` 不再渲染 `MultiEditBar`；待提交只从工具栏入口打开；队列条目可编辑、底部固定提交/清空；标注面板内直编、定位只高亮、不再打开 Inspector
- 改动边界：只改 E2E 与本报告/截图；未改 `src/`、`main/`、`tests/`、`package.json`；未执行 `npm install`；未 commit
- 构建：复用 2026-11-16 11:38:37 的 `dist/renderer/index.html`（SHA256 前 12 位 `5B74D3BB49B1`）；本轮未重新 `build:renderer`
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`

## 0. 结论

**PASS。** `npx tsc --noEmit` 无输出（exit 0）；4 个 spec 共 **23/23 通过，0 failed**。

- 待提交断言已全部从底部 `multi-edit-bar` 收敛到工具栏 `overlays-open-queue` + `overlays-sheet-queue`；所有旧入口断言同时保留 `multi-edit-bar` 数量 = 0。
- 队列条目 `overlays-queue-text` 实测可编辑并落 `edit_queue_v1`；底部 `overlays-queue-footer` 与 `overlays-queue-scroll` 为兄弟节点，提交/清空按钮固定在滚动区外。
- 点击标注项：`overlays-sheet-inspector` 数量 = 0，标注 Sheet 保持打开，`anno-locate-highlight` 可见；`anno-panel-input` 面板内直编可落 `annotations.json`。
- `Ctrl+Shift` 修改文字已按当前实现校为「保存到代码」：直接改写源 HTML、**不入待提交队列**（同步修正旧「入队」断言）。
- 未放宽任何既有断言：队列条数、删除/清空 Confirm、持久化 `[]`、标注删除计数、链接条数、HTML 哈希边界均保持精确断言。

## 1. 过期契约与 E2E 同步

| # | 旧断言（已过期） | 新契约断言 | 覆盖位置 |
| --- | --- | --- | --- |
| 1 | Host 装配 `<MultiEditBar>`；待提交条常驻底部 | Host 装配 `overlays-open-queue` / `overlays-sheet-queue`；`multi-edit-bar` 与 `<MultiEditBar` 均为 0 | `e2e/overlays.spec.ts` 浮层装配 |
| 2 | `multi-edit-count` / `multi-edit-open` / `multi-edit-remove` / `multi-edit-clear` | 工具栏入口 `aria-label="待提交（N）"`；Sheet 内 `overlays-queue-item` / `overlays-queue-remove` / `overlays-queue-clear` | `overlays.spec.ts`、`wave4-pick.spec.ts`、`wave4-b-git-export.spec.ts` |
| 3 | 队列只读，操作在底部条 | `overlays-queue-text` 可编辑，失焦保存到 `edit_queue_v1`；底栏 `overlays-queue-footer` 在 `overlays-queue-scroll` 之外 | `wave4-pick.spec.ts` step 6；`overlays.spec.ts` 静态契约 |
| 4 | 点击标注 → 打开 `overlays-sheet-inspector`，检查器回显内容 | 点击标注 → `overlays-sheet-inspector` = 0，`data-located=1`，`anno-locate-highlight` 可见 | `wave4-pick.spec.ts` step 5；`wave4-b-git-export.spec.ts` step 8 |
| 5 | 标注只能在 Inspector 编辑 | `AnnoPanel` 每条自带 `anno-panel-input` / `anno-panel-save`，面板内直编落盘 | `overlays.spec.ts`；`wave4-pick.spec.ts` step 5 |
| 6 | `Ctrl+Shift` 保存按「将该元素内容改为：…」入队 | 保存到代码直接改写源 HTML；队列长度不变；HTML 哈希变化 | `wave4-pick.spec.ts` step 2 / step 7 |

> 第 6 条为复测中暴露的既有漂移（`PickModifyDialog` 已明确「不进入待提交队列」）；同步后 `wave4-pick` 的数据完整性边界改为「仅保存到代码改写一次 HTML」，与 `wave4-b-pick` 的现行断言一致。

## 2. 测试结果

执行命令：

```powershell
npx tsc --noEmit
node e2e/wave4/seed.mjs --domain pick,b-pick,b-git-export --force
npx playwright test e2e/overlays.spec.ts e2e/wave4-pick.spec.ts e2e/wave4-b-git-export.spec.ts e2e/wave4-b-pick.spec.ts --workers=1
```

| Spec | 用例 / 范围 | 结果 |
| --- | --- | --- |
| `e2e/overlays.spec.ts` | 19 条静态契约（装配、Stage 契约、标注/链接、快照、待提交 Sheet、持久化键） | **19 passed / 0 failed** |
| `e2e/wave4-pick.spec.ts` | A2 Ctrl 拾取全链路（7 steps：拾取/修改文字/多选/检查器/标注/待提交/完整性） | **1 passed / 0 failed** |
| `e2e/wave4-b-git-export.spec.ts` | B1 Git 全链路（11 steps）+ B2/B3 导出与浮层（14 steps：含标注定位、队列持久化/移除/清空、Esc/1024） | **2 passed / 0 failed** |
| `e2e/wave4-b-pick.spec.ts` | B pick 复测（普通点击/需求弹窗/修改弹窗/选中框同步/Sheet 焦点/队列编辑） | **1 passed / 0 failed** |
| **合计** | — | **23 passed / 0 failed（2.4m）** |

关键实测证据：

- 队列：`待提交（2）` → Sheet 内 2 条；编辑首条后 `edit_queue_v1[0].text` 更新；移除 Confirm 后 2→1；清空 Confirm 后条目 0、底栏 0、持久化 `"[]"`。
- 标注：seed 2 条 → 删除 1 条落盘 1 条；面板内改写后 `annotations.json` 含新内容；点击条目不出现 Inspector，`anno-locate-highlight` 可见。
- 修改文字：HTML `2D72B71839FC → 46AAC1D70CD9`，队列保持 0；后续步骤 HTML 不再变化。
- 数据完整性：`wave4-pick` annotations 2→1、links 2→3、queue 最终 0；`wave4-b-git-export` annotations 2→2、links 2→2、queue 最终 `[]`；过滤 seed 原型 CDN 噪声后致命 console/pageerror/crash = 0。

## 3. 关键截图

![待提交 Sheet：条目可直编，底部提交/清空在滚动区外](../shots/retest-queue-anno/queue-01-pick-queue-sheet.png)

![标注定位：面板保持打开，条目 data-located 高亮](../shots/retest-queue-anno/anno-01-pick-anno-locate.png)

![标注定位：元素出现橙色高亮框，未打开检查器](../shots/retest-queue-anno/anno-02-bge-anno-locate.png)

![B/Git-Export 域：待提交 Sheet 2 条 + 固定底栏](../shots/retest-queue-anno/queue-03-bge-queue-sheet.png)

![B/Git-Export 域：reload 后队列仍为 2 条](../shots/retest-queue-anno/queue-04-bge-queue-persist.png)

![清空后：Sheet 空态、底栏消失、localStorage=[]](../shots/retest-queue-anno/queue-05-bge-queue-cleared.png)

![修改文字：保存到代码直接改写 HTML，不入队](../shots/retest-queue-anno/modify-01-pick-save-to-code.png)

## 4. 执行说明与观察

- 首次复跑时 `b-pick` / `b-git-export` 域目录已被上一轮 `afterAll` 清理、`pick` 域 annotation 已被旧跑改写；按仓内约定先 `seed --force` 重建三域后复跑，最终全绿。种子指纹与当前 `.devdata` 不一致的告警属于既有 ENV 提示，不影响本域用例。
- `wave4-b-git-export` 的 `pickWithCtrl` 在「点击落进 iframe 后父窗收不到 keyup」时会偶发不弹需求条；已按 `wave4-pick` 同口径补发父窗 `keyup`，属于测试手势稳定性修复，不放宽断言。
- 队列 Sheet 在 step 10 结束后显式 Esc 关闭，避免后续 1024/焦点步骤被 Sheet 遮罩拦截。
- 未修改 `src/main/tests/package.json`；未执行 `npm install`；未 commit。

## 5. 改动文件

| 文件 | 说明 |
| --- | --- |
| `e2e/overlays.spec.ts` | 装配断言改为待提交 Sheet；新增标注面板直编 / 定位只高亮静态契约 |
| `e2e/wave4-pick.spec.ts` | step 2 修改文字改「保存到代码」；step 5 标注定位高亮 + 面板直编；step 6 待提交 Sheet 编辑/底栏/移除/清空；step 7 HTML 哈希边界 |
| `e2e/wave4-b-git-export.spec.ts` | step 8 标注定位不打开检查器；step 10 待提交入口/Sheet/计数/移除/清空；`pickWithCtrl` keyup 稳定性 |
| `docs/wave4/reports/retest-queue-anno.md` | 本报告 |
| `docs/wave4/shots/retest-queue-anno/*.png` | 8 张证据截图（队列 Sheet、持久化、清空、标注定位、修改文字） |
