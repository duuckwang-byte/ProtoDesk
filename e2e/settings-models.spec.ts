/**
 * e2e/settings-models.spec.ts — Wave2-M 设置/模型回归（K 波）。
 *
 * testid 锚点：settings-dialog / model-manager / model-manager-count。
 * 方案 §8.3 / §2.2：设置 6 Tab（Agent/模型/设计规范/沙箱/快捷键/关于）；
 * 模型管理富信息清单卡片：菜单仅已选、弹窗全量 + 勾选、搜索不改勾选、
 * 自定义输入 32px 等高按钮。
 *
 * 静态契约（无浏览器可跑）。真机步骤见下方 gui 块。
 *
 * 真机步骤（手动，不自动执行）：
 * 1. 打开设置：6 Tab 齐全，默认落 Agent；
 * 2. 「模型」Tab 为富信息卡片清单（非 Table），含描述/标签/计数；
 * 3. 搜索框输入关键字：列表过滤但已勾选数不变；
 * 4. 手输模型 id + 添加：清单新增一行并计入勾选。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip;

test.describe('settings-models 静态契约（K 波设置/模型）', () => {
  test('settings-dialog 含 6 Tab', () => {
    const src = read('src/renderer/features/settings/SettingsDialog.tsx');
    expect(src).toContain('data-testid="settings-dialog"');
    for (const v of ['agent', 'models', 'design', 'sandbox', 'shortcuts', 'about']) {
      expect(src).toContain(`value="${v}"`);
    }
  });

  test('模型管理富信息清单：勾选 + 分组 + 标签 + 计数（非 Table）', () => {
    const src = read('src/renderer/features/models/ModelManager.tsx');
    expect(src).toContain('data-testid="model-manager"');
    expect(src).toContain('data-testid="model-manager-count"');
    expect(src).toContain('可用模型清单');
    expect(src).toContain('data-model-id=');
    expect(src).toContain('Checkbox');
    expect(src).toContain('Badge');
    expect(src).not.toContain('<Table');
  });

  test('搜索只过滤显示、不改勾选', () => {
    const src = read('src/renderer/features/models/ModelManager.tsx');
    expect(src).toContain('matchesQuery');
    expect(src).toContain('shown');
    expect(src).toContain('搜索模型');
  });

  test('自定义输入 32px 等高（h-8 输入 + 按钮）', () => {
    const src = read('src/renderer/features/models/ModelManager.tsx');
    // 搜索框 / 自定义输入框 / 添加按钮等至少 4 处 h-8（32px）
    expect(src.match(/className="h-8[^"]*"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('输入自定义模型 ID');
    expect(src).toContain('添加模型');
  });

  test('空态与搜索无命中态文案就绪', () => {
    const src = read('src/renderer/features/models/ModelManager.tsx');
    expect(src).toContain('模型目录为空');
    expect(src).toContain('无匹配模型');
    expect(src).toContain('搜索仅过滤显示');
  });
});

gui('settings-models 真机行为（需 PLAND_E2E_APP_URL）', () => {
  test('6 Tab 可切换，搜索不改勾选数', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    const dlg = page.getByTestId('settings-dialog');
    await expect(dlg).toBeVisible();
    await page.getByRole('tab', { name: '模型' }).click();
    const count = page.getByTestId('model-manager-count');
    const before = await count.textContent();
    await page.getByLabel('搜索模型').fill('deepseek');
    expect(await count.textContent()).toBe(before);
  });
});
