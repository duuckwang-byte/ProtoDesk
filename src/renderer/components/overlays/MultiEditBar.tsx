/**
 * components/overlays/MultiEditBar.tsx — 待提交常驻入口（Wave 2-L）。
 * 旧语义：edit-entry.js EDIT_QUEUE（{selector,page,text} + sel!==false 即选中默认全选、
 * edit_queue_v1 持久化、清空走 askConfirm）。本实现：有队列才显示（空队列返回 null）；
 * 清空与单条移除均为 destructive，经 Confirm；通知走 toast。
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useUiStore } from "@/stores/ui-store";
import { Confirm } from "./Confirm";

/** 待提交条目（沿用 EDIT_QUEUE 字段口径，selected 缺省视为选中）。 */
export interface EditQueueItem {
  id: string;
  selector: string;
  page: string;
  /** 元素所属 html 文件（W3-08 三键；旧存量可缺省）。 */
  htmlFile?: string;
  text: string;
  tagName?: string;
  selected?: boolean;
}

export interface MultiEditBarProps {
  queue: EditQueueItem[];
  submitting?: boolean;
  onToggle?: (id: string, selected: boolean) => void;
  onRemove?: (id: string) => void;
  onClear?: () => void;
  onSubmit?: () => void;
  onOpen?: () => void;
}

/** 待提交常驻入口：空队列不渲染；选中默认全选；清空/移除经 Confirm。 */
export function MultiEditBar({ queue, submitting = false, onToggle, onRemove, onClear, onSubmit, onOpen }: MultiEditBarProps) {
  const [confirm, setConfirm] = React.useState<{ kind: "clear" | "remove"; id?: string } | null>(null);
  const pushToast = useUiStore((s) => s.pushToast);
  if (!queue || queue.length === 0) return null;

  const selectedCount = queue.filter((q) => q.selected !== false).length;

  return (
    <div
      data-testid="multi-edit-bar"
      // 定位口径：inset-x-0 + mx-auto + w-fit 居中，刻意不用 left-1/2 + -translate-x-1/2。
      // transform 会建立 containing block，使条内 fixed 弹层（Confirm）相对 72px 高的条定位而被裁切。
      className="pointer-events-auto fixed inset-x-0 bottom-3 z-40 mx-auto flex w-fit max-w-[min(720px,calc(100vw-2rem))] items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-lg"
    >
      <button
        type="button"
        data-testid="multi-edit-open"
        onClick={() => onOpen?.()}
        className="flex items-center gap-2 text-left outline-none"
        title="打开待提交列表"
      >
        <Badge data-testid="multi-edit-count">{queue.length}</Badge>
        <span className="whitespace-nowrap text-xs font-medium">待提交{selectedCount > 0 ? `（已选 ${selectedCount}）` : ""}</span>
      </button>
      <span className="mx-1 h-5 w-px bg-border" />
      <div className="hidden max-w-64 items-center gap-1.5 overflow-x-auto sm:flex" data-testid="multi-edit-preview">
        {queue.slice(0, 3).map((q) => (
          <span key={q.id} className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
            <Checkbox checked={q.selected !== false} onCheckedChange={(v) => onToggle?.(q.id, v)} aria-label="选中该条" />
            <span className="max-w-28 truncate" title={q.selector}>
              {q.text || q.selector}
            </span>
            <button
              type="button"
              data-testid="multi-edit-remove"
              data-queue-id={q.id}
              aria-label="移除该条待提交"
              title="移除该条"
              className="rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setConfirm({ kind: "remove", id: q.id })}
            >
              ×
            </button>
          </span>
        ))}
        {queue.length > 3 ? <span className="text-[11px] text-muted-foreground">…</span> : null}
      </div>
      <span className="ml-auto" />
      <Button size="sm" data-testid="multi-edit-submit" disabled={submitting || selectedCount === 0} onClick={() => onSubmit?.()}>
        {submitting ? "提交中…" : `提交${selectedCount > 0 ? `（${selectedCount}）` : ""}`}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="multi-edit-clear"
        onClick={() => setConfirm({ kind: "clear" })}
      >
        清空
      </Button>

      <Confirm
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={confirm?.kind === "clear" ? "清空待提交" : "移除待提交项"}
        description={
          confirm?.kind === "clear"
            ? `清空全部 ${queue.length} 条待提交修改？`
            : "确定移除该条待提交修改吗？"
        }
        confirmText={confirm?.kind === "clear" ? "清空" : "移除"}
        onConfirm={() => {
          if (confirm?.kind === "clear") {
            onClear?.();
            pushToast({ title: "已清空待提交列表。" });
          } else if (confirm?.id) {
            onRemove?.(confirm.id);
            pushToast({ title: "已移除该条待提交。" });
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}

export default MultiEditBar;
