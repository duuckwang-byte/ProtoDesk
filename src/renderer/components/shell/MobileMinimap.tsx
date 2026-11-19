/**
 * src/renderer/components/shell/MobileMinimap.tsx — 移动端小地图（竖向导航条）。
 *
 * 纯展示组件：不读 store、不依赖 Stage、不访问 iframe，仅根据 props 计算比例。
 * - 轨道固定 120px 高，代表整页 totalHeight；
 * - 内部矩形代表当前视口：高度 = viewportHeight / totalHeight，位置 = scrollTop / totalHeight；
 * - 点击/拖动轨道 → onJump(对应 top)，结果 clamp 到 [0, totalHeight - viewportHeight]；
 * - 右下角悬浮，外层 pointer-events:none，仅轨道自身接收指针事件，不遮挡 iframe 交互。
 *
 * 键盘：轨道 role="slider" + tabIndex=0，ArrowUp / ArrowDown 微调，Home / End 直达两端。
 */

import { useRef, type KeyboardEvent, type PointerEvent } from "react"

/** 轨道高度（px）：小地图的固定视觉尺寸，也是比例换算的基准。 */
export const MINIMAP_TRACK_HEIGHT = 120
/** 键盘方向键单次跳转距离（px）。 */
export const MINIMAP_KEYBOARD_STEP = 40
/** 视口矩形命中范围的额外上下留白（px）：矩形很薄时仍可抓取。 */
const THUMB_HIT_SLOP = 4

export interface MobileMinimapProps {
  /** 整页内容高度（px）。 */
  totalHeight: number
  /** 当前可视区高度（px）。 */
  viewportHeight: number
  /** 当前滚动位置（px）。 */
  scrollTop: number
  /** 请求跳转到指定滚动位置（px），组件内部已 clamp。 */
  onJump: (top: number) => void
  /** 是否显示；false 时不渲染任何 DOM。 */
  visible: boolean
}

/** 把目标滚动位置收敛到合法区间 [0, totalHeight - viewportHeight]。 */
export function clampMinimapTop(
  top: number,
  totalHeight: number,
  viewportHeight: number,
): number {
  const maxTop = Math.max(0, totalHeight - viewportHeight)
  if (!Number.isFinite(top)) return 0
  return Math.min(maxTop, Math.max(0, top))
}

/** 视口矩形在轨道内的 top / height（px），两者都按 totalHeight 的比例换算。 */
export function getMinimapThumbRect(
  totalHeight: number,
  viewportHeight: number,
  scrollTop: number,
): { top: number; height: number } {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) {
    return { top: 0, height: MINIMAP_TRACK_HEIGHT }
  }

  const heightRatio = Math.min(1, Math.max(0, viewportHeight / totalHeight))
  const height = heightRatio * MINIMAP_TRACK_HEIGHT
  const safeTop = clampMinimapTop(scrollTop, totalHeight, viewportHeight)
  const top = (safeTop / totalHeight) * MINIMAP_TRACK_HEIGHT

  // 浮点误差兜底：矩形底边不越过轨道末端。
  return { top: Math.min(top, MINIMAP_TRACK_HEIGHT - height), height }
}

export default function MobileMinimap({
  totalHeight,
  viewportHeight,
  scrollTop,
  onJump,
  visible,
}: MobileMinimapProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  /** 拖动起点相对视口矩形顶部的偏移（轨道 px）；null = 当前未拖动。 */
  const grabOffsetRef = useRef<number | null>(null)

  // 不可见、参数非法或整页无需滚动时不渲染，避免给舞台留一块无效热区。
  if (
    !visible ||
    !Number.isFinite(totalHeight) ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0 ||
    totalHeight <= viewportHeight
  ) {
    return null
  }

  const maxTop = Math.max(0, totalHeight - viewportHeight)
  const safeScrollTop = clampMinimapTop(scrollTop, totalHeight, viewportHeight)
  const thumb = getMinimapThumbRect(totalHeight, viewportHeight, safeScrollTop)
  const percent = Math.round((safeScrollTop / totalHeight) * 100)

  /** 指针 y 坐标 → 页面 top；扣除抓取偏移，拖动视口矩形时不会跳动。 */
  const jumpFromPointer = (clientY: number, grabOffset: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    // jsdom 等无布局环境 rect.height 为 0，回退到固定高度，保证行为可测且稳定。
    const trackHeight = rect.height > 0 ? rect.height : MINIMAP_TRACK_HEIGHT
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top - grabOffset) / trackHeight))
    onJump(clampMinimapTop(ratio * totalHeight, totalHeight, viewportHeight))
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const rect = event.currentTarget.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    const onThumb =
      offsetY >= thumb.top - THUMB_HIT_SLOP &&
      offsetY <= thumb.top + thumb.height + THUMB_HIT_SLOP
    const grabOffset = onThumb ? offsetY - thumb.top : 0

    grabOffsetRef.current = grabOffset
    event.currentTarget.focus()
    event.preventDefault()

    if (typeof event.currentTarget.setPointerCapture === "function" && typeof event.pointerId === "number") {
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    // 按下即上报：点在空白处直接跳到指针位置；点在矩形上时 grab 偏移抵消，不会跳动。
    jumpFromPointer(event.clientY, grabOffset)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const grabOffset = grabOffsetRef.current
    if (grabOffset === null) return
    jumpFromPointer(event.clientY, grabOffset)
  }

  /** 指针捕获意外丢失（切窗、系统手势等）时结束拖动，避免后续 hover 误触发跳转。 */
  const handleLostPointerCapture = () => {
    grabOffsetRef.current = null
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (grabOffsetRef.current === null) return
    grabOffsetRef.current = null
    if (
      typeof event.currentTarget.releasePointerCapture === "function" &&
      typeof event.pointerId === "number" &&
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (event.key === "ArrowDown") next = safeScrollTop + MINIMAP_KEYBOARD_STEP
    else if (event.key === "ArrowUp") next = safeScrollTop - MINIMAP_KEYBOARD_STEP
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = maxTop
    if (next === null) return

    event.preventDefault()
    onJump(clampMinimapTop(next, totalHeight, viewportHeight))
  }

  return (
    <div
      data-testid="mobile-minimap"
      // 外层只负责定位：不接收指针事件，避免遮挡 iframe / 舞台。
      style={{ pointerEvents: "none" }}
      className="pointer-events-none fixed bottom-4 right-4 z-40 select-none"
    >
      <div
        ref={trackRef}
        data-testid="mobile-minimap-track"
        role="slider"
        aria-label="页面小地图导航"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxTop)}
        aria-valuenow={Math.round(safeScrollTop)}
        aria-valuetext={`${percent}%`}
        title="点击或拖动跳转，方向键微调"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleKeyDown}
        // 只有轨道自身接收指针事件；外层 none 不阻断这里的 auto。
        style={{ pointerEvents: "auto", height: MINIMAP_TRACK_HEIGHT, touchAction: "none" }}
        className="group relative w-4 cursor-pointer rounded-full bg-white/70 ring-1 ring-inset ring-zinc-900/10 shadow-md backdrop-blur-sm outline-none transition-shadow hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cobalt)]"
      >
        <div
          data-testid="mobile-minimap-thumb"
          aria-hidden="true"
          style={{ top: thumb.top, height: thumb.height }}
          className="pointer-events-none absolute left-0.5 right-0.5 rounded-full bg-zinc-900/30 transition-colors group-hover:bg-zinc-900/45 group-active:bg-zinc-900/50"
        />
      </div>
    </div>
  )
}
