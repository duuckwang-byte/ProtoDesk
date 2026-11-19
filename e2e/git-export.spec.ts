/**
 * e2e/git-export.spec.ts — Wave2-M Git/导出回归（L 波）+ 检查器浮层。
 *
 * testid 锚点：git-panel / git-project-card / git-proto-group / git-file-row /
 * git-filterbar / git-branch-select / git-mode-diff / git-cancel /
 * git-config-dialog / inspector。
 * 方案 §8.1 / §2.2：Git 为可折叠项目卡片 + 树形文件复选框行，
 * 行级增删统计，不用二维 Table；W3-05 补齐配置 / 分支 / 差异 / 取消；
 * 导出 `export-assets/` 三文件 + `__EXPORT_BOOT__` / `__EXPORT_SOURCES__` 契约不变。
 *
 * 静态契约（无浏览器可跑）。真机步骤见下方 gui 块。
 *
 * 真机步骤（手动，不自动执行）：
 * 1. 打开 Git 面板：项目卡片可折叠，文件行三态勾选，顶部等高筛选栏，
 *    行级显示增删行数；
 * 2. 上传发布/拉取同步走确认后刷新列表；
 * 3. 导出单文件离线打开：样式正常，`window.__EXPORT_BOOT__ === true`，
 *    图片走 proto-asset；
 * 4. 检查器三板块（修改需求/跳转交互/需求标注），删除类操作经确认框。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip;

test.describe('git-export 静态契约（L 波 Git/导出）', () => {
  test('git-panel 卡片树：项目卡片 + 原型分组 + 文件行', () => {
    const src = readFile('src/renderer/features/git/GitPanel.tsx');
    expect(src).toContain('data-testid="git-panel"');
    expect(src).toContain('data-testid="git-project-card"');
    expect(src).toContain('data-testid="git-proto-group"');
    expect(src).toContain('data-testid="git-file-row"');
    expect(src).toContain('Collapsible');
    expect(src).toContain('Checkbox');
  });

  test('Git 不用二维 Table', () => {
    const src = readFile('src/renderer/features/git/GitPanel.tsx');
    expect(src).not.toMatch(/from ['"]@\/components\/ui\/table['"]/);
    expect(src).not.toContain('<Table');
    const pkg = readFile('package.json');
    expect(pkg).not.toContain('tanstack');
  });

  test('git-api 薄封装 11 条冻结通道，不新增通道', () => {
    const src = readFile('src/renderer/features/git/git-api.ts');
    for (const name of [
      'GIT_API_METHODS',
      'configGet',
      'saveConfig',
      'testConnection',
      'listBranches',
      '"getStatus"',
      'fetchDiff',
      'push',
      'pull',
      'isBusy',
      'cancel',
      'healRepair',
    ]) {
      expect(src).toContain(name);
    }
    expect(src).not.toContain('ipcRenderer');
    expect(src).not.toMatch(/invoke\(\s*['"]git:/);

    const preload = readFile('preload.js');
    const gitChannels = [...preload.matchAll(/['"](git:[a-z-]+)['"]/g)].map((m) => m[1]);
    expect(new Set(gitChannels).size).toBe(11);

    const contract = readFile('main/ipc-contract.js');
    const block = contract.slice(
      contract.indexOf('const IPC_CHANNELS'),
      contract.indexOf('];', contract.indexOf('const IPC_CHANNELS')),
    );
    const frozen = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(frozen).size).toBe(70);
  });

  test('Git 配置弹窗字段对齐 config + 测试连接显示 latency', () => {
    const src = readFile('src/renderer/features/git/GitConfigDialog.tsx');
    for (const testid of [
      'git-config-dialog',
      'git-config-remote',
      'git-config-branch',
      'git-config-author-name',
      'git-config-author-email',
      'git-config-token',
      'git-config-token-state',
      'git-test-connection',
      'git-test-latency',
      'git-config-save',
    ]) {
      expect(src).toContain(testid);
    }
    expect(src).toContain('remoteUrl');
    expect(src).toContain('hasToken');
    expect(src).toContain('tokenMasked');
    expect(src).toContain('saveConfig({ project, config })');
    expect(src).toContain('latency');
    expect(src).toContain('请先填写远程仓库地址');
  });

  test('Git 面板：分支下拉 / 差异预览 / 操作取消 / 自愈保留', () => {
    const src = readFile('src/renderer/features/git/GitPanel.tsx');
    expect(src).toContain('data-testid="git-branch-select"');
    expect(src).toContain('data-testid="git-mode-diff"');
    expect(src).toContain('data-testid="git-cancel"');
    expect(src).toContain('data-testid="git-need-config"');
    expect(src).toContain('remoteConfigured');
    expect(src).toContain('git.listBranches');
    expect(src).toContain('git.fetchDiff');
    expect(src).toContain('git.isBusy');
    expect(src).toContain('git.cancel');
    expect(src).toContain('git.healRepair');
    expect(src).toContain('GitConfigDialog');
    expect(src).toContain('Confirm');
    // project 只走现有 prop，不引 app-store（W3-01 独占）。
    expect(src).not.toContain('useAppStore');
    expect(src).not.toContain('@/stores/app-store');
  });

  test('export-assets 三文件存在（构建产物随包）', () => {
    for (const f of ['export-template.js', 'icons.js', 'export.css']) {
      expect(fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'export-assets', f))).toBe(
        true,
      );
    }
  });

  test('__EXPORT_BOOT__ / __EXPORT_SOURCES__ 契约保留', () => {
    const legacy = readFile('js/project-ai-export.js');
    expect(legacy).toContain('window.__EXPORT_BOOT__=true');
    expect(legacy).toContain('window.__EXPORT_SOURCES__');
    const menu = readFile('src/renderer/features/export/ExportMenu.tsx');
    expect(menu).toContain('__EXPORT_BOOT__');
    expect(menu).toContain('export-assets/');
  });

  test('检查器已删除（W6）：浮层不再装配 Inspector，仍禁原生弹窗', () => {
    const host = readFile('src/renderer/features/preview/PreviewOverlaysHost.tsx')
    expect(host).not.toContain('components/overlays/Inspector')
    expect(host).not.toContain("sheet === 'inspector'")
    expect(host).not.toContain('overlays-open-inspector')
    // 删除类操作仍统一走 Confirm。
    expect(host).toContain('<Confirm')
    expect(host).not.toMatch(/[^a-zA-Z]alert\(/)
    expect(host).not.toMatch(/[^a-zA-Z]confirm\(/);
  });
});

gui('git-export 真机行为（需 PLAND_E2E_APP_URL）', () => {
  test('Git 卡片树可折叠，文件行可勾选', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    const panel = page.getByTestId('git-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('git-file-row').first()).toBeVisible();
  });
});
