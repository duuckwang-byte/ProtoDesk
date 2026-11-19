import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/** ConfirmationCard：通用确认卡（AI Elements Confirmation 模式，纯展示；权限回执走 features/ai/PermissionCard）。 */
export function ConfirmationCard({
  title,
  detail,
  pending = true,
  onAllow,
  onDeny,
}: {
  title: string;
  detail?: string;
  pending?: boolean;
  onAllow?: () => void;
  onDeny?: () => void;
}) {
  return (
    <Card data-testid="ai-confirmation-card" data-slot="ai-confirmation" className="p-2.5">
      <div className="text-xs font-medium">{title}</div>
      {detail ? <div className="mt-1 break-words text-[11.5px] text-muted-foreground">{detail}</div> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" disabled={!pending} onClick={onDeny}>
          拒绝
        </Button>
        <Button size="sm" disabled={!pending} onClick={onAllow}>
          允许
        </Button>
      </div>
    </Card>
  );
}
