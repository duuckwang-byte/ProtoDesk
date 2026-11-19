# Wave4 B 全量体验 · Git + 导出 + 浮层（标注/快照/链接/待提交）

- 日期：2026-11-13
- 项目：`D:\文件\工具\原型工具-PlanD`
- 域：Git、导出、浮层（检查器/标注/快照/链接/待提交）
- 代码：`e2e/wave4-b-git-export.spec.ts`（新增，未改 `src/**`、`main/**`、`tests/**`、`package.json`）
- 数据目录：`.devdata-wave4-b-git-export`（测试后已删除）
- 远程夹具：`C:\temp\pland-wave4-b-git-export-<ts>.git`（本地 bare，`PLAND_GIT_ALLOW_LOCAL=1`，假 token；测试后已删除）
- 结论：**P0=0，P1=1（快照恢复不可用，阻断放行），P2=3，P3=2，ENV=1**

## 1. 一页结论

| 项 | 结果 |
| --- | --- |
| Git 本地 bare 全链路 | **PASS**：配置保存/回显、测试连接、分支、状态树、搜索/筛选、diff、push、pull、upstream、自愈取消、操作取消、无 GCM/孤儿、`git fsck` 全部通过 |
| 导出 | **PASS**：5 项菜单、源码 JSON、独立 HTML（离线/右侧文档区/表格/无 React）、文档 MD、PNG/PDF 对话框取消、空文档、无源提示 |
| 浮层 | **部分 PASS**：检查器三板块、标注增删/定位/显隐、链接增删/跳转、队列持久化/移除/清空、Esc 单层（Sheet+Confirm）、遮罩、焦点回归、1024 布局均通过 |
| 阻断项 | **快照恢复失败**：`fs.cpSync(当前原型目录 → snapshots/<项目>/<原型>/undo-<ts>)` 在 Windows 运行态返回 `EPERM`，历史版本无法恢复 |
| 数据安全 | 快照恢复失败发生在“恢复前备份”阶段，当前 `首页.html` hash 未变（`2D72B71839FC`），无数据损坏 |
| 环境噪声 | seed 原型自身引用 `cdn.jsdelivr.net/npm/vant`，产生 1 条 CDN 请求与 CSP 报错；与 Git/导出/浮层无关（ENV） |

## 2. 环境与基线

- Electron `37.10.3`，内置 Node `22.21.1`；系统 Node `24.15.0`。
- React 渲染器（`PLAND_RENDERER=react`），真实 Electron + Playwright `_electron`。
- 数据隔离：`app.getPath('userData')` 精确等于 `.devdata-wave4-b-git-export`（启动后断言）。
- seed：项目 `测试1`；侧栏 4 个原型（首页/我的/大厅/需求管理）；`首页.html` sha256[0:12]=`2D72B71839FC`；`首页.md` 9,118 B；`annotations.json` 2 条；`links.json` 2 条；快照 2 版本（`20260924-104632`、`20261111-112957`）。
- Git 初始：sandbox HEAD `e2864057a18d`，工作区 23 项变更；GCM 基线 0。
- 运行命令：

```powershell
$env:PLAND_RENDERER = "react"
npx playwright test e2e/wave4-b-git-export.spec.ts --workers=1 `
  --output=test-results/wave4/b-git-export --reporter=list
```

- 结果：B1 Git `1 passed`；B2/B3 单独运行 `1 failed`（13 个步骤中 12 个 PASS，唯一失败为快照恢复 P1）。

## 3. 缺陷分级汇总

| 级别 | ID | 问题 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
| **P1** | `b-ge-P1-snapshot-restore` | 快照恢复失败：`EPERM, 函数不正确`，恢复前 `undo-*` 备份目录无法创建 | 历史版本不可恢复，核心回滚路径不可用 | 待修 |
| **P2** | `b-ge-P2-status-empty` | Git 状态筛选无结果时仍渲染 4 个空项目卡（“已选 0/0”），不显示“无匹配/无变更”空态 | 用户会误以为筛选坏了 | 待排期 |
| **P2** | `b-ge-P2-esc-nested-git` | Git 仓库设置 Dialog 打开时按 Esc 会连 Git 主面板一起关闭（一次 Esc 关两层） | 丢失配置上下文，需重新打开；与“Esc 单层”规范冲突 | 待排期 |
| **P2** | `b-ge-P2-html-br` | 独立 HTML 右侧文档区把 Markdown 中的 `<br>` 显示为字面文本（本次 50 处） | 离线 PRD 表格每行都出现 `<br>`，可读性明显下降 | 待排期 |
| **P3** | `b-ge-P3-diff-default-collapsed` | 差异预览只默认展开“当前项目”；差异都在非当前项目时首屏只有折叠卡 | 需手动展开才看到具体文件 | backlog |
| **P3** | `b-ge-P3-snapshot-delete` | 快照面板没有“删除快照”入口（只有列表/筛选/恢复） | 历史版本只能恢复，不能在 UI 删除 | backlog / 口径确认 |
| **ENV** | `b-ge-ENV-prototype-cdn` | seed 原型引用 `cdn.jsdelivr.net/npm/vant`，产生 CDN request 与 CSP console error | 非 Git/导出/浮层行为；过滤后致命 console=0 | 环境噪声 |

## 4. Git 全链路（PASS）

| # | 步骤 | 结果与证据 |
| --- | --- | --- |
| 0 | 冷启动/隔离/进入 `测试1` | userData 精确匹配隔离目录；picker auto-restored；`sandbox HEAD=e2864057a18d`；初始 status=23 项 |
| 1 | Git 管理 660px + 状态树首屏 | `git-sheet[data-surface=dialog]` 宽 **660**；分支 `main`；**23 处变更**；**15 个文件行**；**4 个项目卡**；**4 个原型组** |
| 2 | 状态树折叠/搜索/筛选 | 当前项目折叠 15→0→15 行；搜索“首页”命中 11 行且路径全部含“首页”；新增筛选 15 行全 `add`；修改筛选 0 行；冲突筛选 0 行（空项目卡保留=P2）；清空恢复 15 行 |
| 3 | 仓库设置保存/回显/测试连接/分支 | 保存 toast「Git 仓库配置已保存。」；`remoteUrl=file:///C:/temp/...git`、`branch=main` 落盘；假 token 不进入 `git-config.json` 与 `sandbox/.git/config`；重开回显 remote/branch/author，token 状态「已配置 ****oken」、明文框为空；测试连接「连接成功 · 244ms」；分支选项 `main,master` |
| 4 | push 到本地 bare | 勾选当前项目 **15/15**；提交说明 `wave4 b-git-export push <ts>`；toast「发布成功」；bare `log -1` 含该说明；sandbox HEAD = bare `refs/heads/main`；`branch.main.remote=origin`、`merge=refs/heads/main`、`@{u}=origin/main`；busy 时“取消操作”可见 |
| 5 | 差异预览（远端领先 1 提交） | diff hint 可见；**3 处变更**（测绘1 2 + 默认项目 1）；展开“默认项目”后找到 `wave4-b-ge-pull-probe.md`；默认只展开当前项目=P3 |
| 6 | pull 同步 | Confirm「拉取同步…」；toast「同步完成」；探针文件落盘且含 stamp；HEAD=`origin/main`=探针 sha；`ahead/behind=0 0` |
| 7 | 自愈修复取消 | Confirm「自愈修复…」→ 取消；无 `.heal-backup`；`.git/config` hash 不变；拉取后 diff 空态「远端暂无差异」 |
| 8 | 慢操作取消 | 实际命中 `git-cancel`；toast「已取消 pull 操作。」；随后重试拉取成功；最终 HEAD=取消探针 sha；`git fsck --connectivity-only` exit 0 |
| 9 | Esc 单层 | 仓库设置打开时 Esc：config 关闭，但 Git 主面板同时关闭（P2）；单独 Git 面板 Esc 可关闭；主窗始终可见；焦点回到顶栏「Git 管理」 |
| 10 | 进程/仓库健康 | 凭据类进程新增 **0**；关闭后无 git/conhost 子进程；无进程持有 bare/数据目录；`git fsck` exit 0；Git 外部请求 **0**（仅原型 CDN ENV 噪声 1） |

## 5. 导出（PASS）

| # | 项 | 结果与证据 |
| --- | --- | --- |
| 1 | 5 项菜单 + Esc | 5 项齐全：源码 JSON / 独立 HTML / PNG / PDF / Markdown；Esc 后菜单 hidden |
| 2 | 源码 JSON | `测试1[源码].json` **203,850 B**；`JSON.parse` OK；`project=测试1`；`sources=4`（大厅/首页/我的/需求管理）；首页 `content`/`md` 与磁盘逐字符一致 |
| 3 | 独立 HTML | `首页[导出].html` **8,794 B**，sha256[0:12]=`A4D32AAB1124`；Chromium `offline=true` 打开；`__EXPORT_BOOT__=true`；`styleSheets=1`；iframe 正文 292 字符；右侧文档区 text **3,445** 字符、**table=4**、字面 `<br>` **50 处（P2）**、`display=block`、宽 **480px**（iframe right=718，doc x=734）；外链脚本 **0**；React **false**；reactRoot **0**；`react-dom/createRoot` 未出现 |
| 4 | 文档 Markdown | `首页 · 功能说明.md` **9,118 B**，sha256[0:12]=`3DD489F7B5ED`；与磁盘 `首页.md` 逐字节一致；正文 3,780 字符 |
| 5 | PNG/PDF 原生对话框取消 | `dialog.showSaveDialog` 调用 **2** 次（PNG≥1、PDF≥2），均返回 `canceled`；导出目录 PNG/PDF 文件 **0**；导出按钮恢复可用 |
| 6 | 空文档 | 置空 `首页.md` + reload → 导出 MD toast「当前文档为空，无需导出。」；落盘 **0** 文件；恢复备份后文档面板正文 3,466 字符（含商城首页） |
| 7 | 无源项目 | 新建空项目后 `stage data-has-source=0`；源码导出 toast「当前没有可导出的原型。」；HTML 导出 toast「请先选择要导出的原型。」；已切回 `测试1/首页` |

## 6. 浮层（除快照恢复外 PASS）

| # | 项 | 结果与证据 |
| --- | --- | --- |
| 8 | 检查器三板块 + 标注 | 三板块「修改需求/跳转交互/需求标注」可见；新增「W4B-GE-标注-<ts>」→ `annotations.json` 2→3、角标=1；面板定位→检查器回填；显隐开关→角标 1→0→1；删除 Confirm→annotations 回到 2、角标=0 |
| 9 | 链接 | 选中 `[data-pr-id="pr-p-39"]` → 绑定目标「我的」→ links 2→3；链接面板显示 selector/target；「预览跳转」后 `loc-pill=我的`；回首页后删除 Confirm→links 回到 2 |
| 10 | 待提交队列 | 两条就地改（不同 selector）→ 队列 2；`selector/page/htmlFile` 非空；reload 后仍 2 且 Sheet=2；移除 1 条 Confirm→1，reload 后仍 1；清空 Confirm→bar 消失、`edit_queue_v1=[]`，再次 reload 仍为空 |
| 11 | Esc/遮罩/焦点/1024 | 检查器 Esc 后选择仍=1，焦点回到 `overlays-open-inspector`；遮罩点击 (8,8) 关闭 Sheet 且选择保留；Sheet+Confirm 第 1 次 Esc 只关 Confirm（annotations 仍 2）、第 2 次关 Sheet；1024 视口 `innerWidth=1025`、`scrollWidth=1025`（无横向滚动）；检查器 Sheet 宽 430、右边界 1025；Git Sheet 宽 660；`git-toolbar` client/scroll=618/618 |
| 12 | 快照 | 列表 2 版本、筛选 `20260924-104632`→1、清空→2；恢复 Confirm 文案含快照时间；**恢复失败 P1**（见 §7）；列表仍 2；无删除入口 P3 |
| 13 | console | 总 21 条（CDN CSP 14 + 原型脚本 `Unexpected token '.'` 7），原型内容噪声=21，过滤后致命=0，crash=0 |

## 7. P1 深挖：快照恢复 EPERM

### 7.1 现象

- 操作：快照面板 → 选 `20260924-104632` → 恢复 → Confirm「恢复」。
- toast 原文（乱码为 Windows 中文错误文本）：

```text
快照恢复失败：EPERM, º¯Êý²»ÕýÈ·¡£
'\\?\D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-git-export\
snapshots\测试1\首页\undo-20261113-180854'
```

- 恢复前后 `首页.html` sha256[0:12] 均为 `2D72B71839FC`；`annotations=2`、`links=2` 未变；列表仍 2 条。
- 连续 **6 次**（17:27、17:30、17:37、17:40、18:04、18:08）均在同一阶段失败。

### 7.2 代码路径

`main/services/sandbox-storage-service.js:snapshotRestoreImpl`：

```js
const undoDst = path.join(root, 'undo-' + fmtTs(new Date()));
fs.cpSync(dn, undoDst, { recursive: true }); // 失败点
fs.rmSync(dn, { recursive: true, force: true });
fs.cpSync(src, dn, { recursive: true });
```

失败发生在**恢复前备份**，尚未删除/覆盖当前原型目录，因此本次无数据损坏；但用户无法回滚。

### 7.3 运行时归因

| 运行时 | 操作 | 结果 |
| --- | --- | --- |
| 系统 Node `24.15.0` | `fs.cpSync(sandbox/测试1/首页 → snapshots/测试1/首页/undo-manual-test)` | **OK** |
| Electron `37.10.3` 内置 Node `22.21.1`（`ELECTRON_RUN_AS_NODE=1`，应用未启动） | 同一源 → 同一 `snapshots/.../undo-electron-node` | **EPERM** |
| 同上 | 同一源 → `snapshots/.../20260101-000000`、`.../testdir` | **EPERM** |
| 源目录检查 | 11 个文件，无 symlink/junction | 排除链接因素 |

结论：这是 **Electron 37 内置 Node 22 的 `fs.cpSync` 在本次 Windows + 中文路径环境下复制目录的运行时缺陷**；系统 Node 24 不受影响。产品当前直接依赖该 API，导致快照恢复（以及同 API 的自动 `takeSnapshot`）在同类路径下不可用。

### 7.4 建议修复（供 owner 参考）

1. 将 `fs.cpSync` 替换为逐文件 `readdir + copyFileSync`（或 `fs.cp` 异步 + 重试）实现，绕开该运行时缺陷。
2. 或先复制到 `%TEMP%` 的 ASCII 临时目录，再 `rename` 到 `snapshots/.../undo-*`；失败时回退逐文件复制。
3. 对 `EPERM/EBUSY` 增加一次短暂重试，并把错误 toast 改为可读文案（当前中文乱码）。
4. 回归 `takeSnapshot`（同 `fs.cpSync` 调用）与“恢复后 hash = 快照 hash”。

## 8. P2/P3 细节

### P2-1 Git 状态筛选空结果

- 复现：Git 管理 → 状态筛选「冲突」。
- 实际：总数仍显示 23 处变更；内容区保留 `测试1 / .context / 测绘1 / 默认项目` 4 个空项目卡，均为「已选 0/0」；`git-empty` 不出现。
- 证据：`docs/wave4/shots/b-git-export/02-status-conflict-empty.png`。
- 建议：`visible` 过滤后同时剔除 `protos.length===0` 的项目；无结果时显示「没有匹配的变更」空态。

### P2-2 Git 仓库设置 Esc 越级关两层

- 复现：Git 管理 → 仓库设置 → 按 Esc。
- 实际：`git-config-dialog` 关闭，同时 `git-sheet` 也关闭；焦点回到顶栏「Git 管理」。
- 原因：`gitOpen` 在 `ui-store.closeTopmost()` 的优先级栈中先命中；嵌套的仓库设置 Dialog 只登记在通用 `overlayLayers`，不在 store 栈。
- 证据：`09-git-config-before-esc.png`（设置弹窗）、`09-git-after-esc.png`（主面板也已关闭）。
- 建议：`closeTopmost()` 先检查 `closeTopmostOverlay()` 是否存在嵌套层，再处理 store 层；或把仓库设置 Dialog 纳入 store 栈。

### P2-3 独立 HTML 文档区 `<br>` 字面量

- 复现：导出独立 HTML → Chromium 离线打开。
- 实际：右侧文档区 `#docContent` 内出现 **50 处**字面 `<br>`（如「1. …。<br>2. …。<br>3. …。」）；同一 Markdown 在应用内文档面板渲染为真实换行。
- 证据：`03-html-offline.png`。
- 建议：standalone 模板的 Markdown 渲染允许安全 `<br>` 或将其转换为换行；同时保持转义其他 HTML。

### P3-1 差异预览默认折叠非当前项目

- 实际：diff 首屏只展开当前项目；本次远端差异全在 `测绘1` 与 `默认项目`，用户只看到「已选 0/2」「已选 0/1」两张折叠卡，需手动展开。
- 证据：`05-diff-remote.png`。

### P3-2 快照面板无删除入口

- 实际：快照 Sheet 只有列表、筛选、刷新、恢复；没有“删除快照”控件。任务口径中的“快照删除”无法通过 UI 验证；本次记 P3/口径确认。
- 证据：`12-snapshot-list.png`。

### ENV：原型 CDN 噪声

- `https://cdn.jsdelivr.net/npm/vant@4/lib/index.css` 被 CSP 拦截；同时原型内联脚本 `Unexpected token '.'`。
- 来源为 seed 原型 HTML，不是 Git/导出/浮层链路；过滤后致命 console=0。

## 9. 证据索引

`docs/wave4/shots/b-git-export/`：

| 主题 | 截图 |
| --- | --- |
| 冷启动 | `00-cold-start.png` |
| Git 首屏/状态树 | `01-git-panel-660.png`、`02-status-filter.png`、`02-status-conflict-empty.png` |
| Git 配置/连接 | `03-config-filled.png`、`03-config-echo.png`、`03-test-connection-ok.png` |
| push | `04-push-selected.png`、`04-push-success.png` |
| 差异 | `05-diff-remote.png` |
| pull | `06-pull-confirm.png`、`06-pull-success.png` |
| 自愈/取消 | `07-heal-confirm.png`、`07-heal-cancelled.png`、`08-cancel-operation.png` |
| Esc | `09-git-config-before-esc.png`、`09-git-after-esc.png`、`11-esc-sheet-only.png`、`11-esc-confirm-only.png`、`11-mask-close.png` |
| 导出菜单/源码/HTML/MD | `01-export-menu.png`、`01-export-menu-closed.png`、`02-source-toast.png`、`02-source-result.png`、`03-html-toast.png`、`03-html-offline.png`、`04-doc-loaded.png`、`04-md-toast.png`、`04-md-result.png` |
| PNG/PDF 取消 | `05-native-cancel.png` |
| 空文档/无源 | `06-empty-doc-toast.png`、`07-no-source-toast.png` |
| 检查器/标注 | `08-inspector-three-sections.png`、`08-anno-panel.png`、`08-anno-locate.png`、`08-anno-hidden.png`、`08-anno-delete-confirm.png` |
| 链接 | `09-links-panel.png`、`09-link-jump-target.png`、`09-link-delete-confirm.png` |
| 待提交 | `10-queue-bar.png`、`10-queue-persist.png`、`10-queue-remove-confirm.png`、`10-queue-clear-confirm.png`、`10-queue-cleared.png` |
| 1024 布局 | `11-viewport-1024-sheet.png`、`11-viewport-1024-git.png` |
| 快照 | `12-snapshot-list.png`、`12-snapshot-restore-confirm.png`、`12-snapshot-restore-fail-FAIL.png` |
| 收尾 | `10-final.png`、`13-final.png` |

## 10. 清理与边界

- 已删除 `.devdata-wave4-b-git-export`、`C:\temp\pland-wave4-b-git-export-*.git`、`-clone`、`%TEMP%/pland-wave4/exports/b-git-export-*`、诊断目录 `C:\temp\undo-diag-electron`；无 Electron 进程残留。
- 未修改 `src/**`、`main/**`、`tests/**`、`package.json`；未执行 `npm install`；未 commit。
- 未访问真实 gitee；Git 远程仅为本地 bare `file:///C:/temp/...git`，假 token `dummy-local-token` 仅写隔离数据目录且未落明文。
- PNG/PDF 使用主进程 `dialog.showSaveDialog` 调用并返回 `canceled` 模拟用户取消；未生成 PNG/PDF 文件。
- 空文档测试曾临时截断隔离副本的 `首页.md`，已恢复备份并 reload 验证正文 3,466 字符；数据目录已整体删除。
- 全仓 `npx tsc --noEmit` 当前存在 1 个与本 spec 无关的既有错误：`src/renderer/features/docs/__tests__/docs-panel.test.tsx(211,62)` 的 `exact` 参数；本次未修改该文件（按任务边界只读）。
