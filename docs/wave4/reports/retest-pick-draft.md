# Wave4 复测 · 需求草稿「继续 Ctrl 多选不清空」E2E 报告

- 日期：2026-11-16
- 阶段：Ctrl 拾取域补测（需求草稿生命周期）
- 代码版本：仓库 HEAD `77192ddb2115`（2026-09-30）；两个 spec 在本次复测中为工作区文件（未 commit）
- 构建：`npm run build:renderer` PASS（Vite 8.3.8，built in 344ms）
- seed（独立域）：
  - `node e2e/wave4/seed.mjs --domain b-pick --force` → create `.devdata-wave4-b-pick`
  - `node e2e/wave4/seed.mjs --domain pick --force` → replace `.devdata-wave4-pick`
- 运行命令：
  - `npx playwright test e2e/wave4-b-pick.spec.ts e2e/wave4-pick.spec.ts --workers=1`
- 结果：**2 passed / 0 failed（2.4m；b-pick 26.3s / pick 2.0m）**；`window-close` exit 0；`b-pick` 域目录已由 afterAll 删除
- 写入范围：仅本报告、`docs/wave4/shots/retest-pick-draft/*`、两个 spec；未改 `src/main/tests/package.json`，未 `npm install`，未 commit

## 0. 结论

`需求草稿在继续 Ctrl 多选时不被清空` 的双机（PC 舞台 / 移动端舞台）E2E 均 PASS：

- Ctrl 按住再点第二个元素期间，`pick-composer` **不卸载、不隐藏、不闪断**，草稿保持「保留我」，chips=2，选择计数=2；
- 松开 Ctrl 后仍是同一条输入条，焦点回到需求输入框，继续键入得到「保留我，继续」；
- 取消 / 提交 / 工具栏清空选择 / 切源后，草稿均清空；再次拾取输入框为空；
- 原有普通点击不弹、Ctrl+Shift 修改直写 HTML、chips 批量提交、选中框同步、Sheet 焦点、待提交编辑/清空等断言全部保留并通过。

## 1. 新增断言

### 1.1 `e2e/wave4-b-pick.spec.ts`（PC 舞台，步骤 8）

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | Ctrl 首次拾取后输入「保留我」；按住 Ctrl 未点击前 composer 可见、chips=1、value=`保留我` | PASS |
| 2 | 在 **Ctrl 仍按住**时选第二个元素：composer 可见、chips=2、选中计数=2、value=`保留我` | PASS |
| 3 | DOM 探针：`pick-composer` 节点未被移除（MutationObserver `removedNodes`）、40ms 采样无缺失/隐藏、草稿值无漂移、dataset 标记证明同一节点未重建 | PASS：samples=23，detached=0，missing=0，hidden=0，valueDrift=0，sameNode=true |
| 4 | 松开 Ctrl：composer 可见、chips=2、value=`保留我`、`pick-composer-input` 获得焦点 | PASS |
| 5 | 继续键入「，继续」→ value=`保留我，继续` | PASS |
| 6 | 取消 → composer 隐藏、选中计数消失；重新拾取 value=`''` | PASS |
| 7 | 提交 → 队列 0→1 且 text=`提交后草稿清空`；重新拾取 value=`''` | PASS |
| 8 | 用待提交 Sheet「清空 + Confirm」移除本步条目，队列回到 0 | PASS |
| 9 | 工具栏清空选择 → composer 隐藏；重新拾取 value=`''` | PASS |
| 10 | 切源到「大厅」→ composer 隐藏、选中计数消失；切回「首页」重新拾取 value=`''` | PASS |
| 11 | 草稿步骤不改数据：`首页.html` hash 仍等于步骤 4「保存到代码」后的 hash；annotations 3、links 2 不变；queue=`[]` | PASS |
| 12 | 切到「大厅」期间只允许 seed 原型内容噪声（Vant CDN CSP）；切回后致命 console/pageerror/crash=0 | PASS |

### 1.2 `e2e/wave4-pick.spec.ts`（移动端舞台，步骤 8）

同一组 1–12 断言，元素为 `p.product-name` nth 0 / nth 1，附加：

- 探针：samples=363，detached=0，missing=0，hidden=0，valueDrift=0，sameNode=true；
- 切回「首页」后的拾取/取消：新增致命 console/pageerror=0，crash=0；
- 最终 `首页.html` hash 仍等于步骤 2 写入后的 hash，annotations=1、links=3、queue=`[]`。

### 1.3 探针口径（防「短暂消失」）

在 composer 上打 `data-draft-probe="keep"`，同时安装：

1. `MutationObserver(document.body, {childList, subtree})`：任何 removedNodes 命中 composer 自身或其祖先，即记 `detached+1`（即使当帧重新挂载也能捕获）；
2. 40ms 采样：节点不存在记 `missingSamples`；`getBoundingClientRect()` 为 0 或 display/visibility 隐藏记 `hiddenSamples`；输入框 value ≠「保留我」记 `valueDrift`；
3. 手势结束后读回 dataset，确认仍是同一 DOM 节点。

## 2. 保留的原有断言

- 普通点击 / 无修饰键帧桥拾取：不弹 composer、不弹修改框、不写队列；
- Ctrl+Shift：单选替换、按住期间不弹窗、松开只出现一个 `pick-modify-dialog`；取消不写 HTML/队列，保存直接改写源 HTML（本步后 hash 已变化并作为草稿步骤基线）；
- Ctrl 按住连点 3 个：期间不弹窗，松开 chips=3，提交为 1 条 `batch:` 待提交（batchParts=3）；
- 待提交 Sheet：条目就地编辑、空值还原、底栏固定不随滚动、移除/清空经 Confirm、`edit_queue_v1="[]"`；
- 标注：新增 / 定位高亮 / 面板内直编保存 / 删除 Confirm（取消）；
- 选中框随 iframe 滚动与 75% / 125% 缩放同步（最大偏差约 0.006px）；
- Sheet 焦点陷阱（Tab×10、Shift+Tab×3）与 Esc 焦点回归；底部无常驻 `multi-edit-bar`。

> `e2e/wave4-pick.spec.ts` 步骤 6 末尾新增「清空后 Esc 关闭待提交 Sheet」：原 spec 清空队列后把 Sheet 留在打开状态，遮罩会拦截步骤 8 的舞台拾取。该改动只做收尾清理，不修改任何既有断言。
>
> `e2e/wave4-pick.spec.ts` 的 `pickWithCtrl` 在按下 Ctrl 前先把焦点送进 iframe（与 `wave4-b-pick.spec.ts` 同口径）：偶发父窗焦点丢失会让 PICK_RESULT 只选中、不弹需求条；该改动只提高测试确定性，不改变断言与产品代码。

## 3. 关键证据与截图

- b-pick（PC）：`docs/wave4/shots/retest-pick-draft/b-00` … `b-06`
  - `b-01-ctrl-held-second-picked.png`：Ctrl 按住、chips=2、草稿「保留我」、舞台显示「拾取中」
  - `b-02-released-draft-kept.png`：松开 Ctrl 后同一条输入条与草稿
  - `b-03-typed-continued.png`：追加为「保留我，继续」
  - `b-04-cleared-draft-empty.png`：清空选择后重新拾取，输入框为空
  - `b-05-source-switched-hall.png` / `b-06-source-back-draft-empty.png`：切源与切回
- pick（移动端）：`docs/wave4/shots/retest-pick-draft/a-00` … `a-06`，覆盖同一组状态。
- 切源时的噪声仅为 seed「大厅」自带 Vant CDN 被 CSP 拦截（`cdn.jsdelivr.net/npm/vant`）及 `Unexpected token '.'`，属原型内容，不计产品致命错误。

## 4. 备注

- 仅改 E2E 与文档；未改产品代码、`src/main/tests/package.json`、未安装依赖、未 commit。
- 首轮运行暴露的是测试自身问题（探针在手动键入后才读取，把手动输入计为草稿漂移；移动端 spec 的待提交 Sheet 未关闭导致拾取被遮罩拦截；移动端 `pickWithCtrl` 偶发父窗失焦导致只选中不弹条），已分别修正为「先读探针再键入」「步骤 6 末尾关闭 Sheet」「Ctrl 前把焦点送进 iframe」，随后连续两轮均 2/2 PASS。
