/**
 * src/renderer/components/shell/Topbar.tsx — Wave 2-G 顶栏（布局 + 只读 store 投影）。
 *
 * - 高度 40px（h-10，与旧版视觉一致）。
 * - 含 `.loc-pill` 面包屑：项目 / 原型 / 页面三段（data-testid="loc-pill"）。
 * - cobalt 仅用于链接/焦点/少量强调：本栏不用 cobalt 文本（聚焦环由全局样式接管）。
 * - W3-04：导出接 sources-store（真实源）与 docs-store（docContent/docTitle）。
 * - 文档入口收敛为单个「文档」按钮：只 toggle ui-store.docsOpen 开合面板，
 *   不再调用 docwin（独立窗口）。
 *
 * P1-3（顶栏补入口）：
 * - 项目 pill 改为项目切换下拉：sources-store.projects + enterProject，
 *   支持搜索过滤、当前项目高亮、新建项目（createProject 后直接 enterProject）。
 * - 新增刷新（sources-store.refresh）与终端（invokeProtoMethod('ai','openTerminal', 沙箱目录)）。
 * - PC 缩放百分比改为 50/75/100/125 预设下拉；非预设值（如 95%）保留为自定义项。
 * - M1（单一读数）：移动端缩放组为 [模式下拉（全貌/适宽/100%/125%）| - | 百分比 | +]；
 *   -/+ 进入 custom，全貌/适宽读 Stage 实测并发布的 scale，不回退未参与渲染的 zoom。
 * - 下拉的 Esc 只关自己（stopPropagation），不干扰 MainWindow 的 closeTopmost 栈。
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GitBranch,
  MessageSquare,
  Minus,
  Monitor,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  Terminal,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useAppStore, type MobileViewportMode } from "@/stores/app-store"
import { useUiStore } from "@/stores/ui-store"
import { useDocsStore } from "@/stores/docs-store"
import { useSourcesStore } from "@/stores/sources-store"
import { invokeProtoMethod } from "@/lib/ipc"
import { ExportMenu } from "@/features/export/ExportMenu"
import { stageReadingLabel, useStageScaleReading } from "@/components/shell/Stage"
import { cn } from "@/lib/utils"

/** 缩放预设（%）。当前缩放不在此列时，下拉额外保留一个自定义项。 */
const ZOOM_PRESETS = [50, 75, 100, 125]

function LocSegment({ label, placeholder }: { label: string; placeholder: string }) {
  const text = label || placeholder
  return (
    <span title={text} className="max-w-32 truncate">
      {text}
    </span>
  )
}

export default function Topbar() {
  const project = useAppStore((s) => s.project)
  const proto = useAppStore((s) => s.proto)
  const page = useAppStore((s) => s.page)
  const kind = useAppStore((s) => s.kind)
  const zoom = useAppStore((s) => s.zoom)
  const mobileMode = useAppStore((s) => s.mobileViewMode)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setKind = useAppStore((s) => s.setKind)
  const setZoom = useAppStore((s) => s.setZoom)
  const setMobileViewMode = useAppStore((s) => s.setMobileViewMode)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const docsOpen = useUiStore((s) => s.docsOpen)
  const toggleDocs = useUiStore((s) => s.toggleDocs)
  const openAi = useUiStore((s) => s.openAi)
  const pushToast = useUiStore((s) => s.pushToast)
  // W3-04：导出走顶栏直挂 <ExportMenu>（自带 DropdownMenu + ghost 触发器，
  // data-testid="export-menu"）；sources/currentName/docText/docTitle 全部来自真实 store。
  const openGit = useUiStore((s) => (s as unknown as { openGit?: () => void }).openGit)
  const sources = useSourcesStore((s) => s.sources)
  const currentSource = useSourcesStore((s) => s.currentSource)
  const sourceProject = useSourcesStore((s) => s.project)
  const projects = useSourcesStore((s) => s.projects)
  const sourcesLoading = useSourcesStore((s) => s.loading)
  const loadProjects = useSourcesStore((s) => s.loadProjects)
  const enterProject = useSourcesStore((s) => s.enterProject)
  const createProject = useSourcesStore((s) => s.createProject)
  const refreshSources = useSourcesStore((s) => s.refresh)
  const docContent = useDocsStore((s) => s.docContent)
  const docTitle = useDocsStore((s) => s.docTitle)

  const activeProject = sourceProject || project
  const zoomPercent = Math.round(zoom * 100)

  /*
   * 缩放读数单一事实源：移动端「全貌/适宽」比例由 Stage 实测并发布，
   * 持久化 zoom 只参与自定义模式；未测得时显示模式名，绝不显示旧 zoom。
   * PC 仍直接显示 zoom。
   */
  const stageScale = useStageScaleReading()
  const readingMatchesStage =
    stageScale.kind === kind &&
    stageScale.zoom === zoom &&
    (kind === "mobile" ? stageScale.mobileMode === mobileMode : true)
  // 固定比例/自定义无需实测，Stage 发布前也能立即给出正确读数。
  const knownMobileScale =
    mobileMode === "100" ? 1 : mobileMode === "125" ? 1.25 : mobileMode === "custom" ? zoom : null
  const appliedScale = kind === "mobile"
    ? readingMatchesStage
      ? stageScale.scale
      : knownMobileScale
    : zoom
  const zoomLabel = stageReadingLabel(kind, mobileMode, appliedScale)
  const presetValue = kind === "mobile" ? mobileMode : String(zoomPercent)

  /** 移动端 -/+：进入 custom，再按当前可见比例步进（钳制口径与 setZoom 一致）。 */
  const stepMobileZoom = (delta: number) => {
    const base = appliedScale ?? 1
    const next = Math.min(3, Math.max(0.2, Math.round((base + delta) * 100) / 100))
    setMobileViewMode("custom")
    setZoom(next)
  }

  const applyPcZoom = (next: number) => setZoom(next)

  const handlePresetChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const percent = Number(e.target.value)
    if (!Number.isFinite(percent)) return
    applyPcZoom(percent / 100)
  }

  const handleMobileModeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as MobileViewportMode
    if (value === "overview" || value === "fit-width" || value === "100" || value === "125") {
      setMobileViewMode(value)
    }
  }

  /* ═══════════ 项目切换下拉（搜索 + 新建） ═══════════ */

  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [projectQuery, setProjectQuery] = useState("")
  const [newProjectName, setNewProjectName] = useState("")
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectError, setProjectError] = useState("")
  const projectMenuRef = useRef<HTMLElement>(null)

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, projectQuery])

  // 下拉打开时点击外部关闭（Esc 由容器 onKeyDown 处理，只关下拉）。
  useEffect(() => {
    if (!projectMenuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (projectMenuRef.current?.contains(e.target as Node)) return
      // 点外部关闭时一并清空搜索/错误，避免下次展开仍是旧过滤结果。
      setProjectMenuOpen(false)
      setProjectQuery("")
      setProjectError("")
    }
    document.addEventListener("mousedown", onMouseDown)
    return () => document.removeEventListener("mousedown", onMouseDown)
  }, [projectMenuOpen])

  const closeProjectMenu = () => {
    setProjectMenuOpen(false)
    setProjectQuery("")
    setProjectError("")
  }

  const toggleProjectMenu = () => {
    if (projectMenuOpen) {
      closeProjectMenu()
      return
    }
    setProjectError("")
    setProjectMenuOpen(true)
    // 冷启动/项目列表为空时补拉一次；已有列表直接用，避免每次展开都打 IPC。
    if (!projects.length) void loadProjects()
  }

  const handleEnterProject = async (name: string) => {
    const target = String(name || "").trim()
    if (!target || projectBusy) return
    if (target === activeProject) {
      closeProjectMenu()
      return
    }
    setProjectBusy(true)
    setProjectError("")
    try {
      await enterProject(target)
      const err = useSourcesStore.getState().error
      if (err) {
        setProjectError(err)
        pushToast({ title: "切换项目失败", description: err, variant: "destructive" })
        return
      }
      closeProjectMenu()
      pushToast({ title: `已切换到项目「${target}」` })
    } finally {
      setProjectBusy(false)
    }
  }

  const handleCreateProject = async () => {
    const name = newProjectName.trim()
    if (!name) {
      setProjectError("请输入项目名称")
      return
    }
    if (projectBusy) return
    setProjectBusy(true)
    setProjectError("")
    try {
      const r = await createProject(name)
      if (!r.ok) {
        setProjectError(r.error || "新建项目失败")
        pushToast({ title: "新建项目失败", description: r.error, variant: "destructive" })
        return
      }
      const created = r.name || name
      setNewProjectName("")
      await enterProject(created)
      const err = useSourcesStore.getState().error
      if (err) {
        setProjectError(err)
        pushToast({ title: "进入新项目失败", description: err, variant: "destructive" })
        return
      }
      closeProjectMenu()
      pushToast({ title: `已新建并进入项目「${created}」` })
    } finally {
      setProjectBusy(false)
    }
  }

  /* ═══════════ 刷新 / 终端 / 文档入口 ═══════════ */

  const handleRefresh = async () => {
    if (sourcesLoading) return
    if (!activeProject) {
      pushToast({ title: "请先选择项目", description: "刷新需要当前项目上下文" })
      return
    }
    await refreshSources()
    const err = useSourcesStore.getState().error
    if (err) {
      pushToast({ title: "刷新失败", description: err, variant: "destructive" })
      return
    }
    pushToast({ title: "已刷新", description: "项目与原型列表已更新" })
  }

  const handleOpenTerminal = async () => {
    const dir = currentSource?.sandboxDir || ""
    if (!currentSource) {
      pushToast({ title: "请先选择一个原型", description: "打开终端需要当前原型的沙箱目录" })
      return
    }
    if (!dir) {
      pushToast({ title: "当前原型缺少沙箱目录", description: "请刷新项目后重试", variant: "destructive" })
      return
    }
    const r = await invokeProtoMethod("ai", "openTerminal", dir)
    if (r.ok) {
      pushToast({ title: "已打开终端", description: dir })
    } else {
      pushToast({ title: "打开终端失败", description: r.error || "未知错误", variant: "destructive" })
    }
  }

  /** 文档按钮：只开合面板（不走 docwin 独立窗口）。 */
  const handleDocsToggle = () => toggleDocs()

  /* 缩放组小件：PC 走持久化 zoom；移动端 -/+ 进入 custom，预设走视口模式。 */
  const zoomOutButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="缩小"
      onClick={() => (kind === "mobile" ? stepMobileZoom(-0.1) : applyPcZoom(zoom - 0.1))}
      title="缩小"
    >
      <Minus className="size-3.5" />
    </Button>
  )

  const zoomInButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="放大"
      onClick={() => (kind === "mobile" ? stepMobileZoom(0.1) : applyPcZoom(zoom + 0.1))}
      title="放大"
    >
      <Plus className="size-3.5" />
    </Button>
  )

  const presetSelect = (
    <select
      aria-label="缩放预设"
      title="缩放预设（50% / 75% / 100% / 125%）"
      value={presetValue}
      onChange={handlePresetChange}
      className="h-6 w-14 cursor-pointer rounded bg-transparent px-0 text-center text-[11px] tabular-nums text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      {!ZOOM_PRESETS.includes(zoomPercent) ? (
        <option value={zoomPercent}>{zoomPercent}%</option>
      ) : null}
      {ZOOM_PRESETS.map((p) => (
        <option key={p} value={p}>
          {p}%
        </option>
      ))}
    </select>
  )

  /* 移动端视口模式：全貌 / 适宽 / 100% / 125%；custom 时额外保留当前百分比项。 */
  const mobilePresetSelect = (
    <select
      aria-label="移动端视图模式"
      title="移动端视图模式（全貌 / 适宽 / 100% / 125%）"
      value={mobileMode}
      onChange={handleMobileModeChange}
      className="h-6 w-[72px] cursor-pointer rounded bg-transparent px-0 text-center text-[11px] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="overview">全貌</option>
      <option value="fit-width">适宽</option>
      <option value="100">100%</option>
      <option value="125">125%</option>
      {mobileMode === "custom" ? <option value="custom">自定义 {zoomPercent}%</option> : null}
    </select>
  )

  return (
    <header
      data-testid="topbar"
      className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-chrome px-2"
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
        aria-expanded={sidebarOpen}
        onClick={toggleSidebar}
        title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
      >
        <PanelLeft className="size-4" />
      </Button>

      <nav
        ref={projectMenuRef}
        data-testid="loc-pill"
        aria-label="当前位置"
        onKeyDown={(e) => {
          if (e.key === "Escape" && projectMenuOpen) {
            // 只关本项目下拉，避免 MainWindow 的 closeTopmost 顺带关掉其它浮层。
            e.preventDefault()
            e.stopPropagation()
            closeProjectMenu()
          }
        }}
        className="loc-pill relative flex min-w-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground"
      >
        <button
          type="button"
          data-testid="project-switch"
          aria-haspopup="listbox"
          aria-expanded={projectMenuOpen}
          aria-label={`切换项目：${activeProject || "未选择项目"}`}
          title="切换项目（搜索 / 新建）"
          onClick={toggleProjectMenu}
          className={cn(
            "-mx-1 flex min-w-0 items-center gap-0.5 rounded-full px-1 py-0.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
            projectMenuOpen && "bg-accent"
          )}
        >
          <LocSegment label={project} placeholder="未选择项目" />
          <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
        </button>
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <LocSegment label={proto} placeholder="未选择原型" />
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <LocSegment label={page} placeholder="—" />

        {projectMenuOpen ? (
          <div
            data-testid="project-menu"
            role="dialog"
            aria-label="切换项目"
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-72 rounded-lg border border-border bg-popover p-2 text-left text-foreground shadow-lg"
          >
            <div className="flex items-center gap-1.5 rounded border border-border bg-background px-2">
              <Search aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                data-testid="project-search"
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  const first = filteredProjects[0]
                  if (first) void handleEnterProject(first.name)
                }}
                placeholder="搜索项目"
                aria-label="搜索项目"
                className="h-7 min-w-0 flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div role="listbox" aria-label="项目列表" className="mt-1.5 max-h-60 overflow-y-auto">
              {filteredProjects.map((p) => {
                const isCurrent = p.name === activeProject
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    data-current={isCurrent ? "true" : "false"}
                    disabled={projectBusy}
                    onClick={() => void handleEnterProject(p.name)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      isCurrent && "bg-accent font-medium text-foreground"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                      {p.protoCount} 个原型
                    </span>
                    {isCurrent ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                  </button>
                )
              })}
              {!filteredProjects.length ? (
                <p className="px-2 py-3 text-[11px] text-muted-foreground">
                  {sourcesLoading ? "正在读取项目列表…" : "无匹配项目"}
                </p>
              ) : null}
            </div>

            <div className="mt-1.5 border-t border-border pt-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  data-testid="project-create-input"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateProject()
                  }}
                  placeholder="新项目名称"
                  aria-label="新项目名称"
                  className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[11.5px] outline-none placeholder:text-muted-foreground"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="project-create"
                  disabled={projectBusy}
                  onClick={() => void handleCreateProject()}
                  title="新建项目并进入"
                >
                  <FolderPlus className="size-3.5" />
                  新建项目
                </Button>
              </div>
            </div>

            {projectError ? (
              <p role="alert" className="mt-1 px-1 text-[11px] text-destructive">
                {projectError}
              </p>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div className="min-w-2 flex-1" />

      <div role="group" aria-label="端别切换" className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={kind === "pc"}
          onClick={() => setKind("pc")}
          className={cn(kind === "pc" && "bg-accent text-foreground")}
          title="桌面端舞台"
        >
          <Monitor className="size-3.5" />
          <span className="hidden xl:inline">PC</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={kind === "mobile"}
          onClick={() => setKind("mobile")}
          className={cn(kind === "mobile" && "bg-accent text-foreground")}
          title="移动端舞台（375 逻辑宽）"
        >
          <Smartphone className="size-3.5" />
          <span className="hidden xl:inline">移动</span>
        </Button>
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <div role="group" aria-label="舞台缩放" className="flex items-center gap-0.5">
        {kind === "mobile" ? (
          <>
            {mobilePresetSelect}
            {zoomOutButton}
            <span
              data-testid="topbar-zoom-readout"
              title="移动端视口缩放后的实际比例"
              className="w-12 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground"
            >
              {zoomLabel}
            </span>
            {zoomInButton}
          </>
        ) : (
          <>
            {zoomOutButton}
            {presetSelect}
            {zoomInButton}
          </>
        )}
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <div role="group" aria-label="项目工具" className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          data-testid="topbar-refresh"
          aria-label="刷新项目与原型列表"
          disabled={sourcesLoading}
          onClick={() => void handleRefresh()}
          title="刷新项目与原型列表"
        >
          <RefreshCw className={cn("size-3.5", sourcesLoading && "animate-spin")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="topbar-terminal"
          aria-label="打开终端"
          onClick={() => void handleOpenTerminal()}
          title="在当前原型沙箱目录打开终端"
        >
          <Terminal className="size-3.5" />
        </Button>
      </div>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <div role="group" aria-label="操作入口" className="flex items-center gap-0.5">
        <Button variant="ghost" size="sm" aria-label="AI 对话" onClick={() => openAi()} title="打开 AI 对话">
          <MessageSquare className="size-3.5" />
          <span className="hidden xl:inline">AI 对话</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="topbar-docs"
          aria-label="文档"
          aria-pressed={docsOpen}
          onClick={handleDocsToggle}
          className={cn(docsOpen && "bg-accent text-foreground")}
          title={docsOpen ? "收起文档面板" : "打开文档面板"}
        >
          <BookOpen className="size-3.5" />
          <span className="hidden xl:inline">文档</span>
        </Button>
        <Button variant="ghost" size="sm" aria-label="Git 管理" onClick={() => openGit?.()} title="Git 版本管理">
          <GitBranch className="size-3.5" />
          <span className="hidden xl:inline">Git</span>
        </Button>
        <ExportMenu
          projectName={project}
          sources={sources}
          currentName={currentSource?.name ?? ""}
          docText={docContent}
          docTitle={docTitle || currentSource?.displayName || proto}
        />
      </div>
    </header>
  )
}
