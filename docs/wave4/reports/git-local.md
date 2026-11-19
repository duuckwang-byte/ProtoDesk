# Wave4 A 冒烟 · Git 域（本地 bare）报告

- 日期：2026-11-13
- Agent / owner：Wave4 A3 子代理（Git 本地 bare，不触网、不碰 gitee）
- 阶段：A 冒烟
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer` 构建时间 = 2026-11-13 13:49:26；`dist/renderer/index.html` SHA256 前 12 位 = `34D2A2CB18A8`
- 环境：Windows 11 家庭中文版 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-git`
  - 实际 `app.getPath('userData')` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-git`（精确一致）
- seed：`_wave4-seed.json` present；源指纹 `6081a7f5fc2e…`；项目 `测试1`
- 运行命令：
  `npx playwright test e2e/wave4-git-local.spec.ts --workers=1 --output=test-results/wave4/git-local`
- 真实请求/网络：AI_REQUESTS=0；GIT_NETWORK=**仅本地 bare（CLI 夹具/取证）**，产品 Git 通道 0 次外部网络
- 本地远程：`C:\Users\allow\AppData\Local\Temp\pland-wave4\git-remote-20261113-140318.git`（`git init --bare --initial-branch=main`，`http.receivepack=true`）
- 沙箱：`.devdata-wave4-git/sandbox`，HEAD `e2864057a18d84789269c5cf7be6672d68f9b22b`

> 隔离声明：未读写共享 `.devdata`；未改 `src/**`、`main/**`、`tests/**`、`package.json`；未 commit；未写入任何真实 token/凭据。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离启动 | PASS | `userData` 精确等于 `.devdata-wave4-git`；`docs/wave4/shots/git-local/00-cold-start.png` | — |
| 1 | 打开 Git 面板 / 660px Dialog | PASS | `git-sheet[data-surface=dialog]` 可见，`boundingBox.width=660`；`git-panel`、`git-branch-select=main` 可见；截图 `01-git-panel-660.png` | — |
| 2 | 真实变更树 | PASS | `git-total="21 处变更"`（与 CLI `git status -uall` 的 21 项一致）；当前项目 `测试1` 展开 13 行真实 `git-file-row`，其余 8 项在折叠组；`data-path` 示例 `测试1/首页/.context/history.md`；截图 `01-git-panel-660.png` | — |
| 3 | 搜索过滤 | PASS | `git-filter=首页` → 11 行，均命中路径/原型；清空后恢复 13 行；截图 `02-status-filter.png` | — |
| 4 | 差异预览 | PASS | `git-diff-hint` 可见；无远端时 `git-empty="远端暂无差异。"`，无白屏/崩溃；截图 `03-diff-preview.png` | — |
| 5 | 仓库设置：本地 bare 路径 | **BLOCKED** | 填 `…\git-remote-20261113-140318.git` → 测试连接 35ms 返回：`不支持的仓库地址协议：默认仅支持 https:// 仓库地址（GIT_URL_BLOCKED）`；截图 `04-config-local-path-blocked.png` | ENV（安全策略） |
| 6 | 仓库设置：`file:///` | **BLOCKED** | 填 `file:///C:/Users/allow/AppData/Local/Temp/pland-wave4/git-remote-…git` → `不支持的仓库地址协议：默认不支持 file:// 本地路径（GIT_URL_BLOCKED）`；截图 `05-config-file-url-blocked.png` | ENV（安全策略） |
| 7 | 保存被拒 / 不落盘 | PASS（负向） | 保存本地路径 → 同 `GIT_URL_BLOCKED`，弹窗不关闭；`git-config.json` SHA256 前 12 位 `FC5755834B67` 前后一致；沙箱 `.git/config` 哈希前后一致；取消后重开 remote 仍为空；截图 `06-config-save-blocked.png`、`07-config-reopen-empty.png` | — |
| 8 | 上传发布（push） | **BLOCKED** | 无合法 https 远端：`git-push` disabled=true；`git-need-config` 横幅“尚未配置远程仓库，上传/拉取不可用”；沙箱 HEAD 仍 `e2864057…`，bare `log -1` 仍 `50e2053 wave4 pull probe`，无新提交；截图 `08-push-pull-blocked.png` | ENV（安全策略） |
| 9 | 拉取同步（pull） | **BLOCKED** | `git-pull` disabled=true；bare 已预置探针提交 `50e2053 wave4 pull probe`（含 `wave4-pull-probe.md`），但沙箱无 `refs/remotes/origin/main`（`show-ref` exit 1），探针文件未进入沙箱；截图 `08-push-pull-blocked.png` | ENV（安全策略） |
| 10 | 自愈修复入口 | PASS（未执行） | 点「自愈修复」→ `confirm-dialog` 文案“自愈修复 / 自愈修复将先备份再重建/修复本地仓库配置，确定继续吗？”；点「取消」后关闭；`.heal-backup` 未生成，`.git/config` 哈希 `787B9799B9B4` 未变；截图 `09-heal-confirm.png`、`10-heal-cancelled.png` | — |
| 11 | 取消 / 忙碌状态 | N/A（记录） | 空闲时 `git-cancel` 数量 0；因无合法远端可发起 push/pull，busy 状态无法触发；不判失败 | — |
| 12 | ahead/behind/upstream | PASS（记录） | `branch.main.remote=origin`（未被写成本地路径）、`branch.main.merge=refs/heads/main`；`@{u}` 无解析、`HEAD...origin/main` N/A（从未成功 fetch）；符合“未联网”预期 | — |
| 13 | 关闭 / 孤儿 / 日志 | PASS | `close method=window-close exitCode=0`（260ms）；关闭前 Electron 子进程 git/conhost=0；关闭后残留=0；无进程仍持有 bare 或隔离数据目录；console errors=0、pageerrors=0、crashes=0、fatal=0；截图 `11-final.png` | — |

### 1.1 无 GCM 弹窗证据

- 测试连接在 **35ms** 内返回 `GIT_URL_BLOCKED`，说明在进入任何 `ls-remote`/凭据交互前即被 URL 白名单拦截。
- 全程 Electron 子进程中 `git-credential-manager.exe` / `git-remote-https.exe` / `git-remote-http.exe` = 0；`token-state=未配置`，未填写任何 token。
- 关闭后无 `git.exe` / `conhost.exe` / `codebuddy.exe` 孤儿，也没有进程仍引用 bare 或 `.devdata-wave4-git`。
- 与 `docs/git-credential-fix.md` 的空 credential helper + 非交互 env 设计一致，本次未出现系统凭据窗口。

## 2. 缺陷（只报 P0/P1）

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | **无 P0/P1** | — | — | — | — |

## 3. ENV-BLOCKED（非产品缺陷）

| ID | 项 | 结论 | 证据 | 影响与建议 |
| --- | --- | --- | --- | --- |
| ENV-GIT-1 | 本地 bare push/pull | **未执行 / BLOCKED** | `git/auth.js:28,36` 明确拒绝 `file://` 与非 https；UI 原文见步骤 5/6；`git-workflow-service.js:624` 在 `config-save` 入口即返回 `GIT_URL_BLOCKED` | 产品安全策略为 https-only，本地 bare 无替代路径。A3 计划中的 push/pull 无法在本夹具下覆盖；建议协调者在 B 前裁决：①仅开发态放行 `file://`；②改用本地 HTTPS 夹具（自签证书 + 隔离 sslCAInfo）；③接受 push/pull 走真实 https 远端（需 GIT-NET 独占与审批）。本次**未绕过**安全策略。 |
| ENV-GIT-2 | 分支列表/远端差异 | 未覆盖 | 无合法远端，`git:list-branches` 返回 `NEED_CONFIG`，仅本地分支 `main`；`git:fetch-diff` 同 | 不影响本地读路径；远端分支/差异需在 ENV-GIT-1 裁决后补测。 |

## 4. 观察区（按 A 口径不报 P2/P3）

按本次任务口径“只报 P0/P1，像素/文案不报”，差异预览空态、首帧加载态、折叠分组等文案/状态细节均不计入缺陷表；如 B 阶段需要，可单独评审。

## 5. 结论

- 结果：**ENV-BLOCKED（push/pull 未覆盖）；Git 读路径可放行**
- P0 = 0；P1 = 0；P2/P3 未统计（A 口径只报 P0/P1）；ENV = 2
- 阻断项：无产品 P0/P1；push/pull 因 https-only 安全策略 BLOCKED，需协调者裁决夹具方案
- 复测范围：若后续放行本地 HTTPS/file 夹具，只需复跑 `e2e/wave4-git-local.spec.ts` 的步骤 8–9，并补远端分支/差异
- 备注：
  - 本次唯一一次“远端提交”是 CLI 在 `%TEMP%` 内为 pull 预置的探针 `50e2053`，未通过产品写入，也未进入沙箱。
  - 隔离数据目录、临时 bare 与 clone 已在取证后清理；截图保留在 `docs/wave4/shots/git-local/`。
