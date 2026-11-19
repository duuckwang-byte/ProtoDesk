import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Message } from '../Message';
import type { AiMessage } from '@/features/ai/adapters';

afterEach(() => {
  cleanup();
});

function textMessage(text: string): AiMessage {
  return {
    key: 'm1',
    sessionId: 's1',
    role: 'assistant',
    kind: 'text',
    text,
    ts: 1,
    sourceType: 'chunk',
  };
}

describe('Message：Markdown 渲染（B-AI-P2-2）', () => {
  it('assistant 文本渲染为标题 / 列表 / 围栏代码块', () => {
    const { container } = render(
      <Message message={textMessage('# 冒烟\n\n- 通过\n\n```js\nconsole.log(1)\n```')} />,
    );
    expect(container.querySelector('h1')?.textContent).toBe('冒烟');
    expect(container.querySelectorAll('li').length).toBe(1);
    expect(container.querySelector('pre code')?.textContent).toBe('console.log(1)');
    const markdown = screen.getByTestId('ai-message-markdown');
    expect(markdown.innerHTML).not.toContain('```');
  });

  it('不渲染原始 HTML（XSS 防线）', () => {
    const { container } = render(
      <Message message={textMessage('<img src=x onerror="alert(1)"><script>alert(1)</script>')} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByTestId('ai-message-markdown').textContent).toContain('<img src=x');
  });

  it('用户气泡保持纯文本，不解析 Markdown', () => {
    const { container } = render(
      <Message
        message={{ ...textMessage('# 标题'), role: 'user', sourceType: 'local' }}
      />,
    );
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('# 标题');
  });
});

describe('Message：问题卡提交（B-AI-P2-4）', () => {
  const forms = [
    {
      id: 'qform1',
      title: '确认作用页',
      questions: [
        {
          id: 'page',
          label: '选择目标页面',
          type: 'radio',
          options: ['首页', '我的'],
          recommended: '首页',
        },
      ],
    },
  ];

  it('问题卡始终有提交按钮，并通过回调回传当前答案', () => {
    const onSubmit = vi.fn();
    render(
      <Message
        message={{
          key: 'q1',
          sessionId: 's1',
          role: 'assistant',
          kind: 'question',
          text: '请确认作用页',
          ts: 1,
          sourceType: 'question_request',
          payload: { forms },
        }}
        onQuestionnaireSubmit={onSubmit}
      />,
    );
    const submit = screen.getByTestId('ai-questionnaire-submit');
    expect(submit.textContent).toContain('提交');
    fireEvent.click(screen.getByRole('radio', { name: /首页/ }));
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ page: '首页' }, forms);
  });

  it('未答必填项不提交', () => {
    const onSubmit = vi.fn();
    render(
      <Message
        message={{
          key: 'q2',
          sessionId: 's1',
          role: 'assistant',
          kind: 'question',
          text: '请确认作用页',
          ts: 1,
          sourceType: 'question_request',
          payload: { forms },
        }}
        onQuestionnaireSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-questionnaire-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-questionnaire-error').textContent).toContain('选择目标页面');
  });
});
