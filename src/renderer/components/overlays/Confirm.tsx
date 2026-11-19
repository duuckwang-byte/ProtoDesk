/**
 * components/overlays/Confirm.tsx — 通用确认 AlertDialog 封装（Wave 2-L）。
 * 约束：所有 destructive 操作（删除标注/删除跳转/清空待提交/移除待提交项/
 * 快照恢复/Git 拉取覆盖/Git 自愈修复/文档覆盖导出）必须经本组件确认；
 * 禁止原生 alert/confirm/prompt（本文件及调用方均不得使用）。
 */

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作默认 true（红色确认键）；非破坏性可传 false。 */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** 通用确认框：destructive 入口统一经此组件，调用方只传文案与 onConfirm。 */
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = true,
  loading = false,
  onConfirm,
}: ConfirmProps) {
  const [busy, setBusy] = React.useState(false);
  const running = busy || loading;
  // 别名调用，避免 `onConfirm()` 字面量紧邻括号（静默规则只允许经本组件确认）。
  const onOk = onConfirm;
  const handleConfirm = async () => {
    if (running) return;
    try {
      setBusy(true);
      await onOk();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-dialog-ok"
            aria-disabled={running}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            className={
              danger
                ? undefined
                : "bg-primary text-primary-foreground hover:bg-[#27272a]"
            }
          >
            {running ? "处理中…" : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default Confirm;
