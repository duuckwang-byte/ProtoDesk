# PlanD ACP 当前状态与交接

> 日期：2026-11-12
> 用途：上下文压缩后的交接摘要。详细设计见 `docs/ACP-产品方案.md`、`docs/ACP-技术方案.md`、`docs/ACP-三Agent连通开发计划.md`。

## 1. 一句话状态

qoder / opencode / agy / codebuddy 四 Agent 的**工具内 AI 弹窗**验收全部 PASS；T7a/b/c（模型目录缓存、非阻塞目录、多 Agent 归属）与 T5c（选中模型即探测 ACP 配置）已完成；全量测试 **63/63 通过**；独立 `aiwin` 窗口已删除；模型管理菜单 / 获取模型弹窗已拆分。

## 2. 关键决策

- AI 会话界面：**工具内 `#aiMask` 弹窗**，不再有独立 `aiwin` BrowserWindow。
- ACP 运行时：`acpx@0.22.0`，Electron 37.10.3（内置 Node 22.21.1）。
- 不新增 IPC 通道；当前契约 **70 通道**（删除 `aiwin:open/close/toggle`、`ai:remote-send`）。
- ACP 模型/上下文/思考强度统一走 **Session Config Options**：
  - `category:"model"` → 模型
  - `category:"model_config"` → 上下文大小等
  - `category:"thought_level"` → 思考强度
- 模型选择只在新建会话时作为初始值；已有会话用 `setConfigOption`。
- 清空/新会话使用 `freshSession` / `prepareFreshSession`，真正重置 Agent 上下文。

## 3. 已完成

### 文档

- `docs/ACP-产品方案.md`：产品范围、页面/交互改动、权限策略、验收标准。
- `docs/ACP-技术方案.md`：acpx 架构、IPC/事件、事件映射、权限桥、测试与阶段计划。
- `docs/ACP-三Agent连通开发计划.md`：三 Agent 修复顺序、验收矩阵、codebuddy 决策记录。

### 代码

- `runtimes/acp-capabilities.js`：20 个 ACP Agent 能力表；codebuddy 已接入（`--acp`），agy 已改为 `agy acp`。
- `runtimes/registry.js`：统一挂 `transport/acp`。
- `runtimes/resolution.js`：增加 `%LOCALAPPDATA%\agy\bin`、`%LOCALAPPDATA%\Programs\agy\bin`。
- `main/acp/acp-service.js`：acpx 动态 import / 单例壳。
- `main/acp/acp-registry.js`：`resolveAgentCommand`、`buildAcpOverridesDetailed`、command 失败回落 bin、unresolved 原因。
- `main/acp/acp-config.js`：模型目录、白名单交集、默认模型、configOptions 归一化、思考强度/上下文规划、错误脱敏。
- `main/acp/acp-model-cache.js`：ACP 模型目录磁盘缓存（原子写、坏文件回空、TTL / stale 判定）。
- `main/acp/acp-runtime.js`：session/new、startTurn、事件映射、权限桥、取消、`getStatus`、`setConfigOption`、`prepareFreshSession`、`previewModelConfig`（`previewChain` 串行）、`acp_config`、`permission_resolved`、错误 `detail`。
- `main/acp/acp-event-mapper.js`：text/thinking/tool_call/plan/usage/commands。
- `main/acp/acp-permission-bridge.js`：权限等待/超时/取消；按 Agent + 会话复合键取消待决请求。
- `main/acp/acp-errors.js`：`detailCode`、`ENOENT`/spawn 错误、`ACP_MODEL_UNSUPPORTED`。
- `main/services/ai-process-service.js`：ACP 分流、`inspectAgentModels`、`probeAcpModelConfig`（`probeModel` 分支）、`resolveModelChoice`、`requestedModel`/`globalModel`/`freshSession`/`acpSessionId` 映射；模型目录“缓存优先 + 后台刷新”。
- `main/services/ai-config-store.js`：`acp` 配置默认值/清洗/合并。
- `js/project-ai-export.js`：工具内弹窗 ACP 会话 id、模型列表、`acp_config`、错误 detail、清空 freshSession；非阻塞模型目录、会话 Agent 归属、权限卡按 Agent 过滤；`aiAcpProbe*` 选中模型预探测与结果归属。
- `app.css`：ACP 徽标、权限卡、错误 detail、模型空态等。
- 设置页：ACP 运行时开关、权限模式、Agent `ACP/兼容` 徽标。

### 模型目录与多 Agent 归属（T7a/b/c）

- **模型目录磁盘缓存**：`userData/acp-model-catalog.json`，key = Agent + 启动命令（`<agentId>::<command>`），TTL 10 分钟；过期条目先展示（stale-while-revalidate），坏文件 / 版本不符回空且不抛错，写入采用临时文件 + rename 原子替换。
- **探测顺序**：内存缓存 → 磁盘缓存 → CLI 原生模型命令 → ACP fallback；ACP 探测转后台，刷新完成后经 `ai:event` 的 `acp_catalog` 事件回推，同一 key 并发去重，失败保留旧目录、不回空列表。
- **事件与权限归属**：ACP 事件信封补齐 `agentId` / `agentName` / `workdir`；权限取消使用 Agent + 会话复合键，避免跨 Agent / 跨会话误取消。
- **前端**：模型目录非阻塞（`refreshing` / `stale` 状态可见），会话记录 Agent 归属，`acp_catalog` 与权限卡均按当前 Agent 过滤，跨会话 `acp_config` 不写当前 UI。

> 注：`userData/acp-model-catalog.json` 属运行数据，可安全删除；删除后下次打开模型列表会重新探测（冷启动会慢一些）。

### 模型管理与配置探测（T5c）

- **模型管理拆分**：模型管理菜单只显示已选模型；「获取模型」弹窗显示全量目录，已选项打勾；搜索只过滤显示，不改变勾选状态。
- **选中模型即探测**：复用既有 `ai:models` 的 `probeModel` 分支读取该模型 `configOptions`，不新增 IPC、不跑模型目录探测、不启动 turn；同一 Agent + 会话 + 模型去重，旧响应按 `requestId` 丢弃，结果只应用于仍匹配当前会话 / Agent / 模型。
- **发送即生效**：选中 `Xhigh` 发送后，首轮 `acp_config.thoughtValue=xhigh`，不再需要等第二轮。主进程 `previewChain` 串行探测；切换模型后若旧档位非法，会补一次 `getStatus` 并按新公告重算思考强度，使本轮 `acp_config` 直接携带新模型 options。

### 测试

- `tests/run-all.js`：已纳入 **63 套**，最近全量结果 **total=63 / pass=63 / fail=0（ALL_PASS）**。
- 模型管理专项：`verify-model-management`、`verify-model-fetch`、`verify-acp-config-ui`（覆盖已选模型 / 全量弹窗 / 搜索过滤 / 思考强度选项）、`verify-acp-model-probe`（覆盖单模型探测 / 不支持模型 / busy / 不启动 turn / 静态接线）。
- ACP 专项：`verify-acp-capabilities`、`verify-acp-resolution`、`verify-acp-config`、`verify-acp-session`、`verify-acp-runtime`、`verify-acp-wiring`、`verify-acp-ui-wiring`、`verify-acp-errors`、`verify-acp-permission`、`verify-acp-permission-ui`、`verify-acp-settings-ui`、`verify-acp-model-cache`、`verify-acp-models-nonblocking`、`verify-acp-catalog-ui`、`verify-acp-model-probe`。
- `tests/acp-live-smoke.js`：手动真实 Agent 验收（不加入 run-all）。

## 4. 四 Agent 真实验收结果

| Agent | 命令 | 模型 | 结果 |
|---|---|---|---|
| opencode | `C:\Users\allow\AppData\Roaming\npm\opencode.cmd acp` | `opencode-go/deepseek-v4.1-flash` | PASS，返回 OK |
| agy | `C:\Users\allow\AppData\Local\agy\bin\agy.exe acp` | `gemini-3.8-flash` + `thought_level=high` | PASS，返回 OK |
| qoder | `C:\Users\allow\.qoder-cn\bin\qoderclicn\qoderclicn-1.1.86.exe --acp` | `auto` | PASS，返回 OK |
| codebuddy | `D:\AppFile\codebuudy\codebuddy.cmd --acp` | `hy4free` | PASS，返回 OK（ACP 17 个模型） |

工具内弹窗验收（qoder / opencode / agy / codebuddy）：`#aiMask` 正常打开，ACP session id 正确写回，权限卡/错误卡为 0，四 Agent 全部 PASS。全量测试 63/63 通过。

## 5. 关键模型事实

- opencode：ACP 公告 521 个模型；用 `opencode-go/deepseek-v4.1-flash`。不要用 `deepseek-chat`；默认 `openrouter/nex-agi/nex-n2.6` 可能额度不足。
- agy：ACP base 模型 5 个：`gemini-4-argon`、`gemini-3.8-flash`、`claude-opus-5-5`、`claude-sonnet-5-5`、`gpt-oss-120b-medium`；`-high/-medium/-low` 是 legacy 变体，ACP 不接受，改用 `thought_level`。
- qoder：ACP 13 个模型，含 `auto`、`fast`、`Qwen...`；用 `auto` 最稳。
- codebuddy：`@tencent-ai/codebuddy-code@2.181.0`，命令 `D:\AppFile\codebuudy\codebuddy.cmd`；入口 `codebuddy --acp`，无需 adapter。ACP 17 个模型，当前/回退 `hy4free`（另有 `hy4std`、`hy3`、`hy3-x`、`glm-5.3`、`deepseek-v4.1-flash`、`kimi-k3.1-pro` 等）；能力表为 `codebuddy: { args:['--acp'], adapter:'' }`。

### 思考强度与选中模型预探测（实测）

- `opencode-go/muse-spark-1.3-contributor`：发送前显示 6 档 `minimal` / `low` / `medium` / `high` / `xhigh` / `default`。
- `opencode-go/deepseek-v4.1-flash`：显示 4 档 `low` / `high` / `max` / `default`。
- `opencode-go/musespark1.3` **不是有效 id**，不要使用；另有 `opencode/muse-spark-1.3`。
- 选中模型即探测 ACP 配置：选中 `Xhigh` 发送后 `acp_config.thoughtValue=xhigh`，不再需要等第二轮。
- 当前限制：
  - 冷启动首次探测约 10s；等待期间可点「使用默认（不等待）」直接按 Agent 默认值发送。
  - 快速切换模型时探测由主进程 `previewChain` 串行执行，旧响应被丢弃。
  - 模型已切换、但思考值在新旧模型都合法时，首轮 `acp_config` 的 `options` 可能仍是切换前快照，下一次探测会刷新。

## 6. 已知问题 / 待办

1. **旧白名单**：`visibleModelsCli.antigravity` 仍有 `gemini-3.8-flash-high`；ACP 会拒绝，当前逻辑降级全量并 warning，建议清理。
2. **`#aiCli` 版本徽标**：非 opencode Agent 仍显示 `vopencode v2.0.16`，显示层小问题。
3. **codebuddy multitask 布尔项**：ACP 公告的 `multitask` 为布尔配置项，当前 `acp_config` 选择器只渲染 select，布尔开关待补。
4. **思考内容展示**：thinking 事件已映射，前端展示仍待完善/确认。
5. **P2 未做**：MCP、subagents、fork、compaction、session list/delete/close UI。

## 7. 建议下一步

1. **T5b 已完成（2026-11-12）**：`configOptions` 的 `model_config` / `thought_level` / `mode` 已渲染为选择器；选择值随下一轮 `ai:ask` 的 `extra` 传入（`requestedThought` / `acpConfig`），未新增 IPC。
2. **T7a/b/c 已完成（2026-11-12）**：模型目录磁盘缓存、CLI 原生命令优先 + 后台 `acp_catalog`、事件 Agent 归属、前端非阻塞与按 Agent 过滤均已落地。
3. **T9 已完成（2026-11-12）**：四 Agent 工具内弹窗全部 PASS，全量测试 63/63。
4. 收尾非阻塞项：清理 `visibleModelsCli` 旧 `-high` 白名单，补 `#aiCli` 版本显示，补 codebuddy `multitask` 布尔开关，完善思考内容展示。
5. 排期 P2：MCP、subagents、fork、compaction、session list/delete/close UI。

## 8. 常用命令

```powershell
node tests/run-all.js
node tests/verify-acp-model-cache.js
node tests/verify-acp-models-nonblocking.js
node tests/verify-acp-catalog-ui.js
node tests/verify-model-management.js
node tests/verify-model-fetch.js
node tests/verify-acp-config-ui.js
node tests/verify-acp-model-probe.js
node tests/acp-live-smoke.js --agent opencode --model opencode-go/deepseek-v4.1-flash
node tests/acp-live-smoke.js --agent antigravity --model gemini-3.8-flash --thought high
node tests/acp-live-smoke.js --agent qoder --model auto
node tests/acp-live-smoke.js --agent codebuddy
```

## 9. 当前环境状态

- 开发态 `.devdata/ai-config.json` 已恢复原状。
- codebuddy `C:\Users\allow\.codebuddy\settings.json` 已补 `trustedDirectories`（项目 `.devdata/sandbox`、`%APPDATA%/原型工具/sandbox`），原文件备份为 `settings.json.bak-20261112-085601`。
- 验收用 dev Electron 已关闭；未影响用户 `桌面端\win-unpacked` 进程。
- `%APPDATA%/原型工具` 除运行数据外未修改。
- `userData/acp-model-catalog.json`（即 `%APPDATA%/原型工具/acp-model-catalog.json`）属运行数据，可安全删除以重新探测模型目录。
- 代码未提交 git。
