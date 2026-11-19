/**
 * src/renderer/components/shell/__tests__/Stage.chrome-restore.test.tsx
 *
 * 移动端默认 chrome（取代旧的「进入移动端自动收起、切回 PC 恢复」口径）：
 * - 打开移动端原型：默认展开侧栏并打开文档，不自动收起；
 * - PC → 移动端、移动端源 A → B：确保侧栏 / 文档为打开；
 * - 用户手动关闭后，下一次切端别 / 切到另一个移动端源仍按默认重新打开；
 * - 同一源的子页切换 / 对象刷新不重开（只认 sandboxDir/name 变化）；
 * - 移动端 → PC：只在真实切换瞬间关闭文档，侧栏保留用户当前状态；
 * - PC 首帧 / 刷新不强制关闭，PC 重渲染不产生任何 chrome 改动；
 * - 切到 PC 后手动重新打开文档不会被 effect 再次关闭（不订阅 docsOpen）；
 * - StrictMode 双执行不重复调用 action（目标已为 true 时零写入）。
 */

import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import Stage from "../Stage"
import { createMobileViewportPositions, useAppStore, type StageKind } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"
import { useSourcesStore, type SourceKind, type SourceRef } from "@/stores/sources-store"

function makeSource(kind: SourceKind, displayName: string, sandboxDir: string): SourceRef {
  const name = `${displayName}.html`
  return {
    name,
    displayName,
    kind,
    sandboxDir,
    mainHtmlFile: name,
    mdFile: null,
    subPages: [],
    htmlFiles: [name],
    content: "<html></html>",
    md: "",
    pages: [],
    __ver: 1,
  }
}

const PC_SOURCE = makeSource("pc", "首页", "D:/sandbox/测试1/首页")
const MOBILE_A = makeSource("mobile", "移动端首页", "D:/sandbox/测试1/移动端首页")
const MOBILE_B = makeSource("mobile", "移动端详情", "D:/sandbox/测试1/移动端详情")

vi.mock("@/features/preview/PreviewFrame", () => ({
  default: () => <div data-testid="preview-frame" />,
}))

vi.mock("@/features/preview/PreviewOverlaysHost", () => ({
  default: () => null,
}))

vi.mock("@/components/shell/MobileMinimap", () => ({
  default: () => null,
}))

class ResizeObserverMock {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

interface ResetOptions {
  sidebarOpen?: boolean
  docsOpen?: boolean
  sources?: SourceRef[]
}

function resetStores(
  kind: StageKind,
  current: SourceRef | null,
  options: ResetOptions = {},
): void {
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
    sidebarOpen: options.sidebarOpen ?? true,
  })
  useUiStore.setState({ docsOpen: options.docsOpen ?? false })
  useSourcesStore.setState({
    project: "",
    projects: [],
    sources: options.sources ?? (current ? [current] : []),
    currentSource: current,
    activeSubFile: current?.mainHtmlFile || "",
    activeContent: "",
    loading: false,
    error: "",
  })
}

/** 与 Topbar / sources-store 一样只经 setKind 切端别，让 Stage 的 effect 自然执行。 */
function switchKind(kind: StageKind): void {
  act(() => {
    useAppStore.getState().setKind(kind)
  })
}

/** 与侧栏点击一样经 selectSource 切源（同步写 currentSource + 端别）。 */
function switchSource(name: string): void {
  act(() => {
    useSourcesStore.getState().selectSource(name)
  })
}

/** 模拟用户手动关闭两项 chrome。 */
function closeChromeByUser(): void {
  act(() => {
    useAppStore.getState().setSidebarOpen(false)
    useUiStore.getState().closeDocs()
  })
}

function chrome(): { sidebarOpen: boolean; docsOpen: boolean } {
  return {
    sidebarOpen: useAppStore.getState().sidebarOpen,
    docsOpen: useUiStore.getState().docsOpen,
  }
}

beforeEach(() => {
  resetStores("pc", PC_SOURCE)
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverMock
})

afterEach(() => {
  cleanup()
})

describe("移动端默认展开侧栏 / 文档", () => {
  it("初始就是移动端原型：侧栏与文档默认打开，不自动收起", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: false, docsOpen: false })
    render(<Stage />)

    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })

  it("PC → 移动端：切端别后侧栏与文档为打开", () => {
    resetStores("pc", PC_SOURCE, { sidebarOpen: false, docsOpen: false })
    render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })

    switchKind("mobile")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
    expect(screen.getByTestId("stage-frame").getAttribute("data-kind")).toBe("mobile")
  })

  it("移动端舞台无源时切端别也默认打开；仅挂载且无源时不强制", () => {
    resetStores("pc", null, { sidebarOpen: false, docsOpen: false })
    const { unmount } = render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })
    unmount()

    // 直接在移动端挂载但没有原型：没有「打开原型」事件，不改动调用方状态。
    resetStores("mobile", null, { sidebarOpen: false, docsOpen: false })
    render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })

    // 顶栏从 pc 切到 mobile：属于显式进入移动端，默认打开。
    switchKind("pc")
    switchKind("mobile")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })

  it("移动端源 A → B：侧栏与文档保持打开", () => {
    resetStores("mobile", MOBILE_A, {
      sidebarOpen: true,
      docsOpen: true,
      sources: [MOBILE_A, MOBILE_B],
    })
    render(<Stage />)

    switchSource(MOBILE_B.name)
    expect(useSourcesStore.getState().currentSource?.sandboxDir).toBe(MOBILE_B.sandboxDir)
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })

  it("用户手动关闭后，切到另一个移动端源会按默认重新打开", () => {
    resetStores("mobile", MOBILE_A, {
      sidebarOpen: false,
      docsOpen: false,
      sources: [MOBILE_A, MOBILE_B],
    })
    render(<Stage />)
    // 初始移动端源默认打开。
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    closeChromeByUser()
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })

    switchSource(MOBILE_B.name)
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })

  it("同一源的子页切换 / 对象刷新不重开，保留用户手动关闭", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: false, docsOpen: false })
    render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    closeChromeByUser()

    // 子页切换只改 activeSubFile / activeContent，sourceId（sandboxDir/name）不变。
    act(() => {
      useSourcesStore.setState({
        currentSource: {
          ...MOBILE_A,
          activeSubFile: "详情.html",
          activeContent: "<p>sub</p>",
        },
        activeSubFile: "详情.html",
        activeContent: "<p>sub</p>",
      })
    })

    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })
  })
})

describe("移动端 → PC 关闭文档 / 侧栏保留", () => {
  it("移动端保持打开时切回 PC：关闭文档，侧栏保留", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: false, docsOpen: false })
    render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    switchKind("pc")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: false })
  })

  it("用户已关闭时切回 PC：不强制打开侧栏 / 文档", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: false, docsOpen: false })
    render(<Stage />)
    closeChromeByUser()

    switchKind("pc")
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })
  })

  it("切到 PC 后手动重新打开文档，重渲染不会被再次关闭", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: true, docsOpen: true })
    const { rerender } = render(<Stage />)
    switchKind("pc")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: false })

    act(() => {
      useUiStore.getState().openDocs()
    })
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    rerender(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })

  it("PC → 移动端 → PC：第二次回到 PC 仍按切换瞬间关闭文档", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: true, docsOpen: true })
    render(<Stage />)

    switchKind("pc")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: false })

    act(() => {
      useUiStore.getState().openDocs()
    })
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    switchKind("mobile")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    switchKind("pc")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: false })
  })

  it("PC 首帧不强制打开；PC 首次挂载已打开文档也不关闭", () => {
    resetStores("pc", PC_SOURCE, { sidebarOpen: false, docsOpen: false })
    const { rerender } = render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })

    rerender(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })
    expect(screen.getByTestId("stage-frame").getAttribute("data-kind")).toBe("pc")
  })

  it("PC 刷新（首帧）保留已打开的文档与侧栏，不强制关闭", () => {
    resetStores("pc", PC_SOURCE, { sidebarOpen: true, docsOpen: true })
    render(<Stage />)
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })

  it("PC 源之间切换不触发 chrome 打开 / 关闭", () => {
    const otherPc = makeSource("pc", "报表", "D:/sandbox/测试1/报表")
    resetStores("pc", PC_SOURCE, {
      sidebarOpen: false,
      docsOpen: false,
      sources: [PC_SOURCE, otherPc],
    })
    render(<Stage />)

    switchSource(otherPc.name)
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })
  })
})

describe("去循环 / StrictMode", () => {
  it("StrictMode 双执行：目标已为 true 时零 store 写入", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: true, docsOpen: true })
    const appSpy = vi.fn()
    const uiSpy = vi.fn()
    const unsubApp = useAppStore.subscribe(appSpy)
    const unsubUi = useUiStore.subscribe(uiSpy)

    try {
      render(
        <StrictMode>
          <Stage />
        </StrictMode>,
      )
      expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
      expect(appSpy).not.toHaveBeenCalled()
      expect(uiSpy).not.toHaveBeenCalled()
    } finally {
      unsubApp()
      unsubUi()
    }
  })

  it("StrictMode 下初始关闭：只打开一次，之后手动关闭不会被 effect 重新打开", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: false, docsOpen: false })
    render(
      <StrictMode>
        <Stage />
      </StrictMode>,
    )
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    closeChromeByUser()
    expect(chrome()).toEqual({ sidebarOpen: false, docsOpen: false })
  })

  it("StrictMode 下移动端 → PC：只在真实切换瞬间关闭文档一次，侧栏零写入", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: true, docsOpen: true })
    render(
      <StrictMode>
        <Stage />
      </StrictMode>,
    )
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })

    const appSpy = vi.fn()
    const uiSpy = vi.fn()
    const unsubApp = useAppStore.subscribe(appSpy)
    const unsubUi = useUiStore.subscribe(uiSpy)

    try {
      switchKind("pc")
      expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: false })
      const sidebarWrites = appSpy.mock.calls.filter(([next, prev]) => {
        const a = next as { sidebarOpen?: boolean }
        const b = prev as { sidebarOpen?: boolean }
        return a.sidebarOpen !== b.sidebarOpen
      })
      expect(sidebarWrites, "切 PC 不应改侧栏").toHaveLength(0)
      expect(uiSpy, "只在切换瞬间关闭一次文档").toHaveBeenCalledTimes(1)
    } finally {
      unsubApp()
      unsubUi()
    }
  })

  it("StrictMode 下重复渲染 / 切 PC 后重渲染不会重复关闭", () => {
    resetStores("mobile", MOBILE_A, { sidebarOpen: true, docsOpen: true })
    const { rerender } = render(
      <StrictMode>
        <Stage />
      </StrictMode>,
    )

    switchKind("pc")
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: false })

    act(() => {
      useUiStore.getState().openDocs()
    })
    rerender(
      <StrictMode>
        <Stage />
      </StrictMode>,
    )
    expect(chrome()).toEqual({ sidebarOpen: true, docsOpen: true })
  })
})
