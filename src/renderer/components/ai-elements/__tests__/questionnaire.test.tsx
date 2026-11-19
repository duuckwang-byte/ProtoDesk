import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  Questionnaire,
  buildQuestionnaireAnswerText,
  type QuestionnaireForm,
} from '../Questionnaire';

afterEach(() => {
  cleanup();
});

const forms: QuestionnaireForm[] = [
  {
    id: 'f1',
    title: '发布确认',
    questions: [
      {
        id: 'page',
        label: '目标页面',
        type: 'radio',
        options: ['首页', '我的'],
        recommended: '首页',
      },
      {
        id: 'note',
        label: '备注',
        type: 'text',
        options: [],
        recommended: '',
        required: false,
      },
    ],
  },
];

describe('Questionnaire：提交与必填校验（B-AI-P2-4）', () => {
  it('未答必填项时显示错误且不提交', () => {
    const onSubmit = vi.fn();
    render(<Questionnaire forms={forms} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('ai-questionnaire-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-questionnaire-error').textContent).toContain('目标页面');
  });

  it('必填项完成后提交当前答案（可选题可留空）', () => {
    const onSubmit = vi.fn();
    render(<Questionnaire forms={forms} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: /首页/ }));
    fireEvent.change(screen.getByTestId('ai-q-note'), { target: { value: '加急' } });
    fireEvent.click(screen.getByTestId('ai-questionnaire-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ page: '首页', note: '加急' });
    expect(screen.getByTestId('ai-questionnaire-submit').textContent).toContain('已提交');
    expect((screen.getByTestId('ai-q-note') as HTMLInputElement).disabled).toBe(true);
  });

  it('无回调时仍渲染提交按钮，但禁用并说明', () => {
    render(<Questionnaire forms={forms} />);
    const button = screen.getByTestId('ai-questionnaire-submit') as HTMLButtonElement;
    expect(button.textContent).toContain('提交');
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('提交通道');
  });

  it('答案回传文本沿用旧 form answers 口径', () => {
    expect(buildQuestionnaireAnswerText(forms, { page: '首页' })).toBe(
      '[form answers — f1]\n- 目标页面: 首页\n- 备注: （跳过）',
    );
  });
});
