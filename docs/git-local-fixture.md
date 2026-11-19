# Git 本地 bare 夹具（开发态）

- 日期：2026-11-13
- 范围：仅后端 Git URL 白名单；不改 UI、不加依赖、不改 IPC 通道
- 相关代码：`git/auth.js`、`git/config-store.js`
- 回归：`tests/verify-git-local-fixture.js`

## 1. 目的

真机测试需要不触网的远端（本地 bare 仓库）来覆盖 push / pull / fetch-diff / 分支列表。
本方案在**不进入生产**的前提下，为开发态增加一个最小放行口；默认行为仍是 https-only。

## 2. 放行条件（三道闸，缺一不可）

| # | 闸门 | 规则 | 位置 |
| --- | --- | --- | --- |
| 1 | 运行态 | `app.isPackaged === false`；无法确认运行态按打包态处理（fail-closed） | `git/auth.js:isPackagedApp` |
| 2 | 环境变量 | `PLAND_GIT_ALLOW_LOCAL` trim 后必须严格等于 `'1'`（`true`/`yes`/`0`/空均无效） | `git/auth.js:isLocalFixtureAllowed` |
| 3 | URL/路径 | 仅 `file:///` 本地 bare 仓库绝对路径，详见下表 | `git/auth.js:assertAllowedLocalFixtureUrl` |

`file:///` 路径还必须同时满足：

- 必须三斜杠 `file:///`；拒绝 `file://host/...`、`file://C:/...`、`file:////server/...`（UNC）
- Windows 必须是盘符绝对路径，如 `file:///C:/Temp/pland-fixture/repo.git`
- 路径存在、是目录，且为 bare 仓库：含 `HEAD`、`objects`、`refs`，`config` 中 `core.bare=true`
- 拒绝工作区 `.git`、普通目录、普通文件、不存在的路径
- 拒绝反斜杠、`..` / `.` 段（含 `%2e%2e`）、编码斜杠 `%2f`、控制字符、查询串 `?`、片段 `#`、用户名/口令
- 长度 ≤ 500

只有第 3 闸的建议写法：`git init --bare C:\Temp\pland-fixture\repo.git`，URL 填
`file:///C:/Temp/pland-fixture/repo.git`。

## 3. 明确仍拒绝（即使开发态 + env=1）

| 输入 | 结果 |
| --- | --- |
| `http://example.com/repo.git` | `GIT_URL_BLOCKED` |
| `ssh://git@example.com/repo.git`、`git@example.com:repo.git` | `GIT_URL_BLOCKED` |
| `C:\repo.git`、`C:/repo.git`、`\\server\share\repo.git`、`/home/u/repo.git`、`repo.git` | `GIT_URL_BLOCKED` |
| `file://server/share/repo.git`、`file:////server/share/repo.git` | `GIT_URL_BLOCKED` |
| `file:///.../not-a-repo`、`file:///.../plain.txt`、`file:///.../.git`（工作区） | `GIT_URL_BLOCKED` |
| `ext::`、`fd::`、`--upload-pack` / `--receive-pack` / `--exec` / `-e` | `GIT_URL_BLOCKED` |
| 带用户名/口令的 https URL | `GIT_URL_BLOCKED`（凭据仍走输入框 + extraHeader） |

其他安全设计不变：

- Token 不拼 URL，仍走 `http.extraHeader` / `GIT_HTTP_EXTRAHEADER`
- `NEED_HEAL`（嵌套/缺库/坏库）不自动删除、不自动 init
- Git 子进程仍强制空 `credential.helper` + 非交互 env
- `git/config-store.js` 在落盘前再做一次 URL 白名单，防止绕过 IPC 入口直写配置

## 4. 生产边界

1. **打包态永不放宽**：`app.isPackaged === true` 时，即使外部环境带 `PLAND_GIT_ALLOW_LOCAL=1`，`file://` 仍拒绝。
2. **环境变量不是唯一开关**：仅设置 env、不处于未打包开发态，不会放行任何非 https。
3. **fail-closed**：纯 Node / 无法读取 `electron.app.isPackaged`（如测试或异常上下文）按打包态处理。
4. **开关单点**：生产代码中只有 `git/auth.js` 读取 `PLAND_GIT_ALLOW_LOCAL`；`tests/verify-git-local-fixture.js` 的 G01 会静态扫描并断言这一点。
5. **落盘二次校验**：`saveProjectGitConfig` 对非空 `remoteUrl` 调用同一白名单；被拒地址不会写入 `git-config.json`。
6. `_setPackagedForTest` 仅供回归测试注入打包态，生产路径不调用；渲染进程无法访问主进程模块。
7. 没有新增 IPC 通道、没有 UI 改动、没有新增 npm 依赖。

## 5. 真机测试用法

```powershell
# 1) 建一次性 bare 夹具（不要指向业务仓库或工作区 .git）
git init --bare C:\Temp\pland-fixture\repo.git

# 2) 仅本次开发进程设置开关
$env:PLAND_GIT_ALLOW_LOCAL = '1'

# 3) 以未打包开发态启动应用
#    （沿用现有开发启动方式；打包产物不会放行）
```

远端地址填：`file:///C:/Temp/pland-fixture/repo.git`。

注意事项：

- 本地 file 传输不需要真实凭据，但现有 Git 通道在 `test-connection` / `push` / `pull` 前仍要求“已保存 token”（`NEED_AUTH` 保护，避免拉起 GCM）。测试时请在**隔离的开发数据目录**（如 `PLAND_DEV_DATA_DIR`）里填一个**假 token**，不要使用任何真实 token；`http.extraHeader` 对本地 file 传输无效，不会外发。
- **UI 边界**：Git 设置弹窗的前端校验（`js/project-ai-export.js:gitRemoteUrlMsg`）仍按 https-only 拦截，本次按“不改 UI”要求未放开。真机测试若走设置弹窗，会在前端就被拦下；需直接调用后端 IPC（见下）或在后续单独任务中评审 UI 放行。保存成功后，push / pull / fetch-diff 等后端通道直接读取已保存配置，不再经过该前端输入校验；按钮是否可用仍取决于现有 UI 状态。
- 直接用 IPC 保存/探测的示例（在 DevTools Console 或 e2e 中）：

```js
await window.protoAPI.git.testConnection({
  project: '测试1',
  remoteUrl: 'file:///C:/Temp/pland-fixture/repo.git',
  token: 'dummy-local-fixture-token'
});
await window.protoAPI.git.saveConfig({
  project: '测试1',
  config: { remoteUrl: 'file:///C:/Temp/pland-fixture/repo.git', branch: 'main' }
});
```

- 测试结束：关闭应用、`Remove-Item Env:PLAND_GIT_ALLOW_LOCAL`，删除临时 bare 夹具。

## 6. 回归与验收

```text
node --check git/auth.js
node --check git/config-store.js
node tests/verify-git-security.js       # 原 41 项
node tests/verify-git-credential.js     # 原 20 项
node tests/verify-git-local-fixture.js  # 新增 31 项
node tests/verify-ipc.js
node tests/lint-guard.js
```

新增用例覆盖：

- 默认（未设置 env）拒绝 `file://`；打包态、运行态未知、env 非 `1` 均拒绝
- 开发态 + env=1 放行真实 `git init --bare` 夹具（含空格路径、`git ls-remote` 可用）
- `http` / `ssh` / scp / 裸绝对路径 / UNC / 非 bare `.git` / 普通目录 / 普通文件 / 查询串 / 点段 / 编码斜杠均拒绝
- `https` 在默认、打包态、env=1 下均正常放行；带用户信息的 https 仍拒绝
- `config-store` 默认态与打包态不落盘 `file://`，开发态 + env 可落盘
- 静态扫描：`PLAND_GIT_ALLOW_LOCAL` 仅出现在 `git/auth.js`

## 7. 回滚

- 去掉 `PLAND_GIT_ALLOW_LOCAL` 即刻恢复 https-only，无需改代码或清理数据。
- 若开发数据中已保存 `file://` 配置，后续未放行时会以 `GIT_URL_BLOCKED` 失败（fail-closed）；重新保存 https 地址即可，不会被静默使用。
- 完全回滚代码：删除 `git/auth.js` 中的本地夹具分支与 `git/config-store.js` 的落盘前校验，并删除本文件与新增测试。
