# Wave4 B 全量体验 · 设置 / 模型 / Agent 报告

- 日期：2026-11-13
- Agent / owner：Wave4 B 子 agent（B-SETTINGS 设置域）
- 阶段：B 全量体验
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` 2026-11-13 16:49:04 / SHA256 前 16 位 `F8B78205F9ACBC9C`；入口 chunk `index-B19X480y.js` 351,027 B / SHA256 前 16 位 `F0941FCB5F3635D9`
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-settings`
  实际 `app.getPath('userData')` 精确匹配（harness 启动后断言通过，`app.isPackaged=false`）
- seed：`_wave4-seed.json` present；`node e2e/wave4/seed.mjs --domain b-settings`（复用 `%TEMP%\pland-wave4\seed`，源指纹 `17ad3a89355d…`，109 files / 1,110,299 bytes）
- 运行命令：
  `npx playwright test e2e/wave4-b-settings.spec.ts --workers=1 --reporter=list --output=%TEMP%\pland-wave4\pw-b-settings`
  最终一轮：**1 passed / 52.0s**（测试体 51.4s）
- 真实请求/网络：**AI_REQUESTS=0**；**GIT_NETWORK=无**。仅 `ai:test-connection` → `http://127.0.0.1:9/v1` 不可达地址（41ms 返回 `网络连接失败: fetch failed`），未产生任何真实模型/网络请求。
- 凭据：未填写、未保存真实 API Key；dummy key 仅用于输入框显隐，随后清空。最终 `ai-credentials.json` = `{"version":1,"entries":{}}`，`byok.hasApiKey=false`。
- 收尾：Electron `assertCleanExit` 通过（`window-close`，退出码 0）；`.devdata-wave4-b-settings` 已删除；仅保留 `e2e/wave4-b-settings.spec.ts`、本报告与 `docs/wave4/shots/b-settings/*.png`。

## 0. 一句话结论

设置 6 Tab、26 个真实 Agent、17 个模型目录项、2 条设计规范 + 3 个 UI 库、沙箱真实路径、快捷键、关于版本、空态与 1024 宽布局均可用；「保存并应用」、保存失败 toast/错误条/勾选回滚、连通性错误路径通过。**P0=0，P1=2，P2=5，P3=6，ENV=2**。P1 为「dist 落后于 src」与「自研 Select 鼠标点选项不生效」，**外发前需先处理**。

## 1. 执行方式与额度

| 项 | 实测 |
| --- | --- |
| 测试入口 | `e2e/wave4-b-settings.spec.ts` 单用例，`test.setTimeout(900s)`，实际 51.4s |
| 设置外框 | 780×580 稳定；6 Tab 全部真实挂载；footer「关闭」、`Esc` 均可关闭 |
| Agent 探测 | `ai:checkCli` 真实返回 **26** 个 Agent；settings-store 同源渲染 26 行，集合一致 |
| 模型目录 | CLI 引擎 **17** 个目录项；已选基线 `hy4free`、`deepseek-v4.1-flash` 2 项 |
| 设计规范 | seed 基线 spec **2** 条、uilib **3** 条；本轮临时新增/导入/删除均在隔离目录 |
| 网络模拟 | 仅 `127.0.0.1:9` 不可达地址；保存失败/空态/文件导入用主进程 `ipcMain._invokeHandlers` 临时替换 handler，结束后恢复，未改产品代码 |
| 真实 Key | 0；`ai-credentials.json` entries=0 |
| Git | 0 次网络操作 |
| 截图 | 32 张（`docs/wave4/shots/b-settings/01…32`） |

## 2. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷 |
| --- | --- | --- | --- | --- |
| 01 | 首次打开设置：加载态 / 780×580 / 6 Tab 名称 | PASS | `01-settings-loading.png`（「正在读取设置…」「正在探测本地 Agent CLI…」）、`02-agent-tab.png`；Dialog `779.996×579.996`；Tab = Agent 设置 / 模型管理 / 设计规范 / 沙箱存储 / 快捷键 / 关于软件 | — |
| 02 | 6 Tab 逐个切换 | PASS | 6 个 `TabsContent` 均可见：`agent-matrix` / `model-manager` / `design-tab` / `sandbox-tab` / `shortcut-tab` / `about-tab` | — |
| 03 | footer「关闭」、Esc | PASS | footer 关闭、Esc 均在 5s 内隐藏；焦点回到背景（截图 `03-focus-escape.png` 为焦点在顶栏时 Dialog 仍打开） | — |
| 04 | 焦点陷阱 | OBSERVE | 从第一个 Tab `Shift+Tab`，焦点直接落到背景顶栏「设置」按钮（`inDialog=false`），Dialog 仍打开；源码 `dialog.tsx` 明确 TODO 未实现焦点陷阱 | P2-1 |
| 05 | Agent 真实行 / ACP 徽章 | PASS | 26 行 = `ai.checkCli` 26 个 id（集合一致）；20 个 `transport=acp` 行逐行检查，每行恰好 1 个文本 `ACP` 徽章，`badgeIssues=[]`；无 DEFAULT 假数据 | — |
| 06 | ACP 开关 | PASS | 关 → `acp.enabled=false`，开 → `true`；toast「已保存 ACP 开关」 | — |
| 07 | ACP 权限模式 | **P1 阻断** | 真实鼠标点击「全部批准」后下拉关闭但值仍为 `approve-reads`（`optionClickLost=true`）；用 `dispatchEvent('click')` 才落盘 `approve-all`，截图 `05-acp-permission.png`；恢复 `approve-reads` | P1-2 |
| 08 | 重新探测 | PASS | 按钮 `探测中… → 重新探测`；行数保持 26；`探测完成` 出现；`settings-error`=0 | — |
| 09 | API Profile 字段 / 协议 5 项 / Key 显隐 | PASS | 协议/Base URL/Key/显示按钮均 32px；协议下拉 5 项；Key 初始为空、placeholder=`输入 API Key`；显隐切换 `text/password` 正常；dummy key 清空 | — |
| 10 | 测试连通性（空 Key + 不可达 URL） | PASS | 41ms 返回错误徽章 `网络连接失败: fetch failed`；toast「连通性测试失败…」；窗口数仍 1（无 GCM/原生弹窗）；截图 `07-api-test-error.png` | — |
| 11 | API 草稿关闭不误保存 | PASS | Esc 关闭再开，Base URL 仍 `https://openrouter.ai/api/v1`，错误徽章清零；未写入 `127.0.0.1:9` | — |
| 12 | 「保存并应用」 | PASS | 草稿 `…/e2e-apply` 随 footer 应用；toast「设置已保存并应用」；Dialog 自动关闭；重开读到草稿值；截图 `08-api-apply-toast.png`；随后恢复原 URL 并切回 CLI | — |
| 13 | 模型菜单仅已选 | PASS | AI 对话框模型项 = 2，集合 = 设置页勾选集合；每项 `title` 为真实模型 id；截图 `10-model-menu-selected.png` | — |
| 14 | 获取模型弹窗全量 + 勾选 | PASS | 弹窗 `已选 2 / 17 个`、行数 17、勾选集合一致；勾选 `hy4std` → 3，取消 → 2，配置同步；截图 `12-model-fetch-modal.png` | — |
| 15 | 搜索不改勾选 | PASS | `deepseek` 命中 2/17 显示；已选仍 2、总数仍 17；截图 `11-models-search.png` | — |
| 16 | 保存失败 toast / 错误条 / 回滚 | PASS | 主进程注入 `{ok:false,error:'模拟保存失败（E2E）'}`；toast「保存失败：保存 AI 配置：…」+ 错误条 + 「重试」；取消勾选自动回滚为已选；截图 `13-save-failure-toast.png` | — |
| 17 | 全选 / 反选 / 恢复 | PASS | 全选 → 17；反选 → 0；逐项恢复 → 2；配置 `visibleModelsCli.codebuddy` 同步；截图 `14-models-select-all-restored.png` | — |
| 18 | 添加自定义模型 ID | PASS | 添加 `e2e/custom-model-not-real` → 18 项，归入「自定义模型」并勾选；取消后回到 17 项、配置移除；截图 `15-model-custom-added.png` | — |
| 19 | 切模型持久化 | PASS | AI 对话框由 `deepseek-v4.1-flash` 切到 `hy4free` → `localStorage.ai_model=hy4free`；`page.reload()` 后仍选中 Hy4；设置页该行显示「当前」；截图 `16-model-switch-persisted.png` | — |
| 20 | 移除当前模型 → 回落 | PASS | 取消勾选 `hy4free` 后设置页不改写 `ai_model`；打开 AI 对话框自动回落 `deepseek-v4.1-flash` 并持久化；截图 `17-model-fallback.png` | — |
| 21 | 无模型空态 | PASS / P2 | 设置页 `已选 0 / 共 0` + 「模型目录为空」；AI 对话框模型列「暂无模型」；但填入文本后发送按钮仍启用（`sendDisabled=false`），截图 `29-empty-models-ai.png` | P2-2 |
| 22 | 设计规范列表 / 新建 / 导入 / 绑定 / UI 库 | PASS | 基线 2 spec / 3 uilib；新建「E2E 临时规范」→ 3；导入 md → 4；项目绑定写入 `project.json` 并生成 `sandbox/测试1/design-spec.md`，解绑移除快照；新增「E2E 临时组件库」→ 4 并绑定；删除临时 spec 后回到 2；截图 `18…22` | — |
| 23 | 沙箱真实路径 | PASS | `sandbox-root` = 主进程 `sandbox:list().root` = `…\.devdata-wave4-b-settings\sandbox`，磁盘存在；截图 `23-sandbox.png` | — |
| 24 | 快捷键说明 / 本地校验 | PASS | 3 行值 `Ctrl+Enter` / `Esc` / `Ctrl+F`，aria-label 齐全；输入 `not-a-shortcut` 提示「格式非法」，「恢复默认」后消失；截图 `24-shortcuts.png` | — |
| 25 | 关于版本 | PASS | `about-version` = `v1.2.0` = 主进程 `app.getVersion()` = `protoAPI.app.getVersion()`；截图 `25-about.png` | — |
| 26 | 空态：无 Agent / 无规范 / 无 UI 库 | PASS | Agent「未探测到本地 Agent CLI（不显示占位/假数据）」；设计规范「规范库为空」「UI 库为空」；截图 `27`/`28`；恢复 handler 后 26 行 / 17 模型回归 | — |
| 27 | 1024×768 设置布局 | PASS | Dialog `780×580` @ x=122，未越界；`documentElement.scrollWidth=1024=clientWidth`；Dialog 内部横向溢出元素 0；截图 `30-1024-settings.png` | — |
| 28 | 1024 AI 模型 Popover | OBSERVE | Popover `right=1166.8 > 1024`，右侧「思考强度」列被窗口裁切（截图 `32-1024-ai-popover.png`） | P2-5 |
| 29 | 级联 Esc 探测 | OBSERVE | 设计规范项目绑定 Select 打开时 Esc → 整个设置 Dialog 关闭（截图 `31-select-esc-closed.png`）；AI 模型 Popover 打开时 Esc → 整个 AI Dialog 关闭 | P2-3 / P2-4 |
| 30 | console / pageerror / crash | PASS | `crashes=0`；非 ENV 致命错误 0；2 条 vant CDN CSP + 2 条 iframe `Unexpected token '.'` 均为 seed 预览页噪声，归 ENV | ENV-1 |

## 3. P0 / P1

**P0=0。P1=2。**

| ID | 级别 | 现象 | 复现 / 证据 | 影响 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `B-SET-P1-1` | P1 | **当前 dist 落后于 src**：源码 `ModelSelector.tsx` 已改为 portal + fixed + 碰撞钳制（含 `data-testid="ai-model-popover"`），dist `index-B19X480y.js` 仍是旧 absolute 版（无该 testid）；`AiDialog.tsx` 的无模型发送拦截也未出现在 dist | `build-consistency {sourceHasPortalSelector:true, distHasPortalSelector:false}`；`32-1024-ai-popover.png` 右侧裁切；`29-empty-models-ai.png` 无模型仍可发送 | 已修问题未随包发出，用户看到的仍是旧行为；1024 裁切、无模型发送拦截等回归 | 从当前 src 重新 `build:renderer`，用本 spec 复跑；发布前将 dist 与 HEAD 绑定 |
| `B-SET-P1-2` | P1 | **设置内自研 Select 的真实鼠标点击选项不生效**：mousedown 先触发 trigger onBlur，浮层在 mouseup/click 前被卸载，值保持原值。ACP 权限模式、API 协议、设计规范/UI 库选择均受影响 | `select-mouse-click {modeAfterMouseClick:'approve-reads', optionClickLost:true}`；用真实鼠标 down/up 点「全部批准」后下拉关闭但值不变；`dispatchEvent('click')` 才生效。源码 `src/renderer/components/ui/select.tsx:53` 的 `onBlur` 关闭浮层，`SelectItem` 的 `onClick` 已来不及执行 | 用户无法通过鼠标切换 ACP 权限模式/API 协议，属于核心设置不可用；无键盘替代（自定义 Select 无方向键/Enter 项处理） | 去掉 `onBlur` 关闭，或 `onMouseDown` `preventDefault`；建议直接换 Radix Select；修后用真实鼠标（含按下停顿 100ms）复测三类 Select |

## 4. P2（按影响 × 频率）

| 排名 | ID | 现象 | 影响 | 频率 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `B-SET-P2-1` | 设置 Dialog 无焦点陷阱：首个 Tab `Shift+Tab` 直接落到背景顶栏「设置」；Dialog 仍打开 | 键盘用户可把焦点移到遮罩后的顶栏，模态语义失效；Phase 7 可访问性门禁风险 | 每次键盘操作 | `03-focus-escape.png`；`focus-trap {inDialog:false}`；`dialog.tsx` TODO | 补 focus trap + 打开聚焦首项 + 关闭归还 opener |
| 2 | `B-SET-P2-2` | 无模型空态下 AI 发送按钮仍可点 | 多一次必然失败的发送；与 B-AI-P2-5 同源；当前 dist 未包含源码的 `sendBlockedReason` | 模型目录为空/配置异常 | `29-empty-models-ai.png`；`empty-ai {sendDisabled:false}` | 重建 dist（P1-1）；空模型时禁用发送并显示「去设置 › 模型」 |
| 3 | `B-SET-P2-3` | 设计规范项目绑定 Select 打开时按 Esc，整个设置 Dialog 关闭 | 用户只想收起下拉却退出设置，丢失上下文；API 协议/权限模式 Select 同样受影响 | 每次在下拉内按 Esc | `31-select-esc-closed.png`；`select-esc {settingsClosedBySelectEsc:true}` | Select 内 Esc `preventDefault+stopPropagation`，或把下拉注册为 overlay 层 |
| 4 | `B-SET-P2-4` | AI 模型/思考 Popover 打开时按 Esc，整个 AI Dialog 关闭 | 与 B-AI 首轮「Esc 收 Popover 误关 AI Dialog」一致（B-AI 当时判为脚手架；本次固定步骤复测认为是产品行为）；用户会丢失当前对话视图 | 每次在模型浮层内按 Esc | `1024-popover {aiClosedByPopoverEsc:true}`；关闭后 `ai-model-option=0` | Popover Esc 停止冒泡；浮层与父 Dialog 的 Esc 层级分开 |
| 5 | `B-SET-P2-5` | 1024 宽下 AI 模型 Popover 右边界 `1166.8 > 1024`，右侧思考强度列被裁切 | 小窗宽看不到/点不到思考档位；模型列仍可用 | 1024 最小窗宽 | `32-1024-ai-popover.png`；`popoverRight:1166.8448` | 重建 dist 使用源码 portal/fixed 碰撞钳制；补 1024/1123 视口回归 |

## 5. P3 / 观察 / ENV

| ID | 级别 | 现象 | 备注 / 建议 |
| --- | --- | --- | --- |
| `B-SET-O1` | P3 | 快速「切 API 直连」后立即点「保存并应用」存在并发竞态：一次复现最终 `engine=cli`，切换丢失；toast 顺序为「设置已保存并应用」先于「已切换到 API 直连」 | 低频边缘操作；建议 applySettings 等待/禁用并发保存，或给 settings-store 加保存队列；正式复测时按正常节奏等待 toast 后应用是通过的 |
| `B-SET-O2` | P3 | UI 库只有「新增 / 绑定 / 解绑」，无编辑/删除入口；加错只能手工改 `uilibs/index.json` 或删数据目录 | 设计规范有删除（两段确认），UI 库不对称；建议补删除 + 编辑 |
| `B-SET-O3` | P3 | 连通性错误文案 `网络连接失败: fetch failed` 偏技术化，不含 URL/协议/可操作建议 | 不影响错误识别；建议「无法连接 {baseUrl}，请检查地址/网络/代理」 |
| `B-SET-O4` | P3 | toast 会堆叠且重复：连续开关 ACP 出现两条「已保存 ACP 开关」，权限模式改两次出现两条；4s 自动消失 | 设置类高频操作时遮挡右下内容；建议同 key toast 合并/替换 |
| `B-SET-O5` | P3 | 设计规范删除为两段确认（删除 → 确认删除），无取消按钮/超时；误点第一次后需再点同一按钮 | 可用但学习成本高；建议 Confirm 弹窗或在 3s 后自动复位 |
| `B-SET-O6` | P3 | 快捷键修改只在本地校验，不持久化、不改变实际按键（Ctrl+F 仅文档面板内生效） | 产品文案已明确说明，属设计边界；记录避免被误判为保存失败 |
| `B-SET-ENV-1` | ENV | seed 预览页 2 条 `vant@4/lib/index.css` CSP 拒绝 + 2 条 iframe `SyntaxError: Unexpected token '.'` | 与设置域无关；建议 seed 清理外部 CDN/脚本语法，避免污染所有域 console |
| `B-SET-ENV-2` | ENV | 两次失败运行后残留 `codebuddy --acp` 子进程，锁住 `.devdata-wave4-b-settings\sandbox`，需手动结束进程后才能重新 seed；正常通过运行后无残留 | 测试运维观察，非正常路径产品结论；建议失败收尾增加子进程清理，产品侧检查 ACP 子进程回收 |

## 6. 代码锚点（只读核对）

| 行为 | 位置 |
| --- | --- |
| 设置 780×580 / 6 Tab / footer | `src/renderer/features/settings/SettingsDialog.tsx:630-769` |
| Agent 真实行 / ACP 单徽章 | `src/renderer/features/settings/AgentMatrix.tsx:100-122`、`:325-350` |
| API Profile 字段 / 连通性 | `src/renderer/features/settings/AgentMatrix.tsx:403-491`、`SettingsDialog.tsx:567-605` |
| 模型目录 / 勾选 / 全选反选 / 自定义 | `src/renderer/features/models/ModelManager.tsx:272-317`、`:365-397` |
| 获取模型弹窗全量 + 勾选 | `src/renderer/features/models/ModelFetchModal.tsx:74-136` |
| 菜单仅已选 / 当前模型回落 | `src/renderer/features/ai/adapters.ts:1001-1024`；`AiDialog.tsx:137-146` |
| Dialog 无焦点陷阱 TODO | `src/renderer/components/ui/dialog.tsx:7-9` |
| 自研 Select onBlur / Esc | `src/renderer/components/ui/select.tsx:44-57`、`:104-130` |
| 全局 Esc 唯一决策点 | `src/renderer/app/modes/MainWindow.tsx:183-192` |
| 源码 ModelSelector portal/fixed | `src/renderer/components/ai-elements/ModelSelector.tsx:147-356` |
| 关于版本来自主进程 | `src/renderer/features/settings/AboutTab.tsx:17-31`；`settings-store.ts` load |

## 7. 结论

- 结果：**不可直接外发**（P0=0、P1=2、P2=5、P3=6、ENV=2）。核心设置链路在正常节奏下可用，但 P1-2 会让用户无法用鼠标切换 ACP 权限/API 协议；P1-1 使当前 dist 未包含源码已修的 1024 Popover 与无模型发送拦截。
- 建议顺序：① 重新构建 dist（P1-1）→ 复跑本 spec；② 修自研 Select 的 onBlur/点击竞争（P1-2）→ 用真实鼠标复测权限模式/协议/绑定；③ 补 Dialog 焦点陷阱（P2-1）与 Select/Popover Esc 冒泡（P2-3/4）；④ 1024 回归（P2-5）。
- 复测范围：`e2e/wave4-b-settings.spec.ts` 单用例；若改 `select.tsx`、`dialog.tsx`、`settings-store`、`AgentMatrix`、`ModelManager`、`ModelSelector`、`AiDialog`，必须重跑。
- 证据保留：`docs/wave4/shots/b-settings/` 共 32 张 PNG；关键证据 `01-settings-loading.png`、`03-focus-escape.png`、`05-acp-permission.png`、`07-api-test-error.png`、`08-api-apply-toast.png`、`13-save-failure-toast.png`、`16-model-switch-persisted.png`、`17-model-fallback.png`、`21-design-bound.png`、`29-empty-models-ai.png`、`30-1024-settings.png`、`31-select-esc-closed.png`、`32-1024-ai-popover.png`。
- 数据/凭据：未保存真实 API Key；最终 `ai-config.json` `engine=cli`、`baseUrl=https://openrouter.ai/api/v1`、`byok.hasApiKey=false`、`acp.enabled=true`、`defaultPermissionMode=approve-reads`；`ai-credentials.json` entries=0；项目绑定解绑后 `design-spec.md` 移除；`.devdata-wave4-b-settings` 已删除。
- 写入边界：只新增/修改 `e2e/wave4-b-settings.spec.ts`、`docs/wave4/reports/b-settings.md`、`docs/wave4/shots/b-settings/*.png`；未改 `src/**`、`main/**`、`tests/**`、`package.json`；未 `npm install`、未 build、未 commit。
