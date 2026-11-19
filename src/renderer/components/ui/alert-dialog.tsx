import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { registerOverlayLayer } from "@/stores/ui-store"

// Phase 0 最小版 AlertDialog：确认/删除二次确认（无 Radix）。
// Esc 不作为本组件的关闭入口：全局 Esc 栈（MainWindow → ui-store.closeTopmost）
// 是唯一入口；确认层不经 Esc 绕过用户选择。
// TODO(Wave1): 替换为 @radix-ui/react-alert-dialog。

type AlertDialogContextValue = { open: boolean; setOpen: (open: boolean) => void }
const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null)

function useAlertDialog() {
  const ctx = React.useContext(AlertDialogContext)
  if (!ctx) throw new Error("AlertDialog 子组件必须放在 <AlertDialog> 内")
  return ctx
}

function AlertDialog({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange]
  )
  return <AlertDialogContext.Provider value={{ open, setOpen }}>{children}</AlertDialogContext.Provider>
}

function AlertDialogTrigger({ ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useAlertDialog()
  return <button type="button" data-slot="alert-dialog-trigger" onClick={() => setOpen(true)} {...props} />
}

function AlertDialogContent({ className, children, ...props }: React.ComponentProps<"div">) {
  const { open, setOpen } = useAlertDialog()
  // 只登记关闭回调，不监听 Esc：唯一决策点是 MainWindow 的 window keydown
  //（ui-store 栈为空时兜底关闭本层）。
  React.useEffect(() => {
    if (!open) return
    const active = typeof document === "undefined" ? null : document.activeElement
    return registerOverlayLayer({
      close: () => setOpen(false),
      opener: active instanceof HTMLElement && active !== document.body ? active : null,
    })
  }, [open, setOpen])
  if (!open) return null
  const dialog = (
    <div data-slot="alert-dialog-portal" className="fixed inset-0 z-50">
      <div data-slot="alert-dialog-overlay" aria-hidden="true" className="absolute inset-0 bg-black/22" />
      <div className="absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
        <div
          data-slot="alert-dialog-content"
          role="alertdialog"
          aria-modal="true"
          className={cn(
            "max-h-[calc(100vh-2rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-border bg-background p-5 shadow-lg",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    </div>
  )
  // 统一 portal 到 body：避免被祖先 transform（如待提交条的 -translate-x-1/2）建立的
  // containing block 锚定，导致 fixed inset-0 相对局部容器定位、弹窗与按钮被裁切。
  // body 一定在当前文档内；SSR/无 DOM 环境下退化为原位渲染。
  const portalTarget = typeof document !== "undefined" ? document.body : null
  return portalTarget ? createPortal(dialog, portalTarget) : dialog
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-dialog-footer" className={cn("mt-4 flex justify-end gap-2", className)} {...props} />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="alert-dialog-title" className={cn("text-sm font-semibold", className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p data-slot="alert-dialog-description" className={cn("text-xs text-muted-foreground", className)} {...props} />
  )
}

function AlertDialogAction({ onClick, ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useAlertDialog()
  return (
    <button
      type="button"
      data-slot="alert-dialog-action"
      className="h-8 rounded-md bg-destructive px-3 text-[12.5px] font-medium text-destructive-foreground hover:bg-[#b91c1c]"
      onClick={(e) => {
        onClick?.(e)
        setOpen(false)
      }}
      {...props}
    />
  )
}

function AlertDialogCancel({ onClick, ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useAlertDialog()
  return (
    <button
      type="button"
      data-slot="alert-dialog-cancel"
      className="h-8 rounded-md border border-input bg-background px-3 text-[12.5px] font-medium hover:bg-accent"
      onClick={(e) => {
        onClick?.(e)
        setOpen(false)
      }}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
