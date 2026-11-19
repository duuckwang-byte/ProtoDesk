/**
 * src/renderer/components/shell/Stage.tsx — 预览舞台（W3-02：真实 iframe + 子页 + 拾取）。
 *
 * 数据接线（只读消费 W3-01 冻结的 sources-store）：
 * - `currentSource`：源对象（sandboxDir/mainHtmlFile/subPages/content/activeContent）；
 * - `activeContent || content`：主页取列表内容，子页取 sandbox:read-file 结果；
 * - `selectSubPage(file)`：子页切换；传主页文件名即回主页。
 *
 * 布局：
 * - PC：iframe 以舞台剩余空间为 100% 基准，外层按 zoom 做 CSS zoom 缩放
 *   （W5 修订：zoom 是布局级缩放，元素布局尺寸即 基准×zoom，无需再包一层
 *   transform 缩放盒；zoom 会传播进沙箱帧并按新比例重栅格化文字，transform
 *   只会把 1× 栅格纹理上采样导致放大发虚，见 Chromium 399478935/513611535）；
 * - 移动端（M1）：固定 375 逻辑宽，视口高动态适配（W5 修订，详见
 *   useMobileViewport.ts 头注），模式为「全貌 / 适宽 / 100% / 125% / 自定义」；
 *   缩放同样只做 CSS zoom；适宽/固定比例/自定义下壳高吃满可用高、底部常驻
 *   可见，超宽时壳内横向滚动，外层 Stage 始终 overflow-hidden；每个模式独立
 *   记忆滚动位置。
 * - zoom 与 transform 的坐标口径一致（Chromium 实测）：zoom 子树内
 *   getBoundingClientRect 返回外层（视觉）坐标、clientWidth 返回逻辑值，
 *   frameScaleFromWidths = 视觉宽/逻辑宽 的既有换算继续成立，拾取/标注
 *   覆盖层无需改动。
 *
 * 拾取（方案 B）：
 * - Ctrl/Cmd 按住点击 = 多选 toggle（点击期间不新开输入框）；已打开的底部需求条保持不关闭，
 *   仅更新选择，草稿由 PreviewOverlaysHost 保存，继续点选不丢已输入内容；
 * - Ctrl/Cmd+Shift 点击 = 单选替换，松开后才出现唯一修改弹窗（收起需求条）；
 * - 普通点击结束本次会话（关闭需求条/修改弹窗）；
 * - 点击意图只认 PICK_RESULT 自带的 ctrlKey/metaKey/shiftKey，不用父窗 modifierDown 反推；
 * - rect 已在 PreviewFrame 经 scaleRectToPage 换算为页面坐标；
 * - PreviewOverlaysHost 负责选中框/浮层工具条/需求条/修改弹窗/待提交列表。
 *
 * 无源时显示空态；不新增 IPC、不改 sources-store。移动视口模式/位置状态见 app-store（M1 新增）。
 * 移动端默认 chrome：打开移动端原型 / 切入移动端时默认展开侧栏并打开文档；
 * 从移动端切回 PC 时关闭文档（侧栏保留用户当前状态，见下方 chrome effect）。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Loader2, Monitor, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore, type MobileViewportMode, type StageKind } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"
import { useSourcesStore, type SourceKind } from "@/stores/sources-store"
import PreviewFrame, {
  type PickModifierState,
  type PreviewPickedElement,
} from "@/features/preview/PreviewFrame"
import PreviewOverlaysHost, {
  type PickModifyRequest,
} from "@/features/preview/PreviewOverlaysHost"
import MobileMinimap from "@/components/shell/MobileMinimap"
import {
  MOBILE_H,
  MOBILE_W,
  useMobileViewport,
} from "@/features/preview/useMobileViewport"
import { cn } from "@/lib/utils"

export { MOBILE_H, MOBILE_W }

/**
 * 舞台缩放读数：顶栏与舞台工具栏共享的单一事实源。
 *
 * 移动端「全貌 / 适宽」比例由本组件的 ResizeObserver + useMobileViewport 实测得出，
 * 持久化的 `zoom` 只参与自定义模式；若顶栏继续自行显示 `zoom`，就会出现
 * 「顶栏 85% / 舞台 60%」两套读数。Stage 在布局阶段把模式与实测比例发布到这里，
 * Topbar 只读订阅，不再自行推测。
 */
export interface StageScaleReading {
  kind: StageKind
  /** 兼容旧字段：移动端仅「适宽」模式为 true（不再等价于自适应总开关）。 */
  fitMode: boolean
  zoom: number
  /** 实际生效比例；null = 适宽/全貌比例尚未测得（首帧/容器尺寸为 0）。 */
  scale: number | null
  /** 移动端当前视口模式；PC 下无实际意义（保持最后一次值）。 */
  mobileMode: MobileViewportMode
}

let stageScaleReading: StageScaleReading = {
  kind: "pc",
  fitMode: false,
  zoom: 1,
  scale: 1,
  mobileMode: "fit-width",
}

const stageScaleListeners = new Set<() => void>()

function subscribeStageScale(listener: () => void): () => void {
  stageScaleListeners.add(listener)
  return () => {
    stageScaleListeners.delete(listener)
  }
}

function getStageScaleReading(): StageScaleReading {
  return stageScaleReading
}

/** Stage 发布实测读数；值未变时不触发订阅者。 */
export function publishStageScale(next: StageScaleReading): void {
  const prev = stageScaleReading
  if (
    prev.kind === next.kind &&
    prev.fitMode === next.fitMode &&
    prev.zoom === next.zoom &&
    prev.scale === next.scale &&
    prev.mobileMode === next.mobileMode
  ) {
    return
  }
  stageScaleReading = next
  for (const listener of stageScaleListeners) listener()
}

/** 顶栏 / 舞台工具栏共用的订阅入口。 */
export function useStageScaleReading(): StageScaleReading {
  return useSyncExternalStore(subscribeStageScale, getStageScaleReading, getStageScaleReading)
}

/**
 * 缩放文案（两处共用，保证格式与数值一致）：
 * - 已测得比例 → `60%`；
 * - 首帧/容器为 0 → fallback（默认「自适应」，绝不复用旧 zoom 假装测到）。
 */
export function stageZoomLabel(scale: number | null, fallback = "自适应"): string {
  return scale == null ? fallback : `${Math.round(scale * 100)}%`
}

/**
 * 顶栏与舞台工具栏共用的读数文案：
 * - PC：百分比（未测得时按旧口径显示「自适应」）；
 * - 移动端：已测得即百分比；未测得时显示模式名（全貌 / 适宽），不显示假数字。
 */
export function stageReadingLabel(
  kind: StageKind,
  mobileMode: MobileViewportMode,
  scale: number | null,
): string {
  if (kind !== "mobile") return stageZoomLabel(scale)
  if (scale != null) return stageZoomLabel(scale)
  if (mobileMode === "overview") return "全貌"
  if (mobileMode === "fit-width") return "适宽"
  return stageZoomLabel(scale)
}

/**
 * 顶栏 -/+ 是否应自动退出自适应：
 * 仅在移动端且当前开启自适应时，zoom 发生真实变化才退出（PC 舞台不消费 fitMode）。
 * Topbar 的 -/+ 与预设已显式退出；这里兜底其它来源的 zoom 变化。
 */
export function shouldExitFitOnZoomChange(
  prevZoom: number,
  nextZoom: number,
  kind: StageKind,
  fitMode: boolean,
): boolean {
  return kind === "mobile" && fitMode && prevZoom !== nextZoom
}

export default function Stage() {
  const kind = useAppStore((s) => s.kind)
  const zoom = useAppStore((s) => s.zoom)
  const mobileMode = useAppStore((s) => s.mobileViewMode)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)

  const currentSource = useSourcesStore((s) => s.currentSource)
  const activeSubFile = useSourcesStore((s) => s.activeSubFile)
  const activeContent = useSourcesStore((s) => s.activeContent)
  const loading = useSourcesStore((s) => s.loading)
  const selectSubPage = useSourcesStore((s) => s.selectSubPage)

  const boxRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  /** 最近一次按键/帧桥上报的修饰键；点击意图只认 PICK_RESULT，不再用本状态反推。 */
  const [pickModifiers, setPickModifiers] = useState<PickModifierState>({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  })
  const modifierDown = pickModifiers.ctrlKey || pickModifiers.metaKey
  // 底部需求条与修改弹窗都按 sourceKey 绑定：切源/切子页后旧会话自动失效。
  const [composerState, setComposerState] = useState<{ key: string } | null>(null)
  const [modifyState, setModifyState] = useState<{
    key: string
    request: PickModifyRequest
  } | null>(null)
  const pickRequestSeq = useRef(0)
  // 浮层工具条挂在舞台工具区（子顶栏）内，宿主由 Stage 提供，避免 fixed 浮条压住顶栏/文档面板。
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)
  const bindToolbarSlot = useCallback((node: HTMLDivElement | null) => setToolbarSlot(node), [])

  const src = currentSource
  const mainFile = src?.mainHtmlFile || src?.name || ""
  const isMain = !activeSubFile || activeSubFile === mainFile
  const sourceKey = `${src?.sandboxDir || ""}::${activeSubFile || ""}`
  /** 源身份：sandboxDir + name；子页切换不改变它（chrome 默认开合只认切源）。 */
  const sourceId = src ? `${src.sandboxDir || ""}::${src.name || ""}` : ""
  const sourceKind: SourceKind | null = src?.kind ?? null

  // 拾取态与源绑定：key 变化即视为空态，不需要 effect 里 setState 清空（避免级联渲染）。
  const [pickState, setPickState] = useState<{
    key: string
    hover: PreviewPickedElement | null
    selected: PreviewPickedElement[]
  }>({ key: sourceKey, hover: null, selected: [] })
  const hover = pickState.key === sourceKey ? pickState.hover : null
  const selected = pickState.key === sourceKey ? pickState.selected : []
  // 底部需求条 / 修改弹窗同样按 sourceKey 取空：切源/切子页后旧会话自动失效。
  const pickComposerOpen = composerState?.key === sourceKey && selected.length > 0
  const pickModifyRequest = modifyState?.key === sourceKey ? modifyState.request : null

  /*
   * 拾取意图的时间线：
   * 1. Ctrl/Cmd 点击（PICK_RESULT 自带 modifiers）→ 切换多选，只记 collectMode='requirement'；
   * 2. Ctrl/Cmd+Shift 点击 → 单选替换，只记 collectMode='modify'；
   * 3. 松开 Ctrl/Cmd（或 Shift）→ 才把选择转成「底部需求条」或「修改弹窗」。
   * 点击本身绝不弹输入框，也不依赖父窗 modifierDown（修复首次 Ctrl 点击不弹/第二次才弹）。
   */
  const selectedRef = useRef<PreviewPickedElement[]>([])
  const collectModeRef = useRef<'requirement' | 'modify' | null>(null)
  const sourceKeyRef = useRef(sourceKey)
  useEffect(() => {
    // 只重置会话用的 ref；composerState/modifyState 自身带 key，切源后由 key 失配自动隐藏。
    sourceKeyRef.current = sourceKey
    selectedRef.current = []
    collectModeRef.current = null
  }, [sourceKey])

  // 布局阶段测量：PC 缩放盒以该尺寸为 100% 基准，必须在首帧绘制前拿到，
  // 否则 100% 时会先渲染 0×0 再跳到实际尺寸（白屏闪烁）。
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = (rect: { width: number; height: number }) => {
      setBox({ w: rect.width, h: rect.height })
    }
    update(el.getBoundingClientRect())
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) update(rect)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [kind])

  /*
   * 移动端视口状态机：模式、比例、壳内滚动与位置记忆全部收在 hook 内。
   * PC 下 hook 仍会执行（Hooks 规则），但 Stage 不消费其渲染结果，PC 布局保持不变。
   */
  const mobile = useMobileViewport({
    availableWidth: box.w,
    availableHeight: box.h,
    scrollRef: mobileScrollRef,
    active: kind === "mobile",
  })

  /*
   * 端别切换时的默认 chrome：
   *
   * 移动端（默认打开）：
   * - 进入移动端 / 打开移动端原型时展开侧栏并打开文档；
   * - 触发时机（只在「进入或切源」的瞬间判定，不按当前开合状态反推）：
   *   1. kind 从 pc 切到 mobile（顶栏端别切换）；
   *   2. 首次挂载或切源后当前源为移动端：源身份（sandboxDir/name）变化才算切源，
   *      子页切换 / activeContent 刷新不改变 sourceId，不会把用户刚关掉的侧栏重新打开；
   *   3. 当前源端别从非 mobile 变为 mobile（syncSelection 与 kind 同帧变化时的兜底）。
   *
   * PC（默认关闭）：
   * - 只在端别「mobile → pc」的真实切换瞬间关闭文档（docsOpen 为 true 才写），
   *   侧栏不参与，保留用户当前状态；PC 首次启动 / 刷新不强制关闭（保留现有默认）；
   * - 不订阅 docsOpen：切到 PC 后用户再手动打开文档不会被本 effect 关掉。
   *
   * 去循环：
   * - 只在目标状态不为 true 时调用 action，重复触发不会产生新的 store 写入；
   * - 不订阅 sidebarOpen / docsOpen，effect 依赖只有 kind + 源身份 + 源端别，
   *   action 造成的 store 变化不会回灌本 effect；
   * - StrictMode 双执行：prev 引用在首轮写入，第二轮看到相同值，不会重复触发。
   */
  const chromeRef = useRef<{
    kind: StageKind
    sourceId: string
    sourceKind: SourceKind | null
  } | null>(null)
  useLayoutEffect(() => {
    const prev = chromeRef.current
    chromeRef.current = { kind, sourceId, sourceKind }

    // mobile → pc：仅真实切换瞬间关闭文档；侧栏保留用户当前状态，PC 首帧（prev=null）不关闭。
    const kindBecamePc = !!prev && prev.kind === "mobile" && kind === "pc"
    if (kindBecamePc) {
      const uiState = useUiStore.getState()
      if (uiState.docsOpen) uiState.closeDocs()
    }

    const kindBecameMobile = !!prev && prev.kind !== "mobile" && kind === "mobile"
    const sourceChanged = !!prev && prev.sourceId !== sourceId
    const sourceBecameMobile = !!prev && prev.sourceKind !== "mobile" && sourceKind === "mobile"
    // 移动端源：挂载即默认打开；之后仅在切源 / 源端别变为 mobile 时重新打开。
    const openedMobileSource =
      sourceKind === "mobile" &&
      !!sourceId &&
      (!prev || sourceChanged || sourceBecameMobile)

    if (!kindBecameMobile && !openedMobileSource) return

    if (!useAppStore.getState().sidebarOpen) setSidebarOpen(true)
    const ui = useUiStore.getState()
    if (!ui.docsOpen) ui.openDocs()
  }, [kind, sourceId, sourceKind, setSidebarOpen])

  const commitModifiers = useCallback((next: PickModifierState) => {
    setPickModifiers((prev) =>
      prev.ctrlKey === next.ctrlKey && prev.metaKey === next.metaKey && prev.shiftKey === next.shiftKey
        ? prev
        : next,
    )
  }, [])

  // 修饰键：父窗 keydown/keyup 与帧内 CTRL_STATE 都写入同一状态；松开事件是拾取会话的出口。
  useEffect(() => {
    const sync = (e: KeyboardEvent) =>
      commitModifiers({
        ctrlKey: !!e.ctrlKey,
        metaKey: !!e.metaKey,
        shiftKey: !!e.shiftKey,
      })
    const clear = () => commitModifiers({ ctrlKey: false, metaKey: false, shiftKey: false })
    window.addEventListener("keydown", sync)
    window.addEventListener("keyup", sync)
    window.addEventListener("blur", clear)
    return () => {
      window.removeEventListener("keydown", sync)
      window.removeEventListener("keyup", sync)
      window.removeEventListener("blur", clear)
    }
  }, [commitModifiers])

  const applySelection = useCallback(
    (next: PreviewPickedElement[], clearHover = true) => {
      selectedRef.current = next
      setPickState((prev) => ({
        key: sourceKey,
        hover: clearHover ? null : prev.key === sourceKey ? prev.hover : null,
        selected: next,
      }))
    },
    [sourceKey],
  )

  const handleHover = useCallback(
    (el: PreviewPickedElement | null) => {
      setPickState((prev) => ({
        key: sourceKey,
        hover: el,
        selected: prev.key === sourceKey ? prev.selected : [],
      }))
    },
    [sourceKey],
  )

  const handlePick = useCallback(
    (el: PreviewPickedElement, ev: PickModifierState) => {
      const ctrl = !!ev.ctrlKey || !!ev.metaKey
      const shift = !!ev.shiftKey
      // 点击自带的修饰键就是本次意图：不读父窗 modifierDown，首击即生效。
      // 每次都同步，防止按键抬起丢失后武装态残留把普通点击吞掉。
      commitModifiers({ ctrlKey: !!ev.ctrlKey, metaKey: !!ev.metaKey, shiftKey: shift })

      const base = selectedRef.current
      const exists = !!el.selector && base.some((item) => item.selector === el.selector)

      if (ctrl && shift) {
        // Ctrl/Cmd+Shift：只允许单选，新元素直接替换旧选择（不 toggle）。
        // 修改会话与需求会话互斥：进入修改前收起底部需求条（草稿仍由浮层宿主保留）。
        setComposerState(null)
        setModifyState(null)
        collectModeRef.current = 'modify'
        applySelection([el])
        return
      }
      if (ctrl) {
        /*
         * Ctrl/Cmd 继续多选：只更新 selected，不重置 composerState。
         * 已打开的底部需求条在按住 Ctrl 期间保持挂载（输入框与草稿都不消失），
         * 松开 Ctrl 后仍复用同一会话，不会重建输入条。
         */
        setModifyState(null)
        collectModeRef.current = 'requirement'
        const next = exists ? base.filter((item) => item.selector !== el.selector) : [...base, el]
        // 选择被点空时收起会话，避免下一次 Ctrl 首击时提前弹条；草稿由浮层宿主保留。
        if (!next.length) setComposerState(null)
        applySelection(next)
        return
      }
      // 普通点击：只选中/取消，并结束本次需求/修改会话（输入条与弹窗都不叠加）。
      setComposerState(null)
      setModifyState(null)
      collectModeRef.current = null
      applySelection(exists ? base.filter((item) => item.selector !== el.selector) : [el])
    },
    [applySelection, commitModifiers],
  )

  /*
   * 松开修饰键 → 会话出口：
   * - requirement：有选择则显示一个底部需求条（多选共享一条需求）；
   * - modify：只保留一个 Ctrl/Cmd+Shift 目标，显示一个修改文字弹窗。
   * 点击本身不新开输入框；已打开的需求条在 Ctrl 多选期间保持挂载。
   */
  const prevModifiersRef = useRef<PickModifierState>(pickModifiers)
  useEffect(() => {
    const prev = prevModifiersRef.current
    prevModifiersRef.current = pickModifiers
    const prevCtrl = prev.ctrlKey || prev.metaKey
    const ctrl = pickModifiers.ctrlKey || pickModifiers.metaKey
    const ctrlReleased = prevCtrl && !ctrl
    const shiftReleased = prev.shiftKey && !pickModifiers.shiftKey
    if (!ctrlReleased && !shiftReleased) return

    const mode = collectModeRef.current
    if (!mode) return
    collectModeRef.current = null

    if (mode === 'modify') {
      const one = selectedRef.current[0]
      if (!one) return
      pickRequestSeq.current += 1
      setModifyState({
        key: sourceKeyRef.current,
        request: { element: one, seq: pickRequestSeq.current },
      })
      setComposerState(null)
      return
    }

    // 需求条只在 Ctrl/Cmd 松开时出现；Shift 单独松开不结束多选。
    if (!ctrlReleased) return
    if (!selectedRef.current.length) return
    setModifyState(null)
    setComposerState({ key: sourceKeyRef.current })
  }, [pickModifiers])

  const clearSelection = useCallback(() => {
    selectedRef.current = []
    collectModeRef.current = null
    setComposerState(null)
    setModifyState(null)
    setPickState((prev) => ({
      key: sourceKey,
      hover: prev.key === sourceKey ? prev.hover : null,
      selected: [],
    }))
  }, [sourceKey])

  const removeSelection = useCallback(
    (selector: string) => {
      const next = selectedRef.current.filter((item) => item.selector !== selector)
      selectedRef.current = next
      if (!next.length) {
        collectModeRef.current = null
        setComposerState(null)
        setModifyState(null)
      }
      setPickState((prev) => ({
        key: sourceKey,
        hover: prev.key === sourceKey ? prev.hover : null,
        selected: next,
      }))
    },
    [sourceKey],
  )

  const handleWatchdogExit = useCallback(
    () => commitModifiers({ ctrlKey: false, metaKey: false, shiftKey: false }),
    [commitModifiers],
  )
  const handleFrameScroll = useCallback(() => {
    setPickState((prev) => ({
      key: sourceKey,
      hover: null,
      selected: prev.key === sourceKey ? prev.selected : [],
    }))
  }, [sourceKey])
  const handleModifierChange = useCallback(
    (state: PickModifierState) => commitModifiers(state),
    [commitModifiers],
  )
  const handlePickComposerClose = useCallback(() => setComposerState(null), [])
  const handlePickModifyClose = useCallback(() => setModifyState(null), [])

  // PC 生效比例 = zoom；移动端 = 视口模式算出的 scale（未测得为 null）。
  const appliedScale = kind === "mobile" ? mobile.scale : zoom
  // PreviewFrame 的坐标换算兜底比例：首帧未测得时按 1，避免 0 传入。
  const frameScale = kind === "mobile" ? mobile.layoutScale : 1
  const zoomLabel = stageReadingLabel(kind, mobileMode, appliedScale)

  // 布局阶段发布，保证顶栏与舞台工具栏在同一帧显示同一个读数。
  useLayoutEffect(() => {
    publishStageScale({
      kind,
      fitMode: kind === "mobile" && mobileMode === "fit-width",
      zoom,
      scale: appliedScale,
      mobileMode,
    })
  }, [kind, mobileMode, zoom, appliedScale])

  const html = src ? activeContent || src.content : ""
  const pickEnabled = modifierDown && !!src
  const stageTitle = src ? `${src.displayName} · ${isMain ? mainFile : activeSubFile}` : "原型预览"

  const onSelectSubPage = (file: string) => {
    void selectSubPage(file)
  }

  const emptyState = (
    <div
      data-testid="stage-empty"
      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-6 py-16"
    >
      <Monitor aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        {loading ? "正在加载原型…" : "未选择原型"}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {loading ? "正在读取沙箱列表" : "从左侧选择原型，或新建 / 导入原型"}
      </p>
    </div>
  )

  const frame = src ? (
    <PreviewFrame
      html={html}
      kind={src.kind}
      sandboxDir={src.sandboxDir}
      subPages={src.subPages}
      pickEnabled={pickEnabled}
      scale={frameScale}
      title={stageTitle}
      onHoverElement={handleHover}
      onPickElement={handlePick}
      onFrameScroll={handleFrameScroll}
      onWatchdogExit={handleWatchdogExit}
      onPickModifierChange={handleModifierChange}
    />
  ) : null

  /*
   * 移动端画面本体：iframe 永远是 375 逻辑宽，视口高动态适配（全貌用 780 参考机）；
   * 缩放走 CSS zoom（布局级，帧内文字按新比例重栅格化），zoom 子树的布局尺寸
   * 即 375×比例 × 视口高×比例，外层 zoom-box 显式给出同值作为滚动范围。
   */
  const mobileSurface = (
    <div
      data-testid="stage-viewport"
      data-mode={mobileMode}
      style={{
        width: MOBILE_W,
        height: mobile.viewportH,
        zoom: mobile.layoutScale,
      }}
      className={cn(
        "relative overflow-hidden bg-background",
        !src && "flex flex-col items-center justify-center gap-2",
      )}
    >
      {src ? (
        frame
      ) : (
        <>
          <Smartphone aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">移动端舞台空态</p>
          <p className="text-[11px] text-muted-foreground">从左侧选择原型后开始预览</p>
        </>
      )}
    </div>
  )

  return (
    <section
      data-testid="stage-frame"
      data-kind={kind}
      data-fit={kind === "mobile" ? (mobileMode === "fit-width" ? "on" : "off") : "off"}
      data-mobile-mode={kind === "mobile" ? mobileMode : undefined}
      data-has-source={src ? "1" : "0"}
      data-subfile={src ? activeSubFile || mainFile : ""}
      aria-label={kind === "mobile" ? "移动端舞台" : "桌面端舞台"}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
    >
      {/*
        舞台工具区：只保留一条紧凑子顶栏。
        - 设备/缩放信息与子页 Tab 合并，去掉原来“移动端 375×780 · 首页 自适应 60%”的整行说明；
        - 浮层工具条（标注/交互/待提交…）由 PreviewOverlaysHost portal 进右侧 slot，
          不再 fixed 压住顶栏或文档面板；容器本身不建立高层级。
      */}
      <div
        data-testid="stage-toolbar"
        className="flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-chrome px-2"
      >
        <div className="flex shrink-0 items-center gap-1.5">
          {kind === "mobile" ? (
            <Smartphone aria-hidden="true" className="size-3.5 text-muted-foreground" />
          ) : (
            <Monitor aria-hidden="true" className="size-3.5 text-muted-foreground" />
          )}
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            {kind === "mobile"
              ? `移动端 ${MOBILE_W}×${mobile.isOverview ? MOBILE_H : Math.round(mobile.viewportH)}`
              : "桌面端"}
          </span>
          {loading ? (
            <Loader2 aria-hidden="true" className="size-3 animate-spin text-muted-foreground" data-testid="stage-loading" />
          ) : null}
          {pickEnabled ? (
            <span data-testid="pick-status" className="whitespace-nowrap text-[11px] text-[var(--cobalt)]">
              拾取中
            </span>
          ) : null}
        </div>

        {/* 子页切换：主页 + subPages（对应旧 loadSubPage；选中态由 sources-store.activeSubFile 驱动）。 */}
        {src && src.subPages.length > 0 ? (
          <div
            data-testid="stage-subpages"
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <Button
              variant={isMain ? "secondary" : "ghost"}
              size="sm"
              className="h-6 shrink-0 px-2 text-[11px]"
              onClick={() => onSelectSubPage(mainFile)}
              title={mainFile}
            >
              主页
            </Button>
            {src.subPages.map((sp) => (
              <Button
                key={sp.file}
                variant={activeSubFile === sp.file ? "secondary" : "ghost"}
                size="sm"
                className="h-6 shrink-0 px-2 text-[11px]"
                onClick={() => onSelectSubPage(sp.file)}
                title={sp.file}
              >
                {sp.name}
              </Button>
            ))}
          </div>
        ) : (
          <div className="min-w-2 flex-1" />
        )}

        {/*
          只读缩放读数：与顶栏共用 Stage 发布的同一份 appliedScale。
          自适应开关已收进顶栏缩放组，本工具栏不再重复一个「自适应：开/关」按钮。
        */}
        <span
          data-testid="stage-zoom-readout"
          className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:inline"
          aria-live="polite"
          title={kind === "mobile" ? "移动端视口缩放后的实际比例" : "舞台缩放比例"}
        >
          {zoomLabel}
        </span>

        {src ? (
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
        ) : null}
        <div
          ref={bindToolbarSlot}
          data-testid="stage-overlay-slot"
          className="flex min-w-0 items-center"
        />
      </div>

      {kind === "mobile" ? (
        /*
          移动端舞台：外层只负责测量与居中，永远 overflow-hidden。
          - overview：375×780 参考机整体 fit，无滚动容器；
          - 适宽/100/125/custom：壳高吃满可用高，视口高动态适配（内容高 ≈ 可视高，
            无壳内纵向滚动，底部常驻可见，滚动发生在原型内部）；超宽时壳内横向滚动。
          - 小地图只在真实存在纵向溢出时显示（动态视口高下通常不出现）。
        */
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden p-4">
          <div
            ref={boxRef}
            data-testid="stage-mobile-area"
            data-mode={mobileMode}
            className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
          >
            {mobile.isOverview ? (
              <div
                data-testid="stage-mobile-overview"
                data-mode={mobileMode}
                style={{ width: mobile.contentWidth, height: mobile.contentHeight }}
                className="relative shrink-0 overflow-hidden rounded-xl bg-background shadow-sm ring-1 ring-border"
              >
                {mobileSurface}
              </div>
            ) : (
              <div
                data-testid="stage-mobile-shell"
                data-mode={mobileMode}
                style={{ width: mobile.shellWidth, height: mobile.shellHeight }}
                className="relative shrink-0 overflow-hidden rounded-xl bg-background shadow-sm ring-1 ring-border"
              >
                <div
                  ref={mobileScrollRef}
                  data-testid="stage-mobile-scroll"
                  data-mode={mobileMode}
                  data-overflow={mobileMode === "fit-width" ? "auto-y" : "auto"}
                  onScroll={mobile.handleScroll}
                  className={cn(
                    "size-full overscroll-contain",
                    mobileMode === "fit-width"
                      ? "overflow-y-auto overflow-x-hidden"
                      : "overflow-auto",
                  )}
                >
                  <div
                    data-testid="stage-mobile-zoom-box"
                    style={{ width: mobile.contentWidth, height: mobile.contentHeight }}
                    className="relative overflow-hidden"
                  >
                    {mobileSurface}
                  </div>
                </div>

                {/* 小地图只在壳内真实存在纵向溢出时显示（动态视口高下通常无溢出）。 */}
                <MobileMinimap
                  totalHeight={mobile.contentHeight}
                  viewportHeight={mobile.viewportHeight}
                  scrollTop={mobile.scrollTop}
                  onJump={mobile.jumpTo}
                  visible={
                    mobileMode !== "overview" &&
                    mobile.viewportHeight > 0 &&
                    mobile.contentHeight > mobile.viewportHeight + 1
                  }
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        /*
          PC 真实缩放：以舞台可用区为 100% 基准。
          - 缩放走 CSS zoom（W5 修订）：zoom 是布局级缩放，画面本体的布局尺寸
            即 基准 × zoom（决定滚动范围与外层居中），无需 transform 缩放盒；
            zoom 传播进沙箱帧并按新比例重栅格化文字，放大不再发虚。
          - 溢出只向右/下扩展、可滚动到全部内容，不会出现不可达的负坐标；
            滚动只发生在舞台内部，不产生外层文档滚动条。
        */
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <div ref={boxRef} className="relative flex min-h-0 flex-1 flex-col">
            {src ? (
              <div data-testid="stage-pc-scroll" className="absolute inset-0 flex overflow-auto">
                <div
                  data-testid="stage-pc-zoom"
                  data-zoom={zoom}
                  style={{ width: box.w, height: box.h, zoom }}
                  className="relative m-auto shrink-0 overflow-hidden rounded-lg border border-border bg-white shadow-sm"
                >
                  {frame}
                </div>
              </div>
            ) : (
              emptyState
            )}
          </div>
        </div>
      )}

      <PreviewOverlaysHost
        hover={hover}
        selected={selected}
        pickComposerOpen={pickComposerOpen}
        pickModifyRequest={pickModifyRequest}
        toolbarSlot={toolbarSlot}
        onPickComposerClose={handlePickComposerClose}
        onPickModifyClose={handlePickModifyClose}
        onClearSelection={clearSelection}
        onRemoveSelection={removeSelection}
      />
    </section>
  )
}
