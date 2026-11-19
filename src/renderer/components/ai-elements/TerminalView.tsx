import { Card } from '@/components/ui/card';

/** TerminalView：终端输出卡（AI Elements Terminal 模式，纯展示）。 */
export function TerminalView({ output }: { output: string }) {
  if (!output) return null;
  return (
    <Card data-testid="ai-terminal-view" data-slot="ai-terminal" className="p-2.5">
      <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">终端输出</div>
      <pre className="max-h-48 overflow-auto rounded-md bg-secondary p-2 font-mono text-[11.5px] whitespace-pre-wrap">
        {output}
      </pre>
    </Card>
  );
}
