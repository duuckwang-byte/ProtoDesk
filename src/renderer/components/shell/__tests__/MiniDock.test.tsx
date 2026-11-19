/**
 * MiniDock.test.tsx — 入口收敛后，左下角悬浮入口已停用。
 *
 * 覆盖：无论侧栏展开/收起，MiniDock 都只渲染 null，
 * 不存在 mini-dock 浮层与展开/AI/设置快捷入口。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import MiniDock from "../MiniDock"
import { useAppStore } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"

beforeEach(() => {
  useUiStore.setState({ miniDockVisible: true, aiOpen: false, settingsTab: null })
})

afterEach(() => {
  cleanup()
})

describe("MiniDock 已停用", () => {
  it("侧栏收起时不渲染左下角浮层与快捷入口", () => {
    useAppStore.setState({ sidebarOpen: false })
    const { container } = render(<MiniDock />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId("mini-dock")).toBeNull()
    expect(screen.queryByRole("button", { name: "展开侧栏" })).toBeNull()
    expect(screen.queryByRole("button", { name: "AI 设计对话" })).toBeNull()
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull()
  })

  it("侧栏展开时同样不渲染任何入口", () => {
    useAppStore.setState({ sidebarOpen: true })
    const { container } = render(<MiniDock />)

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId("mini-dock")).toBeNull()
  })
})
