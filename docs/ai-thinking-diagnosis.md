# AI 对话框「思考强度」只有「默认」诊断

- 日期：2026-11-16
- 范围：React 渲染器 AI 对话框（`PLAND_RENDERER=react`）
- 隔离目录：`.devdata-wave4-thinkdiag`（由 `e2e/wave4/seed.mjs --domain thinkdiag` 创建，测试后已删除）
- 约束：只选模型 / 只触发 ACP 配置探测；**未发送任何 AI prompt**，未改代码、未安装依赖、未 commit。

## 0. 结论

**结论：不是「ACP 已获取但 UI 未展示」，而是「UI 从未触发 ACP 配置探测」，属于未获取。**
ACP 后端能力完整：`ai:models` 的 `probeModel` 分支和 `acp-runtime.previewModelConfig()` 都能在**不发送 prompt** 的情况下返回每个模型的 `configOptions`，实测 4 个 Agent 的主要模型都能拿到思考档位。但 React 渲染器在模型选择时只执行 `ai-store.setModel()`（dispatch + localStorage），没有任何 `ai:listModels({probeModel})` 调用；`thinkingOptions` 只在 `ai:ask` 的 `acp_config` 事件到达时才写入。因此**发送前 UI 中可选的每个模型都只有 1 个「默认」占位**。

不是以下原因：

| 怀疑项 | 实测/代码结论 |
| --- | --- |
| 只在 `done` 后写入 | 否。`acp_config` 在 `startTurn` 之前发出（`main/acp/acp-runtime.js:1667-1676`），发送开始即公告。 |
| `configOptions` 字段名不匹配 | 否。`thought_level` / `reasoning_effort` / `effort` 三种 id 实测都出现，且 `ai-store` 全部匹配（`src/renderer/stores/ai-store.ts:467-472`）。 |
| `ModelSelector` props 传空 | 否。`AiDialog.tsx:374-382` 正常传入 store 的 `thinkingOptions`；空的是 store 本身。 |
| 默认值覆盖 | 否。`ModelSelector.tsx:129-135` 只在数组为空时显示「默认」占位；有选项时按选项渲染。 |
| P0-2 `internalEventTrace` 把 `acp_config` 过滤掉 | 否。它只阻止事件进入聊天流；store 先处理 `acp_config`，再生成 Trace 行。注入同形事件后 UI 立即出现 4 个档位。 |
| 无 activeSession 时丢弃 | 否。归属校验是 `if (active && ...)`，无 active 时仍写入；且 `bindAiEvents()` 会先 `ensureActiveSession()`。 |

另有两类**真实存在的部分无档位**，不应误判为 UI bug：

- `codebuddy/hy4free`、`qoder/Qwen3.8-Flash`、`qoder/Qwen4-Max-Preview`、`qoder/auto`、`antigravity/gemini-3.8-flash-high` 被 ACP 判定为 `ACP_MODEL_UNSUPPORTED`（这些 UI 模型 id 与 ACP 实际公告不一致）。
- `antigravity/gpt-oss-120b-medium` 探测成功，但 ACP 本来就不提供思考项（只有 `model` / `mode`）。

## 1. 实测方法

1. `node e2e/wave4/seed.mjs --domain thinkdiag` 创建隔离 profile，读取并确认 `app.getPath('userData')` 精确指向 `.devdata-wave4-thinkdiag`。
2. 以 `PLAND_DEV_DATA_DIR=.devdata-wave4-thinkdiag`、`PLAND_RENDERER=react`、`engine=cli` 启动 Electron。
3. **UI 层**：依次切换 `codebuddy` / `opencode` / `qoder` / `antigravity`，打开 AI 对话框，逐个点击模型；每次等待约 1.3–1.6s，读取：
   - `[data-testid="ai-thinking-option"]` 数量与文案；
   - 模型/思考触发器文案；
   - `window.protoAPI.ai.listModels` 调用次数（在设置初始加载完成后才包裹计数）；
   - `window.protoAPI.ai.onEvent` 收到的 `acp_config` / `acp_catalog` 事件。
4. **探测层**：不点击发送，直接调用
   `window.protoAPI.ai.listModels({ engine:'cli', probeModel:<model>, agentId, uiSessionId, cwd })`。
   该分支只做 `ensureSession → setConfigOption → getStatus`，不启动 turn、不发 prompt。
5. **链路验证**：通过主进程 `webContents.send('ai:event', payload)` 注入一条与 `buildAcpConfigEvent()` 同形的合成 `acp_config`（明确标记 synthetic），验证 store/UI 是否能展示；随后切换模型，观察旧选项是否被清理。

## 2. 实测结果

### 2.1 UI 层：选模型但不发送

| Agent | UI 模型（实测可点） | 选中后思考选项 | 触发器 | `ai:models` 调用 | `acp_config` 事件 |
| --- | --- | --- | --- | ---: | ---: |
| codebuddy | `deepseek-v4.1-flash` | 1 个：默认 | 思考默认 | 0 | 0 |
| opencode | `opencode-go/deepseek-v4.1-flash` | 1 个：默认 | 思考默认 | 0 | 0 |
| opencode | `opencode-go/muse-spark-1.3-contributor` | 1 个：默认 | 思考默认 | 0 | 0 |
| qoder | `Qwen3.8-Flash`（UI 只显示这一个） | 1 个：默认 | 思考默认 | 0 | 0 |
| antigravity | `gemini-3.8-flash-high`（UI 只显示这一个） | 1 个：默认 | 思考默认 | 0 | 0 |

补充：

- `antigravity` 打开期间收到过 1 条 `acp_catalog`（后台模型目录刷新），但没有任何 `acp_config`。
- 模型选择后 `listModels` 调用数始终为 0；`setModel` 路径没有发起任何 IPC 探测。
- 这与用户截图完全一致：opencode 的 `DeepSeek V4.1 Flash 1017` / `Muse Spark 1.3 Contributor` 都在列表中，但思考列只有「默认」。

### 2.2 ACP 探测层：同一批模型实际能返回什么

`probeModel` 返回的 `configOptions` 中，思考项实测如下（`currentValue` 为 ACP 公告当前值）：

| Agent | 模型 | 结果 | 耗时 | 思考 config id | 档位 | 当前值 |
| --- | --- | --- | ---: | --- | --- | --- |
| codebuddy | `deepseek-v4.1-flash` | OK | 9179ms | `thought_level` | low / high / max / enabled | enabled |
| codebuddy | `hy4free` | `ACP_MODEL_UNSUPPORTED` | 8ms | — | — | — |
| qoder | `Qwen3.8-Flash` | `ACP_MODEL_UNSUPPORTED` | 14876ms | — | — | — |
| qoder | `Qwen4-Max-Preview` | `ACP_MODEL_UNSUPPORTED` | 13ms | — | — | — |
| qoder | `auto` | `ACP_MODEL_UNSUPPORTED` | 19ms | — | — | — |
| qoder | `qfmodel` | OK | 25ms | `reasoning_effort` | xhigh / low / medium / none | xhigh |
| antigravity | `gemini-3.8-flash` | OK | 15484ms | `thought_level` | low / medium / high | medium |
| antigravity | `gemini-3.8-flash-high` | `ACP_MODEL_UNSUPPORTED` | 14ms | — | — | — |
| antigravity | `gemini-4-argon` | OK | 30ms | `thought_level` | low / medium / high | medium |
| antigravity | `claude-opus-5-5` | OK | 35ms | `thought_level` | low / medium / high | medium |
| antigravity | `claude-sonnet-5-5` | OK | 43ms | `thought_level` | low / medium / high | medium |
| antigravity | `gpt-oss-120b-medium` | OK（无思考项） | 35ms | — | 只有 model / mode | — |
| opencode | `opencode-go/deepseek-v4.1-flash` | OK | 15766ms | `effort` | low / high / max / default | default |
| opencode | `opencode-go/muse-spark-1.3-contributor` | OK | 66ms | `effort` | minimal / low / medium / high / xhigh / default | default |

关键观察：

- **首个模型探测要 9–16s**（ACP runtime / session 首次启动），同 Agent 后续探测 8–66ms。后续若在选模型时同步探测，UI 必须有「读取中」状态，不能假设 1–3s 内一定返回。
- 探测**不产生 `acp_config` 事件**，只把结果返回给调用方；因此不能靠监听事件拿到选模型结果，必须由渲染层主动消费返回值。
- `codebuddy` 的 ACP 公告模型有 16 个，但 UI 白名单/目录里只有 `deepseek-v4.1-flash`；`qoder` ACP 只公告 `qfmodel`，UI 却显示 `Qwen3.8-Flash`；`antigravity` ACP 只公告 7 个 base id，UI 却显示 `gemini-3.8-flash-high`。模型目录与 ACP 实际公告存在偏差，选这些模型后即使修好思考探测，也会先收到 `ACP_MODEL_UNSUPPORTED`。

### 2.3 Store/UI 链路验证（合成 `acp_config`，非真实请求）

注入前：思考选项 1 个「默认」。

注入 `type:'acp_config'`、`thoughtConfigId:'effort'`、`configOptions:[...effort low/high/max/default...]` 后：

- 思考触发器变为「思考 default」；
- 思考列出现 **4 个选项**：low / high / max / default；
- Trace 出现 1 行：`[ACP_CONFIG] model=opencode-go/deepseek-v4.1-flash · thought=effort:high · configOptions=3`；
- 聊天区没有多出 `acp_config` 气泡。

随后点击另一个模型（`opencode-go/muse-spark-1.3-contributor`）：

- 思考触发器回到「思考 default」；
- 思考列仍是 **上一条模型的 4 个旧选项**（没有清空、没有重新探测）。

这证明：**事件 → store → ModelSelector 的展示链路是通的**，缺的只是「选模型时去拿配置」和「换模型时清旧选项」。

## 3. 链路对照与根因

### 3.1 模型选择路径

```
ModelSelector.onModelChange
  → AiDialog.tsx:380  store.setModel(v)
  → ai-store.ts:595-601  dispatch('set-model') + storeModel/storeReasoning
  → ai-store.ts:252-256  仅重置 thinkingLevel='default'
  ✗ 没有任何 ai.listModels / probeModel 调用
```

`src/renderer/stores/ai-store.ts:595-601`：

```ts
function setModel(modelId: string): void {
  dispatch({ type: 'set-model', modelId: str(modelId) });
  const st = getState();
  storeModel(st.modelId);
  storeReasoning(st.thinkingLevel);
}
```

`src/renderer/features/ai/AiDialog.tsx:374-382` 只把 `onModelChange` 透传给 `store.setModel`。在 React 源码中全局搜索 `probeModel`，只命中 `js/project-ai-export.js`、`main/services/ai-process-service.js` 和测试，`src/renderer` 内为 0。

### 3.2 主进程其实已经具备探测能力

- `main/services/ai-process-service.js:1304-1305`：`if (probeModel) return probeAcpModelConfig(h, probeModel, cfg);`
- `probeAcpModelConfig`：`main/services/ai-process-service.js:1235-1296`，调用 `acpRuntime.previewModelConfig()`。
- `previewModelConfig`：`main/acp/acp-runtime.js:1163-1282`，只 `ensureSession → setConfigOption → getStatus`，`activeAsk` 时返回 `busy`，**不 startTurn、不发 prompt**。
- 旧渲染器已经实现过：`js/project-ai-export.js:6669-6717` 的 `aiAcpProbeStart()`，带 agent/session/model 去重、`requestId` 丢弃旧响应、`aiAcpProbeApply()` 归属校验；`tests/verify-acp-config-ui.js:518-553` 专门断言了这套接线。
- React 重写时 `ModelSelector` / `ai-store` 没有迁移这段逻辑，直接导致本次回归。

### 3.3 `acp_config` 为什么只在发送后出现

`main/acp/acp-runtime.js:1667-1672`：

```js
safeEmit(ctx, buildAcpConfigEvent(plan, ctx, { ... }));
...
turn = state.runtime.startTurn(buildTurnInput(ctx));  // :1676
```

`acp_config` 只在 `acpRuntime.ask()` 的会话配置阶段发出，且 `emitAiEvent` 只发给发起 `ai:ask` 的 `ev.sender`（`main/services/ai-process-service.js:1794-1798`）。`previewModelConfig()` 不调用 `safeEmit`，所以选模型永远不会收到它。

`ai-store` 的 `thinkingOptions` 只有两个来源：

- 初始值：`src/renderer/stores/ai-store.ts:201` → `[]`
- `set-acp`：`src/renderer/stores/ai-store.ts:259-267`，由 `applyAcpConfigEvent`（`:457-503`）在 `handleEvent` 的 `type === 'acp_config'` 分支（`:516-519`）调用

因此发送前 `thinkingOptions` 必然为空，`ModelSelector.tsx:129-135` 必然渲染「默认」。

### 3.4 `internalEventTrace` / 无 activeSession 排除

- `src/renderer/features/ai/adapters.ts:451-462` 把 `acp_config` 列为内部控制事件，目的是**不进聊天**；`internalEventTrace` 在 `:538-549` 仍会生成 Trace 行。
- `ai-store.handleEvent` 在 `:516-519` 先处理 `acp_config` 并 `return`，早于 `aiEventToMessages`；聊天过滤不影响 store。
- 归属校验只在有 active 时执行：`ai-store.ts:463`、`:510-511` 都是 `if (active && ...)`；没有 active 不会丢，仍会 dispatch `set-acp`。
- `bindAiEvents()`（`ai-store.ts:913-923`）会先 `ensureActiveSession()`；正常从 AI 对话框发送时一定有 active session。
- 真正的限制是：`bindAiEvents` 只在 `AiDialog` 打开时订阅（`AiDialog.tsx:114`），关闭对话框期间的事件不会进 store；但 `acp_config` 本身只由发送产生，所以这不是本次现象的原因。

### 3.5 字段名与 props 排除

- 思考 config id：实测三种都在匹配表内：
  - `codebuddy` / `antigravity` → `thought_level`
  - `qoder` → `reasoning_effort`
  - `opencode` → `effort`
  `ai-store.ts:467-472` 的候选 id 全部覆盖，因此不是「字段名不匹配导致找不到」。
- 但**选项文案字段确实不匹配**：主进程 `normalizeSelectOptions` 输出 `{ value, name, description }`（`main/acp/acp-config.js:284-313`，`name` 在 `:305`），而渲染层 `thoughtOptionsFromAcp` 只读 `label`（`src/renderer/features/ai/adapters.ts:665-681`，label 在 `:677`），读不到就回落到 `value`。合成事件里传 `{value:'low', name:'Low'}`，UI 实测显示 `low` 而不是 `Low`，证实了这一点。修好探测后如果不同时修这里，用户会看到 `low/high/max` 这类原始值。
- `ModelSelector` props：`AiDialog.tsx:374-382` 传的是 store 的 `thinkingOptions`，不是空数组常量；DOM 中默认态数量=1，符合「空数组 → 占位 1 项」的实现，不是 props 误传。

## 4. 次生问题（建议一并修）

1. **换模型不清旧选项**：`set-model` 只把 `thinkingLevel` 重置为 `default`（`ai-store.ts:252-256`），没有清空 `thinkingOptions`。实测注入 4 个档位后切到另一个模型，仍显示旧模型的 4 个档位。修复探测时必须在 `set-model` 里清空或标记 `awaiting-probe`，否则会出现「新模型显示旧模型档位」。
2. **选项不持久化**：`thinkingOptions` 初始为 `[]`（`ai-store.ts:201`），`loadHistory`（`:380-413`）不恢复；只持久化 `ai_model` / `ai_model_reasoning`（`:423`）。重开应用后回到「默认」，直到下一次发送。既有报告 `docs/wave4/reports/ai-live.md:57`（`ai-live-O2`）已记录该现象；本次确认**不只在 reload 后，首次发送前也一直如此**。
3. **`acpConfig` 没有按模型隔离**：`setThinking` 把档位写进共享 `acpConfig[thoughtConfigId]`（`ai-store.ts:606-613`），换模型只重置 `thinkingLevel`，不清理旧值；下一次 `applyAcpConfigEvent` 可能把旧档位当成「已保存值」重新选中（`:481-494`），与「换模型重置」语义冲突。
4. **`acp_config` 没有校验事件 model 与当前 `state.modelId` 是否一致**：`applyAcpConfigEvent` 只校验会话归属，不校验模型；慢到的旧事件或并发探测结果可能覆盖当前模型的选项。修复探测时必须加 `agentId + uiSessionId + model` 三重归属。
5. **模型目录与 ACP 公告偏差**：qoder/antigravity 的 UI 白名单模型被 ACP 判为不支持；修好探测后应在选择时展示 `ACP_MODEL_UNSUPPORTED`，并考虑自动回落到 ACP 公告首项，而不是让用户发送后才报错。

## 5. 修复建议

### 5.1 首选：把旧渲染器的 probe 接线迁移到 React（主改渲染层，主进程不用改）

**改动层：`src/renderer/stores/ai-store.ts` + `src/renderer/features/ai/AiDialog.tsx`，复用现有 `ai:models` 的 `probeModel` 分支。**

1. 在 `ai-store` 增加探测缓存/动作：
   ```ts
   probeThinking(modelId: string, opts?: { force?: boolean }): Promise<void>
   ```
   - key：`agentId | uiSessionId | modelId`；
   - 状态：`idle | loading | ready | error`，保存 `configOptions` / `modelConfigId` / `error` / `requestId`；
   - 同一 key 的 `loading` / `ready` 直接复用；失败可重试，`busy` 视为瞬时错误；
   - 调用：
     ```ts
     api.ai.listModels({
       engine: 'cli',
       probeModel: modelId,
       agentId,
       uiSessionId,
       cwd: sandboxDir,
     })
     ```
   - 只接受 `r.ok && r.model === 当前 modelId` 的结果；`requestId` 或 model 不匹配直接丢弃。
2. 触发时机：
   - `AiDialog` 打开时，对当前模型探测一次（修复「重开/首次发送前无档位」）；
   - `setModel()` 时先清空/标记当前 `thinkingOptions`，再后台探测新模型；
   - 切换 Agent / 切换会话时按新 key 探测；
   - 不要在 `busy` 时探测（`previewModelConfig` 会返回 `busy`），等 `done` 后补一次，或直接跳过、保留「默认」。
3. 复用归一化逻辑：把 `applyAcpConfigEvent` 中「找 thought 项 → `thoughtOptionsFromAcp` → `resolveThoughtValue` → dispatch set-acp」抽成 `applyAcpSnapshot(snapshot)`，事件和 probe 结果走同一函数。
4. **不要**为了复用事件而伪造 `ai:event`；probe 直接返回结果，避免 Trace 里出现大量假的 `ACP_CONFIG` 行。若确实要走事件，需要新增独立 type 并明确 `synthetic/probe` 标记。

### 5.2 兼容 ACP 返回更多档位

- 思考项识别从「只看 id」改为「id 或 category」：
  ```ts
  const THOUGHT_KEYS = ['thought_level', 'reasoning_effort', 'effort', 'thinking'];
  const thoughtRaw = rawOpts.find((o) => {
    const id = String(o.id || o.key || '').toLowerCase();
    const category = String(o.category || '').toLowerCase();
    return THOUGHT_KEYS.includes(id) || THOUGHT_KEYS.includes(category);
  });
  ```
- 保留 ACP 原始档位，不做白名单/裁剪。实测已有 `minimal`、`xhigh`、`max`、`none`、`enabled` 等值，不能内置 `low/medium/high` 三档假设。
- 排除 `type === 'boolean'` 的思考开关（如 `enabled/disabled`），避免把布尔开关伪装成强度档位；布尔项应单独做开关或按 ACP 原值展示。
- 修 `thoughtOptionsFromAcp` 的文案字段：
  ```ts
  label: str(o.label || o.name || o.title || value)
  title: str(o.title || o.label || o.name || value)
  ```
  同时兼容 `options` 是 grouped 形态的情况（主进程 `normalizeSelectOptions` 已 flatten，但渲染层最好兜底）。
- `resolveThoughtValue` 的 `currentValue` 优先级保持不变；但 `acpConfig` 应按 `agentId|model|configId` 存，或在 `setModel` 时清除该 config 的 saved 值，避免换模型后旧档位复活。

### 5.3 展示与降级

- 探测中：思考列显示「读取中…」+ 可选「默认」；不要直接显示「默认」让用户误以为没有档位。
- 探测失败/模型不支持：显示「该模型未提供思考档位」或 `ACP_MODEL_UNSUPPORTED` 的具体原因；保留「默认」可发送。
- 首次探测 9–16s：不要阻塞发送；后台探测完成后自动展开选项。可缓存最近成功的 options（带 agent 版本/时间戳），启动时先展示缓存再后台校验。

### 5.4 测试建议

- 单元测试（React store）：
  - `setModel` 触发一次 `ai.listModels({probeModel})`；
  - 同一 key 重复选择不重复请求；
  - 旧 `requestId` / 旧 model 响应被丢弃；
  - `set-model` 清空旧 `thinkingOptions`；
  - `thoughtOptionsFromAcp` 读取 `name` 作为 label。
- E2E（不发送 AI）：
  - 打开 AI 对话 → 选 `opencode-go/deepseek-v4.1-flash` → 等待 probe → 断言 `ai-thinking-option` 数量 = 4（low/high/max/default）；
  - 选 `muse-spark-1.3-contributor` → 断言 6 档（minimal/low/medium/high/xhigh/default）；
  - 切模型后旧档位不残留。
- 可直接复用旧测试 `tests/verify-acp-config-ui.js:518-553` 的断言口径（去重、归属、失败不退回静态档位）。

## 6. 附：事件样例（脱敏）

本轮未发送 AI，因此没有真实的 `acp_config` 事件。以下字段名逐字来自 `main/acp/acp-runtime.js:977-1015` 的 `buildAcpConfigEvent()`；`configOptions` 用实测的 opencode `effort` 结构裁剪：

```json
{
  "type": "acp_config",
  "model": "opencode-go/deepseek-v4.1-flash",
  "modelConfigId": "",
  "thoughtConfigId": "effort",
  "thoughtValue": "high",
  "configOptions": [
    {
      "id": "model",
      "name": "Model",
      "category": "model",
      "type": "select",
      "currentValue": "opencode-go/deepseek-v4.1-flash",
      "options": [{ "value": "opencode-go/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash 1017" }]
    },
    {
      "id": "effort",
      "name": "Effort",
      "category": "thought_level",
      "type": "select",
      "currentValue": "high",
      "options": [
        { "value": "low", "name": "Low" },
        { "value": "high", "name": "High" },
        { "value": "max", "name": "Max" },
        { "value": "default", "name": "Default" }
      ]
    }
  ],
  "warnings": [],
  "transport": "acp",
  "agentId": "opencode",
  "agentName": "OpenCode CLI",
  "acpSessionId": "<redacted>",
  "workdir": "<sandbox>/测试1/大厅",
  "uiSessionId": "<redacted>"
}
```

用于链路验证的合成事件与上例同形，额外带 `synthetic: true`；它不是 AI 请求，只用于证明 `ai:event → ai-store → ModelSelector` 可用。验证结果：注入后 4 个档位可见，Trace 出现 `ACP_CONFIG` 行，聊天流无控制事件泄漏。

## 7. 清理

- 隔离 profile `.devdata-wave4-thinkdiag` 已在测试后删除。
- 未修改 `src/`、`main/`、`js/` 或仓库内其它配置；未执行 `npm install` / commit。
- 用户机器上 9:03 启动的 Electron 实例未被触碰。
