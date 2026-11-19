# Wave4 · 模型管理主清单「只显示已选」复测报告

- 日期：2026-11-16
- Agent / owner：模型管理主清单复测子 agent（DeepSeek V4.1 Flash 1017）
- 范围：`ModelManager` 主清单只显示已选模型、移除主清单全选/反选；「获取模型」弹窗仍显示全量并保持勾选；搜索只在已选集合内过滤
- 改动边界：只改 `e2e/wave4-settings.spec.ts`、`e2e/wave4-b-settings.spec.ts` 与本报告/截图；未改 `src/`、`main/`、`tests/`、`package.json`；未执行 `npm install`；未 commit
- 构建：`npm run build:renderer` @ 2026-11-16 14:48（`dist/renderer/assets/index-BCE39k8Z.js`，SHA256 前 12 位 `AB4D2A547256`）
- 环境：Windows / Node `v24.15.0` / Electron `37.10.3` / Playwright `1.65.0`
- 数据目录：`.devdata-wave4-settings`、`.devdata-wave4-b-settings`（先执行 `node e2e/wave4/seed.mjs --domain settings,b-settings --force`）
- 运行命令：

```powershell
npx tsc --noEmit
npx playwright test e2e/wave4-settings.spec.ts e2e/wave4-b-settings.spec.ts --workers=1 --output=%TEMP%\opencode\pw-model-list
```

## 0. 结论

**PASS。** `npx tsc --noEmit` 无输出（exit 0）；2 个 spec 共 **2/2 通过，0 failed**（1.4m）。

- 主清单只渲染已选模型：A1 实测「已选 2 / 共 410 个 · 显示 2 个」，DOM 仅 2 行且全部 checked；B 实测「已选 2 / 共 417 个 · 显示 2 个」，同样仅 2 行。
- 主清单不再提供「全选 / 反选」：两域均有 `toHaveCount(0)` 硬断言，批量只在「获取模型」弹窗内。
- 获取模型弹窗仍为全量目录并保持已选：A1 弹窗 410 行 / 已选 2，B 弹窗 417 行 / 已选 2；行数 = 弹窗计数 = 目录总数。
- 弹窗内「全选 / 取消全选」只作用当前显示项，主清单随之增加/回退；取消勾选后主清单立即移除该行，关闭重开仍不出现，只能从弹窗补回。
- 搜索只在已选集合内过滤：搜索未选 ID → 显示 0 + 「已选模型无匹配」，主清单 0 行且已选计数不变；搜索命中部分已选 → 显示数收缩为命中数。
- 其他设置 / Agent / API / 设计规范 / 沙箱 / 快捷键 / 关于 / 空态 / 1024 断言全部保留，未放宽。

## 1. 过期契约与 E2E 同步

| # | 旧断言（已过期） | 新契约断言 | 覆盖位置 |
| --- | --- | --- | --- |
| 1 | 主清单渲染全量目录，行数 = 目录总数 | 主清单只渲染已选，行数 = `已选` = `显示`，不存在未选行 | A1 step 4.1；B step 4 基线 |
| 2 | 主清单有「全选 / 反选」，点击后批量改勾选 | 主清单无全选/反选（数量 0）；批量只在「获取模型」弹窗 | A1 step 4.1；B step 4 基线 |
| 3 | 取消勾选后行保留、`aria-checked=false` | 取消勾选后行立即消失；关闭重开仍不出现；只能经弹窗重新勾选 | A1 step 4.4；B step 4 移除当前模型/恢复 |
| 4 | 搜索在目录/勾选集合内过滤，`显示` 可等于目录总数 | 搜索只在已选集合内过滤；未选 ID → `显示 0` + 「已选模型无匹配」；正例 `显示 = 命中已选数` | A1 step 4.3；B step 4 搜索 |
| 5 | 全选/反选在主清单，反选后逐项恢复到基线 | 弹窗内「全选 / 取消全选」只作用弹窗当前显示项，主清单同步增减，取消后精确回到基线 | A1 step 4.5；B step 4 弹窗批量 |
| 6 | AI 菜单 option 的 `title` 等于模型 id | ACP 目录刷新后 `title` 为展示名；按 `ai:listModels` 的 `id → name` 映射做精确集合断言（集合仍需完全等于已选） | A1 step 4.1/4.4；B step 4 菜单/切模型 |

> 第 6 条为复测中暴露的展示层差异（`ModelSelector` 的 `title={m.label}`），不是断言放宽：菜单选项集合仍要求与已选集合一一对应，只是把展示名映射回完整 id 再比较。B 切模型同时校验 `localStorage.ai_model` 为完整 id。

## 2. 测试结果

| Spec | 用例 / 范围 | 结果 |
| --- | --- | --- |
| `e2e/wave4-settings.spec.ts` | A1 设置真机冒烟（7 steps：Dialog/6 Tab、Agent 26 行 ACP 单徽章、CLI/API、模型主清单+弹窗+搜索+批量、辅助 Tab、重开一致、console） | **1 passed / 0 failed**（44.2s） |
| `e2e/wave4-b-settings.spec.ts` | B 设置全量体验（9 steps：外框/焦点、Agent、CLI/API/保存应用、模型全链路、设计规范/UI 库、沙箱/快捷键/关于、空态、1024、构建一致性+console） | **1 passed / 0 failed**（39.4s） |
| **合计** | — | **2 passed / 0 failed（1.4m）** |

关键实测数据：

- A1 step 4：`total=410`、`selected=[opencode-go/deepseek-v4.1-flash, opencode-go/muse-spark-1.3-contributor]`、`query=deepseek`、`matched=1`、`catalog=410`、`unselected=408`、`batchTarget=google/deep-research-max-preview-04-2026`；step 6 重开 `checked=2 / total=527 / shown=2`（目录随后台 ACP 刷新增长）。
- B step 4：`total=417`、`baseline=2`、`query=deepseek`、`matched=1`、`fetchCount={checked:2,shown:417}`、`catalog=417`、`unchecked=415`、`probeId=deepseek/deepseek-v4-flash`。
- Agent（两域一致）：26 行真实 Agent、20 个 ACP、`badgeIssues=[]`、重新探测后仍 26 行。
- API：空 Key + `127.0.0.1:9` 在 48ms 内明确失败（`网络连接失败: fetch failed`），无 GCM/新窗口；关闭不保存、保存并应用与恢复基线均通过。
- 空态：无模型时计数 `{checked:0,total:0,shown:0}`，AI 对话框「暂无模型」且发送按钮禁用。
- 1024：Dialog 780×580 不越界、`scrollWidth=1024=clientWidth`、设置内部横向溢出 0。
- Console：仅 seed 预览页 Vant CDN CSP / `Unexpected token '.'` ENV 噪声，过滤后致命项 **0**。

## 3. 关键截图

![主清单只显示已选：已选 2 / 共 410 个 · 显示 2 个，无全选/反选](../shots/retest-model-list/a1-08-models-list.png)

![获取模型弹窗：全量 410 行，已选 2 项保持勾选](../shots/retest-model-list/a1-11-model-fetch-modal-all.png)

![搜索未选模型：主清单 0 行 + 「已选模型无匹配」，已选计数不变](../shots/retest-model-list/a1-12-models-search-unselected.png)

![搜索只在已选内过滤：关键词 deepseek 只命中 1 个已选](../shots/retest-model-list/a1-13-models-search-selected-only.png)

![弹窗内全选：只补当前显示项，主清单同步出现新行](../shots/retest-model-list/a1-14-models-modal-select-all.png)

![弹窗内取消全选：主清单精确回到基线 2 行](../shots/retest-model-list/a1-15-models-modal-batch-restored.png)

![B 域主清单基线：2 行已选](../shots/retest-model-list/b-09-models-baseline.png)

![B 域获取模型弹窗：全量 417 行、已选 2](../shots/retest-model-list/b-12-model-fetch-modal.png)

![B 域保存失败：toast + 单行勾选回滚](../shots/retest-model-list/b-14-save-failure-toast.png)

![B 域自定义模型：添加后进入自定义分组并自动勾选](../shots/retest-model-list/b-17-model-custom-added.png)

![B 域移除当前模型：AI 对话框回落到剩余唯一可见模型](../shots/retest-model-list/b-19-model-fallback.png)

## 4. 执行说明与观察

- ACP 模型目录在会话内异步刷新（同一次运行 step 4 `total=410` → step 6 `total=527`）。用例不锁定固定目录数，只校验同一时刻「主清单行数 = 已选 = 显示」「弹窗行数 = 弹窗计数 = 全量目录」，并保留目录总数 ≥ 已选数的边界断言。
- 「全选 → 取消全选」各触发一笔异步 IPC 保存 + 目录回灌；两笔之间等待 1.2s、取消后等待 1.5s 并再次校验主清单/持久化，避免上一笔保存晚到覆盖后续勾选（首次复跑曾因此让自定义模型用例带上残影，修复后稳定通过）。
- AI 菜单 option 的 `title` 已改为展示名，故新增 `readModelNameMap`（`ai:listModels` 的 `allGroups/groups`）做 id→展示名映射；未选中模型仍不会出现在菜单（集合精确相等 + 数量相等）。
- 关闭设置不保存搜索词、关闭弹窗不改勾选、保存失败回滚、重开一致性等原有断言全部保留。
- 未修改 `src/main/tests/package.json`；未执行 `npm install`；未 commit。

## 5. 改动文件

| 文件 | 说明 |
| --- | --- |
| `e2e/wave4-settings.spec.ts` | step 4 重写为「主清单仅已选 / 弹窗全量 / 已选内搜索 / 弹窗内全选取消」；新增 `readModelNameMap`、`pickSubsetQuery`；截图重定向到 `retest-model-list/a1-*` 并重排编号 |
| `e2e/wave4-b-settings.spec.ts` | step 4 基线/搜索/弹窗/批量/自定义/回落全部按新契约重写；恢复基线改走获取模型弹窗；新增 `readModelNameMap`、`pickSubsetQuery`；截图重定向到 `retest-model-list/b-*` 并重排编号 |
| `docs/wave4/reports/retest-model-list.md` | 本报告 |
| `docs/wave4/shots/retest-model-list/*.png` | 57 张证据截图（A1 20 张 + B 37 张；B 首个加载态采样未命中，故无 `b-01`） |
