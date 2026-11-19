/**
 * components/overlays/SnapshotPanel.tsx — 快照列表/恢复（Wave 2-L；W3-08 修 C4/C5）。
 *
 * 通道只读消费：features/snapshot/SnapshotStore（snapshot.list/restore）。
 * - C4：列表读 `{items:[{ts}]}`，条目以 `ts` 为唯一标识；
 * - C5：恢复发 `{dir, ts}`（不是 `{dir,id}`）；
 * - 列表读取/恢复成功/恢复失败均 toast；恢复为 destructive，必须先经 Confirm。
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useUiStore } from "@/stores/ui-store";
import {
  listSnapshots,
  restoreSnapshot,
  snapshotTimeText,
  type SnapshotItem,
} from "@/features/snapshot/SnapshotStore";
import { Confirm } from "./Confirm";

export interface SnapshotPanelProps {
  /** 当前原型沙箱目录（空串 = 不请求）。 */
  dir: string;
  /** 外部已加载列表（传入时不再自动读 IPC；仍保留手动刷新）。 */
  items?: SnapshotItem[];
  onRestored?: () => void;
  onClose?: () => void;
}

/** 快照面板：列表 + 恢复（恢复经 Confirm，覆盖当前内容）。 */
export function SnapshotPanel({ dir, items, onRestored, onClose }: SnapshotPanelProps) {
  const [list, setList] = React.useState<SnapshotItem[]>(items ?? []);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [pendingTs, setPendingTs] = React.useState<string | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const pushToast = useUiStore((s) => s.pushToast);

  const refresh = React.useCallback(
    async (manual?: boolean) => {
      if (items) {
        setList(items);
        if (manual) pushToast({ title: `快照列表已更新：${items.length} 个。` });
        return;
      }
      if (!dir) {
        setList([]);
        return;
      }
      setLoading(true);
      try {
        const r = await listSnapshots(dir);
        if (r.ok) {
          setList(r.list);
          if (manual) pushToast({ title: `快照列表已更新：${r.list.length} 个。` });
        } else {
          pushToast({ title: `快照列表读取失败：${r.error || "未知错误"}` });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushToast({ title: `快照列表读取失败：${msg || "未知错误"}` });
      } finally {
        setLoading(false);
      }
    },
    [dir, items, pushToast],
  );

  React.useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const shown = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) => s.name.toLowerCase().includes(q) || s.ts.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  }, [list, filter]);

  const pending = pendingTs ? list.find((s) => s.ts === pendingTs) ?? null : null;

  const doRestore = React.useCallback(async () => {
    if (!pendingTs) return;
    setRestoring(true);
    try {
      const r = await restoreSnapshot(dir, pendingTs);
      if (r.ok) {
        pushToast({ title: "已恢复快照。", description: pendingTs });
        await refresh(false);
        onRestored?.();
      } else {
        pushToast({ title: `快照恢复失败：${r.error || "未知错误"}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast({ title: `快照恢复失败：${msg || "未知错误"}` });
    } finally {
      setRestoring(false);
      setPendingTs(null);
    }
  }, [dir, pendingTs, pushToast, refresh, onRestored]);

  return (
    <div data-testid="snapshot-panel" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">快照</span>
        <Badge variant="outline" data-testid="snapshot-count">
          {list.length}
        </Badge>
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh(true)}>
          {loading ? "读取中…" : "刷新"}
        </Button>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        ) : null}
      </div>
      <Input
        data-testid="snapshot-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="筛选快照…"
        className="h-8"
      />
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          {loading ? "正在读取快照…" : "暂无快照。提交/发布前会自动创建快照用于回滚。"}
        </div>
      ) : (
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto" data-testid="snapshot-list">
          {shown.map((s) => (
            <div
              key={s.ts}
              data-testid="snapshot-item"
              data-snapshot-ts={s.ts}
              className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{s.label || s.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground" title={s.ts}>
                  {s.ts} · {snapshotTimeText(s)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid="snapshot-restore"
                onClick={() => setPendingTs(s.ts)}
              >
                恢复
              </Button>
            </div>
          ))}
        </div>
      )}
      <Confirm
        open={pendingTs !== null}
        onOpenChange={(next) => !restoring && !next && setPendingTs(null)}
        title="恢复快照"
        description={
          pending
            ? `确定恢复到快照「${pending.label || pending.name}」（${pending.ts}）吗？当前未提交的修改将被覆盖。`
            : `确定恢复到快照 ${pendingTs || ""} 吗？当前未提交的修改将被覆盖。`
        }
        confirmText="恢复"
        loading={restoring}
        onConfirm={doRestore}
      />
    </div>
  );
}

export default SnapshotPanel;
