import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ModelSelector, computeCascadePosition } from '../ModelSelector';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('computeCascadePosition：小窗宽不裁切（B-AI-P2-1）', () => {
  it('1024 视口下右对齐触发器，right 不越过视口', () => {
    const pos = computeCascadePosition(
      { top: 700, bottom: 732, right: 1000 },
      { width: 1014, height: 768 },
      300,
    );
    expect(pos.width).toBe(448);
    expect(pos.left + pos.width).toBeLessThanOrEqual(1014 - 8);
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(768 - 8);
  });

  it('触发器贴近右侧时整体左移，仍保持两列宽度', () => {
    const pos = computeCascadePosition(
      { top: 700, bottom: 732, right: 1014 },
      { width: 1014, height: 768 },
      300,
    );
    expect(pos.left + pos.width).toBeLessThanOrEqual(1014 - 8);
    expect(pos.width).toBe(448);
  });

  it('上方空间不足时向下翻转', () => {
    const pos = computeCascadePosition(
      { top: 100, bottom: 132, right: 900 },
      { width: 1024, height: 768 },
      300,
    );
    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBeGreaterThanOrEqual(132);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(768 - 8);
  });

  it('极窄视口下宽度收缩到视口内，两列仍可见', () => {
    const pos = computeCascadePosition(
      { top: 400, bottom: 432, right: 320 },
      { width: 320, height: 900 },
      260,
    );
    expect(pos.width).toBe(320 - 16);
    expect(pos.left).toBe(8);
    expect(pos.left + pos.width).toBeLessThanOrEqual(320 - 8);
  });

  it('1024 宽下触发器右边界越界（实测 1166.8）时浮层仍整体在视口内', () => {
    const pos = computeCascadePosition(
      { top: 700, bottom: 732, right: 1166.8448 },
      { width: 1024, height: 768 },
      300,
    );
    expect(pos.left).toBe(1024 - 8 - 448);
    expect(pos.left + pos.width).toBe(1016);
    expect(pos.width).toBe(448);
    expect(pos.maxHeight).toBeGreaterThanOrEqual(64);
  });
});

describe('ModelSelector：portal 浮层与选择语义', () => {
  function renderSelector(onModelChange = vi.fn(), onThinkingChange = vi.fn()) {
    const utils = render(
      <ModelSelector
        models={[
          { value: 'm1', label: '模型一' },
          { value: 'm2', label: '模型二' },
        ]}
        thinkingOptions={[{ value: 'high', label: '高' }]}
        modelId="m1"
        thinkingLevel="high"
        onModelChange={onModelChange}
        onThinkingChange={onThinkingChange}
      />,
    );
    return { ...utils, onModelChange, onThinkingChange };
  }

  it('浮层 portal 到 body，双列 listbox 都渲染', () => {
    const { container } = renderSelector();
    fireEvent.click(screen.getByTestId('ai-model-select'));
    const content = document.body.querySelector('[data-slot="select-content"]') as HTMLElement | null;
    expect(content).toBeTruthy();
    expect(container.contains(content)).toBe(false);
    expect(within(content as HTMLElement).getAllByRole('listbox').length).toBe(2);
    expect(screen.getByTestId('ai-model-popover').getAttribute('data-placement')).toBeTruthy();
    expect(screen.getByTestId('ai-model-popover').style.position).toBe('fixed');
  });

  it('选模型保持打开，选思考关闭（选择语义不变）', () => {
    const { onModelChange, onThinkingChange } = renderSelector();
    fireEvent.click(screen.getByTestId('ai-model-select'));
    fireEvent.click(screen.getAllByTestId('ai-model-option')[1]);
    expect(onModelChange).toHaveBeenCalledWith('m2');
    expect(screen.queryByTestId('ai-model-popover')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-thinking-option'));
    expect(onThinkingChange).toHaveBeenCalledWith('high');
    expect(screen.queryByTestId('ai-model-popover')).toBeNull();
  });

  it('Esc 只关浮层，不再把同一次按键传给 AI Dialog', () => {
    renderSelector();
    fireEvent.click(screen.getByTestId('ai-model-select'));
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    fireEvent.keyDown(document, { key: 'Escape' });
    window.removeEventListener('keydown', onWindowKeyDown);
    expect(screen.queryByTestId('ai-model-popover')).toBeNull();
    expect(onWindowKeyDown).not.toHaveBeenCalled();
  });

  it('真实焦点位于 AI Dialog 内时按 Esc 也只关浮层', () => {
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    try {
      renderSelector();
      const input = document.createElement('textarea');
      input.setAttribute('data-testid', 'ai-input');
      document.body.appendChild(input);
      input.focus();

      fireEvent.click(screen.getByTestId('ai-model-select'));
      expect(screen.getByTestId('ai-model-popover')).toBeTruthy();

      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByTestId('ai-model-popover')).toBeNull();
      expect(onWindowKeyDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });
});

describe('ModelSelector：固定尺寸不随文案伸缩', () => {
  const LONG_MODEL_LABEL = 'DeepSeek-V4.1-Flash-Reasoning-Preview-2026-11-16';
  const LONG_THINKING_LABEL = 'On (default) — extended reasoning budget';

  function renderFixed(overrides: Partial<React.ComponentProps<typeof ModelSelector>> = {}) {
    return render(
      <ModelSelector
        models={[
          { value: 'deepseek', label: 'DeepSeek-V4.1-Flash' },
          { value: 'long', label: LONG_MODEL_LABEL },
        ]}
        thinkingOptions={[
          { value: 'default', label: 'On (default)' },
          { value: 'minimal', label: 'minimal' },
          { value: 'xhigh', label: LONG_THINKING_LABEL },
        ]}
        thinkingStatus="ready"
        modelId="deepseek"
        thinkingLevel="default"
        onModelChange={() => {}}
        onThinkingChange={() => {}}
        {...overrides}
      />,
    );
  }

  it('模型/思考触发器固定 200px/150px，shrink-0，文本 truncate 且 title 为全称', () => {
    renderFixed();
    const modelTrigger = screen.getByTestId('ai-model-select');
    expect(modelTrigger.className).toContain('w-[200px]');
    expect(modelTrigger.className).toContain('shrink-0');
    const modelText = within(modelTrigger).getByText('DeepSeek-V4.1-Flash');
    expect(modelText.className).toContain('truncate');
    expect(modelText.getAttribute('title')).toBe('DeepSeek-V4.1-Flash');
    expect(modelTrigger.querySelector('svg')?.getAttribute('class')).toContain('shrink-0');

    const thinkingTrigger = screen.getByTestId('ai-thinking-select');
    expect(thinkingTrigger.className).toContain('w-[150px]');
    expect(thinkingTrigger.className).toContain('shrink-0');
    const thinkingText = within(thinkingTrigger).getByText('On (default)');
    expect(thinkingText.className).toContain('truncate');
    expect(thinkingText.getAttribute('title')).toBe('On (default)');
    expect(thinkingTrigger.querySelector('svg')?.getAttribute('class')).toContain('shrink-0');
  });

  it('浮层固定 448px，两列 246px/200px，长选项省略但不撑宽', () => {
    renderFixed();
    fireEvent.click(screen.getByTestId('ai-model-select'));

    const panel = screen.getByTestId('ai-model-popover');
    expect(panel.style.width).toBe('448px');
    expect(panel.style.maxWidth).toContain('100vw');

    const grid = screen.getByTestId('ai-model-grid');
    expect(grid.style.gridTemplateColumns).toContain('246px');
    expect(grid.style.gridTemplateColumns).toContain('200px');

    const longModelOption = screen.getAllByTestId('ai-model-option')[1];
    expect(longModelOption.getAttribute('title')).toBe(LONG_MODEL_LABEL);
    const longModelText = within(longModelOption).getByText(LONG_MODEL_LABEL);
    expect(longModelText.className).toContain('truncate');

    const longThinkingOption = screen
      .getAllByTestId('ai-thinking-option')
      .find((o) => o.textContent?.includes('extended reasoning budget'));
    expect(longThinkingOption).toBeTruthy();
    const longThinkingText = within(longThinkingOption as HTMLElement).getByText(LONG_THINKING_LABEL);
    expect(longThinkingText.className).toContain('truncate');
  });

  it('切换不同模型/档位/探测状态时宽度类与浮层宽度完全一致', () => {
    const { rerender } = renderFixed();
    fireEvent.click(screen.getByTestId('ai-model-select'));
    const modelTrigger = screen.getByTestId('ai-model-select');
    const thinkingTrigger = screen.getByTestId('ai-thinking-select');
    const modelClass = modelTrigger.className;
    const thinkingClass = thinkingTrigger.className;
    expect(screen.getByTestId('ai-model-popover').style.width).toBe('448px');

    const variants: Array<Partial<React.ComponentProps<typeof ModelSelector>>> = [
      { modelId: 'long', thinkingLevel: 'minimal' },
      { modelId: 'deepseek', thinkingLevel: 'xhigh' },
      { thinkingStatus: 'probing' },
      { thinkingStatus: 'unsupported' },
      { thinkingStatus: 'error', thinkingError: 'ACP 配置读取失败' },
      { thinkingStatus: 'ready', thinkingLevel: 'default' },
    ];

    for (const variant of variants) {
      rerender(
        <ModelSelector
          models={[
            { value: 'deepseek', label: 'DeepSeek-V4.1-Flash' },
            { value: 'long', label: LONG_MODEL_LABEL },
          ]}
          thinkingOptions={[
            { value: 'default', label: 'On (default)' },
            { value: 'minimal', label: 'minimal' },
            { value: 'xhigh', label: LONG_THINKING_LABEL },
          ]}
          thinkingStatus="ready"
          modelId="deepseek"
          thinkingLevel="default"
          onModelChange={() => {}}
          onThinkingChange={() => {}}
          {...variant}
        />,
      );
      expect(screen.getByTestId('ai-model-select').className).toBe(modelClass);
      expect(screen.getByTestId('ai-thinking-select').className).toBe(thinkingClass);
      expect(screen.getByTestId('ai-model-popover').style.width).toBe('448px');
      expect(screen.getByTestId('ai-model-grid').style.gridTemplateColumns).toContain('246px');
      expect(screen.getByTestId('ai-model-grid').style.gridTemplateColumns).toContain('200px');
    }
  });

  it('1024 视口下 448px 浮层完整落在视口内（不裁切）', () => {
    const pos = computeCascadePosition(
      { top: 700, bottom: 732, right: 1000 },
      { width: 1024, height: 768 },
      360,
    );
    expect(pos.width).toBe(448);
    expect(pos.left).toBe(552);
    expect(pos.left + pos.width).toBeLessThanOrEqual(1024 - 8);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(768 - 8);
  });
});
