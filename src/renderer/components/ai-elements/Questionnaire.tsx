import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** 单题（旧 question-form 行内契约 + `required` 扩展；缺省视为必填）。 */
export interface QuestionnaireQuestion {
  id: string;
  label: string;
  type: string;
  options: string[];
  recommended: string;
  required?: boolean;
}

/** 单表单（旧 question-form 行内契约）。 */
export interface QuestionnaireForm {
  id: string;
  title: string;
  questions: QuestionnaireQuestion[];
}

/**
 * 答案 → 回传给 AI 的文本（逐字沿用旧 qformBuildAnswer 口径：
 * `[form answers — id]` + `- label: value`，未答写「（跳过）」）。
 */
export function buildQuestionnaireAnswerText(
  forms: QuestionnaireForm[] | null | undefined,
  answers: Record<string, string> | null | undefined,
): string {
  const blocks: string[] = [];
  for (const form of Array.isArray(forms) ? forms : []) {
    if (!form || !Array.isArray(form.questions)) continue;
    const lines = ['[form answers — ' + String(form.id || '') + ']'];
    for (const q of form.questions) {
      if (!q) continue;
      const value = String((answers && answers[q.id]) || '').trim();
      lines.push('- ' + String(q.label || q.id) + ': ' + (value || '（跳过）'));
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function isRequired(q: QuestionnaireQuestion): boolean {
  // 旧契约 required 缺省为 true；显式 false 才允许留空。
  return q.required !== false;
}

/**
 * Questionnaire：问题/表单卡（AI Elements Questionnaire 模式，旧 question-form 行内契约）。
 *
 * B-AI-P2-4：补提交入口——
 * - 始终渲染「提交答案」（无回调时禁用并说明，避免“可填写但无法回传”）；
 * - 提交前校验必填项（required 缺省为 true），未答聚焦错误条且不调用回调；
 * - 通过既有 onSubmit 回调提交当前答案；提交后锁定卡片并显示「已提交」。
 */
export function Questionnaire({
  forms,
  onSubmit,
  disabled,
}: {
  forms: QuestionnaireForm[];
  onSubmit?: (answers: Record<string, string>) => boolean | void;
  disabled?: boolean;
}) {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  if (!forms.length) return null;

  const locked = submitted || !!disabled;
  const setAnswer = (id: string, value: string): void => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (error) setError('');
  };

  const submit = (): void => {
    if (locked) return;
    if (!onSubmit) {
      setError('当前没有可用的提交通道，请在输入框中回复。');
      return;
    }
    const missing: string[] = [];
    for (const form of forms) {
      for (const q of form.questions) {
        if (!q || !isRequired(q)) continue;
        if (!String(answers[q.id] || '').trim()) missing.push(q.label || q.id);
      }
    }
    if (missing.length) {
      setError('请先回答必填项：' + missing.join('、'));
      return;
    }
    setError('');
    const accepted = onSubmit(answers);
    if (accepted === false) {
      // 回调侧忙/无模型等场景拒绝发送：保持卡片可编辑，不能假装“已提交”。
      setError('当前暂时无法提交，请稍后再试。');
      return;
    }
    setSubmitted(true);
  };

  return (
    <Card data-testid="ai-questionnaire" data-slot="ai-questionnaire" className="p-2.5">
      {forms.map((f) => (
        <div key={f.id} className="mb-2 last:mb-0">
          <div className="mb-1 text-xs font-medium">{f.title}</div>
          {f.questions.map((q) => (
            <div key={q.id} className="mb-1.5 text-xs">
              <div className="mb-0.5 flex items-baseline gap-0.5 text-muted-foreground">
                <span>{q.label}</span>
                {isRequired(q) ? (
                  <span className="text-destructive" aria-hidden="true" title="必填">
                    *
                  </span>
                ) : null}
              </div>
              {q.type === 'text' || !q.options.length ? (
                <input
                  data-testid={'ai-q-' + q.id}
                  aria-label={q.label}
                  aria-invalid={!!error && isRequired(q) && !String(answers[q.id] || '').trim()}
                  disabled={locked}
                  className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none disabled:opacity-60"
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                />
              ) : (
                <span className="flex flex-col gap-1">
                  {q.options.map((op) => (
                    <label key={op} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="radio"
                        name={f.id + ':' + q.id}
                        value={op}
                        disabled={locked}
                        checked={answers[q.id] === op}
                        onChange={() => setAnswer(q.id, op)}
                      />
                      {op}
                      {q.recommended === op ? '（推荐）' : ''}
                    </label>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
      {error ? (
        <div
          data-testid="ai-questionnaire-error"
          role="alert"
          className="mb-1.5 text-[11.5px] text-destructive"
        >
          {error}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          data-testid="ai-questionnaire-submit"
          size="sm"
          onClick={submit}
          disabled={locked || !onSubmit}
          title={!onSubmit ? '当前没有可用的提交通道' : undefined}
        >
          {submitted ? '已提交' : '提交答案'}
        </Button>
        {submitted ? (
          <span className="text-[11px] text-muted-foreground">已回传给 AI</span>
        ) : null}
      </div>
    </Card>
  );
}

export default Questionnaire;
