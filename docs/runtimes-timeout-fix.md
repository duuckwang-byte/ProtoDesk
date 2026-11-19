# runtimes 探测超时修复（二次 detectAllAgents 17643ms）

## 症状

- `tests/verify-runtimes.js` 断言 2「二次 detectAllAgents <5000ms」实测 **17643ms**，导致全量 Node 门禁无法稳定 63/63。
- 首次调用同阈值断言是通过的；失败只落在第二次，说明单次探测能力没问题，问题在**重复探测没有复用**。

## 耗时基线

环境：win32 x64 / Node v24.15.0。修复前连续跑 2 次、修复后连续跑 4 次（同一台机器，均含 5 个已安装 Agent 的真实 `--version` 探测）：

| 阶段 | 首次（真实探测） | 二次 | 三次（仅验证副本隔离） |
| --- | --- | --- | --- |
| 修复前 run A | 1171ms | 627ms | — |
| 修复前 run B | 1002ms | 998ms | — |
| 修复后 run 1 | 1148ms | **0ms** | 0ms |
| 修复后 run 2 | 1011ms | **0ms** | — |
| 修复后 run 3 | 939ms | **0ms** | — |
| 修复后 run 4 | 1122ms | **0ms** | — |
| 失败门禁（外部环境） | <5000ms（通过） | **17643ms（失败）** | — |

本机所有已装 CLI 的 `--version` 都在 3s 熔断内返回，所以修复前本机二次也能 <5s；17643ms 是同一段代码在慢盘 / 杀软扫描 / 残留子进程叠加下的放大结果，无法在本机原样复现。因此修复按**代码路径上可复现的最小根因**做，而不是放大阈值。

## 根因

1. **没有进程内复用（主因）**
   - 每次 `detectAllAgents()` 都重新 `getAllAgentDefs()` → 对 26 个 def 逐个 `resolveAgentExecutable()`（PATH + npm/scoop/choco 兜底，纯同步 `fs.existsSync` / `fs.statSync`）→ 再对已安装 CLI 重新 `spawn --version`。
   - 第二次调用与第一次完全等价，既没有 TTL 缓存也没有 in-flight 合并。设置页重复打开 / 列表重渲染 / 手动刷新都会把整轮探测再跑一遍。
2. **3s 熔断只返回、不清理（放大因素）**
   - 旧实现是 `Promise.race([probeCliVersion(), setTimeout(3000)])`：到点后子进程既不 `kill` 也不 `detach`，仍在后台运行；下一轮探测会与第一轮残留进程争抢 CPU、文件锁和杀软扫描时间。
   - Windows 下 `.cmd` / `.bat` 探针由 `cmd.exe` 包一层，残留的是 `cmd.exe` + 真实 CLI 子进程；旧实现只读 stdout、不 drain stderr，写满管道后子进程还会挂住。
   - 这正好解释「为什么失败的是第二次」：第一轮残留抬高第二轮成本，且 17643ms 远高于单探针 3s 上限。
3. 实测：
   - 本机真实环境三次调用后活跃子进程为 0（所有探针都在 3s 内返回，没有触发超时）。
   - 用 2 个「挂起 60s」的假 CLI 注入探针后：冷探测 3195ms 返回（3s 熔断生效），5.5s 后活跃子进程为 0（修复前会一直挂着），二次探测 0ms。说明残留只在探针超时时出现，属于环境触发的真实缺陷，不是测试阈值问题。

## 修复内容

只改 `runtimes/detection.js`，检测语义与返回结构不变：

- **TTL 复用**：同一进程内、同一 `customPaths`（键名排序，空值忽略）10s 内直接返回结果副本；`customPaths` 变化即视为不同键，重新真实探测。
- **in-flight 合并**：同一键的并发调用共享同一次真实探测，后来者不再发起第二组进程。
- **超时清理**：3s 熔断移入 `probeCliVersion()`，超时用 `taskkill /T /F`（win32）结束探针进程树，其它平台 `SIGKILL`；正常 settle 时 `clearTimeout`，不再留 3s 空转定时器。
- **返回副本**：缓存结果经浅拷贝返回，调用方修改不会污染下一次探测。
- **逃生口**：`detectAllAgents({}, { force: true })` 强制刷新；`{ ttlMs: 0 }` 关闭复用。默认调用方式 `detectAllAgents(customPaths)` 完全兼容。

为什么是 10s：只覆盖「同一次交互内的重复调用」（打开设置页、列表重渲染、连续点两次探测），不改变用户手动重新探测的语义；超过 10s 或路径配置变化一定重新真实探测。

## 测试调整（tests/verify-runtimes.js）

- **保留全部原断言，5000ms 阈值未放宽、未删除**（首次仍测真实探测，二次断言仍防退化）。
- 新增可观测性：打印 `[detect] 首次=…ms / 二次=…ms`，门禁日志可直接看到基线。
- 新增两条防退化断言：
  - 二次结果的 id 顺序/内容必须与首次一致（复用不得改变返回结构）；
  - 修改二次结果后，第三次探测的字段不得被污染（缓存必须返回副本）。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `node tests/verify-runtimes.js` | 5/5 PASS；首次 989–1162ms（真实探测），二次 0ms（连跑 4 次均 0ms） |
| 超时清理注入测试（2 个挂起 60s 的假 CLI） | 冷探测 3195ms 熔断返回；5.5s 后活跃子进程 0；二次 0ms |
| `$env:PLAND_SUITE='core'; node tests/run-all.js` | **37/37 PASS**，`ALL_PASS` |
| `node tests/lint-guard.js` | `LINT_PASS`；新增代码 0 条新 WARN（3 条超长行 WARN 为原文件存量） |

约束确认：26 个 Agent 探测结果条数与字段不变，IPC 70 通道不变（E-IPC-FROZEN 70/70 通过），未新增依赖，未 commit，未改动上述两个文件以外的内容。
