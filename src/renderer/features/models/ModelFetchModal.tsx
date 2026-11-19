import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cleanModelId, flattenGroups, resolveChecked, type ModelGroup } from './ModelManager';

/**
 * features/models/ModelFetchModal.tsx — 「获取模型」弹窗：全量 + 勾选 + 全选/取消。
 *
 * 旧语义来源（只读消费）：
 * - renderFetchList §2507：弹窗渲染全量目录，checked = (!visible || visible.indexOf(mid)>=0)。
 * - batchFetchCheck §2441：只对显示中(display!=='none')的项逐个 applyFetchToggle。
 * - syncFetchCheckedStates §2431：菜单侧变化只同步勾选态，不重建列表、不丢搜索命中。
 * - getFetchVisible §2501：null=旧配置未落盘(全选)，[]=明确全不选。
 * - modelFetchOk §2583：确认即关闭（勾选直写为当前路径，无二次写回）。
 *
 * 与 J 的级联选择器对接契约：
 * - 本弹窗只经 props 收发：visibleIds / selectedIds / onChange，不改菜单、不碰 stores。
 * - 菜单仅显示已选由调用方按 visibleIds 过滤，本弹窗永远渲染全量。
 */

export interface ModelFetchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups?: ModelGroup[];
  visibleIds: string[] | null | undefined;
  selectedIds?: string[] | null | undefined;
  onChange: (nextVisibleIds: string[]) => void;
}

export function checkedOf(id: string, visible: string[] | null | undefined, allIds: string[]): boolean {
  if (!visible) return true;
  void allIds;
  return visible.indexOf(id) >= 0;
}

/**
 * batchFetchCheck 纯计算（供组件与用例复用）：
 * 仅对 shownIds 中勾选态与 want 不一致的项翻转，其余保持原样；返回全量 next。
 */
export function computeBatchFetchCheck(
  shownIds: string[],
  currentVisibleOrNull: string[] | null | undefined,
  allIds: string[],
  want: boolean,
): string[] {
  const base: string[] =
    Array.isArray(currentVisibleOrNull) ? currentVisibleOrNull.slice() : allIds.slice();
  const shownSet = new Set(shownIds.map(cleanModelId));
  if (want) {
    shownIds.forEach((raw) => {
      const id = cleanModelId(raw);
      if (id && shownSet.has(id) && base.indexOf(id) < 0) base.push(id);
    });
  } else {
    const next = base.filter((id) => !shownSet.has(cleanModelId(id)));
    return next;
  }
  return base;
}

export function ModelFetchModal({
  open,
  onOpenChange,
  groups = [],
  visibleIds,
  selectedIds,
  onChange,
}: ModelFetchModalProps) {
  const [query, setQuery] = React.useState('');
  const effectiveVisible = selectedIds !== undefined ? selectedIds : visibleIds;

  const all = React.useMemo(() => flattenGroups(groups), [groups]);
  const allIds = React.useMemo(() => all.map((m) => m.id), [all]);
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) => {
      const hay = `${m.id} ${m.name || ''} ${m.description || ''} ${(m.tags || []).join(' ')}`.toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }, [all, query]);
  const shownIds = React.useMemo(() => shown.map((m) => m.id), [shown]);

  const checkedCount = shown.filter((m) =>
    checkedOf(m.id, effectiveVisible, allIds),
  ).length;

  if (!open) return null;

  const toggleOne = (id: string, next: boolean) => {
    const base = Array.isArray(effectiveVisible) ? effectiveVisible.slice() : allIds.slice();
    const at = base.indexOf(id);
    if (next && at < 0) base.push(id);
    if (!next && at >= 0) base.splice(at, 1);
    onChange(base);
  };

  // 逐字沿用 batchFetchCheck：只处理显示中的项，且仅当 checked !== want 才翻转。
  const batchFetchCheck = (want: boolean) => {
    const next = computeBatchFetchCheck(shownIds, effectiveVisible, allIds, want);
    onChange(next);
  };

  return (
    <div data-testid="model-fetch-modal" role="dialog" aria-modal="true" className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/22" onClick={() => onOpenChange(false)} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">获取模型（全量目录勾选）</div>
            <Button size="default" variant="ghost" onClick={() => onOpenChange(false)} aria-label="关闭获取模型">
              关闭
            </Button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            弹窗展示全量目录；菜单仅显示已选由调用方按 visibleIds 过滤，本弹窗不改菜单。
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              className="h-8"
              placeholder="搜索模型（仅过滤显示，不改勾选）"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索全量模型"
            />
            <Button size="default" variant="outline" onClick={() => batchFetchCheck(true)}>
              全选
            </Button>
            <Button size="default" variant="outline" onClick={() => batchFetchCheck(false)}>
              取消全选
            </Button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground" data-testid="model-fetch-count">
            已选 {checkedCount} / {shown.length} 个（勾选即时生效）
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-md border border-border p-2">
            {shown.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {all.length === 0 ? '模型目录为空（请检查引擎 / API 配置后刷新）' : '无匹配模型'}
              </div>
            ) : (
              shown.map((m) => {
                const checked = resolveChecked(m.id, effectiveVisible);
                return (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 hover:bg-accent"
                    data-id={m.id}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => toggleOne(m.id, next)}
                      aria-label={`获取模型 ${m.id}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{m.name || m.id}</span>
                    {(m.tags || []).slice(0, 2).map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                    <span className="max-w-[40%] truncate font-mono text-[10px] text-muted-foreground">
                      {m.id}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="default" variant="outline" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
