import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { registerOverlayLayer } from "@/stores/ui-store"

// Phase 0 最小版 Sheet（无 Radix）。注意：AI 对话主容器用 Dialog，Sheet 只给
// 检查器/多选/标注用（§8.4），绝不用作 AI 对话容器。
// Esc 不作为本组件的关闭入口：全局 Esc 栈（MainWindow → ui-store.closeTopmost）
// 是唯一入口，避免一次 Esc 同时触发本组件与全局栈、连关两层。
// TODO(Wave1): 替换为 @radix-ui/react-dialog 的 Sheet 语义实现。

type SheetSide = "top" | "bottom" | "left" | "right"

const sideClass: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 border-b",
  bottom: "inset-x-0 bottom-0 border-t",
  left: "inset-y-0 left-0 border-r",
  right: "inset-y-0 right-0 border-l",
}

type SheetContextValue = { open: boolean; setOpen: (open: boolean) => void }
const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheet() {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error("Sheet 子组件必须放在 <Sheet> 内")
  return ctx
}

/** Sheet 内可聚焦元素（Tab 焦点陷阱用；不依赖布局 API，jsdom 下也可测试）。 */
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

function Sheet({
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
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>
}

function SheetTrigger({ ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useSheet()
  return <button type="button" data-slot="sheet-trigger" onClick={() => setOpen(true)} {...props} />
}

function SheetClose({ onClick, ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useSheet()
  return (
    <button
      type="button"
      data-slot="sheet-close"
      onClick={(e) => {
        onClick?.(e)
        setOpen(false)
      }}
      {...props}
    />
  )
}

function SheetContent({
  className,
  side = "right",
  children,
  onKeyDown,
  ...props
}: React.ComponentProps<"div"> & { side?: SheetSide }) {
  const { open, setOpen } = useSheet()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const openerRef = React.useRef<HTMLElement | null>(null)

  // 只登记关闭回调，不监听 Esc：唯一决策点是 MainWindow 的 window keydown。
  // 打开瞬间先记录触发元素（此时焦点还在背景按钮上），关闭后据此回归焦点。
  React.useEffect(() => {
    if (!open) return
    const active = typeof document === "undefined" ? null : document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    openerRef.current = opener
    return registerOverlayLayer({
      close: () => setOpen(false),
      opener,
    })
  }, [open, setOpen])

  // 打开后把焦点送进浮层首个可聚焦元素（关闭按钮/内容），键盘用户不再停在背景 toolbar。
  React.useEffect(() => {
    if (!open) return
    const root = contentRef.current
    if (!root) return
    const first = focusableElements(root)[0] || root
    focusElement(first)
  }, [open])

  // 关闭（Esc / X / 遮罩 / 受控关闭）后焦点回到触发按钮。
  // Esc 路径 MainWindow 还会同步 focusOpener 一次，重复聚焦同一元素无副作用。
  React.useEffect(() => {
    if (!open) return
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      if (opener && opener.isConnected) focusElement(opener)
    }
  }, [open])

  /** Tab / Shift+Tab 在 Sheet 内循环；不介入 Escape（仍由全局栈单入口处理）。 */
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return
    const root = contentRef.current
    if (!root) return
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
    <div data-slot="sheet-portal" className="fixed inset-0 z-50">
      {/* 遮罩只铺满视口、不包裹内容；内容是其后的定位兄弟，点击内容不会命中遮罩。 */}
      <div
        data-slot="sheet-overlay"
        aria-hidden="true"
        className="absolute inset-0 bg-black/22"
        onClick={() => setOpen(false)}
      />
      <div
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn("absolute bg-background shadow-lg", sideClass[side], className)}
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

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("flex justify-end gap-2 p-4", className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="sheet-title" className={cn("text-sm font-semibold", className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="sheet-description" className={cn("text-xs text-muted-foreground", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
