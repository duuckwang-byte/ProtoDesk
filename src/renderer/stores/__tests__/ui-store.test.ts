/**
 * src/renderer/stores/__tests__/ui-store.test.ts — Esc 栈单层关闭回归。
 *
 * 覆盖 shell-P2-1 的 store 契约：每次 closeTopmost() 只关最上面一层，
 * 顺序固定为 AI > 设置 > Git > 导出 > 文档；上一层关掉后下一层仍可继续关。
 */

import { beforeEach, describe, expect, it } from "vitest"
import { closeTopmostOverlay, registerOverlayLayer, useUiStore } from "../ui-store"

function resetUiStore(): void {
  useUiStore.setState({
    docsOpen: false,
    aiOpen: false,
    settingsTab: null,
    gitOpen: false,
    exportOpen: false,
    miniDockVisible: true,
    toasts: [],
  })
}

beforeEach(resetUiStore)

describe("通用弹层 Esc 栈（Dialog/Sheet/AlertDialog 登记）", () => {
  it("一次只关最后登记的一层，注销后不重复关闭", () => {
    const closed: string[] = []
    const offA = registerOverlayLayer({ close: () => closed.push("a") })
    const offB = registerOverlayLayer({ close: () => closed.push("b") })

    try {
      expect(closeTopmostOverlay()).not.toBeNull()
      expect(closed).toEqual(["b"])

      // 关闭后已同步出栈；组件 cleanup 的注销是幂等的。
      offB()
      expect(closeTopmostOverlay()).not.toBeNull()
      expect(closed).toEqual(["b", "a"])
      expect(closeTopmostOverlay()).toBeNull()
    } finally {
      offA()
      offB()
    }
  })
})

describe("useUiStore.closeTopmost（Esc 栈）", () => {
  it("无可关层时返回 null", () => {
    expect(useUiStore.getState().closeTopmost()).toBeNull()
  })

  it("一次调用只关最上层，顺序 AI > 设置 > Git > 导出 > 文档", () => {
    const ui = useUiStore.getState()
    ui.openDocs()
    ui.openExport()
    ui.openGit()
    ui.openSettings("agent")
    ui.openAi()

    expect(useUiStore.getState().closeTopmost()).toBe("ai")
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: "agent",
      gitOpen: true,
      exportOpen: true,
      docsOpen: true,
    })

    expect(useUiStore.getState().closeTopmost()).toBe("settings")
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: true,
      exportOpen: true,
      docsOpen: true,
    })

    expect(useUiStore.getState().closeTopmost()).toBe("git")
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: true,
      docsOpen: true,
    })

    expect(useUiStore.getState().closeTopmost()).toBe("export")
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: false,
      docsOpen: true,
    })

    expect(useUiStore.getState().closeTopmost()).toBe("docs")
    expect(useUiStore.getState()).toMatchObject({
      aiOpen: false,
      settingsTab: null,
      gitOpen: false,
      exportOpen: false,
      docsOpen: false,
    })

    expect(useUiStore.getState().closeTopmost()).toBeNull()
  })

  it("跳过已关闭的层，不因中间层为空而提前结束", () => {
    useUiStore.setState({ aiOpen: false, settingsTab: null, gitOpen: true, docsOpen: true })

    expect(useUiStore.getState().closeTopmost()).toBe("git")
    expect(useUiStore.getState().gitOpen).toBe(false)
    expect(useUiStore.getState().docsOpen).toBe(true)

    expect(useUiStore.getState().closeTopmost()).toBe("docs")
    expect(useUiStore.getState().docsOpen).toBe(false)
  })
})
