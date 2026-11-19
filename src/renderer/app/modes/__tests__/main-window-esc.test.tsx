/**
 * src/renderer/app/modes/__tests__/main-window-esc.test.tsx — Esc 栈单入口回归。
 *
 * 复现 shell-P2-1 / postfix-P1-1：文档 + 设置 + AI 同时打开时，按 1 次 Esc
 * 只允许关最上面一层，且焦点回到打开该层的触发按钮。
 *
 * DialogContent / SheetContent / AlertDialogContent 已不再各自监听 Esc，
 * 因此这里用真实 Dialog 挂载替身即可验证：一次 keydown 只有 MainWindow 的
 * window 监听会调用一次 closeTopmost()，不会出现「Dialog 先关一层、全局再
 * 关一层」的竞态。
 */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import MainWindow from "../MainWindow"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useAppStore } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"

vi.mock("@/components/shell/Topbar", () => ({ default: () => null }))
vi.mock("@/components/shell/Sidebar", () => ({ default: () => null }))
vi.mock("@/components/shell/Stage", () => ({ default: () => null }))
vi.mock("@/components/shell/DocsPanelHost", () => ({ default: () => null }))
vi.mock("@/features/projects/ProjectPicker", () => ({ default: () => null }))
vi.mock("@/features/git/GitPanel", () => ({ GitPanel: () => null }))

vi.mock("@/features/ai/AiDialog", async () => {
  const { Dialog, DialogContent } = await import("@/components/ui/dialog")
  return {
    AiDialog: function AiDialog({
      open,
      onOpenChange,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
    }) {
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent data-testid="ai-dialog">AI 对话</DialogContent>
        </Dialog>
      )
    },
  }
})

vi.mock("@/features/settings/SettingsDialog", async () => {
  const { Dialog, DialogContent } = await import("@/components/ui/dialog")
  return {
    SettingsDialog: function SettingsDialog({
      open,
      onOpenChange,
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
    }) {
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent data-testid="settings-dialog">设置</DialogContent>
        </Dialog>
      )
    },
  }
})

let localEscCalls = 0

/** 不属于 ui-store 栈的通用 Dialog（如项目选择 / Git 配置）：只能靠全局兜底关闭。 */
function GenericDialogHarness() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button data-testid="open-generic" onClick={() => setOpen(true)}>
        通用弹层
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="generic-dialog">通用弹层内容</DialogContent>
      </Dialog>
    </>
  )
}

function EscHarness() {
  return (
    <div>
      <button data-testid="open-docs" onClick={() => useUiStore.getState().openDocs()}>
        文档
      </button>
      <button data-testid="open-settings" onClick={() => useUiStore.getState().openSettings("agent")}>
        设置
      </button>
      <button data-testid="open-git" onClick={() => useUiStore.getState().openGit()}>
        Git
      </button>
      <button data-testid="open-export" onClick={() => useUiStore.getState().openExport()}>
        导出
      </button>
      <button data-testid="open-ai" onClick={() => useUiStore.getState().openAi()}>
        AI
      </button>
      <input
        data-testid="local-esc"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.stopPropagation()
          localEscCalls += 1
        }}
      />
      <MainWindow />
      <GenericDialogHarness />
    </div>
  )
}

function openLayer(testId: string): void {
  const trigger = screen.getByTestId(testId)
  // jsdom 点击不会自动聚焦；手动聚焦以覆盖「焦点回归触发按钮」。
  trigger.focus()
  fireEvent.click(trigger)
}

function pressEsc(target: Element | Document | Window = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  localEscCalls = 0
  useAppStore.setState({ sidebarOpen: true, kind: "pc", project: "", proto: "" })
  useUiStore.setState({
    docsOpen: false,
    aiOpen: false,
    settingsTab: null,
    gitOpen: false,
    exportOpen: false,
    miniDockVisible: true,
    toasts: [],
  })
})

afterEach(() => {
  cleanup()
})

describe("MainWindow Esc 栈单入口", () => {
  it("设置 + AI 双层：1 次 Esc 只关 AI（1/1 → 0/1），再按一次关设置并回归焦点", () => {
    render(<EscHarness />)
    openLayer("open-settings")
    openLayer("open-ai")

    expect(useUiStore.getState()).toMatchObject({ aiOpen: true, settingsTab: "agent" })
    expect(screen.getByTestId("ai-dialog")).toBeTruthy()
    expect(screen.getByTestId("settings-dialog")).toBeTruthy()

    const first = pressEsc()
    expect(first.defaultPrevented).toBe(true)
    expect(useUiStore.getState()).toMatchObject({ aiOpen: false, settingsTab: "agent" })
    expect(screen.queryByTestId("ai-dialog")).toBeNull()
    expect(screen.getByTestId("settings-dialog")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId("open-ai"))

    const second = pressEsc()
    expect(second.defaultPrevented).toBe(true)
    expect(useUiStore.getState()).toMatchObject({ aiOpen: false, settingsTab: null })
    expect(screen.queryByTestId("settings-dialog")).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId("open-settings"))
  })

  it("一次 keydown 只关最上层：AI → 设置 → Git → 导出 → 文档，逐层可继续关", () => {
    render(<EscHarness />)
    openLayer("open-docs")
    openLayer("open-settings")
    openLayer("open-git")
    openLayer("open-export")
    openLayer("open-ai")

    expect(useUiStore.getState()).toMatchObject({
      aiOpen: true,
      settingsTab: "agent",
      gitOpen: true,
      exportOpen: true,
      docsOpen: true,
    })

    pressEsc()
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: "agent",
      gitOpen: true,
      exportOpen: true,
      docsOpen: true,
    })
    expect(screen.queryByTestId("ai-dialog")).toBeNull()
    expect(screen.getByTestId("settings-dialog")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId("open-ai"))

    pressEsc()
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: true,
      exportOpen: true,
      docsOpen: true,
    })
    expect(screen.queryByTestId("settings-dialog")).toBeNull()
    expect(screen.getByTestId("git-sheet")).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByTestId("open-settings"))

    pressEsc()
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: true,
      docsOpen: true,
    })
    expect(screen.queryByTestId("git-sheet")).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId("open-git"))

    pressEsc()
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: false,
      docsOpen: true,
    })
    expect(document.activeElement).toBe(screen.getByTestId("open-export"))

    pressEsc()
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: false,
      docsOpen: false,
    })
    expect(document.activeElement).toBe(screen.getByTestId("open-docs"))

    // 栈空后继续按 Esc 不报错、不再产生关闭副作用。
    pressEsc()
    expect(useUiStore.getState()).toMatchObject({ docsOpen: false })
  })

  it("同一 tick 内连续两次 keydown 仍各关一层，不因节流漏关", () => {
    render(<EscHarness />)
    openLayer("open-docs")
    openLayer("open-settings")
    openLayer("open-ai")

    act(() => {
      const dispatch = () =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          })
        )
      dispatch()
      dispatch()
    })

    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: false,
      docsOpen: true,
    })
  })

  it("全局栈为空时，通用弹层仍由同一 Esc 入口逐层关闭", () => {
    render(<EscHarness />)
    openLayer("open-docs")
    const genericTrigger = screen.getByTestId("open-generic")
    genericTrigger.focus()
    fireEvent.click(genericTrigger)
    expect(screen.getByTestId("generic-dialog")).toBeTruthy()

    // 第一次 Esc：全局栈优先关文档，通用弹层保持打开。
    pressEsc()
    expect(useUiStore.getState().docsOpen).toBe(false)
    expect(screen.getByTestId("generic-dialog")).toBeTruthy()

    // 第二次 Esc：全局栈为空，兜底关闭通用弹层，焦点回到打开它的按钮。
    pressEsc()
    expect(screen.queryByTestId("generic-dialog")).toBeNull()
    expect(document.activeElement).toBe(genericTrigger)
  })

  it("收起侧栏后不渲染左下角 MiniDock 浮层", () => {
    useAppStore.setState({ sidebarOpen: false })
    render(<MainWindow />)

    expect(screen.queryByTestId("mini-dock")).toBeNull()
    expect(screen.queryByRole("button", { name: "展开侧栏" })).toBeNull()
  })

  it("同一个 keydown Event 重复派发只决策一次（事件级去重，不靠微任务复位）", () => {
    render(<EscHarness />)
    openLayer("open-settings")
    openLayer("open-ai")

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      })
      document.body.dispatchEvent(event)
      // 模拟同一事件被再次送达（例如多个冒泡路径/重复派发）：
      document.body.dispatchEvent(event)
    })

    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: "agent",
    })
    expect(screen.queryByTestId("ai-dialog")).toBeNull()
    expect(screen.getByTestId("settings-dialog")).toBeTruthy()
  })

  it("document 上的合成 Esc 不双关：全局入口只关一层", () => {
    render(<EscHarness />)
    openLayer("open-docs")
    openLayer("open-settings")
    openLayer("open-ai")

    const event = pressEsc(document)
    expect(event.defaultPrevented).toBe(true)

    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: "agent",
      gitOpen: false,
      exportOpen: false,
      docsOpen: true,
    })
    expect(screen.queryByTestId("ai-dialog")).toBeNull()
    expect(screen.getByTestId("settings-dialog")).toBeTruthy()
  })

  it("一次 keydown 只调用一次 closeTopmost，不连续触发", () => {
    render(<EscHarness />)
    openLayer("open-docs")
    openLayer("open-settings")
    openLayer("open-ai")

    const original = useUiStore.getState().closeTopmost
    const spy = vi.fn(original)
    useUiStore.setState({ closeTopmost: spy })
    try {
      pressEsc()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(useUiStore.getState()).toMatchObject({
        aiOpen: false,
        settingsTab: "agent",
        docsOpen: true,
      })

      pressEsc()
      expect(spy).toHaveBeenCalledTimes(2)
      expect(useUiStore.getState()).toMatchObject({
        aiOpen: false,
        settingsTab: null,
        docsOpen: true,
      })
    } finally {
      useUiStore.setState({ closeTopmost: original })
    }
  })

  it("局部 Esc stopPropagation 时全局栈让路，不抢行内编辑/搜索", () => {
    render(<EscHarness />)
    openLayer("open-docs")

    const input = screen.getByTestId("local-esc")
    input.focus()
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" })

    expect(localEscCalls).toBe(1)
    expect(useUiStore.getState().docsOpen).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it("程序化 click 未聚焦触发按钮时，Esc 仍把焦点还给该按钮", () => {
    render(<EscHarness />)
    const trigger = screen.getByTestId("open-ai")
    // jsdom 的 click() 不会像真实鼠标那样聚焦按钮，模拟 e2e 的 DOM click。
    fireEvent.click(trigger)
    expect(useUiStore.getState().aiOpen).toBe(true)
    expect(document.activeElement).not.toBe(trigger)

    pressEsc()
    expect(useUiStore.getState().aiOpen).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it("Dialog 关闭按钮（非 Esc）仍按原路径只关自身", () => {
    render(<EscHarness />)
    openLayer("open-docs")
    openLayer("open-settings")
    openLayer("open-ai")

    const aiDialog = screen.getByTestId("ai-dialog")
    fireEvent.click(within(aiDialog).getByRole("button", { name: "关闭" }))

    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: "agent",
      docsOpen: true,
    })
  })
})
