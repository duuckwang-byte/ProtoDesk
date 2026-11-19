/**
 * 选中框 rect 实时同步回归（b-pick P2-1）。
 *
 * 覆盖：
 * - iframe 内滚动（SCROLL）后立即按 selector 重取 rect；
 * - 舞台缩放 / 窗口 resize 后按当前 frame 几何重新换算页面坐标；
 * - 回包与拾取快照不同时，用实测 rect 覆盖选中框，而不是清空选中。
 */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PreviewOverlaysHost from '../PreviewOverlaysHost';
import { useSourcesStore, type SourceRef } from '@/stores/sources-store';
import { useUiStore } from '@/stores/ui-store';

const SELECTOR = '[data-pr-id="pr-1"]';

const SOURCE: SourceRef = {
  name: '首页.html',
  displayName: '首页',
  kind: 'pc',
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

interface FakeFrame {
  frame: HTMLIFrameElement;
  setBox: (next: Partial<{ left: number; top: number; width: number; height: number }>) => void;
}

function installFakeFrame(): FakeFrame {
  const frame = document.createElement('iframe');
  frame.setAttribute('data-testid', 'preview-frame');
  document.body.appendChild(frame);
  let box = { left: 10, top: 20, width: 500, height: 400 };
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 1000 });
  frame.getBoundingClientRect = () => ({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  }) as DOMRect;
  return {
    frame,
    setBox: (next) => {
      box = { ...box, ...next };
    },
  };
}

function installProtoApi(): void {
  (window as unknown as { protoAPI?: unknown }).protoAPI = {
    annotations: { read: async () => ({ ok: true, data: [] }) },
    links: { read: async () => ({ ok: true, data: { links: [] } }) },
  };
}

function selectedItem() {
  return {
    selector: SELECTOR,
    tagName: 'div',
    text: '商品',
    rect: { left: 0, top: 0, width: 1, height: 1 },
  };
}

function dispatchFromFrame(frame: HTMLIFrameElement, data: Record<string, unknown>, origin = 'null'): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      source: frame.contentWindow,
      origin,
    }),
  );
}

function rectResult(rect: { left: number; top: number; width: number; height: number }) {
  return {
    type: 'ANNO_RECTS_RESULT',
    nonce: 'test_nonce',
    source: 'frame',
    payload: { items: [{ key: SELECTOR, selector: SELECTOR, rect }] },
  };
}

async function flush(): Promise<void> {
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
  delete (window as unknown as { protoAPI?: unknown }).protoAPI;
  document.body.innerHTML = '';
  useUiStore.setState({ aiOpen: false, settingsTab: null, gitOpen: false, toasts: [] });
  useSourcesStore.setState({
    project: '',
    sources: [],
    currentSource: null,
    activeSubFile: '',
    activeContent: '',
  });
  vi.restoreAllMocks();
});

describe('选中框 rect 实时同步（P2-1）', () => {
  it('拾取后按 selector 实测 rect 绘制，不再使用一次性快照', async () => {
    const { frame } = installFakeFrame();
    const slot = document.createElement('div');
    document.body.appendChild(slot);

    await act(async () => {
      render(
        React.createElement(PreviewOverlaysHost, {
          hover: null,
          selected: [selectedItem()],
          toolbarSlot: slot,
        }),
      );
    });
    await flush();

    // 帧视口 rect (100,50,200,40) × 外层 scale 0.5 + frame 原点 (10,20)。
    await act(async () => {
      dispatchFromFrame(frame, rectResult({ left: 100, top: 50, width: 200, height: 40 }));
    });

    const box = document.querySelector<HTMLElement>('.selection-box-overlay');
    expect(box).toBeTruthy();
    expect(box!.style.left).toBe('60px');
    expect(box!.style.top).toBe('45px');
    expect(box!.style.width).toBe('100px');
    expect(box!.style.height).toBe('20px');
  });

  it('SCROLL 消息触发 ANNO_RECTS 重取，resize 同路径', async () => {
    const { frame } = installFakeFrame();
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    const slot = document.createElement('div');
    document.body.appendChild(slot);

    await act(async () => {
      render(
        React.createElement(PreviewOverlaysHost, {
          hover: null,
          selected: [selectedItem()],
          toolbarSlot: slot,
        }),
      );
    });
    await flush();
    const before = post.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    await act(async () => {
      dispatchFromFrame(frame, { type: 'SCROLL', nonce: 'scroll_nonce', source: 'frame', payload: {} });
    });
    expect(post.mock.calls.length).toBeGreaterThan(before);
    const scrollMessage = post.mock.calls[post.mock.calls.length - 1][0] as {
      type: string;
      payload: { items: Array<{ key: string; selector: string }> };
    };
    expect(scrollMessage.type).toBe('ANNO_RECTS');
    expect(scrollMessage.payload.items).toEqual([{ key: SELECTOR, selector: SELECTOR }]);

    const afterScroll = post.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(post.mock.calls.length).toBeGreaterThan(afterScroll);
  });

  it('舞台缩放到 75% 后回包按新 frame 几何换算，误差 <2px', async () => {
    const { frame, setBox } = installFakeFrame();
    const slot = document.createElement('div');
    document.body.appendChild(slot);

    await act(async () => {
      render(
        React.createElement(PreviewOverlaysHost, {
          hover: null,
          selected: [selectedItem()],
          toolbarSlot: slot,
        }),
      );
    });
    await flush();

    // 100%：frame 宽 500 / clientWidth 1000 → 0.5。
    await act(async () => {
      dispatchFromFrame(frame, rectResult({ left: 100, top: 50, width: 200, height: 40 }));
    });
    expect(document.querySelector<HTMLElement>('.selection-box-overlay')!.style.left).toBe('60px');

    // 75%：frame bbox 宽 375 / clientWidth 1000 → 0.375（与 hover 同一换算口径）。
    setBox({ width: 375, height: 300 });
    const expected = { left: 10 + 100 * 0.375, top: 20 + 50 * 0.375, width: 200 * 0.375, height: 40 * 0.375 };
    await act(async () => {
      dispatchFromFrame(frame, rectResult({ left: 100, top: 50, width: 200, height: 40 }));
    });
    const box = document.querySelector<HTMLElement>('.selection-box-overlay')!;
    const actual = {
      left: parseFloat(box.style.left),
      top: parseFloat(box.style.top),
      width: parseFloat(box.style.width),
      height: parseFloat(box.style.height),
    };
    expect(Math.abs(actual.left - expected.left)).toBeLessThan(2);
    expect(Math.abs(actual.top - expected.top)).toBeLessThan(2);
    expect(Math.abs(actual.width - expected.width)).toBeLessThan(2);
    expect(Math.abs(actual.height - expected.height)).toBeLessThan(2);
  });
});
