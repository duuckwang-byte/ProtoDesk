# Wave4 冒烟前环境清点

> 采集时间：2026-11-13 12:21:06 – 12:29（本机，只读）
> 采集人：环境清点子代理（只读；未杀进程、未改代码/数据、未 install、未 commit）
> 唯一写入：本文件

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| Phase0 说的"5 个 Electron 进程"是什么 | **不是**用户桌面端，是**一次开发态 Electron 实例**（1 个实例固定展开为 5 个进程：main + 2×renderer + gpu + network），由外部 Playwright 运行器拉起，`--user-data-dir=<repo>\.devdata` |
| 用户是否正在使用应用 | **是**。`原型工具.exe` ×5 于 11:49:31 由 `explorer.exe` 双击启动，窗口**可见且最大化**（`IsWindowVisible=True`、`IsIconic=False`、`IsZoomed=True`） |
| 用户应用会不会污染 `.devdata` | **不会**。它是**打包态**（`桌面端\win-unpacked\resources\app.asar`），`main.js:16` 的 `.devdata` 重定向只在 `!app.isPackaged` 时生效；其实例命令行显式带 `--user-data-dir=C:\Users\allow\AppData\Roaming\原型工具` |
| 当前是否有 Electron 在跑 | **12:28:25 时为 0**；但 12:16 / 12:21:47 / 12:22:50 / 12:27:29 / 12:27:44 反复成组出现，单次存活约 3–15 秒 |
| 是否需要杀进程才能冒烟 | **不需要杀用户应用**。要消除 `.devdata` 争用，只能让**外部并发测试运行器**停下来；杀 `原型工具.exe` 对 `.devdata` 没有任何帮助，且会打断用户 |
| `.devdata-wave4-*` 残留 | **无**（仓库根仅有 `.devdata`） |
| 9222 等调试端口 | **无占用**（9222–9333 全部空闲） |

**一句话**：真正在写 `.devdata` 的是"别人正在跑的 Playwright 测试"，不是用户的桌面端；用户桌面端只是一个独立的、只写 `%APPDATA%\原型工具` 的旁观者。建议清理清单为**空**（针对 `.devdata` 争用），需要协调的是**并发测试运行器**，不是 PID。

## 1. 采集方法与局限

- `Get-CimInstance Win32_Process`（Name / ProcessId / ParentProcessId / CreationDate / ExecutablePath / CommandLine）。
- 进程归属证据链：`ExecutablePath` + 命令行里的 `--user-data-dir` / `--app-path` / `--type` + 父进程。
- **工作目录（CWD）取不到**：`Win32_Process` 不暴露 CWD，且未使用需要管理员/句柄注入的工具（本任务禁改环境）。因此 CWD 一律以**可验证的替代证据**推断并标注为"推断"。
- 进程是**瞬时**的：electron 组存活 3–15 秒，快照必须按时间点读，不能当稳态。
- 未做：句柄级 LOCK 占用检测（需 `handle.exe`/`openfiles`，涉及额外工具，未安装）。

## 2. 进程快照

### 2.1 与 PlanD 直接相关：用户桌面端（5 个进程，1 个应用实例）

| PID | PPID | 进程名 | 启动时间 | 关键命令行 | 内存 |
|---|---|---|---|---|---|
| 48388 | 5552 (`explorer.exe`) | 原型工具.exe | 11:49:31 | `"D:\文件\工具\原型工具-PlanD\桌面端\win-unpacked\原型工具.exe"`（主进程，无 `--type`） | 129 MB |
| 46524 | 48388 | 原型工具.exe | 11:49:32 | `--type=gpu-process --user-data-dir="C:\Users\allow\AppData\Roaming\原型工具"` | 151 MB |
| 50256 | 48388 | 原型工具.exe | 11:49:32 | `--type=utility --utility-sub-type=network.mojom.NetworkService` | 83 MB |
| 50860 | 48388 | 原型工具.exe | 11:49:32 | `--type=renderer --app-path="...\win-unpacked\resources\app.asar"`（renderer-client-id=4） | 97 MB |
| 37584 | 48388 | 原型工具.exe | 11:49:37 | `--type=renderer`（renderer-client-id=5，第二个窗口） | 87 MB |

- 主窗口：`MainWindowHandle=8718416`，`MainWindowTitle=原型工具`，`Responding=True`，**最大化且可见**。
- 构建产物：`桌面端\win-unpacked\resources\app.asar` mtime `2026-11-13 10:11:58`；`桌面端\原型工具 Setup 1.2.0.exe` 10:12:12 → 用户很可能在**手动验收今天 10:12 打出的 1.2.0 包**。
- 写入位置：`C:\Users\allow\AppData\Roaming\原型工具\`，最近写入 11:51:32（`SharedStorage-wal`）。

### 2.2 与 PlanD 相关：开发态 Electron（突发，非稳态）

采样到的每一次突发都是同一形态：`cmd.exe /d /s /c "…\node_modules\electron\dist\electron.exe" "-r" "…\node_modules\playwright-core\lib\server\electron\loader.js" "--inspect=0" "--remote-debugging-port=0" "."`，随后展开 4 个子进程。

| 观测时刻 | 主 PID（已退出） | 直接父进程 | 子进程采样到的 `--user-data-dir` | 归属 |
|---|---|---|---|---|
| 12:16（Phase0 记录） | 未留存 | 未留存 | 未留存（Phase0 仅记"5 个"） | 开发测试 |
| 12:21:47 | 未捕获（<1 s） | 未捕获 | `.devdata`（由 `DevToolsActivePort`/`Session Storage` 写入推断） | 开发测试 |
| 12:22:50 | 49216 / 52584（双主进程记录，其中一个为壳） | 已退出 | **`D:\文件\工具\原型工具-PlanD\.devdata`**（renderer 命令行实测） | 开发测试 |
| 12:27:29 | 37288 | 40576 `cmd.exe`（已退出） | 未及采样 | 开发测试 |
| 12:27:44 | 18500 | 30452 `cmd.exe`（已退出） | 未及采样 | 开发测试 |

- 两次突发的父 `cmd.exe` PID **不同**（40576 / 30452）→ 不是同一个长驻进程在重启子进程，而是**多次独立的 Playwright 调用**（每次一个新 worker）。
- 12:28:25 复测：`electron.exe` 数量 = **0**。

### 2.3 与 PlanD 相关：测试残留（vitest 侧，非 Electron）

12:23:55–12:24:44 观测到一波 `pland-cleanup-*` 临时目录 + `fake-acp-cli.cmd` + `node -e "setInterval(...)"` + 11 次 `taskkill.exe`，父进程 `49860`（已退出，vitest worker）。对应 `tests/verify-acp-process-cleanup.js`。**全部已自行退出，无残留。**

### 2.4 无关但极易误判（不要动）

| 组 | 数量 | 证据 | 说明 |
|---|---|---|---|
| `codebuddy --acp`（node） | 12:21 时约 40 个 → 12:28:25 为 **0** | `"node" "D:\AppFile\codebuudy\node_modules\@tencent-ai\codebuddy-code\bin\codebuddy" "--acp"`，父 PID 指向早已退出的 shell（PID 被 conhost 复用） | Agent 框架的 ACP 后端，**随会话生灭**，不是 PlanD 的 ACP 会话；注意安装路径拼写是 `codebuudy`（双 u），用 `codebuddy` 过滤会漏 |
| `chrome-devtools-mcp` / `mysql_mcp_server` / `rea mcp` | 各 **7 套**（共约 21 + 7 + 14 个 node/cmd） | 父进程均为 `18836`（OpenCode 服务端），最早 08:45、最晚 12:06 | 历次会话遗留的 MCP 服务，跨 7 个"代"，属框架侧，与本任务无关 |
| `OpenCode.exe` ×6、`DeepSeek Harness.exe` ×6、`ego.exe` ×15、`Antigravity.exe` ×3 | — | 各自 `--user-data-dir` 独立 | 其它工具链 |
| `HBuilderX` / `chrome.exe --remote-debugging-port=9777` / `node` 监听 9092 | — | `D:\AppFile\HBuilderX\...`、`--user-data-dir=...\Temp\HBuilder X\Debug\HX-chrome-userdatadir` | **9777 是 HBuilderX 的调试端口**，不是 PlanD 的；别把它当成 9222 冲突 |

## 3. 归属判断（逐条证据）

### 3.1 `原型工具.exe` ×5 = 用户桌面端，保留

- 路径在 `桌面端\win-unpacked`，`resources\app.asar` 存在 → **打包态**。
- `main.js:16` 的 `if (!app.isPackaged) { app.setPath('userData', '.devdata') }` 在打包态被跳过；命令行实际 `--user-data-dir=C:\Users\allow\AppData\Roaming\原型工具` 与之吻合。
- 父进程是 `explorer.exe`（双击启动），不是 `cmd` / `node` / Playwright。
- 有可见最大化主窗口；11:49 启动后 11:51 仍在写 `%APPDATA%`，之后静止 → 用户开着但未操作。
- **反向验证**：`.devdata\ai-config.json`（12,474 B，11:09:22）与 `%APPDATA%\原型工具\ai-config.json`（65,012 B，11/12 15:57:20）是两份不同数据 → 两套 userData 确实互不相干。

### 3.2 开发态 `electron.exe` = 测试，非用户

- 可执行文件在 `node_modules\electron\dist`，`--app-path="D:\文件\工具\原型工具-PlanD"`（未打包目录）→ 走 `.devdata` 分支。
- 启动参数 `--remote-debugging-port=0`、`--allow-pre-commit-input`、`--disable-breakpad`、`--force-color-profile=srgb`、`-r playwright-core\lib\server\electron\loader.js` 是 **Playwright `_electron.launch()` 的指纹**，人手双击不会带这些。
- 生命周期秒级、成组出现、父进程随即消失 → 自动化用例，不是开发者在手动调试。

### 3.3 关于 Phase0 的"5 个 Electron 进程"

- `e2e/wave4/seed.mjs:189` 的 `detectElectronProcesses()` 用 `tasklist /FI "IMAGENAME eq electron.exe"`，**只匹配 `electron.exe`**，不会命中 `原型工具.exe`。
- 所以 12:16 触发 `ENV-BLOCKED` 的 5 个进程是**真·开发态 Electron**（一次 Playwright 实例），Phase0 的判断**成立**，但它拦下的是"并发的测试运行"，不是用户应用。
- 反过来说：**用户桌面端从来不是 seed 重建的阻塞原因**，杀掉它也不会让 seed 重建变干净。

### 3.4 ACP 判断

- 12:21 的约 40 个 `codebuddy --acp` 在 12:28 全部消失，且其父 PID 指向不存在的 shell（Windows 保留父 PID 数值，PID 被 `conhost.exe` 复用，形成"父进程是 conhost"的假象）→ **典型孤儿形态，但会自行回收**，当前 0 个。
- 判定：属于 Agent 框架的会话后端；**不建议手工清理**——无法区分"正在服务某个会话"与"孤儿"，误杀会中断正在跑的会话（包括本次清点所在的会话）。

## 4. `.devdata` 状态

| 项 | 值 |
|---|---|
| 目录 mtime | `2026-11-13 12:23:04`（深层层级最新写入 **12:27:46**） |
| 最近写入文件 | `Session Storage\LOG`、`Preferences`、`Local Storage\leveldb\000006.log`、`GPUCache\*`（12:27:46，对应 12:27:44 那次 Playwright 突发） |
| `DevToolsActivePort` | 内容 `53268` + `/devtools/browser/20bfae…`；**53268 当前无监听** → 陈旧文件，不代表有实例在跑 |
| LOCK 文件 | 仅 2 个：`Local Storage\leveldb\LOCK`（0 B，11/12 21:20:24）、`Session Storage\LOCK`（0 B，9/8 13:35:23） |
| LOCK 性质 | **LevelDB 内部占位文件，不是进程互斥锁**；Electron/Chromium 在 Windows 上用**命名互斥体**做单实例，不落 `SingletonLock` 文件。因此"有 LOCK 文件"≠"有实例在跑"，也不能据此判断可不可以复制 |
| `Singleton*` | 无（符合 Windows 行为） |
| 关键数据文件 | `ai-config.json` 11:09:22 / `ai-credentials.json` 11:09:22 / `projects-normalized-v1` 12:05:03 / `sandbox\.git\config` 12:11:43 / `snapshots` 11:56:29 / `acp\sessions\*` 最新 11:10:14 |
| 项目目录 | `.devdata\sandbox\` 下：`测试1`、`.context`、`.heal-backup`、`.git`；无新增测试域目录 |

判定：**Chromium 状态层（Local Storage / Session Storage / Preferences / GPUCache）在被并发测试反复改写；业务数据层（ai-config / sandbox / snapshots / acp）自 12:11 后未再变动。** 这与 Phase0 记录的"源指纹漂移集中在 Chromium 状态"一致。

## 5. `.devdata-wave4-*` 残留

```
Get-ChildItem -Force -Directory . | ? Name -like '.devdata*'
→ 仅 .devdata
```

- **仓库根无任何 `.devdata-wave4-*`**（`phase0` 已在自检后删除）。
- `%TEMP%\pland-wave4\` 存在（12:18:55）：`seed\`、`harness-build\`、`failures\phase0\`、`final-dryrun.json`、`harness-selfcheck.cjs` → 这是 Phase0 的 **seed 模板**，属预期产物，不是仓库残留。
- `%TEMP%` 下另有大量历史 `pland-functional-*` / `pland-acp-*` 目录（11:29–11:56），可择机清理，**不影响冒烟**。
- 提醒（Phase0 §300）：`.devdata-wave4-*` **不在** `.gitignore`，各域跑完务必删目录，**严禁提交**。

## 6. 端口 / 调试端点

| 端口 | 监听 | 归属 | 与冒烟关系 |
|---|---|---|---|
| 9222–9333 | **无** | — | 9222 空闲，可安全用作固定调试端口 |
| 9092 | `::`，PID 31348（node） | HBuilderX uni-app `-p h5` | 无关 |
| 9777 | `127.0.0.1`，PID 52128（chrome） | HBuilderX 内置浏览器调试 | **易误判**，不是 PlanD 的 |
| 18787 | `127.0.0.1`，PID 28892（node） | `billion-context`（DeepSeek Harness 侧） | 无关 |

Wave4 harness 用 `_electron.launch()`，Playwright 默认注入 `--remote-debugging-port=0`（随机端口，见 `DevToolsActivePort`），因此**不会有固定端口冲突**；真正冲突的是 **userData 目录**，不是端口。

## 7. 建议动作（本文件只建议，未执行）

### 7.1 保留（不要杀）

| 对象 | 原因 |
|---|---|
| PID 48388 / 46524 / 50256 / 50860 / 37584（`原型工具.exe`） | 用户正在使用的打包版 1.2.0；窗口可见最大化；**不写 `.devdata`**，杀掉只会打断用户且对冒烟零收益 |
| 任意 `OpenCode.exe` / `opencode-cli.exe` / `codebuddy --acp` / MCP 服务 | 属 Agent 框架，可能是当前正在跑的会话；误杀会中断协调者自身 |

### 7.2 可清理（需协调者/用户确认后执行，本代理未执行）

| 对象 | 依据 | 风险 |
|---|---|---|
| **无（针对 `.devdata` 争用）** | 12:28:25 时 `electron.exe` = 0，无可清理的 PlanD 进程 | — |
| `%TEMP%\pland-functional-*`、`%TEMP%\pland-acp-*`（约 20+ 个，11:29–11:56） | 历史测试工作目录 | 极低；仅占磁盘 |
| 7 套陈旧 MCP 服务（`chrome-devtools-mcp` / `mysql_mcp_server` / `rea mcp`，08:45–12:06 各代） | 父进程 `18836` 仍在，但跨 7 代重复 | 中；可能是活跃会话的 MCP，**不建议盲目批杀** |

### 7.3 需要"协调"而不是"杀"的事

**外部 Playwright 运行器仍在间歇启动开发态 Electron 并写共享 `.devdata`。** 这是唯一真实的串状态来源。定位方式（只需看命令行，不需杀）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
  Where-Object CommandLine -match 'playwright-core\\lib\\server\\electron\\loader\.js' |
  Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine
```

- 建议由协调者确认这是哪个域/哪个 agent 的冒烟在跑，**让它停下来**（而不是杀它），再执行 `seed.mjs --rebuild-seed`。
- 若确认无人认领，它属于"无人负责的循环重跑"，此时才考虑按 PID 树清理——**必须用 `/PID <pid> /T`，禁止 `/IM electron.exe`**（避免误伤未来任何实例）。

## 8. 冒烟前检查清单

按顺序执行；任一项不满足就**不要开跑**。

```powershell
# 0) 站在仓库根
cd D:\文件\工具\原型工具-PlanD

# 1) 开发态 Electron 必须为 0，且连续两次采样都为 0（突发只活 3–15 s）
(Get-CimInstance Win32_Process -Filter "Name='electron.exe'").Count
Start-Sleep -Seconds 30
(Get-CimInstance Win32_Process -Filter "Name='electron.exe'").Count

# 2) 没有外部 Playwright 正在拉起 Electron
(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
  Where-Object CommandLine -match 'server\\electron\\loader\.js').Count

# 3) 域目录必须是干净的（应为 0 条，否则先删再让 seed.mjs 重新分发）
Get-ChildItem -Force -Directory . | Where-Object Name -like '.devdata-wave4-*'

# 4) 9222 必须空闲
(Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue).Count

# 5) 记录 .devdata 指纹，跑完再比一次；不一致就判定串状态、结果作废
Get-ChildItem -Recurse -File -Force .\.devdata |
  Measure-Object Length -Sum |
  Select-Object Count,Sum
```

判定口径：

| 检查项 | 通过标准 | 失败处置 |
|---|---|---|
| `electron.exe` 计数 | 两次均为 0 | 等突发结束再测；不要 kill |
| 外部 Playwright | 0 | 找协调者停掉发起方 |
| `.devdata-wave4-*` | 0 条 | 删该域目录，重跑 `seed.mjs --domain <d>` |
| 9222 | 未监听 | 换端口或查占用者 |
| `.devdata` 文件数/总字节 | 前后一致 | 结果作废，标注"源漂移" |

补充硬约束：

1. **禁止** `taskkill /IM electron.exe` 或 `/IM 原型工具.exe`。仓库内所有 `taskkill` 调用都是 `/PID <pid> /T /F`（`tests\run.js:21`、`e2e\wave4\harness.ts:237` 等），沿用该写法。
2. **不要**把 `原型工具.exe` 当作 PlanD 实例。判别式：看 `ExecutablePath` 是否含 `node_modules\electron\dist`，或看 `--user-data-dir` 是否指向 `.devdata`。
3. **不要**在冒烟同时跑 `npm test` / `vitest`：`tests/verify-acp-process-cleanup.js` 会拉起 `fake-acp-cli` 并 `taskkill` 进程树（12:23–12:24 实测到一波），且部分用例会启动 Electron。
4. 工作区当前 `main` 分支有 **111 个未提交改动**（含 `main.js`、`app.css`、`e2e\*`）。开跑前确认没有别人正在改同一批文件，否则报告归因会混淆。
5. `%TEMP%\pland-wave4\seed` 是只读模板，**不要**用 Electron 直接打开它。

## 9. 已知不确定项

| 项 | 说明 |
|---|---|
| 12:27:29 / 12:27:44 两次突发的 `--user-data-dir` | 父 `cmd.exe` 与子进程在采样间隔内退出，未取到；只能从"12:22:50 同形态实例实测指向 `.devdata`"推断，**未经直接验证** |
| 并发运行器的发起方 | 只能确认是 Playwright（`loader.js` 指纹），无法确认是哪个 agent / 哪条命令；其父 `cmd.exe` 也是瞬时的 |
| CWD | 全部为推断（`Win32_Process` 不提供）。已用 `--user-data-dir` / `--app-path` / 可执行路径替代 |
| LevelDB LOCK 的实际持有者 | 未做句柄级检测；当前无 electron 进程，判定为"无持有者"，但未用 `handle.exe` 验证 |
| `原型工具.exe` 是否有未落盘的用户操作 | 只能看到 11:51:32 后 `%APPDATA%` 无写入；窗口最大化但可能只是开着 |

## 附录 A. 陈旧 MCP 服务明细（仅备查，不建议批杀）

7 个"代"，每代 3 条链（`chrome-devtools-mcp` / `mysql_mcp_server` / `rea mcp`），父进程均为 `18836`。

| 启动时刻 | chrome-devtools-mcp（cmd PID） | mysql_mcp_server（cmd PID） | rea mcp（cmd PID） |
|---|---|---|---|
| 08:45:44 | 48896 | 49328 | 50724 |
| 09:00:01 | 46704 | 44456 | 45828 |
| 11:46:00 | 43820 | 50804 | 33648 |
| 11:58:07 | 46416 | 3252 | 48200 |
| 11:59:15 | 8264 | 44316 | 41636 |
| 12:00:22 | 51428 | 50216 | 20388 |
| 12:06:29 | 42796 | 22688 | 42636 |

每条链向下还有 1–3 个 `node.exe` 子进程（`npx-cli.js` → MCP 主脚本 → `watchdog/main.js`）。这些不是 PlanD 的进程，且可能仍有活跃会话在用；**若要清理，应按"代"整树 `taskkill /PID <cmd> /T /F`，并由协调者确认哪几代是死会话。**
