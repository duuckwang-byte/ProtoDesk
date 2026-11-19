# Wave4 冒烟前冻结构建报告

> 执行时间：2026-11-13 12:35:47 – 12:38:40（本机开发态）
> 执行人：冻结构建子代理
> 写入范围：仅本文件；未改源码/配置，未 `npm install`，未 commit，未触碰用户桌面端
> 仓库：`D:\文件\工具\原型工具-PlanD`，分支 `main`，HEAD `77192ddb`（2026-09-30）

## 0. 结论

| 项 | 结果 |
|---|---|
| 冻结版本标识 | **`dist/renderer/assets/index-BHMDlo45.js`**（主 chunk） |
| 统一 dist 树指纹 | `8f2d90c1b770c3d17df783b6c07dac2489f72d4bc38ad5d7cd6185e8b272de4d`（11 文件 / 658,476 B，SHA-256 over sorted `path\tbytes\tsha256`） |
| 类型门禁 | `npx tsc --noEmit` **PASS**，exit 0，无诊断 |
| 单测门禁 | `npx vitest run` **PASS**，20/20 文件、314/314 用例，exit 0，2.91 s |
| 构建门禁 | `npm run build:renderer` **PASS**，2170 modules，exit 0，387 ms |
| Seed | **已重建**：107 文件 / 526,712 B；源 `.devdata` 200 文件 / 1,287,635 B，`sourceUnchanged=true` |
| Harness 自检 | **PASS**：userData 精确隔离、main-window 可见、0 致命 console、window-close exit 0 / 222 ms |
| 当前进程 | 开发态 `electron.exe` = **0**；用户打包端 `原型工具.exe` = 5（未动） |
| 是否可开跑 A1 | **可以**。冻结基线与 seed 模板均就绪；域目录按需生成、跑完即删 |

---

## 1. 环境检查（步骤 1）

### 1.1 采样方法与排除口径

只统计 `electron.exe`（开发态 Playwright 指纹：`node_modules\electron\dist\electron.exe`）。按任务要求排除：

- 用户打包端 `桌面端\win-unpacked\原型工具.exe`（打包态，写 `%APPDATA%\原型工具`）；
- `%APPDATA%\原型工具` 下的用户实例。

### 1.2 采样结果

| 时刻 | `electron.exe` 数量 | 处理 |
|---|---|---|
| 12:35:56（T1） | **0** | 无需停止 |
| 12:35:58（T2，等待 2 s 后复采样） | **0** | 确认稳态为 0 |

- **不存在 PlanD 开发态实例，没有 PID 需要停止**；未执行任何 kill。
- 用户打包端同一时刻为 5 个进程（主进程 + GPU + network + 2×renderer），窗口正常：
  PID `48388`（主）、`46524`、`50256`、`50860`、`37584`，路径均在 `桌面端\win-unpacked\`。
- 自检启动前/关闭后再次采样：`PRE_LAUNCH_DEV_ELECTRON=0` → `POST_LAUNCH_DEV_ELECTRON=0`。
- 全程未触碰 `原型工具.exe`；其数量在结束后仍为 5。

---

## 2. 类型与单测门禁（步骤 2）

### 2.1 `npx tsc --noEmit`

```text
TSC_EXIT=0
```

- 无 error / warning 输出。
- 说明：`tsconfig.json` 未 include `e2e/**`（Phase 0 已记录），因此 harness 另行用严格参数单独编译（见 §5.1）。

### 2.2 `npx vitest run`

```text
Test Files  20 passed (20)
     Tests  314 passed (314)
   Start at  12:36:05
   Duration  2.91s
VITEST_EXIT=0
```

- 环境：jsdom（20 次创建，23.58 s，占 tracked time 75%）。
- 无 failed / skipped / todo 计数异常；退出码 0。

---

## 3. 统一 dist 构建（步骤 3）

命令：`npm run build:renderer`（`vite build --config vite.config.ts && node scripts/copy-export-assets.mjs`）

```text
✓ 2170 modules transformed.
dist/renderer/index.html                          1.26 kB │ gzip:  0.68 kB
dist/renderer/assets/index-BIvHzkol.css          43.44 kB │ gzip:  8.85 kB
dist/renderer/assets/rolldown-runtime-WkwZ5CU-.js 0.59 kB │ gzip:  0.36 kB
dist/renderer/assets/vendor-zustand-H8tULKJc.js   0.67 kB │ gzip:  0.42 kB
dist/renderer/assets/vendor-lucide-BId8BHPg.js   20.24 kB │ gzip:  7.34 kB
dist/renderer/assets/vendor-BC5zy5rY.js          28.13 kB │ gzip:  8.97 kB
dist/renderer/assets/vendor-react-hOfqTAH6.js   210.91 kB │ gzip: 65.86 kB
dist/renderer/assets/index-BHMDlo45.js          329.64 kB │ gzip: 92.01 kB
✓ built in 387ms
BUILD_EXIT=0
```

### 3.1 主 chunk 与警告

| 项 | 值 |
|---|---|
| 主 chunk | `dist/renderer/assets/index-BHMDlo45.js`，**329,649 B**（329.64 kB / gzip 92.01 kB） |
| 主 CSS | `dist/renderer/assets/index-BIvHzkol.css`，43,440 B |
| 最大 vendor | `vendor-react-hOfqTAH6.js`，210,917 B |
| chunk-size 警告 | **无**（Vite 未报 >500 kB） |
| 其它警告 | 仅 1 条：Vite config 使用 `configLoader: 'native'` 时不支持 CJS 中写 ESM 语法（`vite.config.ts:1:1`），属既有配置提示，不影响构建 |
| 额外产物 | `copy-export-assets` 复制 `export-template.js` / `icons.js` / `export.css` 到 `dist/renderer/export-assets/` |

### 3.2 冻结 hash 与时间

构建完成时间：**2026-11-13 12:36:16**（所有本轮产物 mtime 一致）。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `dist/renderer/index.html` | 1,261 | `198725714478672764e49d1a5e8f478bce8daf4eab95ad23a5f060989c9d5a2a` |
| `dist/renderer/assets/index-BHMDlo45.js` | 329,649 | `d525c677f6bbff63e81b58cf5159a424a7c3e568a69d93e885bc9f26c69fdff5` |
| `dist/renderer/assets/index-BIvHzkol.css` | 43,440 | `f35f402702b5fda5abfd8bcd464af6f6b491ca213c6573c63bcea180e6896789` |

完整 dist 清单（11 文件 / 658,476 B）：

```text
renderer/assets/index-BHMDlo45.js             329649  d525c677...
renderer/assets/index-BIvHzkol.css              43440  f35f4027...
renderer/assets/rolldown-runtime-WkwZ5CU-.js      599  2629f2ad...
renderer/assets/vendor-BC5zy5rY.js              28132  0d5d4e8d...
renderer/assets/vendor-lucide-BId8BHPg.js        20244  88e7c98e...
renderer/assets/vendor-react-hOfqTAH6.js        210917  bc38bf40...
renderer/assets/vendor-zustand-H8tULKJc.js         676  57b2d413...
renderer/export-assets/export.css                6179  0c8a0779...
renderer/export-assets/export-template.js        9377  19dc3fd2...
renderer/export-assets/icons.js                  8002  87c1de55...
renderer/index.html                              1261  19872571...
```

- `dist/renderer/index.html` 入口已指向 `./assets/index-BHMDlo45.js`，确认统一 dist 生效。
- 与冻结前旧构建（11:31:59，`index-CEJ3kONG.js`）相比，主 chunk 已换代；旧产物已被 Vite 清理，不存在双入口。

---

## 4. Seed 刷新（步骤 4）

命令：`node e2e/wave4/seed.mjs --rebuild-seed --domain phase0 --force --json`

```text
[seed] built C:\Users\allow\AppData\Local\Temp\pland-wave4\seed files=107 bytes=526712 sourceUnchanged=true
SEED_EXIT=0
```

| 项 | 重建前 | 重建后 |
|---|---|---|
| seed 模板 | `%TEMP%\pland-wave4\seed` | 同路径（覆盖） |
| 创建时间 | `2026-11-13T04:09:41.727Z` | **`2026-11-13T04:36:44.889Z`** |
| 文件数 | 107 | **107** |
| 字节数 | 516,536 | **526,712** |
| 源指纹 | `a75eafce79a0…` | **`0c11ddd5d1434690dd0a6d430b6696f91142e5f709b4a6d45b454c94c498a8dd`** |
| 源文件 / 字节 | 200 / 1,277,459 | 200 / **1,287,635** |
| `sourceUnchanged` | — | **true**（复制期间 `.devdata` 未被改动） |

要点：

- seed 模板已刷新；**旧 seed（Phase 0）已作废**，任何引用 `a75eafce…` 的记录都不再对应当前模板。
- 源指纹变化发生在 Phase 0 之后，漂移量约 +10 KB，集中在 `.devdata` 的 Chromium 状态层（与 `pre-smoke-env.md` 观察一致）；业务白名单内容仍为 `sandbox\测试1`、`specs`、`uilibs`、同名 `snapshots\测试1`、`projects-normalized-v1`、`Local Storage\leveldb`。
- Local Storage 实际带入键：`protoLastProject`、`edit_queue_v1`、`protoOrder_v1`。
- 凭据未复制：`ai-credentials.json` / `git-credentials.json` 条目清空，仅保留 `hasApiKey` / `hasToken` 元数据；git remote 已中和。
- 无 `.seed.lock` 残留。

### 4.1 phase0 分发与清理

- 分发：`--domain phase0 --force` 创建 `.devdata-wave4-phase0`，实测 **108 文件 / 527,067 B**（= seed 107 文件 526,712 B + `_wave4-domain.json` 355 B）。
- harness 自检通过后，该临时域 **已删除**；当前仓库根 `.devdata-wave4-*` 数量 = **0**。
- 因此 A1 开跑时需按域自行生成：`node e2e/wave4/seed.mjs --domain <domain>`；各域跑完必须删除自己的目录（该前缀不在 `.gitignore`）。

---

## 5. Harness 启动自检（步骤 5）

### 5.1 编译

因 `tsconfig.json` 不含 `e2e/**`，按 Phase 0 口径单独严格编译到临时目录：

```powershell
npx tsc e2e/wave4/harness.ts --ignoreConfig --outDir $env:TEMP\pland-wave4\harness-build-freeze `
  --module commonjs --target ES2020 --moduleResolution node10 --ignoreDeprecations 6.0 `
  --esModuleInterop --skipLibCheck --strict --lib ES2020,DOM --types node
# HARNESS_BUILD_EXIT=0
```

自检脚本置于 `%TEMP%\pland-wave4\freeze-selfcheck.cjs`（临时文件，不入仓库），仅做隔离/可见/关闭断言，**不截图、不写失败报告、不发 AI、不触网**。

### 5.2 结果

```json
{
  "domain": "phase0",
  "dataDir": "D:\\文件\\工具\\原型工具-PlanD\\.devdata-wave4-phase0",
  "userData": "D:\\文件\\工具\\原型工具-PlanD\\.devdata-wave4-phase0",
  "strictEqualExpected": true,
  "endsWithExpected": true,
  "seedPresent": true,
  "mainWindowVisible": true,
  "mainWindowBox": { "x": 0, "y": 0, "width": 1123.25, "height": 640.35 },
  "windowTitle": "原型工具",
  "windowUrl": "file:///D:/文件/工具/原型工具-PlanD/dist/renderer/index.html",
  "consoleErrors": 0,
  "pageErrors": 0,
  "crashes": 0,
  "fatalErrors": [],
  "close": { "ok": true, "exitCode": 0, "method": "window-close", "elapsedMs": 222, "exited": true }
}
```

| 断言 | 结果 |
|---|---|
| `PLAND_DEV_DATA_DIR` → `app.getPath('userData')` | 精确相等（非仅后缀），隔离生效 |
| `app.isPackaged` | false（开发态，符合冒烟前提） |
| `_wave4-seed.json` | present |
| `[data-testid=main-window]` | visible，1123×640 |
| 渲染入口 | `file:///…/dist/renderer/index.html`（走的正是本轮冻结 dist，不是 dev server） |
| console / pageerror / crash | 0 / 0 / 0，`fatalErrors=[]` |
| 关闭方式与退出码 | `window-close`，**exit 0**，222 ms |
| 关闭后残留 | `electron.exe` = 0 |
| 临时域清理 | 已删除，仓库无 `.devdata-wave4-*` |

---

## 6. 当前进程状态（报告时点 12:37:52）

| 类别 | 数量 | 说明 |
|---|---:|---|
| 开发态 `electron.exe` | **0** | 无 harness/Playwright 残留 |
| 用户打包端 `原型工具.exe` | **5** | 用户 11:49 启动的 1.2.0，窗口正常；**未触碰** |
| `.devdata-wave4-*` 目录 | **0** | phase0 已清理 |

`%TEMP%\pland-wave4\` 保留：`seed\`（本轮新模板）、`harness-build-freeze\`（本轮编译产物）、`freeze-selfcheck.cjs`（本轮自检脚本）；历史 `failures\`、`harness-build\`、`final-dryrun.json` 未改动。

---

## 7. 版本与工具

| 组件 | 版本 |
|---|---|
| Node / npm | 24.15.0 / 11.12.1 |
| TypeScript | 6.0.3 |
| Vite / Vitest | 8.3.8 / 5.1.0 |
| Electron | 37.10.3 |
| Playwright / playwright-core | 1.65.0 / 1.65.0 |
| 应用 | proto-viewer 1.2.0 |

---

## 8. 合规说明

- 未修改任何源码、配置、测试或 `package.json`；未执行 `npm install`；未 commit。
- 唯一的仓库写入是**本文件**；`dist/` 由规定的 `npm run build:renderer` 生成（构建产物，git 未跟踪）。
- 工作区在冻结前即存在 42 个文件的未提交改动（Wave 前序工作，非本次产生）；本报告不改变、不提交这些改动。
- 未停止/重启用户桌面端任何进程；未触碰 `%APPDATA%\原型工具`。

---

## 9. 开跑 A1 的前置清单

1. **版本基线**：所有域 spec 必须以 `dist/renderer/assets/index-BHMDlo45.js` 为入口；若有人重新 `build:renderer`，本报告的 hash 即失效，需重新冻结。
2. **Seed**：模板已就绪（107 文件 / 526,712 B，源指纹 `0c11ddd5…`）。域启动前执行 `node e2e/wave4/seed.mjs --domain <domain>`；**不要**在并行域同时 `--rebuild-seed`。
3. **隔离**：由 harness 强制 `PLAND_DEV_DATA_DIR=<repo>/.devdata-wave4-<domain>`；域目录同名互斥，单域单实例。
4. **清理**：每域结束删除 `.devdata-wave4-<domain>`，严禁提交。
5. **环境**：开跑前确认 `electron.exe` = 0；用户 `原型工具.exe` 可保持在跑（不共享 userData，不影响冒烟）。

**结论：A1 可以开跑。**
