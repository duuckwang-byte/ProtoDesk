import * as React from "react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Tooltip（无 Radix）：hover/focus 显示，纯展示用途。
// TODO(Wave1): 需要 Esc 关闭/延迟/无障碍全行为时替换为 @radix-ui/react-tooltip。

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <span data-slot="tooltip" className="group/tooltip relative inline-flex">
      {children}
    </span>
  )
}

function TooltipTrigger({ ...props }: React.ComponentProps<"span">) {
  return <span data-slot="tooltip-trigger" tabIndex={0} {...props} />
}

function TooltipContent({
  className,
  side = "top",
  ...props
}: React.ComponentProps<"div"> & { side?: "top" | "bottom" | "left" | "right" }) {
  const pos =
    side === "top"
      ? "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2"
      : side === "bottom"
        ? "top-[calc(100%+6px)] left-1/2 -translate-x-1/2"
        : side === "left"
          ? "right-[calc(100%+6px)] top-1/2 -translate-y-1/2"
          : "left-[calc(100%+6px)] top-1/2 -translate-y-1/2"
  return (
    <div
      data-slot="tooltip-content"
      className={cn(
        "pointer-events-none absolute z-50 hidden w-max max-w-60 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground shadow-md group-hover/tooltip:block group-focus-within/tooltip:block",
        pos,
        className
      )}
      {...props}
    />
  )
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent }
