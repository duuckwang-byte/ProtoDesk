/**
 * src/renderer/components/ui/__tests__/dialog-focus.test.tsx — 设置 Dialog 焦点陷阱回归（B-SET-P2-1）。
 *
 * 覆盖：
 * - 打开后焦点进入 Dialog 首个可聚焦元素；
 * - Tab / Shift+Tab 在 Dialog 内循环，Shift+Tab 不再逃到背景顶栏；
 * - 关闭（X / 全局 Esc 栈兜底）后焦点回归打开按钮；
 * - 非设置 Dialog（`data-testid` 不是 settings-dialog）保持原焦点行为。
 */

import * as React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Dialog, DialogContent, DialogTitle } from "../dialog"
import { closeTopmostOverlay } from "@/stores/ui-store"

afterEach(cleanup)

function Host({ testId = "settings-dialog" }: { testId?: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <button type="button" data-testid="background">
        背景按钮
      </button>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        打开设置
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid={testId}>
          <DialogTitle>设置</DialogTitle>
          <button type="button" data-testid="first">
            第一个
          </button>
          <button type="button" data-testid="last">
            最后一个
          </button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function openDialog(testId?: string): { opener: HTMLElement } {
  render(<Host testId={testId} />)
  const opener = screen.getByTestId("opener")
  opener.focus()
  fireEvent.click(opener)
  expect(screen.getByRole("dialog")).toBeTruthy()
  return { opener }
}

describe("设置 Dialog 焦点陷阱（B-SET-P2-1）", () => {
  it("打开后焦点进入 Dialog 首个可聚焦元素，而不是停在背景", () => {
    openDialog()
    expect(document.activeElement).toBe(screen.getByTestId("first"))
    expect(document.activeElement).not.toBe(screen.getByTestId("background"))
  })

  it("Shift+Tab 从首项循环到末项，Tab 从末项回到首项", () => {
    openDialog()
    const first = screen.getByTestId("first")
    const last = screen.getByTestId("last")
    const close = screen.getByRole("button", { name: "关闭" })

    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: "Tab" })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(last, { key: "Tab" })
    expect(document.activeElement).toBe(first)
  })

  it("X 关闭后焦点回归打开按钮", () => {
    const { opener } = openDialog()
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it("全局 Esc 栈兜底关闭后焦点回归打开按钮", () => {
    const { opener } = openDialog()
    act(() => {
      expect(closeTopmostOverlay()).toBeTruthy()
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it("非设置 Dialog 不改变焦点（陷阱只对设置开启）", () => {
    const { opener } = openDialog("generic-dialog")
    expect(document.activeElement).toBe(opener)
    expect(document.activeElement).not.toBe(screen.getByTestId("first"))

    // 也允许显式关闭：调用方可以传 focusTrap={false} 保持旧行为。
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(document.activeElement).toBe(opener)
  })
})
