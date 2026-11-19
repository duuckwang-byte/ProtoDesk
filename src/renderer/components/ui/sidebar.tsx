import * as React from "react"
import { PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Sidebar（无 Radix）：宽度取 var(--sidebar-width) 236px（§8.1）。
// 本次只留 token/结构给 Wave2；左侧原型列表选中态规范见 styles/globals.css 注释
// （纯白卡片 + 深墨左指示条，或灰底 + 深墨圆点；文件夹无计数），此处不写死。
// TODO(Wave2): 三层拖拽/移动端 Sheet 形态/完整 shadcn sidebar（含 useSidebar 移动端）。

type SidebarContextValue = { open: boolean; setOpen: (open: boolean) => void }
const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) throw new Error("Sidebar 子组件必须放在 <SidebarProvider> 内")
  return ctx
}

function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true)
  return <SidebarContext.Provider value={{ open, setOpen }}>{children}</SidebarContext.Provider>
}

function Sidebar({ className, children, ...props }: React.ComponentProps<"aside">) {
  const { open } = useSidebar()
  if (!open) return null
  return (
    <aside
      data-slot="sidebar"
      className={cn("flex h-full shrink-0 flex-col border-r border-border bg-chrome", className)}
      style={{ width: "var(--sidebar-width)" }}
      {...props}
    >
      {children}
    </aside>
  )
}

function SidebarTrigger({ className, ...props }: React.ComponentProps<"button">) {
  const { open, setOpen } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-trigger"
      aria-label={open ? "收起侧栏" : "展开侧栏"}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn("rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground", className)}
      {...props}
    >
      <PanelLeft className="size-4" />
    </button>
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className={cn("flex items-center gap-2 p-2", className)} {...props} />
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" className={cn("flex-1 overflow-y-auto p-2", className)} {...props} />
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("border-t border-border p-2", className)} {...props} />
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group" className={cn("flex flex-col gap-0.5", className)} {...props} />
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-group-label" className={cn("px-2 py-1 text-[11px] font-medium text-muted-foreground", className)} {...props} />
  )
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group-content" className={cn("flex flex-col gap-px", className)} {...props} />
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("flex flex-col gap-px", className)} {...props} />
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={className} {...props} />
}

function SidebarMenuButton({
  className,
  isActive = false,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean }) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-active={isActive}
      // Wave2 在此接入选中规范（globals.css 注释）：深墨指示，禁用蓝色。
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground data-[active=true]:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

export {
  SidebarProvider,
  Sidebar,
  SidebarTrigger,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
}
