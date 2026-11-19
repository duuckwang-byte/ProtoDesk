import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { AiMessage } from '@/features/ai/adapters';
import { renderMarkdownToHtml } from '@/features/ai/markdown';
import { Reasoning } from './Reasoning';
import { ToolCard } from './ToolCard';
import { PlanCard } from './PlanCard';
import { ConfirmationCard } from './ConfirmationCard';
import { Questionnaire, type QuestionnaireForm } from './Questionnaire';

/**
 * Message：用户/AI 气泡（AI Elements Message 模式，按 kind 分发到各卡片）。
 *
 * B-AI-P2-2：assistant 文本经 `features/ai/markdown` 渲染（标题/列表/表格/粗体/
 * 行内代码/围栏代码块）；渲染器先转义 HTML 再生成标签，禁止透传原始 HTML。
 * `onQuestionnaireSubmit` 由 AiDialog 注入既有发送回调，问题卡提交后直接回传答案。
 */
export function Message({
  message,
  onQuestionnaireSubmit,
}: {
  message: AiMessage;
  onQuestionnaireSubmit?: (
    answers: Record<string, string>,
    forms: QuestionnaireForm[],
  ) => boolean | void;
}) {
  const m = message;
  if (m.role === 'user') {
    return (
      <div data-slot="ai-message-user" className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-[12.5px] text-primary-foreground">
          {m.text}
        </div>
      </div>
    );
  }
  if (m.kind === 'thinking') return <Reasoning text={m.text} />;
  if (m.kind === 'tool_call') {
    const p = (m.payload || {}) as Record<string, unknown>;
    return (
      <ToolCard
        tool={String(p.tool || m.text)}
        title={String(p.title || m.text)}
        status={String(p.status || '')}
        command={String(p.command || '')}
      />
    );
  }
  if (m.kind === 'plan') {
    const p = (m.payload || {}) as { entries?: Array<{ title: string; status: string }> };
    return <PlanCard entries={Array.isArray(p.entries) ? p.entries : []} />;
  }
  if (m.kind === 'permission') {
    const p = (m.payload || {}) as Record<string, unknown>;
    return (
      <ConfirmationCard
        title={String(p.title || m.text || '权限请求')}
        detail={String(p.command || p.path || '')}
        pending={String(p.status || 'pending') === 'pending'}
      />
    );
  }
  if (m.kind === 'question') {
    const p = (m.payload || {}) as { forms?: QuestionnaireForm[] };
    const forms = Array.isArray(p.forms) ? p.forms : [];
    return (
      <Questionnaire
        forms={forms}
        onSubmit={
          onQuestionnaireSubmit
            ? (answers) => onQuestionnaireSubmit(answers, forms)
            : undefined
        }
      />
    );
  }
  if (m.kind === 'error') {
    return (
      <div data-slot="ai-message-error" className="rounded-lg border border-destructive/40 bg-background p-3 text-xs">
        <Badge variant="outline">错误</Badge>
        <div className="mt-1 whitespace-pre-wrap break-words text-foreground">{m.text}</div>
      </div>
    );
  }
  if (m.kind === 'status' || m.kind === 'info' || m.kind === 'trace' || m.kind === 'snapshot' || m.kind === 'usage') {
    return (
      <div data-slot="ai-message-meta" className="text-[11.5px] text-muted-foreground">
        {m.text}
      </div>
    );
  }
  let html = '';
  try {
    html = renderMarkdownToHtml(m.text);
  } catch {
    // Markdown 渲染异常时退回纯文本，绝不因一条回复导致整窗白屏。
    html = '';
  }
  return (
    <div data-slot="ai-message-ai" className={cn('max-w-full rounded-lg border border-border bg-card p-3 text-[12.5px]')}>
      {html ? (
        <div
          data-testid="ai-message-markdown"
          data-slot="ai-message-markdown"
          className="ai-markdown max-w-full break-words"
          // 渲染器先转义全部输入再生成标签；此处只接收 markdown.ts 的自有输出。
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words">{m.text}</div>
      )}
    </div>
  );
}

export default Message;
