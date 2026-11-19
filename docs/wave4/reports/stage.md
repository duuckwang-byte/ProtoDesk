# Wave4 A 冒烟 · 舞台 / 预览 / 移动端 报告

- 日期：2026-11-13
- Agent / owner：A1 子代理（wave4 stage）
- 阶段：A 冒烟
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer` 构建时间 2026-11-13 12:36:16；主 chunk `assets/index-BHMDlo45.js` 329,649 B，SHA256 前 12 位 `D525C677F6BB`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；实际 inner viewport 1123×640（Electron 窗口受工作区限制）
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-stage`；实际 `app.getPath('userData')` 精确相同
- seed：`_wave4-seed.json` present；该文件 SHA256 前 12 位 `8446403CA23B`；manifest 记录的源 `.devdata` 指纹 `0c11ddd5...`
- 运行命令：
  `npx playwright test e2e/wave4-stage.spec.ts --workers=1 --output=test-results/wave4/stage`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无

## 0. 结论先行

**PASS / 可放行（A 冒烟）**：P0=0，P1=0。舞台 iframe、移动端 375×780 自适应、PC/移动切换、缩放读数单一事实源、源切换、刷新、50%/125% 交互、进程退出全部通过；console/pageerror/crash 均为 0。另有 2 条非阻断 P2 观察，见 §4，不影响 A 结论。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离 + 进入项目/首页原型 | PASS | `userData` 与 `.devdata-wave4-stage` 精确一致；项目选择器未弹（自动恢复「测试1」）；侧栏=`首页`/`我的`；`loc-pill`=「测试1 首页 —」 | — |
| 1 | 舞台 iframe / srcdoc / 正文 | PASS | `preview-frame` 数量=1；`srcdoc`=17,423 字符；iframe body 正文=292 字符（首行「首页 分类 秒杀 我的1 活动 猜你喜欢…」）；`stage-frame` 887×600；截图 `01-iframe-render.png` | — |
| 2 | 移动端 375×780 + 默认自适应 + 双读数一致 | PASS | `stage-frame[data-kind=mobile][data-fit=on]`；`topbar-fit-toggle aria-pressed=true`；`stage-viewport` style=`375px×780px`，屏幕 bbox=`225.165×468.341` → 实测 60.044%；顶栏=`60%`，舞台=`60%`，**完全一致**（无 85% vs 60%）；截图 `02-mobile-fit-375x780.png` | — |
| 3 | PC / 移动端切换 | PASS | 切 PC：`data-kind=pc`，`stage-viewport` 数量=0，`preview-frame` 可见，iframe body=292 字符，frame=854×531；切回移动：`data-fit=on`，读数回到 `60%`；截图 `03-pc-stage.png`、`03-mobile-back-fit.png`。注：切换瞬间 iframe 重新挂载，首帧可能空白，等待正文后截图，未判白屏 | — |
| 4 | 源切换（首页/我的）+ 刷新 | PASS | 切「我的」：`data-subfile=我的.html`，`srcdoc`=6,861、body=59、`loc-pill`=「测试1 我的 —」；切回「首页」：`srcdoc`=17,423、body=292、含「猜你喜欢」；刷新后：`srcdoc`=17,423、body=292、`stage-empty`=0、toast「已刷新」；截图 `04-source-mine.png`、`04-refresh-home.png` | — |
| 4b | 真子页 `stage-subpages` | **SKIP** | `stage-subpages` 数量=0；seed 的 `首页/` 目录只有 `首页.html`，没有子页面。按计划 §3.5 第 5 步「没有子页时记 SKIP，不判失败」 | — |
| 5 | 自适应开关 / -+ / 50-75-100-125 预设 / 外层无滚轮 | PASS | 退出自适应：`100%`，bboxW=375；重开自适应：`60%`，bboxW=225.165；预设 50/75/100/125：读数均与顶栏一致，bboxW 依次 187.5 / 281.25 / 375 / 468.75；-/+ 为 `115%`→`125%`；外窗 `docScrollHeight=640=clientHeight`，顶栏滚轮 900px 后 `scrollY=0`；截图 `05-fit-off-100.png`、`05-preset-50.png`、`05-preset-100.png`、`05-preset-125.png` | — |
| 6 | 50% / 125% 下 iframe 仍可交互 | PASS | 50%：iframe 内 `.search-input` 点击聚焦并输入 `W4-50`，`activeElement` 命中输入框；125%：真实鼠标点击商品卡，iframe 内点击事件计数=1，iframe 内滚动 `scrollY=220.18`；截图 `06-interact-50.png`、`06-interact-125.png` | — |
| 7 | console / pageerror / 白屏 / 退出 | PASS | `consoleErrors=[]`，`pageErrors=[]`，`crashes=[]`，致命项=0；`stage-empty` 未出现；`close` = `window-close` / exitCode 0 / 268ms；测试 1 passed（7.0s） | — |

## 2. 截图

目录：`docs/wave4/shots/stage/`

| 文件 | 内容 |
| --- | --- |
| [`01-iframe-render.png`](../shots/stage/01-iframe-render.png) | 首页舞台 iframe + srcdoc + 正文 |
| [`02-mobile-fit-375x780.png`](../shots/stage/02-mobile-fit-375x780.png) | 移动端 375×780，默认自适应，顶栏/舞台同为 60% |
| [`03-pc-stage.png`](../shots/stage/03-pc-stage.png) | PC 舞台，正文可见，frame 854×531 |
| [`03-mobile-back-fit.png`](../shots/stage/03-mobile-back-fit.png) | PC 切回移动端，自适应恢复 60% |
| [`04-source-mine.png`](../shots/stage/04-source-mine.png) | 侧栏切到「我的」，内容变化 |
| [`04-refresh-home.png`](../shots/stage/04-refresh-home.png) | 刷新后回到首页，未白屏 |
| [`05-fit-off-100.png`](../shots/stage/05-fit-off-100.png) | 退出自适应，真实 100%（bboxW=375） |
| [`05-preset-50.png`](../shots/stage/05-preset-50.png) | 50% 预设 |
| [`05-preset-100.png`](../shots/stage/05-preset-100.png) | 100% 预设 |
| [`05-preset-125.png`](../shots/stage/05-preset-125.png) | 125% 预设 |
| [`06-interact-50.png`](../shots/stage/06-interact-50.png) | 50% 下 iframe 输入框聚焦并输入 |
| [`06-interact-125.png`](../shots/stage/06-interact-125.png) | 125% 下商品卡真实点击 + iframe 内滚动 |

关键截图：

![移动端默认自适应](../shots/stage/02-mobile-fit-375x780.png)

![PC 舞台](../shots/stage/03-pc-stage.png)

## 3. 缺陷（仅 P0/P1）

**无。P0=0，P1=0。**

- 未发现舞台白屏、iframe 缺失/空 srcdoc、移动舞台尺寸错误、PC/移动切换失效、文档遮挡舞台、刷新后旧源残留、iframe 加载失败、进程无法退出。
- 未发现两套缩放读数；自适应 60% 时顶栏与舞台完全一致，50/75/100/125 预设与实测 bbox 误差均 ≤1%。

## 4. 观察区（非阻断，A 不计入结论）

| ID | 级别 | 现象 | 复现 | 证据 | 是否进 B |
| --- | --- | --- | --- | --- | --- |
| stage-OBS-1 | P2 | PC 舞台的缩放控件是「死控件」：选 50%/125% 时 `stage-zoom-readout` 跟着变，但 iframe 画面尺寸不变 | 1) 进入 `测试1/首页`；2) 顶栏切 PC；3) 依次选 50%、125%；4) 观察 `preview-frame` bbox | `src/renderer/components/shell/Stage.tsx:258-265` PC 分支固定 `scale=1`，而 `:268-272` 的 `appliedScale` 在 PC 下回显 `zoom`；实测 frame 在 50%/125% 均为 854×531（`frameChanged=false`），截图 `03-pc-stage.png` 读数 125% 但画面未缩放。移动端路径不受影响 | 是（建议 B 阶段定：PC 应用 zoom，或 PC 隐藏/禁用缩放组并固定显示 100%） |
| stage-OBS-2 | P2 | 125% 时移动视窗（视觉高 975px）高于舞台可视区（约 531px），`items-center` 居中 + `overflow-hidden` 裁切上下；顶部搜索框不可达 | 1) 移动端选 125%；2) 尝试点击 iframe 顶部搜索框；3) Playwright 报 `element is outside of the viewport`；4) 中部商品卡可点击 | `src/renderer/components/shell/Stage.tsx:420` 外层 `items-center justify-center overflow-hidden p-6`，`:425-437` 视窗 `transform: scale(125%)`；截图 `05-preset-125.png` 顶部搜索区被裁掉；iframe 内滚动正常（`scrollY=220.18`），但滚动不能露出被裁掉的顶部 | 是（建议顶部对齐 + 舞台内滚动，或限制最大自适应比例） |

## 5. 结论

- 结果：**可放行（A 冒烟）**
- P0 = 0；P1 = 0；P2 = 2（观察区，非阻断）；P3 = 0；ENV = 0
- 阻断项：无
- 复测范围：`e2e/wave4-stage.spec.ts` 单文件单 worker，1 passed / 7.0s；关闭 `window-close` exit 0；致命 console/pageerror/crash = 0
- 备注：
  - `stage-subpages` 因 seed 无子页面记 SKIP，不判失败；如需覆盖，seed 时在 `首页/` 下复制 `首页.html` 为 `详情.html` 后重跑。
  - 本域数据目录 `.devdata-wave4-stage` 已在报告完成后清理；复跑前执行 `node e2e/wave4/seed.mjs --domain stage`。
  - 本轮未修改 `src/**`、`main/**`、`tests/**`、`package.json`，未 commit。
