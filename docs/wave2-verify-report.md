# Wave2 验证总报告（Wave2-M：回归 + E2E + 视觉基线）

> 日期：2026-11-12 · 范围：方案 §12（测试计划）、§2.2（功能对等清单）、Phase 7
> 口径：本波只写 `e2e/` 与本报告；`src/**`、`tests/**` 只读不改。
> Electron 真机项只记录步骤与预期，未强行拉起（见 §6）。

## 1. 结论一览

- E2E 新建 6 文件、45 用例：**35 通过 / 1 fixme（阻塞）/ 9 真机 skip，0 失败**。
- `npx vitest run`：**3 文件 31/31 通过**。
- `npx tsc --noEmit`：**exit 0**。
- `PLAND_SUITE=core node tests/run-all.js`：**total=37 pass=37 fail=0**。
- `check-pack / static-verify / lint-guard`：三门尾行结论均为 **PASS**。
- 阻塞：仅剩 **`doc-micro-edit`（I 波段落 ✎ 微改 Popover）未交付**，已记 fixme + TODO。

## 2. E2E 清单（6 文件 / 45 用例）

| 文件 | 静态契约 | 真机（默认 skip） | 结果 |
|---|---|---|---|
| `e2e/shell.spec.ts` | 顶栏/loc-pill 三段、侧栏 3 手柄、mini-dock 条件渲染、375×780 自适应盒、视觉基线、MainWindow 组装+Esc | loc-pill 更新、mini-dock、移动盒尺寸 | 7 通过 / 3 skip |
| `e2e/preview.spec.ts` | stage-frame、srcDoc 同源 sandbox、无跨域写法（去注释断言）、EXPORT 禁拾取、准星口径 | iframe 同源可读 | 6 通过 / 1 skip |
| `e2e/docs.spec.ts` | docs-panel 双形态、PC fixed+遮罩、kind 分流、?docwin=1、mirror 订阅、Popover 基建、**doc-micro-edit fixme** | 悬浮不挤压、Esc 关闭 | 6 通过 / 1 fixme / 2 skip |
| `e2e/ai.spec.ts` | ai-dialog 纯 Dialog（去注释断言）、双级联、thinking 动态源、ACP key 公告、归属校验 | Dialog 居中 + 级联可见 | 6 通过 / 1 skip |
| `e2e/settings-models.spec.ts` | 6 Tab、卡片清单、搜索不改勾选、h-8 等高、空态文案 | Tab 切换 + 搜索计数不变 | 5 通过 / 1 skip |
| `e2e/git-export.spec.ts` | 卡片树三级 testid、无 Table、export-assets 三文件、BOOT 契约、检查器三板块 | 卡片树可见 | 5 通过 / 1 skip |

运行：`npx playwright test` → `35 passed, 10 skipped`（9 真机需 `PLAND_E2E_APP_URL` + 1 fixme），`--list` → 45 用例。

## 3. testid 覆盖表（G/H/I/J/K/L 约定）

| testid | 状态 | 位置 |
|---|---|---|
| `main-window` | ✅ | `app/modes/MainWindow.tsx` |
| `topbar` / `loc-pill` | ✅ | `components/shell/Topbar.tsx` |
| `sidebar`（3×`DragGrip`） | ✅ | `components/shell/Sidebar.tsx` |
| `mini-dock` | ✅ | `components/shell/MiniDock.tsx` |
| `stage-frame` / `stage-viewport` | ✅ | `components/shell/Stage.tsx` |
| `preview-frame`（srcDoc 同源） | ✅ | `features/preview/PreviewFrame.tsx` |
| `inline-edit` / `pick-overlay` / `multi-edit-*` | ✅ | `features/preview/*` |
| `docs-panel`（overlay/inline 双形态）/ `docs-overlay` | ✅ | `components/shell/DocsPanelHost.tsx` |
| `doc-window`（?docwin=1） | ✅ | `app/modes/DocWindow.tsx` + `main.tsx` 路由 |
| `doc-micro-edit` | ❌ **阻塞** | 无（仅 `Popover` 基建 + `inline-edit` 存在）→ I 波 TODO |
| `ai-dialog` / `ai-chat` / `ai-model-select` / `ai-thinking-select` | ✅ | `features/ai/AiDialog.tsx`、`ai-elements/*` |
| `settings-dialog`（6 Tab） | ✅ | `features/settings/SettingsDialog.tsx` |
| `model-manager` / `model-manager-count` | ✅ | `features/models/ModelManager.tsx` |
| `git-panel` / `git-project-card` / `git-proto-group` / `git-file-row` | ✅ | `features/git/GitPanel.tsx`（无 Table） |
| `inspector`（三板块）/ `confirm-dialog` | ✅ | `components/overlays/Inspector.tsx`、`Confirm.tsx` |

## 4. 门禁四项结论 + 单元/类型

- **core**（`PLAND_SUITE=core`）：`total=37 pass=37 fail=0`，`ALL_PASS`。
- **check-pack**：`PACK_PASS: 0缺失，白名单覆盖全部运行时边`（react+legacy 模式，dist 产物 + export-assets 断言通过）。
- **static-verify**：`STATIC_PASS`（LEGACY_SCOPE dual，旧断言仅限 legacy 文件）。
- **lint-guard**：`LINT_PASS`（扫描 219 个 JS/TS 含 TSX，WARN 296，0 FAIL；IPC 70 冻结一致）。
- **vitest**：`Test Files 3 passed (3) / Tests 31 passed (31)` —— iframe-pick（9）+ adapters + fallback。
  注：本机需 `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` 绕过 vitest 5 原生 config-loader 警告，否则误报 0 文件（环境事项，非代码失败）。
- **tsc**：`npx tsc --noEmit` exit 0。

## 5. 遗留 TODO 清单

1. **I-1（阻塞，唯一）**：`doc-micro-edit` 段落 ✎ 微改 Popover 组件未交付；`ui/popover.tsx` 基建与 `docs-panel` 容器已就绪，对接后1997年 E2E fixme 即转正。
2. **I-2（确认）**：`DocWindow` 订阅通道为 `doc:mirror`，方案 §5.2/§10.3 为 `doc:mirror-push/back`；Phase0  stub 口径，待主进程/I 波对齐确认（功能未断，不断言失败）。
3. **react-ui 单测缺口**：`adapters.ts`（归属/级联/思考回落）与 `ModelManager`（可见集合/回落）暂无 vitest，只有 `iframe-pick`/`adapters`/`fallback` 三文件 31 项；建议 J/K 各补一单测文件。
4. **视觉回归真机**：1440/1024/600 + 缩放 50/100/150 截图对比未跑（需 GUI，见 §6），基线文件 `docs/shadcn-redesign-preview.html` 静态类已断言存在。
5. **沿用（Wave-E，未复验不关闭）**：`project-ai-export.js` 动态执行遗留（lint WARN 跟踪）、死存根冻结、200+ 超长行风格 WARN 存量。

## 6. Electron 真机步骤与预期（未执行，只记录）

前置：`npm run dev:renderer` + `npx electron .`（或安装包冷启动验证离线）。

1. 壳：loc-pill 三段随原型切换更新；侧栏三层拖拽改序；收起侧栏→mini-dock→恢复；移动端 375×780 自适应百分比随窗缩放、外层无滚轮。
2. 预览：iframe 内容正常；`contentDocument` 可读无 SecurityError；Ctrl 悬停准星；导出单文件无拾取注入。
3. 文档：PC 悬浮不挤压舞台（boundingBox 宽度不变）；移动 Flex 挤压；Esc 关闭；`?docwin=1` mirror 往返；✎ 微改（I 交付后）。
4. AI：居中 Dialog；模型/思考双级联；思考选项 = ACP 公告子集；切换模型思考回落；发送/停止/权限/Trace。
5. 设置/模型：6 Tab；卡片清单；搜索过滤勾选不变；手输添加。
6. Git/导出：卡片折叠 + 三态勾选 + 行级统计；发布/拉取后刷新；离线单文件 `__EXPORT_BOOT__ === true`。

## 7. 阻塞清单（归属，不修业务）

| # | 阻塞项 | 归属 | 记录位置 |
|---|---|---|---|
| 1 | `doc-micro-edit` 未交付 | I 波（文档内容） | `e2e/docs.spec.ts` fixme + §5 I-1 |
| — | 其余 testid 与四项门禁 | 无阻塞 | 本报告 §3/§4 |
