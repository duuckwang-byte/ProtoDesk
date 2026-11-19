/**
 * src/renderer/features/preview/__tests__/pick-stage-wiring.test.tsx — Stage 拾取事件接线回归。
 *
 * 覆盖：
 * - Ctrl/Cmd 连续点击 2-3 个元素：期间不弹任何输入框，松开后出现一个底部需求条；
 * - 已打开的底部需求条在 Ctrl 继续多选时保持挂载，已输入草稿不被清空；松开仍只有一条；
 * - 提交 / 取消 / 清空选择 / 切源后草稿清空；
 * - 多选只输入一条统一需求，提交后待提交队列只有 1 条批量；
 * - 单元素需求条露出「标注 / 交互」入口；
 * - Ctrl/Cmd+Shift 连点：只保留最后 1 个，松开后只出现一个修改弹窗；
 * - 普通点击只选中，不弹窗；
 * - 首次 Ctrl 点击即生效（不依赖父窗 modifierDown 预热）。
 *
 * PreviewFrame 用轻量替身直接回传 ctrlKey/metaKey/shiftKey，避免 jsdom 跑 srcdoc 帧内 Agent；
 * 浮层宿主用真实实现，保证「PICK_RESULT → 松开修饰键 → 底部条/修改弹窗」整条接线被覆盖。
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '@/components/shell/Stage';
import type { PickModifierState } from '@/features/preview/PreviewFrame';
import { EDIT_QUEUE_KEY } from '@/lib/storage-keys';
import { useAppStore, createMobileViewportPositions } from '@/stores/app-store';
import { useUiStore } from '@/stores/ui-store';
import { useSourcesStore, type SourceRef } from '@/stores/sources-store';

const SELECTOR_A = '[data-pr-id="pr-1"]';
const SELECTOR_B = '[data-pr-id="pr-2"]';
const SELECTOR_C = '[data-pr-id="pr-3"]';

interface MockPicked {
  selector: string;
  tagName: string;
  text: string;
  rect: { left: number; top: number; width: number; height: number };
}

interface MockPickProps {
  onPickElement?: (el: MockPicked, ev: PickModifierState) => void;
}

const A: MockPicked = {
  selector: SELECTOR_A,
  tagName: 'button',
  text: '提交',
  rect: { left: 20, top: 30, width: 120, height: 32 },
};
const B: MockPicked = {
  selector: SELECTOR_B,
  tagName: 'a',
  text: '了解更多',
  rect: { left: 20, top: 80, width: 90, height: 20 },
};
const C: MockPicked = {
  selector: SELECTOR_C,
  tagName: 'h2',
  text: '产品标题',
  rect: { left: 20, top: 120, width: 200, height: 28 },
};

const CTRL: PickModifierState = { ctrlKey: true, metaKey: false, shiftKey: false };
const CTRL_SHIFT: PickModifierState = { ctrlKey: true, metaKey: false, shiftKey: true };
const PLAIN: PickModifierState = { ctrlKey: false, metaKey: false, shiftKey: false };

vi.mock('@/features/preview/PreviewFrame', () => {
  function trigger(props: MockPickProps, name: string, el: MockPicked, ev: PickModifierState) {
    return (
      <button type="button" data-testid={name} onClick={() => props.onPickElement?.(el, ev)}>
        {name}
      </button>
    );
  }
  return {
    default: (props: MockPickProps) => (
      <div data-testid="preview-frame-mock">
        {trigger(props, 'pick-a', A, CTRL)}
        {trigger(props, 'pick-b', B, CTRL)}
        {trigger(props, 'pick-c', C, CTRL)}
        {trigger(props, 'pick-modify-a', A, CTRL_SHIFT)}
        {trigger(props, 'pick-modify-b', B, CTRL_SHIFT)}
        {trigger(props, 'pick-normal-a', A, PLAIN)}
      </div>
    ),
  };
});

class ResizeObserverMock {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const SOURCE: SourceRef = {
  name: '首页.html',
  displayName: '首页',
  kind: 'pc',
  sandboxDir: 'D:/sandbox/测试1/首页',
  mainHtmlFile: '首页.html',
  mdFile: '首页.md',
  subPages: [],
  htmlFiles: ['首页.html'],
  content: '<html><body>首页</body></html>',
  md: '',
  pages: ['首页'],
  __ver: 1,
  activeSubFile: '首页.html',
};

/** 切源用例的第二个原型（不同 sandboxDir / 主页文件名）。 */
const SOURCE_2: SourceRef = {
  ...SOURCE,
  name: '我的.html',
  displayName: '我的',
  sandboxDir: 'D:/sandbox/测试1/我的',
  mainHtmlFile: '我的.html',
  mdFile: '我的.md',
  htmlFiles: ['我的.html'],
  content: '<html><body>我的</body></html>',
  pages: ['我的'],
  activeSubFile: '我的.html',
};

/** Ctrl+Shift 修改文字写盘用源 HTML（含 3 个拾取元素对应的 data-pr-id）。 */
const MODIFY_PAGE_HTML = [
  '<!DOCTYPE html>',
  '<html><head><title>测试页</title></head><body>',
  '<button data-pr-id="pr-1">提交</button>',
  '<a data-pr-id="pr-2">了解更多</a>',
  '<h2 data-pr-id="pr-3">产品标题</h2>',
  '</body></html>',
].join('\n');

const sandboxWrite = vi.fn(async (_payload?: unknown) => ({ ok: true }));
const refreshSpy = vi.fn(async () => {});

function installProtoApi(): void {
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
    annotations: { read: async () => ({ ok: true, data: [] }) },
    links: { read: async () => ({ ok: true, data: { links: [] } }) },
    sandbox: {
      readFile: async () => ({ ok: true, content: MODIFY_PAGE_HTML }),
      write: sandboxWrite,
    },
  };
}

function removeProtoApi(): void {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
}

function readQueue(): Array<Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(EDIT_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function releaseCtrl(): void {
  fireEvent.keyUp(window, { key: 'Control', ctrlKey: false, metaKey: false, shiftKey: false });
}

/** 模拟按住 Ctrl（Stage 的窗口 keydown 同步修饰键状态）。 */
function holdCtrl(): void {
  fireEvent.keyDown(window, { key: 'Control', ctrlKey: true, metaKey: false, shiftKey: false });
}

beforeEach(() => {
  localStorage.clear();
  installProtoApi();
  sandboxWrite.mockClear();
  refreshSpy.mockClear();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock;
  useAppStore.setState({
    page: '首页',
    kind: 'pc',
    zoom: 1,
    fitMode: false,
    mobileViewMode: 'fit-width',
    mobileScrollPositions: createMobileViewportPositions(),
    sidebarOpen: false,
  });
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
    loading: false,
    error: '',
    refresh: refreshSpy,
  });
});

afterEach(() => {
  cleanup();
  removeProtoApi();
  document.body.innerHTML = '';
  localStorage.clear();
  useUiStore.setState({ aiOpen: false, settingsTab: null, gitOpen: false, toasts: [] });
  useSourcesStore.setState({
    project: '',
    sources: [],
    currentSource: null,
    activeSubFile: '',
    activeContent: '',
  });
});

describe('Stage 拾取事件接线', () => {
  it('首次 Ctrl 点击即选中；连续点 3 个期间不弹窗，松开后出现底部条', async () => {
    render(<Stage />);

    // 不先按 Ctrl：点击自带 ctrlKey 就必须生效（修复首次点击不弹/第二次才弹）。
    fireEvent.click(screen.getByTestId('pick-a'));
    await waitFor(() => expect(screen.getByTestId('overlays-selection-count').textContent).toBe('1'));
    expect(screen.queryByTestId('pick-composer')).toBeNull();

    fireEvent.click(screen.getByTestId('pick-b'));
    fireEvent.click(screen.getByTestId('pick-c'));
    await waitFor(() => expect(screen.getByTestId('overlays-selection-count').textContent).toBe('3'));
    expect(screen.queryByTestId('pick-composer')).toBeNull();
    expect(screen.queryByTestId('pick-modify-dialog')).toBeNull();

    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());
    expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(3);
    // 多选时不露出标注/交互入口。
    expect(screen.queryByTestId('pick-composer-annotation')).toBeNull();
    expect(screen.queryByTestId('pick-composer-link')).toBeNull();
  });

  it('Ctrl 再次点已选元素取消选择；全取消后松开不出现输入条', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    await waitFor(() => expect(screen.getByTestId('overlays-selection-count').textContent).toBe('1'));
    fireEvent.click(screen.getByTestId('pick-a'));
    await waitFor(() => expect(screen.queryByTestId('overlays-selection-count')).toBeNull());
    releaseCtrl();
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(screen.queryByTestId('pick-composer')).toBeNull();
  });

  it('多选只输入一条统一需求，提交后队列只有 1 条批量', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    fireEvent.click(screen.getByTestId('pick-b'));
    fireEvent.click(screen.getByTestId('pick-c'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    fireEvent.change(screen.getByTestId('pick-composer-input'), {
      target: { value: '三个元素统一改成蓝色' },
    });
    fireEvent.click(screen.getByTestId('pick-composer-submit'));

    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      text: '三个元素统一改成蓝色',
      tagName: '批量修改（3 个元素）',
      selected: true,
    });
    expect(String(queue[0].selector)).toMatch(/^batch:/);
    expect(Array.isArray(queue[0].batchParts)).toBe(true);
    expect((queue[0].batchParts as unknown[]).length).toBe(3);
  });

  it('单元素需求条：露出标注/交互入口，提交入 1 条普通队列', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(1);
    expect(screen.getByTestId('pick-composer-annotation')).toBeTruthy();
    expect(screen.getByTestId('pick-composer-link')).toBeTruthy();

    fireEvent.change(screen.getByTestId('pick-composer-input'), {
      target: { value: '按钮改成蓝色' },
    });
    fireEvent.click(screen.getByTestId('pick-composer-submit'));

    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      selector: SELECTOR_A,
      page: '首页',
      htmlFile: '首页.html',
      text: '按钮改成蓝色',
    });
  });

  it('chips 可点击删除，也可键盘 Backspace 删除', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    fireEvent.click(screen.getByTestId('pick-b'));
    releaseCtrl();
    await waitFor(() => expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(2));

    const firstChip = screen.getAllByTestId('pick-composer-chip')[0];
    fireEvent.keyDown(firstChip, { key: 'Backspace' });
    await waitFor(() => expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(1));

    fireEvent.click(screen.getByTestId('pick-composer-chip-remove'));
    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());
  });

  it('Ctrl/Cmd+Shift 连点两个元素只保留最后 1 个，保存直接写盘且不入待提交', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-modify-a'));
    await waitFor(() => expect(screen.getByTestId('overlays-selection-count').textContent).toBe('1'));
    expect(screen.queryByTestId('pick-modify-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('pick-modify-b'));
    await waitFor(() => expect(screen.getByTestId('overlays-selection-count').textContent).toBe('1'));
    expect(screen.queryByTestId('pick-modify-dialog')).toBeNull();

    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-modify-dialog')).toBeTruthy());
    expect(screen.getByTestId('pick-modify-selector').textContent).toBe(SELECTOR_B);
    expect((screen.getByTestId('pick-modify-input') as HTMLTextAreaElement).value).toBe('了解更多');
    expect(screen.queryByTestId('pick-composer')).toBeNull();

    fireEvent.change(screen.getByTestId('pick-modify-input'), { target: { value: '立即了解' } });
    fireEvent.click(screen.getByTestId('pick-modify-save'));
    await waitFor(() => expect(screen.queryByTestId('pick-modify-dialog')).toBeNull());

    // 直接写盘：源 HTML 中 pr-2 文本变化，元素保留；绝不入待提交队列。
    expect(sandboxWrite).toHaveBeenCalledTimes(1);
    const written = sandboxWrite.mock.calls[0][0] as { dir: string; file: string; content: string };
    expect(written.dir).toBe(SOURCE.sandboxDir);
    expect(written.file).toBe('首页.html');
    expect(written.content).toContain('>立即了解<');
    expect(written.content).toContain('data-pr-id="pr-2"');
    expect(written.content).not.toContain('了解更多');
    expect(readQueue()).toEqual([]);
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('普通点击只选中/取消，不弹窗、不写队列', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-normal-a'));
    await waitFor(() => expect(screen.getByTestId('overlays-selection-count').textContent).toBe('1'));

    expect(screen.queryByTestId('pick-composer')).toBeNull();
    expect(screen.queryByTestId('pick-modify-dialog')).toBeNull();
    expect(screen.queryByTestId('pick-requirement-dialog')).toBeNull();

    fireEvent.click(screen.getByTestId('pick-normal-a'));
    await waitFor(() => expect(screen.queryByTestId('overlays-selection-count')).toBeNull());
    expect(readQueue()).toEqual([]);
  });

  it('需求条 Esc 只取消本次拾取，不冒泡到其它 Esc 层', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    const input = screen.getByTestId('pick-composer-input');
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());
    expect(screen.queryByTestId('overlays-selection-count')).toBeNull();
    expect(readQueue()).toEqual([]);
  });

  it('Ctrl 继续多选：输入条不消失，草稿与 chips 同时保留，松开后仍是同一条', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '保留我' } });

    // 按住 Ctrl 再点第二个元素：输入条保持挂载，仅更新 chips 与选择数。
    holdCtrl();
    fireEvent.click(screen.getByTestId('pick-b'));
    expect(screen.getByTestId('pick-composer')).toBeTruthy();
    expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(2);
    expect(screen.getByTestId('overlays-selection-count').textContent).toBe('2');
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('保留我');

    // 松开 Ctrl：仍复用同一条输入条，不重建、不清空草稿。
    releaseCtrl();
    await waitFor(() => expect(screen.getAllByTestId('pick-composer-chip')).toHaveLength(2));
    expect(screen.getByTestId('pick-composer')).toBeTruthy();
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('保留我');
  });

  it('取消后清空草稿：再次拾取时输入条为空', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '取消我' } });
    fireEvent.click(screen.getByTestId('pick-composer-cancel'));
    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());

    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('提交后清空草稿：再次拾取时输入条为空', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '提交我' } });
    fireEvent.click(screen.getByTestId('pick-composer-submit'));
    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());
    expect(readQueue()).toHaveLength(1);

    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('工具栏清空选择后草稿清空', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '清空我' } });
    fireEvent.click(screen.getByTestId('overlays-clear-selection'));
    await waitFor(() => expect(screen.queryByTestId('pick-composer')).toBeNull());

    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('切源清空草稿：切回原源后输入条为空', async () => {
    render(<Stage />);
    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());

    fireEvent.change(screen.getByTestId('pick-composer-input'), { target: { value: '切源前草稿' } });

    await act(async () => {
      useSourcesStore.setState({
        sources: [SOURCE, SOURCE_2],
        currentSource: SOURCE_2,
        activeSubFile: SOURCE_2.mainHtmlFile,
      });
    });
    expect(screen.queryByTestId('pick-composer')).toBeNull();

    await act(async () => {
      useSourcesStore.setState({
        sources: [SOURCE, SOURCE_2],
        currentSource: SOURCE,
        activeSubFile: SOURCE.mainHtmlFile,
      });
    });

    fireEvent.click(screen.getByTestId('pick-a'));
    releaseCtrl();
    await waitFor(() => expect(screen.getByTestId('pick-composer')).toBeTruthy());
    expect((screen.getByTestId('pick-composer-input') as HTMLTextAreaElement).value).toBe('');
  });
});
