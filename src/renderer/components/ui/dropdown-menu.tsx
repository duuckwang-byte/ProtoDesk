import * as React from "react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 DropdownMenu（无 Radix）：顶栏/导出/Git「更多」菜单用。
// TODO(Wave1): 需要子菜单/快捷键/复杂焦点管理时替换为 @radix-ui/react-dropdown-menu。

type DropdownMenuContextValue = { open: boolean; setOpen: (open: boolean) => void }
const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenu() {
  const ctx = React.useContext(DropdownMenuContext)
  if (!ctx) throw new Error("DropdownMenu 子组件必须放在 <DropdownMenu> 内")
  return ctx
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-slot="dropdown-menu"]')
      if (!el) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [open ])
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <span data-slot="dropdown-menu" className="relative inline-flex">
        {children}
      </span>
    </DropdownMenuContext.Provider>
  )
}

function DropdownMenuTrigger({ ...props }: React.ComponentProps<"button">) {
  const { open, setOpen } = useDropdownMenu()
  return (
    <button type="button" data-slot="dropdown-menu-trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} {...props} />
  )
}

function DropdownMenuContent({
  className,
  align = "end",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "center" | "end" }) {
  const { open } = useDropdownMenu()
  if (!open) return null
  return (
    <div
      data-slot="dropdown-menu-content"
      role="menu"
      className={cn(
        "absolute top-[calc(100%+6px)] z-50 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg",
        align === "start" && "left-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "end" && "right-0",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  onSelect,
  onClick,
  disabled,
  ...props
}: React.ComponentProps<"button"> & { inset?: boolean; onSelect?: () => void }) {
  const { setOpen } = useDropdownMenu()
  return (
    <button
      type="button"
      data-slot="dropdown-menu-item"
      role="menuitem"
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.()
        setOpen(false)
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs outline-none hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        inset && "pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuLabel({ className, inset, ...props }: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-[11.5px] font-semibold text-muted-foreground", inset && "pl-8", className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dropdown-menu-separator" className={cn("my-1 h-px bg-border", className)} {...props} />
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="dropdown-menu-shortcut" className={cn("ml-auto font-mono text-[11px] text-muted-foreground", className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
}
