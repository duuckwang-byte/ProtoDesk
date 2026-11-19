# B6 P1 修复：快照恢复 EPERM（Windows / Electron 37 / Node 22）

- 关联证据：`docs/wave4/reports/b-git-export.md` §7、`docs/wave4/shots/b-git-export/12-snapshot-restore-fail-FAIL.png`
- 结论：已修复。快照恢复不再调用 `fs.cpSync`，改为逐文件递归复制 + 暂存/回滚；中文/空格/长路径实测通过。
- 影响范围：仅主进程 `sandbox-storage-service.js` 的快照复制/恢复实现与测试；IPC 契约、前端调用、快照列表格式均未改变；未新增依赖。

## 1. 根因

`snapshotRestoreImpl` 在恢复前先备份当前原型：

```js
const undoDst = path.join(root, 'undo-' + fmtTs(new Date()));
fs.cpSync(dn, undoDst, { recursive: true }); // 失败点
```

Electron 37.10.3 内置 Node 22.21.1 在 Windows + 中文路径下执行 `fs.cpSync(<沙箱原型目录> → <snapshots/.../undo-*>)` 返回：

```text
EPERM, 函数不正确
'\\?\D:\...\snapshots\测试1\首页\undo-20261113-180854'
```

同一源/目标路径用系统 Node 24.15.0 执行成功，因此是 **Electron 37 内置 Node 22 的 `fs.cpSync` 运行时缺陷**，不是权限配置或路径越界。失败发生在备份阶段，尚未删除当前原型，所以历史数据未损坏，但恢复功能不可用。同一 API 也用于 `takeSnapshot`，自动任务前快照存在同样风险。

## 2. 复制实现

`main/services/sandbox-storage-service.js` 新增：

- `copyDirRecursive(src, dst)`：`readdirSync({withFileTypes:true})` + `mkdirSync` + `copyFileSync` 递归复制；
  - 逐字节复制（`copyFileSync`），不经过 `fs.cpSync`；
  - 符号链接优先按链接复制，无权限时跟随目标复制内容，避免漏文件；
  - 单文件复制遇 `EPERM/EBUSY/EACCES` 重试 3 次（每次 60ms），仍失败抛原错误；
  - 复制失败由调用方清理半成品目录。
- `winFsPath(p)`：Windows 绝对路径接近/超过 `MAX_PATH` 时加 `\\?\`（UNC 用 `\\?\UNC\`）前缀，覆盖中文、空格、超过 260 字符的深层目录。
- `fsErrorText(e)`：把 `EPERM/EACCES/EBUSY/ENOENT/ENOSPC/EXDEV` 转成可读中文，避免 Windows 乱码系统文本直接进入 toast。
- `takeSnapshot` 改用 `copyDirRecursive`；失败时删除半份快照并返回 `null`，不再留下损坏版本。
- 旧版沙箱迁移中的 `fs.cpSync` 一并替换（同一运行时缺陷，行为等价）。

## 3. 恢复流程与失败保护

`snapshotRestoreImpl` 由「备份 → 删除当前 → 复制快照」改为四步：

1. **备份当前状态**到 `snapshots/<项目>/<原型>/undo-<时间戳>`；失败立即返回
   `恢复前备份失败，已中止（当前文件未改动）：...`，不触碰当前原型。
2. **复制快照到同级暂存目录** `.restore-staging-<时间戳>-<pid>`；失败只清理暂存，当前原型与源快照均不变。
3. **同级目录交换**：当前原型 rename 为 `.restore-old-*`，暂存目录 rename 为当前原型；
   第二步失败自动 rename 回滚，仍失败则在错误中给出旧目录位置。rename 使用现有 `fsRenameRetry`（EPERM/EBUSY 重试）。
4. **成功后清理**旧副本，并按既有策略 `pruneSnapshots`。

恢复过程中源快照目录只读，不会被修改或删除；`undo-` 仍不进入 `snapshot:list`。`snapshot:restore` 的参数、返回值 `{ok,error?}` 与前端契约保持不变。

## 4. 文件清单

| 文件 | 变更 |
| --- | --- |
| `main/services/sandbox-storage-service.js` | 新增兼容复制/长路径/错误文案辅助；改写 `takeSnapshot`、`snapshotRestoreImpl`；迁移调用去 `cpSync` |
| `tests/verify-snapshot-restore.js` | 追加静态断言：快照服务无 `fs.cpSync`、递归复制存在、备份失败文案、暂存/回滚存在 |
| `tests/verify-snapshot-restore-win.js` | 新增 Windows 实测：中文/空格临时目录、快照→修改→恢复、undo、失败路径、315 字符长路径 |

未修改：`main/ipc-contract.js`、`main/controllers/sandbox-controller.js`、`preload.js`、`js/project-ai-export.js`、`package.json`。

## 5. 验证结果

| 命令 | 运行时 | 结果 |
| --- | --- | --- |
| `node tests/verify-snapshot-restore.js` | Node 24.15.0 | 5/5 PASS |
| `node tests/verify-snapshot-restore-win.js` | Node 24.15.0 | 11/11 PASS |
| `ELECTRON_RUN_AS_NODE=1 electron.exe tests/verify-snapshot-restore-win.js` | Electron 37.10.3 / Node 22.21.1 | 11/11 PASS |
| `node tests/verify-ipc.js` | Node 24.15.0 | 4/4 PASS |
| `node tests/lint-guard.js` | Node 24.15.0 | `LINT_PASS` |

Windows 实测覆盖：

1. 含中文/空格的临时目录创建快照成功；
2. 修改（改/删/增/二进制）后恢复成功，无 `EPERM`；
3. 恢复后所有文件 sha256 与快照逐字节一致；
4. `undo-*` 备份存在且内容为恢复前状态；
5. 源快照未变，`snapshot:list` 仍只返回数字时间戳；
6. 不存在的快照失败且当前文件不变；
7. 模拟 `undo` 目录创建 `EPERM`：明确报错并中止，当前文件不变、无半份备份；
8. 模拟暂存复制 `EPERM`：当前文件与源快照不变，暂存目录清理；
9. 模拟目录交换第二步 `EPERM`：自动回滚，当前文件与源快照均不变；
10. 315 字符深层路径快照/恢复逐字节一致；
11. 流程结束无 `.restore-*` 残留。

## 6. 备注

- `main/services/git-workflow-service.js` 仍有 `fs.cpSync`，用于 Git 仓库内部备份/恢复，不属于快照通道，本次未改；若后续在同类中文路径复现，可复用本次的 `copyDirRecursive`。
- 未执行 `npm install`，未提交 commit。
