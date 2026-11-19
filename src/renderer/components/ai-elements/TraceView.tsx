import * as React from 'react';
import type { TraceLine } from '@/features/ai/adapters';

/**
 * TraceView：执行日志（AI Elements Trace 模式）——独立深色终端面板。
 *
 * 只读投影 ai-store.trace（旧 trace 归一后的行）；不解析事件、不写 store。
 * 清空动作由调用方注入 onClear（AiDialog → store.dispatch({type:'clear-trace'})），
 * 未注入时不渲染清空按钮，保持组件可独立复用。
 */
export function TraceView({
  lines,
  onClear,
}: {
  lines: TraceLine[];
  onClear?: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const copyAll = async (): Promise<void> => {
    const text = lines.map((l) => `[${l.time}] [${l.tag}] ${l.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用（权限/非安全上下文）时不改变日志内容。
    }
  };

  return (
    <div
      data-testid="ai-trace-view"
      data-slot="ai-trace"
      className="flex min-h-0 flex-1 flex-col bg-[#09090b] text-zinc-100"
    >
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-zinc-800 bg-[#0c0c0f] px-3 py-2">
        <button
          type="button"
          data-testid="ai-trace-copy"
          disabled={lines.length === 0}
          onClick={() => {
            void copyAll();
          }}
          className="h-7 rounded-md border border-zinc-700 px-2.5 text-[11.5px] text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
        >
          {copied ? '已复制' : '复制全部日志'}
        </button>
        {onClear ? (
          <button
            type="button"
            data-testid="ai-trace-clear"
            disabled={lines.length === 0}
            onClick={onClear}
            className="h-7 rounded-md border border-zinc-700 px-2.5 text-[11.5px] text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            清空
          </button>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-zinc-500">
          ACP Stream · {lines.length} events
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.65]">
        {lines.length === 0 ? (
          <div className="text-zinc-500">暂无执行日志</div>
        ) : (
          lines.map((l, i) => (
            <div
              key={String(i) + '_' + l.time}
              className="break-words whitespace-pre-wrap"
              data-level={l.level}
            >
              <span className="text-zinc-500">[{l.time}]</span>{' '}
              <span className="text-sky-400">[{l.tag}]</span>{' '}
              <span
                className={
                  l.level === 'error'
                    ? 'text-rose-400'
                    : l.level === 'warn'
                      ? 'text-amber-300'
                      : 'text-zinc-200'
                }
              >
                {l.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default TraceView;
