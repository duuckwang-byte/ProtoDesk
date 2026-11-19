import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/** PlanCard：任务计划卡（AI Elements Plan 模式）。 */
export function PlanCard({ entries }: { entries: Array<{ title: string; status: string }> }) {
  if (!entries.length) return null;
  return (
    <Card data-testid="ai-plan-card" data-slot="ai-plan" className="p-2.5">
      <div className="mb-1.5 text-[11.5px] font-medium text-muted-foreground">计划 · {entries.length}项</div>
      <ul className="flex flex-col gap-1">
        {entries.map((e, i) => (
          <li key={String(i) + '_' + e.title} className="flex items-center gap-2 text-xs">
            {e.status ? <Badge variant="outline">{e.status}</Badge> : null}
            <span className="truncate">{e.title}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
