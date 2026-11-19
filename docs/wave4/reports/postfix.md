# Wave4 修复后复测 · Esc 栈 + 导出独立 HTML 报告

- 日期：2026-11-13
- Agent / owner：修复后复测子代理（DeepSeek V4.1 Flash 1017）
- 阶段：修复后复测（只判 P0/P1，P2/P3 记观察区）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（工作区含未提交修复，未 commit）
- 构建：`dist/renderer` 2026-11-13 14:53:00；主 chunk `assets/index-BbvYM3aF.js` 345,646 B，SHA-256 前 12 位 `53FD5DEE6181`；`dist/renderer/index.html` SHA-256 前 12 位 `70C0E0040D3C`；`export-assets/export-template.js` SHA-256 前 12 位 `12808363C80E`
- 构建链：`npx tsc --noEmit` = 0；`npx vitest run` = 27 files / 386 tests passed；`npm run build:renderer` = 0；`node e2e/wave4/seed.mjs --rebuild-seed` = 109 files / 1,110,299 B
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；实际 inner viewport 1123×640
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-postfix`；实际 `app.getPath('userData')` 精确相同
- seed：`_wave4-seed.json` present；`app.isPackaged=false`
- 运行命令：
  `npx playwright test e2e/wave4-postfix.spec.ts --workers=1 --output=test-results/wave4/postfix`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无；导出 HTML 后 Chromium `newContext({offline:true})` 验证 `file://`

## 0. 结论先行

**需修复**：Esc 栈修复**未生效**（P1），导出独立 HTML 修复**已生效**（PASS）。

- **Esc（P1，FAIL）**：设置 + AI 双层同时打开时，按 **1 次 Esc 两层同时关闭**（`ai/settings = 1/1 → 0/0`），不是「只关最上层」；单层 Esc 虽能关闭，但 `activeElement` 落到 `body`，**焦点未回归**触发按钮。根因是 `MainWindow` 的 `escInFlight` 用 `queueMicrotask` 复位，Chromium 在**每个事件监听器之间**执行微任务，document 上的 Dialog 监听先于 window 冒泡执行时标志已被复位，`DialogContent` 直接 `setOpen(false)`，随后 `closeTopmost()` 已无层可关。已用独立 Chromium 探针复现同一时序，并确认 dist 包内已包含该修复代码，不是构建 stale。
- **X 关闭（PASS）**：AI / 设置各自点右上角 X 均能单独关闭，互不影响。
- **遮罩关闭（P2，FAIL）**：点击设置遮罩空白处（20,300）无反应；`elementFromPoint` 命中的是 `div.absolute inset-0 flex items-center justify-center p-4`（全屏布局容器），它覆盖在 `data-slot="dialog-overlay"` 之上，遮罩点击永远到不了 overlay。可用 X 或 Esc 替代，按 P2 记录。
- **导出独立 HTML（PASS）**：文件 48,794 B；`file://` + 断网打开成功；右侧 `#docContent` **可见**、文本 3,445 字符、含「商城首页」、标题「首页」非空；md 表格 4 个，首个表格可见（4 行 / 10 单元格 / 表头「维度 / 说明」）；iframe 正文 292 字符；无外链脚本、无 React 运行时；离线 pageerror=0。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离 + 进入项目/首页原型 | PASS | `userData` 与 `.devdata-wave4-postfix` 精确一致；项目选择器未弹；启动恢复「测试1 / 大厅 / proj-scroll」，展开侧栏后切「首页」；截图 `00-project-entry.png` | — |
| 1 | 单层：设置 Esc 关闭 + 焦点回归 | **FAIL** | 打开设置并把焦点放到对话框 X；Esc 后 `settings-dialog` 数量 1→0（关闭成功），但 `activeElement=body`（`aria-label=null`、`inTopbar=false`），焦点未回到顶栏「设置」按钮；截图 `01-esc-single-settings.png`、`02-esc-single-settings-focus.png` | P1（postfix-P1-1） |
| 2 | 单层：AI Esc 关闭 + 焦点回归 | **FAIL** | 打开 AI 并聚焦「需求对话」Tab；Esc 后 `ai-dialog` 1→0，`activeElement=body`，焦点未回到顶栏「AI 对话」；截图 `03-esc-single-ai-focus.png` | P1（postfix-P1-1） |
| 3 | 双层：设置 + AI，一次 Esc 只关最上层 | **FAIL** | 打开设置后程序化点击顶栏 AI，双层 `ai/settings=1/1`（截图 `04-esc-stack-before.png`）；按 **1 次** Esc 后 `0/0`，两层同时关闭（截图 `05-esc-stack-after-1.png`）；再按第 2 次 Esc 无层可关（截图 `06-esc-stack-after-2.png`） | P1（postfix-P1-1） |
| 4 | X 关闭不受影响 | PASS | 单开 AI → 点 `ai-dialog button[aria-label=关闭]` → AI 数量 0，设置仍 0；单开设置 → 点 X → 设置数量 0；截图 `07-x-close.png` | — |
| 5 | 遮罩点击关闭不受影响 | **FAIL** | 打开设置后 `elementFromPoint(20,300)` = `DIV.absolute.inset-0.flex.items-center.justify-center.p-4`（无 data-slot）；鼠标点击后 `settings-dialog` 仍为 1，遮罩未收到点击；截图 `08-overlay-close.png`（设置仍打开） | P2（postfix-P2-1） |
| 6 | 导出独立 HTML + `file://` 断网打开 | PASS | toast「独立 HTML 已导出（离线可读，含 __EXPORT_BOOT__ 数据）。」；文件 `%TEMP%\pland-wave4\exports\postfix-1794553770635\01-html\首页[导出].html`，**48,794 B**；`__EXPORT_BOOT__=true`、`__EXPORT_SOURCES__=1`、`__REQ_MAP__` 对象、`__EXPORT_RENDER__` 存在；`styleSheets=1`、外链脚本=0、`offline=true`、正文 3,531 字符；iframe 正文 292 字符；`#docContent` 可见（`docShown=true`）3,445 字符、含「商城首页」、`#exportLiteTitle=首页` 且可见；`.export-lite-doc` bbox `x=814, w=506, h=2410.86`（1440 视口右侧）；md 表格 4 个，首个 `table.md-table` 可见，4 行 / 10 单元格 / 表头「维度 / 说明」/ bbox `480×316`；`React=undefined`、`reactRoot=0`、HTML 不含 `react-dom/createRoot`；离线 console=0、pageerror=0；截图 `09-export-menu.png`、`10-html-offline.png`、`11-html-doc-table.png` | — |
| 7 | console / pageerror / crash / 收尾 | PASS | 切首页后新增 console=0、pageerror=0、crash=0、致命=0；`showSaveDialog` 调用=0；`window-close` exit 0 / 4,628ms；截图 `12-final.png` | — |

> 步骤 1/2/3/5 的失败用 `expect.soft` 记录后继续执行，保证导出 HTML 仍完成取证；测试最终因软断言失败标记 failed，属预期（未修改产品代码）。

## 2. Esc 根因证据（P1）

`src/renderer/app/modes/MainWindow.tsx:44-56`：

```ts
let escInFlight = false
function beginEscHandling(): void {
  escInFlight = true
  queueMicrotask(() => { escInFlight = false })
}
```

`src/renderer/components/ui/dialog.tsx:62-69` 的 `DialogContent` 在 `document`（冒泡）监听 Escape 并直接 `setOpen(false)`；`MainWindow.tsx:230-248` 的 `onOpenChange` 仅在 `isEscInFlight()` 为 true 时忽略。

Chromium 在**每个事件监听器回调后**执行微任务。独立探针（Playwright Chromium，真实 `keyboard.press('Escape')`）时序：

```text
real-key:        ["capture:true","microtask:false","document-bubble:false","window-bubble:false"]
dispatchEvent:   ["capture:true","document-bubble:true","window-bubble:true"]
```

即真实键盘事件下，window 捕获阶段设置的 `escInFlight` 在 document 冒泡监听执行前已被微任务复位；Dialog 的 `setOpen(false)` 绕过了守卫，直接关闭自己。随后 window 冒泡的 `closeTopmost()` 返回 null，`focusOpener` 不会执行 → 焦点落到 body。用 DOM `dispatchEvent` 同步派发时微任务不会插入，才会呈现修复预期的 `document-bubble:true`；这也是单测容易漏掉、真机必现的原因。

复测同时在 bundle 中确认修复代码存在：`dist/renderer/assets/index-BbvYM3aF.js` 含 `xu=!1;function Su(){xu=!0,queueMicrotask(()=>{xu=!1})}`，排除「构建 stale」。

建议（仅记录，本轮不改产品代码）：把微任务复位改为 `setTimeout(0)`，或在 window 冒泡处理完成后再复位；更稳妥的是让 Dialog 的 Esc 关闭统一走 `closeTopmost()`，不要各自在 document 上监听。

## 3. 缺陷

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| postfix-P1-1 | P1 | Esc 栈修复未生效：双层时 1 次 Esc 关掉 AI+设置两层；单层关闭后焦点落到 body | 1) 打开设置；2) 程序化点击顶栏 AI（遮罩挡住真实点击）；3) 按 1 次 Esc | 键盘用户无法逐层退出；焦点丢失，后续键盘操作从 body 开始；本次修复目标未达成 | 步骤 3 计数 `1/1 → 0/0`；步骤 1/2 `activeElement=body`；截图 `04`→`05`；根因时序见 §2 | 微任务复位改 `setTimeout(0)` 或在冒泡后再复位；Dialog Esc 统一交给 `closeTopmost()` |
| postfix-P2-1 | P2 | 点击遮罩空白处不能关闭设置/对话框 | 1) 打开设置；2) 点击对话框外 (20,300) | 鼠标用户少一条常用关闭路径；有 X / Esc 替代，不阻断 | `elementFromPoint(20,300)` = 全屏布局容器 `DIV.absolute.inset-0.flex...`，不是 overlay；`settings-dialog` 仍为 1；截图 `08-overlay-close.png` | 给 `DialogContent` 的全屏包裹层加 `pointer-events-none`，内容自身 `pointer-events-auto`；或把点击处理放到该包裹层 |

## 4. 截图

目录：`docs/wave4/shots/postfix/`

| 文件 | 内容 |
| --- | --- |
| [`00-project-entry.png`](../shots/postfix/00-project-entry.png) | 进入「测试1 / 首页」 |
| [`01-esc-single-settings.png`](../shots/postfix/01-esc-single-settings.png) | 单层设置，焦点在对话框 X |
| [`02-esc-single-settings-focus.png`](../shots/postfix/02-esc-single-settings-focus.png) | Esc 关闭设置后（焦点未回归，body） |
| [`03-esc-single-ai-focus.png`](../shots/postfix/03-esc-single-ai-focus.png) | Esc 关闭 AI 后（焦点未回归，body） |
| [`04-esc-stack-before.png`](../shots/postfix/04-esc-stack-before.png) | 设置 + AI 双层同时打开（1/1） |
| [`05-esc-stack-after-1.png`](../shots/postfix/05-esc-stack-after-1.png) | 按 1 次 Esc 后两层全关（0/0，FAIL） |
| [`06-esc-stack-after-2.png`](../shots/postfix/06-esc-stack-after-2.png) | 第 2 次 Esc 后仍 0/0 |
| [`07-x-close.png`](../shots/postfix/07-x-close.png) | X 关闭 AI / 设置均正常 |
| [`08-overlay-close.png`](../shots/postfix/08-overlay-close.png) | 点遮罩后设置仍打开（FAIL） |
| [`09-export-menu.png`](../shots/postfix/09-export-menu.png) | 导出菜单 |
| [`10-html-offline.png`](../shots/postfix/10-html-offline.png) | 独立 HTML 断网打开：左侧原型 + 右侧文档区可见 |
| [`11-html-doc-table.png`](../shots/postfix/11-html-doc-table.png) | 右侧文档区元素截图：标题 + md 表格 |
| [`12-final.png`](../shots/postfix/12-final.png) | 收尾 |

关键截图：

![双层打开](../shots/postfix/04-esc-stack-before.png)

![1 次 Esc 后两层全关](../shots/postfix/05-esc-stack-after-1.png)

![导出 HTML 右侧文档与表格](../shots/postfix/10-html-offline.png)

## 5. 观察区（非阻断）

| ID | 级别 | 现象 | 复现/证据 | 是否进 B |
| --- | --- | --- | --- | --- |
| postfix-OBS-1 | P3 | 导出 HTML 的 md 表格单元格里 `<br>` 被原样显示（如「移动端流式卡片聚合页。<br>2. 顶部固定…」），表格结构正常但换行标签未转成 `<br>` | 截图 `11-html-doc-table.png`；`js/export-template.js:25-32` 的 `inline()` 先 `esc()`，未把 `&lt;br&gt;` 还原为换行 | 否（P3） |
| postfix-OBS-2 | P3 | 双层打开时设置面板在 DOM/视觉上盖住 AI（MainWindow 挂载顺序 Ai→Settings→Git），而 Esc 栈顺序是 AI 优先，二者对「最上层」的定义不一致 | 截图 `04-esc-stack-before.png`：设置可见、AI 在左后方；`ui-store.closeTopmost()` AI > 设置 | 否（当前两层同时关闭，先修 P1 后再统一语义） |
| postfix-OBS-3 | ENV | seed 自动恢复的「大厅」原型加载外部 Vant CDN 触发 2 条 CSP console error + 1 条 pageerror；切到「首页」后不再新增 | 运行日志 `startupNoise`；同 mobile-viewport 报告 mobile-OBS-4 | 否 |

## 6. 结论

- 结果：**需修复**（Esc 栈 P1 未达成；导出 HTML 子项可放行）
- P0 = 0；P1 = 1（postfix-P1-1，含「一次关两层」与「焦点未回归」两个症状，同一根因合并）；P2 = 1（postfix-P2-1）；P3 = 2；ENV = 1
- 阻断项：Esc 逐层关闭 + 焦点回归
- 复测范围：`e2e/wave4-postfix.spec.ts` 单文件单 worker；Esc/焦点/遮罩软断言失败，导出 HTML 全部硬断言通过；`window-close` exit 0；切首页后新增致命 console/pageerror/crash = 0
- 备注：
  - 本轮**未修改** `src/**`、`main/**`、`tests/**`、`package.json`，未 commit；只新增本 spec、本报告与 `docs/wave4/shots/postfix/**`。
  - 导出文件与临时目录 `%TEMP%/pland-wave4/exports/postfix-1794553770635` 已在测试 `finally` 中删除；本域数据目录 `.devdata-wave4-postfix` 在报告完成后清理。
  - 失败片段位于 `%TEMP%/pland-wave4/failures/postfix/`（中间迭代产物，最终结论以本报告 §2 探针与截图为准）。
