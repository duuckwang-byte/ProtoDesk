/**
 * src/renderer/features/preview/PickRequirementDialog.tsx — 「需求输入」弹窗（已停用）。
 *
 * @deprecated Ctrl/Cmd 拾取不再逐次弹窗：松开修饰键后统一走底部 PickComposer。
 * 本文件保留仅为历史实现参考，PreviewOverlaysHost 不再 import/渲染。
 *
 * 交互口径：
 * - 由 PreviewOverlaysHost 消费 Stage 的拾取请求后打开，展示元素 tag / selector / 文本摘要；
 * - 只收集需求文本，提交由宿主复用待提交队列 enqueue，取消不写；
 * - 关闭走 @/components/ui/dialog：DialogContent 只登记 registerOverlayLayer，不自行监听 Esc，
 *   Esc 由 MainWindow 的全局 Esc 栈单入口关闭，避免一次 Esc 同时关两层；
 * - 打开时焦点进入 textarea（Ctrl/Cmd+Enter 提交，Esc 交给全局栈）。
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { PreviewPickedElement } from './PreviewFrame';

export interface PickRequirementDialogProps {
  open: boolean;
  element: PreviewPickedElement | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

/** 元素文本摘要（空文本回 tagName，避免弹窗出现空白目标行）。 */
function elementSummary(element: PreviewPickedElement | null): string {
  if (!element) return '';
  return element.text || element.tagName || '元素';
}

export function PickRequirementDialog({
  open,
  element,
  onSubmit,
  onCancel,
}: PickRequirementDialogProps): React.ReactElement | null {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState('');
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  // 稳定引用：避免 DialogContent 的 registerOverlayLayer effect 随每次输入重注册。
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) onCancel();
    },
    [onCancel]
  );

  // 宿主按拾取请求挂载/卸载本组件，首次挂载即干净态；打开后把焦点送进输入框。
  React.useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      try {
        taRef.current?.focus();
      } catch {
        // 忽略：节点已卸载时无需聚焦。
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open || !element) return null;

  const submit = (): void => {
    const value = text.trim();
    if (!value) {
      setError('请输入需求内容。');
      try {
        taRef.current?.focus();
      } catch {
        // 忽略。
      }
      return;
    }
    onSubmit(value);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="pick-requirement-dialog" className="pointer-events-auto max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>需求输入</DialogTitle>
          <DialogDescription>Ctrl/Cmd+点击的元素；提交后只加入待提交队列。</DialogDescription>
        </DialogHeader>

        <div
          data-testid="pick-requirement-target"
          className="mt-3 flex flex-col gap-1 rounded-md border border-border bg-secondary/40 p-2.5"
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
              {element.tagName || 'element'}
            </Badge>
            <span className="truncate text-xs font-medium" data-testid="pick-requirement-text">
              {elementSummary(element)}
            </span>
          </div>
          <div
            data-testid="pick-requirement-selector"
            className="break-all font-mono text-[10px] text-muted-foreground"
            title={element.selector}
          >
            {element.selector || '（无稳定选择器）'}
          </div>
        </div>

        <Textarea
          ref={taRef}
          data-testid="pick-requirement-input"
          className="mt-3 min-h-24"
          rows={4}
          value={text}
          placeholder="描述要调整的内容…"
          onChange={(ev) => {
            setText(ev.target.value);
            if (error) setError('');
          }}
          onKeyDown={onKeyDown}
        />
        {error ? (
          <div data-testid="pick-requirement-error" className="mt-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" data-testid="pick-requirement-cancel" onClick={onCancel}>
            取消
          </Button>
          <Button data-testid="pick-requirement-submit" onClick={submit}>
            加入待提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PickRequirementDialog;
