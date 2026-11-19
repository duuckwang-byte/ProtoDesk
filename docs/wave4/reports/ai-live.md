# Wave4 A 冒烟 · AI 对话（AI-LIVE 真实发送）报告

- 日期：2026-11-13
- Agent / owner：A3 子 agent（AI-LIVE 独占槽）
- 阶段：A 冒烟（只报 P0/P1）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` 构建时间 `2026-11-13 13:49:26`，SHA256 前 12 位 `34D2A2CB18A8`（本轮未重新构建，非 STALE-BUILD）
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-ai`
  实际 `app.getPath('userData')` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-ai`（harness 启动后精确匹配断言通过）
- seed：`_wave4-seed.json` present（`node e2e/wave4/seed.mjs --domain ai` 复用 `%TEMP%\pland-wave4\seed`，源指纹 `6081a7f5fc2e…`）
- 运行命令（输出目录在 `%TEMP%`，仓库内只写本报告与截图）：
  `npx playwright test e2e/wave4-ai-live.spec.ts --workers=1 --output=%TEMP%\pland-wave4\pw-ai-live`
- 真实请求/网络：**AI_REQUESTS=1**（唯一一条 `ai:ask`，无重试、无第二条 prompt）；`GIT_NETWORK=无`
- 收尾：Electron exit 0（`window-close`，5788ms）；测试结束已删除 `.devdata-wave4-ai`（截图/报告保留）

## 0. 一句话结论

真实 Agent 链路可用：Codebuddy ACP + `deepseek-v4.1-flash` 完成一轮真实对话，回复 **合并为 1 个 assistant 文本气泡**、正文为 `冒烟通过`、无 `acp_catalog/run_started` 等内部事件泄漏；Trace 有 5 条控制事件摘要；关闭 → `page.reload()` → 重开 AI 后会话与 1 条完整回复仍在。**P0=0，P1=0**。

## 1. 前置：隔离配置 / Agent-模型配对（发送前预检，0 次请求）

| 项 | 实测值 | 说明 |
| --- | --- | --- |
| 隔离 `ai-config.json` | `agentId=codebuddy`、`mainAgent=codebuddy`、`engine=cli`、`model=deepseek-chat`、`acp.enabled=true` | seed 脱敏产物；**本轮未修改该文件** |
| `visibleModelsCli.codebuddy` | `["hy4free","deepseek-v4.1-flash"]` | 模型选择器白名单 |
| Agent 可用性 | `available=true`，`path=D:\AppFile\codebuudy\codebuddy.cmd`，`transport=acp` | `protoAPI.ai.checkCli()` 真实探测 |
| 实际发送模型 | `deepseek-v4.1-flash`（UI 已选，来自真实目录） | 配置里的 `deepseek-chat` 不在该 Agent 目录，被 AiDialog 的回落逻辑纠正，未触发「模型不被支持」 |
| 凭据状态 | `hasApiKey=false`（seed 已剥离）；CLI 引擎走本机 Codebuddy 登录态 | 未读取/打印任何凭据明文 |

> 预检基线：`AiDialog` 打开后 `ai-model-selector` 计数 = 1，`ai-model-select` / `ai-thinking-select` 各 1；`ai-dialog-error` = 0；`ai-status-cli` = `● CLI 就绪`；`ai-status-agent` = `Agent: Codebuddy Code`。

## 2. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 | 打开 AI 对话：单模型选择器 + 已选模型 + 思考档位 | PASS | 截图 `docs/wave4/shots/ai-live/01-ai-open.png`；DOM：`ai-model-selector`=1、可选模型=2（`deepseek-v4.1-flash`* / `hy4free`）、思考触发器=`思考 默认`；`ai-dialog-error`=0；耗时 4080ms | — |
| 2 | 真实发送唯一 1 条：`请只回复：冒烟通过` → 单气泡 | PASS | 截图 `02-streaming.png`（busy 中，停止按钮为启用态）、`02-assistant-reply.png`；**AI_REQUESTS=1**；总耗时 **23002ms**，首字 **21098ms**；采样 **106 点**（200ms 间隔，其中 10 点已有文本）；assistant 文本气泡 **max=1 / final=1**；正文长度 4、内容 `冒烟通过`；user 气泡=1；`fast-stream=否`；权限卡=0；工具卡=0；思考块=1；内部事件泄漏=无；`ai-dialog-error`=空 | — |
| 3 | 模型/思考切换后 thinking 重置（不发送第二条） | PASS | 截图 `03-thinking-options.png`、`03-model-switch-thinking-reset.png`；ACP 在真实跑完后公告 2 个思考档位 `high / enabled*`（发送前仅 1 个「默认」占位 → 证明选项动态来自 ACP，非写死）；切到 `high` 成功；再换模型 `hy4free` 后思考回落 `default`（重置=是）；随后复位到 `deepseek-v4.1-flash`；**全程未发送** | — |
| 4 | Trace 面板内部事件摘要 + 会话列表 | PASS | 截图 `04-trace-panel.png`；`ai-trace-view` 行数=5，header `ACP Stream · 5 events`；标签 `ACP_CATALOG`（agent=codebuddy · models=2 · source=acp）、`SESSION`（acpSessionId=01a1d385-…）、`ACP_CONFIG`（model=deepseek-v4.1-flash · thought=thought_level · configOptions=5）、`RUN_STARTED`（engine=cli · pid=41120）、`DONE`；会话列表=1，标题=`请只回复：冒烟通过`，副标题=`codebuddy · 01a1d385-…` | — |
| 5 | 关闭 AI → `page.reload()` → 重开：持久化 | PASS | 截图 `05-reopen-persist.png`；会话 1→1；assistant 文本气泡 1→1；正文与刷新前**逐字一致**（4 字 `冒烟通过`，无重复拼接）；思考块 602 字保留；耗时 2202ms | — |
| 6 | 停止 / 重试（真实链路） | SKIP | 按 `docs/wave4-smoke-plan.md` §6.1：真实链路只发 1 次，停止/重试需要可控长流，统一走 AI-MOCK；本 spec **未点击** `ai-stop-btn` / `ai-retry-btn`，避免第二次请求 | — |

> 单气泡判定（§6.2 口径）：106 个采样点中，凡是已出现 assistant 文本的采样点（10 点），`[data-slot="ai-message-ai"]` 数量均为 1；最终 done 后仍为 1。未出现「一词一气泡」。本轮模型插入了 1 段 `thinking`（`ai-reasoning`，602 字）与 3 条 `usage` 元消息，但文本段内部未被拆分，符合「有 thinking 时按段内不拆词判定」的口径。

## 3. 缺陷

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | **无 P0 / P1** | — | — | — | — |

## 4. 观察区（A 阶段只记录，不阻断）

| ID | 级别 | 现象 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- |
| ai-live-O1 | P2（潜在风险） | 隔离配置 `model=deepseek-chat` 不属于 Codebuddy 目录；本次因 UI 已有合法模型而未触发，但若「模型目录尚未加载完就发送」（store.modelId 为空）`ai:ask` 会回落到 `aiCfg.model`，存在 `ACP_MODEL_UNSUPPORTED` 风险 | 建议 B 验证 | 建议发送前置条件：模型目录为空时禁用发送，或让 `ai:ask` 在 `targetModel` 不被支持时回落到 ACP 公告首项 |
| ai-live-O2 | P2（状态显示） | `page.reload()` 重开后思考触发器回到「默认」占位、ACP 档位列表清空（`acp_config` 不回放，需下一轮才恢复） | 建议 B 验证 | 功能不受影响：`ai_model_reasoning` 仍在，下一轮 ACP 公告会参与解析；B 可评估是否持久化最近一次 ACP 档位列表 |

> 按 A 阶段过滤口径，另有若干 P3 文案/像素/瞬时态观察（用量元消息文案、重置后裸值标签、重开瞬时「CLI 检测中」等），不列入本表、不阻断。


## 5. 结论

- 结果：**可放行**（AI-LIVE 真实段）
- P0 = 0；P1 = 0；P2 = 2（观察/潜在，未阻断）；P3 = 0（按 A 阶段口径不报）；ENV = 0
- 阻断项：无
- 复测范围：无需复测；mock 段（停止 / 权限 / 重试）由 AI-MOCK 波次单独覆盖
- 备注：
  - 实际请求次数 = **1**（`AI_REQUESTS=1`），未点停止/重试，未出现权限请求；
  - `console error=0`、`pageerror=0`、`crash=0`，主进程 `stderr` 为空；
  - 首字延迟 21.1s 属 Agent/模型侧延迟（非 UI 卡死：期间停止按钮可用，流式期间的 10 个采样点始终只对应 1 个 assistant 气泡）；
  - 测试数据目录已清理，8 张截图与失败上下文（无）均保留在 `docs/wave4/shots/ai-live/`。
