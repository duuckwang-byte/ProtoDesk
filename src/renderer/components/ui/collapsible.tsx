import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Collapsible（无 Radix）。
// TODO(Wave1): 需要高度动画时补 CSS grid-rows 动画或替换为 Radix。

type CollapsibleContextValue = { open: boolean; setOpen: (open: boolean) => void }
const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null)

function useCollapsible() {
  const ctx = React.useContext(CollapsibleContext)
  if (!ctx) throw new Error("Collapsible 子组件必须放在 <Collapsible> 内")
  return ctx
}

function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
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
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div data-slot="collapsible" data-state={open ? "open" : "closed"} className={className} {...props} />
    </CollapsibleContext.Provider>
  )
}

function CollapsibleTrigger({ className, children, onClick, ...props }: React.ComponentProps<"button">) {
  const { open, setOpen } = useCollapsible()
  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      aria-expanded={open}
      onClick={(e) => {
        onClick?.(e)
        setOpen(!open)
      }}
      className={cn("flex w-full items-center gap-1.5", className)}
      {...props}
    >
      {children}
      <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
    </button>
  )
}

function CollapsibleContent({ className, ...props }: React.ComponentProps<"div">) {
  const { open } = useCollapsible()
  if (!open) return null
  return <div data-slot="collapsible-content" className={className} {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
