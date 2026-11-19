# 思考强度缓存（主进程后台 + 启动预热）

## 1. 背景

思考强度（`thought_level` 等）来自 ACP `previewModelConfig`：要拉起 Agent 子进程、`initialize` + `session/new`、
`setConfigOption(model)` + `getStatus`，冷启动数百 ms 到数秒。改造前这条链路是**同步等待**：

- 打开设置面板并选中模型 → 等 ACP；
- 保存模型 / 可见模型 → 面板重新拉目录时再次等 ACP；
- 应用启动后首次打开对话 → 再等一次。

本轮把「读思考档位」拆成 **缓存优先 + 后台探测**：UI 只读缓存，探测在后台队列跑，完成后回写。
不新增 IPC 通道（仍是 `ai:models`），不改 70 通道契约，不改 ACP 协议。

## 2. 缓存位置与结构

| 项 | 值 |
| --- | --- |
| 文件 | `userData/ai-thinking-cache.json`（开发态即 `.devdata/ai-thinking-cache.json`，随 `PLAND_DEV_DATA_DIR` 隔离） |
| key | `<agentId>|<model>`（换 Agent / 换模型天然隔离，不串档） |
| 版本 | `version: 1`，不匹配整份作废（旧结构不猜） |
| 上限 | 64 条、保留 7 天（`prune` 按 `ts` 清过期 + 超限保留最新） |
| 写 | 同目录临时文件 + `rename` 原子替换，失败不破坏旧文件，不残留 `.tmp` |

```json
{
  "version": 1,
  "entries": {
    "opencode|opencode-go/deepseek-v4.1-flash": {
      "agentId": "opencode",
      "model": "opencode-go/deepseek-v4.1-flash",
      "configOptions": [{ "id": "thought_level", "currentValue": "high", "options": [] }],
      "modelConfigId": "model_config",
      "status": "ready",
      "ts": 1763000000000
    }
  }
}
```

`status` 三态：

- `ready`：探测成功，带 `configOptions` / `modelConfigId`，**算命中**；
- `unsupported`：模型不支持该配置项（`ACP_MODEL_UNSUPPORTED`），**算命中**（不再反复探）；
- `error`：其它失败（`busy` / `ACP_PROBE_FAILED` / `ACP_DISABLED` …），带 `error` 摘要，**不算命中**（下次仍重探）。

实现：`main/services/ai-thinking-cache.js`，导出 `createThinkingCache`（可注入 `filePath` / `maxEntries` / `maxAgeMs` / `now`）
以及默认单例的 `load` / `get` / `set` / `prune`。

## 3. 命中 / 后台时序

入口仍是 `aiModelsImpl(ev, { probeModel, agentId, background?, force? })`，命中判定在 `probeAcpModelConfig` 最前面：

| 情况 | 行为 | 耗时 |
| --- | --- | --- |
| 命中 `ready` 且 `force !== true` | 直接回 `{ ok:true, cached:true, status, configOptions, modelConfigId }`，**不解析启动命令、不拉起 ACP** | 同步（< 1ms） |
| 命中 `unsupported` 且 `force !== true` | 直接回 `{ ok:false, cached:true, error:'ACP_MODEL_UNSUPPORTED' }`（与真实探测同一出入参，UI 仍是「不支持」） | 同步 |
| `background === true` 且未命中 | 立即回 `{ ok:true, probe:true, status:'probing', configOptions:[], scheduled:true }`，真实探测丢后台队列 | 同步 |
| 未命中且非 background | 保持原有等待探测语义（失败原因原样返回），成功后回写缓存 | 同改造前 |
| `force === true` | 跳过缓存读取，强制真探测并覆盖缓存 | 同改造前 |

后台队列：

- `setImmediate` 起跑，不占当前 tick；
- 同 key（`agentId|model`）**单飞去重**：重复调用只复用同一个任务；
- 任务内部再次进入 `probeAcpModelConfig`（`__run:true`），成功/失败都回写缓存；
- 失败不抛给调用方、不弹窗，`PLAND_AI_TRACE=1` 时打一行 `[ai-thinking-cache] ...` 诊断。

## 4. 启动预热

`main/controllers/ai-controller.js` 在 `registerAIController()` 末尾调用 `scheduleThinkingCacheWarm()`：

```
app.whenReady() → setImmediate → aiProcess.warmThinkingCache()
```

`thinkingWarmCache()`（`ai-process-service`）：

1. 只跑一次：并发/重复调用复用同一个 promise；
2. 读 `cfg.agentId || cfg.mainAgent` 与当前模型（`cfg.model` → `visibleModelsCli[agentId][0]` → `visibleModels[0]`）；
3. Agent 未找到 / ACP 未启用 / 模型为空 → 直接跳过（不探测、不写缓存）；
4. 缓存已命中 → 直接返回（不重复探测）；
5. 否则排后台任务，完成后写缓存。

失败只 trace（每进程至多一行 `console.warn`），不弹窗、不阻塞启动、不影响窗口创建。

## 5. 保存触发

`src/renderer/stores/settings-store.ts` 的 `save()` 在 `ai.saveConfig` 成功且刷新模型目录之后：

```ts
warmThinkingCache(saved, models.engine, agentId, models.visibleModels, models.defaultModel);
```

- `config` / `visibleModels` / `engine` 任一变化都走这个分支，因此都会刷一次预热；
- **fire-and-forget**：`void Promise.resolve(ai.listModels(hint)).catch(() => {})`，不 `await`，保存立即返回；
- `hint = { engine:'cli', probeModel, agentId, background:true }`，复用既有 `ai:models` 通道；
- 只走 CLI（ACP 只服务 CLI），`engine === 'api'` 时不预热；
- 当前模型取值顺序 `pickProbeModel`：`config.model` → 可见模型首个 → 目录默认值，与主进程预热同序。

后台探测卡住（ACP 有多慢都不管）也不影响 `save()` 的返回——见 `settings-store.test.ts` 的 "后台探测卡住也不阻塞保存返回"。

## 6. 渲染层（ai-store）行为

`ai-store.probeThinking` **不变**：仍是 `agentId|uiSessionId|modelId` 三级 key、requestId 校验、busy 延后补探。
变化只在于主进程会秒回缓存，因此：

- 首次探测（命中缓存）→ 立即可用，不再等 ACP；
- 同一 Agent/会话/模型再次触发 → 渲染层自身缓存直接复用，**不再打 IPC**；
- `ready` / `unsupported` 不会被重复探测；`error`（非瞬时）只有在 `force` 或作用域变化时才重试。

## 7. 敏感信息

缓存文件**不含 token / 凭据**：

- 只写 `agentId` / `model` / `configOptions` / `modelConfigId` / `status` / `ts` / `error`；
- 写入前对 `configOptions` 递归清洗：命中 `api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|credential|authorization`
  的键直接丢弃，并限制深度（4）、字符串长度（400）、条目数（40）；
- 读取时同样清洗，手改文件塞进来的敏感键也不会回到 UI。

## 8. 容错

| 场景 | 行为 |
| --- | --- |
| 文件不存在 / 空 | 空结构，视为未命中 |
| 坏 JSON / 版本不符 / `entries` 非对象 | 整份作废，返回空结构，不抛错 |
| 单条记录非法（缺 `agentId`/`model`） | 跳过该条，其它条目照常 |
| key 与 `agentId|model` 不一致 | 丢弃该条（防手改文件串档） |
| 写入失败（目录不可写 / rename 失败） | 返回 `null`，旧文件保持完整，业务不感知 |
| 探测失败 | 写 `status:'error'` 留痕但不命中，下次重探 |

## 9. 测试与验证

| 命令 | 覆盖 |
| --- | --- |
| `node tests/verify-ai-thinking-cache.js` | 缓存读写/原子写/损坏容错/敏感键/prune、命中不调 ACP、background 立即返回 + 后台回写 + 单飞、启动预热只一次、key 隔离、静态接线 |
| `npx vitest run src/renderer/stores/__tests__/settings-store.test.ts` | 保存后 `background:true` 预热、不阻塞保存、api 引擎不预热、当前模型取值 |
| `npx vitest run src/renderer/stores/__tests__/ai-store.test.ts` | `cached:true` 直接 ready、同作用域不重复探测 |
| `node tests/verify-ipc.js` / `node tests/lint-guard.js` | 70 通道冻结不变、风格门禁 |
| `node tests/verify-acp-model-probe.js` | probe 分支既有语义未回退（可重复运行） |

测试隔离：`__setAcpModelsTestHooks({ thinkingCache })` 可注入独立缓存实例；
`thinkingCache: false` 或**注入任何 `ai:models` 探测钩子**时默认不读写真实用户缓存，
避免用例命中上一次运行留下的 `ai-thinking-cache.json`（`verify-acp-model-probe.js` 可反复跑）。
`__resetThinkingWarmForTest()` 用于重置「启动预热只跑一次」标记。

## 10. 取舍

- **命中不看新鲜度**：只要 `status` 是 `ready`/`unsupported` 就秒回，避免 UI 抖动；陈旧档位由「7 天 prune + 保存即重探 + `force`」兜底。
- **失败也落盘**：`error` 记录只用于留痕与诊断，不参与命中，所以不会掩盖可恢复的瞬时故障。
- **ACP 关闭时靠保存/预热重探**：命中路径不查 ACP 开关（保证秒回），但保存触发的后台探测会写 `error` 记录，
  使下一次探测重新走真实判定，状态不会长期停在旧值。
