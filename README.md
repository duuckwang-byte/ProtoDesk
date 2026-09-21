# PRTool · 原型预览工具

原型 + 文档一体化工具（Electron 桌面端）。以「项目制沙箱」组织原型，本地 CLI驱动，生成/修改原型与文档，支持快捷选中页面元素提交至CLI进行修改、原型和文档一屏展示。

## 功能

### 组织与管理

- **项目制沙箱**：`%APPDATA%/原型工具/sandbox/<项目>/<原型>/`，一个项目一个文件夹、一个原型一个子文件夹（html + md + links.json 同放）。打开应用先弹窗选择进入哪个项目，**一个窗口只展示一个项目**；侧栏顶部显示当前项目名，点击随时切换；支持项目新建 / 重命名 / 删除（默认项目保护不可删）

### 原型预览与文档

- **原型 + 文档同屏**：左侧源列表切换原型，右侧展示该原型的功能说明；工具左上角与文档标题统一显示**当前原型名称**
- **端别切换**：移动端 / PC 端一键切换布局（按文件名与内容启发式自动识别，可手动纠正）
- **内容缩放**：50%~150% 预设或直接输入，Ctrl+滚轮微调，双击舞台复位 100%
- **结构化功能说明**：md 采用 `## 页面 <标题>（<路由key>）` 分章节格式，整篇一次渲染全部章节；「目录」弹窗点击定位到对应章节（蓝色背景闪烁两次后自动关闭）；文档支持 Markdown 直接编辑并保存回写沙箱 md
- **最新需求**：每个原型目录独立的 `最新需求.md`，跟随原型读写，记录当前迭代需求

### 跳转绑定（LinkBind）

- **配置**：按住 Ctrl 点击原型元素打开检查器，为该元素配置「跳转至」目标原型与页面；绑定关系持久化在原型目录 `links.json`
- **预览**：点击已绑定元素直接跳转目标原型的对应页面；悬停显示「跳转至 …」气泡与描边提示；链接徽标实时计数
- **联动**：与编辑模式互斥广播；切换原型/AI 刷新后自动重载绑定；导出 HTML 内嵌绑定数据（`__EXPORT_LINKS__`），离线打开跳转依然可用

### AI 设计

- **参考open-design实现的本地 CLI驱动**：不自写Agent或者AgentAPI调用逻辑，将任务完全交给本地CLI，你可以任意使用自己本地的skill、插件、MCP等。工具中的API连接方式，实际由本地安装的opencodeClI驱动，使用前必须安装opencodeCLI。
- **快照回滚**：每次 AI 任务前自动保存原型快照（每原型保留最近 10 份，超出删最旧）；AI 对话弹窗「 历史」查看并一键恢复任意版本，恢复前自动备份当前状态（undo 快照
- **Ctrl 即时拾取（CTRL_PICK）**：按住 Ctrl 点击拾取元素，支持多选 / toggle 反选 / 覆盖层角标，松开 Ctrl 批量提交（批量统一与独立双 Tab）；待提交队列含唯一 CSS 选择器 + 页面路由 + `所属文件 htmlFile`，提交头含`涉及文件清单`约束只改所属文件；旧预览/编辑模式开关已下线（`setEditMode` 仅存根告警）
- **多 HTML 子页面**：一原型文件夹可含多 HTML（主页同名，其他为子页），支持新建 / 重命名 / 删除子页面，`loadSubPage` 切换，刷新保持子页，标注与待提交队列按 `htmlFile + page` 双隔离
- **模型显示管理**：设置模型管理 Tab + 顶部模型下拉按引擎过滤；CLI / API 双可见性（`visibleModelsCli / Api`）+ 自定义（`customModelsCli`）即时落盘，空过滤防呆回退`默认推荐模型（CLI 预设）`，`-free` 统一清洗，切换 Agent 清空缓存并刷新；获取模型弹窗勾选即时写入管理页（无需确认，搜索过滤不丢勾选，管理页已有默认勾上）
- **Git 协同**：顶栏 Git 下拉（上传发布 / 拉取同步 / 仓库设置）；单远端单库模型（本机唯一库，全部项目共用一个远端，保存即改写全局）；上传目标分支 / 拉取来源分支（仅本次远端分支名，不切换本地工作区）；选择性上传拉取（拉取用远端覆盖本地前需确认，可自动备份）；切远端 / 跨项目推送 / 强制覆盖需二次确认；沙箱异常（嵌套库缺失损坏）需确认后备份修复，不静默删除
- **需求标注**：零污染 Sidecar（`annotations.json`，`proto:annotations:read/save`），角标显隐 / 序号附着 / 总览抽屉 / 点击定位闪烁 / Popover，导出内嵌
- **AI 双 Tab 与事件管道**：大模型弹窗双 Tab（需求对话 + DSH 运行日志），`ai:ask → startAgentExecution` 分流（BYOK 走 opencode 桥接）；对话流严格按事件到达顺序时间线穿插展示：已探索聚合（N 次读取 + 文件 chips）/ 思考逐句落子（标点切分，围栏保护，进行中光标，末 1500 字截断，全文进思考链弹窗）/ 编辑行（进行中→完成 `+N −M`，行数来自行级 diff，失败回落纯文件名）/ Shell 行（命令 + 完成/失败 tag）/ 最终回答 + 落款（时间 + 复制纯文本）；回滚卡浅灰整行样式（一键回滚，类名不变）；“文件变更审计”卡已删除（信息由编辑行承载）；静默超 30 秒变黄提示“可能停滞”（长工具调用窗口不误报）；会话自愈与 stdout 错误闭环；发送前会话校验失败不吞输入框内容；历史会话存事件流 v2（`[{t,text,file,added,deleted,ts}…]`，回放与直播像素一致，旧格式只读降级）；后台自动刷新无项目时静默不打扰，仅手动刷新才提示选项目

### 错误提示与日志

- 操作失败右下角 **toast** 轻提示（不阻塞操作）；本地日志 `%APPDATA%/原型工具/logs/app-日期.log`（启动时自动清理 7 天前旧文件）

### 导入导出

- **导出**：勾选多个原型合并为一个独立 HTML（样式 / 脚本 / 功能说明 / 跳转绑定 / 最新需求全部内嵌），任何环境离线打开可用，左下菜单切换原型；查看器自动剥离全部工具性 UI
- **导入**：「＋ 新增原型」选择 HTML 即复制进当前项目沙箱（同名 md 一并带入）；可识别本工具导出的合并文件并自动拆分还原为多个原型

## 快速开始

```bash
# 安装依赖
npm install

# 启动（开发模式，数据隔离在 .devdata/）
npx electron .

# 打包 Windows 安装版（NSIS，可选安装目录）
npm run build   # 或 npx electron-builder --win --x64
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `原型+文档.html` | 主界面入口（内联 UI 结构，样式/脚本外链） |
| `app.css` | 主界面样式 |
| `js/icons.js` | 图标系统（内联 SVG，`data-ic` 占位替换，随导出内嵌） |
| `js/mask-manager.js` | 统一遮罩栈 + 单一 Esc 监听（弹窗/抽屉双关闭治理） |
| `js/core-docs.js` | 文档解析/渲染/编辑 + 功能说明面板 + 目录（TOC） |
| `js/nav-zoom.js` | 页面导航同步 + 舞台缩放 |
| `js/sandbox-core.js` | 全局状态 + 端别判定/切换 + 原型加载 + 源列表/虚拟分组/右键菜单 |
| `js/project-ai-export.js` | 项目选择 + 沙箱扫描 + 设置（Agent 矩阵 / API 多配置卡片 / 模型管理）+ AI 对话（双 Tab / 时间线事件流：思考切分 + 已探索/编辑/Shell 行 + 落款复制 + 静默检测，统一展开气泡）/ 快照历史 + Git 协同 + 刷新（后台自动刷新静默）+ 导出（含标注 / 链接内嵌） |
| `js/edit-entry.js` | Ctrl 拾取 + 待提交队列 + 新建原型 + 启动入口 |
| `js/link-bind.js` | 跳转绑定运行时 + 元素检查器/管理抽屉 + 链接徽标 |
| `js/annotation-core.js` | 零污染元素标注引擎（Sidecar 存储 + 稳定定位 + 页面隔离） |
| `platform/` | 跨平台基础设施 4 文件（`command.js` 命令构造 / `process.js` 进程树 / `env.js` 环境变量 / `budget.js` 预算守卫），供 `main.js` / `runtimes/engine.js` 调用 |
| `providers/` | 多协议 BYOK 引擎 3 文件（`protocols.js` 5 协议 + `normalizeProviderBaseUrl` / `connection-test.js` 诊断 / `model-fetcher.js` 拉取） |
| `runtimes/` | 26 Agent 适配器矩阵：顶层 7 js（`registry` 注册 / `detection + resolution` 探测 / `parsers` 解析 / `engine` 执行 + `needsProtocol` 降级 / `diagnostics` 诊断 / `types` 类型 / `byok-opencode` 桥接）+ `defs/26（15 直驱 + 11 发现型，qoder已直驱）` + `parsers/5` |
| `main.js` / `preload.js` | Electron 主进程与预加载（沙箱/项目/快照/links/日志/版本/AI 等 IPC） |
| `toolPrompt.md` | AI 工作提示词（原型与文档分离修改、工作目录约定），随包分发 |
| `tests/` | 27 套门禁（`npm test`，纯 Node 可进 CI：25 套 verify + 打包完整性 `check-pack` + static-verify）+ CDP UI 回归（`npm run test:ui`，需 GUI）+ `cases/`，见下文 |
| `桌面端/` | 打包产物（NSIS 安装包 / win-unpacked），不入库 |
| `.devdata/` | 开发隔离数据（不入库、可随时删除） |

> js 九个文件按依赖序在 html 中引入（icons → mask-manager → core-docs → nav-zoom → sandbox-core → project-ai-export → edit-entry → link-bind → annotation-core），顺序勿乱调。

## 配置

- 沙箱根目录：`%APPDATA%/原型工具/sandbox/`（打包版）；无需手动设置
- AI：26 Agent 本地 CLI 自动发现（顺序见上，npm 根缓存加速并发探测）+ API 多协议 BYOK 直连，设置矩阵卡片可手动指定路径 / 重探测，未安装折叠收纳；模型列表 `cliModelsCache + TTL` 缓存，`save-config` 即时清缓存
- 设置弹窗 4 Tab：Agent 设置（引擎分段 + CLI 矩阵 + API 多配置卡片 / 服务商名称 / 当前使用 + BYOK 诊断 / 拉取）/ 模型管理（可见性 + 自定义 + `-free` 清洗）/ 沙箱（根目录）/ 关于软件（版本号）；主题系统已彻底剥离，全局仅默认浅色
- **开发/正式隔离**：`npx electron .`（未打包）时 userData 自动重定向到本目录 `.devdata/`，开发测试绝不读写正式环境 `%APPDATA%/原型工具`；打包发布后恢复正式路径
- 旧版本（exe 旁 `sandbox/`）首次升级启动会询问是否迁移数据与 `ai-config.json`

## 开发自检

```bash
node --check main.js && node --check preload.js && node --check js/icons.js && node --check js/mask-manager.js && node --check js/core-docs.js && node --check js/nav-zoom.js && node --check js/sandbox-core.js && node --check js/project-ai-export.js && node --check js/edit-entry.js && node --check js/link-bind.js && node --check js/annotation-core.js
npx electron . --remote-debugging-port=9333    # 开发启动（可配合 CDP 回归）
npm test                                       # 统一门禁：27 套串行（pack 打包完整性 + static-verify + 25 套 verify），ALL_PASS 方可合入，可进 CI
npm run test:ui                                # UI 回归（需 GUI）：自动启动 electron 执行 11 用例并汇总 PASS/FAIL
```

## 发布流程（版本纪律）

1. 语义化版本：功能迭代升 minor、修复升 patch（改 `package.json` 的 `version`）
2. 固定顺序：改版本号 → `npm run build` → commit（message 注明版本）→ push → 打 tag `v1.x.y`
3. 产物：`桌面端/原型工具 Setup 1.x.y.exe`；设置弹窗内展示当前版本号

## UI 回归测试（tests/）

- `tests/run-all.js`（`npm test` / `test:all`）：26 套纯 Node 串行（pack 打包完整性 + static-verify / platform / runtimes / providers / ipc / model-management / ui-integration / session-healing / subpage-naming / stdout-error-closure / event-pipeline / model-fetch / send-guard / snapshot-restore / md-p1 / md-p2 / md-p3 / md-p4 / doc-edit / docwin / inline-edit / link-stamp / spec-uilib / ui-specs / ctrl-release），任一失败 exit=1，可进 CI；`tests/cdp.js` 仅 UI 回归用
- `tests/run.js`（`npm run test:ui`，需 GUI 本机）：直接启动 electron.exe（避免进程残留占用调试端口）→ 顺序执行 11 用例 → 结束进程树 → 汇总 PASS/FAIL
- UI 用例清单（11项，与 `tests/run.js` 同步，首位为纳入的孤儿用例）：
  - `diag-first-screen`：首屏诊断（项目弹窗 / 标注引擎 / 遮罩栈 / 图标 / 设置入口存在性）
  - `project-flow`：项目选择弹窗渲染 → 进入首个项目 → 断言仅加载该项目
  - `title-toc`：标题=当前原型名；目录点击=定位+闪烁+自动关闭+动画清除
  - `snapshot`：快照 IPC 通道（list 结构 / restore 非法 ts 报错）
  - `guard-and-rename`：沙箱越权防护 + 删除校验 + 跨页锚 route key + 重命名联动
  - `export-verify`：导出文件校验（结构 / md / docs / DOM）
  - `full-simulation`：全流程模拟综合（菜单栏响应式、文档按钮、取色与交互片段、项目切换、HTML 导出）
  - `new-features-upgrade`：新功能综合（导出下拉/设置4Tab/模型管理/AI双Tab/日志/Markdown渲染）
  - `ctrl-pick`：Ctrl拾取（命名空间收敛/覆盖层/toggle反选/批量统一与独立提交/Esc关闭/防重绑定）
  - `git-flow`：Git协同（下拉菜单/仓库配置/选择性上传与拉取/目标分支/覆盖与自愈确认/无emoji）
  - `anno-features`：需求标注（角标显隐/序号附着/总览抽屉/点击定位闪烁/Popover）
- 定位区分：轻量 11 套可进 CI 门禁；CDP UI 11 用例为本机 GUI 回归，不进 CI
