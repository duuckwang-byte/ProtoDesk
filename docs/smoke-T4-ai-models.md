# 冒烟测试 T4 — AI 对话 / 模型 / 设置域

- 范围：`src/renderer/features/ai/*（含 __tests__）`、`src/renderer/components/ai-elements/*`、`src/renderer/stores/ai-store.ts`、`src/renderer/features/settings/*`、`src/renderer/features/models/*（含 __tests__）`
- 方法：只读测试；未改 `src/tests/main/package.json`；未跑 `npm install`；未拉起真实 Agent；未 commit。
- 唯一写出：本文件。

## 1. 用例表（执行结果）

### 1.1 vitest

命令：`npx vitest run src/renderer/features/ai src/renderer/features/models`

结果（原文）：

```
RUN  v5.1.0 D:/文件/工具/原型工具-PlanD
Test Files  2 passed (2)
Tests  22 passed (22)
Start at  16:55:02
Duration  1.65s
```

明细：`src/renderer/features/ai/__tests__/adapters.test.ts`（归属/思考重置/空事件/权限归一）通过；`src/renderer/features/models/__tests__/fallback.test.ts`（移除回落/搜索不改勾选/batchFetchCheck）通过。

### 1.2 playwright

命令：`npx playwright test e2e/ai.spec.ts e2e/settings-models.spec.ts`

结果（原文）：

```
Running 13 tests using 2 workers
ok settings-models 含 6 Tab
ok 模型管理富信息卡片 Card + Checkbox + Badge + 计数
ok 搜索只过滤显示、不改勾选
ok ai-dialog 为居中 Dialog，不用 Sheet/Resizable
ok 自定义输入 32px 等高（h-8 输入 + 按钮）
ok 模型/思考两级级联存在（顶部 + 底部各一）
ok 空态与搜索无命中态文案就绪
ok thinking 非写死：选项只来自 ACP 输入
ok ACP 源公告 thought_level 系 key（动态源存在）
ok 模型切换重置 thinking（旧语义沿用）
ok 消息流容器与归属校验就绪
2 skipped（真机 gui，需 PLAND_E2E_APP_URL）
11 passed (1.0s)
```

## 2. 语义抽查（逐条 PASS/FAIL）

| # | 检查点 | 结论 | 证据 |
|---|---|---|---|
| S1 | AiDialog 只用 Dialog，无 Sheet/Resizable | PASS | `src/renderer/features/ai/AiDialog.tsx:1-8` 仅 import Dialog 系；`e2e/ai.spec.ts:39` codeOnly 断言 `not.toContain('Sheet'/'Resizable')` 通过 |
| S2 | thinking 选项全部来自 props/ACP，无写死档位 | PASS | `adapters.ts:418-453` `thoughtOptionsFromAcp` 空输入回 `[]`，无档位常量；`components/ai-elements/ModelSelector.tsx:31-34` 空时仅中性 `default/默认` 占位；`stores/ai-store.ts:285-302` 选项来自 `acp_config.configOptions` thought 系 key；全仓 grep `minimal/medium/'low'/'high'/'off'` 在 `features/ai`、`components/ai-elements`、`stores/ai-store.ts` 非测试代码零命中（仅命中 `font-medium` CSS 与 `__tests__` 输入数据） |
| S3 | 权限卡带 agentId+uiSessionId（data 属性） | PASS | `src/renderer/features/ai/PermissionCard.tsx:40-46` `data-agent-id={payload.agentId}` + `data-ui-session-id={payload.uiSessionId}` + `data-permission-id` + `data-scope-key`；展示行 `Agent:{agentId} · 会话:{uiSessionId}` |
| S4a | 发送参数口径 | 条件PASS（见 D1） | `stores/ai-store.ts:420-430` `ask(content, agentSessionId, '', modelId, extra{history,uiSessionId,agentSessionId,acpSessionId,freshSession,engine:'cli',acpConfig,reasoning})`；核心 5 元组（`ask(t, oid, dir, model, extra)` + `extra.uiSessionId/agentSessionId/acpSessionId/freshSession/acpConfig/reasoning`）与旧 `js/project-ai-export.js:7075` 一致；差异仅原型简化项，见 D1 |
| S4b | 零新 IPC 通道 | PASS | `features/ai`、`components/ai-elements`、`features/models` 内零 `invoke/ipcRenderer` 命中；`stores/ai-store.ts` 仅用 `protoAPI.ai.ask/cancel/confirmScope` + `lib/events.onAiEvent(ai:event)`；`preload.js:97-111` 证实三者映射到冻结通道 `ai:ask/ai:cancel/ai:scope-confirm(send)`；`types/ipc.d.ts:30-100` 70 通道冻结表未动 |
| S5 | 模型移除回落 found→defId→allIds[0]→aiStoreModel | PASS | `features/models/ModelManager.tsx:118-160` `resolveModelFallback` 逐字沿用旧 `§6311-6317`：found→`defId&&inList?defId:allIds[0]`→`aiStoreModel(next)`→`!found?cur=''`；`removeVisibleModelAndFallback:145-160` 组合移除+回落；`fallback.test.ts:20-58` 覆盖三分支 |
| S6 | 搜索不改勾选 | PASS | `ModelManager.tsx:212,262-287` `shown=listed.filter(matchesQuery)`，计数 `checkedCount` 取自 `listed`；`ModelFetchModal.tsx:42-61` `computeBatchFetchCheck` 仅翻转 `shownIds`；用例 `fallback.test.ts:65-88` 通过 |
| S7 | 设置 6 Tab 齐全 | PASS | `features/settings/SettingsDialog.tsx:111-116,118-197` `agent/models/design/sandbox/shortcuts/about` Trigger+Content 齐全；e2e 静态断言通过 |
| S8 | RHF/Zod/Table 无引用 | PASS | `features/ai`、`features/models`、`features/settings`、`components/ai-elements` grep `react-hook-form/zod/Table/useForm` 零命中（设计规范 Tab 为受控 Input+轻量校验，`SettingsDialog.tsx:94-100`） |

## 3. 缺陷清单

| ID | 级别 | 定位 | 描述 | 影响 | 建议 |
|---|---|---|---|---|---|
| D1 | P2（轻微偏离，非阻塞） | `src/renderer/stores/ai-store.ts:420-430` vs `js/project-ai-export.js:7075` | 新 `sendMessage.extra` 为简化版：`history:[]`（旧为 `(s.m).slice(-20)`）、`sandboxDir:''`（旧为 `aiSbxDir()`）、缺 `lastHash/activePage/targetFile/uiKind/enableTools`。核心归属五件套齐全，属原型简化但与“口径一致”严格字面有差 | 真机续跑/多轮历史、沙箱目录绑定弱于旧链路 | T4 结论放行；后续真机联调前补齐 `history/lastHash/sandboxDir` 或在报告外立项说明“原型有意简化” |
| D2 | P2（小缺陷） | `src/renderer/features/settings/AgentMatrix.tsx:65` vs `preload.js:97` | `invokeProtoMethod('ai','check')` 查找 `protoAPI.ai.check`，但网关实际暴露的是 `checkCli`（`ai:check`）。网关缺失时 `invokeProtoMethod` 收敛 `{ok:false}` 不抛错，故“重新探测”恒显示失败文案 | 设置 Agent Tab 探测按钮不可用，不影响其它 Tab | 改为 `invokeProtoMethod('ai','checkCli')` 或在 `lib/ipc` 加别名；加一个单测断言方法名存在 |
| D3 | P3（代码异味） | `src/renderer/features/models/ModelManager.tsx:222-224` | `emitToggle` 移除分支先调一次 `resolveModelFallback('', base, …)` 并丢弃返回值，随后又调一次有效计算。无行为影响（第二次覆盖），但多一次 `aiStoreModel` 副作用风险 | 可读性/误持久化风险极低 | 删除第 223 行无用调用 |

注：D2 在本次 T4 必跑用例之外（vitest/playwright 均未覆盖 `AgentMatrix.redetect`），为 grep 扩查发现；未复现真机，仅静态定位。

## 4. 结论

- 阻塞性缺陷：无。`vitest 22/22`、`playwright 11 passed + 2 skipped（需真机 URL）` 全部通过；S1–S8 中 S4a 为条件通过，其余全 PASS。
- T4 冒烟结论：**通过（附 D1–D3 非阻塞缺陷，见上表）**。建议后续：修复 D2 方法名、清理 D3、真机联调前对齐 D1 发送参数。
