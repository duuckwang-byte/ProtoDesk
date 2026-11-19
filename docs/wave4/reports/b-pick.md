# Wave4 B 全量体验 · Ctrl 拾取 / 就地编辑 / 多选 报告

- 日期：2026-11-13
- Agent / owner：B 全量体验子代理（DeepSeek V4.1 Flash 1017）
- 阶段：B 全量体验
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`（工作区含未提交改动，未 commit）
- 构建：`dist/renderer` 构建时间 2026-11-13 15:36:43；`index.html` 1,261 B / SHA256 前 12 位 `AA42E6DCAF5B`；主 chunk `assets/index-DwF5s1C0.js` 345,696 B / SHA256 前 12 位 `66F9C4748D65`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0；真实 inner viewport 1123×640（Electron 页面缩放使 CSS 2px 边框实测为 1.754px）
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-b-pick`；实际 `app.getPath('userData')` 精确相同
- seed：`_wave4-seed.json` present；manifest SHA256 前 12 位 `B2EAD1DA85A9`；源指纹前 12 位 `17ad3a89355d`；源项目 `测试1`（`首页` / `我的`）
- 运行命令：
  `node e2e/wave4/seed.mjs --domain b-pick`
  `npx playwright test e2e/wave4-b-pick.spec.ts --workers=1 --output=test-results/wave4/b-pick`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=无

## 0. 结论先行

**可放行（B 体验）；建议外发前修 P2-1（选中框漂移）。** P0=0，P1=0，P2=3（5 个症状合并为 3 个根因），P3=4（含 1 项 N/A：无复制 selector），ENV=1。

- Ctrl 悬停/点选、可见框与角标、selector、就地改（替换/插入/Esc/空/超长）、多选 3 元素与批量/逐项、检查器三板块、标注增改删与显隐、链接新增/预览跳转/删除、待提交跨 reload 与跨进程重启持久化、Esc 单层关闭与焦点回归全部通过。
- A 阶段两条观察已修复：悬停框/选中框现在有可见虚线/实线与填充；待提交条 Confirm 已 portal 到 body，实测居中且完整可见（`x=369.6, y=254.3, 384×131.7`，视口 1123×640）。
- 仍存在的 P2：① 选中框 rect 在拾取时固化，iframe 滚动/舞台缩放后不跟随（132.9px / 271.7px 偏差）；② Sheet 打开后焦点不进入浮层、Tab 仍停在背景工具栏；③ 已绑定状态「更换目标」是死按钮，仅 toast。
- `首页.html` SHA256 全程不变（`2D72B71839FC`）；annotations 2→3→2、links 2→3→2、queue 最终 `[]`；排除原型内容噪声后致命 console/pageerror/crash=0；进程 `window-close` exit 0。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离 + 进入 `测试1/首页` + 桌面端 + 侧栏展开 | PASS | `userData` 与 `.devdata-wave4-b-pick` 精确一致；项目选择器未弹；`sidebar` `aria-expanded=true`；`stage-frame[data-kind=pc][data-fit=off]`；基线 `首页.html` SHA256 前 12 位 `2D72B71839FC`、annotations=2、links=2、queue=0；截图 `00-entry-sidebar-pc.png` | — |
| 1 | Ctrl 悬停/点选：可见框、角标、selector、复制、滚动/缩放 | PASS（含 P2 观察） | 悬停框：`border-style=dashed`、`border-color=rgb(37,99,235)`、`background=rgba(37,99,235,0.1)`、bbox 与元素换算误差 ≤3px；选中框：`solid`、`rgba(37,99,235,0.14)`；角标「1」蓝底白字；检查器 selector=`[data-pr-id="pr-p-39"]`、`页面: 首页`、`文件: 首页.html`；同元素再点取消→计数 0、overlay 0，重新点选→1；检查器内「复制 selector」按钮 count=0（N/A）。iframe 内滚动 160px 后 hover 框仍 ≤3px 对齐；选中框偏差 132.9px（P2-1）。75% 缩放后 hover 框 ≤3px、读数 75%；选中框偏差 271.7px（P2-1）；125% hover 仍 ≤3px、读数 125%。截图 `01-hover-visible.png`、`01-selected-visual.png`、`01-inspector-selector.png`、`01-scroll-hover.png`、`01-selection-drift-scroll.png`、`01-selection-drift-zoom.png`、`01-zoom-hover.png` | P2-1 |
| 2 | 就地编辑：替换/插入/Enter/Esc/空/超长/撤销 | PASS | 编辑框预填「轻薄透气运动跑鞋 春秋季新款」；纯 Enter 只换行不提交（与 UI「Ctrl+Enter 保存」一致）；Ctrl+Enter 后队列 0→1，文本前缀「将该元素内容改为：」，`ai-dialog`=0。插入模式同 selector upsert，前缀「在该元素之后插入：」，队列仍 1。空/纯空格提交被拦截「请输入要修改的内容。」且编辑框保持打开。1608 字符长文本完整入队（queue 文本 1617 字符，无截断/无上限提示，P3）。Esc→条内二次确认；「继续编辑」保留；再次 Esc→「放弃修改」关闭且队列不变。textarea 原生 Ctrl+Z/Ctrl+Shift+Z 有效（`W4B-undo→W4B-und→W4B-undo`），无产品级撤销/重做按钮（P3）。截图 `02-*.png` 7 张 | — |
| 3 | 多选：3 元素、Ctrl/Ctrl+Shift、批量/逐个、校验、入队 | PASS | Ctrl 点 A、Ctrl+Shift 点 B/C：计数=3、选中框=3、角标 `1/2/3`；Ctrl+Shift 再点 B 移除→2，再加回→3；纯 Ctrl 点新元素替换为单选（计数 1，符合文档语义）。`multi-edit-drawer` 标题「已选中 3 个元素」、3 个 chip；批量空提交拦截「请输入统一修改诉求。」；逐个空提交拦截「请至少为一个元素填写修改诉求。」；逐个只填第 1 项→队列 +1；批量 3 个（避开已入队 selector）→队列 +3 至 5，3 个 selector 互不相同且默认选中；点遮罩取消→抽屉关闭、选择清空。截图 `03-multi-three.png`、`03-multi-validation.png`、`03-multi-individual.png`、`03-multi-queued.png` | — |
| 4 | 检查器：三板块 / 需求增改删 / 跳转 / 标注 | PASS（含 P2/P3 观察） | 选中 `[data-pr-id="pr-p-67"]`；`inspector-sec-req/jump/anno` 均可见。需求空提交拦截；新增入队 +1；输入框保留刚加入的草稿（P3），关闭重开后仍回填；同 selector 再次提交为 upsert（不增条数）；从待提交 Sheet 移除需 Confirm，删除后队列 -1。跳转空目标拦截且 `links.json` 不变；选「我的」保存后 `inspector-jump-state=已绑定`、links 2→3，新条目 `selector=[data-pr-id="pr-p-67"]`、`target=我的`、`htmlFile=首页.html`、`page=""`；「更换目标」点击后无下拉/输入（P2-3）；删除绑定 Confirm 后 links→2，再重加→3。标注空保存拦截；新增后「已标注」、annotations 2→3、角标「3」绿色 `rgb(4,120,87)`。截图 `04-inspector-req.png`、`04-inspector-jump.png`、`04-inspector-jump-change.png`、`04-inspector-anno.png` | P2-3 / P3 |
| 5 | 标注：新增/定位/颜色编号/显隐/编辑/删除 Confirm | PASS | 面板计数 3、3 个条目；新增项编号「3」、绿色 `rgb(4,120,87)`；关闭显隐开关→角标 0、`proto_anno_visible=0`；再开→角标 1、值 `1`。点击条目定位→检查器「已标注」并回显内容；改内容保存后 annotations 条数不变、文件内容已更新。第二元素新增标注→4，检查器删除经 Confirm→3；面板删除第一元素标注经 Confirm→2（回到 seed）。截图 `05-anno-panel.png`、`05-anno-hidden.png`、`05-anno-locate.png`、`05-anno-delete-confirm.png` | — |
| 6 | 链接：新增 / 预览跳转 / 删除 Confirm | PASS | 复用步骤 4 在 `pr-p-67` 的绑定；链接面板 3 条，新条目含「我的」。点「预览跳转」→面板关闭、`loc-pill` 切换为「我的」、iframe 保持渲染；回「首页」后面板仍 3 条；删除新绑定经 Confirm→links 3→2（回到 seed），面板 2 条。截图 `06-links-panel.png`、`06-link-jump-target.png`、`06-link-delete-confirm.png` | — |
| 7 | 待提交：跨进程持久化 / 勾选 / 提交提示 / 移除 / 清空 | PASS | 重启前 queue=5（1 就地改 + 1 逐项 + 3 批量）。关闭应用（`window-close` exit 0）后重新拉起：条计数仍 5，queue 文本与顺序逐一相同。取消第一条勾选→提交按钮「提交（4）」；点提交 toast「待提交已就绪：4 条」+「本轮不直调大模型；请在 AI 对话中发起修改。」，queue 仍 5、`ai-dialog`=0。reload 后仍「提交（4）」、`selected=false` 持久化。条内移除→4，Confirm 居中完整可见（`x=369.6,y=254.3,384×131.7`，视口 1123×640）；Sheet 再移除→3；清空→条消失、`edit_queue_v1="[]"`、Sheet 空态「待提交队列为空」。截图 `07-queue-persist-restart.png`、`07-queue-submit-toast.png`、`07-queue-remove-confirm.png`、`07-queue-clear-confirm.png`、`07-queue-cleared.png` | — |
| 8 | 键盘无障碍：toolbar / Tab / Enter / 焦点 / Esc 单层 | PASS（含 P2 观察） | `overlays-toolbar role=toolbar`，8 个按钮全部有可访问名、`tabIndex=0`；连续 5 次 Tab 均停留在 toolbar。聚焦「检查器」按 Enter 可打开 Sheet；但打开后 `activeElement` 仍是触发按钮（P2-2），再 Tab 落到背景「多选」按钮（P2-2，无焦点陷阱）。Esc 关闭 Sheet 后选择保留（计数 1）、焦点回归「检查器」触发按钮。打开队列 Sheet→点清空→Confirm 可见；第 1 次 Esc 只关 Confirm，待提交条与 queue 均保留；第 2 次 Esc 只关 Sheet，条仍在。截图 `08-keyboard-toolbar.png`、`08-keyboard-sheet-focus.png`、`08-keyboard-sheet-closed.png`、`08-esc-confirm-only.png`、`08-esc-sheet-only.png` | P2-2 |
| 9 | 数据完整性 / console / 退出 | PASS | `首页.html` SHA256 前 12 位仍 `2D72B71839FC`；annotations=2、links=2、queue=[]。原始 console 6 条均为 seed 原型内容噪声（4 条 Vant CDN CSP + 2 条 `pageerror: Unexpected token '.'`，来自大厅/我的，非首页拾取链路），标 ENV；排除后致命项=0。测试 1 passed / 35.4s；`window-close` exit 0 / 368ms。截图 `09-done.png` | ENV |

> 交互细节：桌面端由顶栏「桌面端舞台」切换并断言 `data-kind=pc`；本次 seed 的 Local Storage 已保存 PC 端别，启动即为 PC，`ensurePcStage` 二次校验。
>
> 元素选择：就地改/多选使用商品名 nth 0–4；检查器/链接/键盘使用 `pr-p-67`（nth 5），第二标注使用 `pr-p-71`（nth 6），避免 enqueue 按 selector 合并造成计数歧义。

## 2. 缺陷（P0 / P1）

**无。P0=0，P1=0。**

- 未发现：Ctrl 悬停无反应、点选 selector 为空、就地改写错元素、多选计数错、检查器/标注/链接保存失败、待提交丢失、原型 HTML 被改写、应用崩溃或进程无法退出。
- `annotations.json` / `links.json` 仅在隔离副本内按预期变化并回到基线；`首页.html` 全程 hash 不变。

## 3. P2 缺陷（按影响 × 频率排序）

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| b-pick-P2-1 | P2 | **选中框 rect 在拾取时固化，不随 iframe 滚动/舞台缩放重算**。hover 框准确，选中框会漂到别的元素上 | 1) 选中商品名；2) iframe 内滚动 160px；3) 观察选中框；4) 重置滚动后切 75% 缩放再观察 | 用户滚动/缩放后看到“选中了错误的元素”，视觉可信度受损；实际编辑/入队仍按原 selector 命中正确元素，有 hover/检查器作为替代确认 | 滚动后最大偏差 **132.9px**；75% 缩放后 **271.7px**；截图 `01-selection-drift-scroll.png`、`01-selection-drift-zoom.png`；hover 同步复测 ≤3px | 在 SCROLL / zoom 变化 / frame resize 时重读选中元素 rect（或按 pick 时 scale 与当前 scale 比例换算）；`PreviewOverlaysHost.selected` 目前只存一次性 rect |
| b-pick-P2-2 | P2 | **Sheet 打开后焦点不进入浮层，且无焦点陷阱**；Tab 继续停留在背景 toolbar | 1) 键盘聚焦「检查器」；2) Enter 打开；3) 读 `activeElement`；4) 按 1 次 Tab | 键盘用户打开浮层后仍在背景操作，容易误触其他按钮；鼠标路径不受影响 | 打开后 `activeElement=BUTTON[data-testid=overlays-open-inspector]`；Tab 后为 `overlays-open-multi`（仍在 toolbar）；截图 `08-keyboard-sheet-focus.png` | Sheet 打开时聚焦第一个可交互元素（关闭按钮/内容），并加 Tab 焦点循环；关闭后已能正确回归触发按钮 |
| b-pick-P2-3 | P2 | **已绑定状态「更换目标」是死按钮**：点击只弹 toast「从下拉选择目标原型…」，页面没有下拉或输入框 | 1) 选中元素并绑定「我的」；2) 点「更换目标」；3) 查找目标下拉/输入 | 想改目标只能先删除绑定再重加（两步且有 Confirm）；按钮承诺与行为不一致 | `inspector-jump-target-pick` / `inspector-jump-target` 均不可见（false/false）；toast 原文见日志；截图 `04-inspector-jump-change.png` | 已绑定态也渲染目标选择器，或让「更换目标」切回未绑定编辑态；不要只 toast |

## 4. 观察区（P3 / ENV）

| ID | 级别 | 现象 | 复现/证据 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- | --- |
| b-pick-OBS-copy | P3（N/A） | 检查器没有「复制 selector」入口 | `inspector` 内 `复制/copy` 按钮 count=0 | 否 | 需求为“若有”，按 N/A 记录；selector 文本可手动选中 |
| b-pick-OBS-longtext | P3 | 就地改/待提交无长度上限 | 1608 字符完整入队，queue 文本 1617 字符，无截断/提示 | 待产品确认 | 若后续接 AI，超长诉求可能超出上下文；建议加软上限/计数 |
| b-pick-OBS-undo | P3 | 无产品级撤销/重做 | toolbar `撤销/重做` 按钮 count=0；textarea 原生 Ctrl+Z/ Ctrl+Shift+Z 有效 | 否 | 提交后的队列变更只能移除/清空，不能撤销 |
| b-pick-OBS-req-draft | P3 | 需求加入后输入框保留草稿 | 点击「加入待提交」后 input value 仍为原文本（draft 回填） | 待确认 | 再次点击会 upsert 同一条，不会重复；可能是刻意保留草稿 |
| b-pick-ENV-prototype-console | ENV | seed 原型内容自带外部 CDN/脚本噪声 | 6 条：4×Vant CDN CSP、2×`pageerror: Unexpected token '.'`；来自大厅/我的原型，非首页拾取链路 | 否 | 与 `postfix-OBS-3` 同源；排除后致命项=0 |

## 5. 截图

目录：`docs/wave4/shots/b-pick/`（41 张，均为最终通过轮次）

| 文件 | 内容 |
| --- | --- |
| [`00-entry-sidebar-pc.png`](../shots/b-pick/00-entry-sidebar-pc.png) | 进入 `测试1/首页`，侧栏展开，桌面端舞台 |
| [`01-hover-visible.png`](../shots/b-pick/01-hover-visible.png) | Ctrl 悬停：蓝色虚线框 + 10% 填充 + 「拾取中」 |
| [`01-selected-visual.png`](../shots/b-pick/01-selected-visual.png) | 点选后：蓝色实线框 + 编号角标 1 |
| [`01-inspector-selector.png`](../shots/b-pick/01-inspector-selector.png) | 检查器 selector / 页面 / 文件徽标与三板块 |
| [`01-scroll-hover.png`](../shots/b-pick/01-scroll-hover.png) | iframe 滚动 160px 后 hover 框仍贴合元素 |
| [`01-selection-drift-scroll.png`](../shots/b-pick/01-selection-drift-scroll.png) | 滚动后选中框漂移（P2-1，132.9px） |
| [`01-selection-drift-zoom.png`](../shots/b-pick/01-selection-drift-zoom.png) | 75% 缩放后选中框漂移（P2-1，271.7px） |
| [`01-zoom-hover.png`](../shots/b-pick/01-zoom-hover.png) | 75% 下 hover 框仍准确 |
| [`02-inline-enter-newline.png`](../shots/b-pick/02-inline-enter-newline.png) | 纯 Enter 只换行、不提交 |
| [`02-inline-open.png`](../shots/b-pick/02-inline-open.png) | 就地改编辑条预填原文 |
| [`02-inline-replace-queued.png`](../shots/b-pick/02-inline-replace-queued.png) | 文本替换 Ctrl+Enter 入队（队列 1） |
| [`02-inline-insert-mode.png`](../shots/b-pick/02-inline-insert-mode.png) | 「插入元素」模式 |
| [`02-inline-empty-blocked.png`](../shots/b-pick/02-inline-empty-blocked.png) | 空内容被拦截，编辑条保持打开 |
| [`02-inline-longtext.png`](../shots/b-pick/02-inline-longtext.png) | 1608 字符长文本入队 |
| [`02-inline-esc-confirm.png`](../shots/b-pick/02-inline-esc-confirm.png) | Esc 条内二次确认「确定放弃本次就地改吗？」 |
| [`03-multi-three.png`](../shots/b-pick/03-multi-three.png) | Ctrl+Shift 选中 3 个元素，角标 1/2/3 |
| [`03-multi-validation.png`](../shots/b-pick/03-multi-validation.png) | 逐个修改空提交校验 |
| [`03-multi-individual.png`](../shots/b-pick/03-multi-individual.png) | 逐个修改填写第 1 项 |
| [`03-multi-queued.png`](../shots/b-pick/03-multi-queued.png) | 批量提交后队列 5 |
| [`04-inspector-req.png`](../shots/b-pick/04-inspector-req.png) | 检查器三板块 + 需求入队 |
| [`04-inspector-jump.png`](../shots/b-pick/04-inspector-jump.png) | 跳转绑定「我的」，状态已绑定 |
| [`04-inspector-jump-change.png`](../shots/b-pick/04-inspector-jump-change.png) | 已绑定态「更换目标」无下拉（P2-3） |
| [`04-inspector-anno.png`](../shots/b-pick/04-inspector-anno.png) | 新增标注、绿色角标 3 |
| [`05-anno-panel.png`](../shots/b-pick/05-anno-panel.png) | 标注面板 3 条，新增项编号/颜色 |
| [`05-anno-hidden.png`](../shots/b-pick/05-anno-hidden.png) | 关闭角标显隐（角标 0） |
| [`05-anno-locate.png`](../shots/b-pick/05-anno-locate.png) | 点条目标注定位到检查器 |
| [`05-anno-delete-confirm.png`](../shots/b-pick/05-anno-delete-confirm.png) | 检查器删除标注 Confirm |
| [`06-links-panel.png`](../shots/b-pick/06-links-panel.png) | 链接面板 3 条（含新增 `pr-p-67 → 我的`） |
| [`06-link-jump-target.png`](../shots/b-pick/06-link-jump-target.png) | 预览跳转后切换到「我的」 |
| [`06-link-delete-confirm.png`](../shots/b-pick/06-link-delete-confirm.png) | 删除跳转绑定 Confirm |
| [`07-queue-persist-restart.png`](../shots/b-pick/07-queue-persist-restart.png) | 关闭应用重启后队列仍 5 条 |
| [`07-queue-submit-toast.png`](../shots/b-pick/07-queue-submit-toast.png) | 提交动作只 toast「待提交已就绪：4 条」 |
| [`07-queue-remove-confirm.png`](../shots/b-pick/07-queue-remove-confirm.png) | 条内移除 Confirm 居中且完整可见（回归 pick-OBS-2） |
| [`07-queue-clear-confirm.png`](../shots/b-pick/07-queue-clear-confirm.png) | 清空 Confirm |
| [`07-queue-cleared.png`](../shots/b-pick/07-queue-cleared.png) | 清空后条消失、Sheet 空态 |
| [`08-keyboard-toolbar.png`](../shots/b-pick/08-keyboard-toolbar.png) | toolbar 8 按钮与 Tab 焦点 |
| [`08-keyboard-sheet-focus.png`](../shots/b-pick/08-keyboard-sheet-focus.png) | Enter 打开检查器（焦点仍在背景，P2-2） |
| [`08-keyboard-sheet-closed.png`](../shots/b-pick/08-keyboard-sheet-closed.png) | Esc 关闭 Sheet，选择保留 |
| [`08-esc-confirm-only.png`](../shots/b-pick/08-esc-confirm-only.png) | 第 1 次 Esc 只关 Confirm，待提交条仍在 |
| [`08-esc-sheet-only.png`](../shots/b-pick/08-esc-sheet-only.png) | 第 2 次 Esc 只关 Sheet |
| [`09-done.png`](../shots/b-pick/09-done.png) | 收尾：queue 清空、页面回到首页 |

关键截图：

![Ctrl 悬停可见框](../shots/b-pick/01-hover-visible.png)

![75% 缩放后选中框漂移](../shots/b-pick/01-selection-drift-zoom.png)

![待提交 Confirm 居中完整可见](../shots/b-pick/07-queue-remove-confirm.png)

## 6. 结论

- 结果：**可放行（B 体验）；建议外发前修 P2-1**
- P0 = 0；P1 = 0；P2 = 3（b-pick-P2-1/2/3）；P3 = 4（含 1 项 N/A）；ENV = 1
- 阻断项：无
- P2 owner / 挂账：P2-1 建议归 `features/preview`（选中 rect 重算）；P2-2 归 `components/ui/sheet`（初始焦点/焦点陷阱）；P2-3 归 `components/overlays/Inspector`（已绑定态更换目标）。三者均有替代路径，不阻断放行。
- 复测范围：`e2e/wave4-b-pick.spec.ts` 单文件单 worker，1 passed / 35.4s；两次 Electron 启动（首次 + 重启验证）均 `window-close` exit 0；`首页.html` hash 不变；排除原型内容噪声后致命 console/pageerror/crash=0。
- 备注：
  - 本构建已修复 A 阶段 pick-OBS-1（悬停/选中框无样式）与 pick-OBS-2（待提交 Confirm 被底部条裁切）；本轮以计算样式和 bbox 复核。
  - 就地改按设计只入待提交队列，不直写 `首页.html`；本轮继续以 HTML hash 不变作为数据安全证据。
  - 本轮未修改 `src/**`、`main/**`、`tests/**`、`package.json`，未 commit；只新增 `e2e/wave4-b-pick.spec.ts`、本报告与 `docs/wave4/shots/b-pick/**`。
  - 复跑前执行 `node e2e/wave4/seed.mjs --domain b-pick`；本轮结束后已清理 `.devdata-wave4-b-pick`。
