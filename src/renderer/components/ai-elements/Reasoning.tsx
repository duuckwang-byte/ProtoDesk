import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** Reasoning：思考块（AI Elements Reasoning 模式，可折叠，默认收起长文本）。 */
export function Reasoning({ text, defaultOpen = false }: { text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const body = text.length > 1500 && !open ? text.slice(-1500) : text;
  return (
    <Card data-testid="ai-reasoning" data-slot="ai-reasoning" className="p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-muted-foreground">思考过程 · {text.length}字</span>
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </Button>
      </div>
      <div className={cn('mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground', !open && 'line-clamp-6')}>
        {body}
      </div>
    </Card>
  );
}
