# 变更影响面测试规范（Change-Impact Testing）

- 适用：原型工具 PlanD v1.2.0 及后续修复包
- 目的：日常修复只跑“本次改动影响域”的最小测试集；全量门禁只用于发布和真正的共享面变更
- 覆盖：**10 个功能域 + 1 条兜底映射**
- 约束：本流程不执行 `npm install`，不改测试/配置来“放行”，不以 `SKIP` 冒充 `PASS`

---

## 1. 原则

### 1.1 默认：只跑受影响域的最小集

判定单位是**功能域**，不是“改了几个文件”。

- 一个修复包只改一个域：只跑该域的最小单测 + 最小 e2e，不改的域不跑。
- 一个修复包改多个域：取各域最小集的**并集**，不升级为全量。
- 只有命中 §1.2 的条件，才允许跑全量。

“最小集”不是只跑单测：

- 纯内部逻辑：单测可以闭环。
- 用户可见行为：至少 1 条真机 e2e。
- 公共契约、持久化键、IPC 字段：至少 1 条静态契约断言。
- 打包白名单、构建入口：至少 1 次 `check-pack` / 构建核验。

### 1.2 全量触发条件

“全量”指 §6 的 R1–R8 整套发布门禁。

| # | 触发条件 | 说明 |
| --- | --- | --- |
| 1 | **发布前** | 外发、试用交付、打安装包、版本号发布，必须全量。 |
| 2 | **改共享基础设施** | `main/**`、`preload.js`、`main/ipc-contract.js`、`runtimes/**`、`providers/**`、`platform/**`、`git/**`（主进程安全/凭据）、`vite.config.ts`、`package.json` 构建配置、`scripts/**` 构建脚本。默认全量；只有能证明“契约不变”的局部实现修复，才可降到 §3 第 9 行，并在报告中写明证据。 |
| 3 | **跨域重构** | 改动涉及 3 个及以上功能域；或改共享 store 契约、事件总线、全局样式 token、持久化键格式。 |
| 4 | **无法判断影响面** | 新增文件没有归属、调用链跨域、报告无法说明“为什么只跑这些”。此时不要猜，直接全量。 |

补充的操作型升级（不是新类别，是执行中触发）：

| # | 触发 | 动作 |
| --- | --- | --- |
| 5 | 实际 `git diff` 超出执行前声明，或改到共享文件 | 重写声明；按新影响面取并集；共享契约变化则全量 |
| 6 | 同一修复包连续 2 次因“影响面误判”失败 | 停止局部复跑，升级全量 |

### 1.3 日常禁止

以下命令**不得**作为日常默认，只能在 §1.2 触发时执行：

```text
npx tsc --noEmit                 # 全量类型检查
npx vitest run                   # 不带路径 = 全部单测
npx playwright test              # 不带文件 = 全部 e2e
node tests/run-all.js            # 默认 PLAND_SUITE=all
npm run build                    # 全量构建 + electron-builder 打包
```

日常单域只使用带路径/带 spec 的命令，例如：

```text
npx vitest run src/renderer/features/docs
npx playwright test e2e/wave4-b-docs.spec.ts
```

### 1.4 影响面判定顺序

1. 取变更文件：`git status --short` / `git diff --name-only`。
2. 按 §3 表匹配路径前缀，得到功能域。
3. 多域取并集；命中兜底行则全量。
4. 先写 §5 的“执行前声明”，再执行。
5. 跑完贴结果；失败先修再复跑同一最小集，不直接全量。

---

## 2. 每个修复包的固定流程

| 步骤 | 动作 | 产物 |
| --- | --- | --- |
| 1 | 记录 HEAD 与变更文件 | `git rev-parse HEAD`、`git diff --name-only` |
| 2 | 查 §3 映射表，写影响域与最小测试 | 报告 §0“执行前声明” |
| 3 | 执行最小集 | 命令、exit code、摘要 |
| 4 | 跑完贴结果 | 报告 §1 结果表；PASS/FAIL/SKIP/ENV 逐条写 |
| 5 | 失败处理 | 同域修复 + 同集复跑；跨域/共享面才升级 |
| 6 | 结论 | PASS / FAIL / PASS-WITH-RISK + 未覆盖风险 |

硬规则：

- **未写执行前声明就开跑 = 流程违规**，结果不作为验收依据。
- **只写“已测试/没问题” = 未验收**，必须贴命令与结果。
- **未受影响域不重复全量**；不要用“多跑一点更保险”替代影响面判断。
- 报告中的测试集必须能对应到 §3 的某一行；对不上就按兜底行处理。

---

## 3. 文件 → 功能域 → 最小测试集映射

标记：`U` = Vitest 单测；`S` = 静态契约 / Node verify；`E` = Electron 真机 e2e；`B` = 构建/打包。

| # | 影响文件（仓库相对路径） | 功能域 | 最小测试集 | 升级条件 |
| --- | --- | --- | --- | --- |
| 1 | `src/renderer/features/ai/**`<br>`src/renderer/components/ai-elements/**`<br>`src/renderer/stores/ai-store.ts` | AI 对话 / 模型选择 / 权限卡 | **U**：`npx vitest run src/renderer/features/ai src/renderer/components/ai-elements src/renderer/stores/__tests__/ai-store.test.ts`<br>**S**：`npx playwright test e2e/ai.spec.ts`（改选择器/持久化键时）<br>**E**：`npx playwright test e2e/wave4-b-ai.spec.ts --workers=1 --output=test-results/ai` | 改 ACP 事件适配器、`ai:*` IPC、`main/acp/**` → 第 9 行；改模型清单来源 `settings-store` → 并第 5 行 |
| 2 | `src/renderer/features/preview/**`<br>`src/renderer/components/shell/Stage.tsx`<br>`src/renderer/features/preview/Pick*.tsx`<br>`src/renderer/features/preview/{InlineEdit,MultiSelect}.tsx` | 预览 / 舞台拾取（Pick） | **U**：`npx vitest run src/renderer/features/preview`<br>**S**：`npx playwright test e2e/preview.spec.ts`<br>**E**：`npx playwright test e2e/wave4-b-pick.spec.ts --workers=1 --output=test-results/pick` | 同时改 Stage 布局/缩放 → 并第 4 行；改浮层宿主 → 并第 8 行；改 iframe sandbox/CSP/帧桥协议 → 第 9 行或全量 |
| 3 | `src/renderer/features/docs/**`<br>`src/renderer/stores/docs-store.ts`<br>`src/renderer/components/shell/DocsPanelHost.tsx`<br>`src/renderer/app/modes/DocWindow.tsx` | 文档面板 / 编辑 / 独立窗 | **U**：`npx vitest run src/renderer/features/docs src/renderer/stores/__tests__/docs-store.test.ts`<br>**S**：`npx playwright test e2e/docs.spec.ts`<br>**E**：`npx playwright test e2e/wave4-b-docs.spec.ts --workers=1 --output=test-results/docs` | 改 docwin/mirror 主进程侧、`doc:*` IPC → 第 9 行；改文档 MD/PNG/PDF 导出 → 并第 7 行 |
| 4 | `src/renderer/components/shell/{Topbar,Sidebar,Stage,MiniDock}.tsx`<br>`src/renderer/app/modes/MainWindow.tsx`<br>`src/renderer/features/projects/**`<br>`src/renderer/stores/{app,ui}-store.ts` | 主壳 / 侧栏 / 舞台框架 | **U**：`npx vitest run src/renderer/components/shell src/renderer/app/modes/__tests__ src/renderer/stores/__tests__/ui-store.test.ts`（改 `sources-store` 时再加 `src/renderer/stores/__tests__/sources-store.test.ts`）<br>**S**：`npx playwright test e2e/shell.spec.ts`<br>**E**：`npx playwright test e2e/wave4-b-shell-stage.spec.ts --workers=1 --output=test-results/shell-stage`<br>**E（条件）**：改 Stage 缩放/iframe/移动端时加 `npx playwright test e2e/wave4-stage.spec.ts --workers=1 --output=test-results/stage` | `Stage` 同时承载 Pick → 并第 2 行；改 `DocsPanelHost` → 归第 3 行；改项目切换同时影响文档源 → 并第 3 行 |
| 5 | `src/renderer/features/settings/**`<br>`src/renderer/features/models/**`<br>`src/renderer/stores/settings-store.ts` | 设置 / 模型管理 / Agent 配置 | **U**：`npx vitest run src/renderer/features/settings src/renderer/features/models`<br>**S**：`npx playwright test e2e/settings-models.spec.ts`<br>**E**：`npx playwright test e2e/wave4-b-settings.spec.ts --workers=1 --output=test-results/settings` | 模型可见性被 AI 消费 → 并第 1 行；改 API Key/凭据存储、preload 暴露面 → 第 9 行或全量 |
| 6 | `src/renderer/features/git/**` | Git 面板（渲染器） | **U**：`npx vitest run src/renderer/features/git`<br>**S**：`node tests/verify-git-security.js`<br>`node tests/verify-git-credential.js`<br>`npx playwright test e2e/git-export.spec.ts`<br>**E**：`npx playwright test e2e/wave4-b-git-export.spec.ts -g "B1 Git" --workers=1 --output=test-results/git`<br>**E（条件）**：真实本地 bare push/pull 加 `npx playwright test e2e/wave4-git-local.spec.ts --workers=1 --output=test-results/git-local` | 改根目录 `git/**`（auth/config）、`preload.js` 的 Git API、token/凭据流程 → 第 9 行或全量；真实 gitee 网络写操作需单独审批，不纳入日常 |
| 7 | `src/renderer/features/export/**`<br>`js/export-template.js`<br>`scripts/copy-export-assets.mjs`（仅资源内容；改脚本本身归第 10 行） | 导出（JSON/HTML/MD/PNG/PDF） | **U**：`npx vitest run src/renderer/features/export`<br>**S**：`node tests/check-pack.js`<br>`npx playwright test e2e/export.spec.ts`<br>**E**：`npx playwright test e2e/wave4-export.spec.ts --workers=1 --output=test-results/export` | 改导出 HTML 契约（`__EXPORT_BOOT__`/`__EXPORT_SOURCES__`）→ 并第 3、8 行；改 Vite/构建资源管线 → 第 10 行 |
| 8 | `src/renderer/features/annotations/**`<br>`src/renderer/features/snapshot/**`<br>`src/renderer/features/links/**`<br>`src/renderer/components/overlays/**`<br>`src/renderer/features/preview/PreviewOverlaysHost.tsx` | 标注 / 快照 / 链接 / 浮层 | **U**：`npx vitest run src/renderer/features/annotations src/renderer/features/snapshot src/renderer/components/overlays src/renderer/features/preview/__tests__/overlays-host.test.ts`<br>**S**：`npx playwright test e2e/overlays.spec.ts`<br>**E**：`npx playwright test e2e/wave4-b-git-export.spec.ts -g "B2/B3" --workers=1 --output=test-results/overlays`<br>**E（条件）**：改 Esc/遮罩/焦点栈时加 `npx playwright test e2e/wave4-postfix.spec.ts --workers=1 --output=test-results/postfix` | 改 Stage 槽位契约 / Pick 控制器 → 并第 2、4 行；改标注/链接数据格式且导出消费 → 并第 7 行；`links` 无独立单测，必须跑 `e2e/overlays.spec.ts` |
| 9 | `main/**`<br>`main/acp/**`<br>`preload.js`<br>`main/ipc-contract.js`<br>`runtimes/**`<br>`providers/**`<br>`platform/**`<br>`git/**`<br>`src/renderer/types/ipc.d.ts` | 主进程 / ACP / runtime / provider / 安全边界 | **S/U 组合**：core Node 全量（PowerShell/CMD 见 §4.4）<br>**E**：`npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts --workers=1 --output=test-results/core-electron`<br>**U（条件）**：改 `preload.js` / `ipc-contract.js` / `ipc.d.ts` 时加 `npx tsc --noEmit` | 改 IPC/preload 契约、runtime/provider 注册格式、sandbox/安全边界、凭据流程 → **全量 §6**；无法证明契约不变 → 全量 |
| 10 | `package.json`（含 `build`）<br>`package-lock.json`<br>`vite.config.ts`<br>`tsconfig.json`<br>`scripts/**` | 构建 / 打包 / 安装器 | **B**：`node tests/check-pack.js`<br>`npm run build:renderer`<br>`npm run build`<br>`§4.5 asar/安装包核验`<br>**E（条件）**：改入口/`build.files`/asar 后加 `npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts --workers=1 --output=test-results/build-smoke` | 本行本身就是发布级验收；正式发布仍必须走 §6；改依赖/锁文件先单独审批，不在修复包内 `npm install` |
| 11 | **兜底**：`src/renderer/lib/**`、`src/renderer/components/ui/**`、`app.css`、`src/renderer/stores/{sources,ui}-store.ts`、`main.js`、`dist/**`、未命中任何行、无法判断 | 共享/跨域/未知 | **全量 §6** | 不适用；先尝试拆出具体域，拆不出就全量 |

### 3.1 共享文件的多域并集（不自动全量）

| 共享文件 | 典型影响域 | 最小处理 |
| --- | --- | --- |
| `src/renderer/stores/sources-store.ts` | 主壳、预览/Pick、文档 | 取第 2、3、4 行并集；改 store 契约/事件语义 → 视为跨域重构，全量 |
| `src/renderer/stores/ui-store.ts` | 主壳、浮层 | 取第 4、8 行并集 |
| `src/renderer/lib/storage-keys.ts` | AI、文档、设置、浮层 | 取对应域单测；改键名/迁移 → 全量 |
| `src/renderer/components/ui/**` | 主壳、文档、设置、浮层 | 取使用方单测 + 1 条代表性真机 e2e；改 Dialog/焦点行为 → 第 3、4、5、8 行并集 |
| `app.css` / 全局 Tailwind token | 全 UI | 第 4 行 + 文档/设置/浮层各 1 条代表性 e2e；无法判断 → 全量 |
| `src/renderer/types/ipc.d.ts` | 主进程契约 + 所有消费方 | 第 9 行 + `npx tsc --noEmit`；改通道签名 → 全量 |

### 3.2 归属易错点

- `components/shell/DocsPanelHost.tsx` 归**文档域**，不归主壳域。
- `Stage.tsx` 的**布局/缩放/壳**归主壳域；**拾取/iframe 接线**归预览域。两者都改就取并集。
- `features/preview/PreviewOverlaysHost.tsx` 归**浮层域**；`Pick*.tsx` 归**预览域**。
- 根目录 `git/**` 是主进程安全/凭据，归第 9 行；`src/renderer/features/git/**` 才是 Git 界面域。
- `e2e/wave4-b-git-export.spec.ts` 内含 Git 与“导出+浮层”两段；只改一侧时用 `-g "B1 Git"` 或 `-g "B2/B3"` 选择，不要整文件跑。

### 3.3 静态契约 vs 真机 e2e

- `e2e/{ai,docs,preview,settings-models,shell,export,git-export,overlays}.spec.ts` 以读源码/静态契约为主，速度快；GUI 块默认 `skip`，设置 `PLAND_E2E_APP_URL` 才执行。
- `e2e/wave4-b-*.spec.ts`、`e2e/electron-*.spec.ts` 是真实 Electron；用户可见行为以它们为准。
- 静态契约通过不等于真机通过；真机通过也不能替代数据键/通道的静态断言。

---

## 4. 命令模板（PowerShell / CMD）

均在仓库根目录执行。示例域为 `docs`，替换路径即可。

- 同一功能域同时只跑 1 个 Electron e2e；`wave4-b-*` 使用固定的 `.devdata-wave4-*` 数据目录，并行会互相抢写。
- 多个域需要并行时，确保域不重叠、数据目录不同；`AI-LIVE`、`GIT-WRITE`、`DOC-WIN` 仍串行。

### 4.1 单域最小集

**PowerShell**

```powershell
$DOMAIN = "docs"
npx vitest run src/renderer/features/docs src/renderer/stores/__tests__/docs-store.test.ts
npx playwright test e2e/wave4-b-docs.spec.ts e2e/docs.spec.ts --workers=1 --output="test-results/$DOMAIN"
```

**CMD**

```bat
set DOMAIN=docs
npx vitest run src/renderer/features/docs src/renderer/stores/__tests__/docs-store.test.ts
npx playwright test e2e/wave4-b-docs.spec.ts e2e/docs.spec.ts --workers=1 --output=test-results/%DOMAIN%
```

记录退出码：

```powershell
# PowerShell
$LASTEXITCODE
```

```bat
:: CMD
echo %ERRORLEVEL%
```

### 4.2 多域并集

```powershell
# 例：主壳 + 文档（不要把并集写成全量）
npx vitest run src/renderer/components/shell src/renderer/app/modes/__tests__ src/renderer/features/docs src/renderer/stores/__tests__/docs-store.test.ts
npx playwright test e2e/wave4-b-shell-stage.spec.ts e2e/wave4-b-docs.spec.ts e2e/shell.spec.ts e2e/docs.spec.ts --workers=1 --output=test-results/shell-docs
```

```bat
npx vitest run src/renderer/components/shell src/renderer/app/modes/__tests__ src/renderer/features/docs src/renderer/stores/__tests__/docs-store.test.ts
npx playwright test e2e/wave4-b-shell-stage.spec.ts e2e/wave4-b-docs.spec.ts e2e/shell.spec.ts e2e/docs.spec.ts --workers=1 --output=test-results/shell-docs
```

### 4.3 单条 Node verify / 静态门禁

```powershell
node tests/verify-git-security.js
node tests/verify-git-credential.js
node tests/check-pack.js
```

### 4.4 core Node + Electron 双入口（主进程/ACP/runtime/provider）

**PowerShell**

```powershell
$env:PLAND_SUITE = "core"
node tests/run-all.js
Remove-Item Env:PLAND_SUITE
npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts --workers=1 --output=test-results/core-electron
```

**CMD**

```bat
set PLAND_SUITE=core
node tests/run-all.js
set PLAND_SUITE=
npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts --workers=1 --output=test-results/core-electron
```

- `PLAND_SUITE=core` 覆盖：check-pack、lint-guard、git-security、git-credential、static-verify、platform、runtimes、全部 `acp-*`、providers、ipc、model-management 及相关 session/事件/模型 verify。
- Electron 双入口 = `electron-live.spec.ts`（React + legacy）+ `electron-functional.spec.ts`（React 9 步 + P0/P1 回归）。

### 4.5 构建 / 打包 / asar 核验

```powershell
node tests/check-pack.js
npm run build:renderer
npm run build
```

asar 核验（只读，不重新打包）：

```powershell
node -e "const a=require('@electron/asar');const f='桌面端/win-unpacked/resources/app.asar';const l=a.listPackage(f);const need=['\\dist\\renderer\\index.html','\\dist\\renderer\\export-assets\\export-template.js','\\dist\\renderer\\export-assets\\icons.js','\\dist\\renderer\\export-assets\\export.css'];for(const p of need)if(!l.includes(p))throw new Error('missing '+p);console.log('ASAR_OK entries='+l.length)"
```

安装器核验：

```powershell
node -e "const fs=require('fs');const d='桌面端';const a=fs.readdirSync(d).filter(n=>/Setup.*\.exe$/i.test(n));if(!a.length)throw new Error('installer missing');const f=d+'/'+a[0];const s=fs.statSync(f).size;if(s<50*1024*1024)throw new Error('installer too small: '+s);console.log('INSTALLER_OK '+f+' bytes='+s)"
```

---

## 5. 修复包验收报告模板

每个修复包一份，放在该包的报告/记录中。**先填 §0，再执行；跑完补 §1–§4。**

```markdown
# 修复包验收 · <ID / 标题>

## 0. 执行前声明（必须先写）

| 项 | 内容 |
| --- | --- |
| 日期 / 负责人 |  |
| 分支 / HEAD | `git rev-parse HEAD` =  |
| 变更文件 | `git diff --name-only` =  |
| 影响域 | 映射表第 __ 行：____（多域写全部） |
| 选择的最小测试 | 1) `...`<br>2) `...` |
| 明确不跑 | 未受影响域：____；全量项：____；理由：____ |
| 共享面检查 | 是否改 `main/preload/ipc-contract/runtimes/providers/platform/git/构建配置`：是/否 |

## 1. 执行结果（跑完粘贴）

| # | 命令 | 结果 | 关键输出 / exit code | 证据 |
| --- | --- | --- | --- | --- |
| 1 |  | PASS / FAIL / SKIP / ENV |  | 日志/截图/文件/断言摘要 |
| 2 |  |  |  |  |

> 结果只允许 PASS / FAIL / SKIP / ENV；“基本通过”“应该没问题”不算结果。

## 2. 失败与重跑

| 失败命令 | 失败点（域内/共享面） | 处理 | 复跑命令 | 结果 |
| --- | --- | --- | --- | --- |
|  |  | 修代码 / 改声明 / 升级全量 |  |  |

## 3. 未覆盖风险

- [ ] 未跑全量 `tsc`：本次未改类型契约；若改 `src/renderer/types/**` 需补跑/升级
- [ ] e2e SKIP/ENV：原因____；未把 SKIP 当 PASS
- [ ] 真实 AI 请求未验证 / 配额不足：仅 mock + 单测覆盖
- [ ] 真实远端 Git 未验证：仅本地 bare / 静态契约
- [ ] 未跑全量打包：本次未改构建/打包链
- [ ] 仅 Windows 验证
- [ ] 其他：____

## 4. 结论

- 结论：PASS / FAIL / PASS-WITH-RISK
- 是否可进入下一修复包：是 / 否
- 是否需要升级全量：是 / 否；触发条件：____
- 备注：____
```

判定口径：

| 结论 | 条件 |
| --- | --- |
| PASS | 声明的命令全部 PASS，无未解释 SKIP；影响域覆盖完整 |
| PASS-WITH-RISK | 域内 PASS，但有已列明且可接受的未覆盖风险（如 AI 配额、真实远端） |
| FAIL | 任一声明命令 FAIL；或实际改动超出声明未重写；或关键路径仅 SKIP |
| 升级全量 | 命中 §1.2；或失败指向共享文件/跨域契约 |

---

## 6. 全量发布门禁（唯一全量入口）

**只有本节 R1–R8 是“全量”。** 其他章节的带路径命令都是受影响域的最小集，不得替代本节；本节也不得被拆成“只跑一半”后宣称发布通过。

### 6.1 命令清单

| # | 门禁项 | 命令 | 通过标志 |
| --- | --- | --- | --- |
| R1 | TypeScript 全量类型检查 | `npx tsc --noEmit` | exit 0，无诊断 |
| R2 | Vitest 全量单测 | `npx vitest run` | 0 failed |
| R3 | Playwright 全量 e2e | `npx playwright test` | 0 failed；skip 逐条有原因（含 Electron 双入口） |
| R4 | Node 全量验证 | `node tests/run-all.js` | `ALL_PASS`，无 `FAIL_SUITES` |
| R5 | ESLint error 门禁 | `npx eslint . --quiet` | exit 0 |
| R6 | 打包白名单静态核验 | `node tests/check-pack.js` | `PACK_PASS` |
| R7 | renderer 构建 + 完整打包 | `npm run build:renderer`<br>`npm run build` | exit 0；安装器生成 |
| R8 | asar / 安装包核验 | §4.5 两条 `node -e` | `ASAR_OK` + `INSTALLER_OK` |

说明：

- R3 的 `npx playwright test` 已包含 `e2e/electron-live.spec.ts` 与 `e2e/electron-functional.spec.ts`，发布时**不重复**再跑一次双入口；只有做“核心域最小集”（§4.4）时才单独跑。
- R3 全量含 AI 真实链路 spec（`wave4-ai-live` / `wave4-b-ai`）。执行前确认 Agent 与配额；环境不满足时记录 ENV/SKIP 原因，禁止连续重试烧额度。Git 相关全量默认走本地 bare，不碰真实远端。
- R4 内部已包含 `check-pack`、`lint-guard`、`git-security`、`git-credential` 等 core 套件；R6 再显式跑一次是为了让打包白名单失败独立可见。
- R5 若仓库存在已知历史 warning，只允许 warning；出现 error 即阻断。

### 6.2 PowerShell 顺序执行

```powershell
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx vitest run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx playwright test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node tests/run-all.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx eslint . --quiet
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node tests/check-pack.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build:renderer
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node -e "const a=require('@electron/asar');const f='桌面端/win-unpacked/resources/app.asar';const l=a.listPackage(f);const need=['\\dist\\renderer\\index.html','\\dist\\renderer\\export-assets\\export-template.js','\\dist\\renderer\\export-assets\\icons.js','\\dist\\renderer\\export-assets\\export.css'];for(const p of need)if(!l.includes(p))throw new Error('missing '+p);console.log('ASAR_OK entries='+l.length)"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node -e "const fs=require('fs');const d='桌面端';const a=fs.readdirSync(d).filter(n=>/Setup.*\.exe$/i.test(n));if(!a.length)throw new Error('installer missing');const f=d+'/'+a[0];const s=fs.statSync(f).size;if(s<50*1024*1024)throw new Error('installer too small: '+s);console.log('INSTALLER_OK '+f+' bytes='+s)"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

### 6.3 CMD 顺序执行

```bat
npx tsc --noEmit && npx vitest run && npx playwright test && node tests/run-all.js && npx eslint . --quiet && node tests/check-pack.js && npm run build:renderer && npm run build
```

构建通过后，再运行 §4.5 的 asar 与安装器两条 `node -e` 命令。

### 6.4 发布判定

- R1–R8 全部通过，才允许发布/外发/交付试用。
- 任一 FAIL：停止发布，按失败域回到 §3 最小集修复；修复后**重新从 R1 跑整套**，不能只补跑失败项就发布。
- R3 的 SKIP 必须逐条写明原因；关键路径不能以 SKIP 结案。
- 发布记录必须包含：HEAD、R1–R8 结果、安装器路径与字节数、`ASAR_OK` 条目数、已知风险。

---

## 7. 常见误判

| 现象 | 正确处理 |
| --- | --- |
| “改了 store，怕影响大，直接全量” | 先查 §3.1：能列出影响域就取并集；只有契约/键格式变化才全量 |
| “只改了文案，不用跑” | 文案在组件内也要跑该域单测 + 1 条静态/真机；纯文档 `docs/**` 除外 |
| “单测过了，e2e 不用跑” | 用户可见行为必须有真机 e2e；单测不覆盖 iframe/焦点/落盘 |
| “静态契约过了，等于真机过了” | 静态只防契约漂移；真机行为以 `wave4-b-*` / `electron-*` 为准 |
| “e2e 环境不就绪，记 PASS 吧” | 记 SKIP/ENV，写原因与风险；关键路径 SKIP = 未验收 |
| “改的是测试/配置，不影响产品” | 测试/配置变更也要跑对应门禁；改 `vite/package` 归第 10 行或全量 |
| “多个包一起跑一次全量更省事” | 未受影响域不重复全量；各包按域跑，共享面才合并/升级 |
| “改了 `e2e/wave4-b-git-export.spec.ts` 的一半” | 用 `-g "B1 Git"` 或 `-g "B2/B3"` 选段，不整文件跑 |

---

## 8. 维护

- 新增 e2e/单测目录时，同步更新 §3 对应行；新增功能域时新增一行，不把新域塞进兜底。
- 新增共享文件时，先判断是否应进 §3.1；进不了就按兜底全量。
- 本文件只描述流程与映射，不替代各域验收清单、缺陷分级和发布签字。
