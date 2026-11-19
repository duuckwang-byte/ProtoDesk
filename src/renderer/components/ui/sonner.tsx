import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

// Phase 0 最小版 Sonner（通知）：Toaster 容器 + toast() 推送，无 sonner/cmdk 依赖。
// TODO(Phase 6): 若需要滑动手势/富交互，替换为 `sonner` 包（底层由 shadcn sonner 封装 §3）。

type ToastItem = { id: number; title: React.ReactNode; description?: React.ReactNode }
type Listener = (items: ToastItem[]) => void

let nextId = 1
let items: ToastItem[] = []
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((fn) => fn([...items]))
}

function toast(title: React.ReactNode, opts?: { description?: React.ReactNode }) {
  const id = nextId++
  items = [...items, { id, title, description: opts?.description }]
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 4000)
  return id
}

function Toaster({ className, ...props }: React.ComponentProps<"div">) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  React.useEffect(() => {
    listeners.add(setToasts)
    return () => {
      listeners.delete(setToasts)
    }
  }, [])
  if (!toasts.length) return null
  return (
    <div
      data-slot="toaster"
      aria-live="polite"
      className={cn("fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2", className)}
      {...props}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-slot="toast"
          className="rounded-lg border border-border bg-background p-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <div data-slot="toast-title" className="text-xs font-medium">
              {t.title}
            </div>
            <button
              type="button"
              aria-label="关闭通知"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                items = items.filter((x) => x.id !== t.id)
                emit()
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
          {t.description ? (
            <div data-slot="toast-description" className="mt-1 text-xs text-muted-foreground">
              {t.description}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export { Toaster, toast }
