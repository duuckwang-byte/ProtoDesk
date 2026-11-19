/**
 * 选中框 rect 响应器注入回归（b-pick P2-1）。
 *
 * - 预览 srcdoc 追加 `data-pick-rect-responder`，用已冻结的 ANNO_RECTS 协议回包；
 * - 幂等注入，不重复追加；
 * - __EXPORT_BOOT__ 下保持原 HTML（导出态不注入任何东西）。
 */

import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PreviewFrame, { injectPickRectResponder, type PickModifierState } from '../PreviewFrame';

const HTML = '<html><head></head><body><div id="x">hi</div></body></html>';

afterEach(() => {
  cleanup();
  delete (window as unknown as { __EXPORT_BOOT__?: unknown }).__EXPORT_BOOT__;
});

describe('PreviewFrame 选中框 rect 响应器', () => {
  it('预览 srcdoc 注入响应器且幂等', () => {
    render(<PreviewFrame html={HTML} title="测试" />);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    const srcdoc = frame?.getAttribute('srcdoc') || '';
    expect(srcdoc).toContain('data-pick-rect-responder');
    expect(srcdoc).toContain('ANNO_RECTS_RESULT');
    expect(srcdoc).toContain('__protoPickRectResponder');
    expect(srcdoc).toContain('data-sandbox-bridge');

    const once = injectPickRectResponder(HTML);
    const twice = injectPickRectResponder(once);
    expect(twice).toBe(once);
    expect(twice.match(/data-pick-rect-responder/g)?.length).toBe(1);
  });

  it('__EXPORT_BOOT__ 下不注入响应器', () => {
    (window as unknown as { __EXPORT_BOOT__?: boolean }).__EXPORT_BOOT__ = true;
    render(<PreviewFrame html={HTML} title="测试" />);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    expect(frame?.getAttribute('srcdoc')).toBe(HTML);
  });
});

describe('PreviewFrame 修饰键帧桥', () => {
  function dispatchFromFrame(frame: HTMLIFrameElement, data: Record<string, unknown>): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: 'null',
          data,
        }),
      );
    });
  }

  it('PICK_RESULT 原样回传 ctrlKey/metaKey/shiftKey', async () => {
    const onPick = vi.fn();
    render(<PreviewFrame html={HTML} title="测试" onPickElement={onPick} />);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    expect(frame?.contentWindow).toBeTruthy();

    dispatchFromFrame(frame!, {
      type: 'PICK_RESULT',
      nonce: 'pick_nonce_1',
      source: 'frame',
      payload: {
        selector: '#x',
        tagName: 'div',
        text: 'hi',
        rect: { left: 1, top: 2, width: 10, height: 20 },
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      },
    });

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const modifiers = onPick.mock.calls[0][1] as PickModifierState;
    expect(modifiers).toEqual({ ctrlKey: true, metaKey: false, shiftKey: true });
  });

  it('CTRL_STATE 回传 shift，供 Stage 识别松开 Shift', async () => {
    const onModifiers = vi.fn();
    render(<PreviewFrame html={HTML} title="测试" onPickModifierChange={onModifiers} />);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');

    dispatchFromFrame(frame!, {
      type: 'CTRL_STATE',
      nonce: 'ctrl_nonce_1',
      source: 'frame',
      payload: { ctrlKey: true, metaKey: false, shiftKey: true },
    });

    await waitFor(() => expect(onModifiers).toHaveBeenCalledTimes(1));
    expect(onModifiers.mock.calls[0][0]).toEqual({ ctrlKey: true, metaKey: false, shiftKey: true });
  });

  it('PICK_RESULT / HOVER 透传 pickIndex', async () => {
    const onPick = vi.fn();
    const onHover = vi.fn();
    render(<PreviewFrame html={HTML} title="测试" onPickElement={onPick} onHoverElement={onHover} />);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    expect(frame?.contentWindow).toBeTruthy();

    dispatchFromFrame(frame!, {
      type: 'PICK_RESULT',
      nonce: 'pick_nonce_2',
      source: 'frame',
      payload: {
        selector: '.item',
        pickIndex: 2,
        tagName: 'div',
        text: '第二项',
        rect: { left: 1, top: 2, width: 10, height: 20 },
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      },
    });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][0]).toMatchObject({ selector: '.item', pickIndex: 2 });

    dispatchFromFrame(frame!, {
      type: 'HOVER',
      nonce: 'hover_nonce_1',
      source: 'frame',
      payload: {
        selector: '.item',
        pickIndex: 0,
        tagName: 'div',
        text: '第一项',
        rect: { left: 3, top: 4, width: 11, height: 21 },
      },
    });
    await waitFor(() =>
      expect(onHover.mock.calls.some((call) => (call[0] as { pickIndex?: number })?.pickIndex === 0)).toBe(true),
    );
  });

  it('pickIndex 非法（负数/非数字）归一为 undefined', async () => {
    const onPick = vi.fn();
    render(<PreviewFrame html={HTML} title="测试" onPickElement={onPick} />);
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');

    dispatchFromFrame(frame!, {
      type: 'PICK_RESULT',
      nonce: 'pick_nonce_3',
      source: 'frame',
      payload: {
        selector: '#x',
        pickIndex: 'oops',
        tagName: 'div',
        text: 'hi',
        rect: { left: 1, top: 2, width: 10, height: 20 },
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      },
    });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect((onPick.mock.calls[0][0] as { pickIndex?: number }).pickIndex).toBeUndefined();
  });
});
