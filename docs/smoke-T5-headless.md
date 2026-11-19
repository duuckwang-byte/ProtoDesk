# T5 冒烟报告：模拟真机（无头浏览器渲染 + 截图）

- 日期：2026-11-12
- 用例文件：`e2e/headless-render.spec.ts`（新建，仅本波允许）
- 截图目录：`docs/smoke-shots/`（5 张新建）
- 结论摘要：**渲染管线全绿（4/4 通过、零致命 console error、无白屏），但目检发现 P0 级缺陷——整站无任何样式（裸骨架）。T5 有条件通过，样式修复后需重跑复检。**

## 1. 环境

| 项 | 值 |
|---|---|
| OS / Node | Windows / v24.15.0 |
| Playwright | 1.65.0 |
| Chromium | 158.0.8127.18（chromium-1254；headless-shell-1254，本波新装，无网问题，已装好） |
| 加载协议 | `file://` + `--allow-file-access-from-files`（launchOptions，见 §5） |
| 产物 | `dist/renderer/index.html`（git 忽略，可放心重建） |

## 2. 构建结果

`npm run build:renderer`（vite build + 复制 export-assets）：**成功**。

- vite v8.3.8，2110 modules，731ms
- `dist/renderer/index.html` 0.76 kB
- `dist/renderer/assets/index-C4ViOxPC.js` 290.09 kB（gzip 90.11 kB）
- export-assets 复制 3 项：`export-template.js`、`icons.js`、`export.css`
- 注意：`dist/renderer/assets/` 下**只有 JS，无任何 CSS 产物**（与 §4 缺陷对应）。

## 3. 用例表（`npx playwright test e2e/headless-render.spec.ts`）

```
Running 4 tests using 1 worker
  ok 1 a) 主窗骨架可见 + 零致命 console error (1.3s)
  ok 2 b) 三视口截图 1440×900 / 1024×768 / 600×900 (2.9s)
  ok 3 c) 移动端模拟 390×844 @2x 自适应盒截图 (1.1s)
  ok 4 d) 独立文档窗 ?docwin=1 骨架 + 截图 (1.1s)
  4 passed (8.3s)
```

| # | 用例 | 断言 | 结果 |
|---|---|---|---|
| a | 主窗 `file://index.html`，1440×900 | `main-window`/`topbar`/`sidebar`/`stage-frame` 可见；致命 console error 为空 | 通过 |
| b | 同 URL 切 1024×768、600×900 | 每视口骨架可见、致命 error 为空、截图落盘 | 通过（3 张） |
| c | 新 context：390×844、deviceScaleFactor 2、isMobile+touch | 骨架可见、致命 error 为空、截图落盘 | 通过（1 张） |
| d | `file://index.html?docwin=1`，1024×768 | `doc-window` 可见、致命 error 为空、截图落盘 | 通过（1 张） |

断言口径：只验“骨架 + 零致命 error”，未碰业务逻辑。第三方警告/favicons 类经 `isFatal` 白名单忽略（实际运行中一条未触发）。

## 4. console error 清单

- 4 用例、6 次页面加载（含 b 内 3 次）：**致命 console error = 0，pageerror = 0**。
- 原始 `console` 全量（含 warning/info）同样干净（react 无报错、无 missing-key 刷屏）。

## 5. 截图目检（5 张逐张结论）

> 通病（5 张共有）：**整页无样式**——纵向裸排、浏览器默认宋体/Times、无背景色无布局。DOM 骨架全对，但视觉上顶栏/侧栏/舞台“未组装成界面”。无白屏、无错位（错位的前提是样式存在），内容可读。

| 截图 | 目检结论 |
|---|---|
| `main-1440x900.png` | 顶栏控件（项目/原型面包屑、PC/移动切换、85% 缩放、文档按钮）、侧栏树（示例分组/示例原型/子页面一/二/未选中原型）、舞台占位文案（桌面端舞台占位、预览 iframe 由 Wave2-H 接入）**都在**；但纵向堆叠、无分栏。顶栏/侧栏/舞台占位：**结构正常、样式缺失**；图标区有个别 tofu 口（字体回退所致，属样式缺失的连带现象）。 |
| `main-1024x768.png` | 同上。1024 宽下无横向溢出、无白屏。 |
| `main-600x900.png` | 同上。窄视口自然纵排，无横向滚动条异常。 |
| `mobile-390x844-2x.png` | @2x 清晰，内容完整可读，无白屏；自适应盒行为**无法目检**——Stage 的移动端 375×780 盒依赖样式，当前裸排下只见纵向文字流。 |
| `docwin-1024x768.png` | `doc-window` 正确独立渲染（页签 功能说明/最新需求、搜索框、暂无目录/暂无文档内容），无顶栏/侧栏/舞台混入，路由 `?docwin=1` 正确；同样无样式。 |

## 6. 缺陷分级

- **P0（阻塞视觉验收）：整站零样式。** 硬证据（无头页内实测）：`document.styleSheets.length === 0`、无 `<style>` 节点、`.flex` 未生效（`main-window` computed display 为 `block`）、body 字体为浏览器默认 `Times New Roman`。
- 根因：`src/renderer/styles/globals.css`（`@import "tailwindcss"`，Tailwind v4 入口）**没有任何模块 import 它**——`main.tsx`/`providers.tsx` 均未引入（仅注释提及），grep 全仓 `globals.css` 只有注释引用。构建因此零 CSS 产出（§2）。dev 态同病（同一入口），非 file:// 特有。
- 非缺陷（澄清）：`file://` 直载 ES module 会被 Chromium CORS 拦截（origin 'null'，`net::ERR_FAILED`），属浏览器安全策略；本波已用 `--allow-file-access-from-files` 放行，更接近 Electron file 承载语义，4 用例均在此 flag 下通过。后续若改走本地 http 静态服务可去掉该 flag，但不影响本结论。

## 7. 结论与后续

1. T5 管线（重建产物 → 无头加载 → 骨架断言 → 5 截图 → 零致命 error）**全绿，有条件通过**。
2. P0 样式缺失转交修复：建议在 `src/renderer/main.tsx`（或 providers）`import "./styles/globals.css"`，重跑 `npm run build:renderer` 确认 `dist/renderer/assets/*.css` 产出后，**重跑本 spec 复检**（目检应见顶栏横排/侧栏分栏/舞台占位居中）。
3. 本波未改 `src`/`tests`/`main`/`package.json`，未 commit；其他 e2e 文件未碰。
