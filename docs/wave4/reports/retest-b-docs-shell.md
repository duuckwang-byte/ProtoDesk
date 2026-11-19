# Wave4 B 阶段复测 · 文档 + 主壳/舞台（当前 UI）

- 日期：2026-11-13
- 构建：`dist/renderer` 18:35 重建（React 渲染器，非 legacy）
- 运行方式：真实 Electron 主进程 + Playwright，独立数据目录，`--workers=1`
- 结论：**文档域 PASS 10/10；主壳/舞台域 PASS 7/7；无 P0/P1；P2 × 3；ENV 噪声 1 类**
- 数据目录（已清理）：
  - `.devdata-wave4-b-docs-retest`
  - `.devdata-wave4-b-shell-retest`
- 截图目录：`docs/wave4/shots/retest-b-docs-shell/`
- 用例文件：
  - `e2e/wave4-b-docs.spec.ts`
  - `e2e/wave4-b-shell-stage.spec.ts`

## 1. 运行命令与清理

```powershell
node e2e/wave4/seed.mjs --domain b-docs-retest,b-shell-retest --force

npx playwright test e2e/wave4-b-docs.spec.ts --workers=1 `
  --output=test-results/wave4/retest-b-docs-shell

npx playwright test e2e/wave4-b-shell-stage.spec.ts --workers=1 `
  --output=test-results/wave4/retest-b-docs-shell
```

收尾：

- 文档夹具写入前备份，结束后按字节还原；`首页.md / 最新需求.md / 我的.md` hash 与 seed 一致。
- `proto-asset` 测试图片 `sandbox/测试1/首页/assets/w4br.png` 已删除。
- 两个 `.devdata-wave4-*-retest` 目录已删除。

## 2. 总览

| 域 | 结果 | 步骤 | P0 | P1 | P2 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 文档 | **PASS** | 10/10 | 0 | 0 | 3 | 宽度、目录、四类草稿守卫、图片、表格横滚全部通过 |
| 主壳/舞台 | **PASS** | 7/7 | 0 | 0 | 0 | 入口收敛、无 MiniDock、端别恢复、非当前原型子页自动切换 |
| console/pageerror/crash | PASS | — | 0 | 0 | — | 仅 seed 原型 CDN/CSP 噪声，过滤后 0 fatal |

## 3. 文档域（PASS 10/10）

| # | 用例 | 结果 | 关键证据 | 截图 |
| --- | --- | --- | --- | --- |
| 1 | PC 文档宽 1200 / overlay 不挤压舞台 | PASS | 视口 1589 时 panel=1200.0；视口 1123 时 panel=1091.2（`100vw-32`）；打开面板前后舞台宽 887.2→887.2 | `docs-01-pc-1200.png` |
| 2 | PC 窄窗宽度夹紧 | PASS | 窗口缩到 800：vw=789，panel=757.0（=vw-32，≤1200）；恢复后 1091.2 | `docs-02-pc-narrow.png` |
| 3 | 移动端 640 / 窄窗 70% | PASS | main=1123 → panel=640.0；main=789 → panel=552.3（70.0%）；移动舞台逻辑视口仍 375×780 | `docs-03-mobile-640.png`、`docs-03-mobile-70pct.png` |
| 4 | 移动端目录 close / Esc / 24px / 高亮 | PASS | `doc-toc-close` 点击后 `data-open=false`；再开后 Esc 只关目录、面板保留且无 Confirm；条目高=24px；跳转后 active=1（目标 `w4br-长文-029-章节`） | `docs-04-mobile-toc.png`、`docs-04-mobile-toc-closed-leak.png` |
| 5 | 切 Tab 草稿 Confirm | PASS | 脏草稿点「最新需求」弹 Confirm；继续编辑保留草稿；放弃后切到最新需求（11121321）、退出编辑 | `docs-05-tab-guard.png` |
| 6 | 切原型草稿 Confirm | PASS | 编辑「首页」时点「我的」弹 Confirm，面板保留；放弃后正文切到「我的」，旧草稿未写盘；切回首页无残留草稿 | `docs-06-source-guard.png` |
| 7 | 关面板草稿 Confirm | PASS | Esc 关面板被拦下，Confirm 文案含「关闭文档面板」；继续编辑保留；放弃后关闭；重开无编辑区/无草稿 | `docs-07-close-panel-guard.png` |
| 8 | 关独立文档窗草稿 Confirm | PASS | 独立窗编辑后 Esc：窗口不关，Confirm 含「关闭独立文档窗口」；放弃后窗口才关；主窗与磁盘无草稿 | `docs-08-docwin-guard.png` |
| 9 | 图片 data:image / proto-asset | PASS | data 图片 naturalWidth>0；`proto-asset://local/测试1/首页/assets/w4br.png` 实际渲染 1×1；`javascript:` 图片无 `<img>`、回退 alt | `docs-09-images.png` |
| 10 | 窄面板表格横向滚动 | PASS | inline 面板下宽表容器 `overflow-x=auto`，scrollWidth=6619 > clientWidth=604，scrollLeft 可到 140 | `docs-10-table-scroll.png` |

补充说明：

- 长文目录 92 条，PC 目录为浮层、移动端为抽屉；目录条目固定 24px，不再被压扁。
- 草稿守卫四类入口（Tab / 原型 / 面板 / 独立窗）均实际走 `confirm-dialog`，不是浏览器原生 confirm。
- `data:` 与 `proto-asset:` 图片均受 CSP `img-src` 白名单放行；`http(s)` 图片仍受 CSP 限制（本轮未改 CSP，未作为失败项）。

## 4. 主壳 / 舞台域（PASS 7/7）

| # | 用例 | 结果 | 关键证据 | 截图 |
| --- | --- | --- | --- | --- |
| 1 | 冷启动 / 移动端自动收侧栏 / 顶栏入口收敛 / 无 MiniDock | PASS | 冷启动 kind=mobile、sidebar=0、docs=0、mini-dock=0；顶栏只有 `topbar-docs`，无设置/功能说明/最新需求；展开侧栏后 mini-dock 仍 0；4 个真实原型 | `shell-01-cold-start.png`、`shell-01-sidebar.png` |
| 2 | 设置只在侧栏底部 | PASS | 全局设置入口=1，位于 sidebar 底部；topbar 设置入口=0；点击打开 `settings-dialog`，Esc 关闭 | `shell-02-settings-sidebar.png` |
| 3 | `topbar-docs` 只开合面板，不弹独立窗 | PASS | 打开前后 `BrowserWindow.getAllWindows().length=1`；1.2s 后仍为 1、无 `docwin=1`；再次点击关闭、`aria-pressed` 同步 true→false | `shell-03-docs-open.png` |
| 4 | 收起侧栏后无 MiniDock | PASS | sidebar=0、mini-dock=0；重新展开后 mini-dock 仍=0 | `shell-04-no-minidock.png` |
| 5 | 移动端自动收；切回 PC 恢复侧栏/文档 | PASS | PC（sidebar=1/docs=1）→ 移动端（0/0）→ 切回 PC 自动恢复 sidebar=1、docs=1（overlay） | `shell-05-pc-before-mobile.png`、`shell-05-mobile-auto-collapse.png`、`shell-05-back-to-pc-restored.png`、`shell-05-back-to-pc-sidebar.png` |
| 6 | 非当前原型新建子页自动切新子页 | PASS | 当前=首页，在「我的」上新建 `SHELLR-子页-74264` → `data-subfile=SHELLR-子页-74264.html`，loc-pill 含 我的/子页；侧栏子页 `aria-current=true`、行 `data-selected=true`；文件已落盘 | `shell-06-subpage-switched.png` |
| 7 | console / pageerror / crash | PASS | 原始 console=4、pageerror=3、crash=0；排除 Vant CDN/CSP/内联脚本噪声后 fatal 全为 0 | `shell-07-final.png` |

## 5. 缺陷与观察

### P0

无。

### P1

无。

### P2

1. **移动端目录关闭后仍以浮层形式可见（视觉未消失）**
   - 现象：点击 `doc-toc-close` 后 `data-open=false`、`pointer-events=none`，但抽屉向左平移出文档面板后没有被裁剪，176px 宽的目录仍浮在舞台上方。Esc 关闭抽屉同样如此。
   - 影响：用户会认为“目录没关掉”；舞台左侧被遮挡。交互状态正确，属于视觉/层级缺陷。
   - 证据：`data-open=false`、`pointer-events=none`；`drawerRight=478.5`，`panelLeft=483.3`，落在舞台侧的可见宽=**176.0px**（整个抽屉宽度），截图 `docs-04-mobile-toc-closed-leak.png`。
   - 建议：给移动端文档面板容器加 `overflow-hidden`，或把抽屉限制在面板裁剪区域内；也可在关闭态卸载抽屉内容。
2. **目录跳转后的高亮可能停在目标上一条**
   - 现象：点击「W4BR 长文 029 章节」后目标标题位于滚动容器顶 +8px，恰好落在 `heading.top - scroller.top <= 8` 的判定边界之外，active 仍为 028；再滚动 24px 后正确切到 029。
   - 影响：跳转完成后“当前项”短暂/稳定显示为上一条，弱化定位反馈。
   - 证据：`scrollTop=5780`、目标标题 top=249、容器 top=241、active=`w4br-长文-028-章节`。
   - 建议：把阈值放宽到 12px，或跳转偏移从 `-6` 改为 `-12`。
3. **切原型守卫文案指向“上一个原型”**
   - 现象：从「首页」切到「我的」时，Confirm 显示“已切换到「首页」”，而不是“已切换到「我的」”或“已离开「首页」”。
   - 影响：容易被理解为切换失败/切回了首页。
   - 证据：Confirm 全文 `未保存的草稿 已切换到「首页」。你在上一个原型的修改尚未保存…`。
   - 建议：文案改成“已离开「首页」，切换到「我的」”或只写“上一个原型「首页」”。

### ENV

- seed 原型自带 Vant CDN 样式与内联脚本，产生 4 条 CSP console + 3~4 条 `Unexpected token '.'` pageerror；均来自 `/大厅`、`/需求管理` 原型内容，非应用代码，过滤后 fatal=0。已在 spec 内按既有口径过滤并在报告中单列。

## 6. 截图清单

`docs/wave4/shots/retest-b-docs-shell/`

- 文档：`docs-01-pc-1200.png` … `docs-10-table-scroll.png`（含 `docs-04-mobile-toc-closed-leak.png`）
- 主壳：`shell-01-cold-start.png` … `shell-07-final.png`
- 无 `*-FAIL.png` 残留。

## 7. 结论

当前 UI 下，文档与主壳/舞台的 B 阶段复测项全部通过：文档面板宽度夹紧、移动端目录关闭与 Esc 分层、24px 目录与滚动高亮、四类草稿 Confirm、data/proto-asset 图片、表格横滚均符合预期；设置入口已收敛到侧栏底部、顶栏只剩 `topbar-docs` 且不会拉起独立窗、MiniDock 已移除、移动端切回 PC 会恢复侧栏与文档、非当前原型新建子页会自动切到新子页。

本轮无 P0/P1；3 个 P2 均为视觉/文案层问题，可安排在下一轮 UI 收口。
