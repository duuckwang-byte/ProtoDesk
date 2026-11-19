# Wave4 A2 冒烟 · 导出域（源码 JSON / 独立 HTML / 文档 Markdown）报告

- 日期：2026-11-13
- Agent / owner：A2 子代理（wave4 export）
- 阶段：A 冒烟（PNG/PDF 原生保存对话框留 A3，本域不点击）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer` 构建时间 2026-11-13 12:36:16；主 chunk `assets/index-BHMDlo45.js` 329,649 B，SHA256 前 12 位 `D525C677F6BB`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-export`；实际 `app.getPath('userData')` 精确相同
- seed：`_wave4-seed.json` present；SHA256 前 12 位 `8446403CA23B`
- 运行命令：
  `npx playwright test e2e/wave4-export.spec.ts --workers=1 --output=test-results/wave4/export`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无；原生保存对话框调用=0（`dialog.showSaveDialog` spy）
- 结果：**1 passed / 9.0s**；Electron `window-close` exit 0 / 347ms

## 0. 结论先行

**PASS / 可放行（A 冒烟）**：P0=0，P1=0。

- 5 项导出菜单齐全且 Esc 可关闭；源码包 JSON 真实落盘、可解析、内容与磁盘一致。
- 独立 HTML 真实落盘，Chromium `file://` + 断网模式可打开：`__EXPORT_BOOT__=true`、`__EXPORT_SOURCES__` 存在、内联样式表 1 个、正文非空、iframe 正文 292 字符、无外链脚本、无 React 运行时。
- 当前文档 Markdown 落盘且与磁盘 `首页.md` **逐字节一致**（9,118 B）。
- PNG/PDF 菜单项仅断言可见，未点击；`showSaveDialog` 调用计数 0。
- console error / pageerror / crash 均为 0。
- 仅有 1 条非阻断 P2 观察（独立 HTML 的文档区被隐藏），不计入 A 结论，详见 §3。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离 + 冷启动 + 当前源 | PASS | `userData` 与 `.devdata-wave4-export` 精确一致；项目选择器未弹（自动恢复「测试1」）；侧栏 `首页/我的`；`loc-pill` 含「首页」；`stage-frame[data-has-source=1]` | — |
| 1 | 顶栏导出菜单 5 项 + Esc | PASS | `export-menu` 可见；`export-source/html/png/pdf/md` 全可见；文案=「导出源码包（JSON） / 导出独立 HTML（单文件离线） / 导出文档长图（PNG） / 导出文档（PDF） / 导出文档（Markdown）」；Esc 后菜单项 hidden；截图 `01-export-menu.png`、`01-export-menu-closed.png` | — |
| 2 | 导出源码包（JSON） | PASS | toast「源码包已导出。」；`%TEMP%\pland-wave4\exports\export-1794546968331\01-source\测试1[源码].json`，**22,343 B**（>20KB），SHA256 前 12 位 `BD55630422A9`；`JSON.parse=OK`；`project=测试1`；`sources=2`（`首页.html` / `我的.html`，displayName=首页/我的）；首页 content 10,980 字符=磁盘 `首页.html`（11,396 B UTF-8），md 3,780 字符=磁盘 `首页.md`（9,118 B）；我的 content/md 同样逐字符一致；截图 `02-source-toast.png`、`02-source-result.png` | — |
| 3 | 导出独立 HTML + Chromium file:// 断网 | PASS | toast「独立 HTML 已导出（离线可读，含 __EXPORT_BOOT__ 数据）。」；文件 `...\02-html\首页[导出].html`，**47,618 B**，SHA256 前 12 位 `4C4DC220193F`；`<!doctype html>`；Chromium `newContext({offline:true})` 打开：`offline=true`、`__EXPORT_BOOT__=true`、`__EXPORT_SOURCES__=1`、`__REQ_MAP__` 对象、`styleSheets=1`、主正文 18 字符（标题+原型按钮）、iframe 正文 **292 字符**、内联 md 3,445 字符（含「商城首页」）、外链脚本 **0**、`React=undefined`、`reactRoot=0`、无 `react-dom/createRoot`、`__EXPORT_RENDER__` 存在；截图 `03-html-toast.png`、`03-html-offline.png` | — |
| 4 | md 图片内联为 `data:image` | **SKIP** | seed 的 `首页.md` / `我的.md` 图片语法=0 条；`首页/assets/` 文件=0 个。按任务口径记 SKIP，不伪造图片数据 | — |
| 6a | 空文档错误路径（先于步骤 5 执行，保证 docContent 未加载） | PASS | 启动后未打开文档面板时点击「导出文档（Markdown）」→ toast「当前文档为空，无需导出。」；下载目录文件=0（未落盘） | — |
| 5 | 导出文档 Markdown | PASS | 打开文档面板并加载「首页.md」后导出；toast「文档 Markdown 已导出。」；文件 `...\04-doc-md\首页 · 功能说明.md`，**9,118 B**，SHA256 前 12 位 `3DD489F7B5ED`；与磁盘 `首页.md` **逐字节一致**（文本一致=true，仅换行差异=false）；正文 3,780 字符，首行「# 商城首页 — 产品需求文档 (PRD)」；文件名含「首页/功能说明」；截图 `05-doc-loaded.png`、`05-md-toast.png`、`05-md-result.png` | — |
| 6b | toast / 错误处理 / 原生框守卫 | PASS | 3 次成功导出均有 toast；空文档有明确提示且不落盘；`dialog.showSaveDialog` 调用=**0**；导出目录 PNG/PDF 文件=0；主进程 `will-download` 记录 3 个（`测试1[源码].json` / `首页[导出].html` / `首页 · 功能说明.md`）；PNG/PDF 菜单项仅断言可见、全程未点击；截图 `06-final.png` | — |
| 7 | console / pageerror / crash / 退出 | PASS | console error=0（致命=0）；pageerror=0；crash=0；`close`=`window-close`，exitCode=0，347ms；截图 `07-console-final.png` | — |

> 说明：步骤 6 含两条检查，其中「空文档」必须在文档面板加载前执行，故实际执行顺序为 1→2→3→4→6a→5→6b→7；导出均为只读操作，单步失败不污染源文件。

## 2. 导出文件（临时目录，报告完成后已清理）

| 文件 | 绝对路径 | 大小 | SHA256 前 12 位 |
| --- | --- | --- | --- |
| 源码包 JSON | `C:\Users\allow\AppData\Local\Temp\pland-wave4\exports\export-1794546968331\01-source\测试1[源码].json` | 22,343 B | `BD55630422A9` |
| 独立 HTML | `C:\Users\allow\AppData\Local\Temp\pland-wave4\exports\export-1794546968331\02-html\首页[导出].html` | 47,618 B | `4C4DC220193F` |
| 文档 Markdown | `C:\Users\allow\AppData\Local\Temp\pland-wave4\exports\export-1794546968331\04-doc-md\首页 · 功能说明.md` | 9,118 B | `3DD489F7B5ED` |

落盘方式：主进程 `session.defaultSession.on('will-download')` → `item.setSavePath()` 重定向；`page` download 事件未作为判定依据。JSON 除 `JSON.parse` 外还比对 `project/sources/content/md`；MD 与磁盘源文件做字节级比对。

## 3. 截图

目录：`docs/wave4/shots/export/`

| 文件 | 内容 |
| --- | --- |
| [`01-export-menu.png`](../shots/export/01-export-menu.png) | 顶栏导出菜单 5 项齐全 |
| [`01-export-menu-closed.png`](../shots/export/01-export-menu-closed.png) | Esc 关闭后菜单消失 |
| [`02-source-toast.png`](../shots/export/02-source-toast.png) | 源码包导出成功 toast「源码包已导出。」 |
| [`02-source-result.png`](../shots/export/02-source-result.png) | 源码包导出后主窗状态 |
| [`03-html-toast.png`](../shots/export/03-html-toast.png) | 独立 HTML 导出成功 toast |
| [`03-html-offline.png`](../shots/export/03-html-offline.png) | Chromium `file://` + 断网打开导出 HTML：原型 iframe 正常、样式生效 |
| [`05-doc-loaded.png`](../shots/export/05-doc-loaded.png) | 文档面板加载「首页.md」（当前文档基线） |
| [`05-md-toast.png`](../shots/export/05-md-toast.png) | 文档 Markdown 导出成功 toast |
| [`05-md-result.png`](../shots/export/05-md-result.png) | 文档 Markdown 导出后主窗状态 |
| [`06-final.png`](../shots/export/06-final.png) | toast / 原生框守卫检查后的最终状态 |
| [`07-console-final.png`](../shots/export/07-console-final.png) | console/pageerror/crash 收尾 |

关键截图：

![导出菜单](../shots/export/01-export-menu.png)

![独立 HTML 断网打开](../shots/export/03-html-offline.png)

## 4. 缺陷（仅 P0/P1）

**无。P0=0，P1=0。**

已覆盖且未触发的 P0/P1 边界：

- 5 项菜单缺失（P1）：5/5 存在。
- 源码 JSON 无文件/坏 JSON/project 或 sources 缺失（P1）：文件 22,343 B、可解析、2 个源、content/md 与磁盘一致。
- 独立 HTML 无文件或关键契约缺失（P1）：文件 47,618 B，`__EXPORT_BOOT__` / `__EXPORT_SOURCES__` / 样式 / 正文 / 无 React 全部通过。
- 文档 Markdown 无文件/内容错误（P1）：逐字节一致。
- 原生保存对话框阻断（P1）：`showSaveDialog` 调用 0，未点击 PNG/PDF。

## 5. 观察区（非阻断，A 不计入结论）

| ID | 级别 | 现象 | 复现 | 证据 | 是否进 B |
| --- | --- | --- | --- | --- | --- |
| export-OBS-1 | P2 | 独立 HTML 打开后右侧「文档」区域为空白，导出的 md 实际被渲染进隐藏节点，未显示 | 1) 导出独立 HTML；2) Chromium `file://` 断网打开；3) 观察右侧文档面板 | `src/renderer/features/export/ExportMenu.tsx:184` 输出 `<div id="docContent" style="display:none">`；`js/export-template.js:100` 优先取 `docContent`（`getElementById('docContent') || getElementById('exportLiteDoc')`），导致 md 3,445 字符写入隐藏节点、可见的 `#exportLiteDoc` 为空、`#exportLiteTitle` 未赋值；截图 `03-html-offline.png` 右侧面板空白 | 是（建议 B 阶段让模板优先 `exportLiteDoc`/`exportLiteTitle`，或把 `docContent` 改为可见容器） |

## 6. 结论

- 结果：**可放行（A 冒烟）**
- P0 = 0；P1 = 0；P2 = 1（观察区，非阻断）；P3 = 0；ENV = 0；SKIP = 1（md 图片内联，seed 无图片）
- 阻断项：无
- 复测范围：`e2e/wave4-export.spec.ts` 单文件单 worker，1 passed / 9.0s；`window-close` exit 0；致命 console/pageerror/crash = 0
- 备注：
  - PNG/PDF 原生保存对话框按任务要求留 A3，本域只验证菜单项存在，未点击，`showSaveDialog` 调用=0。
  - md 图片内联因 seed 的 `首页.md` / `我的.md` 无图片、`首页/assets/` 为空而 SKIP；如需覆盖，可在隔离副本的 md 中增加 `![x](assets/x.png)` 并放入图片后重跑。
  - 本域数据目录 `.devdata-wave4-export` 与 `%TEMP%\pland-wave4\exports\export-1794546968331` 已在报告完成后清理；复跑前执行 `node e2e/wave4/seed.mjs --domain export`。
  - 本轮未修改 `src/**`、`main/**`、`tests/**`、`package.json`，未 commit；只新增 `e2e/wave4-export.spec.ts`、本报告与 `docs/wave4/shots/export/**`。
