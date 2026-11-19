# PlanD ACP 三 Agent 连通开发计划

> 版本：v1.0（开发规划稿）
> 日期：2026-11-11
> 范围：qoder / opencode / agy（Antigravity）三个本机 Agent 通过 ACP 完成一次只读任务；codebuddy 只做 ACP 可行性决策，不纳入本轮验收。
> 关联文档（只读，不修改）：`docs/ACP-产品方案.md`、`docs/ACP-技术方案.md`。
> 约束：74 个 IPC 通道冻结；`acp.enabled` 默认 false；UI 由另一子智能体做「删除独立 aiwin 窗口」纠偏，UI 工作必须排在其后。

---

## 0. 结论先行

1. 三个 Agent 的 ACP 链路本身都可用，当前失败集中在四类「适配层」问题：命令/能力表错误、模型目录未探测、会话配置未应用、会话标识混用。
2. 修复顺序必须是 **A 命令 → B 模型/配置 → C 会话生命周期 → D 测试 → E UI**。A/B/C 全部在主进程与 runtimes 层，不依赖 UI，可先落地。
3. 本轮不新增 IPC 通道；模型/思考强度/上下文选择通过现有 `ai:models`、`ai:ask`、`ai:save-config` 与 `ai:event` 扩展完成。
4. codebuddy 先跑一个 30 分钟 ACP 探测。只有同时支持 `initialize`、`session/new`、`session/prompt` 才纳入 P1；否则保持 legacy，并在验收矩阵标记「不具备 ACP 可行性」。
5. UI（模型/上下文/思考强度选择器、错误详情）必须等 aiwin 纠偏合入后再做，避免与 `app.css`、`js/project-ai-export.js` 的写者冲突。

### 0.1 当前基线

| 项 | 现状 | 说明 |
|---|---|---|
| 测试 | `npm test` 53/53；ACP 单测 6/6 | 改动后以 `run-all.js` 的 `ALL_PASS` 为准 |
| acpx | `0.22.0`，精确锁版本 | 已导出 `inspectAgentModels`、`getStatus`、`setModel`、`setConfigOption`、`prepareFreshSession` |
| opencode | `C:\Users\allow\AppData\Roaming\npm\opencode.cmd acp` | ACP 有 521 个模型；`opencode-go/deepseek-v4.1-flash` 已验证可回 OK |
| agy | `C:\Users\allow\AppData\Local\agy\bin\agy.exe acp` | ACP 模型 5 个 base id；`gemini-3.8-flash` 已验证可回 OK |
| qoder | `qodercli --acp`（CN 版 fallback `qoderclicn`） | ACP 模型为 `auto` / `Qwen...`；当前配置的 `deepseek-chat` 不匹配 |
| codebuddy | 当前 legacy | ACP 可行性待探测，本轮不做实现 |

### 0.2 三个 Agent 的已知 ACP 事实

| Agent | 启动命令 | ACP 模型 | 备注 |
|---|---|---|---|
| opencode | `opencode acp` | 521 个，含 `opencode-go/deepseek-v4.1-flash` | 旧 fallback `opencode/deepseek-v4-flash` 已失效 |
| agy | `agy acp` | `gemini-4-argon`、`gemini-3.8-flash`、`claude-opus-5-5`、`claude-sonnet-5-5`、`gpt-oss-120b-medium` | `thought_level`：low/medium/high；`gemini-3.8-flash-high` 是 legacy 变体，ACP 不接受 |
| qoder | `qodercli --acp` | `auto`、`Qwen...`（以 ACP 列表为准） | CN 版用 `qoderclicn`；不得下发 `deepseek-chat` |

---

## 1. 目标与验收标准

### 1.1 总目标

在 `acp.enabled=true` 时，qoder、opencode、agy 三个 Agent 均能：

1. 解析到正确的 ACP 启动命令，不出现 `agy_acp_server.exe` / 内置命令 ENOENT。
2. `ai:models` 返回该 Agent 的 ACP 模型列表，而不是旧 fallback；白名单交集为空时降级为全量 ACP 列表而非空列表。
3. 默认模型不使用 `aiCfg.model`（`deepseek-chat`）等 API/legacy 模型；显式选择合法 ACP 模型后可成功下发。
4. 完成一次只读任务（prompt：只回复 `OK`，不读写文件），事件序列包含 `session`、`run_started`、`chunk`、`done`，且 `done.cancelled=false`。
5. 切换模型/思考强度时，已有会话通过 `setModel` / `setConfigOption` 生效；需要重建时走 `prepareFreshSession`，不静默复用旧配置。
6. 失败时错误卡带 `detail`（含原始 cause 与合法模型列表），不再只显示「会话初始化失败」。

### 1.2 单 Agent 验收命令

以下命令在仓库根目录执行，依赖后续任务新增的 `tests/acp-live-smoke.js`。退出码 0 为通过，1 为失败；`--json` 输出机器可读结果。

```powershell
# qoder
node tests/acp-live-smoke.js --agent qoder --model auto --prompt "只回复 OK，不要读取或修改任何文件"

# opencode
node tests/acp-live-smoke.js --agent opencode --model opencode-go/deepseek-v4.1-flash --prompt "只回复 OK，不要读取或修改任何文件"

# agy（antigravity 的别名）
node tests/acp-live-smoke.js --agent antigravity --model gemini-3.8-flash --thought high --prompt "只回复 OK，不要读取或修改任何文件"
```

期望输出（成功契约）：

```text
[PASS] agent=<id> command="<解析出的绝对命令>" model=<model> thought=<level|-> session=<acp-session-id> events=session,run_started,chunk,done answer="OK" stopReason=end_turn durationMs=<n>
```

失败输出：

```text
[FAIL] agent=<id> code=<ACP_*> stage=<models|session|config|prompt> detail="<单行脱敏详情>" durationMs=<n>
```

### 1.3 模型目录验收命令

```powershell
node tests/acp-live-smoke.js --agent antigravity --list-models
node tests/acp-live-smoke.js --agent opencode --list-models
node tests/acp-live-smoke.js --agent qoder --list-models
```

期望：

| Agent | 期望 |
|---|---|
| agy | 恰好 5 个 base id，不含 `gemini-3.8-flash-high`；含 `gemini-3.8-flash` |
| opencode | 含 `opencode-go/deepseek-v4.1-flash`；不是只有 `deepseek-chat`；列表非空 |
| qoder | 含 `auto` 或实际 ACP 模型；不含 `deepseek-chat`（除非 ACP 真的公告） |

### 1.4 失败判定（任一即失败）

- 退出码非 0，或 `[FAIL]`。
- 事件中出现 `error`，且 `code` 属于 `ACP_MODEL_UNSUPPORTED`、`ACP_SESSION_INIT_FAILED`、`ACP_BACKEND_MISSING`、`ACP_TURN_FAILED`。
- 120 秒内没有 `done`，或 `done.cancelled=true`。
- `answer` 不包含 `OK`（允许前后空白/标点）。
- 解析出的命令包含 `agy_acp_server`，或请求里出现 `deepseek-chat` 被当作 ACP 模型。
- `ai:models` 返回空列表，或返回的 agy 列表只有 `-high` 变体。

### 1.5 codebuddy 决策标准（本轮只出结论）

```powershell
codebuddy --help | Select-String -Pattern "acp|agent|stdio"
codebuddy acp --help
```

可行性门槛：能启动并完成 `initialize` → `session/new` → `session/prompt` 三帧，且模型可通过 ACP 公告。满足则记录「P1 可纳入」并另开任务；不满足则记录「ACP 不可行，保持 legacy」，本轮验收矩阵标「待可行性结论」，不计入三 Agent 通过数。

---

## 2. 根因与修复工作流

### A. 命令与能力表（P0，先做）

#### A1. agy 启动命令纠偏

**现状链路**：`runtimes/acp-capabilities.js` 把 antigravity 写成 `command: 'agy_acp_server.exe'` → `runtimes/registry.js` 复制到 `def.acp.command` → `main/acp/acp-registry.js` 走 `resolveCommand`，解析失败后 `continue` 静默跳过 → acpx 使用内置同名命令，ENOENT → 被包装为 `ACP_SESSION_INIT_FAILED`。

**修复**：

1. `runtimes/acp-capabilities.js`：

```js
antigravity: { args: ['acp'], adapter: '' }
```

删除 `command` 字段，让 ACP override 走 `resolveBin(def)`，即 `def.bin = 'agy'` + `args: ['acp']`。

2. `runtimes/resolution.js`：给 antigravity 增加厂商目录 fallback，优先级放在 PATH 前、qoder 厂商目录之后：

```text
%LOCALAPPDATA%\agy\bin
%LOCALAPPDATA%\Programs\agy\bin
```

本机应解析到 `C:\Users\allow\AppData\Local\agy\bin\agy.exe`。仍允许 `ai-config.json` 的 `cliPaths.antigravity` 覆盖。

3. `main/acp/acp-registry.js`：`buildAcpOverrides` 保留原返回值以兼容测试，新增：

```js
buildAcpOverridesDetailed(...)
// -> { overrides: { [id]: [bin, ...args] }, unresolved: [{ id, reason, command, candidates }] }

resolveAgentCommand(def, aiCfg)
// -> { command: [bin, ...args] | null, unresolved: { reason, candidates } | null }
```

`resolveAgentCommand` 是 T2 的 `aiModelsImpl` 与 T3 的 `ask()` 共用的单 Agent 解析入口。`ask()` / `ai:models` 在选中 Agent 解析不到命令时，直接抛 `ACP_BACKEND_MISSING`，`detail` 写明「期望命令、尝试过的候选、自定义路径配置项」，禁止让 acpx 落到内置命令。

4. 测试更新：`tests/verify-acp-capabilities.js` 中 antigravity 期望改为 `{ args: ['acp'], adapter: '' }`，并新增 `tests/verify-acp-resolution.js` 验证 agy 厂商目录解析与自定义路径优先。

#### A2. opencode / qoder 路径

- opencode：优先 `cliPaths.opencode`；否则由 `resolveAgentExecutable` 在 `%APPDATA%\npm` 命中 `opencode.cmd`。验收必须打印解析出的绝对路径，避免「PATH 有但 acpx 启动的是另一个」。
- qoder：`qodercli` 优先，CN 版 fallback `qoderclicn`；`runtimes/resolution.js` 已有 `~/.qoder-cn/bin/qoderclicn/` 版本化文件解析，保留。若用户配置了 `cliPaths.qoder`，优先自定义路径。
- 两个 Agent 都必须在 `unresolved` 时显性失败，不允许静默跳过。

#### A3. codebuddy 决策点

只做探测，不改能力表：

1. 用 `codebuddy --help` 搜索 `acp` / `stdio` / `agent`。
2. 若存在 `codebuddy acp` 或 `codebuddy --acp`，用 `tests/acp-live-smoke.js --agent codebuddy --command "codebuddy acp" --probe` 做 `initialize + session/new`，不发送 prompt。
3. 判定：
   - `acp=true`：记录命令、模型列表、协议版本，另开 P1 任务加入 `ACP_CAPABILITIES`。
   - `acp=false`：记录 `reason=no-acp-command`，保持 legacy，不进入本轮开发。
4. 决策结果写入本计划末尾的「决策记录」，不改 `docs/ACP-产品方案.md` / `docs/ACP-技术方案.md`。

---

### B. 模型与配置层（P0）

#### B1. `aiModelsImpl` 改为真正调用 `inspectAgentModels`

**现状**：ACP 分支只回 `def.fallbackModels`；没有调用 `inspectAgentModels`；opencode/agy 的旧 fallback id 已失效；`visibleModels` 过滤后可能为空。

**新增 `main/acp/acp-config.js`（纯函数 + 一个探测入口）**：

```js
// 纯函数，便于单测；不 require Electron
normalizeModelCatalog(inspection)        // AcpRuntimeSessionModels -> { models, defaultModel, source }
mergeVisibleModels(advertised, whitelist) // 返回 { models, warning }
resolveModelChoice(input)                 // 返回 { model, source, warning, available }
normalizeConfigOptions(status)            // details.configOptions -> [{ key,label,currentValue,options }]
planSessionConfig(input)                  // 返回 { model, selections, configOptions, warnings }
redactErrorDetail(err)                    // 脱敏、截断 800 字
ACP_MODEL_FALLBACKS                       // 三个 Agent 的已知可用 ACP 模型，不使用 legacy fallback
```

**`aiModelsImpl` ACP 分支行为**：

1. 解析选中 Agent 的 ACP 命令；解析失败直接返回 `ok:false` + `ACP_BACKEND_MISSING` 细节，不再回旧 fallback。
2. 调用 `inspectAgentModels({ agentCommand, cwd, timeoutMs: 15000 })`；结果缓存 10 分钟，key 为 `agentId + 命令绝对路径`。配置保存时清缓存。
3. `inspectAgentModels` 失败或返回空：仅使用 `ACP_MODEL_FALLBACKS[agentId]`；三个 Agent 的 fallback 必须都是 ACP id（agy 5 个 base、opencode 至少 `opencode-go/deepseek-v4.1-flash`、qoder `auto`）。
4. 白名单交集：

```js
const whitelist = pickVisibleModels(cfg, def.id); // visibleModelsCli[id] 优先，其次 visibleModels
const merged = mergeVisibleModels(advertised, whitelist);
// whitelist 非空但交集为空 => 使用 advertised 全量，并返回 warning='visibleModels-no-intersection'
```

5. 默认模型：`cfg.acp.agents[id].model` 若在列表内则用之；否则用 `inspection.currentModelId`（若在列表内）；否则列表第一个。**绝不使用 `cfg.model` / `cfg.defaultModel` / `deepseek-chat`**。
6. 返回结构在现有 `groups/default/engine/transport/visibleModels/agentId/reasoningOptions` 基础上增加：

```js
{
  transport: 'acp',
  configOptions: null, // ai:models 阶段可为 null；首次 ask 后由 acp_config 事件补齐
  defaultSource: 'agent-config' | 'agent-current' | 'first-advertised',
  warning: 'visibleModels-no-intersection' | undefined
}
```

> 不在 `ai:models` 阶段额外 spawn 一次会话去取 `configOptions`，避免每次打开选择器都启动 Agent。真实 `configOptions` 在首次 `ask` 的 `getStatus` 中获取，并通过 `acp_config` 事件回传 UI；这是 P0 的折中，E 阶段可加「测试连接时探测配置」按钮。

#### B2. `ask` 阶段的模型/配置应用

**原则**：`sessionOptions.model` 只在新建会话时生效，对已有会话无效，而且会在 `session/new` 阶段直接抛 `ACP_MODEL_UNSUPPORTED`。因此本轮**不在 `ensureSession` 里传 `model`**，统一在会话建立后读取 `getStatus`，再应用 `setModel` / `setConfigOption`。

`planSessionConfig` 输入：

```js
{
  status,                 // runtime.getStatus({ handle })
  requestedModel,         // 仅来自 UI / extra，不含 cfg.model
  modelSource,            // 'ui' | 'agent-config' | ''，用于区分「用户明确选择」与「配置默认值」
  requestedThought,       // extra.reasoning 或 cfg.acp.agents[id].thoughtLevel
  cfg,
  def
}
```

模型选择优先级：

```text
1. UI 明确选择且 exact 命中 advertised            -> 使用
2. cfg.acp.agents[id].model 且命中 advertised      -> 使用
3. status.models.currentModelId 且命中 advertised  -> 使用
4. advertised[0]                                   -> 使用
5. advertised 为空                                 -> 不设置，交给 Agent 默认
```

- 任何来源只要等于 `cfg.model` / `cfg.defaultModel` / `deepseek-chat`，一律视为「API/legacy 泄漏」，忽略并记 `warning='ignored-global-model'`。
- `modelSource==='ui'` 且不在 advertised：不静默改模型，抛 `ACP_MODEL_UNSUPPORTED`，`detail` 带 `availableModels`，让用户重选。
- `modelSource==='agent-config'` 且不在 advertised：视为配置过期，降级到 current/first，记 `warning='config-model-stale'`，不阻断本轮。
- 模型 id 按 ACP 原样精确匹配，**不做 lowercase**（qoder 的 `Qwen...` 大小写敏感）。

思考强度：

```text
候选 key 顺序：thought_level -> reasoning_effort -> effort -> thinking
候选值：extra.reasoning（非 default）-> cfg.acp.agents[id].thoughtLevel
仅当 status.details.configOptions 或 getCapabilities().configOptionKeys 公告该 key 时应用
值必须在 options 内；否则 trace warning，不阻断本轮
```

`model_config` / 上下文：

- `status.details.configOptions` 中出现的 select 项统一归一化为 `{ key, label, currentValue, options }`。
- `model_config` 作为模型子配置处理：先 `setModel`，再应用 `model_config`，最后应用 `thought_level`（模型变更可能重置思考档位）。
- 上下文类 key（如 `context`、`max_tokens`、`context_window`）只做透传，不硬编码；没有公告就不显示、不下发。

应用顺序：

```text
ensureSession (不带 model)
  -> getStatus
  -> planSessionConfig
  -> setModel（若需要且 advertised 命中）
  -> setConfigOption（model_config）
  -> setConfigOption（thought_level）
  -> 再 getStatus（可选，捕获 currentValue）
  -> emit acp_config
  -> startTurn
```

调用签名必须用对象形式：

```js
await runtime.setModel({ handle, model });
await runtime.setConfigOption({ handle, key, value });
```

#### B3. 错误 detail 透传

- `main/acp/acp-errors.js`（T2）：`normalizeAcpError` 增加 `detail` / `reason` 字段，来源依次为 `err.cause.message`、`err.data.details`、`err.detail`、`err.message`；截断 800 字；脱敏 `apiKey/token/Authorization/Bearer`。
- `main/acp/acp-runtime.js` 的 `errorPayload`（T3 接入，T2 只提供字段）增加：

```js
{
  detail,
  agentId,
  command,          // 解析出的可执行文件 basename 或完整路径
  availableModels,  // ACP_MODEL_UNSUPPORTED 时
  reason            // acpx RequestedModelUnsupportedError.reason
}
```

- `ACP_SESSION_INIT_FAILED` 的 `detail` 必须包含原始 spawn 错误（例如 `ENOENT ... agy_acp_server.exe`），否则 A1 的修复无法被验收发现。

#### B4. 配置持久化

- 复用 `ai:save-config`，不新增通道。
- 允许 `cfg.acp.agents[id]` 保存 `model`、`thoughtLevel`、`transport`、`permissionMode`、`command`；`ai-config-store` 现有 `sanitizeAcpAgentEntry` 已保留字符串字段，无需改 schema。
- 不把 API Key / token / env 写入 `acp.agents`。

---

### C. 会话生命周期（P0）

#### C1. `sessionOptions.model` 与 `s.oid` 混用

**现状**：

- `ensureInput.sessionOptions = { model }` 对已有持久会话无效；对新建会话又会因 `deepseek-chat` 直接 `ACP_MODEL_UNSUPPORTED`。
- `s.oid` 同时承载 legacy CLI 会话 id 与 ACP `backendSessionId`；`ask()` 的 `resumeSessionId` 还会回落到 positional `sessionId`，导致跨协议串用。
- `prepareFreshSession` 未使用，用户点「清空/新会话」后仍可能复用旧 acpx record。

**修复**：

1. `main/acp/acp-runtime.js` 删除 `ensureInput.sessionOptions = { model }`；模型统一走 B2 的 `setModel`。
2. 新增进程内 `sessionHandles: Map<sessionKey, handle>`。`ensureSession` 成功后写入；`close/shutdown` 删除；`finishAsk` 不删除（persistent 会话要跨轮复用）。
3. `resumeSessionId` 只接受 `opts.resumeSessionId`（由 `ai-process-service` 从 `extra.acpSessionId` 传入），**禁止**回落到 positional `sessionId` / `agentSessionToken`。
4. `resume` 失败回退：
   - 若 `sessionHandles` 有旧 handle：先 `prepareFreshSession({ handle: old })`，再 `ensureSession` 同 key 新建。
   - 若没有旧 handle：使用 `sessionKey + '-r' + Date.now().toString(36)` 的新 key，避免 acpx 复用旧 record。
   - emit `trace`（tag `SESSION`，level `warn`）+ 新的 `session` 事件；UI 清掉旧 `acpSessionId` 并提示「已开启新会话」。
5. 显式新建/清空：`ai:ask` 的 `extra.resetSession === true` 时（`ai-process-service` 透传到 `acpRuntime.ask({ resetSession })`）：
   - 有 handle → `prepareFreshSession({ handle })`；
   - 无 handle → 新 sessionKey 后缀；
   - 清空 `s.acpSessionId` / `s.acp`（UI 侧，E 阶段）。
6. 模型/配置变更需要新会话时（`setModel` / `setConfigOption` 抛 `ACP_BACKEND_UNSUPPORTED_CONTROL`）：
   - `prepareFreshSession` → 同 key 重新 `ensureSession` → 重新 `getStatus` → 应用配置 → 重试一次；
   - 仍失败则 `ACP_TURN_FAILED`，detail 写明「该 Agent 不支持在现有会话切换模型」。
7. `cancel`：保持现有 `turn.cancel` + 2 秒杀进程树兜底；取消后不要删除 handle，下一次仍可复用会话。

#### C2. `s.oid` 拆分（主进程先兼容，UI 后落地）

目标字段：

| 层 | 字段 | 用途 |
|---|---|---|
| UI | `s.agentSessionId` | legacy CLI 会话 id（如 opencode `ses_...`） |
| UI | `s.acpSessionId` | ACP `backendSessionId` |
| UI | `s.acp = { recordId, backendSessionId, agentId, cwd }` | 恢复/诊断 |
| UI | `s.oid` | 仅作为旧数据兼容字段，不再写入新 ACP 会话 |

主进程先行：

- `ai-process-service.aiAskImpl` 的 `resumeSessionId` 改为：

```js
resumeSessionId: String(
  (extraOpts && (extraOpts.acpSessionId || extraOpts.resumeSessionId)) || ''
)
```

不再拼接 `agentSessionToken`。

- `session` 事件增加 `acpSessionId`、`recordId`、`agentSessionId` 字段；UI 未升级时旧逻辑仍写 `s.oid`，但不会影响 ACP resume（因为主进程只认 `extra.acpSessionId`）。

UI 后行（E 阶段）：

- `ai:event` 的 `session` 分支：`transport==='acp'` → 写 `s.acpSessionId` 与 `s.acp`；否则写 `s.agentSessionId`。
- `aiDoSend`：positional `sessionId` 只传 `s.agentSessionId || s.oid`；`extra.acpSessionId` 传 `s.acpSessionId`；`extra.uiSessionId` 不变。
- 旧数据迁移：`s.acp` 不存在时，不把 `s.oid` 当作 ACP resume id；首次 ACP 任务新建会话并提示一次。避免把 legacy id 当 ACP id 导致 `ACP_SESSION_INIT_FAILED`。

---

### D. 测试（P0）

#### D1. 单元测试

| 文件 | 覆盖 |
|---|---|
| `tests/verify-acp-capabilities.js`（改） | agy 命令/args；19 项能力表；registry 挂载 |
| `tests/verify-acp-resolution.js`（新） | agy 厂商目录、自定义路径优先、qoder CN fallback |
| `tests/verify-acp-config.js`（新） | 模型目录归一化、白名单交集为空降级、默认模型忽略 `cfg.model`、thought_level 选择、`model_config` |
| `tests/verify-acp-errors.js`（改） | detail 透传、脱敏、`ACP_MODEL_UNSUPPORTED` 合法模型列表 |
| `tests/verify-acp-session.js`（新） | fake runtime 的 `getStatus/setModel/setConfigOption/prepareFreshSession`；resume fallback；resetSession；positional id 不进入 ACP resume |
| `tests/verify-acp-runtime.js`（改） | 现有事件/权限/取消回归；新增无模型泄漏、无 `sessionOptions.model` |

#### D2. 真实 Agent 端到端

新增 `tests/acp-live-smoke.js`：

- 纯 Node，不依赖 Electron；直接调用 `main/acp/acp-runtime.ask`（真实 acpx，不注入 fake）。
- 显式构造测试配置 `{ ...loadAiConfigFull(), acp: { ...cfg.acp, enabled: true, defaultPermissionMode: 'deny-all' } }`，不依赖用户当前 `acp.enabled` 值。
- 支持参数：`--agent`、`--model`、`--thought`、`--prompt`、`--list-models`、`--probe`、`--json`、`--timeout`、`--command`（raw 命令覆盖，用于 codebuddy 这类尚未进能力表的 Agent）。
- 使用临时 cwd 与临时 session store，结束后清理；权限用 `deny-all`，`fs:false`、`terminal:false`。
- 事件断言：`session` 在 `run_started` 前；`done` 最后；`answer` 含 `OK`；`error` 为空；记录解析出的 command。
- `--list-models` 只跑 `inspectAgentModels`，不发送 prompt。
- `--probe` 只做 `ensureSession + getStatus`，用于 codebuddy 可行性。

`package.json` 增加：

```json
"test:acp:live": "node tests/acp-live-smoke.js"
```

不加入 `tests/run-all.js` 默认套件（真实 Agent 慢、依赖登录/额度）。

#### D3. 全量回归

```powershell
npm test
npm run lint
npm run build
```

验收：`run-all.js` 输出 `ALL_PASS`（53 个既有套件 + 新增单测套件全部通过）；`lint-guard.js` 仍为 74 个 IPC 通道；`electron-builder --dir` 打包后 `main/acp/acp-config.js` 与 acpx 均在 asar 内。

#### D4. UI 测试（E 阶段）

- 更新 `tests/verify-acp-settings-ui.js`：模型/思考/上下文控件、错误详情折叠、`acp_config` 事件渲染。
- 新增 `tests/verify-acp-config-ui.js`（静态断言）：`s.acpSessionId` 与 `s.agentSessionId` 的写入/读取分支，禁止 `s.oid` 新写 ACP。
- UI 验收以 `npm start` 手工冒烟为准：启用 ACP → 选 Agent/模型/思考强度 → 发送只读任务 → 看到 `OK` 与 `done`。

---

### E. UI（P1，必须等 aiwin 纠偏完成）

**前置门禁**：

1. aiwin 纠偏已合入，`app.css` / `js/project-ai-export.js` 没有其他写者。
2. 重新阅读 `docs/ACP-产品方案.md` / `docs/ACP-技术方案.md` 的最新版本（可能被 aiwin 子智能体改过），只读，不修改。
3. 本阶段不新增 IPC 通道；所有数据来自 `ai:models` / `ai:event` / `ai:save-config`。

**E1. 模型选择器**

- 数据源：`ai:models` 的 ACP 分支；分组显示 `Agent 名称 / ACP`。
- 显示 `defaultSource` 提示：`Agent 当前模型` / `Agent 默认` / `首个可用`。
- 列表为空时显示「该 Agent 未公告模型，使用 Agent 默认」，禁止显示旧 fallback。
- 白名单交集为空时显示轻提示「已忽略可见模型白名单（无交集）」。

**E2. 思考强度与上下文选择器**

- 思考强度：优先 `configOptions` 中 `thought_level` 的 options；否则用 `reasoningOptions`；只有 1 个选项时隐藏。
- 上下文：`configOptions` 中出现 `context` / `max_tokens` / `context_window` 时显示为下拉；没有则隐藏，不硬编码。
- 选择后通过 `ai:ask` 的 `extra.reasoning` / `extra.configOptions` 下发；不新增通道。
- 收到 `acp_config` 事件后同步选择器；自动降级时显示「已使用 Agent 默认模型 X」的 trace 提示。

**E3. 错误详情**

- 错误卡显示 `title` + `message`；「展开详情」显示 `detail`、`agentId`、`command`、`availableModels`。
- `ACP_MODEL_UNSUPPORTED` 时提供「切换到可用模型」按钮，直接打开模型选择器。
- 复制诊断按钮只复制脱敏后的 detail。

**E4. 设置页**

- 每 Agent 默认模型/思考强度（写入 `cfg.acp.agents[id]`）。
- 「测试连接」复用 `ai:models`（不新增通道）；显示解析出的命令与模型数量。
- 未解析命令时显示 `unresolved` 候选路径与 `cliPaths` 配置入口。

**E5. 文件边界**

- 只改 `js/project-ai-export.js`、`app.css`、`tests/verify-acp-settings-ui.js`、`tests/verify-acp-config-ui.js`。
- 不改 `docs/ACP-产品方案.md` / `docs/ACP-技术方案.md`。
- 若 aiwin 纠偏仍在进行，E 任务只写测试与样式草案，不合入。

---

## 3. 任务拆分与串并行

### 3.1 依赖图

```text
Wave 0 基线（只读）
  └─ 记录当前 npm test 53/53、三个 Agent 的失败码

Wave 1（并行）
  ├─ T1 A：命令/能力表（agy + 路径 + unresolved + codebuddy 探测）
  ├─ T2 B：模型/配置层（acp-config.js + aiModelsImpl + detail）
  └─ T4 D-scaffold：acp-live-smoke.js 骨架 + package.json 脚本（可先写，跑不通）

Wave 2
  ├─ T3 C：会话生命周期（依赖 T2 的 planSessionConfig/applySessionConfig 接口）
  └─ T4 D-live：A+B+C 合并后跑三 Agent 真实端到端

Wave 3（等 aiwin 纠偏）
  └─ T5 E：UI 模型/思考/上下文选择器 + 错误详情

Wave 4
  └─ 全量回归、打包、codebuddy 结论、本计划决策记录更新
```

### 3.2 文件边界（避免冲突）

| 任务 | 独占文件 | 只读依赖 | 禁止触碰 |
|---|---|---|---|
| T1 A | `runtimes/acp-capabilities.js`、`runtimes/resolution.js`、`main/acp/acp-registry.js`、`tests/verify-acp-capabilities.js`、`tests/verify-acp-resolution.js` | `runtimes/registry.js`、`runtimes/defs/antigravity.js` | `main/acp/acp-runtime.js`、`main/services/ai-process-service.js`、UI 文件 |
| T2 B | `main/acp/acp-config.js`（新）、`main/acp/acp-errors.js`、`main/services/ai-process-service.js`、`tests/verify-acp-config.js`、`tests/verify-acp-errors.js` | `main/acp/acp-registry.js`（T1 的 `resolveAgentCommand`）、`runtimes/resolution.js` | `main/acp/acp-runtime.js`、UI 文件 |
| T3 C | `main/acp/acp-runtime.js`、`tests/verify-acp-runtime.js`、`tests/verify-acp-session.js` | T2 的 `acp-config.js`、T1 的 override | `main/services/ai-process-service.js`、UI 文件 |
| T4 D | `tests/acp-live-smoke.js`（新）、`tests/run-all.js`、`package.json`、`tests/lint-guard.js`（仅必要时） | 全部 | 业务实现文件、UI 文件 |
| T5 E | `js/project-ai-export.js`、`app.css`、`tests/verify-acp-settings-ui.js`、`tests/verify-acp-config-ui.js` | 主进程事件契约 | `main/acp/*`、`docs/ACP-*.md` |

### 3.3 必须串行的点

1. **T2 → T3**：`planSessionConfig` / `applySessionConfig` 的接口先冻结，T3 再接入 `ask()`；否则同一文件 `acp-runtime.js` 会被两人改。
2. **T1 → T4 live**：命令解析不对，live smoke 只会重复报 ENOENT；T4 可以先写骨架，但正式跑必须等 T1。
3. **T3 → T5**：主进程事件与 `s.acpSessionId` 字段稳定后，UI 才有可靠契约。
4. **aiwin 纠偏 → T5**：硬门禁；`app.css` / `project-ai-export.js` 在纠偏期间只读。

### 3.4 可并行的点

- T1 与 T2 完全独立（命令表 vs 模型层），可同日并行。
- T4 的 harness 骨架可与 T1/T2 并行；真实跑放到 Wave 2。
- T2 的单测与 T3 的 fake runtime 测试可并行；只要接口签名先对齐。
- E 的静态测试可以先写（不依赖运行），但样式/交互改动必须等门禁。

---

## 4. 验收矩阵

### 4.1 三 Agent

| Agent | launch command | 模型 | 期望事件 | 失败判定 |
|---|---|---|---|---|
| qoder | `qodercli --acp`；CN fallback `qoderclicn --acp` | `auto`（或 `--list-models` 中的实际 id） | `session` → `run_started` → `chunk(OK)` → `done(cancelled=false, stopReason=end_turn)` | `ACP_MODEL_UNSUPPORTED`、`ACP_SESSION_INIT_FAILED`、模型列表为空、命令解析为 `deepseek-chat` |
| opencode | `C:\Users\allow\AppData\Roaming\npm\opencode.cmd acp` | `opencode-go/deepseek-v4.1-flash` | 同上；`session.id` 为 ACP backend id | 下发了 `aiCfg.model=deepseek-chat`；列表只有旧 fallback；命令不是 `opencode.cmd` |
| agy | `C:\Users\allow\AppData\Local\agy\bin\agy.exe acp` | `gemini-3.8-flash` + `thought=high` | 同上；额外期望 `acp_config` 含 `model=gemini-3.8-flash`、`thought_level=high` | 命令含 `agy_acp_server.exe`；使用 `gemini-3.8-flash-high`；`setConfigOption` 失败；无 `done` |
| codebuddy | 待定（先 probe） | 待定 | 若 `acp=true`：同三 Agent；若 `false`：`[SKIP] reason=no-acp-command` | 未出结论前不判定失败；结论必须记录 |

### 4.2 分层验收

| 层 | 命令 | 期望 |
|---|---|---|
| L0 命令解析 | `node -e "const {getAgentDef}=require('./runtimes/registry'); console.log(JSON.stringify(getAgentDef('antigravity').acp))"` | `{"args":["acp"],"adapter":""}` |
| L1 模型目录 | `node tests/acp-live-smoke.js --agent antigravity --list-models` | 5 个 base id，无 `-high` |
| L2 单轮只读 | 三 Agent 命令（见 1.2） | `[PASS] ... answer="OK"` |
| L3 配置切换 | `--model gemini-3.8-flash --thought low` 再跑一次 | `acp_config` 的 `thought_level=low`；不报错 |
| L4 恢复 | 连续两次同一 `--session` 参数（harness 支持） | 第二次不新建或恢复失败后明确提示「已开启新会话」 |
| L5 UI | `npm start` 手工冒烟 | 选择器/错误详情可用；无新 IPC |

---

## 5. 风险与回滚

| 风险 | 触发 | 应对 | 回滚 |
|---|---|---|---|
| acpx 0.22 pre-1.0 API 漂移 | 升级 acpx 后 `getStatus` / `prepareFreshSession` 变化 | 锁 `acpx@0.22.0`；`acp-config.js` 封装；所有可选方法 `typeof` 守卫 | 直接回退 package-lock；ACP 关闭走 legacy |
| agy 旧版不支持 `agy acp` | `agy --version` 较旧；`agy acp --help` 失败 | capability 探测失败即 `ACP_BACKEND_MISSING`，提示升级；禁止回退 `agy_acp_server.exe` | 该 Agent 临时标 legacy，其余两个不受影响 |
| opencode 默认模型额度 | 默认模型无额度/限流 | 不把 `opencode-go/deepseek-v4.1-flash` 设为全局默认；只显式选择时使用；`ACP_TURN_FAILED` detail 提示切换 | 切到 Agent 当前模型或另一个可用模型 |
| qoder CN 版差异 | `qoderclicn --acp` 参数/模型不同 | 先 `--list-models` 取真实模型；命令/模型都从 ACP 公告走；不做硬编码 | 该 Agent 标 legacy/待适配 |
| IPC 冻结 | 想加 `ai:session-*` | 本轮不新增；用 `ai:event` 新类型 + `ai:ask` extra；`lint-guard` 74 不变 | 若必须新增，另开契约变更任务，不在本轮 |
| UI 冲突 | aiwin 纠偏仍改 `project-ai-export.js` / `app.css` | T5 硬门禁；主进程 A/B/C 先合；E 只写测试草案 | UI 不合入，直接把 ACP 能力留在主进程 |
| `s.oid` 旧数据 | 旧会话把 ACP id 存在 `s.oid` | 主进程只认 `extra.acpSessionId`；旧 `s.oid` 不用于 ACP resume；首次新建并提示 | 用户可手动「新会话」；不丢历史消息 |
| 白名单空交集 | `.devdata` 中 agy 只有 `gemini-3.8-flash-high` | 交集为空回退全量 ACP 列表 + warning；不自动改用户配置 | UI 可手动清理可见模型 |
| 错误 detail 泄密 | 原始 stderr 含 token/path | `redactErrorDetail` 脱敏 + 800 字截断 | 关闭 detail 展示，仅保留错误码 |
| 打包 asar | 新模块未进包 | 新文件在 `main/acp/**` 自动包含；跑 `electron-builder --dir` 验证 | 回退构建配置；不影响开发态 |

**总回滚开关**：`ai-config.json` 的 `acp.enabled=false`。本轮所有改动不得改变默认 false；关闭后必须完全走 legacy，且 `npm test` 全绿。

---

## 6. 明确不做（本轮非目标）

1. P2 能力：MCP servers、subagents、fork、compaction、session list/close 新 IPC。
2. Claude / Codex / Pi 适配器安装与端到端（仅保留能力表，不在本轮验收）。
3. Elicitation / 认证 / 登录桥增强；沿用现有权限卡与 `ai:scope-confirm`。
4. codebuddy ACP 实现：只有 probe 通过才另开 P1，不在本轮写代码。
5. 自动模型下载、额度管理、自动重试/切换模型。
6. 修改 `docs/ACP-产品方案.md`、`docs/ACP-技术方案.md`。
7. UI 在 aiwin 纠偏完成前不合入。

---

## 7. 首批 3 个子智能体任务建议

### T1 — ACP 命令与能力表纠偏（可立即开始）

**目标**：agy 用 `agy acp` 启动；opencode/qoder 路径可解析；override 失败显性报错；codebuddy 出可行性结论。

**文件**：

- `runtimes/acp-capabilities.js`
- `runtimes/resolution.js`
- `main/acp/acp-registry.js`
- `tests/verify-acp-capabilities.js`
- `tests/verify-acp-resolution.js`（新）

**关键交付**：

```js
// acp-capabilities.js
antigravity: { args: ['acp'], adapter: '' }
```

```js
// acp-registry.js
buildAcpOverridesDetailed(...) -> { overrides, unresolved }
```

**验收命令**：

```powershell
node tests/verify-acp-capabilities.js
node tests/verify-acp-resolution.js
node -e "const {getAgentDef}=require('./runtimes/registry'); console.log(JSON.stringify(getAgentDef('antigravity').acp))"
node -e "const {getAgentDef}=require('./runtimes/registry'); const {resolveAgentExecutable}=require('./runtimes/resolution'); resolveAgentExecutable(getAgentDef('antigravity'),'').then(p=>console.log(p||'UNRESOLVED'))"
```

**期望**：测试全 PASS；`acp` 为 `{"args":["acp"],"adapter":""}`；路径为 `C:\Users\allow\AppData\Local\agy\bin\agy.exe`（或 `cliPaths.antigravity` 指定值）。

**时间盒**：0.5 天。**依赖**：无。

---

### T2 — ACP 模型/配置层（可立即开始，与 T1 并行）

**目标**：`aiModelsImpl` 真正调用 `inspectAgentModels`；默认模型不再泄漏 `cfg.model`；白名单空交集降级；`thought_level` / `model_config` 可规划；错误 detail 可读。

**文件**：

- `main/acp/acp-config.js`（新，纯函数）
- `main/acp/acp-errors.js`
- `main/services/ai-process-service.js`
- `tests/verify-acp-config.js`（新）
- `tests/verify-acp-errors.js`

**接口（T3 依赖，必须先冻结）**：

```js
planSessionConfig({ status, requestedModel, requestedThought, cfg, def })
// -> { model, selections: [{ key, value }], configOptions, warnings }

applySessionConfig({ runtime, handle, plan, capabilities })
// -> { applied: [{ key, value, accepted }], warnings }
```

**验收命令**：

```powershell
node tests/verify-acp-config.js
node tests/verify-acp-errors.js
```

**期望**：全 PASS；单测至少覆盖：

- agy 5 个 base id，`gemini-3.8-flash` 命中，`gemini-3.8-flash-high` 不命中；
- opencode 列表含 `opencode-go/deepseek-v4.1-flash`；
- qoder 列表含 `auto`；
- `cfg.model='deepseek-chat'` 被忽略；
- 白名单 `['gemini-3.8-flash-high']` 交集为空 → 回退全量 + warning；
- `thought_level=high` 被选中；非法值只 warning 不抛错；
- `ACP_MODEL_UNSUPPORTED` 的 detail 含可用模型列表。

**时间盒**：1 天。**依赖**：T1 的 `resolveAgentCommand` / `buildAcpOverridesDetailed` 可用；若未合入，先用接口 stub。

---

### T3 — ACP 会话生命周期（T2 接口冻结后开始）

**目标**：`getStatus` 后应用模型/配置；`prepareFreshSession` 支持新建；resume 失败不串旧 record；positional `sessionId` 不进入 ACP resume；主进程侧 `s.oid` 兼容隔离。

**文件**：

- `main/acp/acp-runtime.js`
- `tests/verify-acp-runtime.js`
- `tests/verify-acp-session.js`（新）

**关键改动**：

- 删除 `ensureInput.sessionOptions = { model }`。
- `ensureSession` 成功后维护 `sessionHandles`。
- `resumeSessionId` 只来自 `opts.resumeSessionId`。
- `resetSession` → `prepareFreshSession`。
- `setModel` / `setConfigOption` 不支持时 → `prepareFreshSession` 重建并重试一次。
- `session` 事件带 `acpSessionId` / `recordId` / `agentSessionId`。
- `errorPayload` 带 `detail` / `agentId` / `command` / `availableModels`。

**验收命令**：

```powershell
node tests/verify-acp-runtime.js
node tests/verify-acp-session.js
```

**期望**：全 PASS；fake runtime 断言：

- `getStatus` 被调用；
- `setModel` / `setConfigOption` 收到对象参数；
- `prepareFreshSession` 在 reset / 不支持控制时被调用；
- `ensureSession` 入参不含 `sessionOptions.model`；
- 传 `{ sessionId:'s_xxx' }` 不会被当作 ACP resume；
- resume 失败后新 sessionKey 与 trace 事件存在。

**时间盒**：1 天。**依赖**：T2 的 `acp-config.js` 接口；T1 的 override。

---

### 后续任务（不作为首批）

- **T4**：`tests/acp-live-smoke.js` + 三 Agent live + 全量回归；依赖 T1/T2/T3。
- **T5**：UI 选择器/错误详情；依赖 aiwin 纠偏完成。

---

## 8. 附录

### 8.1 事件契约增量（不新增 IPC）

```js
// session
{
  type: 'session', id, acpSessionId, recordId, agentSessionId,
  transport: 'acp', uiSessionId?
}

// acp_config（首次 ask / 配置变更后）
{
  type: 'acp_config',
  model: 'gemini-3.8-flash',
  configOptions: [
    { key: 'thought_level', label: '思考强度', currentValue: 'high',
      options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] }
  ],
  warnings: ['ignored-global-model'],
  transport: 'acp', uiSessionId?
}

// error 增量
{
  type: 'error', code, title, message, action, retryable,
  detail, agentId, command, availableModels?, reason?,
  transport: 'acp', uiSessionId?
}
```

### 8.2 `getStatus` 取配置的代码位置

```js
const status = await runtime.getStatus({ handle });
// status.models: { currentModelId, availableModelIds, availableModels }
// status.details.configOptions: [{ id, name, currentValue, options, category? }]
```

`inspectAgentModels` 只返回模型；`configOptions` 必须从 `getStatus` 取。这是 B2 选择「首次 ask 后发 `acp_config`」的原因。

### 8.3 codebuddy 探测记录模板

```text
日期：
codebuddy 版本：
命令：codebuddy --help / codebuddy acp --help
是否含 ACP：
initialize：PASS/FAIL
session/new：PASS/FAIL
模型列表：
结论：P1 可纳入 / 保持 legacy
```

### 8.4 决策记录（待填）

| 日期 | 决策 | 依据 | 负责人 |
|---|---|---|---|
| 2026-11-11 | 三 Agent 先修 A/B/C，UI 后置 | 当前失败均在主进程适配层 | 开发规划 |
| 待填 | codebuddy 是否纳入 ACP | `--probe` 结果 | T1 |
| 待填 | agy 最低支持版本 | `agy acp --help` 实测 | T1 |

### 8.5 Definition of Done

- [ ] `npm test` 输出 `ALL_PASS`，既有 53 套件无回归。
- [ ] `node tests/acp-live-smoke.js --agent qoder --model auto ...` PASS。
- [ ] `node tests/acp-live-smoke.js --agent opencode --model opencode-go/deepseek-v4.1-flash ...` PASS。
- [ ] `node tests/acp-live-smoke.js --agent antigravity --model gemini-3.8-flash --thought high ...` PASS。
- [ ] 三个 `--list-models` 结果符合 1.3；agy 无 `-high` 变体。
- [ ] `acp.enabled=false` 默认未变；关闭后 legacy 正常。
- [ ] 74 个 IPC 通道未变；`lint-guard` 通过。
- [ ] codebuddy 结论已记录（可纳入 / 不可纳入）。
- [ ] `docs/ACP-产品方案.md`、`docs/ACP-技术方案.md` 未被本计划任务修改。

---

## 决策记录：codebuddy ACP 可行性

> 日期：2026-11-11
> 对象：`@tencent-ai/codebuddy-code` 2.181.0
> 结论：**有条件可行**。原生支持 ACP，但当前安装残缺；本轮不纳入三 Agent 验收，修复后另开 P1。

### 结论

- codebuddy 2.181.0 原生是 ACP Agent，入口为 `codebuddy --acp`，使用 stdio + `ndJsonStream`，依赖 `@agentclientprotocol/sdk 1.9.0`。
- 不需要额外的 ACP 适配器包装，具备直接接入现有 ACP 链路的条件；acpx 兼容性仍需 P1 实测确认。
- 前提是安装完整、命令可执行；当前机器上的安装不满足该前提。

### 当前安装状态：不可用

`D:\AppFile\codebuudy` 是一次升级中断留下的残缺目录：

| 检查项 | 现状 |
|---|---|
| `package.json` | 缺失 |
| `node_modules\@tencent-ai\codebuddy-code\dist` | 仅有空的 `web-ui`，入口产物缺失 |
| `bin` | 启动脚本在，但依赖缺失，命令无法正常工作 |
| 唯一完整包 | `node_modules\@tencent-ai\.codebuddy-code-I1D3QUpL`（2.181.0） |

`.codebuddy-code-I1D3QUpL` 是 npm 安装过程中的临时暂存目录，随时可能被清理或覆盖，**不能作为产品配置或发布依赖**。

### 修复建议

1. 先备份临时目录中的完整旧包（仅用于回滚，不写入任何配置）。
2. 用 npm 覆盖安装到正式目录。
3. 用 `codebuddy --acp` 验证 `initialize` / `session/new`。

```powershell
# 1) 备份完整旧包
Copy-Item -Recurse -Force `
  "D:\AppFile\codebuudy\node_modules\@tencent-ai\.codebuddy-code-I1D3QUpL" `
  "D:\AppFile\codebuudy-backup-20261111"

# 2) 重新安装指定版本
npm install --prefix D:\AppFile\codebuudy @tencent-ai/codebuddy-code@2.181.0

# 3) 验证
codebuddy --version
codebuddy --acp
```

修复后实测结果：

- `codebuddy --acp` 可完成 `initialize` 与 `session/new`。
- 模型列表包含 17 个模型。
- `models.availableModels` 的 `_meta` 带 `maxInputTokens`、`effortOptions`，可直接用于模型与思考强度选择。

### 决策

- **本轮三 Agent 验收不包含 codebuddy。** 验收范围仍为 qoder / opencode / agy；codebuddy 在记录中标注 `[SKIP] reason=install-broken (P1)`，不判定为失败。
- 修复安装后**另开 P1 任务**接入，具体改动：
  - 在 `runtimes/acp-capabilities.js` 增加：

    ```js
    codebuddy: { args: ['--acp'], adapter: '' }
    ```

  - 在 `tests/acp-live-smoke.js` 补一条真实 smoke（`--agent codebuddy`），至少覆盖 `initialize` → `session/new` → 只读 prompt → `done`。
  - 复用现有 `inspectAgentModels` / `getStatus` / `planSessionConfig`，不新增 IPC 通道，不为 codebuddy 写专用适配器。

### 风险与约束

| 风险 | 说明 | 应对 |
|---|---|---|
| 工作目录信任 | ACP 会话的 cwd 必须在 `trustedDirectories` 内；当前只含 `D:/AppFile/codebuudy`、`D:/文件/Agent/日常` | P1 接入时把项目 cwd 加入信任列表，或在启动前显式确认；不要让信任判断依赖 UI 弹窗 |
| stderr 噪声 | stderr 存在非致命 `job-object.node` 告警 | 客户端只解析 stdout 的 ndJsonStream；stderr 仅进日志，**不能当协议输出** |
| 临时目录被清理 | 完整包只存在于 `.codebuddy-code-I1D3QUpL` | 先备份再重装；配置只指向正式安装目录 |
| 误用入口 | WorkBuddy 的 `codebuddy-lite` 不是 ACP 入口 | 只认 `codebuddy --acp`；`codebuddy-lite` 不写入 capabilities |

### 明确不做

- 不把 `D:\AppFile\codebuudy\node_modules\@tencent-ai\.codebuddy-code-I1D3QUpL` 写入 `cliPaths` 或任何产品配置。
- 不把 WorkBuddy 的 `codebuddy-lite` 当作 ACP 入口。
- 不在本轮修改 `runtimes/acp-capabilities.js` 或新增 codebuddy 测试；本轮只记录决策。

记录日期：2026-11-11

---

## 实施更新（2026-11-12）：codebuddy 已修复并接入

> 承接上文 2026-11-11 决策；本节只记录实施结果，不改写原决策。

### 安装结果

| 项 | 结果 |
|---|---|
| npm 包 | `@tencent-ai/codebuddy-code@2.181.0` |
| 命令解析 | `where codebuddy` → `D:\AppFile\codebuudy\codebuddy.cmd` |
| 版本 | `codebuddy --version` → `2.181.0` |

### ACP 直连

- `initialize` / `session/new` / `prompt` 全部通过；只读 prompt 返回 `OK`，`stopReason=end_turn`。
- 无需适配器：入口即 `codebuddy --acp`，stdio + ndJsonStream。
- 模型列表 17 个，当前/回退模型 `hy4free`：
  `hy4free`、`hy4std`、`hy3`、`hy3-x`、`deepseek-v4.1-flash`、`glm-5.3`、`glm-5.3-flash`、`glm-5.2`、`space-bunny`、`minimax-m3.1-flash`、`minimax-m2.7`、`kimi-k3.1-pro`、`kimi-k3-1`、`kimi-k2.8-preview`、`deepseek-v4-pro`、`step-5-preview`、`mimo-v2.6-pro`。

### 接入改动

- `runtimes/acp-capabilities.js` 新增：`codebuddy: { args: ['--acp'], adapter: '' }`。
- ACP Agent 能力表 **19 → 20**（`Object.keys(ACP_CAPABILITIES).length === 20`）。
- 复用现有 `inspectAgentModels` / `getStatus` / `planSessionConfig`；未新增 IPC 通道，未写 codebuddy 专用适配器。
- `C:\Users\allow\.codebuddy\settings.json` 的 `trustedDirectories` 已补充：
  - `D:/文件/工具/原型工具-PlanD/.devdata/sandbox`
  - `C:/Users/allow/AppData/Roaming/原型工具/sandbox`
  - 原 settings 已备份为 `settings.json.bak-20261112-085601`。

### 验收

- `node tests/acp-live-smoke.js --agent codebuddy --list-models` → PASS，`models=17 current=hy4free`。
- `node tests/acp-live-smoke.js --agent codebuddy` → PASS，`answer="OK"`、`stopReason=end_turn`。
- `node tests/run-all.js` → `SUMMARY total=59 pass=59 fail=0`，`ALL_PASS`。

记录日期：2026-11-12


