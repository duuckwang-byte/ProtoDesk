# PRTool · 原型预览工具

原型 + 文档一体化工具（Electron 桌面端）。以「项目制沙箱」组织原型，本地 AI（opencode）生成/修改原型与文档，支持页面跳转绑定、AI 任务快照回滚与离线导出交付。

## 功能

### 组织与管理

- **项目制沙箱**：`%APPDATA%/原型工具/sandbox/<项目>/<原型>/`，一个项目一个文件夹、一个原型一个子文件夹（html + md + links.json 同放）。打开应用先弹窗选择进入哪个项目，**一个窗口只展示一个项目**；侧栏顶部显示当前项目名，点击随时切换；支持项目新建 / 重命名 / 删除（默认项目保护不可删）
- **旧数据兼容**：旧版扁平沙箱首次启动自动整理（所有扁平原型归入「默认项目」，一次性标记防重复）；旧版 exe 旁 `sandbox/` 首次启动询问迁移
- **沙箱是唯一数据源**：安装包不携带任何示例项目，%APPDATA% 沙箱为空即从空白开始；新建项目 / 导入 / AI 生成均写入此目录
- **左侧列表交互**：原型项**单击**切换预览、**双击**直接重命名、**右键**弹出菜单（移入文件夹… / 重命名 / 删除原型… / 从列表移除）；分组标题**点击**折叠、**右键**菜单（新建二级文件夹 / 重命名文件夹 / 删除文件夹…）
- **虚拟文件夹**：对原型分类整理（最多两级），不创建真实目录；分组关系存本机 localStorage（key 含沙箱路径，跨项目天然隔离），导出文件不携带
- **刷新按钮**：顶部工具条「刷新」（预览/编辑右侧）一键重新读取本地最新的原型与文档

### 原型预览与文档

- **原型 + 文档同屏**：左侧源列表切换原型，右侧展示该原型的功能说明；工具左上角与文档标题统一显示**当前原型名称**
- **端别切换**：移动端 / PC 端一键切换布局（按文件名与内容启发式自动识别，可手动纠正）
- **内容缩放**：50%~150% 预设或直接输入，Ctrl+滚轮微调，双击舞台复位 100%
- **结构化功能说明**：md 采用 `## 页面 <标题>（<路由key>）` 分章节格式，整篇一次渲染全部章节；「目录」弹窗点击定位到对应章节（蓝色背景闪烁两次后自动关闭）；文档支持 Markdown 直接编辑并保存回写沙箱 md
- **最新需求**：每个原型目录独立的 `最新需求.md`，跟随原型读写，记录当前迭代需求

### 跳转绑定（LinkBind）

- **配置**：编辑模式下点击原型元素打开检查器，为该元素配置「跳转至」目标原型与页面；绑定关系持久化在原型目录 `links.json`
- **预览**：点击已绑定元素直接跳转目标原型的对应页面；悬停显示「跳转至 …」气泡与描边提示；链接徽标实时计数
- **联动**：与编辑模式互斥广播；切换原型/AI 刷新后自动重载绑定；导出 HTML 内嵌绑定数据（`__EXPORT_LINKS__`），离线打开跳转依然可用

### AI 设计

- **opencode CLI 驱动**：自动发现 npm / scoop / Chocolatey / PATH 安装位置，可在设置中手动指定；模型按供应商分组选择；会话按沙箱目录隔离持久化，自动续接历史上下文
- **快照回滚**：每次 AI 任务前自动保存原型快照（每原型保留最近 10 份，超出删最旧）；AI 对话弹窗「⏱ 历史」查看并一键恢复任意版本，恢复前自动备份当前状态（undo 快照）；AI 生成中禁止恢复
- **编辑模式**：预览/编辑一键切换；编辑模式下悬浮原型元素输入修改需求（Ctrl+点击穿透正常操作原型），需求进入待提交列表（含唯一 CSS 选择器与所在页面路由），批量提交由大模型定位修改并自动刷新

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
| `js/core-docs.js` | 文档解析/渲染/编辑 + 功能说明面板 + 目录（TOC） |
| `js/nav-zoom.js` | 页面导航同步 + 舞台缩放 |
| `js/sandbox-core.js` | 全局状态 + 端别判定/切换 + 原型加载 + 源列表/虚拟分组/右键菜单 |
| `js/project-ai-export.js` | 项目选择 + 沙箱扫描 + 设置 + AI 对话/快照历史 + 刷新 + 导出 |
| `js/link-bind.js` | 跳转绑定运行时 + 元素检查器/管理抽屉 + 链接徽标 |
| `js/edit-entry.js` | 编辑模式 + 新建原型 + 启动入口 |
| `main.js` / `preload.js` | Electron 主进程与预加载（沙箱/项目/快照/links/日志/版本/AI 等 IPC） |
| `toolPrompt.md` | AI 工作提示词（原型与文档分离修改、工作目录约定），随包分发 |
| `tests/` | CDP 回归脚本（见下文） |
| `桌面端/` | 打包产物（NSIS 安装包 / win-unpacked），不入库 |
| `.devdata/` | 开发隔离数据（不入库、可随时删除） |

> js 六个文件按依赖序在 html 中引入（core-docs → nav-zoom → sandbox-core → project-ai-export → link-bind → edit-entry），顺序勿乱调。

## 配置

- 沙箱根目录：`%APPDATA%/原型工具/sandbox/`（打包版）；无需手动设置
- AI：自动查找本地 opencode，可在设置中手动指定路径；CLI 版本号缓存避免重复探测
- 设置弹窗显示：沙箱根目录、当前版本号、CLI 信息
- **开发/正式隔离**：`npx electron .`（未打包）时 userData 自动重定向到本目录 `.devdata/`，开发测试绝不读写正式环境 `%APPDATA%/原型工具`；打包发布后恢复正式路径
- 旧版本（exe 旁 `sandbox/`）首次升级启动会询问是否迁移数据与 `ai-config.json`

## 开发自检

```bash
node --check main.js && node --check preload.js && node --check js/core-docs.js && node --check js/nav-zoom.js && node --check js/sandbox-core.js && node --check js/project-ai-export.js && node --check js/link-bind.js && node --check js/edit-entry.js
npx electron . --remote-debugging-port=9333    # 开发启动（可配合 CDP 回归）
npm run test:ui                                # UI 回归：自动启动 electron 执行用例并汇总 PASS/FAIL
```

## 发布流程（版本纪律）

1. 语义化版本：功能迭代升 minor、修复升 patch（改 `package.json` 的 `version`）
2. 固定顺序：改版本号 → `npm run build` → commit（message 注明版本）→ push → 打 tag `v1.x.y`
3. 产物：`桌面端/原型工具 Setup 1.x.y.exe`；设置弹窗内展示当前版本号

## UI 回归测试（tests/）

- `tests/cdp.js`：CDP 公共连接器（fetch `/json/list` + WebSocket + evaluate 封装，awaitPromise）
- `tests/run.js`：直接启动 electron.exe（避免进程残留占用调试端口）→ 顺序执行10用例 → 结束进程树 → 汇总 PASS/FAIL
- 用例清单（10项，与 `tests/run.js` 同步）：
  - `project-flow`：项目选择弹窗渲染 → 进入首个项目 → 断言仅加载该项目
  - `title-toc`：标题=当前原型名；目录点击=定位+闪烁+自动关闭+动画清除
  - `snapshot`：快照 IPC 通道（list 结构 / restore 非法 ts 报错）
  - `guard-and-rename`：沙箱越权防护 + 删除校验 + 跨页锚 route key + 重命名联动
  - `export-verify`：导出文件校验（结构 / md / docs / DOM）
  - `full-simulation`：全流程模拟综合（菜单栏响应式、文档按钮、取色与交互片段、项目切换、HTML 导出）
  - `new-features-upgrade`：新功能综合（导出下拉/设置4Tab/模型管理/AI双Tab/日志/Markdown渲染）
  - `ctrl-pick`：Ctrl拾取（命名空间收敛/覆盖层/toggle反选/批量统一与独立提交/Esc关闭/防重绑定）
  - `git-flow`：Git协同（下拉菜单/仓库配置/选择性上传与拉取/分支切换/沙箱自愈/无emoji）
  - `anno-features`：需求标注（角标显隐/序号附着/总览抽屉/点击定位闪烁/Popover）
- 定位为本机 GUI 手动回归工具，不进 CI
