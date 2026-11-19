# 移动端 inline 文档层级修复 · 真机复测报告

- 日期：2026-11-18
- Agent / owner：移动端文档层级修复子代理（DeepSeek V4.1 Flash 1017）
- 范围：仅 `src/renderer/components/shell/DocsPanelHost.tsx`、`e2e/wave4-mobile-viewport.spec.ts`、`e2e/electron-functional.spec.ts`、`e2e/electron-live.spec.ts`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；实际 inner viewport `1123×640`
- 数据目录（真机探针）：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-mobile-docs-zindex`；`app.getPath('userData')` 精确相同，`app.isPackaged=false`，`_wave4-seed.json` present
- 未 commit；未改其他源码 / 测试 / `package.json`，未执行 `npm install`

## 0. 结论先行

**PASS**：移动端 inline 文档由 `z-50` 降到 `z-40`，位于 Stage / 预览工具条（计算 `z-index: auto`）之上、Dialog / Sheet（`z-50`）之下。移动端默认打开文档时，侧栏「新建子页面」Dialog 可正常显示、输入框可聚焦可输入，关闭 Dialog 后文档仍保持打开；设置 / AI / Git 三个弹层也均在文档之上可操作。

- 真机探针：文档 `z=40`、Dialog portal `z=50`；输入框中心点命中 `INPUT`，归属 Dialog，未命中 docs-panel；输入后取消，文档仍为 inline。
- 设置 / AI / Git：三个弹层中心区域命中均在各自 Dialog 内，portal `z=50`；依次关闭后文档仍打开。
- E2E：`5 passed / 0 failed`（54.3s）；`npx tsc --noEmit` = 0；目标 Vitest `9 files / 88 tests passed`；`npm run build:renderer` = 0。

## 1. 层级修复（z-index 前后）

| 层 | 修复前 | 修复后 | 说明 |
| --- | --- | --- | --- |
| 移动端 inline 文档 `docs-panel[data-variant=inline]` | `z-50` | **`z-40`** | 本次修改 |
| PC overlay 文档 `docs-panel[data-variant=overlay]` | `z-50` | `z-50`（不变） | 独立浮窗 + 遮罩，未改动 |
| PC 文档目录 `doc-toc-sidebar` | `z-50` | `z-50`（不变） | 与 PC 文档同层 |
| Dialog / Sheet portal | `z-50` | `z-50`（不变） | 新建子页 / 设置 / AI / Git |
| Stage / 预览浮层工具条 | `auto`（在流内） | `auto`（不变） | 文档 `z-40` 显式高于它们 |
| 浮动小地图 | `z-40` | `z-40`（不变） | 文档关闭后使用；同层时文档在 DOM 后 |

根因：侧栏内的「新建子页面」Dialog 由 Sidebar 先渲染，而 inline 文档位于 `main` 内、DOM 更靠后；两者同为 `z-50` 时由文档顺序决定绘制顺序，文档压住 Dialog。移动端文档显式降为 `z-40` 后，所有 `z-50` 弹层稳定在上。

真机计算值（移动端默认态、文档打开）：

```json
{
  "stageZ": "auto",
  "toolbarZ": "auto",
  "docsZ": "40",
  "docsVariant": "inline",
  "docsWidth": 621,
  "stageWidth": 266
}
```

## 2. 真机 Dialog 可操作性

操作路径：进入「测试1 / 首页」（移动端源）→ 移动端默认展开侧栏并打开文档 → 侧栏「首页」更多操作 → 新建子页面。

| 检查项 | 实测 | 结果 |
| --- | --- | --- |
| 文档默认打开 | `data-variant=inline`，`z-index=40` | PASS |
| Dialog portal 层级 | `z-index=50` | PASS |
| 输入框可见 | `getBoundingClientRect()` 宽高 > 0 | PASS |
| 输入框中心命中 | `document.elementFromPoint` → `INPUT`，`closest('[role=dialog]')` = true，docs-panel = false | PASS |
| 可输入 | `fill('层级探针')` → `inputValue()='层级探针'` | PASS |
| 关闭 Dialog 后文档 | 点击「取消」→ Dialog hidden，docs-panel 仍可见且 `data-variant=inline` | PASS |
| 设置弹层 | `settings-dialog` 命中在自身内部，portal `z=50`；文档保持打开 | PASS |
| AI 弹层 | `ai-dialog` 命中在自身内部，portal `z=50`；文档保持打开 | PASS |
| Git 弹层 | `git-sheet` 命中在自身内部，portal `z=50`；文档保持打开 | PASS |

原始证据：`docs/wave4/shots/mobile-docs-zindex/evidence.json`。

## 3. E2E 同步与结果

### 3.1 旧口径修正（只改过期断言/注释，未删用例）

`e2e/wave4-mobile-viewport.spec.ts`

- 改写「进入移动端自动收起侧栏 / 关闭文档」旧断言；改为切移动端后 `sidebar=1`、`docs=1`、`data-variant=inline`（用例保留）。
- 保留并新增层级断言：文档 `z=40`；切 PC 后文档保留且变 `overlay`；切回移动端恢复 `inline`。
- 新增真机回归步骤：文档默认打开时从侧栏新建子页面，断言 Dialog portal `z=50`、输入框命中 Dialog、可输入；取消后文档仍开。
- 为后续视口/小地图断言保持完整舞台宽度，验证完默认 chrome 后按用户操作关闭文档，再进入适宽/全貌/100/125/custom/小地图步骤。
- `openProjectAndHome` 的「Stage 自动收侧栏」注释改为「移动端默认展开，仅手动收起时兜底」。

`e2e/electron-functional.spec.ts`

- A 步骤 5：文档入口改为「仅在未打开时点击」，避免默认打开的文档被 toggle 关闭；保留「最新需求」Tab 命中 docs-panel 的遮挡回归断言。
- B 步骤 1：移动端→PC 后按新口径「切 PC 不强制改状态」，文档会以 overlay 保留；为避免 PC 遮罩挡住顶栏下拉，先按用户操作关闭文档。
- B 步骤 5：文档入口同样改为条件打开。
- 冷启动、设置入口、导出菜单等处的「移动端会收起侧栏 / inline 文档盖住顶栏下拉」注释同步为当前口径。

`e2e/electron-live.spec.ts`

- 仅同步「移动端 kind 会自动收起侧栏」的旧注释；侧栏兜底展开逻辑保留。

### 3.2 运行结果

```text
npx playwright test e2e/wave4-mobile-viewport.spec.ts e2e/electron-functional.spec.ts e2e/electron-live.spec.ts --workers=1
→ 5 passed (54.3s), 0 failed
```

| 用例 | 结果 | 耗时 | 关键证据 |
| --- | --- | --- | --- |
| wave4-mobile-viewport · 移动端视口 | PASS | 13.5s | `docsZ=40`；`dialogZ=50`；输入框命中 `INPUT`；切 PC 文档保留 overlay、切回 inline；视口/小地图断言全通过 |
| electron-functional · A 9 步 | PASS | 15.3s | 步骤 5 移动端文档默认打开，`最新需求` Tab 直接点击成功，命中 `docs-panel-content` |
| electron-functional · B P0/P1 | PASS | 13.2s | Git 660 Dialog、侧栏三层拖拽、设置 32px、文档目录 6 条 + 表格 4 个、AI 单选择器 |
| electron-live · A React | PASS | 10.6s | 设置 / Git / AI / 导出 + Esc + `exit:0` |
| electron-live · B legacy | PASS | 0.959s | legacy 回退 + 进程退出 |

补充门禁：

```text
npx tsc --noEmit
→ 0

npx vitest run src/renderer/components/shell src/renderer/features/docs
→ Test Files 9 passed; Tests 88 passed

npm run build:renderer
→ vite build 成功；主 chunk dist/renderer/assets/index-Bf5FL2mN.js 391,126 B
```

E2E 仅观察到 1 条 seed 内联原型噪声 `pageerror: Unexpected token '.'`（「大厅」原型），不属于本次层级改动，致命 console/pageerror/crash = 0。

## 4. 截图

目录：`docs/wave4/shots/mobile-docs-zindex/`

| 文件 | 内容 |
| --- | --- |
| [`01-mobile-default-docs-open.png`](../shots/mobile-docs-zindex/01-mobile-default-docs-open.png) | 移动端默认态：侧栏 + inline 文档同时打开，文档 `z=40` |
| [`02-subpage-dialog-above-docs.png`](../shots/mobile-docs-zindex/02-subpage-dialog-above-docs.png) | 「新建子页面」Dialog 压在文档之上，输入框可见可聚焦 |
| [`03-subpage-dialog-input-filled.png`](../shots/mobile-docs-zindex/03-subpage-dialog-input-filled.png) | Dialog 输入框已填入「层级探针」 |
| [`04-dialog-closed-docs-still-open.png`](../shots/mobile-docs-zindex/04-dialog-closed-docs-still-open.png) | 取消 Dialog 后文档仍保持打开 |
| [`05-settings-above-docs.png`](../shots/mobile-docs-zindex/05-settings-above-docs.png) | 设置 Dialog 在文档之上；文档在底层仍打开 |
| [`06-ai-above-docs.png`](../shots/mobile-docs-zindex/06-ai-above-docs.png) | AI Dialog 在文档之上 |
| [`07-git-above-docs.png`](../shots/mobile-docs-zindex/07-git-above-docs.png) | Git Dialog 在文档之上 |
| [`08-final-docs-open.png`](../shots/mobile-docs-zindex/08-final-docs-open.png) | 三个弹层依次关闭后文档仍打开 |

关键截图：

![移动端默认文档打开](../shots/mobile-docs-zindex/01-mobile-default-docs-open.png)

![新建子页面 Dialog 在文档之上](../shots/mobile-docs-zindex/02-subpage-dialog-above-docs.png)

![关闭 Dialog 后文档仍打开](../shots/mobile-docs-zindex/04-dialog-closed-docs-still-open.png)

## 5. 观察区（非阻断）

| ID | 级别 | 现象 | 说明 |
| --- | --- | --- | --- |
| docs-z-OBS-1 | P3 | 移动端文档默认打开时宽度 `621px`，舞台仅剩 `266px`，移动端视图读数显示 `62%` | 属「侧栏 + 文档默认打开」的预期挤压；关闭文档后恢复 100%。本次未改布局比例 |
| docs-z-OBS-2 | P3 | 浮动小地图 `z-40` 与文档同层，文档打开时会被右侧文档覆盖 | 小地图属舞台辅助控件；关闭文档后正常。未改变其层级，避免与本次「文档低于弹层」口径互相影响 |
| docs-z-OBS-3 | P3 | `e2e/wave4-b-shell-stage.spec.ts` 仍保留「新建子页前先手动关闭文档」的旧 workaround 注释 | 该 spec 不在本次独占范围，未修改；其现有步骤仍可正常通过，建议后续 owner 移除该 workaround 并补默认打开断言 |

## 6. 结论

- 结果：**可放行**
- 移动端 inline 文档：`z-50 → z-40`；PC overlay 文档保持 `z-50`
- 新建子页 / 设置 / AI / Git 弹层：均稳定在文档之上，可点击、可输入
- E2E：5 passed / 0 failed；typecheck、目标单测、renderer 构建均通过
- 未 commit
