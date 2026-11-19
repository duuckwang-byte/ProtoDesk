/**
 * src/renderer/features/docs/__tests__/docs-panel.test.tsx
 *
 * 覆盖 wave4 b-docs 四个 P2：
 * - TOC-SQUASH：目录条目固定 24px、shrink-0，nav 独立滚动；
 * - PANEL-WIDTH：PC 980px / 移动端 640px，PC 目录为文档左侧同层级独立 fixed 面板（220px）；
 * - TOC-ACTIVE：正文滚动时 data-active 跟随当前标题；
 * - 草稿守卫：切 Tab / 关面板 / 关独立窗都先 Confirm，取消保留编辑态。
 * 另覆盖移动端目录抽屉：X / Esc / 选择条目关闭，且 Esc 不关文档；
 * 独立窗 variant=window：目录与正文左右 flex、目录常驻不收起。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import DocsPanel from "@/features/docs/DocsPanel"
import DocsPanelHost from "@/components/shell/DocsPanelHost"
import { useAppStore } from "@/stores/app-store"
import { useDocsStore } from "@/stores/docs-store"
import { useSourcesStore, type SourceRef } from "@/stores/sources-store"
import { useUiStore } from "@/stores/ui-store"

const MD = [
  "# 第一章",
  "",
  "正文一",
  "",
  "## 第二章",
  "",
  "正文二",
  "",
  "## 第三章",
  "",
  "正文三",
].join("\n")

const SOURCE: SourceRef = {
  name: "首页.html",
  displayName: "首页",
  kind: "pc",
  sandboxDir: "/sandbox/A/首页",
  mainHtmlFile: "首页.html",
  mdFile: "首页.md",
  subPages: [],
  htmlFiles: ["首页.html"],
  content: "<html></html>",
  md: MD,
  pages: [],
  __ver: 0,
}

const DOCS_INITIAL = {
  docContent: "",
  draft: "",
  editing: false,
  toc: [],
  search: "",
  saving: false,
  loading: false,
  lastError: "",
  tab: "desc" as const,
  descContent: "",
  latestContent: "",
  descLoaded: false,
  latestLoaded: false,
  mirrorDir: "",
  mirrorTab: "desc" as const,
  mirrorContent: "",
  mirrorPending: false,
  sourceDir: "",
  sourceVer: 0,
  sourceName: "",
  sourceDisplayName: "",
  sourceMdFile: null,
  docTitle: "功能说明",
  draftStash: {},
  pendingGuard: null,
}

function installApi(): void {
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
    sandbox: {
      readFile: async () => ({ ok: false, error: "not-found" }),
      write: async () => ({ ok: true }),
    },
    doc: {
      readLatest: async () => ({ ok: true, content: "# 最新需求" }),
      writeLatest: async () => ({ ok: true }),
      mirrorPush: async () => ({ ok: true }),
      mirrorBack: async () => ({ ok: true }),
    },
    docwin: {
      open: async () => ({ ok: true, mode: "win" }),
      close: async () => ({ ok: true, mode: "panel" }),
      toggle: async () => ({ ok: true, mode: "win" }),
    },
  }
}

function seedPanel(overrides: Partial<typeof DOCS_INITIAL> = {}): void {
  useDocsStore.setState({
    ...DOCS_INITIAL,
    docContent: MD,
    draft: MD,
    descContent: MD,
    descLoaded: true,
    sourceDir: SOURCE.sandboxDir,
    sourceDisplayName: SOURCE.displayName,
    sourceName: SOURCE.name,
    docTitle: "首页 · 功能说明",
    ...overrides,
  })
  useSourcesStore.setState({
    project: "A",
    projects: [],
    sources: [SOURCE],
    currentSource: SOURCE,
    activeSubFile: "",
    activeContent: "",
    loading: false,
    error: "",
    pickerOpen: false,
  })
  useUiStore.setState({ docsOpen: true, toasts: [] })
}

beforeEach(() => {
  localStorage.clear()
  try {
    window.history.replaceState({}, "", "/")
  } catch {
    // jsdom 允许。
  }
  installApi()
  useDocsStore.setState(DOCS_INITIAL)
  useSourcesStore.setState({
    project: "",
    projects: [],
    sources: [],
    currentSource: null,
    activeSubFile: "",
    activeContent: "",
    loading: false,
    error: "",
    pickerOpen: false,
  })
  useUiStore.setState({ docsOpen: false, toasts: [] })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
})

describe("目录布局（P2-TOC-SQUASH / P2-PANEL-WIDTH）", () => {
  it("目录条目固定最小高度且不参与 flex 压缩，nav 独立滚动", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "overlay" }))

    const items = screen.getAllByTestId("doc-toc-item")
    expect(items.length).toBe(3)
    for (const item of items) {
      expect(item.className).toContain("h-6")
      expect(item.className).toContain("min-h-6")
      expect(item.className).toContain("shrink-0")
    }
    const nav = screen.getByTestId("doc-toc-nav")
    expect(nav.className).toContain("overflow-y-auto")
    expect(nav.className).toContain("min-h-0")
  })

  it("直接渲染（无宿主容器）时回退为面板内 absolute 目录，宽 220px", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "overlay" }))
    const sidebar = screen.getByTestId("doc-toc-sidebar")
    expect(sidebar.className).toContain("absolute")
    expect(sidebar.className).toContain("w-[220px]")
    expect(sidebar.className).not.toContain("shrink-0")
    // 正文容器仍可用（目录在面板内浮层，不占文档流）。
    expect(screen.getByTestId("doc-editor")).toBeTruthy()
  })
})

describe("PC 独立目录面板（同层级 / 左右相邻 / 常驻）", () => {
  it("目录与文档是兄弟节点且均为 fixed；目录在左、宽 220、与文档等高", async () => {
    seedPanel()
    useAppStore.setState({ kind: "pc" })
    render(createElement(DocsPanelHost))

    const panel = screen.getByTestId("docs-panel")
    const toc = screen.getByTestId("doc-toc-sidebar")
    // 同层级：两者是同一父节点下的兄弟（目录不是文档内部浮层）。
    expect(toc.parentElement).toBe(panel.parentElement)
    expect(panel.className).toContain("fixed")
    expect(toc.className).toContain("fixed")
    expect(toc.className).toContain("w-[220px]")
    expect(toc.className).toContain("top-12")
    expect(toc.className).toContain("bottom-4")
    expect(panel.className).toContain("top-12")
    expect(panel.className).toContain("bottom-4")
    // 相邻不重叠：目录右边界锚在文档宽 + 0.5rem 间隙之外（文档 right-4）。
    const right = toc.style.right
    expect(right).toContain("min(980px")
    expect(right).toContain("100vw")
    expect(right).toContain("rem")

    // 目录内容经 portal 同步注入宿主面板，未在文档面板里再渲染一套。
    expect(within(toc).getAllByTestId("doc-toc-item").length).toBe(3)
    expect(within(panel).queryByTestId("doc-toc-item")).toBeNull()
  })

  it("目录常驻：无收起按钮、无 TocRail，点击目录不关闭文档", async () => {
    seedPanel()
    useAppStore.setState({ kind: "pc" })
    render(createElement(DocsPanelHost))

    const panel = screen.getByTestId("docs-panel")
    const toc = screen.getByTestId("doc-toc-sidebar")
    expect(within(toc).queryByTestId("doc-toc-toggle")).toBeNull()
    expect(within(toc).queryByRole("button", { name: "收起目录" })).toBeNull()
    expect(within(panel).queryByTestId("doc-toc-toggle")).toBeNull()
    expect(screen.queryByRole("button", { name: "收起目录" })).toBeNull()

    await waitFor(() => expect(within(toc).getAllByTestId("doc-toc-item").length).toBe(3))
    fireEvent.click(within(toc).getAllByTestId("doc-toc-item")[1])
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(screen.getByTestId("docs-panel")).toBeTruthy()
  })

  it("1024 视口不越界：目录 left≥0，文档右侧不出屏，正文仍≥560px", () => {
    // 与 DocsPanelHost 的宽度契约一致：right-4(1rem) + 文档宽 + 0.5rem 间隙 + 220px 目录。
    const viewport = 1024
    const panelWidth = Math.min(980, viewport - 18 * 16)
    const panelLeft = viewport - 16 - panelWidth
    const tocRight = 16 + panelWidth + 8
    const tocLeft = viewport - tocRight - 220
    expect(panelWidth).toBe(736)
    expect(tocLeft).toBeGreaterThanOrEqual(0)
    expect(tocLeft + 220).toBeLessThanOrEqual(panelLeft)
    expect(panelLeft + panelWidth).toBeLessThanOrEqual(viewport)
    // 文档面板 p-3（左右 12px）后正文可用宽度。
    expect(panelWidth - 24).toBeGreaterThanOrEqual(560)
  })
})

describe("独立文档窗布局（variant=window）", () => {
  it("目录与正文左右 flex：目录常驻 220px，不收起、不遮挡", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "window" }))

    expect(screen.getByTestId("docs-panel-content").getAttribute("data-variant")).toBe("window")
    const workspace = screen.getByTestId("doc-window-workspace")
    expect(workspace.className).toContain("flex")
    const toc = screen.getByTestId("doc-toc-sidebar")
    expect(toc.parentElement).toBe(workspace)
    expect(toc.className).toContain("w-[220px]")
    expect(toc.className).toContain("shrink-0")

    const editor = screen.getByTestId("doc-editor")
    const body = editor.parentElement as HTMLElement
    expect(body.parentElement).toBe(workspace)
    expect(body.className).toContain("flex-1")
    // 目录在正文左侧相邻，正文占剩余宽度（不是覆盖层）。
    expect(toc.nextElementSibling).toBe(body)
    expect(toc.className).not.toContain("absolute")
    expect(screen.queryByTestId("doc-toc-toggle")).toBeNull()
    expect(within(toc).queryByRole("button", { name: "收起目录" })).toBeNull()
  })
})

describe("面板宽度（P2-PANEL-WIDTH）", () => {
  it("PC 悬浮文档 980px；视口不足时用 calc(100vw-18rem) 防溢出", () => {
    seedPanel()
    useAppStore.setState({ kind: "pc" })
    render(createElement(DocsPanelHost))

    const panel = screen.getByTestId("docs-panel")
    expect(panel.getAttribute("data-variant")).toBe("overlay")
    expect(panel.className).toContain("w-[min(980px,calc(100vw-18rem))]")
    expect(panel.className).toContain("fixed")
    expect(panel.className).not.toContain("w-[1200px]")
    expect(panel.className).not.toContain("w-[400px]")
  })

  it("移动端 inline 面板 640px（2× 原 320px），封顶 70% 给舞台留空间", () => {
    seedPanel()
    useAppStore.setState({ kind: "mobile" })
    render(createElement(DocsPanelHost))

    const panel = screen.getByTestId("docs-panel")
    expect(panel.getAttribute("data-variant")).toBe("inline")
    expect(panel.className).toContain("w-[min(640px,70%)]")
    expect(panel.className).toContain("shrink-0")
    expect(panel.className).not.toContain("w-[320px]")
    expect(panel.className).not.toContain("max-w-[45%]")
  })
})

describe("移动端目录抽屉关闭", () => {
  function openDrawer(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: /^目录$/ }))
    return screen.getByTestId("doc-toc-drawer")
  }

  it("头部 X 明确可点：关闭抽屉但不关闭文档面板", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "inline" }))

    const drawer = openDrawer()
    expect(drawer.getAttribute("data-open")).toBe("true")

    const close = screen.getByTestId("doc-toc-close")
    expect(close.getAttribute("aria-label")).toBe("关闭目录")
    fireEvent.click(close)

    expect(drawer.getAttribute("data-open")).toBe("false")
    expect(useUiStore.getState().docsOpen).toBe(true)
  })

  it("关闭后完全不可见/不可点：父容器裁剪 + opacity-0 + pointer-events-none + inert", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "inline" }))

    const drawer = openDrawer()
    const clip = screen.getByTestId("doc-toc-clip")
    // 抽屉在裁剪层内；打开时正常滑入（平移 0、完全不透明、可交互）。
    expect(drawer.parentElement).toBe(clip)
    expect(clip.className).toContain("overflow-hidden")
    expect(drawer.className).toContain("translate-x-0")
    expect(drawer.className).toContain("opacity-100")
    expect(drawer.hasAttribute("inert")).toBe(false)

    fireEvent.click(screen.getByTestId("doc-toc-close"))
    // 关闭后平移出裁剪层左缘，且兜底不可见/不可点/不可聚焦。
    expect(drawer.className).toContain("-translate-x-[110%]")
    expect(drawer.className).toContain("opacity-0")
    expect(drawer.className).toContain("pointer-events-none")
    expect(drawer.hasAttribute("inert")).toBe(true)
    expect(clip.className).toContain("overflow-hidden")
  })

  it("Esc 只关目录：不冒泡到 MainWindow 的 closeTopmost，文档仍打开", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "inline" }))
    const drawer = openDrawer()

    const closeTopmost = vi.fn(() => useUiStore.getState().closeDocs())
    window.addEventListener("keydown", closeTopmost)
    try {
      fireEvent.keyDown(document.body, { key: "Escape" })
    } finally {
      window.removeEventListener("keydown", closeTopmost)
    }

    expect(drawer.getAttribute("data-open")).toBe("false")
    expect(closeTopmost).not.toHaveBeenCalled()
    expect(useUiStore.getState().docsOpen).toBe(true)
  })

  it("选择目录项后抽屉自动关闭", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "inline" }))
    const drawer = openDrawer()

    fireEvent.click(within(drawer).getAllByTestId("doc-toc-item")[1])

    expect(drawer.getAttribute("data-open")).toBe("false")
    expect(useUiStore.getState().docsOpen).toBe(true)
  })

  it("桌面端 overlay 不拦截 Esc（closeTopmost 照常收到）", () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "overlay" }))

    const closeTopmost = vi.fn()
    window.addEventListener("keydown", closeTopmost)
    try {
      fireEvent.keyDown(document.body, { key: "Escape" })
    } finally {
      window.removeEventListener("keydown", closeTopmost)
    }

    expect(closeTopmost).toHaveBeenCalledTimes(1)
  })
})

describe("目录当前项高亮（P2-TOC-ACTIVE）", () => {
  it("正文滚动到第二章后，对应目录项 data-active=true", async () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "overlay" }))

    await waitFor(() => expect(screen.getAllByTestId("doc-toc-item").length).toBe(3))
    const scroller = screen.getByTestId("doc-preview") as HTMLElement
    const headings = Array.from(scroller.querySelectorAll<HTMLElement>("[data-toc-id]"))
    expect(headings.length).toBe(3)

    const box = {
      x: 0,
      y: 100,
      top: 100,
      left: 0,
      right: 368,
      bottom: 500,
      width: 368,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect
    scroller.getBoundingClientRect = () => box
    // 第一章在顶部、第二章已滚过视口顶部、第三章仍在下方。
    const tops = [100, 80, 300]
    headings.forEach((heading, index) => {
      heading.getBoundingClientRect = () =>
        ({ ...box, top: tops[index], bottom: tops[index] + 20 }) as DOMRect
    })

    fireEvent.scroll(scroller)
    await waitFor(() => {
      const items = screen.getAllByTestId("doc-toc-item")
      expect(items[1].getAttribute("data-active")).toBe("true")
      expect(items[0].getAttribute("data-active")).toBe("false")
      expect(items[2].getAttribute("data-active")).toBe("false")
    })
  })

  it("标题落在容器顶 + 标题高度内即高亮（跳转落点不会停在上一条）", async () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "overlay" }))

    await waitFor(() => expect(screen.getAllByTestId("doc-toc-item").length).toBe(3))
    const scroller = screen.getByTestId("doc-preview") as HTMLElement
    const headings = Array.from(scroller.querySelectorAll<HTMLElement>("[data-toc-id]"))

    const box = {
      x: 0,
      y: 241,
      top: 241,
      left: 0,
      right: 368,
      bottom: 641,
      width: 368,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect
    scroller.getBoundingClientRect = () => box
    // 目标标题在容器顶 +12px（旧阈值 8px 会判成“未到”，停在上一条）。
    const tops = [100, 253, 600]
    headings.forEach((heading, index) => {
      heading.getBoundingClientRect = () =>
        ({ ...box, top: tops[index], bottom: tops[index] + 24, height: 24 }) as DOMRect
    })

    fireEvent.scroll(scroller)
    await waitFor(() => {
      const items = screen.getAllByTestId("doc-toc-item")
      expect(items[1].getAttribute("data-active")).toBe("true")
      expect(items[0].getAttribute("data-active")).toBe("false")
    })
  })

  it("点击目录后立即高亮目标；平滑滚动途中不被上一条抢走", async () => {
    seedPanel()
    render(createElement(DocsPanel, { variant: "overlay" }))

    await waitFor(() => expect(screen.getAllByTestId("doc-toc-item").length).toBe(3))
    const scroller = screen.getByTestId("doc-preview") as HTMLElement
    const headings = Array.from(scroller.querySelectorAll<HTMLElement>("[data-toc-id]"))
    const box = {
      x: 0,
      y: 241,
      top: 241,
      left: 0,
      right: 368,
      bottom: 641,
      width: 368,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect
    scroller.getBoundingClientRect = () => box
    // 目标仍在下方（平滑滚动的第一帧），位置计算会指向上一条。
    const tops = [241, 800, 1200]
    headings.forEach((heading, index) => {
      heading.getBoundingClientRect = () =>
        ({ ...box, top: tops[index], bottom: tops[index] + 24, height: 24 }) as DOMRect
    })
    fireEvent.scroll(scroller)
    await waitFor(() => {
      expect(screen.getAllByTestId("doc-toc-item")[0].getAttribute("data-active")).toBe("true")
    })

    fireEvent.click(screen.getAllByTestId("doc-toc-item")[1])
    expect(screen.getAllByTestId("doc-toc-item")[1].getAttribute("data-active")).toBe("true")

    fireEvent.scroll(scroller)
    await waitFor(() => {
      const items = screen.getAllByTestId("doc-toc-item")
      expect(items[1].getAttribute("data-active")).toBe("true")
      expect(items[0].getAttribute("data-active")).toBe("false")
    })
  })
})

describe("未保存草稿守卫（P2-TAB-DRAFT / CLOSE / PROTO / DOCWIN-DIRTY）", () => {
  it("切 Tab 先确认：取消保留编辑态，确认放弃才切换", async () => {
    seedPanel({
      docContent: MD,
      draft: `${MD}\n\n未保存标记`,
      editing: true,
      latestContent: "# 最新需求",
    })
    render(createElement(DocsPanel, { variant: "overlay" }))

    fireEvent.click(screen.getByRole("tab", { name: "最新需求" }))
    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy()
    expect(useDocsStore.getState().tab).toBe("desc")
    expect(useDocsStore.getState().pendingGuard).toEqual({ kind: "tab", tab: "latest" })

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())
    expect(useDocsStore.getState().tab).toBe("desc")
    expect(useDocsStore.getState().editing).toBe(true)
    expect(useDocsStore.getState().draft).toContain("未保存标记")

    fireEvent.click(screen.getByRole("tab", { name: "最新需求" }))
    await screen.findByTestId("confirm-dialog")
    fireEvent.click(screen.getByTestId("confirm-dialog-ok"))
    await waitFor(() => expect(useDocsStore.getState().tab).toBe("latest"))
    expect(useDocsStore.getState().editing).toBe(false)
  })

  it("关闭面板先确认：取消后仍打开并保留草稿，确认放弃才关闭", async () => {
    seedPanel({ docContent: MD, draft: `${MD}\n\n关闭前草稿`, editing: true })
    render(createElement(DocsPanel, { variant: "overlay" }))

    act(() => useUiStore.getState().closeDocs())
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy()
    expect(useDocsStore.getState().pendingGuard).toEqual({ kind: "close-panel" })

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(useDocsStore.getState().editing).toBe(true)
    expect(useDocsStore.getState().draft).toContain("关闭前草稿")

    act(() => useUiStore.getState().closeDocs())
    await screen.findByTestId("confirm-dialog")
    fireEvent.click(screen.getByTestId("confirm-dialog-ok"))
    await waitFor(() => expect(useUiStore.getState().docsOpen).toBe(false))
    expect(useDocsStore.getState().draft).toBe(MD)
  })

  it("DocsPanelHost 关闭面板（真实宿主入口）不卸载面板，Confirm 就地出现", async () => {
    seedPanel({ docContent: MD, draft: `${MD}\n\n宿主关闭草稿`, editing: true })
    useAppStore.setState({ kind: "pc" })
    render(createElement(DocsPanelHost))

    expect(screen.getByTestId("docs-panel")).toBeTruthy()
    act(() => useUiStore.getState().closeDocs())
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy()
    expect(screen.getByTestId("docs-panel")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())
    expect(screen.getByTestId("docs-panel")).toBeTruthy()
    expect(useDocsStore.getState().editing).toBe(true)
    expect(useDocsStore.getState().draft).toContain("宿主关闭草稿")
  })

  it("独立文档窗关闭（beforeunload）先确认：取消保留窗口与草稿", async () => {
    window.history.replaceState({}, "", "/?docwin=1")
    seedPanel({ docContent: MD, draft: `${MD}\n\n独窗草稿`, editing: true })
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined)
    render(createElement(DocsPanel, { variant: "overlay" }))

    const first = new Event("beforeunload", { cancelable: true })
    act(() => {
      window.dispatchEvent(first)
    })
    expect(first.defaultPrevented).toBe(true)
    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy()
    expect(useDocsStore.getState().pendingGuard).toEqual({ kind: "close-window" })

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())
    expect(closeSpy).not.toHaveBeenCalled()
    expect(useDocsStore.getState().editing).toBe(true)
    expect(useDocsStore.getState().draft).toContain("独窗草稿")

    const second = new Event("beforeunload", { cancelable: true })
    act(() => {
      window.dispatchEvent(second)
    })
    await screen.findByTestId("confirm-dialog")
    fireEvent.click(screen.getByTestId("confirm-dialog-ok"))
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1))
    expect(useDocsStore.getState().draft).toBe(MD)
    closeSpy.mockRestore()
  })

  it("切原型后草稿暂存并弹确认；取消后切回原原型自动恢复编辑态", async () => {
    seedPanel({ docContent: MD, draft: `${MD}\n\n切原型草稿`, editing: true })
    render(createElement(DocsPanel, { variant: "overlay" }))

    const other: SourceRef = {
      ...SOURCE,
      name: "我的.html",
      displayName: "我的",
      sandboxDir: "/sandbox/A/我的",
      mdFile: "我的.md",
      md: "# 我的",
    }
    act(() => {
      useSourcesStore.setState({ sources: [SOURCE, other], currentSource: other })
    })

    const dialog = await screen.findByTestId("confirm-dialog")
    expect(useDocsStore.getState().pendingGuard?.kind).toBe("source")
    // 文案指向目标原型「我的」，不能误写来源「首页」造成“切回去了”的错觉。
    expect(dialog.textContent).toContain("已切换到「我的」")
    expect(dialog.textContent).not.toContain("已切换到「首页」")
    expect(useDocsStore.getState().draftStash[`${SOURCE.sandboxDir}::desc`]).toContain("切原型草稿")

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())
    expect(useDocsStore.getState().draftStash[`${SOURCE.sandboxDir}::desc`]).toContain("切原型草稿")

    act(() => {
      useSourcesStore.setState({ currentSource: SOURCE })
    })
    await waitFor(() => expect(useDocsStore.getState().editing).toBe(true))
    expect(useDocsStore.getState().draft).toContain("切原型草稿")
  })

  it("面板卸载后再切原型：重开仍弹确认，草稿按目录暂存不丢", async () => {
    const other: SourceRef = {
      ...SOURCE,
      name: "我的.html",
      displayName: "我的",
      sandboxDir: "/sandbox/A/我的",
      mdFile: "我的.md",
      md: "# 我的",
    }
    seedPanel({ docContent: MD, draft: `${MD}\n\n重开草稿`, editing: true })
    const first = render(createElement(DocsPanel, { variant: "overlay" }))
    first.unmount()

    // 面板已卸载（等价于独立窗/宿主卸载）后切到另一原型，再重开面板。
    act(() => {
      useSourcesStore.setState({ sources: [SOURCE, other], currentSource: other })
    })
    render(createElement(DocsPanel, { variant: "overlay" }))

    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy()
    expect(useDocsStore.getState().pendingGuard?.kind).toBe("source")
    expect(useDocsStore.getState().draftStash[`${SOURCE.sandboxDir}::desc`]).toContain("重开草稿")
    expect(useDocsStore.getState().docContent).toBe("# 我的")

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())

    act(() => {
      useSourcesStore.setState({ currentSource: SOURCE })
    })
    await waitFor(() => expect(useDocsStore.getState().editing).toBe(true))
    expect(useDocsStore.getState().draft).toContain("重开草稿")
  })
})
