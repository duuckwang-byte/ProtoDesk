import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { registerOverlayLayer } from "@/stores/ui-store"

// Phase 0 最小版 Dialog（无 Radix）：受控/非受控 open + 遮罩点击关闭。
// Esc 不作为本组件的关闭入口：全局 Esc 栈（MainWindow → ui-store.closeTopmost）
// 是唯一入口，避免一次 Esc 同时触发本组件与全局栈、连关两层。
//
// B-SET-P2-1：设置面板需要模态焦点语义。焦点陷阱只对设置 Dialog 开启
// （`data-testid="settings-dialog"` 或显式 focusTrap），避免改变 AI / Git /
// 项目选择等既有 Dialog 的焦点行为。
// TODO(Wave1): 替换为 @radix-ui/react-dialog。

type DialogContextValue = { open: boolean; setOpen: (open: boolean) => void }
const DialogContext = React.createContext<DialogContextValue | null>(null)

/** Dialog 内可聚焦元素（Tab 焦点陷阱用；不依赖布局 API，jsdom 下也可测试）。 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled") || el.closest("[aria-hidden='true']") || el.closest("[hidden]")) return false
    try {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden") return false
    } catch {
      // 忽略：取不到样式时按可聚焦处理。
    }
    return true
  })
}

function focusElement(el: HTMLElement | null): void {
  if (!el) return
  try {
    el.focus({ preventScroll: true })
  } catch {
    try {
      el.focus()
    } catch {
      // 忽略：元素不可聚焦。
    }
  }
}

function useDialog() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("Dialog 子组件必须放在 <Dialog> 内")
  return ctx
}

function Dialog({
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
  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>
}

function DialogTrigger({ ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useDialog()
  return <button type="button" data-slot="dialog-trigger" onClick={() => setOpen(true)} {...props} />
}

function DialogClose({ onClick, ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useDialog()
  return (
    <button
      type="button"
      data-slot="dialog-close"
      onClick={(e) => {
        onClick?.(e)
        setOpen(false)
      }}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  focusTrap,
  onKeyDown,
  ...props
}: React.ComponentProps<"div"> & {
  /**
   * 显式开启焦点陷阱。缺省时只有设置 Dialog（`data-testid="settings-dialog"`）
   * 自动开启，其他 Dialog 保持既有焦点行为。
   */
  focusTrap?: boolean
}) {
  const { open, setOpen } = useDialog()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const openerRef = React.useRef<HTMLElement | null>(null)
  const setOpenRef = React.useRef(setOpen)
  const testId = (props as Record<string, unknown>)["data-testid"]
  const shouldTrapFocus = focusTrap ?? testId === "settings-dialog"

  // 保持最新关闭回调，避免父组件每次渲染传入新的 onOpenChange 时重新登记/覆盖 opener。
  React.useEffect(() => {
    setOpenRef.current = setOpen
  }, [setOpen])

  // 只登记关闭回调，不监听 Esc：唯一决策点是 MainWindow 的 window keydown。
  // opener 只在「关闭 → 打开」时捕获一次（父组件重渲染不得覆盖为 AI 等后开层的触发器）。
  React.useEffect(() => {
    if (!open) return
    const active = typeof document === "undefined" ? null : document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    openerRef.current = opener
    return registerOverlayLayer({
      close: () => setOpenRef.current(false),
      opener,
    })
  }, [open])

  // 打开后把焦点送进 Dialog 首个可聚焦元素（设置 Tab），背景顶栏不再可获得焦点。
  React.useEffect(() => {
    if (!open || !shouldTrapFocus) return
    const root = contentRef.current
    if (!root) return
    const first = focusableElements(root)[0] || root
    focusElement(first)
  }, [open, shouldTrapFocus])

  // 关闭（Esc / X / 遮罩 / 保存后自动关闭）后焦点回到打开它的按钮。
  React.useEffect(() => {
    if (!open || !shouldTrapFocus) return
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      if (opener && opener.isConnected) focusElement(opener)
    }
  }, [open, shouldTrapFocus])

  /** Tab / Shift+Tab 在设置 Dialog 内循环；不介入 Escape（仍由全局栈单入口处理）。 */
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!shouldTrapFocus || event.key !== "Tab") return
    const root = contentRef.current
    if (!root) return
    // 设置内嵌套弹层（如获取模型弹窗）自行管理焦点，不被外层陷阱截走。
    const target = event.target
    if (target instanceof HTMLElement) {
      const owner = target.closest('[role="dialog"]')
      if (owner && owner !== root) return
    }
    const focusables = focusableElements(root)
    if (focusables.length === 0) {
      event.preventDefault()
      focusElement(root)
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = typeof document === "undefined" ? null : document.activeElement
    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault()
        focusElement(last)
      }
    } else if (active === last || !root.contains(active)) {
      event.preventDefault()
      focusElement(first)
    }
  }

  if (!open) return null
  return (
    // 布局容器只负责居中，不拦截指针：遮罩是其全屏子层，内容层压在其上。
    // 这样点空白处命中的是 overlay，点内容命中的是 content（不会冒泡到 overlay）。
    <div
      data-slot="dialog-portal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        data-slot="dialog-overlay"
        aria-hidden="true"
        className="absolute inset-0 bg-black/22"
        onClick={() => setOpen(false)}
      />
      <div
        ref={contentRef}
        data-slot="dialog-content"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-lg",
          className
        )}
        onKeyDown={(event) => {
          trapTab(event)
          onKeyDown?.(event)
        }}
        {...props}
      >
        {children}
        <button
          type="button"
          aria-label="关闭"
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-footer" className={cn("mt-4 flex justify-end gap-2", className)} {...props} />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="dialog-title" className={cn("text-sm font-semibold", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="dialog-description" className={cn("text-xs text-muted-foreground", className)} {...props} />
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
