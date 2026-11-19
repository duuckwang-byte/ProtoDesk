# 冒烟测试 T2：预览 / 拾取 / 导出域

- 日期：2026-11-12
- 工作目录：`D:\文件\工具\原型工具-PlanD`
- 测试性质：只读冒烟（除本报告文件外未写任何文件；未改 `src` / `tests` / `main` / `package.json`；未跑 `npm install`；未 commit）
- 范围：
  - `src/renderer/features/preview/*`（含 `__tests__`、`lib/iframe-pick.ts`、`PreviewFrame.tsx`、`PickOverlay.tsx`、`InlineEdit.tsx`、`MultiSelect.tsx`）
  - `src/renderer/features/export/ExportMenu.tsx`
  - `src/renderer/components/overlays/MultiEditBar.tsx`
  - `dist/renderer/export-assets/`

## 1. 用例表

| 编号 | 类型 | 用例 / 断言 | 结果 |
|---|---|---|---|
| U1 | vitest | `src/renderer/features/preview` 全量（`iframe-pick.test.ts` 9 项，见 §2.1） | PASS（9/9） |
| E1 | playwright | `e2e/preview.spec.ts` 静态契约 6 项 | PASS（6/6，另 1 真机 skip） |
| E2 | playwright | `e2e/git-export.spec.ts` 静态契约 5 项 | PASS（5/5，另 1 真机 skip） |
| S1 | 语义抽查 | PreviewFrame 只用 `srcDoc` + `sandbox`，无跨域 `src` / `contentWindow.location` | PASS |
| S2 | 语义抽查 | `__EXPORT_BOOT__` 下拾取短路（悬停/点选/load/看门狗/准星五处） | PASS（含 1 低级备注 D1） |
| S3 | 语义抽查 | 看门狗 `activeElement === frame`，blur + 300ms 轮询 | PASS |
| S4 | 语义抽查 | 移动端坐标经缩放盒换算（`scaleRectToPage` / `pagePointToFrame` / `scaleBoxScale`，375×780） | PASS（单元层面；集成未接线，见 D2 观察） |
| S5 | 语义抽查 | batch / individual 提交校验文案与旧语义一致（含聚焦行为） | PASS |
| S6 | 语义抽查 | ExportMenu 含 `__EXPORT_BOOT__` / `__EXPORT_SOURCES__` 且不读根 `app.css` | PASS |
| S7 | 语义抽查 | `export-assets` 三文件存在 | PASS |
| S8 | 语义抽查 | MultiEditBar 空队列返回 `null` | PASS |

真机用例（需 `PLAND_E2E_APP_URL`）在本次环境下按设计 skip，不计失败：
`preview 真机行为` 1 项 skip、`git-export 真机行为` 1 项 skip。

## 2. 自动化原始结果（粘贴）

### 2.1 `npx vitest run src/renderer/features/preview --reporter=verbose`

```text
RUN  v5.1.0 D:/文件/工具/原型工具-PlanD

 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > 准星样式字符串沿用旧 id 与正文
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > html/body 不可拾取，其余标签可拾取
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > scaleRectToPage 沿用 editRectToPage 口径
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > pagePointToFrame 为 scaleRectToPage 的逆运算
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > 移动端缩放盒按 375 逻辑宽换算
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > frameScale 非法输入回 1
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > 选择器拼接过滤空段
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > 导出态/就地改打开时禁用拾取
 ✓ src/renderer/features/preview/__tests__/iframe-pick.test.ts > iframe-pick 纯函数 > 看门狗：activeElement===frame 即帧内

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  16:55:49
   Duration  1.80s
```

注：另有 Vite `configLoader: 'native'` 警告一行，不影响结果。

### 2.2 `npx playwright test e2e/preview.spec.ts e2e/git-export.spec.ts`

```text
Running 13 tests using 2 workers

  ok  1 e2e\git-export.spec.ts:32:3 › git-export 静态契约（L 波 Git/导出） › git-panel 卡片树：项目卡片 + 原型分组 + 文件行
  ok  2 e2e\preview.spec.ts:34:3 › preview 静态契约（H 波预览） › Stage 外框 testid 存在
  ok  3 e2e\git-export.spec.ts:42:3 › git-export 静态契约（L 波 Git/导出） › Git 不用二维 Table
  ok  4 e2e\preview.spec.ts:40:3 › preview 静态契约（H 波预览） › 预览 iframe 走 srcDoc + 同源 sandbox
  ok  5 e2e\git-export.spec.ts:50:3 › export-assets 三文件存在（构建产物随包）
  ok  6 e2e\preview.spec.ts:47:3 › preview 静态契约（H 波预览） › 无跨域写法：不读 contentWindow.location，不设 http src
  ok  7 e2e\git-export.spec.ts:58:3 › __EXPORT_BOOT__ / __EXPORT_SOURCES__ 契约保留
  ok  8 e2e\preview.spec.ts:54:3 › __EXPORT_BOOT__ 下禁用拾取与注入
  ok  9 e2e\git-export.spec.ts:67:3 › 检查器三板块 + destructive 经确认 + 无原生弹窗
  -  11 e2e\git-export.spec.ts:80:3 › git-export 真机行为（需 PLAND_E2E_APP_URL） › Git 卡片树可折叠，文件行可勾选
  ok 10 e2e\preview.spec.ts:60:3 › preview 静态契约（H 波预览） › 准星样式沿用旧 id 与正文
  ok 12 e2e\preview.spec.ts:66:3 › preview 静态契约（H 波预览） › html/body 不可拾取，其余标签可拾取
  -  13 e2e\preview.spec.ts:74:3 › preview 真机行为（需 PLAND_E2E_APP_URL） › iframe 同源可读，无 SecurityError

  2 skipped
  11 passed (1.3s)
```

## 3. 语义抽查证据（逐条 PASS/FAIL）

- **S1 PASS — 仅 `srcDoc` + `sandbox`，无跨域写法**
  - `src/renderer/features/preview/PreviewFrame.tsx:243-244`：`srcDoc={props.html}` + `sandbox="allow-scripts allow-same-origin"`。
  - 全 `preview/` 目录 grep `contentWindow.location|loadURL|src="http`：代码区零命中；仅 `PreviewFrame.tsx:114`、`PickOverlay.tsx:10-11` 注释行提及禁区说明。`contentDocument` 读取（`PreviewFrame.tsx:50-57` `frameDoc`）为 srcdoc 同源合法路径，非跨域。
  - e2e `preview.spec.ts:47-52` 同断言已 PASS。
- **S2 PASS — `__EXPORT_BOOT__` 下拾取短路**
  - `PreviewFrame.tsx:42-48` 定义 `isExportBoot()`（`window.__EXPORT_BOOT__ === true`）。
  - 短路点：`105`（准星 effect）/`126`（mousemove）/`150`（click）/`184`（onLoad）/`212`（看门狗 effect），均为首行 `if (isExportBoot()) return;`。
  - 另 `lib/iframe-pick.ts:137-139` `isPickDisabled({exportBoot, inlineOpen})` 纯函数 + 单测覆盖（exportBoot=true 即禁用）。
- **S3 PASS — 看门狗 `activeElement === frame`**
  - `lib/iframe-pick.ts:148-149`：`return !!frame && activeElement === frame`，不碰 DOM。
  - `PreviewFrame.tsx:216` blur 回调 + `224-227` 300ms 轮询均经 `isFocusInFrame(document.activeElement, frame)` 判定；帧内 return 不退出，失焦（`!document.hasFocus()`）才调 `onWatchdogExit`。注释注明“`hasFocus` 跨进程不可靠”，与旧语义一致。
- **S4 PASS（单元） — 移动端坐标经缩放盒换算**
  - `lib/iframe-pick.ts:22-24` `MOBILE_VIEWPORT_W=375/H=780`；`61-72` `frameScaleFromWidths`、`81-90` `scaleRectToPage`（`page = frame.left + rect.left * s`，沿用 `editRectToPage`）、`100-104` `pagePointToFrame`（逆运算）、`112-121` `scaleBoxScale`；单测 3 项覆盖数值（含 `750→2`、`0/NaN→1`）。
  - 局限见 D2：换算仅纯函数层面，组件集成尚未接线。
- **S5 PASS — batch / individual 校验文案与旧语义一致**
  - 新：`MultiSelect.tsx:48` `'请输入统一修改诉求。'`、`67` `'请至少为一个元素填写修改诉求。'`。
  - 旧：`js/edit-entry.js:309`、`341` 逐字相同（含全角句号）。
  - 聚焦行为一致：batch 空 → `batchInputRef.focus()`（`MultiSelect.tsx:100`）对旧 `reqInput.focus()`；individual 空 → `getElementById('indiv_input_'+首项id).focus()`（`109-111`）对旧同口径；拦截后只 `status` 提示、不进大模型提交（`99-115` return）。
- **S6 PASS — ExportMenu 契约保留且不读根 `app.css`**
  - 契约：`ExportMenu.tsx:52-53` 常量 `__EXPORT_BOOT__` / `__EXPORT_SOURCES__`；`131-136` `bootScript` 逐字拼 `window.__EXPORT_BOOT__=true`、`window.__EXPORT_SOURCES__=`、`__REQ_MAP__`、`__EXPORT_LINKS__`、`__ANNO_MAP__`；`312` toast 文案亦含 `__EXPORT_BOOT__`。
  - 资源：`79-83` `loadExportAsset` 只读 `export-assets/<file>` 与 `./export-assets/<file>`；`208-211` 仅取 `export.css` / `export-template.js` / `icons.js`。全文件 grep `app.css` 仅命中注释行 `6`（“不再假设根目录存在 app.css”）与 `77`（“绝不读根 app.css”），代码区无 `fetch("app.css")`。
- **S7 PASS — `export-assets` 三文件存在**
  - `dist/renderer/export-assets/` 下 `export-template.js`（9377B）、`export.css`（6179B）、`icons.js`（8002B）均存在；e2e `git-export.spec.ts:50-56` 同断言 PASS；复制脚本 `scripts/copy-export-assets.mjs:9-13` 来源为 `js/export-template.js`、`js/icons.js`、`src/renderer/styles/export.css`。
- **S8 PASS — MultiEditBar 空队列返回 `null`**
  - `src/renderer/components/overlays/MultiEditBar.tsx:38`：`if (!queue || queue.length === 0) return null;`。Hook（`37` `useState`）在 early-return 之前，顺序稳定，无条件 Hook 违规。

## 4. 缺陷清单（分级：P0 阻塞 / P1 严重 / P2 一般 / P3 建议）

| 编号 | 级别 | 描述 | 定位 | 状态 |
|---|---|---|---|---|
| D1 | P3 建议 | 准星 effect 的 `isPickDisabled({ exportBoot: false, inlineOpen: false })` 为硬编码恒假，永不触发；且 `PreviewFrameProps` 无 `inlineOpen` 入参，准星注入未实现“就地改打开时互斥拾取”。导出态已有 `isExportBoot()` 兜底故无功能事故，但与文件头“INLINE_EDIT.open 时不进拾取”注释不一致。建议：给 `PreviewFrame` 加 `inlineOpen?: boolean` 并透传给 `isPickDisabled`，或删除该死分支。 | `src/renderer/features/preview/PreviewFrame.tsx:23-40`（缺 prop）、`104-107`（死分支） | 待修，不阻塞冒烟 |
| D2 | P3 观察（非缺陷） | 移动端缩放换算无集成：`PreviewFrame` 的 `scale` prop 取后即 `void`（`235-236`，注释称由父组件换算），但全仓无 `PreviewFrame` 消费者，`Stage.tsx:95-117` 移动端仍为占位（“预览 iframe 由 Wave2-H 接入”）。纯函数单测全过，集成风险留给接线波次。建议接线时在 Stage/容器内用 `scaleRectToPage` 换算 hover/选中 rect 后再喂 `PickOverlay`。 | `src/renderer/features/preview/PreviewFrame.tsx:235-236`、`src/renderer/components/shell/Stage.tsx:95-117` | 待接线，不计缺陷 |
| D3 | P3 建议 | `InlineEdit` 脏关闭走原生 `window.confirm`（`54-66`），与 `MultiEditBar` / `Inspector` 统一 `Confirm` 组件口径不一致；`git-export.spec` 已对 Inspector 断言“无原生弹窗”。当前实现注释自洽（沿用旧 `askConfirm`，不可用时保守不关），功能正确，仅体验/一致性建议。 | `src/renderer/features/preview/InlineEdit.tsx:54-66` | 待评估，不阻塞冒烟 |

P0/P1 缺陷：**0**。以上均为 P3，不影响 T2 冒烟结论。

## 5. 结论

- **结论：通过（条件通过，无 P0/P1）。**
- vitest `src/renderer/features/preview` 9/9 通过；playwright `preview + git-export` 静态契约 11 通过、2 真机按设计 skip。
- 8 项语义抽查全部 PASS；`srcDoc` 同源、`__EXPORT_BOOT__` 短路、看门狗、校验文案、`__EXPORT_SOURCES__` 契约、`export-assets` 三文件、空队列 `null` 均符合旧语义。
- 遗留 3 项 P3（D1 死分支/inlineOpen 缺口、D2 移动端集成未接线、D3 原生 confirm 一致性），建议在预览接线波次（Stage 接入 PreviewFrame）时一并处理；真机拾取/导出离线打开仍需 `PLAND_E2E_APP_URL` 环境补测。
