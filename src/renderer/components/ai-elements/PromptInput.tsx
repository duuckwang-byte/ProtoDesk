import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * PromptInput：输入条 + 发送/停止（AI Elements Prompt Input 模式）。
 *
 * `sendBlockedReason`（B-AI-P2-5）：无可用模型/未选择模型时禁用发送并展示原因，
 * 同时拦住 Enter 发送，避免发起一次必然失败的 ai:ask。
 *
 * 焦点样式：textarea 聚焦只用 1px 低对比边框 + 柔和 focus ring，
 * 覆盖 Textarea 基座的 focus:border-[var(--ring)]（--ring 近黑，视觉过重）。
 */
export function PromptInput({
  busy,
  disabled,
  sendBlockedReason,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled?: boolean;
  sendBlockedReason?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = React.useState('');
  const blocked = !!sendBlockedReason;
  const submit = () => {
    const v = text.trim();
    if (!v || busy || disabled || blocked) return;
    setText('');
    onSend(v);
  };
  return (
    <div data-testid="ai-prompt-input" data-slot="ai-prompt-input" className="flex items-end gap-2 p-3 pt-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Textarea
          data-testid="ai-prompt-textarea"
          value={text}
          disabled={disabled}
          placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
          className="min-h-10 resize-none focus:border-zinc-300 focus:ring-2 focus:ring-ring/10"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {sendBlockedReason ? (
          <div data-testid="ai-send-hint" className="px-0.5 text-[11px] text-muted-foreground">
            {sendBlockedReason}
          </div>
        ) : null}
      </div>
      {busy ? (
        <Button data-testid="ai-stop-btn" variant="outline" onClick={onStop}>
          停止
        </Button>
      ) : (
        <Button
          data-testid="ai-send-btn"
          disabled={disabled || blocked || !text.trim()}
          title={sendBlockedReason}
          onClick={submit}
        >
          发送
        </Button>
      )}
    </div>
  );
}

export default PromptInput;
