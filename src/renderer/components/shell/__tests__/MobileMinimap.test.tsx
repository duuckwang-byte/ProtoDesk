/**
 * MobileMinimap.test.tsx — 移动端小地图的纯展示行为。
 *
 * 覆盖：轨道/视口矩形比例、点击与拖动跳转、上下界 clamp、隐藏条件、
 * 键盘可达性、外层 pointer-events 不遮挡 iframe。
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import MobileMinimap, {
  MINIMAP_TRACK_HEIGHT,
  type MobileMinimapProps,
} from "../MobileMinimap"

afterEach(() => {
  cleanup()
})

const baseProps: Omit<MobileMinimapProps, "onJump"> = {
  totalHeight: 1200,
  viewportHeight: 300,
  scrollTop: 0,
  visible: true,
}

function setup(overrides: Partial<MobileMinimapProps> = {}) {
  const onJump = vi.fn()
  const view = render(<MobileMinimap {...baseProps} onJump={onJump} {...overrides} />)
  return { onJump, ...view }
}

describe("MobileMinimap 比例与位置", () => {
  it("轨道固定 120px，视口矩形高度/位置按 totalHeight 比例换算", () => {
    const { rerender, onJump } = setup({ scrollTop: 300 })

    const track = screen.getByTestId("mobile-minimap-track")
    const thumb = screen.getByTestId("mobile-minimap-thumb")

    expect(track.style.height).toBe(`${MINIMAP_TRACK_HEIGHT}px`)
    // 高度 300/1200 × 120 = 30；位置 300/1200 × 120 = 30。
    expect(thumb.style.height).toBe("30px")
    expect(thumb.style.top).toBe("30px")

    // 滚到底时视口矩形正好贴住轨道底部：900/1200 × 120 = 90，90 + 30 = 120。
    rerender(<MobileMinimap {...baseProps} scrollTop={900} onJump={onJump} />)
    expect(screen.getByTestId("mobile-minimap-thumb").style.top).toBe("90px")
  })

  it("超长页面仍严格按 viewportHeight/totalHeight 缩放矩形", () => {
    setup({ totalHeight: 12000, viewportHeight: 300, scrollTop: 6000 })
    const thumb = screen.getByTestId("mobile-minimap-thumb")
    // 300/12000 × 120 = 3；6000/12000 × 120 = 60。
    expect(thumb.style.height).toBe("3px")
    expect(thumb.style.top).toBe("60px")
  })

  it("scrollTop 超出范围时按有效区间展示，不越出轨道", () => {
    setup({ scrollTop: 99999 })
    const thumb = screen.getByTestId("mobile-minimap-thumb")
    expect(thumb.style.top).toBe("90px")
    expect(Number.parseFloat(thumb.style.top) + Number.parseFloat(thumb.style.height)).toBe(120)
  })
})

describe("MobileMinimap 点击与拖动", () => {
  it("点击轨道按指针纵向比例跳转", () => {
    const { onJump } = setup()
    const track = screen.getByTestId("mobile-minimap-track")

    fireEvent.pointerDown(track, { clientY: 60, button: 0, pointerId: 1 })
    expect(onJump).toHaveBeenCalledWith(600)
  })

  it("拖动视口矩形保持抓取偏移，不产生跳变", () => {
    const { onJump } = setup({ scrollTop: 300 })
    const track = screen.getByTestId("mobile-minimap-track")

    // 矩形位于 30–60px，从 40px 处按下：抓取偏移 10px，上报当前位置但不跳动。
    fireEvent.pointerDown(track, { clientY: 40, button: 0, pointerId: 1 })
    expect(onJump).toHaveBeenLastCalledWith(300)

    // (70 - 10) / 120 × 1200 = 600。
    fireEvent.pointerMove(track, { clientY: 70, pointerId: 1 })
    expect(onJump).toHaveBeenLastCalledWith(600)

    fireEvent.pointerUp(track, { clientY: 70, pointerId: 1 })
    fireEvent.pointerMove(track, { clientY: 100, pointerId: 1 })
    expect(onJump).toHaveBeenCalledTimes(2)
  })

  it("跳转结果 clamp 到 [0, totalHeight - viewportHeight]", () => {
    const { onJump } = setup()
    const track = screen.getByTestId("mobile-minimap-track")

    fireEvent.pointerDown(track, { clientY: 999, button: 0, pointerId: 1 })
    expect(onJump).toHaveBeenLastCalledWith(900)

    fireEvent.pointerDown(track, { clientY: -999, button: 0, pointerId: 1 })
    expect(onJump).toHaveBeenLastCalledWith(0)
  })
})

describe("MobileMinimap 隐藏条件", () => {
  it("visible=false 时不渲染", () => {
    setup({ visible: false })
    expect(screen.queryByTestId("mobile-minimap")).toBeNull()
  })

  it("totalHeight <= viewportHeight 时无需导航，不渲染", () => {
    const { rerender, onJump } = setup({ totalHeight: 300, viewportHeight: 300 })
    expect(screen.queryByTestId("mobile-minimap")).toBeNull()

    rerender(<MobileMinimap {...baseProps} totalHeight={280} viewportHeight={300} onJump={onJump} />)
    expect(screen.queryByTestId("mobile-minimap")).toBeNull()
  })
})

describe("MobileMinimap 键盘与无阻挡", () => {
  it("轨道是中文命名的 slider，方向键/Home/End 可跳转", () => {
    const { onJump } = setup({ scrollTop: 300 })
    const track = screen.getByRole("slider", { name: "页面小地图导航" })

    expect(track.getAttribute("aria-orientation")).toBe("vertical")
    expect(track.getAttribute("aria-valuemax")).toBe("900")
    expect(track.getAttribute("aria-valuenow")).toBe("300")
    expect(track.tabIndex).toBe(0)

    fireEvent.keyDown(track, { key: "ArrowDown" })
    expect(onJump).toHaveBeenLastCalledWith(340)

    fireEvent.keyDown(track, { key: "ArrowUp" })
    expect(onJump).toHaveBeenLastCalledWith(260)

    fireEvent.keyDown(track, { key: "Home" })
    expect(onJump).toHaveBeenLastCalledWith(0)

    fireEvent.keyDown(track, { key: "End" })
    expect(onJump).toHaveBeenLastCalledWith(900)
  })

  it("外层 pointer-events:none，仅轨道自身 auto", () => {
    setup()
    const container = screen.getByTestId("mobile-minimap")
    const track = screen.getByTestId("mobile-minimap-track")

    expect(container.style.pointerEvents).toBe("none")
    expect(track.style.pointerEvents).toBe("auto")
    expect(container.contains(track)).toBe(true)
  })
})
