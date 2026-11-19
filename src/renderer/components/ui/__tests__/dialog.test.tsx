/**
 * src/renderer/components/ui/__tests__/dialog.test.tsx — 弹层关闭路径回归。
 *
 * 覆盖 postfix-P2-1 / postfix-P1-1 的两个基础约束：
 * - 遮罩是内容层的兄弟而不是被全屏容器压住，点空白关、点内容不关、X 关；
 * - DialogContent / SheetContent / AlertDialogContent 不再监听 Esc，
 *   避免与 MainWindow 的全局 Esc 栈各关一次（一次键关两层）。
 */

import * as React from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Dialog, DialogContent, DialogTitle } from "../dialog"
import { Sheet, SheetContent, SheetTitle } from "../sheet"
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from "../alert-dialog"

afterEach(cleanup)

function pressEsc(target: Element | Node | Window | Document = document.body): void {
  fireEvent.keyDown(target, { key: "Escape", code: "Escape" })
}

function renderDialog(): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn()
  function Host() {
    const [open, setOpen] = React.useState(true)
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          setOpen(next)
        }}
      >
        <DialogContent data-testid="test-dialog">
          <DialogTitle>测试对话框</DialogTitle>
          <button type="button" data-testid="inside">
            内容按钮
          </button>
        </DialogContent>
      </Dialog>
    )
  }
  render(<Host />)
  return { onOpenChange }
}

describe("Dialog 遮罩 / X / Esc", () => {
  it("遮罩是内容的兄弟层，点遮罩关闭、点内容不关闭", () => {
    const { onOpenChange } = renderDialog()
    const portal = document.querySelector('[data-slot="dialog-portal"]') as HTMLElement
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement
    const content = screen.getByTestId("test-dialog")

    // 结构契约：内容直接挂在布局容器下，遮罩后面没有全屏 absolute 包裹层挡着。
    expect(overlay.parentElement).toBe(portal)
    expect(content.parentElement).toBe(portal)
    expect(overlay.nextElementSibling).toBe(content)

    fireEvent.click(content)
    fireEvent.click(screen.getByTestId("inside"))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("test-dialog")).toBeTruthy()

    fireEvent.click(overlay)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("test-dialog")).toBeNull()
  })

  it("X 只走自身关闭路径", () => {
    const { onOpenChange } = renderDialog()
    fireEvent.click(within(screen.getByTestId("test-dialog")).getByRole("button", { name: "关闭" }))
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("test-dialog")).toBeNull()
  })

  it("Esc 不由 DialogContent 处理，留给全局 Esc 栈", () => {
    const { onOpenChange } = renderDialog()
    pressEsc()
    pressEsc(window)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("test-dialog")).toBeTruthy()
  })
})

function renderSheet(): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn()
  function Host() {
    const [open, setOpen] = React.useState(true)
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          setOpen(next)
        }}
      >
        <SheetContent data-testid="test-sheet">
          <SheetTitle>测试面板</SheetTitle>
        </SheetContent>
      </Sheet>
    )
  }
  render(<Host />)
  return { onOpenChange }
}

describe("Sheet 遮罩 / Esc", () => {
  it("点遮罩关闭、点内容不关闭", () => {
    const { onOpenChange } = renderSheet()
    const content = screen.getByTestId("test-sheet")

    fireEvent.click(content)
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('[data-slot="sheet-overlay"]') as HTMLElement)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("test-sheet")).toBeNull()
  })

  it("Esc 不由 SheetContent 处理", () => {
    const { onOpenChange } = renderSheet()
    pressEsc()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("test-sheet")).toBeTruthy()
  })
})

function renderAlertDialog(): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn()
  function Host() {
    const [open, setOpen] = React.useState(true)
    return (
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          setOpen(next)
        }}
      >
        <AlertDialogContent data-testid="test-alert">
          <AlertDialogTitle>确认删除</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    )
  }
  render(<Host />)
  return { onOpenChange }
}

describe("AlertDialog Esc", () => {
  it("Esc 不自关，必须由用户显式选择", () => {
    const { onOpenChange } = renderAlertDialog()
    pressEsc()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("test-alert")).toBeTruthy()
  })
})
