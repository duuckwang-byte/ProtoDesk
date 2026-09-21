# CLI 权限矩阵（只读调研）

> 方法：仅跑 `--help / --version` 类只读命令，cwd 固定系统 Temp（`C:\Users\allow\AppData\Local\Temp\opencode`），未在仓库目录 spawn 任务，未做写文件试验。未安装项标“未安装 / 按文档”。
> 适配器真相源：`runtimes/registry.js`（26 家）+ `runtimes/defs/*.js` + `runtimes/defs/manifest.json`（factory 条目）。
> 实测版本：`agy 1.2.7` / `opencode 1.18.31`（`opencode-cli` 未装，用 fallback `opencode`）/ `qoderclicn 1.1.59`（`qodercli` 未装，用 fallback CN 版）/ `dsh 0.1.2-rc.1` / `reasonix v1.19.3`。

| 适配器 id | bin | 当前适配器放行旗 | 收紧候选项 | 工作区限定参数 | 收紧风险（无人值守） | 建议 | 状态 |
|---|---|---|---|---|---|---|---|
| opencode | opencode-cli (fallback opencode) | 无放行旗（`run --format json --thinking` + `--dir`） | 已是收紧态；可选 `--agent` 换只读 agent / 配置文件 deny 规则 | `--dir`（适配器已用） | 无（默认即审批态） | 保持 | 已安装实测 1.18.31 |
| claude | claude | `--permission-mode bypassPermissions`（全放行） | `--permission-mode acceptEdits / plan / default / auto / dontAsk`，`--allowedTools/--disallowedTools`（按文档） | `--add-dir`（按文档） | 高：切 plan/default 会弹审批挂起；acceptEdits/auto 风险低 | 可试点收紧（先 acceptEdits） | 未安装 / 按文档 |
| cursor-agent | cursor-agent | `--force`（全放行，`--yolo` 别名） | 去 `--force`；`--mode plan/ask`、`--sandbox enabled`（按文档） | `--workspace`（适配器已用） | 高：去 force 后 `-p` 默认只提议不落地，会“静默不改” | 需自研兜底（先 sandbox，不直去 force） | 未安装 / 按文档 |
| codex | codex | 非典型全放行：`exec --json --skip-git-repo-check`（仅跳过 git 检查，未加 sandbox 放行） | `--sandbox read-only / workspace-write` + `--ask-for-approval on-request / never`，新版 profiles `:read-only / :workspace / :danger-full-access`（按文档） | `-C`（适配器已用）+ `--add-dir / --cd`（按文档） | 高：`on-request` 在非交互下会挂起；`never + read-only` 才可无人值守 | 保持（要收紧需自研超时/降级兜底） | 未安装 / 按文档 |
| deepseek-harness | dsh | 无放行旗（`--profile open-design --stdio`） | 无（harness 层无审批旗；靠 profile 插件约束） | 无显式参数 | 无 | 保持 | 已安装实测 0.1.2-rc.1 |
| qwen | qwen | `--yolo`（全放行） | `--approval-mode default / auto_edit / plan` + `-s/--sandbox`（Gemini 系按文档） | `--add-dir` 系（按文档，待实测确认 `--include-directories` 变体） | 中高：plan/default 会审批挂起；auto_edit 风险低 | 可试点收紧（先 auto_edit） | 未安装 / 按文档 |
| deepseek | deepseek (fallback codewhale) | `exec --auto`（自动批准） | 去 `--auto` / `--approval-mode` 系（按文档，待实测） | 靠 cwd（按文档，待实测） | 高：去 auto 即回交互 | 保持（需自研兜底才能动） | 未安装 / 按文档 |
| mimo | mimo | 无放行旗（`run --format json`） | 已是收紧态（按文档暂无审批档可加） | 靠 cwd（无显式旗） | 无 | 保持 | 未安装 / 按文档 |
| amp | amp | `--dangerously-allow-all` + `-x`（全放行） | 去 flag 走 `amp.permissions` allow/ask 规则、`amp.commands.allowlist`（按文档） | 无显式参数（靠 cwd） | 高：去 flag 后命令逐条审批 | 需自研兜底（先 allowlist，不直去 flag） | 未安装 / 按文档 |
| codebuddy | codebuddy (fallback cbc) | `--permission-mode bypassPermissions`（全放行，同 claude 系） | `--permission-mode acceptEdits / plan / default`（按文档） | `--add-dir` 系（按文档，待实测） | 高：同 claude | 可试点收紧（先 acceptEdits） | 未安装 / 按文档 |
| aider | aider | `--yes-always`（全放行；另带 `--no-git --no-auto-commits` 等伤害控制） | 去 `--yes-always`；`--dry-run / --read-only` 只读档（按文档） | 靠 cwd + 文件参数（无 `--add-dir` 式旗） | 高：去 yes 即回交互确认，批量任务必挂 | 保持（需自研兜底） | 未安装 / 按文档 |
| grok-build | grok | `--always-approve` + `--no-plan`（全放行） | 去 `--always-approve` / 加 `--plan`（按文档，待实测） | 无显式参数（按文档） | 高：审批回流 | 保持（需自研兜底） | 未安装 / 按文档 |
| antigravity | agy | `--dangerously-skip-permissions`（全放行） | `--sandbox`（终端限制）+ `--mode plan / accept-edits` + `--agent` 只读 agent | `--add-dir`（可重复，实测有） | 中：`--sandbox` 可能拦构建脚本；`plan` 只读不落地 | 可试点收紧 | 已安装实测 1.2.7 |
| atomcode | atomcode | `-y`（全放行） | 去 `-y`（按文档，待实测确认只读档） | 无显式参数（按文档） | 高：去 `-y` 即审批挂起 | 保持（需自研兜底） | 未安装 / 按文档 |
| amr | vela | 无放行旗（`agent run`） | ACP 层约束（按文档） | 无显式参数 | 无 | 保持 | 未安装 / 按文档 |
| copilot | copilot | `--allow-all-tools`（全放行；注意还有更大档 `--allow-all/--yolo = tools+paths+urls`） | `--allow-tool / --deny-tool` 白/黑名单精细化（按文档，适配器当前只用了 tools 子集） | `--add-dir`（路径校验；另有 `--allow-all-paths` 为反向放行，勿用） | 低中：allow-list + deny 高危（`rm`/`git push`）仍可无人值守 | 可试点收紧 | 未安装 / 按文档 |
| devin | devin | `--permission-mode dangerous` + `--respect-workspace-trust false`（全放行） | 切 safe/受信模式（按文档，待实测） | 靠 cwd（另有 trust 旗，反向） | 高 | 保持（需自研兜底） | 未安装 / 按文档 |
| hermes | hermes | 中放行：`acp --accept-hooks`（放行 hooks，非全工具） | 去 `--accept-hooks` / ACP 层 deny 规则 | 无显式参数 | 低中 | 保持（可试点去 hooks） | 未安装 / 按文档 |
| kilo | kilo | 无放行旗（`acp`） | ACP 层约束 | 无显式参数 | 无 | 保持 | 未安装 / 按文档 |
| kimi | kimi | 无放行旗（`acp`） | ACP 层约束 | 无显式参数 | 无 | 保持 | 未安装 / 按文档 |
| kiro | kiro-cli | 无放行旗（`acp`） | ACP 层约束 | 无显式参数 | 无 | 保持 | 未安装 / 按文档 |
| pi | pi | 无放行旗（`--mode rpc`） | RPC 层约束 | 无显式参数 | 无 | 保持 | 未安装 / 按文档 |
| qoder | qodercli (fallback qoderclicn) | `--yolo` + `-w`（全放行 + 工作区已限定；注：已装 CN 版 `--help` 未列 `--yolo`，疑隐式别名，显式档为 `--dangerously-skip-permissions`） | `--permission-mode default / accept_edits / dont_ask / auto` + `--allowed-tools / --disallowed-tools / --tools` + `--agent` | `-w/--cwd`（适配器已用）+ `--add-dir`（实测有） | 低中：`accept_edits` 仍自动改码，仅高危 shell 再问，加超时兜底即可 | 可试点收紧 ★ | 已安装实测（CN 1.1.59） |
| reasonix | reasonix | 无放行旗（`acp`；`run` 系默认 `--permission-mode ask`，适配器未走 run） | `acp -workspace-only` + `-sandbox-bash enforce` + `-sandbox-network on/off`（实测有）；`run` 系另有 `--permission-mode manual/ask/auto/acceptEdits/dontAsk/plan/bypassPermissions` + `--allowed-tools` + `--dir/--add-dir` | `-workspace-only` + `--dir/--add-dir`（实测有） | 无：纯加固边界，不改审批流 | 可试点收紧（零风险加固）★ | 已安装实测 v1.19.3 |
| trae-cli | traecli | `acp serve --yolo`（全放行） | 去 `--yolo`（按文档，待实测） | 靠 cwd（按文档） | 中高（待实测） | 需自研兜底（先实测再动） | 未安装 / 按文档 |
| vibe | vibe-acp | 无放行旗（空 args） | ACP 层约束 | 无显式参数 | 无 | 保持 | 未安装 / 按文档 |

## 结论：先试点哪 2 家（排序）

1. **qoder（P1）**：已装实测，收紧手段最全（`permission-mode accept_edits` + `allowed/disallowed-tools` + `-w/--add-dir` 双工作区限定），`accept_edits` 仍自动改码、无人值守基本不破，示范 Gemini 系白名单范式。
2. **antigravity `agy`（P2）**：已装实测，`--sandbox + --mode plan/accept-edits + --add-dir` 三件套齐，`plan` 可先用于只读任务零风险验证，再扩到 `accept-edits`，示范 Claude 系 sandbox 范式。
3. 备选零风险加固：**reasonix**（`acp -workspace-only + -sandbox-bash enforce`，不改审批流，随时可加）；**copilot**（`--allow-all-tools` → `--allow-tool/--deny-tool` + `--add-dir`，文档成熟，但本机未装，需装后实测）。

## registry 核对（26 家一一对应、无遗漏）

`runtimes/registry.js` → `BASE_AGENT_DEFS` 共 26：opencode / claude / cursor-agent / codex / deepseek-harness / qwen / deepseek / mimo / amp / codebuddy / aider / grok-build / antigravity / atomcode / amr / copilot / devin / hermes / kilo / kimi / kiro / pi / qoder / reasonix / trae-cli / vibe。上表 26 行逐一对应，其中 bespoke 14（opencode, claude, cursor-agent, codex, deepseek-harness, qwen, deepseek, mimo, amp, codebuddy, aider, grok-build, antigravity, atomcode）+ factory 12（amr, copilot, devin, hermes, kilo, kimi, kiro, pi, qoder, reasonix, trae-cli, vibe），与 `manifest.json` driver 划分一致。全放行约 14 家：claude / cursor-agent / qwen / deepseek / amp / codebuddy / aider / grok-build / antigravity / atomcode / copilot / devin / qoder / trae-cli。

## 档位配置字段约定与各家映射（def 侧能力，配置落盘不动）

- 字段：`options.permissionMode`（字符串）。缺省（未传 / 非字符串 / 空 / 全空白）即现状，`buildArgs` 逐字返回原 argv；仅显式传入非空值才改变 argv。
- 本轮只做 def 侧“认这个字段”的能力；`ai-config-store` 落盘 / UI 配置不动。

| def（`runtimes/defs`） | 缺省（现状，原样） | 显式 `permissionMode` 映射 | 备注 |
|---|---|---|---|
| claude（`claude.js`） | `--permission-mode bypassPermissions`（位置：`--verbose` 后、`--model/--resume` 前） | 非空即 `--permission-mode <值>` 原位替代（如 `acceptEdits / plan / default`，按上表收紧候选项） | 仅显式时替换值，顺序不动 |
| codebuddy（`codebuddy.js`） | `--permission-mode bypassPermissions`（位置：末尾，`--model/--resume` 后） | 非空即 `--permission-mode <值>` 原位替代（同 claude 系） | 仅显式时替换值，顺序不动 |
| qoder（`qoder.js`，工厂委托 + 薄包装，`manifest.json` 未动） | `-p --output-format stream-json --yolo`（+ `-w/--model` 按原装配） | 非空即追加 `--permission-mode <值>`（如 `accept_edits`；默认 `--yolo` 不动） | 已读 `opendesign/.../defs/qoder.ts`：注释仅确认 `--yolo` 为文档化非交互旗，未确认原生参数名；参数名/取值（`default / accept_edits / dont_ask / auto`）按上表，待实测 |
| antigravity（`antigravity.js`，即 `agy`） | `--dangerously-skip-permissions`（首位；后接 `--model/--effort --output-format stream-json -p`） | 仅 `=== 'plan'` 时换成 `--mode plan`（首部两槽替换，其余顺序不动）；其余值（含 `accept-edits`）暂保持现状 | 本文件此前无 `--mode` 取值注释，取值按上表（`--mode plan / accept-edits`）；本轮仅映射 `plan`，其余待实测后再扩 |
| 其余 22 家 | 均保持现状（本轮未改） | 未映射，传入也无变化 | 后续按需再扩 |
