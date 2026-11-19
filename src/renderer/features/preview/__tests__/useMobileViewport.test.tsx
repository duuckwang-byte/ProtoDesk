/**
 * src/renderer/features/preview/__tests__/useMobileViewport.test.tsx
 *
 * M1 视口状态机单测（W5 修订：动态视口高）：
 * - 模式 → 比例（适宽只按宽度；全貌纵横都 fit；100/125/custom 固定）；
 * - 非 overview 视口高 = 壳可视高 ÷ 比例，内容高精确吃满可视高（无壳内纵向滚动）；
 * - overview 视口高固定 780（参考机整体可见）；
 * - 壳内滚动位置按模式记忆，切回恢复并 clamp；
 * - jumpTo 与 Minimap 所需 viewportHeight 数据。
 */

import { useRef } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  clampMobileScroll,
  mobileScaleFor,
  useMobileViewport,
} from "../useMobileViewport"
import { createMobileViewportPositions, useAppStore } from "@/stores/app-store"

function resetStore(): void {
  useAppStore.setState({
    kind: "mobile",
    zoom: 1,
    mobileViewMode: "fit-width",
    mobileScrollPositions: createMobileViewportPositions(),
  })
}

function Harness({ width = 300, height = 600 }: { width?: number; height?: number }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const viewport = useMobileViewport({
    availableWidth: width,
    availableHeight: height,
    scrollRef,
    active: true,
  })
  return (
    <div>
      <div
        ref={scrollRef}
        data-testid="scroll"
        onScroll={viewport.handleScroll}
        style={{ overflow: "auto" }}
      >
        <div style={{ height: viewport.contentHeight }} />
      </div>
      <button type="button" onClick={() => viewport.setMode("overview")}>
        mode-overview
      </button>
      <button type="button" onClick={() => viewport.setMode("fit-width")}>
        mode-fit
      </button>
      <button type="button" onClick={() => viewport.setMode("100")}>
        mode-100
      </button>
      <button type="button" onClick={() => viewport.setMode("125")}>
        mode-125
      </button>
      <button type="button" onClick={() => viewport.jumpTo(300)}>
        jump-300
      </button>
      <span data-testid="scale">{viewport.scale ?? "null"}</span>
      <span data-testid="layout-scale">{viewport.layoutScale}</span>
      <span data-testid="shell">
        {viewport.shellWidth}x{viewport.shellHeight}
      </span>
      <span data-testid="content">
        {viewport.contentWidth}x{viewport.contentHeight}
      </span>
      <span data-testid="viewport-h">{viewport.viewportH}</span>
      <span data-testid="viewport-height">{viewport.viewportHeight}</span>
      <span data-testid="scroll-top">{viewport.scrollTop}</span>
    </div>
  )
}

interface ScrollMetrics {
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
}

/** jsdom 没有布局，按实例注入可滚尺寸与会 clamp 的 scrollTop/scrollLeft。 */
function patchScrollMetrics(el: HTMLElement, metrics: ScrollMetrics): void {
  let top = el.scrollTop
  let left = el.scrollLeft
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: metrics.scrollHeight })
  Object.defineProperty(el, "clientHeight", { configurable: true, value: metrics.clientHeight })
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: metrics.scrollWidth })
  Object.defineProperty(el, "clientWidth", { configurable: true, value: metrics.clientWidth })
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      const max = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
      top = Math.min(max, Math.max(0, Number(value) || 0))
    },
  })
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      const max = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
      left = Math.min(max, Math.max(0, Number(value) || 0))
    },
  })
}

afterEach(() => {
  cleanup()
  resetStore()
})

describe("mobileScaleFor 模式状态机", () => {
  it("适宽只按可用宽：min(1, 宽/375)", () => {
    expect(mobileScaleFor("fit-width", 300, 600, 1)).toBeCloseTo(0.8)
    expect(mobileScaleFor("fit-width", 600, 300, 1)).toBe(1)
    expect(mobileScaleFor("fit-width", 0, 600, 1)).toBeNull()
  })

  it("全貌纵横都 fit：min(宽/375, 高/780)", () => {
    expect(mobileScaleFor("overview", 300, 600, 1)).toBeCloseTo(600 / 780)
    expect(mobileScaleFor("overview", 900, 780, 1)).toBe(1)
    expect(mobileScaleFor("overview", 300, 0, 1)).toBeNull()
  })

  it("100 / 125 / custom 不依赖可用区；custom 复用 zoom clamp", () => {
    expect(mobileScaleFor("100", 0, 0, 0.5)).toBe(1)
    expect(mobileScaleFor("125", 0, 0, 0.5)).toBe(1.25)
    expect(mobileScaleFor("custom", 0, 0, 0.9)).toBeCloseTo(0.9)
    expect(mobileScaleFor("custom", 0, 0, 5)).toBe(3)
    expect(mobileScaleFor("custom", 0, 0, 0.1)).toBe(0.2)
  })
})

describe("clampMobileScroll", () => {
  it("按可滚范围收敛 top/left，负数归零", () => {
    const metrics = { scrollHeight: 1200, clientHeight: 400, scrollWidth: 500, clientWidth: 300 }
    expect(clampMobileScroll({ top: 900, left: 400 }, metrics)).toEqual({ top: 800, left: 200 })
    expect(clampMobileScroll({ top: -20, left: -1 }, metrics)).toEqual({ top: 0, left: 0 })
  })
})

describe("useMobileViewport 布局尺寸", () => {
  it("默认适宽：视口高 = 壳可视高 ÷ 比例，内容高吃满可视高（无壳内纵向滚动）", () => {
    resetStore()
    render(<Harness />)

    expect(screen.getByTestId("scale").textContent).toBe("0.8")
    // 600 可视高 ÷ 0.8 = 750 逻辑视口高；内容高 750×0.8 = 600 精确吃满可视高。
    expect(screen.getByTestId("viewport-h").textContent).toBe("750")
    expect(screen.getByTestId("content").textContent).toBe("300x600")
    expect(screen.getByTestId("shell").textContent).toBe("300x600")
  })

  it("全貌：视口高固定 780，壳尺寸=内容尺寸（参考机整体可见，无滚动余地）", () => {
    resetStore()
    useAppStore.setState({ mobileViewMode: "overview" })
    render(<Harness />)

    expect(Number(screen.getByTestId("scale").textContent)).toBeCloseTo(600 / 780)
    expect(screen.getByTestId("viewport-h").textContent).toBe("780")
    expect(screen.getByTestId("shell").textContent).toBe(
      `${375 * (600 / 780)}x600`,
    )
  })

  it("100 / 125：视口高随比例反缩（可视高不变），内容高吃满可视高", () => {
    resetStore()
    useAppStore.setState({ mobileViewMode: "100" })
    const { unmount } = render(<Harness />)
    expect(screen.getByTestId("viewport-h").textContent).toBe("600")
    expect(screen.getByTestId("content").textContent).toBe("375x600")
    expect(screen.getByTestId("shell").textContent).toBe("300x600")
    unmount()

    useAppStore.setState({ mobileViewMode: "125" })
    render(<Harness />)
    // 600 可视高 ÷ 1.25 = 480 逻辑视口高。
    expect(screen.getByTestId("viewport-h").textContent).toBe("480")
    expect(screen.getByTestId("content").textContent).toBe("468.75x600")
    expect(screen.getByTestId("shell").textContent).toBe("300x600")
  })
})

describe("每模式位置记忆", () => {
  it("切换模式时各记各的，切回恢复", () => {
    resetStore()
    render(<Harness />)
    const scroll = screen.getByTestId("scroll")
    patchScrollMetrics(scroll, {
      scrollHeight: 1200,
      clientHeight: 400,
      scrollWidth: 500,
      clientWidth: 300,
    })

    scroll.scrollTop = 250
    scroll.scrollLeft = 40
    fireEvent.scroll(scroll)
    expect(useAppStore.getState().mobileScrollPositions["fit-width"]).toEqual({
      top: 250,
      left: 40,
    })

    fireEvent.click(screen.getByText("mode-100"))
    expect(scroll.scrollTop).toBe(0)

    scroll.scrollTop = 500
    fireEvent.scroll(scroll)
    // 100% 模式首次进入时 left 已恢复为它自己的 0。
    expect(useAppStore.getState().mobileScrollPositions["100"]).toEqual({
      top: 500,
      left: 0,
    })

    fireEvent.click(screen.getByText("mode-fit"))
    expect(scroll.scrollTop).toBe(250)
    expect(scroll.scrollLeft).toBe(40)
  })

  it("切回时按新的可滚范围 clamp", () => {
    resetStore()
    render(<Harness />)
    const scroll = screen.getByTestId("scroll")
    patchScrollMetrics(scroll, {
      scrollHeight: 1200,
      clientHeight: 400,
      scrollWidth: 500,
      clientWidth: 300,
    })

    scroll.scrollTop = 700
    fireEvent.scroll(scroll)

    // 可用内容变短：最大可滚只剩 200。
    patchScrollMetrics(scroll, {
      scrollHeight: 600,
      clientHeight: 400,
      scrollWidth: 300,
      clientWidth: 300,
    })

    fireEvent.click(screen.getByText("mode-100"))
    fireEvent.click(screen.getByText("mode-fit"))
    expect(scroll.scrollTop).toBe(200)
  })

  it("jumpTo 写入当前模式的位置，并同步 viewportHeight", () => {
    resetStore()
    useAppStore.setState({ mobileViewMode: "100" })
    render(<Harness />)
    const scroll = screen.getByTestId("scroll")
    patchScrollMetrics(scroll, {
      scrollHeight: 780,
      clientHeight: 400,
      scrollWidth: 375,
      clientWidth: 300,
    })

    // 切换一次模式让 hook 读取注入的 clientHeight。
    fireEvent.click(screen.getByText("mode-fit"))
    fireEvent.click(screen.getByText("mode-100"))
    expect(screen.getByTestId("viewport-height").textContent).toBe("400")

    fireEvent.click(screen.getByText("jump-300"))
    expect(scroll.scrollTop).toBe(300)
    expect(useAppStore.getState().mobileScrollPositions["100"].top).toBe(300)
  })
})
