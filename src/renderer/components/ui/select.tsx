import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Select（无 Radix）：Trigger + 浮层 Content + Item 单选。
// B-SET-P1-2：Item 的 mousedown 必须 preventDefault，否则焦点从 trigger 移走会触发
// 根节点 onBlur，浮层在 mouseup/click 之前就被卸载，真实鼠标点击选项不生效。
// 键盘：Trigger 上 ↑/↓/Home/End 打开并移动高亮，Enter/Space 选中，Esc 只关自身。
// RETEST-B-SET-P2-1：浮层 portal 到 body + position fixed + 高 z-index，按触发器矩形
// 定位；下方空间不足时向上翻转，最大高度按可用空间钳制并在浮层内滚动。这样设置
// Dialog 的 overflow-hidden / 底栏 / 遮罩都不会再裁剪下拉。
// TODO(Wave1): 替换为 @radix-ui/react-select（虚拟滚动在大模型清单时补）。

/** 浮层与视口边缘、触发器之间留白（px）。 */
const FLOATING_MARGIN = 8
const FLOATING_GAP = 4
/** 极端窄视口下仍保留的最小可滚动高度。 */
const MIN_USABLE_HEIGHT = 48

type SelectItemRecord = { value: string; id: string }

type SelectContextValue = {
  value: string
  selectValue: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  contentId: string
  items: SelectItemRecord[]
  registerItem: (item: SelectItemRecord) => () => void
  highlighted: string | null
  setHighlighted: React.Dispatch<React.SetStateAction<string | null>>
}
const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelect() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error("Select 子组件必须放在 <Select> 内")
  return ctx
}

/** 聚焦时不滚动页面；jsdom 下 focus 选项可能不实现，忽略即可。 */
function focusElement(el: HTMLElement | null): void {
  if (!el) return
  try {
    el.focus({ preventScroll: true })
  } catch {
    try {
      el.focus()
    } catch {
      // 忽略：元素不可聚焦。
    }
  }
}

function scrollItemIntoView(id: string): void {
  if (typeof document === "undefined") return
  const el = document.getElementById(id)
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "nearest" })
  }
}

function Select({
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const [open, setOpen] = React.useState(false)
  const [highlighted, setHighlighted] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<SelectItemRecord[]>([])
  const value = controlledValue ?? uncontrolledValue
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const contentId = React.useId()

  const setValue = React.useCallback(
    (next: string) => {
      if (controlledValue === undefined) setUncontrolledValue(next)
      onValueChange?.(next)
    },
    [controlledValue, onValueChange]
  )

  /** 选中后统一收起浮层并把焦点还给 trigger（鼠标 click / 键盘 Enter 共用）。 */
  const selectValue = React.useCallback(
    (next: string) => {
      setValue(next)
      setOpen(false)
      setHighlighted(null)
      focusElement(triggerRef.current)
    },
    [setValue]
  )

  // 选项在 Content 挂载时按渲染顺序登记；id 用于 aria-activedescendant。
  const registerItem = React.useCallback((item: SelectItemRecord) => {
    setItems((prev) => (prev.some((record) => record.id === item.id) ? prev : [...prev, item]))
    return () => {
      setItems((prev) => prev.filter((record) => record.id !== item.id))
    }
  }, [])

  // 浮层已 portal 到 body，不在根节点的 DOM 子树内；点击外部时要显式收起，
  // 否则根节点 onBlur 永远看不到这次焦点变化。点击触发器仍由 onClick 负责开关。
  React.useEffect(() => {
    if (!open || typeof document === "undefined") return
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const root = triggerRef.current?.closest('[data-slot="select"]')
      if (root?.contains(target)) return
      if (document.getElementById(contentId)?.contains(target)) return
      setOpen(false)
      setHighlighted(null)
    }
    document.addEventListener("mousedown", onDocumentMouseDown, true)
    return () => document.removeEventListener("mousedown", onDocumentMouseDown, true)
  }, [open, contentId])

  // 打开后默认高亮当前值；没有匹配项时高亮第一项。
  // 纯派生值：选项在 Content 挂载后才登记，不需要在 effect 里补一次 setState。
  const effectiveHighlighted = React.useMemo(() => {
    if (!open) return null
    if (highlighted && items.some((record) => record.value === highlighted)) return highlighted
    return items.some((record) => record.value === value) ? value : items[0]?.value ?? null
  }, [open, highlighted, items, value])

  const moveHighlight = (key: "ArrowDown" | "ArrowUp" | "Home" | "End") => {
    if (items.length === 0) return
    const currentIndex =
      effectiveHighlighted === null
        ? -1
        : items.findIndex((record) => record.value === effectiveHighlighted)
    let nextIndex: number
    if (key === "Home") nextIndex = 0
    else if (key === "End") nextIndex = items.length - 1
    else if (key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
    else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1
    const next = items[nextIndex]
    setHighlighted(next.value)
    scrollItemIntoView(next.id)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!open) return
      // 只关自身：阻止同一次 Esc 继续冒泡到 window 的全局 Esc 栈（设置 Dialog）。
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setHighlighted(null)
      focusElement(triggerRef.current)
      return
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault()
      if (!open) {
        setHighlighted(null)
        setOpen(true)
        return
      }
      moveHighlight(event.key)
      return
    }

    if (!open && (event.key === "Enter" || event.key === " ")) {
      // 键盘打开；显式 preventDefault，避免 button 默认 click 再 toggle 一次。
      event.preventDefault()
      setHighlighted(null)
      setOpen(true)
      return
    }

    if (open && (event.key === "Enter" || event.key === " ")) {
      const target =
        items.find((record) => record.value === effectiveHighlighted) ?? items[0] ?? undefined
      if (!target) return
      event.preventDefault()
      selectValue(target.value)
    }
  }

  return (
    <SelectContext.Provider
      value={{
        value,
        selectValue,
        open,
        setOpen,
        triggerRef,
        contentId,
        items,
        registerItem,
        highlighted: effectiveHighlighted,
        setHighlighted,
      }}
    >
      <div
        data-slot="select"
        className="relative inline-block"
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
        }}
      >
        {children}
      </div>
    </SelectContext.Provider>
  )
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<"button">) {
  const { open, setOpen, triggerRef, contentId, highlighted, items, setHighlighted } = useSelect()
  const activeId = open
    ? items.find((record) => record.value === highlighted)?.id
    : undefined
  return (
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      data-slot="select-trigger"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? contentId : undefined}
      aria-activedescendant={activeId}
      onClick={() => {
        const next = !open
        setOpen(next)
        setHighlighted(null)
      }}
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-[12.5px] shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}

function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value } = useSelect()
  return <span data-slot="select-value">{value || <span className="text-muted-foreground">{placeholder}</span>}</span>
}

function SelectContent({ className, children, ...props }: React.ComponentProps<"div">) {
  const { open, contentId, triggerRef } = useSelect()
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  // 定位/翻转：固定定位相对视口，直接量触发器矩形即可，不受 Dialog 滚动容器影响。
  // 用 layout effect 在绘制前完成，避免浮层先出现在错误位置再跳动。
  React.useLayoutEffect(() => {
    if (!open) return
    const el = contentRef.current
    if (!el) return

    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0

      el.style.position = "fixed"
      el.style.zIndex = "1000"
      el.style.width = "max-content"
      el.style.minWidth = `${Math.round(rect.width)}px`
      el.style.maxWidth = `${Math.max(viewportWidth - FLOATING_MARGIN * 2, 0)}px`

      // 先量自然高度，再按视口剩余空间决定向下 / 向上。
      const naturalHeight = el.scrollHeight
      const spaceBelow = viewportHeight - rect.bottom - FLOATING_GAP - FLOATING_MARGIN
      const spaceAbove = rect.top - FLOATING_GAP - FLOATING_MARGIN
      const placeOnTop = naturalHeight > spaceBelow && spaceAbove > spaceBelow
      const available = placeOnTop ? spaceAbove : spaceBelow

      // 宽度已按 max-width 钳制，量完再决定水平方向是否需要左移。
      const width = el.offsetWidth
      let left = rect.left
      if (left + width > viewportWidth - FLOATING_MARGIN) {
        left = viewportWidth - FLOATING_MARGIN - width
      }
      left = Math.max(FLOATING_MARGIN, left)

      el.style.left = `${Math.round(left)}px`
      el.style.maxHeight = `${Math.round(Math.max(available, MIN_USABLE_HEIGHT))}px`
      if (placeOnTop) {
        el.style.top = "auto"
        el.style.bottom = `${Math.round(viewportHeight - rect.top + FLOATING_GAP)}px`
        el.dataset.placement = "top"
      } else {
        el.style.bottom = "auto"
        el.style.top = `${Math.round(rect.bottom + FLOATING_GAP)}px`
        el.dataset.placement = "bottom"
      }
      el.style.visibility = "visible"
    }

    place()
    window.addEventListener("resize", place)
    // capture：设置 Dialog 的滚动容器滚动时也要跟随触发器。
    window.addEventListener("scroll", place, true)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(place)
      observer.observe(el)
      if (triggerRef.current) observer.observe(triggerRef.current)
    }
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      observer?.disconnect()
    }
  }, [open, triggerRef])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={contentRef}
      id={contentId}
      role="listbox"
      data-slot="select-content"
      data-placement="bottom"
      className={cn(
        "overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border border-border bg-popover p-1 shadow-md outline-none",
        className
      )}
      // 初始隐藏：layout effect 量完并写好位置后再显示，避免绘制到 body 末尾。
      style={{ position: "fixed", zIndex: 1000, visibility: "hidden" }}
      {...props}
    >
      {children}
    </div>,
    document.body
  )
}

function SelectItem({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { value: active, selectValue, highlighted, setHighlighted, registerItem } = useSelect()
  const selected = active === value
  const id = React.useId()

  React.useEffect(() => registerItem({ value, id }), [registerItem, value, id])

  return (
    <div
      id={id}
      data-slot="select-item"
      data-value={value}
      data-highlighted={highlighted === value ? "true" : undefined}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onMouseDown={(e) => {
        // B-SET-P1-2：阻止 mousedown 的默认焦点转移。否则焦点从 trigger 移走，
        // 根节点 onBlur 会在 mouseup/click 之前卸载浮层，真实鼠标点击永远选不中。
        // 不在这里提交：保留标准 click 语义，避免浮层卸载后 click 穿透到下层按钮。
        e.preventDefault()
      }}
      onClick={() => selectValue(value)}
      onMouseEnter={() => setHighlighted(value)}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent",
        selected && "font-medium",
        highlighted === value && "bg-accent",
        className
      )}
      {...props}
    >
      <span className="w-3.5">{selected && <Check className="size-3.5" />}</span>
      {children}
    </div>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
