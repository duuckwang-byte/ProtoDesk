/**
 * src/renderer/features/preview/__tests__/overlays-host.test.ts — P0-1 回归。
 *
 * 覆盖：
 * - 浮层工具条 portal 到 Stage 提供的 slot，不再是 fixed right-3 top-14；
 * - 容器 pointer-events:none，只有工具条自身开放交互；
 * - settingsTab / aiOpen / gitOpen 为真时工具条整条隐藏，关闭后恢复；
 * - 主入口「交互 / 标注 / 待提交」存在，待提交入口可打开队列 Sheet；
 * - Stage 顶栏 -/+ 触发的 zoom 变化在移动端自适应开启时会自动退出自适应。
 */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PreviewOverlaysHost from '../PreviewOverlaysHost';
import { shouldExitFitOnZoomChange } from '@/components/shell/Stage';
import { EDIT_QUEUE_KEY } from '@/lib/storage-keys';
import { useSourcesStore, type SourceRef } from '@/stores/sources-store';
import { useUiStore } from '@/stores/ui-store';

const SOURCE: SourceRef = {
  name: '首页.html',
  displayName: '首页',
  kind: 'mobile',
  sandboxDir: 'D:/sandbox/测试1/首页',
  mainHtmlFile: '首页.html',
  mdFile: '首页.md',
  subPages: [{ file: '我的.html', name: '我的' }],
  htmlFiles: ['首页.html', '我的.html'],
  content: '<html><body>首页</body></html>',
  md: '',
  pages: ['首页'],
  __ver: 1,
  activeSubFile: '首页.html',
  activeContent: '',
};

function installProtoApi(): void {
  (window as unknown as { protoAPI?: unknown }).protoAPI = {
    annotations: { read: async () => ({ ok: true, data: [] }) },
    links: { read: async () => ({ ok: true, data: { links: [] } }) },
  };
}

function removeProtoApi(): void {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
}

function makeSlot(): HTMLDivElement {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  return slot;
}

function toolbarOf(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>('[data-testid="overlays-toolbar"]');
}

async function renderHost(slot: HTMLElement): Promise<void> {
  await act(async () => {
    render(
      React.createElement(PreviewOverlaysHost, {
        hover: null,
        selected: [],
        toolbarSlot: slot,
      }),
    );
  });
  // 等标注/链接读取 effect 落定，避免 act 警告。
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  installProtoApi();
  useUiStore.setState({
    docsOpen: false,
    aiOpen: false,
    settingsTab: null,
    gitOpen: false,
    exportOpen: false,
    toasts: [],
  });
  useSourcesStore.setState({
    project: '测试1',
    sources: [SOURCE],
    currentSource: SOURCE,
    activeSubFile: SOURCE.mainHtmlFile,
    activeContent: '',
  });
});

afterEach(() => {
  cleanup();
  removeProtoApi();
  document.body.innerHTML = '';
  useUiStore.setState({
    aiOpen: false,
    settingsTab: null,
    gitOpen: false,
    toasts: [],
  });
  useSourcesStore.setState({
    project: '',
    sources: [],
    currentSource: null,
    activeSubFile: '',
    activeContent: '',
  });
});

describe('PreviewOverlaysHost 工具条挂载与层级', () => {
  it('portal 到 Stage slot，且不再是 fixed / top-14 浮条', async () => {
    const slot = makeSlot();
    await renderHost(slot);

    const toolbar = toolbarOf(slot);
    expect(toolbar).toBeTruthy();
    expect(toolbar?.className).not.toContain('fixed');
    expect(toolbar?.className).not.toContain('top-14');
    expect(toolbar?.className).not.toContain('right-3');
    expect(toolbar?.getAttribute('role')).toBe('toolbar');
    // 工具条自身开放交互，但不使用高于弹层的 z-index。
    expect(toolbar?.style.pointerEvents).toBe('auto');
    expect(toolbar?.className).not.toContain('z-50');
  });

  it('拾取浮层容器 pointer-events:none，层级低于文档遮罩/弹层', async () => {
    const slot = makeSlot();
    await renderHost(slot);

    const host = document.querySelector<HTMLElement>('[data-testid="preview-overlays"]');
    expect(host).toBeTruthy();
    expect(host?.style.pointerEvents).toBe('none');
    expect(host?.style.zIndex).toBe('30');
  });

  it('提供「交互 / 标注 / 待提交」主入口，待提交可打开队列 Sheet', async () => {
    const slot = makeSlot();
    await renderHost(slot);

    expect(slot.querySelector('[data-testid="overlays-open-links"]')).toBeTruthy();
    expect(slot.querySelector('[data-testid="overlays-open-anno"]')).toBeTruthy();
    expect(slot.querySelector('[data-testid="overlays-open-queue"]')).toBeTruthy();
    expect(slot.querySelector('[data-testid="overlays-open-snapshot"]')).toBeTruthy();
    // W6：检查器入口已随功能删除，不得回流。
    expect(slot.querySelector('[data-testid="overlays-open-inspector"]')).toBeNull();
    // 多选 Drawer / 就地改入口已收敛：需求走底部输入条，修改走唯一 PickModifyDialog。
    expect(slot.querySelector('[data-testid="overlays-open-multi"]')).toBeNull();
    expect(slot.querySelector('[data-testid="overlays-open-inline"]')).toBeNull();

    const queueButton = slot.querySelector<HTMLButtonElement>('[data-testid="overlays-open-queue"]');
    await act(async () => {
      queueButton?.click();
    });
    expect(document.querySelector('[data-testid="overlays-sheet-queue"]')).toBeTruthy();
  });

  it('待提交不再常驻底部条：有队列时也只从工具栏入口打开', async () => {
    localStorage.setItem(
      EDIT_QUEUE_KEY,
      JSON.stringify([
        {
          id: 'q1',
          selector: '[data-pr-id="pr-p-39"]',
          page: '首页',
          htmlFile: '首页.html',
          text: '改成蓝色',
          selected: true,
        },
      ]),
    );
    const slot = makeSlot();
    await renderHost(slot);

    // 旧常驻条已移除，队列内容只能在 Sheet 内看到。
    expect(document.querySelector('[data-testid="multi-edit-bar"]')).toBeNull();
    await act(async () => {
      slot.querySelector<HTMLButtonElement>('[data-testid="overlays-open-queue"]')?.click();
    });
    expect(document.querySelector('[data-testid="overlays-sheet-queue"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="overlays-queue-text"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="overlays-queue-footer"]')).toBeTruthy();
  });
});

describe('应用级弹层打开时工具条不穿透', () => {
  it('settingsTab / aiOpen / gitOpen 任一为真即隐藏，全部关闭后恢复', async () => {
    const slot = makeSlot();
    await renderHost(slot);
    expect(toolbarOf(slot)).toBeTruthy();

    await act(async () => {
      useUiStore.setState({ settingsTab: 'agent' });
    });
    expect(toolbarOf(slot)).toBeNull();

    await act(async () => {
      useUiStore.setState({ settingsTab: null, aiOpen: true });
    });
    expect(toolbarOf(slot)).toBeNull();

    await act(async () => {
      useUiStore.setState({ aiOpen: false, gitOpen: true });
    });
    expect(toolbarOf(slot)).toBeNull();

    await act(async () => {
      useUiStore.setState({ gitOpen: false });
    });
    expect(toolbarOf(slot)).toBeTruthy();
  });
});

describe('Stage 顶栏 -/+ 与自适应联动', () => {
  it('移动端自适应开启时，zoom 变化退出自适应并按 zoom 生效', () => {
    expect(shouldExitFitOnZoomChange(1, 0.9, 'mobile', true)).toBe(true);
    expect(shouldExitFitOnZoomChange(1, 1.1, 'mobile', true)).toBe(true);
  });

  it('zoom 未变化 / 自适应已关 / PC 舞台不触发退出', () => {
    expect(shouldExitFitOnZoomChange(1, 1, 'mobile', true)).toBe(false);
    expect(shouldExitFitOnZoomChange(1, 0.9, 'mobile', false)).toBe(false);
    expect(shouldExitFitOnZoomChange(1, 0.9, 'pc', true)).toBe(false);
  });
});
