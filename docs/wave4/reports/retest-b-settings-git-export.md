# Wave4 B 阶段复测 · 设置 + Git / 导出

- 日期：2026-11-13
- 范围：设置域（入口 / Agent 网格 / ACP / Select / 焦点陷阱 / 1024 Popover）+ Git / 导出域（状态筛选空态 / Git 设置 Esc / 本地 bare push-pull / 快照恢复 / 独立 HTML / PNG-PDF）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` 2026-11-13 18:35:07，SHA256[0:16]=`CB86BB99128073A2`；入口 chunk `index-CcwA6lD7.js` 378,633 B，SHA256[0:16]=`34F6C3B385CB5F03`
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 结论：**P0=0，P1=0，P2=1，P3=2，ENV=2**。设置 / Git / 导出三块均 **PASS**；上一轮 2 个 P1（dist 落后、Select 鼠标点击失效）与 1 个 P1（快照恢复 EPERM）均已修复并通过真机复测。

## 1. 一页结论

| 域 | 结果 | 关键证据 |
| --- | --- | --- |
| 设置 / Agent / 模型 / 设计规范 | **PASS** | 侧栏底部「打开设置」入口；6 Tab；Agent 26 行、20 个 ACP 行每行恰好 1 个 ACP 徽章；网格 2 列 ↔ 1 列；设置 Dialog 焦点陷阱与关闭归还焦点；Select 真实鼠标点击生效；Select Esc 只关自身；1024 模型 Popover 双列完整可见（right=`971.998` ≤ 1024） |
| Git | **PASS** | 筛选/搜索无结果：0 文件行、0 项目卡、空态「没有匹配的变更」；Git 设置 Esc 只关自身（第 2 次 Esc 才关 Git）；本地 bare push/pull 成功，HEAD=`origin/main`、ahead/behind=`0 0`、`git fsck` exit 0；无 GCM/孤儿进程 |
| 导出 | **PASS** | 源码 JSON 603,850 B；独立 HTML 49,379 B、离线可读、右侧文档 3,245 字符 / 4 表格 / 字面 `<br>`=**0**；文档 MD 9,118 B 与磁盘逐字节一致；PNG/PDF 原生对话框均取消且 0 落盘；空文档/无源提示正确 |
| 快照 | **PASS** | 恢复成功 toast「已恢复快照。20260924-104632」；`首页.html` sha256=`2D72B71839FC` 等于快照；生成 `undo-20261113-191306`（含首页.html）；列表仍 2 条 |
| 阻断项 | **无** | P0=0、P1=0；唯一 P2 为 ACP 权限 Select 靠近 Dialog 底部时下拉项被底栏遮挡（鼠标只能点第一项） |

## 2. 环境、数据隔离与运行方式

- 数据目录（两域独立）：
  - 设置：`D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-settings`
  - Git / 导出：`D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-git-export`
  - 启动后均断言 `app.getPath('userData')` 精确等于对应目录（`app.isPackaged=false`）；跑完已删除。
- seed：`node e2e/wave4/seed.mjs --domain b-settings --force`、`node e2e/wave4/seed.mjs --domain b-git-export --force`（模板 `%TEMP%\pland-wave4\seed`）。
- Git：`PLAND_GIT_ALLOW_LOCAL=1` + `file:///C:/temp/pland-wave4-b-git-export-<ts>.git` 本地 bare；假 token `dummy-local-token`；**未访问任何真实 Git 远端**。
- 截图统一写入 `docs/wave4/shots/retest-b-settings-git-export/`（`settings-*` 36 张、`git-export-*` 54 张，共 90 张）。
- 实际命令：

```powershell
node e2e/wave4/seed.mjs --domain b-settings --force
npx playwright test e2e/wave4-b-settings.spec.ts --workers=1 --reporter=list `
  --output=%TEMP%\pland-wave4\pw-retest-b-settings-final

node e2e/wave4/seed.mjs --domain b-git-export --force
npx playwright test e2e/wave4-b-git-export.spec.ts -g "B1 Git" --workers=1 --reporter=list `
  --output=%TEMP%\pland-wave4\pw-retest-b-git

node e2e/wave4/seed.mjs --domain b-git-export --force
npx playwright test e2e/wave4-b-git-export.spec.ts -g "B2/B3" --workers=1 --reporter=list `
  --output=%TEMP%\pland-wave4\pw-retest-b-ge-standalone-final
```

| 运行 | 结果 | 耗时 |
| --- | --- | --- |
| 设置全量 | **1 passed** | 50.4s（总 51.0s） |
| Git B1（本地 bare 全链路） | **1 passed** | 50.7s |
| 导出 + 浮层 B2/B3 | **1 passed** | 32.5s |

> 运行口径：B1 与 B2/B3 各自从新鲜 seed 单独运行。B1→B2 同数据目录连续跑时，B2 在 1024→1440 窗口恢复后渲染进程无响应（详见 §7 `ENV-2`）；按历史报告口径分次运行，两次均通过。

## 3. 设置域逐项结果

| # | 复测项 | 结果 | 实测 |
| --- | --- | --- | --- |
| S1 | 设置入口改为侧栏底部「打开设置」 | PASS | `sidebar` 底部按钮 `aria-label="打开设置"`、`title="系统设置（Agent）"` 可见；顶栏已无「设置」按钮；点击后 780×580 Dialog 打开 |
| S2 | 设置外框 / 6 Tab / 关闭 / Esc | PASS | Dialog `779.996×579.996`；Tab=Agent 设置 / 模型管理 / 设计规范 / 沙箱存储 / 快捷键 / 关于软件；footer「关闭」与 Esc 均隐藏 |
| S3 | 设置 Dialog 焦点陷阱 | PASS | 打开后焦点在首个 Tab；`Shift+Tab` 回绕到 Dialog 内「关闭」按钮（`inDialog=true`）；再 `Tab` 回到「Agent 设置」；Esc 关闭后焦点回到侧栏「打开设置」 |
| S4 | Agent 卡片网格 2 列 / 1 列 | PASS | 780 Dialog 下 `agent-card-grid` 宽 514.8px、`gridTemplateColumns` 2 列；视口 720 时容器 423.0px、降为 1 列；恢复 1440 后回到 2 列 |
| S5 | ACP 单徽章 | PASS | 26 个真实 Agent；20 个 `transport=acp` 行逐行检查，每行恰好一个文本 `ACP` 徽章（`badgeIssues=[]`）；无 DEFAULT/假数据 |
| S6 | Select 鼠标点击选项生效 | PASS | 真实鼠标 `mousedown→70ms→mouseup` 点「全部批准」后，`acp.defaultPermissionMode` 从 `approve-reads` 落盘为 `approve-all`，toast「已保存权限模式」，`optionClickLost=false`；API 协议用同样鼠标点 Anthropic / OpenAI 均生效 |
| S7 | P2：ACP 权限下拉靠近底部被遮挡 | **P2** | ACP 卡靠近 Dialog 底部时，下拉第二、三项中心 `elementFromPoint` 命中 `footer` / `dialog-overlay`，鼠标只能点第一项。详见 §5 `RETEST-B-SET-P2-1` |
| S8 | 重新探测 | PASS | 按钮「探测中…」→「重新探测」；行数保持 26；`settings-error`=0；「探测完成」出现 |
| S9 | API Profile / 测试连通性 / 保存并应用 | PASS | 协议 5 项、Base URL、Key 显隐、32px 高度；空 Key + `127.0.0.1:9` 返回「网络连接失败: fetch failed」（37–45ms）；草稿 Esc 不误保存；「保存并应用」toast 后重开回读 |
| S10 | 模型：菜单仅已选 / 获取模型 / 搜索 / 全选反选 / 自定义 ID | PASS | 模型目录 17；已选 `hy4free`、`deepseek-v4.1-flash`；搜索 `deepseek` 命中 2、勾选不变；全选 17→反选 0→恢复 2；自定义模型取消后回 17 |
| S11 | 切模型持久化 / 移除当前模型回落 | PASS | 切 `hy4free` 后 `localStorage.ai_model=hy4free`，reload 仍选中；移除当前模型后回 `deepseek-v4.1-flash` |
| S12 | 无模型空态发送拦截 | PASS | 设置页「已选 0 / 共 0」＋「模型目录为空」；AI 模型列「暂无模型」；发送按钮 `disabled=true`，提示「暂无可用模型：请先在 设置 › 模型 中启用至少一个模型」 |
| S13 | 设计规范 / UI 库 / 沙箱 / 快捷键 / 关于 | PASS | 基线 spec 2 / uilib 3；新建、导入 md、项目绑定生成 `design-spec.md`、解绑移除；新增 UI 库并绑定；沙箱根等于 `…\.devdata-wave4-b-settings\sandbox`；快捷键 3 行；版本 `v1.2.0` 与主进程一致 |
| S14 | 1024 设置布局 | PASS | Dialog `780×580` @ x=122；`documentElement.scrollWidth=1024=clientWidth`；Dialog 内横向溢出元素 0 |
| S15 | Select Esc 只关自身 | PASS | 设计规范项目绑定 Select 打开后 Esc：下拉关闭、设置 Dialog 仍可见、焦点回到 trigger；再 Esc 才关设置 |
| S16 | 1024 AI 模型 Popover 双列可见 | PASS | Popover `x=524, right=971.998, width=448, height=94.2`，`top=525, bottom=619.2` 全部在 1024×768 内；两列 `gridTemplateColumns=286.246px 159.999px`；模型列 285.4px / 思考列 160.0px，均可见；模型 2 项、思考 1 项 |
| S17 | Popover Esc 只关自身 | PASS | Esc 后 `ai-model-option=0`、`ai-dialog` 仍可见；再 Esc 才关 AI Dialog |

## 4. Git / 导出逐项结果

### 4.1 Git

| # | 复测项 | 结果 | 实测 |
| --- | --- | --- | --- |
| G1 | 660px Git 面板 / 状态树 | PASS | `git-sheet[data-surface=dialog]` 宽 660；分支 main；23 处变更 / 15 文件行 / 4 项目卡 / 4 原型组 |
| G2 | 状态筛选无结果空态 | PASS | 冲突筛选：0 文件行、**0 项目卡**、`git-empty` 可见且文案「没有匹配的变更。」 |
| G3 | 搜索无结果空态 | PASS | 搜索不存在字符串：0 文件行、0 项目卡、同一空态；清空后恢复 15 行 |
| G4 | 仓库设置保存/回显/测试连接 | PASS | toast「Git 仓库配置已保存。」；remoteUrl=`file:///C:/temp/…git`、branch=main；token 显示「已配置 ****oken」、明文框为空；测试连接「连接成功 · 136–182ms」；分支 main/master |
| G5 | Git 设置 Esc 只关自身 | PASS | 仓库设置 Dialog 打开时 Esc：config hidden=true、`git-sheet` 仍可见、焦点回到「仓库设置」；第 2 次 Esc 才关 Git；单独 Git 面板 Esc 可关 |
| G6 | push 到本地 bare | PASS | 勾选 15/15；toast「发布成功」；bare log 含 `wave4 b-git-export push <stamp>`；sandbox HEAD = bare `refs/heads/main`；`branch.main.remote=origin`、`merge=refs/heads/main`、`@{u}=origin/main` |
| G7 | pull 同步 | PASS | 另一 clone 追加探针；Confirm「拉取同步…」；toast「同步完成」；`wave4-b-ge-pull-probe.md` 落盘含 stamp；HEAD=`origin/main`；ahead/behind=`0 0` |
| G8 | 自愈取消 / 慢操作取消 / 进程健康 | PASS | 自愈 Confirm 取消无 `.heal-backup`、`.git/config` hash 不变；pull 取消 toast「已取消 pull 操作。」，重试成功；`git fsck` exit 0；凭据进程新增 0；关闭后无 git/conhost 子进程；Git 外部请求 0 |
| G9 | 快照恢复（EPERM 修复） | PASS | 2 版本列表/筛选正常；恢复 Confirm；toast「已恢复快照。20260924-104632」；恢复后 `首页.html` sha256=`2D72B71839FC` 等于快照文件；生成 `undo-20261113-191306` 且含 `首页.html`；列表仍 2 条 |

### 4.2 导出

| # | 复测项 | 结果 | 实测 |
| --- | --- | --- | --- |
| E1 | 导出菜单 5 项 + Esc | PASS | 源码 JSON / 独立 HTML / PNG / PDF / Markdown 全可见；Esc 后菜单隐藏 |
| E2 | 源码 JSON | PASS | `测试1[源码].json` 603,850 B；`JSON.parse` OK；`project=测试1`；sources=4；首页 `content`/`md` 与磁盘逐字符一致 |
| E3 | 独立 HTML：无字面 `<br>`、右侧非空 | PASS | `首页[导出].html` 49,379 B；离线打开 `__EXPORT_BOOT__=true`；styleSheets=1；右侧 `#docContent` 正文 **3,245** 字符、表格 **4**、字面 `<br>` **0**、`display=block`、宽 480px（iframe right=718，doc x=734）；外链脚本 0；React=false |
| E4 | 文档 Markdown | PASS | `首页 · 功能说明.md` 9,118 B；与磁盘 `首页.md` 逐字节一致；正文 3,780 字符 |
| E5 | PNG / PDF 取消 | PASS | `dialog.showSaveDialog` 调用 2 次（PNG、PDF）均 `canceled`；导出目录 PNG/PDF 0 文件；按钮恢复可用 |
| E6 | 空文档 / 无源项目 | PASS | 空 `首页.md` + reload → MD 导出 toast「当前文档为空，无需导出。」、0 落盘；空项目 `stage data-has-source=0`，源码 toast「当前没有可导出的原型。」，HTML toast「请先选择要导出的原型。」 |
| E7 | 浮层回归 | PASS | 检查器三板块；标注 2→3→2；链接 2→3→2；待提交 2 条 reload 持久化、移除/清空确认；Sheet+Confirm 两次 Esc 单层；1024 布局不横向溢出 |

## 5. 缺陷分级

### P0 / P1

**无。** 本轮所有指定阻断项通过。

### P2

| ID | 现象 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| `RETEST-B-SET-P2-1` | ACP 权限 Select 靠近设置 Dialog 底部时，下拉浮层向下展开并被 Dialog 底栏/遮罩裁切：只有第一项「全部批准」可鼠标点击，第二项命中 `FOOTER`、第三项命中 `dialog-overlay` | 用户无法用鼠标选择「仅批准读取 / 全部拒绝」；本次恢复该项改用程序化 click 完成 | `settings-05-acp-permission-occluded.png`；`elementFromPoint` 记录见测试日志 `select-restore` | 下拉向上翻转 / portal 到 body + 碰撞钳制 / 限制高度并内部滚动；同时复核 API 协议 Select 在底部卡片时的表现 |

### P3 / 观察

| ID | 现象 | 备注 |
| --- | --- | --- |
| `b-ge-P3-diff-default-collapsed` | 差异预览只展开当前项目；差异都在非当前项目时首屏只有折叠卡 | 展开后可见文件行；沿用上一轮结论 |
| `b-ge-P3-snapshot-delete` | 快照面板仍无「删除快照」入口 | 只有列表/筛选/刷新/恢复；口径待确认 |

### ENV / 测试运维

| ID | 现象 | 处理 |
| --- | --- | --- |
| `ENV-1` | seed 原型自带 `cdn.jsdelivr.net/npm/vant@4/lib/index.css` CSP 拒绝与 iframe `Unexpected token '.'` | 与设置/Git/导出逻辑无关；过滤后致命 console=0、crash=0 |
| `ENV-2` | 同文件顺序执行 B1→B2（同数据目录）时，B2 在 1024→1440 窗口恢复后 `stage-frame` 消失、渲染进程无响应，`ctx.close` 需强制 kill；B2 独立 seed 运行连续 2 次均通过，B1 单跑/全跑均通过 | 判定为测试顺序/数据复用或窗口 resize 路径的环境问题，未计入产品 P1；建议 B1/B2 分次运行或每个测试前重新 seed，并单独立项排查该状态下的渲染挂起 |

## 6. 旧缺陷回归核对

| 旧 ID | 旧结论 | 本轮 |
| --- | --- | --- |
| `B-SET-P1-1` | dist 落后于 src（缺 `ai-model-popover`） | **FIXED**：dist 18:35 重建；bundle 含 `ai-model-popover`；`dist/renderer/index.html` mtime ≥ `ModelSelector.tsx` |
| `B-SET-P1-2` | 自研 Select 真实鼠标点击选项不生效 | **FIXED**：ACP 权限与 API 协议均用真实鼠标点击成功 |
| `B-SET-P2-1` | 设置 Dialog 无焦点陷阱 | **FIXED**：首尾 Tab 循环、关闭归还入口焦点 |
| `B-SET-P2-2` | 无模型仍可发送 | **FIXED**：发送按钮禁用 + 原因提示 |
| `B-SET-P2-3` | Select Esc 连带关闭设置 | **FIXED**：只关下拉，设置保持 |
| `B-SET-P2-4` | Popover Esc 连带关闭 AI Dialog | **FIXED**：只关 Popover |
| `B-SET-P2-5` | 1024 Popover 右侧裁切 | **FIXED**：right=`971.998` ≤ 1024，双列完整 |
| `b-ge-P1-snapshot-restore` | 快照恢复 EPERM | **FIXED**：恢复成功、hash 匹配、undo 备份生成 |
| `b-ge-P2-status-empty` | 筛选空结果仍渲染空项目卡 | **FIXED**：0 项目卡 + 「没有匹配的变更」 |
| `b-ge-P2-esc-nested-git` | Git 设置 Esc 一次关两层 | **FIXED**：config 只关自身，Git 面板保留 |
| `b-ge-P2-html-br` | 独立 HTML 文档区字面 `<br>` | **FIXED**：字面 `<br>`=0，右侧正文 3,245 字符 |

## 7. 证据索引（`docs/wave4/shots/retest-b-settings-git-export/`）

| 主题 | 截图 |
| --- | --- |
| 设置入口/加载/焦点 | `settings-01-settings-loading.png`、`settings-02-agent-tab.png`、`settings-03-focus-trap.png` |
| Agent 2 列 / 1 列 / ACP | `settings-04-agent-rows-acp.png`、`settings-04-agent-grid-2col.png`、`settings-04-agent-grid-1col.png` |
| ACP 权限（成功 / 遮挡） | `settings-05-acp-permission.png`、`settings-05-acp-permission-occluded.png` |
| API / 模型 / 设计规范 | `settings-06-api-profile.png`、`settings-07-api-test-error.png`、`settings-08-api-apply-toast.png`、`settings-09`–`17`、`settings-18`–`22` |
| 1024 设置 / Select Esc / Popover | `settings-30-1024-settings.png`、`settings-31-select-esc-only.png`、`settings-32-1024-ai-popover.png`、`settings-32-1024-popover-esc-only.png` |
| Git 状态筛选空态 | `git-export-b1-02-status-filter.png`、`git-export-b1-02-status-conflict-empty.png`、`git-export-b1-02-search-empty.png` |
| Git 配置/连接 | `git-export-b1-03-config-filled.png`、`git-export-b1-03-config-echo.png`、`git-export-b1-03-test-connection-ok.png` |
| push / pull / 取消 | `git-export-b1-04-push-selected.png`、`git-export-b1-04-push-success.png`、`git-export-b1-06-pull-confirm.png`、`git-export-b1-06-pull-success.png`、`git-export-b1-08-cancel-operation.png` |
| Git Esc 单层 | `git-export-b1-09-git-config-before-esc.png`、`git-export-b1-09-git-after-esc.png` |
| 导出 HTML / MD / 原生取消 | `git-export-b2-03-html-offline.png`、`git-export-b2-04-md-result.png`、`git-export-b2-05-native-cancel.png` |
| 快照恢复 | `git-export-b2-12-snapshot-list.png`、`git-export-b2-12-snapshot-restore-confirm.png`、`git-export-b2-12-snapshot-restored.png` |

## 8. 清理与边界

- 已删除 `.devdata-wave4-b-settings`、`.devdata-wave4-b-git-export`、`C:\temp\pland-wave4-b-git-export-*.git`、`*-clone`、`%TEMP%\pland-wave4\exports\b-git-export-*`；杀掉/确认无 Electron、git 残留进程。
- 未修改 `src/**`、`main/**`、`js/**`、`tests/**`、`package.json`；未执行 `npm install`、未 build、未 commit。
- 本轮只修改/新增：`e2e/wave4-b-settings.spec.ts`、`e2e/wave4-b-git-export.spec.ts`、本报告、`docs/wave4/shots/retest-b-settings-git-export/*.png`。
- 未保存任何真实 API Key（`ai-credentials.json` entries=0）；未访问真实 Git 远端；PNG/PDF 仅模拟取消。
- 截图通过测试内 shot 拦截写入指定复测目录；数据目录仍按两域独立（settings / git-export），互不共享。

## 9. 结论与建议

- 设置、Git、导出的指定复测项全部 PASS，P0/P1 清零，可进入下一阶段。
- 唯一 P2 是设置底部 ACP 权限下拉被 Dialog 底栏遮挡，属于可用但影响选择效率的问题，建议后续把 Select 浮层改为 portal + 上下翻转/碰撞钳制。
- 建议把 B1/B2 固定为分次 seed 运行（或每个测试独立数据目录），避免 `ENV-2` 的渲染挂起干扰结果；若要合并跑，建议先定位 1024→1440 resize 后的无响应。
