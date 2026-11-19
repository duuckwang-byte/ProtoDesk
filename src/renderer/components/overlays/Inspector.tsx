/**
 * components/overlays/Inspector.tsx — 检查器卡片（Wave 2-L）。
 * 方案 §8.4：Sheet 形态（非 AI 对话）；三板块：修改需求 / 跳转交互 / 需求标注，
 * 首板块默认展开。destructive 操作（删除跳转/删除标注）经 Confirm 确认；
 * 通知走 sonner toast，禁原生弹窗。
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useUiStore } from "@/stores/ui-store";
import { Confirm } from "./Confirm";

export interface InspectorTargetOption {
  /** 目标原型展示名（写入 LinkItem.target）。 */
  name: string;
  /** 可跳转子页面（value 写入 LinkItem.targetPage，通常是 .html 文件名）。 */
  pages?: Array<{ value: string; label: string }>;
}

export interface InspectorFoldState {
  jump?: boolean;
  req?: boolean;
  anno?: boolean;
}

export interface InspectorProps {
  selector: string;
  page: string;
  label?: string;
  text?: string;
  tagName?: string;
  /** 元素所属 html 文件（W3-08 三键展示）。 */
  htmlFile?: string;
  /** 修改需求草稿（来自待提交队列同 selector+page 条目）。 */
  draft?: string;
  /** 已绑定跳转目标展示。 */
  boundTarget?: string;
  boundTargetPage?: string;
  isBound?: boolean;
  /** 需求标注现状。 */
  annoContent?: string;
  hasAnno?: boolean;
  /** 可选目标原型（来自 sources-store；提供时渲染下拉，避免自由输入拼错）。 */
  targetOptions?: InspectorTargetOption[];
  /** 三板块折叠态（来自 storage-keys LINK_INSP_FOLD；缺省走默认值）。 */
  fold?: InspectorFoldState;
  onFoldChange?: (section: "jump" | "req" | "anno", open: boolean) => void;
  onAddRequirement?: (text: string) => void;
  onStartJumpSelect?: () => void;
  onSaveJump?: (target: string, targetPage: string) => void | Promise<void>;
  onRemoveJump?: () => void | Promise<void>;
  onSaveAnno?: (content: string) => void | Promise<void>;
  onDeleteAnno?: () => void | Promise<void>;
}

/** 检查器卡片：修改需求 / 跳转交互 / 需求标注三板块，首板块默认展开。 */
export function Inspector({
  selector,
  page,
  label,
  text,
  tagName,
  htmlFile = "",
  draft = "",
  boundTarget = "",
  boundTargetPage = "",
  isBound = false,
  annoContent = "",
  hasAnno = false,
  targetOptions,
  fold,
  onFoldChange,
  onAddRequirement,
  onStartJumpSelect,
  onSaveJump,
  onRemoveJump,
  onSaveAnno,
  onDeleteAnno,
}: InspectorProps) {
  const [reqText, setReqText] = React.useState(draft);
  const [jumpTarget, setJumpTarget] = React.useState(boundTarget);
  const [jumpPage, setJumpPage] = React.useState(boundTargetPage);
  /** 已绑定态的「更换目标」编辑态：true 时渲染与未绑定态相同的目标选择器。 */
  const [jumpEditing, setJumpEditing] = React.useState(false);
  const [annoText, setAnnoText] = React.useState(annoContent);
  const [confirmKind, setConfirmKind] = React.useState<"jump" | "anno" | null>(null);
  const targetSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const targetInputRef = React.useRef<HTMLInputElement | null>(null);
  const pushToast = useUiStore((s) => s.pushToast);

  React.useEffect(() => setReqText(draft), [draft]);
  React.useEffect(() => setAnnoText(annoContent), [annoContent]);
  React.useEffect(() => {
    // 切换选中元素或绑定结果变化时，退出「更换目标」编辑态并回填已保存值。
    setJumpEditing(false);
    setJumpTarget(boundTarget);
    setJumpPage(boundTargetPage);
  }, [selector, boundTarget, boundTargetPage]);

  // 进入「更换目标」后把焦点交给目标选择器，键盘用户可直接改选。
  React.useEffect(() => {
    if (!jumpEditing) return;
    const timer = window.setTimeout(() => {
      (targetSelectRef.current || targetInputRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [jumpEditing]);

  const pageOptions = React.useMemo(() => {
    if (!targetOptions || !jumpTarget) return [];
    const hit = targetOptions.find((o) => o.name === jumpTarget);
    return hit && Array.isArray(hit.pages) ? hit.pages : [];
  }, [targetOptions, jumpTarget]);

  const focusTargetPicker = () => {
    onStartJumpSelect?.();
    try {
      (targetSelectRef.current || targetInputRef.current)?.focus();
    } catch {
      // 忽略：无下拉时仅走外部回调。
    }
  };

  /** 已绑定态点击「更换目标」：切到真实编辑态（下拉/输入 + 保存/取消）。 */
  const startJumpEdit = () => {
    setJumpEditing(true);
    onStartJumpSelect?.();
  };

  /** 取消更换：丢弃本地选择并回到已绑定展示，不调用 onSaveJump（不写盘）。 */
  const cancelJumpEdit = () => {
    setJumpEditing(false);
    setJumpTarget(boundTarget);
    setJumpPage(boundTargetPage);
  };

  const saveJump = () => {
    if (!jumpTarget.trim()) {
      pushToast({ title: "请先选择跳转目标原型。" });
      return;
    }
    onSaveJump?.(jumpTarget.trim(), jumpPage.trim());
  };

  const submitReq = () => {
    const v = reqText.trim();
    if (!v) {
      pushToast({ title: "请先输入要调整的内容。" });
      return;
    }
    onAddRequirement?.(v);
    setReqText("");
  };

  /** 目标选择器（未绑定态与已绑定「更换目标」编辑态共用同一套下拉/输入）。 */
  const jumpEditor = (
    <>
      {targetOptions && targetOptions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <select
            ref={targetSelectRef}
            data-testid="inspector-jump-target-pick"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
            value={jumpTarget}
            onChange={(e) => {
              setJumpTarget(e.target.value);
              setJumpPage("");
            }}
            aria-label="选择目标原型"
          >
            <option value="">选择目标原型…</option>
            {targetOptions.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
          {pageOptions.length > 0 ? (
            <select
              data-testid="inspector-jump-page-pick"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              aria-label="选择目标子页面"
            >
              <option value="">打开主页</option>
              {pageOptions.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <input
          ref={targetInputRef}
          data-testid="inspector-jump-target"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
          value={jumpTarget}
          onChange={(e) => setJumpTarget(e.target.value)}
          placeholder="目标原型（展示名）"
        />
        <input
          data-testid="inspector-jump-page"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
          value={jumpPage}
          onChange={(e) => setJumpPage(e.target.value)}
          placeholder="目标子页面（可空，空=打开主页）"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" data-testid="inspector-jump-save" onClick={saveJump}>
          保存绑定
        </Button>
        {isBound ? (
          <Button size="sm" variant="outline" data-testid="inspector-jump-cancel" onClick={cancelJumpEdit}>
            取消
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={focusTargetPicker}>
            从列表选择
          </Button>
        )}
      </div>
    </>
  );

  return (
    <div data-testid="inspector" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold">
          {label || text || "元素"}
          {tagName ? <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">{tagName}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="break-all">{selector}</span>
          <Badge variant="outline">页面: {page || "首页"}</Badge>
          {htmlFile ? (
            <Badge variant="outline" className="max-w-full truncate" title={htmlFile}>
              文件: {htmlFile}
            </Badge>
          ) : null}
        </div>
      </div>

      <Collapsible
        defaultOpen={fold?.req ?? true}
        onOpenChange={(open) => onFoldChange?.("req", open)}
        data-testid="inspector-sec-req"
        className="rounded-lg border border-border"
      >
        <div className="px-3 py-2">
          <CollapsibleTrigger className="text-[13px] font-semibold">修改需求</CollapsibleTrigger>
        </div>
        <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
          <Textarea
            data-testid="inspector-req-input"
            value={reqText}
            onChange={(e) => setReqText(e.target.value)}
            placeholder="描述要调整的内容，加入待提交队列统一提交…"
            rows={3}
          />
          <div>
            <Button size="sm" data-testid="inspector-req-add" onClick={submitReq}>
              加入待提交
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        defaultOpen={fold?.jump ?? isBound}
        onOpenChange={(open) => onFoldChange?.("jump", open)}
        data-testid="inspector-sec-jump"
        className="rounded-lg border border-border"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <CollapsibleTrigger className="text-[13px] font-semibold">跳转交互</CollapsibleTrigger>
          <span className="ml-auto" data-testid="inspector-jump-state">
            {isBound ? <Badge>已绑定</Badge> : <Badge variant="outline">未绑定</Badge>}
          </span>
        </div>
        <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
          {isBound ? (
            <>
              <div className="text-xs text-muted-foreground" data-testid="inspector-jump-bound-to">
                跳转至：<span className="text-foreground">{boundTarget}</span>
                {boundTargetPage ? <span> · {boundTargetPage}</span> : null}
              </div>
              {jumpEditing ? (
                <>
                  {jumpEditor}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid="inspector-jump-remove"
                      onClick={() => setConfirmKind("jump")}
                    >
                      删除绑定
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" data-testid="inspector-jump-change" onClick={startJumpEdit}>
                    更换目标
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    data-testid="inspector-jump-remove"
                    onClick={() => setConfirmKind("jump")}
                  >
                    删除绑定
                  </Button>
                </div>
              )}
            </>
          ) : (
            jumpEditor
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        defaultOpen={fold?.anno ?? hasAnno}
        onOpenChange={(open) => onFoldChange?.("anno", open)}
        data-testid="inspector-sec-anno"
        className="rounded-lg border border-border"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <CollapsibleTrigger className="text-[13px] font-semibold">需求标注</CollapsibleTrigger>
          <span className="ml-auto" data-testid="inspector-anno-state">
            {hasAnno ? <Badge>已标注</Badge> : <Badge variant="outline">未标注</Badge>}
          </span>
        </div>
        <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
          <Textarea
            data-testid="inspector-anno-input"
            value={annoText}
            onChange={(e) => setAnnoText(e.target.value)}
            placeholder="补充该元素的业务说明…"
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="inspector-anno-save"
              onClick={() => {
                if (!annoText.trim()) {
                  pushToast({ title: "请输入标注内容。" });
                  return;
                }
                onSaveAnno?.(annoText.trim());
              }}
            >
              保存标注
            </Button>
            {hasAnno ? (
              <Button size="sm" variant="destructive" data-testid="inspector-anno-delete" onClick={() => setConfirmKind("anno")}>
                删除标注
              </Button>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Confirm
        open={confirmKind !== null}
        onOpenChange={(next) => !next && setConfirmKind(null)}
        title={confirmKind === "jump" ? "删除跳转绑定" : "删除标注"}
        description={confirmKind === "jump" ? "确定删除该元素的跳转绑定吗？" : "确定删除该元素的需求标注吗？"}
        confirmText="删除"
        onConfirm={async () => {
          if (confirmKind === "jump") await onRemoveJump?.();
          else await onDeleteAnno?.();
          setConfirmKind(null);
        }}
      />
    </div>
  );
}

export default Inspector;
