# Wave4 B 全量体验 · 文档查看与交互 报告（b-docs）

- 日期：2026-11-13
- Agent / owner：Wave4 B subagent（docs 全量体验）
- 阶段：B 全量体验（P2/P3 为主；P0/P1 仍按阻断处理）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` mtime `2026-11-13T15:36:43+08:00`；index.html SHA256 前 12 = `AA42E6DCAF5B`
  - 入口 bundle：`dist/renderer/assets/index-DwF5s1C0.js`，345,696 bytes，SHA256 前 12 = `66F9C4748D65`
  - 构建晚于 `src/renderer/features/docs/**`、`stores/docs-store.ts` 的最后修改（13:47），非 STALE-BUILD
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-docs`
  - harness 启动后 `app.getPath('userData')` 精确匹配通过；`_wave4-seed.json` present
  - seed：109 files / 1,110,299 bytes；source fingerprint `17ad3a89355d…`
  - 并行期间共享 `.devdata` 指纹发生漂移（`9e64a72f5e6b…`），本域复用 Phase 0 seed，未重建、未写共享 `.devdata`
- 运行命令：
  `$env:PLAND_WAVE4_DOMAIN='b-docs'; npx playwright test e2e/wave4-b-docs.spec.ts --workers=1 --output=test-results/wave4/b-docs`
- 真实请求/网络：`AI_REQUESTS=0`；`GIT_NETWORK=无`；`DOC-WIN` 独占打开 2 次；`EXPORT-NATIVE` PNG/PDF 各 1 次（均取消）；MD 下载 1 次

**结论先行：P0 = 0，P1 = 0；19/19 步骤 PASS；1 passed / 0 failed（45.1s）；Electron `window-close` exit 0。**
本轮新增 8 个 P2、4 个 P3。最优先 P2 是「长目录条目被压扁到 8px，目录文字不可读」和「PC 面板目录展开时正文仅约 190px」。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 | 打开文档 / 加载态 / Markdown 渲染 | PASS | overlay 面板；打开 335ms；正文 14,992 字；h1=1、h2=82、表格=5、ul/ol=1/1、代码=1、引用=1、链接=1；无原始 Markdown；`javascript:` 链接=0；舞台宽度 887→887；截图 `01-open-markdown.png` | — |
| 2 | 最新需求 Tab / 可控加载态 | PASS | 延时 `doc:read-latest` 800ms 后捕获「加载中…」Badge +「正在加载…」空态；加载后 8 字、含 `11121321`；标题「最新需求 · 首页」；切回功能说明正常；截图 `02-latest-loading.png` | — |
| 3 | 目录折叠 / 长文滚动 / 跳转定位 | PASS | 目录 88 条；折叠/展开条目数一致；点击最后一条 `scrollTop 0→8256`，目标标题入视口；smooth 采样 110 帧、中间帧 83；**首条目录高度仅 8px**；`data-active` 始终 0；截图 `03-toc-collapse-expand.png`、`03-toc-jump-long.png` | P2（压扁/高亮） |
| 4 | 目录搜索 vs 正文搜索 | PASS | 88→1 条（「W4-B 长文 001」，过滤后条目高 24px）；搜索「商品」显示「无匹配条目」但正文仍含 41 处；目录搜索不滚动正文、不打开正文搜索栏；截图 `04-toc-search-distinct.png` | P3（占位文案） |
| 5 | 移动端文档 / 目录抽屉 / Tab 可点 | PASS | `data-variant=inline`；舞台逻辑尺寸 375×780 前后不变；Tab 命中 `docs-panel-content`（docs-panel 内）；抽屉 `data-open true→点击条目→false`；抽屉顶边 173 ≥ Tab 底边 165；截图 `05-mobile-drawer.png` | — |
| 6 | 正文搜索 / Ctrl+F / 计数 / 循环 / Esc | PASS | Ctrl+F 聚焦正文搜索；「商品」41 处，计数 1/41→2/41→1/41→41/41 循环；mark=41、active 高亮色不同；大小写查询 2/2；无结果 0/0 且按钮禁用；Esc 只关搜索；搜索按钮入口可用；目录搜索「长文 002」时正文查询仍为 `W4-B`、mark=256；编辑态 Esc 不退出编辑；截图 `06-search-hits.png`、`06-search-case-wrap.png` | — |
| 7 | Markdown 图片 / 安全 URL | PASS | `data:` 图片按 `safeUrl` 回退为 alt（无 `<img>`）；`blob:` 图片真实渲染 natural 16×16；微改还原后 img=0；截图 `07-image-blob-render.png`、`07-image-data-alt.png` | P2（常见 URL 不可见） |
| 8 | 段落微改 / 行范围精确 | PASS | 目标行 53；561 行在微改前后不变；仅第 53 行变化；hash `1d163d80aad6→dc82b505c60`；Badge 消失；表格分隔行/代码围栏保留；截图 `08-micro-edit-line.png` | P3（无成功 toast） |
| 9 | 连续微改 / 取消 | PASS | 第二次微改仍只改第 53 行，`MICRO-1/2` 同时存在；Popover 取消后正文无取消标记，hash 保持 `53fe26671a5e`；截图 `09-micro-edit-repeat.png` | — |
| 10 | 表格 / 代码块微改入口 | PASS | 表格内 ✎=0、代码块内 ✎=0、标题 ✎=1；表格/代码块只能整篇编辑（第 11 步验证可行）；截图 `10-micro-edit-scope.png` | P2（局部能力缺口） |
| 11 | 整篇编辑 / 保存 / 结构保持 | PASS | 编辑区预填 16,074 字 Markdown；改表格单元格 + 代码行后 Badge=未保存；保存后 h1=1、表格=5、代码=1（与保存前一致）；磁盘保留表格分隔行/代码围栏；hash `53fe26671a5e→c24a87310248`；截图 `11-edit-unsaved.png`、`11-edit-saved-structure.png` | — |
| 12 | 取消编辑 / 未保存提示 / 关闭与切换守卫 | PASS | 取消后 hash 不变、预览无原始 Markdown；关闭面板重开后 editing=true、草稿含标记（无确认框但未丢）；切 Tab、切原型再切回草稿被静默丢弃，`confirm-dialog=0`，磁盘未写入；截图 `12-dirty-close-reopen.png`、`12-proto-switch-draft.png` | P2（切 Tab / 切原型草稿丢失） |
| 13 | 保存中切换原型 / 保存守卫 | PASS | 挂起 `sandbox:write` 后切到「我的」再放行：toast「保存已阻断…」，文档区 alert 含「保存已阻断」；首页.md 保留旧原型落盘内容；我的.md hash `b58cefce2fb9` 未被污染；截图 `13-save-guard-blocked.png` | — |
| 14 | 粘贴纯文本 / HTML / 图片 / 超长 | PASS | 纯文本 3 行保留；HTML/span/style/颜色全部剥离（仅 `br`，561 个换行来自全文）；HTML-only 标记未进入；图片 HTML 被剔除（img=0）；84,020 字超长粘贴 119ms，编辑器 16,106→100,126 字，Ctrl+Z 可撤销；两次取消均未写盘；截图 `14-paste-plain-html.png`、`14-paste-very-long.png` | P3（HTML-only 无提示） |
| 15 | 独立文档窗 / 打开 / 窗口现状 | PASS | `doc-window` 可见、无 `main-window`；正文 15,032 字且含夹具段落；标题正确；窗口 bounds `{x:-6,y:-6,w:1135,h:672}`、maximized=true、displays=2；截图 `15-docwin-open.png` | P3（无位置/尺寸记忆） |
| 16 | 独立窗编辑保存 / 主窗即时同步 / 关闭回面板 | PASS | docwin 微改 `W4-B-WIN-MICRO` + 整篇 `W4-B-WIN-EDIT` 均落盘；回主窗关闭独立窗后未刷新即显示两标记（h1=1、tables=5）；独立窗按钮恢复；再次打开后 Esc 关闭无确认、磁盘不含 `W4-B-WIN-DIRTY`；截图 `16-docwin-micro-saved.png`、`16-docwin-mirror-main.png`、`16-docwin-closed-panel.png` | P2（独立窗草稿丢失） |
| 17 | 文档导出 MD / PNG / PDF | PASS | 菜单 3 项齐全；MD 文件 `首页 · 功能说明.md` 35,890 bytes，sha `014F909E100C`，内容与磁盘逐字一致；PNG/PDF 原生保存对话框各出现 1 次（总计 2），取消后无 png/pdf、导出按钮恢复；截图 `17-export-menu.png`、`17-export-md.png`、`17-export-native-cancel.png` | — |
| 18 | 空文档 / 空态 / 空导出 | PASS | 最新需求清空后显示「暂无最新需求」、目录 0 条/「暂无目录」、标题正确；MD/PNG 导出均提示「当前文档为空，无需导出」，原生对话框调用 2→2（未增加）、无文件；恢复后 hash 回到 `8FEBD21B4150`；截图 `18-empty-latest.png`、`18-empty-export-toast.png` | — |
| 19 | 超长文档 / 打开 / 目录 / 编辑保存 | PASS | 346,507 bytes；打开 390ms；目录 248 条；跳到最后 scrollTop>30,000；编辑区 125,557 字，进入编辑 269ms；追加标记输入 126ms、保存 315ms；保存后 h1=1、表格=5、代码=1，文件 346,525 bytes；截图 `19-long-doc-open.png`、`19-long-doc-edited.png` | — |

## 2. 缺陷

P0 / P1 均为 0。以下 P2 按「影响 × 频率」排序，均只写隔离副本证据。

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| `b-docs-P2-TOC-SQUASH` | **P2（最高）** | 长目录（88 条）时每条目录被压到约 **8px** 高，文字裁成点线，目录名称不可读；条目仍可点击 | 打开含 80+ 标题的 PRD → PC「文档」→ 看左侧目录 | 长 PRD 目录无法按名称浏览；只能依赖目录搜索过滤（过滤到 1 条后恢复 24px） | 首条 `doc-toc-item` bbox 高 8px；过滤后 24px；`01/03` 截图 | 目录按钮加 `shrink-0`/`min-h-6`，让 nav 滚动而不是压缩条目；长目录建议默认折叠或虚拟滚动 |
| `b-docs-P2-PANEL-WIDTH` | P2 | PC 面板 400px，目录 176px，正文仅 **190px**；PRD 表格逐字换行，阅读效率低 | 打开 PC 文档面板，目录展开 | 表格/长段落阅读困难；折叠目录可缓解 | panel=400、sidebar=176、preview=190；`01` 截图 | 面板可拖宽/默认折叠目录；或目录改为抽屉，正文至少 300px |
| `b-docs-P2-TOC-ACTIVE` | P2 | 目录当前阅读位置不高亮：跳转后没有任何 `doc-toc-item` 的 `data-active=true` | 点击目录最后一条 → 检查目录 | 长文滚动后无法判断当前章节 | toc=88，active=0 | 传 `activeId` / 滚动监听，高亮当前标题并自动滚入目录视口 |
| `b-docs-P2-IMAGE` | P2 | Markdown 图片的常见 URL 不显示：`data:` 被 `safeUrl` 拦截为 alt，`http(s)` 被 CSP `img-src` 拦截；仅 `blob:` 可渲染 | 文档写入 `![alt](data:...)` 或 https 图片 | 含图片的 PRD 只能看到 alt/空白；文档表达力下降 | data: img=0；blob: natural 16×16；CSP `img-src 'self' data: blob: proto-asset:` 不含 https | 沙箱图片改走 `proto-asset:`；或提供受控图片代理/域名白名单；保留安全拦截 |
| `b-docs-P2-MICRO-SCOPE` | P2 | 微改 ✎ 只覆盖段落/标题；表格单元格、代码块没有局部入口 | hover 表格/代码块 | 改表格/代码需整篇编辑，长文档定位成本高 | table ✎=0、code ✎=0、标题 ✎=1 | 为表格行/单元格与代码块增加块级微改，复用行号区间替换 |
| `b-docs-P2-TAB-DRAFT` | P2 | 编辑中切换文档 Tab 会静默丢弃未保存草稿，无确认 | 功能说明→编辑→改一段→点「最新需求」→切回 | 未保存内容丢失且无提示 | 切回后正文不含 `W4-B-TAB-DRAFT`；磁盘 hash 不变；confirm=0 | Tab 切换前检测 `dirty`，确认/自动存草稿；或每个 Tab 独立草稿 |
| `b-docs-P2-PROTO-DRAFT` | P2 | 编辑中切到其他原型再切回，未保存草稿被静默丢弃，无确认 | 编辑→改一段→关闭面板→切「我的」→切回「首页」 | 同上；跨原型切换更容易误丢 | 切回后不含 `W4-B-PROTO-DRAFT`；confirm=0；磁盘未写入 | 切源/切项目前统一 dirty 守卫；草稿按 sourceDir 隔离保存 |
| `b-docs-P2-DOCWIN-DIRTY` | P2 | 独立文档窗编辑中直接 Esc/关闭会静默丢弃草稿，无确认 | docwin→进入编辑→改一段→Esc | 独立窗草稿丢失 | confirm=0；磁盘不含 `W4-B-WIN-DIRTY` | `beforeunload`/关闭前 dirty 确认；或关闭时把草稿回写主窗草稿区 |

> 共性：`TAB-DRAFT` / `PROTO-DRAFT` / `DOCWIN-DIRTY` 是同一类「未保存草稿守卫缺失」，建议一个 owner 统一修复；主面板关闭再打开目前**会保留**草稿，不需要重复改。

## 3. 观察区（P3，只记录不阻断）

| ID | 级别 | 现象 | 证据 / 备注 |
| --- | --- | --- | --- |
| `b-docs-P3-TOC-PLACEHOLDER` | P3 | 目录搜索占位符写「搜索目录 / 正文」，但只过滤目录；正文搜索是独立输入框 | 搜「商品」显示「无匹配条目」，正文实际 41 处；建议改为「搜索目录」 |
| `b-docs-P3-MICRO-TOAST` | P3 | 段落微改保存成功没有成功 toast，只能看到正文变化与「未保存」Badge 消失 | 保存后 toast 数=0；建议补「已保存」轻提示 |
| `b-docs-P3-PASTE-HTML` | P3 | 仅含 HTML/图片、无 `text/plain` 的粘贴被静默忽略，无提示 | 编辑器长度 16,106→16,106；安全行为正确，建议提示「已忽略富文本，仅支持纯文本」 |
| `b-docs-P3-DOCWIN-BOUNDS` | P3 | 独立文档窗固定 520×800 后立即 maximize，没有位置/尺寸记忆；2 个显示器下不会记住上次屏幕位置 | bounds `{x:-6,y:-6,w:1135,h:672}`、maximized=true、displays=2 |
| `ENV/THIRD-PARTY` | 非 docs | 原始 console error 6 条均来自 seed 的「大厅」原型 CDN：Vant CSS 4 条 CSP + 2 条 `Unexpected token '.'`；docs 域致命 error=0 | 已按第三方/CDN 噪声过滤；不计入 docs 缺陷，建议 stage/shell owner 关注「大厅.html」外链 |

## 4. 结论

- 结果：**可放行（docs 域）**；P0=0、P1=0；P2=8、P3=4、ENV=0（另有 6 条非 docs 第三方噪声）。
- 阻断项：无。
- 复测范围：`e2e/wave4-b-docs.spec.ts` 全量 19 步；数据目录 `.devdata-wave4-b-docs`；MD 导出到 `%TEMP%\pland-wave4\b-docs-exports`。
- 建议：P2-1（目录压扁）与 P2-2（正文过窄）建议**外发前修复**，均为 DocsPanel/DocToc CSS 级改动；P2-3~P2-8 排入 B backlog 并指定 owner。P2-1 修复后重点复跑本 spec 第 3、4 步与 1440×900/1024×768 视口。
- 数据完整性：运行前备份、运行后还原 `首页.md` / `最新需求.md` / `我的.md`，最终 hash 分别为 `3DD489F7B5ED` / `8FEBD21B4150` / `B58CEFCE2FB9`，与 seed 一致；未污染共享 `.devdata`。
- 收尾：报告完成后删除 `.devdata-wave4-b-docs`；截图与报告保留；未修改产品代码、未 `npm install`、未 commit。

## 5. 截图

目录：`docs/wave4/shots/b-docs/`

| 文件 | 说明 |
| --- | --- |
| `01-open-markdown.png` | PC 文档面板 Markdown 渲染；目录 88 条、条目压扁、正文 190px 的现场 |
| `02-latest-loading.png` | 最新需求 Tab：加载中 Badge +「正在加载…」空态 |
| `03-toc-collapse-expand.png` | 目录折叠后展开（展开态、长目录） |
| `03-toc-jump-long.png` | 跳到最后一条，正文滚到长文末段 |
| `04-toc-search-distinct.png` | 目录搜索「W4-B 长文 001」过滤为 1 条；正文不动 |
| `05-mobile-drawer.png` | 移动端 inline 面板 + 目录抽屉，未遮挡 Tab |
| `06-search-hits.png` / `06-search-case-wrap.png` | 正文搜索命中/计数/高亮；大小写与循环 |
| `07-image-blob-render.png` / `07-image-data-alt.png` | blob 图片真实渲染；data: 图片回退 alt |
| `08-micro-edit-line.png` | 段落微改后正文与行号精确结果 |
| `09-micro-edit-repeat.png` | 连续微改 + Popover 取消 |
| `10-micro-edit-scope.png` | 表格/代码块无 ✎、标题有 ✎ |
| `11-edit-unsaved.png` / `11-edit-saved-structure.png` | 整篇编辑未保存 Badge；保存后结构保持 |
| `12-dirty-close-reopen.png` / `12-proto-switch-draft.png` | 关闭面板重开草稿保留；切原型草稿丢失现场 |
| `13-save-guard-blocked.png` | 保存中切原型：toast + alert「保存已阻断」 |
| `14-paste-plain-html.png` / `14-paste-very-long.png` | HTML/样式剥离；84,020 字超长粘贴 |
| `15-docwin-open.png` | 独立文档窗打开（maximized） |
| `16-docwin-micro-saved.png` / `16-docwin-mirror-main.png` / `16-docwin-closed-panel.png` | docwin 微改保存；主窗即时同步；关闭回面板 |
| `17-export-menu.png` / `17-export-md.png` / `17-export-native-cancel.png` | 3 项导出菜单；MD 落盘；PNG/PDF 原生对话框取消 |
| `18-empty-latest.png` / `18-empty-export-toast.png` | 最新需求空态；空文档导出提示 |
| `19-long-doc-open.png` / `19-long-doc-edited.png` | 346KB 超长文档打开；编辑保存后 |
