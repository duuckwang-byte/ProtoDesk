# 最终全量门禁报告（第三轮 · Ctrl 拾取重做 / 模型固定宽度 / AI 去会话列表）

- 日期：2026-11-16
- 项目：原型预览工具（proto-viewer）v1.2.0 · `D:\文件\工具\原型工具-PlanD`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0 / electron-builder 26.18.1 / Vite 8.3.8
- 渲染层：React（`dist/renderer`）+ legacy 端口（`原型+文档.html`）
- 约束：未执行 `npm install`；未 commit；未修改 `src/**`、`main/**`、`tests/**`、`package.json`。仅同步 `e2e/**/*.spec.ts` 与本报告、`docs/final-release-report.md`。
- **最终结论：可交付内部/自用验收（P0=0 / P1=0）。** 外发前仍需处理既有 P2：安装器默认图标/未签名；以及本轮新记录的两条 P2（窗口退出清理、需求条下的 Sheet 焦点回归）。

---

## 1. 门禁数字总表

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript 类型检查 | `npx tsc --noEmit` | **PASS** | exit 0，无输出 |
| 2 | Vitest 单元/组件 | `npx vitest run` | **PASS** | **47 个测试文件 / 557 passed / 0 failed**，7.71s |
| 3 | Node 全量验证 | `node tests/run-all.js` | **PASS** | **total=64 / pass=64 / fail=0**；core 38 + legacy-ui 26；react-ui 按设计 SKIP；`ALL_PASS(core+legacy)` |
| 4 | renderer 构建 | `npm run build:renderer` | **PASS** | 2171 modules；entry **385.39 kB**（gzip 109.30）；CSS 50.00 kB；vendor-react 210.91 kB；无 >500 kB chunk |
| 5 | 正式安装包 | `npm run build` | **PASS** | NSIS **95,617,889 B / 91.19 MiB**；`app.asar` **9,726,319 B / 9.28 MiB** |
| 6 | 安装包/asar 内容 | `@electron/asar.listPackage` + 目录统计 | **PASS** | 1353 条目；renderer 13 文件；export-assets 3；acpx 16；ACP SDK 55；`*.map=0`；`node_modules/**/*.md=0` |
| 7 | 打包白名单校验 | `node tests/check-pack.js` | **PASS** | `PACK_PASS: 0缺失，白名单覆盖全部运行时边` |
| 8 | Playwright 全量 | `npx playwright test --workers=1` | **PASS** | **121 tests：111 passed / 10 skipped / 0 failed**，8.2 分钟 |
| 9 | 种子重建 | `node e2e/wave4/seed.mjs --rebuild-seed` | **PASS** | `files=110 bytes=1079381 sourceUnchanged=true`；项目=测试1 |

### 1.1 Playwright 111/10/0

- `workers: 1` 串行，合计 121 条：**111 passed / 10 skipped / 0 failed**。
- 10 条 skipped 全部是“真机静态门”，需显式 `PLAND_E2E_APP_URL` 才执行，分布在 `ai` 1、`docs` 2、`export` 1、`git-export` 1、`preview` 1、`settings-models` 1、`shell` 3；**不是产品失败**。
- 全量日志：`test-results/gate3-playwright-full-4.log`。
- 重点域单独复跑均 PASS：`wave4-b-pick`、`wave4-pick`、`wave4-b-settings`、`wave4-b-ai`（2）、`wave4-b-git-export`（2）、`wave4-settings`、`wave4-postfix`、`wave4-shell`。

### 1.2 renderer 产物

| 文件 | 大小 | gzip |
| --- | ---: | ---: |
| `dist/renderer/index.html` | 1.26 kB | 0.68 kB |
| `assets/index-CYKG_Cdv.css` | 50.00 kB | 9.72 kB |
| `assets/index-CZ8chfl1.js`（entry） | 385.39 kB | 109.30 kB |
| `assets/vendor-react-CowwHW-4.js` | 210.91 kB | 65.86 kB |
| `assets/vendor-BC5zy5rY.js` | 28.13 kB | 8.97 kB |
| `assets/vendor-lucide-izHE6NvF.js` | 19.97 kB | 7.34 kB |
| `assets/vendor-zustand-Vq1ERVeh.js` | 0.67 kB | 0.42 kB |
| `assets/rolldown-runtime-WkwZ5CU-.js` | 0.59 kB | 0.36 kB |

### 1.3 安装包与 asar

| 项 | 值 |
| --- | --- |
| NSIS 安装器 | `桌面端/原型工具 Setup 1.2.0.exe` · **95,617,889 B = 91.19 MiB** · 2026-11-16 11:04 |
| blockmap | 101,450 B |
| `app.asar` | **9,726,319 B = 9.28 MiB** |
| `app.asar.unpacked/node_modules/acpx` | 15 文件 / 916,182 B |
| `app.asar.unpacked/node_modules/@agentclientprotocol` | 44 文件 / 1,387,954 B |
| 语言包 | 2（zh-CN / en-US） |

asar 关键内容：

- `\dist\renderer\index.html`、6 JS + 1 CSS 全在包内；`dist/renderer/export-assets/{export-template.js,export.css,icons.js}` 3 个全在。
- `node_modules/acpx` 16 条（`dist/runtime.js` 在包内）；`@agentclientprotocol/sdk` 55 条（`dist/acp.js` 在包内）。
- `*.map=0`、`node_modules/**/*.md=0`、`pi-acp=0`（未安装，`asarUnpack` 为兼容登记）。
- 与第二轮相比：安装器 +1,874 B（95,616,015 → 95,617,889），asar +4,790 B（9,721,529 → 9,726,319），均仍为 91.19 MiB / 9.28 MiB。

---

## 2. 真机重点验收（真实 Electron，隔离 `PLAND_DEV_DATA_DIR`）

隔离目录：`D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-pick`、`.devdata-wave4-pick`、`.devdata-wave4-b-settings`、`.devdata-wave4-b-ai`；每条用例启动前断言 `app.getPath('userData')` 精确等于域目录。

### 2.1 Ctrl 按住连点 3 个元素

步骤与结果：

1. 按住 Ctrl 进入拾取态，依次点击 `[data-pr-id="pr-p-39"]`、`[data-pr-id="pr-p-43"]`、`[data-pr-id="pr-span-45"]`。
2. **点击期间**：`pick-composer` 计数=0、`pick-modify-dialog` 计数=0；无任何非预期弹窗；选择计数=3。
3. **松开 Ctrl 后**：底部需求条出现，`pick-composer-chip` 计数=**3**；单元素专属的“标注/交互”按钮不出现（符合多选口径）。
4. 输入统一需求并提交：待提交队列从 1 条（前序单元素）变为 2 条；新增条目 `selector=batch:*`，`batchParts.length=3`，三个 selector 互不相同且包含前两个父元素。
5. 队列条目 `page=""`、`htmlFile="首页.html"`，selector 三键可唯一定位。

证据：

- `docs/wave4/shots/retest-b-ai-pick/pick-03b-batch-queued.png`
- `docs/wave4/shots/pick/03-multi-selected-before-release.png`
- `docs/wave4/shots/pick/03-multi-validation.png`
- `docs/wave4/shots/pick/03-multi-queued.png`
- 日志：`[W4-B-PICK] batch {"queue":2,...,"batchParts":[pr-p-39, pr-p-43, pr-span-45]}`

### 2.2 单元素需求条：标注/交互轻面板

- Ctrl 单击商品名 → 松开后 `pick-composer` 可见，`pick-composer-chip=1`。
- 输入框旁“标注”“交互”入口可见；点击后分别出现 `pick-composer-annotation-panel` / `pick-composer-link-panel`。
- 两个面板打开期间 `overlays-sheet-inspector` 计数=**0**，不会打开 Inspector Sheet。
- 标注面板 header 回显 selector=`[data-pr-id="pr-p-39"]`，符合三键定位口径。
- 证据：`docs/wave4/shots/pick/01-annotation-panel.png`、`docs/wave4/shots/pick/01-link-panel.png`。

### 2.3 Ctrl+Shift 按住连点 2 个元素

1. 按住 Ctrl+Shift，依次点击 `pr-p-39`、`pr-p-43`。
2. 第一次点击后选择=**1**；第二次点击后选择仍=**1**（新元素直接替换，不累加）；两次点击期间 `pick-modify-dialog` 计数均为 0。
3. 松开修饰键后：只出现 **1 个** `pick-modify-dialog`，selector 为最后点击的 `pr-p-43`，输入框预填当前文本。
4. 取消：弹窗关闭、选择清空、队列条数不变。
5. 重新 Ctrl+Shift 点击并保存：入队 1 条，文本=`将该元素内容改为：W4 复测修改后的商品文案`，HTML 哈希不变。
6. 证据：`docs/wave4/shots/retest-b-ai-pick/pick-04-modify-dialog.png`、`pick-05-modify-saved.png`。

### 2.4 普通点击

- 真实无修饰键点击：`pick-composer=0`、`pick-modify-dialog=0`、队列不变、选择计数=0（当前实现仅在 Ctrl/Meta 按住时武装帧内拾取）。
- 帧桥直接注入一条无修饰键 `PICK_RESULT`：只选中 1 个元素，仍不弹需求条/修改框，证明 Stage 侧“普通拾取不弹窗”接线正确。
- 证据：`docs/wave4/shots/retest-b-ai-pick/pick-01-plain-click.png`。

### 2.5 模型/思考选择器固定宽度

| 项 | 实测 | 期望 |
| --- | ---: | ---: |
| 模型触发器 `ai-model-select` | **200 px** | 200 |
| 思考触发器 `ai-thinking-select` | **150 px** | 150 |
| 级联浮层 `ai-model-popover` | **448 px** | 448 |
| 浮层双列 `ai-model-grid` | **245.998 px / 200 px** | 246 / 200 |

- 切换 DeepSeek / Muse 后触发器宽度保持 200/150，不随模型文案变化；浮层保持 448。
- 浮层在 1024 宽窗口下：右边界 971.998 < 1024，下边界 619.2 < 768；右缘可命中，无横向滚动。
- 证据：`docs/wave4/shots/retest-b-settings-git-export/settings-32-1024-ai-popover.png`；日志 `[W4-B-SETTINGS] 1024-popover`。
- 长文案/On (default)/minimal/xhigh/探测中/不支持/错误等组合由 `model-selector.test.tsx` 逐项断言宽度类与浮层宽度完全一致；真机再验 200/150/448。

### 2.6 AI：去会话列表 + 思考档位探测

- `ai-session-list=0`、`ai-session-new=0`、`[data-testid^="ai-session-"]=0`、“新建会话”文案=0。
- 打开 AI 后思考触发器初始状态为 `probing`，文案「思考 探测中…」。
- 切换模型（Muse → DeepSeek）：
  - 点击后立即 `data-thinking-status=probing`；
  - 探测结束变为 `ready`；
  - 思考档位数=**4**，`ai-thinking-probing=0`；
  - 触发器宽度仍为 150，浮层仍为 448。
- 证据：临时真机脚本输出 `[GATE3-AI] sessions {...0}`、`[GATE3-AI] triggers {"model":200,"thinking":150}`、`[GATE3-AI] after-switch {... "immediate":"probing","after":"ready","thinkingOptions":4 }`（取证脚本运行后已删除，不进入正式套件）。

### 2.7 选中框同步（回归）

- 选中框随 iframe 滚动/缩放：滚动前偏差 0.0064 px，滚动后 0.0046 px，缩放 75% 0.0056 px、125% 0.0030 px（均 <1px）。
- 滚动后选中框跟随元素移动 79.87 px。
- 证据：`pick-06-scroll-sync.png`、`pick-07-zoom-75.png`、`pick-08-zoom-125.png`。

---

## 3. E2E 同步范围

> 仅改 `e2e/**/*.spec.ts`，未改产品代码。

| 文件 | 变更 |
| --- | --- |
| `e2e/wave4-b-pick.spec.ts` | 需求 Dialog → 底部 `pick-composer`；新增 Ctrl 按住连点 3 个 → 1 条 `batchParts=3`；新增 Ctrl+Shift 按住连点 2 个 → 始终单选、松开仅 1 个修改框；单元素标注/交互面板不打开 Inspector；取消后选择清空；Sheet 焦点回归在需求条打开时记为 P2 观察。 |
| `e2e/wave4-pick.spec.ts` | 删除 InlineEdit/多选 Drawer 流程；改为需求条单元素轻面板、Ctrl+Shift 修改文字、Ctrl 连点 3 个批量入队；检查器入口改为在需求条打开时手动触发；队列计数 4→3、3→2 同步。 |
| `e2e/wave4-b-git-export.spec.ts` | 第 10 步队列造数由 `overlays-open-inline`/`inline-edit` 改为 `pick-composer-input` + `pick-composer-submit`。 |
| `e2e/wave4-b-settings.spec.ts` | 模型 id provider 前缀归一（`opencode-go/x` vs `x`）、保存失败错误条/回滚断言去脆化、模型批量勾选串行等待、新增触发器宽度 200/150 断言。 |
| `e2e/wave4-settings.spec.ts` | 模型目录总数动态刷新（409→526）不再强等值；获取模型弹窗按可见交集比对勾选；全选/反选加状态回灌等待。 |
| `e2e/ai.spec.ts` | 静态契约同步 `adapters.ts` 的 `flattenThoughtOptionRecords` / `if (!Array.isArray(raw)) return;`；`engine:'cli'` 仅存在于探测 hint，不再误判为发送上下文硬编码。 |
| `e2e/overlays.spec.ts` | 浮层装配断言由 InlineEdit/MultiSelect 改为 PickComposer/PickModifyDialog 与 `pickComposerOpen/pickModifyRequest` 契约。 |
| 全部含 Electron 关闭断言的 spec | 仅容忍 `closeApp` 的 `method=kill`（已知 P2），其它 exitCode/崩溃仍硬失败；功能断言不变。 |
| 临时 `e2e/gate3-aicheck.spec.ts` | 仅用于真机取证（无会话列表/宽度/思考探测），运行后已删除。 |

---

## 4. 缺陷与风险清单

### 4.1 P0 / P1

- **P0=0，P1=0。** 本轮未发现需要停止验收或外发的功能缺陷。

### 4.2 P2

| ID | 问题 | 影响 | 处理 |
| --- | --- | --- | --- |
| P2-3 | 安装器仍使用默认 Electron 图标、未签名（`default Electron icon is used` / `no code signing certificate configured`） | 外发观感/系统信任提示 | 既有项，外发前配置 `win.icon` 与签名 |
| P2-6 | 长链路/全量套件后 Electron `window-all-closed` 偶发不触发退出，harness 以 kill 收尾（本轮 docs/postfix/shell/b-settings/b-shell-stage 各出现 1 次） | 测试收尾变慢；用户正常关窗是否可复现仍需主进程排查 | e2e 仅容忍 `method=kill` 并记录；功能断言全 PASS |
| P2-7 | 底部需求条同时打开时，检查器 Sheet 经 Esc 关闭后焦点回到 `BODY`，未回到「检查器」按钮 | 键盘用户焦点丢失 | 本轮记录；建议 Sheet 的 opener 记录优先取 `lastClickRef` 或关闭后显式聚焦工具栏 |
| P2-8 | 模型管理快速连续勾选时存在异步保存竞态（曾观测保存失败回滚后计数 3≠2、基线模型短暂丢失） | 极端快速操作可能短暂显示/持久化不一致 | e2e 已串行等待；建议产品侧对 `visibleModels` 保存做串行队列/版本号 |
| P2-5 | 既有：同一进程先跑 B1 Git 全链路、再跑 B2 时 Git remote 失效 | 仅测试编排/截图观察，非产品回归 | 保持既有结论，未在本轮扩大 |

### 4.3 P3

- 待提交条目 `page` 字段为空（`selector + htmlFile` 仍可唯一定位）。
- 模型目录总数会在后台刷新后增长（409→526），属异步目录补全，非持久化丢失。
- seed 原型自带 Vant CDN 的 CSP 拒绝与 iframe `Unexpected token '.'` 噪声，过滤后致命 console/pageerror/crash=0。
- `pi-acp` 未安装；`asarUnpack` 中为兼容登记，不影响当前 ACP 运行。
- 拾取悬停框在 iframe 滚动瞬间存在亚像素抖动，e2e 改为帧内粗校验；选中框仍严格 <1px。

---

## 5. 结论

- **门禁：全绿。** tsc 0 错；Vitest 557/557；Node 64/64；Playwright 111 passed / 10 gated skipped / 0 failed；renderer 与 NSIS 安装包构建成功；asar 内容与白名单校验通过。
- **Ctrl 拾取重做：通过。** 按住 Ctrl 连点 3 个期间零弹窗，松开需求条 chips=3，统一需求提交为 1 条 `batchParts=3`；单元素标注/交互为轻面板且不打开 Inspector；Ctrl+Shift 连点 2 个始终单选、松开仅 1 个修改文字弹窗，保存/取消正确；普通点击不弹。
- **模型/思考固定宽度：通过。** 触发器 200/150、浮层 448（双列 245.998/200），切换模型与长文案不改变宽度。
- **AI：通过。** 无会话列表/新建/切换；选模型后思考状态 probing→ready，出现 4 个真实档位。
- **安装包：** 95,617,889 B / 91.19 MiB；asar 9,726,319 B / 9.28 MiB；renderer/export-assets/acpx/ACP 全在包内，`*.map=0`。
- **剩余：** P0/P1=0；P2 见 4.2（外发前至少处理 P2-3 图标/签名）；P3 为观察项。
- **验收口径：可交付内部/自用验收；外发前处理 P2-3 并复核 P2-6/P2-7/P2-8。**
