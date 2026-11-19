/**
 * src/renderer/components/shell/__tests__/Stage.zoom.test.ts — 缩放读数文案单测。
 *
 * 顶栏与舞台工具栏共用 stageZoomLabel：
 * - 自适应必须显示实测 scale，不得回退到持久化 zoom；
 * - 尚未测得时显示「自适应」，避免出现第二个数字。
 */

import { describe, expect, it } from "vitest"
import { stageReadingLabel, stageZoomLabel } from "../Stage"

describe("stageZoomLabel 单一缩放读数", () => {
  it("实测比例直接作为读数（60%，不是持久化 zoom 的 85%）", () => {
    expect(stageZoomLabel(0.6)).toBe("60%")
  })

  it("比例未测得时按调用方兜底文案显示", () => {
    expect(stageZoomLabel(null)).toBe("自适应")
    expect(stageZoomLabel(null, "适宽")).toBe("适宽")
  })

  it("百分比四舍五入口径固定，顶栏与舞台不会各算各的", () => {
    expect(stageZoomLabel(0.855)).toBe("86%")
    expect(stageZoomLabel(0.2)).toBe("20%")
    expect(stageZoomLabel(3)).toBe("300%")
  })
})

describe("stageReadingLabel 顶栏/舞台共用读数", () => {
  it("移动端已测得即百分比，未测得显示模式名", () => {
    expect(stageReadingLabel("mobile", "fit-width", 0.6)).toBe("60%")
    expect(stageReadingLabel("mobile", "fit-width", null)).toBe("适宽")
    expect(stageReadingLabel("mobile", "overview", null)).toBe("全貌")
    expect(stageReadingLabel("mobile", "125", 1.25)).toBe("125%")
  })

  it("PC 沿用原百分比/自适应口径", () => {
    expect(stageReadingLabel("pc", "fit-width", 0.85)).toBe("85%")
    expect(stageReadingLabel("pc", "fit-width", null)).toBe("自适应")
  })
})
