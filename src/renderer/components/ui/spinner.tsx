import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 loading 菊花；与 shadcn spinner 的 data-slot 对齐。
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span data-slot="spinner" role="status" aria-label="加载中" className={cn("inline-flex", className)} {...props}>
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </span>
  )
}

export { Spinner }
