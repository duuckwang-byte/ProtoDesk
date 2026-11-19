import * as React from "react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 ScrollArea：原生滚动 + 细圆角滚动条（globals.css 已全局 6px）。
// TODO(Wave1): 需要自定义滚动条视口时替换为 @radix-ui/react-scroll-area。

function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("relative overflow-hidden", className)} {...props}>
      <div data-slot="scroll-area-viewport" className="h-full w-full overflow-auto">
        {children}
      </div>
    </div>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  // 原生滚动条已由全局样式接管，此占位保留 shadcn API 形状。
  return <div data-slot="scroll-bar" data-orientation={orientation} aria-hidden="true" className={cn("hidden", className)} {...props} />
}

export { ScrollArea, ScrollBar }
