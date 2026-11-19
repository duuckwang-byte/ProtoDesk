import * as React from "react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Popover（无 Radix）：文档段落「✎ 微改」等轻浮层用。
// TODO(Wave1): 需要复杂定位/碰撞检测时替换为 @radix-ui/react-popover。

type PopoverContextValue = { open: boolean; setOpen: (open: boolean) => void }
const PopoverContext = React.createContext<PopoverContextValue | null>(null)

function usePopover() {
  const ctx = React.useContext(PopoverContext)
  if (!ctx) throw new Error("Popover 子组件必须放在 <Popover> 内")
  return ctx
}

function Popover({
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
  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <span data-slot="popover" className="relative inline-flex">
        {children}
      </span>
    </PopoverContext.Provider>
  )
}

function PopoverTrigger({ ...props }: React.ComponentProps<"button">) {
  const { open, setOpen } = usePopover()
  return (
    <button type="button" data-slot="popover-trigger" aria-expanded={open} onClick={() => setOpen(!open)} {...props} />
  )
}

function PopoverContent({
  className,
  align = "center",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "center" | "end" }) {
  const { open, setOpen } = usePopover()
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-slot="popover"]')
      if (!el) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [open, setOpen])
  if (!open) return null
  return (
    <div
      data-slot="popover-content"
      className={cn(
        "absolute top-[calc(100%+6px)] z-50 min-w-40 rounded-lg border border-border bg-popover p-2 shadow-lg",
        align === "start" && "left-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "end" && "right-0",
        className
      )}
      {...props}
    />
  )
}

export { Popover, PopoverTrigger, PopoverContent }
