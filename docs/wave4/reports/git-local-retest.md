# Wave4 A3 复测 · Git 本地 bare 夹具（UI 配置 + push/pull）

- 日期：2026-11-13
- Agent / owner：Wave4 A3 子代理（复测）
- 阶段：A3 复测（开发态本地 bare 夹具，真机 UI 全链路）
- 代码版本：`git rev-parse HEAD` = `77192ddb21157d3aebca12167dd8563c1da4d31d`
- 构建：`dist/renderer/index.html` SHA256 前 12 位 = `AA42E6DCAF5B`；构建时间 = 2026-11-13 15:36:43（+08:00）；所有 `src/**` 修改时间均早于该构建，本轮**未重新构建**
- 环境：Windows 11 家庭中文版 10.0.26200 / Node v24.15.0 / Electron 37.10.3 / Playwright 1.65 / git 2.54.0.windows.1
- 数据目录：`PLAND_DEV_DATA_DIR` = `D:\文件\工具\原型工具-PlanD\.devdata-wave4-git-retest`
  - 实际 `app.getPath('userData')` = 同路径（精确一致）
- seed：`node e2e/wave4/seed.mjs --domain git-retest`；`_wave4-seed.json` present；源指纹 `17ad3a89355d…`；项目 `测试1`
- 夹具开关：`launchApp({ domain:'git-retest', env:{ PLAND_GIT_ALLOW_LOCAL:'1' } })`（未打包开发态）
- 运行命令：
  `npx playwright test e2e/wave4-git-local.spec.ts --workers=1 --output=test-results/wave4/git-local-retest`
- 运行结果：**1 passed（39.1s）**；全链路一次通过
- 网络边界：产品 Git 通道只使用 `file:///` 本地 bare；0 次 https/ssh、0 次 gitee；Git 阶段外部请求 0 次
  - 启动期预览 iframe 对种子原型内置的 `cdn.jsdelivr.net` CSS 有 1 次请求意图，被页面 CSP 直接拦截（`requestfailed` 原因 = `csp`，未建立连接），详见 §6

> 隔离声明：未读写共享 `.devdata`；本轮只修改 `e2e/wave4-git-local.spec.ts`，新增 `docs/wave4/reports/git-local-retest.md` 与 `docs/wave4/shots/git-local-retest/*.png`；未改 `src/**`、`main/**`、`tests/**`、`package.json`；未 npm install、未 commit、未碰真实 gitee、未使用真实 token。

## 1. 步骤结果

| # | 步骤 | 结果 | 证据 | 缺陷级别 |
| --- | --- | --- | --- | --- |
| 0 | 隔离启动 | PASS | `userData` 精确等于 `.devdata-wave4-git-retest`；seed present；`00-cold-start.png` | — |
| 1 | Git 面板 / 660px Dialog | PASS | `git-sheet[data-surface=dialog]`，`boundingBox.width=660`；`git-branch-select=main`；`git-total=23 处变更`；可见 `git-file-row=15`（当前项目 15 行；另 8 项在折叠组，未挂载行）；`01-git-panel-660.png` | — |
| 2 | 仓库设置：`file:///` + main + 假 token → 保存 | PASS | remote=`file:///C:/Users/allow/AppData/Local/Temp/pland-wave4/git-fixture-20261113-155120.git`；branch=`main`；作者 `Wave4 GitRetest`；假 token `dummy-local-token`；保存后弹窗关闭，Toast=`Git 仓库配置已保存。`；重开 token-state=`已配置 ****oken`；`02-config-filled.png`、`03-config-saved.png` | — |
| 3 | 测试连接（复用已保存 token） | PASS | 后端 `ls-remote` 成功，弹窗提示 `连接成功 · 131ms`；无 `GIT_URL_BLOCKED`、无 `NEED_AUTH`、无 GCM；`04-test-connection-ok.png` | — |
| 4 | 分支列表 | PASS | 分支下拉 `main,master`；远端已配置（`git-branch-hint` 不出现）；`05-branch-list.png` | — |
| 5 | 上传发布（push） | PASS | 勾选当前项目 15/15；提交说明 `wave4 git-retest push 20261113-155120`；Toast=`发布成功`；bare `log --oneline -1` = `7f14cbb wave4 git-retest push 20261113-155120`；`06-push-selected.png`、`07-push-success.png` | — |
| 6 | 拉取同步（pull） | PASS | 另一 clone 向 bare 追加 `803099e wave4 git-retest pull probe 20261113-155120`；UI Confirm「拉取同步」→ Toast=`同步完成`；沙箱 `wave4-pull-probe.md` 出现且内容含时间戳；`08-pull-confirm.png`、`09-pull-success.png` | — |
| 7 | 差异预览 | PASS | 切到差异预览，`git-diff-hint` 可见；已同步后空态=`远端暂无差异。`，无白屏/崩溃；`10-diff-preview.png` | — |
| 8 | 自愈入口 | PASS | 点「自愈修复」→ Confirm 文案含「自愈修复将先备份再重建/修复本地仓库配置」；取消后 `.heal-backup` 未生成、`.git/config` SHA256 未变；`11-heal-confirm.png`、`12-heal-cancelled.png` | — |
| 9 | 取消 / 忙碌 | PASS | push、pull 期间均实测到 `git-busy` 与 `git-cancel`（`busy=true cancel=true`）；空闲时 `git-cancel` 数量 0 | — |
| 10 | 关闭 / 孤儿 / 日志 | PASS | `close method=window-close exitCode=0 elapsed=419ms`；关闭后无 git/conhost/codebuddy 残留、无进程持有 bare/隔离数据目录；crashes=0；Git 阶段 console/pageerror/crash 新增 0；`13-final.png` | — |
| 11 | 最终不变量 | PASS | bare `refs/heads/main` = 沙箱 `HEAD` = `803099eec75913952389f38fd486384fce95d1db`；工作区变更 23 → 8 | — |

## 2. 配置证据（PASS）

- 保存落盘（`.devdata-wave4-git-retest/git-config.json`）：

  ```json
  {
    "defaultConfig": {
      "remoteUrl": "file:///C:/Users/allow/AppData/Local/Temp/pland-wave4/git-fixture-20261113-155120.git",
      "branch": "main",
      "authorName": "Wave4 GitRetest",
      "authorEmail": "wave4-gitretest@local"
    },
    "projects": {
      "测试1": {
        "remoteUrl": "file:///C:/Users/allow/AppData/Local/Temp/pland-wave4/git-fixture-20261113-155120.git",
        "branch": "main",
        "authorName": "Wave4 GitRetest",
        "authorEmail": "wave4-gitretest@local"
      }
    }
  }
  ```

- `git-config.json` **不含** `dummy-local-token`；sandbox `.git/config` 同样不含。
- `git-credentials.json` 只有 `测试1.tokenEnc`（safeStorage 加密后的 base64），明文 token 未落盘。
- sandbox `remote.origin.url` 已校准为 `file:///…git-fixture-20261113-155120.git`。
- 保存前后 `git-config.json` SHA256 发生变化；保存失败/被拒的负向路径本轮未出现。

## 3. push / pull 证据（PASS）

### 3.1 push

- UI：勾选 `测试1` 15/15 文件 → 提交说明 `wave4 git-retest push 20261113-155120` →「上传发布」。
- Toast：`发布成功`（`07-push-success.png`）；发布后变更数 23 → 8。
- bare 侧：
  - `git --git-dir=<bare> log --oneline -1` = `7f14cbb wave4 git-retest push 20261113-155120`
  - `git --git-dir=<bare> rev-parse refs/heads/main` = `7f14cbbd027b8a3c0bc7186cc14425c44fd2ecb9`
  - 与沙箱 `HEAD` 完全一致。
- upstream 未被写成 URL：
  - `branch.main.remote=origin`
  - `branch.main.merge=refs/heads/main`
  - `remote.origin.url=file:///C:/Users/allow/AppData/Local/Temp/pland-wave4/git-fixture-20261113-155120.git`
  - push 后 `@{u}` 可解析为 `origin/main`

### 3.2 pull

- 在 `%TEMP%\pland-wave4\git-fixture-20261113-155120-clone` 克隆 bare，追加提交：
  - `803099e wave4 git-retest pull probe 20261113-155120`（文件 `wave4-pull-probe.md`）
  - 已 push 回 bare；bare `log -1` 为该探针提交。
- UI：「拉取同步」→ Confirm 文案含「拉取远端并合并到本地…」→ 确认 → Toast=`同步完成`。
- 沙箱侧：
  - `HEAD` = `803099eec75913952389f38fd486384fce95d1db`（快进到探针提交）
  - `refs/remotes/origin/main` = 同一 sha
  - `@{u}` 可解析；`HEAD...origin/main` ahead/behind = `0 0`
  - `sandbox/wave4-pull-probe.md` 存在，内容含 `20261113-155120`
- 拉取后变更数保持 8（探针文件为已提交内容，不再计入未提交变更）。

## 4. 安全 / 进程 / 日志

- 无 GCM / HTTPS 凭据助手：测试前后系统 `git-credential-manager*.exe`、`git-remote-http(s).exe` 基线均为 0，全程未新增；Electron 子进程内 git/conhost 也为 0。
- 关闭后：`git.exe` / `conhost.exe` / `codebuddy.exe` 残留 = 0；无进程仍引用 bare 或 `.devdata-wave4-git-retest`。
- 主进程退出：`window-close`，exitCode=0，419ms。
- 测试脚本外未发起任何 Git 网络操作；凭据只走 `http.extraHeader`，本地 file 传输实际不发送。

## 5. P0 / P1

| ID | 级别 | 现象 | 复现步骤 | 影响 | 证据 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | **无 P0/P1** | — | — | — | — |

- `GIT_URL_BLOCKED`：本轮**未出现**，无需 BLOCKED 记录；开发态夹具（未打包 + `PLAND_GIT_ALLOW_LOCAL=1` + 合法 bare）已按设计放行。
- 回归：`node tests/verify-git-local-fixture.js` → `passed=31 failed=0 total=31`（默认/打包态/fail-closed 仍拒绝 `file://`，https 不受影响）。

## 6. 控制台口径与启动期噪声（非 Git 域）

本轮严格记录原始 console/pageerror，并区分“启动基线”与“Git 阶段新增”：

| 指标 | 启动基线（Git 操作前，已打开面板并完成首屏读取） | Git 阶段新增 | 结论 |
| --- | --- | --- | --- |
| console error | 1 | **0** | Git 域无新增 |
| pageerror | 1 | **0** | Git 域无新增 |
| crash | 0 | **0** | 全程 0 |
| 外部请求 | 1（预览内容） | **0** | Git 阶段无外部请求 |

基线两条均来自主窗预览 iframe `about:srcdoc` 加载种子原型 `大厅.html`（不是 Git 面板、也不是应用主 bundle）：

1. `Refused to load the stylesheet 'https://cdn.jsdelivr.net/npm/vant@4/lib/index.css' because it violates … "style-src 'self' 'unsafe-inline'"`  
   Playwright `requestfailed` 原因为 `csp`，即 CSP 在建立连接前拦截，未真正出网。
2. `pageerror: Unexpected token '.'`  
   对应 `大厅.html` 第 2 段内联脚本的语法错误（静态提取该脚本并用 `vm.Script` 复核可稳定复现）。

说明：这两条在 Git 操作开始前即存在，属**种子原型内容**（`.devdata` 在 14:53 重建后新增的 CDN 原型）而非 A3 Git 实现；本轮未修改 seed/原型内容来掩盖噪声。若协调者要求“全局 console=0”，修复应归入预览/种子内容域，而不是 Git 夹具。除此之外，Git 全链路 console/pageerror/crash 新增均为 0。

## 7. 观察区（按 A 口径不报 P2/P3）

- `saveProjectGitConfig` 会把 `file:///` 同时写入 `defaultConfig` 与项目 `测试1`；隔离域内无副作用，生产态因打包限制无法保存 `file://`，不构成 P1。
- 分支下拉含 `main,master`：`master` 来自后端默认候选集合，本地 bare 只有 `main`；仅为展示冗余。
- 测试连接 131ms、push/pull 均为本地文件传输，耗时不代表真实 https 网络表现。

## 8. 清理

- spec 的 `finally` 已删除一次性 bare 与 clone：`git-fixture-20261113-155120.git`、`git-fixture-20261113-155120-clone`；复查 `%TEMP%\pland-wave4` 无 `git-fixture-*` 残留。
- 隔离数据目录 `.devdata-wave4-git-retest` 已删除。
- 临时诊断脚本/日志已删除；未改动仓库源码、未 commit、未安装依赖。

## 9. 结论

- **配置：PASS** — UI 保存 `file:///` + 假 token 成功，重开回显正确，token 脱敏且不明文落盘；测试连接 131ms 成功。
- **push：PASS** — bare 收到提交 `7f14cbb`（与沙箱 HEAD 一致），`branch.main.remote=origin`，未被写成 URL。
- **pull：PASS** — clone 追加提交 `803099e` 后 UI 拉取成功，沙箱收到文件并快进到同一提交，ahead/behind `0 0`。
- **P0 = 0；P1 = 0；BLOCKED = 0。**
- 控制台：Git 阶段新增 console/pageerror/crash = 0；启动基线 1+1 为种子原型预览内容噪声（CSP 拦截 + 原型脚本语法错误），非 Git 缺陷，已在 §6 明示。
- 结论：开发态本地 bare 夹具已可支撑 Git 域真机 push/pull 复测；后续 B 阶段可直接复用本 spec。
