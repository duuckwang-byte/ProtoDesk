/**
 * e2e/preview.spec.ts — W3-02 预览舞台回归（真实 iframe + 拾取 + 选择器）。
 *
 * 静态契约（无需 Electron）：
 * - Stage 从 sources-store 取 currentSource，渲染 PreviewFrame（activeContent || content）；
 * - 子页列表走 selectSubPage；移动端保留 375×780 自适应盒；
 * - PreviewFrame 走 secureSrcdoc + SANDBOX_ATTR（方案 B：allow-scripts allow-forms）；
 * - 拾取经帧内 Agent / postMessage，不读 contentDocument；selector 由 generateSelector 生成；
 * - PreviewOverlaysHost 装配 PickOverlay；
 * - __EXPORT_BOOT__ 下禁用拾取与注入。
 *
 * 动态契约（Chromium）：验证 allow-scripts allow-forms 沙箱帧
 * 能向父窗 postMessage、且父窗读不到其 document（方案 B 的安全前提）。
 *
 * 真机步骤（手动，不自动执行）：
 * 1. 启动后进入项目，点任一原型：舞台出现 iframe 且内容正常；
 * 2. 控制台 `document.querySelector('[data-testid=preview-frame]').contentDocument` 为 null
 *    （方案 B 的预期；拾取不依赖它）；
 * 3. 按住 Ctrl 悬停原型元素出现准星 + 悬停框，点击出现选择角标；
 * 4. 子页按钮切换后 iframe 内容变化；点“主页”回到主 html。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip;

/** 去注释后断言：注释里的旧方案说明不算实现代码。 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

test.describe('preview 静态契约（W3-02 舞台）', () => {
  test('Stage 接真实源：currentSource / activeContent / 子页 / PreviewFrame / 浮层', () => {
    const src = read('src/renderer/components/shell/Stage.tsx');
    expect(src).toContain('data-testid="stage-frame"');
    expect(src).toContain('useSourcesStore');
    expect(src).toContain('currentSource');
    expect(src).toContain('activeContent || src.content');
    expect(src).toContain('selectSubPage');
    expect(src).toContain('data-testid="stage-subpages"');
    expect(src).toContain('<PreviewFrame');
    expect(src).toContain('PreviewOverlaysHost');
    expect(src).toContain('data-testid="stage-viewport"');
    expect(src).toContain('MOBILE_W');
    expect(src).toContain('MOBILE_H');
    expect(src).toContain('stage-empty');
    // M1 起移动端常量与缩放函数在 useMobileViewport；Stage 只消费/再导出。
    const viewport = read('src/renderer/features/preview/useMobileViewport.ts');
    expect(viewport).toContain('MOBILE_W = 375');
    expect(viewport).toContain('MOBILE_H = 780');
    expect(viewport).toContain('mobileScaleFor');
    expect(src).toContain('stageZoomLabel');
  });

  test('PreviewFrame：srcDoc + 方案 B sandbox + 帧内注入', () => {
    const src = read('src/renderer/features/preview/PreviewFrame.tsx');
    expect(src).toContain('data-testid="preview-frame"');
    expect(src).toContain('srcDoc={srcdoc}');
    expect(src).toContain('secureSrcdoc');
    expect(src).toContain('sandbox={SANDBOX_ATTR}');
    expect(codeOnly(src)).not.toContain('allow-same-origin');
  });

  test('secure-srcdoc：allow-scripts allow-forms + 脚本转义 + 帧桥', () => {
    const src = read('src/renderer/features/preview/lib/secure-srcdoc.ts');
    expect(src).toContain("SANDBOX_ATTR = 'allow-scripts allow-forms'");
    expect(codeOnly(src)).not.toContain('allow-same-origin');
    expect(src).toContain('sandboxSafeScript');
    expect(src).toContain('data-sandbox-bridge');
    expect(src).toContain('generateSelector');
    expect(src).toContain('postToFrame');
    expect(src).toContain('PICK_REQUEST');
    expect(src).toContain('STAMP_SET');
    expect(src).toContain('ANNO_RECTS');
  });

  test('不读 contentDocument / contentWindow.location（方案 B 拾取只走 postMessage）', () => {
    const src = codeOnly(read('src/renderer/features/preview/PreviewFrame.tsx'));
    expect(src).not.toContain('contentDocument');
    expect(src).not.toContain('contentWindow.location');
    expect(src).not.toContain('loadURL');
    expect(src).not.toContain('src="http');
  });

  test('__EXPORT_BOOT__ 下禁用拾取与注入', () => {
    const src = read('src/renderer/features/preview/PreviewFrame.tsx');
    expect(src).toContain('__EXPORT_BOOT__');
    expect(src).toContain('isExportBoot');
  });

  test('准星样式沿用旧 id 与正文', () => {
    const src = read('src/renderer/features/preview/lib/iframe-pick.ts');
    expect(src).toContain("CROSSHAIR_STYLE_ID = 'ctrlPickCrosshairStyle'");
    expect(src).toContain('*{cursor:crosshair!important}');
  });

  test('选择器：generateSelector 移植 data-pr-id/testid/id/路径/nth-of-type', () => {
    const src = read('src/renderer/features/preview/lib/iframe-pick.ts');
    expect(src).toContain('export function generateSelector');
    expect(src).toContain('data-pr-id');
    expect(src).toContain('data-testid');
    expect(src).toContain('nth-of-type');
    expect(src).toContain('querySelectorAll');
  });

  test('拾取 rect 经 scaleRectToPage 换算', () => {
    const src = read('src/renderer/features/preview/PreviewFrame.tsx');
    expect(src).toContain('scaleRectToPage');
    expect(src).toContain('frameScaleFromWidths');
  });

  test('PreviewOverlaysHost 只接 PickOverlay + W3-08 占位注释', () => {
    const src = read('src/renderer/features/preview/PreviewOverlaysHost.tsx');
    expect(src).toContain('PickOverlay');
    expect(src).toContain('preview-overlays');
    expect(src).toContain('TODO(W3-08)');
    expect(src).toContain('pointerEvents');
  });
});

test.describe('preview 沙箱行为（Chromium）', () => {
  test('allow-scripts allow-forms：帧内脚本可 postMessage，父窗不可读其 document', async ({ page }) => {
    const msg = await page.evaluate(
      () =>
        new Promise<{ type: string } | null>((resolve) => {
          const onMessage = (ev: MessageEvent) => {
            const data = ev.data as { type?: string } | null;
            if (!data || data.type !== 'HELLO') return;
            window.removeEventListener('message', onMessage);
            resolve({ type: data.type });
          };
          window.addEventListener('message', onMessage);
          const frame = document.createElement('iframe');
          frame.id = 'f';
          frame.setAttribute('sandbox', 'allow-scripts allow-forms');
          frame.srcdoc = '<script>parent.postMessage({type:"HELLO"},"*");<\/script>';
          document.body.appendChild(frame);
          window.setTimeout(() => resolve(null), 3000);
        }),
    );
    expect(msg).toEqual({ type: 'HELLO' });

    const readable = await page.evaluate(() => {
      const frame = document.getElementById('f') as HTMLIFrameElement | null;
      try {
        return !!frame?.contentDocument;
      } catch {
        return false;
      }
    });
    expect(readable).toBe(false);
  });
});

gui('preview 真机行为（需 PLAND_E2E_APP_URL）', () => {
  test('舞台 iframe 可见且为 srcdoc 沙箱（不可读 contentDocument）', async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string);
    const frame = page.getByTestId('preview-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    const readable = await frame.evaluate((el: HTMLIFrameElement) => {
      try {
        return !!el.contentDocument;
      } catch {
        return false;
      }
    });
    expect(readable).toBe(false);
  });
});
