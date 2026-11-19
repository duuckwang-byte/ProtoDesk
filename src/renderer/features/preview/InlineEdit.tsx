/**
 * src/renderer/features/preview/InlineEdit.tsx — 就地编辑条（文本替换 + 插入元素最小闭环）。
 *
 * 旧语义对齐（js/edit-entry.js INLINE_EDIT 只读参考）：
 * - 弹窗 id="inlineEditPop"，输入区 class="inline-edit-ta"，保存/放弃按钮；
 * - inlineEditTryClose：内容无变化直接关；有变化时 Esc 需二次确认
 *   （旧 askConfirm 模态框；缺失时保守不关）。本壳无 askConfirm 且 ui-store
 *   亦无 confirm API，故以条内二次确认条代替（绝不用原生弹窗）；
 * - inlineEditSave：无变化提示关闭；有变化写盘（失败转 AI 队列）。本壳只做最小闭环：
 *   文本替换（replace）/ 插入元素（insertAfter）两种模式 + esc 取消 / Ctrl+Enter 提交，
 *   落盘与队列由父组件 onSubmit 承接（W3-08 只入待提交队列，不直调大模型）；
 * - Ctrl+Shift+单击进代码编辑（就地改）与本条互斥：父组件在 INLINE_EDIT.open 时不进拾取（isPickDisabled inlineOpen）。
 */
import React, { useEffect, useRef, useState } from 'react';

export type InlineEditMode = 'replace' | 'insertAfter';

export interface InlineEditSubmitPayload {
  text: string;
  mode: InlineEditMode;
}

export interface InlineEditProps {
  open: boolean;
  /** 目标元素描述（如「确认提交」(button.ok)），沿用 editElementLabel 口径。 */
  targetLabel: string;
  initialText: string;
  /** 浮层锚点（页面坐标；缺省居中偏上）。 */
  anchor?: { left: number; top: number };
  onSubmit: (payload: InlineEditSubmitPayload) => void;
  onCancel: () => void;
}

var InlineEdit: React.FC<InlineEditProps> = function InlineEdit(props: InlineEditProps) {
  var [text, setText] = useState(props.initialText);
  var [mode, setMode] = useState<InlineEditMode>('replace');
  var [discardArmed, setDiscardArmed] = useState(false); // 条内二次确认条是否展开（有修改放弃时用，绝不用原生弹窗）
  var taRef = useRef<HTMLTextAreaElement | null>(null);
  var openAtRef = useRef(0);

  // 打开时重置（沿用 INLINE_EDIT.open/initText/openAt 口径；350ms 内误触不关由父组件处理）。
  useEffect(function () {
    if (props.open) {
      setText(props.initialText);
      setMode('replace');
      setDiscardArmed(false); // 重开即回到干净态：开/关成环，关时残留不带到下一次
      openAtRef.current = Date.now();
      var t = window.setTimeout(function () {
        try { if (taRef.current) taRef.current.focus(); } catch { /* ignore */ }
      }, 0);
      return function () { window.clearTimeout(t); };
    }
    return undefined;
  }, [props.open, props.initialText]);

  if (!props.open) return null;

  var dirty = text !== props.initialText;

  function requestCancel(): void {
    if (!dirty) {
      // 内容无变化，直接关闭（沿用 inlineEditTryClose 首分支）。
      setDiscardArmed(false);
      props.onCancel();
      return;
    }
    // 有修改时只展开条内二次确认条、等待用户抉择（沿用旧 askConfirm 语义；
    // ui-store 无 confirm API，绝不用原生弹窗；确认框不可用时旧逻辑保守不关，
    // 此处确认条常可用，故展开后 return 等用户点选）。
    setDiscardArmed(true);
  }

  function requestSubmit(): void {
    if (text === props.initialText) {
      props.onCancel(); // 内容无变化，直接关闭（沿用 inlineEditSave 首分支）。
      return;
    }
    props.onSubmit({ text: text, mode: mode });
  }

  function onKeyDown(ev: React.KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      if (discardArmed) {
        // 二次确认条已展开时再按 Esc：保守收起确认条、留在编辑态（沿用旧缺失分支不关）。
        setDiscardArmed(false);
        return;
      }
      requestCancel();
      return;
    }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault(); // Ctrl/Cmd+Enter 提交（沿用旧迭代语义）
      requestSubmit();
    }
  }

  const anchorStyle: React.CSSProperties = props.anchor
    ? { position: 'fixed', left: Math.max(8, Math.round(props.anchor.left)), top: Math.max(8, Math.round(props.anchor.top)) }
    : { position: 'fixed', left: '50%', top: '18%', transform: 'translateX(-50%)' };

  return (
    <div
      id="inlineEditPop"
      className="inline-edit-pop pointer-events-auto z-[70] flex w-[440px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
      data-testid="inline-edit"
      style={anchorStyle}
    >
      <div className="inline-edit-hd flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold">
        <span>{'修改 ' + props.targetLabel}</span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">Ctrl+Enter 保存 · Esc 放弃</span>
      </div>
      <div className="inline-edit-wrap relative flex flex-col gap-2 p-3">
        <div role="radiogroup" aria-label="编辑模式" className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="inline-edit-mode"
              value="replace"
              checked={mode === 'replace'}
              onChange={function () { setMode('replace'); }}
            />
            文本替换
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="inline-edit-mode"
              value="insertAfter"
              checked={mode === 'insertAfter'}
              onChange={function () { setMode('insertAfter'); }}
            />
            插入元素
          </label>
        </div>
        <textarea
          ref={taRef}
          className="inline-edit-ta min-h-24 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cobalt)]"
          data-testid="inline-edit-input"
          rows={4}
          spellCheck={false}
          value={text}
          onChange={function (ev) { setText(ev.target.value); }}
          onKeyDown={onKeyDown}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="inline-edit-btn inline-edit-incancel h-6 rounded-md border border-input bg-background px-2 text-[11px] hover:bg-accent"
            onClick={requestCancel}
          >
            放弃
          </button>
          <button
            type="button"
            className="inline-edit-btn primary inline-edit-insave h-6 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-[#27272a]"
            onClick={requestSubmit}
          >
            保存
          </button>
        </div>
        {discardArmed && dirty ? (
          <div className="inline-edit-discard flex flex-col gap-2 rounded-md border border-destructive/40 bg-[var(--rose-soft)] p-2" data-testid="inline-edit-discard">
            <span className="inline-edit-discard-msg text-[11px]">内容已修改，确定放弃本次就地改吗？</span>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="inline-edit-btn inline-edit-discard-back h-6 rounded-md border border-input bg-background px-2 text-[11px]"
                data-testid="inline-edit-discard-back"
                onClick={function () { setDiscardArmed(false); }}
              >
                继续编辑
              </button>
              <button
                type="button"
                className="inline-edit-btn danger inline-edit-discard-ok h-6 rounded-md bg-destructive px-2 text-[11px] text-destructive-foreground"
                data-testid="inline-edit-discard-ok"
                onClick={function () { setDiscardArmed(false); props.onCancel(); }}
              >
                放弃修改
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default InlineEdit;
