/**
 * src/renderer/features/preview/useMobileViewport.ts — 移动端预览视口（M1）。
 *
 * 职责：
 * - 模式 → 缩放比例：overview（375×780 参考机整体 fit）/ fit-width（默认）/
 *   100 / 125 / custom（复用持久化 zoom）；
 * - 动态视口高（W5 修订）：非 overview 模式的逻辑视口高 = 壳内可视高 ÷ 比例，
 *   壳高永远吃满可用区、底部常驻可见；纵向滚动只发生在原型（iframe）内部，
 *   不再产生壳内纵向滚动。overview 仍用 780 参考机整体可见；
 * - 缩放只做 CSS zoom（不做 transform，W5 修订见 Stage.tsx 头注），
 *   wrapper 的布局尺寸同步为 375×比例 × 视口高×比例；
 * - 位置记忆：每个模式独立记住 scrollTop/scrollLeft，切回时恢复并 clamp；
 * - 给 MobileMinimap 提供 totalHeight / viewportHeight / scrollTop 与跳转入口
 *   （动态视口高下内容高 ≈ 可视高，小地图按实际溢出条件隐藏）。
 *
 * 不读 iframe 内部滚动（跨域 sandbox，不可读），也不改 PreviewFrame 协议。
 */

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react"
import {
  useAppStore,
  type MobileViewportMode,
  type MobileViewportPosition,
} from "@/stores/app-store"

/** 移动端逻辑视窗宽（iframe 固定宽，不随模式变化）。 */
export const MOBILE_W = 375
/** overview 模式的参考机视口高（整机可见口径）；其它模式视口高动态适配可用高。 */
export const MOBILE_H = 780

/** 自定义比例与持久化 zoom 共用同一 clamp 口径。 */
export function clampMobileScale(value: number): number {
  const v = Number(value)
  if (!Number.isFinite(v)) return 1
  return Math.min(3, Math.max(0.2, v))
}

/**
 * 计算某模式下的缩放比例。
 *
 * - 未测得可用区（overview / fit-width）返回 null，由调用方显示模式名而非假数字；
 * - fit-width 按需求只横向适配：scale = min(1, 可用宽 / 375)；高度由动态视口高
 *   适配（W5：视口高 = 壳可视高 ÷ 比例，底部常驻可见，滚动发生在原型内部）；
 * - overview 纵横都适配：scale = min(可用宽/375, 可用高/780)，因此整机可见、不滚动。
 */
export function mobileScaleFor(
  mode: MobileViewportMode,
  availableWidth: number,
  availableHeight: number,
  customZoom: number,
): number | null {
  if (mode === "100") return 1
  if (mode === "125") return 1.25
  if (mode === "custom") return clampMobileScale(customZoom)

  const width = Number(availableWidth)
  const height = Number(availableHeight)
  if (!Number.isFinite(width) || width <= 0) return null

  if (mode === "overview") {
    if (!Number.isFinite(height) || height <= 0) return null
    const s = Math.min(width / MOBILE_W, height / MOBILE_H)
    return Number.isFinite(s) && s > 0 ? s : null
  }

  // fit-width
  const s = Math.min(1, width / MOBILE_W)
  return Number.isFinite(s) && s > 0 ? s : null
}

/** 把期望滚动位置 clamp 到容器可滚范围。 */
export function clampMobileScroll(
  position: MobileViewportPosition,
  metrics: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number },
): MobileViewportPosition {
  const maxTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const maxLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  const top = Number.isFinite(position.top) ? position.top : 0
  const left = Number.isFinite(position.left) ? position.left : 0
  return {
    top: Math.min(maxTop, Math.max(0, top)),
    left: Math.min(maxLeft, Math.max(0, left)),
  }
}

export interface MobileViewportOptions {
  /** 舞台可用宽（已扣除内边距）。 */
  availableWidth: number
  /** 舞台可用高（已扣除内边距）。 */
  availableHeight: number
  /** 壳内滚动容器 ref（由调用方创建并挂到 DOM，hook 只读写其 current）。 */
  scrollRef: RefObject<HTMLDivElement | null>
  /**
   * 是否处于移动端舞台。PC→移动端时滚动容器会重新挂载，
   * 需要靠该标记让「恢复位置」effect 重新执行。
   */
  active: boolean
}

export interface MobileViewportResult {
  mode: MobileViewportMode
  /** 实际生效比例；null = 可用区尚未测得（仅 overview / fit-width 会为 null）。 */
  scale: number | null
  /** 渲染用比例（首帧未测得时按 1 兜底，避免 0 尺寸闪烁）。 */
  layoutScale: number
  isOverview: boolean
  /** 当前模式逻辑视口高（iframe 高度基准）；overview 固定 780，其余 = 壳可视高 ÷ 比例。 */
  viewportH: number
  /** 手机壳（可视窗口）尺寸。 */
  shellWidth: number
  shellHeight: number
  /** 缩放后内容布局尺寸（= 375×比例 × 视口高×比例；非 overview 精确吃满壳可视高）。 */
  contentWidth: number
  contentHeight: number
  scrollTop: number
  scrollLeft: number
  /** 壳内可视高度（wrapper.clientHeight），给 MobileMinimap 用。 */
  viewportHeight: number
  setMode: (mode: MobileViewportMode) => void
  handleScroll: () => void
  jumpTo: (top: number) => void
}

export function useMobileViewport(options: MobileViewportOptions): MobileViewportResult {
  const { availableWidth, availableHeight, scrollRef, active } = options
  const mode = useAppStore((s) => s.mobileViewMode)
  const zoom = useAppStore((s) => s.zoom)
  const setMobileViewMode = useAppStore((s) => s.setMobileViewMode)

  const modeRef = useRef(mode)
  const [scroll, setScroll] = useState<MobileViewportPosition>({ top: 0, left: 0 })
  const [viewportHeight, setViewportHeight] = useState(0)
  /*
   * 壳内可视高实测（含横向滚动条占位）；非 overview 的视口高按它换算。
   * null = 尚未测得（首帧 / jsdom 无布局）：此时回落到可用高，
   * 绝不能把首帧的 0 冻结进 state（Stage 的可用区测量晚一帧才落定）。
   */
  const [measuredShellHeight, setMeasuredShellHeight] = useState<number | null>(null)
  const shellClientHeight = measuredShellHeight ?? availableHeight

  const scale = mobileScaleFor(mode, availableWidth, availableHeight, zoom)
  const layoutScale = scale ?? 1
  const isOverview = mode === "overview"
  const contentWidth = MOBILE_W * layoutScale
  // 动态视口高：overview 用 780 参考机整体可见；其余模式视口高 = 壳可视高 ÷ 比例，
  // 底部常驻可见，纵向滚动只发生在原型（iframe）内部。
  const viewportH = isOverview ? MOBILE_H : Math.max(1, shellClientHeight / layoutScale)
  // 内容高按可视高清零点收敛（floor 到 2 位小数，避免浮点尾差顶出纵向滚动条）。
  const contentHeight = isOverview
    ? MOBILE_H * layoutScale
    : Math.min(Math.floor(viewportH * layoutScale * 100) / 100, shellClientHeight)

  /*
   * 手机壳尺寸：
   * - overview 与内容同尺寸（参考机整体 fit，永不滚动）；
   * - 非 overview 壳高固定吃满可用高，**不随内容高回缩**（W5 关键：壳若随
   *   clientHeight 回缩，横向滚动条会引发「壳高→可视高→内容高→壳高」的
   *   收缩循环，触发 React #185）；视口高按壳可视高反推，内容高精确吃满。
   *   宽度随比例收紧或封顶可用宽（超宽时壳内横向滚动）。
   */
  const shellWidth = isOverview
    ? contentWidth
    : Math.min(contentWidth, Math.max(0, availableWidth))
  const shellHeight = isOverview ? contentHeight : Math.max(0, availableHeight)

  // 模式引用给滚动回调使用；先于位置恢复执行。
  useLayoutEffect(() => {
    modeRef.current = mode
  }, [mode])

  // 模式/比例/可用区变化后：恢复该模式记住的位置并 clamp 到新的可滚范围。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!active || !el || isOverview) {
      setScroll({ top: 0, left: 0 })
      setViewportHeight(0)
      return
    }
    const saved = useAppStore.getState().mobileScrollPositions[mode]
    const next = clampMobileScroll(saved, {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    })
    el.scrollTop = next.top
    el.scrollLeft = next.left
    setScroll((prev) => (prev.top === next.top && prev.left === next.left ? prev : next))
    setViewportHeight(el.clientHeight)
  }, [active, mode, layoutScale, availableWidth, availableHeight, isOverview, scrollRef])

  // 壳尺寸/布局输入变化（窗口 resize / 侧栏收放 / 模式切换）时同步实测值：
  // viewportHeight 给 MobileMinimap；shellClientHeight 决定动态视口高。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!active || !el || isOverview) return
    const syncFromEl = () => {
      const measured = el.clientHeight
      setViewportHeight(measured)
      if (measured > 0) {
        setMeasuredShellHeight((prev) =>
          prev != null && Math.abs(prev - measured) < 0.5 ? prev : measured,
        )
      }
    }
    syncFromEl()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => syncFromEl())
    ro.observe(el)
    return () => ro.disconnect()
  }, [active, isOverview, mode, layoutScale, availableWidth, availableHeight, shellWidth, shellHeight, scrollRef])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = { top: el.scrollTop, left: el.scrollLeft }
    setScroll((prev) => (prev.top === next.top && prev.left === next.left ? prev : next))
    useAppStore.getState().setMobileScrollPosition(modeRef.current, next)
  }, [scrollRef])

  const jumpTo = useCallback((top: number) => {
    const el = scrollRef.current
    if (!el) return
    const next = clampMobileScroll(
      { top, left: el.scrollLeft },
      {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      },
    )
    el.scrollTop = next.top
    el.scrollLeft = next.left
    setScroll(next)
    useAppStore.getState().setMobileScrollPosition(modeRef.current, next)
  }, [scrollRef])

  const setMode = useCallback(
    (next: MobileViewportMode) => {
      setMobileViewMode(next)
    },
    [setMobileViewMode],
  )

  return {
    mode,
    scale,
    layoutScale,
    isOverview,
    viewportH,
    shellWidth,
    shellHeight,
    contentWidth,
    contentHeight,
    scrollTop: scroll.top,
    scrollLeft: scroll.left,
    viewportHeight,
    setMode,
    handleScroll,
    jumpTo,
  }
}
