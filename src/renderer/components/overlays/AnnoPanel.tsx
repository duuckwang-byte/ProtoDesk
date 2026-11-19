/**
 * components/overlays/AnnoPanel.tsx — 标注面板（Wave 2-L）。
 * 旧语义：annotation-core.js renderAnnoMgrList（按页分组、固定编号=全量创建序、
 * 删除走 askConfirm）。本实现：分组 + 编号 + 定位 + 删除经 Confirm；通知走 toast。
 *
 * 收敛口径（本轮）：
 * - 点击标注项只定位高亮元素，不打开/切换到三栏检查器 Sheet；
 * - 每条标注在当前面板内直接显示输入框，可直接修改内容并保存（onSave(id, content) 走 saveAnnos）；
 * - 空内容不允许保存（还原原值并就地提示）；
 * - 保留角标显隐开关与删除 Confirm。
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useUiStore } from "@/stores/ui-store";
import { annoColorOf, annoNumberOf, groupAnnosByPage, type AnnoItem } from "@/features/annotations/AnnoStore";
import { Confirm } from "./Confirm";

export interface AnnoPanelProps {
  items: AnnoItem[];
  /** 标注角标显隐（storage-keys 常量 PROTO_ANNO_VISIBLE 的受控值；不传则不渲染开关）。 */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  /** 定位：只高亮元素，不切换弹窗。 */
  onLocate?: (anno: AnnoItem) => void;
  /** 当前正在定位高亮的标注 id（用于列表内高亮提示）。 */
  locatedId?: string | null;
  /** 当前面板内直接保存标注内容；返回 false 表示保存失败（面板不重复成功 toast）。 */
  onSave?: (id: string, content: string) => void | boolean | Promise<void | boolean>;
  /** 返回 false 表示保存失败（面板不再重复成功 toast）。 */
  onDelete?: (id: string) => void | boolean | Promise<void | boolean>;
  onClose?: () => void;
}

/** 单条标注的内联编辑器：失焦 / Ctrl+Enter 保存，Esc 还原，空内容不保存。 */
function AnnoContentEditor({ anno, onSave }: { anno: AnnoItem; onSave?: AnnoPanelProps["onSave"] }) {
  const [draft, setDraft] = React.useState(anno.content);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const savingRef = React.useRef(false);
  const dirty = draft.trim() !== (anno.content || "").trim();

  React.useEffect(() => {
    setDraft(anno.content);
    setError("");
  }, [anno.id, anno.content]);

  const commit = async (): Promise<void> => {
    if (!onSave || savingRef.current) return;
    const value = draft.trim();
    if (!value) {
      setDraft(anno.content);
      setError("标注内容不能为空，已还原。");
      return;
    }
    if (value === (anno.content || "").trim()) {
      setDraft(anno.content);
      setError("");
      return;
    }
    savingRef.current = true;
    setBusy(true);
    try {
      const r = await onSave(anno.id, value);
      if (r === false) {
        setError("保存失败，请重试。");
        return;
      }
      setDraft(value);
      setError("");
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-1" data-testid="anno-panel-editor" data-anno-id={anno.id}>
      <textarea
        data-testid="anno-panel-input"
        data-anno-id={anno.id}
        aria-label="标注内容"
        rows={2}
        value={draft}
        readOnly={!onSave}
        placeholder="输入标注内容…"
        className="min-h-12 w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cobalt)]"
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError("");
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // 只还原本条标注，不冒泡去关闭 Sheet / 全局弹层。
            e.preventDefault();
            e.stopPropagation();
            setDraft(anno.content);
            setError("");
            e.currentTarget.blur();
            return;
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void commit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {error ? (
          <span data-testid="anno-panel-error" className="text-[11px] text-destructive">
            {error}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">失焦 / Ctrl+Enter 保存，Esc 取消</span>
        )}
        <span className="ml-auto" />
        <Button
          size="sm"
          data-testid="anno-panel-save"
          disabled={!onSave || busy || !dirty}
          onClick={() => void commit()}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

/** 标注面板：按页分组展示，固定编号，当前面板内直接编辑，删除经 Confirm 确认。 */
export function AnnoPanel({
  items,
  visible,
  onVisibleChange,
  onLocate,
  locatedId,
  onSave,
  onDelete,
  onClose,
}: AnnoPanelProps) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const groups = React.useMemo(() => groupAnnosByPage(items), [items]);
  const pending = pendingId ? items.find((a) => a.id === pendingId) ?? null : null;

  return (
    <div data-testid="anno-panel" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">需求标注</span>
        <Badge variant="outline" data-testid="anno-panel-count">
          {items.length}
        </Badge>
        <span className="ml-auto" />
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        ) : null}
      </div>
      {onVisibleChange ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
          <span className="text-xs text-muted-foreground">原型标注角标</span>
          <span className="ml-auto" />
          <Switch
            data-testid="anno-visible-switch"
            checked={visible !== false}
            onCheckedChange={(v) => onVisibleChange(v)}
            aria-label="显示或隐藏原型标注角标"
          />
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
          当前原型暂无需求标注。
          <br />
          按住 Ctrl 点击原型元素，在当前面板直接输入标注说明。
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.page} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {g.page}（{g.items.length}）
            </h4>
            {g.items.map((a) => {
              const no = annoNumberOf(items, a.id);
              const color = annoColorOf(a);
              const located = locatedId === a.id;
              return (
                <div
                  key={a.id}
                  data-testid="anno-panel-item"
                  data-anno-id={a.id}
                  data-anno-selector={a.selector}
                  data-located={located ? "1" : undefined}
                  title={a.selector}
                  onClick={(e) => {
                    const el = e.target as HTMLElement | null;
                    if (el?.closest("textarea,button")) return;
                    onLocate?.(a);
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 text-left transition-colors ${
                    located
                      ? "border-[var(--cobalt)] bg-accent ring-1 ring-[var(--cobalt)]"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={{ background: color.bg, color: color.fg }}
                    >
                      {no}
                    </span>
                    <span
                      className="truncate text-[11px] text-muted-foreground"
                      title={`${a.htmlFile || ""} · ${a.page || "首页"}`}
                    >
                      {a.htmlFile || "当前文件"} · {a.page || "首页"}
                    </span>
                    <span className="ml-auto" />
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="anno-panel-locate"
                      aria-label="定位此标注"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLocate?.(a);
                      }}
                    >
                      定位
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="anno-panel-delete"
                      aria-label="删除此标注"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingId(a.id);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{a.selector}</div>
                  <AnnoContentEditor anno={a} onSave={onSave} />
                </div>
              );
            })}
          </section>
        ))
      )}
      <Confirm
        open={pendingId !== null}
        onOpenChange={(next) => !deleting && !next && setPendingId(null)}
        title="删除标注"
        description={pending ? `确定删除标注「${(pending.content || "").slice(0, 24) || "需求标注"}」吗？` : "确定删除该标注吗？"}
        confirmText="删除"
        loading={deleting}
        onConfirm={async () => {
          if (!pendingId) return;
          setDeleting(true);
          try {
            const r = await onDelete?.(pendingId);
            if (r !== false) pushToast({ title: "已删除需求标注。" });
          } finally {
            setDeleting(false);
            setPendingId(null);
          }
        }}
      />
    </div>
  );
}

export default AnnoPanel;
