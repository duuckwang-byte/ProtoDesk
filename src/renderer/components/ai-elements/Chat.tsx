import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AiMessage } from '@/features/ai/adapters';
import { Message } from './Message';

/** Chat：会话消息流容器（AI Elements Chat 模式，数据源只走 ai:event 归一后的 messages）。 */
export function Chat({
  messages,
  className,
  renderMessage,
}: {
  messages: AiMessage[];
  className?: string;
  renderMessage?: (m: AiMessage) => React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // 流式合并后消息条数不变，只有最后一条的正文在增长：滚动必须依赖其内容/时间戳。
  const last = messages.length ? messages[messages.length - 1] : null;
  const lastKey = last ? last.key : '';
  const lastTextLength = last ? last.text.length : 0;
  const lastTs = last && typeof last.ts === 'number' ? last.ts : 0;
  React.useEffect(() => {
    const el = ref.current;
    if (el) {
      try {
        el.scrollTop = el.scrollHeight;
      } catch {
        // 滚动失败不阻断渲染。
      }
    }
  }, [messages.length, lastKey, lastTextLength, lastTs]);
  return (
    <div
      data-testid="ai-chat"
      data-slot="ai-chat"
      ref={ref}
      className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3', className)}
    >
      {messages.length === 0 ? (
        <div data-testid="ai-chat-empty" className="py-8 text-center text-xs text-muted-foreground">
          暂无消息，输入问题开始对话。
        </div>
      ) : (
        messages.map((m) => (
          <div key={m.key} data-testid={'ai-msg-' + m.kind}>
            {renderMessage ? renderMessage(m) : <Message message={m} />}
          </div>
        ))
      )}
    </div>
  );
}
