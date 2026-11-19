# Wave4 A 冒烟 · 设置 / 模型 / Agent 域报告

- 日期：2026-11-13
- Agent / owner：Wave4 A1 子代理（设置域）
- 阶段：A 冒烟
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（工作树含并行域改动，本轮未 commit）
- 构建：`dist/renderer/index.html` = 2026-11-13 12:36:16，SHA256 `198725714478672764E49D1A5E8F478BCE8DAF4EAB95AD23A5F060989C9D5A2A`；主包 `assets/index-BHMDlo45.js` = 329,649 B，SHA256 `D525C677F6BBFF63E81B58CF5159A424A7C3E568A69D93E885BC9F26C69FDFF5`
- 环境：Windows / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；Playwright 视口覆盖 1440×900
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-settings`；实际 `app.getPath('userData')` = 同路径（精确相等，`app.isPackaged=false`）
- seed：`_wave4-seed.json` present；源指纹 `0c11ddd5d1434690dd0a6d430b6696f91142e5f709b4a6d45b454c94c498a8dd`；seed 107 文件 / 526,712 B；AI/Git 凭据已剥离（`copied=false`，`ai-credentials.json` / `git-credentials.json` entries 为空）
- 运行命令：`npx playwright test e2e/wave4-settings.spec.ts --workers=1 --reporter=list --output=C:\Users\allow\AppData\Local\Temp\opencode\wave4-settings-results-final`
- 真实请求/网络：`AI_REQUESTS=0`（未调用 `ai:ask`）；`GIT_NETWORK=无`；仅 `ai:test-connection` 对 `http://127.0.0.1:9/v1` 走无效地址错误路径，无付费请求
- 结果：**PASS**；同 spec 从干净 seed 连续执行 2 次均通过（26.1s / 25.8s），无 `-FAIL.png`

> 视口说明：本机 Electron 窗口被系统工作区限制为 1123×640，`max-h-[85vh]` 会把设置 Dialog 压到 544px。spec 用 `page.setViewportSize(1440×900)` 覆盖到标准桌面视口后测得 Dialog **779.996×579.996**（设计值 780×580），截图为 1440×900。这不是产品缺陷，仅记录环境约束。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 | 顶栏「设置」打开 Dialog；6 Tab 逐个切换；Esc 关闭 | PASS | `01-settings-open-780x580.png`、`02-tab-models.png`；DOM：`settings-dialog` 布局盒 779.996×579.996；`role=tab` 6 个（Agent 设置 / 模型管理 / 设计规范 / 沙箱存储 / 快捷键 / 关于软件）；6 个 TabContent 均可见；`settings-error`=0；Esc 后 `settings-dialog` 在 5s 内隐藏 | — |
| 2 | Agent Tab：真实行、重新探测、CLI/API 32px、transport=acp 单徽章 | PASS | `03-agent-real-rows.png`、`04-agent-acp-badges.png`；DOM：26 行，等于 `ai.checkCli` 返回的 26 个 Agent（集合完全一致）；`DEFAULT_AGENTS` 无代码定义、无文案；重新探测后仍 26 行且 `settings-error`=0；`engine-cli`/`engine-api` 实测高度 32/32px；20 个 `transport=acp` 行逐行检查，`badgeIssues=[]`（每行恰好 1 个文本为 `ACP` 的徽章，无小写 `acp` 徽章） | — |
| 3 | CLI ↔ API 切换；API Profile 字段/32px；测试连通性错误处理；关闭不误保存 | PASS | `05-api-profile-32px.png`、`06-api-test-error.png`、`07-api-reopen-not-saved.png`；API 协议/Base URL/API Key/显示按钮高度均 32px；Key 输入值为空、placeholder=`输入 API Key`（无已保存凭据）；`http://127.0.0.1:9/v1` + 空 Key 在 **46ms** 返回 `网络连接失败: fetch failed`，窗口数保持 1（无 GCM/原生对话框），stderr 无 credential manager 提示；关闭再用 Esc 重开，Base URL 仍为 `https://openrouter.ai/api/v1`，非草稿 `127.0.0.1:9`，无残留错误徽章；切回 CLI 后 `engine=cli`，可见模型恢复 `hy4free / deepseek-v4.1-flash` | — |
| 4 | 模型管理：菜单仅已选、搜索不改勾选、勾选持久化、全选/反选、获取模型弹窗、关闭不误保存 | PASS | `08-models-list.png`、`09-ai-menu-selected-only.png`、`10-models-32px.png`、`11-models-search-filter.png`、`12-models-batch-restored.png`、`13-model-fetch-modal.png`；模型页 17 个目录项、已选 2；AI 对话框菜单仅 2 项，集合与勾选集合完全一致（`Hy4` / `DeepSeek-V4.1-Flash`）；搜索 `deepseek` 显示 2 个、已选仍 2；取消 `hy4free` 后 `visibleModelsCli.codebuddy` 落盘为 1 项，重开仍为未选，AI 菜单不再出现；恢复后全选=17、反选=0、逐项恢复=2；获取模型弹窗 17 行、已选 2，勾选集合与模型页一致，关闭弹窗勾选不变；带搜索词关闭设置再重开，搜索框清空且勾选仍 2；7 个模型操作控件（搜索/自定义/添加/刷新/获取/全选/反选）实测高度均 32px | — |
| 5 | 设计规范 / 沙箱 / 快捷键 / 关于真实内容；版本非写死 | PASS | `14-design-tab.png`、`15-sandbox-tab.png`、`16-shortcuts-tab.png`、`17-about-tab.png`；设计规范 2 条（`spec-ui-mobile`、`spec-ui-desktop`）+ UI 库 3 条；沙箱根目录 = 主进程 `sandbox:list().root` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-settings\sandbox`；快捷键 3 行 = `Ctrl+Enter` / `Esc` / `Ctrl+F`；关于显示 `v1.2.0`，等于主进程 `app.getVersion()` 与 `protoAPI.app.getVersion()` 的 `1.2.0`，且 `AboutTab.tsx` 源码无 `1.2.0` 字面量 | — |
| 6 | 关闭设置后重开，状态一致；最终配置未越权保存 | PASS | `18-reopen-agent.png`；重开后 26 行、`engine-cli aria-pressed=true`、模型 2/17、设计规范 2 / UI 库 3、沙箱路径与关于版本均一致；最终 `ai.getConfig()`：`engine=cli`、`visibleModelsCli.codebuddy=["hy4free","deepseek-v4.1-flash"]`、`byok.baseUrl=https://openrouter.ai/api/v1`（未被草稿覆盖）、`byok.hasApiKey=false`；`ai-credentials.json` entries=0 | — |
| 7 | console / pageerror / crash | PASS | `consoleErrors=[]`、`pageErrors=[]`、`crashes=[]`、`fatalCount=0`；主进程 stderr 末尾为空；`assertCleanExit` 通过（window-close，exitCode=0，未触发 kill） | — |

## 2. 缺陷（P0/P1）

**无 P0 / P1。**

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | 本域 A 冒烟未发现 P0/P1 | — | — | — | — |

## 3. 观察区（A 阶段不阻断，不计入结论）

| ID | 级别 | 现象 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- |
| settings-OBS-1 | P2（观察） | 设置刚打开、后台 `load()` 尚未完成时立即切换引擎，可能出现「Agent 页/落盘配置已是 CLI，但模型页仍显示 `API 直连` + 475 个 API 模型，AI 菜单也显示 API 模型」的竞态；等待加载完成或重开设置后恢复。 | 是（B 修复/复测） | 首轮执行（run7）触发；代码：`SettingsDialog.tsx:513-518`（open 时 `load()`）、`AgentMatrix.tsx:173-182`（switchMode 不等待 load）、`settings-store.ts:473-549`（load 完成后整体 set）与 `settings-store.ts:700-728`（save 完成后整体 set）缺少请求序号/取消。本 spec 在 `openSettings()` 等待 `settings-loading` 结束后连续 2 次 PASS，故 A 不阻断。 |

> settings-OBS-1 首轮日志：`C:\Users\allow\AppData\Local\Temp\opencode\wave4-settings-run7.log`（失败信息为 `Expected {hy4free, deepseek-v4.1-flash}` vs `Received {nvidia/nemotron-3-ultra-550b-a55b:free, openrouter/free}`）。

> 其余观察（不单独列 ID）：测试连通性在网络不可达时返回 `fetch failed`，属文案层面，未计入；Dialog 高度受 1123×640 本机窗口的 `85vh` 限制，属环境约束，1440×900 视口下为设计值。

## 4. 代码锚点（只读核对）

| 行为 | 位置 |
| --- | --- |
| Dialog 780×580、6 Tab | `src/renderer/features/settings/SettingsDialog.tsx:632-667` |
| Agent 真实行、ACP 单徽章 | `src/renderer/features/settings/AgentMatrix.tsx:100-122`、`:322-350` |
| API Profile 字段与 32px | `src/renderer/features/settings/AgentMatrix.tsx:403-491` |
| 模型目录/勾选/全选/反选 | `src/renderer/features/models/ModelManager.tsx:272-299`、`:365-397` |
| 获取模型弹窗全量 + 勾选 | `src/renderer/features/models/ModelFetchModal.tsx:74-136` |
| 菜单仅已选派生 | `src/renderer/features/ai/adapters.ts:1001-1024` |
| 关于版本来自主进程 | `src/renderer/features/settings/AboutTab.tsx:14-27`、`src/renderer/stores/settings-store.ts:503,539` |
| 沙箱 / 快捷键真实数据 | `SandboxTab.tsx:20-38`、`ShortcutTab.tsx:23-27` |

## 5. 结论

- 结果：**可放行（A 冒烟）**
- P0 = 0；P1 = 0；P2 = 1（观察区，非阻断）；P3 = 0（未记录像素/文案）；ENV = 0
- 阻断项：无
- 复测范围：若后续修改 `settings-store` / `AgentMatrix` / `ModelManager`，复跑本 spec；若修 settings-OBS-1，额外复测「打开设置后立即切换引擎 + 模型页/AI 菜单」。
- 数据/凭据：未填写真实 API Key，未点击「保存 API 配置」/「保存并应用」；最终 `ai-credentials.json` entries=0，`ai-config.json` 的 `engine=cli`、`visibleModelsCli.codebuddy` 与基线一致、`byok.baseUrl` 未被草稿覆盖、`hasApiKey=false`。
- 清理：本域 `.devdata-wave4-settings` 已在报告完成后删除；Playwright 输出位于 `%TEMP%\opencode\wave4-settings-results-final`，未写入仓库 `test-results`。
- 合规：本轮只新增/修改 `e2e/wave4-settings.spec.ts`、`docs/wave4/reports/settings.md`、`docs/wave4/shots/settings/*.png`；未改 `src/**`、`main/**`、`tests/**`、`package.json`；未 `npm install` / `build`；未 commit。
