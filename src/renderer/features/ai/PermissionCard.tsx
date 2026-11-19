import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { permissionOptionId, permissionScopeKey } from './adapters';
import type { PermissionRequest } from './adapters';
import { getAiStore } from '@/stores/ai-store';

/**
 * PermissionCard：权限请求卡（Agent + uiSessionId 复合键归属，旧 permRequest 口径）。
 * - 卡面必带 agentId + uiSessionId 归属（复合键展示 + 状态机幂等）。
 * - 同意/拒绝/记住选择：记住时 decision 升级为 allow-always（旧 permDecide 口径）。
 * - 回执复用既有 ai:scope-confirm（kind:'acp-permission'），不新增通道。
 */
export function PermissionCard({
  payload,
  pending = true,
  onResolved,
}: {
  payload: PermissionRequest;
  pending?: boolean;
  onResolved?: (decision: 'allow-once' | 'allow-always' | 'deny') => void;
}) {
  const [remember, setRemember] = React.useState(false);
  const [state, setState] = React.useState<'pending' | 'allowed' | 'denied'>('pending');
  const scopeKey = permissionScopeKey(payload);
  const target = payload.command || payload.path || payload.title || '（未提供）';

  const decide = (decision: 'allow-once' | 'allow-always' | 'deny') => {
    if (!pending || state !== 'pending') return;
    const finalDecision = decision === 'allow-once' && remember ? 'allow-always' : decision;
    const optionId = permissionOptionId(payload, finalDecision);
    getAiStore().resolvePermission(payload.id, finalDecision, optionId || undefined);
    setState(finalDecision === 'deny' ? 'denied' : 'allowed');
    onResolved?.(finalDecision);
  };

  return (
    <Card
      data-testid="ai-permission-card"
      data-slot="ai-permission"
      data-permission-id={payload.id}
      data-agent-id={payload.agentId}
      data-ui-session-id={payload.uiSessionId}
      data-scope-key={scopeKey}
      className="p-2.5"
    >
      <div className="flex items-center gap-2">
        <Badge variant="outline">权限请求</Badge>
        <Badge variant="secondary">{payload.kind || '操作'}</Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {state === 'pending' ? '待处理' : state === 'allowed' ? '已允许' : '已拒绝'}
        </span>
      </div>
      <div className="mt-1.5 break-words text-xs">{payload.title}</div>
      <div className="mt-0.5 break-words font-mono text-[11.5px] text-muted-foreground">{target}</div>
      <div
        data-testid="ai-permission-scope"
        className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground"
        title={scopeKey}
      >
        Agent:{payload.agentId || '—'} · 会话:{payload.uiSessionId || payload.sessionId || '—'}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={!pending || state !== 'pending'} onClick={() => decide('deny')}>
          拒绝
        </Button>
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          记住选择
        </label>
        <Button size="sm" disabled={!pending || state !== 'pending'} className="ml-auto" onClick={() => decide(remember ? 'allow-always' : 'allow-once')}>
          允许一次
        </Button>
      </div>
    </Card>
  );
}
