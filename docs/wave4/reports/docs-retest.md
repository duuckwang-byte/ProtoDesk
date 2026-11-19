# Wave4 A2 文档 P1 修复后重建 + 真机复测报告（docs-retest）

- 日期：2026-11-13
- Agent / owner：Wave4 A2 subagent（docs 复测）
- 阶段：P1 修复复测（只判 P0/P1）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（未 commit）
- 构建：`npm run build:renderer` 重建；`dist/renderer/index.html` mtime `2026-11-13T13:49:26+08:00`；SHA256 前 12 = `34D2A2CB18A8`
  - 上一轮 A 冒烟构建 `198725714478`（12:36）已被本次重建覆盖
  - 入口 bundle：`dist/renderer/assets/index-Dy7edHRq.js`（332.81 kB）
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-docs-retest`（harness `app.getPath('userData')` exact-match 断言通过）
- seed：`_wave4-seed.json` present；source fingerprint `6081a7f5fc2e…`；seed 107 files / 550,469 bytes
- 复测命令：
  `$env:PLAND_WAVE4_DOMAIN='docs-retest'; npx playwright test e2e/wave4-docs.spec.ts --workers=1 --output=test-results/wave4/docs-retest`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无；DOC-WIN 独占使用 1 次；导出原生对话框=0
- 前置自检：`npx tsc --noEmit` 通过；`npx vitest run` 22 files / 333 tests 全通过；`node e2e/wave4/seed.mjs --rebuild-seed` 成功；启动前确认无 `electron.exe` 占用

**结论先行：P1 闭环。P0 = 0，P1 = 0；`e2e/wave4-docs.spec.ts` 1 passed / 0 failed。**

## 1. P1 复测结果

### 1.1 docs-P1-1（编辑→取消后预览混入原始 Markdown）— **PASS（已闭环）**

| 项 | 「进入编辑→取消」（未修改） | 编辑态粘贴富文本→取消 |
| --- | --- | --- |
| 预览是否含原始标题 `# 商城首页` | 否 | 否 |
| 预览是否含原始分隔线 `---` | 否 | 否 |
| 预览是否含原始表格竖线 `\| 维度 \|` / `\| :--- \|` / `\| W4 校验列 \|` | 否 | 否 |
| 预览是否含代码围栏 ` ``` ` | 否 | 否 |
| 预览首行 | 渲染后的「商城首页 — 产品需求文档 (PRD)」 | 同左 |
| 标题 `<h1>` 数量 | 1（与取消前一致） | 1（与取消前一致） |
| 表格数量 | 5（与取消前一致） | 5（与取消前一致） |
| 正文长度 | 复测脚本 3505 → 3505；spec 3516 → 3516（含第 4 步微改） | spec 3516（未增长） |
| 粘贴内容 `W4-P1-1-PASTE-1` 是否进入预览 | — | 否 |
| 磁盘 | 取消前后内容逐字一致 | 取消前后内容逐字一致 |

- 复测步骤（真机）：打开 `测试1/首页` → 顶栏「文档」→ 点「进入编辑」→ 直接「取消」；粘贴路径为进入编辑后粘贴 `text/html(span/style)` + `text/plain` 再取消。
- 结论：两种取消路径均未残留原始 Markdown、未重复渲染正文，滚动位置按实现恢复；原 P1-1 根因（contentEditable 手写 DOM 被预览节点复用）已由编辑区/预览区独立 `key` 消除。
- 证据截图：`docs/wave4/shots/docs-retest/03-p1-1-edit-cancel-clean.png`、`04-p1-1-paste-cancel-clean.png`、`05-edit-cancel-clean.png`、`05-paste-cancel-clean.png`
- 对照基线：`02-p1-baseline.png`（进入编辑前）

### 1.2 docs-P1-2（docwin 保存后主窗 mirror-back 不同步）— **PASS（已闭环）**

| 步骤 | 结果 |
| --- | --- |
| 主窗打开 `测试1/首页` 功能说明 | OK（正文 3505 字） |
| 点「在独立窗口打开文档」 | `doc-window` 打开，初始正文镜像主窗（含段落原文，3,505 字） |
| docwin 内段落微改追加 `W4-MIRROR-WIN` 并保存 | docwin 正文立即出现标记；磁盘 `首页.md` 包含该标记 |
| 回主窗关闭独立窗（顶栏「文档」） | 主窗面板立即显示 `… W4-EDIT-OK W4-MIRROR-WIN`，**未刷新** |
| 主窗结构 | `h1=1`、`tables=5`、正文 3,530 字（未重复渲染） |
| 「独立窗口」按钮 | 恢复可见、可点 |
| 磁盘最终态 | SHA256 前 12 `25FA0A52648F`，9,495 bytes / 4,019 chars；段落行含 `W4-EDIT-OK W4-MIRROR-WIN` |

- 手工复测与 spec 第 6 步均验证「关闭即见新内容、不依赖 reload」；`doc:mirror-back` + `mirrorPending` 的实现路径与断言一致。
- 证据截图：`05-p1-2-docwin-open.png`、`06-p1-2-docwin-saved.png`、`07-p1-2-main-immediate.png`、`06-docwin-open.png`、`06-docwin-edited.png`、`06-docwin-closed-panel.png`

## 2. spec 重跑结果

- 命令：`$env:PLAND_WAVE4_DOMAIN='docs-retest'; npx playwright test e2e/wave4-docs.spec.ts --workers=1 --output=test-results/wave4/docs-retest`
- 结果：**1 passed / 0 failed（21.2s）**；`FATAL_CONSOLE=0`；Electron `window-close` 正常退出 `exit=0`（2,560ms）
- 分步：STEP 1–6 全部 PASS；无 SKIP

| # | 步骤 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 文档面板 / Markdown 渲染 | PASS | 正文 3,505 字；表格 5；列表 2；代码块 1；原始竖线行 0 |
| 2 | 目录折叠 / 跳转 / 移动端抽屉 | PASS | 目录 7 条；`scrollTop 0→661`；移动端 Tab 命中 `docs-panel-content`；抽屉未遮挡 Tab |
| 3 | Ctrl+F 查找 / 焦点守卫 | PASS | 「商品」命中 41；`1/41→2/41→1/41`；Esc 只关搜索；设置搜索框焦点未丢失 |
| 4 | 段落微改 / 落盘 / 刷新保留 | PASS | `999cf6d13e81→b1287cf375db`；reload 后标记仍在 |
| 5 | 编辑态富文本粘贴 + **P1-1 回归** | PASS | 仅保留纯文本与 `br`（70 个），无 span/style/颜色；两种取消路径均无原始 Markdown、无重复渲染 |
| 6 | 独立文档窗 / mirror / 关闭回面板 | PASS | 即时 mirror-back 含 `W4-MIRROR-WIN`（未刷新；h1=1，tables=5，len=3,530） |

- spec 变更（仅测试代码，未改产品代码）：
  1. 增加 `PLAND_WAVE4_DOMAIN` 域覆盖（缺省仍为 `docs`），本次用 `docs-retest` 隔离数据与截图，避免覆盖 A 冒烟原始证据；
  2. 第 5 步补充 P1-1 回归断言：原始标题/分隔线/表格竖线/代码围栏、预览首行、h1/表格数量、正文长度不得增长，且无论通过与否都留截图；
  3. 第 6 步补充 P1-2 硬断言：关闭 docwin 后主窗必须立即包含 `W4-MIRROR-WIN`（不刷新），并校验 h1=1、表格≥5。
- 断言只增不减，原有阈值（正文 >3,000 字、表格 ≥5、命中数 >3 等）未放宽。

## 3. 截图

目录：`docs/wave4/shots/docs-retest/`

| 文件 | 说明 |
| --- | --- |
| `00-cold-start.png` | 冷启动进入 `测试1/首页`，PC 舞台 |
| `01-panel-markdown.png` | 文档面板 Markdown 真渲染（表格/列表/代码块） |
| `02-p1-baseline.png` | P1-1 基线：进入编辑前预览首屏 |
| `03-p1-1-edit-cancel-clean.png` | **P1-1 复测**：进入编辑→直接取消，预览干净、无重复 |
| `04-p1-1-paste-cancel-clean.png` | **P1-1 复测**：粘贴富文本后取消，预览干净、无粘贴内容 |
| `05-edit-cancel-clean.png` | spec 第 5 步：编辑→取消后截图（PASS 路径） |
| `05-paste-cancel-clean.png` | spec 第 5 步：粘贴后取消截图（PASS 路径） |
| `05-paste-plain.png` | 编辑态粘贴结果：仅纯文本 + `br` |
| `05-p1-2-docwin-open.png` | 独立文档窗打开，初始镜像主窗 |
| `06-p1-2-docwin-saved.png` | docwin 内保存 `W4-P1-2-RETEST` 后 |
| `07-p1-2-main-immediate.png` | **P1-2 复测**：关闭独立窗后主窗立即显示新内容（未刷新） |
| `06-docwin-open.png`、`06-docwin-edited.png`、`06-docwin-closed-panel.png` | spec 第 6 步：打开 / 独立窗保存 / 关闭回主窗即时镜像 |
| `02-toc-*.png`、`03-search-*.png`、`04-micro-edit-*.png` | 第 2–4 步回归截图 |

## 4. 剩余问题

- P0 = 0；P1 = 0。
- 未发现新增 P2/P3 阻断项；本轮仅复测 docs 域，未重跑相邻域（stage/shell/export 等），跨域回归不在本次范围。
- 观察（非缺陷）：编辑态粘贴后 contentEditable 的 `innerHTML` 含 70 个 `br`（允许的纯文本换行标签），符合「只保留纯文本/换行」预期。

## 5. 结论

- **P1-1、P1-2 均已闭环**：修复后的构建（`34D2A2CB18A8`）在真机上通过手工复测与 `e2e/wave4-docs.spec.ts` 全量 6 步。
- spec：**1 passed / 0 failed**；步骤 1–6 全 PASS，无致命 console/page error，Electron 正常退出。
- 产品代码未改动；仅按授权更新 `e2e/wave4-docs.spec.ts` 的 P1 回归断言与复测域开关。
- 收尾：复测完成后删除 `.devdata-wave4-docs-retest`；`docs/wave4/shots/docs/`（A 冒烟原始证据）未被覆盖。
