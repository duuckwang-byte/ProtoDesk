# 最终发布门禁报告

> **最新安装包（2026-11-18 15:51 重打包，含移动端文档默认展开 / 切 PC 关文档 / 目录独立平级 / 移动文档 z-40 / 预览 HTTP/HTTPS 放行 / 思考缓存）见 §15**；§1–§14 为历史记录，安装包数字以 §15 为准，其余门禁数字沿用 §12 与 `docs/final-gate-report-4.md`。

- 日期：2026-11-12
- 项目：原型预览工具（proto-viewer）v1.2.0
- 范围：发布前最终门禁（类型检查、单元测试、E2E、全量 Node 验证、renderer 构建、打包）
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65 / electron-builder 26.18.1
- 约束遵守：只读源码，仅写入本报告与 `docs/wave3-acceptance.md` 的 P2-1/P1-1 状态；未改 `src/`、`main/`、`tests/`、`package.json`；未执行 `npm install`；未 commit。

## 1. 门禁结果总表

| # | 门禁项 | 命令 | 结果 | 关键数字 / 说明 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript 类型检查 | `npx tsc --noEmit` | **PASS** | exit 0，无诊断输出 |
| 2 | Vitest 单元测试 | `npx vitest run` | **PASS** | 12 个测试文件，**187 passed / 0 failed**，1.86s |
| 3 | Playwright 全量（默认 8 workers） | `npx playwright test` | **FAIL** | **90 passed / 10 skipped / 1 failed / 1 did not run**（共 102）。失败为 `e2e/electron-live.spec.ts:147` 关闭项目选择器时 strict mode 命中 2 个「关闭」按钮；属测试代码并行隔离问题，非产品缺陷（见 §5） |
| 3b | Playwright 全量（串行复核） | `npx playwright test --workers=1` | **PASS** | **92 passed / 10 skipped / 0 failed**（共 102），30.9s |
| 3c | Playwright 单跑 electron-live | `npx playwright test e2e/electron-live.spec.ts` | **PASS** | 2 passed / 0 failed，10.3s |
| 4 | Node 全量验证 | `node tests/run-all.js` | **PASS** | **total=63 / pass=63 / fail=0**（core 37 + legacy-ui 26；react-ui 按设计 SKIP），`ALL_PASS(core+legacy)` |
| 5 | renderer 构建 | `npm run build:renderer` | **PASS** | exit 0；2170 modules；`index-C4RKaV0h.js` **249.00 kB**（gzip 69.57 kB）、`vendor-react-rlfG4WVh.js` 210.91 kB（gzip 65.86 kB）、`vendor-BC5zy5rY.js` 28.13 kB、`vendor-lucide-D8iz16mb.js` 16.91 kB、`vendor-zustand-Cw-nooAa.js` 0.67 kB、`rolldown-runtime-WkwZ5CU-.js` 0.59 kB、`index-CUSZohI8.css` 35.28 kB、`index.html` 1.26 kB；无 >500 kB chunk 警告（P2-4 拆包生效） |
| 6a | 打包白名单检查 | `node tests/check-pack.js` | **PASS** | `PACK_PASS: 0缺失，白名单覆盖全部运行时边` |
| 6b | 代码门禁 | `node tests/lint-guard.js` | **PASS** | `LINT_PASS`，扫描 301 个 JS/TS(TSX)，WARN 306（存量风格，不红） |
| 6c | 静态约束 | `node tests/static-verify.js` | **PASS** | `STATIC_PASS: 全部静态约束校验通过` |
| 6d | IPC 契约 | `node tests/verify-ipc.js` | **PASS** | 4/4（含 cancel 整树终止） |
| 7 | 完整打包 | `npm run build`（electron-builder） | **PASS** | exit 0；安装器 116,020,908 字节（**110.65 MiB**）；`app.asar` 65,576,231 字节（**62.54 MiB**）；asar 内含 `\dist\renderer\index.html` 及本轮 6 个新 hash JS chunk（`index-C4RKaV0h` / `vendor-react-rlfG4WVh` / `vendor-BC5zy5rY` / `vendor-lucide-D8iz16mb` / `vendor-zustand-Cw-nooAa` / `rolldown-runtime-WkwZ5CU-`），无旧 `index-*.js` 残留；本轮无 EBUSY |
| 8 | P2-1 状态复核 | 源码 + 退出实测 | **已修复** | `GCM_INTERACTIVE=never` 等非交互环境、`activeGitChildren` 集合、三处退出兜底均存在；打开 Git 面板后退出 `exit:0`，首轮 **927ms**（另两轮 315/342ms） |
| 9 | P1-1 状态复核 | 源码 + 既有真机记录 | **保留“已修复”** | `DocsPanelHost.tsx` 移动端 inline 分支 `relative z-50` 仍在；功能验收步骤 5「移动端直接点击成功」记录有效 |

### 新增 P0 / P1

- **无新增 P0，无新增 P1。**
- P2-1 由 P2 转为“已修复”；P1-1 维持“已修复”；**P2-2 已于 2026-11-13 修复（安装器 110.65 → 91.16 MiB），见 §9**。
- 剩余未修复 P2 为图标/签名（P2-3）；单 chunk 超限（P2-4）已修复，均不阻断内部/试用交付。
- 另有 1 项**测试代码**并行隔离问题（P2-T1），不进入产品缺陷清单，不阻断发布（见 §5）。

## 2. 安装包信息

> **本节为 2026-11-12 历史记录；当前安装包（2026-11-17 16:31 重打包）见 §14。**

| 项目 | 路径 / 值 | 大小 | 时间 |
| --- | --- | --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe` | 116,020,908 bytes / **110.65 MiB** | 2026-11-12 21:26:19 |
| 安装器 blockmap | `桌面端/原型工具 Setup 1.2.0.exe.blockmap` | 121,962 bytes | 2026-11-12 21:26:24 |
| 免安装主程序 | `桌面端/win-unpacked/原型工具.exe` | 204,521,984 bytes | 2026-11-12 21:25:52 |
| app.asar | `桌面端/win-unpacked/resources/app.asar` | 65,576,231 bytes / **62.54 MiB** | 2026-11-12 21:25:52 |
| renderer 入口 | asar 内 `\dist\renderer\index.html` | 1,261 bytes | 2026-11-12 21:25:27 |
| renderer 主 entry | asar 内 `\dist\renderer\assets\index-C4RKaV0h.js` | 249,008 bytes | 2026-11-12 21:25:27 |
| renderer vendor-react | asar 内 `\dist\renderer\assets\vendor-react-rlfG4WVh.js` | 210,917 bytes | 2026-11-12 21:25:27 |
| renderer vendor | asar 内 `\dist\renderer\assets\vendor-BC5zy5rY.js` | 28,132 bytes | 2026-11-12 21:25:27 |
| renderer vendor-lucide | asar 内 `\dist\renderer\assets\vendor-lucide-D8iz16mb.js` | 16,910 bytes | 2026-11-12 21:25:27 |
| renderer vendor-zustand | asar 内 `\dist\renderer\assets\vendor-zustand-Cw-nooAa.js` | 676 bytes | 2026-11-12 21:25:27 |
| renderer runtime | asar 内 `\dist\renderer\assets\rolldown-runtime-WkwZ5CU-.js` | 599 bytes | 2026-11-12 21:25:27 |
| renderer CSS | asar 内 `\dist\renderer\assets\index-CUSZohI8.css` | 35,282 bytes | 2026-11-12 21:25:27 |

- asar 顶层内容与上轮一致：`node_modules / app.css / design-specs / dist / git / js / main.js / main / package.json / platform / preload.js / providers / runtimes / toolPrompt.md / 原型+文档.html`。
- asar 内 renderer 资源共 **11 条**：`dist/renderer` 下 7 个 assets（6 JS + 1 CSS）、`index.html`、`export-assets` 三件；`index.html` 引用的 `index-C4RKaV0h.js`、`rolldown-runtime-WkwZ5CU-.js`、`vendor-react-rlfG4WVh.js`、`vendor-BC5zy5rY.js`、`vendor-lucide-D8iz16mb.js`、`vendor-zustand-Cw-nooAa.js` 全部在 asar 内。
- SHA-256 逐文件比对：上述 11 条 **11/11 MATCH**，asar 内文件与本轮 `dist/renderer` 构建产物字节一致（含 `index.html` 1,261 bytes）。
- **无旧 `index-*.js` 残留**：asar 的 `dist/renderer/assets` 仅含上表 7 个文件，未发现上轮 `index-B4ralKp-.js`；`node_modules/tsx/dist/index-*.mjs` 属运行时依赖，不计入 renderer 资源。
- 与上轮打包相比：安装器 +493 bytes（116,020,415 → 116,020,908），`app.asar` +1,785 bytes（65,574,446 → 65,576,231），差异来自 `index.html` 的 modulepreload 标签及新 hash 文件名。
- 构建日志仍提示：`default Electron icon is used`、`no code signing certificate configured`；`signAndEditExecutable: false` 导致图标/版本资源编辑与签名同时跳过。对应 P2-3，未在本轮修复。
- 本轮打包前检查无 `原型工具.exe` / `electron` 打包版进程占用，未出现 EBUSY、未重试、未强杀任何用户进程。

## 3. P2-1 / P1-1 复核

### P2-1 Git 子进程收尾（已修复）

- **非交互环境**：`main/services/git-workflow-service.js` 定义 `GIT_NONINTERACTIVE_ENV`，强制 `GCM_INTERACTIVE=never`、`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS=echo`、`SSH_ASKPASS=echo`；`buildGitChildEnv()` 将强制项放在调用方 env 之后，调用方无法覆盖。
- **活跃子进程集合**：`activeGitChildren = new Set()`；spawn 即 `trackGitChild()` 登记，close/error/超时/取消统一 `untrackGitChild()` 注销，并兼容维护 `shared.gitCurrentChild`。
- **三处退出兜底**（`main.js`）：
  1. `window-all-closed` → `cleanupGitChildrenSync()` 同步回收后 `app.quit()`；
  2. `before-quit` → `preventDefault()`，异步 `cleanupGitChildren()`，2s 兜底定时器后再次 `app.quit()`；
  3. `process.on('exit')` → `cleanupGitChildrenSync()` 同步回收。
  以上只终止本进程 spawn 的 git 子进程树，不碰无关进程。
- **退出实测**：React 模式打开 Git 面板并停留后关闭窗口，3 次均收到 `exit:0`，退出耗时 **927ms / 315ms / 342ms**（首轮 927ms 与既有修复记录 902–1073ms 区间一致；修复前为 6–20s 收不到 close、teardown 30s 兜底）。
- 结论：P2-1 **已修复**；`docs/wave3-acceptance.md` E 表已同步。

### P1-1 移动端文档遮挡（保留已修复）

- `src/renderer/components/shell/DocsPanelHost.tsx:86` 移动端 inline 分支仍为 `relative z-50`，文档层压过 `overlays-toolbar`。
- `docs/wave3-functional-report.md` 步骤 5 记录：移动端「最新需求」Tab 直接点击成功，命中测试落在 `docs-panel` 内部。
- 结论：P1-1 **保持“已修复”**，本轮无回退。

## 4. 剩余 P2 与阻断结论

| 编号 | 问题 | 本轮证据 | 是否阻断发布 | 建议 |
| --- | --- | --- | --- | --- |
| P2-2 | 打包体积膨胀 | **已修复（2026-11-13）**：按 `docs/packaging-size-analysis.md` 方案 B 实施；安装器 **110.65 → 91.16 MiB（−19.49 MiB / −17.6%）**，`app.asar` **62.54 → 9.15 MiB（−85.4%）**，`app.asar.unpacked` 34.17 → 6.45 MiB，语言包 55 → 2；`dependencies` 仅保留 `acpx`，详见 §9 | **否（已消除）** | 后续如新增运行时依赖，复核 `build.files` 负向模式与 `asarUnpack`；真机 AI 问答回归建议补一次 |
| P2-3 | 安装包缺图标且未签名 | 构建日志 `default Electron icon is used`、`no code signing certificate configured`；`signAndEditExecutable: false` | **否（内部/试用）**；**外发前建议修复** | 配置 `win.icon`；外发前配置代码签名；如需保留自定义元数据改用 `signExecutable: false` |
| P2-4 | renderer 单 chunk 超 500 kB | **已修复（2026-11-12）**：`vite.config.ts` 增加 `manualChunks`，拆为 `vendor-react` 210.91 kB / `index` 249.00 kB / `vendor` 28.13 kB / `vendor-lucide` 16.91 kB / `vendor-zustand` 0.67 kB（+ 0.59 kB runtime）；主 entry **249.00 kB < 400 kB**，最大 chunk **210.91 kB < 500 kB**，无 >500 kB 警告；JS 合计 gzip 146.58 kB（拆分前 148.49 kB，未增大） | **否（已消除）** | 已用 `build.rollupOptions.output.manualChunks` 按依赖拆包，业务代码仍为单一 chunk；后续新增重依赖时复核主 entry 体积 |

### 阻断结论

- **不阻断内部/试用交付**：类型、单测、Node 全量、renderer 构建、electron-builder 打包均通过；P0/P1 为 0。
- **外发前建议先处理 P2-3（图标/签名）**，否则 Windows 首次运行会触发 SmartScreen 提示且无品牌图标；P2-2 可与后续版本优化（P2-4 已修复）。
- 若发布流程要求“Playwright 默认并行全绿”，需先修复 P2-T1（测试代码），否则默认 `npx playwright test` 会因状态互扰出现 1 failed。串行与单跑均全绿，不影响产品可用性。

## 5. 门禁异常说明（P2-T1，测试代码）

- 现象：默认 8 workers 全量运行时，`e2e/electron-live.spec.ts:147` 失败：
  `getByRole('button', { name: '关闭', exact: true })` 同时命中项目选择器底部「关闭」按钮与右上角 `aria-label="关闭"` 的 X 按钮，触发 Playwright strict mode violation。
- 触发条件：`electron-live` 与 `electron-functional` 并行启动，两个 Electron 实例共用开发态 `.devdata`；本轮并行运行时 `electron-live` 冷启动出现项目选择器，单跑/串行时未出现。
- 复核：`npx playwright test --workers=1` → 92 passed / 10 skipped / 0 failed；`npx playwright test e2e/electron-live.spec.ts` → 2 passed。
- 定性：**测试代码并行隔离与选择器健壮性问题，不是产品缺陷，不计入产品缺陷分级（P0/P1/P2）**。建议后续为每个 worker 指定独立 `userData`，或将选择器限定到 `project-picker` 容器内；本轮受“只读源码、禁改 tests/e2e”约束未修改。

## 6. 默认入口与 legacy 回滚

| 场景 | 命令 / 规则 |
| --- | --- |
| 默认入口 | `npm start` → **React**（`dist/renderer/index.html`） |
| 显式 React | `npm run start:react` |
| 临时回滚 legacy | `npm run start:legacy` |
| PowerShell 回滚 | `$env:PLAND_RENDERER='legacy'; npx electron .` |
| 启动参数回滚 | `npx electron . --renderer=legacy`（即 `?renderer=legacy`） |
| 恢复默认 | `Remove-Item Env:PLAND_RENDERER`（或直接 `npm run start:react`） |
| 产物缺失自动回退 | React 模式下 `dist/renderer/index.html` 不存在 → 打印告警并自动加载 `原型+文档.html` |
| 版本级回滚 | 将 `main.js` 与 `main/controllers/window-controller.js` 中 `getRendererMode()` 默认值 `'react'` 改为 `'legacy'`，重新 `npm run build` |

- 主窗与 `?docwin=1` 文档窗使用同一入口规则；legacy 文件 `原型+文档.html` 仍在 asar 内。

## 7. 交付建议

1. **内部/试用**：可直接交付本轮 `桌面端/原型工具 Setup 1.2.0.exe`（110.65 MiB）；默认 React，legacy 可一键回退。
2. **外发前**：优先配置 `win.icon` 与代码签名（P2-3），再重新执行 `npm run build` 并复核安装器体积/asar；P2-2 体积优化已于 2026-11-13 完成（安装器 91.16 MiB，详见 §9），无需再清理依赖。
3. **性能**：P2-4 已通过 `manualChunks` 拆包消除 506 kB 单 chunk 警告（主 entry 249.00 kB、最大 chunk 210.91 kB），后续新增重依赖时复核主 entry 体积。
4. **CI**：修复 e2e 并行隔离与「关闭」选择器（P2-T1），使默认 `npx playwright test` 稳定全绿；在修复前，发布门禁使用 `--workers=1` 或分 spec 串行执行。
5. **发版记录**：`docs/wave3-acceptance.md` 已同步 P2-1 为“已修复”；本报告作为最终门禁与交付依据。

## 8. 证据与限制

- §1 门禁结果为本轮最终门禁执行记录；其中第 5/7 项与安装包/asar 内容以 P2-4 重打包 `npm run build`（2026-11-12 21:25–21:26）为准。
- asar 校验使用 `@electron/asar` 的 `extractFile` 逐文件读取并计算 SHA-256，与本地 `dist/renderer` 同名文件比对；未修改 asar 内任何文件或源码。
- `npx vitest run` 有 Vite 配置加载器提示（`vitest.config.ts` ESM in CommonJS），不影响测试结果，属工具链提示。
- Playwright 默认并行失败为测试代码问题，已通过串行全量与单 spec 复核，未修改任何测试或业务代码。
- P2-1 退出耗时为本机 3 次实测（927/315/342ms）；不同机器与 Git 远端状态可能有差异，但均远低于 15s 上限。

## 9. P2-2 体积优化实施（2026-11-13）

- 方案依据：`docs/packaging-size-analysis.md` **方案 B**（零运行时代码改动）；实施记录与逐项证据见该文档 **§11**。
- 改动范围：`package.json`、`package-lock.json`（旧 lock 为陈旧文件，已用 `npm install --package-lock-only --ignore-scripts` 同步为 661 包）；未改 `src/`、`main/`、`tests/`；未执行完整 `npm install`；未 commit。
- 配置：`dependencies` 仅保留 `acpx@0.22.0`，10 个前端/构建期包移入 `devDependencies`；`build.electronLanguages=["zh-CN","en-US"]`；`build.files` 追加 9 条 `!**/node_modules/...` 负向模式；`asarUnpack` 保持 acpx / `@agentclientprotocol` 不变。

### 9.1 体积对比

| 项 | 优化前（2026-11-12） | 优化后（2026-11-13） | 变化 |
| --- | ---: | ---: | ---: |
| NSIS 安装器 | 116,020,908 B / 110.65 MiB | 95,587,074 B / **91.16 MiB** | **−19.49 MiB（−17.6%）** |
| `app.asar` | 65,576,231 B / 62.54 MiB | 9,590,025 B / **9.15 MiB** | −53.39 MiB（−85.4%） |
| `app.asar.unpacked` | 34.17 MiB / 554 文件 | **6.45 MiB / 388 文件** | −27.72 MiB（−81.1%） |
| `locales/*.pak` | 55 个 | **2 个**（zh-CN、en-US） | −53 个 |

- 比方案 B 预算（95.3 MiB）再低 4.1 MiB，主要来自 `!**/node_modules/@esbuild/**`（构建期原生二进制，运行时 import 图不经过）。

### 9.2 回归结果

| 项 | 命令 | 结果 |
| --- | --- | --- |
| renderer 构建 | `npm run build:renderer` | **PASS**（`index-Cv5UVz7h.js` 309.21 kB，vendor-react 210.91 kB） |
| 完整打包 | `npm run build` | **PASS**（无 EBUSY、无强杀进程） |
| Electron E2E | `npx playwright test e2e/electron-live.spec.ts` | **PASS**，2 passed / 0 failed |
| IPC 契约 | `node tests/verify-ipc.js` | **PASS**，4/4 |
| asar 内容核验 | `dist/renderer/index.html`、acpx runtime、`@agentclientprotocol/sdk`、fs-safe `.node`/`.wasm`、zod | **全部在包内**；`*.map`、react-dom、lucide、tailwind 链、`@esbuild`、`zod/src` 均为 0 |
| 打包白名单门禁 | `node tests/check-pack.js` | **FAIL（脚本限制）**：第 45 行只允许含 `.bak` 的负向模式，新增 `!**/node_modules/**` 规则必然被判失败；建议改为 `n.includes('.bak') || n.startsWith('!**/node_modules/')`（本轮受"不改 tests"约束未动） |

- 遗留：建议补一次真机 AI 问答回归（真实 agent 提问 + 模型列表），最终确认 `@esbuild` 裁剪无影响；P2-3 图标/签名仍待处理。
- 本轮 `dist/renderer` hash/体积与 2026-11-12 不同（主 entry 249.00 → 309.21 kB），系两次构建之间源码变更，与依赖归位无关，仍满足 P2-4 阈值。

---

## 10. 最终全量门禁复验与放行结论（2026-11-13）

> 本节为最终口径，**取代** §1 表中第 3/3b/6a/7 行与 §5（P2-T1）、§9.2 最后一行的历史记录。
> 完整逐项证据、真机步骤与 P0/P1 对照见 **`docs/final-gate-report.md`**。

### 10.1 复验结果

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript | `npx tsc --noEmit` | **PASS** | exit 0 |
| 2 | Vitest | `npx vitest run` | **PASS** | 14 文件 / **250 passed** / 0 failed |
| 3 | Playwright 全量 | `npx playwright test` | **PASS** | **93 passed / 10 skipped / 0 failed**（共 103），42.9s |
| 4 | Node 全量 | `node tests/run-all.js` | **PASS** | **63/63**，`ALL_PASS(core+legacy)` |
| 5 | renderer + 打包 | `npm run build:renderer` + `npm run build` | **PASS** | 安装器 **95,587,069 B / 91.16 MiB**；`app.asar` **9,590,025 B / 9.15 MiB**；unpacked 388 文件 / 6.45 MiB；语言包 2 |
| 6 | Electron 真机 | `npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts` | **PASS** | **4 passed / 0 failed**（React 9 步 + P0/P1 复核 + legacy 回退） |
| 7 | 打包白名单门禁 | `node tests/check-pack.js` | **PASS** | `PACK_PASS: 0缺失`；153 条 PASS / 0 FAIL（原脚本限制已修复） |
| 8 | 就地改门禁 | `node tests/verify-inline-edit.js` | **PASS** | `passed=24 failed=0`（A10 已支持 6 条 `.bak` + 9 条 node_modules 剪枝） |
| 9 | ESLint error | `npx eslint . --quiet` | **PASS** | exit 0（`dialog` per-file 例外已移除） |

- 注：本节安装器 95,587,069 B 为本次复验重打包结果，与 §9.1 记录的 95,587,074 B 相差 5 B，属重打包压缩/时间戳抖动，体积口径一致（91.16 MiB）。

### 10.2 asar 关键内容

- `\dist\renderer\index.html` + `export-assets/{export-template.js,icons.js,export.css}` 均在包内。
- `node_modules/acpx/dist/runtime.js`（acpx 17 文件）、`node_modules/@agentclientprotocol/**`（56 文件）、`@openclaw/fs-safe-win32-x64-msvc/fs-safe-native.node` 均在包内。
- `*.map=0`；`node_modules/**/*.md=0`；`node_modules/**/{test,tests,__tests__}/**=0`；`zod/src=0`；`@esbuild=0`。

### 10.3 缺陷与放行

- **P0/P1：0**。`docs/wave3-functional-report.md` 列出的 P1（移动端文档遮挡）及本轮 UI 定稿项（浮层 portal、AI 单选择器/无 `acp_catalog`、设置 32px/CLI-API、侧栏三层拖拽、Git 660 Dialog、文档 Markdown/目录、顶栏终端/刷新/项目切换）全部复验 PASS。
- **P2-T1（测试并行隔离）不再复现**：`playwright.config.ts` 固定 `workers: 1`，且项目选择器关闭按钮已限定在 `project-picker` 容器内；默认 `npx playwright test` 即全绿。
- **剩余未修复：仅 P2-3（图标/签名）**，不阻断内部/试用交付；外发前配置 `win.icon` 与代码签名并重跑 `npm run build`。
- **最终结论：可交付（内部/试用），无需返工。**

---

## 11. 第二轮最终全量门禁（2026-11-13，最终口径）

> 本节取代 §10 及 §1/§3/§5/§9 的历史数字；完整逐项证据、真机步骤与 P0/P1/P2/P3 清单见 **`docs/final-gate-report-2.md`**。

### 11.1 门禁结果

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript | `npx tsc --noEmit` | **PASS** | exit 0 |
| 2 | Vitest | `npx vitest run` | **PASS** | **46 文件 / 525 passed / 0 failed**，6.82s |
| 3 | Node 全量 | `node tests/run-all.js` | **PASS** | **64/64**，`ALL_PASS(core+legacy)`，react-ui SKIP |
| 4 | Playwright 全量 | `npx playwright test --workers=1` | **PASS** | **121 tests：111 passed / 10 skipped / 0 failed**，8.4m |
| 5 | renderer + 打包 | `npm run build:renderer` + `npm run build` | **PASS** | 主 entry **381.01 kB**（<500 kB）；安装器 **95,616,015 B / 91.19 MiB**；`app.asar` **9,721,529 B / 9.27 MiB**；unpacked 388 文件 / 6.45 MiB；语言包 2 |
| 6 | asar 核验 | `@electron/asar` | **PASS** | `dist/renderer/index.html` + 3 个 export-assets + 6 JS/1 CSS 全在；acpx 16 条、ACP SDK 55 条；`*.map=0`、`node_modules/**/*.md=0` |
| 7 | 重点域真机 | `e2e/wave4-b-ai`、`b-pick`、`b-docs`、`b-settings`、`b-shell-stage`、`b-git-export` | **PASS** | **8 passed / 0 failed**，独立 `.devdata-wave4-*`，3.4m |
| 8 | 既有真机 | `e2e/electron-live.spec.ts e2e/electron-functional.spec.ts` | **PASS** | **4 passed / 0 failed**（React 9 步 + P0/P1 复核 + legacy 回退） |
| 9 | ESLint error | `node tests/lint-guard.js` | **PASS** | `LINT_PASS`，362 文件，WARN 333（存量风格） |

### 11.2 重点域结论

- **AI**：无会话列表/新建/切换；真实发送 1 条，`assistant 气泡 max=1 / final=1`；无 `acp_catalog` 泄漏；Markdown/代码块正常；模型 Popover 1024 右边界 961<1014、下边界 592<738；问题卡提交回传正常。
- **Ctrl 拾取**：Ctrl 需求框提交入队、Ctrl+Shift 修改框保存/取消、普通点击不弹；选中框滚动/75%/125% 缩放漂移均 <1px；Sheet 焦点陷阱与 Esc 回归正常。
- **文档**：PC 1200 / 移动 640（窄窗 70%=552.3）；移动目录关闭后 `opacity=0`、pointer-events=none、面板外不可命中；目录 24px/高亮/滚动跳转正常；切 Tab/原型/面板/独立窗草稿守卫全 PASS；docwin mirror 与导出 HTML 文档区（3245 字符、4 表格、`<br>`=0）正常。
- **设置**：侧栏唯一入口；6 Tab；Agent 26 行 / ACP 20；Select 三项可见可点并落盘；焦点陷阱、Esc 单层、1024 布局全 PASS。
- **Git/导出/快照**：本地 bare push/pull/diff/自愈/upstream 全 PASS，无 GCM/孤儿进程；JSON/HTML/MD/PNG-PDF 取消 5 项全 PASS；快照 2 版本筛选/恢复 Confirm/undo 备份全 PASS。

### 11.3 缺陷与放行

- **P0/P1：0**。未发现需要停止验收/返工的产品缺陷；未修改 `src/**`、`main/**`、`tests/**`、`package.json`。
- **P2-3（唯一确定的产品 P2）**：安装包无自定义图标、未签名；构建日志 `default Electron icon is used`、`no code signing certificate configured`。内部/试用不阻断；**外发前必须处理**。
- **P2-5（待复核）**：同一数据域先跑 B1 Git 全链路后，B1 遗留的本地 bare remote 被删除；B2 打开 Git 出现 `GIT_URL_BLOCKED`，长链路曾伴随页面无响应。B2 单独运行 / 重新 seed 隔离后 13 步全 PASS；不排除测试长链路/截图环境因素，列观察不阻断。
- **P3**：待提交条目 `page` 为空；快照面板无删除入口；差异预览默认只展开当前项目；seed 原型 Vant/CDN 噪声；模型下拉 2/3 项随配置变化。均不阻断。
- **最终结论：可交付（内部/试用），无需返工。** 外发前处理 P2-3 并复核 P2-5。

---

## 12. 第三轮全量门禁 · Ctrl 拾取重做 / 模型固定宽度 / AI 去会话列表（2026-11-16）

> 取替 §11 的 1/2/3/4/5/6/8/9 历史数字，新增证据与缺陷见 **`docs/final-gate-report-3.md`**。

### 12.1 门禁结果

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript | `npx tsc --noEmit` | **PASS** | exit 0 |
| 2 | Vitest | `npx vitest run` | **PASS** | **47 文件 / 557 passed / 0 failed**，7.71s |
| 3 | Node 全量 | `node tests/run-all.js` | **PASS** | **64/64**，`ALL_PASS(core+legacy)`，react-ui SKIP |
| 4 | Playwright 全量 | `npx playwright test --workers=1` | **PASS** | **121 tests：111 passed / 10 skipped / 0 failed**，8.2m |
| 5 | renderer 构建 | `npm run build:renderer` | **PASS** | 2171 modules；entry **385.39 kB**（gzip 109.30）；CSS 50.00 kB；无 >500 kB chunk |
| 6 | 安装包 | `npm run build` | **PASS** | 安装器 **95,617,889 B / 91.19 MiB**；`app.asar` **9,726,319 B / 9.28 MiB** |
| 7 | asar 内容 | `@electron/asar` + 目录统计 | **PASS** | renderer 13 / export-assets 3 / acpx 16 / ACP SDK 55；`*.map=0`、`node_modules/**/*.md=0` |
| 8 | 打包白名单 | `node tests/check-pack.js` | **PASS** | `PACK_PASS: 0缺失` |
| 9 | 种子重建 | `seed.mjs --rebuild-seed` | **PASS** | files=110 / bytes=1,079,381 / sourceUnchanged=true |

10 条 skipped 均为需 `PLAND_E2E_APP_URL` 的真机静态门，不是产品失败。

### 12.2 重点结论

- **Ctrl 拾取**：按住 Ctrl 连点 3 个期间零弹窗；松开需求条 chips=3；统一需求提交为 1 条 `batchParts=3`。单元素露出“标注/交互”轻面板，不打开 Inspector Sheet。
- **Ctrl+Shift**：按住连点 2 个选择始终为 1；松开仅出现 1 个修改文字弹窗；取消不写队列、保存按“将该元素内容改为：…”入队。普通点击不弹。
- **模型/思考固定宽度**：触发器实测 **200 / 150 px**，浮层 **448 px**（双列 245.998 / 200 px）；切换 DeepSeek/Muse、长文案不改变宽度。
- **AI**：`ai-session-list/new/切换` 均为 0；思考初始 `probing`（探测中…），切换模型后 `probing → ready`，真实档位 4 个。
- **选中框同步**：滚动/75%/125% 缩放偏差均 <1px（0.0030–0.0064 px）。

### 12.3 缺陷与放行

- **P0/P1：0**。未修改 `src/**`、`main/**`、`tests/**`、`package.json`；未 `npm install`；未 commit。
- **P2-3（既有，外发前必须处理）**：安装器默认图标、未签名。
- **P2-6（新）**：长链路/全量套件后 `window-all-closed` 偶发不退出，harness 以 kill 收尾；功能断言全 PASS，建议主进程排查退出清理。
- **P2-7（新）**：需求条同时打开时，检查器 Sheet Esc 关闭后焦点回落 `BODY`，未回到触发按钮。
- **P2-8（新）**：模型管理快速连续勾选存在异步保存竞态；e2e 已串行等待，建议产品侧保存串行化/版本号。
- **P2-5（沿用观察）**：同一进程 B1→B2 时 Git remote 失效，属测试编排观察，非本轮回归。
- **最终结论：可交付内部/自用验收，无需返工。** 外发前处理 P2-3，并复核 P2-6/P2-7/P2-8。

---

## 13. 第四轮源码重打包与安装包校验（2026-11-17 15:05，已被 §14 取代）

> 本节为第四轮历史记录，**已被 §14 取代**（§14 的安装器包含预览 HTTP/HTTPS CSP 放行）；其余门禁数字沿用 §12 与 `docs/final-gate-report-4.md`。

### 13.1 重打包原因与源码基线

- 第四轮（`docs/final-gate-report-4.md`，2026-11-16）只执行了 `npm run build:renderer`（16:34 产出 `index-CuKZsX_t.js`），安装器仍是第三轮 11:04 的产物，落后于最新源码。
- 本轮以当前工作区源码重打包：HEAD `77192ddb21157d3aebca12167dd8563c1da4d31d`，工作区含 140 项未提交改动；**未 commit、未 `npm install`、未改 `src/**`、`main/**`、`tests/**`、`package.json`**，仅更新本报告。
- 构建命令 `npm run build`（先 `build:renderer` 再 `electron-builder --win --x64`），**exit 0**，2026-11-17 15:05:11 → 15:05:50（39s）；2170 modules，无 >500 kB chunk 警告。
- 重构建产出 hash 与构建前 `dist/renderer` 完全一致（`index-CuKZsX_t.js` 391,526 B、`index-rSM-A3L2.css` 50,073 B 等），说明 16:34 的 dist 已是最新源码产物，本次仅把安装包同步到该 dist。
- 打包前确认无 `原型工具.exe` / `electron.exe` 运行；**无 EBUSY、未重试、未强杀任何进程**。

### 13.2 安装包信息（当前）

| 项目 | 路径 | 大小 | 时间 |
| --- | --- | --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe` | **95,625,251 B / 91.20 MiB** | 2026-11-17 15:05:45 |
| 安装器 SHA-256 | 同上 | `C7DF4436A6F6A1C6A5D924D03A7EC1A5A8649EF824385CA9FED0206F1E684C4A` | — |
| 安装器 blockmap | `桌面端/原型工具 Setup 1.2.0.exe.blockmap` | 101,427 B | 2026-11-17 15:05:49 |
| 免安装主程序 | `桌面端/win-unpacked/原型工具.exe` | 204,521,984 B | 2026-11-17 15:05:29 |
| app.asar | `桌面端/win-unpacked/resources/app.asar` | **9,763,819 B / 9.31 MiB** | 2026-11-17 15:05:29 |
| app.asar SHA-256 | 同上 | `1B203D791A6661258FB181BC88885693707AB9F4504F6B03313EC2669E18C6B7` | — |
| app.asar.unpacked | `桌面端/win-unpacked/resources/app.asar.unpacked` | 388 文件 / 6.45 MiB | 2026-11-17 15:05:28 |
| 语言包 | `桌面端/win-unpacked/locales/*.pak` | 2 个（zh-CN、en-US） | — |

- 与第三轮（95,617,889 B / 9,726,319 B）相比：安装器 **+7,362 B**、`app.asar` **+37,500 B**，差异来自 renderer entry 由 385.39 kB 增至 391.52 kB（第四轮思考强度缓存/预热改动）。
- 构建日志仍为 `default Electron icon is used`、`no code signing certificate configured`，属既有 P2-3，未在本轮处理。

### 13.3 asar 内容与 dist 校验（全部 PASS）

- asar 条目 **1,354**（文件 1,209 + 目录 145）；`dist/renderer` 资源 **11 条**：7 个 assets（6 JS + 1 CSS）、`index.html`、`export-assets` 三件。
- `index.html`（1,261 B）引用 **7 个资源，7/7 在包内且 SHA-256 与本地一致**：

| 引用 | 字节 | SHA-256（前 12 位） |
| --- | ---: | --- |
| `assets/index-CuKZsX_t.js` | 391,526 | `DBB9D9723EAA` |
| `assets/rolldown-runtime-WkwZ5CU-.js` | 599 | `2629F2AD3CB7` |
| `assets/vendor-react-CowwHW-4.js` | 210,917 | `FC390F43AC66` |
| `assets/vendor-lucide-izHE6NvF.js` | 19,978 | `B6CE275C62A0` |
| `assets/vendor-BC5zy5rY.js` | 28,132 | `0D5D4E8D6A7A` |
| `assets/vendor-zustand-Vq1ERVeh.js` | 676 | `0CD720C02BA1` |
| `assets/index-rSM-A3L2.css` | 50,073 | `50B56680AE79` |

- `dist/renderer` 全量 **11/11 SHA-256 MATCH**（含 `index.html`、3 个 export-assets）；`dist/renderer` 合计 728,509 B。
- `export-assets/{export-template.js 11,166 B, icons.js 8,002 B, export.css 6,179 B}` **3/3 在包内**。
- `node_modules/acpx/dist/runtime.js` 在包内，acpx **15 条**；`@agentclientprotocol/sdk` **44 条**（仅 sdk 一个 ACP 包）。
- 裁剪校验：`*.map=0`、`node_modules/**/*.md=0`、`node_modules/**/{test,tests,__tests__}/**=0`、`zod/src=0`、`@esbuild=0`。
- 残留校验：`dist/renderer/assets` 仅 7 个当前文件，**旧 `index-*.js` 残留 = 0**。

### 13.4 Electron 双入口 E2E

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| A. React 真机（骨架 + 设置/Git/AI/导出 + Esc + 退出） | **PASS** | `exit:0@6962ms；close@6962ms`，14.1s |
| B. legacy 回退（`原型+文档.html` + 旧顶栏 + 退出） | **PASS** | `exit:0@261ms；close@261ms`，1.2s |
| 汇总 `npx playwright test e2e/electron-live.spec.ts` | **2 passed / 0 failed** | 15.7s，exit 0 |

- 仅采集到 3 条 console error，均为 seed 原型 Vant CDN 的 CSP/语法噪声（`cdn.jsdelivr.net`、`vant`、`Unexpected token '.'`），属 spec 既有忽略项，非产品错误。
- 用例会重写 `docs/wave3-react-live.png`；运行后已按原字节还原（SHA-256 `BD00C1908AB1D9…`，178,394 B），`docs/` 除本报告外无净变更。

### 13.5 放行结论

- **可交付（内部/试用）**：安装器、asar 内容、renderer 引用与双入口真机均通过，P0/P1 = 0。
- **外发前仍需处理 P2-3**（默认图标 + 未签名）；本轮未引入新缺陷，P2-6/P2-7/P2-8 观察项沿用 §12.3。
- 交付物：`桌面端/原型工具 Setup 1.2.0.exe`（95,625,251 B，2026-11-17 15:05:45）。

---

## 14. 第五轮源码重打包与安装包校验（2026-11-17 16:31，已被 §15 取代）

> 本节**取代 §2 与 §13 的安装包数字**；其余门禁数字沿用 §12 与 `docs/final-gate-report-4.md`。本轮把工作区最新源码（预览 HTTP/HTTPS CSP 放行、AI 思考缓存、Ctrl 拾取收敛）打进安装包。

### 14.1 重打包原因与源码基线

- §13 的安装器产自 15:05，其 asar 内 `dist/renderer/index.html` 仍是 **1,261 B 的旧 entry**（对应 `docs/preview-network-policy.md` §2.1 的变更前 CSP：仅 `img-src`/`frame-src`/`style-src`/`connect-src` 四条，无 `http:`/`https:` 放行）；此后 `src/renderer/index.html` 的 CSP 已按该文档放行任意 HTTP/HTTPS 资源，但未重新打包，故本轮重打。
- 源码基线：HEAD `77192ddb21157d3aebca12167dd8563c1da4d31d`，工作区 143 项未提交改动；**未 commit、未 `npm install`、未改 `src/**`、`main/**`、`tests/**`、`package.json`**，仅更新本报告。
- 构建命令 `npm run build`（先 `build:renderer` 再 `electron-builder --win --x64`），**exit 0**，2026-11-17 16:31:24 → 16:32:02（37.6s）；2170 modules，renderer 构建 366ms，无 >500 kB chunk 警告。
- 打包前检查：无 `原型工具.exe` / `electron.exe` 运行；对 `桌面端/win-unpacked/原型工具.exe` 与 `resources/app.asar` 做独占读写锁探测均为 **UNLOCKED**；**无 EBUSY、未重试、未强杀任何用户进程**。

### 14.2 安装包信息（当前）

| 项目 | 路径 | 大小 | 时间 |
| --- | --- | --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe` | **95,625,125 B / 91.20 MiB** | 2026-11-17 16:31:57 |
| 安装器 SHA-256 | 同上 | `A4D1BE2D590A03E5F381AB47E3013255E986A34C5E4B34784D17E8239C2351EB` | — |
| 安装器 blockmap | `桌面端/原型工具 Setup 1.2.0.exe.blockmap` | 101,495 B | 2026-11-17 16:32:02 |
| 免安装主程序 | `桌面端/win-unpacked/原型工具.exe` | 204,521,984 B | 2026-11-17 16:31:40 |
| 主程序 SHA-256 | 同上 | `BC95357B43C49CEFC43113DC618039E617FCB353609691FFD944AC97C42817B4` | — |
| app.asar | `桌面端/win-unpacked/resources/app.asar` | **9,764,444 B / 9.31 MiB** | 2026-11-17 16:31:40 |
| app.asar SHA-256 | 同上 | `31B6E80C228C50E1524C36B62E7928B3A6ACC5FF0EF8AF81F5503C1CFA7A062D` | — |
| app.asar.unpacked | `桌面端/win-unpacked/resources/app.asar.unpacked` | 388 文件 / 6,765,573 B（6.45 MiB） | 2026-11-17 16:31:39 |
| 语言包 | `桌面端/win-unpacked/locales/*.pak` | 2 个（en-US 515,663 B、zh-CN 520,877 B） | — |

- 与 §13（95,625,251 B / 9,763,819 B）相比：安装器 **−125 B**，`app.asar` **+625 B**，差额恰为 `dist/renderer/index.html` 由 1,261 B 增至 **1,886 B**（CSP 策略说明 + `http:`/`https:` 令牌）；6 个 JS chunk 与 1 个 CSS 的 hash 与 §13 完全相同，说明本轮只有 CSP entry 变化。
- `桌面端/latest.yml` 已同步：`size: 95625125`、`sha512: kOys6jHr/uANyqdy+JnF0F7PCmxigngITKfWG5U66iDtn9ifkuhfIEwPWefZDysauJEoWaRKFRLybMPw3J2SeQ==`、`releaseDate: 2026-11-17T08:32:02.433Z`（= 本地 16:32:02 +08:00）。
- 构建日志仍为 `default Electron icon is used`、`no code signing certificate configured`，属既有 P2-3，未在本轮处理。

### 14.3 CSP 校验（本次改动已进包）

- asar 内 `dist/renderer/index.html`（1,886 B）含 `http-equiv="Content-Security-Policy"`，**同时包含 `http:` 与 `https:`**：`http:` 10 处（9 条指令 + `http://localhost:5173`），`https:` 9 处。
- 9 条网络类指令全部放行 HTTP/HTTPS：

| 指令 | 值 |
| --- | --- |
| `script-src` | `'self' 'unsafe-inline' https: http: http://localhost:5173` |
| `style-src` | `'self' 'unsafe-inline' https: http:` |
| `font-src` | `'self' data: https: http:` |
| `img-src` | `'self' data: blob: proto-asset: https: http:` |
| `connect-src` | `'self' https: http: wss: ws://localhost:5173` |
| `frame-src` | `'self' data: blob: https: http:` |
| `media-src` | `'self' data: blob: https: http:` |
| `worker-src` | `'self' blob: https: http:` |
| `form-action` | `'self' https: http:` |

- 未新增 `object-src` 等危险指令；iframe `sandbox` 与主进程 `webSecurity` 未放宽，与 `docs/preview-network-policy.md` 一致。
- 对比 §13 包内 1,261 B 的旧 `index.html`（`docs/preview-network-policy.md` §2.1 的 4 条变更前 CSP，无 scheme 放行），本轮 entry +625 B 且 CSP 指令带放行令牌，**证明预览 HTTP/HTTPS 改动确已进包**。

### 14.4 asar 内容与 dist 校验（全部 PASS）

- asar 条目 **1,354**（文件 1,209 + 目录 145）；`dist/renderer` 资源 **11 条**：7 个 assets（6 JS + 1 CSS）、`index.html`、`export-assets` 三件。
- `index.html` 引用 **7 个资源，7/7 在包内且 SHA-256 与本地一致**：

| 引用 | 字节 | SHA-256（前 12 位） |
| --- | ---: | --- |
| `assets/index-CuKZsX_t.js` | 391,526 | `DBB9D9723EAA` |
| `assets/rolldown-runtime-WkwZ5CU-.js` | 599 | `2629F2AD3CB7` |
| `assets/vendor-react-CowwHW-4.js` | 210,917 | `FC390F43AC66` |
| `assets/vendor-lucide-izHE6NvF.js` | 19,978 | `B6CE275C62A0` |
| `assets/vendor-BC5zy5rY.js` | 28,132 | `0D5D4E8D6A7A` |
| `assets/vendor-zustand-Vq1ERVeh.js` | 676 | `0CD720C02BA1` |
| `assets/index-rSM-A3L2.css` | 50,073 | `50B56680AE79` |

- `dist/renderer` 全量 **11/11 SHA-256 MATCH**（含 `index.html` `C7AB34D3D074…`、3 个 export-assets）；合计 729,134 B；asar 内无本地不存在的 `dist/renderer` 多余文件。
- `export-assets/{export-template.js 11,166 B, icons.js 8,002 B, export.css 6,179 B}` **3/3 在包内且 hash 一致**。
- `node_modules/acpx` **15 文件**（含 `dist/runtime.js` 105,845 B）；`@agentclientprotocol/sdk` **44 文件**（`dist/acp.js` 66,907 B），无其它 ACP 包；`app.asar.unpacked` 内同名 runtime/acp.js 均存在。
- 裁剪校验：`*.map=0`、`node_modules/**/*.md=0`、`node_modules/**/{test,tests,__tests__}/**=0`、`zod/src=0`、`@esbuild=0`、`*.bak=0`。
- 残留校验：`dist/renderer/assets` 仅 7 个当前文件，**旧 `index-*.js` 残留 = 0**。

### 14.5 Electron 双入口 E2E

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| A. React 真机（骨架 + 设置/Git/AI/导出 + Esc + 退出） | **PASS** | `exit:0@7445ms；close@7445ms`，14.8s |
| B. legacy 回退（`原型+文档.html` + 旧顶栏 + 退出） | **PASS** | `exit:0@302ms；close@302ms`，1.5s |
| 汇总 `npx playwright test e2e/electron-live.spec.ts` | **2 passed / 0 failed** | 17.1s，exit 0 |

- 仅采集到 1 条 console error：seed 原型 Vant CDN 的 `pageerror: Unexpected token '.'`，属 spec 既有忽略项（`vant` / `cdn.jsdelivr.net`），非产品错误；无 React 运行时错误。
- 用例重写了 `docs/wave3-react-live.png`；运行后已按原字节还原（SHA-256 `BD00C1908AB1D9AD467370AAC5822A54C1E5F0950237670C7263ACE7FA6B1F93`，178,394 B），`docs/` 除本报告外无净变更。

### 14.6 放行结论

- **可交付（内部/试用）**：安装器、CSP 进包、asar 内容、renderer 引用与双入口真机全部通过，P0/P1 = 0。
- **外发前仍需处理 P2-3**（默认图标 + 未签名）；本轮未引入新缺陷，P2-6/P2-7/P2-8 观察项沿用 §12.3。
- 交付物：`桌面端/原型工具 Setup 1.2.0.exe`（95,625,125 B，2026-11-17 16:31:57，SHA-256 `A4D1BE2D590A03E5F381AB47E3013255E986A34C5E4B34784D17E8239C2351EB`）。

---

## 15. 第六轮源码重打包与安装包校验（2026-11-18 15:51，当前口径）

> 本节**取代 §2、§13、§14 的安装包数字**；其余门禁数字沿用 §12 与 `docs/final-gate-report-4.md`。本轮把当前工作区最新源码（移动端文档默认展开、切 PC 自动关文档、文档目录独立平级、移动端文档层 z-40、预览 HTTP/HTTPS 放行 + `unsafe-eval`、AI 思考强度缓存）打进安装包。

### 15.1 重打包原因与源码基线

- §14 安装器产自 2026-11-17 16:31；此后 renderer 源码继续变更（`src/renderer/components/shell/DocsPanelHost.tsx` 11-18 **15:11:41**、`Stage.tsx` **15:20:55**、`src/renderer/index.html` **14:38:59**），`dist/renderer` 已于 11-18 **15:22:10** 重建，但安装器仍是 11-18 **14:48:51** 的产物，落后于最新 dist，故本轮重打。
- 源码基线：HEAD `77192ddb21157d3aebca12167dd8563c1da4d31d`，工作区 144 项未提交改动；**未 commit、未 `npm install`、未改 `src/**`、`main/**`、`tests/**`、`package.json`**，仅更新本报告（e2e 用例自动重写的 `docs/wave3-functional-shots/*.png` 见 §15.5）。
- 构建命令 `npm run build`（先 `build:renderer` 再 `electron-builder --win --x64`），**exit 0**，2026-11-18 **15:50:31 → 15:51:04（32.3s）**；2170 modules，renderer 构建 318ms，无 >500 kB chunk 警告。
- 重构建产出 hash 与构建前 `dist/renderer`（15:22:10）完全一致（`index-C2kcM7uv.js` 391,206 B、`index-Etm5v0t1.css` 49,885 B 等），说明 15:22 的 dist 已是最新源码产物，本次仅把安装包同步到该 dist。
- 打包前检查：**无 `原型工具.exe` / `electron.exe` 进程运行**（`Win32_Process` 按可执行路径/进程名过滤为空；`%APPDATA%\原型工具` 用户数据目录存在但不占锁）；对 `桌面端/win-unpacked/原型工具.exe`、`resources/app.asar`、`桌面端/原型工具 Setup 1.2.0.exe` 做独占读写锁探测均为 **UNLOCKED**；**无 EBUSY、无重试、未强杀任何用户进程**。

### 15.2 安装包信息（当前）

| 项目 | 路径 | 大小 | 时间 |
| --- | --- | --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe` | **95,625,140 B / 91.19 MiB** | 2026-11-18 15:51:00 |
| 安装器 SHA-256 | 同上 | `47AD8B47E87B288FFFE6EFCBAAC6BD1F099AD0E810EE1C393D37D506DE8AE3DA` | — |
| 安装器 blockmap | `桌面端/原型工具 Setup 1.2.0.exe.blockmap` | 101,375 B | 2026-11-18 15:51:04 |
| 免安装主程序 | `桌面端/win-unpacked/原型工具.exe` | 204,521,984 B | 2026-11-18 15:50:46 |
| 主程序 SHA-256 | 同上 | `A303AD408F8090B94A34FF65F253636575480885F8519EBFE3BA6CC4E834F68D` | — |
| app.asar | `桌面端/win-unpacked/resources/app.asar` | **9,763,684 B / 9.31 MiB** | 2026-11-18 15:50:46 |
| app.asar SHA-256 | 同上 | `E66BA57CEC14C168E6EE4DAB91B0776B9A4238CFEE35D9CF5DADCFA2B8F1B5C2` | — |
| app.asar.unpacked | `桌面端/win-unpacked/resources/app.asar.unpacked` | 388 文件 / 6,766,573 B（6.45 MiB） | 2026-11-18 15:50:45 |
| 语言包 | `桌面端/win-unpacked/locales/*.pak` | 2 个（en-US 515,663 B、zh-CN 520,877 B） | — |

- 与 §14（95,625,125 B / 9,764,444 B）相比：安装器 **+15 B**，`app.asar` **−760 B**。差额与 renderer 资源变化完全吻合：entry **−320 B**（391,526 → 391,206）、CSS **−188 B**（50,073 → 49,885）、`vendor-lucide` **−485 B**（19,978 → 19,493）、`index.html` **+233 B**（1,886 → 2,119），合计 **−760 B**；`vendor-react`/`vendor-zustand` 体积不变仅换 hash，`vendor-BC5zy5rY` 未变。
- `桌面端/latest.yml` 已同步：`size: 95625140`、`sha512: TBb5cDn8fEt8K0I5FTo8bPKgwyd5vuTFQWDl+bwDphQAh1f5wKSUD+IyrScG+/gnTDRRdaVxMkda9iIv5OKoKQ==`、`releaseDate: 2026-11-18T07:51:04.181Z`（= 本地 15:51:04 +08:00）。
- 构建日志仍为 `default Electron icon is used`、`no code signing certificate configured`，属既有 P2-3，未在本轮处理；另有一条 `downloaded electron zip extracted successfully`，为 electron-builder 复用缓存后重新解包，不影响产物。

### 15.3 CSP 校验（预览 HTTP/HTTPS 放行 + unsafe-eval 已进包）

- asar 内 `dist/renderer/index.html`（**2,119 B**，SHA-256 `B1DDCF3A35F13353321EDCE1E4CBA0CF214088EA9E04878FD5430EDA6DB86D13`，与本地 dist 字节一致）含 `http-equiv="Content-Security-Policy"`，**同时包含 `http:` 与 `https:`**：`http:` 11 处、`https:` 10 处。
- 9 条网络类指令全部放行 HTTP/HTTPS，且 `script-src` 显式放行 `'unsafe-eval'`（沙箱预览 iframe 内单文件 Vue 2/3 运行时模板编译所需）：

| 指令 | 值 |
| --- | --- |
| `script-src` | `'self' 'unsafe-inline' 'unsafe-eval' https: http: http://localhost:5173` |
| `style-src` | `'self' 'unsafe-inline' https: http:` |
| `font-src` | `'self' data: https: http:` |
| `img-src` | `'self' data: blob: proto-asset: https: http:` |
| `connect-src` | `'self' https: http: wss: ws://localhost:5173` |
| `frame-src` | `'self' data: blob: https: http:` |
| `media-src` | `'self' data: blob: https: http:` |
| `worker-src` | `'self' blob: https: http:` |
| `form-action` | `'self' https: http:` |

- 未新增 `object-src` 等危险指令；iframe `sandbox`（`allow-scripts allow-forms`，无 `allow-same-origin`）与主进程 `webSecurity` 未放宽，与 `docs/preview-network-policy.md` 一致。
- 对比 §14 包内 1,886 B 的 `index.html`，本轮 **+233 B** 来自新增的 `'unsafe-eval'` 令牌与策略注释；`http:`/`https:` 放行令牌保持有效，**证明预览网络放行改动仍在包内且未回退**。

### 15.4 asar 内容与 dist 校验（全部 PASS）

- asar 条目 **1,354**（文件 1,209 + 目录 145）；`dist/renderer` 资源 **11 条**：7 个 assets（6 JS + 1 CSS）、`index.html`、`export-assets` 三件。
- `index.html` 引用 **7 个资源，7/7 在包内且 SHA-256 与本地一致**：

| 引用 | 字节 | SHA-256（前 12 位） |
| --- | ---: | --- |
| `assets/index-C2kcM7uv.js` | 391,206 | `F9E01441CBA9` |
| `assets/rolldown-runtime-WkwZ5CU-.js` | 599 | `2629F2AD3CB7` |
| `assets/vendor-lucide-Hsf31Bd9.js` | 19,493 | `CDF8DC81D966` |
| `assets/vendor-react-Ccb6oHA7.js` | 210,917 | `C1B4565469FE` |
| `assets/vendor-BC5zy5rY.js` | 28,132 | `0D5D4E8D6A7A` |
| `assets/vendor-zustand-CEWZ_QTf.js` | 676 | `47AA1FAC2F86` |
| `assets/index-Etm5v0t1.css` | 49,885 | `3449E14FA03E` |

- `dist/renderer` 全量 **11/11 SHA-256 MATCH**（含 `index.html`、3 个 export-assets），合计 **728,374 B**；asar 内无本地不存在的 `dist/renderer` 多余文件。
- `export-assets/{export-template.js 11,166 B, icons.js 8,002 B, export.css 6,179 B}` **3/3 在包内且 hash 一致**。
- `node_modules/acpx` **15 文件**（含 `dist/runtime.js` 105,845 B）；`@agentclientprotocol/sdk` **44 文件**（`dist/acp.js` 66,907 B），无其它 ACP 包；`app.asar.unpacked` 内同名 `runtime.js`（105,845 B）与 `acp.js`（66,907 B）均存在。
- 裁剪校验：`*.map=0`、`*.bak=0`、`node_modules/**/*.md=0`、`node_modules/**/{test,tests,__tests__}/**=0`、`zod/src=0`、`@esbuild=0`。
- 残留校验：`dist/renderer/assets` 仅 7 个当前文件，`index-*.js` 只有当前 entry **1 个**，**旧 chunk 残留 = 0**。
- 新增特性进包证据：entry `index-C2kcM7uv.js` 内含 `relative z-40`、`docs-panel`、`doc-toc-sidebar`、`docs-overlay`、`docs-source-title`、`stage-mobile-scroll`、`stage-mobile-area`、`stage-mobile-shell`、`stage-mobile-zoom-box` 等标识；源码 `DocsPanelHost.tsx`（15:11:41）与 `Stage.tsx`（15:20:55）均早于本轮 dist（15:50:33），且 asar 内 entry 与本地 dist 字节一致，说明移动文档层 z-40、目录独立平级、移动端默认展开、切 PC 关文档的代码确已进包。

### 15.5 Electron 双入口 + 功能 E2E

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| `e2e/electron-live.spec.ts` A. React 真机（骨架 + 设置/Git/AI/导出 + Esc + 退出） | **PASS** | `exit:0@4616ms；close@4616ms`，11.2s |
| 同上 B. legacy 回退（`原型+文档.html` + 旧顶栏 + 退出） | **PASS** | `exit:0@232ms；close@232ms`，985ms |
| 汇总 `npx playwright test e2e/electron-live.spec.ts` | **2 passed / 0 failed** | 12.6s，exit 0 |
| `e2e/electron-functional.spec.ts` A. React 9 步功能操作 | **PASS（9/9）** | 冷启动/侧栏/预览/移动端 375×780/文档面板/设置 6 Tab/导出/AI/退出 `exit:0@4720ms`，15.0s |
| 同上 B. P0/P1 回归复核 | **PASS** | 顶栏项目下拉+刷新+终端、侧栏三层拖拽、Git 660px Dialog、设置 CLI/API 32/32px、文档目录 6 条 + Markdown 表格 4 个、AI 单模型选择器无 `acp_catalog`；`exit:0@5390ms` |
| 汇总 `npx playwright test e2e/electron-functional.spec.ts` | **2 passed / 0 failed** | 28.7s，exit 0 |

- `electron-live` 仅采集到 1 条 console error：seed 原型 Vant CDN 的 `pageerror: Unexpected token '.'`，属 spec 既有忽略项，非产品错误；无 React 运行时错误。
- `electron-functional` 记录 `CONSOLE_ERRORS_TOTAL=1`、`CONSOLE_ERRORS_FATAL=0`，同为 Vant CDN 噪声。
- 功能用例第 5 步复验文档面板：`docs-panel` 可见、功能说明正文 3,353 字符、Markdown 表格 4 个、移动端 Tab 直接点击成功（P1-1 无回退）。
- 副作用说明：`electron-live` 重写 `docs/wave3-react-live.png`，已按**本次运行前**字节还原（SHA-256 `FE58F51FB2593C5B171EF326453108C22420AD82B75D79EABB99989CB7E3D49E`，179,694 B，15:15:29；注意该图在上一轮运行后已被改写，与 §14 记录的 `BD00C190…` 178,394 B 不同，属既有 e2e 输出，非本轮新增变更）；`electron-functional` 重写 `docs/wave3-functional-shots/` 下 15 张用例证据图（15:53–15:54），均为测试产物。

### 15.6 放行结论

- **可交付（内部/试用）**：安装器、CSP（HTTP/HTTPS + `unsafe-eval`）进包、asar 内容与 hash、renderer 引用 7/7、双入口与功能 E2E（4 passed / 0 failed）全部通过，P0/P1 = 0。
- **外发前仍需处理 P2-3**（默认图标 + 未签名）；本轮未引入新缺陷，P2-6/P2-7/P2-8 观察项沿用 §12.3。
- 交付物：`桌面端/原型工具 Setup 1.2.0.exe`（**95,625,140 B / 91.19 MiB**，2026-11-18 15:51:00，SHA-256 `47AD8B47E87B288FFFE6EFCBAAC6BD1F099AD0E810EE1C393D37D506DE8AE3DA`）。
