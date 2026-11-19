/**
 * ModelManager.test.tsx — 模型管理主清单（仅已选 + 已选内搜索 + 计数/空态）。
 *
 * 覆盖：主清单只渲染已选、visibleIds=null 全选、visibleIds=[] 空态、取消即消失、
 * 搜索仅在已选内过滤、主清单不含批量按钮、操作区 32px 等高。
 */

import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ModelManager, type ModelGroup } from "../ModelManager"

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

/** 模拟调用方受控回写：onChange → visibleIds 更新 → 主清单重算。 */
function ControlledManager({
  initial,
  onChange,
}: {
  initial: string[] | null
  onChange?: (next: string[]) => void
}) {
  const [visible, setVisible] = React.useState<string[] | null>(initial)
  return (
    <ModelManager
      groups={groups}
      visibleIds={visible}
      onChange={(next) => {
        onChange?.(next)
        setVisible(next)
      }}
    />
  )
}

const rowIds = () =>
  Array.from(document.querySelectorAll("[data-model-id]")).map((el) =>
    el.getAttribute("data-model-id"),
  )

const countText = () => screen.getByTestId("model-manager-count").textContent

afterEach(cleanup)

describe("ModelManager 主清单：仅已选", () => {
  it("visibleIds=['a'] 只显示 a，未选项不渲染", () => {
    render(<ModelManager groups={groups} visibleIds={["a"]} />)

    expect(rowIds()).toEqual(["a"])
    expect(screen.queryByText("b")).toBeNull()
    expect(screen.queryByText("c")).toBeNull()
    expect(countText()).toContain("已选 1 / 共 3 个 · 显示 1 个")
  })

  it("visibleIds=null（旧配置全选）显示全部", () => {
    render(<ModelManager groups={groups} visibleIds={null} />)

    expect(rowIds()).toEqual(["a", "b", "c"])
    expect(countText()).toContain("已选 3 / 共 3 个 · 显示 3 个")
  })

  it("visibleIds=[] 显示「暂未选择模型」空态", () => {
    render(<ModelManager groups={groups} visibleIds={[]} />)

    expect(rowIds()).toEqual([])
    expect(screen.getByText("暂未选择模型，点击「获取模型」选择")).toBeTruthy()
    expect(countText()).toContain("已选 0 / 共 3 个 · 显示 0 个")
  })

  it("目录为空时保留配置检查提示", () => {
    render(<ModelManager groups={[]} visibleIds={[]} />)

    expect(rowIds()).toEqual([])
    expect(screen.getByText("暂未选择模型，点击「获取模型」选择")).toBeTruthy()
    expect(
      screen.getByText("模型目录为空（请检查引擎 / API 配置后刷新）"),
    ).toBeTruthy()
  })

  it("取消勾选 a 后主清单立即变空并回写 []", () => {
    const onChange = vi.fn()
    render(<ControlledManager initial={["a"]} onChange={onChange} />)

    expect(rowIds()).toEqual(["a"])
    fireEvent.click(screen.getByLabelText("勾选模型 a"))

    expect(onChange).toHaveBeenCalledWith([])
    expect(rowIds()).toEqual([])
    expect(screen.getByText("暂未选择模型，点击「获取模型」选择")).toBeTruthy()
    expect(countText()).toContain("已选 0 / 共 3 个")
  })

  it("取消勾选 b 后仅剩已选的 a", () => {
    render(<ControlledManager initial={["a", "b"]} />)

    fireEvent.click(screen.getByLabelText("勾选模型 b"))

    expect(rowIds()).toEqual(["a"])
    expect(countText()).toContain("已选 1 / 共 3 个 · 显示 1 个")
  })
})

describe("ModelManager 搜索只在已选集合内过滤", () => {
  it("搜索命中未选模型 → 「已选模型无匹配」，勾选与计数不变", () => {
    render(<ModelManager groups={groups} visibleIds={["a"]} />)

    fireEvent.change(screen.getByLabelText("搜索模型"), {
      target: { value: "b" },
    })

    expect(rowIds()).toEqual([])
    expect(screen.getByText("已选模型无匹配")).toBeTruthy()
    // 已选数不被搜索改变；显示数按已选内命中计算。
    expect(countText()).toContain("已选 1 / 共 3 个 · 显示 0 个")
  })

  it("搜索只在已选 ['a','b'] 内命中 a，未选的 c 不出现", () => {
    render(<ModelManager groups={groups} visibleIds={["a", "b"]} />)

    fireEvent.change(screen.getByLabelText("搜索模型"), {
      target: { value: "a" },
    })

    expect(rowIds()).toEqual(["a"])
    expect(screen.queryByText("c")).toBeNull()
    expect(countText()).toContain("已选 2 / 共 3 个 · 显示 1 个")
  })

  it("清除搜索恢复已选集合（不会带出未选项）", () => {
    render(<ModelManager groups={groups} visibleIds={["a", "b"]} />)
    const search = screen.getByLabelText("搜索模型") as HTMLInputElement

    fireEvent.change(search, { target: { value: "a" } })
    expect(rowIds()).toEqual(["a"])

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }))
    expect(search.value).toBe("")
    expect(rowIds()).toEqual(["a", "b"])
    expect(screen.queryByText("c")).toBeNull()
  })
})

describe("ModelManager 操作区", () => {
  it("主清单不含全选 / 反选，只保留刷新 / 获取模型", () => {
    render(
      <ModelManager
        groups={groups}
        visibleIds={["a"]}
        onRefresh={() => {}}
        onFetchModels={() => {}}
      />,
    )

    const manager = screen.getByTestId("model-manager")
    expect(within(manager).queryByRole("button", { name: "全选" })).toBeNull()
    expect(within(manager).queryByRole("button", { name: "反选" })).toBeNull()
    expect(within(manager).getByRole("button", { name: "刷新" })).toBeTruthy()
    expect(within(manager).getByRole("button", { name: "获取模型" })).toBeTruthy()
  })

  it("搜索与自定义添加位于同一操作区，并保持 32px 高", () => {
    render(<ModelManager groups={groups} visibleIds={["a"]} />)

    const actions = screen.getByTestId("model-manager-actions")
    const search = within(actions).getByLabelText("搜索模型")
    const custom = within(actions).getByLabelText("自定义模型 id")
    const add = within(actions).getByRole("button", { name: "添加模型" })

    for (const el of [search, custom, add]) {
      expect(el.className).toContain("h-8")
    }
  })

  it("自定义 ID 添加走 onChange，不改动搜索关键字", () => {
    const onChange = vi.fn()
    render(
      <ModelManager groups={groups} visibleIds={["a"]} onChange={onChange} />,
    )
    const search = screen.getByLabelText("搜索模型") as HTMLInputElement
    fireEvent.change(search, { target: { value: "a" } })

    fireEvent.change(screen.getByLabelText("自定义模型 id"), {
      target: { value: "  qwen-coder-plus  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }))

    expect(onChange).toHaveBeenCalledWith(["a", "qwen-coder-plus"])
    expect(search.value).toBe("a")
    expect((screen.getByLabelText("自定义模型 id") as HTMLInputElement).value).toBe("")
  })
})
