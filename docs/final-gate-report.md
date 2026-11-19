# 最终全量门禁 + Electron 真机复验报告

- 日期：2026-11-13
- 项目：原型预览工具（proto-viewer）v1.2.0，`D:\文件\工具\原型工具-PlanD`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0 / electron-builder 26.18.1 / Vite 8.3.8
- 真机渲染器：React（`PLAND_RENDERER=react`）+ legacy 回退（`PLAND_RENDERER=legacy`）
- 约束遵守：未执行 `npm install`，未 commit，未修改 `src/**`、`main/**`、`package.json`；仅改测试与报告（见 §2 变更清单）。
- 结论：**全量门禁 PASS，可交付（内部/试用）**；外发前仅需处理 P2-3（图标/签名）。

---

## 1. 门禁结果总表

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript 类型检查 | `npx tsc --noEmit` | **PASS** | exit 0，无诊断输出 |
| 2 | Vitest 单元测试 | `npx vitest run` | **PASS** | **14 个测试文件 / 250 passed / 0 failed**，2.62s |
| 3 | Playwright 全量 | `npx playwright test` | **PASS** | **93 passed / 10 skipped / 0 failed**（共 103），42.9s，workers=1 |
| 4 | Node 全量验证 | `node tests/run-all.js` | **PASS** | **total=64 / pass=64 / fail=0**（core 38 + legacy-ui 26；react-ui 按设计 SKIP），`ALL_PASS(core+legacy)`；含新增 `git-credential` 套件（20/20，core 组） |
| 5a | renderer 构建 | `npm run build:renderer` | **PASS** | exit 0；2170 modules；见 §1.1 chunk 明细 |
| 5b | 完整打包 | `npm run build` | **PASS** | exit 0；安装器 **95,587,069 B / 91.16 MiB**；`app.asar` 9,590,025 B / **9.15 MiB**；无 EBUSY |
| 5c | 安装器/asar 核验 | `@electron/asar` 读取 | **PASS** | asar 1,352 条目；`dist/renderer/index.html` + 3 个 export-assets + 6 JS/1 CSS 全在包内；`*.map=0` |
| 6 | Electron 真机 | `npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts` | **PASS** | **4 passed / 0 failed**，27.2s（live 2 + functional 2） |
| 7 | ESLint error 门禁（补充） | `npx eslint . --quiet` | **PASS** | exit 0（dialog per-file 例外移除后 `no-undef` 恢复，无新增 error） |

### 1.1 renderer 构建产物（`npm run build:renderer`）

| 文件 | 大小 | gzip |
| --- | ---: | ---: |
| `dist/renderer/index.html` | 1.26 kB | 0.68 kB |
| `assets/index-BBgGSfv8.css` | 41.55 kB | 8.45 kB |
| `assets/index-Cv5UVz7h.js`（主 entry） | 309.21 kB | 86.15 kB |
| `assets/vendor-react-DiV6l5IP.js` | 210.91 kB | 65.86 kB |
| `assets/vendor-BC5zy5rY.js` | 28.13 kB | 8.97 kB |
| `assets/vendor-lucide-D-8nt8z9.js` | 19.64 kB | 7.14 kB |
| `assets/vendor-zustand-DSoFOYgI.js` | 0.67 kB | 0.42 kB |
| `assets/rolldown-runtime-WkwZ5CU-.js` | 0.59 kB | 0.36 kB |

- 无 >500 kB chunk 警告（P2-4 拆包保持有效）。
- `export-assets`：`export-template.js`、`icons.js`、`export.css` 三件落位。

### 1.2 安装包 / asar 明细（最终一次 `npm run build`）

| 项 | 值 |
| --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe`，**95,587,069 B = 91.16 MiB**（2026-11-13 10:12:12） |
| blockmap | 101,363 B |
| `app.asar` | **9,590,025 B = 9.15 MiB** |
| `app.asar.unpacked` | **388 文件 / 6.45 MiB** |
| 语言包 | 2（zh-CN、en-US） |
| asar 条目 | 1,352 |

asar 内容核验（`@electron/asar.listPackage`）：

- `\dist\renderer\index.html` 存在；`dist/renderer/export-assets/{export-template.js,icons.js,export.css}` 存在。
- acpx runtime：`\node_modules\acpx\dist\runtime.js` 等 **17 个文件**在包内。
- ACP SDK：`\node_modules\@agentclientprotocol\**` **56 个文件**在包内。
- fs-safe 原生文件：`\node_modules\@openclaw\fs-safe-win32-x64-msvc\fs-safe-native.node` 在包内；`app.asar.unpacked` 内另有该 `.node`（1,882,936 B）与 `windows-security-helper.exe`（44,856 B）。
- 瘦身校验：`*.map=0`、`node_modules/**/*.md=0`、`node_modules/**/{test,tests,__tests__}/**=0`、`node_modules/zod/src/**=0`、`@esbuild/**=0`；`pi-acp` 未安装（`asarUnpack` 为防御性登记，不构成缺失）。

---

## 2. 本轮测试代码修复（未动产品代码）

### 2.1 `tests/check-pack.js` — 允许 node_modules 瘦身负向模式

- 变更点：
  - §2 新增 `isNodeModulesPrune()` / `isLegalExclusion()`：排除项合法条件为「含 `.bak`」**或**「匹配 `!**/node_modules/<非空子路径>`」；其余 `!` 条目仍判 FAIL。
  - 新增 §5c：9 条 node_modules 剪枝必须逐条在 `build.files` 中（防体积回流）。
  - 新增 §5d：正例只允许 13 条已登记项（legacy 12 + `dist/renderer/**`），夹带未登记正例即 FAIL；并校验无重复条目。
- 保留校验：必需正例、违禁项（`tests/**`/`.devdata`/`*.log`/`桌面端`）、6 条 `.bak` 排除、require 边覆盖。
- 结果：`PASS 153 / FAIL 0`，`PACK_PASS: 0缺失，白名单覆盖全部运行时边`（修复前 `PACK_FAIL: 9项`）。

### 2.2 `tests/verify-inline-edit.js` A10 — 排除项按用途分类计数

- 变更点：不再断言“排除项恰 6 条”，改为：
  - `.bak` 排除**恰 6 条**且逐条存在；
  - node_modules 剪枝**恰 9 条**且逐条登记（P2-2 清单）；
  - 任意排除项必须是上述两类之一（阻止 `!js/core-docs.js` 这类“排除运行时必需文件”的偷渡）；
  - 正例不得夹带未登记条目、不得重复。
- 结果：`SUMMARY passed=24 failed=0`，`A10 无新增script` PASS（修复前 `15 !== 6`）。

### 2.3 e2e 静态契约按新 UI 更新（未删用例、未放宽为无意义断言）

| 文件 | 过期断言 | 新契约断言 |
| --- | --- | --- |
| `e2e/ai.spec.ts` | `{cascade}` ≥2（顶部+底部各一） | `<ModelSelector>` **恰 1 个**（`AiDialog.tsx:166`）、不存在 `{cascade}` |
| `e2e/settings-models.spec.ts` | `CardContent`、`暂未选择模型`、`手输模型 id` | 分组富信息清单（`可用模型清单` + `data-model-id` + Checkbox/Badge、非 `<Table>`）、空态「模型目录为空」/「无匹配模型」、`h-8` ≥4 处 + 「输入自定义模型 ID」/「添加模型」 |
| `e2e/electron-live.spec.ts` | Git 右侧 Sheet | Git **居中 Dialog**：`data-surface="dialog"` + 宽度 **660px** |
| `e2e/electron-functional.spec.ts` | 无 Git/P0-P1 专项 | 新增步骤内断言 + 新用例 B（见 §3.2） |

---

## 3. Electron 真机结果

### 3.1 功能验收 A：9 步真实操作（`electron-functional.spec.ts`）

| # | 真操作 | 结果 | 关键证据（本次实测） |
| --- | --- | --- | --- |
| 1 | 冷启动 / 项目选择 | PASS | `main-window/topbar/sidebar/stage-frame` 可见；项目选择器未出现（自动恢复）；当前项目「测试1」 |
| 2 | 侧栏真实数据 / 点击原型 | PASS | 原型 **2** 个：首页 / 我的；无「示例」；点击「首页」；面包屑=`测试1 首页 —` |
| 3 | 预览 iframe / srcdoc | PASS | iframe 数量 **1**；`srcdoc` 长度 **17423**；iframe body 文本长度 **292** |
| 4 | 移动端 375×780 | PASS | `data-kind=mobile`；逻辑尺寸 **375×780**（屏幕渲染 225×468） |
| 5 | 文档面板 / 最新需求 | PASS | 功能说明正文 **3353** 字；**Markdown 表格 4 个**；最新需求 **8** 字（`11121321`）；Tab 中心 `elementFromPoint` 命中 `docs-panel-content`（`docs-panel` 内）；移动端 Tab **直接点击成功** |
| 6 | 设置 6 Tab / Agent | PASS | 6 Tab；Agent 真实行 **26**；`engine-cli`/`engine-api` 高度 **32/32px**；无 `DEFAULT_AGENTS` |
| 7 | 导出菜单 / 源码包 | PASS | 菜单 **5** 项；落盘 **22,343 bytes**；toast「源码包已导出。」；fatal console error 0 |
| 8 | AI 对话 / 模型列表 | PASS | 模型选择器 **1** 个（`ai-model-select`/`ai-thinking-select` 各 1）；当前模型 `opencode-go/DeepSeek V4.1 Flash 1017`；可选 **3**；正文无 `acp_catalog`；未发送消息 |
| 9 | 关闭进程 / 退出 | PASS | `exit:0`，耗时 **346ms**（≤15s） |

- console error 总数 **0**、fatal **0**、pageerror **0**。
- 退出耗时多次运行区间 **279–398ms**（上表为本次记录值 346ms），均远低于 15s 上限。
- 说明：与 `docs/wave3-functional-report.md` 相比，正文长度 3786→3353、可选模型 2→3（多一个「默认」项），均来自沙箱文档/模型配置变化或配置项本身，不是 UI 回归；首行仍为「商城首页 — 产品需求文档 (PRD)」。

### 3.2 功能验收 B：P0/P1 回归复核（本轮新增）

| 复核项 | 结果 | 实测证据 |
| --- | --- | --- |
| 顶栏：项目下拉 / 刷新 / 终端 | PASS | `project-switch` 打开 `project-menu`（真实项目 1 个，含搜索框、新建项目输入）；`topbar-refresh`、`topbar-terminal` 可见且 enabled |
| 侧栏：三层真实拖拽 | PASS | `data-level` 三层能力：当前项目实际为文件夹 **0** / 原型 **2** / 子页 **0**（未建文件夹；三层结构由静态契约 `Sidebar.tsx:189/862/932/1016` 覆盖）；原型行 `draggable=true`，派发 `dragstart` 后 `data-dragging=true`、`dragend` 后回落 `false`；拖拽手柄 **2**（对应 2 个原型行） |
| Git：660 居中 Dialog | PASS | `git-sheet` 可见，`data-surface="dialog"`，实测宽度 **660px**；Esc 关闭 |
| 设置：32px + CLI/API | PASS | 「本地 CLI」「API 直连」按钮高度 **32px / 32px**；`settings-dialog` 文本含两者 |
| 文档：Markdown + 目录 | PASS | PC 模式 `doc-toc-sidebar` 可见，目录 **6** 条；`doc-preview` 内 **4** 个 Markdown 表格真实渲染 |
| AI：单选择器 + 无 acp_catalog | PASS | `ai-model-selector` 恰 **1** 个；`ai-model-select`/`ai-thinking-select` 各 1；对话正文不含 `acp_catalog` |
| 退出 | PASS | `exit:0`，**837ms** |

- 截图：`docs/wave3-functional-shots/10-p0p1-{topbar-project,git-dialog,settings-32px-cliapi,docs-toc-markdown,ai-single-selector}.png`。
- 用例 B 退出耗时多次运行 **743–875ms**（上表为本次记录值 837ms）。
- 与 A 分开执行的原因：不改变 A 的 9 步编号与历史截图口径；两用例串行、各自拉起/关闭 Electron，互不抢写 `.devdata`。

### 3.3 Electron 真机 live（`electron-live.spec.ts`）

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| A. React 真机 | PASS | 骨架 + 设置 Esc + **Git 660 Dialog** + AI Esc + 导出 5 项 + 无致命 console error + `exit:0`（7.5s） |
| B. legacy 回退 | PASS | 加载 `原型+文档.html`、不含 `dist/renderer`、标题「原型预览」、`#btnSettings` 可见、无 React 主窗、`exit:0`（983ms） |

---

## 4. P0/P1 逐项对照（`docs/wave3-functional-report.md`）

| 项 | 结论 | 代码锚点 | 本轮证据 |
| --- | --- | --- | --- |
| 浮层不再遮挡 | **PASS** | `PreviewOverlaysHost.tsx:38`（createPortal）、`:847-855`（工具条 portal 到 Stage 槽位，无 `fixed right-3 top-14 z-50`）、`:1022-1024`（Sheet/Confirm portal 到 body）；`DocsPanelHost.tsx:82-86`（移动端 inline `relative z-50`） | 步骤 5：Tab 中心 `elementFromPoint` 命中 `docs-panel-content`；点击直接成功 |
| AI 无重复选择器 | **PASS** | `AiDialog.tsx:166`（唯一 `<ModelSelector>`）；`ModelSelector.tsx:61/73/85` | 真机 1 个选择器；静态契约 `<ModelSelector` 恰 1 |
| AI 无 `acp_catalog` 泄漏 | **PASS** | `adapters.ts:394/463`（内部事件→trace）；`AiDialog.tsx:32/81` | 真机对话正文不含 `acp_catalog`；Vitest adapters 用例通过 |
| 设置高度 32px | **PASS** | `AgentMatrix.tsx:271-296`（`h-8` 引擎按钮）；`SettingsDialog.tsx:66/274/295/332-431` | 真机 engine 按钮 32/32px |
| 设置 CLI-API | **PASS** | `AgentMatrix.tsx:263-297`（`engine-cli`/`engine-api`，API 协议/Base URL/Key） | 真机文本含「本地 CLI」「API 直连」 |
| 侧栏三层拖拽 | **PASS** | `Sidebar.tsx:189`（DragGrip）、`:914`（原型行 draggable）、`:1002`（文件夹行 draggable）、`:862/932/1016`（subpage/proto/group 三层） | 真机原型行 `dragstart→data-dragging=true`；三层能力由静态契约（3 处 DragGrip + 三层 `data-level`）覆盖 |
| Git Dialog | **PASS** | `MainWindow.tsx:121-131`（`h-[80vh] max-w-[660px]`、`data-surface="dialog"`） | live + 功能 B 均实测 660px |
| 文档 Markdown | **PASS** | `DocEditor.tsx:167-233`（heading/list/code/table/quote 分块渲染，`:197-233` 表格） | 真机 4 个表格；正文 3353 字 |
| 文档目录 | **PASS** | `DocToc.tsx:34/56/62`；`DocsPanel.tsx:207-231/330` | 真机目录 6 条、`doc-toc-sidebar` 可见 |
| 顶栏终端/刷新/项目切换 | **PASS** | `Topbar.tsx:300`（project-switch）、`:321`（project-menu）、`:482`（topbar-refresh）、`:493`（topbar-terminal） | 真机三者可见/可用；项目下拉列出真实项目 |

---

## 5. 剩余缺陷与观察项

### 5.1 唯一剩余缺陷（不阻断内部/试用，外发前建议修复）

| 编号 | 问题 | 证据 | 阻断性 |
| --- | --- | --- | --- |
| P2-3 | 安装包无自定义图标、未签名 | 构建日志：`default Electron icon is used`、`no code signing certificate configured`；`win.signAndEditExecutable=false` 同时跳过元数据/图标编辑与签名 | 内部/试用**不阻断**；外发前会触发 SmartScreen 且无品牌图标 |

### 5.2 观察项（非缺陷，未定级）

1. **功能说明正文长度漂移**：`docs/wave3-functional-report.md` 记录 3786 字，本次 3353 字；首行与文档结构一致，属沙箱 `首页.md` 内容变更，不是渲染回归（本次额外断言 Markdown 表格 4 个）。
2. **AI 模型下拉 3 项**：其中一项 id/标签为「默认」，来自 settings 的模型组配置；选择器数量仍为 1，无重复 UI。
3. **Playwright download 事件缺失**：Electron + Playwright 下 `page 'download'` 仍不触发；主进程 `will-download` 重定向后文件真实落盘 22,343 bytes 且 JSON 内容正确，按“文件落盘 + toast”判 PASS，属框架限制。
4. **首页原型自带 mobile kind**：点击「首页」会经 `sources-store.enterSource` 把舞台切到 mobile（产品既有行为）；测试需显式切 PC 才能看到 `doc-toc-sidebar`。已写入用例 B，避免后续误判。
5. **项目下拉本次仅 1 个真实项目**：与 `.devdata` 当前数据一致，非空态。

---

## 6. 最终放行结论

- **可交付（内部/试用）**：类型检查、250 项单测、103 项 E2E（93 passed / 10 skipped）、64 项 Node 全量（core 38 + legacy-ui 26，含新增 `git-credential` 套件）、renderer 构建、electron-builder 打包、4 项 Electron 真机全部 PASS，P0/P1 为 0。
- **外发前**：必须先处理 P2-3（`win.icon` + 代码签名）；其余 P2 已清零（P2-2 体积 91.16 MiB、P2-4 拆包、P2-1 Git 收尾、P1-1 移动端文档遮挡均保持已修复）。
- **无需返工**：本轮未发现产品回归；测试代码的 2 处规则过期与 4 处静态契约过期已按新契约修正，未删用例、未降低断言强度。

---

## 7. 复跑命令

```bash
npx tsc --noEmit
npx vitest run
npx playwright test
node tests/run-all.js
npm run build:renderer
npm run build
npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts
```

- 安装器：`桌面端/原型工具 Setup 1.2.0.exe`
- 真机截图：`docs/wave3-functional-shots/`（01–09 主路径，10-p0p1-* 回归复核）
- 打包体积分析：`docs/packaging-size-analysis.md` §11
- 历史功能验收：`docs/wave3-functional-report.md`（本文以本轮实测数字为准）
