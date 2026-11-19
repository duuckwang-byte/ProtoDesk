# AI 流式回复被拆成“一词一气泡”诊断报告

- 诊断对象：`D:\文件\工具\原型工具-PlanD` 当前工作树（HEAD `77192dd`；`src/renderer` 为未跟踪新增）。
- 现象：AI 对话中一条 assistant 回复被拆成多个独立气泡，每个气泡只有一个词，例如截图中的 `调整 / 功能 / 说明 / 文档 / 直接 / 说`。
- 结论：**根因在渲染层消息模型 / store 归约层：每个 `chunk` 增量事件都被转换成一条独立的 `AiMessage`，store 只做数组追加，Chat 再按 message 数组逐条渲染。整条链路没有任何“把同一段流式文本合并到上一条 assistant 消息”的逻辑。**
- 约束：本次只读诊断，未改业务代码、未安装依赖、未提交、未发真实 AI 请求；复现使用本地 mock 事件。

---

## 1. 结论摘要

`chunk` 的语义是 **delta（增量片段）**，不是一条完整消息。当前实现把每个 delta 都当成一条消息：

```text
ACP agent_message_chunk / CLI text_delta
        ↓
ai:event { type: 'chunk', text: '调整' }        // 一个词/一个 token
        ↓
aiEventToMessages() → [新的 AiMessage]          // 1 个事件 = 1 条消息
        ↓
aiReducer('append-messages') → [...prev, msg]   // 只追加，不合并
        ↓
Chat.tsx → messages.map(...)                    // 1 条消息 = 1 个气泡
```

因此：

- codebuddy 按“词”发 delta 时，就是一个词一个气泡；
- 其他 Agent 若按字符发 delta，就会变成一个字一个气泡；
- 问题不是 codebuddy 独有，也不是 P0-2 事件白名单把 `chunk` 误判成控制事件；
- 旧版 `i5AnswerAppendChunk()` 本来就有“累计缓冲区 + 单气泡更新”（`js/project-ai-export.js:5099-5114`），React 迁移没有把这段逻辑迁过来；
- 真正缺的是 **delta → assistant 消息段** 的聚合层，以及可跨事件识别“同一段回复”的 `messageId` / `runId` / 段序号。

---

## 2. 事件样例与语义确认

### 2.1 实际 ACP 事件样例（本地 mapper 复现输出）

输入 3 个 ACP `text_delta`，每个带同一个 `messageId: 'acp-msg-1'`：

```json
[
  { "type": "chunk", "text": "调整", "transport": "acp", "uiSessionId": "s1" },
  { "type": "chunk", "text": "功能", "transport": "acp", "uiSessionId": "s1" },
  { "type": "chunk", "text": "说明", "transport": "acp", "uiSessionId": "s1" }
]
```

注意：**3 个事件里的 `messageId` 全部丢失**。ACP mapper 只保留了 `type/text/transport/uiSessionId`。

### 2.2 当前 chunk 载荷字段

ACP 路径（`main/acp/acp-event-mapper.js:30-38`）：

```js
{
  type: 'chunk',
  text,                 // delta，不是累计全文
  transport: 'acp',
  uiSessionId
}
```

CLI / API 路径（`main/services/ai-process-service.js:1996-2003`）：

```js
emitAiEvent({
  type: 'chunk',
  text: String((text && text.text) || text || '')
});
```

两条路径的共同点：

- `text` 是 **增量片段**；
- 没有 `messageId`；
- 没有 `runId` / `turnId`；
- 没有 `index` / `seq`；
- 没有 `accumulated` 累计全文；
- 没有 `mode: 'delta' | 'full'` 语义标记。

### 2.3 为什么可以确定 `text` 是 delta

- ACP 侧：acpx 的 `resolveTextChunk()` 直接返回当前 `content.text`，不做累计（`node_modules/acpx/dist/runtime.js:188-211`）。
- 主进程 CLI/API 侧：`answerAcc += t` 才是在累计全文（`main/services/ai-process-service.js:1996-2000`），说明 `t` 本身是片段。
- 各 CLI parser 的 `onChunk` 都是按 delta / 行 / 文本块逐次回调（例如 `runtimes/parsers/claude-stream.js:14-18`、`runtimes/parsers/json-event-stream.js:231-243`），每次回调代表“新增内容”，不是整轮累计全文。

因此正确做法是 **append 到当前 assistant 文本段**，而不是每段新建气泡。

### 2.4 `messageId` 其实在上游存在，但在 mapper 被丢掉

acpx 0.22.0 的 `AcpRuntimeEvent` 明确带有可选的 `messageId`，并说明它用于关联同一条 producer message 的多个 chunk：

- `node_modules/acpx/dist/runtime.d.ts:220-233`
- `node_modules/@agentclientprotocol/sdk/schema/schema.json:4458-4468`：

> All chunks belonging to the same message share the same `messageId`. A change in `messageId` indicates a new message has started.

但 `main/acp/acp-event-mapper.js:30-38` 的 `mapTextDelta()` 没有把 `event.messageId` 透传出去，导致前端即使想做协议级合并也没有依据。

---

## 3. 逐层代码定位

### 3.1 消息模型：没有流段/消息 id

`src/renderer/features/ai/adapters.ts:33-62`

```ts
export interface AiMessage {
  key: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  kind: 'text' | 'thinking' | ...;
  text: string;
  ts: number;
  sourceType: string;
  payload?: Record<string, unknown>;
}
```

`AiMessage` 没有：

- `messageId` / `streamId` / `segmentId`；
- `streaming` 状态；
- `delta` / `full` 模式；
- `runId`。

所以消息模型本身表达不了“这几条其实是同一段流”。

### 3.2 适配器：每个 chunk 都新建一条消息

`src/renderer/features/ai/adapters.ts:641-673`

```ts
export function aiEventToMessages(ev, sessionId): AiMessage[] {
  ...
  const mk = (...) => {
    msgSeq += 1;
    return {
      key: str(e.id) || type + '_' + String(msgSeq),
      ...
    };
  };
  switch (type) {
    case 'thinking':
      ...
    case 'chunk':
    case 'answer':
      if (!str(e.text).trim()) return [];
      return [mk('assistant', 'text', str(e.text))];   // ← 每个 delta 新建一条
    ...
  }
}
```

两个直接问题：

1. `chunk` / `answer` 分支无条件 `mk()` 新消息；
2. `key` 使用事件 `id` 或 `type_<全局自增>`；每个 chunk 的 key 都不同，React 无法把它们识别为同一条消息的更新。

另外 `src/renderer/features/ai/adapters.ts:672` 用 `!str(e.text).trim()` 判断空文本，会把**只含空格/换行**的 delta 丢掉，可能导致英文单词间空格或代码换行丢失（详见 §6.4）。

### 3.3 纯 reducer：只做 concat

`src/renderer/features/ai/adapters.ts:724-734`

```ts
export function reduceAiEventsToMessages(prev, ev, sessionId): AiMessage[] {
  const base = Array.isArray(prev) ? prev.slice() : [];
  const next = aiEventToMessages(ev, sessionId);
  if (!next.length) return base;
  return base.concat(next);       // ← 只追加，不尝试合并
}
```

### 3.4 store reducer：append-messages 只做数组拼接

`src/renderer/stores/ai-store.ts:230-235`

```ts
case 'append-messages': {
  const prev = state.messages[action.sessionId] ?? [];
  return {
    ...state,
    messages: { ...state.messages, [action.sessionId]: [...prev, ...action.messages] },
  };
}
```

没有“上一条 assistant text 是否仍在流式中”的判断。

### 3.5 handleEvent：chunk 直接转消息并 append；run_started/done 只切 busy

`src/renderer/stores/ai-store.ts:454-508`

关键片段：

```ts
if (type === 'run_started') dispatch({ type: 'set-busy', busy: true });
if (type === 'done' || type === 'error') dispatch({ type: 'set-busy', busy: false });
...
const msgs = aiEventToMessages(ev, active.id);
if (msgs.length) dispatch({ type: 'append-messages', sessionId: active.id, messages: msgs });
```

事实：

- `run_started` / `done` **没有创建消息边界**，只改 `busy`；
- 每个 `chunk` 都走 `aiEventToMessages` + `append-messages`；
- 没有维护“当前打开的 assistant 文本段”；
- 没有按 `runId` / `messageId` 判断是否同一段。

### 3.6 Chat / Message：按 message 数组逐条渲染

`src/renderer/components/ai-elements/Chat.tsx:39-43`

```tsx
messages.map((m) => (
  <div key={m.key} data-testid={'ai-msg-' + m.kind}>
    {renderMessage ? renderMessage(m) : <Message message={m} />}
  </div>
))
```

`src/renderer/components/ai-elements/Message.tsx:67-70`

```tsx
return (
  <div data-slot="ai-message-ai" className={...}>
    <div className="whitespace-pre-wrap break-words">{m.text}</div>
  </div>
);
```

没有按 `messageId` 分组，也没有“最后一条 assistant 文本原地更新”的机制。消息数组里有 6 个词，就渲染 6 个带 `gap-2` 间距的气泡。

### 3.7 ACP 主进程链路：逐个 text_delta 发 chunk

`main/acp/acp-runtime.js:1309-1318`

```js
for await (const event of ctx.turn.events) {
  ...
  let mapped = [];
  try { mapped = mapAcpEvents(event, ctx.uiSessionId); } catch (e) { mapped = []; }
  for (const payload of mapped) safeEmit(ctx, payload);
}
```

每个 `text_delta` 映射成一个 `chunk` 并立即 `emit`，没有在 runtime 侧做聚合。

`main/acp/acp-event-mapper.js:30-38` 的 `mapTextDelta()` 只返回：

```js
{
  type: isThought ? 'thinking' : 'chunk',
  text,
  ...sessionFields(uiSessionId)
}
```

`event.messageId` 没有进入返回对象。

### 3.8 CLI / API 链路：onChunk 只保留 text

`main/services/ai-process-service.js:1996-2003`

```js
onChunk: (text) => {
  try {
    const t = String((text && text.text) || text || '');
    if (t) answerAcc += t;
  } catch (e) {}
  try { addEvUsage(text && text.usage); } catch (e) {}
  emitAiEvent({ type: 'chunk', text: String((text && text.text) || text || '') });
}
```

parser 即使提供了 `id` / `stepIndex`（例如 `runtimes/parsers/agy-stream.js:198`），这里也只保留 `text`，其余字段全部丢弃。

`run_started`（`ai-process-service.js:1992`）没有 `runId`；`done`（`ai-process-service.js:2118-2123`）也没有 `runId`。ACP 侧 `ctx.requestId` 虽然存在（`acp-runtime.js:1464`），但也没有写进 `run_started` / `chunk` / `done`。

### 3.9 持久化的放大效应

`src/renderer/features/ai/adapters.ts:851-852`

```ts
export const AI_HISTORY_MAX_MESSAGES = 200;
```

当前每个词都是一条消息，因此：

- 一轮稍长的回复就可能占满 200 条消息配额；
- `serializeSessions()` 截断的是“消息条数”，不是“对话轮数”，早先的对话会被挤掉（`adapters.ts:1156-1158`）；
- 刷新/重开弹窗后，`parseSessionsFile()` 还原的仍然是“一词一条”，气泡问题不会自愈（`adapters.ts:1022-1055`）。

### 3.10 对照：旧实现本来就是合并的

旧渲染层并没有“一词一气泡”：

- `js/project-ai-export.js:7261-7268` 的 live `chunk` 分支调用 `i5AnswerAppendChunk(String(ev.text || ''))`；
- `js/project-ai-export.js:5099-5114` 的 `i5AnswerAppendChunk()` 把片段累加到 `aiTlAnswerText`，并且**复用同一个 `aiTlAnswerEl` / `aiTlAnswerBodyEl`**，只更新其 `innerHTML`；
- 它的空值判断是 `if(!s) return;`，**没有 `trim()`**，所以纯空格/换行片段不会被丢弃。

这说明 React 版适配器在迁移 `ai:event → AiMessage` 时，只保留了“事件进来”的映射，没有把旧实现的“累计缓冲区 + 单气泡更新”一起迁过来。当前一词一气泡是 **React 迁移引入的回归**，不是旧版行为。

---

## 4. P0-2 白名单 / 控制事件过滤是否影响 chunk/answer

**结论：不影响本次问题，P0-2 不是根因。**

`src/renderer/features/ai/adapters.ts:393-433`：

```ts
export const AI_INTERNAL_EVENT_TYPES = [
  'acp_catalog', 'acp_config', 'run_started', 'done', 'session',
  'commands', 'permission_resolved', 'question_resolved',
  'scope_confirm', 'scope_confirm_dismiss',
] as const;

const AI_CHAT_EVENT_TYPES = new Set<string>([
  'thinking',
  'chunk',
  'answer',       // ← 明确允许
  'tool_call',
  ...
]);

export function isInternalAiEvent(type: unknown): boolean {
  const t = str(type).trim();
  if (!t) return true;
  return AI_INTERNAL_EVENT_SET.has(t) || !AI_CHAT_EVENT_TYPES.has(t);
}
```

`chunk` 和 `answer` 都在聊天事件白名单内，`isInternalAiEvent('chunk') === false`；现有测试也明确断言了这一点（`src/renderer/features/ai/__tests__/adapters.test.ts:400-405`）。因此：

- 不是把 `chunk` 误判为控制事件；
- 也不是白名单导致“每次 chunk 当独立消息”——后者是 `aiEventToMessages` / `append-messages` 的 1:1 行为，白名单只决定“是否生成消息”，不决定“是否合并”。

需要注意的相邻风险：

- 白名单是 fail-closed 的：如果以后某个 Agent/adapter 把流式事件命名为 `text`、`output`、`final` 等，会被当控制事件静默丢弃。当前主进程 live 路径统一发 `chunk`，所以本次不受影响；建议用事件契约测试锁死 `chunk`/`answer`。
- 静态代码显示主进程 `ai-process-service.js:2038` 发的是 `type: 'question'`，但白名单/适配器只认 `question_request`（`adapters.ts:418`、`adapters.ts:697`），该事件会被 `isInternalAiEvent()` 过滤。这个问题与气泡拆分无关，建议另开项确认，不要混在本次修复里。

---

## 5. codebuddy 是否与其他 Agent 不同

**不是 codebuddy 专属问题。**

- codebuddy 在能力表中是原生 ACP：`runtimes/acp-capabilities.js:30` → `{ args: ['--acp'], adapter: '' }`；`runtimes/registry.js:72-77` 会为它挂 `transport: 'acp'`。
- ACP 开启时，codebuddy 与其他 ACP Agent 走完全相同的映射链：
  `agent_message_chunk` → `text_delta` → `mapAcpEvents()` → `chunk`。
  `main/acp/acp-event-mapper.js` 里没有任何 `codebuddy` 分支。
- ACP 关闭时，codebuddy 走 legacy CLI：`runtimes/defs/codebuddy.js:28,42` 使用 `stream-json` + `streamFormat: 'claude-stream-json'`，最终仍走 `ai-process-service.js:1996-2003` 的 `onChunk` → `chunk`。

差异只在 **delta 粒度**：

- codebuddy 可能按词发 `agent_message_chunk` / `text_delta`，所以肉眼看到“一词一气泡”；
- 其他 Agent 若按字符发，则会“一字一气泡”；
- 若某个 Agent 一次发整段，则看起来正常。

根因是前端把任意粒度的 delta 都当成一条消息，与具体 Agent 无关。

---

## 6. 正确合并方案

### 6.1 合并放在哪一层

**放在状态层（`ai-store` reducer / adapters 的纯归约函数），不要只放在 React 渲染层。**

原因：

1. `messages` 是持久化数据源，渲染层临时分组会导致 store 里仍是成千上万条词消息，200 条上限、历史恢复、导出都会继续出错；
2. `reduceAiEventsToMessages()` 是纯 reducer 底座，应和 store 共享同一套合并规则，保证 live / replay / restore 行为一致；
3. Renderer 保持“消息数组即渲染数组”的简单模型，后续做 Markdown、复制、重试都更容易。

推荐结构：

```text
ai:event (delta)
  → aiEventToMessages() 产出带 streamId / mode 的候选消息
  → appendMessagesWithStreamMerge(prev, incoming)  // 纯函数，唯一合并入口
  → aiReducer('append-messages') / reduceAiEventsToMessages()
  → Chat 只消费合并后的 messages
```

### 6.2 事件契约建议

在主进程侧补齐字段（不新增 IPC 通道，只扩展 `ai:event` 载荷）：

| 字段 | 事件 | 含义 |
|---|---|---|
| `runId` | `run_started` / `chunk` / `done` / `error` | 一轮执行的唯一 id；ACP 可直接用 `ctx.requestId`，CLI/API 在 `runAgentProcess` 开始时生成 |
| `messageId` | `chunk` / `thinking` | ACP 原始 `messageId`；没有就省略 |
| `seq` | `chunk` / `thinking` | 同一 run 内单调递增，用于去重/诊断 |
| `mode` | `chunk` / `answer` | `'delta'`（追加）或 `'full'`（替换）；当前已检查的 ACP / CLI 路径均为 delta；API 模式也走同一 `onChunk`，若未来改为整段回调必须显式标记 |
| `transport` | 全部 | 已有 ACP 侧字段，CLI/API 可补 `'cli'` / `'api'`，便于诊断 |

ACP mapper 最小改动：

```js
function mapTextDelta(event, uiSessionId) {
  const text = event.text == null ? '' : String(event.text);
  if (!text) return null;
  return {
    type: isThought ? 'thinking' : 'chunk',
    text,
    ...(event.messageId ? { messageId: String(event.messageId) } : {}),
    ...sessionFields(uiSessionId),
  };
}
```

CLI/API service 最小改动：

```js
const runId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
// run_started: emitAiEvent({ type: 'run_started', runId, ... })
// onChunk:     emitAiEvent({ type: 'chunk', runId, seq: ++seq, mode: 'delta', text: t })
// done:        emitAiEvent({ type: 'done', runId, ... })
```

### 6.3 合并算法（推荐）

给 `AiMessage` 增加可选字段：

```ts
export type StreamMode = 'delta' | 'full';

export interface AiMessage {
  // ...existing
  /** 同一段流的稳定 id：ACP messageId，或 runId + 段序号 */
  streamId?: string;
  /** 是否仍在流式中；done/error/非文本事件后置 false */
  streaming?: boolean;
  /** delta 追加；full 替换当前段 */
  streamMode?: StreamMode;
}
```

合并规则：

1. **只合并“相邻”的 assistant text 消息。**
   如果上一条是 `thinking` / `tool_call` / `plan` / `permission` / `question` / `error` / `trace` / `usage` / `snapshot` / `status`，就关闭当前文本段，下一条 chunk 新建气泡。这样能保持“文本 → 工具卡 → 文本”的真实时间顺序，避免把工具后的文字塞回工具前的气泡。
2. **同一 `streamId` 才合并。**
   - 有 ACP `messageId`：相同则合并，变化则新建；
   - 没有 `messageId`：用 `runId + ':text:' + segmentSeq` 作为兜底 id；进入 reducer 前必须补好，不能靠“缺失即兼容”合并；
   - 同一 `messageId` 中间夹了 tool/thinking 时，段序号 +1，生成 `messageId#2`，既保留协议归属又保证视觉顺序。
3. **`mode: 'delta'` 追加，`mode: 'full'` 替换。**
   不要靠“文本是否重复”猜；重复词是合法内容，按内容去重会丢字。
4. **`run_started` / `done` / `error` / `cancel` 关闭当前段。**
   即使两轮之间没有用户消息（例如重试、自动续跑），也不会把上一轮文字拼到下一轮。
5. **按 session 维护游标。**
   不要用模块级全局“当前流”；多会话/切会话时按 `sessionId` 分开，避免 A 会话的 chunk 合到 B 会话。
6. **只合并 live 文本。**
   `sourceType === 'restore'` 的历史消息不参与 live 合并；历史合并单独做迁移（见 §6.5）。

最小可用伪代码（前提：进入 `appendStreamText` 前已为每条候选消息补好 `streamId`）：

```ts
function appendStreamText(prev: AiMessage[], incoming: AiMessage): AiMessage[] {
  const last = prev[prev.length - 1];
  const canMerge =
    last &&
    last.role === 'assistant' &&
    last.kind === 'text' &&
    last.streaming !== false &&
    (last.sourceType === 'chunk' || last.sourceType === 'answer') &&
    incoming.role === 'assistant' &&
    incoming.kind === 'text' &&
    (incoming.sourceType === 'chunk' || incoming.sourceType === 'answer') &&
    !!incoming.streamId &&
    incoming.streamId === last.streamId;

  if (!canMerge) {
    return [...prev, { ...incoming, streaming: true }];
  }

  const text =
    incoming.streamMode === 'full'
      ? incoming.text
      : last.text + incoming.text;

  return [
    ...prev.slice(0, -1),
    { ...last, text, ts: incoming.ts, streaming: true },
  ];
}
```

> 注意：`streamMode` 缺省时应按 `chunk → delta` 处理；`answer` 的语义要先确认。当前主进程 live 路径没有 `answer` 生产者，`answer` 主要出现在旧回放/兼容路径（`js/project-ai-export.js:5333` 把 `answer/chunk/final/output` 都当片段追加）。如果未来 `answer` 表示“整段最终文本”，必须显式传 `mode: 'full'`，否则会重复。

### 6.4 避免重复 / 丢字

- **空格/换行不能 trim 掉。** `adapters.ts:672` 现在 `if (!str(e.text).trim()) return []`，会丢弃只含空白的 delta。修复后应：
  - `text === ''` 才跳过；
  - 纯空白 delta 若当前有打开的文本段，追加进去；
  - 若当前没有文本段，可暂存或丢弃（避免开头出现空白气泡），但不能影响后续单词间空格。
- **不要按文本内容去重。** 中文重复词、代码重复符号都是合法内容；去重必须基于 `runId + seq` 或 `messageId + seq`。
- **`seq` 回退/重复事件**：同一 `streamId` 下 `seq <= lastSeq` 视为重复，忽略；`seq` 跳号但内容非空时仍追加，不能因为缺号丢字，可记一条 trace 诊断。
- **`messageId` 变化**：必须新建消息段，不能继续拼。
- **`mode` 混用**：同一段内先 delta 后 full 时，full 应替换而不是追加；先 full 后 delta 时，delta 追加到 full 之后。
- **parser 重复来源**：少数 stream parser 可能在 `content_block_start` 先发一次 `block.text`，随后又发 `content_block_delta`；这类情况应由 parser 只发 delta，或在事件上标记 `mode:'full'`，不能靠前端按文本内容猜重复。
- **取消/错误后晚到的 chunk**：`done/error/cancel` 已关闭的 stream 不再接受合并；晚到 chunk 新建消息或丢弃并记 trace，避免污染下一轮。

### 6.5 历史数据迁移

即使 live 修好，旧会话里已经落盘的“一词一条”仍然存在。建议在恢复路径做一次轻量 coalesce：

- 位置：`adapters.ts:1022-1055` 的 `normalizeStoredMessages()` 之后；
- 规则：相邻、`role === 'assistant'`、`kind === 'text'`、`sourceType === 'chunk'` 的消息合并为一条；遇到任何非文本 kind 或其他 sourceType 就断开；
- `answer` 不参与旧数据合并（避免把多条完整回答拼成一条）；
- 合并后 `key` 保留第一条的 key，`ts` 取最后一条，`streaming` 置 `false`；
- `messagesFromLegacy()`（`adapters.ts:945-993`）如果遇到旧 `m` 中连续的 `r:'a'` 文本，也可以按同样规则合并，但优先级低于 `msgs` 迁移。

这样刷新/重开旧会话后，历史气泡也能恢复成段落。

### 6.6 渲染层联动（容易漏）

`Chat.tsx:17-26` 的自动滚动只依赖 `messages.length`：

```tsx
React.useEffect(() => { ... el.scrollTop = el.scrollHeight; }, [messages.length]);
```

合并后，流式追加不会改变 `messages.length`，只会改最后一条的 `text`，**自动滚动会失效**。修复时应把依赖改为：

```tsx
const last = messages[messages.length - 1];
React.useEffect(..., [messages.length, last?.text.length, last?.ts]);
```

或者由 store 暴露一个 `streamVersion` 计数。

另外：

- `Chat` 的 `key` 应使用合并段的 `streamId` / 首条消息 key，不能把 `messageId` 直接当每个 chunk 的 key，否则同一段的所有 chunk 会得到重复 React key；
- `Message` 不需要改结构，合并后自然一个 `data-slot="ai-message-ai"` 气泡。

### 6.7 兼容 codebuddy / 其他 Agent

| 场景 | 处理 |
|---|---|
| codebuddy ACP，带 `messageId` | mapper 透传 `messageId`，前端按 `messageId` 合并 |
| codebuddy ACP，不带 `messageId` | 用 `runId + ':text:' + segmentSeq` 兜底；同一 run 内相邻 chunk 合并 |
| 其他 ACP Agent，带/不带 `messageId` | 同上，不写任何 agent 特判 |
| codebuddy legacy CLI（`claude-stream-json`） | service 生成 `runId`；`onChunk` 的 text 逐段追加；parser 没有 id 也能合并 |
| 其他 CLI / API Agent | 同一 `onChunk` 路径，同一 runId 兜底 |
| thinking 流 | 使用独立 `streamId`（如 `thought:` 前缀），绝不和正文合并 |
| 工具调用/计划/权限 | 作为文本段边界，关闭当前 text 段，不参与合并 |

关键原则：**合并逻辑只认 `streamId` / `mode` / 段边界，不认 `agentId`。** codebuddy 不需要特殊分支，其他 Agent 也不会被漏掉。

### 6.8 不建议的方案

- **只在 `Chat.tsx` 做相邻文本分组**：store 和持久化仍然是词消息，200 条上限、历史恢复、导出、重试全部继续受影响；且没有 `messageId` 时分组规则会和 store 分叉。
- **按 `text` 内容去重**：会丢掉合法的重复词/重复符号。
- **把 `messageId` 直接作为每条 chunk 的 `key`**：同一段所有 chunk 的 key 相同，React 会报 duplicate key，渲染可能错乱。
- **在 ACP runtime 侧把整轮文本缓存后只发一条**：会破坏流式体验，也拿不到“文本 → 工具 → 文本”的中间顺序。

---

## 7. 本地复现（未发真实 AI 请求）

### 7.1 复现脚本

临时脚本放在仓库外：

```text
C:\Users\allow\AppData\Local\Temp\opencode\ai-stream-repro\repro.ts
```

执行：

```powershell
cd "D:\文件\工具\原型工具-PlanD"
npx tsx "C:\Users\allow\AppData\Local\Temp\opencode\ai-stream-repro\repro.ts"
```

脚本做四件事：

1. 用 `mapAcpEvents()` 构造 3 个带同一 `messageId` 的 `text_delta`；
2. 用 `reduceAiEventsToMessages()` 折叠；
3. 用 `aiReducer()` 模拟 `append-messages`；
4. 用 `createAiStore().handleEvent()` 走真实 store 入口（mock 事件，无网络）。

### 7.2 实际输出

```text
=== 1) ACP mapper 输出 ===
[
  { "type": "chunk", "text": "调整", "transport": "acp", "uiSessionId": "s1" },
  { "type": "chunk", "text": "功能", "transport": "acp", "uiSessionId": "s1" },
  { "type": "chunk", "text": "说明", "transport": "acp", "uiSessionId": "s1" }
]
messageId 保留数: 0 / 3

=== 2) adapters 折叠 ===
消息数: 3
texts: ["调整","功能","说明"]
keys: ["chunk_1","chunk_2","chunk_3"]

=== 3) ai-store 纯 reducer ===
messages 数: 3
kind/text: [
  {"kind":"text","text":"调整","key":"chunk_4"},
  {"kind":"text","text":"功能","key":"chunk_5"},
  {"kind":"text","text":"说明","key":"chunk_6"}
]
busy: false

=== 4) createAiStore.handleEvent ===
store messages 数: 3
store texts: ["调整","功能","说明"]
store busy: false

REPRO_RESULT: BUG_REPRODUCED (3 chunks -> 3 messages)
```

结论：**3 个连续 chunk → 3 条消息 → 3 个气泡**，与截图现象一致；同时确认 ACP mapper 丢失了 3/3 个 `messageId`。

### 7.3 现有单测基线

```powershell
cd "D:\文件\工具\原型工具-PlanD"
npx vitest run src/renderer/features/ai/__tests__/adapters.test.ts src/renderer/stores/__tests__/ai-store.test.ts
```

结果：

```text
Test Files  2 passed (2)
Tests       62 passed (62)
```

现有测试全部通过，说明**当前没有覆盖“多个连续 chunk 应合并为一条消息”的回归用例**；它们只覆盖了控制事件过滤、空事件、归属校验、持久化等。

环境：Node `v24.15.0`，Vitest `5.1.0`，Windows。

---

## 8. 建议补的回归测试

### 8.1 adapters 纯函数

文件：`src/renderer/features/ai/__tests__/adapters.test.ts`

| 用例 | 输入 | 期望 |
|---|---|---|
| 连续 chunk 合并 | `chunk('调整')` → `chunk('功能')` → `chunk('说明')`，同一 `runId` | 1 条消息，`text === '调整功能说明'` |
| 相同 messageId 合并 | 3 个 `chunk`，同一 `messageId` | 1 条消息，key/streamId 稳定 |
| 不同 messageId 分段 | `messageId: m1` → `m2` | 2 条消息，不拼接 |
| thinking 打断 | `chunk` → `thinking` → `chunk` | 2 条 text + 1 条 thinking，顺序不变 |
| tool_call 打断 | `chunk` → `tool_call` → `chunk` | 2 条 text + 1 条 tool，text 不跨工具合并 |
| run 边界 | `run_started` → 2 chunks → `done` → `run_started` → 2 chunks | 2 条消息，不跨轮拼接 |
| 空白 delta | `chunk('hello')` → `chunk(' ')` → `chunk('world')` | 1 条消息，`'hello world'`，空格不丢 |
| 空字符串 | `chunk('')` | 不新增消息 |
| full 模式 | `chunk` delta 后 `answer` full | 按 `mode` 替换，不重复 |
| 旧 answer 兼容 | 3 个 `answer`（legacy delta 语义） | 明确按约定合并或分段，测试锁死 |

### 8.2 store 集成

文件：`src/renderer/stores/__tests__/ai-store.test.ts`

| 用例 | 操作 | 期望 |
|---|---|---|
| handleEvent 合并 | `ensureActiveSession()` 后依次 `handleEvent(run_started / chunk × 3 / done)` | `messages[sid].length === 1`，text 为完整句子 |
| 非文本边界 | `chunk` → `tool_call` → `chunk` | `messages[sid]` 为 text/tool/text 三条 |
| 持久化 | 3 chunks 后 `serializeSessions` → `parseSessionsFile` | 仍是 1 条消息，text 不丢 |
| 旧历史迁移 | fixture 中 3 条相邻 `sourceType:'chunk'` | 恢复为 1 条 |
| 200 条上限 | 一轮 300 个 chunk | 合并后 1 条，不挤掉旧对话 |

### 8.3 ACP mapper / runtime

文件：`tests/verify-acp-mapper.js`、`tests/verify-acp-runtime.js`

| 用例 | 期望 |
|---|---|
| `text_delta` 带 `messageId` | 映射出的 `chunk` 保留 `messageId` |
| `text_delta` 不带 `messageId` | 不伪造 id，前端走 run 兜底 |
| `stream: 'thought'` | 映射为 `thinking`，保留 `messageId` |
| runtime 连续 3 个 `text_delta` | 发出的 3 个 `chunk` 共享 `runId`，带 `seq`/`messageId` |
| `run_started` / `done` | 带同一个 `runId` |

### 8.4 CLI/API service

文件：可新增 `tests/verify-ai-chunk-contract.js` 或并入现有 `verify-event-pipeline.js`

| 用例 | 期望 |
|---|---|
| `onChunk({ text: 'a' })` × 3 | 发出 3 个 `chunk`，同一 `runId`，`mode:'delta'`，`seq` 递增 |
| parser 提供 `id` / `stepIndex` | 不丢失（至少保留在 `chunk` 载荷中） |
| `onClose` | `done` 带同一 `runId`，前端可关流 |
| 空文本 | 不发 `chunk` |

### 8.5 UI 回归

文件：可新增 `src/renderer/components/ai-elements/__tests__/Chat.test.tsx` 或 e2e

| 用例 | 期望 |
|---|---|
| 注入 3 个 chunk 事件 | `[data-slot="ai-message-ai"]` 只有 1 个 |
| 3 个 chunk + tool_call + 3 个 chunk | 2 个 AI 气泡 + 1 个工具卡，顺序正确 |
| 流式追加时 | 最后一条气泡文本增长，自动滚动仍生效 |
| 刷新恢复 | 1 个气泡，不是 3 个 |

### 8.6 建议的 mock 事件序列

```json
[
  { "type": "run_started", "runId": "r1", "engine": "cli" },
  { "type": "chunk", "runId": "r1", "seq": 0, "mode": "delta", "text": "调整" },
  { "type": "chunk", "runId": "r1", "seq": 1, "mode": "delta", "text": "功能" },
  { "type": "chunk", "runId": "r1", "seq": 2, "mode": "delta", "text": "说明" },
  { "type": "done", "runId": "r1" }
]
```

期望：`messages` 长度 1，`text === '调整功能说明'`，`busy` 从 true 回到 false。

---

## 9. 修复优先级建议

| 优先级 | 改动 | 说明 |
|---|---|---|
| P0 | 在 `append-messages` / `reduceAiEventsToMessages` 增加相邻 delta 合并 | 先消除一词一气泡；同时处理 whitespace-only delta |
| P0 | `run_started` / `done` / `error` 关闭文本段 | 防止跨轮拼接；即使暂不加上游 id 也应先做 |
| P1 | ACP mapper 透传 `messageId`；ACP runtime 透传 `requestId` | 让合并有协议级依据，兼容不同 Agent 粒度 |
| P1 | CLI/API service 增加 `runId` / `seq` / `mode` | 覆盖无 `messageId` 的 Agent |
| P1 | 持久化保留 `streamId`/`streaming`，恢复时置 false | 避免刷新后状态错乱 |
| P2 | 旧历史 coalesce | 修复已落盘的一词一气泡 |
| P2 | `Chat` 滚动依赖改为最后一条文本长度 | 合并后流式自动滚动不回退 |
| P2 | 补 §8 回归测试 | 防止后续再退化 |

---

## 10. 附：关键证据索引

| 文件:行 | 事实 |
|---|---|
| `src/renderer/features/ai/adapters.ts:33-62` | `AiMessage` 无 `messageId` / `streamId` / `streaming` / `mode` |
| `src/renderer/features/ai/adapters.ts:641-673` | 每个 `chunk` / `answer` 都 `mk()` 新消息 |
| `src/renderer/features/ai/adapters.ts:672` | 空白 delta 被 `trim()` 丢弃 |
| `src/renderer/features/ai/adapters.ts:724-734` | `reduceAiEventsToMessages` 只 `concat` |
| `src/renderer/features/ai/adapters.ts:393-433` | P0-2 白名单；`chunk`/`answer` 明确允许 |
| `src/renderer/features/ai/adapters.ts:851-852` | 历史最多 200 条消息，词消息会挤掉旧对话 |
| `src/renderer/features/ai/adapters.ts:1022-1055` | 历史恢复逐条重建，未合并 chunk |
| `src/renderer/stores/ai-store.ts:230-235` | `append-messages` 只数组拼接 |
| `src/renderer/stores/ai-store.ts:454-508` | `handleEvent` 对 chunk 直接转消息；run_started/done 只切 busy |
| `src/renderer/components/ai-elements/Chat.tsx:39-43` | message 数组逐条 map 渲染 |
| `src/renderer/components/ai-elements/Message.tsx:67-70` | 每条 text 消息一个独立气泡 |
| `js/project-ai-export.js:5099-5114` | 旧版 `i5AnswerAppendChunk` 累计文本并复用同一个气泡元素 |
| `js/project-ai-export.js:7261-7268` | 旧版 live `chunk` 走累计缓冲区，不逐片新建气泡 |
| `main/acp/acp-event-mapper.js:30-38` | `text_delta` → `chunk`，丢弃 `messageId` |
| `main/acp/acp-runtime.js:1309-1318` | 每个 ACP 事件立即 emit，不聚合 |
| `main/acp/acp-runtime.js:1464` | 已有 `requestId`，但未写入 chunk/run 事件 |
| `main/services/ai-process-service.js:1996-2003` | `onChunk` 只发 `{type:'chunk', text}`，丢弃 parser 其它字段 |
| `main/services/ai-process-service.js:1992` | `run_started` 无 `runId` |
| `main/services/ai-process-service.js:2118-2123` | `done` 无 `runId` |
| `node_modules/acpx/dist/runtime.d.ts:220-233` | acpx `text_delta` 可选携带 `messageId` |
| `node_modules/@agentclientprotocol/sdk/schema/schema.json:4458-4468` | 同一 `messageId` 的 chunk 属于同一条消息 |

---

## 11. 最终判断

这不是“codebuddy 特例”，也不是“P0-2 白名单误杀 chunk”，而是 **消息模型层面把流式 delta 当成独立消息**：

- 上游：`chunk.text` 是增量，且 `messageId` 被丢弃；
- 中游：`aiEventToMessages` 1 个事件 → 1 条 `AiMessage`，store 只 append；
- 下游：`Chat` 按消息数组逐条渲染。

修复应优先在 **store/adapters 的状态归约层** 增加“同一 `streamId` 的相邻 delta 合并”，并用 `run_started/done` 关闭段；同时补齐 `runId` / `messageId` / `seq` / `mode` 契约，才能同时兼容 codebuddy、其他 ACP Agent、CLI/API Agent，并避免重复、丢字和旧历史继续恶化。
