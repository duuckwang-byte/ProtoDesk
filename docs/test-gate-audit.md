# 测试门禁过期断言审计（T-MAINT）

日期：2026-11-12

## 背景

Phase0 将 `package.json` 的 `build.files` 白名单从 **18 条增至 19 条**（新增 `dist/renderer/**`，React 渲染器产物随包）。旧门禁中按“恰好 18 条”硬编码的断言因此误报，与业务代码无关。

## 全仓排查口径

在 `tests/*.js` 中检索 `18`，并限定与 `files` / `build.files` / `白名单` / `startsWith('!')` 相关：

```powershell
Select-String -Path tests/*.js -Pattern "18" | Where-Object { $_.Line -match "files|白名单|whitelist|allowed|permitted" }
rg "(length\s*[,=!]==?\s*18|=== ?18|== ?18\b|18 ?条|toBe\(18\)|须为 ?18)" tests
rg "package\.json|pkg\.files|build\.files|startsWith\('!'\)" tests
```

结论：**仅 `tests/verify-inline-edit.js` 的 A10 存在 `build.files === 18` 硬编码**，其余 `18` 均为 HTML `<script>` 清单数量（仍为 18，未变化），不在本次修复范围。`tests/check-pack.js` 已由他人改为 mode-aware，未改动。

## 改动清单

### 1) `tests/verify-inline-edit.js` — A10 `testA10_NoNewScript`

**改前**（仅数量断言，新增合法条目即失败）：

```js
assert.strictEqual(filesList.length, 18, `build.files 白名单须为 18 条...`);
assert.strictEqual(filesList.filter(p => String(p).startsWith('!')).length, 6, ...);
assert.ok(filesList.includes('main/**'), ...);
assert.ok(filesList.includes('design-specs/**'), ...);
```

**改后**（必需项齐全 + 排除项约束 + 违禁项 + 防夹带，与 `check-pack.js` §1/§5 同源口径）：

```js
const REQUIRED_FILES = [
  'main.js', 'main/**', 'preload.js', 'app.css', 'js/**',
  'runtimes/**', 'providers/**', 'platform/**', 'git/**',
  '原型+文档.html', 'toolPrompt.md', 'design-specs/**',
  'dist/renderer/**',
];
const BAK_EXCLUSIONS = [
  '!js/**/*.bak', '!runtimes/**/*.bak', '!providers/**/*.bak',
  '!platform/**/*.bak', '!git/**/*.bak', '!**/*.bak',
];

// 1. 必需项逐项存在（legacy 12 项 + dist/renderer/**）
// 2. 排除项恰为 6 条，且逐项存在、全部为 .bak
// 3. 正例只允许 REQUIRED_FILES：多出任何未登记条目即失败（防偷渡）
// 4. 不得有重复条目
// 5. 违禁项不得进包：tests/**、.devdata、*.log、桌面端/、桌面端
// 6. 保留 main/**、design-specs/**、dist/renderer/** 的显式命名断言
```

要点：

- **没有放宽为“只查包含”**：新增 `extras` 校验，除 13 条正例（legacy 12 + `dist/renderer/**`）与 6 条 bak 排除外，任何额外条目都会失败；总条数 19 成为“13 正例 + 6 排除”的派生结果，而非新的魔法数字。
- 失败信息按缺失/多余条目逐条报出，便于定位，不再只报“19 !== 18”。
- 同步更新 A10 顶部注释（旧注释“白名单17不变”已过期）。

### 未改动项（排查后确认无需改）

| 位置 | 断言内容 | 不改原因 |
| --- | --- | --- |
| `tests/check-pack.js:100` | `htmlScripts.length === 18` | HTML 脚本清单仍为 18，与 `build.files` 无关；该文件白名单断言已 mode-aware |
| `tests/verify-inline-edit.js:269` | `scripts.length === 18` | 同上，HTML script 数量未变化 |
| `tests/verify-spec-uilib.js:272` | 脚本清单 18 项 deepStrictEqual | 同上，HTML script 数量未变化 |

未修改任何业务源码、`package.json`、其他测试用例或断言。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `node tests/verify-inline-edit.js` | `SUMMARY passed=24 failed=0` / `INLINE_EDIT_PASS`（A10 `[PASS]`） |
| `PLAND_SUITE=core node tests/run-all.js` | `SUMMARY total=37 pass=37 fail=0` / `ALL_PASS` |

## 遗留

- 若后续再向 `build.files` 增加合法条目（如新的运行时目录），A10 会按“未登记条目”失败，需要同步更新 `REQUIRED_FILES`；这是有意的门禁行为，避免白名单被静默夹带。
- 打包覆盖完整性仍以 `tests/check-pack.js` 为准（真实展开白名单并核对 require 边）；A10 只负责白名单结构与必需项。
