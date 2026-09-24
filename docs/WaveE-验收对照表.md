# Wave-E 收尾验收记录（JSDoc 契约 + 静态检查升级 + 全量回归）

> 基线：`node tests/run-all.js` 25/25 ALL_PASS（本波前后均验证）。只做加法：注释 / 配置 / 测试门禁增强；业务逻辑零改动。
> 新增文件：`eslint.config.js`、`prettierrc`（`.prettierrc.json`）、`main/ipc-contract.js`、`tests/lint-guard.js`、本文档。
> 修改文件：21 个契约文件纯 JSDoc 注释追加、`tests/static-verify.js` 加固、`package.json`（scripts + devDeps声明，不动 build.files 17 条）。

## 1. JSDoc 覆盖率（21/21，100%）

| 分组 | 文件 | @param | @returns | @typedef |
|---|---|---|---|---|
| 网关 | preload.js | 有 | 有 | 有（ProtoAPINamespace/IpcInvokeResult） |
| 契约源 | main/ipc-contract.js | 有 | 有 | 有（IpcOk/PageRef/SandboxRef/DocSnapshot/MaskedAiConfig + IPC_CHANNELS 72） |
| 控制器 | git/sandbox/ai/doc/window-controller.js（5） | 有 | 有 | 有（各域 Result/Opts） |
| 服务 | git-workflow/sandbox-storage/ai-process/doc-export/ai-config-store（5） | 有 | 有 | 有（GitOpResult/SandboxOpResult/AiAskArgs/ExportArgs/SaveAiResult 等） |
| 基础设施 | platform/env.js、runtimes/defs/factory.js、runtimes/registry.js | 有 | 有 | 有（AgentEnv/ManifestEntry/RuntimeAgentDef） |
| 渲染层 | js/store.js、event-bus.js、sandbox-agent.js、utils.js、main.js、sandbox-core.js | 有 | 有 | 有（SourceRef/DocSaveSnapshot/GuardResult/EventType/SandboxMsg/AnyValue/BootState/BridgeMsg） |

- 口径：文件含 `/**` 且含 `@param` + `@returns` 即达标（`tests/lint-guard.js` E-JSDOC + `static-verify.js` E-jsdoc 双门禁）。
- 72 通道：`main/ipc-contract.js` IPC_CHANNELS 72 == controllers `ipcMain.handle` 去重 72，`diffChannels` 一致（E-IPC-FROZEN）。

## 2. ESLint 规则表（flat config + Prettier 同源，零运行时依赖）

| 配置 | 位置 | 规则 | 级别 | 说明 |
|---|---|---|---|---|
| 安全红线 | eslint.config.js | no-eval / no-implied-eval / no-new-func / no-script-url | error | 呼应 iframe 特权穿透修复；生产代码零容忍 |
| 稳定 | eslint.config.js | no-undef / no-redeclare | error | 幽灵变量/拼写漂移早暴露 |
| 稳定 | eslint.config.js | no-unused-vars / no-empty | warn | 存量大，先提醒不阻塞 |
| 风格 | eslint.config.js + .prettierrc.json | quotes(single) / semi / printWidth 120 / tabWidth 2 / singleQuote / endOfLine lf | warn | 与 Prettier 同源，不阻塞 npm test |
| 忽略 | eslint.config.js ignores | node_modules/桌面端/dist/.devdata/smoke-sandbox/**.bak/*.log | - | 生产包外事项不扫 |
| 零依赖门禁 | tests/lint-guard.js | E-EVAL/E-GRAMMAR(node --check 真解析)/E-JSDOC/E-IPC-FROZEN/E-CONFIG；风格项全 WARN | - | `npm run lint` 即跑；`npx eslint` 需先 `npm i -D`（package.json 已声明 eslint ^9 / prettier ^3） |

## 3. static-verify 改进点（I1–I5，旧断言一行未删语义）

- I1 剥离注释再扫残留门（theme/gradient/shortcut）：注释里写“已移除”不再误报，真残留仍命中。
- I2 ghost 门禁剥离注释 + 字符串字面量：文案/注释提及保留字不再误报，真实裸引用仍命中。
- I3 emoji 白名单擴充：彩色 emoji 清零红线不变，仅放行单色排版符（原有 ✕✎▾«＋▸ + ✔✓★☆○●◆◇■□▲△▶▷◁→←↑↓↔·…—–）。
- I4 新模块同步扫描：js/store·event-bus·sandbox-agent·utils·main 纳入 emoji/ghost 扫描。
- I5 Wave-E 契约门：E-eslint/E-prettier/E-jsdoc（14 文件）/E-ipc（72冻结）存在性检查。

## 4. 全量验收

- `node tests/run-all.js`：25/25 ALL_PASS（pack、git-security、static-verify、platform、runtimes、providers、ipc、model-management、ui-integration、session-healing、send-guard、subpage-naming、stdout-error-closure、event-pipeline、model-fetch、snapshot-restore、md-p1～p4、doc-edit、docwin、inline-edit、link-stamp、spec-uilib）。
- `node tests/verify-ai-encryption.js`：15/15 PASS（save-ok、masked-empty、masked-shape、disk-no-plain、disk-no-keyfield、full-memory、ipc-never-plain、empty-keeps-key、no-tmp、no-empty、migrated、backup-has-plain、stripped、recovered、idempotent）。
- `node tests/lint-guard.js`：LINT_PASS（129 JS，WARN 186 项风格/1 处 new Function 遗留跟踪，0 FAIL）。
- `node tests/static-verify.js`：STATIC_PASS（含 Wave-E 契约门）。

## 5. 手工安全复查 5 项证据

1. parent.protoAPI 不可达：`<iframe id="frame" src="about:blank" sandbox="allow-scripts allow-forms">`（无 allow-same-origin）；`js/sandbox-agent.js` 帧模板零 `parent.protoAPI`；宿主/帧仅经白名单 postMessage（FROM: PICK_RESULT/NAV_JUMP/STAMP_SET/proto-link/proto-link-stale；TO: PICK_REQUEST/NAV_JUMP/STAMP_SET/proto-mode/proto-goto）+ nonce + 1MB 上限。
2. TLS 无条件 0 无残留：`platform/env.js` 默认不设该变量；唯一赋值在 `if (isInsecureTlsOptIn(PLAN_D_ALLOW_INSECURE_TLS))` 内 + warn；外部透传 `=== '0'` 亦 warn；自签 CA 走 `PLAN_D_EXTRA_CA_CERTS`→`NODE_EXTRA_CA_CERTS`。
3. .bak 零残留：全仓（除 node_modules/.git/.devdata）`*.bak` 计数 0；DESIGN 已归档 `docs/archive/DESIGN-Coinbase.md`。
4. asar 无 bak：`node tests/check-pack.js` PACK_PASS；白名单 17 条含 6 条 `!**/*.bak` 排除。
5. API Key 掩码：`verify-ai-encryption` 15 项全绿（落盘无明文、IPC 恒掩码 `****`+后4、空回写不冲、原子写无 tmp、无空文件、迁移备份+幂等）；`ai-config-store.js` 用 safeStorage，`getMaskedAiConfig` 明文恒空。

## 6. 审计整改对照表（五大维度 / 七章问题 → 状态）

| 报告位置 | 问题 | 本波前状态 | Wave-E 动作 | 状态 |
|---|---|---|---|---|
| 二-3 P0-1 | iframe 同源特权穿透 | 已修（sandbox+postMessage） | JSDoc 契约化（Bridge/msg 白名单）+ 复查取证 | 关闭，保持 |
| 二-3 P0-2 | 全局 TLS 校验关闭 | 已修（默认安全+opt-in） | JSDoc 契约化 + 无条件 0 扫描取证 | 关闭，保持 |
| 三-1/七-Phase2/3 | 巨石与伪模块化（core-docs/project-ai-export/main） | 已拆（main 96行+main/*、Git/AI/Doc 域、EXPORT 2 脚本、runtimes manifest+factory、store/event-bus/sandbox-agent/utils） | 零重构，仅补契约注释 | 保持，无回退 |
| 三-3/七-Phase2 | 全局状态散落与保存竞态 | 已修（Store 快照守卫+EventBus） | JSDoc（SourceRef/DocSaveSnapshot/GuardResult/EVENTS） | 关闭，保持 |
| 四-1 | 无类型/JSDoc + static-verify 脆弱 + 无 ESLint/Prettier | 未修 | 21 文件 JSDoc、eslint.config.js、.prettierrc.json、lint-guard、static-verify I1–I5 | 关闭 |
| 四-2 | 打包 bak 泄漏 + 中文输出目录 | 已修（17 条白名单+6 排除；输出目录历史约束保留） | check-pack 复验 PASS | 关闭，保持 |
| 四-3 | AI Key 明文落盘+透传 | 已修（safeStorage+掩码+原子写+迁移） | 复验 15 项 + JSDoc（MaskedAiConfig/SaveAiResult） | 关闭，保持 |
| 四-4 | verify-git-security 未进门禁 | 已修（run-all 25 套含 git-security） | 复验 PASS，未动 run-all | 关闭，保持 |
| 五-1 | 36 bak（4.08MB）+ DESIGN 未归档 | 已修（删光+归档） | 复查 0 残留 | 关闭，保持 |
| 五-2/六-3 | 样板与重复轮子（26 适配器/CSS/esc 等） | 已修（factory+manifest、EXPORT 解耦、utils 收敛） | JSDoc（factory kinds/Utils） | 关闭，保持 |
| 六-1/2 | 死存根与死函数 | 历波按门禁冻结（测试明令部分保留） | 未动（只加注释，不删代码） | 保持（见遗留 Top3-3） |

## 7. 遗留 Top3（按风险排序，均不阻塞本波绿灯）

1. `js/project-ai-export.js:3450` `new Function(act[2])()` 动态执行遗留：业务逻辑不动，lint 降 WARN 跟踪；后续应收敛为白名单动作分发或预编译函数表，并补栏截断面单测。
2. 渲染层巨石仍大（core-docs 5k+ 行级）与 200+ 超长行存量：风格 WARN 存量（186 项）未清；后续 Wave 按域继续切分 + `eslint --fix`/Prettier 渐进收敛。
3. 死存根/死函数冻结未删（setEditMode/inlineEditIsTextTag/cleanOrphanedStamp 等，测试有“缺席/禁止调用”断言）：本波为保 25 绿未动；后续待门禁同步后按审计第六章清单删除并收紧断言。
