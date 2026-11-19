import type { ReactNode } from "react"

// Phase 0 空壳：仅透传 children。Wave2 由状态/主题智能体填充
// （Zustand stores、Tailwind globals.css、sonner Toaster 等）。
export default function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>
}
