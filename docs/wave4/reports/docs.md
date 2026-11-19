# Wave4 A 冒烟 · 文档查看与交互（docs）报告

- 日期：2026-11-13
- Agent / owner：Wave4 A2 subagent（docs）
- 阶段：A 冒烟（只判 P0/P1）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` mtime `2026-11-13T04:36:16.867Z`；SHA256 前 12 = `198725714478`
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-docs`（harness 启动后 `app.getPath('userData')` exact-match 断言通过）
- seed：`_wave4-seed.json` present；指纹 `0c11ddd5d143`；107 files / 526,712 bytes
- 运行命令：
  `npx playwright test e2e/wave4-docs.spec.ts --workers=1 --output=test-results/wave4/docs`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无；DOC-WIN 独占使用 1 次；导出原生对话框=0
- 夹具：向隔离副本 `sandbox/测试1/首页/首页.md` 追加 `## W4 冒烟校验`（段落 + 无序/有序列表 + 围栏代码块 + 表格），仅写 `.devdata-wave4-docs`，不碰共享 `.devdata`

**结论先行：FAIL。P0 = 0，P1 = 2。**

## 1. 步骤结果

| # | 步骤 | 结果（PASS/FAIL/SKIP） | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 冷启动 → 进入 `测试1/首页` → 切 PC（前置） | PASS | `main-window`/`sidebar-tree`/`stage-frame` 可见；项目 `测试1`、原型 `首页`；`stage-frame[data-kind=pc]`；截图 `00-cold-start.png` | — |
| 1 | 打开文档面板；功能说明非空；表格/列表/代码块真实渲染 | PASS | `docs-panel[data-variant=overlay]`；正文 3,505 字；表格 5（seed 4 + 夹具 1）、列表 2、`pre[data-doc-code]` 1；`innerText` 无 `\| 维度 \| 说明 \|`、无 `\| :--- \|`、无 `^\|` 段落；截图 `01-panel-markdown.png` | — |
| 2 | 左侧目录折叠/展开 + 标题跳转；移动端目录抽屉 | PASS | PC 目录 7 条；`收起目录`→`doc-toc-toggle`→展开；点末条「W4 冒烟校验」正文 `scrollTop 0→661` 且标题进入视口；移动端 `data-variant=inline`；「最新需求」Tab 中心点命中 `docs-panel-content`（未被预览浮层遮挡）；抽屉 `data-open=true`→点条目→`false`，抽屉顶边在 Tab 列表底边之下；截图 `02-toc-collapse-expand.png`、`02-toc-jump.png`、`02-mobile-toc-drawer.png` | — |
| 3 | Ctrl+F：搜索栏/计数/上一个/下一个/高亮/Esc；焦点在设置输入框时不抢占 | PASS | Ctrl+F 打开 `doc-searchbar` 并聚焦 `doc-search-input`；关键词「商品」命中 41，`mark[data-doc-hit]` 41 且唯一 `data-active=true`；next→`2 / 41`（active hit=1），prev→`1 / 41`（active hit=0）；Esc 只关搜索、面板保留、高亮清零；设置「模型管理 → 搜索模型」聚焦时 Ctrl+F 未打开搜索栏，焦点仍为「搜索模型」；截图 `03-search-hits.png`、`03-search-next.png`、`03-search-guard-settings.png` | — |
| 4 | 段落 ✎ 微改：正文变化；落盘；reload 后保留 | PASS | 微改框预填本段原文；追加 `W4-EDIT-OK` 后正文出现标记；磁盘 `首页.md` SHA256 前 12 `999cf6d13e81 → b1287cf375db`；`未保存` Badge 消失；`page.reload()` 后重新进入 `测试1/首页` 仍含 `W4-EDIT-OK`；截图 `04-micro-edit-popover.png`、`04-micro-edit-saved.png`、`04-micro-edit-persist.png` | — |
| 5 | 编辑态粘贴富文本：只保留纯文本/换行，无 span/style 残留 | **FAIL**（粘贴子项 PASS；取消后预览污染见 docs-P1-1） | 注入 `text/html`（`p style`、`span style`、颜色、`text-decoration`、隐藏 HTML-only 标记）+ `text/plain` 两行；编辑器 `innerText` 含两行纯文本、不含 `W4-HTML-ONLY`；`innerHTML` 无 `span`/`style=`/`font-weight`/`text-decoration`/`color:`，标签仅 `br`（70 个）；`未保存` Badge 出现；取消后磁盘与粘贴前逐字一致。**但「进入编辑→取消」后正文预览顶部混入整篇原始 Markdown，见 docs-P1-1**；截图 `05-paste-plain.png`、`05-edit-cancel-leak-FAIL.png`、`05-paste-cancel-leak-FAIL.png` | P1 |
| 6 | 独立文档窗：打开；修改一处；主窗/文档窗 mirror；关闭回面板 | **FAIL**（打开/初始镜像/落盘/关闭回面板 PASS；mirror-back 内容不同步，见 docs-P1-2） | `doc-window` 打开且无主壳；初始正文镜像主窗（含 `W4-EDIT-OK`）；docwin 微改追加 `W4-MIRROR-WIN` 并保存，磁盘最终 SHA256 前 12 `25fa0a52648f`（9,495 bytes / 4,019 chars）；关闭独立窗后主窗回 `docs-panel`，`独立窗口` 按钮恢复可见可点；**主窗正文含 `W4-EDIT-OK`、不含 `W4-MIRROR-WIN`；刷新主窗后含 `W4-MIRROR-WIN`**；截图 `06-docwin-open.png`、`06-docwin-edited.png`、`06-docwin-mirror-FAIL.png`、`06-docwin-mirror-after-reload.png` | P1 |

## 2. 截图

目录：`docs/wave4/shots/docs/`

| 文件 | 说明 |
| --- | --- |
| `00-cold-start.png` | 冷启动进入 `测试1/首页`，PC 舞台 |
| `01-panel-markdown.png` | PC overlay 文档面板；表格/列表/代码块真实渲染 |
| `02-toc-collapse-expand.png` | 目录折叠为竖排「目录」按钮后展开 |
| `02-toc-jump.png` | 点击末条目录跳转到「W4 冒烟校验」 |
| `02-mobile-toc-drawer.png` | 移动端 inline 面板 + 目录抽屉（未遮挡 Tab） |
| `03-search-hits.png` | Ctrl+F 搜索「商品」：41 命中、`1 / 41`、高亮 |
| `03-search-next.png` | 下一个匹配：`2 / 41`、active 高亮切换 |
| `03-search-guard-settings.png` | 设置搜索框聚焦时 Ctrl+F 未抢占 |
| `04-micro-edit-popover.png` | 段落 ✎ 微改 Popover（预填本段） |
| `04-micro-edit-saved.png` | 应用后正文出现 `W4-EDIT-OK` |
| `04-micro-edit-persist.png` | reload 后重新打开文档，标记仍在 |
| `05-paste-plain.png` | 编辑态粘贴富文本：仅纯文本 + `br`，无 span/style，`未保存` Badge |
| `05-edit-cancel-leak-FAIL.png` | **P1-1 现场**：仅「进入编辑→取消」，预览混入原始 Markdown |
| `05-paste-cancel-leak-FAIL.png` | **P1-1 现场**：粘贴后取消同样混入原始 Markdown |
| `06-docwin-open.png` | 独立文档窗打开，初始镜像主窗内容 |
| `06-docwin-edited.png` | docwin 内微改后：`W4-EDIT-OK W4-MIRROR-WIN`，磁盘已落盘 |
| `06-docwin-mirror-FAIL.png` | **P1-2 现场**：关闭独立窗后主窗只有 `W4-EDIT-OK`，缺 `W4-MIRROR-WIN`；`独立窗口` 按钮已恢复 |
| `06-docwin-mirror-after-reload.png` | 刷新主窗后出现 `W4-MIRROR-WIN`，证明磁盘写入成功、仅实时 mirror 缺失 |

## 3. P0 / P1

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 根因（file:line）与建议 |
| --- | --- | --- | --- | --- | --- | --- |
| docs-P1-1 | P1 | 文档面板「进入编辑 → 取消」后，正文预览顶部混入整篇**原始 Markdown**（`# 商城首页…`、`---`、`\| 维度 \| 说明 \|`、```text 等），随后又重复渲染完整正文；看起来像文档损坏/内容重复。数据与磁盘未损坏，切 Tab 或关闭/重开面板可恢复。 | 1) 打开 `测试1/首页`；2) 顶栏「文档」打开 PC 面板；3) 点「进入编辑」；4) 直接点「取消」（无需修改、无需粘贴）；5) 观察正文。100% 复现；粘贴后再取消同样复现。 | 编辑/取消后的主阅读视图错误，用户可能误判文档损坏；滚动位置丢失。**不阻断保存/微改**，但正常编辑路径的可见结果错误。 | `docs/wave4/shots/docs/05-edit-cancel-leak-FAIL.png`、`05-paste-cancel-leak-FAIL.png`；取消前后磁盘 SHA256 不变；`doc-preview.innerText` 同时出现原始 `# 商城首页`、`\| 维度 \| 说明 \|` 与渲染后的 `商城首页 — 产品需求文档 (PRD)`。 | **根因**：`src/renderer/features/docs/DocEditor.tsx:484-489` 直接把 `draft` 写入 contentEditable 的 `innerText`；`:799-827` 编辑区与预览区在同一个条件分支位置渲染同一种 `div`，React 复用同一 DOM 节点；`:713-716` 取消时再次手动写 `innerText`。React 不跟踪手动写入的文本节点，切回预览时只追加渲染块，残留的原始 Markdown 文本成为预览首个子节点。**建议**：编辑区/预览区使用不同 `key` 或不同宿主元素；切回预览前清空节点；不要手动写 React 管理的 DOM。 |
| docs-P1-2 | P1 | 独立文档窗保存后，主窗 mirror-back **只同步 mode、不同步 content**：关闭 docwin 回面板，主窗仍显示旧正文；刷新后才看到独立窗的修改。 | 1) 主窗打开 `测试1/首页` 功能说明；2) 点「独立窗口」；3) 在 docwin 微改「W4-段落-起点」追加 `W4-MIRROR-WIN` 并按 Enter；4) 回主窗点顶栏「文档」（关闭独立窗）；5) 查看主窗正文：含 `W4-EDIT-OK`、不含 `W4-MIRROR-WIN`；6) 刷新主窗后可见 `W4-MIRROR-WIN`。 | 独立窗编辑结果在主窗不可见，违反 plan §3.3 step 7「独→主 mirror-back 同步」；数据已落盘，刷新可恢复；用户会误以为独立窗修改丢失。 | `06-docwin-open.png`（初始镜像）、`06-docwin-edited.png`（docwin 含两标记）、`06-docwin-mirror-FAIL.png`（主窗缺 WIN）、`06-docwin-mirror-after-reload.png`（刷新后含 WIN）；磁盘 `25fa0a52648f`，段落行 = `…测试段落。 W4-EDIT-OK W4-MIRROR-WIN`。 | **根因**：`src/renderer/stores/docs-store.ts:168` 在 docwin 内 `pushContentMirror` 直接 `return`（文档窗保存不向主窗推 content）；`:1151-1153` `docwin.close` 只 `openDocs()`，不重读磁盘；`:913-929` `sameDir && descLoaded` 命中缓存，不重新 `sandbox:read-file`；`src/renderer/app/modes/DocWindow.tsx:28-34` 只上报 `mode`。**建议**：docwin 保存成功后经 `doc:mirror-back` 推送 `{kind:'content', payload}`；或关闭/重开面板时强制 `loadDesc(source, {force:true})` 从磁盘重读。 |

## 4. 结论

- 结果：**需修复**（A 冒烟 FAIL）
- P0 = 0；P1 = 2；P2 = 0；P3 = 0；ENV = 0
- 阻断项：`docs-P1-1`（编辑→取消后预览混入原始 Markdown）、`docs-P1-2`（docwin→主窗内容 mirror-back 不同步）
- 已通过：打开文档面板、Markdown 表格/列表/代码块真实渲染、目录折叠/展开/跳转、移动端目录抽屉与 Tab 可点、Ctrl+F 搜索/计数/上一个/下一个/高亮/Esc、设置输入框焦点守卫、段落 ✎ 微改落盘 + reload 持久化、编辑态富文本粘贴纯文本化（无 span/style）、docwin 打开/初始镜像/保存落盘/关闭回面板/独立窗口按钮恢复
- 复测范围：修复 `DocEditor` 编辑/预览切换后复跑本 spec；修复 mirror-back 后复跑本 spec，并加跑相邻「移动端文档 + 舞台」smoke
- 备注：`docs-P1-1` 数据未损坏且有「切 Tab/重开面板」替代路径；若协调者严格按「P1 无替代路径」口径，可降为 P2，但建议按 P1 处理（保存/取消后主视图立即呈现原始 Markdown，用户会误判数据损坏）。本域按任务要求已清理 `.devdata-wave4-docs`；截图与哈希已固化在本报告，重新执行 `node e2e/wave4/seed.mjs --domain docs` 后即可复跑（spec 会自动注入 W4 夹具）。
