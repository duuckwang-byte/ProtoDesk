/**
 * src/renderer/features/docs/DocsPanel.tsx — W3-03 文档面板内容。
 *
 * 经 DocsPanelHost / DocWindow 在三种形态下渲染（§8.1：PC 右侧悬浮弹层 / 移动端 Flex 挤压），
 * 形态由 props 传入，本组件只做内容（头部动作 + Tab + 左侧目录 + 编辑器），
 * 不做定位/遮罩：
 * - variant === "overlay"：PC 悬浮（宿主提供 fixed 定位 + 遮罩 + Esc 关闭，绝不挤压原型）；
 *   目录由宿主渲染为文档左侧同层级的独立 fixed 面板，本组件经 portal 注入目录内容；
 * - variant === "window"：独立文档窗口，目录与正文左右 flex 常驻（220px），不收起、不遮挡；
 * - variant === "inline"：移动端行内挤压（宿主提供 Flex 宽度约束），目录折叠为抽屉。
 *
 * 目录：PC 常驻显示、无收起按钮，与文档面板等高并内部滚动；移动端为覆盖式抽屉，
 * 头部 X / Esc / 选择条目均可关闭。条目固定 24px 高、目录区独立滚动；
 * 当前项随正文滚动高亮（scroll 计算，data-active）。
 * 点击条目经 `data-toc-id` 在正文滚动容器内定位，不再堆在正文上方。
 *
 * 头部：文档标题 + 独立窗口（docs-store.useDocWindow）+ 导出 PNG/PDF/MD
 * （复用 renderDocPreview / buildDocExportPayload，不修改 ExportMenu）。
 *
 * 数据：
 * - 挂载即加载功能说明（loadDesc：优先 source.md，缺失读 sandbox:read-file）；
 * - 切「最新需求」按当前 SourceRef.sandboxDir 读 doc:read-latest；
 * - 切源时按当前 Tab 重新加载，旧读回包由 docs-store 的序号/归属守卫丢弃。
 *
 * 本组件不另设窗口级 Esc 监听，避免与 MainWindow 的 closeTopmost 栈冲突。
 */

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Download, ListTree, X } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button, buttonVariants } from "@/components/ui/button"
import { Confirm } from "@/components/overlays/Confirm"
import { cn } from "@/lib/utils"
import { invokeProtoMethod } from "@/lib/ipc"
import { useSourcesStore } from "@/stores/sources-store"
import {
  useDocsStore,
  extractDocHeadings,
  isDocWindowMode,
  renderDocPreview,
  useDocWindow,
  type DocGuardIntent,
} from "@/stores/docs-store"
import { useUiStore } from "@/stores/ui-store"
import { buildDocExportPayload } from "@/features/export/export-assets"
import DocToc from "@/features/docs/DocToc"
import DocEditor from "@/features/docs/DocEditor"

/** 面板形态（与 DocsPanelHost 的 data-variant 口径一致）。 */
export type DocsPanelVariant = "overlay" | "inline" | "window"

export interface DocsPanelProps {
  /** 形态：PC 悬浮 overlay / 移动端挤压 inline / 独立文档窗 window，由宿主传入。 */
  variant: DocsPanelVariant
  /** 关闭回调（可选；默认不处理，由宿主/顶层栈关闭）。 */
  onClose?: () => void
  /**
   * PC overlay 的目录 DOM 宿主（DocsPanelHost 渲染的独立 fixed 面板）。
   * 提供时目录经 portal 注入同一层级；缺省时回退为文档面板内 absolute 目录。
   */
  tocHost?: HTMLElement | null
}

type DocExportKind = "png" | "pdf" | "md"

/** 守卫文案：confirmText=放弃修改 / cancelText=继续编辑。 */
function guardTextOf(guard: DocGuardIntent | null): { title: string; description: string } {
  if (!guard) return { title: "", description: "" }
  if (guard.kind === "tab") {
    return {
      title: "未保存的草稿",
      description: `当前文档还有未保存的修改。切换到「${
        guard.tab === "latest" ? "最新需求" : "功能说明"
      }」会放弃这些修改；选择“继续编辑”可留在当前编辑状态。`,
    }
  }
  if (guard.kind === "source") {
    // 文案必须指向目标原型（toName），旧文案误用来源名会让人以为切换失败/切回上一个。
    const nextName = String(guard.toName ?? "").trim()
    const switched =
      nextName && nextName !== guard.name
        ? `已切换到「${nextName}」。`
        : `已离开「${guard.name}」。`
    return {
      title: "未保存的草稿",
      description: `${switched}你在「${guard.name}」的修改尚未保存，已暂存：选择“继续编辑”会保留草稿（切回「${guard.name}」可继续编辑），选择“放弃修改”将丢弃这些修改。`,
    }
  }
  if (guard.kind === "close-window") {
    return {
      title: "未保存的草稿",
      description: "关闭独立文档窗口会放弃未保存的修改；选择“继续编辑”可留在当前编辑状态。",
    }
  }
  return {
    title: "未保存的草稿",
    description: "关闭文档面板会放弃未保存的修改；选择“继续编辑”可留在当前编辑状态。",
  }
}

/** Markdown 本地下载（与 ExportMenu 的文档 Markdown 导出口径一致）。 */
function downloadText(filename: string, text: string, mime = "text/markdown;charset=utf-8"): void {
  try {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch {
    useUiStore.getState().pushToast({ title: "导出文件创建失败。" })
  }
}

export default function DocsPanel({ variant, onClose, tocHost }: DocsPanelProps) {
  const tab = useDocsStore((s) => s.tab)
  const setTab = useDocsStore((s) => s.setTab)
  const docContent = useDocsStore((s) => s.docContent)
  const docTitle = useDocsStore((s) => s.docTitle)
  const setToc = useDocsStore((s) => s.setToc)
  const toc = useDocsStore((s) => s.toc)
  const editing = useDocsStore((s) => s.editing)
  const search = useDocsStore((s) => s.search)
  const setSearch = useDocsStore((s) => s.setSearch)
  const loadDesc = useDocsStore((s) => s.loadDesc)
  const loadLatest = useDocsStore((s) => s.loadLatest)
  const docWindowBusy = useDocWindow((s) => s.busy)
  const openDocWindow = useDocWindow((s) => s.open)
  const pendingGuard = useDocsStore((s) => s.pendingGuard)
  const resolveGuard = useDocsStore((s) => s.resolveGuard)
  const pushToast = useUiStore((s) => s.pushToast)
  const source = useSourcesStore((s) => s.currentSource)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState<DocExportKind | null>(null)
  /** 目录当前阅读位置（随正文滚动更新，data-active 由它驱动）。 */
  const [activeHeading, setActiveHeading] = useState("")
  /** 上一个源目录：用于检测「切原型」并把旧草稿暂存。 */
  const prevDirRef = useRef<string>(useDocsStore.getState().sourceDir || source?.sandboxDir || "")
  /** 独立窗确认放弃后的放行标记（避免 beforeunload 再次拦截）。 */
  const allowWindowCloseRef = useRef(false)
  /** 正在跳转的目标锚点：平滑滚动期间锁住高亮，避免途经标题把目标顶掉。 */
  const jumpRef = useRef<{ id: string; until: number } | null>(null)

  const inline = variant === "inline"
  const windowVariant = variant === "window"
  const overlay = variant === "overlay"
  const inDocWindow = isDocWindowMode()
  const guardText = guardTextOf(pendingGuard)

  // 切原型守卫（必须早于 loadDesc effect）：旧源有未保存草稿时先按「目录 + Tab」暂存，
  // 再挂起 Confirm。Sources 层（Sidebar.selectSource）不在本域可改范围，故采用
  // “暂存 + 确认放弃/继续编辑”策略：取消后草稿保留，切回该原型自动恢复编辑态。
  useEffect(() => {
    const nextDir = String(source?.sandboxDir ?? "").trim()
    const prevDir = prevDirRef.current
    if (!nextDir) {
      prevDirRef.current = ""
      return
    }
    if (!prevDir || nextDir === prevDir) {
      prevDirRef.current = nextDir
      return
    }
    const doc = useDocsStore.getState()
    if (doc.draft !== doc.docContent) {
      const key = doc.stashDraft()
      if (key) {
        const prevName =
          useSourcesStore
            .getState()
            .sources.find((item) => item.sandboxDir === prevDir)?.displayName ||
          prevDir.split(/[\\/]/).filter(Boolean).pop() ||
          "上一个原型"
        // 目标原型名：守卫文案写“已切换到「我的」”，不能沿用来源名。
        const nextName =
          String(source?.displayName ?? "").trim() ||
          String(source?.name ?? "").replace(/\.(html?|md)$/i, "").trim() ||
          nextDir.split(/[\\/]/).filter(Boolean).pop() ||
          ""
        useDocsStore.setState({
          pendingGuard: {
            kind: "source",
            dir: prevDir,
            name: prevName,
            key,
            ...(nextName ? { toName: nextName } : {}),
          },
        })
      }
    }
    prevDirRef.current = nextDir
  }, [source?.sandboxDir])

  // 挂载 / 切源：加载功能说明（docs-store 同目录命中缓存，不会覆盖本地已保存内容）。
  useEffect(() => {
    void loadDesc(source)
  }, [source, loadDesc])

  // 挂载 / 切源 / 切 Tab：最新需求按当前 dir 读取。
  useEffect(() => {
    if (tab !== "latest") return
    void loadLatest(source?.sandboxDir ?? "")
  }, [tab, source?.sandboxDir, source?.__ver, loadLatest])

  // 正文变化时重建 TOC（与预览共用块解析，id 与 data-toc-id 同源）。
  useEffect(() => {
    setToc(extractDocHeadings(docContent))
  }, [docContent, setToc])

  /**
   * 目录当前项：监听正文滚动容器，取「标题 top <= 容器顶 + 标题高度」的最后一个标题。
   *
   * 阈值不再写死 8px：跳转落点通常只比容器顶低 6~10px，目标标题可能因此被判成
   * “还没到”而把高亮留在上一条。这里用标题自身高度作阈值（最少 12px），跳转后
   * 目标标题只要落在容器顶部附近即算命中。
   * 跳转进行中（平滑滚动）由 jumpRef 锁定目标，滚动途经的标题不会抢走高亮。
   * 用 scroll 计算而非 IntersectionObserver（jsdom 无 IO，且长文 88 条更稳定）。
   */
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const scroller = root.querySelector<HTMLElement>("[data-doc-scroll]")
    if (!scroller) {
      setActiveHeading("")
      return
    }
    jumpRef.current = null
    let frame = 0
    const compute = () => {
      frame = 0
      const headings = Array.from(scroller.querySelectorAll<HTMLElement>("[data-toc-id]"))
      if (!headings.length) {
        setActiveHeading("")
        return
      }
      // 跳转动画未结束前，高亮锁在目标上（含目标尚在下方/上方的情况）。
      const jump = jumpRef.current
      if (jump) {
        if (Date.now() < jump.until) {
          setActiveHeading((prev) => (prev === jump.id ? prev : jump.id))
          return
        }
        jumpRef.current = null
      }
      const top = scroller.getBoundingClientRect().top
      let current = headings[0].getAttribute("data-toc-id") ?? ""
      for (const heading of headings) {
        const rect = heading.getBoundingClientRect()
        // 最少 12px（覆盖跳转落点），最多 48px（避免异常高/量测异常把下一条提前算进来）。
        const tolerance = Math.max(12, Math.min(48, rect.height || 0))
        if (rect.top - top <= tolerance) {
          current = heading.getAttribute("data-toc-id") ?? current
        } else {
          break
        }
      }
      setActiveHeading((prev) => (prev === current ? prev : current))
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(compute)
    }
    const onScrollEnd = () => {
      // 平滑滚动结束：解除跳转锁定，按最终位置重算（目标已在顶部附近，仍会命中）。
      if (!jumpRef.current) return
      jumpRef.current = null
      compute()
    }
    compute()
    scroller.addEventListener("scroll", onScroll, { passive: true })
    scroller.addEventListener("scrollend", onScrollEnd)
    window.addEventListener("resize", onScroll)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      scroller.removeEventListener("scroll", onScroll)
      scroller.removeEventListener("scrollend", onScrollEnd)
      window.removeEventListener("resize", onScroll)
    }
  }, [docContent, editing, tab])

  // 守卫 Confirm 打开时 Esc = 取消（保留编辑态），不能顺带把文档面板/独立窗关掉。
  useEffect(() => {
    if (!pendingGuard) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      resolveGuard(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [pendingGuard, resolveGuard])

  /**
   * 移动端目录抽屉的 Esc：只收起抽屉，不把文档面板一起关掉。
   *
   * MainWindow 在 window 冒泡阶段用 closeTopmost() 关文档，这里必须在捕获阶段
   * 截断（stopImmediatePropagation）且仅当抽屉是文档内最上层：
   * - Confirm / AI / 设置 / Git / 导出 / 微改 Popover 打开时让它们先处理；
   * - 正文搜索打开时 DocEditor 自己的捕获监听负责关搜索（同为分层处理）。
   */
  useEffect(() => {
    if (!inline || !drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (useDocsStore.getState().pendingGuard) return
      const ui = useUiStore.getState()
      if (ui.aiOpen || ui.settingsTab !== null || ui.gitOpen || ui.exportOpen) return
      if (
        typeof document !== "undefined" &&
        document.querySelector('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]')
      ) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setDrawerOpen(false)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [inline, drawerOpen])

  // 独立文档窗：关闭（Esc / Alt+F4 / 系统关闭）前拦下未保存草稿，走 Confirm。
  useEffect(() => {
    if (!inDocWindow) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowWindowCloseRef.current) return
      const doc = useDocsStore.getState()
      if (doc.draft === doc.docContent) return
      event.preventDefault()
      event.returnValue = false
      useDocsStore.setState({ pendingGuard: { kind: "close-window" } })
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [inDocWindow])

  function handleTab(next: string) {
    // 有未保存草稿时 setTab 只挂起 pendingGuard，Confirm 确认放弃后才真正切换。
    setTab(next === "latest" ? "latest" : "desc")
    setDrawerOpen(false)
  }

  /** 守卫确认：放弃草稿并执行挂起动作；独立窗关闭需放行 beforeunload 后再次 close。 */
  function handleGuardConfirm() {
    const kind = useDocsStore.getState().pendingGuard?.kind
    resolveGuard(true)
    if (kind === "close-window") {
      allowWindowCloseRef.current = true
      window.close()
    }
  }

  /** 目录跳转：只在正文滚动容器内滚动到同 id 标题。 */
  function handleJump(anchorId: string) {
    // 立即高亮目标，并在平滑滚动窗口内锁定，避免滚过中间标题时高亮来回跳。
    jumpRef.current = { id: anchorId, until: Date.now() + 900 }
    setActiveHeading(anchorId)
    try {
      const root = bodyRef.current
      if (!root) return
      const el =
        Array.from(root.querySelectorAll<HTMLElement>("[data-toc-id]")).find(
          (node) => node.getAttribute("data-toc-id") === anchorId,
        ) ?? null
      if (!el) return
      const scroll =
        el.closest<HTMLElement>("[data-doc-scroll]") ??
        root.querySelector<HTMLElement>("[data-doc-scroll]")
      if (scroll && scroll.contains(el)) {
        const top =
          el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 6
        if (typeof scroll.scrollTo === "function") {
          scroll.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
        } else {
          scroll.scrollTop = Math.max(0, top)
        }
      } else if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" })
      }
    } catch {
      // 定位失败静默（旧 flashTitle 同理不抛错）。
    }
  }

  async function handleOpenWindow() {
    if (docWindowBusy) return
    await openDocWindow()
  }

  async function exportDoc(kind: "png" | "pdf") {
    const st = useDocsStore.getState()
    const text = String(st.docContent ?? "")
    if (!text.trim()) {
      pushToast({ title: "当前文档为空，无需导出。" })
      return
    }
    const payload = buildDocExportPayload(st.docTitle, renderDocPreview(text))
    if (!payload) {
      pushToast({ title: "当前文档渲染结果为空，无法导出。" })
      return
    }
    setExportBusy(kind)
    try {
      const channel = kind === "png" ? "exportLongImage" : "exportPdf"
      const r = (await invokeProtoMethod("doc", channel, payload)) as {
        ok: boolean
        error?: string
        cancelled?: boolean
      }
      if (!r) return
      if (r.cancelled) return
      if (r.ok) {
        pushToast({ title: kind === "png" ? "文档长图已导出。" : "文档 PDF 已导出。" })
      } else {
        pushToast({ title: `文档导出失败：${r.error || "未知错误"}` })
      }
    } finally {
      setExportBusy(null)
    }
  }

  function exportMd() {
    const st = useDocsStore.getState()
    const text = String(st.docContent ?? "")
    if (!text.trim()) {
      pushToast({ title: "当前文档为空，无需导出。" })
      return
    }
    setExportBusy("md")
    try {
      const name = String(st.docTitle || "文档").replace(/[\\/:*?"<>|]/g, "_")
      downloadText(`${name}.md`, text, "text/markdown;charset=utf-8")
      pushToast({ title: "文档 Markdown 已导出。" })
    } finally {
      setExportBusy(null)
    }
  }

  /**
   * 目录内容：PC 独立面板 / 独立窗 / 移动端抽屉共用（搜索、高亮、跳转同源）。
   * close 仅在移动端抽屉传入；PC 与独立窗目录常驻，不提供收起/关闭按钮。
   */
  function tocBody(options?: {
    close?: { testId: string; label: string; title: string; onClose: () => void }
    onJump?: (id: string) => void
  }) {
    const close = options?.close
    return (
      <div data-testid="doc-toc-body" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 pb-1">
          <ListTree className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">目录</span>
          <span className="text-[10px] text-muted-foreground">{toc.length}</span>
          {close ? (
            <>
              <div className="min-w-1 flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={close.label}
                title={close.title}
                data-testid={close.testId}
                onClick={close.onClose}
              >
                <X className="size-4" />
              </Button>
            </>
          ) : null}
        </div>
        <DocToc
          items={toc}
          query={search}
          activeId={activeHeading}
          onQueryChange={setSearch}
          onJump={options?.onJump ?? handleJump}
        />
      </div>
    )
  }

  /** 独立窗目录：常驻 220px，与正文左右 flex，不收起、不遮挡。 */
  function TocAside() {
    return (
      <aside
        data-testid="doc-toc-sidebar"
        data-variant="window"
        aria-label="文档目录"
        className="flex w-[220px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-background p-2"
      >
        {tocBody()}
      </aside>
    )
  }

  /** 直接渲染 DocsPanel（无宿主目录容器）时的降级：面板内 absolute 目录。 */
  function TocFallback() {
    return (
      <aside
        data-testid="doc-toc-sidebar"
        data-variant="overlay"
        aria-label="文档目录"
        className="absolute inset-y-0 left-0 z-20 flex w-[220px] max-w-[80%] flex-col rounded-r-md border-r border-border bg-background p-2 shadow-lg"
      >
        {tocBody()}
      </aside>
    )
  }

  function TocDrawer() {
    return (
      <>
        {drawerOpen ? (
          <div
            data-testid="doc-toc-backdrop"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-10 bg-black/20"
          />
        ) : null}
        <aside
          id="doc-toc-drawer"
          data-testid="doc-toc-drawer"
          data-open={drawerOpen ? "true" : "false"}
          aria-hidden={!drawerOpen}
          // 关闭态整层不可聚焦/不可点击；父级 overflow-hidden 再裁掉平移出去的部分。
          inert={!drawerOpen}
          className={cn(
            "absolute bottom-0 left-0 top-0 z-20 flex w-[176px] max-w-full flex-col rounded-r-md border-r border-border bg-background p-2 shadow-lg transition-[transform,opacity] duration-200",
            drawerOpen
              ? "translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-[110%] opacity-0",
          )}
        >
          {tocBody({
            close: {
              testId: "doc-toc-close",
              label: "关闭目录",
              title: "关闭目录（Esc）",
              onClose: () => setDrawerOpen(false),
            },
            onJump: (id) => {
              handleJump(id)
              setDrawerOpen(false)
            },
          })}
        </aside>
      </>
    )
  }

  function renderWorkspace() {
    if (inline) {
      return (
        // overflow-hidden：移动端抽屉平移出面板左缘后必须被裁掉，不能浮在舞台上。
        <div data-testid="doc-toc-clip" className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              aria-expanded={drawerOpen}
              aria-controls="doc-toc-drawer"
              onClick={() => setDrawerOpen((v) => !v)}
            >
              <ListTree className="size-3.5" />
              目录
            </Button>
            <span className="truncate text-[10px] text-muted-foreground">{toc.length} 个标题</span>
          </div>
          {TocDrawer()}
          <div ref={bodyRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DocEditor />
          </div>
        </div>
      )
    }

    if (windowVariant) {
      return (
        <div data-testid="doc-window-workspace" className="flex min-h-0 flex-1 gap-2">
          {TocAside()}
          <div ref={bodyRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DocEditor />
          </div>
        </div>
      )
    }

    return (
      <div className="relative flex min-h-0 flex-1 gap-2">
        {tocHost ? null : TocFallback()}
        <div ref={bodyRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DocEditor />
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="docs-panel-content"
      data-variant={variant}
      className="flex min-h-0 flex-1 flex-col gap-2 p-3"
    >
      {/* 文档头部：标题 + 独立窗口 + 导出 PNG/PDF/MD 快捷入口。 */}
      <div data-testid="docs-head-actions" className="flex shrink-0 items-center gap-1">
        <span
          data-testid="docs-doc-title"
          title={docTitle}
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
        >
          {docTitle}
        </span>
        {!inDocWindow ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[11px]"
            disabled={docWindowBusy}
            aria-label="在独立窗口打开文档"
            title="独立窗口"
            onClick={() => void handleOpenWindow()}
          >
            <AppWindow className="size-3.5" />
            <span className={inline ? "sr-only" : undefined}>独立窗口</span>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="docs-export-menu"
            disabled={exportBusy !== null}
            aria-label="导出文档"
            title="导出 PNG / PDF / Markdown"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-1.5 text-[11px]")}
          >
            <Download className="size-3.5" />
            <span className={inline ? "sr-only" : undefined}>{exportBusy ? "导出中…" : "导出"}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>文档</DropdownMenuLabel>
            <DropdownMenuItem data-testid="docs-export-png" onSelect={() => void exportDoc("png")}>
              导出 PNG 长图
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="docs-export-pdf" onSelect={() => void exportDoc("pdf")}>
              导出 PDF
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="docs-export-md" onSelect={exportMd}>
              导出 Markdown
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs value={tab} onValueChange={handleTab} className="flex min-h-0 flex-1 flex-col gap-2">
        <TabsList aria-label="文档类型" className="grid shrink-0 grid-cols-2">
          <TabsTrigger value="desc">功能说明</TabsTrigger>
          <TabsTrigger value="latest">最新需求</TabsTrigger>
        </TabsList>
        <TabsContent value="desc" className="flex min-h-0 flex-1 flex-col gap-2">
          {renderWorkspace()}
        </TabsContent>
        <TabsContent value="latest" className="flex min-h-0 flex-1 flex-col gap-2">
          {renderWorkspace()}
        </TabsContent>
      </Tabs>

      {/* PC：目录注入宿主提供的独立 fixed 面板（与文档同级、位于左侧）；移动端/独立窗走各自 aside。 */}
      {overlay && tocHost ? createPortal(tocBody(), tocHost) : null}

      {/* 未保存草稿守卫：切 Tab / 切原型 / 关面板 / 关独立窗统一走这里。 */}
      <Confirm
        open={pendingGuard !== null}
        onOpenChange={(next) => {
          if (!next) resolveGuard(false)
        }}
        title={guardText.title}
        description={guardText.description}
        confirmText="放弃修改"
        cancelText="继续编辑"
        danger
        onConfirm={handleGuardConfirm}
      />
    </div>
  )
}
