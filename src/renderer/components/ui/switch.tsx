import * as React from "react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Switch（无 Radix，button + role=switch）。

function Switch({
  className,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked)
  const isControlled = checked !== undefined
  const on = isControlled ? checked : uncontrolled
  return (
    <button
      type="button"
      data-slot="switch"
      role="switch"
      aria-checked={on}
      data-state={on ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => {
        if (!isControlled) setUncontrolled(!on)
        onCheckedChange?.(!on)
      }}
      className={cn(
        "h-[18px] w-8 shrink-0 rounded-full bg-input transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        className={cn(
          "block size-3.5 rounded-full bg-background shadow-sm transition-transform translate-x-0.5",
          on && "translate-x-[15px]"
        )}
      />
    </button>
  )
}

export { Switch }
