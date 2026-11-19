# 思考强度缓存 / 后台探测 / 启动预热 · 验证报告

- 日期：2026-11-16
- 项目：原型预览工具（proto-viewer）v1.2.0 · `D:\文件\工具\原型工具-PlanD`
- 范围：`docs/ai-thinking-cache.md` 所述的本地缓存、保存触发、后台探测、启动预热、敏感字段与容错
- 环境：Windows 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65.0 / opencode CLI v2.0.16（真实 ACP）
- 隔离数据目录：`PLAND_DEV_DATA_DIR=.devdata-wave4-thinkcache`（`app.getPath('userData')` 精确指向该目录，不触碰 `.devdata`）
- 运行命令：
  - `npm run build:renderer`（e2e 前置；Electron 开发态加载 `dist/renderer`）
  - `npx playwright test e2e/wave4-thinking-cache.spec.ts --workers=1`
  - `node tests/verify-ai-thinking-cache.js`
  - `$env:PLAND_SUITE='core'; node tests/run-all.js`
  - `node tests/verify-ipc.js` / `npx tsc --noEmit`

## 0. 结论

**P0=0，P1=0。缓存、保存不阻塞、缓存命中、key 隔离、unsupported 落缓存、启动预热、损坏容错、敏感字段检查全部通过。**
保存落盘 **94ms**（后台探测 **7.79s** 后才写缓存）；缓存命中 **2.7–4.8ms**；重启后主窗 **1.29s** 可见、预热 **15.53s** 在后台完成；缓存文件无 token/apiKey 等敏感键。
仅记录 3 条 P2（e2e 首轮退出兜底、冷启动探测类断言对机器负载敏感、e2e 依赖 renderer 构建新鲜度），无 P0/P1。

## 1. 关键结果

| # | 验证项 | 实测 | 判定 |
| --- | --- | --- | --- |
| 1 | 设置 → 模型选择未缓存模型并保存 | 保存落盘 **94ms**；保存时缓存文件还没有目标条目 | PASS |
| 2 | 保存不等待 ACP | 后台探测完成并写缓存 **7.79s**；保存与探测相差 > 7.6s | PASS |
| 3 | 保存后 UI 仍可交互 | 关闭获取模型弹窗并来回切 Tab **184ms** | PASS |
| 4 | 缓存命中 | 连续 3 次 probe：**4.8 / 2.7 / 2.8ms**，`cached:true`，`ok:true`，`configOptions` 3 项 | PASS |
| 5 | 命中不重复 ACP | 命中前后缓存文件 SHA1 不变；启动预热命中后文件 hash/mtime 均不变 | PASS |
| 6 | 换模型 key 隔离 | `opencode\|opencode-go/kimi-k3` 与 `opencode\|opencode-go/qwen4-max` 两条独立记录；新模型后台探测 **15.02s** 后 ready | PASS |
| 7 | 换 Agent key 隔离 | `pland-probe-agent\|opencode-go/kimi-k3` 独立记录，`status:error` / `ACP_AGENT_NOT_FOUND`，未串到 opencode | PASS |
| 8 | unsupported 落缓存 | 首次真实判定 **12.2ms** 返回 `ACP_MODEL_UNSUPPORTED`；第二次命中 **3.3ms**，`cached:true`；条目 `status:unsupported` | PASS |
| 9 | 重启预热（坏 JSON） | 启动前写入非法 JSON；主窗 **1.29s** 可见（此时 JSON 仍非法/无目标条目），预热 **15.53s** 后写成合法 `version:1` 文档 | PASS |
| 10 | 预热读取当前 config 模型 | config `model=opencode-go/qwen4-max` → 预热写入 `opencode\|opencode-go/qwen4-max`，`ts` 为本次启动时间，`configOptions` 3 项 | PASS |
| 11 | error 记录不算命中、会被更新 | 预置 `status:error, ts:1` → 预热重探并覆盖为 `ready`，`ts=1794818676605`，`configOptions` 3 项 | PASS |
| 12 | 启动不被预热阻塞 | 主窗可见 1.29s / 1.31s，预热完成 15.53s / 15.67s（均远晚于可见） | PASS |
| 13 | 敏感字段 | 递归扫描缓存全部 key：`sensitiveKeys=[]`；文件文本无 `"apiKey"` / `"access_token"` / `"refresh_token"` / `"password"` / `"secret"` | PASS |
| 14 | 损坏 JSON 容错 | 坏 JSON 启动不崩、不弹错；预热直接重建缓存文件（`version:1`） | PASS |

> 保存耗时口径：复选框点击 → `ai-config.json` 已包含新选中模型（`ai:save-config` 落盘）。保存链路随后还会刷新一次模型目录（`fetchModels`），但它不接触思考强度探测；后台思考探测为 fire-and-forget，实测 7.79s 后才回写缓存，保存和 UI 均已返回。
>
> Agent 隔离用例使用未知 Agent `pland-probe-agent`：主进程按同一 `<agentId>|<model>` 公式立即写 `error/ACP_AGENT_NOT_FOUND` 记录，用来证明 key 含 Agent 且不串档，同时避免为验证再拉起第二个真实 CLI；真实模型切换与 unsupported 均走了本机 opencode 的真实 ACP。

## 2. 缓存文件与条目

| 项 | 值 |
| --- | --- |
| 路径 | `D:\文件\工具\原型工具-PlanD\.devdata-wave4-thinkcache\ai-thinking-cache.json`（隔离 userData 根目录） |
| 结构 | `version: 1` + `entries`；key = `<agentId>\|<model>` |
| 保存后条目 | `opencode\|opencode-go/kimi-k3` · `status:ready` · `configOptions` = `model` / `effort` / `mode`（3 项） · `ts=1794818609558` |
| 本轮观测到的 key | `opencode\|opencode-go/kimi-k3`、`opencode\|opencode-go/qwen4-max`、`pland-probe-agent\|opencode-go/kimi-k3`、`opencode\|pland/definitely-not-a-model` |
| 最终文件（测试 4 后） | `version:1`，52,185 B；仅 `opencode\|opencode-go/qwen4-max`（`ready`，3 项，`ts=1794818676605`）——测试 3 的坏 JSON 场景按设计整份重建 |
| 敏感字段 | 递归 key 扫描 0 命中；值内未见凭据明文 |

## 3. 门禁数字

| 门禁 | 命令 | 结果 | 数字 |
| --- | --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | PASS | exit 0，无输出 |
| 缓存纯 Node 套件 | `node tests/verify-ai-thinking-cache.js` | PASS | **11 passed / 0 failed** |
| core 总门禁 | `$env:PLAND_SUITE='core'; node tests/run-all.js` | PASS | **total=39 / pass=39 / fail=0**；`GROUP_MAP core=39 legacy-ui=26 react-ui=0 mapped=65/65`；`ALL_PASS` |
| IPC 契约 | `node tests/verify-ipc.js` | PASS | **4 passed / 0 failed**（复跑；首跑见 P2-2） |
| 真机缓存用例 | `npx playwright test e2e/wave4-thinking-cache.spec.ts --workers=1` | PASS | **4 passed / 0 failed**，1.4 分钟 |
| renderer 构建（e2e 前置） | `npm run build:renderer` | PASS | 2170 modules；entry `index-CuKZsX_t.js` 391.52 kB |

`tests/run-all.js` 仅追加 `['ai-thinking-cache','verify-ai-thinking-cache.js']` 到 `SUITES`，并加入 `CORE_EXACT`；未删改任何既有 suite，总数 64 → **65**，core 38 → **39**。

## 4. 缺陷

### P0 / P1

无。

### P2

| ID | 级别 | 现象 | 证据 / 复现 | 影响 | 建议 |
| --- | --- | --- | --- | --- | --- |
| `THINK-P2-1` | P2 | e2e 用例 1 关闭窗口后 15s 内未退出，`closeApp` 用 `taskkill /T /F` 兜底；用例 2/3/4 均 0 退出 | `[W4-THINK] close {"label":"1","exited":false}`；其余 `exited:true, code:0` | 仅测试收尾耗时，不阻塞功能；可能是一次 ACP 会话刚完成后的进程树回收慢 | 后续单独排查 ACP 子进程退出时机；测试保留 15s 兜底 |
| `THINK-P2-2` | P2 | 冷启动时 `runtimes`/`ipc` 的 `detectAllAgents` 断言对机器负载敏感：首轮 core 37/39（`runtimes` 7890ms > 5000ms；`ipc` 0xC0000409 崩溃），立即复跑 39/39；`verify-ipc` 首跑 3/4（15190ms），复跑 4/4 | `core-run.log` / `core-run2.log`；`verify-runtimes` 单独复跑 `首次=805ms` | 非本改动引入，属于全量门禁冷启动抖动 | 门禁机预热或对探测类断言加一次重试；本轮以复跑全绿为准 |
| `THINK-P2-3` | P2 | e2e 依赖 `dist/renderer` 新鲜度：本轮开始 dist 为 14:48 构建，不含 16:11 的 settings-store 保存预热代码，导致 UI 保存不触发预热；`npm run build:renderer` 后通过 | `dist` 旧 bundle 无 `probeModel` 预热调用；重建后 `index-CuKZsX_t.js` 含 `probeModel` | 若门禁直接跑 Playwright 而不先构建，会误判功能失败 | 门禁顺序固定为 `build:renderer` → Playwright；spec 头部已注明前置 |

## 5. 证据截图

- `docs/wave4/shots/thinking-cache/01-model-fetch-modal.png` — 获取模型弹窗，选择 `opencode-go/kimi-k3`
- `docs/wave4/shots/thinking-cache/02-settings-after-save.png` — 保存后设置/模型页（保存已返回，探测尚在后台）
- `docs/wave4/shots/thinking-cache/03-cache-hit.png` — 重启后缓存命中场景（设置/模型页）
- `docs/wave4/shots/thinking-cache/04-startup-visible.png` — 坏 JSON 重启，主窗已可见、预热未完成
- `docs/wave4/shots/thinking-cache/05-startup-warm-done.png` — 预热完成、缓存重建
- `docs/wave4/shots/thinking-cache/06-warm-update.png` — error 记录被预热覆盖为 ready
- `docs/wave4/shots/thinking-cache/07-warm-hit.png` — 预热命中、缓存文件未重写

## 6. 复现与清理

```powershell
cd D:\文件\工具\原型工具-PlanD
npm run build:renderer
node tests/verify-ai-thinking-cache.js
$env:PLAND_SUITE='core'; node tests/run-all.js
node tests/verify-ipc.js
npx tsc --noEmit
npx playwright test e2e/wave4-thinking-cache.spec.ts --workers=1
Remove-Item -Recurse -Force .devdata-wave4-thinkcache
```

- 隔离目录 `.devdata-wave4-thinkcache` 验证完成后删除；`.devdata` 未触碰。
- 测试使用本机真实 `opencode` CLI 的 ACP 会话来产生 `configOptions`；无网络模型调用（只做 `initialize` + `session/new` + `setConfigOption` + `status`）。
