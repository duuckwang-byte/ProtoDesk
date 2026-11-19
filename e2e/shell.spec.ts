/**
 * e2e/shell.spec.ts — Wave2-M 主壳回归（G 波：顶栏/侧栏/舞台/mini-dock）。
 *
 * testid 锚点（G/H/I/J/K/L 约定）：topbar / loc-pill / sidebar /
 * stage-frame / stage-viewport / mini-dock / main-window。
 *
 * 本文件只做静态契约断言（读 src，不启动浏览器），`npx playwright test`
 * 无需浏览器即可全绿。Electron 真机行为见下方 gui 块（默认 skip，
 * 置 PLAND_E2E_APP_URL 后才执行，不强行拉起）。
 *
 * 真机步骤（手动，不自动执行）：
 * 1. `npm run dev:renderer` + `npx electron .` 启动；
 * 2. 顶栏 loc-pill 显示「项目 / 原型 / 页面」三段，切换原型后实时更新；
 * 3. 侧栏三层（文件夹/一级/二级）悬停出现 6 点手柄，可上下拖拽改序，
 *    无数字计数、无蓝色选中；
 * 4. 收起侧栏 → 左下角 mini-dock 出现，点击恢复侧栏；
 * 5. 端别切「移动」→ 舞台出现 375×780 逻辑框 + 自适应百分比，随窗口缩放，
 *    外层无纵向滚轮。
 * 预期：以上全部符合方案 §2.2 / §8.1。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const count = (src: string, sub: string): number => src.split(sub).length - 1;

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip;

test.describe('shell 静态契约（G 波主壳）', () => {
  test('顶栏含 loc-pill 三段面包屑', () => {
    const src = read('src/renderer/components/shell/Topbar.tsx');
    expect(src).toContain('data-testid="topbar"');
    expect(src).toContain('data-testid="loc-pill"');
    expect(src).toContain('project');
    expect(src).toContain('proto');
    expect(src).toContain('page');
  });

  test('侧栏三层真实树：三处拖拽手柄 + 三层 data-level + 无示例数据', () => {
    const src = read('src/renderer/components/shell/Sidebar.tsx');
    expect(src).toContain('data-testid="sidebar"');
    expect(count(src, '<DragGrip')).toBeGreaterThanOrEqual(3);
    expect(src).toContain('GripVertical');
    // W3-01：侧栏改接真实数据（sources-store + app-store 分组/折叠）
    expect(src).toContain('useSourcesStore');
    expect(src).toContain('readGroups');
    expect(src).toContain('readFold');
    expect(src).toContain('data-level="group"');
    expect(src).toContain('data-level="proto"');
    expect(src).toContain('data-level="subpage"');
    expect(src).not.toContain('示例分组');
    expect(src).not.toContain('子页面一');
  });

  test('MiniDock 已停用：入口收敛后不再渲染', () => {
    const src = read('src/renderer/components/shell/MiniDock.tsx');
    expect(src).toContain('已停用');
    expect(src).toContain('return null');
    // 旧左下角浮层不再存在；侧栏收起后走顶栏左侧开关。
    expect(src).not.toContain('data-testid="mini-dock"');
    expect(src).not.toContain('sidebarOpen');
  });

  test('移动端 375×780 自适应盒：常量 + ResizeObserver + 缩放', () => {
    const stage = read('src/renderer/components/shell/Stage.tsx');
    const viewport = read('src/renderer/features/preview/useMobileViewport.ts');
    expect(stage).toContain('data-testid="stage-frame"');
    expect(stage).toContain('data-testid="stage-viewport"');
    expect(stage).toContain('MOBILE_W');
    expect(stage).toContain('MOBILE_H');
    expect(viewport).toContain('MOBILE_W = 375');
    expect(viewport).toContain('MOBILE_H = 780');
    expect(viewport).toContain('ResizeObserver');
    expect(stage).toContain('自适应');
  });

  test('拾取坐标口径与视窗常量一致（iframe-pick）', () => {
    const src = read('src/renderer/features/preview/lib/iframe-pick.ts');
    expect(src).toContain('MOBILE_VIEWPORT_W = 375');
    expect(src).toContain('MOBILE_VIEWPORT_H = 780');
  });

  test('视觉基线保留 loc-pill / mini-dock / 375×780 盒', () => {
    const html = read('docs/shadcn-redesign-preview.html');
    expect(html).toContain('.loc-pill');
    expect(html).toContain('.mini-dock.show');
    expect(html).toContain('width: 375px; height: 780px');
  });

  test('MainWindow 组装壳 + Esc 统一栈', () => {
    const src = read('src/renderer/app/modes/MainWindow.tsx');
    expect(src).toContain('data-testid="main-window"');
    expect(src).toContain('Topbar');
    expect(src).toContain('Sidebar');
    expect(src).toContain('Stage');
    expect(src).toContain('DocsPanelHost');
    expect(src).toContain('MiniDock');
    expect(src).toContain('closeTopmost');
  });

  test('操作入口：顶栏 AI/Git/导出 + 侧栏唯一设置入口', () => {
    const topbar = read('src/renderer/components/shell/Topbar.tsx');
    expect(topbar).toContain('openAi');
    expect(topbar).toContain('openGit');
    expect(topbar).toContain('<ExportMenu');
    expect(topbar).toContain('AI 对话');
    expect(topbar).toContain('Git 管理');
    // 设置入口已收敛到侧栏底部，顶栏不再有设置按钮。
    expect(topbar).not.toContain('openSettings');
    expect(topbar).not.toContain('aria-label="设置"');

    const sidebar = read('src/renderer/components/shell/Sidebar.tsx');
    expect(sidebar).toContain('aria-label="打开设置"');
    expect(sidebar).toContain('openSettings');
  });
});

gui('shell 真机行为（需 PLAND_E2E_APP_URL）', () => {
  test('loc-pill 随原型切换更新', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    const pill = page.getByTestId('loc-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('项目');
  });

  test('收起侧栏出现 mini-dock', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    await page.getByRole('button', { name: '收起侧栏' }).click();
    await expect(page.getByTestId('mini-dock')).toBeVisible();
  });

  test('移动端出现 375×780 自适应盒', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    await page.getByTitle('移动端舞台（375 逻辑宽）').click();
    const vp = page.getByTestId('stage-viewport');
    await expect(vp).toBeVisible();
    const box = await vp.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round((box as { width: number }).width)).toBe(375);
  });
});
