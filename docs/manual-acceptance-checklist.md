# 手工验收清单（真机三项，headless 覆盖不到）· F8

> 范围：只补 headless 覆盖不到的三项真机。headless（`e2e/headless-render.spec.ts`，见 `docs/smoke-T5-headless.md`）只断言“骨架可见 + 零致命 console error + 截图”，不覆盖：真实多窗口 IPC/mirror、file:// 离线双击单文件、安装包 asar + proto-asset 路径。
> 本文件是 F8 唯一可写文件。失败回滚一律：`PLAND_RENDERER=legacy`（缺省即 legacy，见 `main.js:40-44` / `window-controller.js:14-19`）。

## 0. 自动化前置（F8 当日已跑，结果记入头部）

- 日期：2026-11-12（`Get-Date` 实测）。
- `npm run build:renderer`：**成功**。
  - `vite v8.3.8`，2111 modules，562ms。
  - `dist/renderer/index.html` 0.84 kB（实测 840 B）。
  - `dist/renderer/assets/index-s7AugzpY.js` 290.10 kB + `index-CpAUX5uN.css` **29.21 kB**（实测 290105 / 29215 B）。
  - `copy-export-assets` 复制 3 项 OK。
  - 对比意义：T5 时 `assets/` 下无 CSS（`docs/smoke-T5-headless.md §2/§6` P0 整站零样式）；本次构建 **CSS 已产出**，P0 已修，下述三项在此产物上验收。
- 产物四文件存在（实测 `Get-ChildItem` 全在）：
  - `dist/renderer/index.html`（937 B 级别：实测 840 B）。
  - `dist/renderer/export-assets/export-template.js`（实测 9377 B）。
  - `dist/renderer/export-assets/icons.js`（实测 8002 B）。
  - `dist/renderer/export-assets/export.css`（实测 6179 B）。
- `node tests/check-pack.js`：**PASS**，尾行 `PACK_PASS: 0缺失，白名单覆盖全部运行时边`，exit 0。要点断言均过：`main.loadFile须绝对路径`、`main保留legacy入口`、`main双入口含 PLAND_RENDERER / dist/renderer/index.html`、`dist产物存在 ×4`、`违禁未进包`。
- `node tests/verify-docwin.js`：**29/29**，尾行 `DOCWIN_PASS: 全部29项独立文档窗口断言通过`，exit 0（含 A1-A12/S1-S2/B1-B3/E1-E6/F1/D1/H1-H2）。
- 结论：自动化门禁全绿，方可进入下述三项手工。

---

## A. `PLAND_RENDERER=react` 启动 + 独立文档窗口（mirror 来回、关闭回 panel）

> 对应启动分支 `main.js:40-88`（react 走 `dist/renderer/index.html`，legacy 走 `原型+文档.html`，`renderer=legacy` 深链强制 legacy）；窗口工厂与 5 通道 `window-controller.js:60-145`；手册来源 `e2e/docs.spec.ts:10-16` 真机步骤 1-4 + `gui` 块 83-100（PC 悬浮不挤压、Esc 关闭）。

### A-前置

1. 已完成 §0 四项（构建 + 四文件 + check-pack + 29/29）。
2. 同一工作目录终端，关闭已在跑的 `dev:renderer` / electron 实例（防端口与单例干扰）。
3. 准备一个含文档目录的项目/原型（mirror 来回可见变化即可，无需真实业务数据）。

### A-操作

1. PowerShell 设置并启动（当前窗口有效）：
   ```powershell
   $env:PLAND_RENDERER='react'
   npx electron .
   ```
   （cmd 则为 `set PLAND_RENDERER=react && npx electron .`。不改系统环境变量。）
2. 确认主窗为 react 产物：顶栏/侧栏/舞台横排分栏、有样式（非 T5 裸排）；DevTools（F12）`location.pathname` 含 `dist/renderer/index.html`，无白屏、无致命 console error。
3. 主窗点「打开文档」（或 DevTools 执行 `ipc invoke docwin:open {project, proto}` 带参版一次）：独立窗口弹出，标题 `文档-功能说明`（`window-controller.js:70-74` 初始 520×800 后 `maximize()`）。
4. 独立窗内检查：只渲染 `data-testid="doc-window"`（页签 功能说明/最新需求、搜索框），无顶栏/侧栏/舞台混入（对应 T5 `docwin-1024x768.png` 目检口径的真机版）。
5. mirror 来回各一次：
   - 主窗改文档（如切换页签/搜索关键字）→ 独立窗内容同步变（`doc:mirror-push` → `doc:mirror`，`window-controller.js:128-137`；无窗时回 `{nop:true}`，有窗时须 `ok:true`）。
   - 独立窗内改一次（如切 Tab）→ 主窗收到 `doc:mirror` 回写（`doc:mirror-back`，`window-controller.js:139-145`）。
6. 关闭独立窗（点 X）：主窗应收到 `{kind:'mode', mode:'panel'}` 并切回 panel 形态（`window-controller.js:87-90` closed 处理）；再点「打开文档」应能重开且 `docwin:toggle` 在 busy（`activeExecution`）时拒绝并回 `busy` 可不测，只验开关各一次。
7. 另验 Esc：主窗 panel 形态下按 Esc 关闭文档（栈顺序 AI > 文档 > 设置，见 `e2e/docs.spec.ts:14` 与 `wave2-verify-report.md §6.3`）。

### A-预期（逐项打勾）

- [ ] react 主窗有样式分栏，无白屏；F12 无致命 error、无 `Times New Roman` 裸排。
- [ ] 独立窗标题 `文档-功能说明`，仅 `doc-window` 内容，无主壳混入。
- [ ] 主→独 mirror 同步可见；独→主 mirror-back 同步可见。
- [ ] 关独立窗后主窗回 panel，可重开；Esc 可关 panel 文档。
- [ ] 全程 `docWin.isDestroyed()` 无异常、无僵尸窗口（主窗关闭联带关 docWin，`main.js:66-69`）。

### A-回滚

- 任一失败：关闭所有 electron 进程，执行 `$env:PLAND_RENDERER='legacy'`（或新终端不设该变量，缺省即 legacy）后 `npx electron .` 重启，即回 legacy `原型+文档.html`。不改代码、不重装。

---

## B. 单文件导出离线双击打开（样式 / 交互 / `__EXPORT_BOOT__`）

> 手册来源 `e2e/git-export.spec.ts:12-19` 真机步骤 3 + `gui` 块预期（样式正常、`__EXPORT_BOOT__===true`、图片走 proto-asset）、`e2e/preview.spec.ts:10-16` 真机步骤 4（导出单文件拾取不注入）。

### B-前置

1. §0 通过，且 A 项 react 主窗可正常打开项目/原型。
2. 准备：目标机（本机即可）先记下在线态样式截图一张；准备一个含图片资源的原型（验 proto-asset / 内联图片二者之一即可）。

### B-操作

1. react 模式主窗（`$env:PLAND_RENDERER='react'`）执行导出单文件（ExportMenu 路径，`src/renderer/features/export/ExportMenu.tsx` 含 `__EXPORT_BOOT__` 与 `export-assets/` 引用），保存为如 `D:\tmp\export-offline\proto-standalone.html`。
2. 断网（拔网线/飞行模式/禁网卡任一），把该单个 html 拷到**干净目录**单独存放（不拷仓库、不拷 dist）。
3. 资源管理器**双击**该 html（系统浏览器打开，`file://` 协议），全程保持断网。
4. 目检 + DevTools（F12 → Console）执行：
   ```js
   window.__EXPORT_BOOT__ === true
   !!window.__EXPORT_SOURCES__
   document.styleSheets.length > 0
   ```
5. 点一处跳转交互（如原型内页跳/锚点），确认可跳；按住 Ctrl 悬停确认**无准星/无悬停框**（`ctrlPickCrosshairStyle` 未注入，`preview.spec.ts` 步骤 4）。
6. 恢复网络。

### B-预期（逐项打勾）

- [ ] 离线双击可开，无白屏；排版与在线态一致（非 T5 裸排），`export.css` 生效（`document.styleSheets.length > 0`）。
- [ ] `window.__EXPORT_BOOT__ === true`，`window.__EXPORT_SOURCES__` 非空（契约见 `git-export.spec.ts:58-65`，legacy `js/project-ai-export.js` 保留兼容）。
- [ ] 图片正常显示（内联或 proto-asset 路径可解，无大片裂图）；交互跳转正常。
- [ ] 拾取未注入：Ctrl 悬停无准星（`isExportBoot` 下禁用，`PreviewFrame.tsx` 断言）。
- [ ] Console 无致命 error（file:// CORS 类 `net::ERR_FAILED` 若出现则记为环境事项，非产物失败；真机 Electron 语义以 C 项为准）。

### B-回滚

- 任一失败：删该单文件，不动仓库；回主程序执行 `$env:PLAND_RENDERER='legacy'` 重启确认 legacy 导出链仍可用（legacy `js/project-ai-export.js` 同契约）。不改 `js/**` 与 `export-assets`。

---

## C. electron-builder 安装包启动（asar 路径、proto-asset 图片）

> 依据 `package.json:55-106` build 配置（`asar:true`、`files` 含 `dist/renderer/**`、输出 `桌面端/`）、`main.js:83-87` 绝对路径 `loadFile(app.getAppPath()+…)`（check-pack 已断言）、`main.js:20-24,104-105` proto-asset 特权协议 + `handleProtoAsset`（只服务 `SANDBOX_ROOT` 内 assets 图片）。

### C-前置

1. §0 通过。确认 `桌面端/` 为构建输出目录（git 忽略，打包前可清空，`check-pack` 已验 `违禁未进包: 桌面端/`）。
2. 准备含 assets 图片的沙箱项目一个（验 proto-asset 用）；准备管理员/安装权限（NSIS 非一键安装，可改目录，`package.json:97-102`）。

### C-操作

1. 打包（允许的耗时命令）：
   ```powershell
   npm run build
   ```
   确认 `桌面端/` 下产出安装器（`原型工具-*.exe`）。
2. 在干净路径安装（改一次安装目录，验 `allowToChangeInstallationDirectory`），安装后**冷启动**（不带 dev server，不设 `PLAND_E2E_APP_URL`）。
3. 首屏检查：无白屏，主窗正常（默认 legacy 除非安装后环境带 `PLAND_RENDERER=react`；两种都应能起，先验默认 legacy，再设 react 重验一次 A 的 2-4 步即可）。
4. asar 路径验证（主窗 DevTools → Console，或主进程日志任一）：
   ```js
   // 期望含 app.asar（打包态 getAppPath 指向 asar 内）
   require('electron').ipcRenderer ? 'renderer-has-ipc' : 'no-ipc'
   ```
   更直接：在安装目录确认 `resources/app.asar` 存在，且 `resources/` 下**无** `tests/`、`.devdata`、`*.log`（与 check-pack 违禁项对应）。
5. proto-asset 图片验证：打开含 assets 图片的原型，图片正常显示；DevTools → Network/Elements 确认图片 `src` 走 `proto-asset://…` 且 200（失败则看主进程 console 是否报越界拦截——只服务 `SANDBOX_ROOT` 内，目录外图片被拦是**预期安全行为**，换沙箱内图片重验）。
6. F12/`Ctrl+Shift+I` 能开关 detached DevTools（`attachDevToolsShortcut`，`window-controller.js:29-49`）。

### C-预期（逐项打勾）

- [ ] 安装器可装、可改目录、有桌面/开始菜单快捷方式；冷启动无白屏。
- [ ] `resources/app.asar` 存在；`tests/.devdata/*.log/桌面端` 均未进包。
- [ ] legacy 默认可起；`PLAND_RENDERER=react` 下 dist 产物可起（与 A 一致）。
- [ ] 沙箱内 assets 图片经 `proto-asset://` 正常加载；沙箱外文件被拦（安全预期）。
- [ ] F12 开关控制台正常。

### C-回滚

- 任一失败：卸载安装包，删 `桌面端/` 重打前先回 `$env:PLAND_RENDERER='legacy'` 用 `npx electron .` 源码态确认功能基线（区分“打包问题”还是“源码问题”）。不改 `package.json:build.files` 白名单，不动 `main.js` 路径逻辑。

---

## 通用失败回滚（一句话）

- 任何一项失败：先记“哪一步 / 什么现象 / Console 原文 / 是否断网 / PLAND_RENDERER 值”，然后一律 `$env:PLAND_RENDERER='legacy'`（或清掉该变量）重启回 legacy 基线；安装包问题另附 `桌面端/` 安装器文件名与安装路径。禁 `npm install`（本清单仅允许已执行的 `build:renderer` / `build`），禁 commit，禁碰本文件之外。
