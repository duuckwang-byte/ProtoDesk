/**
 * src/renderer/components/shell/DocsPanelHost.tsx — Wave 2-G 文档面板容器。
 *
 * 只做容器与两种形态切换，内容由 Wave2-I 填充：
 * - PC（kind === "pc"）：右侧独立悬浮弹窗 + 遮罩，fixed 定位，绝不挤压原型
 *   （§8.1 硬约束）。文档宽 980px（视口不足时 `100vw - 18rem`），
 *   目录是文档左侧同层级的独立 fixed 面板（220px），两者相邻不重叠；
 *   目录内容由 DocsPanel 经 portal 注入（`doc-toc-sidebar` 即 portal 宿主），
 *   目录与文档共用同一遮罩和 Esc 栈。
 * - 移动端：Flex 行内挤压容器，与舞台并排压缩；宽 640px（2× 原 320px），
 *   窄视口封顶 70%，始终给舞台留至少 30% 可视宽度；目录仍是面板内抽屉。
 *   层级 z-40：高于舞台/预览浮层，低于 Dialog/Sheet（z-50），弹层不被文档遮挡。
 * - Esc 关闭由 MainWindow 统一监听经 ui-store.closeTopmost() 处理
 *  （栈顺序 AI > 文档 > 设置），本容器不另设窗口级监听，避免一次按键关两层。
 *  唯一例外：移动端目录抽屉的 Esc 在 DocsPanel 内捕获并只收起抽屉。
 *
 * 目录定位：文档 `right-4`，目录 `right = 1rem + 文档宽 + 0.5rem` 的间隙；
 * 视口 ≥1024 时目录 left ≥44px，文档与目录都不越出屏幕。
 */

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"
import DocsPanel from "@/features/docs/DocsPanel"

function DocsHead({ onClose }: { onClose: () => void }) {
  const proto = useAppStore((s) => s.proto)
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <span className="text-xs font-medium">文档</span>
      {proto ? (
        <span data-testid="docs-source-title" className="max-w-40 truncate text-[11px] text-muted-foreground">
          {proto}
        </span>
      ) : null}
      <div className="min-w-2 flex-1" />
      <Button variant="ghost" size="icon" aria-label="关闭文档" title="关闭文档（Esc）" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </div>
  )
}

export default function DocsPanelHost() {
  const kind = useAppStore((s) => s.kind)
  const docsOpen = useUiStore((s) => s.docsOpen)
  const closeDocs = useUiStore((s) => s.closeDocs)
  const panelRef = useRef<HTMLElement>(null)
  /** PC 目录面板的 DOM 宿主：DocsPanel 把目录内容 portal 到这里，保证两块面板同级。 */
  const [tocHost, setTocHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (docsOpen) panelRef.current?.focus()
  }, [docsOpen])

  if (!docsOpen) return null

  if (kind === "pc") {
    return (
      <>
        <div
          data-testid="docs-overlay"
          aria-hidden="true"
          onClick={closeDocs}
          className="fixed inset-0 z-40 bg-black/30"
        />
        <aside
          ref={setTocHost}
          data-testid="doc-toc-sidebar"
          data-variant="overlay"
          aria-label="文档目录"
          style={{ right: "calc(1rem + min(980px, 100vw - 18rem) + 0.5rem)" }}
          className="fixed bottom-4 top-12 z-50 flex w-[220px] flex-col overflow-hidden rounded-lg border border-border bg-background p-2 shadow-lg"
        />
        <aside
          ref={panelRef}
          data-testid="docs-panel"
          data-variant="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="文档面板"
          tabIndex={-1}
          className="fixed bottom-4 right-4 top-12 z-50 flex w-[min(980px,calc(100vw-18rem))] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
        >
          <DocsHead onClose={closeDocs} />
          <DocsPanel variant="overlay" tocHost={tocHost} />
        </aside>
      </>
    )
  }

  // 移动端行内面板层级：z-40。
  // - 高于舞台内容与预览浮层（工具条已回到 Stage 子顶栏，无更高 z 级）；
  // - 低于 Dialog / Sheet 的 z-50，保证新建子页、设置、AI、Git 弹层压在文档之上；
  //   两者同为 z-50 时由 DOM 顺序决定，侧栏内的「新建子页面」Dialog 先于文档渲染，
  //   会被 inline 文档盖住，因此这里必须显式降一层。
  // PC overlay 文档仍保持 z-50（独立浮窗 + 遮罩，不在本分支）。
  return (
    <aside
      ref={panelRef}
      data-testid="docs-panel"
      data-variant="inline"
      role="complementary"
      aria-label="文档面板"
      tabIndex={-1}
      className="relative z-40 flex h-full w-[min(640px,70%)] shrink-0 flex-col border-l border-border bg-background"
    >
      <DocsHead onClose={closeDocs} />
      <DocsPanel variant="inline" />
    </aside>
  )
}
