# Wave4 修复后复测 · 移动端视口报告

- 日期：2026-11-13
- Agent / owner：修复后复测子代理（DeepSeek V4.1 Flash 1017）
- 阶段：修复后复测（只判 P0/P1，P2/P3 记观察区）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（工作区含未提交修复，未 commit）
- 构建：`dist/renderer` 2026-11-13 14:53:00；主 chunk `assets/index-BbvYM3aF.js` 345,646 B，SHA-256 前 12 位 `53FD5DEE6181`；`dist/renderer/index.html` SHA-256 前 12 位 `70C0E0040D3C`；`export-assets/export-template.js` SHA-256 前 12 位 `12808363C80E`
- 构建链：`npx tsc --noEmit` = 0；`npx vitest run` = 27 files / 386 tests passed；`npm run build:renderer` = 0；`node e2e/wave4/seed.mjs --rebuild-seed` = 109 files / 1,110,299 B，源 `.devdata` 指纹前 12 位 `17AD3A89355D`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；实际 inner viewport 1123×640
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-mobile-viewport`；实际 `app.getPath('userData')` 精确相同
- seed：`_wave4-seed.json` present；`app.isPackaged=false`
- 运行命令：
  `npx playwright test e2e/wave4-mobile-viewport.spec.ts --workers=1 --output=test-results/wave4/mobile-viewport`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无；未触发原生保存对话框

## 0. 结论先行

**PASS / 可放行（移动端视口域）**：P0=0，P1=0，1 test passed / 10.1s，`window-close` exit 0 / 398ms。

- 默认「适宽」：手机壳高度 `532.353px`，可用区高度 `532.367px`，差值 `0.014px`；内容高 `780px`，滚动只发生在壳内；外层 `scrollHeight=clientHeight=640`，`window.scrollY=0`。
- 正文逻辑字号（iframe 375px 逻辑宽）`body=16px`，可见正文最小 `12px`；适宽实测比例 `100%`，视觉最小字号 `12px`。
- 模式切换全貌/适宽/100/125/custom 的顶栏与舞台读数始终一致；全貌 `68%`（实测 `68.25%`）一屏完整；125% 壳内滚到底可看到 780px 逻辑视口底部；每个模式独立恢复滚动位置。
- 小地图非全貌显示；90% 轨道点击从 `scrollTop=0` 跳到 `247.37px`，视口框 `thumbTop 0 → 38.06`；全貌不渲染小地图。
- 进入移动端后侧栏 `1→0`、文档面板 `1→0`，自动收起生效。
- 复测新增 console/pageerror/crash = 0；启动时 seed 自动恢复的「大厅」原型产生 2 条 Vant CDN CSP error + 1 条 pageerror，属 seed 内联原型噪声，已单列观察项。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离 + 进入项目/首页原型 | PASS | `userData` 与 `.devdata-wave4-mobile-viewport` 精确一致；项目选择器未弹；启动自动恢复「测试1 / 大厅 / proj-scroll」，展开侧栏后切到「首页」；截图 `00-project-entry.png` | — |
| 1 | PC 基线 → 切移动端自动收侧栏/文档 | PASS | PC 下 `sidebar=1`、`docs-panel=true`；DOM click 移动端按钮后 `data-kind=mobile`，`sidebar=0`、`docs-panel=0`；截图 `01-pc-before-mobile.png`、`02-mobile-auto-collapse.png` | — |
| 2 | 默认「适宽」：壳占满可用高、壳内滚动、外层无滚动、字号 | PASS | `data-mobile-mode=fit-width`、`data-fit=on`；顶栏=舞台=`100%`；stage-mobile-area `1091.255×532.367`，shell `375×532.353`（高度差 0.014px）；`scrollHeight=780`、`clientHeight=532`；程序化 `scrollTop=179.82` 生效；外层 `docScrollHeight=640=clientHeight=640`、`scrollY=0`；iframe `body=16px`、最小正文 `12px`、视觉最小 `12px`；截图 `03-fit-width.png` | — |
| 2b | 壳内滚轮归属 | PASS | 手机壳中心滚轮 700px 后：壳 `scrollTop` 保持 `179.82`，iframe 内 `scrollY=316.67`（嵌套滚动由 iframe 消费），外层 `scrollY=0`；滚动始终没有逃出手机区域 | — |
| 3 | 全貌：一屏完整、无壳内滚动、无小地图 | PASS | `68%`，实测 `(255.94/375)=68.2512%`；`stage-mobile-overview` `255.94×532.35` 完整落在 area `1091.26×532.37` 内；`stage-mobile-scroll` 数量=0；正文从搜索框到「热门推荐」完整可见；`mobile-minimap` 数量=0；截图 `04-overview.png` | — |
| 4 | 100%：1:1、可滚、小地图显示 | PASS | 顶栏=舞台=`100%`；`stage-viewport` bbox `375×779.996`，`transform=matrix(1,0,0,1,0,0)`；`scrollHeight=780`、`clientHeight=527`；小地图 `visible=true`，thumb `height=81.08`、`aria-valuenow=0`；截图 `05-mode-100.png` | — |
| 5 | 125%：内部滚动可看全、视口框随滚动变化 | PASS | 顶栏=舞台=`125%`；bbox `468.75×974.995`；`scrollHeight=975`、`clientHeight=527`、`maxTop=448`；滚到底 `scrollTop=448.25`，`scrollTop+clientHeight ≥ scrollHeight-1`；小地图 thumb `0 → 55.14`；截图 `06-mode-125-top.png`、`07-mode-125-bottom.png` | — |
| 6 | custom：-/+ 进入自定义比例 | PASS | 125% 点「缩小」→ `data-mobile-mode=custom`，顶栏=舞台=`115%`，bbox `431.25×896.995`，`transform=matrix(1.15,...)`；截图 `08-mode-custom.png` | — |
| 7 | 每模式独立记忆滚动位置 | PASS | 适宽存 `139.91`，100% 存 `200`；切回适宽恢复 `139.91`，再切回 100% 恢复 `200`；截图 `09-restore-fit-width.png` | — |
| 8 | 小地图点击跳转 + 视口框变化 | PASS | 轨道 `16×120` @ `(1091.26,504.36)`；90% 处点击（避开视口框拖动区）后 `scrollTop 0→247.37`（理论 `min(702,248)=248`），thumb `0→38.06`；截图 `10-minimap-jump.png` | — |
| 9 | console / pageerror / crash | PASS | 切到首页后新增 console=0、pageerror=0、crash=0；致命项=0；截图 `11-final.png` | — |

> 证据目录：`docs/wave4/shots/mobile-viewport/`；表内 `.png` 均位于该目录。

## 2. 截图

| 文件 | 内容 |
| --- | --- |
| [`00-project-entry.png`](../shots/mobile-viewport/00-project-entry.png) | 进入「测试1 / 首页」后的初始舞台 |
| [`01-pc-before-mobile.png`](../shots/mobile-viewport/01-pc-before-mobile.png) | PC 基线：侧栏 + 文档面板同时打开 |
| [`02-mobile-auto-collapse.png`](../shots/mobile-viewport/02-mobile-auto-collapse.png) | 切移动端后侧栏/文档自动收起 |
| [`03-fit-width.png`](../shots/mobile-viewport/03-fit-width.png) | 默认适宽：375 宽手机壳占满可用高，壳内滚动 |
| [`04-overview.png`](../shots/mobile-viewport/04-overview.png) | 全貌 68%：整机一屏完整，无小地图 |
| [`05-mode-100.png`](../shots/mobile-viewport/05-mode-100.png) | 100% + 小地图 |
| [`06-mode-125-top.png`](../shots/mobile-viewport/06-mode-125-top.png) | 125% 顶部，壳内可滚动 |
| [`07-mode-125-bottom.png`](../shots/mobile-viewport/07-mode-125-bottom.png) | 125% 滚到底，小地图视口框下移 |
| [`08-mode-custom.png`](../shots/mobile-viewport/08-mode-custom.png) | custom 115% |
| [`09-restore-fit-width.png`](../shots/mobile-viewport/09-restore-fit-width.png) | 切回适宽恢复滚动位置 |
| [`10-minimap-jump.png`](../shots/mobile-viewport/10-minimap-jump.png) | 小地图点击跳转后 |
| [`11-final.png`](../shots/mobile-viewport/11-final.png) | 收尾状态 |

关键截图：

![默认适宽](../shots/mobile-viewport/03-fit-width.png)

![全貌](../shots/mobile-viewport/04-overview.png)

![125% 滚到底](../shots/mobile-viewport/07-mode-125-bottom.png)

## 3. 缺陷（P0/P1）

**无。P0=0，P1=0。**

已覆盖且未触发：手机壳未占满高、外层出现滚动条、正文小于 12px、模式读数与实测不一致、全貌被裁切、125% 无法滚到底、切回丢失滚动位置、小地图不显示/点击无效/全貌残留、进入移动端未收侧栏或文档。

## 4. 观察区（非阻断）

| ID | 级别 | 现象 | 复现/证据 | 是否进 B |
| --- | --- | --- | --- | --- |
| mobile-OBS-1 | P3 | 「适宽」在大屏下的读数是 `100%`：该模式只按宽度适配（`min(1, 可用宽/375)`），高度靠壳内滚动，读数符合实现但容易被理解为「应缩到 60%」 | `useMobileViewport.ts:60-62`；截图 `03-fit-width.png` 顶栏显示「适宽 / 100%」 | 否（口径问题，功能正确） |
| mobile-OBS-2 | P3 | 小地图固定在窗口右下角（`fixed bottom-4 right-4`），不是贴着手机壳右下角；大屏时离手机较远，但可点击且不遮挡 iframe | `MobileMinimap.tsx:165`；截图 `05-mode-100.png`、`10-minimap-jump.png` | 否 |
| mobile-OBS-3 | P3 | 100%/125% 下手机壳出现横向滚动条（垂直滚动条占 6px 使 `scrollWidth 375 > clientWidth 369`），`clientHeight` 由 532 变 527；不影响读数与滚动 | 步骤 4/5 快照 | 否 |
| mobile-OBS-4 | ENV | seed 启动自动恢复的「大厅」原型加载外部 Vant CDN 被 CSP 拦截（2 条 console error），并有 1 条 `pageerror: Unexpected token '.'`；切到「首页」后不再新增，属 seed 内联原型内容噪声，不是移动端视口产品缺陷 | 运行日志 `startupNoise`；失败片段 `%TEMP%/pland-wave4/failures/mobile-viewport/` | 否（建议 seed 侧修「大厅」内联脚本或过滤） |

## 5. 结论

- 结果：**可放行（移动端视口域）**
- P0 = 0；P1 = 0；P2 = 0；P3 = 3；ENV = 1
- 阻断项：无
- 复测范围：`e2e/wave4-mobile-viewport.spec.ts` 单文件单 worker，1 passed / 10.1s；关闭 `window-close` exit 0；切首页后新增致命 console/pageerror/crash = 0
- 备注：
  - 本轮未修改 `src/**`、`main/**`、`tests/**`、`package.json`，未 commit；只新增本 spec、本报告与 `docs/wave4/shots/mobile-viewport/**`。
  - 复测前执行了 `npx tsc --noEmit`、`npx vitest run`、`npm run build:renderer`、`node e2e/wave4/seed.mjs --rebuild-seed`。
  - 本域数据目录 `.devdata-wave4-mobile-viewport` 已在报告完成后清理；复跑前执行 `node e2e/wave4/seed.mjs --domain mobile-viewport`。
