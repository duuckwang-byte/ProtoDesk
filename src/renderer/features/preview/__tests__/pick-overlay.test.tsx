/**
 * pick-overlay.test.tsx — Wave4 pick-OBS-1 回归。
 *
 * 覆盖：
 * - 悬停框/选中框有可见边框 + 半透明填充，角标编号 1..n；
 * - 所有框与容器 pointer-events:none，不遮挡 iframe / Stage 工具栏交互；
 * - box-sizing:border-box：2px 边框画在 rect 内侧，不撑大 bbox；
 * - 移动端 scale 后的小数坐标保留（不被提前取整导致漂移）。
 */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PickOverlay from '../PickOverlay';

afterEach(cleanup);

describe('PickOverlay 可见样式（pick-OBS-1）', () => {
  it('无悬停/选中时只渲染空容器', () => {
    const { getByTestId, queryByTestId } = render(<PickOverlay hover={null} selected={[]} />);
    expect(getByTestId('pick-overlay')).toBeTruthy();
    expect(queryByTestId('pick-hover')).toBeNull();
    expect(document.querySelector('.selection-box-overlay')).toBeNull();
  });

  it('悬停框：2px 虚线 + 半透明填充 + 不拦截鼠标', () => {
    const { getByTestId } = render(
      <PickOverlay
        hover={{ left: 581.997, top: 491.996, width: 72.999, height: 21.998 }}
        selected={[]}
      />,
    );
    const hover = getByTestId('pick-hover');

    expect(hover.id).toBe('editHover');
    expect(hover.style.position).toBe('absolute');
    expect(hover.style.borderWidth).toBe('2px');
    expect(hover.style.borderStyle).toBe('dashed');
    expect(hover.style.borderColor).toMatch(/#2563eb|rgb\(37,\s*99,\s*235\)/);
    expect(hover.style.backgroundColor).toContain('rgba(37, 99, 235');
    expect(hover.style.boxSizing).toBe('border-box');
    expect(hover.style.pointerEvents).toBe('none');
    // 移动端 scale=0.6008：小数坐标原样保留，避免框与元素错位。
    expect(hover.style.left).toBe('581.997px');
    expect(hover.style.top).toBe('491.996px');
    expect(hover.style.width).toBe('72.999px');
    expect(hover.style.height).toBe('21.998px');
  });

  it('选中框：2px 实线 + 半透明填充 + 白描边序号角标', () => {
    render(
      <PickOverlay
        hover={null}
        selected={[
          { left: 10, top: 20, width: 100, height: 30 },
          { left: 10, top: 60, width: 80, height: 24 },
        ]}
      />,
    );

    const boxes = Array.from(document.querySelectorAll<HTMLElement>('.selection-box-overlay'));
    expect(boxes).toHaveLength(2);

    const first = boxes[0];
    expect(first.style.borderWidth).toBe('2px');
    expect(first.style.borderStyle).toBe('solid');
    expect(first.style.borderColor).toMatch(/#2563eb|rgb\(37,\s*99,\s*235\)/);
    expect(first.style.backgroundColor).toContain('rgba(37, 99, 235');
    expect(first.style.boxSizing).toBe('border-box');
    expect(first.style.pointerEvents).toBe('none');

    const badges = Array.from(document.querySelectorAll<HTMLElement>('.selection-badge'));
    expect(badges.map((b) => b.textContent)).toEqual(['1', '2']);
    const badge = badges[0];
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.borderStyle).toBe('solid');
    expect(badge.style.backgroundColor).toMatch(/#2563eb|rgb\(37,\s*99,\s*235\)/);
    expect(badge.style.color).toMatch(/#ffffff|rgb\(255,\s*255,\s*255\)/);
    expect(badge.style.pointerEvents).toBe('none');
  });

  it('浮层容器 pointer-events:none，层级/事件不干扰 Stage 工具条', () => {
    const { getByTestId } = render(
      <PickOverlay hover={{ left: 1, top: 2, width: 3, height: 4 }} selected={[]} />,
    );
    expect(getByTestId('pick-overlay').style.pointerEvents).toBe('none');
  });

  it('零尺寸选中框不渲染（沿用旧 renderOverlay 跳过口径）', () => {
    render(<PickOverlay hover={null} selected={[{ left: 0, top: 0, width: 0, height: 0 }]} />);
    expect(document.querySelectorAll('.selection-box-overlay')).toHaveLength(0);
  });
});
