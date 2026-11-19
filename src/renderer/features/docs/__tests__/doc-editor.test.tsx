/**
 * src/renderer/features/docs/__tests__/doc-editor.test.tsx
 *
 * 覆盖 wave4 b-docs 两个 P2：
 * - IMAGE：Markdown 图片 data:image/* / proto-asset 可渲染，javascript/vbscript 仍回退 alt；
 * - PANEL-WIDTH：表格按内容撑开（min-w-max + nowrap）并由外层横向滚动，不逐字换行。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { createElement } from "react"
import DocEditor from "@/features/docs/DocEditor"
import { useDocsStore } from "@/stores/docs-store"

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="

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
  sourceDir: "",
  sourceVer: 0,
  sourceName: "",
  sourceDisplayName: "",
  sourceMdFile: null,
  docTitle: "功能说明",
  draftStash: {},
  pendingGuard: null,
}

function seed(content: string): void {
  useDocsStore.setState({ ...DOCS_INITIAL, docContent: content, draft: content })
}

beforeEach(() => {
  localStorage.clear()
  useDocsStore.setState(DOCS_INITIAL)
})

afterEach(cleanup)

describe("Markdown 图片（P2-IMAGE）", () => {
  it("data:image/* 真实渲染 <img>，不再回退 alt", () => {
    seed(`# 图\n\n![示意图](${PNG})`)
    render(createElement(DocEditor))
    const img = screen.getByTestId("doc-preview").querySelector("img")
    expect(img).not.toBeNull()
    expect(img?.getAttribute("src")).toBe(PNG)
    expect(img?.getAttribute("alt")).toBe("示意图")
  })

  it("proto-asset: 图片可渲染（沙箱资源协议）", () => {
    seed("![资源](proto-asset://sandbox/a.png)")
    render(createElement(DocEditor))
    expect(screen.getByTestId("doc-preview").querySelector("img")?.getAttribute("src")).toBe(
      "proto-asset://sandbox/a.png",
    )
  })

  it("javascript / vbscript / 非图片 data: 仍被拦截为 alt", () => {
    seed(
      [
        "# 安全",
        "",
        "![甲](javascript:alert)",
        "",
        "![乙](vbscript:msgbox)",
        "",
        "![丙](data:text/html;base64,AAAA)",
      ].join("\n"),
    )
    render(createElement(DocEditor))
    const preview = screen.getByTestId("doc-preview")
    expect(preview.querySelectorAll("img")).toHaveLength(0)
    expect(preview.textContent).toContain("甲")
    expect(preview.textContent).toContain("乙")
    expect(preview.textContent).toContain("丙")
  })
})

describe("表格横向滚动（P2-PANEL-WIDTH）", () => {
  it("表格 min-w-max + 单元格 nowrap，外层 overflow-x-auto", () => {
    seed(
      [
        "# 表格",
        "",
        "| 维度 | 说明 | 备注 |",
        "| --- | --- | --- |",
        "| 页面数据 | 字段与值说明文字 | 附加备注 |",
        "| 接口 | 请求与响应 | 错误码 |",
      ].join("\n"),
    )
    render(createElement(DocEditor))
    const table = screen.getByTestId("doc-preview").querySelector("table")
    expect(table).not.toBeNull()
    expect(table?.className).toContain("min-w-max")
    expect(table?.parentElement?.className).toContain("overflow-x-auto")
    const cell = table?.querySelector("th")
    expect(cell?.className).toContain("whitespace-nowrap")
    const td = table?.querySelector("td")
    expect(td?.className).toContain("whitespace-nowrap")
  })
})
