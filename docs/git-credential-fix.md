# Git 凭据弹窗与 upstream 配置修复说明

- 修复对象：`main/services/git-workflow-service.js`
- 新增测试：`tests/verify-git-credential.js`（独立运行；本轮未改 `tests/run-all.js`）
- 依据：`docs/git-popup-diagnosis.md`（A 类根因：凭据交互/GCM 被反复拉起；upstream 被写成 URL）
- 约束：未联网、未真实 push、未新增依赖、未改 UI、未 commit

## 1. 根因 → 修复点对照

| 根因 | 触发路径 | 修复点 |
|---|---|---|
| token 未被接受时，git 回落到全局 credential helper（GCM） | `auth.argsPrefix` 只注入 `http.extraHeader`，未禁用 helper | `runGit` 统一经 `buildGitSpawnArgs()` 注入 `-c credential.helper=`（空 helper），并保留非交互 env |
| GCM 在 `Trace2.Initialize` 阶段即崩溃，`GCM_INTERACTIVE=never` 拦不住启动 | 同一条 git 命令仍会 spawn `git-credential-manager.exe` | 空 helper 从配置层直接清空 helper 列表，GCM 根本不会被启动 |
| 打开面板/测试连接就 `ls-remote`，无凭据时反复弹窗 | `gitListBranchesImpl` / `gitTestConnectionImpl` 无条件发起网络请求 | 无 token 时**不进入网络分支**，直接返回 `NEED_AUTH` |
| `git push -u <url>` 把 `branch.<name>.remote` 写成 URL | `gitPushImpl` 的 `pushArgs` 含 `-u` | 改为 `push <url> HEAD:refs/heads/<branch>`，不再产生 URL upstream |
| 已存在的 `branch.*.remote=<URL>` 不会自愈 | 无任何配置修复逻辑 | 新增 `healGitUpstream()`，在操作入口/保存配置/自愈修复时纠正为 `origin` 并补 `merge` |

## 2. 空 credential helper：确保 GCM 不启动

`main/services/git-workflow-service.js` 新增：

```js
const GIT_CREDENTIAL_HELPER_ARGS = Object.freeze(['-c', 'credential.helper=']);

function buildGitSpawnArgs(args) {
  return ['-c', 'core.quotepath=false', ...GIT_CREDENTIAL_HELPER_ARGS, ...args];
}
```

- `runGit()` 是唯一的 git spawn 点，现统一使用 `buildGitSpawnArgs(args)`，因此**所有** git 命令（含带 token 的 `ls-remote/fetch/push/pull`）都带空 helper。
- 空 helper 在 git 配置层表示“重置 helper 列表”，本地/全局 `credential.helper = manager` 会被清空，GCM 不会被拉起；token 无效时只会直接鉴权失败并返回可读错误。
- 空 helper 位于业务 `args` 之前，调用方传入的 `-c http.extraHeader=...` 无法覆盖它。
- 环境继续强制：

```js
GCM_INTERACTIVE: 'never',
GIT_TERMINAL_PROMPT: '0',
GIT_ASKPASS: 'echo',
SSH_ASKPASS: 'echo'
```

`buildGitChildEnv()` 将上述键放在调用方 env 之后，调用方不可覆盖。`stdio` 保持 `['ignore', 'pipe', 'pipe']`，凭据交互没有 stdin 可读。

> 测试已用真实 git 验证：临时仓库配置假 helper 后，普通 `git credential fill` 会调用 helper（marker 生成）；使用 `buildGitSpawnArgs(['credential','fill'])` 后 helper 不再被调用（marker 不生成）。

## 3. 无凭据通道行为（不再触发 GCM）

新增 `hasUsableGitCredential(cred)`：只有非空 token 才算可用凭据（仅用户名无法构造 `extraHeader`）。无 token 时统一返回：

```js
{ ok: false, code: 'NEED_AUTH', error: '未配置 Git 账号或 Access Token：已跳过远程访问（不会弹出系统凭据窗口）...' }
```

| 通道 | 无 token 行为 |
|---|---|
| `git:list-branches` | 不执行 `ls-remote`，返回 `NEED_AUTH`，同时附带本地分支、`currentBranch`、`remoteConfigured:true` |
| `git:test-connection` | 不执行探测，直接 `NEED_AUTH` |
| `git:fetch-diff` | 不执行 `fetch`，直接 `NEED_AUTH` |
| `git:pull` | 不执行 `fetch`，直接 `NEED_AUTH` |
| `git:push` | 在 `reset/add/commit` **之前**返回 `NEED_AUTH`，不产生注定推不上去的本地提交 |
| `git:status` | 保持正常返回本地状态（见下） |

`git:status` 的说明：该通道只执行 `status / rev-parse / diff / ls-tree / config` 等**纯本地**命令，代码中不存在 `ls-remote/fetch/push/pull`，因此本身不会触发 GCM。无凭据时若强行返回 `NEED_AUTH`，会让用户看不到本地待上传文件，属于功能回退；本修复选择保持本地状态可用，并由两层机制兜底：

1. 通道内不添加任何远端命令；
2. 万一未来新增远端命令，`runGit` 的空 helper + 非交互 env 也会阻止 GCM。

`git:status` 入口仍会经过 `ensureSandboxGitRepo()`，因此打开面板/读取状态时会顺带执行 upstream 自愈（纯本地配置命令）。

## 4. upstream 自愈逻辑

新增 `healGitUpstream(cwd, branch, remoteUrl)`，只执行本地 `git config` / `git remote` / `rev-parse`，不联网、不涉及凭据：

1. `git config --local --get-regexp '^branch\..*\.remote$'` 枚举所有分支的 remote 配置，并补充当前分支作为兜底检查对象。
2. 用 `isGitRemoteUrlValue()` 判断值是否是地址形态：
   - `https://...`、`git://...` 等带协议；
   - `git@host:path` scp 形态；
   - Windows 盘符路径（`D:\...`）或 `/...` 本地路径。
3. 命中地址形态时：
   - `origin` 已存在 → `git remote set-url origin <应用配置 URL>`；
   - `origin` 不存在 → `git remote add origin <应用配置 URL>`；
   - `git config --local branch.<name>.remote origin`；
   - 若 `branch.<name>.merge` 缺失 → 写入 `refs/heads/<name>`。
4. 已是 `origin` 但缺 `merge` 的分支也补齐 `refs/heads/<name>`，恢复 `@{u}` 与 ahead/behind。
5. 全程 `try/catch`，无仓库/坏仓库时安全返回 `{healed:false}`，不抛错、不删除任何文件。

调用点：

- `ensureSandboxGitRepo()`：`git:config-save`、`git:status`、`git:push`、`git:fetch-diff`、`git:pull` 的共同入口，覆盖“保存配置时自愈”和“每次操作启动时自愈”；
- `gitHealRepairImpl()`：仓库自愈修复完成后再次校正；
- `gitPushImpl()` 推送成功后再次校正，防止历史 `-u` 残留。

修复前后示例：

```ini
# 修复前（push -u <url> 遗留，upstream 失效）
[branch "main"]
    remote = https://gitee.com/duuckwang/test.git
    merge = refs/heads/main

# 修复后
[branch "main"]
    remote = origin
    merge = refs/heads/main
```

测试验证：补齐后执行 `git rev-parse --abbrev-ref '@{u}'` 返回 `origin/main`；重复执行自愈返回 `healed:false`（幂等）。

## 5. 接口与兼容性

- 11 条 git IPC 通道及 controller/preload 未变；成功返回字段未删改。
- `NEED_AUTH` 属于既有错误结构 `{ok:false, code, error}` 的新 code 值，前端现有“错误分支/toast”可直接消费；`git:list-branches` 的 NEED_AUTH 仍附带 `branches/currentBranch/remoteConfigured`，兼容现有读取方式。
- 未新增 npm 依赖；未改 `GitPanel.tsx` / `MainWindow` / `preload.js` / `main.js`。
- 未改 `tests/run-all.js`，新测试独立运行。

## 6. 新增测试覆盖

`tests/verify-git-credential.js`（20 条，全部本地临时仓库，不联网）：

| 组 | 覆盖 |
|---|---|
| A01–A03 | argv 统一含 `-c credential.helper=`；非交互 env 不可覆盖；真实 git 语义下 helper 不被调用 |
| B01–B03 | 显式 URL push 不写 `branch.remote`；旧 `push -u <url>` 根因对照；源码不再出现 `push -u` |
| C01–C04 | URL upstream 改写为 origin + 补 merge；`@{u}` 可解析；幂等/无仓库安全；URL 形态识别 |
| D01–D06 | 无 token 判定；status 本地可用且自愈；list-branches 快速 `NEED_AUTH`；test-connection/fetch-diff/pull/push 全部 `NEED_AUTH`；status 不调用 helper；保存配置自愈 |
| E01–E04 | `runGit` 单源空 helper；list-branches 凭据前置早于 `ls-remote`；status 零远端命令；ensure/heal-repair 调用自愈 |

## 7. 验证结果

| 命令 | 结果 |
|---|---|
| `node --check main/services/git-workflow-service.js` | 通过（SYNTAX_OK） |
| `node tests/verify-git-security.js` | 41/41 PASS（GITSEC_PASS） |
| `node tests/verify-ipc.js` | 4/4 PASS |
| `node tests/verify-git-credential.js` | 20/20 PASS（GITCRED_PASS） |
| `node tests/lint-guard.js` | LINT_PASS（304 个 JS/TS，WARN 均为既有存量） |

验证过程未访问任何远端、未执行真实 push；push/upstream 测试仅使用 `os.tmpdir()` 下的临时仓库与本地 bare 仓库。

## 8. 已知边界

1. 无 token 时不再对**公开仓库**做匿名 `ls-remote/fetch`——这是“绝不弹凭据窗口”的取舍；需要浏览远端分支时请先保存 Token。
2. 本修复不升级 GCM，也不改变系统 `.gitconfig`；它只是保证应用拉起的 git 不再调用任何 helper。终端里手工执行 git 仍可能触发 GCM 崩溃，需要单独升级/固定 GCM 版本。
3. `git:status` 不返回 `NEED_AUTH` 是有意设计（纯本地、无网络）；无凭据用户仍可看到本地变更并决定是否先配置凭据。
4. 自愈只改本地仓库 `.git/config`，不会修改远端，也不会删除分支或提交。
