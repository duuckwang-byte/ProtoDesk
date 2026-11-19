import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/** ToolCard：工具调用卡（AI Elements Tool 模式）。 */
export function ToolCard({
  tool,
  title,
  status,
  command,
}: {
  tool: string;
  title: string;
  status?: string;
  command?: string;
}) {
  const done = /done|complete|success/i.test(status || '');
  return (
    <Card data-testid="ai-tool-card" data-slot="ai-tool-call" className="p-2.5">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{tool || '工具'}</Badge>
        <span className="truncate text-xs text-muted-foreground">{title}</span>
        {status ? <Badge variant={done ? 'default' : 'outline'}>{status}</Badge> : null}
      </div>
      {command ? (
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-secondary p-2 font-mono text-[11.5px]">{command}</pre>
      ) : null}
    </Card>
  );
}
