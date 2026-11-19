# PlanD ACP 接入 · 技术方案

> 版本：v0.1  
> 日期：2026-11-11  
> 目标：以 `acpx` 作为底层 ACP 运行时，替换现有「一次性 spawn CLI + stdout 解析」的执行链路；保留 `runtimes/engine.js` 作为非 ACP CLI 的兼容通道。  
> 关联产品方案：`docs/ACP-产品方案.md`

---

## 1. 结论先行

1. **底层服务选 `acpx`**：使用 `acpx/runtime` 的 `createAcpRuntime()`，而不是自己实现 JSON-RPC 客户端。
2. **运行环境已升级**：`acpx` 要求 Node.js >= 22.13；Electron 已从 33.4.11 升级到 37.10.3（内置 Node 22.21.1），`acpx@0.22.0` 已安装。Node 22 sidecar 仅作为回滚备选。
3. **不新增 IPC 通道（MVP）**：继续使用现有 74 个通道，通过扩展 `ai:event` 事件类型和 `ai:scope-confirm` 的 payload 完成权限/问答回传，避免触碰 `E-IPC-FROZEN` 门禁。
4. **按 `transport` 路由**：每个 Agent 增加 `transport: 'acp' | 'legacy' | 'auto'`。`ai-process-service` 在 `ai:ask` 入口分流，ACP 走新服务，legacy 原样走 `startAgentExecution()`。
5. **acpx 只做运行时，不做探测**：26 个 Agent 的安装探测继续用现有 `--version` 链路；ACP `initialize` 只在「测试连接」或首次建会话时执行。
6. **所有 ACP Agent 使用显式 command override**：不要依赖 acpx 内置的 `npx` / `process.execPath` 解析，因为 Electron 的 `process.execPath` 是 `electron.exe`，会错误地重启应用。

### 1.1 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| ACP 底层 | `acpx/runtime` | 已有会话、队列、权限、事件、30 个 Agent 配置，MIT |
| 运行方式 | Electron 37+ 内嵌 | 改动最小，不加 Node sidecar；sidecar 作为备选 |
| ACP 探测 | 不做全量握手 | 26 个进程 × initialize 太慢，且非 ACP Agent 不支持 |
| IPC | 复用现有 70 通道 | 避免 contract/preload/controller/tests 连锁改动 |
| Agent 能力表 | 集中 `runtimes/acp-capabilities.js` | 不改 14 个 bespoke def，单一真相源 |
| 权限默认 | `approve-reads` | 读/搜索不打扰，写/执行逐条审批 |

### 1.2 当前实施状态（2026-11-11）

已完成：

- 恢复主窗口工具内 AI 弹窗（`#aiMask`）；删除独立 `aiwin=1` 窗口及相关 IPC/镜像兼容路径。
- 「AI设计」、新建原型、待提交列表统一走工具内弹窗；待提交列表恢复本地 `openAiDesign + aiDoSend`。
- 删除 `aiwin:open/close/toggle` 与 `ai:remote-send` 后，IPC 冻结契约由 74 收敛为 70。
- Electron 37.10.3 + electron-builder 26.18.1 + `acpx@0.22.0` 安装完成；Electron 内置 Node 22.21.1。
- `runtimes/acp-capabilities.js` 19 个 ACP Agent 能力表；`runtimes/registry.js` 统一挂 `transport/acp`。
- `main/acp/`：service、registry、event mapper、permission bridge、errors、runtime。
- `ai-process-service` ACP 分流（默认 `acp.enabled=false`）；`ai:check` 返回 transport/acp 元数据；`ai:models` ACP 走 fallback。
- `ai:scope-confirm` 增加 `kind:'acp-permission'` 路由；前端权限卡 + 设置页 ACP 开关。
- 测试：52/52 全绿；`electron-builder --dir` 打包验证通过（新文件与 acpx 均进 asar）。
- 真实 spike：`opencode acp` 走通 `initialize → session/new → session/prompt`；因模型配额失败，非链路问题。

未完成（Phase 2/3）：

- 真实 Agent 的端到端回归（OpenCode/Claude/Codex）。
- 会话恢复 `resumeSessionId` 前端写入、模型/模式动态切换、Elicitation、认证。
- 权限模式变更后 runtime 单例重建（当前需重启）。
- 打包后真实 ACP 任务冒烟、`asarUnpack` 下 adapter `.bin` 验证。
- 设置页按 Agent 粒度的 `acp.agents` 配置。

---

## 2. 现状与约束

### 2.1 现有链路

```text
renderer
  aiDoSend()
    → protoAPI.ai.ask(prompt, sessionId, sandboxDir, model, extra)
      → ai-controller.js  ai:ask
        → ai-process-service.js aiAskImpl()
          → detect/resolve CLI
          → scope confirm
          → startAgentExecution()
            → runtimes/engine.js spawn()
            → parser (claude-stream / json-event-stream / plain)
            → handlers: onThinking/onChunk/onToolCall/onSession/onClose
              → emitAiEvent() → renderer ai:event
```

### 2.2 关键约束

| 约束 | 现状 | 影响 |
|---|---|---|
| Electron 版本 | 37.10.3 | 内置 Node 22.21.1，满足 acpx 的 22.13 |
| 模块格式 | main 为 CommonJS | acpx 为 ESM-only，需要动态 `import()` |
| IPC 契约 | 70 通道冻结 | 新增通道要改 contract/preload/controller/tests/lint-guard |
| Agent 探测 | `detectAllAgents()` 并发 `--version` | 不能改成 26 个 ACP 握手，太慢且多数不支持 |
| 事件契约 | `ai:event` 的 `session/run_started/tool_call/thinking/chunk/trace/done/error` | ACP 事件必须映射到这些类型，避免前端大改 |
| UI 形态 | 工具内 `#aiMask` 弹窗是唯一 AI 会话界面 | 事件目标与权限卡都面向发起任务的主窗口 |
| 沙箱 | `cwd = aiWorkDir(sandboxDir)`，任务前后签名对比 | ACP 仍以该 cwd 为工作区 |
| 权限现状 | 多数 CLI 全放行旗 | ACP 改为逐条审批，是产品级变化 |
| 测试 | Node 24 跑 `npm test`，Electron 37.10.3 内置 Node 22.21.1 | 测试与 Electron 运行时均已满足 acpx |

---

## 3. 运行环境方案

### 3.1 方案 A：升级 Electron（已执行）

| 项 | 内容 |
|---|---|
| 当前版本 | Electron 37.10.3 / electron-builder 26.18.1 / 内置 Node 22.21.1 |
| 影响 | 主进程 Node 版本满足 acpx；无需额外 sidecar；打包体积不增加 Node 运行时 |
| 验证 | `npm test` 52/52；`electron-builder --dir` 通过；开发态 Electron 37 启动/工具内 AI 弹窗/设置页/权限卡冒烟通过 |
| 风险 | Electron 大版本升级可能影响 iframe sandbox、DevTools、窗口行为；需继续跑安装包冷启动回归 |

**结论**：已升级，不再需要先做 Electron 升级。PlanD 没有 native 依赖，升级成本可控。

### 3.2 方案 B：Node 22 sidecar（仅回滚备选）

| 项 | 内容 |
|---|---|
| 结构 | 主进程 spawn 一个 `node.exe acp-sidecar.js`，sidecar 内跑 `acpx/runtime` |
| 通信 | 本地 stdio JSON-RPC 或命名管道；主进程做客户端 |
| 优点 | 不改 Electron；ACP 崩溃不拖垮主进程；可独立升级 Node |
| 缺点 | 打包 Node 运行时（约 50MB+）；要维护第二套 RPC；权限/事件需要二次转发 |
| 适用 | Electron 升级被阻塞、或需要强隔离 |

**不建议**直接把 `acpx` CLI 当 sidecar：CLI 的 NDJSON 输出适合自动化，不适合交互式权限和会话控制；sidecar 应嵌入 `acpx/runtime`，由主进程通过本地 RPC 调用。

---

## 4. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ AI 对话弹窗 (工具内 #aiMask / project-ai-export.js)          │
│  - 现有 ai:event 渲染                                       │
│  - 新增 permission / question / plan / usage / agent_status │
│  - 设置页 ACP 状态、模型/模式、权限策略                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (现有 70 通道 + 事件扩展)
┌──────────────────────────▼──────────────────────────────────┐
│ Main                                                        │
│  ai-controller.js                                           │
│    ├─ ai:ask ───────────────┐                               │
│    ├─ ai:cancel ────────────┤                               │
│    ├─ ai:check ─────────────┤                               │
│    ├─ ai:models ────────────┤                               │
│    ├─ ai:save-config ───────┤                               │
│    └─ ai:scope-confirm ─────┤                               │
│                             ▼                               │
│  ai-process-service.js  (facade / 路由)                     │
│    ├─ isApiMode → 现有 BYOK 链路                            │
│    ├─ isAcpEnabled → acp-runtime                            │
│    └─ 其他 → runtimes/engine.js (legacy)                    │
│                                                             │
│  acp/                                                       │
│    ├─ acp-service.js          acpx 动态 import / 单例壳      │
│    ├─ acp-runtime.js          ask / session / turn / cancel  │
│    ├─ acp-registry.js         Agent → 显式 command override  │
│    ├─ acp-event-mapper.js     AcpRuntimeEvent → ai:event     │
│    ├─ acp-permission-bridge.js 权限等待与回传                 │
│    └─ acp-errors.js           acpx/SDK 错误 → 用户可读错误    │
│                                                             │
│  runtimes/engine.js           legacy CLI 执行（不动）         │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. acpx 集成设计

### 5.1 依赖与版本

```json
{
  "dependencies": {
    "acpx": "0.22.0"
  }
}
```

> Claude / Codex / Pi 适配器尚未加入 `package.json`；启用这三个 Agent 前需安装 `@agentclientprotocol/claude-agent-acp`、`@agentclientprotocol/codex-acp`、`pi-acp`，并加入 `dependencies`。

原则：

- `acpx` 锁定精确版本，避免 pre-1.0 API 漂移。
- 不要单独引入 `@agentclientprotocol/sdk` 2.x；acpx 0.22 使用 1.9.x，混用会产生两套协议栈。
- Claude/Codex/Pi 适配器版本以 acpx 0.22 的内置 ranges 为准；升级 acpx 时同步升级。
- `electron` 升到 ≥ 37；`electron-builder` 升到 ≥ 26。

### 5.2 Runtime 单例

```js
// main/acp/acp-service.js
'use strict';

const path = require('node:path');
const { app } = require('electron');
const paths = require('../paths');
const shared = require('../state');
const { buildAgentOverrides } = require('./acp-registry');
const { permissionBridge } = require('./acp-permission-bridge');

let runtimePromise = null;

async function getRuntime() {
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    // acpx 是 ESM-only；CJS main 用动态 import
    const acpx = await import('acpx/runtime');

    const overrides = await buildAgentOverrides();
    const registry = acpx.createAgentRegistry({ overrides });

    return acpx.createAcpRuntime({
      // 默认 cwd；ensureSession 会传每个沙箱的实际 cwd
      cwd: paths.SANDBOX_ROOT,

      sessionStore: acpx.createFileSessionStore({
        stateDir: path.join(app.getPath('userData'), 'acp', 'sessions'),
      }),

      agentRegistry: registry,

      // 运行级默认策略；单会话可通过 sessionPermissions 覆盖
      permissionMode: 'approve-reads',
      nonInteractivePermissions: 'deny',
      permissionPolicy: {
        autoApprove: ['read', 'search'],
        escalate: ['edit', 'execute', 'fetch', 'move', 'delete'],
        defaultAction: 'deny',
      },

      // 权限回调（问答回调在 startTurn 时按轮传入）
      onPermissionRequest: (request, context) =>
        permissionBridge.request(request, context),
      elicitationModes: ['form'],

      // 能力开关：runtime 级；MVP 全局开启，靠权限策略控制
      fs: true,
      terminal: true,

      // 30 分钟；超时由 acpx 转成错误
      timeoutMs: 30 * 60 * 1000,

      // ACP 协议流量（handleAcpMessage 在 acp-runtime.js 内实现/脱敏）
      onAcpMessage: (direction, message) =>
        handleAcpMessage(direction, message),

      // 进程生命周期：复用现有 activeExecution / killProcessTree
      processLifecycle: {
        onSpawned: (proc) => {
          if (shared.activeExecution) {
            shared.activeExecution.pid = proc.pid;
          }
        },
        onExit: (proc) => {
          if (shared.activeExecution && shared.activeExecution.pid === proc.pid) {
            shared.activeExecution = null;
          }
        },
      },

      // 按会话覆盖权限模式（cwd / agent 不同）
      sessionPermissions: (ctx) => permissionBridge.policyFor(ctx),

      // 子进程环境：显式 allowlist，避免泄漏 Electron/API 变量
      agentProcessEnv: buildAgentEnv(),
    });
  })();

  return runtimePromise;
}

async function shutdown() {
  if (!runtimePromise) return;
  try {
    const runtime = await runtimePromise;
    await runtime.shutdown();
  } catch (_) {}
  runtimePromise = null;
}

module.exports = { getRuntime, shutdown };
```

> 以上为结构示意；落地时补齐 `buildAgentEnv()`（环境白名单）、`permissionBridge.policyFor()`、`diagnostics` 等实现。

> AI 弹窗、未来多标签页共用这一个 runtime；不要按窗口创建 runtime，否则同一会话会出现多个 owner/进程。`createSharedAcpRuntime` 用于「多进程共享同一本地会话」，当前单 Electron 主进程不需要。
>
> `getRuntime()` 必须在 `app.whenReady()` 之后首次调用，确保 `app.getPath('userData')` / `paths.SANDBOX_ROOT` 已完成初始化。

### 5.3 Agent Registry：必须显式 override

acpx 内置 registry 默认用 `npx`，并且某些路径会使用 `process.execPath`。在 Electron 里：

- `process.execPath` 是 `electron.exe`，不是 `node.exe`；
- 打包后可能没有 `npx`；
- 首次运行联网安装适配器不可接受。

因此，**所有 ACP Agent 都通过 override 指定显式命令**：

```js
// main/acp/acp-registry.js
const path = require('node:path');
const { app } = require('electron');
const { getAllAgentDefs } = require('../../runtimes/registry');
const { resolveAgentExecutable } = require('../../runtimes/resolution');

async function buildAgentOverrides() {
  const overrides = {};

  for (const def of getAllAgentDefs()) {
    if (def.transport !== 'acp') continue;

    // 1) 原生 ACP：复用现有 CLI 解析
    if (!def.acp || !def.acp.adapter) {
      const bin = await resolveAgentExecutable(def, getCustomPath(def.id));
      if (bin) {
        overrides[def.id] = [bin, ...((def.acp && def.acp.args) || [])];
      }
      continue;
    }

    // 2) 适配器：自定义路径 → node_modules/.bin → PATH
    const adapter = await resolveAdapterBin(def.acp.command, def.id);
    if (adapter) {
      overrides[def.id] = [adapter, ...(def.acp.args || [])];
    }
  }

  return overrides;
}

function getCustomPath(id) {
  try {
    const cfg = require('../services/ai-config-store').loadAiConfigFull();
    return (cfg.cliPaths && cfg.cliPaths[id])
      || (id === 'opencode' ? cfg.cliPath : '')
      || '';
  } catch (_) {
    return '';
  }
}

async function resolveAdapterBin(name, agentId) {
  const custom = getCustomPath(agentId || name);
  if (custom) return custom;

  // 打包后 app.getAppPath() 可能是 asar；.bin 通常需要 asarUnpack
  const binDir = path.join(app.getAppPath(), 'node_modules', '.bin');
  const win = process.platform === 'win32';
  const candidates = win
    ? [path.join(binDir, name + '.cmd'), path.join(binDir, name + '.exe')]
    : [path.join(binDir, name)];

  for (const c of candidates) {
    try { if (require('node:fs').existsSync(c)) return c; } catch (_) {}
  }

  // 最后走 PATH
  return await resolveAgentExecutable({ bin: name, fallbackBins: [] }, custom)
    .catch(() => null);
}
```

> 注意：`resolveAdapterBin` 的 PATH 分支是异步的；实际实现可先同步检查 `node_modules/.bin`，再在启动时异步补齐。不要在 `createAgentRegistry` 之后动态改 override。

### 5.4 会话与 handle 映射

```js
// main/acp/acp-runtime.js（节选：会话部分）
const crypto = require('node:crypto');

function sessionKeyFor({ cwd, uiSessionId }) {
  const cwdHash = crypto.createHash('sha1').update(String(cwd || '')).digest('hex').slice(0, 12);
  const sid = String(uiSessionId == null ? '' : uiSessionId).trim() || 'default';
  const sidHash = crypto.createHash('sha1').update(sid).digest('hex').slice(0, 12);
  return `pland-${cwdHash}-${sidHash}`;
}

async function ensureSession({ runtime, agentId, cwd, uiSessionId, resumeSessionId }) {
  return runtime.ensureSession({
    sessionKey: sessionKeyFor({ cwd, uiSessionId }),
    agent: agentId,
    mode: 'persistent',
    cwd,
    resumeSessionId: resumeSessionId || undefined,
  });
}
```

> 不要把原始 `uiSessionId` 拼进 sessionKey：acpx 落盘时会再次编码为文件名，长路径型 id 会超过 Windows 255 字符上限，导致 `ACP_SESSION_INIT_FAILED`。使用哈希后 key 固定 31 字符。

映射关系：

| 层 | 字段 | 用途 |
|---|---|---|
| UI 会话 | `s.id`（`s_...`） | 前端标签页/会话列表 |
| acpx 会话键 | `sessionKey` | `(agentCommand, cwd, name)` 作用域 |
| acpx 记录 | `handle.acpxRecordId` | 本地 session store 主键 |
| ACP 会话 | `handle.backendSessionId` | `session/prompt` 的 sessionId，存到 `s.oid` |
| Agent 内部会话 | `handle.agentSessionId` | 某些适配器的原生会话 ID，可选 |
| UI 扩展 | `s.acp = { recordId, backendSessionId, agentId, cwd, protocolVersion }` | 恢复、诊断、展示 |

恢复流程：

```text
打开对话
  → 读取本地 s.oid / s.acp
  → runtime.ensureSession({ resumeSessionId: s.oid })
      ├─ 成功 → handle；UI 显示「已恢复」
      └─ 失败 → runtime.ensureSession({ resumeSessionId: undefined })
                 → 新会话；UI 提示「该 Agent 不支持恢复，已开启新会话」
```

清空/新建：

```text
用户点「清空」或「新会话」
  → 若有 handle：runtime.close({ handle, reason: 'user-reset' })
  → 清除 s.oid / s.acp
  → 下一轮 ensureSession 新建
```

> `sessionPermissions(ctx)` 的 `ctx` 只提供 `sessionKey`、`cwd`、`agentCommand`，不直接提供 PlanD 的 `agentId`。需要在 `ensureSession` 时维护一个 `sessionKey → { agentId, permissionMode }` 的内存映射，供权限策略和事件路由使用。

### 5.5 单轮执行

```js
// main/acp/acp-runtime.js（节选：单轮执行）
async function startAcpTurn({ runtime, handle, prompt, uiSessionId, handlers }) {
  const requestId = `${uiSessionId}:${Date.now()}:${crypto.randomUUID()}`;

  const turn = runtime.startTurn({
    handle,
    requestId,
    mode: 'prompt',
    text: prompt,
    onPermissionRequest: (request, context) =>
      permissionBridge.request(request, context),
    onElicitation: (request, context) =>
      permissionBridge.requestElicitation(request, context),
  });

  // 进程已接受 prompt 后再发 run_started
  turn.promptStarted.then(() => {
    handlers.onStart({
      pid: shared.activeExecution && shared.activeExecution.pid,
      agentId: handle.agentId,
      agentName: handle.agentName,
    });
  }).catch(() => {});

  for await (const event of turn.events) {
    mapEvent(event, handlers, uiSessionId);
  }

  const result = await turn.result;
  return result;
}
```

关键点：

- 用 `startTurn()`，不要用 `runTurn()`；`startTurn().events` 不保证发出终态事件，终态以 `turn.result` 为准。
- `turn.promptStarted` 只表示 prompt 被 transport 接受，不代表 Agent 开始输出。
- `turn.result` 在最终持久化/清理后 resolve，适合触发 `done`。
- `turn.cancel()` 是单轮取消；`runtime.cancel({ handle })` 是会话级取消。

### 5.6 取消与超时

```js
async function cancelAcpTurn(active) {
  const { turn, handle, runtime } = active;
  try { await turn.cancel({ reason: 'user' }); } catch (_) {}

  // 2 秒内未结束，杀进程树兜底
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!shared.activeExecution) break;
    await sleep(50);
  }

  if (shared.activeExecution && shared.activeExecution.pid) {
    try { await killProcessTree(shared.activeExecution.pid); } catch (_) {}
  }

  // 清理权限等待者
  permissionBridge.cancelSession(handle.backendSessionId);
  shared.activeExecution = null;
}
```

- acpx 的 `timeoutMs` 到点会以错误结束；UI 映射为「执行超时」，不是「连接失败」。
- 取消时挂起的权限请求必须 resolve 为 cancel，否则 Agent 可能一直等。

### 5.7 一次请求的时序

```text
renderer          main/ai-process-service        acp-service              acpx runtime              Agent
   │ ai:ask                │                         │                        │                      │
   ├──────────────────────>│                         │                        │                      │
   │                       │ scope confirm (可选)     │                        │                      │
   │                       ├────────────────────────>│                        │                      │
   │                       │ ensureSession           │                        │                      │
   │                       ├────────────────────────>│ ensureSession          │                      │
   │                       │                         ├───────────────────────>│ spawn / initialize   │
   │                       │                         │<───────────────────────┤ handle               │
   │                       │ startTurn               │                        │                      │
   │                       ├────────────────────────>│ startTurn              │                      │
   │                       │                         ├───────────────────────>│ session/prompt       │
   │                       │                         │<───────────────────────┤ session/update       │
   │                       │<────────────────────────┤ mapEvent               │                      │
   │<──────────────────────┤ ai:event                │                        │                      │
   │                       │                         │<───────────────────────┤ request_permission   │
   │<──────────────────────┤ permission_request      │                        │                      │
   │ confirmScope          │                         │                        │                      │
   ├──────────────────────>│                         │ resolve                │                      │
   │                       │                         ├───────────────────────>│ permission response  │
   │                       │                         │<───────────────────────┤ session/update       │
   │<──────────────────────┤ ai:event                │                        │                      │
   │                       │<────────────────────────┤ result                 │                      │
   │<──────────────────────┤ done                    │                        │                      │
```


## 6. 事件映射

### 6.1 acpx 事件 → 现有 `ai:event`

| acpx `AcpRuntimeEvent` | 现有 `ai:event` | UI |
|---|---|---|
| `text_delta` + `stream: 'output'` | `chunk` | 正文气泡 |
| `text_delta` + `stream: 'thought'` | `thinking` | 思考链 |
| `tool_call` | `tool_call` | 工具卡 |
| `status` + `entries` | `plan` | 计划卡 |
| `status` + `availableCommands` | `commands` | 斜杠命令 |
| `status` + `used/size/cost/breakdown` | `usage` | 用量卡/日志 |
| `error` | `error` | 错误卡 |
| `turn.result.status === 'completed'` | `done` | 完成 |
| `turn.result.status === 'cancelled'` | `done`（`cancelled:true`） | 已停止 |
| `turn.result.status === 'failed'` | `error` | 失败 |
| `onPermissionRequest` | `permission_request` | 权限卡 |
| `onElicitation` | `question_request` | 问题卡 |
| `processLifecycle.onSpawned` | `agent_status`（connected） | 状态 |
| `processLifecycle.onExit` | `agent_status`（disconnected） | 状态 |
| `onAcpMessage` | `trace`（tag `ACP`） | 协议日志 |

### 6.2 映射实现

```js
// main/acp/acp-event-mapper.js
function mapEvent(event, handlers, uiSessionId) {
  switch (event.type) {
    case 'text_delta':
      if (event.stream === 'thought') {
        handlers.onThinking({ text: event.text });
      } else {
        handlers.onChunk({ text: event.text });
      }
      break;

    case 'tool_call':
      handlers.onToolCall({
        type: 'tool_call',
        id: event.toolCallId,
        toolCallId: event.toolCallId,
        tool: event.title,
        title: event.title,
        status: event.status,
        kind: event.kind,
        locations: event.locations,
        input: event.rawInput,
        output: event.rawOutput,
        content: event.content,
        uiSessionId,
      });
      break;

    case 'status':
      if (Array.isArray(event.entries)) {
        handlers.onPlan({ entries: event.entries, uiSessionId });
      }
      if (Array.isArray(event.availableCommands)) {
        handlers.onCommands({ commands: event.availableCommands, uiSessionId });
      }
      if (event.used != null || event.size != null || event.cost) {
        handlers.onUsage({
          used: event.used,
          size: event.size,
          cost: event.cost,
          breakdown: event.breakdown,
          uiSessionId,
        });
      }
      break;

    default:
      break;
  }
}
```

### 6.3 `run_started` / `done` / `error`

```js
// run_started
emitAiEvent({
  type: 'run_started',
  pid,
  agentId: def.id,
  agentName: def.name,
  engine: 'cli',
  transport: 'acp',
  uiSessionId,
});

// done
emitAiEvent({
  type: 'done',
  cancelled: result.status === 'cancelled',
  stopReason: result.stopReason,
  permissionStats: permissionBridge.statsFor(handle.backendSessionId),
  fileChanges,          // 仍由现有签名 diff 计算
  transport: 'acp',
  uiSessionId,
});

// error
emitAiEvent({
  type: 'error',
  code: normalized.code,
  title: normalized.title,
  message: normalized.message,
  action: normalized.action, // login / install / switch / retry
  retryable: normalized.retryable,
  transport: 'acp',
  uiSessionId,
});
```

> `result.stopReason` 可能是 `end_turn`、`max_tokens`、`refusal`、`cancelled` 等；UI 用中文映射，不直接展示枚举。

---

## 7. 权限与问答桥

### 7.1 权限请求

acpx 的 `onPermissionRequest` 收到：

```ts
type AcpPermissionRequest = {
  sessionId: string;
  raw: RequestPermissionRequest;
  inferredKind?: ToolKind;
};
```

前端需要：

```ts
type PermissionPayload = {
  type: 'permission_request';
  id: string;
  uiSessionId: string;
  sessionId: string;
  toolCallId?: string;
  title: string;
  kind?: string;       // read / edit / execute / fetch ...
  command?: string;
  path?: string;
  locations?: Array<{ path: string; line?: number }>;
  options: Array<{ optionId: string; name: string; kind: string }>;
  risk: 'low' | 'medium' | 'high';
};
```

回传：

```js
// renderer -> main，复用现有 ai:scope-confirm 通道
window.protoAPI.ai.confirmScope({
  kind: 'acp-permission',
  id,
  decision: 'allow-once' | 'allow-always' | 'deny',
  optionId, // 可选：直接选 Agent 提供的 option
});
```

主进程路由：

```js
// ai-controller.js
ipcMain.on('ai:scope-confirm', (ev, payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.kind === 'acp-permission') {
    return acpPermissionBridge.resolve(p);
  }
  if (p.kind === 'acp-elicitation') {
    return acpPermissionBridge.resolveElicitation(p);
  }
  return aiProcess.handleScopeConfirmResponse(p);
});
```

`acpPermissionBridge.request()`：

```js
async function request(req, { signal }) {
  const id = randomUUID();
  const payload = buildPermissionPayload(id, req);
  emitInteraction(payload); // 回传发起任务的工具内主窗口

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup(id);
      resolve({ outcome: 'cancel' });
    }, 120000);

    pending.set(id, {
      req,
      resolve: (decision) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(decision);
      },
    });

    signal.addEventListener('abort', () => {
      cleanup(id);
      resolve({ outcome: 'cancel' });
    }, { once: true });
  });
}
```

决策映射：

| UI | acpx 决策 |
|---|---|
| 允许一次 | `{ outcome: 'allow_once' }` 或 `{ outcome: 'selected', optionId }` |
| 本会话始终允许此类 | `{ outcome: 'allow_always' }` 或记住 optionId |
| 拒绝 | `{ outcome: 'reject_once' }` / `{ outcome: 'reject_always' }` |
| 超时/取消 | `{ outcome: 'cancel' }` |

> 如果 Agent 提供了多个同 kind 的 option，优先回传 `optionId`，避免 acpx 选错。

### 7.2 问答 / Elicitation

- acpx `onElicitation` 收到 `elicitation/create`。
- 映射为 `question_request`，前端复用 `question-form` 卡片。
- 回传：

```js
window.protoAPI.ai.confirmScope({
  kind: 'acp-elicitation',
  id,
  action: 'accept' | 'decline' | 'cancel',
  content: { questionId: value },
});
```

- `elicitationModes: ['form']`；URL 模式暂不支持，返回 `decline`。
- 若 acpx 识别到「以权限请求形式出现的问题」且无法选择答案，会报 `PERMISSION_PROMPT_UNAVAILABLE`；UI 明确提示「该 Agent 的提问形式暂不支持，请切换 Agent 或使用兼容模式」。

---

## 8. IPC 与事件契约

### 8.1 不新增通道

MVP 复用：

| 通道 | 用途 | 变化 |
|---|---|---|
| `ai:check` | 探测 Agent | 返回增加 `transport` / `acp` 静态字段 |
| `ai:models` | 模型列表 | ACP Agent 走 `inspectAgentModels` / `getStatus` |
| `ai:ask` | 发起任务 | `extra.uiSessionId` / `acpSessionId` / `resumeSessionId`；是否走 ACP 由主进程判断 |
| `ai:cancel` | 取消 | 支持 ACP turn.cancel + 进程兜底 |
| `ai:is-busy` | 忙态 | 不变 |
| `ai:save-config` | 保存配置 | 增加 `acp` 配置块 |
| `ai:scope-confirm` | 范围/权限/问答回传 | 增加 `kind` 字段 |
| `ai:open-terminal` | 用户终端 | 不变 |

如果 P1 需要显式会话管理，再新增：

- `ai:session-list`
- `ai:session-close`

新增时必须同步：

1. `preload.js`
2. `main/ipc-contract.js` 的 `IPC_CHANNELS`
3. `main/controllers/ai-controller.js` 的 `ipcMain.handle`
4. `tests/verify-ipc.js`
5. `tests/lint-guard.js` 中硬编码的 `70`

### 8.2 `ai:event` 扩展

新增事件类型（向后兼容，旧前端会忽略）：

```text
agent_status
permission_request
permission_resolved
question_request
question_resolved
plan
usage
commands
```

公共字段：

```js
{
  type: '...',
  uiSessionId: 's_xxx',
  transport: 'acp',
  ts: 1730000000000,
}
```

前端按 `uiSessionId` 过滤；`ai:event` 只发回发起任务的工具内主窗口，由其 AI 弹窗渲染。

### 8.3 事件目标

```js
function emitInteraction(payload) {
  // 事件回到发起任务的窗口（工具内主窗口）；未来多标签页可按 uiSessionId 扩展
  const wc = ev.sender;
  try { if (wc && !wc.isDestroyed()) wc.send('ai:event', payload); } catch (_) {}
}
```

流式 `chunk` / `thinking` 与权限/状态事件都发回发起任务的窗口；工具内 AI 弹窗负责渲染，不存在独立 AI 窗口。

---

## 9. 配置模型

### 9.1 `ai-config.json` 增加 `acp`

`ai-config-store` 当前对未知键基本透传，但仍建议显式加入默认值与保存白名单：

```json
{
  "acp": {
    "enabled": true,
    "defaultPermissionMode": "approve-reads",
    "sessionTtlMs": 2592000000,
    "logJsonRpc": false,
    "agents": {
      "opencode": {
        "transport": "acp",
        "permissionMode": "approve-reads"
      },
      "claude": {
        "transport": "acp",
        "command": "C:\\...\\claude-agent-acp.cmd",
        "args": []
      },
      "codex": {
        "transport": "acp"
      },
      "deepseek": {
        "transport": "legacy"
      }
    }
  }
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `enabled` | 全局 ACP 开关；false 时全部走 legacy |
| `defaultPermissionMode` | `approve-reads` / `approve-all` / `deny-all` |
| `sessionTtlMs` | 会话过期清理 |
| `logJsonRpc` | 是否记录 ACP 协议流量 |
| `agents[id].transport` | `acp` / `legacy` / `auto` |
| `agents[id].permissionMode` | 单 Agent 覆盖 |
| `agents[id].command` / `args` | 自定义 adapter 路径（可选） |

敏感凭据（API Key、OAuth token）不要写入 `acp` 明文；沿用 `safeStorage` 或环境变量注入。

> 灰度策略：首版 `acp.enabled` 默认 `false`，设置页提供开关；Phase 2 验证通过后对新安装默认 `true`，老用户保持 `auto` 逐步迁移。

### 9.2 Manifest / 能力表

推荐把 ACP 能力集中在 `runtimes/acp-capabilities.js`，由 `runtimes/registry.js` 统一挂到每个 def 上。`manifest.json` 不必逐个改；如果希望 manifest 自描述，也可以给 factory 条目补同样字段，但以能力表为准。

示例：

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "bin": "opencode",
  "versionArgs": ["--version"],
  "transport": "acp",
  "acp": {
    "agent": "opencode",
    "args": ["acp"],
    "adapter": false
  }
}
```

Claude：

```json
{
  "id": "claude",
  "name": "Claude Code",
  "bin": "claude",
  "versionArgs": ["--version"],
  "transport": "acp",
  "acp": {
    "agent": "claude",
    "command": "claude-agent-acp",
    "args": [],
    "adapter": true
  }
}
```

Codex / Pi 同理。`factory.js` 需要把 `transport`、`acp` 透传到 `def`；`types.js` 更新 JSDoc。

`needsProtocol` 保留一个版本用于兼容旧测试；`transport` 优先。

---

## 10. 与现有代码的接入点

### 10.1 `main/services/ai-process-service.js`

**`aiAskImpl`**

```js
const useAcp = !isApiMode
  && aiCfg.acp
  && aiCfg.acp.enabled !== false
  && def
  && def.transport === 'acp'
  && resolveTransport(aiCfg, def.id) !== 'legacy';

// helper
function resolveTransport(cfg, id) {
  const v = cfg && cfg.acp && cfg.acp.agents && cfg.acp.agents[id];
  return (v && v.transport) || 'auto';
}

if (useAcp) {
  return acpService.ask({
    ev, prompt: finalPrompt, sessionId: agentSessionToken,
    sandboxDir, model: targetModel, extraOpts,
    def, aiCfg, cwd, beforeSignature, beforeContents,
  });
}
// 原 legacy 路径保持不变
```

**`aiCancelImpl`**

```js
if (shared.activeExecution && shared.activeExecution.kind === 'acp') {
  return acpService.cancel(shared.activeExecution);
}
// 原 killProcessTree 路径
```

**`aiModelsImpl`**

```js
if (def.transport === 'acp' && acpEnabled) {
  try {
    const models = await inspectAgentModels({
      agentCommand: await buildAgentCommand(def),
      cwd: aiWorkDir(null),
      timeoutMs: 10000,
    });
    // 转成现有 groups 结构
  } catch (_) {
    // 回退 fallbackModels
  }
}
```

**`aiCheckImpl`**

- 保持 `detectAllAgents(customPaths)`。
- 为每个结果附加：

```js
{
  transport: def.transport || 'legacy',
  acp: {
    supported: def.transport === 'acp',
    adapter: !!(def.acp && def.acp.adapter),
    enabled: !!(aiCfg.acp && aiCfg.acp.enabled),
  }
}
```

- 不做 ACP `initialize`。

### 10.2 `main/controllers/ai-controller.js`

- `ai:scope-confirm` 路由增加 `kind` 分支（见 7.1）。
- 其他通道不变。

### 10.3 `preload.js`

- 保持现有 `confirmScope`；可增加别名 `confirmInteraction`，但底层仍是 `ai:scope-confirm`。
- 不新增 IPC 通道。

### 10.4 `runtimes/engine.js`

在 `startAgentExecution()` 入口增加保护：

```js
if (def.transport === 'acp') {
  throw new Error('ACP agent must be executed via main/acp/acp-service.js');
}
```

legacy 的 `needsProtocol` 分支保留，但只对非 ACP 的发现型协议生效。

### 10.5 `runtimes/registry.js` / `defs/factory.js` / `types.js`

- `runtimes/registry.js`：构建 `BASE_AGENT_DEFS` 后，用 `runtimes/acp-capabilities.js` 统一补 `transport` / `acp` 字段。
- `factory.js` 不需要改；它仍负责 manifest 条目的基础字段。
- `types.js` 增加 `transport` / `acp` 的 JSDoc 说明。

> 14 个 bespoke def（opencode / claude / codex / cursor-agent / deepseek-harness / qwen / deepseek / mimo / amp / codebuddy / aider / grok-build / antigravity / atomcode）不建议逐个改 JS 文件。更稳的做法是新增 `runtimes/acp-capabilities.js` 作为 ACP 能力单一真相源：
>
> ```js
> const ACP_CAPABLE = {
>   opencode: { args: ['acp'] },
>   claude: { adapter: 'claude-agent-acp' },
>   codex: { adapter: 'codex-acp' },
>   'cursor-agent': { args: ['acp'] },
>   // ...
> };
> ```
>
> `runtimes/registry.js` 在构建 `BASE_AGENT_DEFS` 后统一补字段：
>
> ```js
> const { ACP_CAPABLE } = require('./acp-capabilities');
> for (const def of BASE_AGENT_DEFS) {
>   const cap = ACP_CAPABLE[def.id];
>   if (cap) { def.transport = 'acp'; def.acp = cap; }
> }
> ```
>
> 这样 `acp-registry`、`ai:check`、设置页都读 `def.transport` / `def.acp`，不需要改 14 个 bespoke def，也不需要动 `manifest.json` 的既有结构。

### 10.6 前端 `js/project-ai-export.js`

**`aiDoSend`**

前端只透传 UI 会话/ACP 会话标识，是否走 ACP 由主进程 `isAcpEnabled` 判断：

```js
extra: {
  ...
  uiSessionId: s.id || '',
  acpSessionId: s.oid || '',
}
```

**事件处理**

在现有 `ai:event` 监听中增加：

```js
else if (ev.type === 'agent_status') { permAgentStatus(ev); }
else if (ev.type === 'permission_request') { permRequest(ev); }
else if (ev.type === 'permission_resolved') { permResolved(ev.id); }
else if (ev.type === 'question_request') { /* 复用 question-form 卡片 */ }
else if (ev.type === 'plan') { /* 计划卡 */ }
else if (ev.type === 'usage') { /* 用量卡 */ }
else if (ev.type === 'commands') { /* 斜杠命令 */ }
```

**权限卡**

- 动态 DOM，追加到 `aiChatView` 的时间线。
- 实际结构：

```text
.perm-wrap[data-permission-id]
  .tool-call-card  [permission] [状态]
  .perm-card
    .perm-head  Agent 请求执行操作 / 类型徽标 / 风险
    .perm-target 命令或文件
    .perm-cwd 工作目录
    .perm-foot [拒绝] [本会话始终允许此类] [允许一次]
    .perm-state 待处理/已允许/已拒绝
```

- 回答后：

```js
window.protoAPI.ai.confirmScope({
  kind: 'acp-permission',
  id,
  decision: 'allow-once',
  optionId,
});
```

- 卡片持久化到 `aiCurTaskEvents`（`t:'permission'`），重开对话框时回放为已处理状态。

**设置页**

- `i5RenderAgentMatrix` 增加 `transport` 徽标、ACP 状态、筛选。
- `i5SetMainAgent` 保存 `acp.agents[id].transport`。
- 模型管理器增加模式/来源标签。

### 10.7 `原型+文档.html` / `app.css`

- 新增权限卡、计划卡、终端卡、用量卡、Agent 状态胶囊、ACP 徽标样式。
- 权限卡优先用动态 DOM，避免大改 HTML 结构。
- 设置页增加筛选/权限策略控件（静态 HTML + JS 渲染）。

### 10.8 `package.json` / 打包

- `dependencies` 增加 acpx、adapters、cross-spawn。
- `devDependencies` 升级 electron/electron-builder。
- `build.files` 确认包含：
  - `node_modules/acpx/**`
  - `node_modules/@agentclientprotocol/**`
  - `node_modules/pi-acp/**`
  - `main/acp/**`
- `asarUnpack`：

```json
"asarUnpack": [
  "node_modules/acpx/**",
  "node_modules/@agentclientprotocol/**",
  "node_modules/pi-acp/**"
]
```

- 打包后必须验证：
  - `acpx/runtime` 能被动态 import；
  - adapter `.cmd` / `.exe` 能 spawn；
  - session store 可写；
  - 不是从 asar 里 spawn 二进制。

---

## 11. 错误处理与诊断

### 11.1 错误映射

| 来源 | 错误 | UI 动作 |
|---|---|---|
| acpx | `ACP_BACKEND_MISSING` | 安装/指定 Agent 路径 |
| acpx | `ACP_BACKEND_UNAVAILABLE` | 测试连接、查看日志 |
| acpx | `ACP_SESSION_INIT_FAILED` | 新建会话/切换 Agent |
| acpx | `ACP_TURN_FAILED` | 重试 |
| acpx | `PERMISSION_DENIED` | 黄色提示，不弹红卡 |
| acpx | `PERMISSION_PROMPT_UNAVAILABLE` | 该 Agent 提问形式不支持，切换 Agent |
| acpx | `TIMEOUT` | 执行超时，重试/加大超时 |
| ACP SDK | `AUTH_REQUIRED` | 登录/配置凭据 |
| 进程 | exit code ≠ 0 | 查看日志/重启 Agent |
| 环境 | Node < 22.13 | 升级 Electron / 使用 sidecar |

### 11.2 诊断

- `onAcpMessage` 记录：
  - 方向（outbound/inbound）
  - 方法名
  - JSON-RPC id
  - 时间戳
  - 耗时（请求-响应配对）
  - 错误码
  - 脱敏后的 params/result（移除 token、apiKey、长文本）
- 环形缓冲：每会话 500 条，全局 5MB；滚动写文件。
- `trace` 事件 tag `ACP`，前端协议视图过滤。
- `runtime.doctor()` 或 `inspectAgentModels()` 用于「测试连接」。

---

## 12. 安全设计

1. **工作区**：`cwd = aiWorkDir(sandboxDir)`；ACP `fs/*` 由 acpx 限制在 cwd 内。
2. **权限**：默认 `approve-reads`；写/执行/网络逐条询问；拒绝不崩溃。
3. **路径守卫**：保留现有 `findScopeRefs`、`sandboxGuardBefore/After`；ACP 文件请求再次校验 cwd。
4. **环境变量**：使用 `agentProcessEnvAllow` 白名单，不把 Electron/API 密钥传给 Agent；显式注入需要的凭据。
5. **终端**：`terminal: true` 只在权限审批后执行；不把用户终端和 Agent 终端混用。
6. **会话数据**：存 `%APPDATA%/原型工具/acp/sessions`；提供清理入口；不云同步。
7. **日志脱敏**：JSON-RPC 日志移除 `apiKey`、`token`、`Authorization`、大段文件内容。
8. **诚实文案**：ACP 权限是应用层策略，不是 OS 沙箱；设置页明确提示。

---

## 13. 测试计划

### 13.1 单元测试

- `acp-registry`：Agent id → command override 映射；adapter 缺失处理。
- `acp-event-mapper`：每类事件映射；未知事件忽略；`uiSessionId` 透传。
- `acp-permission-bridge`：allow/deny/always/timeout/abort；optionId 选择。
- `acp-errors`：acpx 错误 → 用户可读错误。
- `ai-config-store`：`acp` 默认值、保存/读取、敏感字段不落盘。

### 13.2 集成测试

- 用官方 TS SDK 写一个 mock ACP agent（`tests/fixtures/mock-acp-agent.js`）：
  - `initialize`
  - `session/new`
  - `session/prompt` → 发送 `agent_message_chunk` / `tool_call` / `permission_request`
  - `session/cancel`
- 用 `acp-service` 驱动 mock：
  - 事件顺序：`run_started` → `thinking` → `chunk` → `permission_request` → `tool_call` → `done`
  - 权限允许后继续；拒绝后 Agent 收到 reject。
  - 取消后 2 秒内结束。
- 用 `inspectAgentModels` 测试模型探测；失败回退静态列表。

### 13.3 真实 Agent 测试

| Agent | 测试内容 | 优先级 |
|---|---|---|
| OpenCode | 会话、流式、工具、取消 | P0 |
| Claude Code | adapter、权限、会话恢复 | P0 |
| Codex | adapter、权限、模型配置 | P0 |
| Kimi / Kiro / Qwen | 原生 ACP、工具 | P1 |
| Copilot | ACP public preview | P1 |
| Vibe | ACP-only、无终端 | P1 |

### 13.4 回归与门禁

- `npm test` 全绿。
- `tests/verify-runtimes.js`：legacy 26 个 def 不回归；`transport` 字段合法。
- `tests/verify-ipc.js`：`ai:check` 字段兼容；`ai:ask` legacy 不回归。
- `tests/verify-terminal.js`：ACP-only Agent 的终端提示。
- `tests/lint-guard.js`：70 通道不变。
- `npm run build` + 安装包冷启动 + ACP 任务冒烟。

### 13.5 性能目标

| 指标 | 目标 |
|---|---|
| 首次连接 | < 3 秒（本机已安装 Agent） |
| 首 token | 不高于 legacy 20% |
| 权限请求 UI 出现 | < 500ms |
| 取消 | P95 < 2 秒 |
| 会话恢复 | < 2 秒 |
| 内存 | 单会话常驻 < 200MB 增量 |

---

## 14. 分阶段实施

### Phase 0：环境与 Spike（已完成）

- 升级 Electron 37.10.3 / electron-builder 26.18.1，跑回归。
- 安装 `acpx@0.22.0`，用 `createAcpRuntime` 跑通一个 `opencode acp` 会话（`initialize → session/new → session/prompt`）。
- 验证 ESM 动态 import、`electron-builder --dir` 打包、asar 内 acpx。
- 产出：可运行的 spike 脚本（opencode 因模型配额失败，链路本身已跑通）。

### Phase 1：服务层与 3 个 Agent（部分完成）

- 新增 `main/acp/*`。
- `ai-process-service` 路由 ACP / legacy（`acp.enabled` 默认 false）。
- OpenCode 已跑通 spike；Claude / Codex 适配器尚未安装，未做真实回归。
- 事件映射、权限桥、取消、错误映射已完成。
- `ai:check` / `ai:models` / `ai:ask` / `ai:cancel` 接入已完成。
- 产出：隐藏开关下的 ACP 任务可用。

### Phase 2：UI 与交互（5-7 天，部分完成）

- 权限卡、计划卡、用量卡、Agent 状态。（权限卡/设置开关已完成；计划/用量待做）
- 设置页 ACP 筛选、状态、权限策略、测试连接。（全局开关已完成；筛选/测试待做）
- 模型/模式切换。
- AI 弹窗生命周期（工具内 `#aiMask` 为主入口、待提交本地发送、关闭不中断任务）。
- Trace 协议视图。
- 产出：可演示的 ACP 体验。

### Phase 3：扩面与增强（1-2 周）

- 19 个 ACP Agent 覆盖。
- 会话恢复、问题/elicitation、终端输出、认证。
- 诊断日志、导出。
- 产出：ACP 成为默认通道，legacy 兜底。

### Phase 4：清理与稳定（持续）

- 按数据决定哪些 legacy 适配器可以下线。
- 优化连接复用、会话 TTL、内存。
- 补齐 E2E 和安装包测试。

---

## 15. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| acpx pre-1.0 API 变化 | 升级破坏 | 锁版本、封装 `acp-service` 接口、必要时 vendor |
| Electron 升级回归 | 影响现有功能 | 先升级跑全量测试，再合 ACP；保留回滚分支 |
| Electron `process.execPath` 问题 | Agent 启动成 Electron | 全部使用显式 override，禁用 acpx 内置 npx/package-exec |
| 适配器缺失 | Claude/Codex 不可用 | 内置依赖 + 检测 + 安装引导 |
| 认证方式不一 | 部分 Agent 不可用 | P1 做认证桥；先覆盖无需登录 Agent |
| 权限请求过多 | 用户烦 | 读/搜索自动允许；会话级记住；风险分级 |
| `fs`/`terminal` 是 runtime 级 | 无法按 Agent 精细开关 | MVP 全局开启 + 权限策略；P1 拆 runtime 或直连 SDK |
| 多窗口事件串扰 | 状态错乱 | `uiSessionId` 过滤 + 交互事件广播 |
| 长会话内存/磁盘 | 性能问题 | TTL、消息上限、清理入口 |
| IPC 冻结门禁 | 无法加通道 | MVP 复用现有通道；P1 按流程更新 74 契约 |

---

## 16. 附录：关键 acpx API 速查

```ts
// 创建
const runtime = createAcpRuntime({
  cwd, sessionStore, agentRegistry, permissionMode,
  nonInteractivePermissions, permissionPolicy,
  onPermissionRequest, onElicitation, elicitationModes,
  fs, terminal, timeoutMs, onAcpMessage, processLifecycle,
  sessionPermissions, agentProcessEnv,
});

// 会话
const handle = await runtime.ensureSession({
  sessionKey, agent, mode: 'persistent', cwd, resumeSessionId,
});
const status = await runtime.getStatus({ handle });
const caps = await runtime.getCapabilities({ handle });

// 单轮
const turn = runtime.startTurn({
  handle, requestId, mode: 'prompt', text,
  onPermissionRequest,
});
await turn.promptStarted;
for await (const event of turn.events) { /* ... */ }
const result = await turn.result; // completed / cancelled / failed
await turn.cancel({ reason: 'user' });

// 控制
await runtime.setMode({ handle, mode });
await runtime.setModel({ handle, model });
await runtime.setConfigOption({ handle, key, value });
await runtime.cancel({ handle });
await runtime.close({ handle, reason, discardPersistentState });

// 生命周期
await runtime.shutdown();

// 探测/模型
const models = await inspectAgentModels({
  agentCommand, cwd, timeoutMs: 10000,
});
const report = await runtime.doctor();
```

### 参考

- acpx：https://github.com/openclaw/acpx
- acpx runtime contract：`src/runtime/public/contract.ts`
- acpx permissions：`docs/permissions.md`
- ACP 官方 TypeScript SDK：https://github.com/agentclientprotocol/typescript-sdk
- ACP 协议：https://agentclientprotocol.com
- DeepChat Electron 实现：https://github.com/ThinkInAIXYZ/deepchat/tree/main/src/main/agent/acp
- vscode-acp 最小客户端：https://github.com/formulahendry/vscode-acp
