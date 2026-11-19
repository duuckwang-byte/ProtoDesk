# 冒烟 T3「文档/docwin 域」报告

- 工作目录：`D:\文件\工具\原型工具-PlanD`
- 范围：`src/renderer/features/docs/*`、`src/renderer/app/modes/DocWindow.tsx`、`src/renderer/stores/docs-store.ts`、`main/controllers/window-controller.js`（只读）、`tests/verify-docwin.js`
- 禁令遵守：未改 `src`/`tests`/`main`/`package.json`，未跑 `npm install`，未 commit；唯一写操作为本文件（新建）。

## 1. 必跑命令原文粘贴

### 1.1 `node tests/verify-docwin.js`

```text
Platform: win32 arch=x64
Node: v24.15.0 execPath=C:\Program Files\nodejs\node.exe
[PASS] A1 主进程docwin三通道
[PASS] A2 镜像中继透传
[PASS] A3 关窗通知panel
[PASS] A4 主窗联带关闭
[PASS] A5 preload暴露
[PASS] A6 isDocWinMode
[PASS] A7 bootDocWinMode
[PASS] A8 handleDocMirror四kind
[PASS] A9 mirrorPush防环
[PASS] A10 双Tab与reqMode切换
[PASS] A10b
[PASS] A10b 合一单壳tab
[PASS] A10c
[PASS] A10c 目录左侧固定列
[PASS] A11 切换按钮文案互换
[PASS] A12 apply源码语义
[PASS] S1 窗口判别+按钮文案真执行
[PASS] S2 面板模式真执行(开/收/幂等/窗内禁)
[PASS] B1 Tab胶囊120px/圆角50
[PASS] B2 docwin恒左目录右文档220px
[PASS] B3 docwin maximize+默认openToc
[PASS] E1 docwin前端open带参透传
[PASS] E2 切回显式开/X关仅同步
[PASS] E3 API卡片隐URL模型Key
[PASS] E4 行号属性存在
[PASS] E5 微改段落格级
[PASS] E6 文档窗query直进禁picker闪
[PASS] F1 高度链100vh+独立滚动
[PASS] D1 无渐变无emoji红线
[PASS] H1 独立窗切Tab无遮罩
[PASS] H2 F12控制台开关
SUMMARY passed=29 failed=0
DOCWIN_PASS: 全部29项独立文档窗口断言通过
```

结论：29/29 通过。注：该脚本断言对象是旧栈（`main.js`/`preload.js`/`js/core-docs.js`/`原型+文档.html`/`app.css`），不是本域 React 新文件；仅证明旧通道契约未被破坏。

### 1.2 `npx playwright test e2e/docs.spec.ts`

```text
Running 9 tests using 1 worker
  ok 1 e2e\docs.spec.ts:27:3 › docs 静态契约（I 波文档） › docs-panel 双形态：overlay（PC）+ inline（移动） (13ms)
  ok 2 e2e\docs.spec.ts:35:3 › docs 静态契约（I 波文档） › PC 悬浮 fixed + 遮罩关闭；移动行内 border-l 挤压 (3ms)
  ok 3 e2e\docs.spec.ts:42:3 › docs 静态契约（I 波文档） › MainWindow 按 kind 分流文档容器（PC 悬浮不参与分栏） (3ms)
  ok 4 e2e\docs.spec.ts:48:3 › docs 静态契约（I 波文档） › ?docwin=1 路由桩 + doc-window 容器 (5ms)
  ok 5 e2e\docs.spec.ts:55:3 › docs 静态契约（I 波文档） › 独立窗口订阅 mirror 通道 (5ms)
  ok 6 e2e\docs.spec.ts:59:3 › docs 静态契约（I 波文档） › Popover 基建存在（微改浮层用） (3ms)
  -  7 e2e\docs.spec.ts:65:3 › docs 静态契约（I 波文档） › doc-micro-edit 段落微改 Popover（I 待交付，仅记阻塞）
  -  8 e2e\docs.spec.ts:84:3 › docs 真机行为（需 PLAND_E2E_APP_URL） › PC 文档悬浮不挤压舞台
  -  9 e2e\docs.spec.ts:94:3 › docs 真机行为（需 PLAND_E2E_APP_URL） › Esc 关闭文档
  3 skipped
  6 passed (1.1s)
```

结论：6 passed / 3 skipped。跳过项中 1 项为 `fixme`（见缺陷 D1），2 项为 `PLAND_E2E_APP_URL` 门控真机用例（无浏览器环境，未执行）。

## 2. 语义抽查（逐条 PASS/FAIL）

| # | 检查项 | 结论 | 依据（file:line） |
|---|---|---|---|
| S1 | DocWindow 只渲染文档面板 | PASS | `src/renderer/app/modes/DocWindow.tsx:85-92` 仅渲染 `<DocsPanel variant="overlay" />`，无 Topbar/Sidebar/Stage |
| S2 | open 上报 mode=win | PASS | 同上 `:46`，`reportMode("win")`；`reportMode` 经 `invokeProtoMethod("doc","mirrorBack",{kind:"mode",mode})`（`:23-29`） |
| S3 | close 回 mode=panel | PASS | 同上 `:68` beforeunload + `:81` 卸载清理均 `reportMode("panel")`，与主进程 `closed` 通知互补（注释 `:11`） |
| S4 | project/proto query 直进 | PASS | 同上 `:33-43`，`URLSearchParams` 取 `project`/`proto` 直写 `app-store`；`main.tsx:16` 以 `docwin=1` 分流 DocWindow |
| S5 | mirror 事件名与旧通道一字不差 | PASS | `events.ts:15` `DOC_MIRROR_CHANNEL='doc:mirror'` ≡ `preload.js:34` `ipcRenderer.on('doc:mirror')` ≡ `window-controller.js:89,133,141` `send('doc:mirror')`；`preload.js:64-65,72-73` `invoke('doc:mirror-push'/'doc:mirror-back')` ≡ `window-controller.js:128,139` `ipcMain.handle(...)` ≡ `main/ipc-contract.js:65-66`、`types/ipc.d.ts:45-46`；DocWindow 经 `lib/events onDocMirror` 订阅（`:20,48`），上报经 `mirrorBack` 网关映射，不自造通道 |
| S6 | DocsPanel overlay/inline 双形态由 props 切换 | 条件PASS（见 D2） | `features/docs/DocsPanel.tsx:18-26,70-75` `variant: "overlay"\|"inline"` → `data-variant`，内容只做 Tab+目录+搜索+编辑器（`:1-9` 注释）；但 `DocsPanelHost` 尚未装配它（见缺陷） |
| S7 | doc-micro-edit testid 存在 | 源码PASS / 用例FAIL（见 D1） | `features/docs/DocEditor.tsx:74` `data-testid="doc-micro-edit"` 存在；但 `e2e/docs.spec.ts:66-80` 只在 3 个旧文件中查找，漏掉真实位置，恒 `fixme` 跳过 |
| S8 | DocEditor 内核包壳未重写（无自研 markdown 解析器） | PASS | `DocEditor.tsx:1-9,119` 声明只接管容器/工具栏/保存，原生 `contenteditable` + 浏览器 undo（`:180-190`）；渲染委托遗留 `renderMd/renderMdPreview`（`docs-store.ts:182-201`），本地仅转义+标题/加粗/段落 fallback；`grep(marked\|markdown-it\|remark\|unified)` 在 `features/docs` 零命中（仅命中 `renderMd` 包壳引用与 `contenteditable`） |
| S9 | 保存走 doc 通道、失败 toast | PASS | `stores/docs-store.ts:253` `invokeProtoMethod("doc","writeLatest",...)`，失败两路 `:264,273` `pushToast({title:"文档保存失败",variant:"destructive"})`；禁 `alert/confirm/prompt`（`DocEditor.tsx:8`） |
| S10 | PC 浮层不挤压原型（无 Resizable/分栏） | PASS | `MainWindow.tsx:62` PC `<DocsPanelHost/>` 置于 `flex-1` 行之外；`DocsPanelHost.tsx:47-61` PC 为 `fixed bottom-4 right-4 top-12 z-50` + `docs-overlay fixed inset-0 z-40 bg-black/30`；移动 `:76-85` 行内 `border-l` 挤压符合 §8.1；`grep(Resizable)` 在 `src/renderer` 零实现命中（仅 `styles/globals.css:137` 禁用注释与 `AiDialog` 约束注释） |

## 3. 缺陷清单

| ID | 级别 | 位置 | 描述 | 影响 |
|---|---|---|---|---|
| D1 | P2（用例侧，测试恒跳过） | `e2e/docs.spec.ts:66-80` vs `src/renderer/features/docs/DocEditor.tsx:74` | `doc-micro-edit` 断言的检索文件表（`DocsPanelHost`/`AnnoPanel`/`InlineEdit`）已过期，未包含真实宿主 `features/docs/DocEditor.tsx`，`has` 恒为 `false` → `test.fixme` 恒跳过，源码 PASS 也无法被用例证明 | T3 用例表 S7 名义覆盖、实际零断言；修测试文件即可，不动业务 |
| D2 | P1（集成未接线，G 壳/I 芯脱节） | `src/renderer/components/shell/DocsPanelHost.tsx:1-18,64-70,87-93` | Host 仍渲染 `data-testid="docs-placeholder"` 占位（“内容由 Wave2-I 填充”），未 `import`/`渲染` `features/docs/DocsPanel`；`MainWindow.tsx:59,62` 与 e2e 双形态断言（S10）只覆盖到壳，真实 `DocsPanel`/`DocEditor`/`DocToc` 在主窗路径不可达；`DocWindow.tsx` 直引 `DocsPanel` 故独立窗不受影响 | 主窗打开文档看到的是占位而非文档内容；S6 判条件 PASS 的原因；需 I 波接线任务认领（本冒烟不改） |

注：`DocsPanel` 自身 `data-testid="docs-panel-content"` 与 Host 的 `data-testid="docs-panel"` 并存，不判为缺陷（各守一层，e2e 锚点仍为 Host）。

## 4. 结论

- 自动化：`verify-docwin.js` 29/29（旧栈契约守住）；`e2e/docs.spec.ts` 6 过 / 3 跳（1 fixme + 2 真机门控）。
- 语义：S1–S5、S8–S10 均为 PASS；S6 条件 PASS、S7 源码 PASS，阻塞分别记 D2、D1。
- 缺陷：P1×1（Host 未装配 DocsPanel）、P2×1（e2e 检索表过期致恒跳过）；均定位到 `file:line`，本次只读报告、未修复。
- 发布意见：docwin 独立窗路径可放行；主窗文档内容路径因 D2 不可放行，需先完成 Host→DocsPanel 接线并更新 e2e 检索表后复测。
