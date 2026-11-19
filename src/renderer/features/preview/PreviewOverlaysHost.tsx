/**
 * src/renderer/features/preview/PreviewOverlaysHost.tsx — 预览舞台浮层总装（W3-08）。
 *
 * 装配关系（本文件是 W3-02 空壳的唯一填充点，Stage 不改）：
 *
 *   PreviewOverlaysHost
 *   ├─ PickOverlay                悬停框 / 选中框 / 角标（W3-02 已有）
 *   ├─ 标注角标（overlay）         选中元素命中 annotation 时按 annoColorOf 画编号
 *   ├─ 标注定位高亮（overlay）     点击标注项只高亮元素，不切换弹窗
 *   ├─ 浮层工具条（portal 到 Stage 工具区）交互 / 标注 / 待提交 / 快照
 *   │                             设置 / AI / Git 打开时整条隐藏，避免穿透 Dialog/Sheet 遮罩
 *   ├─ Sheet(标注)   → AnnoPanel          列表 + 当前面板直接编辑 / 定位高亮 / 删除（Confirm）
 *   ├─ Sheet(快照)   → SnapshotPanel      列表 + 恢复（Confirm）
 *   ├─ Sheet(链接)   链接清单 + 预览跳转 / 删除（Confirm）
 *   ├─ Sheet(待提交) 队列清单（条目可直接编辑）+ 底部固定提交/清空（Confirm）
 *   ├─ PickComposer         松开 Ctrl/Cmd → 底部一条统一需求输入条（bottom 固定 1rem；
 *   │                        草稿由本宿主保存，选择变化 / 短暂卸载不丢）
 *   └─ PickModifyDialog     松开 Ctrl/Cmd+Shift → 唯一一个修改文字弹窗
 *
 * 待提交入口收敛：底部不再常驻 MultiEditBar，待提交只从工具栏「待提交」打开。
 *
 * 数据口径：
 * - 标注/链接读写一律用 `currentSource.sandboxDir`；保存三键 `selector + page + htmlFile`；
 *   selector 来自 W3-02 帧桥（PreviewFrame 的 generateSelector，不在此重算）。
 * - 标注显隐键 `PROTO_ANNO_VISIBLE`、待提交键 `EDIT_QUEUE_KEY` 均只读消费
 *   lib/storage-keys 常量（不新增键、不迁移；检查器及其折叠键已随 W6 功能删除移除）。
 * - 链接帧桥只调用 LinkBind 对 W3-02 已有协议（STAMP_SET / NAV_JUMP / ANNO_RECTS）的封装，
 *   不新增协议名、不读 iframe document。
 * - 就地改/多选只入待提交队列；Ctrl/Cmd+Shift「修改文字」例外：直接读源 HTML → 替换元素文本 →
 *   写盘（与旧 `edit-entry.js codeEditSave` 口径一致），**绝不入队、绝不转 AI**。
 * - 待提交条目内容可在 Sheet 内直接编辑（失焦 / Ctrl+Enter 保存，Esc 取消），只改 text，
 *   不改勾选/移除/批量条目语义。
 *
 * 坐标口径：Stage / PreviewFrame 传进来的 rect 已是页面（client）坐标，
 * 容器 position:fixed; inset:0; z-index:30；容器 pointer-events:none，仅控件开 pointer-events。
 * 工具条经 toolbarSlot portal 到 Stage 子顶栏（普通流，不建立 z-index），
 * 需要遮罩/对话框的 Sheet 经 createPortal 挂到 body（z-50），始终压住工具条。
 *
 * TODO(W3-08): 标注/原型图片资产（sandbox:list-assets/read-asset-base64/save-asset/delete-asset）
 * 本轮按可选项未接线；接入时只扩展本文件与资产面板，不改 Stage/PreviewFrame。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Inbox, Link2, MessageSquarePlus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAppStore } from '@/stores/app-store'
import { useSourcesStore } from '@/stores/sources-store'
import { useUiStore } from '@/stores/ui-store'
import { EDIT_QUEUE_KEY, readJson, writeJson } from '@/lib/storage-keys'
import { invokeProtoMethod } from '@/lib/ipc'
import PickOverlay, { type OverlayRect } from './PickOverlay'
import { frameScaleFromWidths, scaleRectToPage } from './lib/iframe-pick'
import { isTrustedFrameEvent } from './lib/secure-srcdoc'
import PickComposer, { type PickTargetOption } from './PickComposer'
import PickModifyDialog, { type PickModifySaveResult } from './PickModifyDialog'
import type { EditQueueItem } from '@/components/overlays/MultiEditBar'
import AnnoPanel from '@/components/overlays/AnnoPanel'
import SnapshotPanel from '@/components/overlays/SnapshotPanel'
import Confirm from '@/components/overlays/Confirm'
import type { PreviewPickedElement } from './PreviewFrame'
import {
  annoColorOf,
  annoNumberOf,
  annoTimestamp,
  findAnno,
  loadAnnos,
  makeAnnoItem,
  readAnnoVisible,
  removeAnnoById,
  saveAnnos,
  upsertAnno,
  writeAnnoVisible,
  type AnnoItem,
} from '@/features/annotations/AnnoStore'
import {
  findLink,
  jumpPreviewFrame,
  linkButtonName,
  loadLinks,
  makeLinkId,
  removeLink,
  requestAnnoRectsInFrame,
  saveLinks,
  stampLinkInFrame,
  stampLinksInFrame,
  targetLabel,
  upsertLink,
  type LinkItem,
} from '@/features/links/LinkBind'

/** 松开 Ctrl/Cmd+Shift 后的唯一修改弹窗请求（Stage 自增 seq）。 */
export interface PickModifyRequest {
  /** 被点击的元素（selector/pickIndex/tagName/text/rect 均来自帧桥拾取快照）。 */
  element: PreviewPickedElement
  /** 拾取序号：相同 seq 不重复打开弹窗。 */
  seq: number
}

/** 批量待提交条目里的一个元素（不入 selector 主键，供后续 AI 按元素拆分）。 */
export interface PickBatchPart {
  selector: string
  page: string
  htmlFile?: string
  label?: string
  tagName?: string
}

/** 待提交条目：普通单条与批量合单共用同一份 Sheet；批量条目额外带 batchParts。 */
export type PickQueueItem = EditQueueItem & { batchParts?: PickBatchPart[] }

export interface PreviewOverlaysHostProps {
  /** 当前悬停元素（页面坐标，null=隐藏）。 */
  hover: PreviewPickedElement | null
  /** 当前选中元素（顺序即角标 1..n；页面坐标）。 */
  selected: PreviewPickedElement[]
  /** 松开 Ctrl/Cmd 后是否显示底部需求输入条（Stage 判定）。 */
  pickComposerOpen?: boolean
  /** 松开 Ctrl/Cmd+Shift 后的修改弹窗请求；同一时间最多一个。 */
  pickModifyRequest?: PickModifyRequest | null
  /** 关闭需求条（提交/取消后由 Stage 回收会话）。 */
  onPickComposerClose?: () => void
  /** 关闭修改弹窗（保存/取消后由 Stage 回收会话）。 */
  onPickModifyClose?: () => void
  /**
   * 浮层工具条的挂载点（Stage 工具区右侧 slot）。
   * 传入后工具条经 portal 进入舞台子顶栏，不再 fixed 覆盖顶栏/文档面板；
   * 不传时工具条不渲染（本组件仅由 Stage 使用，宿主必须提供）。
   */
  toolbarSlot?: HTMLElement | null
  /** 清空选择（提交 / 取消 / 手动清空）。 */
  onClearSelection?: () => void
  /** 移除单个选择（chips 删除）。 */
  onRemoveSelection?: (selector: string) => void
}

type SheetKind = 'anno' | 'snapshot' | 'links' | 'queue'

type ConfirmState =
  | { kind: 'link'; link: LinkItem }
  | { kind: 'queue-clear' }
  | { kind: 'queue-remove'; id: string }
  | null

interface AnnoBadge {
  anno: AnnoItem
  rect: OverlayRect
  no: number
}

function toOverlayRect(item: PreviewPickedElement | null): OverlayRect | null {
  if (!item || !item.rect) return null
  const r = item.rect
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** 无实测 rect 时复用的稳定空表（避免每次 render 新建对象触发 memo 失效）。 */
const EMPTY_LIVE_RECTS: Record<string, OverlayRect> = {}

/** 两个 overlay rect 是否肉眼不可区分（用于抑制轮询回包的无效 setState）。 */
function sameRect(a: OverlayRect | undefined, b: OverlayRect): boolean {
  if (!a) return false
  return (
    Math.abs(a.left - b.left) < 0.01 &&
    Math.abs(a.top - b.top) < 0.01 &&
    Math.abs(a.width - b.width) < 0.01 &&
    Math.abs(a.height - b.height) < 0.01
  )
}

/** 取当前预览 iframe（只用于 postMessage；绝不读 contentDocument/location）。 */
function findPreviewFrame(): HTMLIFrameElement | null {
  try {
    if (typeof document === 'undefined') return null
    return document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]')
  } catch {
    return null
  }
}

function queueId(): string {
  return 'eq_' + Date.now().toString(36) + Math.floor(Math.random() * 2176782336).toString(36)
}

/** 归一化待提交队列（坏数据丢弃，不抛错；批量条目的 batchParts 原样保留）。 */
function normalizeQueue(raw: unknown): PickQueueItem[] {
  if (!Array.isArray(raw)) return []
  const out: PickQueueItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = String(o.id ?? '') || queueId()
    const batchParts: PickBatchPart[] = []
    if (Array.isArray(o.batchParts)) {
      for (const rawPart of o.batchParts) {
        if (!rawPart || typeof rawPart !== 'object') continue
        const p = rawPart as Record<string, unknown>
        const selector = String(p.selector ?? '').trim()
        if (!selector) continue
        batchParts.push({
          selector,
          page: String(p.page ?? ''),
          htmlFile: typeof p.htmlFile === 'string' ? p.htmlFile : undefined,
          label: typeof p.label === 'string' ? p.label : undefined,
          tagName: typeof p.tagName === 'string' ? p.tagName : undefined,
        })
      }
    }
    const selector = String(o.selector ?? '').trim() || (batchParts.length ? 'batch:' + id : '')
    const text = String(o.text ?? '').trim()
    if (!selector || !text) continue
    out.push({
      id,
      selector,
      page: String(o.page ?? ''),
      htmlFile: typeof o.htmlFile === 'string' ? o.htmlFile : undefined,
      text,
      tagName: typeof o.tagName === 'string' ? o.tagName : undefined,
      selected: o.selected !== false,
      ...(batchParts.length ? { batchParts } : {}),
    })
  }
  return out
}

/** 启动时恢复待提交队列（键 edit_queue_v1，与旧 EDIT_QUEUE 同键）。 */
function loadQueue(): PickQueueItem[] {
  return normalizeQueue(readJson(EDIT_QUEUE_KEY, null))
}

function linkKey(link: LinkItem): string {
  return String(link.plid || link.id || '') + '|' + String(link.selector || '') + '|' + String(link.page || '')
}

/**
 * 待提交条目内联编辑器：失焦 / Ctrl+Enter 保存，Esc 取消（还原原值），空文本不允许保存。
 * 只改 text，不动勾选 / 移除 / 批量条目（batchParts）语义。
 */
function QueueTextEditor(props: { id: string; text: string; onSave: (id: string, text: string) => void }) {
  const [draft, setDraft] = useState(props.text)
  const [error, setError] = useState('')
  const skipBlur = useRef(false)

  useEffect(() => {
    setDraft(props.text)
    setError('')
  }, [props.text])

  const commit = () => {
    const value = draft.trim()
    if (!value) {
      setDraft(props.text)
      setError('待提交内容不能为空，已还原。')
      return
    }
    setError('')
    setDraft(value)
    if (value !== props.text) props.onSave(props.id, value)
  }

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-0.5"
      data-testid="overlays-queue-editor"
      data-queue-id={props.id}
    >
      <textarea
        data-testid="overlays-queue-text"
        data-queue-id={props.id}
        aria-label="待提交内容"
        rows={2}
        value={draft}
        className="min-h-11 w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cobalt)]"
        onChange={(ev) => {
          skipBlur.current = false
          setDraft(ev.target.value)
          if (error) setError('')
        }}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false
            return
          }
          commit()
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            // 只还原本条待提交内容，不冒泡关闭 Sheet。
            ev.preventDefault()
            ev.stopPropagation()
            skipBlur.current = true
            setDraft(props.text)
            setError('')
            ev.currentTarget.blur()
            return
          }
          if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault()
            commit()
            skipBlur.current = true
            ev.currentTarget.blur()
          }
        }}
      />
      {error ? (
        <div data-testid="overlays-queue-text-error" className="text-[10px] text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}

/** 修改文字写盘结果（内部）：解析成功返回目标元素与文档，失败回具体错误文案。 */
type LocateHtmlResult =
  | { ok: true; doc: Document; target: Element }
  | { ok: false; error: string }

/**
 * 在源 HTML 中定位「修改文字」目标（旧 `codeEditSave` 口径）：
 * - 用 DOMParser 解析源文件，不用 iframe 内存 DOM；
 * - 唯一命中直接用；多命中按帧内上报的 pickIndex 取对应序号；序号缺失/越界回错误。
 * @param sourceHtml 源 HTML 全文
 * @param selector 拾取时生成的稳定选择器
 * @param pickIndex 同 selector 命中列表序号（0 基，可缺省）
 * @returns 定位结果（ok=false 时 error 为可直接展示的文案）
 */
function locateHtmlTarget(sourceHtml: string, selector: string, pickIndex?: number): LocateHtmlResult {
  let doc: Document | null = null
  try {
    doc = new DOMParser().parseFromString(sourceHtml, 'text/html')
  } catch {
    doc = null
  }
  if (!doc || !doc.documentElement) return { ok: false, error: '源文件解析失败。' }
  let hits: Element[] = []
  try {
    hits = Array.from(doc.querySelectorAll(selector))
  } catch {
    return { ok: false, error: '选择器在源文件无效：' + selector }
  }
  if (!hits.length) return { ok: false, error: '元素已变化（命中 0 个），请重新拾取。' }
  if (hits.length === 1) return { ok: true, doc, target: hits[0] }
  const idx = typeof pickIndex === 'number' && Number.isInteger(pickIndex) ? pickIndex : -1
  if (idx < 0 || idx >= hits.length) {
    return { ok: false, error: `元素已变化（命中 ${hits.length} 个，原序号不可用），请重新拾取。` }
  }
  return { ok: true, doc, target: hits[idx] }
}

/**
 * 序列化修改后的文档（旧 `codeEditSave` 口径）：保留 doctype 声明，只回写 documentElement。
 * @param doc 已修改的 DOMParser 文档
 * @param sourceHtml 源 HTML（仅用于判定是否有 doctype）
 * @returns 待写盘 HTML
 */
function serializeEditedHtml(doc: Document, sourceHtml: string): string {
  const hasDoctype = /^\s*<!doctype/i.test(sourceHtml)
  return (hasDoctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML
}

export default function PreviewOverlaysHost(props: PreviewOverlaysHostProps) {
  /* ── 只读订阅（zustand v5：selector 只回原始值/稳定引用，不新建数组/对象） ── */
  const sandboxDir = useSourcesStore((s) => s.currentSource?.sandboxDir) || ''
  const mainHtmlFile = useSourcesStore((s) => s.currentSource?.mainHtmlFile) || ''
  const activeSubFile = useSourcesStore((s) => s.activeSubFile) || ''
  const sources = useSourcesStore((s) => s.sources)
  const appPage = useAppStore((s) => s.page)
  const pushToast = useUiStore((s) => s.pushToast)
  /*
   * 应用级弹层打开时隐藏工具条：Dialog/Sheet 的 portal 都是 z-50，
   * 工具条（原 fixed z-50）在设置/AI/Git 打开后仍会从遮罩外穿透出来。
   * 这里直接不渲染，保证弹层截图里不出现工具条；关闭弹层后自动恢复。
   */
  const settingsOpen = useUiStore((s) => s.settingsTab !== null)
  const aiOpen = useUiStore((s) => s.aiOpen)
  const gitOpen = useUiStore((s) => s.gitOpen)
  const modalOpen = settingsOpen || aiOpen || gitOpen

  const htmlFile = activeSubFile || mainHtmlFile
  const page = appPage || ''

  const onClearSelection = props.onClearSelection
  const onRemoveSelection = props.onRemoveSelection
  const onPickComposerClose = props.onPickComposerClose
  const onPickModifyClose = props.onPickModifyClose

  /* ── 本地状态 ── */
  const [annoItems, setAnnoItems] = useState<AnnoItem[]>([])
  const [annoLoading, setAnnoLoading] = useState(false)
  const [annoReady, setAnnoReady] = useState(false)
  const [annoVisible, setAnnoVisible] = useState<boolean>(() => readAnnoVisible())
  const [links, setLinks] = useState<LinkItem[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [linksReady, setLinksReady] = useState(false)
  const [queue, setQueue] = useState<PickQueueItem[]>(() => loadQueue())
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  /*
   * 需求草稿提升到宿主：PickComposer 受控消费（draft / onDraftChange）。
   * Ctrl 继续多选只改选择、不改 composerDraft；即使输入条因选择暂空或应用弹层
   * 短暂卸载，重新挂载时仍能取回已输入内容。只在提交成功、取消、清空选择、
   * 切源（含切子页）时清空。
   */
  const [composerDraft, setComposerDraft] = useState('')
  /*
   * 修改弹窗：从 props.pickModifyRequest 派生，seq 记账避免关闭后同一请求再次弹出。
   * 需求输入已收敛到底部 PickComposer，不再有 requirement 弹窗。
   */
  const [dismissedModifySeq, setDismissedModifySeq] = useState(0)
  /*
   * 标注定位高亮：只画一层元素框，不切 Sheet、不改选中。
   * rect 由帧桥 ANNO_RECTS → ANNO_RECTS_RESULT 现取（与选中框同一换算口径）。
   */
  const [locatedAnno, setLocatedAnno] = useState<{
    id: string
    selector: string
    rect: OverlayRect | null
  } | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  /*
   * 选中框实测 rect：props.selected[].rect 是拾取瞬间的快照，iframe 滚动/舞台缩放后
   * 会漂移。这里按 selector 向帧内响应器重取 rect（ANNO_RECTS → ANNO_RECTS_RESULT），
   * 并以 scope（源 + 页面 + htmlFile）隔离，切源后旧回包自动失效。
   */
  const [liveRectState, setLiveRectState] = useState<{
    scope: string
    rects: Record<string, OverlayRect>
  }>({ scope: '', rects: {} })
  const annoSeq = useRef(0)
  const linkSeq = useRef(0)

  const selectedOne = props.selected.length === 1 ? props.selected[0] : null
  const hasSelection = props.selected.length > 0
  const activeModifyRequest =
    props.pickModifyRequest && props.pickModifyRequest.seq !== dismissedModifySeq
      ? props.pickModifyRequest
      : null
  const liveRectScope = sandboxDir + '\u0001' + page + '\u0001' + htmlFile
  const liveRects = liveRectState.scope === liveRectScope ? liveRectState.rects : EMPTY_LIVE_RECTS

  /* ── 读取标注 / 链接：只认 currentSource.sandboxDir（切源废弃旧回包） ── */
  useEffect(() => {
    annoSeq.current += 1
    const seq = annoSeq.current
    setAnnoItems([])
    setAnnoReady(false)
    setLocatedAnno(null)
    if (!sandboxDir) {
      setAnnoLoading(false)
      return
    }
    setAnnoLoading(true)
    void loadAnnos(sandboxDir).then((r) => {
      if (seq !== annoSeq.current) return
      setAnnoLoading(false)
      if (!r.ok) {
        pushToast({ title: `标注读取失败：${r.error || '未知错误'}` })
        return
      }
      setAnnoReady(true)
      setAnnoItems(r.list)
    })
  }, [sandboxDir, pushToast])

  useEffect(() => {
    linkSeq.current += 1
    const seq = linkSeq.current
    setLinks([])
    setLinksReady(false)
    if (!sandboxDir) {
      setLinksLoading(false)
      return
    }
    setLinksLoading(true)
    void loadLinks(sandboxDir).then((r) => {
      if (seq !== linkSeq.current) return
      setLinksLoading(false)
      if (!r.ok) {
        pushToast({ title: `跳转链接读取失败：${r.error || '未知错误'}` })
        return
      }
      setLinksReady(true)
      setLinks(r.links)
    })
  }, [sandboxDir, pushToast])

  /* ── 切源：关闭当前 Sheet / 标注定位，避免旧源状态挂在新源上 ── */
  const prevDirRef = useRef(sandboxDir)
  useEffect(() => {
    if (prevDirRef.current === sandboxDir) return
    prevDirRef.current = sandboxDir
    setSheet(null)
    setLocatedAnno(null)
    setConfirmState(null)
  }, [sandboxDir])

  /*
   * 需求草稿按「源 + 页面」绑定：切源或切子页后旧草稿自动失效，避免带到新页面。
   * 仅选择变化（含 Ctrl 多选增删、选择暂时为空）不清空草稿。
   */
  const composerDraftScope = sandboxDir + '\u0001' + htmlFile
  const prevComposerScopeRef = useRef(composerDraftScope)
  useEffect(() => {
    if (prevComposerScopeRef.current === composerDraftScope) return
    prevComposerScopeRef.current = composerDraftScope
    setComposerDraft('')
  }, [composerDraftScope])

  /* ── 待提交队列持久化（edit_queue_v1） ── */
  useEffect(() => {
    writeJson(EDIT_QUEUE_KEY, queue)
  }, [queue])

  /* ── 链接帧桥：STAMP_SET（已有协议）随链接清单/切源重打；ANNO_RECTS best-effort ── */
  useEffect(() => {
    if (!sandboxDir || links.length === 0) return
    const stamp = () => {
      const frame = findPreviewFrame()
      if (frame) stampLinksInFrame(frame, links)
    }
    stamp()
    const timer = window.setTimeout(stamp, 400)
    return () => window.clearTimeout(timer)
  }, [sandboxDir, links])

  useEffect(() => {
    if (!sandboxDir || annoItems.length === 0) return
    const timer = window.setTimeout(() => {
      const frame = findPreviewFrame()
      if (frame) {
        requestAnnoRectsInFrame(
          frame,
          annoItems.map((a) => ({ id: a.id, selector: a.selector })),
        )
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [sandboxDir, annoItems])

  /*
   * 选中 rect 实时同步（P2-1）：
   * - 帧内任意滚动 → Agent 发 SCROLL，立即重取；
   * - 窗口尺寸变化 → resize 重取；
   * - 舞台 CSS zoom 缩放不触发 scroll（W5 起 zoom 改布局、RO 未必覆盖帧），用 160ms 轮询兜底
   *   （仅在有选中时运行；回包与缓存完全一致时不 setState，不产生持续重渲染）。
   * 回包坐标是帧视口坐标，按当前 frame.getBoundingClientRect()/clientWidth 换算成页面坐标，
   * 因此在 75%/125% 缩放下与 hover 框使用同一套换算口径。
   */
  useEffect(() => {
    if (!props.selected.length) return
    const selectors = props.selected
      .map((el) => String(el.selector || ''))
      .filter((selector) => !!selector)
    if (!selectors.length) return
    const selectorSet = new Set(selectors)
    let disposed = false

    const request = () => {
      if (disposed) return
      const frame = findPreviewFrame()
      if (!frame) return
      requestAnnoRectsInFrame(
        frame,
        selectors.map((selector) => ({ id: selector, selector })),
      )
    }

    const onMessage = (ev: MessageEvent) => {
      const frame = findPreviewFrame()
      if (!frame) return
      let frameWindow: Window | null = null
      try {
        frameWindow = frame.contentWindow
      } catch {
        frameWindow = null
      }
      if (!isTrustedFrameEvent(ev, frameWindow)) return
      const data = ev.data as { type?: unknown; payload?: unknown } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'SCROLL') {
        request()
        return
      }
      if (data.type !== 'ANNO_RECTS_RESULT') return
      const payload =
        data.payload && typeof data.payload === 'object'
          ? (data.payload as Record<string, unknown>)
          : {}
      const list = Array.isArray(payload.items) ? payload.items : []
      if (!list.length) return
      const frameRect = frame.getBoundingClientRect()
      const scale = frameScaleFromWidths(frameRect.width, frame.clientWidth || frameRect.width)
      const next: Record<string, OverlayRect> = {}
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue
        const rec = raw as Record<string, unknown>
        const key = typeof rec.key === 'string' ? rec.key : ''
        if (!key || !selectorSet.has(key)) continue
        const value = rec.rect
        if (!value || typeof value !== 'object') continue
        const r = value as Record<string, unknown>
        const left = Number(r.left)
        const top = Number(r.top)
        const width = Number(r.width)
        const height = Number(r.height)
        if (![left, top, width, height].every((n) => Number.isFinite(n))) continue
        next[key] = scaleRectToPage(
          { left, top, width, height },
          { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height },
          scale,
        )
      }
      if (!Object.keys(next).length) return
      setLiveRectState((prev) => {
        const base = prev.scope === liveRectScope ? prev.rects : {}
        let changed = false
        const merged: Record<string, OverlayRect> = { ...base }
        for (const [key, rect] of Object.entries(next)) {
          if (!sameRect(base[key], rect)) {
            merged[key] = rect
            changed = true
          }
        }
        return changed ? { scope: liveRectScope, rects: merged } : prev
      })
    }

    window.addEventListener('message', onMessage)
    window.addEventListener('resize', request)
    request()
    const warmup = window.setTimeout(request, 120)
    const timer = window.setInterval(request, 160)
    return () => {
      disposed = true
      window.clearTimeout(warmup)
      window.clearInterval(timer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('resize', request)
    }
  }, [props.selected, liveRectScope])

  /*
   * 标注定位高亮：按 anno.id 向帧内响应器取 rect（少量重试兜底 srcdoc 尚未挂载）。
   * 只更新本地高亮框，不切换 Sheet、不改选中；与选中框共用 scaleRectToPage 换算口径。
   */
  const locatedAnnoId = locatedAnno?.id || ''
  const locatedAnnoSelector = locatedAnno?.selector || ''
  useEffect(() => {
    if (!locatedAnnoId) return
    const id = locatedAnnoId
    const selector = locatedAnnoSelector
    let disposed = false

    const onMessage = (ev: MessageEvent) => {
      const frame = findPreviewFrame()
      if (!frame) return
      let frameWindow: Window | null = null
      try {
        frameWindow = frame.contentWindow
      } catch {
        frameWindow = null
      }
      if (!isTrustedFrameEvent(ev, frameWindow)) return
      const data = ev.data as { type?: unknown; payload?: unknown } | null
      if (!data || typeof data !== 'object' || data.type !== 'ANNO_RECTS_RESULT') return
      const payload =
        data.payload && typeof data.payload === 'object'
          ? (data.payload as Record<string, unknown>)
          : {}
      const list = Array.isArray(payload.items) ? payload.items : []
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue
        const rec = raw as Record<string, unknown>
        if (rec.key !== id) continue
        const value = rec.rect
        if (!value || typeof value !== 'object') return
        const r = value as Record<string, unknown>
        const left = Number(r.left)
        const top = Number(r.top)
        const width = Number(r.width)
        const height = Number(r.height)
        if (![left, top, width, height].every((n) => Number.isFinite(n))) return
        const frameRect = frame.getBoundingClientRect()
        const scale = frameScaleFromWidths(frameRect.width, frame.clientWidth || frameRect.width)
        const rect = scaleRectToPage(
          { left, top, width, height },
          { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height },
          scale,
        )
        if (disposed) return
        setLocatedAnno((prev) =>
          prev && prev.id === id && !sameRect(prev.rect || undefined, rect) ? { ...prev, rect } : prev,
        )
        return
      }
    }

    const request = () => {
      if (disposed) return
      const frame = findPreviewFrame()
      if (frame) requestAnnoRectsInFrame(frame, [{ id, selector }])
    }

    window.addEventListener('message', onMessage)
    request()
    const warmup = window.setTimeout(request, 150)
    const retry = window.setTimeout(request, 600)
    return () => {
      disposed = true
      window.clearTimeout(warmup)
      window.clearTimeout(retry)
      window.removeEventListener('message', onMessage)
    }
  }, [locatedAnnoId, locatedAnnoSelector])

  /* ── 派生数据（useMemo：不把新数组/对象塞回 zustand selector） ── */
  const hoverRect = useMemo(() => toOverlayRect(props.hover), [props.hover])
  const selectedRects = useMemo(
    () =>
      props.selected
        .map((item) => {
          const live = item.selector ? liveRects[item.selector] : undefined
          return live || toOverlayRect(item)
        })
        .filter((r): r is OverlayRect => !!r),
    [props.selected, liveRects],
  )

  const annoBadges = useMemo<AnnoBadge[]>(() => {
    if (!annoVisible || !annoItems.length) return []
    const out: AnnoBadge[] = []
    for (const el of props.selected) {
      const hit = findAnno(annoItems, { selector: el.selector, page, htmlFile })
      if (hit) {
        const live = el.selector ? liveRects[el.selector] : undefined
        out.push({ anno: hit, rect: live || el.rect, no: annoNumberOf(annoItems, hit.id) })
      }
    }
    return out
  }, [annoVisible, annoItems, props.selected, page, htmlFile, liveRects])

  /* 需求条只认当前唯一选中元素；标注/跳转/需求都以它为目标。 */
  const currentAnno = useMemo(
    () =>
      selectedOne
        ? findAnno(annoItems, { selector: selectedOne.selector, page, htmlFile })
        : null,
    [annoItems, selectedOne, page, htmlFile],
  )
  const currentLink = useMemo(
    () => (selectedOne ? findLink(links, selectedOne.selector, page, htmlFile) : null),
    [links, selectedOne, page, htmlFile],
  )

  const targetOptions = useMemo(
    () =>
      sources.map((s) => ({
        name: s.displayName || s.name,
        pages: s.subPages.map((sp) => ({ value: sp.file, label: sp.name })),
      })),
    [sources],
  )

  /* ── 队列写入：普通单条按 selector+page+htmlFile 去重；批量条目直接追加 ── */
  const enqueue = useCallback((entries: Array<Omit<PickQueueItem, 'id' | 'selected'>>) => {
    if (!entries.length) return
    setQueue((prev) => {
      const next = prev.slice()
      for (const entry of entries) {
        if (entry.batchParts?.length) {
          next.push({ ...entry, id: queueId(), selected: true })
          continue
        }
        const idx = next.findIndex(
          (q) =>
            q.selector === entry.selector &&
            q.page === entry.page &&
            (q.htmlFile || '') === (entry.htmlFile || ''),
        )
        if (idx >= 0) next[idx] = { ...next[idx], ...entry, selected: true }
        else next.push({ ...entry, id: queueId(), selected: true })
      }
      return next
    })
  }, [])

  /* ── 标注 ── */
  const handleToggleAnnoVisible = useCallback(
    (visible: boolean) => {
      setAnnoVisible(visible)
      writeAnnoVisible(visible)
      pushToast({ title: visible ? '已显示原型标注角标。' : '已隐藏原型标注角标。' })
    },
    [pushToast],
  )

  const handleSaveAnno = useCallback(
    async (content: string) => {
      const target = selectedOne
      const text = String(content || '').trim()
      if (!target || !sandboxDir) {
        pushToast({ title: '请先选择原型元素，再保存标注。' })
        return false
      }
      if (!text) {
        pushToast({ title: '请输入标注内容。' })
        return false
      }
      if (!target.selector) {
        pushToast({ title: '该元素没有稳定选择器，无法保存标注。' })
        return false
      }
      if (!annoReady) {
        pushToast({ title: '标注尚未成功读取，已取消保存以避免覆盖。' })
        return false
      }
      const existing =
        currentAnno ||
        findAnno(annoItems, { selector: target.selector, page: page, htmlFile: htmlFile })
      const item: AnnoItem = existing
        ? { ...existing, content: text, updatedAt: annoTimestamp() }
        : makeAnnoItem({
            htmlFile: htmlFile,
            selector: target.selector,
            page: page,
            content: text,
            textSnippet: target.text,
            tagName: target.tagName,
            elementName: target.text,
          })
      const next = upsertAnno(annoItems, item)
      const r = await saveAnnos(sandboxDir, next)
      if (!r.ok) {
        pushToast({ title: `保存标注失败：${r.error || '未知错误'}` })
        return false
      }
      setAnnoItems(next)
      pushToast({ title: existing ? '已更新需求标注。' : '已新增需求标注。' })
      return true
    },
    [annoItems, annoReady, currentAnno, htmlFile, page, selectedOne, pushToast, sandboxDir],
  )

  /* 标注面板内直接编辑：按 id 定位条目，写 saveAnnos 并更新列表。 */
  const handleUpdateAnno = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      if (!sandboxDir || !id) return false
      const text = String(content || '').trim()
      if (!text) {
        pushToast({ title: '标注内容不能为空。' })
        return false
      }
      if (!annoReady) {
        pushToast({ title: '标注尚未成功读取，已取消保存以避免覆盖。' })
        return false
      }
      const existing = annoItems.find((a) => a.id === id)
      if (!existing) {
        pushToast({ title: '该标注已不存在，请刷新后重试。' })
        return false
      }
      if ((existing.content || '').trim() === text) return true
      const item: AnnoItem = { ...existing, content: text, updatedAt: annoTimestamp() }
      const next = upsertAnno(annoItems, item)
      const r = await saveAnnos(sandboxDir, next)
      if (!r.ok) {
        pushToast({ title: `保存标注失败：${r.error || '未知错误'}` })
        return false
      }
      setAnnoItems(next)
      pushToast({ title: '已更新需求标注。' })
      return true
    },
    [annoItems, annoReady, pushToast, sandboxDir],
  )

  const handleDeleteAnno = useCallback(
    async (id: string) => {
      if (!sandboxDir || !id) return false
      if (!annoReady) {
        pushToast({ title: '标注尚未成功读取，已取消删除以避免覆盖。' })
        return false
      }
      const next = removeAnnoById(annoItems, id)
      const r = await saveAnnos(sandboxDir, next)
      if (!r.ok) {
        pushToast({ title: `删除标注失败：${r.error || '未知错误'}` })
        return false
      }
      setAnnoItems(next)
      setLocatedAnno((prev) => (prev && prev.id === id ? null : prev))
      return true
    },
    [annoItems, annoReady, pushToast, sandboxDir],
  )

  /* 定位只高亮元素：不清空当前选择、不切换任何弹层。 */
  const handleLocateAnno = useCallback((anno: AnnoItem) => {
    setLocatedAnno({ id: anno.id, selector: anno.selector, rect: null })
  }, [])

  /* ── 链接 ── */
  const handleSaveJump = useCallback(
    async (target: string, targetPage: string) => {
      const el = selectedOne
      if (!el || !sandboxDir) {
        pushToast({ title: '请先选择原型元素，再绑定跳转。' })
        return false
      }
      if (!el.selector) {
        pushToast({ title: '该元素没有稳定选择器，无法绑定跳转。' })
        return false
      }
      if (!linksReady) {
        pushToast({ title: '跳转链接尚未成功读取，已取消保存以避免覆盖。' })
        return false
      }
      const existing = currentLink || findLink(links, el.selector, page, htmlFile)
      const plid = String(existing?.plid || existing?.id || makeLinkId())
      const item: LinkItem = {
        ...(existing || {}),
        id: plid,
        plid,
        selector: el.selector,
        page: page,
        htmlFile: htmlFile,
        target: String(target || '').trim(),
        targetPage: String(targetPage || '').trim(),
        label: el.text || existing?.label || '',
        text: el.text || existing?.text || '',
        ts: Date.now(),
      }
      if (!item.target) {
        pushToast({ title: '请先选择跳转目标原型。' })
        return false
      }
      const next = upsertLink(links, item)
      const r = await saveLinks(sandboxDir, next)
      if (!r.ok) {
        pushToast({ title: `保存跳转绑定失败：${r.error || '未知错误'}` })
        return false
      }
      setLinks(next)
      stampLinkInFrame(findPreviewFrame(), item)
      pushToast({ title: existing ? '已更新跳转绑定。' : '已保存跳转绑定。' })
      return true
    },
    [currentLink, htmlFile, page, selectedOne, links, linksReady, pushToast, sandboxDir],
  )

  const handleRemoveJump = useCallback(async () => {
    const el = selectedOne
    if (!el || !sandboxDir) return false
    if (!linksReady) {
      pushToast({ title: '跳转链接尚未成功读取，已取消删除以避免覆盖。' })
      return false
    }
    const next = removeLink(links, el.selector, page, htmlFile)
    const r = await saveLinks(sandboxDir, next)
    if (!r.ok) {
      pushToast({ title: `删除跳转绑定失败：${r.error || '未知错误'}` })
      return false
    }
    setLinks(next)
    pushToast({ title: '已删除跳转绑定。' })
    return true
  }, [htmlFile, page, selectedOne, links, linksReady, pushToast, sandboxDir])

  const handleDeleteLink = useCallback(
    async (link: LinkItem) => {
      if (!sandboxDir) return
      if (!linksReady) {
        pushToast({ title: '跳转链接尚未成功读取，已取消删除以避免覆盖。' })
        return
      }
      const next = removeLink(links, link.selector, link.page, link.htmlFile)
      const r = await saveLinks(sandboxDir, next)
      if (!r.ok) {
        pushToast({ title: `删除跳转绑定失败：${r.error || '未知错误'}` })
        return
      }
      setLinks(next)
      pushToast({ title: '已删除跳转绑定。' })
    },
    [links, linksReady, pushToast, sandboxDir],
  )

  const handleJumpLink = useCallback(
    (link: LinkItem) => {
      const targetPage = String(link.targetPage || '')
      const target = String(link.target || '')
      const isSelf =
        target === (useSourcesStore.getState().currentSource?.displayName || '') ||
        target === mainHtmlFile ||
        target === (useSourcesStore.getState().currentSource?.name || '')
      if (isSelf) {
        jumpPreviewFrame(findPreviewFrame(), targetPage || link.page || '')
        useAppStore.getState().setPage(targetPage || link.page || '')
        setSheet(null)
        pushToast({ title: targetPage ? `已跳转到 ${targetPage}。` : '已回到原型主页。' })
        return
      }
      const store = useSourcesStore.getState()
      const src = store.sources.find(
        (s) => s.displayName === target || s.name === target || s.mainHtmlFile === target,
      )
      if (!src) {
        pushToast({ title: `目标原型不在当前项目：${target || '未指定'}` })
        return
      }
      store.selectSource(src.name)
      if (targetPage) {
        const sp = src.subPages.find((p) => p.name === targetPage || p.file === targetPage)
        if (sp) void store.selectSubPage(sp.file)
      }
      setSheet(null)
      pushToast({ title: `已切换到 ${src.displayName}。` })
    },
    [mainHtmlFile, pushToast],
  )

  /* ── 队列操作 ── */

  const handleQueueToggle = useCallback((id: string, selected: boolean) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, selected } : q)))
  }, [])

  /* 只改条目 text 并触发 edit_queue_v1 持久化；不碰勾选/移除/批量语义。 */
  const handleQueueEdit = useCallback(
    (id: string, text: string) => {
      const value = String(text || '').trim()
      if (!id || !value) return
      setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, text: value } : q)))
      pushToast({ title: '已更新待提交内容。' })
    },
    [pushToast],
  )

  const handleQueueRemove = useCallback((id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }, [])

  const handleQueueClear = useCallback(() => {
    setQueue([])
  }, [])

  const handleQueueSubmit = useCallback(() => {
    const count = queue.filter((q) => q.selected !== false).length
    if (!count) return
    pushToast({
      title: `待提交已就绪：${count} 条`,
      description: '本轮不直调大模型；请在 AI 对话中发起修改。',
    })
  }, [queue, pushToast])

  /* ── 松开 Ctrl/Cmd：底部需求条（单元素=普通需求，多元素=一条批量需求） ── */
  const handlePickComposerCancel = useCallback(() => {
    setComposerDraft('')
    onClearSelection?.()
    onPickComposerClose?.()
  }, [onClearSelection, onPickComposerClose])

  const handlePickComposerSubmit = useCallback(
    (text: string) => {
      const value = String(text || '').trim()
      if (!value) {
        pushToast({ title: '请输入需求内容。' })
        return
      }
      const elements = props.selected.filter((el) => !!el.selector)
      if (!elements.length) {
        pushToast({ title: '所选元素无法定位，请重新拾取。' })
        return
      }
      if (elements.length === 1) {
        const el = elements[0]
        enqueue([
          {
            selector: el.selector,
            page: page,
            htmlFile: htmlFile,
            text: value,
            tagName: el.tagName,
          },
        ])
        pushToast({ title: '已加入待提交队列。' })
      } else {
        const batchParts: PickBatchPart[] = elements.map((el) => ({
          selector: el.selector,
          page: page,
          htmlFile: htmlFile,
          label: el.text || el.tagName,
          tagName: el.tagName,
        }))
        const id = queueId()
        // 多选只入一条批量条目；batchParts 留给后续 AI 按元素拆分，本组件绝不直调 AI。
        setQueue((prev) => [
          ...prev,
          {
            id,
            selector: 'batch:' + id,
            page: '',
            text: value,
            tagName: `批量修改（${batchParts.length} 个元素）`,
            selected: true,
            batchParts,
          },
        ])
        pushToast({
          title: `已将 1 条批量需求加入待提交列表（${batchParts.length} 个元素）。`,
        })
      }
      // 提交成功：会话结束，草稿与选择一起清空，下次打开是空白输入条。
      setComposerDraft('')
      onClearSelection?.()
      onPickComposerClose?.()
    },
    [enqueue, htmlFile, onClearSelection, onPickComposerClose, page, props.selected, pushToast],
  )

  const handleComposerSaveAnno = useCallback(
    async (text: string) => {
      const ok = await handleSaveAnno(text)
      if (ok) {
        setComposerDraft('')
        onClearSelection?.()
        onPickComposerClose?.()
      }
      return ok
    },
    [handleSaveAnno, onClearSelection, onPickComposerClose],
  )

  const handleComposerSaveLink = useCallback(
    async (target: string, targetPage: string) => {
      const ok = await handleSaveJump(target, targetPage)
      if (ok) {
        setComposerDraft('')
        onClearSelection?.()
        onPickComposerClose?.()
      }
      return ok
    },
    [handleSaveJump, onClearSelection, onPickComposerClose],
  )

  const handleComposerRemoveLink = useCallback(async () => {
    const ok = await handleRemoveJump()
    if (ok) {
      setComposerDraft('')
      onClearSelection?.()
      onPickComposerClose?.()
    }
    return ok
  }, [handleRemoveJump, onClearSelection, onPickComposerClose])

  /* ── 松开 Ctrl/Cmd+Shift：唯一修改弹窗；「保存到代码」直接改源 HTML 写盘，不入队、不转 AI ── */
  const closePickModify = useCallback(() => {
    const seq = props.pickModifyRequest?.seq ?? 0
    if (seq) setDismissedModifySeq((prev) => (seq > prev ? seq : prev))
    // 修改会话结束并清空选择：需求草稿一并失效，避免带到下一次拾取。
    setComposerDraft('')
    onClearSelection?.()
    onPickModifyClose?.()
  }, [onPickModifyClose, onClearSelection, props.pickModifyRequest])

  const handlePickModifySubmit = useCallback(
    async (text: string): Promise<PickModifySaveResult> => {
      const el = activeModifyRequest?.element || null
      const value = String(text || '').trim()
      // 失败统一收口：toast 具体错误 + 交给弹窗就地展示；弹窗保持打开，绝不入队、绝不转 AI。
      const fail = (message: string): PickModifySaveResult => {
        pushToast({ title: message })
        return { ok: false, error: message }
      }
      if (!el) {
        closePickModify()
        return { ok: true }
      }
      if (!value) return fail('请输入修改后的文本。')
      if (!el.selector) return fail('该元素没有稳定选择器，无法直接修改代码。')
      if (!sandboxDir || !htmlFile) return fail('当前原型缺少代码目录或 HTML 文件，无法保存到代码。')
      if (value === String(el.text || '').trim()) {
        // 内容未变化直接关闭：不读盘、不写盘。
        closePickModify()
        return { ok: true }
      }

      const read = await invokeProtoMethod('sandbox', 'readFile', { dir: sandboxDir, file: htmlFile })
      if (!read.ok) return fail('源文件读取失败：' + (read.error || '未知错误'))
      const readRecord = read as unknown as Record<string, unknown>
      const sourceHtml = typeof readRecord.content === 'string' ? readRecord.content : ''

      const located = locateHtmlTarget(sourceHtml, el.selector, el.pickIndex)
      if (!located.ok) return fail(located.error + '文件：' + htmlFile)
      if (String(located.target.textContent || '').trim() === value) {
        // 源文件已是目标文本：不写盘，直接关闭。
        closePickModify()
        return { ok: true }
      }

      // 只替换元素文本内容，保留元素本身与全部属性（旧 codeEditSave 的最小改写口径）。
      located.target.textContent = value

      let out = ''
      try {
        out = serializeEditedHtml(located.doc, sourceHtml)
      } catch {
        return fail('序列化失败，请重新拾取后再试。')
      }

      const write = await invokeProtoMethod('sandbox', 'write', {
        dir: sandboxDir,
        file: htmlFile,
        content: out,
      })
      if (!write.ok) return fail('写盘失败：' + (write.error || '未知错误'))

      pushToast({ title: '已保存到代码', description: `已写入 ${htmlFile}，预览已刷新。` })
      // 刷新当前源内容 → PreviewFrame 的 srcdoc 重建，预览立即显示新文本。
      void useSourcesStore.getState().refresh()
      closePickModify()
      return { ok: true }
    },
    [activeModifyRequest, closePickModify, htmlFile, pushToast, sandboxDir],
  )

  /* 清空选择（工具栏 ✕）结束本次会话：选择与草稿一起清空。 */
  const handleClearSelection = useCallback(() => {
    setComposerDraft('')
    onClearSelection?.()
  }, [onClearSelection])

  /* chips 删除：删掉最后一个等于清空选择并结束会话，草稿一并清空；其余删除保留草稿。 */
  const handleComposerRemove = useCallback(
    (selector: string) => {
      if (props.selected.length <= 1) setComposerDraft('')
      onRemoveSelection?.(selector)
    },
    [onRemoveSelection, props.selected.length],
  )

  /* ── 确认框统一处理 ── */
  const handleConfirm = useCallback(async () => {
    const state = confirmState
    if (!state) return
    if (state.kind === 'link') {
      await handleDeleteLink(state.link)
    } else if (state.kind === 'queue-clear') {
      handleQueueClear()
      pushToast({ title: '已清空待提交列表。' })
    } else if (state.kind === 'queue-remove') {
      handleQueueRemove(state.id)
      pushToast({ title: '已移除该条待提交。' })
    }
    setConfirmState(null)
  }, [confirmState, handleDeleteLink, handleQueueClear, handleQueueRemove, pushToast])

  const confirmMeta = useMemo(() => {
    if (!confirmState) return { title: '', description: '', confirmText: '确认' }
    if (confirmState.kind === 'link') {
      return {
        title: '删除跳转绑定',
        description: `确定删除「${targetLabel(confirmState.link)}」的跳转绑定吗？`,
        confirmText: '删除',
      }
    }
    if (confirmState.kind === 'queue-clear') {
      return { title: '清空待提交', description: `清空全部 ${queue.length} 条待提交修改？`, confirmText: '清空' }
    }
    return { title: '移除待提交项', description: '确定移除该条待提交修改吗？', confirmText: '移除' }
  }, [confirmState, queue.length])

  /* ── 无源：不渲染任何浮层（Stage 空态由 Stage 自己负责） ── */
  if (!sandboxDir) return null

  // 拾取框仍按页面（client）坐标铺满视口；层级压到文档遮罩（z-40）与 Dialog/Sheet（z-50）之下。
  const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 30 }

  return (
    <div data-testid="preview-overlays" style={overlayStyle}>
      <PickOverlay hover={hoverRect} selected={selectedRects} />

      {/* 标注角标（按选中元素 rect 定位，尊重 PROTO_ANNO_VISIBLE 显隐） */}
      {annoBadges.map(({ anno, rect, no }) => {
        const color = annoColorOf(anno)
        return (
          <span
            key={anno.id}
            data-testid="overlay-anno-badge"
            data-anno-id={anno.id}
            title={anno.content}
            style={{
              position: 'absolute',
              left: Math.round(rect.left) + 'px',
              top: Math.max(0, Math.round(rect.top) - 10) + 'px',
              background: color.bg,
              color: color.fg,
              pointerEvents: 'none',
            }}
            className="flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold shadow"
          >
            {no}
          </span>
        )
      })}

      {/* 标注定位高亮：只高亮元素，不切换 Sheet */}
      {locatedAnno?.rect ? (
        <div
          data-testid="anno-locate-highlight"
          data-anno-id={locatedAnno.id}
          style={{
            position: 'absolute',
            left: Math.round(locatedAnno.rect.left) + 'px',
            top: Math.round(locatedAnno.rect.top) + 'px',
            width: Math.round(locatedAnno.rect.width) + 'px',
            height: Math.round(locatedAnno.rect.height) + 'px',
            boxSizing: 'border-box',
            border: '2px solid #EA580C',
            background: 'rgba(234, 88, 12, 0.10)',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/*
        浮层工具条：portal 到 Stage 子顶栏右侧 slot。
        - 主入口按效果图收敛为「交互 / 标注 / 待提交」，其余编辑工具用图标按钮同排收纳；
        - 不再 fixed right-3 top-14 z-50：既不压 Stage 顶栏，也不会越过文档面板；
        - settingsTab / aiOpen / gitOpen 为真时整条不渲染，避免穿透 Dialog/Sheet 遮罩。
      */}
      {!modalOpen && props.toolbarSlot
        ? createPortal(
            <div
              data-testid="overlays-toolbar"
              role="toolbar"
              aria-label="预览浮层工具"
              style={{ pointerEvents: 'auto' }}
              className="pointer-events-auto flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-background/95 p-0.5 shadow-sm backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <Button
                size="sm"
                variant="ghost"
                data-testid="overlays-open-links"
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                aria-label={`交互：跳转链接（${links.length}）`}
                title={`交互：跳转链接（${links.length}）`}
                onClick={() => setSheet('links')}
              >
                <Link2 aria-hidden="true" className="size-3.5" />
                <span className="hidden xl:inline">交互</span>
                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                  {links.length}
                </Badge>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="overlays-open-anno"
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                aria-label={`标注（${annoItems.length}）`}
                title={`标注（${annoItems.length}）`}
                onClick={() => setSheet('anno')}
              >
                <MessageSquarePlus aria-hidden="true" className="size-3.5" />
                <span className="hidden xl:inline">标注</span>
                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                  {annoItems.length}
                </Badge>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="overlays-open-queue"
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
                aria-label={`待提交（${queue.length}）`}
                title={`待提交（${queue.length}）`}
                onClick={() => setSheet('queue')}
              >
                <Inbox aria-hidden="true" className="size-3.5" />
                <span className="hidden xl:inline">待提交</span>
                <Badge variant={queue.length > 0 ? 'cobalt' : 'outline'} className="h-4 px-1 text-[10px]">
                  {queue.length}
                </Badge>
              </Button>

              <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

              <Button
                size="icon"
                variant="ghost"
                data-testid="overlays-open-snapshot"
                className="size-6 shrink-0"
                aria-label="快照"
                title="快照"
                onClick={() => setSheet('snapshot')}
              >
                <Camera aria-hidden="true" className="size-3.5" />
              </Button>

              {hasSelection ? (
                <>
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
                  <Badge
                    variant="cobalt"
                    data-testid="overlays-selection-count"
                    className="h-4 shrink-0 px-1 text-[10px]"
                    title={`已选 ${props.selected.length} 个元素`}
                  >
                    {props.selected.length}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="overlays-clear-selection"
                    className="size-6 shrink-0"
                    aria-label="清空选择"
                    title="清空选择"
                    onClick={handleClearSelection}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </Button>
                </>
              ) : null}

              {annoLoading || linksLoading ? (
                <span
                  className="shrink-0 px-1 text-[10px] text-muted-foreground"
                  title="正在读取标注/链接…"
                >
                  …
                </span>
              ) : null}
            </div>,
            props.toolbarSlot,
          )
        : null}

      {/*
        松开 Ctrl/Cmd 后的唯一需求输入条：
        - chips 在上、输入框在下；多选一条统一需求，提交为一条批量待提交；
        - 单元素时输入框旁有「标注 / 交互」小面板入口；
        - 底部不再常驻待提交条，输入条位置固定 bottom:1rem；
        - 应用级弹层打开（modalOpen）时整条不渲染，避免 Esc/焦点互抢；
        - W6 修复：portal 到 body + z-50。此前渲染在本容器（z-30）内，z-40 被
          层叠上下文封顶，移动端默认打开的文档面板（z-40）会盖住输入条；
          portal 后与 Sheet/Confirm 同挂 body（本段在前、Sheet 在后，同 z-50
          时后挂者在上），Sheet 遮罩仍能盖住输入条，层级关系与旧实现一致。
      */}
      {!modalOpen && props.pickComposerOpen && typeof document !== 'undefined' ? (
        createPortal(
          <PickComposer
            elements={props.selected}
            annotationContent={currentAnno?.content || ''}
            linkTarget={currentLink?.target || ''}
            linkTargetPage={currentLink?.targetPage || ''}
            linkBound={!!currentLink}
            targetOptions={targetOptions as PickTargetOption[]}
            draft={composerDraft}
            onDraftChange={setComposerDraft}
            onRemove={handleComposerRemove}
            onSubmit={handlePickComposerSubmit}
            onCancel={handlePickComposerCancel}
            onSaveAnnotation={handleComposerSaveAnno}
            onSaveLink={handleComposerSaveLink}
            onRemoveLink={handleComposerRemoveLink}
          />,
          document.body,
        )
      ) : null}

      {/* Sheet/Confirm 统一 portal 到 body：避免继承容器的 pointer-events:none */}
      {typeof document !== 'undefined'
        ? createPortal(
            <>
              <Sheet open={sheet === 'anno'} onOpenChange={(open) => !open && setSheet(null)}>
                <SheetContent
                  side="right"
                  data-testid="overlays-sheet-anno"
                  className="pointer-events-auto flex h-full w-[min(430px,94vw)] flex-col gap-0 p-0"
                >
                  <SheetHeader className="shrink-0 p-4 pb-3 pr-10">
                    <SheetTitle>需求标注</SheetTitle>
                    <SheetDescription>
                      点击条目定位高亮元素；内容在当前面板直接修改并保存，不跳转检查器。
                    </SheetDescription>
                  </SheetHeader>
                  <div data-testid="overlays-anno-scroll" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                    <AnnoPanel
                      items={annoItems}
                      visible={annoVisible}
                      onVisibleChange={handleToggleAnnoVisible}
                      onLocate={handleLocateAnno}
                      locatedId={locatedAnnoId}
                      onSave={handleUpdateAnno}
                      onDelete={handleDeleteAnno}
                    />
                  </div>
                </SheetContent>
              </Sheet>

              <Sheet open={sheet === 'snapshot'} onOpenChange={(open) => !open && setSheet(null)}>
                <SheetContent
                  side="right"
                  data-testid="overlays-sheet-snapshot"
                  className="pointer-events-auto w-[min(430px,94vw)] overflow-y-auto p-4"
                >
                  <SheetHeader className="p-0 pb-3">
                    <SheetTitle>快照</SheetTitle>
                    <SheetDescription>列出当前原型快照（items[].ts），恢复前必须确认。</SheetDescription>
                  </SheetHeader>
                  <SnapshotPanel
                    dir={sandboxDir}
                    onRestored={() => {
                      void useSourcesStore.getState().refresh()
                      void loadAnnos(sandboxDir).then((r) => {
                        if (r.ok) setAnnoItems(r.list)
                      })
                      void loadLinks(sandboxDir).then((r) => {
                        if (r.ok) setLinks(r.links)
                      })
                    }}
                  />
                </SheetContent>
              </Sheet>

              <Sheet open={sheet === 'links'} onOpenChange={(open) => !open && setSheet(null)}>
                <SheetContent
                  side="right"
                  data-testid="overlays-sheet-links"
                  className="pointer-events-auto w-[min(430px,94vw)] overflow-y-auto p-4"
                >
                  <SheetHeader className="p-0 pb-3">
                    <SheetTitle>跳转链接</SheetTitle>
                    <SheetDescription>
                      保存三键：selector + 页面 + html 文件；预览跳转走 W3-02 NAV_JUMP。
                    </SheetDescription>
                  </SheetHeader>
                  {linksLoading ? (
                    <div className="p-4 text-xs text-muted-foreground">正在读取链接…</div>
                  ) : links.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                      当前原型暂无跳转绑定。按住 Ctrl 选中一个元素后，在需求条「交互」面板里绑定目标。
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2" data-testid="overlays-link-list">
                      {links.map((link) => (
                        <div
                          key={linkKey(link)}
                          data-testid="overlays-link-item"
                          data-link-selector={link.selector}
                          className="flex flex-col gap-1 rounded-lg border border-border p-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-medium">
                              {linkButtonName(link) || link.selector}
                            </span>
                            <Badge variant="outline" className="ml-auto shrink-0">
                              {link.page || '首页'}
                            </Badge>
                          </div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground" title={link.selector}>
                            {link.selector}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            跳转至：{targetLabel(link)}
                          </div>
                          <div className="flex gap-2 pt-0.5">
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="overlays-link-jump"
                              onClick={() => handleJumpLink(link)}
                            >
                              预览跳转
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid="overlays-link-delete"
                              onClick={() => setConfirmState({ kind: 'link', link })}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SheetContent>
              </Sheet>

              <Sheet open={sheet === 'queue'} onOpenChange={(open) => !open && setSheet(null)}>
                <SheetContent
                  side="right"
                  data-testid="overlays-sheet-queue"
                  className="pointer-events-auto flex h-full w-[min(430px,94vw)] flex-col gap-0 p-0"
                >
                  <SheetHeader className="shrink-0 p-4 pb-3 pr-10">
                    <SheetTitle>待提交</SheetTitle>
                    <SheetDescription>
                      共 {queue.length} 条；内容可直接编辑，失焦 / Ctrl+Enter 保存，Esc 取消。
                    </SheetDescription>
                  </SheetHeader>
                  <div
                    data-testid="overlays-queue-scroll"
                    className="min-h-0 flex-1 overflow-y-auto px-4 pb-3"
                  >
                    {queue.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                        待提交队列为空。Ctrl 拾取后从底部需求条提交会出现在这里。
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2" data-testid="overlays-queue-list">
                        {queue.map((q, i) => {
                          const meta = q.batchParts?.length
                            ? `批量 · ${q.batchParts.length} 个元素`
                            : `${q.htmlFile ? q.htmlFile + ' · ' : ''}${q.page || '首页'} · ${q.selector}`
                          return (
                            <div
                              key={q.id}
                              data-testid="overlays-queue-item"
                              data-queue-id={q.id}
                              className="flex items-start gap-2 rounded-lg border border-border p-2.5"
                            >
                              <Checkbox
                                checked={q.selected !== false}
                                onCheckedChange={(v) => handleQueueToggle(q.id, v)}
                                aria-label="选中该条待提交"
                                className="mt-0.5"
                              />
                              <div className="flex min-w-0 flex-1 items-start gap-1">
                                <span className="mt-1 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                  {i + 1}.
                                </span>
                                <div className="min-w-0 flex-1">
                                  <QueueTextEditor id={q.id} text={q.text} onSave={handleQueueEdit} />
                                  <div
                                    data-testid="overlays-queue-meta"
                                    className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                                    title={q.selector}
                                  >
                                    {meta}
                                  </div>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid="overlays-queue-remove"
                                onClick={() => setConfirmState({ kind: 'queue-remove', id: q.id })}
                              >
                                移除
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {queue.length > 0 ? (
                    <div
                      data-testid="overlays-queue-footer"
                      className="flex shrink-0 gap-2 border-t border-border bg-background p-3"
                    >
                      <Button size="sm" onClick={handleQueueSubmit} data-testid="overlays-queue-submit">
                        提交已选（{queue.filter((q) => q.selected !== false).length}）
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="overlays-queue-clear"
                        onClick={() => setConfirmState({ kind: 'queue-clear' })}
                      >
                        清空
                      </Button>
                    </div>
                  ) : null}
                </SheetContent>
              </Sheet>

              {activeModifyRequest ? (
                <PickModifyDialog
                  key={'pick-mod:' + activeModifyRequest.seq + ':' + activeModifyRequest.element.selector}
                  open
                  element={activeModifyRequest.element}
                  onSubmit={handlePickModifySubmit}
                  onCancel={closePickModify}
                />
              ) : null}

              <Confirm
                open={confirmState !== null}
                onOpenChange={(next) => !next && setConfirmState(null)}
                title={confirmMeta.title}
                description={confirmMeta.description}
                confirmText={confirmMeta.confirmText}
                onConfirm={handleConfirm}
              />
            </>,
            document.body,
          )
        : null}
    </div>
  )
}
