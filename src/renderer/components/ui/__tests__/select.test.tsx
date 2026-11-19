/**
 * src/renderer/components/ui/__tests__/select.test.tsx — 自研 Select 回归。
 *
 * 覆盖 B-SET-P1-2 / P2-3：
 * - 真实鼠标 mousedown 即选中（浮层不会因 trigger onBlur 先卸载导致 click 落空）；
 * - 键盘 ↑/↓/Home/End + Enter/Space 可用；
 * - Esc 只关 Select，不把同一次按键传给 window 上的全局 Esc 栈（设置 Dialog）。
 */

import * as React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Select, SelectContent, SelectItem, SelectTrigger } from "../select"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Host({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <Select defaultValue="a" onValueChange={onValueChange}>
      <SelectTrigger aria-label="测试选择">
        <span>当前选项</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">选项 A</SelectItem>
        <SelectItem value="b">选项 B</SelectItem>
        <SelectItem value="c">选项 C</SelectItem>
      </SelectContent>
    </Select>
  )
}

function openSelect(): { trigger: HTMLElement } {
  render(<Host onValueChange={vi.fn()} />)
  const trigger = screen.getByRole("combobox", { name: "测试选择" })
  fireEvent.click(trigger)
  expect(screen.getByRole("listbox")).toBeTruthy()
  return { trigger }
}

describe("Select 鼠标选择（B-SET-P1-2）", () => {
  it("mousedown 阻止 trigger 失焦，click 正常选中并收起浮层", () => {
    const onValueChange = vi.fn()
    render(<Host onValueChange={onValueChange} />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })
    trigger.focus()
    fireEvent.click(trigger)

    const optionB = screen.getByRole("option", { name: /选项 B/ })
    // 浏览器默认会在 mousedown 时把焦点从 trigger 移到 body，触发根节点
    // onBlur 卸载浮层；组件必须 preventDefault 保住 trigger 焦点。
    // fireEvent 返回 false 表示事件的默认行为已被阻止。
    expect(fireEvent.mouseDown(optionB)).toBe(false)
    expect(screen.getByRole("listbox")).toBeTruthy()
    expect(document.activeElement).toBe(trigger)

    // 焦点未丢，mouseup 后的 click 仍落在选项上。
    fireEvent.mouseUp(optionB)
    fireEvent.click(optionB)

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith("b")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("程序化 click（E2E dispatchEvent 路径）仍能选中", () => {
    const onValueChange = vi.fn()
    render(<Host onValueChange={onValueChange} />)
    fireEvent.click(screen.getByRole("combobox", { name: "测试选择" }))
    const optionC = screen.getByRole("option", { name: /选项 C/ })
    act(() => {
      optionC.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onValueChange).toHaveBeenCalledWith("c")
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

describe("Select 键盘操作", () => {
  it("Enter 打开，↓ 移动高亮，Enter 选中", () => {
    const onValueChange = vi.fn()
    render(<Host onValueChange={onValueChange} />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })

    trigger.focus()
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(screen.getByRole("listbox")).toBeTruthy()
    // 打开后默认高亮当前值 a。
    expect(screen.getByRole("option", { name: /选项 A/ }).getAttribute("data-highlighted")).toBe("true")

    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(screen.getByRole("option", { name: /选项 B/ }).getAttribute("data-highlighted")).toBe("true")
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /选项 B/ }).id
    )

    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(onValueChange).toHaveBeenCalledWith("b")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("↑ 从首项循环到末项，Home/End 跳转，Space 选中", () => {
    const onValueChange = vi.fn()
    render(<Host onValueChange={onValueChange} />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })

    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    expect(screen.getByRole("listbox")).toBeTruthy()
    fireEvent.keyDown(trigger, { key: "ArrowUp" })
    expect(screen.getByRole("option", { name: /选项 C/ }).getAttribute("data-highlighted")).toBe("true")

    fireEvent.keyDown(trigger, { key: "Home" })
    expect(screen.getByRole("option", { name: /选项 A/ }).getAttribute("data-highlighted")).toBe("true")

    fireEvent.keyDown(trigger, { key: "End" })
    fireEvent.keyDown(trigger, { key: " " })
    expect(onValueChange).toHaveBeenCalledWith("c")
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

describe("Select Esc 隔离（B-SET-P2-3）", () => {
  it("Esc 只关自身，window 上的全局 Esc 栈收不到事件", () => {
    render(<Host />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })
    fireEvent.click(trigger)
    expect(screen.getByRole("listbox")).toBeTruthy()

    const onWindowKeyDown = vi.fn()
    window.addEventListener("keydown", onWindowKeyDown)
    try {
      fireEvent.keyDown(trigger, { key: "Escape" })
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown)
    }

    expect(onWindowKeyDown).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("关闭状态下 Esc 不拦截，仍交给全局栈", () => {
    render(<Host />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })
    const onWindowKeyDown = vi.fn()
    window.addEventListener("keydown", onWindowKeyDown)
    try {
      fireEvent.keyDown(trigger, { key: "Escape" })
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown)
    }
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1)
  })

  it("点击浮层与触发器之外收起，但不把该次 mousedown 当成选中", () => {
    const onValueChange = vi.fn()
    render(<Host onValueChange={onValueChange} />)
    fireEvent.click(screen.getByRole("combobox", { name: "测试选择" }))
    expect(screen.getByRole("listbox")).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("嵌在设置 Dialog 中按 Esc 不会触发 Dialog 关闭监听", () => {
    const closeDialog = vi.fn()
    function SettingsLike() {
      React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") closeDialog()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
      }, [])
      return <Host />
    }
    render(<SettingsLike />)
    fireEvent.click(screen.getByRole("combobox", { name: "测试选择" }))
    act(() => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "测试选择" }), { key: "Escape" })
    })
    expect(closeDialog).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

describe("Select 浮层 portal / 定位 / 翻转（RETEST-B-SET-P2-1）", () => {
  function mockRect(el: HTMLElement, rect: { top: number; bottom: number; left: number; width: number }) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      height: rect.bottom - rect.top,
      toJSON: () => ({}),
    } as DOMRect)
  }

  function mockSize(el: HTMLElement, size: { width: number; height: number }) {
    Object.defineProperty(el, "offsetWidth", { configurable: true, value: size.width })
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: size.height })
  }

  it("浮层挂到 body 且 fixed + 高 z-index，不被 overflow-hidden 祖先裁剪", () => {
    render(
      <div style={{ overflow: "hidden", height: 40 }}>
        <Host />
      </div>
    )
    fireEvent.click(screen.getByRole("combobox", { name: "测试选择" }))
    const listbox = screen.getByRole("listbox")

    expect(listbox.parentElement).toBe(document.body)
    expect(listbox.style.position).toBe("fixed")
    expect(Number(listbox.style.zIndex)).toBeGreaterThan(50)
    expect(listbox.className).toContain("overflow-y-auto")
    expect(listbox.style.visibility).toBe("visible")
  })

  it("下方空间充足时向下展开，最大高度按下方空间钳制", () => {
    render(<Host />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })
    fireEvent.click(trigger)
    const listbox = screen.getByRole("listbox")

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768)
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024)
    mockRect(trigger, { top: 100, bottom: 132, left: 100, width: 160 })
    mockSize(listbox, { width: 160, height: 96 })
    fireEvent(window, new Event("resize"))

    expect(listbox.dataset.placement).toBe("bottom")
    expect(listbox.style.top).toBe("136px")
    expect(listbox.style.bottom).toBe("auto")
    expect(listbox.style.maxHeight).toBe(`${768 - 132 - 4 - 8}px`)
    expect(listbox.style.minWidth).toBe("160px")
  })

  it("下方空间不足时向上翻转，并按上方可用空间钳制高度", () => {
    render(<Host />)
    const trigger = screen.getByRole("combobox", { name: "测试选择" })
    fireEvent.click(trigger)
    const listbox = screen.getByRole("listbox")

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500)
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024)
    mockRect(trigger, { top: 440, bottom: 472, left: 300, width: 160 })
    mockSize(listbox, { width: 180, height: 120 })
    fireEvent(window, new Event("resize"))

    expect(listbox.dataset.placement).toBe("top")
    expect(listbox.style.top).toBe("auto")
    expect(listbox.style.bottom).toBe(`${500 - 440 + 4}px`)
    expect(listbox.style.maxHeight).toBe(`${440 - 4 - 8}px`)
  })
})
