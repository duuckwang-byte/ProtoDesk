# W5 修复报告 · 缩放发虚（CSS zoom）与移动端动态视口高

- 日期：2026-11-19
- 范围：React 渲染层舞台缩放机制 + 移动端视口高度口径
- 决策来源：用户在《缩放发虚与移动端高度 · 排查结论》页确认两项方向
  （问题一 → CSS zoom 替代 transform；问题二 → 动态视口高）

## 0. 结论先行

两项修复均已实施并通过全部门禁：

| 门禁 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 错误 |
| `npx vitest run` | 50 文件 / 623 测试全过 |
| `npm run build:renderer` | 通过（主 chunk `index-CbS4NQO4.js`） |
| `node tests/lint-guard.js` | LINT_PASS（仅既存 react-refresh 警告） |
| e2e（真机 Electron） | wave4-stage / wave4-mobile-viewport / wave4-b-shell-stage / wave4-b-docs / electron-functional 全过 |

缩放清晰度 A/B（同机、同窗口、同内容、同截图区域，梯度能量越高越清晰）：

| 场景 | transform（旧） | CSS zoom（新） | 变化 |
| --- | ---: | ---: | --- |
| PC 100%（对照组） | 152.863 | 152.864 | 持平（1× 栅格，机制无关） |
| PC 125% | 99.729 | 132.771 | **+33.2%** |
| 移动端 125% | 217.349 | 276.366 | +27.1% |

对照组持平证明度量口径稳定；125% 的 +33% 边缘能量即「帧内文字按新比例重栅格化」的直接证据。

## 1. 问题一：缩放（尤其放大）时文字图标发虚

### 根因（见排查页，摘要）

- 两端舞台都用 `transform: scale()` 缩放逻辑尺寸不变的沙箱预览帧（`sandbox` 无
  `allow-same-origin`，srcDoc 注入）；
- Chromium 对 IsolatedSandboxIFrame 不按祖先 transform 比例重栅格（缺陷
  399478935，M140 修复；本应用 Electron 37.10.3 = Chromium 138 未包含）；
  残留缺陷 513611535 的四条件（沙箱帧 + 非整数比例 + 圆角裁剪 + 帧内滚动条）
  本应用全中，即使升到 M140 也只能部分缓解。

### 修复（决策：CSS zoom 替代 transform）

- `Stage.tsx` PC 分支：移除 `stage-pc-zoom-box` 缩放盒，`stage-pc-zoom`
  直接 `style={{ width: 基准, height: 基准, zoom }}`；zoom 是布局级缩放，
  元素布局尺寸即 基准×zoom，滚动/居中语义与旧缩放盒完全一致。
- `Stage.tsx` 移动端 `stage-viewport`：`transform: scale()` → `zoom`。
- 语义 spike（Chromium 实测，沙箱 srcdoc 帧 + rounded 裁剪复刻）证明
  zoom 与 transform 的坐标口径一致：
  - zoom 传播进帧：帧内 `innerWidth` 仍 375（帧布局不重排，视觉整体缩放）；
  - `getBoundingClientRect()` 返回外层（视觉）坐标、`clientWidth` 返回逻辑值
    → `frameScaleFromWidths` / `scaleRectToPage` 既有换算零改动，
    拾取悬停框、选中框、标注定位全部沿用。
- e2e 侧 `assertZoom` 增加 `transform === 'none'` + `computed zoom ≈ 比例` 断言。

### 备注

- 旧渲染器（`js/nav-zoom.js`，`start:legacy` 回退路径）仍为 transform 方案，
  发虚在 legacy 下依旧存在；默认 React 渲染层已根治。
- Playwright 1.65 的跨帧 `locator.click` 不换算 CSS zoom（actionability 误报
  「intercepts pointer events」），e2e 中 50% 输入框改用与 `clickCardInFrame`
  同口径的实测坐标点击（`bboxWidth/clientWidth` 实测比例 + 真实鼠标坐标）。

## 2. 问题二：移动端只有「全貌」能看到底部

### 根因（设计口径，非计算 bug）

- 逻辑视窗固定 375×780；适宽只按宽适配（`min(1, 可用宽/375)`），
  高度交给壳内滚动；只有全貌按 `min(宽/375, 高/780)` 双向适配。
- wave4 验收实测壳高与可用高差 0.014px（测量无 bug），但 100%/125% 下
  `scrollHeight 780/975 > clientHeight 527`，底部必须壳内滚到底。

### 修复（决策：动态视口高）

- `useMobileViewport.ts`：非 overview 模式的逻辑视口高 = 壳内可视高 ÷ 比例
  （实测 `stage-mobile-scroll.clientHeight`，含横向滚动条占位；未测得时回落可用高）；
  内容高按可视高清零点收敛（floor 到 2 位小数 + clamp），壳内不再出现纵向滚动条。
- overview（全貌）保持 375×780 参考机整机可见，语义不变。
- 效果：适宽/100%/125%/custom 的手机壳高永远吃满可用区，**底部常驻可见**，
  长页滚动发生在原型（iframe）内部（真机语义）；帧内 `innerHeight` 随壳反缩
  （e2e 断言帧内 `innerHeight ≈ 舞台逻辑视口高`）。
- 联动：工具栏标签改为显示实际逻辑视口（如「移动端 375×532」，全貌仍 375×780）；
  顶栏移动端按钮 title 改「移动端舞台（375 逻辑宽）」；
  小地图只在壳内真实纵向溢出时显示（动态视口高下恒隐藏，组件保留）；
  每模式滚动位置记忆保留（纵向恒 0，横向仍可用）。

### 过程中发现并修复的连带缺陷（React #185）

- 初版实现让 100/125/custom 的壳高随内容高回缩（`min(contentHeight, 可用高)`）。
  窄窗口下 125% 内容宽超出壳 → 横向滚动条占 15px → 实测可视高变小 →
  视口高/内容高/壳高依次回缩 → 横向滚动条仍在 → 再次回缩 →
  无限收缩循环 → React #185（Maximum update depth）→ 整树卸载白屏。
- 修复：非 overview 壳高固定吃满可用高、不随内容回缩
  （`useMobileViewport.ts` 壳尺寸注释块），实测 125% 下
  `scrollHeight == clientHeight`（zoom-ab 探针）。
- 单测无法覆盖（jsdom 无布局、`clientHeight=0` 走兜底），由真机 e2e 兜底：
  适宽/100/125/custom 全模式断言壳内无纵向溢出。

## 3. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/renderer/features/preview/useMobileViewport.ts` | 动态视口高 + 壳可视高实测 + 壳高不回缩（#185 修复） |
| `src/renderer/components/shell/Stage.tsx` | PC/移动端 transform → CSS zoom；小地图按溢出显示；工具栏标签动态 |
| `src/renderer/components/shell/Topbar.tsx` | 移动端按钮 title 更新 |
| `src/renderer/stores/app-store.ts` | 模式注释口径更新（无行为变化） |
| `src/renderer/features/preview/lib/iframe-pick.ts` | 注释口径更新（坐标换算零改动） |
| `src/renderer/features/preview/PreviewOverlaysHost.tsx` | 轮询注释口径更新 |
| 单测：`useMobileViewport.test.tsx`、`Stage.zoom.integration.test.tsx` | 新口径断言（视口高=可视高÷比例、内容高吃满、zoom 值、无溢出小地图隐藏） |
| e2e：`wave4-stage.spec.ts`、`wave4-mobile-viewport.spec.ts` | 断言改为动态视口高 + CSS zoom 机制 + 无壳内纵向滚动 |
| e2e：`electron-functional.spec.ts`、`wave4-b-docs.spec.ts` | 高度断言改动态值 |
| e2e：`wave4-docs.spec.ts` 等 5 处 | 移动端按钮 title 选择器更新 |

## 4. 复测记录

- `npx playwright test e2e/wave4-stage.spec.ts e2e/wave4-mobile-viewport.spec.ts --workers=1`
  → 2 passed（26.1s）：PC 50/75/100/125 预设、移动端手动 50/115/125、
  50%/125% 真实鼠标跨帧点击全部命中；外层无滚动；退出干净。
- `npx playwright test e2e/wave4-b-shell-stage.spec.ts e2e/wave4-b-docs.spec.ts e2e/electron-functional.spec.ts`
  → 4 passed（1.4m）：舞台五模式、小地图隐藏口径、文档层级、移动端舞台
  动态视口高（`04-mobile-dynamic-viewport.png`）全过。
- 已知噪声：seed「大厅」Vant CSP / `Unexpected token '.'`（ENV，同 wave4 口径过滤）。

## 5. 遗留与建议

1. **Ctrl+滚轮缩放**：README 快捷键表写有「Ctrl+滚轮缩放」，legacy 实现于
   `js/nav-zoom.js`；React 版未实现 wheel 监听（本前已存在的缺口，与本修复无关）。
2. **legacy 渲染层**：仍为 transform 方案；如需根治可同样换 zoom（`nav-zoom.js:57`）。
3. **Electron 升级**：37.x 已结束支持（Chromium 138）；升 38+（M140+）可额外
   拿到 transform 路径的引擎修复，与本方案互补不冲突。
4. seed 脚本 `--force` 在域目录被外部句柄占用时 EPERM 半删
   （本轮 `.devdata-wave4-mobile-viewport`、`.devdata-wave4-b-shell-retest`，
   以「不清目录、直接拷回种子」恢复）；建议 seed.mjs 对 rm 失败给出可操作的
   分支提示（复制而非删除）。
