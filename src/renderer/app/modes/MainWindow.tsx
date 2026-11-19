/**
 * src/renderer/app/modes/MainWindow.tsx — Wave 2-G 主窗口（顶栏/侧栏/舞台/文档/入口组装）。
 *
 * - CSS Grid/Flex 布局；PC 文档为悬浮覆盖，不参与分栏挤压（§8.1 硬约束）。
 * - Esc 全局统一入口：MainWindow 的 window keydown 只调用一次 ui-store.closeTopmost()，
 *   栈空时兜底关闭最后登记的通用弹层（Dialog / Sheet / AlertDialog）；一次只关一层。
 *   组件自身不再监听 Esc，局部输入框/重命名/搜索仍以 stopPropagation 优先。
 * - 主窗挂载三弹层：AiDialog（居中 Dialog）、SettingsDialog（Dialog，settingsTab 透传）、
 *   GitPanel（居中 Dialog 承载，max-w-660px / 80vh）。导出不挂载：ExportMenu 自带 DropdownMenu + Trigger
 *   （data-testid="export-menu"），属顶栏 Dropdown 菜单内容，由顶栏挂载；
 *   主窗仅经 ui-store.exportOpen 系列状态参与 Esc 栈。
 * - 侧栏收起后不再挂载 MiniDock，左下角无悬浮入口。
 * - ui-store 通知队列经 ToastBridge 转交 sonner Toaster 展示。
 */

import { useEffect, useRef } from "react"
import { GitBranch } from "lucide-react"
import Topbar from "@/components/shell/Topbar"
import Sidebar from "@/components/shell/Sidebar"
import Stage from "@/components/shell/Stage"
import DocsPanelHost from "@/components/shell/DocsPanelHost"
import { Toaster, toast } from "@/components/ui/sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AiDialog } from "@/features/ai/AiDialog"
import { SettingsDialog, type SettingsTabId as DialogSettingsTabId } from "@/features/settings/SettingsDialog"
import { GitPanel } from "@/features/git/GitPanel"
import ProjectPicker from "@/features/projects/ProjectPicker"
import { useAppStore } from "@/stores/app-store"
import {
  useUiStore,
  closeTopmostOverlay,
  type SettingsTabId as UiSettingsTabId,
  type TopLayer,
} from "@/stores/ui-store"

type LayerKey = Exclude<TopLayer, null>

const LAYER_KEYS: LayerKey[] = ["ai", "settings", "git", "export", "docs"]

/**
 * 同一次 keydown 只决策一次（模块级；同一时刻只有一个主窗）。
 *
 * Esc 的唯一入口是下面 effect 里的 window keydown 监听：它只调用一次
 * closeTopmost()，一次只关最上面一层。DialogContent / SheetContent /
 * AlertDialogContent 不再各自在 document 上监听 Esc，因此不存在
 * 「document 先关一层、window 再关下一层」的竞态。
 *
 * 去重必须放在事件级而不是时间窗口：Chromium 会在每个事件监听器回调之间
 * 清空微任务队列，queueMicrotask / setTimeout 复位标志都会让同一次 keydown
 * 在后续监听器里重新变成「未处理」。这里用 Event 对象本身去重，同一次
 * keydown 只决策一次；新的 keydown 是新的 Event，连续按 Esc 可逐层关闭。
 *
 * 行内重命名 / 文档搜索 / 输入框等局部 Esc 在 target 上 stopPropagation，
 * 事件到不了 window，因此仍优先于全局栈。
 */
const handledEscEvents = new WeakSet<Event>()

function isLayerOpen(layer: LayerKey): boolean {
  const s = useUiStore.getState()
  switch (layer) {
    case "ai":
      return s.aiOpen
    case "settings":
      return s.settingsTab !== null
    case "git":
      return s.gitOpen
    case "export":
      return s.exportOpen
    case "docs":
      return s.docsOpen
  }
}

function snapshotLayers(): Record<LayerKey, boolean> {
  return {
    ai: isLayerOpen("ai"),
    settings: isLayerOpen("settings"),
    git: isLayerOpen("git"),
    export: isLayerOpen("export"),
    docs: isLayerOpen("docs"),
  }
}

/** Esc 关闭后把焦点还给打开该层的触发按钮（元素已卸载时静默跳过）。 */
function focusOpener(el: HTMLElement | null | undefined): void {
  if (!el || !el.isConnected || typeof el.focus !== "function") return
  el.focus({ preventScroll: true })
}

/**
 * ui-store settingsTab（agent/model/spec/sandbox/shortcut/about）与
 * SettingsDialog tab（agent/models/design/sandbox/shortcuts/about）的双向映射。
 * ui-store 口径已定稿不得改名，适配只做在本文件。
 */
const UI_TO_DIALOG_TAB: Record<UiSettingsTabId, DialogSettingsTabId> = {
  agent: "agent",
  model: "models",
  spec: "design",
  sandbox: "sandbox",
  shortcut: "shortcuts",
  about: "about",
}

const DIALOG_TO_UI_TAB: Record<DialogSettingsTabId, UiSettingsTabId> = {
  agent: "agent",
  models: "model",
  design: "spec",
  sandbox: "sandbox",
  shortcuts: "shortcut",
  about: "about",
}

function ToastBridge() {
  const forwarded = useRef(new Set<number>())
  useEffect(() => {
    return useUiStore.subscribe(() => {
      const { toasts, dismissToast } = useUiStore.getState()
      for (const item of toasts) {
        if (forwarded.current.has(item.id)) continue
        forwarded.current.add(item.id)
        toast(item.title, { description: item.description })
        dismissToast(item.id)
      }
    })
  }, [])
  return null
}

export default function MainWindow() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const kind = useAppStore((s) => s.kind)
  const project = useAppStore((s) => s.project)
  const aiOpen = useUiStore((s) => s.aiOpen)
  const closeAi = useUiStore((s) => s.closeAi)
  const settingsTab = useUiStore((s) => s.settingsTab)
  const openSettings = useUiStore((s) => s.openSettings)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const gitOpen = useUiStore((s) => s.gitOpen)
  const closeGit = useUiStore((s) => s.closeGit)
  const openersRef = useRef<Partial<Record<LayerKey, HTMLElement | null>>>({})
  const lastClickRef = useRef<HTMLElement | null>(null)

  // 程序化 click（e2e/脚本）不会给按钮聚焦；记录点击目标作为焦点回归兜底。
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target
      const clicked =
        target instanceof HTMLElement
          ? (target.closest<HTMLElement>("button, [role='button']") ?? target)
          : null
      lastClickRef.current = clicked
      // 本次点击所在任务结束后清除（不是微任务：不参与同一事件内监听器之间的时序），
      // 避免陈旧目标污染后续程序化打开。store 订阅在同一 click 任务内已消费该值。
      window.setTimeout(() => {
        if (lastClickRef.current === clicked) lastClickRef.current = null
      }, 0)
    }
    document.addEventListener("click", onClickCapture, true)
    return () => document.removeEventListener("click", onClickCapture, true)
  }, [])

  // 记录每层由哪个元素打开，Esc 关闭后把焦点还回去。
  useEffect(() => {
    let prev = snapshotLayers()
    return useUiStore.subscribe(() => {
      const next = snapshotLayers()
      for (const layer of LAYER_KEYS) {
        if (prev[layer] || !next[layer]) continue
        const active = document.activeElement
        const clicked = lastClickRef.current
        lastClickRef.current = null
        // 真实点击会聚焦按钮；程序化 click（e2e/DOM click）不会。优先用点击目标，
        // 保证「程序化打开 AI 时焦点仍在设置按钮」也能把焦点还给 AI 触发器。
        const candidate =
          clicked ?? (active instanceof HTMLElement && active !== document.body ? active : null)
        openersRef.current[layer] = candidate?.isConnected ? candidate : null
      }
      prev = next
    })
  }, [])

  useEffect(() => {
    // 唯一决策点：一次 keydown 只调用一次 closeTopmost()，只关最上面一层。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (handledEscEvents.has(e)) return
      handledEscEvents.add(e)
      const closed = useUiStore.getState().closeTopmost()
      if (closed) {
        e.preventDefault()
        e.stopPropagation()
        focusOpener(openersRef.current[closed])
        return
      }
      // ui-store 栈为空时，兜底关最后打开的通用弹层（Sheet / AlertDialog /
      // 不属于全局栈的 Dialog）。它们只登记关闭回调，不另外监听 Esc，
      // 因此仍然只有本监听一个决策点，一次只关一层。
      const overlay = closeTopmostOverlay()
      if (!overlay) return
      e.preventDefault()
      e.stopPropagation()
      focusOpener(overlay.opener)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div
      data-testid="main-window"
      className="flex h-screen w-full flex-col overflow-hidden bg-canvas text-foreground"
    >
      <Topbar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? <Sidebar /> : null}
        <main aria-label="工作区" className="flex min-h-0 min-w-0 flex-1">
          <Stage />
          {kind === "mobile" ? <DocsPanelHost /> : null}
        </main>
      </div>
      {kind === "pc" ? <DocsPanelHost /> : null}
      {/* AI：居中 Dialog（AiDialog 自带 Dialog 容器，props 为 open/onOpenChange）。 */}
      <AiDialog
        open={aiOpen}
        onOpenChange={(open) => {
          // X / 遮罩只关自身；Esc 由全局栈统一关闭（closeTopmost）。
          if (!open) closeAi()
        }}
      />
      {/* 设置：Dialog（settingsTab 透传，经双向映射适配两套 TabId 口径）。 */}
      <SettingsDialog
        open={settingsTab !== null}
        onOpenChange={(open) => {
          if (!open) closeSettings()
        }}
        tab={settingsTab === null ? undefined : UI_TO_DIALOG_TAB[settingsTab]}
        onTabChange={(tab) => openSettings(DIALOG_TO_UI_TAB[tab])}
      />
      {/* Git：居中 Dialog（660px × 80vh）；GitPanel 无 open/onClose，只接 project/branch/onChanged。 */}
      <Dialog
        open={gitOpen}
        onOpenChange={(open) => {
          if (!open) closeGit()
        }}
      >
        <DialogContent
          data-testid="git-sheet"
          data-surface="dialog"
          className="flex h-[80vh] max-w-[660px] flex-col gap-0 overflow-hidden p-0"
        >
          {/* data-testid 保留 git-sheet 以兼容既有 e2e 锚点；实际承载已改为居中 Dialog。 */}
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <GitBranch className="size-4 text-muted-foreground" aria-hidden />
              Git 协同
            </DialogTitle>
            <DialogDescription>分支、本地变更与远端同步</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <GitPanel project={project} />
          </div>
        </DialogContent>
      </Dialog>
      {/*
        导出不挂载：ExportMenu 自身即 DropdownMenu（含 Trigger + 菜单内容，
        props 为 sources/currentName/reqMap…，无 open/onOpenChange），属顶栏
        Dropdown，由顶栏挂载；主窗仅保留 ui-store.exportOpen 系列状态参与 Esc 栈。
      */}
      {/* 项目选择（W3-01）：冷启动无 protoLastProject 时出现；只由本组件负责启动数据。 */}
      <ProjectPicker />
      <ToastBridge />
      <Toaster />
    </div>
  )
}
