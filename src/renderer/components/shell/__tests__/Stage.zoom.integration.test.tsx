/**
 * src/renderer/components/shell/__tests__/Stage.zoom.integration.test.tsx
 *
 * M1 移动端视口 + PC 缩放端到端（jsdom，W5 修订：CSS zoom + 动态视口高）：
 * - 默认适宽：scale=min(1, 可用宽/375)，手机壳吃满可用高；视口高 = 壳可视高 ÷ 比例，
 *   内容高精确吃满可视高（无壳内纵向滚动）；
 * - 全貌：375×780 参考机整体 fit，不生成滚动容器；
 * - 100% / 125%：固定比例，视口高随比例反缩；小地图无纵向溢出时不显示；
 * - 缩放走 CSS zoom（zoom 会随帧传播并重栅格化文字），stage-viewport 上
 *   读 style.zoom；坐标换算口径（getBoundingClientRect=视觉、clientWidth=逻辑）不变；
 * - 顶栏与舞台读数同源；外层 Stage 始终 overflow-hidden；
 * - 移动端不自动收起侧栏 / 文档；chrome 默认打开逻辑见 Stage.chrome-restore.test.tsx。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import Topbar from "../Topbar"
import Stage from "../Stage"
import { createMobileViewportPositions, useAppStore } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"
import { useSourcesStore, type SourceRef } from "@/stores/sources-store"

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

vi.mock("@/features/preview/PreviewFrame", () => ({
  default: () => <div data-testid="preview-frame" />,
}))

vi.mock("@/features/preview/PreviewOverlaysHost", () => ({
  default: () => null,
}))

vi.mock("@/components/shell/MobileMinimap", () => ({
  default: (props: {
    totalHeight: number
    viewportHeight: number
    scrollTop: number
    visible: boolean
  }) => (
    <div
      data-testid="mobile-minimap-mock"
      data-visible={props.visible ? "1" : "0"}
      data-total={props.totalHeight}
      data-viewport={props.viewportHeight}
      data-scroll={props.scrollTop}
    />
  ),
}))

class ResizeObserverMock {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let rectSpy: ReturnType<typeof vi.spyOn>

function resetStores(kind: "pc" | "mobile" = "mobile"): void {
  useAppStore.setState({
    project: "",
    proto: "",
    page: "",
    kind,
    zoom: 1,
    fitMode: true,
    mobileViewMode: "fit-width",
    mobileScrollPositions: createMobileViewportPositions(),
    mobileChromeSnapshot: null,
    sidebarOpen: true,
  })
  useUiStore.setState({ docsOpen: false })
  useSourcesStore.setState({
    project: "",
    projects: [],
    sources: [],
    currentSource: null,
    activeSubFile: "",
    activeContent: "",
    loading: false,
    error: "",
  })
}

beforeEach(() => {
  resetStores()
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock
  // 舞台可用区 300×600（boxRef 在内边距内，已扣除 padding）。
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 300,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  rectSpy.mockRestore()
})

describe("移动端默认适宽", () => {
  it("scale=min(1, 可用宽/375)，视口高=壳可视高÷比例，内容高吃满可视高", async () => {
    useSourcesStore.setState({ currentSource: source })
    render(
      <>
        <Topbar />
        <Stage />
      </>
    )

    await waitFor(() => expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("80%"))
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("80%")
    expect((screen.getByLabelText("移动端视图模式") as HTMLSelectElement).value).toBe("fit-width")

    const shell = screen.getByTestId("stage-mobile-shell")
    expect(shell.style.width).toBe("300px")
    expect(shell.style.height).toBe("600px")

    const scroll = screen.getByTestId("stage-mobile-scroll")
    expect(scroll.getAttribute("data-overflow")).toBe("auto-y")
    expect(scroll.className).toContain("overflow-y-auto")

    // 可用区 300×600：视口高 600÷0.8=750 逻辑；内容高 750×0.8=600 精确吃满可视高。
    const zoomBox = screen.getByTestId("stage-mobile-zoom-box")
    expect(zoomBox.style.width).toBe("300px")
    expect(zoomBox.style.height).toBe("600px")

    const viewport = screen.getByTestId("stage-viewport")
    expect(viewport.style.width).toBe("375px")
    expect(viewport.style.height).toBe("750px")
    // 缩放走 CSS zoom（不是 transform）：jsdom 下可读回 style.zoom。
    expect(viewport.style.zoom).toBe("0.8")
  })

  it("外层 Stage 始终 overflow-hidden，滚动不落到外层", () => {
    render(<Stage />)
    const stage = screen.getByTestId("stage-frame")
    expect(stage.className).toContain("overflow-hidden")
    expect(screen.queryByTestId("stage-mobile-scroll")).toBeTruthy()
  })
})

describe("移动端全貌", () => {
  it("375×780 整体 fit，不渲染滚动容器与导航条", async () => {
    useAppStore.setState({ mobileViewMode: "overview" })
    useSourcesStore.setState({ currentSource: source })
    render(
      <>
        <Topbar />
        <Stage />
      </>
    )

    // min(300/375, 600/780) = 0.7692 → 77%
    await waitFor(() => expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("77%"))
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("77%")
    expect(screen.getByTestId("stage-mobile-overview")).toBeTruthy()
    expect(screen.queryByTestId("stage-mobile-scroll")).toBeNull()
    expect(screen.queryByTestId("mobile-minimap-mock")).toBeNull()
  })
})

describe("移动端 100% / 125%", () => {
  it("100%：画面 zoom(1)，视口高=壳可视高，小地图无溢出不显示", async () => {
    useAppStore.setState({ mobileViewMode: "100" })
    useSourcesStore.setState({ currentSource: source })
    render(
      <>
        <Topbar />
        <Stage />
      </>
    )

    await waitFor(() => expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("100%"))
    const shell = screen.getByTestId("stage-mobile-shell")
    expect(shell.style.width).toBe("300px")
    expect(shell.style.height).toBe("600px")

    const scroll = screen.getByTestId("stage-mobile-scroll")
    expect(scroll.getAttribute("data-overflow")).toBe("auto")
    expect(scroll.className).toContain("overflow-auto")

    // 视口高 600÷1=600 逻辑；内容高 600×1=600 精确吃满可视高，无纵向滚动。
    const zoomBox = screen.getByTestId("stage-mobile-zoom-box")
    expect(zoomBox.style.width).toBe("375px")
    expect(zoomBox.style.height).toBe("600px")
    expect(screen.getByTestId("stage-viewport").style.zoom).toBe("1")

    // 动态视口高下内容高 ≈ 可视高，无纵向溢出，小地图不显示。
    const minimap = screen.getByTestId("mobile-minimap-mock")
    expect(minimap.getAttribute("data-visible")).toBe("0")
    expect(minimap.getAttribute("data-total")).toBe("600")
  })

  it("125%：视口高随比例反缩（600÷1.25=480），读数与比例一致", async () => {
    useAppStore.setState({ mobileViewMode: "125" })
    useSourcesStore.setState({ currentSource: source })
    render(
      <>
        <Topbar />
        <Stage />
      </>
    )

    await waitFor(() => expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("125%"))
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("125%")
    expect((screen.getByLabelText("移动端视图模式") as HTMLSelectElement).value).toBe("125")

    const zoomBox = screen.getByTestId("stage-mobile-zoom-box")
    expect(zoomBox.style.width).toBe("468.75px")
    expect(zoomBox.style.height).toBe("600px")
    expect(screen.getByTestId("stage-viewport").style.zoom).toBe("1.25")
    expect(screen.getByTestId("stage-viewport").style.height).toBe("480px")

    const minimap = screen.getByTestId("mobile-minimap-mock")
    expect(minimap.getAttribute("data-visible")).toBe("0")
  })

  it("顶栏切到 125% 后两处读数同步", async () => {
    useSourcesStore.setState({ currentSource: source })
    render(
      <>
        <Topbar />
        <Stage />
      </>
    )

    fireEvent.change(screen.getByLabelText("移动端视图模式"), { target: { value: "125" } })

    await waitFor(() => expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("125%"))
    expect(screen.getByTestId("topbar-zoom-readout").textContent).toBe("125%")
  })
})

describe("移动端不自动收起侧栏 / 文档", () => {
  it("移动端挂载保持调用方状态，不再 closeDocs / setSidebarOpen(false)", () => {
    useAppStore.setState({ kind: "mobile", sidebarOpen: true })
    useUiStore.setState({ docsOpen: true })
    render(<Stage />)

    expect(useAppStore.getState().sidebarOpen).toBe(true)
    expect(useUiStore.getState().docsOpen).toBe(true)
  })

  it("PC 行为不变：侧栏与文档保持调用方状态", () => {
    resetStores("pc")
    useAppStore.setState({ sidebarOpen: true })
    useUiStore.setState({ docsOpen: true })
    render(<Stage />)

    expect(useAppStore.getState().sidebarOpen).toBe(true)
    expect(useUiStore.getState().docsOpen).toBe(true)
  })
})

describe("PC 缩放：读数变化时画面真实缩放", () => {
  function renderPc(zoom: number): void {
    resetStores("pc")
    useAppStore.setState({ zoom })
    useSourcesStore.setState({ currentSource: source })
    render(
      <>
        <Topbar />
        <Stage />
      </>
    )
  }

  it("100% 时画面盒与舞台可用区一致，zoom 为 1", () => {
    renderPc(1)

    const scaled = screen.getByTestId("stage-pc-zoom")
    expect(scaled.style.zoom).toBe("1")
    expect(scaled.style.width).toBe("300px")
    expect(scaled.style.height).toBe("600px")
    expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("100%")
  })

  it("预设 125%：CSS zoom 放大布局尺寸（滚动范围随之扩大），读数一致", () => {
    renderPc(1)

    fireEvent.change(screen.getByLabelText("缩放预设"), { target: { value: "125" } })

    // zoom 是布局级缩放：本体基准尺寸不变（300×600），布局尺寸=基准×1.25，
    // 不再需要 transform 缩放盒（stage-pc-zoom-box 已随 W5 修订移除）。
    const scaled = screen.getByTestId("stage-pc-zoom")
    expect(scaled.style.zoom).toBe("1.25")
    expect(scaled.getAttribute("data-zoom")).toBe("1.25")
    expect(scaled.style.width).toBe("300px")
    expect(scaled.style.height).toBe("600px")
    expect(screen.queryByTestId("stage-pc-zoom-box")).toBeNull()
    expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("125%")
    expect((screen.getByLabelText("缩放预设") as HTMLSelectElement).value).toBe("125")
  })

  it("50%：画面缩小，本体即布局盒（可在舞台内居中）", () => {
    renderPc(1)

    fireEvent.change(screen.getByLabelText("缩放预设"), { target: { value: "50" } })

    const scaled = screen.getByTestId("stage-pc-zoom")
    expect(scaled.style.zoom).toBe("0.5")
    expect(scaled.style.width).toBe("300px")
    expect(scaled.style.height).toBe("600px")
    expect(scaled.className).toContain("m-auto")
    expect(screen.getByTestId("stage-zoom-readout").textContent).toBe("50%")
  })
})
