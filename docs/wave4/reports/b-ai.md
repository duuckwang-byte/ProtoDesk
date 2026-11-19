# Wave4 B 全量体验 · AI 对话 报告

- 日期：2026-11-13
- Agent / owner：Wave4 B 子 agent（B-AI 重点域；真实发送按 AI-LIVE 独占额度）
- 阶段：B 全量体验
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` 2026-11-13 15:36:43 / SHA256 前 12 位 `AA42E6DCAF5B`
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-ai`
  实际 `app.getPath('userData')` 精确匹配（harness 启动后断言通过）
- seed：`_wave4-seed.json` present；`node e2e/wave4/seed.mjs --domain b-ai`（复用 `%TEMP%\pland-wave4\seed`，源指纹 `17ad3a89355d…`，109 files / 1,110,299 bytes）
- 运行命令：
  `npx playwright test e2e/wave4-b-ai.spec.ts --workers=1 --output=%TEMP%\pland-wave4\pw-b-ai`
  0 真实请求复测：`$env:WAVE4_B_AI_MOCK_ONLY='1'; npx playwright test e2e/wave4-b-ai.spec.ts --workers=1 --output=%TEMP%\pland-wave4\pw-b-ai`
- 真实请求/网络：**AI_REQUESTS=2**（B 阶段总计：首轮作用页真实验证 1 次 + 单气泡/Markdown 真实验证 1 次）；GIT_NETWORK=无
- 收尾：Electron exit 0（`window-close`）；`.devdata-wave4-b-ai` 已删除；仅保留 `docs/wave4/shots/b-ai/` 截图与临时证据摘要

## 0. 一句话结论

真实 Agent 链路可用：Codebuddy ACP 完成 2 次真实短对话，回复合并为 **1 个 assistant 文本气泡**，流式期间自动滚动到底部（gap < 1px），停止按钮在 busy 时可用，Trace 有控制事件、复制/清空有效，作用页 `extra.activePage` 真实透传。**P0=0，P1=0，P2=6**；最优先修「小窗宽下双列 Popover 右侧思考列被裁切」与「Markdown/代码块不渲染」。

## 1. 执行方式与额度

| 项 | 实测 |
| --- | --- |
| 真实发送 A（作用页） | prompt：`只回复两个字：收到。不要调用工具。`；模型 `deepseek-v4.1-flash`；总耗时 **25644ms**；回复「收到」；`ai:ask` 捕获 `extra.activePage=proj-scroll`、`targetFile=大厅.html`、`uiKind=mobile` |
| 真实发送 B（单气泡/Markdown） | prompt：三行 Markdown + js 代码块；ACP 会话实际模型 `hy4free`（Trace `ACP_CONFIG model=hy4free`，thinking=`enabled`）；首字 **32091ms** / 完成 **34224ms**；文本 34 字 `# 冒烟 ```js console.log(1) ``` - 通过` |
| 真实请求总数 | **2**（严格 ≤2；失败/被阻断的发送未产生 `ai:ask`） |
| 停止 / 重试 / 权限 / 问题卡 | 主进程 mock `ai:ask` / `ai:event`，**0 次真实网络**；可控长流与权限事件只走隔离副本 |
| 无模型空态 | 第二次冷启动 + stub `ai:models` 返回空目录，**0 次真实网络** |
| 持久化 / 模型/思考级联 | `WAVE4_B_AI_MOCK_ONLY=1` 复测（0 真实请求），避免为复跑再烧第 3 次额度 |
| 轮次备注 | 首轮脚本用 `Esc` 收 Popover 误关 AI Dialog，导致 1 次发送未发出（0 次 `ai:ask`）；改为点击 trigger 收起后重跑。该次为测试脚手架问题，不计产品缺陷 |

> 真实发送 A 与 B 分别覆盖了两个 Codebuddy 可见模型：`deepseek-v4.1-flash`（作用页/回复）与 `hy4free`（Markdown/单气泡/耗时）。两者均在 seed 白名单内，发送均成功。

## 2. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 01 | 打开 AI：单选择器 / 状态胶囊 / 快照占位 / 作用页 | PASS | 截图 `01-ai-open.png`；`ai-model-selector`=1；模型 `deepseek-v4.1-flash`；思考「默认」；作用页 4 项；沙箱=`测试1`；CLI=`● CLI 就绪`；Agent=`Codebuddy Code`；空态「暂无消息」；快照按钮 disabled + title 说明占位 | — |
| 02 | 模型/思考双列 Popover | PASS | 截图 `02-model-popover.png`；DOM 双列=2 个 listbox；模型 2（deepseek* / hy4free）；思考 1（默认占位）；无搜索框（设计边界）；两列 `overflow-y:auto`。默认小窗下右侧列视觉裁切，见 P2-1 / 步骤 15 | P2-1（视觉裁切） |
| 03 | 真实发送（单气泡）：首字 / 完成 / Markdown / 自动滚动 | PASS | 截图 `03-real-send1-streaming.png`、`03-real-send1-reply.png`；AI_REQUESTS=1；首字 32091ms；完成 34224ms；154 采样点（11 点已有文本）；气泡 max=1 / final=1；相邻文本气泡=0；文本 34 字；thinking=1；工具卡=0；`pre/code=0/0`、fence=8（原样 Markdown）；scrollHeight 449 / clientHeight 293、底部 gap **0.30px**；停止按钮捕获为启用；内部事件泄漏=无 | P2（Markdown 原样展示，见 P2-2） |
| 04 | Trace：真实链路控制事件 + 深色面板 | PASS | 截图 `04-real-trace.png`；5 行；`ACP_CATALOG / SESSION / ACP_CONFIG / RUN_STARTED / DONE`；背景 `rgb(9,9,11)`；正文无 `acp_catalog/run_started` 泄漏 | — |
| 05 | 思考档位动态 + 换模型 thinking 重置 | PASS | 真实 ACP 公告 2 档（`high / enabled`，`configOptions=5`）；mock 复测公告 3 档（`high / medium / enabled`）；切 `high→medium` 成功；换模型 `hy4free` 后思考回落 `default`（重置=是）；复位 `deepseek-v4.1-flash`；未发送第二条消息。截图 `05-model-switch-thinking-reset.png` | — |
| 06 | 会话列表：新建 / 切换 / 入口盘点 | PASS | 会话 1→2；新会话空态「暂无消息」；切回首个发送会话后 1 个 assistant 气泡仍完整；列表按钮只有 `+ 新建会话`；重命名/删除/清空入口=0 | P2（会话管理缺失，见 P2-3） |
| 07 | 作用页 `extra.activePage` | PASS | 作用页真实发送（deepseek）捕获 `extra.activePage=proj-scroll`；mock 复测再次捕获 `extra.activePage=proj-scroll`、`targetFile=大厅.html`、`uiKind=mobile`、`model=deepseek-v4.1-flash`。截图 `07-real-send2-active-page.png`、`07-active-page-mock.png` | — |
| 08 | 关闭 → reload → 重开持久化 | PASS | mock 复测：模型切 `hy4free` → reload 后仍 `hy4free`；会话=2；active 会话标题=`只回复两个字：收到。不要调用工具。`，回复「收到」保留；另一会话文本 34 字完整；作用页刷新后回落「自动」（本地态，不持久化）。真实单会话 reload 持久化已在 A 阶段 `ai-live.md` 步骤 5 通过。截图 `08-persist-reopen.png` | — |
| 09 | mock 长流：自动滚动 / 停止 / 取消清理 | PASS | 截图 `09-mock-stop.png`；busy 中停止按钮=启用；滚动 467/293、gap≈0（-0.56px 子像素）；点击停止 → `ai:cancel`=1；busy 回落；保留已生成文本 695 字；无错误条 | — |
| 10 | mock 停止后重试：新 run / 新气泡 | PASS | 截图 `10-mock-retry.png`；`ai:ask` 2→3；assistant 气泡=2；新气泡文本「重试成功」；不拼接上一轮长流文本 | — |
| 11 | 权限卡：记住选择 + 允许 / 拒绝 | PASS | 截图 `11-permission-allow.png`、`11-permission-deny.png`；卡 1：勾选「记住选择」+「允许一次」→ `{decision:allow-always, optionId:opt-always}`，卡状态「已允许」；卡 2：「拒绝」→ `{decision:deny, optionId:opt-deny}`，状态「已拒绝」 | — |
| 12 | 问题卡渲染 + 提交入口 | OBSERVE | 截图 `12-question-card.png`；`ai-questionnaire` 可见；radio=2；「首页（推荐）」；**提交按钮=0**，可填写但无法回传 | P2-4 |
| 13 | Trace 复制全部 / 清空 / 事件数 | PASS | 截图 `13-trace-panel.png`、`13-trace-cleared.png`；深色 `rgb(9,9,11)`；行数 4–6（事件集不同）；复制写入剪贴板 120–505 字符，按钮变「已复制」；清空后 0 行 + 「暂无执行日志」 | — |
| 14 | 错误：断网返回 / 抛异常 / ACP error / 恢复 | PASS | 截图 `14-error-network.png`、`14-error-acp.png`；`ERR_INTERNET_DISCONNECTED`、`ECONNRESET`、`ACP_MODEL_UNSUPPORTED` 均在 `ai-dialog-error` 清晰显示；busy 回落、输入框可用、停止按钮禁用；ACP error 另有错误气泡；下一次发送清除错误并恢复「恢复成功」；无崩溃 | — |
| 15 | 视口 1024×768 / 600×900 | OBSERVE | 截图 `15-viewport-1024.png`、`15-model-popover-1024.png`、`15-viewport-min-width.png`；1024 下 dialog 982px@x16 未溢出；**级联浮层 right=1232 / viewport=1014，右侧思考列被裁切**；600×900 被产品 `minWidth=1024/minHeight=680` 钳制为 1025×900 | P2-1 / ENV（600 不可达） |
| 16 | 键盘：Shift+Enter 换行不发请求 | PASS | textarea 含换行；`ai:ask` 未增加（9→9） | — |
| 21 | 无模型空态 | PASS | 截图 `21-no-model.png`；模型触发器「选择模型」；模型项=0；浮层「暂无模型」；0 真实请求 | — |
| 22 | 无模型发送：错误清晰、不崩 | OBSERVE | 截图 `22-no-model-send-ready.png`、`22-no-model-error.png`；无模型时填入文本后发送按钮**仍可点**（P2）；点击后错误「未选择模型：请在设置 › 模型 中启用至少一个模型」；busy=false；未崩溃；0 真实请求 | P2-5 |

## 3. P0 / P1

**P0=0，P1=0。** 未出现白屏/崩溃/数据损坏/会话丢失；真实发送、单气泡、持久化、停止/重试、权限、Trace、作用页均可用。

## 4. P2 优先级（按影响 × 频率）

| 排名 | ID | 现象 | 影响 | 频率 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `B-AI-P2-1` | 1024 最小窗宽下，模型/思考双列 Popover 右侧「思考强度」列被窗口裁切（content right=1232 > viewport=1014；thinking 列 x=1076–1228）；1440 宽实测可完整显示（right=1409 < viewport=1429） | 用户看不到/难以点选思考档位；模型列与默认档位仍可用，发送不受阻 | 中（1024 最小窗宽 / 默认 1123 小窗） | `15-model-popover-1024.png`；`summary.steps.viewport.popover` | 给 Popover 加 collision padding / `align="end"` / 小视口改为单列级联；或让内容宽度随视口收缩 |
| 2 | `B-AI-P2-2` | AI 回复中的 Markdown/代码块原样显示：真实回复 `# 冒烟`、```` ```js ````、`- 通过` 均按纯文本渲染 | 可读性/复制体验差；标题、列表、代码块、表格都无法成形 | 高（每个 Markdown 回复） | `03-real-send1-reply.png`；`pre/code=0/0`、fence=8 | 接入 Markdown 渲染 + 代码块高亮 + HTML 清洗；保留纯文本兜底 |
| 3 | `B-AI-P2-3` | 会话列表只有「+ 新建会话」；无重命名、删除、清空入口 | 历史会话无法整理/清理；只能手动清 localStorage | 中（会话积累后） | `06-session-new.png`；列表按钮数组=`["+ 新建会话"]` | 会话卡 hover/菜单增加重命名、删除、清空（删除/清空走 Confirm） |
| 4 | `B-AI-P2-4` | 问题卡（`question-form`）可填写、有推荐项，但**没有提交按钮** | AI 提问无法回传答案；用户只能改用普通输入框描述 | 中低（出现 question-form 时） | `12-question-card.png`；`提交按钮=0` | 给 `Questionnaire` 接 `onSubmit`，复用既有 ai:ask/确认通道回传答案 |
| 5 | `B-AI-P2-5` | 无可用模型时，填入文本后发送按钮仍启用；点击后才报「未选择模型」 | 多一次无效往返；缺少“去设置选模型”的引导 | 低（模型目录为空/配置异常） | `22-no-model-send-ready.png`；`22-no-model-error.png` | 模型列表为空时禁用发送并显示「去设置 › 模型」入口；或在错误条上加入跳转 |
| 6 | `B-AI-P2-6` | 「历史快照」按钮禁用占位，title 明说 AI 对话框暂无打开快照面板的 store API | AI 对话框内无法查看历史快照；只能从预览工具栏打开 | 低中（想从 AI 回看快照时） | `01-ai-open.png`；`snapshotDisabled=true` | 补全局快照面板 open API，或暂时隐藏按钮避免“永远灰” |

## 5. P3 / 观察 / ENV

| ID | 级别 | 现象 | 处理建议 |
| --- | --- | --- | --- |
| `B-AI-O1` | P3 | 错误用顶部 inline error 条，不是 toast；但更持久、可复制，且不遮挡输入 | 保持 inline；如要 toast，双通道会重复 |
| `B-AI-O2` | P3 | 作用页下拉显示内部 key（`proj-scroll` / `fund-scroll` / `fund-detail-bar`），不是页面标题 | 显示页面友好名，value 仍用 key |
| `B-AI-O3` | P3 | 模型选择器无搜索框（设计边界）；当前仅 2 个模型，滚动未触发 | 模型多时再评估搜索/分组 |
| `B-AI-O4` | P3 | 不同冷启动下默认模型在 `deepseek-v4.1-flash` 与 `hy4free` 间波动（都可用，发送均成功） | 记录为目录刷新/默认项时机观察，非失败 |
| `B-AI-O5` | P3 | 作用页选择只存在组件本地态，reload 后回落「自动」 | 若要跨刷新保留，提升到 ai-store 持久化 |
| `B-AI-O6` | P3 | reload 后思考档位回到「默认」，ACP 档位列表需下一轮公告才恢复（继承 A 阶段 ai-live-O2） | 可缓存最近一次 ACP 档位列表 |
| `B-AI-O7` | P3 | 单轮真实回复前后出现 3 条「用量已更新」元消息，信息重复 | 合并为一条（或折叠到 Trace/详情） |
| `B-AI-E1` | ENV | 600×900 视口不可达：BrowserWindow `minWidth=1024`、`minHeight=680`，`setSize(600,900)` 实际为 1025×900 | 不是缺陷；B 的 600 矩阵按产品最小窗宽记录 |
| `B-AI-E2` | ENV | 页面级 2 条错误（1 console + 1 pageerror）：`about:srcdoc` 预览页的 vant CDN CSP 拒绝 + 一条预览脚本 `SyntaxError: Unexpected token '.'`；AI 对话框本身无报错，crashes=0 | 属 seed 预览页噪声；建议后续 seed 清理外部 CDN/脚本语法 |
| `B-AI-E3` | ENV | 真实首字 32.1s、完成 34.2s（Codebuddy/模型侧延迟）；期间停止按钮可用、UI 未卡死 | 记录为 Agent 延迟，不判 UI 缺陷 |

## 6. 结论

- 结果：**可放行**（P0=0、P1=0；P2=6 已按影响×频率分级；P3=7；ENV=3）。
- P2 挂账：`B-AI-P2-1`~`B-AI-P2-6` 均有复现步骤/截图，owner 由协调者指派；`P2-1/P2-2` 建议外发前修，`P2-3/4/5/6` 可进入下一迭代。
- 建议：外发前优先修 `B-AI-P2-1`（小窗宽级联裁切）与 `B-AI-P2-2`（Markdown 渲染）；`P2-3/4/5/6` 可排入体验迭代。
- 复测范围：AI 域 `e2e/wave4-b-ai.spec.ts` 两个用例（真实单气泡 + 无模型空态）；mock-only 复测 0 真实请求，步骤 01–16 中 14 项 PASS、2 项 OBSERVE（12/15）；空态 21 PASS、22 OBSERVE；3 个 OBSERVE 分别对应 P2-4/P2-1/P2-5。
- 证据保留：`docs/wave4/shots/b-ai/` 共 28 张 PNG；真实发送证据 `03-real-send1-*`、`04-real-trace.png`、`07-real-send2-active-page.png`；mock/持久化证据 `03-send1-reply.png`、`08-persist-reopen.png`、`09-mock-stop.png`、`10-mock-retry.png`、`11-permission-*`、`12-question-card.png`、`13-trace-*`、`14-error-*`、`15-model-popover-1024.png`、`21-no-model.png`、`22-no-model-*`。
- 写入边界：仅新增 `e2e/wave4-b-ai.spec.ts`、本报告与截图；未改产品代码、未改 `package.json`、未 `npm install`、未 commit。
