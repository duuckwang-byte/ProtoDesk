# Wave4 B 阶段复测 · AI 对话 + Ctrl 拾取 报告

- 日期：2026-11-13
- Agent / owner：B 阶段复测子 agent（DeepSeek V4.1 Flash 1017）
- 阶段：B 阶段复测（AI + Ctrl 拾取；更新已漂移 E2E）
- 代码版本：工作区非 git 仓库，无 `git rev-parse HEAD`；以构建产物与 seed 指纹取证
- 构建：`npm run build:renderer` 于 2026-11-13 18:35 重新构建；`dist/renderer/index.html` SHA256 前 12 位 `CB86BB991280`
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录（两域各自独立）：
  - AI：`PLAND_DEV_DATA_DIR=D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-ai`，`app.getPath('userData')` 精确一致
  - 拾取：`PLAND_DEV_DATA_DIR=D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-pick`，`app.getPath('userData')` 精确一致
- seed：`node e2e/wave4/seed.mjs --rebuild-seed`；seed 109 files / 1,113,440 bytes；源指纹 `a1e7372730fc`；manifest SHA256 前 12 位 `1CF8502783AC`；项目 `测试1`
- 运行命令：
  - `npx playwright test e2e/wave4-b-ai.spec.ts --workers=1 --output=%TEMP%\pland-wave4\pw-retest-b-ai`
  - `npx playwright test e2e/wave4-b-pick.spec.ts --workers=1 --output=%TEMP%\pland-wave4\pw-retest-b-pick`
- 真实请求/网络：**AI_REQUESTS=1**（唯一短 prompt，成功）；其余 AI 场景全部主进程 mock；GIT_NETWORK=无
- 收尾：两域均 `window-close` exit 0；`.devdata-wave4-b-ai` / `.devdata-wave4-b-pick` 已删除；无残留本域 Electron

## 0. 结论

**AI 域 PASS（2/2 用例），Ctrl 拾取域 PASS（1/1 用例）。P0=0，P1=0，P2=0，P3=3（含 1 条继承观察），ENV=2。**

- AI 已按当前 UI 收口为**单一全宽对话**：无会话列表、无新建会话、无会话切换；对话区宽度占 Dialog `97.4%`。
- 输入框聚焦为**浅色边框**：实测 sRGB `228,228,231`（zinc-300 级别），不是近黑 ring。
- 模型 / 思考双列 Popover 在 **1024×768** 下完整可见：panel `right=961 < viewport 1014`，思考列 `right=960`，右缘可命中、无横向滚动。
- Markdown / 代码块正常渲染：`h1×1`、`pre×1`、`code×1`、`li×1`，聊天文本不含 ``` 围栏原文。
- 问题卡已有「提交答案」：提交后锁定「已提交」，并通过既有 `ai:ask` 回传 `[form answers — qform1] - 选择页面: 首页`。
- 真实发送仅 **1 条**短 prompt，模型 `deepseek-v4.1-flash`，回复「收到」落在一个 assistant 文本气泡，未拼接其他轮次。
- 无模型时发送按钮**前置禁用**，提示「暂无可用模型：请先在 设置 › 模型 中启用至少一个模型」，`ai:ask=0`。
- Ctrl+点击弹 `pick-requirement-dialog` 并提交入队；Ctrl+Shift+点击弹 `pick-modify-dialog`，取消不写、保存按「将该元素内容改为：…」入队。
- 选中框在 iframe 滚动（80px）与 75% / 125% 缩放下实时重算：最大偏差 **0.006px**，无漂移。
- Sheet 打开后焦点进入浮层，连续 10 次 Tab、3 次 Shift+Tab 均未逃逸；Esc 关闭后焦点回到「检查器」触发按钮。
- 数据完整性：`首页.html` SHA256 全程 `2D72B71839FC`；annotations 2→2、links 2→2、queue 最终 `[]`；排除 seed 原型内容噪声后致命 console/pageerror/crash=0。

## 1. 预检

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | PASS（exit 0，无输出） |
| 单元测试 | `npx vitest run`（`package.json` 无 `vitest` script，`npm run test:unit` 同口径） | PASS：46 files / 517 tests |
| 渲染器构建 | `npm run build:renderer` | PASS：Vite 8.3.8，2173 modules，254ms |
| seed 重建 | `node e2e/wave4/seed.mjs --rebuild-seed` | PASS：109 files / 1,113,440 bytes / sourceUnchanged=true |
| 域 seed | `node e2e/wave4/seed.mjs --domain b-ai --force`、`--domain b-pick --force` | PASS |
| 启动前 Electron | `Get-Process electron` | 无（复测期间另一域 `b-docs-retest` 启动，未干扰本域；未 kill 他人进程） |

## 2. AI 域（`e2e/wave4-b-ai.spec.ts`）

### 2.1 结果

| # | 场景 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 01 | 单一全宽对话：无会话列表 / 新建 / 切换 | PASS | `ai-session-list=0`、`ai-session-new=0`、`[data-testid^=ai-session-]=0`、「新建会话」文案=0、`ai-chat=1`；chat/dialog 宽度比 `0.974`；截图 `ai-01-open.png` |
| 02 | 输入框焦点浅边框 | PASS | textarea 聚焦 `borderRgb=[228,228,231]`、宽度 `0.877px`；外层 focus-within 同为 `[228,228,231]`；截图 `ai-02-input-focus.png` |
| 03 | 模型 Popover 1024×768 不裁切 | PASS | viewport `1014×738`；panel `x=513,w=448,right=961,bottom=592`；thinking `x=800,right=960`；`overflowRight=false`、`overflowBottom=false`、右缘命中 `[true,true]`、`bodyOverflowX=false`；截图 `ai-03-model-popover-1024.png` |
| 04 | Markdown / 代码块 | PASS | mock 流式回复；`assistantCount=1`（单气泡）、`markdown=1`、`h1=1`、`pre=1`、`code=1`、`li=1`；聊天文本无 ```；截图 `ai-04-markdown.png` |
| 05 | 问题卡提交 | PASS | 2 个 radio；空/推荐项可选；点「提交答案」→「已提交 / 已回传给 AI」；`ai:ask` prompt=`[form answers — qform1]\n- 选择页面: 首页`；截图 `ai-05-question-submit.png` |
| 06 | 真实发送 1 条短 prompt | PASS | `ai:ask` 真实调用 **1** 次，prompt=`只回复两个字：收到。不要调用工具。`，model=`deepseek-v4.1-flash`；新增 assistant 文本气泡 **1** 个，末条文本「收到」，busy=false，无错误条；截图 `ai-06-real-send.png` |
| 07 | 无模型：发送前置禁用、0 请求 | PASS | 触发器「选择模型」，浮层「暂无模型」；`ai-send-hint=暂无可用模型：请先在 设置 › 模型 中启用至少一个模型`；发送按钮 disabled；`ai:ask=0`；截图 `ai-07-no-model.png` |
| — | 进程 / 崩溃 / 致命日志 | PASS | crash=0；`window-close` exit 0 / 3,511ms；排除 seed 原型 Vant CDN 与 `Unexpected token '.'` 噪声后 fatal=0 |

### 2.2 关键截图

![单一全宽对话](../shots/retest-b-ai-pick/ai-01-open.png)

![1024 下模型 Popover 完整可见](../shots/retest-b-ai-pick/ai-03-model-popover-1024.png)

![Markdown 标题 / 代码块 / 列表](../shots/retest-b-ai-pick/ai-04-markdown.png)

![真实发送回复「收到」](../shots/retest-b-ai-pick/ai-06-real-send.png)

## 3. Ctrl 拾取域（`e2e/wave4-b-pick.spec.ts`）

### 3.1 结果

| # | 场景 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 00 | 隔离 + 进入 `测试1/首页` + 桌面端 | PASS | `userData` 与域目录一致；`sidebar-tree` 可见；`stage-frame[data-kind=pc][data-fit=off]`；基线 `首页.html` `2D72B71839FC`、annotations=2、links=2、queue=0；截图 `pick-00-entry.png` |
| 01 | 真实普通点击（无 Ctrl） | PASS | 不弹 `pick-requirement-dialog` / `pick-modify-dialog`；队列不变；选中计数=0；截图 `pick-01-plain-click.png` |
| 02 | 无修饰键拾取接线（帧桥 PICK_RESULT） | PASS | 选中计数=1、选中框=1；两类弹窗均 0；队列不变（只选中、不弹窗） |
| 03 | Ctrl+点击 → 需求弹窗 → 空校验 → 入队 | PASS | `pick-requirement-dialog` 可见；target selector=`[data-pr-id="pr-p-39"]`；选中计数=1；空提交拦截「请输入需求内容。」；提交后队列 0→1，item `{selector, text, htmlFile:首页.html}`，toast「已加入待提交队列。」；截图 `pick-02-requirement-dialog.png`、`pick-03-requirement-queued.png` |
| 04 | Ctrl+Shift+点击 → 修改弹窗 → 取消 / 保存 | PASS | 弹窗预填当前文本「无线降噪蓝牙耳机 长续航」；取消后队列不变、选择保留；重开改文案保存后队列 1→2，`text=将该元素内容改为：W4 复测修改后的商品文案`；截图 `pick-04-modify-dialog.png`、`pick-05-modify-saved.png` |
| 05 | 选中框滚动 / 缩放不漂移 | PASS | 滚动 `+80px` 后框移动 `79.87px`，偏差 `0.0046px`；75% 偏差 `0.0056px`；125% 偏差 `0.0030px`；均在 ±4px 断言内；截图 `pick-06-scroll-sync.png`、`pick-07-zoom-75.png`、`pick-08-zoom-125.png` |
| 06 | Sheet 焦点陷阱 / Esc 回归 | PASS | 打开后 `activeElement=inspector-sec-req`（在 Sheet 内）；Tab×10 全在 Sheet 内（含 `overlays-sheet-inspector` 首尾循环）；Shift+Tab×3 仍在 Sheet；Esc 后焦点回 `overlays-open-inspector`，选择保留；截图 `pick-09-sheet-focus.png` |
| 07 | 清空队列 / 数据完整性 / 退出 | PASS | Confirm 清空后 `edit_queue_v1="[]"`；HTML hash 不变；annotations=2、links=2；致命日志=0；`window-close` exit 0 / 346ms；截图 `pick-10-final.png` |

### 3.2 关键截图

![Ctrl+点击需求输入弹窗](../shots/retest-b-ai-pick/pick-02-requirement-dialog.png)

![Ctrl+Shift 修改信息弹窗](../shots/retest-b-ai-pick/pick-04-modify-dialog.png)

![75% 缩放选中框不漂移](../shots/retest-b-ai-pick/pick-07-zoom-75.png)

![Sheet 焦点在浮层内循环](../shots/retest-b-ai-pick/pick-09-sheet-focus.png)

## 4. P0 / P1

**无。P0=0，P1=0，P2=0。**

未发现：AI 白屏/崩溃、真实发送重复扣额度、Markdown 渲染异常、Popover 裁切、无模型仍发请求、Ctrl 拾取错元素、弹窗提交丢失、选中框漂移、Sheet 焦点逃逸、原型 HTML 被改写、进程无法退出。

## 5. P3 / 观察 / ENV

| ID | 级别 | 现象 | 证据 | 影响 / 处理 |
| --- | --- | --- | --- | --- |
| `B-PICK-OBS-plain-click` | P3 | 真实无修饰键点击不会进入拾取（当前实现仅 Ctrl/Meta 按住时武装帧）；因此真实普通点击既不会弹窗也不会新增选中。无修饰键的「只选中、不弹窗」接线已用帧桥 `PICK_RESULT` 验证 | `plainClick.selectionAfterPlainClick=0`；`plainPickBridge={selected:1,dialogs:0}` | 与「普通点击只选中」的产品措辞存在口径差异；若要求纯鼠标点选，需要产品增加常驻拾取态，否则保持 Ctrl 武装模型即可 |
| `B-PICK-OBS-queue-page` | P3 | 待提交条目的 `page` 字段为空（当前 `app-store.page` 未赋值）；`selector + htmlFile` 仍可唯一定位 | queue item `page=""`、`htmlFile="首页.html"` | 不影响本轮入队/提交；若后续按 page 做多页去重，建议补齐页面名 |
| `B-AI-OBS-usage` | P3 | 真实一轮回复前后仍出现 3 条「用量已更新」元消息，信息重复（继承 B-AI-O7） | `ai-06-real-send.png` 聊天流可见多条用量行 | 可合并为一条或折叠进 Trace，不影响发送/单气泡 |
| `B-AI-ENV-seed-console` | ENV | AI 域原始 console 2 条 + pageerror 1 条，均来自 seed 原型 `大厅` 的 Vant CDN CSP 与 `Unexpected token '.'`；排除后 fatal=0 | `evidence.console={errors:2,pageErrors:1,crashes:0}` | 非 PlanD AI 链路问题；建议后续 seed 清理外部 CDN/脚本 |
| `B-PICK-ENV-seed-console` | ENV | 拾取域原始 console 2 条，为 `首页` seed 原型的 Vant CDN CSP 噪声；排除后 fatal=0 | `evidence.final.fatal=[]`、`consoleErrors=2` | 非拾取链路问题 |

## 6. 复测范围与 E2E 更新说明

旧版 `wave4-b-ai.spec.ts` / `wave4-b-pick.spec.ts` 已按当前 UI 重写，移除以下漂移断言：

- AI：`ai-session-list` / `ai-session-new` / 会话切换 / 新建会话 / 会话持久化断言；改为单一全宽对话断言。
- AI：旧「无模型时发送仍可点」OBSERVE；改为「发送按钮 disabled + 原因提示 + 0 ai:ask」PASS。
- AI：旧 `[data-slot="select-content"]` 直读；改为 `ai-model-popover` + 视口碰撞几何 + 右缘命中。
- 拾取：旧「Ctrl+点击直接选中、无弹窗」；改为「Ctrl+点击弹需求框、Ctrl+Shift 弹修改框」。
- 拾取：旧「选中框漂移 P2」；改为实时 rect 同步断言（滚动 + 75%/125% 缩放）。
- 拾取：旧「Sheet 焦点仍在背景」；改为焦点进入 + Tab 循环 + Esc 回归。

本文件只改 `e2e/wave4-b-ai.spec.ts`、`e2e/wave4-b-pick.spec.ts`、本报告与 `docs/wave4/shots/retest-b-ai-pick/**`；未改 `src/**`、`main/**`、`tests/**`、`package.json`，未 `npm install`，未 commit。

## 7. 证据与清理

- 截图目录：`docs/wave4/shots/retest-b-ai-pick/`（18 张，AI 7 + 拾取 11）
- 失败报告目录（本轮无最终失败）：`%TEMP%/pland-wave4/failures/b-ai|b-pick/`（首轮调试失败记录，未纳入结论）
- 证据摘要：`%TEMP%/pland-wave4/retest-b-ai-summary.json`、`%TEMP%/pland-wave4/retest-b-pick-summary.json`
- 数据目录：`.devdata-wave4-b-ai`、`.devdata-wave4-b-pick` 均已删除
- 真实发送额度：AI_REQUESTS=1；mock ai:ask 不触网
- 进程：两域均 `window-close` exit 0；未 kill 其他域正在运行的 Electron
