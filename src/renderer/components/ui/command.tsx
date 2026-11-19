import * as React from "react"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Command（命令面板，可选组件；底层 cmdk 不单独引入 §3）。
// 只做展示容器 + 输入框；过滤/键盘导航 Wave 按需补（TODO: 接 cmdk）。
// 注意：AI 对话主容器用 Dialog，不用 Command（§8.4）。

function Command({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command"
      role="dialog"
      aria-label="命令面板"
      className={cn("overflow-hidden rounded-xl border border-border bg-popover shadow-lg", className)}
      {...props}
    />
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <div data-slot="command-input-wrapper" className="flex items-center gap-2 border-b border-border px-3">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        data-slot="command-input"
        className={cn("h-10 w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground", className)}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="command-list" className={cn("max-h-75 overflow-y-auto p-1", className)} {...props} />
}

function CommandEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="command-empty" className={cn("px-2 py-6 text-center text-xs text-muted-foreground", className)} {...props} />
}

function CommandGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="command-group" className={cn("px-1 py-1", className)} {...props} />
}

function CommandItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-item"
      role="option"
      aria-selected="false"
      className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent", className)}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="command-separator" className={cn("my-1 h-px bg-border", className)} {...props} />
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="command-shortcut" className={cn("ml-auto font-mono text-[11px] text-muted-foreground", className)} {...props} />
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator, CommandShortcut }
