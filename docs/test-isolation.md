# 真机测试并行隔离（PLAND_DEV_DATA_DIR）

## 1. 背景

开发态下 Electron 的 `userData` 固定指向仓库根目录的 `.devdata/`。同一台机器上并行跑多个真机测试（多个 agent、多个 Playwright worker）时，所有实例会同时读写同一份磁盘状态，典型串扰包括：

- 项目列表、`protoLastProject`、沙箱目录被并发创建/切换；
- `localStorage` / `Preferences` / 窗口状态互相覆盖；
- `ai-config.json`、`git-config.json`、`git-credentials.json` 等凭据被并发改写；
- 一个实例弹出的项目选择器遮住另一个实例的页面，造成假失败。

`PLAND_DEV_DATA_DIR` 用于给每个并行实例分配独立的 Electron 用户数据目录，从根上隔离上述状态。

## 2. 隔离机制

实现位置：`main.js` 顶部，`app.setName()` 与所有 `main/paths`、`main/services` 加载之前。

```js
if (!app.isPackaged) {
  var _devDataDir = path.join(__dirname, '.devdata');
  var _devDataEnv = String(process.env.PLAND_DEV_DATA_DIR || '').trim();
  if (_devDataEnv) _devDataDir = path.resolve(__dirname, _devDataEnv);
  app.setPath('userData', _devDataDir);
}
```

规则：

| 场景 | 实际 userData |
| --- | --- |
| 打包态（`app.isPackaged === true`） | Electron 默认目录，忽略 `PLAND_DEV_DATA_DIR`，行为不变 |
| 开发态，未设置/空值/纯空白 | `<仓库根>/.devdata`（与改造前一致） |
| 开发态，相对路径 | 以 `main.js` 所在目录（仓库根）为基准解析 |
| 开发态，绝对路径 | 原样使用 |

因为 `main/paths.js` 以及所有服务都通过 `app.getPath('userData')` 派生路径，以下内容会随目录自动隔离，无需改动业务代码：

- 业务数据：`sandbox/`、`specs/`、`uilibs/`、`snapshots/`、`logs/`；
- 凭据与配置：`ai-config.json`、`ai-credentials.json`、`git-config.json`、`git-credentials.json`、`acp/`；
- Electron/Chromium 状态：`Local Storage`、`Session Storage`、`Cache`、`Preferences`、`Local State` 等。

本改动不涉及 IPC 通道（70 通道契约不变）、`webPreferences` 安全配置或渲染层代码。

## 3. 并行使用

### 3.1 命名约定

每个并行 agent/用例使用互不相同的目录，建议带角色或 run id：

```text
.devdata-smoke-ai
.devdata-smoke-agent-b
.devdata-e2e-20261113-01
```

同一个目录同一时刻只允许一个 Electron 实例使用。需要串行复用同一目录时，先退出应用并清理，或换新目录。

### 3.2 命令行启动

PowerShell（每个 agent 使用独立终端）：

```powershell
$env:PLAND_DEV_DATA_DIR = ".devdata-smoke-ai"
npm start
```

bash / Git Bash：

```bash
PLAND_DEV_DATA_DIR=.devdata-smoke-ai npm start
```

绝对路径同样可用：

```powershell
$env:PLAND_DEV_DATA_DIR = "D:\tmp\pland-smoke-ai"
npm start
```

### 3.3 Playwright `_electron` 启动

在 `_electron.launch()` 的 `env` 中传入唯一目录，并可用 `app.evaluate` 回读实际路径做断言：

```ts
const app = await _electron.launch({
  args: ['.'],
  cwd: ROOT,
  env: {
    ...process.env,
    PLAND_RENDERER: 'react',
    PLAND_DEV_DATA_DIR: path.join(ROOT, '.devdata-smoke-ai'),
  } as Record<string, string>,
})
const page = await app.firstWindow()
await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 30_000 })
const userData = await app.evaluate(({ app }) => app.getPath('userData'))
console.log('userData =', userData)
```

多个 agent 只改变 `PLAND_DEV_DATA_DIR` 的值即可并行，不要共用同一个目录。

注意：新目录是全新的 Electron profile，首次启动只有默认项目/空凭据。依赖固定测试数据的用例，需要在该目录内自行准备种子数据（复制 fixture 或通过用例创建），不能依赖共享 `.devdata` 里的历史状态。

## 4. 清理

先关闭对应 Electron 进程，再删除目录（Windows 下进程未退出时文件可能被占用）。

PowerShell：

```powershell
Remove-Item -Recurse -Force .devdata-smoke-ai
```

bash：

```bash
rm -rf .devdata-smoke-ai
```

批量清理所有冒烟临时目录前先确认列表，避免误删正式开发目录 `.devdata`：

```powershell
Get-ChildItem -Directory -Filter ".devdata-*" | Select-Object Name
Get-ChildItem -Directory -Filter ".devdata-*" | Remove-Item -Recurse -Force
```

## 5. `.gitignore` 建议（需 `.gitignore` 维护者处理）

当前 `.gitignore` 只有 `.devdata/`，不覆盖 `.devdata-smoke-ai` 这类并行目录。建议补充：

```gitignore
# 开发隔离数据（含并行冒烟目录）
.devdata/
.devdata-*/
```

在规则生效前，不要提交任何 `.devdata-*` 目录；提交前用 `git status --short` 确认没有临时目录或其中的凭据文件。

## 6. 冒烟验证

```powershell
node --check main.js
npm run build:renderer
```

然后用两个不同的目录各启动一次真实 Electron（Playwright `_electron`），等待 `main-window` 可见后正常关闭，并断言：

1. 两次 `app.getPath('userData')` 分别等于两个指定目录；
2. 两个路径互不相同；
3. 两次主进程都正常退出（`exitCode === 0`，无残留窗口）；
4. 目录内生成各自的 `sandbox/`、`Preferences` 等文件，未写入对方的目录。

验证完成后按第 4 节删除两个临时目录。

## 7. 排障

- **目录没有生效**：确认不是打包态（打包态按设计忽略该变量）；确认变量值非空、无多余引号；相对路径以仓库根（`main.js` 所在目录）为基准。
- **两个实例仍然互相影响**：检查是否给两个实例传了同一个目录；同一目录不能并行。
- **启动报目录不可用**：自定义目录不可用时实现会回退 `.devdata`，此时隔离失效，应检查路径权限/盘符。
- **清理失败**：先确认 Electron 进程已退出，再删除目录。
