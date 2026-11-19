# Wave4 Phase 0 测试基座报告

- 日期：2026-11-13
- 项目：`D:\文件\工具\原型工具-PlanD`
- 状态：**PASS**。基座可用；本轮只验证启动/隔离/seed/报告骨架，**未执行任何业务域**。
- 约束：未 `npm install`、未 commit、未改 `src/**` / `main/**` / `tests/**` / `package.json`；未启动真实 AI 发送；未执行 Git 网络操作。

---

## 1. 交付物

| 文件 | 状态 | 用途 |
| --- | --- | --- |
| `e2e/wave4/harness.ts` | 新建 | `launchApp({domain, env})`、userData 隔离断言、console/pageerror 收集、截图、失败报告、关闭兜底 |
| `e2e/wave4/seed.mjs` | 新建 | 从 `.devdata` 只读复制最小 seed 到 `%TEMP%\pland-wave4\seed`，并分发到 `<repo>/.devdata-wave4-<domain>` |
| `docs/wave4/reports/README.md` | 新建 | 每域报告模板、截图命名、缺陷级别、结论判定、harness 用法 |
| `docs/wave4/shots/.gitkeep` | 新建 | 截图根目录占位 |
| `docs/wave4/phase0-report.md` | 新建 | 本报告 |

说明：`docs/wave4-smoke-plan.md` §5.3 写的共享工具名是 `e2e/wave4/_harness.ts`；本次任务口径为 `e2e/wave4/harness.ts`，以本报告与代码为准。

---

## 2. 环境与基线

| 项 | 值 |
| --- | --- |
| OS | Windows（当前工作机） |
| Node | v24.15.0 |
| Electron | 37.10.3（`node_modules/electron`） |
| Playwright | 1.65.0 |
| `npx tsc --noEmit` | **PASS**，exit 0 |
| `node --check e2e/wave4/seed.mjs` | **PASS**，exit 0 |
| `dist/renderer/index.html` | 存在（2026-11-13 11:31:59） |

---

## 3. `.devdata` 只读勘察

源目录：`D:\文件\工具\原型工具-PlanD\.devdata`

- 源指纹（路径+大小+mtime+SHA256）：`a75eafce79a0ff40a0a93722096e6ef8deb8aa5f9a1b8003d629f326b8670544`
- 源文件数 / 字节数（指纹覆盖范围）：200 / 1,277,459
- 构建前后指纹一致：`sourceUnchanged=true`
- 构建前检测 Electron 进程：无（`activeElectronPids=[]`）
- 构建后（约 12:11）另一个 Electron 实例写入过 `.devdata/Local Storage` 等 Chromium 状态；随后源指纹又观测到 `0b14d78afa17…`、`86a0dcf369f3…` 两次变化，说明共享 `.devdata` 仍有并行实例在写。已核对的项目文件/配置/凭据未变（变化集中在 Local Storage 等 Chromium 状态）；12:16 尝试重建时检测到 5 个 Electron 进程，按设计拒绝重建，保留 12:05 的干净 seed。详见 §8「已观测到源漂移」

### 3.1 sandbox 结构

```text
.devdata/sandbox/
  测试1/
    首页/
      .context/            # history.md / toolPrompt.md / ui-spec.md / skills
      annotations.json     # 2 条
      links.json           # 2 条
      首页.html
      首页.md
      首页.a2ui.json
      最新需求.md
      assets/
    我的/
      我的.html
      我的.md
  .context/                # 全局上下文（5 文件，66,893 B）
  .git/                    # 本地仓库（58 文件，37,810 B）
  .gitignore
```

### 3.2 关键发现（不猜测删除）

| 项 | 勘察结果 | 处理 |
| --- | --- | --- |
| 项目 | 只有 `测试1`（`首页` + `我的`） | 全量复制该项目 |
| 快照 | `snapshots/测试1` 下 2 个版本、21 文件 | 只复制同名项目 |
| 其他快照 | `snapshots/测绘1`、`snapshots/PC端系统` 无同名 sandbox 项目 | 不复制，记录为 excluded |
| `git-config.json` | 项目键为 `测绘1`，与 sandbox 的 `测试1` 不匹配 | **不猜测改名**；保留原键，清空 remoteUrl，记录 mismatch |
| `sandbox/.git` | `origin` 指向 `gitee.com` | 副本删除 `[remote "..."]` 段，避免误触网络 |
| `ai-config.json` | 无明文 `apiKey`（4 处均为空串）；存在 `apiKeyMasked` / `hasApiKey` | 清空掩码与 has 标记，原始状态只写入 manifest 元数据 |
| `ai-credentials.json` | 条目 `default` 含 `apiEnc` / `byokEnc` / `apiConfigEnc` / `profilesEnc` | **不复制可解密凭据**；写出 `{version:1,entries:{}}` |
| `git-credentials.json` | 条目 `测绘1` 含 `usernameEnc` / `tokenEnc` | 同上，写出空 entries |
| `Local Storage` | 8 文件；发现 `protoLastProject`、`edit_queue_v1`、`protoOrder_v1` | 原样复制；队列可能为旧状态，域 spec 需自行清理 |
| `acp/`、`logs/`、缓存、`Preferences`、`Session Storage`、`Network` 等 | 与最小用例无关 | 不复制 |

---

## 4. Seed 结构

### 4.1 位置与体积

| 项 | 值 |
| --- | --- |
| seed 模板 | `C:\Users\allow\AppData\Local\Temp\pland-wave4\seed` |
| seed manifest | `%TEMP%\pland-wave4\seed\_wave4-seed.json` |
| 文件数 / 字节数 | 107 / 516,536（含 4 个脱敏配置 + manifest；复制 payload 为 102 / 499,779） |
| 域目录 | `<repo>\.devdata-wave4-<domain>`（与 harness 强制路径一致） |
| 域标记 | `<domain>\_wave4-domain.json`（domain、copiedAt、seed 路径） |

```text
%TEMP%/pland-wave4/seed/
  _wave4-seed.json
  ai-config.json                    # 脱敏保留（模型/Agent/规范绑定）
  ai-credentials.json               # {"version":1,"entries":{}}
  git-config.json                   # remoteUrl=""
  git-credentials.json              # {"version":1,"entries":{}}
  projects-normalized-v1
  Local Storage/leveldb/            # 8 文件（不含 LOCK/LOG）
  sandbox/
    测试1/                          # 13 文件，与源逐字节一致
    .context/
    .git/                           # remote 段已移除
    .gitignore
  snapshots/测试1/                  # 2 版本 / 21 文件
  specs/                            # index.json + 2 个 UI 规范
  uilibs/index.json
```

### 4.2 凭据脱敏结果

| 源文件 | 源条目 | 源敏感字段 | seed 动作 | manifest 元数据 |
| --- | --- | --- | --- | --- |
| `ai-credentials.json` | `default` | `apiEnc` / `byokEnc` / `apiConfigEnc` / `profilesEnc` | 只写 `entries:{}` | `hasApiKey=true`、`hasProfiles=true`、`copied=false` |
| `git-credentials.json` | `测绘1` | `usernameEnc` / `tokenEnc` | 只写 `entries:{}` | `hasToken=true`、`hasUsername=true`、`copied=false` |

- 未复制任何明文、密文、可解密串；域目录扫描 `apiEnc|byokEnc|apiConfigEnc|profilesEnc|tokenEnc|usernameEnc` 命中 **0**。
- `git-config.json` 与 `sandbox/.git/config` 的远程地址已清空；manifest 只记录 `remoteHosts=["gitee.com"]`，不记录路径/token。
- AI 真实发送域需要协调者在隔离副本中**单独注入**凭据；Phase 0 不注入。

### 4.3 保真校验

- `测试1` 项目下 13 个文件：源 / seed / 域目录 SHA256 **全部一致**，域目录无额外文件。
- `首页/annotations.json` = 2 条，`links.json` = 2 条，与源一致。
- `sandbox/.git/config` 从 369 B 变为 263 B：remote 段 1 个已移除；本地历史/对象/索引保留。

### 4.4 使用命令

```powershell
# 只读勘察，不写文件
node e2e/wave4/seed.mjs --dry-run --json

# Phase 0 / 协调者：构建或刷新共享 seed（构建前必须关闭所有 Electron）
node e2e/wave4/seed.mjs --rebuild-seed

# 每个域：复用 seed，复制到 <repo>/.devdata-wave4-<domain>
node e2e/wave4/seed.mjs --domain shell

# 覆盖重建某个域（确认没有实例在用该域目录）
node e2e/wave4/seed.mjs --domain shell --force

# 一次刷新 8 个域
node e2e/wave4/seed.mjs --all --force
```

- 默认**复用已有 seed**，并行 agent 不会同时重建；需要刷新必须显式 `--rebuild-seed`。
- 构建 seed 有 `%TEMP%\pland-wave4\.seed.lock`；30 分钟视为 stale。
- 检测到 Electron 进程时拒绝重建 seed；确认风险后才可加 `--allow-active-source`。
- 源目录只读；构建前后指纹不一致会直接失败。

---

## 5. Harness 与隔离断言

### 5.1 契约

```ts
const ctx = await launchApp({ domain: 'shell', env: { /* 可选 */ } })
// ctx.app / ctx.page / ctx.dataDir / ctx.userData / ctx.seedPresent
// ctx.consoleErrors / ctx.pageErrors / ctx.crashes / ctx.stderr / ctx.failures
// ctx.shot(step, slug, { fullPage?, fail?, page? })
// ctx.reportFailure({ step, slug, level, expected, actual, error?, extra? })
// ctx.assertNoFatalConsole()
// ctx.fatalErrors()
await ctx.close() // window.close -> app.close -> taskkill/SIGKILL，永不抛异常
assertCleanExit(result) // 显式断言 exitCode=0 且非 kill
```

`launchApp` 的硬行为：

1. `PLAND_DEV_DATA_DIR = <repo>/.devdata-wave4-<domain>`，在合并 `env` 后**最后覆盖**，调用方无法改回 `.devdata`。
2. 启动后回读 `app.isPackaged`，为 true 直接失败（打包态忽略隔离变量）。
3. 回读 `app.getPath('userData')`，同时断言「以期望目录结尾」+「精确相等」。
4. 默认要求域目录存在 `_wave4-seed.json`；空 profile 必须显式 `requireSeed:false`。
5. 失败路径自动 `closeApp(..., {force:true})`，不留 Electron 进程。

### 5.2 自检命令

```powershell
# 1) 严格类型检查 harness（tsconfig.json 未 include e2e，单独编译）
npx tsc e2e/wave4/harness.ts --ignoreConfig --outDir $env:TEMP\pland-wave4\harness-build `
  --module commonjs --target ES2020 --moduleResolution node10 --ignoreDeprecations 6.0 `
  --esModuleInterop --skipLibCheck --strict --lib ES2020,DOM --types node

# 2) 用编译产物启动一次 phase0 专用域（带 seed，仅验证基座，不测业务）
$env:NODE_PATH = "<repo>\node_modules"
$env:PLAND_WAVE4_ROOT = "<repo>"   # 仅临时编译自检需要
node $env:TEMP\pland-wave4\harness-selfcheck.cjs
```

### 5.3 自检结果（phase0 专用域，最后一次）

```json
{
  "domain": "phase0",
  "dataDir": "D:\\文件\\工具\\原型工具-PlanD\\.devdata-wave4-phase0",
  "userData": "D:\\文件\\工具\\原型工具-PlanD\\.devdata-wave4-phase0",
  "endsWithExpected": true,
  "strictEqualExpected": true,
  "seedPresent": true,
  "consoleErrors": 0,
  "pageErrors": 0,
  "crashes": 0,
  "fatalErrors": 0,
  "shotPathSample": "D:\\文件\\工具\\原型工具-PlanD\\docs\\wave4\\shots\\phase0\\01-isolation-check.png",
  "failureReport": "C:\\Users\\allow\\AppData\\Local\\Temp\\pland-wave4\\failures\\phase0\\00-harness-selfcheck-2026-11-13T04-14-49-364Z.md",
  "close": {
    "ok": true,
    "exitCode": 0,
    "method": "window-close",
    "elapsedMs": 552,
    "exited": true
  }
}
```

结论：**隔离生效**（期望路径 = 实际 userData，精确相等），**致命 console/page error = 0**，**进程 exitCode = 0**。多次自检关闭耗时 323–579ms，均为 `window-close`，无 kill 兜底。

失败报告 helper 也已实际落盘（`screenshot:false`，避免在仓库产生非约定截图）；格式包含预期/实际/数据目录/console/pageerror/crash/stderr，域 spec 可直接引用。

---

## 6. 验证记录

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `npx tsc --noEmit` | PASS，exit 0（仓库基线；不覆盖 e2e） |
| 2 | `node --check e2e/wave4/seed.mjs` | PASS，exit 0 |
| 3 | `node e2e/wave4/seed.mjs --dry-run --json` | PASS；`seedAction=reuse`、`activeElectronPids=[]`、源指纹匹配 |
| 4 | `node e2e/wave4/seed.mjs --rebuild-seed --domain phase0 --force --json` | PASS；seed 107 文件 / 516,536 B（payload 102 / 499,779），`sourceUnchanged=true` |
| 5 | `node e2e/wave4/seed.mjs --domain phase0 --force --json` | PASS；复用 seed，域目录重建成功 |
| 6 | 域目录已存在且未加 `--force` | 预期失败 exit 1，提示加 `--force`，未覆盖 |
| 7 | harness 严格编译（见 §5.2） | PASS，exit 0 |
| 8 | harness 启动 phase0 + 隔离断言 + 关闭 | PASS；见 §5.3 |
| 9 | 真实 AI 发送 / Git 网络 | **未执行**（Phase 0 明确不做） |
| 10 | 12:16 再次 `--rebuild-seed` | 预期 **ENV-BLOCKED**：检测到 5 个 Electron 进程，拒绝复制共享 `.devdata`；生产 seed 未被修改 |
| 11 | `--seed %TEMP%\pland-wave4\seed-test` 隔离试构建 | PASS；新计数逻辑输出 107 文件 / 519,507 B，`sourceUnchanged=true`；验证后删除 seed-test，未触碰生产 seed |

自检用的 `phase0` 域目录在报告完成后已删除，避免未跟踪测试数据留在仓库；需要复现时执行 `node e2e/wave4/seed.mjs --domain phase0` 再跑 harness 即可。

---

## 7. 并行使用说明

### 7.1 域与产出

| 域 | spec | 报告 | 截图 | 数据目录 | Playwright 输出 |
| --- | --- | --- | --- | --- | --- |
| AI | `e2e/wave4-ai.spec.ts` | `docs/wave4/reports/ai.md` | `docs/wave4/shots/ai/` | `.devdata-wave4-ai` | `test-results/wave4/ai` |
| Ctrl 拾取 | `e2e/wave4-pick.spec.ts` | `docs/wave4/reports/pick.md` | `docs/wave4/shots/pick/` | `.devdata-wave4-pick` | `test-results/wave4/pick` |
| 文档 | `e2e/wave4-docs.spec.ts` | `docs/wave4/reports/docs.md` | `docs/wave4/shots/docs/` | `.devdata-wave4-docs` | `test-results/wave4/docs` |
| 主壳 | `e2e/wave4-shell.spec.ts` | `docs/wave4/reports/shell.md` | `docs/wave4/shots/shell/` | `.devdata-wave4-shell` | `test-results/wave4/shell` |
| 舞台 | `e2e/wave4-stage.spec.ts` | `docs/wave4/reports/stage.md` | `docs/wave4/shots/stage/` | `.devdata-wave4-stage` | `test-results/wave4/stage` |
| 设置 | `e2e/wave4-settings.spec.ts` | `docs/wave4/reports/settings.md` | `docs/wave4/shots/settings/` | `.devdata-wave4-settings` | `test-results/wave4/settings` |
| Git | `e2e/wave4-git.spec.ts` | `docs/wave4/reports/git.md` | `docs/wave4/shots/git/` | `.devdata-wave4-git` | `test-results/wave4/git` |
| 导出/标注/快照/链接 | `e2e/wave4-export.spec.ts` | `docs/wave4/reports/export.md` | `docs/wave4/shots/export/` | `.devdata-wave4-export` | `test-results/wave4/export` |

### 7.2 单域命令模板

```powershell
# 1) 准备本域数据目录（复用只读 seed；不要并行重建 seed）
node e2e/wave4/seed.mjs --domain shell

# 2) 只跑本域 spec；独立命令/进程，单命令内 workers=1
npx playwright test e2e/wave4-shell.spec.ts --workers=1 --output=test-results/wave4/shell
```

### 7.3 并发与独占

- 常规 UI 槽：最多 **3 个** Electron 实例（shell / stage / settings / pick / docs-read 可并行）。
- 独占通道（同一时刻只允许 1 个）：
  - `AI-LIVE`：真实 `ai:ask`；
  - `GIT-WRITE`：Git 写 / 本地 bare push/pull；
  - `DOC-WIN`：独立文档窗 + mirror；
  - `EXPORT-NATIVE`：PNG/PDF/HTML 原生保存对话框（域内串行）。
- AI mock 阶段可与 UI 槽并行，但必须用独立域目录。
- **禁止**裸跑 `npx playwright test` 全量；每个 agent 只跑自己的 spec。
- 不共享 Electron 实例、不共享 seed、不共享 `test-results`。
- 锁文件约定（可选）：`%TEMP%\pland-wave4\locks\{ai.live,git.write,docwin,export.native}.lock`，内容 `domain/pid/start/owner`，30 分钟 stale。

### 7.4 重置与清理

```powershell
# 先确认该域没有 Electron 在跑，再重建域目录
node e2e/wave4/seed.mjs --domain shell --force

# 清理所有域目录前先列出，避免误删
Get-ChildItem -Directory -Filter ".devdata-wave4-*" | Select-Object Name
Get-ChildItem -Directory -Filter ".devdata-wave4-*" | Remove-Item -Recurse -Force
```

- `.devdata-wave4-*` 目前**不在** `.gitignore`；严禁提交。建议 `.gitignore` 维护者补充 `.devdata-*/`。
- seed 模板只读；不要用 Electron 直接打开 `%TEMP%\pland-wave4\seed`。

---

## 8. 已知限制与风险

| 项 | 说明 | 建议 |
| --- | --- | --- |
| `tsconfig.json` 未 include `e2e/**` | `npx tsc --noEmit` 通过但不检查 harness；本次已单独严格编译 | 协调者可另行把 `e2e/wave4` 纳入 tsconfig（本轮未改） |
| 凭据被剥离 | AI 真实发送 / 真实 gitee 需要凭据；seed 只有 `hasToken` 元数据 | AI-LIVE / GIT-NET 前由协调者在隔离副本单独注入 |
| Git 项目键不匹配 | `git-config.json` 的 `测绘1` 与 sandbox 的 `测试1` 不一致 | 不猜测改名；Git 域自行写本地 bare 配置 |
| Git 远程已清空 | `sandbox/.git/config` 删除了 remote 段，`branch.main.remote=origin` 仍保留 | Git 域重新 `git remote add origin <local bare>` |
| Local Storage 旧队列 | seed 含 `edit_queue_v1`、`protoOrder_v1` | 导出域开始前显式清空/预置队列；AI 域清 AI 历史键 |
| seed 复用不自动感知源变化 | 源指纹变化只告警，不自动重建 | 需要刷新时 `--rebuild-seed` |
| **共享 `.devdata` 仍在被并行写** | seed 构建于 12:05（指纹 `a75eafce79a0…`）；12:11 左右另一实例写入 `.devdata/Local Storage`、`Preferences`、`Session Storage`，随后源指纹又出现 `0b14d78afa17…`、`86a0dcf369f3…`。已核对的项目文件、配置、凭据未变；12:16 重建被 5 个 Electron 进程拦截（预期行为） | **冻结 UI / 确认无实例后**由协调者 `--rebuild-seed` 再分发；不要边跑边重建；域 agent 只复制自己的目录 |
| LevelDB 复制竞态 | 已用 Electron 进程检测 + 构建前后指纹兜底；仍无法防非 Electron 写入 | 只在 Phase 0 无实例时构建 seed |
| `PLAND_WAVE4_ROOT` | 仅用于把 harness 编译到临时目录做自检 | 域 spec 不要设置 |
| 测试域目录未跟踪 | `.devdata-wave4-phase0` 已在自检后删除 | 各域结束按报告签字后再删 |

---

## 9. 下一步（A 阶段）

1. 协调者确认 seed 指纹 / 8 域目录命名；各 agent 用 `--domain` 分发，不重建 seed。
2. 各域按 `docs/wave4/reports/README.md` 建 `<domain>.md`，spec 从 `./wave4/harness` 引入基座。
3. 按 §7.2 单域执行；失败用 `ctx.reportFailure` 落临时片段，再汇总到域报告。
4. A 阶段只报 P0/P1；每域保留域目录与截图到报告签字。
5. A 的 P0/P1 关闭并复测通过后，才启动 B。

---

## 10. 合规声明

- 未执行 `npm install`、`npm run build`、`npm run build:renderer`。
- 未 commit、未改 `src/**`、`main/**`、`tests/**`、`package.json`、`playwright.config.ts`。
- 未修改原 `.devdata`；源指纹构建前后一致。
- 未启动真实 AI 发送；未执行 Git 网络操作；未打开文档独立窗。
- 本轮只新增本文列出的 5 个文件（另产生 `%TEMP%` 下的 seed/失败片段/编译自检产物，不属于仓库）。
