# ACP / CLI 探测子进程孤儿修复

日期：2026-11-13
范围：`main/services/ai-process-service.js`、`main/acp/acp-runtime.js`、`main/acp/acp-process-lifecycle.js`、`main.js`

## 1. 问题现象

e2e 收尾诊断：

- `execCliListModels` 超时只执行 `child.kill()`，只结束 `cmd.exe`；
- `cmd.exe /c codebuddy.cmd --acp` 派生的 `node codebuddy --acp` 与 `conhost.exe` 继续存活；
- 残留进程继承 Electron 的 fd3/fd4，Playwright 收尾等待 `close` 事件 30s；
- ACP runtime 在应用退出时没有统一 `shutdown()`，会话进程也可能残留。

## 2. 统一看护模型

新增 `main/acp/acp-process-lifecycle.js`，只登记本进程拉起或 acpx 明确回调的 PID：

| 来源 | 登记方式 | 元数据 | 注销时机 |
|---|---|---|---|
| `execCliListModels`（CLI 原生模型探测） | `registerChild(child)` | kind=`cli-list-models`、命令、启动时间 | `close` / `error` / 强杀完成后 |
| acpx ACP agent / probe / terminal | `processLifecycle.onSpawned(proc)` → `trackPid(pid)` | kind=`acp`、`proc.command`、scope、startedAt | `onExit` / shutdown 强杀完成后 |
| 本地临时假 CLI（测试） | 同上 | 带唯一 marker | 测试断言后清理 |

安全边界：

- 不按镜像名清杀；常规清理只处理登记表内的 PID，退出兜底扫描也只结束“当前进程后代 + ACP 命令签名”命中的进程树；
- 外部 PID 必须带 `command` 才登记，测试/异常路径的伪 PID 不会进入清理集合；
- 本地子进程退出后立即从登记表移除，避免 PID 复用窗口；
- 未登记进程不参与 `shutdownAll` / `killAllSync`。

### 2.1 `inspectAgentModels` 的特殊兜底

acpx 的 `inspectAgentModels` 内部自建 `AcpClient`，不暴露 `processLifecycle`，拿不到 agent PID。
处理方式：

1. 启动前记录 `agentCommand` 的命令签名（完整路径、去扩展名 basename、`--acp`）；
2. 退出时先 `AbortSignal.abort()`，等待 acpx 的 `finally → client.close()` 收尾（Windows 400ms，其它平台 1200ms）；
3. 再做一次“当前 Electron 后代树 + 命令签名”扫描，命中 `--acp` / Agent 命令的进程按树 `taskkill /T /F`；
4. 扫描只限当前进程后代，跳过 `electron.exe`、`--type=renderer/gpu/utility`、`powershell/pwsh/taskkill` 与 `conhost` 根匹配（conhost 只随命中根进程的后代展开清理）。

这样既覆盖 acpx 不暴露 PID 的探测，也不会按 `conhost.exe` 镜像名误杀其它应用的 console host。

## 3. 清理触发点

| 触发点 | 行为 |
|---|---|
| `execCliListModels` 超时 | `killPidTree` → Windows `taskkill /pid <pid> /T /F`，并 `destroy()` stdout/stderr |
| `execCliListModels` 收到 AbortSignal | 同上 |
| spawn `error` | 同上（无 PID 时安全 no-op） |
| 正常 `close` | 只注销 + 销毁 stdio，不杀进程 |
| `ai:cancel` | 先清理 `kind=cli-list-models` 的探测树，再走 ACP `turn.cancel` / 2s 兜底 |
| ACP `cancel` | `turn.cancel` 后 2s 未结束 → `killPidTree`（登记项走统一清理，未登记 PID 回落平台 kill） |
| ACP `shutdown()` | `cancel(grace=0)` → runtime.shutdown（限时）→ 强杀仍登记的 `kind=acp` 进程树 |
| ACP 目录后台刷新退出 | `abortAcpCatalogRefreshes` + 等待 acpx `finally` 关闭 client（Windows 400ms，其它平台 1200ms） |
| `inspectAgentModels` 遗留兜底 | 按“当前进程后代树 + `--acp`/Agent 命令签名”扫描，`taskkill /T /F`；跳过 Electron 自身子进程与扫描 shell |
| `window-all-closed` | `shutdownAiProcessesSync({sweep:false})`：中止刷新、同步 `taskkill /T /F` 全部登记树 |
| `before-quit` | `Promise.allSettled([cleanupGitChildren(), shutdownAiProcesses()])`，5s 兜底后退出 |
| `will-quit` | 再同步清理一次登记树 |
| `process.on('exit')` | Git + AI 登记树同步兜底（`spawnSync taskkill`） |

## 4. 约束保持

- 未新增 IPC 通道，`main/ipc-contract.js` 70 通道不变；
- 未改 `ai:ask` 入参、流式事件、模型返回结构；
- 未新增 npm 依赖；
- 未改 `src/renderer`；
- 用户手动打开的终端（`ai:open-terminal`）不登记、不随应用退出强杀，保持原有独立终端语义。

## 5. 验证

```powershell
node --check main/services/ai-process-service.js
node --check main/acp/acp-runtime.js
node --check main/acp/acp-process-lifecycle.js
node --check main.js
node tests/verify-acp-process-cleanup.js
node tests/verify-ipc.js
node tests/verify-acp-runtime.js
node tests/lint-guard.js
npx playwright test e2e/electron-live.spec.ts
```

`tests/verify-acp-process-cleanup.js` 使用临时 `.cmd` 启动常驻 `node` 子进程，不联网、不调用真实 codebuddy：

1. 正常探测完成后登记表归零、无残留；
2. 超时后 `cmd.exe -> node` 整树在 6s 内消失；
3. ACP runtime `shutdown()` 即使 runtime 自身卡死，也会在超时后强杀登记树；
4. `AbortSignal` 取消时同样按进程树收尾；
5. 退出后代树兜底扫描能命中 `--acp` 进程（覆盖 inspectAgentModels）；
6. `shutdownAll` / `killAllSync` 不误杀未登记进程。

真机收尾检查（只读）：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match 'codebuddy' -or $_.Name -eq 'conhost.exe' } |
  Select-Object ProcessId,ParentProcessId,Name,CommandLine
```

验收口径：e2e 结束后 `codebuddy` 数量为 0，且无新增 `cmd.exe` / `conhost.exe` 来自 Electron 进程树。
