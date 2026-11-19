/**
 * src/renderer/features/docs/DocToc.tsx — Wave 2-I 文档目录（TOC 跳转 + 搜索过滤 + 当前项高亮）。
 *
 * 纯展示组件：items/query/activeId 由父级（DocsPanel，经 docs-store / 滚动计算）传入；
 * 跳转只做锚点定位回调，不碰编辑内核与 mirror 通道。
 *
 * 布局约束：条目固定 24px 高且 `shrink-0`，长目录（80+ 条）由 nav 自己滚动，
 * 不允许 flex 把条目压扁到几像素（wave4 b-docs TOC-SQUASH）。
 */

import { useEffect, useMemo, useRef } from "react"
import { ListTree } from "lucide-react"
import type { DocTocItem } from "@/stores/docs-store"
import { Input } from "@/components/ui/input"

export interface DocTocProps {
  /** TOC 条目（docs-store.extractDocHeadings 产出）。 */
  items: DocTocItem[]
  /** 搜索关键字（受控，透传 docs-store.search）。 */
  query: string
  /** 当前高亮锚点（随正文滚动更新）。 */
  activeId?: string
  /** 搜索变化。 */
  onQueryChange: (q: string) => void
  /** 点击条目跳转。 */
  onJump: (id: string) => void
}

export default function DocToc({ items, query, activeId, onQueryChange, onJump }: DocTocProps) {
  const needle = query.trim().toLowerCase()
  const navRef = useRef<HTMLElement>(null)
  const filtered = useMemo(() => {
    if (!needle) return items
    return items.filter((it) => it.text.toLowerCase().includes(needle))
  }, [items, needle])

  // 当前项滚入目录自己的滚动视口（block: nearest，不影响正文）。
  useEffect(() => {
    const nav = navRef.current
    if (!nav || !activeId) return
    const active = Array.from(nav.querySelectorAll<HTMLElement>("[data-toc-id]")).find(
      (node) => node.getAttribute("data-toc-id") === activeId,
    )
    if (!active || typeof active.scrollIntoView !== "function") return
    try {
      active.scrollIntoView({ block: "nearest" })
    } catch {
      // jsdom / 旧内核不支持选项时忽略，高亮本身不受影响。
    }
  }, [activeId, filtered])

  return (
    <div data-testid="doc-toc" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="relative shrink-0">
        <Input
          data-testid="doc-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索目录"
          aria-label="搜索目录"
          className="h-7 text-xs"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="flex items-center gap-1.5 px-1 py-3 text-[11px] text-muted-foreground">
          <ListTree className="size-3.5" />
          <span>{items.length === 0 ? "暂无目录" : "无匹配条目"}</span>
        </div>
      ) : (
        <nav
          ref={navRef}
          data-testid="doc-toc-nav"
          aria-label="文档目录"
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-contain pr-0.5"
        >
          {filtered.map((it) => {
            const active = activeId === it.id
            return (
              <button
                key={it.id}
                type="button"
                data-testid="doc-toc-item"
                data-toc-id={it.id}
                data-active={active ? "true" : "false"}
                aria-current={active ? "true" : undefined}
                title={it.text}
                onClick={() => onJump(it.id)}
                className={
                  "block h-6 min-h-6 w-full shrink-0 truncate rounded px-1.5 text-left text-xs leading-6 transition-colors hover:bg-muted " +
                  (active
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground")
                }
                style={{ paddingLeft: `${6 + Math.max(0, Math.min(5, it.level - 1)) * 12}px` }}
              >
                {it.text}
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}
