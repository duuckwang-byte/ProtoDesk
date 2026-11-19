# Git 弹窗与上传状态诊断报告

- 诊断对象：`D:\文件\工具\原型工具-PlanD`
- 诊断时间：2026-11-13
- 诊断方式：只读。未执行任何网络 git 操作（无 push / pull / fetch / ls-remote），未 add / commit / push，未改源码、测试、配置，未安装依赖。
- 唯一写入：本文件。
- 敏感信息：报告不包含 token 明文；只记录“是否存在凭据”。

## 0. 结论速览

| 问题 | 结论 | 关键证据 |
|---|---|---|
| 当前是否还有 git 残留进程 | **没有**。`git.exe=0`、`git-remote-https.exe=0`、`git-credential-manager.exe=0`、`ssh.exe=0` | 2026-11-13 进程快照，见 §1 |
| 弹窗是什么 | **最可能是 GCM（git-credential-manager）被拉起后崩溃/闪烁**，不是应用内每条 git 命令的 console 窗口 | Windows 事件日志 2026-11-12 21:01:37 `git-credential-manager.exe` 崩溃，见 §2.5、§4 |
| 是否缺 `windowsHide` | **不缺**。git 的唯一 spawn 点已设置 `windowsHide: true` | `main/services/git-workflow-service.js:352-358`（`:355`） |
| 是否有过密的 git 轮询 | **没有 git 轮询风暴**。GitPanel 的 1s 定时器只读内存忙态，不 spawn git；legacy 无 git 定时器 | `GitPanel.tsx:266-284`、`git-controller.js:43`、`git-workflow-service.js:1185` |
| 上传是否成功 | **没有成功；更准确说是“没有发生新的上传”**。本地没有 11 月的新提交，也没有 push 失败日志 | 沙箱 HEAD 停留在 2026-09-23；主仓 HEAD 停留在 2026-09-30；见 §3 |
| 最可能根因 | **A 类：凭据交互/GCM 反复被调用**，并叠加本次日志中 GCM 2.7.3 在启动阶段崩溃；认证未通过导致上传链路根本没走到 push | 见 §5 |

一句话：**用户看到的“很多 git 窗口”大概率是 GCM 被反复拉起（以及崩溃/控制台闪烁），不是上传进度窗口；上传本身没有完成，而且本地根本没有生成 11 月的新提交。**

---

## 1. 当前进程快照

### 1.1 命令

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match 'git|credential|ssh' } |
  Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine
```

### 1.2 结果（2026-11-13 空闲态）

| 进程名 | 数量 | 父进程 | 启动时间 |
|---|---:|---|---|
| `git.exe` | 0 | — | — |
| `git-remote-https.exe` | 0 | — | — |
| `git-credential-manager.exe` | 0 | — | — |
| `ssh.exe` | 0 | — | — |
| `ssh-agent.exe` | 0 | — | — |
| 合计匹配 | **0** | — | — |

说明：

- 诊断过程中曾瞬时出现 2 个 `git.exe`，父进程是本次诊断的 PowerShell（由 `git status` 只读命令产生），2 秒后再次查询已归零。**不是应用残留**。
- 当前只有一个开发态 Electron 实例（5 个 `electron.exe` 进程：1 个主进程 + 4 个子进程，2026-11-13 09:16:23 启动，父进程为 `node.exe` 41332），没有旧的打包版 `原型工具.exe` 在跑。
- 因此“现在还有很多 git 进程挂着”这一条不成立；用户看到的窗口应已随进程退出而消失。

### 1.3 与历史记录对比

- `docs/wave3-acceptance.md:99` 记录：验收机 `tasklist` 曾出现“多枚历史残留 `git.exe` / `git-remote-https.exe` / `git-credential-manager.exe`”。
- 但该文档和 `docs/final-release-report.md` 中**没有出现“85”这个具体数字**，只写了“多枚”。所以“85 个历史残留”无法从现有文档复核；能确认的是**当前为 0**。
- 历史 P2-1 修复内容（`GIT_NONINTERACTIVE_ENV`、`activeGitChildren`、退出兜底）与现状一致，见 `docs/final-release-report.md:62-72`、`main.js:119-145`。

---

## 2. 弹窗类型诊断

### 2.1 git 子进程是否缺 `windowsHide`

全仓（排除 `node_modules`）只有一处 spawn git：

`main/services/git-workflow-service.js:352-358`

```js
const child = spawn('git', gitArgs, {
  cwd,
  env: buildGitChildEnv(envAdd),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

- `:355` 明确 `windowsHide: true`。
- `git show HEAD:main/services/git-workflow-service.js` 中该行也存在（HEAD 版本 `:210`），不是本轮才补的。
- 另一处 `taskkill` 也设置了 `windowsHide: true`（`:85`）。

**结论：B 类“每条 git 命令都闪一个 console 窗口（缺 windowsHide）”在当前代码中不成立。**

但有一个例外需要说明：`windowsHide` 只作用于 `git.exe` 本身，**不作用于 git 再拉起的孙进程**（如 `git-credential-manager.exe`）。GCM 是独立进程，若它被 git 拉起，仍可能产生自己的窗口/控制台闪烁，见 §2.5。

### 2.2 GitPanel 是否有定时轮询会反复 spawn git

`src/renderer/features/git/GitPanel.tsx:266-284`

```ts
// 操作期轮询 isBusy；空闲时也做一次探测，接管外部操作（如上次未结束的 push）。
React.useEffect(() => {
  if (!project) return;
  let alive = true;
  const tick = async () => {
    const busy = await git.isBusy();
    if (alive) setRemoteBusy(busy);
  };
  void tick();
  if (localOp === null && !remoteBusy) {
    return () => { alive = false; };
  }
  const timer = window.setInterval(() => void tick(), 1000);
  ...
}, [project, localOp, remoteBusy]);
```

调用链：

- `GitPanel.tsx:270` → `git.isBusy()`
- `preload.js:149` → `ipcRenderer.invoke('git:is-busy')`
- `main/controllers/git-controller.js:43-45` → `gitWorkflow.gitIsBusyImpl()`
- `main/services/git-workflow-service.js:1184-1185` → 只读 `shared.gitState.busy`

**结论：这个 1s 轮询只读主进程内存，不 spawn git。** 它只在 `localOp !== null || remoteBusy === true` 时启动；空闲态只探测一次。不是“弹很多 git 窗口”的原因。

### 2.3 真正会触发网络 git 的入口

打开 Git 面板时，`GitPanel.tsx:237-256` 会调用 `loadMeta()`；`loadMeta` 在 `:147` 调 `git.listBranches`。

主进程 `gitListBranchesImpl` 在配置了 remote 时会执行：

`main/services/git-workflow-service.js:537-543`

```js
const auth = gitAuth.buildGitAuthEnv({ username, token });
const plainUrl = remoteUrl;
const remRes = await runGit(paths.SANDBOX_ROOT,
  [...auth.argsPrefix, 'ls-remote', '--heads', plainUrl],
  { timeoutMs: 15000, envAdd: auth.envAdd });
```

这是一次**真实网络访问**。每打开一次 Git 面板、每点一次“测试连接”（`:571-590`）、每次读取分支列表/刷新，都可能触发一次 `git ls-remote`。如果 token 未被接受，git 就会转而调用全局 credential helper，即 GCM。

### 2.4 legacy 版是否有同类轮询

`js/project-ai-export.js` 中：

- `:4066` 的 `setInterval(aiThinkTick, 1000)` 是 AI 思考计时，不是 git。
- 未发现 git status 的 `setInterval` / 定时轮询。
- 但 legacy 的“上传/拉取”弹窗打开时会调用 `listBranches`（各一次，失败分支再补一次）：
  - `js/project-ai-export.js:1113`、`:1121`（上传弹窗）
  - `js/project-ai-export.js:1406`、`:1414`（拉取弹窗）
  - `js/project-ai-export.js:1457`（分支刷新按钮）

`js/git-ui/git-domain.js` 只有 `setTimeout` 做 UI 收尾（`:94`），没有 git 轮询。

**结论：legacy 也没有 git 轮询风暴，但每次打开上传/拉取弹窗同样会走一次网络 `ls-remote`。**

### 2.5 GCM 的直接证据（关键）

Windows Application 日志中，近 30 天唯一一条 git 相关事件：

| 时间 | 来源 | 事件 ID | 内容 |
|---|---|---|---|
| 2026-11-12 21:01:37 | .NET Runtime | 1026 | `git-credential-manager.exe` 未处理异常终止 |

异常栈摘要：

```text
System.InvalidOperationException
  at System.Diagnostics.Process.get_StandardError()
  at GitCredentialManager.GitProcess.CreateGitException(...)
  at GitCredentialManager.GitProcessConfiguration.Enumerate(...)
  at GitCredentialManager.Settings.GetSettingValues(...)
  at GitCredentialManager.Settings.GetTrace2Settings()
  at GitCredentialManager.Trace2.Initialize(...)
  at GitCredentialManager.Program.AppMain(...)
```

含义：**GCM 在启动阶段（Trace2 初始化）就崩了**，还没有走到“弹账号密码框”的业务逻辑。它崩溃前会启动 `git config` 子进程，读取 stderr 时抛 `InvalidOperationException`。

本机环境：

- Git：`git version 2.54.0.windows.1`（`C:\Program Files\Git\cmd\git.exe`）
- GCM：`2.7.3+5fa7116896c82164996a609accd1c5ad90fe730a`
- 全局配置：`C:\Users\allow\.gitconfig:18` `helper = manager`
- Gitee 的 credential provider：`.gitconfig:16` `provider = generic`
- `cmdkey /list` 中只有：
  - `git:https://github.com`（用户 `duuckwang-byte`）
  - `git:https://codeup.aliyun.com`（用户 `allowmidrable`）
  - 以及两条 `gh:github.com:*`

**没有 `git:https://gitee.com` 的已存凭据。**

补充：GitHub 的 helper 是 `gh.exe auth git-credential`（`.gitconfig:7`），不走 GCM；因此本次 GCM 崩溃更可能来自 Gitee / Codeup 路径，而不是 GitHub push。Codeup 在凭据管理器里有条目，Gitee 没有，故 **Gitee 是触发交互提示的最可能目标**。

因此，只要有一次 Gitee HTTPS 请求没有成功带上 token（token 失效、用户名不匹配、或 safeStorage 解密失败），git 就会调用 `manager`，GCM 就会被拉起；GCM 2.7.3 在当前 Git 2.54 环境下又可能在启动时崩溃，表现为窗口/控制台一闪而过。**这与用户“弹了很多 git 窗口”的描述吻合。**

需要说明的限制：

- 事件日志只能证明“至少 1 次 GCM 启动并崩溃”，**无法离线精确还原弹窗总次数**（GCM 成功启动/静默退出不会写 Application 日志）。
- 无法从事件日志确定这次 GCM 的父进程是应用还是终端里手工执行的 git；两条路径都会走同一个全局 credential helper。

---

## 3. 上传状态（纯本地检查）

### 3.1 主仓库（GitHub 代码仓）

命令与输出摘要：

```text
$ git -C . status -sb
## main...origin/main
 M README.md
 D ai-dialog-demo.html
 ...
?? docs/wave3-acceptance.md
?? src/
...
```

统计：`M=37`、`D=3`、`??=56`，合计 **96 项未提交变更**。

```text
$ git -C . log --oneline -5
77192dd feat: question-form文本提问链/.../版本1.1.0
95ff156 feat: 适配OpenCodeV2（run删除--dir，工作目录走进程cwd）+ 版本1.0.1
4c0bf14 feat: 原生弹窗整体替换为toast+askConfirm/F12控制台/...
0ce1cbd docs: 修正下载直链为ASCII文件名
ef34161 docs(release): 精简README+Apache-2.0声明，...
```

```text
$ git -C . remote -v
origin  https://github.com/duuckwang-byte/PRTool.git (fetch)
origin  https://github.com/duuckwang-byte/PRTool.git (push)
```

```text
$ git -C . reflog -5
77192dd HEAD@{0}: commit: feat: question-form...
95ff156 HEAD@{1}: reset: moving to HEAD
95ff156 HEAD@{2}: commit: feat: 适配OpenCodeV2...
...
```

关键点：

- HEAD = `77192dd`，提交时间 **2026-09-30 11:11:05 +0800**。
- `origin/main` 也指向 `77192dd`；`.git/logs/refs/remotes/origin/main` 最后一条是 `update by push`，时间 **2026-09-30 11:11:28**。说明 9 月 30 日那次上传是成功的。
- 但 **11 月 12 日的大量改动全部没有 commit**（96 项）。`git status -sb` 没有 `[ahead N]`，不是因为“已上传”，而是因为**根本没有新提交可推**。
- 也就是说：如果用户期待的是“把 11 月的代码/文档上传到 GitHub”，**没有发生**。

### 3.2 应用沙箱仓库（Gitee 测试仓）

应用实际操作的是 `.devdata/sandbox`（`main/paths.js:19` `SANDBOX_ROOT = <userData>/sandbox`；开发态 userData 被 `main.js:16` 指到 `.devdata`）。

```text
$ git -C .devdata/sandbox status -sb
## main
 D 测绘1/我的/我的.html
MD 测绘1/我的/我的.md
?? .context/
?? .gitignore
?? 测试1/
```

注意：这里显示的是 `## main`，**没有 `...origin/main`**，说明 upstream 没配好（见 §3.4）。

```text
$ git -C .devdata/sandbox log --oneline -5
e286405 更新原型与文档数据
6e5bef5 更新原型与文档数据
```

```text
$ git -C .devdata/sandbox reflog -8
e286405 HEAD@{0}: commit: 更新原型与文档数据
6e5bef5 HEAD@{1}: reset: moving to HEAD
6e5bef5 HEAD@{2}: commit (initial): 更新原型与文档数据
```

时间：

- `6e5bef5`：2026-09-23 15:58:29 +0800
- `e286405`：2026-09-23 15:58:55 +0800

```text
$ git -C .devdata/sandbox rev-list --left-right --count main...origin/main
0       7
```

即：**本地 main 比 `origin/main` 落后 7 个提交**（本地是远端祖先）。

`.devdata/sandbox/.git/logs/refs/remotes/origin/main`：

```text
... 6e5bef5  1790150311 +0800
6e5bef5 -> e286405  1790150337 +0800
e286405 -> 9667c69  1790150639 +0800
```

对应 2026-09-23 15:58:31 / 15:58:57 / 16:03:59。也就是说：

- 9 月 23 日 15:58 的两次提交曾成功推到 Gitee（`origin/main` 被更新到 `e286405`）。
- 16:03:59 远端被更新到 `9667c69`（Gitee 网页端又产生了 7 个提交，`git log --all` 可见 `新建 新的`、`删除文件 ...` 等）。
- **此后沙箱没有任何新提交、fetch 或 push**；`FETCH_HEAD` 也停在 2026-09-23 16:32:48。

结论：

- 应用“上传”最后一次成功是 **2026-09-23 15:58**，不是 11 月。
- 11 月 12 日打开面板/操作时没有产生新 commit，所以也没有可上传的内容。
- 如果现在直接对沙箱做“上传”，由于远端领先 7 个提交，**新提交会被 non-fast-forward 拒绝**；但当前连新提交都没有，所以 push 实际会是 “Everything up-to-date” 或在上传前就因未勾选文件而返回。

### 3.3 配置与凭据

`.devdata/git-config.json`（开发态应用配置，最后修改 2026-09-23 15:54:29）：

```json
{
  "defaultConfig": {
    "remoteUrl": "https://gitee.com/duuckwang/test.git",
    "branch": "main"
  },
  "projects": {
    "测绘1": {
      "remoteUrl": "https://gitee.com/duuckwang/test.git",
      "branch": "main"
    }
  }
}
```

`.devdata/git-credentials.json`：

- `测绘1` 条目存在。
- `usernameEnc`、`tokenEnc` 均非空。
- 按 `git/config-store.js:114-115,160-165` 的逻辑，**hasToken 应为 true**（密文未解密，报告不展示任何密文/明文）。

authorName / 提交身份：

- `.devdata/git-config.json` 中**没有 authorName 字段**。
- 沙箱仓库本地配置 `.devdata/sandbox/.git/config:13-14`：`user.name = 产品设计师`、`user.email = designer@local`。
- 主仓库未在 `.git/config` 覆盖提交身份，使用全局 `C:\Users\allow\.gitconfig:11-12` 的 `user.name` / `user.email`。

`%APPDATA%\原型工具\git-config.json`（打包版应用配置，最后修改 2026-09-23 14:25:19）指向另一个仓库：

```text
https://codeup.aliyun.com/68993dc39eda9d4e3ee49534/PRFile.git
```

**三个远端不是同一个：**

| 使用方 | 远端 | 文件 |
|---|---|---|
| 主代码仓 | `https://github.com/duuckwang-byte/PRTool.git` | `.git/config:9` |
| 开发态应用“上传” | `https://gitee.com/duuckwang/test.git` | `.devdata/git-config.json:3,8` |
| 打包版应用“上传” | `https://codeup.aliyun.com/.../PRFile.git` | `%APPDATA%\原型工具\git-config.json` |

所以：**即使用户在应用里看到“上传成功”，也不会更新 GitHub 上的 PRTool 代码仓**；应用上传的是沙箱里的原型文件，不是 `src/`、`docs/` 这些源码。

### 3.4 发现的配置 bug：`branch.main.remote` 被写成了 URL

`.devdata/sandbox/.git/config:15-17`：

```ini
[branch "main"]
    remote = https://gitee.com/duuckwang/test.git
    merge = refs/heads/main
```

`branch.<name>.remote` 应该是 remote 名（如 `origin`），这里却被写成了 URL。验证：

```text
$ git -C .devdata/sandbox rev-parse --abbrev-ref '@{u}'
fatal: upstream branch 'refs/heads/main' not stored as a remote-tracking branch
```

这直接导致：

- `git status -sb` 只显示 `## main`，无法显示 ahead/behind。
- 应用里判断“本地是否领先远端”的逻辑可能拿不到正确的 upstream。

来源指向 `main/services/git-workflow-service.js:795`：

```js
const pushArgs = [...auth.argsPrefix, 'push', '-u'];
...
pushArgs.push(plainUrl, `HEAD:refs/heads/${branch}`);
```

`git push -u <url> HEAD:refs/heads/main` 会把 upstream 写成那个 URL。建议改为不带 `-u` 的显式 URL push，事后再用 `git branch --set-upstream-to=origin/<branch>` 设置（前提是存在名为 `origin` 的 remote）。

---

## 4. 日志与时间线

### 4.1 应用日志

| 位置 | 内容 | 是否有 git 记录 |
|---|---|---|
| `.devdata/logs/app-2026-11-11.log` | 956 字节，全部是 `[error][ai]` | 否 |
| `%APPDATA%\原型工具\logs\app-2026-11-12.log` | 308 字节，`[error][ai]`（Qoder/Qwen/Session interrupted） | 否 |
| `.devdata/logs/` 下 2026-11-12 | **没有 app-2026-11-12.log** | — |
| `sandbox/`、`.devdata/sandbox/` | 无 `*.log`（只有原型文件、`.context`、`.git`） | — |

最近 24 小时（2026-11-12 09:30 之后）内，应用日志中没有 git 相关行；唯一 git 相关记录来自 Windows Application 事件日志（§4.2）。

`git:push` / `git:test` / `git:status` 关键字在 `.devdata/logs` 与 `%APPDATA%\原型工具\logs` 的应用日志中 **0 命中**。

`gitPushFailLog()` 会把 commit/push 失败写到 `logsDir()`（`main/services/git-workflow-service.js:831-841`；`logsDir()` 定义在 `main/services/sandbox-storage-service.js:111`）。**没有任何 `[git:push] ... failed` 记录**，说明 push 没有走到失败落盘那一步。

### 4.2 时间线

| 时间（+0800） | 事件 | 证据 |
|---|---|---|
| 2026-09-23 15:58:29 | 沙箱首次提交 `6e5bef5` | `git log` |
| 2026-09-23 15:58:55 | 沙箱第二次提交 `e286405` | `git reflog` |
| 2026-09-23 15:58:57 | `origin/main` 更新到 `e286405`（推送成功） | `.git/logs/refs/remotes/origin/main` |
| 2026-09-23 16:03:59 | `origin/main` 更新到 `9667c69`（远端网页端 7 个提交） | 同上；`git log --all` |
| 2026-09-23 16:32:48 | 最后一次 `FETCH_HEAD` | `.devdata/sandbox/.git/FETCH_HEAD` |
| 2026-09-30 11:11:05 | 主仓提交 `77192dd` | `git log -1` |
| 2026-09-30 11:11:28 | GitHub `origin/main` `update by push` | `.git/logs/refs/remotes/origin/main` |
| 2026-11-12 20:42:20 | `git-workflow-service.js` 最后修改（P2-1 修复已在文件中） | 文件 mtime |
| **2026-11-12 21:01:37** | **`git-credential-manager.exe` 崩溃（.NET 1026）** | Windows Application 日志 |
| 2026-11-12 21:23:38 | 沙箱 `.git/config` 被重写（与 `ensureSandboxGitRepo` 的 `core.quotepath` / `user.name` / `user.email` 写入点一致，见 `:414,429,432`；本次未产生 commit/push）。注：11-13 09:27:06 应用/测试再次运行时又重写为同一内容 | 文件 mtime |
| 2026-11-12 21:23:49 | Playwright `.last-run.json`（后于 11-13 09:27 又更新为 passed） | `test-results/.last-run.json` |
| 2026-11-13 09:16:23 | 当前开发态 Electron 启动 | 进程 CreationDate |
| 2026-11-13 诊断时 | 无 git/GCM 进程，Application 日志无新 git 事件 | 进程快照 / 事件日志 |

**重要对照：** `git-workflow-service.js` 的修复文件 mtime 是 11-12 20:42，而 GCM 崩溃发生在 21:01（相隔 19 分钟）。若 21:01 运行的应用实例是在 20:42 之后启动的，则说明 **即使 `GCM_INTERACTIVE=never` 已生效，GCM 仍被拉起并崩溃**；崩溃发生在 GCM 的 Trace2 初始化阶段，早于它读取交互配置，所以这个环境变量无法阻止这类启动崩溃。反之，如果该实例启动于 20:42 之前，则它加载的还是旧代码，弹窗属于修复前行为。

### 4.3 网络代理

`C:\Users\allow\.gitconfig:2,5` 配置了：

```ini
[http]
    proxy = http://127.0.0.1:7897
[https]
    proxy = http://127.0.0.1:7897
```

诊断时 `127.0.0.1:7897` **正在监听**，`clash-verge` / `verge-mihomo` 进程在运行。因此“代理没开导致 push 失败”不是当前的首要嫌疑；但若代理规则把 Gitee 走了不可达节点，仍可能造成网络失败（本次未做联网验证）。

---

## 5. 结论：A / B / C 三选一

### A) 凭据交互弹窗（GCM）反复弹 —— **最可能，置信度高**

支持证据：

1. Windows 事件日志明确记录 `git-credential-manager.exe` 在 2026-11-12 21:01:37 启动并崩溃（.NET 1026）。
2. 全局 credential helper 是 `manager`（`.gitconfig:18`）；Gitee 没有已存凭据（`cmdkey /list` 无 gitee 条目）。
3. 应用打开 Git 面板就会走 `listBranches → git ls-remote`（`GitPanel.tsx:255,147` → `git-workflow-service.js:542`），每次都可能拉起 GCM。
4. 本次事件记录中 GCM 2.7.3 在 Git 2.54 下于 Trace2 初始化阶段崩溃，会产生窗口/控制台闪烁或崩溃提示。
5. `GCM_INTERACTIVE=never` 只能阻止“交互提示”，不能阻止 GCM 被启动，也不能阻止它在读取该配置前崩溃。

不能确认的部分：

- 无法离线确认 Gitee token 是否已过期/被撤销，或 safeStorage 是否解密失败；只能确认密文存在（hasToken 应为 true）。
- 无法精确统计弹窗次数；事件日志只留下 1 次崩溃记录。

### B) 每条 git 命令都闪 console 窗口（缺 windowsHide）—— **基本排除**

- 唯一 git spawn 点已设置 `windowsHide: true`（`git-workflow-service.js:355`），HEAD 版本也有（`:210`）。
- GitPanel 的 1s 定时器只读内存，不 spawn git（`GitPanel.tsx:279` → `git-controller.js:43` → `git-workflow-service.js:1185`）。
- legacy 没有 git 定时轮询。
- 唯一保留的解释是：**GCM 孙进程**不受 git 的 `windowsHide` 约束，可能产生控制台闪烁；这属于 A 的表现，不是“git 命令本身缺 windowsHide”。

### C) 上传确实失败（认证/远端/网络）—— **“没上传成功”成立，但不是“推了被拒”**

- 主仓 HEAD 停在 2026-09-30；11 月的 96 项改动全部未提交。**没有新提交，就没有可推的内容。**
- 沙箱 HEAD 停在 2026-09-23；11 月没有新 commit、没有 fetch、没有 push。
- 没有任何 `[git:push] ... failed` 日志，说明没有走到 push 失败分支。
- 沙箱本地落后远端 7 个提交；即使现在补提交，普通 push 也会 non-fast-forward。要上传必须先 pull/merge（或明确选择 force，但会覆盖远端 7 个提交，风险高）。
- 应用配置的远端是 Gitee 测试仓/Codeup，不是 GitHub PRTool。**应用内“上传”不会发布代码到 GitHub。**

### 最可能根因（合并表述）

> 用户打开 Git 面板/测试连接时，应用执行 `git ls-remote` 访问 Gitee；由于 Gitee token 未被接受（过期/解密失败/用户名不匹配），git 转而调用全局 GCM。本次日志显示 GCM 2.7.3 在启动阶段崩溃，导致窗口反复闪烁/弹出；同时因为本地没有新提交，上传链路从未真正走到 push，所以“上传没成功”。

---

## 6. 建议动作

### 6.1 立即（不需要改代码）

1. **当前没有 git 进程需要关闭**（0 个）。不要为了“清窗口”去杀 Electron 或全部 `git.exe`。
2. 如果弹窗正在发生，先记录再处理：
   ```powershell
   Get-CimInstance Win32_Process |
     Where-Object { $_.Name -match 'git-credential-manager|git-remote-https' } |
     Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine
   ```
   只结束 `git-credential-manager.exe` / `git-remote-https.exe`；不要结束正在 commit/push 的 `git.exe`。
3. 在应用“仓库设置”里**重新保存一次 Gitee 的 username + PAT**（需要有 write 权限），然后只点一次“测试连接”：
   - 若不再弹 GCM，说明此前是 token 失效/解密失败；
   - 若仍弹/闪，直接进入 6.2 的代码修复。
4. 不要用“强制覆盖上传”解决当前问题：沙箱远端领先 7 个提交，强制会覆盖 Gitee 上的网页端修改。先备份/确认。

### 6.2 代码修复（需负责人批准；本次未改）

| 优先级 | 修改点 | 目的 |
|---|---|---|
| P1 | `main/services/git-workflow-service.js:351-358`：当 `auth.argsPrefix` 非空时，给 git 参数加 `-c credential.helper=`（或用 `GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0/GIT_CONFIG_VALUE_0` 注入空 helper） | **彻底不启动 GCM**；token 无效时直接失败，而不是弹窗/崩溃 |
| P1 | `main/services/git-workflow-service.js:795`：去掉 `push -u`，改为 `push <url> HEAD:refs/heads/<branch>`；如需 upstream，单独 `git branch --set-upstream-to=origin/<branch>` | 修复 `branch.main.remote=<URL>`（`.devdata/sandbox/.git/config:16`）和 upstream 失效 |
| P2 | `src/renderer/features/git/GitPanel.tsx:255` / `:147`：面板挂载时先只读本地分支，网络 `listBranches` 改为显式“刷新/测试连接”触发 | 减少无意义的 GCM 触发次数 |
| P2 | 升级/固定 GCM 版本，或确认 Git 2.54 与 GCM 2.7.3 的兼容性 | 规避 `Trace2.Initialize` 启动崩溃 |
| P2 | 为“有 token 时不得出现 git-credential-manager 子进程”加集成测试 | 防止回归 |

### 6.3 如果目标是把 11 月成果上传到 GitHub

这不是应用 Git 面板能做到的：

- 主仓有 96 项未提交变更，需要先有意识地 `git add` + `commit`，再 `git push` 到 `https://github.com/duuckwang-byte/PRTool.git`。
- 本次诊断按约束**没有**执行 add/commit/push。
- 应用面板的“上传”只覆盖 `.devdata/sandbox` 下的原型文件（`测绘1/`、`测试1/` 等），不包含 `src/`、`docs/`、`main/` 等源码目录。

---

## 7. 证据局限

1. 未执行 `git fetch / pull / ls-remote / push`，远端最新状态未知；文中 ahead/behind 均基于最后一次本地 fetch（Gitee：2026-09-23 16:03；GitHub：2026-09-30 11:11）。
2. 未解密 token，只确认密文非空；token 是否过期/有写权限无法离线判断。
3. 事件日志只能证明至少一次 GCM 启动崩溃，无法还原弹窗总次数，也无法 100% 区分是应用还是终端手工 git 触发。
4. 文档中没有“85”这个数字，只有“多枚历史残留”；本报告不把 85 当作已核实事实。
