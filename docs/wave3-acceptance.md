# W3 最终真机验收报告（Electron 实机 + 打包）

- 日期：2026-11-12
- 范围：Wave 3 收口前的真机验收（Playwright `_electron` 拉起真实主进程 + legacy 回退 + electron-builder 打包检查）
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65 / electron-builder 26.18.1
- 约束遵守：仅新增 `e2e/electron-live.spec.ts`、`docs/wave3-acceptance.md`（及验收截图）；未改 `src/`、`main/`、`tests/`、`package.json`；未执行 `npm install`；未 commit。

## 0. 结论摘要

| 项 | 结论 | 一句话说明 |
| --- | --- | --- |
| A. React 真机验收 | **PASS** | 主窗骨架可见；设置 / Git / AI / 导出四入口均可打开且 Esc 可关；零致命 console error；主进程正常退出 |
| B. legacy 回退验收 | **PASS** | 加载 `原型+文档.html`（file URL 中文百分号编码），标题与旧顶栏 `#btnSettings` 正常，无 React 主窗残留 |
| C. 打包检查 | **PASS** | `npm run build` 成功；`桌面端/原型工具 Setup 1.2.0.exe` 110.6 MB；`app.asar` 内含 `dist/renderer/index.html` 与新 hash 资源 |
| 是否可交付 | **可交付（内部/试用）** | 无未修复 P0/P1（原 P1-1 移动端文档遮挡已修复；P2-1 Git 子进程收尾已修复）；剩余 3 项 P2（打包体积、图标/签名、chunk 体积），外发前建议处理 |

> 说明：A 的第 6 步“冷启动项目选择器”为 **SKIP**（本机存在 `protoLastProject`，启动直接恢复上次项目「测试1」，未出现选择器）；按任务口径不强制清理用户本地状态，记录为 SKIP。

## A. React 真机验收（PASS）

- 用例：`e2e/electron-live.spec.ts` → `A. React 真机：骨架 + 设置/Git/AI/导出 + Esc + 进程退出`
- 启动方式：`_electron.launch({ args: ['.'], cwd: ROOT, env: { ...process.env, PLAND_RENDERER: 'react' } })`
- 证据：`docs/wave3-react-live.png`（2560×1459 主窗截图，含侧栏/舞台/预览浮层）

| # | 步骤 | 结果 | 证据 / 断言 |
| --- | --- | --- | --- |
| 1 | 等待 firstWindow，断言 `[data-testid=main-window]`、`topbar`、`sidebar`、`stage-frame` 可见 | **PASS** | 四个 testid 全部 `toBeVisible()`；窗口标题「原型工具」，URL 为 `file:///.../dist/renderer/index.html` |
| 1b | 收集 `pageerror` + console error，排除 favicon/第三方噪声 | **PASS** | 采集到 console error **0 条**（无 pageerror）；断言 fatal 列表为空 |
| 2 | 点顶栏「设置」→ `[data-testid=settings-dialog]` 可见 → Esc 关闭 | **PASS** | Dialog 出现并卸载；关闭后 `toBeHidden()` |
| 3 | 点「Git 管理」→ `[data-testid=git-sheet]` 可见 → Esc 关闭 | **PASS** | 右侧 Sheet 出现并卸载 |
| 4 | 点「AI 对话」→ `[data-testid=ai-dialog]` 可见 → Esc 关闭 | **PASS** | Dialog 出现并卸载 |
| 5 | 点「导出」→ 下拉菜单项可见 → Esc 关闭 | **PASS** | `export-source` / `export-html` / `export-png` / `export-pdf` / `export-md` 五项均可见，Esc 后全部卸载 |
| 6 | 冷启动项目选择器（无 `protoLastProject` 时） | **SKIP** | 本机已恢复上次项目「测试1」，`[data-testid=project-picker]` 未出现；按约定不硬断言、不改用户 localStorage。主窗截图仍落盘 `docs/wave3-react-live.png` |
| 7 | 关闭 Electron，断言主进程退出 | **PASS** | 走真实用户路径 `window.close()` → `window-all-closed` → `app.quit()`；15s 内收到进程 exit，`exitCode = 0` |

### A 的实现说明（测试收尾）

- Playwright 1.65 的 `electronApplication.close()` 在“打开过 Git 面板 + 存在交互式 Git 凭据子进程”时不会 resolve（进程实际已退出，`exitCode=0`），会让 worker teardown 等满 30s。用例改用窗口关闭并监听 `exit` 事件断言退出，结果稳定。
- 为适配无人值守环境，测试进程注入 `GIT_TERMINAL_PROMPT=0 / GCM_INTERACTIVE=never / GIT_ASKPASS=echo / SSH_ASKPASS=echo`，避免 credential-manager 弹窗挂起。该设置只作用于验收进程（P2-1 已于 2026-11-12 修复：业务代码现内置同一组非交互环境变量与退出回收，详见 E 表）。

## B. legacy 回退验收（PASS）

- 用例：`e2e/electron-live.spec.ts` → `B. legacy 回退：旧版 原型+文档.html + 旧顶栏 + 进程退出`
- 启动方式：`PLAND_RENDERER=legacy`
- 实测值：
  - 标题：`原型预览 · 投融资录入工作流`（断言 `/原型预览/`）
  - URL：`file:///D:/.../%E5%8E%9F%E5%9E%8B+%E6%96%87%E6%A1%A3.html`，解码后含 `原型+文档.html`；不含 `dist/renderer`
  - 旧顶栏：`#btnSettings` 可见；`body.innerText` 非空（约 200+ 字符，含“项目 / 移动 / PC / 交互 / 标注 / 刷新 / Git / 终端 / 导出”等旧工具条）
  - 反向断言：`[data-testid=main-window]` 数量为 **0**（确认是真回退，而非同一 React 入口）
  - 收尾：进程 15s 内退出，`exitCode = 0`
- 观察（非缺陷）：legacy 冷启动也会弹旧版「选择项目」浮层，属旧版既有行为，本次未作为断言。

## C. 打包检查（PASS）

命令：`npm run build`（= `vite build` + `electron-builder --win --x64`），耗时约 1–2 分钟，远低于 8 分钟上限。

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 安装器生成 | **PASS** | `桌面端/原型工具 Setup 1.2.0.exe`，110.6 MB，2026-11-12 20:25:29 |
| 免安装目录 | **PASS** | `桌面端/win-unpacked/原型工具.exe` |
| app.asar 生成 | **PASS** | `桌面端/win-unpacked/resources/app.asar`，62.53 MB，2026-11-12 20:24:52 |
| asar 内含 renderer 入口 | **PASS** | `asar list` 命中 `\dist\renderer\index.html`、`\dist\renderer\assets\index-BukCqeo1.js`、`\dist\renderer\assets\index-CUSZohI8.css`（与本轮 `build:renderer` 产物 hash 一致） |
| asar 顶层内容 | 记录 | `app.css / design-specs / dist / git / js / main / main.js / node_modules / package.json / platform / preload.js / providers / runtimes / toolPrompt.md / 原型+文档.html` |

### C 的过程记录

- 第 1 次 `npm run build` 失败：`EBUSY: resource busy or locked, rmdir '桌面端\win-unpacked'`。
  - 原因：本机有 5 个旧打包版进程（`桌面端\win-unpacked\原型工具.exe`，PID 9764/19920/36976/37544/38516，14:35 启动）占用目录。
  - 处理：对主窗口进程 PID 19920 执行非强制 `taskkill`（发送关闭信号），进程正常退出；未强杀、未改业务代码。
- 第 2 次 `npm run build` 成功。

## D. e2e 运行结果（贴原始输出）

命令：

```bash
npx playwright test e2e/electron-live.spec.ts
```

结果（exit code = 0）：

```text
Running 2 tests using 1 worker

  ok 1 e2e\electron-live.spec.ts:123:3 › W3 真机验收（React / legacy）› A. React 真机：骨架 + 设置/Git/AI/导出 + Esc + 进程退出 (8.0s)
  ok 2 e2e\electron-live.spec.ts:214:3 › W3 真机验收（React / legacy）› B. legacy 回退：旧版 原型+文档.html + 旧顶栏 + 进程退出 (1.3s)

  2 passed (9.9s)
```

> 说明：Windows 控制台为 GBK 代码页，原始输出中的中文显示为乱码；上表按源文件用例名还原。运行无 console error 输出、无 teardown 错误。

## E. 缺陷清单（P0 / P1 / P2）

| 编号 | 级别 | 描述 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| P0-1 | — | 无 | — | — |
| P1-1 | P1（已修复） | **移动端文档面板「最新需求」Tab 被预览浮层工具栏遮挡**：移动端 `DocsPanelHost` 行内 `<aside>` 处于普通 Flex 流、无定位层级，`[data-testid=overlays-toolbar]`（`fixed right-3 top-14 z-50`）覆盖文档面板右半侧并拦截 Tab 点击；PC 悬浮分支正常。 | 修复前 `docs/wave3-functional-shots/05-docs-mobile-overlap.png`；修复后 `05b-docs-mobile-fixed.png`；`e2e/electron-functional.spec.ts` 步骤 5 由「被遮挡后切 PC」变为「移动端直接成功」；`docs/wave3-functional-report.md` P1 节 | **已于 2026-11-12 修复**：`src/renderer/components/shell/DocsPanelHost.tsx` 移动端 inline 分支加 `relative z-50`，与工具栏同级但 DOM 树序在 Stage 之后，文档层压过工具栏；Sheet/Dialog 仍经 body portal 保持上层，PC 分支未改。复测：`tsc --noEmit` 通过；Playwright 27 passed / 3 skipped；vitest 187 passed |
| P2-1 | P2（已修复） | **Git 面板会触发远程凭据交互，子进程收尾不干净**：默认环境下打开 Git 面板后，`git-remote-https.exe` / `git-credential-manager.exe` 挂起并占住 Electron 的 stdio 管道；应用窗口关闭后 Playwright 长期收不到进程 `close`（实测 6–20s 仍无 close），teardown 需 30s 超时兜底。设置 `GCM_INTERACTIVE=never` 后 `close` 立即触发（5s 内）。验收机 `tasklist` 可见多枚历史残留 `git.exe` / `git-remote-https.exe` / `git-credential-manager.exe`。 | **原证据**：本次 A 用例复现；当时 `main/services/git-workflow-service.js` 仅记录 `shared.gitCurrentChild` 并在超时/取消时 `killProcessTree`，应用退出时无整树回收钩子。**修复证据（2026-11-12）**：① `main/services/git-workflow-service.js` 新增 `GIT_NONINTERACTIVE_ENV`，强制 `GCM_INTERACTIVE=never` / `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=echo` / `SSH_ASKPASS=echo`（`buildGitChildEnv` 置于调用方 env 之后，不可被覆盖）；② 新增 `activeGitChildren` 活跃子进程集合（spawn 即 `trackGitChild`，close/error/超时/取消统一 `untrackGitChild`）；③ `main.js` 增加三条退出兜底：`window-all-closed` 同步 `cleanupGitChildrenSync`、`before-quit` 异步 `cleanupGitChildren`（`preventDefault` + 2s 兜底定时器后再 `app.quit`）、`process.on('exit')` 同步回收；只处理本进程 spawn 的 git 树。**复测**：打开 Git 面板后关闭窗口，主进程 `exit:0`，退出耗时首轮 **927ms**（另两轮 315/342ms；与既有修复记录 902–1073ms 一致），Playwright 可正常收到进程退出，不再依赖 teardown 30s 兜底。 | **已于 2026-11-12 修复**，无需后续动作 |
| P2-2 | P2 | **打包体积膨胀**：`app.asar` 62.53 MB，`node_modules` 全量进入 asar（含已被 Vite 打进 `dist/renderer` 的 react/react-dom/lucide 等）；安装包 110.6 MB（旧版 1.0.1 为 78.3 MB）。 | `asar list` 顶层含 `node_modules`；安装器体积对比 | 在 `build.files` 中排除纯前端依赖，仅保留主进程运行时需要的 `acpx` 等；或改为 `asarUnpack` + 精简 `dependencies` |
| P2-3 | P2 | **安装包缺图标且未签名**：构建日志 `default Electron icon is used`、`no code signing certificate configured`；`signAndEditExecutable: false` 会同时跳过图标/版本资源写入，Windows 首次运行会触发 SmartScreen 提示。 | electron-builder 日志 | 配置 `win.icon`；外发前配置代码签名；如需保留自定义元数据，改用 `signExecutable: false` |
| P2-4 | P2 | **renderer 单 chunk 超警戒线**：`dist/renderer/assets/index-BukCqeo1.js` 506.20 kB（gzip 150.10 kB），Vite 提示 >500 kB。 | `npm run build` 输出 | 对设置/文档/AI 等重面板做动态 import 拆包，或调整 `chunkSizeLimit` 并持续观测首屏 |

## F. 变更与证据文件

| 文件 | 说明 |
| --- | --- |
| `e2e/electron-live.spec.ts` | 新增真机验收用例（React + legacy，串行 2 用例） |
| `docs/wave3-acceptance.md` | 本报告 |
| `docs/wave3-react-live.png` | React 主窗真机截图（本轮实际运行） |
| `桌面端/原型工具 Setup 1.2.0.exe` | 本轮打包产物（构建产物，gitignore） |
| `桌面端/win-unpacked/resources/app.asar` | 本轮打包产物（含 dist/renderer） |

## G. 最终结论

- A/B/C 三项验收全部通过（A 的第 6 步项目选择器因本机已恢复上次项目而 SKIP，不影响主链路）。
- 原 P1-1（移动端文档面板「最新需求」Tab 被预览浮层工具栏遮挡）已于 2026-11-12 修复并复测通过；P2-1（Git 子进程收尾）已于 2026-11-12 修复并复测（打开 Git 面板后退出 `exit:0`，首轮 927ms）。当前无未修复 P0/P1。剩余 3 项 P2 均不影响当前内部试用交付。
- **可交付**。建议外发前优先处理 P2-3（图标/签名），P2-2（体积）与 P2-4（拆包）可排入后续优化。
