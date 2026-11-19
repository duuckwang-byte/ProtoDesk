/**
 * src/renderer/features/docs/DocEditor.tsx — Wave 2-I 文档编辑器容器。
 *
 * 只接管容器/工具栏/保存/状态；contenteditable/undo 内核不动（§10.3）：
 * - 预览态：按 docs-store 的轻量 Markdown 块解析结果渲染（标题/段落/表格/列表/代码块等），
 *   标题输出 `data-toc-id` 供 DocToc 锚点定位；段落/标题保留悬停 `✎ 微改`（E2E 锚点 `doc-micro-edit`）；
 * - 编辑态：原生 contenteditable（浏览器自带 undo），React 只在编辑区挂载时灌入 innerText；
 *   编辑区/预览区使用不同 key，退出编辑即整块卸载，避免 contenteditable 文本残留到预览（docs-P1-1）；
 * - 保存/放弃走 docs-store（desc → sandbox:write / latest → doc:write-latest，
 *   失败经 ui-store toast）；段落微改立即落盘，避免只改内存不保存。
 * 禁 `alert` / `confirm` / `prompt`。
 *
 * 安全：预览中的富文本一律来自 `renderDocInline`（先转义再插入受控标签），
 * 禁止把原始 Markdown/HTML 直接交给 innerHTML。
 *
 * 搜索 / 粘贴（本文件内实现，不新增依赖）：
 * - Ctrl/Cmd+F 仅在文档面板内聚焦“正文搜索”，预览态用 `<mark>` 高亮，
 *   编辑态用 CSS Custom Highlight（不改 contenteditable DOM），Esc 关闭且不冒泡到面板；
 * - 粘贴一律读取 `text/plain`：单行走原生 insertText，多行走转义后的 `<br>`（保留 undo），
 *   剪贴板里的 HTML/样式从不进入编辑器。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { ChevronDown, ChevronUp, Pencil, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import {
  parseDocBlocks,
  renderDocInline,
  useDocsStore,
  type DocBlock,
  type DocHeadingBlock,
  type DocParagraphBlock,
} from "@/stores/docs-store"

export interface DocEditorProps {
  /** 保存成功回调（可选；失败已由 docs-store 经 ui-store toast）。 */
  onSaved?: () => void
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const

const HEADING_CLASS: Record<number, string> = {
  1: "mb-1.5 mt-1 text-sm font-semibold leading-6 text-foreground first:mt-0",
  2: "mb-1 mt-2 text-[13px] font-semibold leading-5 text-foreground",
  3: "mb-0.5 mt-1.5 text-xs font-semibold leading-5 text-foreground",
  4: "mb-0.5 mt-1.5 text-xs font-medium leading-5 text-foreground",
  5: "mb-0.5 mt-1 text-[11px] font-medium leading-5 text-foreground",
  6: "mb-0.5 mt-1 text-[11px] font-medium leading-5 text-muted-foreground",
}

/** 行内 HTML（`renderDocInline` 已做转义，仅插入受控标签）。 */
function InlineHtml({ text, breaks = false }: { text: string; breaks?: boolean }) {
  const html = breaks ? renderDocInline(text).replace(/\n/g, "<br />") : renderDocInline(text)
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

/* ═══════════ 正文搜索 / 纯文本粘贴（组件内实现，不新增依赖） ═══════════ */

const SEARCH_HIT_ATTR = "data-doc-hit"
const SEARCH_HIT_BG = "#fde68a"
const SEARCH_HIT_ACTIVE_BG = "#fbbf24"
const SEARCH_HIGHLIGHT_HITS = "doc-search-hits"
const SEARCH_HIGHLIGHT_ACTIVE = "doc-search-active"

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

/** CSS Custom Highlight 注册表（Electron/Chromium 有；jsdom 无，返回 null）。 */
function getHighlightRegistry(): HighlightRegistry | null {
  try {
    const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS
    return css?.highlights ?? null
  } catch {
    return null
  }
}

type HighlightConstructor = new (...ranges: Range[]) => unknown

function getHighlightConstructor(): HighlightConstructor | null {
  try {
    const ctor = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight
    return typeof ctor === "function" ? ctor : null
  } catch {
    return null
  }
}

/** 在元素文本节点里查找全部命中（大小写不敏感）；Range 供编辑态高亮与计数共用。 */
export function findTextRanges(root: HTMLElement, query: string): Range[] {
  const needle = String(query ?? "").trim()
  if (!needle) return []
  const lower = needle.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node.nodeValue ?? ""
    if (text) {
      const hay = text.toLowerCase()
      let at = hay.indexOf(lower)
      while (at >= 0) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        ranges.push(range)
        at = hay.indexOf(lower, at + needle.length)
      }
    }
    node = walker.nextNode()
  }
  return ranges
}

/** 清掉上一次预览高亮（只解除 <mark>，不动正文文本）。 */
function clearPreviewHighlights(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`mark[${SEARCH_HIT_ATTR}]`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  })
  root.normalize()
}

/**
 * 预览态高亮：只改 `dangerouslySetInnerHTML` 容器内部的文本节点，
 * React 不跟踪这些子节点，因此不会破坏 diff；返回的 marks 顺序即上一个/下一个的定位顺序。
 */
function markPreviewText(root: HTMLElement, query: string): HTMLElement[] {
  const needle = String(query ?? "").trim()
  if (!needle) return []
  const lower = needle.toLowerCase()
  const marks: HTMLElement[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? ""
    if (!text) continue
    const hay = text.toLowerCase()
    let at = hay.indexOf(lower)
    if (at < 0) continue
    const frag = document.createDocumentFragment()
    let cursor = 0
    while (at >= 0) {
      if (at > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, at)))
      const mark = document.createElement("mark")
      mark.setAttribute(SEARCH_HIT_ATTR, String(marks.length))
      mark.style.backgroundColor = SEARCH_HIT_BG
      mark.style.color = "inherit"
      mark.style.borderRadius = "2px"
      mark.appendChild(document.createTextNode(text.slice(at, at + needle.length)))
      frag.appendChild(mark)
      marks.push(mark)
      cursor = at + needle.length
      at = hay.indexOf(lower, cursor)
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
    textNode.parentNode?.replaceChild(frag, textNode)
  }
  return marks
}

/** 滚动容器内把命中块滚到中间（rect 为 0 时跳过，兼容 jsdom）。 */
function scrollRectIntoView(scroller: HTMLElement | null, rect: { top: number; height: number } | null): void {
  if (!scroller || !rect || !rect.height) return
  const box = scroller.getBoundingClientRect()
  if (!box.height) return
  scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2
}

/** 剪贴板文本规范化：统一换行、去除 NBSP/零宽字符与尾随空行（避免多出空段）。 */
export function normalizePastedText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\n+$/, "")
}

/** 纯文本 → 仅含 `<br>` 的受控 HTML（换行保留，所有字符先转义；不引入样式标签）。 */
function plainTextToBrHtml(plain: string): string {
  const escape = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  return plain.split("\n").map(escape).join("<br>")
}

/**
 * 在 contenteditable 当前选区插入纯文本：优先走原生 `insertText`（单行）/
 * 受控 `<br>` HTML（多行，保留原生 undo），不可用时按行插入文本节点 + `<br>`。
 * 剪贴板 HTML 从不进入编辑器，因此不会带入 span/style/颜色。
 */
export function insertPlainTextAtSelection(text: string, root: HTMLElement): boolean {
  const plain = normalizePastedText(text)
  if (!plain) return false
  const selection = typeof window !== "undefined" ? window.getSelection() : null
  let range: Range | null = null
  if (selection && selection.rangeCount > 0) {
    const candidate = selection.getRangeAt(0)
    if (root.contains(candidate.commonAncestorContainer)) range = candidate
  }
  if (!range) {
    range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
  }

  // 原生编辑命令能写进浏览器 undo 栈；多行用转义后的 <br>，避免 Chromium 生成 <div> 包装。
  if (selection && typeof document.execCommand === "function") {
    try {
      selection.removeAllRanges()
      selection.addRange(range)
      const inserted =
        plain.includes("\n")
          ? document.execCommand("insertHTML", false, plainTextToBrHtml(plain))
          : document.execCommand("insertText", false, plain)
      if (inserted) return true
    } catch {
      // 命令不可用（jsdom/只读）时走手工插入。
    }
  }

  range.deleteContents()
  const frag = document.createDocumentFragment()
  plain.split("\n").forEach((line, index) => {
    if (index > 0) frag.appendChild(document.createElement("br"))
    if (line) frag.appendChild(document.createTextNode(line))
  })
  const last = frag.lastChild
  range.insertNode(frag)
  if (selection && last) {
    const caret = document.createRange()
    caret.setStartAfter(last)
    caret.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caret)
  }
  return true
}

/**
 * 段落/标题微改（悬停出现 ✎，E2E 锚点 data-testid="doc-micro-edit"）。
 * 保存时按解析块的行号区间替换原文，不再用 split/join 破坏表格与列表结构。
 */
function MicroEditBlock({
  block,
  index,
}: {
  block: DocHeadingBlock | DocParagraphBlock
  index: number
}) {
  const setDraft = useDocsStore((s) => s.setDraft)
  const [value, setValue] = useState(block.text)
  const [open, setOpen] = useState(false)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setValue(block.text)
  }

  async function apply() {
    const next = value.trim()
    if (!next || next === block.text) {
      setOpen(false)
      return
    }
    const st = useDocsStore.getState()
    const lines = String(st.docContent).replace(/\r\n?/g, "\n").split("\n")
    if (block.start < 0 || block.end < block.start || block.end >= lines.length) {
      setOpen(false)
      return
    }
    const replacement =
      block.kind === "heading"
        ? [`${"#".repeat(Math.min(6, Math.max(1, block.level)))} ${next}`]
        : next.split("\n")
    lines.splice(block.start, block.end - block.start + 1, ...replacement)
    setDraft(lines.join("\n"))
    setOpen(false)
    const ok = await useDocsStore.getState().save()
    // 保存失败：保留草稿并进入编辑态，让用户可重试（错误已由 store toast）。
    if (!ok) useDocsStore.getState().setEditing(true)
  }

  const headingTag =
    block.kind === "heading" ? HEADING_TAGS[Math.min(6, Math.max(1, block.level)) - 1] : null
  const Tag = (headingTag ?? "p") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p"

  return (
    <div data-para-idx={index} className="group relative">
      {block.kind === "heading" ? (
        <Tag
          id={block.id}
          data-toc-id={block.id}
          className={HEADING_CLASS[Math.min(6, Math.max(1, block.level))]}
        >
          <InlineHtml text={block.text} />
        </Tag>
      ) : (
        <p className="whitespace-pre-wrap py-0.5 pr-5 text-xs leading-5 text-foreground/90">
          <InlineHtml text={block.text} breaks />
        </p>
      )}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          data-testid="doc-micro-edit"
          aria-label={`微改第 ${index + 1} 段`}
          title="微改本段"
          className="absolute -right-0.5 top-0 hidden items-center justify-center rounded border border-border bg-background p-1 text-muted-foreground shadow-sm hover:text-foreground group-hover:inline-flex"
        >
          <Pencil className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <p className="mb-1.5 text-[11px] font-medium text-foreground">微改第 {index + 1} 段</p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="微改内容"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") apply()
            }}
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" className="h-6 text-[11px]" onClick={apply}>
              应用
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** 列表项（有序/无序共用；深度以缩进呈现，避免额外依赖）。 */
function ListItems({ block }: { block: Extract<DocBlock, { kind: "list" }> }) {
  return (
    <>
      {block.items.map((item, i) => (
        <li
          key={`${i}`}
          style={item.depth ? { marginLeft: `${item.depth * 12}px` } : undefined}
          className="pl-0.5"
        >
          <InlineHtml text={item.text} />
        </li>
      ))}
    </>
  )
}

/** 单个 Markdown 块渲染。 */
function DocBlockView({ block, index }: { block: DocBlock; index: number }) {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      return <MicroEditBlock block={block} index={index} />
    case "list":
      return block.ordered ? (
        <ol
          start={block.startNumber !== 1 ? block.startNumber : undefined}
          className="my-1 list-decimal space-y-0.5 pl-5 text-xs leading-5"
        >
          <ListItems block={block} />
        </ol>
      ) : (
        <ul className="my-1 list-disc space-y-0.5 pl-5 text-xs leading-5">
          <ListItems block={block} />
        </ul>
      )
    case "code":
      return (
        <pre
          data-doc-code
          className="my-1.5 overflow-x-auto rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-4"
        >
          <code className={block.lang ? `language-${block.lang.replace(/[^\w-]/g, "")}` : undefined}>
            {block.text}
          </code>
        </pre>
      )
    case "table":
      return (
        <div className="my-1.5 max-w-full overflow-x-auto rounded-md border border-border">
          {/* min-w-max：列宽按内容撑开，窄面板下横向滚动，不把中文逐字压成一行。 */}
          <table className="min-w-max border-collapse text-[11px]">
            <thead className="bg-muted/60">
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={`h-${i}`}
                    style={block.align[i] ? { textAlign: block.align[i] as "left" | "center" | "right" } : undefined}
                    className="whitespace-nowrap border-b border-r border-border px-1.5 py-1 text-left font-medium last:border-r-0"
                  >
                    <InlineHtml text={cell} breaks />
                  </th>
                ))}
              </tr>
            </thead>
            {block.rows.length ? (
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={`r-${r}`} className="odd:bg-background even:bg-muted/20">
                    {row.map((cell, c) => (
                      <td
                        key={`c-${r}-${c}`}
                        style={block.align[c] ? { textAlign: block.align[c] as "left" | "center" | "right" } : undefined}
                        className="whitespace-nowrap border-r border-t border-border px-1.5 py-1 align-top last:border-r-0"
                      >
                        <InlineHtml text={cell} breaks />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      )
    case "quote":
      return (
        <blockquote className="my-1.5 border-l-2 border-border pl-2 text-[11px] leading-5 text-muted-foreground">
          <InlineHtml text={block.text} breaks />
        </blockquote>
      )
    case "hr":
      return <hr className="my-2 border-border" />
    default:
      return null
  }
}

export default function DocEditor({ onSaved }: DocEditorProps) {
  const docContent = useDocsStore((s) => s.docContent)
  const draft = useDocsStore((s) => s.draft)
  const editing = useDocsStore((s) => s.editing)
  const saving = useDocsStore((s) => s.saving)
  const loading = useDocsStore((s) => s.loading)
  const lastError = useDocsStore((s) => s.lastError)
  const tab = useDocsStore((s) => s.tab)
  const beginEdit = useDocsStore((s) => s.beginEdit)
  const discard = useDocsStore((s) => s.discard)
  const save = useDocsStore((s) => s.save)
  const setDraft = useDocsStore((s) => s.setDraft)

  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const previewMarksRef = useRef<HTMLElement[]>([])
  const editRangesRef = useRef<Range[]>([])
  const previewScrollRef = useRef(0)

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [hitCount, setHitCount] = useState(0)

  /**
   * 编辑区挂载时灌入 draft：contenteditable 的文本由浏览器维护，React 不渲染其子节点。
   * 编辑区与预览区使用不同 key（见 JSX），退出编辑即卸载整个节点，手动写入的文本不会
   * 被预览复用；取消时也不再回写任何 DOM，预览完全由 React 按 docContent 重建。
   */
  const attachEditArea = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node
    if (!node) return
    node.innerText = useDocsStore.getState().draft
    node.focus()
  }, [])

  // 退出编辑（取消/保存）后预览是新节点：恢复进入编辑前的滚动位置，避免阅读位置丢失。
  useEffect(() => {
    if (editing) return
    const root = previewRef.current
    if (root) root.scrollTop = previewScrollRef.current
  }, [editing])

  // 进入编辑前记录预览滚动位置（此时预览仍挂载）。
  function handleBeginEdit() {
    previewScrollRef.current = previewRef.current?.scrollTop ?? 0
    beginEdit()
  }

  const dirty = draft !== docContent
  const blocks = useMemo(() => parseDocBlocks(editing ? draft : docContent), [editing, draft, docContent])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery("")
    setActiveIndex(0)
    setHitCount(0)
    previewMarksRef.current = []
    editRangesRef.current = []
    if (editing) bodyRef.current?.focus()
  }, [editing])

  // 打开搜索栏后聚焦输入框；再次按 Ctrl+F 时由键盘处理器直接 focus/select。
  useEffect(() => {
    if (!searchOpen) return
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [searchOpen])

  // Ctrl/Cmd+F 只在文档面板内生效；Esc 关闭搜索并截断，避免顺带关掉文档面板/独立窗口。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && searchOpen) {
        const target = event.target instanceof Node ? event.target : null
        const root = rootRef.current
        if (target && target !== document.body && root && !root.contains(target)) return
        // 微改 Popover / 导出菜单打开时让它们先响应 Esc，避免一次关闭两层。
        if (root?.querySelector('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]')) return
        event.preventDefault()
        event.stopPropagation()
        closeSearch()
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return
      const root = rootRef.current
      if (!root) return
      const active = document.activeElement
      const panel = root.closest('[data-testid="docs-panel"], [data-testid="doc-window"]') ?? root
      if (active && active !== document.body && !panel.contains(active)) return
      event.preventDefault()
      event.stopPropagation()
      if (searchOpen) {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else {
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [closeSearch, searchOpen])

  // 预览态：把命中文本包进 <mark>（只改 dangerouslySetInnerHTML 内部节点）。
  useEffect(() => {
    if (editing) return
    const root = previewRef.current
    if (!root) return
    clearPreviewHighlights(root)
    previewMarksRef.current = []
    if (!searchOpen) return
    const marks = markPreviewText(root, query)
    previewMarksRef.current = marks
    setHitCount(marks.length)
  }, [blocks, editing, query, searchOpen])

  // 命中数变化时夹住下标，渲染时直接用（避免再写回 state 造成级联渲染）。
  const currentIndex = hitCount > 0 ? Math.min(Math.max(0, activeIndex), hitCount - 1) : 0

  // 预览态：上一个/下一个只改已建 <mark> 的底色并滚动，不重建 DOM。
  useEffect(() => {
    if (editing || !searchOpen) return
    const marks = previewMarksRef.current
    if (!marks.length) return
    const index = Math.min(currentIndex, marks.length - 1)
    marks.forEach((mark, i) => {
      const active = i === index
      mark.setAttribute("data-active", active ? "true" : "false")
      mark.style.backgroundColor = active ? SEARCH_HIT_ACTIVE_BG : SEARCH_HIT_BG
    })
    scrollRectIntoView(previewRef.current, marks[index]?.getBoundingClientRect() ?? null)
  }, [currentIndex, editing, query, searchOpen])

  // 编辑态：Range + CSS Custom Highlight，不向 contenteditable 注入任何节点。
  useEffect(() => {
    if (!editing) return
    const root = bodyRef.current
    const registry = getHighlightRegistry()
    const HighlightCtor = getHighlightConstructor()
    const clear = () => {
      if (!registry) return
      registry.delete(SEARCH_HIGHLIGHT_HITS)
      registry.delete(SEARCH_HIGHLIGHT_ACTIVE)
    }
    if (!root || !searchOpen) {
      editRangesRef.current = []
      clear()
      return clear
    }
    const ranges = findTextRanges(root, query)
    editRangesRef.current = ranges
    setHitCount(ranges.length)
    if (registry && HighlightCtor && ranges.length) {
      try {
        registry.set(SEARCH_HIGHLIGHT_HITS, new HighlightCtor(...ranges))
      } catch {
        // 高亮失败不影响计数与跳转。
      }
    } else {
      clear()
    }
    return clear
  }, [draft, editing, query, searchOpen])

  // 编辑态：当前命中单独一层高亮并滚动到视线中间。
  useEffect(() => {
    if (!editing || !searchOpen) return
    const ranges = editRangesRef.current
    if (!ranges.length) return
    const index = Math.min(currentIndex, ranges.length - 1)
    const active = ranges[index]
    const registry = getHighlightRegistry()
    const HighlightCtor = getHighlightConstructor()
    if (registry && HighlightCtor) {
      try {
        registry.set(SEARCH_HIGHLIGHT_ACTIVE, new HighlightCtor(active))
      } catch {
        // 同上，高亮失败静默。
      }
    }
    const rect = typeof active.getBoundingClientRect === "function" ? active.getBoundingClientRect() : null
    scrollRectIntoView(bodyRef.current, rect)
  }, [currentIndex, draft, editing, query, searchOpen])

  function stepMatch(delta: number) {
    if (hitCount <= 0) return
    setActiveIndex((currentIndex + delta + hitCount) % hitCount)
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeSearch()
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      stepMatch(event.shiftKey ? -1 : 1)
    }
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    // 无条件阻止默认粘贴：即使剪贴板只有 HTML，也不再把它塞进编辑器。
    event.preventDefault()
    const text = event.clipboardData?.getData("text/plain") ?? ""
    if (!text) return
    const root = bodyRef.current
    if (!root) return
    if (insertPlainTextAtSelection(text, root)) {
      setDraft(root.innerText ?? root.textContent ?? "")
    }
  }

  async function handleSave() {
    const ok = await save()
    if (ok) onSaved?.()
  }

  const countLabel = query.trim() && hitCount > 0 ? `${currentIndex + 1} / ${hitCount}` : "0 / 0"

  return (
    <div ref={rootRef} data-testid="doc-editor" className="flex min-h-0 flex-1 flex-col gap-2">
      <style>{`
        ::highlight(${SEARCH_HIGHLIGHT_HITS}) { background-color: ${SEARCH_HIT_BG}; color: inherit; }
        ::highlight(${SEARCH_HIGHLIGHT_ACTIVE}) { background-color: ${SEARCH_HIT_ACTIVE_BG}; color: inherit; }
        [data-testid="doc-preview"] img { max-width: 100%; height: auto; border-radius: 4px; }
      `}</style>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-xs font-medium">正文</span>
        {dirty ? (
          <Badge variant="secondary" className="text-[10px]">
            未保存
          </Badge>
        ) : null}
        {saving ? (
          <Badge variant="secondary" className="text-[10px]">
            保存中…
          </Badge>
        ) : null}
        {loading ? (
          <Badge variant="secondary" className="text-[10px]">
            加载中…
          </Badge>
        ) : null}
        <div className="min-w-2 flex-1" />
        <Button
          variant={searchOpen ? "secondary" : "ghost"}
          size="icon"
          className="size-7"
          aria-label="搜索正文"
          aria-expanded={searchOpen}
          aria-controls="doc-searchbar"
          title="搜索正文（Ctrl+F）"
          data-testid="doc-search-toggle"
          onClick={() => {
            if (searchOpen) closeSearch()
            else setSearchOpen(true)
          }}
        >
          <Search className="size-3.5" />
        </Button>
        {editing ? (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={saving} onClick={discard}>
              取消
            </Button>
            <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={handleSave}>
              保存
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleBeginEdit}>
            进入编辑
          </Button>
        )}
      </div>
      {searchOpen ? (
        <div
          id="doc-searchbar"
          data-testid="doc-searchbar"
          role="search"
          className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/30 px-1.5 py-1"
        >
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            data-testid="doc-search-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="在正文中查找"
            aria-label="在正文中查找"
            className="h-6 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none"
          />
          <span
            data-testid="doc-search-count"
            className="min-w-12 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground"
          >
            {countLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="上一个匹配"
            title="上一个匹配（Shift+Enter）"
            data-testid="doc-search-prev"
            disabled={hitCount === 0}
            onClick={() => stepMatch(-1)}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="下一个匹配"
            title="下一个匹配（Enter）"
            data-testid="doc-search-next"
            disabled={hitCount === 0}
            onClick={() => stepMatch(1)}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="关闭搜索"
            title="关闭搜索（Esc）"
            data-testid="doc-search-close"
            onClick={closeSearch}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}
      {lastError ? (
        <p role="alert" className="shrink-0 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {lastError}
        </p>
      ) : null}
      {editing ? (
        <div
          key="doc-edit"
          ref={attachEditArea}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="文档编辑区"
          data-testid="doc-edit-area"
          onInput={(e) => setDraft(e.currentTarget.innerText ?? "")}
          onPaste={handlePaste}
          className="min-h-24 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-2 text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : (
        <div
          key="doc-preview"
          ref={previewRef}
          data-testid="doc-preview"
          data-doc-scroll="true"
          className="min-h-0 flex-1 overflow-y-auto rounded-md px-0.5"
        >
          {blocks.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              {loading ? "正在加载…" : tab === "latest" ? "暂无最新需求" : "暂无文档内容"}
            </p>
          ) : (
            blocks.map((block, i) => <DocBlockView key={`${block.kind}-${i}`} block={block} index={i} />)
          )}
        </div>
      )}
    </div>
  )
}
