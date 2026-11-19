# 冒烟测试 T1「主壳/导航域」报告

- 日期：2026-11-12
- 工作目录：`D:\文件\工具\原型工具-PlanD`
- 范围：`src/renderer/components/shell/*`、`src/renderer/app/modes/MainWindow.tsx`、`src/renderer/stores/app-store.ts`、`src/renderer/stores/ui-store.ts`
- 方式：只读（读码 + 只读命令）；唯一写出为本报告
- 约束遵守：未改 `src/tests/main/package.json`、未跑 `npm install`、未 commit

## 1. 命令结果

### 1.1 `npx tsc --noEmit`

- 命令：`npx tsc --noEmit` 后 `Write-Output "EXITCODE=$LASTEXITCODE"`
- 结果：无输出（零错误），`EXITCODE=0`
- 结论：PASS

### 1.2 `npx playwright test e2e/shell.spec.ts`

- 命令：`npx playwright test e2e/shell.spec.ts`
- 结果：`EXITCODE=0`，`7 passed`，`3 skipped`
- 详情：
  - 7 个静态契约用例全绿（顶栏 loc-pill / 侧栏骨架 / mini-dock / 375×780 盒 / iframe-pick 口径 / 视觉基线 / MainWindow 组装+Esc）
  - 3 个 `gui` 真机用例 skip（需 `PLAND_E2E_APP_URL`，当前未置，符合 `e2e/shell.spec.ts:29` 设计）
- 结论：PASS（静态部分）；真机部分未执行，按 spec 注释属预期 skip

## 2. 语义抽查（逐条 PASS/FAIL）

| # | 检查项 | 结果 | 证据（file:line） |
|---|--------|------|-------------------|
| S1 | 顶栏 `h-10` / 40px | PASS | `src/renderer/components/shell/Topbar.tsx:4` 注释“高度 40px（h-10）”；`:41` `className="flex h-10 shrink-0 …"`（`h-10`=2.5rem=40px） |
| S2 | loc-pill 三段（项目/原型/页面） | PASS | `Topbar.tsx:55` `data-testid="loc-pill"`；`:59` `LocSegment label={project}`；`:61` `label={proto}`；`:63` `label={page}`；`:16-23` `LocSegment` 定义；另有 `project/proto/page` 三处 `useAppStore` 订阅 `:26-28` |
| S3 | 侧栏无计数 | PASS | `Sidebar.tsx` 全文无 `count/badge/数字计数` 业务代码；命中仅 `:5` 注释“文件夹无右侧计数数字（§8.1 硬约束）”；`Select-String "count\|badge"` 无业务命中 |
| S4 | 侧栏选中无蓝色 | PASS | `Sidebar.tsx:47` 选中 `bg-white text-foreground shadow-sm`；`:54` 指示条 `bg-[#18181b]`；`:75` 二级选中 `bg-accent text-foreground`；`:80` 圆点 `bg-[#18181b]`；`#0052ff / bg-blue / text-blue / cobalt` 业务代码零命中（仅 `:6` 注释“禁用蓝色/cobalt 选中”） |
| S5 | 三层各有拖拽手柄 | PASS | `Sidebar.tsx:16` `function DragGrip()` + `:23` `GripVertical`；调用 3 处：`:59`（一级 `LevelOneItem`）、`:83`（二级 `LevelTwoItem`）、`:111`（分组 `CollapsibleTrigger data-level="group"`）；`data-level` 三种：`:104 group`、`:43 proto`、`:72 subpage` |
| S6 | mini-dock 仅收起渲染 | PASS | `MiniDock.tsx:16` `if (sidebarOpen \|\| !visible) return null`；`:12` `sidebarOpen` 取自 app-store；`:14` `visible` 取自 ui-store `miniDockVisible`；`:19` `data-testid="mini-dock"` |
| S7 | Stage 含 MOBILE_W=375 / MOBILE_H=780 / ResizeObserver / overflow-hidden | PASS | `Stage.tsx:15` `MOBILE_W = 375`；`:16` `MOBILE_H = 780`；`:34` `new ResizeObserver` + `:38` `ro.observe(el)` + `:39` `ro.disconnect()`；`:59` `kind === "mobile" && fitMode && "overflow-hidden"`；`:96` 外层 `overflow-hidden p-6`；`:100` 内层 `overflow-hidden`；`:57-58` `data-testid="stage-frame"`、`stage-viewport` 在 `:103`；`:74` “自适应”文案 |
| S8 | PC Docs 为 overlay（MainWindow 无 Resizable） | PASS | `MainWindow.tsx` 全文无 `Resizable`（`Select-String "Resizable"` 零命中）；`:62` PC 分支 `{kind === "pc" ? <DocsPanelHost /> : null}` 独立于 Flex 分栏之外；`DocsPanelHost.tsx:44-72` PC 分支 `fixed inset-0 z-40` 遮罩（`data-testid="docs-overlay":48`）+ `fixed bottom-4 right-4 top-12 z-50` 面板（`data-testid="docs-panel" data-variant="overlay":55-56`）；移动端为行内挤压 `:77-84` `data-variant="inline"`，符合“PC 绝不挤压原型” |
| S9 | Esc 栈 AI>文档>设置（ui-store closeTopmost） | PASS | `ui-store.ts:92-107` `closeTopmost()` 顺序 `aiOpen(:94) → docsOpen(:98) → settingsTab(:102)`，一次只关一层，返回 `TopLayer`；`MainWindow.tsx:39-47` 全局 `keydown` 监听 `Escape` 调 `useUiStore.getState().closeTopmost()`，`closed` 时 `stopPropagation`；`DocsPanelHost.tsx` 无窗口级 Esc 监听（注释 `:8-9` 已声明避免一次按键关两层，实测无 `addEventListener`） |
| S10 | app-store 经 storage-keys 读写分组/折叠/缩放 | PASS | `app-store.ts:15-24` `from "@/lib/storage-keys"`；`:158` `readGroups→loadGroupsData(p)`；`:166` `writeGroups→saveGroupsData(p,data)`；`:174` `readFold→readJson(groupsFoldKey(p),null)` + `coerceFold`；`:182` `writeFold→writeJson(groupsFoldKey(p),…)`；`:77` `initialZoom→readContentZoom(CONTENT_ZOOM_FALLBACK)`；`:133` `setZoom→writeContentZoom(clamped)`；键口径 `src/renderer/lib/storage-keys.ts:13` `protoGroups_v1`、` :16` `protoGroupsFold_v1`、` :45` `contentZoom`、` :48` `CONTENT_ZOOM_FALLBACK=0.85`，与注释 `:10-11` 持久化红线一致；未做迁移/清空 |
| S11 | 拾取口径与视窗常量一致（附加，spec 内） | PASS | `src/renderer/features/preview/lib/iframe-pick.ts:23` `MOBILE_VIEWPORT_W = 375`；`:24` `MOBILE_VIEWPORT_H = 780`，与 Stage 常量一致 |
| S12 | 视觉基线保留（附加，spec 内） | PASS | `e2e/shell.spec.ts:71-76` 用例通过；`docs/shadcn-redesign-preview.html` 含 `.loc-pill` / `.mini-dock.show` / `width: 375px; height: 780px` |

注：S3/S4 的“蓝色选中类”按任务要求以 `grep #0052ff / 蓝色选中类` 执行，业务代码零命中；`bg-accent` 为主题中性悬停/选中色，非蓝色系。

## 3. 缺陷清单

无阻塞缺陷。

| 编号 | 级别 | 描述 | 定位 | 状态 |
|------|------|------|------|------|
| — | — | 本次抽查未发现 [阻塞] 缺陷 | — | — |
| T1-SUG-01 | [建议] | 二级选中态 `bg-accent` 与悬停态 `hover:bg-accent` 同值（`Sidebar.tsx:75`），仅靠 `bg-[#18181b]` 圆点（`:80`）区分，键盘/弱视用户可辨识性偏弱；但符合“去蓝”硬约束，不阻断合入 | `src/renderer/components/shell/Sidebar.tsx:75,80` | 建议：后续可在不引入蓝色前提下加粗/加字重区分 |
| T1-SUG-02 | [建议] | 真机 3 用例因无 `PLAND_E2E_APP_URL` 而 skip，静态契约不能覆盖真机拖拽/缩放像素行为；合入前建议在 Electron 真机按 `e2e/shell.spec.ts:11-19` 手动步骤走一遍 | `e2e/shell.spec.ts:29,90-113` | 建议：手动补验 |

## 4. 结论

- **可合入**（需满足：`tsc` 零错误已满足；`playwright` 静态 7/7 通过已满足；语义 S1–S10 全 PASS；无 [阻塞] 缺陷）。
- 返工项：无。
- 后续建议：合入后补一次真机手动验证（loc-pill 三段随原型切换 / 三层手柄拖拽 / 收起出现 mini-dock / 移动端 375×780 自适应无纵向滚轮），覆盖被 skip 的 3 个 gui 用例。
