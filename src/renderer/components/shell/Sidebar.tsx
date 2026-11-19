/**
 * src/renderer/components/shell/Sidebar.tsx — W3-01 左侧真实三层树（文件夹/原型/子页）。
 *
 * 数据源（全部真实，无示例数据）：
 * - 原型/子页：`stores/sources-store`（sandbox:list 构造的 SourceRef）
 * - 文件夹：`app-store.readGroups(project)`（`protoGroups_v1__<project>`，含二级 parent）
 * - 折叠：`app-store.readFold/writeFold`（`protoGroupsFold_v1__<project>`）
 * - 排序：`protoOrder_v1` / `subPageOrder_v1`，由 sources-store 统一读写
 *
 * 拖拽状态机（HTML5 drag，三层各自独立）：
 * - group：before / after（同级排序）、inside（移入文件夹 / 成为子文件夹）
 * - proto：before / after（同组排序或跨组插入）、inside（拖到文件夹标题 = 移入该组）
 * - sub：before / after（仅同 sandboxDir 内排序）
 * - tail：拖到列表末尾 = 原型移出文件夹 / 文件夹移到根目录
 * 每种状态都有插入线或高亮反馈；松手后写入 protoOrder_v1 / subPageOrder_v1 / 分组键。
 *
 * 视觉约束：无计数；选中 = 纯白卡片 + 深墨（#18181b）左指示条；手柄仅在真实可拖时显示。
 * 键盘：手柄可聚焦，↑/↓ 调整同级顺序；右键菜单也可通过 ⋯ 按钮用键盘打开。
 *
 * 交互补充（P1 UI 复核）：
 * - 底部 Dock：主 CTA「AI 设计对话」+ 新建/导入原型 + 设置（Agent Tab）。
 * - 双击原型/文件夹行进入行内重命名：Enter 提交、Esc 取消、失焦提交（空名/同名则取消）；
 *   编辑期间临时关闭该行 drag，⋯/右键菜单入口保持不变。
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"
import {
  ChevronDown,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useAppStore, type GroupsData } from "@/stores/app-store"
import {
  protoGroupKey,
  useSourcesStore,
  type DropPosition,
  type ProtoOrderMap,
  type SourceKind,
  type SourceRef,
  type SourceSubPage,
  type SubPageOrderMap,
} from "@/stores/sources-store"
import {
  createProto,
  createSubPage,
  importProtoFromFile,
  removeProto,
  renameProto,
} from "@/features/projects/proto-actions"
import { useUiStore } from "@/stores/ui-store"
import { ORDER_KEY, SUB_ORDER_KEY, readJson } from "@/lib/storage-keys"
import { cn } from "@/lib/utils"

type GroupNode = GroupsData["list"][number]

type DragItem =
  | { kind: "group"; id: string; parent: string | null }
  | { kind: "proto"; key: string; gid: string }
  | { kind: "sub"; dir: string; file: string }

type DropPos = DropPosition | "inside"

type DropTarget =
  | { kind: "group"; id: string; pos: DropPos }
  | { kind: "group-body"; gid: string }
  | { kind: "proto"; key: string; gid: string; pos: DropPosition }
  | { kind: "sub"; dir: string; file: string; pos: DropPosition }
  | { kind: "tail" }

type MenuState =
  | { kind: "group"; id: string; name: string; parent: string | null; x: number; y: number }
  | { kind: "proto"; source: SourceRef; x: number; y: number }

type NameDialogState =
  | { kind: "folder-create"; parent: string | null }
  | { kind: "folder-rename"; id: string; initial: string }
  | { kind: "proto-rename"; dir: string; initial: string }
  | { kind: "sub-create"; dir: string; initial: string; sourceKind: SourceKind }

type ConfirmState =
  | { kind: "folder"; id: string; name: string }
  | { kind: "proto"; dir: string; name: string }

/** 双击行内重命名：只覆盖原型与文件夹（子页面暂无重命名 IPC）。 */
type InlineRenameState =
  | { kind: "proto"; dir: string; original: string }
  | { kind: "folder"; id: string; original: string }

function readProtoOrder(): ProtoOrderMap {
  const value = readJson(ORDER_KEY, null)
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as ProtoOrderMap
}

function readSubOrder(): SubPageOrderMap {
  const value = readJson(SUB_ORDER_KEY, null)
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as SubPageOrderMap
}

/**
 * 按持久化 key 顺序排列；缺失项按 zh-CN 名称补在末尾（旧 getOrderedProtos 同口径）。
 */
function orderedBy<T>(
  list: T[],
  stored: unknown,
  keyOf: (item: T) => string,
  labelOf: (item: T) => string
): T[] {
  const sorted = list
    .slice()
    .sort((a, b) => String(labelOf(a)).localeCompare(String(labelOf(b)), "zh-CN"))
  if (!Array.isArray(stored) || !stored.length) return sorted
  const byKey = new Map<string, T>()
  list.forEach((item) => byKey.set(keyOf(item), item))
  const out: T[] = []
  for (const key of stored) {
    if (typeof key !== "string") continue
    const item = byKey.get(key)
    if (item) {
      out.push(item)
      byKey.delete(key)
    }
  }
  const remain = Array.from(byKey.values()).sort((a, b) =>
    String(labelOf(a)).localeCompare(String(labelOf(b)), "zh-CN")
  )
  return out.concat(remain)
}

/** 文件夹 id 是否等于 ancestorId 或位于其后代链上。 */
function folderChainHas(list: GroupNode[], groupId: string, ancestorId: string): boolean {
  let cursor: string | null = groupId
  const guard = new Set<string>()
  while (cursor) {
    if (cursor === ancestorId) return true
    if (guard.has(cursor)) return false
    guard.add(cursor)
    cursor = list.find((group) => group.id === cursor)?.parent || null
  }
  return false
}

function toastError(title: string, description?: string): void {
  useUiStore.getState().pushToast({ title, description, variant: "destructive" })
}

function toastInfo(title: string, description?: string): void {
  useUiStore.getState().pushToast({ title, description })
}

function rowPosition(e: DragEvent, allowInside: boolean): DropPos {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const y = e.clientY - rect.top
  if (allowInside) {
    if (y < rect.height * 0.3) return "before"
    if (y > rect.height * 0.7) return "after"
    return "inside"
  }
  return y < rect.height / 2 ? "before" : "after"
}

function menuPoint(e: ReactMouseEvent<HTMLElement>): { x: number; y: number } {
  const rect = e.currentTarget.getBoundingClientRect()
  // 右键菜单用指针坐标；键盘触发的 click（detail=0）用元素右下角。
  const keyboard = e.detail === 0 && e.type !== "contextmenu"
  const x = keyboard ? rect.right : e.clientX
  const y = keyboard ? rect.bottom : e.clientY
  const width = window.innerWidth || 1280
  const height = window.innerHeight || 800
  return {
    x: Math.max(8, Math.min(x, width - 200)),
    y: Math.max(8, Math.min(y, height - 180)),
  }
}

function DragGrip({
  label,
  grabbed,
  onKeyDown,
}: {
  label: string
  grabbed: boolean
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-grabbed={grabbed}
      title={`${label}（聚焦后按 ↑ / ↓ 移动）`}
      className="mr-0.5 inline-flex shrink-0 cursor-grab items-center rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#18181b]/30 group-hover:opacity-100 active:cursor-grabbing"
      onKeyDown={onKeyDown}
      onClick={(e) => e.preventDefault()}
    >
      <GripVertical aria-hidden="true" className="size-3.5" />
    </button>
  )
}

function DropLine({ position }: { position: DropPosition }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-2 right-2 z-10 h-[2px] rounded-full bg-[#18181b]",
        position === "before" ? "-top-px" : "-bottom-px"
      )}
    />
  )
}

function MenuItem({
  icon,
  children,
  danger,
  autoFocus,
  onSelect,
}: {
  icon: ReactNode
  children: ReactNode
  danger?: boolean
  autoFocus?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      autoFocus={autoFocus}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent",
        danger ? "text-destructive" : "text-foreground"
      )}
    >
      <span aria-hidden="true" className="inline-flex size-3.5 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

const selectedCardClass = "bg-white text-foreground shadow-sm"

export default function Sidebar() {
  const sources = useSourcesStore((s) => s.sources)
  const currentSource = useSourcesStore((s) => s.currentSource)
  const project = useSourcesStore((s) => s.project)
  const loading = useSourcesStore((s) => s.loading)
  const error = useSourcesStore((s) => s.error)
  const activeSubFile = useSourcesStore((s) => s.activeSubFile)
  const selectSource = useSourcesStore((s) => s.selectSource)
  const selectSubPage = useSourcesStore((s) => s.selectSubPage)
  const openProjectPicker = useSourcesStore((s) => s.openProjectPicker)
  const orderRevision = useSourcesStore((s) => s.orderRevision)
  const folderRevision = useSourcesStore((s) => s.folderRevision)
  const reorderProto = useSourcesStore((s) => s.reorderProto)
  const moveProtoToGroup = useSourcesStore((s) => s.moveProtoToGroup)
  const reorderSubPage = useSourcesStore((s) => s.reorderSubPage)
  const createFolder = useSourcesStore((s) => s.createFolder)
  const renameFolder = useSourcesStore((s) => s.renameFolder)
  const removeFolder = useSourcesStore((s) => s.removeFolder)
  const moveFolder = useSourcesStore((s) => s.moveFolder)

  const readGroups = useAppStore((s) => s.readGroups)
  const readFold = useAppStore((s) => s.readFold)
  const writeFold = useAppStore((s) => s.writeFold)

  const openAi = useUiStore((s) => s.openAi)
  const openSettings = useUiStore((s) => s.openSettings)

  // folderRevision 是 localStorage 的失效信号（不是读取函数的参数）。
  const groups = useMemo(
    () => readGroups(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readGroups, project, folderRevision]
  )
  // 不把 localStorage 数据拷进 effect：状态自带 project 作用域，切项目时自动回退到持久化值。
  const [foldState, setFoldState] = useState<{ project: string; fold: Record<string, boolean> }>(
    () => ({ project, fold: readFold(project) })
  )
  const fold = foldState.project === project ? foldState.fold : readFold(project)
  const [subFoldState, setSubFoldState] = useState<{
    project: string
    map: Record<string, boolean>
  }>(() => ({ project, map: {} }))
  const subFold = subFoldState.project === project ? subFoldState.map : {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const protoOrder = useMemo(() => readProtoOrder(), [project, orderRevision])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const subOrder = useMemo(() => readSubOrder(), [project, orderRevision])

  const dragRef = useRef<DragItem | null>(null)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [dragStatus, setDragStatus] = useState("")

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newKind, setNewKind] = useState<SourceKind>("pc")
  const [busy, setBusy] = useState(false)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [nameValue, setNameValue] = useState("")
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  const [inlineRename, setInlineRename] = useState<InlineRenameState | null>(null)
  const [inlineValue, setInlineValue] = useState("")
  const inlineDoneRef = useRef(false)

  const groupIds = useMemo(() => new Set(groups.list.map((g) => g.id)), [groups])

  function groupIdOf(source: SourceRef): string {
    const gid = String(groups.map[protoGroupKey(source)] || "")
    return gid && groupIds.has(gid) ? gid : ""
  }

  function sourcesOfGroup(gid: string): SourceRef[] {
    return gid ? grouped.byGroup[gid] || [] : grouped.ungrouped
  }

  function orderedProtos(list: SourceRef[], gid: string): SourceRef[] {
    const stored = protoOrder[project]?.[gid || "ungrouped"]
    return orderedBy(list, stored, protoGroupKey, (s) => s.displayName || s.name)
  }

  function orderedSubPages(source: SourceRef): SourceSubPage[] {
    const stored = subOrder[source.sandboxDir]
    return orderedBy(
      source.subPages,
      stored,
      (sp) => sp.file,
      (sp) => sp.name || sp.file
    )
  }

  const grouped = useMemo(() => {
    const byGroup: Record<string, SourceRef[]> = {}
    const ungrouped: SourceRef[] = []
    for (const source of sources) {
      const gid = groupIdOf(source)
      if (gid) {
        ;(byGroup[gid] = byGroup[gid] || []).push(source)
      } else {
        ungrouped.push(source)
      }
    }
    return { ungrouped, byGroup }
    // groupIdOf 的输入（groups/groupIds）已在依赖中；此处只做纯分组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, groups, groupIds])

  const rootGroups = useMemo(
    () => groups.list.filter((g) => !g.parent || !groupIds.has(String(g.parent))),
    [groups, groupIds]
  )

  useEffect(() => {
    if (!menu) return
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [menu])

  function toggleGroup(id: string): void {
    const next = { ...fold, [id]: !fold[id] }
    setFoldState({ project, fold: next })
    writeFold(next, project)
  }

  function toggleSubFold(dir: string): void {
    const base = subFoldState.project === project ? subFoldState.map : {}
    setSubFoldState({ project, map: { ...base, [dir]: !base[dir] } })
  }

  function beginDrag(item: DragItem, e: DragEvent, label: string, text: string): void {
    dragRef.current = item
    setDrag(item)
    setDropTarget(null)
    setDragStatus(`正在拖动「${label}」`)
    try {
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", text)
    } catch {
      // DataTransfer 不可用时仅依赖内存 dragRef。
    }
  }

  function endDrag(): void {
    dragRef.current = null
    setDrag(null)
    setDropTarget(null)
  }

  function announce(text: string): void {
    setDragStatus(text)
  }

  function onGroupDragStart(e: DragEvent, group: GroupNode): void {
    beginDrag(
      { kind: "group", id: group.id, parent: group.parent || null },
      e,
      group.name,
      group.name
    )
  }

  function onGroupDragOver(e: DragEvent<HTMLDivElement>, group: GroupNode): void {
    const item = dragRef.current
    if (!item || item.kind === "sub") return
    if (item.kind === "group" && folderChainHas(groups.list, group.id, item.id)) {
      setDropTarget(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    try {
      e.dataTransfer.dropEffect = "move"
    } catch {
      // 忽略。
    }
    // 原型拖到文件夹标题：整块都是“移入”，避免误以为能重排文件夹。
    const pos: DropPos = item.kind === "proto" ? "inside" : rowPosition(e, true)
    setDropTarget({ kind: "group", id: group.id, pos })
  }

  function onGroupDrop(e: DragEvent<HTMLDivElement>, group: GroupNode): void {
    const item = dragRef.current
    const target = dropTarget
    if (!item || item.kind === "sub") return
    if (!target || target.kind !== "group" || target.id !== group.id) return
    e.preventDefault()
    e.stopPropagation()
    endDrag()

    if (item.kind === "proto") {
      if (moveProtoToGroup(item.key, group.id)) {
        announce(`已移入文件夹「${group.name}」`)
      }
      return
    }
    if (group.id === item.id || folderChainHas(groups.list, group.id, item.id)) return
    if (target.pos === "inside") {
      if (moveFolder(item.id, group.id).ok) announce(`已移入文件夹「${group.name}」`)
      return
    }
    const parent = group.parent || null
    const siblings = groups.list.filter((g) => (g.parent || null) === parent)
    const index = siblings.findIndex((g) => g.id === group.id)
    const beforeId =
      target.pos === "before" ? group.id : siblings[index + 1]?.id || null
    if (moveFolder(item.id, parent, beforeId).ok) announce(`已调整文件夹「${group.name}」顺序`)
  }

  function onGroupBodyDragOver(e: DragEvent<HTMLDivElement>, group: GroupNode): void {
    const item = dragRef.current
    if (!item || item.kind === "sub") return
    if (item.kind === "group" && folderChainHas(groups.list, group.id, item.id)) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget({ kind: "group-body", gid: group.id })
  }

  function onGroupBodyDrop(e: DragEvent<HTMLDivElement>, group: GroupNode): void {
    const item = dragRef.current
    const target = dropTarget
    if (!item || item.kind === "sub") return
    if (!target || target.kind !== "group-body" || target.gid !== group.id) return
    e.preventDefault()
    e.stopPropagation()
    endDrag()
    if (item.kind === "proto") {
      if (moveProtoToGroup(item.key, group.id)) announce(`已移入文件夹「${group.name}」`)
      return
    }
    if (group.id === item.id || folderChainHas(groups.list, group.id, item.id)) return
    if (moveFolder(item.id, group.id).ok) announce(`已移入文件夹「${group.name}」`)
  }

  function onProtoDragStart(e: DragEvent, source: SourceRef): void {
    beginDrag(
      { kind: "proto", key: protoGroupKey(source), gid: groupIdOf(source) },
      e,
      source.displayName,
      protoGroupKey(source)
    )
  }

  function onProtoDragOver(e: DragEvent<HTMLDivElement>, source: SourceRef): void {
    const item = dragRef.current
    if (!item || item.kind !== "proto") return
    const key = protoGroupKey(source)
    if (item.key === key) {
      setDropTarget(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    try {
      e.dataTransfer.dropEffect = "move"
    } catch {
      // 忽略。
    }
    setDropTarget({
      kind: "proto",
      key,
      gid: groupIdOf(source),
      pos: rowPosition(e, false) as DropPosition,
    })
  }

  function onProtoDrop(e: DragEvent<HTMLDivElement>, source: SourceRef): void {
    const item = dragRef.current
    const target = dropTarget
    if (!item || item.kind !== "proto") return
    if (!target || target.kind !== "proto" || target.key !== protoGroupKey(source)) return
    e.preventDefault()
    e.stopPropagation()
    const targetGid = groupIdOf(source)
    const targetKey = protoGroupKey(source)
    const pos = target.pos
    endDrag()
    if (item.key === targetKey) return

    if (item.gid === targetGid) {
      if (reorderProto(targetGid, item.key, targetKey, pos)) {
        announce(`已调整「${source.displayName}」顺序`)
      }
      return
    }

    const list = orderedProtos(sourcesOfGroup(targetGid), targetGid)
    const index = list.findIndex((s) => protoGroupKey(s) === targetKey)
    const beforeKey =
      pos === "before" ? targetKey : list[index + 1] ? protoGroupKey(list[index + 1]) : null
    if (moveProtoToGroup(item.key, targetGid, beforeKey)) {
      const name = targetGid
        ? groups.list.find((g) => g.id === targetGid)?.name || "文件夹"
        : "未分组"
      announce(`已移动到「${name}」`)
    }
  }

  function onSubDragStart(e: DragEvent, source: SourceRef, sub: SourceSubPage): void {
    beginDrag(
      { kind: "sub", dir: source.sandboxDir, file: sub.file },
      e,
      sub.name || sub.file,
      sub.file
    )
  }

  function onSubDragOver(
    e: DragEvent<HTMLDivElement>,
    source: SourceRef,
    sub: SourceSubPage
  ): void {
    const item = dragRef.current
    if (!item || item.kind !== "sub") return
    if (item.dir !== source.sandboxDir || item.file === sub.file) {
      setDropTarget(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    try {
      e.dataTransfer.dropEffect = "move"
    } catch {
      // 忽略。
    }
    setDropTarget({
      kind: "sub",
      dir: source.sandboxDir,
      file: sub.file,
      pos: rowPosition(e, false) as DropPosition,
    })
  }

  function onSubDrop(
    e: DragEvent<HTMLDivElement>,
    source: SourceRef,
    sub: SourceSubPage
  ): void {
    const item = dragRef.current
    const target = dropTarget
    if (!item || item.kind !== "sub") return
    if (!target || target.kind !== "sub" || target.file !== sub.file) return
    if (item.dir !== source.sandboxDir) return
    e.preventDefault()
    e.stopPropagation()
    const pos = target.pos
    endDrag()
    if (item.file === sub.file) return
    if (reorderSubPage(source.sandboxDir, item.file, sub.file, pos)) {
      announce(`已调整子页面「${sub.name || sub.file}」顺序`)
    }
  }

  function onTailDragOver(e: DragEvent<HTMLDivElement>): void {
    const item = dragRef.current
    if (!item || item.kind === "sub") return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget({ kind: "tail" })
  }

  function onTailDrop(e: DragEvent<HTMLDivElement>): void {
    const item = dragRef.current
    const target = dropTarget
    if (!item || item.kind === "sub") return
    if (!target || target.kind !== "tail") return
    e.preventDefault()
    e.stopPropagation()
    endDrag()
    if (item.kind === "group") {
      if (moveFolder(item.id, null, null).ok) announce("已移到根目录")
      return
    }
    if (moveProtoToGroup(item.key, "")) announce("已移到未分组")
  }

  function onGroupGripKey(
    e: ReactKeyboardEvent<HTMLButtonElement>,
    group: GroupNode
  ): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    e.stopPropagation()
    const parent = group.parent || null
    const siblings = groups.list.filter((g) => (g.parent || null) === parent)
    const index = siblings.findIndex((g) => g.id === group.id)
    if (index < 0) return
    if (e.key === "ArrowUp") {
      if (index === 0) return
      if (moveFolder(group.id, parent, siblings[index - 1].id).ok) {
        announce(`已上移文件夹「${group.name}」`)
      }
      return
    }
    if (index >= siblings.length - 1) return
    const afterNext = siblings[index + 2]?.id || null
    if (moveFolder(group.id, parent, afterNext).ok) {
      announce(`已下移文件夹「${group.name}」`)
    }
  }

  function onProtoGripKey(e: ReactKeyboardEvent<HTMLButtonElement>, source: SourceRef): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    e.stopPropagation()
    const gid = groupIdOf(source)
    const list = orderedProtos(sourcesOfGroup(gid), gid)
    const key = protoGroupKey(source)
    const index = list.findIndex((s) => protoGroupKey(s) === key)
    if (index < 0) return
    const next = list[index + (e.key === "ArrowUp" ? -1 : 1)]
    if (!next) return
    const position: DropPosition = e.key === "ArrowUp" ? "before" : "after"
    if (reorderProto(gid, key, protoGroupKey(next), position)) {
      announce(`已${e.key === "ArrowUp" ? "上移" : "下移"}「${source.displayName}」`)
    }
  }

  function onSubGripKey(
    e: ReactKeyboardEvent<HTMLButtonElement>,
    source: SourceRef,
    sub: SourceSubPage
  ): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    e.stopPropagation()
    const list = orderedSubPages(source)
    const index = list.findIndex((item) => item.file === sub.file)
    if (index < 0) return
    const next = list[index + (e.key === "ArrowUp" ? -1 : 1)]
    if (!next) return
    if (
      reorderSubPage(
        source.sandboxDir,
        sub.file,
        next.file,
        e.key === "ArrowUp" ? "before" : "after"
      )
    ) {
      announce(`已${e.key === "ArrowUp" ? "上移" : "下移"}子页面「${sub.name || sub.file}」`)
    }
  }

  function openGroupMenu(e: ReactMouseEvent<HTMLElement>, group: GroupNode): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      kind: "group",
      id: group.id,
      name: group.name,
      parent: group.parent || null,
      ...menuPoint(e),
    })
  }

  function openProtoMenu(e: ReactMouseEvent<HTMLElement>, source: SourceRef): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ kind: "proto", source, ...menuPoint(e) })
  }

  function openNameDialog(next: NameDialogState, initial = ""): void {
    setNameDialog(next)
    setNameValue(initial)
  }

  /**
   * 进入行内重命名。input 由 autoFocus 聚焦并全选；
   * Enter 提交、Esc 取消、失焦提交（与原名称相同或为空则静默取消）。
   */
  function startInlineRename(next: InlineRenameState): void {
    if (busy) return
    inlineDoneRef.current = false
    setInlineRename(next)
    setInlineValue(next.original)
  }

  function cancelInlineRename(): void {
    inlineDoneRef.current = true
    setInlineRename(null)
    setInlineValue("")
  }

  async function commitInlineRename(): Promise<void> {
    if (inlineDoneRef.current) return
    const pending = inlineRename
    if (!pending) return
    // 先上锁再清 UI：Enter 触发的提交会卸载 input，避免 blur 再提交一次。
    inlineDoneRef.current = true
    const next = inlineValue.trim()
    setInlineRename(null)
    setInlineValue("")
    if (!next || next === pending.original) return
    const result =
      pending.kind === "folder"
        ? renameFolder(pending.id, next)
        : await renameProto(pending.dir, next)
    if (!result.ok) {
      toastError("重命名失败", result.error)
      return
    }
    toastInfo(pending.kind === "folder" ? "已重命名文件夹" : "已重命名原型", result.name)
  }

  function inlineRenameInput(label: string): ReactNode {
    return (
      <Input
        autoFocus
        className="h-7 min-w-0 flex-1 rounded-md bg-background px-2 text-xs"
        value={inlineValue}
        aria-label={label}
        title="Enter 提交，Esc 取消；失焦提交"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setInlineValue(e.target.value)}
        onBlur={() => void commitInlineRename()}
        onKeyDown={(e) => {
          // Esc 不能冒泡到 MainWindow 的浮层栈。
          e.stopPropagation()
          if (e.key === "Enter") {
            e.preventDefault()
            void commitInlineRename()
            return
          }
          if (e.key === "Escape") {
            e.preventDefault()
            cancelInlineRename()
          }
        }}
      />
    )
  }

  async function handleCreate(): Promise<void> {
    if (busy) return
    const name = newName.trim()
    if (!name) {
      toastError("请输入原型名称")
      return
    }
    setBusy(true)
    const r = await createProto({ name, kind: newKind })
    setBusy(false)
    if (!r.ok) {
      toastError("新建原型失败", r.error)
      return
    }
    setCreateOpen(false)
    setNewName("")
    toastInfo("已新建原型", r.name)
  }

  async function handleImport(): Promise<void> {
    if (busy) return
    setBusy(true)
    const r = await importProtoFromFile()
    setBusy(false)
    if (!r.ok) {
      if (!r.cancelled) toastError("导入原型失败", r.error)
      return
    }
    toastInfo(
      "已导入原型",
      r.created && r.created.length > 1 ? `共 ${r.created.length} 个` : r.name
    )
  }

  async function handleNameSubmit(): Promise<void> {
    if (busy || !nameDialog) return
    const name = nameValue.trim()
    if (!name) {
      toastError(nameDialog.kind === "sub-create" ? "请输入子页面名称" : "请输入名称")
      return
    }
    setBusy(true)
    let result: { ok: boolean; error?: string; name?: string }
    switch (nameDialog.kind) {
      case "folder-create":
        result = createFolder(name, nameDialog.parent)
        break
      case "folder-rename":
        result = renameFolder(nameDialog.id, name)
        break
      case "proto-rename":
        result = await renameProto(nameDialog.dir, name)
        break
      case "sub-create":
        result = await createSubPage(nameDialog.dir, name, nameDialog.sourceKind)
        break
    }
    setBusy(false)
    if (!result.ok) {
      // 子页创建失败（重名/非法名/IO）要能一眼分清是哪个操作；失败时不刷新列表。
      const failTitle = nameDialog.kind === "sub-create" ? "新建子页面失败" : "操作失败"
      toastError(failTitle, result.error)
      return
    }
    const title =
      nameDialog.kind === "folder-create"
        ? "已新建文件夹"
        : nameDialog.kind === "folder-rename"
          ? "已重命名文件夹"
          : nameDialog.kind === "proto-rename"
            ? "已重命名原型"
            : "已新建子页面"
    setNameDialog(null)
    setNameValue("")
    toastInfo(title, result.name)
  }

  async function handleConfirmDelete(): Promise<void> {
    if (busy || !confirmState) return
    setBusy(true)
    const result =
      confirmState.kind === "folder"
        ? removeFolder(confirmState.id)
        : await removeProto(confirmState.dir)
    setBusy(false)
    if (!result.ok) {
      toastError("删除失败", result.error)
      return
    }
    const title = confirmState.kind === "folder" ? "已删除文件夹" : "已删除原型"
    const name = confirmState.name
    setConfirmState(null)
    toastInfo(title, name)
  }

  function renderSubPage(source: SourceRef, sub: SourceSubPage): ReactNode {
    const isSelected =
      !!currentSource && currentSource.sandboxDir === source.sandboxDir && activeSubFile === sub.file
    const canDrag = source.subPages.length > 1
    const drop =
      dropTarget?.kind === "sub" &&
      dropTarget.dir === source.sandboxDir &&
      dropTarget.file === sub.file
        ? dropTarget
        : null
    const dragging =
      !!drag && drag.kind === "sub" && drag.dir === source.sandboxDir && drag.file === sub.file
    return (
      <div
        key={sub.file}
        className={cn(
          "group relative flex items-center rounded-md",
          isSelected ? selectedCardClass : "hover:bg-accent",
          dragging && "opacity-45"
        )}
        data-selected={isSelected ? "true" : "false"}
        data-dragging={dragging ? "true" : "false"}
        draggable={canDrag}
        onDragStart={(e) => {
          if (canDrag) onSubDragStart(e, source, sub)
        }}
        onDragOver={(e) => onSubDragOver(e, source, sub)}
        onDrop={(e) => onSubDrop(e, source, sub)}
        onDragEnd={endDrag}
      >
        {isSelected ? (
          <span
            aria-hidden="true"
            className="absolute bottom-1 left-1 top-1 w-[3px] rounded-full bg-[#18181b]"
          />
        ) : null}
        {drop ? <DropLine position={drop.pos} /> : null}
        <button
          type="button"
          data-level="subpage"
          aria-current={isSelected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-4 pr-1 text-left text-xs text-muted-foreground hover:text-foreground"
          onClick={() => void selectSubPage(sub.file)}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              isSelected ? "bg-[#18181b]" : "bg-muted-foreground/50"
            )}
          />
          <span className="min-w-0 flex-1 truncate">{sub.name || sub.file}</span>
        </button>
        {canDrag ? (
          <DragGrip
            label={`拖拽排序子页面「${sub.name || sub.file}」`}
            grabbed={dragging}
            onKeyDown={(e) => onSubGripKey(e, source, sub)}
          />
        ) : null}
      </div>
    )
  }

  function renderProto(source: SourceRef): ReactNode {
    const hasSub = source.subPages.length > 0
    const mainFile = source.mainHtmlFile || source.name
    const isCurrent = !!currentSource && currentSource.sandboxDir === source.sandboxDir
    const isMainActive =
      isCurrent && (!activeSubFile || activeSubFile === mainFile || activeSubFile === source.name)
    const folded = !!subFold[source.sandboxDir]
    const key = protoGroupKey(source)
    const gid = groupIdOf(source)
    const canDrag = !!project
    const dragging = !!drag && drag.kind === "proto" && drag.key === key
    const editing = inlineRename?.kind === "proto" && inlineRename.dir === source.sandboxDir
    const drop =
      dropTarget?.kind === "proto" && dropTarget.key === key && dropTarget.gid === gid
        ? dropTarget
        : null
    return (
      <div key={source.sandboxDir || source.name} className="flex flex-col gap-px">
        <div
          className={cn(
            "group relative flex items-center rounded-md",
            isMainActive ? selectedCardClass : "hover:bg-accent",
            dragging && "opacity-45"
          )}
          data-selected={isMainActive ? "true" : "false"}
          data-key={key}
          data-sandbox-dir={source.sandboxDir}
          data-dragging={dragging ? "true" : "false"}
          draggable={canDrag && !editing}
          onDragStart={(e) => {
            if (canDrag && !editing) onProtoDragStart(e, source)
          }}
          onDragOver={(e) => onProtoDragOver(e, source)}
          onDrop={(e) => onProtoDrop(e, source)}
          onDragEnd={endDrag}
          onContextMenu={(e) => openProtoMenu(e, source)}
        >
          {isMainActive ? (
            <span
              aria-hidden="true"
              className="absolute bottom-1 left-1 top-1 w-[3px] rounded-full bg-[#18181b]"
            />
          ) : null}
          {drop ? <DropLine position={drop.pos} /> : null}
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pl-3 pr-1">
              <FileText aria-hidden="true" className="size-3.5 shrink-0" />
              {inlineRenameInput(`重命名原型「${source.displayName}」`)}
            </div>
          ) : (
            <button
              type="button"
              data-level="proto"
              aria-current={isMainActive ? "true" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-3 pr-1 text-left text-xs",
                isMainActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => selectSource(source.name)}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                startInlineRename({
                  kind: "proto",
                  dir: source.sandboxDir,
                  original: source.displayName,
                })
              }}
              title={`查看该原型主页（${source.kind === "pc" ? "PC 端" : "移动端"}）；双击重命名`}
            >
              <FileText aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{source.displayName}</span>
            </button>
          )}
          {hasSub && !editing ? (
            <button
              type="button"
              aria-label={folded ? "展开子页面" : "收起子页面"}
              title={folded ? "展开子页面" : "收起子页面"}
              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
              onClick={() => toggleSubFold(source.sandboxDir)}
            >
              <ChevronDown className={cn("size-3 transition-transform", folded && "-rotate-90")} />
            </button>
          ) : null}
          {editing ? null : (
            <button
              type="button"
              aria-label={`原型「${source.displayName}」更多操作`}
              title="更多操作"
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              onClick={(e) => openProtoMenu(e, source)}
            >
              <MoreHorizontal aria-hidden="true" className="size-3.5" />
            </button>
          )}
          {canDrag && !editing ? (
            <DragGrip
              label={`拖拽排序原型「${source.displayName}」（可跨文件夹）`}
              grabbed={dragging}
              onKeyDown={(e) => onProtoGripKey(e, source)}
            />
          ) : null}
        </div>
        {hasSub && !folded ? (
          <div className="ml-3 flex flex-col gap-px border-l border-border pl-1">
            {orderedSubPages(source).map((sub) => renderSubPage(source, sub))}
          </div>
        ) : null}
      </div>
    )
  }

  function renderGroup(group: GroupNode): ReactNode {
    const folded = !!fold[group.id]
    const children = groups.list.filter((g) => String(g.parent || "") === group.id)
    const protos = grouped.byGroup[group.id] || []
    const canDrag = !!project
    const dragging = !!drag && drag.kind === "group" && drag.id === group.id
    const editing = inlineRename?.kind === "folder" && inlineRename.id === group.id
    const drop =
      dropTarget?.kind === "group" && dropTarget.id === group.id ? dropTarget : null
    const inside = drop?.pos === "inside"
    const bodyActive = dropTarget?.kind === "group-body" && dropTarget.gid === group.id
    return (
      <div key={group.id} className="flex flex-col gap-px">
        <div
          className={cn(
            "group relative flex items-center rounded-md hover:bg-accent",
            inside && "bg-accent ring-1 ring-inset ring-[#18181b]/35",
            dragging && "opacity-45"
          )}
          data-level="group-row"
          data-group-id={group.id}
          data-dragging={dragging ? "true" : "false"}
          draggable={canDrag && !editing}
          onDragStart={(e) => {
            if (canDrag && !editing) onGroupDragStart(e, group)
          }}
          onDragOver={(e) => onGroupDragOver(e, group)}
          onDrop={(e) => onGroupDrop(e, group)}
          onDragEnd={endDrag}
          onContextMenu={(e) => openGroupMenu(e, group)}
        >
          {drop && drop.pos !== "inside" ? (
            <DropLine position={drop.pos as DropPosition} />
          ) : null}
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-0.5">
              <ChevronDown
                aria-hidden="true"
                className={cn("size-3 shrink-0 transition-transform", folded && "-rotate-90")}
              />
              <Folder aria-hidden="true" className="size-3.5 shrink-0" />
              {inlineRenameInput(`重命名文件夹「${group.name}」`)}
            </div>
          ) : (
            <button
              type="button"
              data-level="group"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={!folded}
              onClick={() => toggleGroup(group.id)}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                startInlineRename({ kind: "folder", id: group.id, original: group.name })
              }}
              title="点击展开/收起文件夹；双击重命名"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn("size-3 shrink-0 transition-transform", folded && "-rotate-90")}
              />
              <Folder aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
            </button>
          )}
          {editing ? null : (
            <button
              type="button"
              aria-label={`文件夹「${group.name}」更多操作`}
              title="更多操作"
              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              onClick={(e) => openGroupMenu(e, group)}
            >
              <MoreHorizontal aria-hidden="true" className="size-3.5" />
            </button>
          )}
          {canDrag && !editing ? (
            <DragGrip
              label={`拖拽排序文件夹「${group.name}」（可拖入其他文件夹）`}
              grabbed={dragging}
              onKeyDown={(e) => onGroupGripKey(e, group)}
            />
          ) : null}
        </div>
        {folded ? null : (
          <div
            className={cn(
              "flex flex-col gap-px rounded-md pl-2",
              bodyActive && "bg-accent/60 ring-1 ring-inset ring-[#18181b]/25"
            )}
            onDragOver={(e) => onGroupBodyDragOver(e, group)}
            onDrop={(e) => onGroupBodyDrop(e, group)}
          >
            {orderedProtos(protos, group.id).map((source) => renderProto(source))}
            {children.map((child) => renderGroup(child))}
            {!protos.length && !children.length ? (
              <div className="px-2 py-1 text-[11px] text-muted-foreground/70">
                空文件夹 · 可拖入原型
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  const nameDialogTitle =
    nameDialog?.kind === "folder-create"
      ? "新建文件夹"
      : nameDialog?.kind === "folder-rename"
        ? "重命名文件夹"
        : nameDialog?.kind === "proto-rename"
          ? "重命名原型"
          : "新建子页面"

  return (
    <aside
      data-testid="sidebar"
      aria-label="原型列表"
      className="flex h-full shrink-0 flex-col border-r border-border bg-chrome"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1 pt-2.5">
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">原型</span>
        <button
          type="button"
          onClick={openProjectPicker}
          title="切换项目"
          className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-right text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {project || "未选择项目"}
        </button>
        <button
          type="button"
          aria-label="新建文件夹"
          title="新建文件夹"
          disabled={!project}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          onClick={() => openNameDialog({ kind: "folder-create", parent: null })}
        >
          <FolderPlus aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className="flex flex-col gap-0.5 p-2 pt-1"
          data-testid="sidebar-tree"
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null
            if (!next || !e.currentTarget.contains(next)) setDropTarget(null)
          }}
        >
          {error ? (
            <p className="px-2 py-2 text-[11px] leading-relaxed text-destructive">{error}</p>
          ) : null}
          {loading && !sources.length ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">正在加载原型…</p>
          ) : null}
          {!loading && !sources.length && !groups.list.length ? (
            <div className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
              {project ? (
                <>
                  暂无原型
                  <br />
                  点击下方「新建原型」或「导入原型」添加
                </>
              ) : (
                <>请先选择项目</>
              )}
            </div>
          ) : null}
          {grouped.ungrouped.length
            ? orderedProtos(grouped.ungrouped, "").map((source) => renderProto(source))
            : null}
          {rootGroups.map((group) => renderGroup(group))}
          {drag && drag.kind !== "sub" ? (
            <div
              onDragOver={onTailDragOver}
              onDrop={onTailDrop}
              className={cn(
                "mt-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground",
                dropTarget?.kind === "tail" && "border-[#18181b]/40 bg-accent text-foreground"
              )}
            >
              {drag.kind === "group" ? "拖到此处移到根目录" : "拖到此处移到未分组"}
            </div>
          ) : null}
          <span className="sr-only" role="status" aria-live="polite">
            {dragStatus}
          </span>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-border p-2">
        <Button
          className="mb-1.5 w-full justify-center shadow-sm"
          onClick={openAi}
          title="打开 AI 设计对话"
        >
          <Sparkles aria-hidden="true" />
          AI 设计对话
        </Button>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 justify-start"
            disabled={!project || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus aria-hidden="true" />
            新建原型
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 justify-start"
            disabled={!project || busy}
            onClick={() => void handleImport()}
          >
            <Upload aria-hidden="true" />
            导入原型
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-[26px] w-7 shrink-0 px-0"
            aria-label="打开设置"
            title="系统设置（Agent）"
            onClick={() => openSettings("agent")}
          >
            <Settings aria-hidden="true" />
          </Button>
        </div>
      </div>

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={
            menu.kind === "group"
              ? `文件夹「${menu.name}」操作`
              : `原型「${menu.source.displayName}」操作`
          }
          className="fixed z-[70] min-w-44 rounded-lg border border-border bg-popover p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.kind === "group" ? (
            <>
              <MenuItem
                autoFocus
                icon={<FolderPlus />}
                onSelect={() => {
                  const parent = menu.id
                  setMenu(null)
                  openNameDialog({ kind: "folder-create", parent })
                }}
              >
                新建子文件夹
              </MenuItem>
              <MenuItem
                icon={<Pencil />}
                onSelect={() => {
                  const id = menu.id
                  const initial = menu.name
                  setMenu(null)
                  openNameDialog({ kind: "folder-rename", id, initial }, initial)
                }}
              >
                重命名
              </MenuItem>
              <div className="my-1 h-px bg-border" aria-hidden="true" />
              <MenuItem
                danger
                icon={<Trash2 />}
                onSelect={() => {
                  const id = menu.id
                  const name = menu.name
                  setMenu(null)
                  setConfirmState({ kind: "folder", id, name })
                }}
              >
                删除
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem
                autoFocus
                icon={<Pencil />}
                onSelect={() => {
                  const source = menu.source
                  const initial = source.displayName
                  setMenu(null)
                  openNameDialog(
                    { kind: "proto-rename", dir: source.sandboxDir, initial },
                    initial
                  )
                }}
              >
                重命名
              </MenuItem>
              <MenuItem
                icon={<FilePlus />}
                onSelect={() => {
                  const dir = menu.source.sandboxDir
                  const sourceKind = menu.source.kind
                  setMenu(null)
                  openNameDialog({ kind: "sub-create", dir, initial: "", sourceKind })
                }}
              >
                新建子页面
              </MenuItem>
              {groupIdOf(menu.source) ? (
                <MenuItem
                  icon={<Folder />}
                  onSelect={() => {
                    const key = protoGroupKey(menu.source)
                    setMenu(null)
                    if (moveProtoToGroup(key, "")) announce("已移到未分组")
                  }}
                >
                  移出文件夹
                </MenuItem>
              ) : null}
              <div className="my-1 h-px bg-border" aria-hidden="true" />
              <MenuItem
                danger
                icon={<Trash2 />}
                onSelect={() => {
                  const dir = menu.source.sandboxDir
                  const name = menu.source.displayName
                  setMenu(null)
                  setConfirmState({ kind: "proto", dir, name })
                }}
              >
                删除
              </MenuItem>
            </>
          )}
        </div>
      ) : null}

      <Dialog open={!!nameDialog} onOpenChange={(open) => (!open ? setNameDialog(null) : null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{nameDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-2">
            <Input
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleNameSubmit()
              }}
              placeholder={
                nameDialog?.kind === "sub-create" ? "子页面名称" : "名称"
              }
              aria-label={nameDialogTitle}
            />
            {nameDialog?.kind === "sub-create" ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                将在该原型目录内创建 HTML 子页面。
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setNameDialog(null)}>
              取消
            </Button>
            <Button size="sm" variant="default" disabled={busy} onClick={() => void handleNameSubmit()}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmState}
        onOpenChange={(open) => (!open ? setConfirmState(null) : null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmState?.kind === "folder" ? "删除文件夹？" : "删除原型？"}
            </DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {confirmState?.kind === "folder" ? (
              <>
                将删除文件夹「{confirmState.name}」及其子文件夹；其中的原型会移到未分组，
                不会删除原型文件。
              </>
            ) : (
              <>
                将删除原型「{confirmState?.name}」及其全部文件，操作不可撤销。
              </>
            )}
          </p>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setConfirmState(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleConfirmDelete()}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建原型</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate()
              }}
              placeholder="原型名称"
              aria-label="原型名称"
            />
            <div role="group" aria-label="端别" className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={newKind === "pc"}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  newKind === "pc"
                    ? "border-[#18181b] bg-[#18181b] text-white"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                )}
                onClick={() => setNewKind("pc")}
              >
                PC 端
              </button>
              <button
                type="button"
                aria-pressed={newKind === "mobile"}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  newKind === "mobile"
                    ? "border-[#18181b] bg-[#18181b] text-white"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                )}
                onClick={() => setNewKind("mobile")}
              >
                移动端
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="default" disabled={busy} onClick={() => void handleCreate()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
