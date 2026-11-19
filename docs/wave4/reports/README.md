# Wave4 域报告目录约定

本目录每域一份报告：`docs/wave4/reports/<domain>.md`。

- 8 个域：`ai` / `pick` / `docs` / `shell` / `stage` / `settings` / `git` / `export`。
- 汇总 `00-summary.md` 与最终 `docs/wave4-smoke-report.md` 由协调者独占，域 agent 不写。
- 报告只写自己的域；不要复用别人的截图名、数据目录或 `test-results` 输出目录。
- 报告内禁止出现 API Key、Git token、凭据明文或可解密串；只写「已配置 / 已剥离 / hasToken=true」这类状态。

## 1. 每域报告模板

复制下面模板到 `docs/wave4/reports/<domain>.md`，按 A 冒烟 / B 全量体验填写。

```markdown
# Wave4 <A 冒烟 / B 全量体验> · <域名称> 报告

- 日期：
- Agent / owner：
- 阶段：A 冒烟 / B 全量体验
- 代码版本：`git rev-parse HEAD` =
- 构建：`dist/renderer` 构建时间 / 入口 hash =
- 环境：Windows / Node / Electron / Playwright
- 数据目录：`PLAND_DEV_DATA_DIR` =（实际 `app.getPath('userData')` =）
- seed：`_wave4-seed.json` present / missing；seed 指纹 =
- 运行命令：
  `npx playwright test e2e/wave4-<domain>.spec.ts --workers=1 --output=test-results/wave4/<domain>`
- 真实请求/网络：AI_REQUESTS=0/1；GIT_NETWORK=无/本地 bare/真实远端

## 1. 步骤结果

| # | 步骤 | 结果（PASS/FAIL/SKIP） | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 1 |  |  | 截图/文件/DOM/日志 | — / P0 / P1 / P2 / P3 |
| 2 |  |  |  |  |

> 证据写法：
> - 截图：`docs/wave4/shots/<domain>/01-xxx.png`；失败为 `01-xxx-FAIL.png`。
> - 文件：绝对路径 + 字节数 + SHA256 前 12 位；导出文件校验魔数/JSON 可解析。
> - DOM：`[data-testid=...]` + 可见文本/数量。
> - Console：保留原始 error 文本；过滤 favicon/third-party/devtools/ResizeObserver/autofill 后统计致命项。
> - AI：真实请求次数、首/末事件时间、流式采样点、气泡数量与文本长度。

## 2. 缺陷

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| <domain>-P1-1 | P1 |  |  |  |  |  |

## 3. 观察区（A 阶段 P2/P3 只记录，不阻断）

| ID | 级别 | 现象 | 是否进 B | 备注 |
| --- | --- | --- | --- | --- |

## 4. 结论

- 结果：**可放行 / 需修复 / ENV-BLOCKED**
- P0 = 0；P1 = 0；P2 = n；P3 = n；ENV = n
- 阻断项：
- 复测范围：
- 备注：
```

## 2. 截图目录

```text
docs/wave4/shots/
  <domain>/
    01-<slug>.png
    02-<slug>.png
    02-<slug>-FAIL.png
```

- `<domain>` 只能是 8 个域名之一。
- `<NN>` 为两位步骤号；`<slug>` 用英文小写短横线，禁止空格/中文/时间戳。
- 失败步骤额外保存 `-FAIL.png`，不允许覆盖 PASS 截图。
- 主窗截图默认视口；整页/长文档才用 `fullPage`。
- 独立文档窗（docwin）截图也放在本域目录，文件名加 `-docwin`。

## 3. 缺陷级别

| 级别 | 定义 | A 阶段处理 |
| --- | --- | --- |
| **P0** | 崩溃、白屏、数据损坏/丢失、项目无法进入、进程无法退出、整域不可用 | 立即停止该域；全局阻断 |
| **P1** | 核心用户路径不可用或结果错误，且没有可用替代路径 | A 阻断，必须修复 + 复测 |
| **P2** | 局部功能异常、状态不对、明显体验问题，但有替代路径 | A 只记录，不阻断；B 优先排序 |
| **P3** | 文案、像素、间距、图标、动效、排序、提示语、轻微延迟 | A 不记录到阻断表；B 末尾处理 |
| **ENV** | 环境/配额/网络/远程仓库/Agent 未安装等非产品问题 | 不计缺陷，标 `ENV-BLOCKED` 并说明证据 |

## 4. 结论判定

| 结论 | 条件 |
| --- | --- |
| **可放行** | A：P0=P1=0；B：P0=P1=0，P2 已分级且有 owner/waiver |
| **需修复** | 存在未关闭 P0/P1；或 P2 影响核心路径且无替代 |
| **需返工** | 多域 P0/P1 连锁、构建/数据隔离本身不可靠 |
| **ENV-BLOCKED** | 环境不满足（Agent 未装/无网络/配额/构建 stale）；不算产品结论，重排环境后重跑 |

## 5. Phase 0 基座用法

```ts
import { launchApp, assertCleanExit, reportFailure } from './wave4/harness'

const ctx = await launchApp({ domain: 'shell' }) // 强制 <repo>/.devdata-wave4-shell
try {
  await ctx.shot(1, 'cold-start')
  // ... 步骤断言 ...
  ctx.assertNoFatalConsole()
} catch (err) {
  await reportFailure(ctx, {
    step: 1,
    slug: 'cold-start',
    level: 'P1',
    expected: 'main-window 可见',
    actual: '白屏 / 无 main-window',
    error: err,
  })
  throw err
} finally {
  assertCleanExit(await ctx.close())
}
```

- 数据目录准备：`node e2e/wave4/seed.mjs --domain <domain>`；重建 seed 只在 Phase 0/协调者执行 `--rebuild-seed`。
- 默认要求域目录有 `_wave4-seed.json`；确实要空 profile 时显式传 `launchApp({ domain, requireSeed: false })`。
- 失败片段自动落到 `%TEMP%/pland-wave4/failures/<domain>/`，包含截图、console、pageerror、stderr。
- 同一域目录同一时刻只允许一个 Electron 实例；并行只允许不同域目录。
- 不裸跑 `npx playwright test`；只跑单域 spec，且 `--output=test-results/wave4/<domain>`。
- `PLAND_WAVE4_ROOT` 只用于把 harness 编译到临时目录做 Phase 0 自检，域 spec 不要设置。
