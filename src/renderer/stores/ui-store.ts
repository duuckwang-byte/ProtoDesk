/**
 * src/renderer/stores/ui-store.ts — Wave 2-G 浮层/通知状态（文档/AI/设置/mini-dock/toast）。
 *
 * 真 zustand 实现（zustand v5 `create`）。
 * 对外 API 与此前自实现一字不改：
 *   - 细粒度 selector：`useUiStore((s) => s.docsOpen)`（H/I/J/K/L 只读消费，API 已定稿不得改名）
 *   - `useUiStore.getState()` / `useUiStore.setState()` / `useUiStore.subscribe()`
 *
 * Esc 栈顺序（定稿，W2）：AI Dialog > 设置 > Git > 导出 > 文档浮层。
 * 所有浮层统一经 `closeTopmost()` 处理 Esc，一次只关顶层；Dialog/Sheet/AlertDialog
 * 不自行监听 Esc，只在 `registerOverlayLayer()` 登记关闭回调，供全局入口在栈空时兜底。
 * toast 统一走本 store，禁止 `alert` / `confirm` / `prompt`。
 * W2 新增：gitOpen / exportOpen 两组 open/close/toggle（命名逐字定稿，供 W1/顶栏消费）。
 */

import { create } from "zustand"

/** 设置面板 Tab（§8.1 共 6 个；null = 设置关闭）。 */
export type SettingsTabId = "agent" | "model" | "spec" | "sandbox" | "shortcut" | "about"

export type ToastVariant = "default" | "cobalt" | "destructive"

export interface UiToast {
  id: number
  title: string
  description?: string
  variant?: ToastVariant
}

/** closeTopmost 关掉的顶层浮层（null = 无可关）。栈顺序 AI > 设置 > Git > 导出 > 文档。 */
export type TopLayer = "ai" | "settings" | "git" | "export" | "docs" | null

export interface UiState {
  /** 文档面板打开（PC=悬浮覆盖，移动端=Flex 挤压）。 */
  docsOpen: boolean
  /** AI 对话框打开（Wave2-J 填充，居中大型 Dialog）。 */
  aiOpen: boolean
  /** 设置面板 Tab（null = 关闭）。 */
  settingsTab: SettingsTabId | null
  /** Git 面板打开（主窗右侧 Sheet 承载，W1/顶栏消费）。 */
  gitOpen: boolean
  /** 导出菜单打开（顶栏 Dropdown 内容，主窗不挂载，仅状态参与 Esc 栈）。 */
  exportOpen: boolean
  /** 侧栏收起后是否显示左下角悬浮入口（默认显示）。 */
  miniDockVisible: boolean
  /** 通知队列（先进先出，展示层消费后 dismiss）。 */
  toasts: UiToast[]
  openDocs: () => void
  closeDocs: () => void
  toggleDocs: () => void
  openAi: () => void
  closeAi: () => void
  toggleAi: () => void
  openSettings: (tab?: SettingsTabId) => void
  closeSettings: () => void
  openGit: () => void
  closeGit: () => void
  toggleGit: () => void
  openExport: () => void
  closeExport: () => void
  toggleExport: () => void
  setMiniDockVisible: (visible: boolean) => void
  pushToast: (input: { title: string; description?: string; variant?: ToastVariant }) => number
  dismissToast: (id: number) => void
  clearToasts: () => void
  /** Esc 统一入口：按 AI > 设置 > Git > 导出 > 文档顺序只关顶层，返回被关层。 */
  closeTopmost: () => TopLayer
}

let toastSeq = 1

/**
 * 通用弹层（Dialog / Sheet / AlertDialog）注册的 Esc 栈。
 *
 * 这些组件本身不再监听 keydown；打开时把「关闭自己」的回调登记到这里，
 * 由 MainWindow 的单一 Esc 入口在 ui-store 栈为空时兜底调用。
 * 后打开者排在后面（更靠上），一次只关最后一个。
 */
export interface OverlayLayer {
  close: () => void
  /** 打开该层时的焦点元素；Esc 兜底关闭后还焦点（已卸载则跳过）。 */
  opener?: HTMLElement | null
}

const overlayLayers: OverlayLayer[] = []

/** 登记一个通用弹层；返回注销函数（组件卸载/关闭时调用）。 */
export function registerOverlayLayer(layer: OverlayLayer): () => void {
  overlayLayers.push(layer)
  return () => {
    const index = overlayLayers.lastIndexOf(layer)
    if (index >= 0) overlayLayers.splice(index, 1)
  }
}

/** 关闭最上层通用弹层；无弹层时返回 null。同步出栈，保证同一 tick 连续 Esc 各关一层。 */
export function closeTopmostOverlay(): OverlayLayer | null {
  const layer = overlayLayers.pop()
  if (!layer) return null
  layer.close()
  return layer
}

export interface UiStoreHook {
  (): UiState
  <S>(selector: (s: UiState) => S): S
  getState: () => UiState
  setState: (partial: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => void
  subscribe: (listener: () => void) => () => void
}

export const useUiStore: UiStoreHook = create<UiState>()((set, get) => ({
  docsOpen: false,
  aiOpen: false,
  settingsTab: null,
  gitOpen: false,
  exportOpen: false,
  miniDockVisible: true,
  toasts: [],
  openDocs: () => set({ docsOpen: true }),
  closeDocs: () => {
    if (get().docsOpen) set({ docsOpen: false })
  },
  toggleDocs: () => set({ docsOpen: !get().docsOpen }),
  openAi: () => set({ aiOpen: true }),
  closeAi: () => {
    if (get().aiOpen) set({ aiOpen: false })
  },
  toggleAi: () => set({ aiOpen: !get().aiOpen }),
  openSettings: (tab) => set({ settingsTab: tab ?? get().settingsTab ?? "agent" }),
  closeSettings: () => {
    if (get().settingsTab !== null) set({ settingsTab: null })
  },
  openGit: () => set({ gitOpen: true }),
  closeGit: () => {
    if (get().gitOpen) set({ gitOpen: false })
  },
  toggleGit: () => set({ gitOpen: !get().gitOpen }),
  openExport: () => set({ exportOpen: true }),
  closeExport: () => {
    if (get().exportOpen) set({ exportOpen: false })
  },
  toggleExport: () => set({ exportOpen: !get().exportOpen }),
  setMiniDockVisible: (visible) => set({ miniDockVisible: Boolean(visible) }),
  pushToast: (input) => {
    const id = toastSeq++
    const item: UiToast = {
      id,
      title: String(input.title ?? ""),
      description: input.description,
      variant: input.variant ?? "default",
    }
    set({ toasts: [...get().toasts, item] })
    return id
  },
  dismissToast: (id) => {
    const next = get().toasts.filter((t) => t.id !== id)
    if (next.length !== get().toasts.length) set({ toasts: next })
  },
  clearToasts: () => {
    if (get().toasts.length) set({ toasts: [] })
  },
  closeTopmost: (): TopLayer => {
    const s = get()
    if (s.aiOpen) {
      set({ aiOpen: false })
      return "ai"
    }
    if (s.settingsTab !== null) {
      set({ settingsTab: null })
      return "settings"
    }
    if (s.gitOpen) {
      set({ gitOpen: false })
      return "git"
    }
    if (s.exportOpen) {
      set({ exportOpen: false })
      return "export"
    }
    if (s.docsOpen) {
      get().closeDocs()
      return "docs"
    }
    return null
  },
}))
