/**
 * src/renderer/features/projects/ProjectPicker.tsx — W3-01 项目选择器。
 *
 * 行为对齐旧 `js/project-ai-export.js:7973-8075`：
 * - 冷启动先拉 `sandbox.projects()`；有 `protoLastProject` 且项目仍存在则直接进入；
 *   否则弹出本选择器（不是假数据）。
 * - 每个项目显示名称 + `protoCount`。
 * - 可新建（进入新项目）、重命名、删除；「默认项目」不可删除。
 *
 * 冷启动恢复只由本组件负责；MainWindow 只挂载本组件，不碰其它弹层。
 */

import { useEffect, useRef, useState } from "react"
import { Check, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PROTO_LAST_PROJECT, readText } from "@/lib/storage-keys"
import {
  useSourcesStore,
  type ProjectInfo,
  type SourcesActionResult,
} from "@/stores/sources-store"
import { useUiStore } from "@/stores/ui-store"
import { cn } from "@/lib/utils"

function toastError(title: string, description?: string): void {
  useUiStore.getState().pushToast({ title, description, variant: "destructive" })
}

interface PanelProps {
  project: string
  projects: ProjectInfo[]
  loading: boolean
  storeError: string
  onClose: () => void
  enterProject: (name: string) => Promise<void>
  createProject: (name: string) => Promise<SourcesActionResult>
  renameProject: (oldName: string, name: string) => Promise<SourcesActionResult>
  removeProject: (name: string) => Promise<SourcesActionResult>
}

/** 选择器内容（仅在 open 时挂载；key=project，打开即用最新项目重置本地编辑态）。 */
function ProjectPickerPanel(props: PanelProps) {
  const { project, projects, loading, storeError, onClose } = props
  const [picked, setPicked] = useState(project || "")
  const [newName, setNewName] = useState("")
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [confirmRemove, setConfirmRemove] = useState("")
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState("")
  const error = localError || storeError

  async function handleEnter(name: string): Promise<void> {
    const target = String(name || "").trim()
    if (!target) return
    setBusy(true)
    setLocalError("")
    await props.enterProject(target)
  }

  async function handleCreate(): Promise<void> {
    const name = newName.trim()
    if (!name) {
      setLocalError("请输入项目名称")
      return
    }
    setBusy(true)
    setLocalError("")
    const r = await props.createProject(name)
    if (!r.ok) {
      setBusy(false)
      setLocalError(r.error || "创建项目失败")
      return
    }
    setNewName("")
    setBusy(false)
    await handleEnter(r.name || name)
  }

  async function handleRename(): Promise<void> {
    if (!renaming) return
    const next = renameValue.trim()
    if (!next || next === renaming) {
      setRenaming(null)
      return
    }
    setBusy(true)
    setLocalError("")
    const r = await props.renameProject(renaming, next)
    setBusy(false)
    if (!r.ok) {
      setLocalError(r.error || "重命名失败")
      toastError("重命名失败", r.error)
      return
    }
    setPicked(r.name || next)
    setRenaming(null)
  }

  async function handleRemove(): Promise<void> {
    const name = confirmRemove
    if (!name) return
    setBusy(true)
    setLocalError("")
    const r = await props.removeProject(name)
    setBusy(false)
    setConfirmRemove("")
    if (!r.ok) {
      setLocalError(r.error || "删除项目失败")
      toastError("删除项目失败", r.error)
      return
    }
    if (picked === name) setPicked("")
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DialogContent data-testid="project-picker" className="max-w-md">
          <DialogHeader>
            <DialogTitle>选择项目</DialogTitle>
            <DialogDescription>
              一个项目一个文件夹，进入后侧栏只展示该项目的原型。上次项目会自动恢复。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
            {loading && !projects.length ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">正在读取项目列表…</p>
            ) : projects.length ? (
              <ul className="divide-y divide-border">
                {projects.map((p) => {
                  const isPicked = picked === p.name
                  const isRenaming = renaming === p.name
                  return (
                    <li key={p.name}>
                      <div
                        className={cn(
                          "flex items-center gap-1 px-2 py-1.5",
                          isPicked ? "bg-accent" : "hover:bg-accent/60"
                        )}
                      >
                        {isRenaming ? (
                          <>
                            <Input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleRename()
                                if (e.key === "Escape") setRenaming(null)
                              }}
                              className="h-7 flex-1"
                              aria-label="项目新名称"
                            />
                            <button
                              type="button"
                              title="保存名称"
                              aria-label="保存名称"
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              onClick={() => void handleRename()}
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title="取消重命名"
                              aria-label="取消重命名"
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              onClick={() => setRenaming(null)}
                            >
                              <X className="size-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              data-selected={isPicked ? "true" : "false"}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left"
                              onClick={() => setPicked(p.name)}
                              onDoubleClick={() => void handleEnter(p.name)}
                            >
                              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                                {p.name}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                {p.protoCount} 个原型
                              </span>
                            </button>
                            <button
                              type="button"
                              title="重命名项目"
                              aria-label={"重命名项目 " + p.name}
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                              onClick={() => {
                                setRenaming(p.name)
                                setRenameValue(p.name)
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title={
                                p.name === "默认项目"
                                  ? "「默认项目」不可删除"
                                  : "删除项目（整目录，不可恢复）"
                              }
                              aria-label={"删除项目 " + p.name}
                              disabled={p.name === "默认项目"}
                              className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => setConfirmRemove(p.name)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-3 py-4 text-xs text-muted-foreground">暂无项目，输入名称新建一个。</p>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate()
              }}
              placeholder="新项目名称"
              aria-label="新项目名称"
            />
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleCreate()}>
              新建并进入
            </Button>
          </div>

          {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
              关闭
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={busy || !picked}
              onClick={() => void handleEnter(picked)}
            >
              进入项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmRemove}
        onOpenChange={(next) => {
          if (!next) setConfirmRemove("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              删除项目「{confirmRemove}」将删除其文件夹及其中全部原型，不可恢复。确定删除？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRemove()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default function ProjectPicker() {
  const open = useSourcesStore((s) => s.pickerOpen)
  const projects = useSourcesStore((s) => s.projects)
  const project = useSourcesStore((s) => s.project)
  const loading = useSourcesStore((s) => s.loading)
  const storeError = useSourcesStore((s) => s.error)
  const loadProjects = useSourcesStore((s) => s.loadProjects)
  const enterProject = useSourcesStore((s) => s.enterProject)
  const createProject = useSourcesStore((s) => s.createProject)
  const renameProject = useSourcesStore((s) => s.renameProject)
  const removeProject = useSourcesStore((s) => s.removeProject)
  const openPicker = useSourcesStore((s) => s.openProjectPicker)
  const closePicker = useSourcesStore((s) => s.closeProjectPicker)

  const booted = useRef(false)

  // 冷启动：拉项目列表 → 有 last project 直接进，否则弹选择器。
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      const list = await loadProjects()
      // 窗口参数直达（旧 bootProjectFlow 同口径）：?project=xxx 优先于 last project。
      let queryProject = ""
      try {
        queryProject = new URLSearchParams(window.location.search).get("project") || ""
      } catch {
        queryProject = ""
      }
      if (queryProject && list.some((p) => p.name === queryProject)) {
        await enterProject(queryProject)
        return
      }
      const last = readText(PROTO_LAST_PROJECT) || ""
      if (last && list.some((p) => p.name === last)) {
        await enterProject(last)
        return
      }
      openPicker()
    })()
  }, [loadProjects, enterProject, openPicker])

  if (!open) return null

  return (
    <ProjectPickerPanel
      key={project || "__no-project__"}
      project={project}
      projects={projects}
      loading={loading}
      storeError={storeError}
      onClose={closePicker}
      enterProject={enterProject}
      createProject={createProject}
      renameProject={renameProject}
      removeProject={removeProject}
    />
  )
}
