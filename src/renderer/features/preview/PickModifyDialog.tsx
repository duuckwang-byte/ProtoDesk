/**
 * src/renderer/features/preview/PickModifyDialog.tsx — Ctrl/Cmd+Shift 拾取后的唯一「修改文字」弹窗。
 *
 * 交互口径：
 * - 只在松开 Ctrl/Cmd（或 Shift）后打开，目标是最后点击的 1 个元素（不支持多选）；
 * - 展示 tag / selector / 当前文本，textarea 预填当前文本；
 * - 「保存到代码」= 直接改写源 HTML（读文件 → DOMParser 定位元素 → 替换 textContent → 写盘），
 *   **绝不入待提交队列、绝不转 AI**；内容未变化时直接关闭、不写盘；取消不写；
 * - 保存失败（空文本 / selector 无效 / 读取失败 / 解析失败 / 写盘失败）时保留弹窗并就地显示错误；
 * - 关闭走 @/components/ui/dialog：DialogContent 只登记 registerOverlayLayer，不自行监听 Esc，
 *   Esc 由 MainWindow 的全局 Esc 栈单入口关闭，避免一次 Esc 同时关两层；
 * - 打开时焦点进入 textarea（Ctrl/Cmd+Enter 保存，Esc 交给全局栈）。
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

/** 「保存到代码」结果：ok=false 时宿主带回具体错误，弹窗保留并就地显示。 */
export interface PickModifySaveResult {
  ok: boolean;
  error?: string;
}

export interface PickModifyDialogProps {
  open: boolean;
  element: PreviewPickedElement | null;
  /** 直接写盘（宿主实现）；ok=false 时弹窗不关闭并显示 error。 */
  onSubmit: (text: string) => PickModifySaveResult | Promise<PickModifySaveResult>;
  onCancel: () => void;
}

export function PickModifyDialog({
  open,
  element,
  onSubmit,
  onCancel,
}: PickModifyDialogProps): React.ReactElement | null {
  const [text, setText] = React.useState(() => (element ? element.text : ''));
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const mountedRef = React.useRef(true);
  const savingRef = React.useRef(false);
  // 稳定引用：避免 DialogContent 的 registerOverlayLayer effect 随每次输入重注册。
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) onCancel();
    },
    [onCancel]
  );

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 宿主按拾取请求挂载/卸载本组件，首次挂载即回填当前文本；打开后把焦点送进输入框。
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

  const focusInput = (): void => {
    try {
      taRef.current?.focus();
    } catch {
      // 忽略。
    }
  };

  const submit = async (): Promise<void> => {
    if (savingRef.current) return;
    const value = text.trim();
    if (!value) {
      setError('请输入修改后的文本。');
      focusInput();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await onSubmit(value);
      if (!mountedRef.current) return;
      if (result && result.ok === false) {
        setError(result.error || '保存到代码失败，请重试。');
        focusInput();
      }
      // ok=true 时由宿主关闭弹窗（成功 / 内容未变化），这里不再改动状态。
    } catch (err) {
      if (!mountedRef.current) return;
      setError((err instanceof Error && err.message) || '保存到代码失败，请重试。');
      focusInput();
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="pick-modify-dialog" className="pointer-events-auto max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>修改文字</DialogTitle>
          <DialogDescription>
            直接改写源 HTML：把该元素内容替换为新文本（保留元素与属性），保存后立即刷新预览，不进入待提交队列。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-secondary/40 p-2.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">标签</span>
            <Badge variant="outline" data-testid="pick-modify-tag" className="font-mono text-[10px]">
              {element.tagName || 'element'}
            </Badge>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">选择器</span>
            <span
              data-testid="pick-modify-selector"
              className="break-all font-mono text-[10px] text-foreground"
              title={element.selector}
            >
              {element.selector || '（无稳定选择器）'}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">当前文本</span>
            <span data-testid="pick-modify-current" className="whitespace-pre-wrap break-all text-foreground">
              {element.text || '（无文本）'}
            </span>
          </div>
        </div>

        <Textarea
          ref={taRef}
          data-testid="pick-modify-input"
          className="mt-3 min-h-24 font-mono"
          rows={4}
          value={text}
          placeholder="输入修改后的文本…"
          disabled={saving}
          onChange={(ev) => {
            setText(ev.target.value);
            if (error) setError('');
          }}
          onKeyDown={onKeyDown}
        />
        {error ? (
          <div data-testid="pick-modify-error" className="mt-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" data-testid="pick-modify-cancel" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button data-testid="pick-modify-save" onClick={() => void submit()} disabled={saving}>
            {saving ? '保存中…' : '保存到代码'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PickModifyDialog;
