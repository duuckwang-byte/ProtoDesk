import * as React from "react"
import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Checkbox（无 Radix，button + role=checkbox）。

function Checkbox({
  className,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked?: boolean | "indeterminate"
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked)
  const isControlled = checked !== undefined
  const state = isControlled ? checked : uncontrolled
  return (
    <button
      type="button"
      data-slot="checkbox"
      role="checkbox"
      aria-checked={state === "indeterminate" ? "mixed" : state}
      data-state={state === "indeterminate" ? "indeterminate" : state ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => {
        const next = state !== true
        if (!isControlled) setUncontrolled(next)
        onCheckedChange?.(next)
      }}
      className={cn(
        "size-4 shrink-0 rounded-[4px] border border-input bg-background shadow-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        className
      )}
      {...props}
    >
      {state === "indeterminate" ? (
        <Minus className="size-3" />
      ) : state ? (
        <Check className="size-3" />
      ) : null}
    </button>
  )
}

export { Checkbox }
