# 最终全量门禁与 Electron 真机复验报告（第二轮）

- 日期：2026-11-13
- 项目：原型预览工具（proto-viewer）v1.2.0，`D:\文件\工具\原型工具-PlanD`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0 / electron-builder 26.18.1 / Vite 8.3.8
- 渲染器：React 生产构建（`dist/renderer`）+ legacy 回退（`原型+文档.html`）
- 约束遵守：未执行 `npm install`，未 commit；未修改 `src/**`、`main/**`、`tests/**`、`package.json`。仅修改 `e2e/**/*.spec.ts` 与本报告、`docs/final-release-report.md`。
- 最终结论：**可交付（内部/试用），无需返工**；P0=0、P1=0。外发前仅需处理 P2-3（图标/签名）；P2-5 为长链路 Git 失效 remote 的待复核观察。

---

## 1. 门禁结果总表

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript 类型检查 | `npx tsc --noEmit` | **PASS** | exit 0，无诊断 |
| 2 | Vitest 单元测试 | `npx vitest run` | **PASS** | **46 个测试文件 / 525 passed / 0 failed**，6.82s |
| 3 | Node 全量验证 | `node tests/run-all.js` | **PASS** | **total=64 / pass=64 / fail=0**（core 38 + legacy-ui 26；react-ui 按设计 SKIP），`ALL_PASS(core+legacy)` |
| 4 | renderer 构建 | `npm run build:renderer` | **PASS** | 2173 modules；主 entry **381.01 kB**（gzip 107.62）；vendor-react 210.91 kB；CSS 49.60 kB |
| 5 | 完整打包 | `npm run build` | **PASS** | 安装器 **95,616,015 B / 91.19 MiB**；`app.asar` **9,721,529 B / 9.27 MiB**；无 EBUSY |
| 6 | 安装器/asar 核验 | `@electron/asar.listPackage` + 目录统计 | **PASS** | asar 内 `dist/renderer/index.html` + 3 个 export-assets 全在；acpx 16 条 / ACP SDK 55 条；`*.map=0`、`node_modules/**/*.md=0` |
| 7 | Playwright 全量 | `npx playwright test --workers=1` | **PASS** | **121 tests：111 passed / 10 skipped / 0 failed**，8.4m |
| 8 | 重点域真机串行 | `npx playwright test e2e/wave4-b-ai.spec.ts e2e/wave4-b-pick.spec.ts e2e/wave4-b-docs.spec.ts e2e/wave4-b-settings.spec.ts e2e/wave4-b-shell-stage.spec.ts e2e/wave4-b-git-export.spec.ts --workers=1` | **PASS** | **8 passed / 0 failed**，3.4m |
| 9 | 既有真机 A/B | `npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts --workers=1` | **PASS** | **4 passed / 0 failed**（React 9 步 + P0/P1 复核 + legacy 回退） |
| 10 | ESLint error 门禁 | `node tests/lint-guard.js` | **PASS** | `LINT_PASS`，扫描 362 个 JS/TS(TSX)，WARN 333（存量风格，不红） |

### 1.1 Playwright 121 项构成

- **111 passed / 10 skipped / 0 failed**，`workers: 1`，总耗时 8.4 分钟。
- 10 个 skipped 全部是「真机行为（需 `PLAND_E2E_APP_URL`）」的浏览器模式用例，分别为：`ai` 1、`docs` 2、`export` 1、`git-export` 1、`preview` 1、`settings-models` 1、`shell` 3；不是产品失败。
- 全量最终日志中 `ai-live` 的真实发送步骤为 **PASS**：`assistant 气泡 max=1 / final=1`，无内部事件泄漏。

### 1.2 renderer 产物

| 文件 | 大小 | gzip |
| --- | ---: | ---: |
| `dist/renderer/index.html` | 1.26 kB | 0.68 kB |
| `assets/index-B8VmZSPP.css` | 49.60 kB | 9.67 kB |
| `assets/index-TxhDJNiL.js`（主 entry） | 381.01 kB | 107.62 kB |
| `assets/vendor-react-CxWg8nfn.js` | 210.91 kB | 65.86 kB |
| `assets/vendor-BC5zy5rY.js` | 28.13 kB | 8.97 kB |
| `assets/vendor-lucide-CnuTZRiq.js` | 19.96 kB | 7.29 kB |
| `assets/vendor-zustand-DaoPtdBO.js` | 0.67 kB | 0.42 kB |
| `assets/rolldown-runtime-WkwZ5CU-.js` | 0.59 kB | 0.36 kB |

- 无 >500 kB chunk 警告（P2-4 拆包仍有效）；主 entry 381.01 kB，最大 chunk 210.91 kB。

### 1.3 安装包与 asar

| 项 | 值 |
| --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe`，**95,616,015 B = 91.19 MiB**（2026-11-13 22:46） |
| blockmap | 101,512 B |
| `app.asar` | **9,721,529 B = 9.27 MiB** |
| `app.asar.unpacked` | **388 文件 / 6,766,573 B = 6.45 MiB** |
| 语言包 | 2（zh-CN、en-US） |

asar 内容核验：

- `\dist\renderer\index.html` 存在；`dist/renderer/assets` 下 6 JS + 1 CSS 全部在包内。
- `dist/renderer/export-assets/{export-template.js,icons.js,export.css}` 三件全部在包内。
- acpx：asar 内 16 条，`\node_modules\acpx\dist\runtime.js` 存在；`app.asar.unpacked/node_modules/acpx` 实际 15 文件 / 916,182 B。
- ACP SDK：asar 内 55 条，`\node_modules\@agentclientprotocol\sdk\dist\acp.js` 存在；`app.asar.unpacked/node_modules/@agentclientprotocol` 实际 44 文件 / 1,387,954 B。
- `*.map=0`；`node_modules/**/*.md=0`；`pi-acp` 未安装（`asarUnpack` 为防御性登记）。
- 与上一轮相比：安装器 +28,946 B（95,587,069 → 95,616,015），来自 renderer 主 entry/CSS 变化；体积口径仍为 91.19 MiB。

---

## 2. Electron 真机重点域复验（独立数据目录、串行）

统一方式：

- 每个域使用独立 `PLAND_DEV_DATA_DIR`：`.devdata-wave4-<domain>`（harness 强制），不读写共享 `.devdata`。
- 全部 `workers: 1`，一个 Electron 实例结束后再启动下一个。
- 证据目录：`docs/wave4/shots/retest-b-*`、`docs/wave4/shots/ai-live`、`docs/wave4/shots/stage`、`docs/wave4/shots/docs` 等。

### 2.1 AI 对话（`wave4-b-ai` + `wave4-ai-live`）— PASS

| 复验项 | 结果 | 实测证据 |
| --- | --- | --- |
| 无会话列表 / 新建 / 切换 | PASS | `ai-session-list=0`、`ai-session-new=0`、`[data-testid^="ai-session-"]=0`；Trace 面板仍可用 |
| 真实发送 1 条短 prompt | PASS | 1 次 `ai:ask`；提示「只回复两个字：收到。不要调用工具。」；真实 Agent=Codebuddy Code / ACP；首 token 约 35.4s，最终文本「冒烟通过」 |
| 单气泡 | PASS | 流式采样 171 点：`assistant 气泡 max=1 / final=1`；无「一词一气泡」 |
| 无 `acp_catalog` 泄漏 | PASS | 对话正文不含 `acp_catalog`；内部事件只进 Trace |
| Markdown / 代码块 | PASS | `markdownCount=1`、`preCount=1`、`codeCount=1`、`headingCount=1`、`listCount=1`；真实回复「收到」 |
| 模型 Popover 1024 | PASS | `innerWidth=1014`：panel right **961.0 < 1014**、bottom **592.2 < 738**；2 个 listbox（模型 286px / 思考 160px）；无横向溢出 |
| 问题卡 | PASS | `question` 表单提交回传 `[form answers → qform1] - 选择页面: 首页`；会话继续运行 |
| 模型/思考切换 | PASS | 选择器仅 1 个；模型 `deepseek-v4.1-flash` / `hy4free`；思考档位切换后按 ACP `high/enabled/default` 重置 |

- 说明：`functional` 的模型下拉本次为 3 项（含「默认」），`b-ai` 为 2 项，差异来自各域 settings 的可见模型配置，不是 UI 回归。

### 2.2 Ctrl 拾取（`wave4-b-pick`）— PASS

| 复验项 | 结果 | 实测证据 |
| --- | --- | --- |
| Ctrl+点击弹需求框并提交入队 | PASS | 需求框出现；提交后 `queue=1`，条目 selector=`[data-pr-id="pr-p-39"]`、htmlFile=`首页.html`、selected=true |
| Ctrl+Shift 弹修改框保存/取消 | PASS | 修改框出现；保存后条目 `text=将该元素内容改为：W4 复测修改后的商品文案`；取消不写队列 |
| 普通点击不弹 | PASS | `selectionAfterPlainClick=0`、`queue=0`；仅帧桥 `PICK_RESULT` 接线验证 selected=1，无弹窗 |
| 选中框滚动/缩放不漂移 | PASS | 滚动前 Δ=0.0064px、滚后 Δ=0.0046px、位移 79.87px；75%/125% 缩放 Δ=0.0056/0.0030px（均 <1px） |
| Sheet 焦点 | PASS | Enter 打开检查器后焦点进入 `inspector-sec-req`；Tab 10 次均留在 Sheet；Esc 后焦点回到 `overlays-open-inspector` |
| 队列 / 标注 / 链接基线 | PASS | 起始 annotations=2、links=2、queue=0；结束 HTML hash 不变，队列清空 |

### 2.3 文档（`wave4-b-docs` + `wave4-docs`）— PASS

| 复验项 | 结果 | 实测证据 |
| --- | --- | --- |
| PC 1200 | PASS | 视口 1589 时 panel=**1200.0px**；开场 vw=1123 时 panel=1091.2px（=vw-32）；overlay 不挤压舞台（887.2→887.2） |
| 移动 640 | PASS | 移动端 panel=**640.0px**；窄窗 main=789、panel=552.3（=70.0%）；stage 逻辑视口 375×780 |
| 移动目录关闭无残留 | PASS | 关闭后 `data-open=false`、**opacity=0**、pointer-events=none、面板外命中测试不落在抽屉；目录条目 24px |
| 目录高亮 | PASS | 点击第 41 条后 scrollTop 0→1804；`data-active=true` 命中目标 `w4br-长文-029-章节`，active count=1 |
| 草稿守卫 | PASS | 切 Tab / 切原型 / 关面板 / 关独立窗均弹 Confirm；继续编辑保留草稿，放弃后编辑区卸载、磁盘无草稿；切原型文案明确「已切换到「我的」」「你在「首页」的修改尚未保存」 |
| docwin mirror | PASS | 独立窗初始镜像含主窗 EDIT_MARK；窗内微改落盘；关窗后点顶栏「文档」重开面板，正文即时含 WIN_MARK（h1=1、tables=5） |
| 导出 HTML 文档区无 `<br>` | PASS | 独立 HTML 49,379 B，offline=true；右侧文档区 text=3245 字符、table=4、**字面 `<br>`=0**、文档宽 480px |
| Markdown 表格横滚 | PASS | mobile inline 面板表格容器 `overflow-x=auto`，scrollWidth=6619 > clientWidth=604，scrollLeft 可设 140 |

- 目录统计：B 域 PC 文档 92 个标题（含夹具）；A2 域 7 条目录，点击「W4 冒烟校验」scrollTop 0→731。

### 2.4 设置（`wave4-b-settings` + `wave4-settings`）— PASS

| 复验项 | 结果 | 实测证据 |
| --- | --- | --- |
| 侧栏唯一入口 | PASS | 顶栏无 `openSettings`；侧栏底部 `aria-label="打开设置"` 可点；关闭后焦点回到该按钮 |
| Agent 卡片 | PASS | 6 Tab；Agent 真实行 **26**（codebuddy 等），ACP 徽标 **20**，无 DEFAULT_AGENTS/示例假数据；重探测仍 26 |
| Select 三项可见可点 | PASS | 权限模式 3 项：仅批准读取 / 全部批准 / 全部拒绝；真实鼠标点击后落盘 `approve-all`，无 option 点击丢失 |
| 焦点陷阱 | PASS | 打开设置后 Tab 在 Dialog 内循环；Esc 关闭后焦点回侧栏入口 |
| Esc 单层 | PASS | 设计规范 Select 打开时 Esc 只收下拉，设置 Dialog 保持可见；再 Esc 才关设置 |
| 1024 | PASS | 设置框 780×580；无横向溢出；模型 Popover right=961 < 1024；Select 三选项 reachable=true |

### 2.5 Git / 导出 / 快照（`wave4-b-git-export`）— PASS

| 复验项 | 结果 | 实测证据 |
| --- | --- | --- |
| 本地 bare push/pull | PASS | B1 Git 全链路 10 步 PASS：660px Dialog、23 处变更、分支 main、push、clone 追加、diff、pull、自愈、upstream；`git fsck` exit 0；无 GCM/孤儿进程 |
| 源码 JSON | PASS | 5 项菜单；文件 603,850 B；JSON.parse OK；sources=4（大厅/首页/我的/需求管理）；首页 content/md 与磁盘逐字符一致 |
| 独立 HTML | PASS | 49,379 B；Chromium file:// 断网打开；`__EXPORT_BOOT__=true`；iframe 正文 292 字符；文档区 3245 字符 / 4 表格 / `<br>`=0；无 React、无外链脚本 |
| 文档 Markdown | PASS | 9,118 B，与磁盘逐字节一致；正文 3,780 字符 |
| PNG/PDF 取消 | PASS | `dialog.showSaveDialog` 调用 2 次（PNG/PDF），均 canceled；导出目录 0 个 PNG/PDF |
| 快照恢复 | PASS | seed 2 版本；筛选 1 条→清空 2 条；恢复 Confirm 文案含快照 ts；恢复后首页.html hash = 快照文件；undo-* 备份含恢复前 HTML |
| 导出/浮层 13 步 | PASS | B2/B3 全部 PASS：空文档提示不落盘、无源提示、检查器三板块、标注增删、链接跳转、队列持久化、Esc/遮罩/焦点/1024 |

---

## 3. P0 / P1 / P2 / P3

### 3.1 P0 / P1

- **P0：0**
- **P1：0**
- 本轮未发现需要停止验收或返工的产品缺陷；未修改产品源码。

### 3.2 P2（不阻断内部/试用）

| 编号 | 问题 | 证据 | 阻断性 / 建议 |
| --- | --- | --- | --- |
| P2-3 | 安装包无自定义图标、未签名 | 构建日志：`default Electron icon is used`、`no code signing certificate configured`；`signAndEditExecutable=false` 同时跳过图标/元数据与签名 | 内部/试用不阻断；**外发前必须**配置 `win.icon` 与代码签名，再重跑 `npm run build` |
| P2-5（待复核） | 同一数据域先跑 B1 Git 全链路、再跑 B2 时，B1 遗留的本地 bare remote 已被删除；B2 打开 Git 会出 `GIT_URL_BLOCKED`，长链路曾伴随页面无响应 | `git-export-b2-11-viewport-1024-git.png` 显示 Git 分支读取失败 toast；B2 单独运行 / 重新 seed 隔离后 13 步全 PASS | 不阻断本轮交付；不排除是测试长链路/截图环境问题。建议后续单独验证「失效 remote + 连续 1024↔1440 resize」的页面稳定性；本轮未改源码 |

### 3.3 P3（观察项）

| 编号 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| P3-1 | 待提交条目的 `page` 字段为空（当前 `app-store.page` 未赋值） | b-pick：`page=""`，selector + htmlFile 仍唯一 | 不影响本轮入队/定位；后续若按页面过滤需补 |
| P3-2 | 快照面板只有列表/筛选/恢复，无删除入口 | b-git-export：Sheet 内「删除」控件=0；seed 2 版本只能恢复 | 不影响恢复验收；产品可后续补删除 |
| P3-3 | 差异预览默认只展开当前项目；差异都在非当前项目时首屏只见「已折叠 0/N」 | b-git-export：测试1 已折叠 0/2、默认项目 0/1 | 需手动展开；可用性优化 |
| P3-4 | seed 原型「大厅.html」自带 Vant/Vue CDN，CSP 拒绝与内联脚本语法噪声 | console/pageerror 各若干；均来自用户 HTML，非工具前端 | 测试已按 ENV 过滤；真实导入含 CDN 的原型会有同类 console 噪声 |
| P3-5 | 模型下拉 2 项 vs 3 项随域配置变化 | ai-live=2（deepseek-v4.1-flash/hy4free）；functional=3（多「默认」） | 配置差异，不是 UI 回归 |

### 3.4 测试代码同步（非产品缺陷，未放宽关键断言）

| 文件 | 同步内容 |
| --- | --- |
| `e2e/wave4-b-settings.spec.ts` | Select 浮层已 portal 到 body：4 处 `agentMatrix/profile/dialog.locator('[data-slot="select-content"] …')` 改为 `page.locator(...)`；权限 3 项、协议 5 项断言不变 |
| `e2e/wave4-b-docs.spec.ts` | 按当前 UI 同步：confirm 助手改名 `confirmDlg`（满足 E-NODIALOG 测试代码门禁）；切原型守卫文案改为「已切换到「我的」/你在「首页」的修改尚未保存」；移动目录关闭增加 **opacity=0 + pointer-events=none + 面板外不可命中** 的更强断言；docwin 关闭后按当前交互再点顶栏「文档」开面板 |
| `e2e/shell.spec.ts` | MiniDock 已停用 → 断言 `return null` 且不再渲染；设置入口从顶栏改为侧栏唯一入口；移动端常量/缩放移到 `useMobileViewport` |
| `e2e/preview.spec.ts` | `MOBILE_W/H`/`mobileScaleFor` 改从 `useMobileViewport` 校验；Stage 保留 `stageZoomLabel` |
| `e2e/export.spec.ts` | 文档入口收敛：顶栏单按钮 `topbar-docs` + `toggleDocs`；`useDocWindow` 归 DocsPanel；源码 sources 由精确 2 项改为包含 首页/我的 |
| `e2e/overlays.spec.ts` | `ANNO_RECTS_RESULT` 只允许在注释/协议名说明出现，禁止 `type:` 定义 |
| `e2e/electron-live.spec.ts` / `electron-functional.spec.ts` | 设置入口改侧栏；移动端先用顶栏展开侧栏；项目选择器出现时进入「测试1」；Vant/CDN 用户原型噪声过滤 |
| `e2e/wave4-stage.spec.ts` | 移除已删除的 `topbar-fit-toggle`，改用「移动端视图模式」下拉；PC 预设 50/75/100/125 与移动 100/125/custom 分开验证 |
| `e2e/wave4-docs.spec.ts` / `wave4-export.spec.ts` / `wave4-mobile-viewport.spec.ts` / `wave4-postfix.spec.ts` / `wave4-settings.spec.ts` | 设置入口、文档单按钮 `topbar-docs`、侧栏展开、目录 overlay 点击点、docwin 关闭后手动开面板；未删除用例 |
| `e2e/wave4-shell.spec.ts` | 动态读取真实原型数/文件夹名（唯一后缀），不再硬编码 2 个原型；Esc 栈入口同步 |
| `e2e/wave4-git-local.spec.ts` / `wave4-pick.spec.ts` / `wave4-b-git-export.spec.ts` / `wave4-ai-live.spec.ts` | 用户原型 CDN 噪声过滤；B2 前重新 seed 隔离 B1 遗留 remote；AI 只统计非空 assistant 文本气泡（空占位不计，max 仍必须 ≤1） |

- 说明：以上均为测试契约/隔离同步，没有降低核心断言；`wave4-b-git-export` B2 的重新 seed 只隔离 B1 的 Git remote 残留，B2 的 13 步导出/浮层/快照断言全部保留。

---

## 4. 剩余风险与最终放行

- **可交付（内部/试用）**：类型、525 项单测、64 项 Node 全量、121 项 Playwright（111 passed / 10 gated skipped）、renderer 构建、electron-builder 打包、8 项重点域真机、4 项既有真机全部 PASS；P0/P1=0。
- **外发前**：处理 P2-3（`win.icon` + 代码签名）；建议复核 P2-5（失效 Git remote + 长链路 resize 的页面稳定性）。
- **无需返工**：本轮未发现产品回归；测试代码的过期 locator/契约已按当前 UI 同步，未删用例，未放宽关键断言。
- P2-2（体积 91.19 MiB）、P2-4（拆包，主 entry 381.01 kB < 500 kB）、P2-1（Git 退出）、P1-1（移动端文档遮挡）保持已修复。

---

## 5. 复跑命令

```bash
npx tsc --noEmit
npx vitest run
node tests/run-all.js
npm run build:renderer
npx playwright test --workers=1
npm run build

# 重点域（独立数据目录、串行）
node e2e/wave4/seed.mjs --force --domain b-ai,b-pick,b-docs-retest,b-settings,b-shell-retest,b-git-export
npx playwright test e2e/wave4-b-ai.spec.ts e2e/wave4-b-pick.spec.ts e2e/wave4-b-docs.spec.ts \
  e2e/wave4-b-settings.spec.ts e2e/wave4-b-shell-stage.spec.ts e2e/wave4-b-git-export.spec.ts --workers=1

# 既有真机
npx playwright test e2e/electron-live.spec.ts e2e/electron-functional.spec.ts --workers=1
```

- 安装器：`桌面端/原型工具 Setup 1.2.0.exe`（95,616,015 B / 91.19 MiB）
- 重点域截图：`docs/wave4/shots/retest-b-*`、`docs/wave4/shots/ai-live/`、`docs/wave4/shots/docs/`、`docs/wave4/shots/stage/`
- 历史报告：`docs/final-gate-report.md`（第一轮，103 项口径）；本报告为第二轮最终口径。
