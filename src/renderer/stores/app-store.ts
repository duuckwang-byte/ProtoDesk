/**
 * src/renderer/stores/app-store.ts — Wave 2-G 主壳状态（项目/原型/端别/缩放/侧栏）。
 *
 * 真 zustand 实现（zustand v5 `create`）。
 * 对外 API 与此前自实现一字不改，G/H/I 及所有消费方零改：
 *   - 细粒度 selector：`useAppStore((s) => s.project)`（H/I/J/K/L 只读消费，API 已定稿不得改名）
 *   - `useAppStore.getState()` / `useAppStore.setState()` / `useAppStore.subscribe()`
 *   - 无参数调用返回完整 state（`useAppStore()`）。
 *
 * 持久化红线（§10.3）：分组/折叠/缩放读写必须经 `@/lib/storage-keys` 的键 helpers，
 * 原样读写 `protoGroups_v1__*`、`protoGroupsFold_v1__*`、`contentZoom`，不做迁移、不清空。
 */

import { create } from "zustand"
import {
  CONTENT_ZOOM_FALLBACK,
  groupsFoldKey,
  loadGroupsData,
  readContentZoom,
  readJson,
  saveGroupsData,
  writeContentZoom,
  writeJson,
} from "@/lib/storage-keys"

/** 舞台端别：pc = 桌面端，mobile = 移动端（375 逻辑宽 + 动态视口高，W5）。 */
export type StageKind = "pc" | "mobile"

/**
 * 移动端预览视口模式（M1，W5 修订动态视口高）：
 * - overview：375×780 参考机整体 fit，不滚动；
 * - fit-width：默认，scale=min(1, 可用宽/375)，视口高=壳可视高÷比例，底部常驻可见；
 * - 100 / 125：固定比例，视口高随比例反缩，纵向滚动发生在原型（iframe）内部；
 * - custom：-/+ 调整后的自定义比例（复用持久化 `zoom`）。
 */
export type MobileViewportMode = "overview" | "fit-width" | "100" | "125" | "custom"

export const MOBILE_VIEWPORT_MODES: readonly MobileViewportMode[] = [
  "overview",
  "fit-width",
  "100",
  "125",
  "custom",
]

/** 移动端壳内滚动位置（每个模式各记一份）。 */
export interface MobileViewportPosition {
  top: number
  left: number
}

/**
 * 进入移动端前的 chrome 快照（B4 P2-1）。
 *
 * 进入移动端会自动收侧栏 / 关文档；这里只记录进入前的状态，切回 PC 时由 Stage 恢复。
 * `*Touched` = 移动端会话期间用户手动改过该开关，回 PC 时以用户操作为准，不覆盖。
 */
export interface MobileChromeSnapshot {
  sidebarOpen: boolean
  docsOpen: boolean
  sidebarTouched: boolean
  docsTouched: boolean
}

export type MobileViewportPositions = Record<MobileViewportMode, MobileViewportPosition>

const EMPTY_MOBILE_POSITION: MobileViewportPosition = { top: 0, left: 0 }

export function createMobileViewportPositions(): MobileViewportPositions {
  return {
    overview: { ...EMPTY_MOBILE_POSITION },
    "fit-width": { ...EMPTY_MOBILE_POSITION },
    "100": { ...EMPTY_MOBILE_POSITION },
    "125": { ...EMPTY_MOBILE_POSITION },
    custom: { ...EMPTY_MOBILE_POSITION },
  }
}

export function isMobileViewportMode(value: unknown): value is MobileViewportMode {
  return typeof value === "string" && (MOBILE_VIEWPORT_MODES as readonly string[]).includes(value)
}

/** 分组数据形态（与 storage-keys.loadGroupsData 返回一致，业务列表由 Wave2-H 持有）。 */
export type GroupsData = ReturnType<typeof loadGroupsData>

/** 折叠表：分组 id -> 是否折叠。 */
export type GroupsFold = Record<string, boolean>

export interface AppState {
  /** 当前项目名（空串 = 未选择，无业务数据时为空）。 */
  project: string
  /** 当前原型（源文件名，空串 = 未选择）。 */
  proto: string
  /** 当前页面/子页（loc-pill 第三段，空串 = 未选择）。 */
  page: string
  /** 舞台端别。 */
  kind: StageKind
  /** 舞台缩放 [0.2, 3]，初始值原样读 contentZoom。 */
  zoom: number
  /** 移动端自适应缩放盒开关（默认开，§8.1）。PC 不消费；保留以兼容旧 API。 */
  fitMode: boolean
  /** 移动端预览视口模式（默认适宽）。 */
  mobileViewMode: MobileViewportMode
  /** 每个移动视口模式各自记住的壳内滚动位置。 */
  mobileScrollPositions: MobileViewportPositions
  /** 进入移动端前的侧栏/文档状态；null = 无待恢复状态（PC 首次进入 / 已恢复）。 */
  mobileChromeSnapshot: MobileChromeSnapshot | null
  /** 侧栏展开/收起。 */
  sidebarOpen: boolean
  setProject: (project: string) => void
  setProto: (proto: string) => void
  setPage: (page: string) => void
  setKind: (kind: StageKind) => void
  setZoom: (zoom: number) => void
  setFitMode: (fitMode: boolean) => void
  setMobileViewMode: (mode: MobileViewportMode) => void
  /** 记录某个模式的壳内滚动位置（切回该模式时恢复并 clamp）。 */
  setMobileScrollPosition: (mode: MobileViewportMode, position: MobileViewportPosition) => void
  /** 写入 / 清空移动前 chrome 快照（只记录，不触发侧栏或文档开合）。 */
  setMobileChromeSnapshot: (snapshot: MobileChromeSnapshot | null) => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  /** 经 storage-keys 原样读本项目分组（默认当前项目）。 */
  readGroups: (project?: string) => GroupsData
  /** 经 storage-keys 原样写本项目分组（只写作用域键）。 */
  writeGroups: (data: GroupsData, project?: string) => void
  /** 经 storage-keys 原样读本项目折叠表（默认当前项目，缺失回空对象）。 */
  readFold: (project?: string) => GroupsFold
  /** 经 storage-keys 原样写本项目折叠表（只写作用域键）。 */
  writeFold: (fold: GroupsFold, project?: string) => void
  /** 读缩放（state 真值；初始化时原样读 contentZoom）。 */
  readZoom: () => number
  /** 写缩放（走 setZoom：clamp + 原样写 contentZoom）。 */
  writeZoom: (zoom: number) => void
}

function initialZoom(): number {
  try {
    if (typeof window === "undefined") return CONTENT_ZOOM_FALLBACK
    return readContentZoom(CONTENT_ZOOM_FALLBACK)
  } catch {
    return CONTENT_ZOOM_FALLBACK
  }
}

function clampZoom(value: number): number | null {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  // 与旧 clampZoom 一致：0.2..3（C15）。
  return Math.min(3, Math.max(0.2, v))
}

function coerceScrollValue(value: unknown): number {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.round(v * 100) / 100
}

function coerceMobilePosition(value: unknown): MobileViewportPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_MOBILE_POSITION }
  }
  const rec = value as Record<string, unknown>
  return { top: coerceScrollValue(rec.top), left: coerceScrollValue(rec.left) }
}

function coerceFold(value: unknown): GroupsFold {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: GroupsFold = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v
  }
  return out
}

export interface AppStoreHook {
  (): AppState
  <S>(selector: (s: AppState) => S): S
  getState: () => AppState
  setState: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
  subscribe: (listener: () => void) => () => void
}

export const useAppStore: AppStoreHook = create<AppState>()((set, get) => ({
  project: "",
  proto: "",
  page: "",
  kind: "pc",
  zoom: initialZoom(),
  fitMode: true,
  mobileViewMode: "fit-width",
  mobileScrollPositions: createMobileViewportPositions(),
  mobileChromeSnapshot: null,
  sidebarOpen: true,
  setProject: (project) => set({ project: String(project ?? "") }),
  setProto: (proto) => set({ proto: String(proto ?? "") }),
  setPage: (page) => set({ page: String(page ?? "") }),
  setKind: (kind) => set({ kind: kind === "mobile" ? "mobile" : "pc" }),
  setZoom: (zoom) => {
    const clamped = clampZoom(zoom)
    if (clamped === null) return
    set({ zoom: clamped })
    try {
      writeContentZoom(clamped)
    } catch {
      // 写失败静默（与 storage-keys 口径一致）。
    }
  },
  setFitMode: (fitMode) => set({ fitMode: Boolean(fitMode) }),
  setMobileViewMode: (mode) => {
    if (!isMobileViewportMode(mode)) return
    if (get().mobileViewMode === mode) return
    set({ mobileViewMode: mode })
  },
  setMobileScrollPosition: (mode, position) => {
    if (!isMobileViewportMode(mode)) return
    const next = coerceMobilePosition(position)
    const prev = get().mobileScrollPositions[mode]
    if (prev.top === next.top && prev.left === next.left) return
    set((state) => ({
      mobileScrollPositions: { ...state.mobileScrollPositions, [mode]: next },
    }))
  },
  setMobileChromeSnapshot: (snapshot) => {
    set({ mobileChromeSnapshot: snapshot ?? null })
  },
  setSidebarOpen: (open) => set({ sidebarOpen: Boolean(open) }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  readGroups: (project) => {
    const p = project ?? get().project
    try {
      return loadGroupsData(p)
    } catch {
      return { list: [], map: {} }
    }
  },
  writeGroups: (data, project) => {
    const p = project ?? get().project
    try {
      saveGroupsData(p, data)
    } catch {
      // 写失败静默。
    }
  },
  readFold: (project) => {
    const p = project ?? get().project
    try {
      return coerceFold(readJson(groupsFoldKey(p), null))
    } catch {
      return {}
    }
  },
  writeFold: (fold, project) => {
    const p = project ?? get().project
    try {
      writeJson(groupsFoldKey(p), fold ?? {})
    } catch {
      // 写失败静默。
    }
  },
  readZoom: () => get().zoom,
  writeZoom: (zoom) => get().setZoom(zoom),
}))
