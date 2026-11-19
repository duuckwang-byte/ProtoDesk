import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PromptInput } from '../PromptInput';

afterEach(() => {
  cleanup();
});

describe('PromptInput：无模型时发送前置禁用（B-AI-P2-5）', () => {
  it('展示原因、禁用发送、点击/Enter 都不触发 onSend', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        busy={false}
        sendBlockedReason="暂无可用模型：请先在 设置 › 模型 中启用至少一个模型"
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    const textarea = screen.getByTestId('ai-prompt-textarea');
    fireEvent.change(textarea, { target: { value: '你好' } });
    const send = screen.getByTestId('ai-send-btn') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toContain('暂无可用模型');
    expect(screen.getByTestId('ai-send-hint').textContent).toContain('设置 › 模型');
    fireEvent.click(send);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('有模型时输入后可正常发送', () => {
    const onSend = vi.fn();
    render(<PromptInput busy={false} onSend={onSend} onStop={vi.fn()} />);
    const textarea = screen.getByTestId('ai-prompt-textarea');
    const send = screen.getByTestId('ai-send-btn') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: '你好' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith('你好');
    expect(screen.queryByTestId('ai-send-hint')).toBeNull();
  });
});

describe('PromptInput：焦点样式', () => {
  it('textarea 使用 1px 低对比边框与柔和 focus ring', () => {
    render(<PromptInput busy={false} onSend={vi.fn()} onStop={vi.fn()} />);
    const textarea = screen.getByTestId('ai-prompt-textarea');
    expect(textarea.className).toContain('focus:border-zinc-300');
    expect(textarea.className).toContain('focus:ring-2');
    expect(textarea.className).toContain('focus:ring-ring/10');
    // 基座的近黑 focus 边框已被 cn/twMerge 覆盖掉。
    expect(textarea.className).not.toContain('focus:border-[var(--ring)]');
  });
});
