/**
 * Sidebar.test.tsx — 侧栏底部 Dock + 双击行内重命名。
 *
 * 覆盖：
 * - 底部 Dock 保留新建/导入，并新增 AI 设计对话（openAi）与设置（openSettings('agent')）。
 * - 双击原型行进入行内编辑：Enter 提交、Esc 取消、失焦提交；不触发 IPC（renameProto 被 mock）。
 * - 拖拽行保持 draggable（编辑态临时关闭）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import Sidebar from "../Sidebar"
import { groupsKey } from "@/lib/storage-keys"
import { useAppStore } from "@/stores/app-store"
import { useSourcesStore, type SourceRef } from "@/stores/sources-store"
import { useUiStore } from "@/stores/ui-store"

const protoActions = vi.hoisted(() => ({
  renameProto: vi.fn(async (_dir: string, name: string) => ({ ok: true, name })),
}))

vi.mock("@/features/projects/proto-actions", () => ({
  createProto: vi.fn(async () => ({ ok: true, name: "新原型" })),
  createSubPage: vi.fn(async () => ({ ok: true, file: "sub.html" })),
  importProtoFromFile: vi.fn(async () => ({ ok: false, cancelled: true })),
  removeProto: vi.fn(async () => ({ ok: true })),
  renameProto: protoActions.renameProto,
}))

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

function resetState(): void {
  protoActions.renameProto.mockClear()
  localStorage.clear()
  useAppStore.setState({ project: "测试1", sidebarOpen: true })
  useSourcesStore.setState({
    project: "测试1",
    projects: [{ name: "测试1", protoCount: 1 }],
    sources: [source],
    currentSource: source,
    activeSubFile: "",
    activeContent: "",
    loading: false,
    error: "",
    pickerOpen: false,
  })
  useUiStore.setState({ aiOpen: false, settingsTab: null, toasts: [] })
}

beforeEach(resetState)
afterEach(cleanup)

function openInlineRename(): HTMLInputElement {
  fireEvent.doubleClick(screen.getByRole("button", { name: "首页" }))
  return screen.getByLabelText("重命名原型「首页」") as HTMLInputElement
}

describe("Sidebar 底部 Dock", () => {
  it("保留新建/导入原型，并新增 AI 设计对话与设置", () => {
    render(<Sidebar />)

    expect(screen.getByRole("button", { name: "新建原型" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "导入原型" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "AI 设计对话" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "打开设置" })).toBeTruthy()
  })

  it("AI 入口打开 AI 对话，设置入口打开 Agent Tab", () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole("button", { name: "AI 设计对话" }))
    expect(useUiStore.getState().aiOpen).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }))
    expect(useUiStore.getState().settingsTab).toBe("agent")
  })
})

describe("Sidebar 双击行内重命名", () => {
  it("双击行进入编辑，input 自动聚焦并按 Enter 提交", async () => {
    render(<Sidebar />)

    const input = openInlineRename()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe("首页")

    fireEvent.change(input, { target: { value: "  新首页  " } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() =>
      expect(protoActions.renameProto).toHaveBeenCalledWith(
        "D:/sandbox/测试1/首页",
        "新首页"
      )
    )
    expect(screen.queryByLabelText(/重命名原型/)).toBeNull()
  })

  it("Esc 取消，不提交也不冒泡到全局 keydown", () => {
    render(<Sidebar />)
    const onWindowKeyDown = vi.fn()
    window.addEventListener("keydown", onWindowKeyDown)

    const input = openInlineRename()
    fireEvent.change(input, { target: { value: "临时名称" } })
    fireEvent.keyDown(input, { key: "Escape" })

    expect(screen.queryByLabelText(/重命名原型/)).toBeNull()
    expect(protoActions.renameProto).not.toHaveBeenCalled()
    expect(onWindowKeyDown).not.toHaveBeenCalled()
    window.removeEventListener("keydown", onWindowKeyDown)
  })

  it("失焦提交；改名清空时静默取消", async () => {
    render(<Sidebar />)

    const input = openInlineRename()
    fireEvent.change(input, { target: { value: "失焦新名" } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(protoActions.renameProto).toHaveBeenCalledWith(
        "D:/sandbox/测试1/首页",
        "失焦新名"
      )
    )

    const again = openInlineRename()
    fireEvent.change(again, { target: { value: "   " } })
    fireEvent.blur(again)
    await waitFor(() => expect(screen.queryByLabelText(/重命名原型/)).toBeNull())
    expect(protoActions.renameProto).toHaveBeenCalledTimes(1)
  })

  it("编辑态关闭行拖拽，结束后恢复 draggable", () => {
    render(<Sidebar />)
    const row = screen.getByText("首页").closest("[data-key]") as HTMLElement
    expect(row.getAttribute("draggable")).toBe("true")

    openInlineRename()
    expect(row.getAttribute("draggable")).toBe("false")

    fireEvent.keyDown(screen.getByLabelText("重命名原型「首页」"), { key: "Escape" })
    expect(row.getAttribute("draggable")).toBe("true")
  })

  it("文件夹行同样支持双击行内改名", () => {
    localStorage.setItem(
      groupsKey("测试1"),
      JSON.stringify({ list: [{ id: "g1", name: "分组A", parent: null }], map: {} })
    )
    useSourcesStore.setState({ folderRevision: 1 })
    render(<Sidebar />)

    fireEvent.doubleClick(screen.getByRole("button", { name: "分组A" }))
    const input = screen.getByLabelText("重命名文件夹「分组A」") as HTMLInputElement
    fireEvent.change(input, { target: { value: "分组B" } })
    fireEvent.keyDown(input, { key: "Enter" })

    const saved = JSON.parse(localStorage.getItem(groupsKey("测试1")) || "{}")
    expect(saved.list[0].name).toBe("分组B")
    expect(screen.queryByLabelText(/重命名文件夹/)).toBeNull()
  })
})
