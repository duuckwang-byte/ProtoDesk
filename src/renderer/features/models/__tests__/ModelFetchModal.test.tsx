/**
 * ModelFetchModal.test.tsx — 「获取模型」弹窗：全量目录 + 已选勾选 + 批量只作用显示项。
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ModelFetchModal } from "../ModelFetchModal"
import type { ModelGroup } from "../ModelManager"

const groups: ModelGroup[] = [
  {
    provider: "deepseek",
    label: "DeepSeek",
    models: [
      { id: "a", name: "Model A", description: "通用对话" },
      { id: "b", name: "Model B", description: "推理" },
    ],
  },
  {
    provider: "openai",
    label: "OpenAI",
    models: [{ id: "c", name: "Model C", description: "多模态" }],
  },
]

const rowIds = () =>
  Array.from(document.querySelectorAll("[data-id]")).map((el) =>
    el.getAttribute("data-id"),
  )

const checkedOf = (id: string) =>
  screen.getByLabelText(`获取模型 ${id}`).getAttribute("aria-checked")

afterEach(cleanup)

describe("ModelFetchModal 全量 + 保持选中", () => {
  it("渲染全量目录，visibleIds=['a'] 时只有 a 勾选", () => {
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={["a"]}
        onChange={() => {}}
      />,
    )

    expect(rowIds()).toEqual(["a", "b", "c"])
    expect(checkedOf("a")).toBe("true")
    expect(checkedOf("b")).toBe("false")
    expect(checkedOf("c")).toBe("false")
  })

  it("visibleIds=null（旧配置全选）时全量勾选", () => {
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={null}
        onChange={() => {}}
      />,
    )

    expect(rowIds()).toEqual(["a", "b", "c"])
    expect(checkedOf("a")).toBe("true")
    expect(checkedOf("b")).toBe("true")
    expect(checkedOf("c")).toBe("true")
  })

  it("搜索只过滤显示、不改勾选（onChange 不被调用）", () => {
    const onChange = vi.fn()
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={["a"]}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText("搜索全量模型"), {
      target: { value: "b" },
    })

    expect(rowIds()).toEqual(["b"])
    expect(checkedOf("b")).toBe("false")
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("搜索全量模型"), {
      target: { value: "" },
    })
    expect(rowIds()).toEqual(["a", "b", "c"])
    expect(checkedOf("a")).toBe("true")
  })

  it("勾选未选项 b → onChange 追加，a 保持选中", () => {
    const onChange = vi.fn()
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={["a"]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByLabelText("获取模型 b"))
    expect(onChange).toHaveBeenCalledWith(["a", "b"])
  })

  it("取消勾选 a → onChange 移除", () => {
    const onChange = vi.fn()
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={["a", "b"]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByLabelText("获取模型 a"))
    expect(onChange).toHaveBeenCalledWith(["b"])
  })
})

describe("ModelFetchModal 全选 / 取消全选只处理显示项", () => {
  it("全选只在弹窗内：按钮存在，搜索后全选只补显示项", () => {
    const onChange = vi.fn()
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={["a"]}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole("button", { name: "全选" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "取消全选" })).toBeTruthy()

    fireEvent.change(screen.getByLabelText("搜索全量模型"), {
      target: { value: "b" },
    })
    fireEvent.click(screen.getByRole("button", { name: "全选" }))

    // c 未显示，保持未选。
    expect(onChange).toHaveBeenCalledWith(["a", "b"])
  })

  it("取消全选只移除显示中的勾选项，隐藏项保留", () => {
    const onChange = vi.fn()
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={["a", "b", "c"]}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText("搜索全量模型"), {
      target: { value: "b" },
    })
    fireEvent.click(screen.getByRole("button", { name: "取消全选" }))

    expect(onChange).toHaveBeenCalledWith(["a", "c"])
  })

  it("空选择时全选可恢复全量", () => {
    const onChange = vi.fn()
    render(
      <ModelFetchModal
        open
        onOpenChange={() => {}}
        groups={groups}
        visibleIds={[]}
        onChange={onChange}
      />,
    )

    expect(checkedOf("a")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "全选" }))
    expect(onChange).toHaveBeenCalledWith(["a", "b", "c"])
  })
})
