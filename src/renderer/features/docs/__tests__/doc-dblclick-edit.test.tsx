/**
 * src/renderer/features/docs/__tests__/doc-dblclick-edit.test.tsx
 *
 * W6 修复回归：文档阅读态「双击就地改」（对齐旧版 P2 双击段落微浮层口径）。
 * - 双击段落/标题 → 微改浮层出现（回填原文），应用后只替换该块并保存；
 * - 双击列表/引用 → 多行 textarea 编辑该块 Markdown 源行，应用后整块替换；
 * - code 块内双击不触发；段落内 IMG 双击不触发（走原生选择）；
 * - 取消不落盘；保存失败进入编辑态兜底。
 *
 * 保存经 docs-store.save 落盘；此处 mock save（jsdom 无 IPC），断言调用与内容替换。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import DocEditor from "@/features/docs/DocEditor"
import { useDocsStore } from "@/stores/docs-store"

const DOCS_INITIAL = {
  docContent: "",
  draft: "",
  editing: false,
  toc: [],
  search: "",
  saving: false,
  loading: false,
  lastError: "",
  tab: "desc" as const,
  descContent: "",
  latestContent: "",
  descLoaded: false,
  latestLoaded: false,
  sourceDir: "D:/sandbox/测试1/首页",
  sourceVer: 1,
  sourceName: "首页.html",
  sourceDisplayName: "首页",
  sourceMdFile: null,
  docTitle: "功能说明",
  draftStash: {},
  pendingGuard: null,
}

const MD = [
  "# 功能说明",
  "",
  "原始段落文字",
  "",
  "- 列表甲",
  "- 列表乙",
  "",
  "> 引用一句",
  "",
  "```js",
  "const code = 1",
  "```",
].join("\n")

/** mock docs-store.save：模拟真实保存把 draft 落成 docContent。 */
function installSaveMock(): ReturnType<typeof vi.fn> {
  const save = vi.fn(async () => {
    const st = useDocsStore.getState()
    useDocsStore.setState({ docContent: st.draft, draft: st.draft })
    return true
  })
  useDocsStore.setState({ save: save as unknown as () => Promise<boolean> })
  return save
}

function seed(content: string): void {
  useDocsStore.setState({ ...DOCS_INITIAL, docContent: content, draft: content })
}

beforeEach(() => {
  localStorage.clear()
  useDocsStore.setState(DOCS_INITIAL)
})

afterEach(() => {
  cleanup()
  useDocsStore.setState(DOCS_INITIAL)
})

describe("双击段落/标题 → 微改浮层（W6）", () => {
  it("双击段落弹出微改浮层，回填原文；应用后只替换该块并保存", async () => {
    seed(MD)
    const save = installSaveMock()

    render(<DocEditor />)
    fireEvent.doubleClick(screen.getByText("原始段落文字"))

    const input = await screen.findByLabelText("微改内容")
    expect((input as HTMLInputElement).value).toBe("原始段落文字")

    fireEvent.change(input, { target: { value: "改过的段落文字" } })
    fireEvent.click(screen.getByRole("button", { name: "应用" }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const content = useDocsStore.getState().docContent
    expect(content).toContain("改过的段落文字")
    expect(content).not.toContain("原始段落文字")
    // 其它块不受影响。
    expect(content).toContain("# 功能说明")
    expect(content).toContain("- 列表甲")
    expect(content).toContain("> 引用一句")
  })

  it("双击标题应用后保留原有 # 级别前缀", async () => {
    seed(MD)
    const save = installSaveMock()

    render(<DocEditor />)
    fireEvent.doubleClick(screen.getByText("功能说明"))

    const input = await screen.findByLabelText("微改内容")
    // 标题浮层回填的是纯文本（不带 # 前缀），与既有微改口径一致。
    expect((input as HTMLInputElement).value).toBe("功能说明")
    fireEvent.change(input, { target: { value: "功能说明（修订）" } })
    fireEvent.click(screen.getByRole("button", { name: "应用" }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const content = useDocsStore.getState().docContent
    expect(content).toContain("# 功能说明（修订）")
    expect(content).not.toContain("# 功能说明\n")
  })
})

describe("双击列表/引用 → 源行浮层（W6）", () => {
  it("双击列表项弹出多行浮层，回填原始 Markdown（含 - 前缀），应用后整块替换", async () => {
    seed(MD)
    const save = installSaveMock()

    render(<DocEditor />)
    fireEvent.doubleClick(screen.getByText("列表甲"))

    const area = (await screen.findByTestId("doc-raw-edit-input")) as HTMLTextAreaElement
    expect(area.value).toBe("- 列表甲\n- 列表乙")

    fireEvent.change(area, { target: { value: "- 列表甲（改）\n- 列表丙" } })
    fireEvent.click(screen.getByTestId("doc-raw-edit-apply"))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const content = useDocsStore.getState().docContent
    expect(content).toContain("- 列表甲（改）")
    expect(content).toContain("- 列表丙")
    expect(content).not.toContain("- 列表乙")
    // 段落/引用原样保留。
    expect(content).toContain("原始段落文字")
    expect(content).toContain("> 引用一句")
  })

  it("双击引用弹出浮层（含 > 前缀），应用后整块替换", async () => {
    seed(MD)
    const save = installSaveMock()

    render(<DocEditor />)
    fireEvent.doubleClick(screen.getByText("引用一句"))

    const area = (await screen.findByTestId("doc-raw-edit-input")) as HTMLTextAreaElement
    expect(area.value).toBe("> 引用一句")

    fireEvent.change(area, { target: { value: "> 引用两句" } })
    fireEvent.click(screen.getByTestId("doc-raw-edit-apply"))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(useDocsStore.getState().docContent).toContain("> 引用两句")
    expect(useDocsStore.getState().docContent).not.toContain("> 引用一句")
  })
})

describe("双击排除项与取消（W6）", () => {
  it("code 块内双击不弹任何微改浮层", () => {
    seed(MD)
    installSaveMock()

    render(<DocEditor />)
    fireEvent.doubleClick(screen.getByText("const code = 1"))

    expect(screen.queryByLabelText("微改内容")).toBeNull()
    expect(screen.queryByTestId("doc-raw-edit-input")).toBeNull()
  })

  it("段落内 IMG 双击不弹浮层（图片走原生行为）", () => {
    seed("# 图\n\n![示意图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)")
    installSaveMock()

    render(<DocEditor />)
    const img = screen.getByTestId("doc-preview").querySelector("img")
    expect(img).not.toBeNull()
    fireEvent.doubleClick(img as HTMLElement)

    expect(screen.queryByLabelText("微改内容")).toBeNull()
  })

  it("取消关闭浮层且不落盘", async () => {
    seed(MD)
    const save = installSaveMock()

    render(<DocEditor />)
    fireEvent.doubleClick(screen.getByText("原始段落文字"))
    const input = await screen.findByLabelText("微改内容")
    fireEvent.change(input, { target: { value: "不应保存的内容" } })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))

    await waitFor(() => expect(screen.queryByLabelText("微改内容")).toBeNull())
    expect(save).not.toHaveBeenCalled()
    expect(useDocsStore.getState().docContent).toContain("原始段落文字")
  })
})
