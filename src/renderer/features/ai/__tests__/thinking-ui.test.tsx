/**
 * 思考强度探测 UI 回归（ModelSelector）：
 * - 探测中：触发器显示「探测中…」，列内没有旧档位；
 * - 不支持：显示「该模型不支持思考」、档位列禁用、没有旧模型档位；
 * - 成功：只渲染 ACP 文案（Low/High），不显示原始 low/high 值；
 * - 失败：保留「默认」可发送，并在浮层内提示，不写全局错误。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelSelector, type ThinkingStatus } from '@/components/ai-elements/ModelSelector';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderSelector(
  thinkingStatus: ThinkingStatus,
  thinkingOptions: Array<{ value: string; label: string; title?: string }> = [],
  thinkingError = '',
) {
  render(
    <ModelSelector
      models={[{ value: 'm1', label: '模型一' }]}
      thinkingOptions={thinkingOptions}
      thinkingStatus={thinkingStatus}
      thinkingError={thinkingError}
      modelId="m1"
      thinkingLevel="high"
      onModelChange={() => {}}
      onThinkingChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId('ai-model-select'));
}

describe('ModelSelector：思考探测状态', () => {
  it('探测中显示「探测中…」，不残留旧档位', () => {
    renderSelector('probing');
    expect(screen.getByTestId('ai-thinking-select').textContent).toContain('探测中…');
    expect(screen.getByTestId('ai-thinking-probing').textContent).toContain('探测中…');
    expect(screen.queryAllByTestId('ai-thinking-option')).toHaveLength(0);
  });

  it('不支持思考：明确空态并禁用档位列', () => {
    renderSelector('unsupported');
    const trigger = screen.getByTestId('ai-thinking-select');
    expect(trigger.textContent).toContain('不支持');
    expect(trigger.hasAttribute('disabled') || trigger.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
    expect(screen.getByTestId('ai-thinking-empty').textContent).toContain('该模型不支持思考');
    expect(screen.queryAllByTestId('ai-thinking-option')).toHaveLength(0);
  });

  it('ready 只展示 ACP 文案（不显示原始 low/high）', () => {
    renderSelector('ready', [
      { value: 'low', label: '低', title: '低强度' },
      { value: 'high', label: '高', title: '高强度' },
    ]);
    expect(screen.getByTestId('ai-thinking-select').textContent).toContain('高');
    const options = screen.getAllByTestId('ai-thinking-option');
    expect(options.map((o) => o.textContent)).toEqual(['低', '高']);
    expect(screen.queryByText('low')).toBeNull();
    expect(screen.queryByText('high')).toBeNull();
  });

  it('探测失败保留「默认」并只在浮层内提示', () => {
    renderSelector('error', [], 'ACP 配置读取失败');
    expect(screen.getByTestId('ai-thinking-select').textContent).toContain('默认');
    expect(screen.getByTestId('ai-thinking-error').textContent).toContain('档位读取失败');
    expect(screen.getAllByTestId('ai-thinking-option')).toHaveLength(1);
  });
});
