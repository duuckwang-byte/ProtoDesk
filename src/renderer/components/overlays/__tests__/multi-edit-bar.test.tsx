/**
 * multi-edit-bar.test.tsx — Wave4 pick-OBS-2 回归。
 *
 * 覆盖：
 * - 空队列不渲染（保留既有语义）；
 * - 底部条不再使用 left-1/2 + -translate-x-1/2（transform 会建立 containing block）；
 * - Confirm 经 AlertDialog portal 到 body，不锚定在 72px 高的条内、不被视口下缘裁切；
 * - 取消/确认按钮存在且可点击，确认后回调正确。
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiEditBar, type EditQueueItem } from '../MultiEditBar';
import { useUiStore } from '@/stores/ui-store';

const QUEUE: EditQueueItem[] = [
  {
    id: 'q1',
    selector: '[data-pr-id="pr-p-39"]',
    page: '首页',
    htmlFile: '首页.html',
    text: 'W4-就地改-文字',
    selected: true,
  },
];

afterEach(() => {
  cleanup();
  useUiStore.setState({ toasts: [] });
});

describe('MultiEditBar 待提交条（pick-OBS-2）', () => {
  it('空队列不渲染', () => {
    render(<MultiEditBar queue={[]} />);
    expect(screen.queryByTestId('multi-edit-bar')).toBeNull();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('条本身不再建立 transform containing block（inset-x-0 + mx-auto 居中）', () => {
    render(<MultiEditBar queue={QUEUE} />);
    const bar = screen.getByTestId('multi-edit-bar');

    expect(bar.className).not.toContain('-translate-x-1/2');
    expect(bar.className).not.toContain('left-1/2');
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('mx-auto');
    expect(bar.className).toContain('w-fit');
  });

  it('移除 Confirm portal 到 body：不在条内，fixed 覆盖整个视口，按钮可点', async () => {
    const onRemove = vi.fn();
    render(<MultiEditBar queue={QUEUE} onRemove={onRemove} />);
    const bar = screen.getByTestId('multi-edit-bar');

    fireEvent.click(screen.getByTestId('multi-edit-remove'));

    const dialog = screen.getByTestId('confirm-dialog');
    // 关键：弹窗不是条的后代（否则 fixed 会相对条定位并被裁切）。
    expect(bar.contains(dialog)).toBe(false);

    const portal = dialog.closest<HTMLElement>('[data-slot="alert-dialog-portal"]');
    expect(portal).toBeTruthy();
    expect(portal?.parentElement).toBe(document.body);
    expect(portal?.className).toContain('fixed');
    expect(portal?.className).toContain('inset-0');

    // 取消/确认按钮均可见于 DOM，确认按钮可点击并触发回调。
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-dialog-ok'));
      await Promise.resolve();
    });

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('q1');
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('清空 Confirm 同样 portal 到 body，取消后关闭且不触发回调', () => {
    const onClear = vi.fn();
    render(<MultiEditBar queue={QUEUE} onClear={onClear} />);

    fireEvent.click(screen.getByTestId('multi-edit-clear'));

    const dialog = screen.getByTestId('confirm-dialog');
    const portal = dialog.closest<HTMLElement>('[data-slot="alert-dialog-portal"]');
    expect(portal?.parentElement).toBe(document.body);
    expect(dialog.textContent).toContain('清空全部 1 条待提交修改？');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });
});
