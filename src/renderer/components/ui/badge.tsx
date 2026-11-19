import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Phase 0 最小版：cva 只用在 button/badge。

const badgeVariants = cva(
  "inline-flex items-center gap-1 h-5 px-[7px] rounded-full text-[11.5px] font-medium leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground border border-border",
        outline: "border border-border text-foreground",
        cobalt: "bg-[var(--cobalt-soft)] text-[var(--cobalt)] border border-[var(--cobalt-border)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
