/**
 * src/renderer/components/shell/__tests__/Topbar.test.tsx — P1-3 顶栏入口单测。
 *
 * 覆盖：项目切换下拉（搜索 / 当前项高亮 / 新建）、刷新、终端（ai:openTerminal）、
 * 单一「文档」按钮只开合面板（不走 docwin）、设置入口不在顶栏；
 * Esc 只关下拉不冒泡到 MainWindow 的全局栈。
 *
 * 只 mock store action 与 window.protoAPI，不引入新依赖。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import Topbar from "../Topbar"
import { publishStageScale } from "../Stage"
import { createMobileViewportPositions, useAppStore } from "@/stores/app-store"
import { useDocsStore } from "@/stores/docs-store"
import { useSourcesStore, type SourceRef, type SourcesActionResult } from "@/stores/sources-store"
import { useUiStore } from "@/stores/ui-store"

const enterProjectMock = vi.fn(async (_name: string) => undefined)
const createProjectMock = vi.fn(
  async (name: string): Promise<SourcesActionResult> => ({ ok: true, name })
)
const refreshMock = vi.fn(async () => undefined)

const source: SourceRef = {
  name: "首页.html",
  displayName: "首页",
  kind: "pc",
  sandboxDir: "D:/sandbox/测试1/首页",
  mainHtmlFile: "首页.html",
  mdFile: null,
  subPages: [],
  htmlFiles: ["首页.html"],
  content: "<html></html>",
  md: "",
  pages: [],
  __ver: 1,
}

function resetStores(): void {
  enterProjectMock.mockClear()
  createProjectMock.mockClear()
  refreshMock.mockClear()

  useAppStore.setState({
    project: "",
    proto: "",
    page: "",
    kind: "pc",
    zoom: 1,
    fitMode: true,
    mobileViewMode: "fit-width",
    mobileScrollPositions: createMobileViewportPositions(),
    sidebarOpen: true,
  })
  publishStageScale({
    kind: "pc",
    fitMode: false,
    zoom: 1,
    scale: 1,
    mobileMode: "fit-width",
  })
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
    enterProject: enterProjectMock,
    createProject: createProjectMock,
    refresh: refreshMock,
  })
  useDocsStore.setState({ tab: "desc", docContent: "", docTitle: "功能说明", editing: false })
  useUiStore.setState({
    docsOpen: false,
    aiOpen: false,
    settingsTab: null,
    gitOpen: false,
    exportOpen: false,
    toasts: [],
  })
}

function openProjectMenu(): HTMLElement {
  fireEvent.click(screen.getByTestId("project-switch"))
  return screen.getByTestId("project-menu")
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
})

describe("Topbar 项目切换下拉", () => {
  it("搜索过滤项目并高亮当前项目", () => {
    useSourcesStore.setState({
      project: "测试1",
      projects: [
        { name: "测试1", protoCount: 2 },
        { name: "另一个项目", protoCount: 0 },
      ],
    })
    render(<Topbar />)
    openProjectMenu()

    const current = screen.getByRole("option", { name: /测试1/ })
    expect(current.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("option", { name: /另一个项目/ })).toBeTruthy()

    fireEvent.change(screen.getByTestId("project-search"), { target: { value: "另一" } })
    expect(screen.queryByRole("option", { name: /测试1/ })).toBeNull()
    expect(screen.getByRole("option", { name: /另一个项目/ })).toBeTruthy()
  })

  it("点选项目调用 enterProject", async () => {
    useSourcesStore.setState({
      project: "测试1",
      projects: [
        { name: "测试1", protoCount: 2 },
        { name: "另一个项目", protoCount: 0 },
      ],
    })
    render(<Topbar />)
    openProjectMenu()

    fireEvent.click(screen.getByRole("option", { name: /另一个项目/ }))
    await waitFor(() => expect(enterProjectMock).toHaveBeenCalledWith("另一个项目"))
  })

  it("新建项目后直接进入", async () => {
    useSourcesStore.setState({ project: "测试1", projects: [{ name: "测试1", protoCount: 2 }] })
    render(<Topbar />)
    openProjectMenu()

    fireEvent.change(screen.getByTestId("project-create-input"), { target: { value: "新项目" } })
    fireEvent.click(screen.getByTestId("project-create"))

    await waitFor(() => expect(createProjectMock).toHaveBeenCalledWith("新项目"))
    await waitFor(() => expect(enterProjectMock).toHaveBeenCalledWith("新项目"))
  })

  it("Esc 只关下拉，不冒泡到全局 keydown", () => {
    useSourcesStore.setState({ projects: [{ name: "测试1", protoCount: 2 }] })
    const onWindowKeyDown = vi.fn()
    window.addEventListener("keydown", onWindowKeyDown)
    render(<Topbar />)
    openProjectMenu()

    fireEvent.keyDown(screen.getByTestId("project-search"), { key: "Escape" })
    expect(screen.queryByTestId("project-menu")).toBeNull()
    expect(onWindowKeyDown).not.toHaveBeenCalled()
    window.removeEventListener("keydown", onWindowKeyDown)
  })
})

describe("Topbar 刷新 / 终端", () => {
  it("刷新按钮调用 sources-store.refresh", async () => {
    useSourcesStore.setState({ project: "测试1" })
    render(<Topbar />)

    fireEvent.click(screen.getByTestId("topbar-refresh"))
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })

  it("终端按钮经 ai:openTerminal 下发当前沙箱目录", async () => {
    const openTerminal = vi.fn(async () => ({ ok: true, success: true }))
    ;(window as unknown as { protoAPI?: unknown }).protoAPI = { ai: { openTerminal } }
    useSourcesStore.setState({ project: "测试1", currentSource: source })
    render(<Topbar />)

    fireEvent.click(screen.getByTestId("topbar-terminal"))
    await waitFor(() => expect(openTerminal).toHaveBeenCalledWith(source.sandboxDir))
    await waitFor(() =>
      expect(useUiStore.getState().toasts.map((t) => t.title)).toContain("已打开终端")
    )
  })

  it("无当前源时终端按钮只 toast，不发 IPC", () => {
    const openTerminal = vi.fn(async () => ({ ok: true }))
    ;(window as unknown as { protoAPI?: unknown }).protoAPI = { ai: { openTerminal } }
    useSourcesStore.setState({ project: "测试1", currentSource: null })
    render(<Topbar />)

    fireEvent.click(screen.getByTestId("topbar-terminal"))
    expect(openTerminal).not.toHaveBeenCalled()
    expect(useUiStore.getState().toasts.map((t) => t.title)).toContain("请先选择一个原型")
  })
})

describe("Topbar 文档入口", () => {
  it("只保留一个文档按钮，点击开合并保持面板模式", () => {
    const docwinOpen = vi.fn(async () => "panel")
    ;(window as unknown as { protoAPI?: unknown }).protoAPI = { docwin: { open: docwinOpen } }
    render(<Topbar />)

    // 旧的两个快捷入口与顶栏设置入口均已移除。
    expect(screen.queryByTestId("topbar-doc-desc")).toBeNull()
    expect(screen.queryByTestId("topbar-doc-latest")).toBeNull()
    expect(screen.queryByRole("button", { name: "功能说明" })).toBeNull()
    expect(screen.queryByRole("button", { name: "最新需求" })).toBeNull()
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull()

    const button = screen.getByTestId("topbar-docs")
    fireEvent.click(button)
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(button.getAttribute("aria-pressed")).toBe("true")

    fireEvent.click(button)
    expect(useUiStore.getState().docsOpen).toBe(false)
    expect(button.getAttribute("aria-pressed")).toBe("false")
    // 文档按钮不再调用 docwin 独立窗口。
    expect(docwinOpen).not.toHaveBeenCalled()
  })

  it("保留项目下拉、刷新、终端、端别、缩放、AI、Git、导出入口", () => {
    render(<Topbar />)

    expect(screen.getByTestId("project-switch")).toBeTruthy()
    expect(screen.getByTestId("topbar-refresh")).toBeTruthy()
    expect(screen.getByTestId("topbar-terminal")).toBeTruthy()
    expect(screen.getByRole("group", { name: "端别切换" })).toBeTruthy()
    expect(screen.getByRole("group", { name: "舞台缩放" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "AI 对话" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Git 管理" })).toBeTruthy()
    expect(screen.getByTestId("export-menu")).toBeTruthy()
  })
})

describe("Topbar 移动端视口模式（与舞台同一事实源）", () => {
  it("适宽：显示舞台实测比例，不出现旧 zoom 数字", () => {
    useAppStore.setState({ kind: "mobile", zoom: 0.85, mobileViewMode: "fit-width" })
    publishStageScale({
      kind: "mobile",
      fitMode: true,
      zoom: 0.85,
      scale: 0.6,
      mobileMode: "fit-width",
    })
    render(<Topbar />)

    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("60%")
    expect((screen.getByLabelText("移动端视图模式") as HTMLSelectElement).value).toBe("fit-width")
    expect(screen.queryByText("85%")).toBeNull()
  })

  it("适宽未测得比例时显示「适宽」，不回退旧 zoom", () => {
    useAppStore.setState({ kind: "mobile", zoom: 0.85, mobileViewMode: "fit-width" })
    publishStageScale({
      kind: "mobile",
      fitMode: true,
      zoom: 0.85,
      scale: null,
      mobileMode: "fit-width",
    })
    render(<Topbar />)

    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("适宽")
    expect(screen.queryByText("85%")).toBeNull()
  })

  it("全貌未测得比例时显示「全貌」", () => {
    useAppStore.setState({ kind: "mobile", zoom: 0.85, mobileViewMode: "overview" })
    publishStageScale({
      kind: "mobile",
      fitMode: false,
      zoom: 0.85,
      scale: null,
      mobileMode: "overview",
    })
    render(<Topbar />)

    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("全貌")
    expect((screen.getByLabelText("移动端视图模式") as HTMLSelectElement).value).toBe("overview")
  })

  it("预设 100% / 125% 切换视口模式且不写持久化 zoom", () => {
    useAppStore.setState({ kind: "mobile", zoom: 0.85, mobileViewMode: "fit-width" })
    render(<Topbar />)

    fireEvent.change(screen.getByLabelText("移动端视图模式"), { target: { value: "100" } })
    expect(useAppStore.getState().mobileViewMode).toBe("100")
    expect(useAppStore.getState().zoom).toBeCloseTo(0.85)
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("100%")

    fireEvent.change(screen.getByLabelText("移动端视图模式"), { target: { value: "125" } })
    expect(useAppStore.getState().mobileViewMode).toBe("125")
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("125%")
  })

  it("缩小/放大从当前可见比例进入 custom", () => {
    useAppStore.setState({ kind: "mobile", zoom: 1, mobileViewMode: "fit-width" })
    publishStageScale({
      kind: "mobile",
      fitMode: true,
      zoom: 1,
      scale: 0.6,
      mobileMode: "fit-width",
    })
    render(<Topbar />)

    fireEvent.click(screen.getByLabelText("缩小"))
    expect(useAppStore.getState().mobileViewMode).toBe("custom")
    expect(useAppStore.getState().zoom).toBeCloseTo(0.5)
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("50%")

    fireEvent.click(screen.getByLabelText("放大"))
    expect(useAppStore.getState().mobileViewMode).toBe("custom")
    expect(useAppStore.getState().zoom).toBeCloseTo(0.6)
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("60%")
  })

  it("PC 不渲染移动端读数与模式下拉，缩放组保持原样", () => {
    useAppStore.setState({ kind: "pc", zoom: 0.85, fitMode: true })
    publishStageScale({
      kind: "pc",
      fitMode: true,
      zoom: 0.85,
      scale: 0.85,
      mobileMode: "fit-width",
    })
    render(<Topbar />)

    expect(screen.queryByTestId("topbar-zoom-readout")).toBeNull()
    expect(screen.queryByLabelText("移动端视图模式")).toBeNull()
    expect((screen.getByLabelText("缩放预设") as HTMLSelectElement).value).toBe("85")
  })
})
