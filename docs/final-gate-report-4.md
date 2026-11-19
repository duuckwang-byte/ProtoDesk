# 最终全量门禁报告（第四轮 · 思考强度缓存 / 后台探测 / 启动预热）

- 日期：2026-11-16
- 项目：原型预览工具（proto-viewer）v1.2.0 · `D:\文件\工具\原型工具-PlanD`
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0 / Vite 8.3.8 / opencode CLI v2.0.16
- 渲染层：React（`dist/renderer`，本轮重新构建）
- 约束：未执行 `npm install`；未 commit；未修改 `src/**`、`main/**`、`tests/**`（`tests/run-all.js` 仅追加 suite）、`package.json`。
- **结论：可放行内部/自用验收（P0=0 / P1=0）。** 思考强度缓存的保存触发、命中、key 隔离、unsupported、启动预热、损坏容错、敏感字段全部通过；记录 3 条 P2（测试收尾、冷启动门禁抖动、e2e 构建前置）。

---

## 1. 门禁数字总表

| # | 门禁项 | 命令 | 结果 | 关键数字 |
| --- | --- | --- | --- | --- |
| 1 | TypeScript 类型检查 | `npx tsc --noEmit` | **PASS** | exit 0，无输出 |
| 2 | 缓存纯 Node 套件 | `node tests/verify-ai-thinking-cache.js` | **PASS** | **11 passed / 0 failed** |
| 3 | core 总门禁 | `$env:PLAND_SUITE='core'; node tests/run-all.js` | **PASS** | **total=39 / pass=39 / fail=0**；`GROUP_MAP core=39 legacy-ui=26 react-ui=0 mapped=65/65`；`ALL_PASS` |
| 4 | IPC 契约 | `node tests/verify-ipc.js` | **PASS** | **4 passed / 0 failed**（复跑；冷启动首跑 3/4，见 P2-2） |
| 5 | 真机缓存用例 | `npx playwright test e2e/wave4-thinking-cache.spec.ts --workers=1` | **PASS** | **4 passed / 0 failed**，1.4 分钟 |
| 6 | renderer 构建（e2e 前置） | `npm run build:renderer` | **PASS** | 2170 modules；entry `index-CuKZsX_t.js` 391.52 kB（gzip 111.00 kB）；CSS 50.07 kB |
| 7 | 全量 suite 装配 | `tests/run-all.js` 静态计数 | **PASS** | SUITES 64 → **65**；core 38 → **39**；legacy-ui 26；未删/改其他 suite |

### 1.1 全量门禁抖动说明

- 首次 `PLAND_SUITE=core`（冷机）：`total=39 / pass=37 / fail=2`，失败为：
  - `runtimes`（exit 1）：`detectAllAgents` 7890ms > 5000ms 断言阈值；
  - `ipc`（exit 3221226505，0xC0000409）：断言 1 通过后进程崩溃。
- 立即复跑：`runtimes` 单独 5/5（首次探测 805ms），`ipc` 单独 4/4，整组 core **39/39**。
- 判定：冷启动/机器负载导致的既有门禁抖动，与本轮缓存改动无调用关系；以复跑全绿为准（P2-2）。

## 2. 真机验收（真实 Electron，隔离 `PLAND_DEV_DATA_DIR`）

隔离目录：`.devdata-wave4-thinkcache`；每轮启动前 seed 独立配置，`app.getPath('userData')` 指向该目录，不触碰 `.devdata`。

| 项 | 实测 | 判定 |
| --- | --- | --- |
| 保存耗时（复选框点击 → `ai-config.json` 落盘） | **94ms** | PASS（远低于 5–30s） |
| 保存后 UI 可交互（关弹窗 + 切 Tab） | **184ms** | PASS |
| 后台探测写入缓存 | **7.79s**（保存时缓存尚无目标条目） | PASS |
| 缓存命中 probe ×3 | **4.8 / 2.7 / 2.8ms**，`cached:true`，`configOptions=3` | PASS |
| 换模型 key | `opencode\|opencode-go/kimi-k3` → `opencode\|opencode-go/qwen4-max`，后台 **15.02s** ready | PASS |
| 换 Agent key | `pland-probe-agent\|opencode-go/kimi-k3`，`error/ACP_AGENT_NOT_FOUND`，不串档 | PASS |
| unsupported | 首次 **12.2ms** 返回 `ACP_MODEL_UNSUPPORTED`；二次 **3.3ms** `cached:true`；条目 `unsupported` | PASS |
| 敏感字段 | 递归 key 扫描 **0 命中**；无 `"apiKey"`/`"access_token"`/`"refresh_token"`/`"password"`/`"secret"` | PASS |
| 重启预热（坏 JSON） | 主窗 **1.29s** 可见（JSON 仍非法/无目标条目）；预热 **15.53s** 后重建合法缓存 | PASS |
| 预热按当前 config 模型 | `model=opencode-go/qwen4-max` → 写入同 key，`ts` 为本次启动、`configOptions=3` | PASS |
| error 记录刷新 | `status:error, ts:1` → 预热重探覆盖为 `ready`，新 `ts=1794818676605` | PASS |
| 预热命中不重写 | 重启后缓存文件 SHA1 与 mtime **均不变**；命中 probe **6.2ms** | PASS |

缓存路径与条目：

- `D:\文件\工具\原型工具-PlanD\.devdata-wave4-thinkcache\ai-thinking-cache.json`
- `version: 1`；key = `<agentId>|<model>`；最终文件 52,185 B，条目 `opencode|opencode-go/qwen4-max`（`ready`，`configOptions` = `model`/`effort`/`mode`，`ts=1794818676605`）。
- 本轮观测 key：`opencode|opencode-go/kimi-k3`、`opencode|opencode-go/qwen4-max`、`pland-probe-agent|opencode-go/kimi-k3`、`opencode|pland/definitely-not-a-model`。

## 3. 缺陷

### P0 / P1

无。

### P2

| ID | 级别 | 现象 | 证据 | 影响 / 建议 |
| --- | --- | --- | --- | --- |
| `GATE4-P2-1` | P2 | e2e 用例 1 关闭窗口后 15s 内未退出，`taskkill /T /F` 兜底；用例 2/3/4 均 0 退出 | `[W4-THINK] close {"label":"1","exited":false}`；其余 `exited:true, code:0` | 仅测试收尾耗时；建议后续单独排查 ACP 会话完成后的进程树回收 |
| `GATE4-P2-2` | P2 | 冷启动首轮 `runtimes` / `ipc` 对 `detectAllAgents` 耗时敏感（7890ms / 15190ms > 5000ms；`ipc` 0xC0000409），复跑全绿 | `core-run.log` 37/39；`core-run2.log` 39/39；`verify-ipc` 3/4 → 4/4 | 既有门禁抖动，与本改动无关；门禁机建议预热或对探测断言加一次重试 |
| `GATE4-P2-3` | P2 | e2e 依赖 `dist/renderer` 新鲜度：初始 dist（14:48）不含 16:11 的保存预热代码，UI 保存不触发预热；重建后通过 | 旧 bundle 无 `probeModel` 预热调用；`npm run build:renderer` 后 entry `index-CuKZsX_t.js` 含 `probeModel` | 门禁顺序固定 `build:renderer` → Playwright；spec 头部已注明前置 |

## 4. 变更与证据

- 修改：`tests/run-all.js` 仅追加 `['ai-thinking-cache','verify-ai-thinking-cache.js']` 到 `SUITES` 与 `CORE_EXACT`（core 组）。
- 新增：`e2e/wave4-thinking-cache.spec.ts`（4 个 serial 真机用例）。
- 新增：`docs/wave4/reports/thinking-cache.md`、本报告。
- 截图（7 张）：`docs/wave4/shots/thinking-cache/01…07-*.png`。
- 隔离目录 `.devdata-wave4-thinkcache` 已在验证后删除；`.devdata` 未触碰。
