/**
 * src/renderer/stores/sources-store.ts — W3-01 数据底座：项目 / 原型 / 当前源。
 *
 * 对应旧渲染层：
 * - 项目列表：`js/project-ai-export.js:7961-7971`（`sandbox.projects()`）
 * - 进入项目：`js/project-ai-export.js:8053-8062`（写 `protoLastProject` + 拉原型列表）
 * - 原型列表 / 源对象：`js/project-ai-export.js:8081-8194`（`sandbox.list` + `SourceRef`）
 * - 切源：`js/sandbox-core.js:87-131`（`loadSource`）
 * - 切子页：`js/sandbox-core.js:461-502`（`sandbox.readFile`）
 *
 * 接口冻结（W3-02/03/04/05/07/08 只读消费，不得改名）：
 * - SourceRef：name/displayName/kind/sandboxDir/mainHtmlFile/mdFile/subPages/htmlFiles/
 *   content/md/pages/__ver（逐字对齐 `project-ai-export.js:8125-8127` + `js/store.js:49-56`）
 * - useSourcesStore selectors：sources/currentSource/loading/error
 * - actions：loadProjects() / enterProject(name) / loadSources(project, selectName?) /
 *   selectSource(name) / selectSubPage(file) / refresh()
 *
 * 所有 IPC 均走 `window.protoAPI.sandbox`（不新增通道、不改契约）：
 * - `sandbox:projects` / `sandbox:list` 是旧“裸载荷”通道（无 `ok` 字段），经本文件
 *   `invokeSandboxPayload` 取原始载荷；其余动作统一经 `invokeProtoMethod('sandbox', ...)`。
 */

import { create } from "zustand"
import { getProtoApi, invokeProtoMethod, ipcErrorText } from "@/lib/ipc"
import { migrateLegacyGroups } from "@/lib/legacy-migrate"
import {
  ORDER_KEY,
  PROTO_LAST_PROJECT,
  SUB_ORDER_KEY,
  loadGroupsData,
  readJson,
  removeKey,
  saveGroupsData,
  writeJson,
  writeText,
} from "@/lib/storage-keys"
import { useAppStore } from "@/stores/app-store"

/** 端别：pc = 桌面端，mobile = 移动端。 */
export type SourceKind = "pc" | "mobile"

/** 原型子页面（沙箱列表返回口径）。 */
export interface SourceSubPage {
  /** 文件名（含 .html）。 */
  file: string
  /** 无扩展名的显示名。 */
  name: string
}

/**
 * 当前源对象（冻结契约，逐字对齐旧 `project-ai-export.js:8125-8127`）。
 * `activeSubFile` 为旧源对象的动态字段（切子页用，W3-07 读取），保持可选、不破坏冻结字段。
 */
export interface SourceRef {
  /** 主 html 文件名（源身份）。 */
  name: string
  /** 原型文件夹名（侧栏显示名）。 */
  displayName: string
  /** 端别（文件名优先 + 内容启发式）。 */
  kind: SourceKind
  /** 沙箱目录绝对路径。 */
  sandboxDir: string
  /** 主 html 文件名（与 name 一致，旧字段保留）。 */
  mainHtmlFile: string
  /** 同目录 md 文件名；无 md 为 null。 */
  mdFile: string | null
  /** 子页面清单。 */
  subPages: SourceSubPage[]
  /** 目录内全部 html 文件名。 */
  htmlFiles: string[]
  /** 主 html 内容。 */
  content: string
  /** md 内容（无 md 为空串；是否存在看 mdFile）。 */
  md: string
  /** 主 html 解析出的页面路由清单（extractPages）。 */
  pages: string[]
  /** 保存守卫版本号（切源 +1，对应 js/store.js bumpVer）。 */
  __ver: number
  /** 当前子页文件；主页时等于 mainHtmlFile。 */
  activeSubFile?: string
  /** 当前子页内容（主页时为空串；W3-02 预览取 `activeContent || content`）。 */
  activeContent?: string
}

/** 项目列表条目（sandbox:projects 返回口径）。 */
export interface ProjectInfo {
  /** 项目名（磁盘文件夹名）。 */
  name: string
  /** 原型文件夹数量。 */
  protoCount: number
}

/** 侧栏文件夹（持久化在 `protoGroups_v1__<project>`）。 */
export interface ProtoGroup {
  /** 稳定 id（拖拽/重命名期间不变）。 */
  id: string
  /** 显示名。 */
  name: string
  /** 父文件夹 id；根文件夹为 null。 */
  parent: string | null
}

/** 分组数据形态（与 storage-keys.loadGroupsData 返回一致）。 */
export interface ProtoGroupsData {
  list: ProtoGroup[]
  /** 原型 stable key → 文件夹 id。 */
  map: Record<string, string>
}

/** `protoOrder_v1` 形态：project → groupId|'ungrouped' → 原型 stable key 数组。 */
export type ProtoOrderMap = Record<string, Record<string, string[]>>

/** `subPageOrder_v1` 形态：sandboxDir → 子页文件名数组。 */
export type SubPageOrderMap = Record<string, string[]>

/** 插入位置：目标之前 / 目标之后。 */
export type DropPosition = "before" | "after"

/** 轻量操作结果（供 Sidebar / ProjectPicker 判断成功失败）。 */
export interface SourcesActionResult {
  ok: boolean
  error?: string
  /** 新建/改名后的名称（成功时）。 */
  name?: string
  /** 新建文件夹时的 id（成功时）。 */
  id?: string
}

/** 沙箱列表文件夹原始条目（只取本包用到的字段）。 */
interface SandboxFolder {
  name: string
  dir: string
  htmlFile: string | null
  html: string | null
  mdFile: string | null
  md: string | null
  subPages: SourceSubPage[]
  htmlFiles: string[]
}

export interface SourcesState {
  /** 当前项目（空串 = 未进入）。 */
  project: string
  /** 项目列表（ProjectPicker 用）。 */
  projects: ProjectInfo[]
  /** 当前项目全部原型源。 */
  sources: SourceRef[]
  /** 当前源（空项目为 null）。 */
  currentSource: SourceRef | null
  /** 当前子页文件（主页时等于 mainHtmlFile）。 */
  activeSubFile: string
  /** 当前子页内容（主页时为空串）。 */
  activeContent: string
  /** 拉项目/原型列表进行中。 */
  loading: boolean
  /** 最近一次错误文案（空串 = 无错误）。 */
  error: string
  /** 项目选择器是否打开（冷启动无 last project 时由 ProjectPicker 打开）。 */
  pickerOpen: boolean
  openProjectPicker: () => void
  closeProjectPicker: () => void
  /** 拉项目列表（sandbox.projects）。 */
  loadProjects: () => Promise<ProjectInfo[]>
  /** 进入项目：写 protoLastProject + 迁移裸键 + 拉原型列表。 */
  enterProject: (name: string) => Promise<void>
  /** 拉指定项目的原型列表并构造 SourceRef；selectName 用于新建后选中。 */
  loadSources: (project: string, selectName?: string) => Promise<void>
  /** 按文件名/显示名/目录切换当前源（回到主页）。 */
  selectSource: (name: string) => void
  /** 切换子页（读 sandbox:read-file）；传主页文件名则回主页。 */
  selectSubPage: (file: string) => Promise<void>
  /** 重新拉当前项目列表并尽量保留当前源/子页。 */
  refresh: () => Promise<void>
  /**
   * 新建子页成功后：刷新父原型 subPages/htmlFiles，并选中新子页。
   * 父原型不是当前源时先切到父源，避免 `selectSubPage` 报「子页面不存在」。
   * @returns 是否已切到新子页
   */
  syncCreatedSubPage: (dir: string, file: string, name?: string) => Promise<boolean>
  /** 排序版本号：侧栏监听后重读 protoOrder_v1 / subPageOrder_v1。 */
  orderRevision: number
  /** 文件夹版本号：侧栏监听后重读 protoGroups_v1（顺序/层级/map 均会变）。 */
  folderRevision: number
  /** 同组内重排一级原型（持久化 protoOrder_v1）。 */
  reorderProto: (
    gid: string,
    fromKey: string,
    toKey: string,
    position: DropPosition
  ) => boolean
  /** 一级原型跨文件夹移动（同时改分组 map 与 protoOrder_v1）；beforeKey 为空表示追加到末尾。 */
  moveProtoToGroup: (key: string, gid: string, beforeKey?: string | null) => boolean
  /** 原型改名后同步分组 map / 排序键（避免改名后掉出文件夹）。 */
  remapProtoKey: (oldKey: string, newKey: string) => boolean
  /** 同目录内重排子页（持久化 subPageOrder_v1）。 */
  reorderSubPage: (
    dir: string,
    fromFile: string,
    toFile: string,
    position: DropPosition
  ) => boolean
  /** 新建文件夹（parent 为空 = 根目录）。 */
  createFolder: (name: string, parent?: string | null) => SourcesActionResult
  /** 重命名文件夹。 */
  renameFolder: (id: string, name: string) => SourcesActionResult
  /** 删除文件夹（子文件夹一并删除，原型移到未分组，不删原型文件）。 */
  removeFolder: (id: string) => SourcesActionResult
  /** 移动文件夹到指定父级；beforeId 为空表示追加到同级末尾。 */
  moveFolder: (id: string, parent?: string | null, beforeId?: string | null) => SourcesActionResult
  /** 新建项目（project:create）。 */
  createProject: (name: string) => Promise<SourcesActionResult>
  /** 重命名项目（project:rename）。 */
  renameProject: (oldName: string, name: string) => Promise<SourcesActionResult>
  /** 删除项目（project:remove；默认项目拒绝）。 */
  removeProject: (name: string) => Promise<SourcesActionResult>
}

/* ═══════════ 纯函数：端别推断 / 页面提取（逐字移植旧实现） ═══════════ */

/**
 * 端别推断（逐字移植 `js/sandbox-core.js:28-38 detectKind`）。
 * @param html html 内容
 * @returns mobile 或 pc
 */
export function detectKind(html: string): SourceKind {
  const s = String(html || "")
  const vp = /<meta[^>]*name=["']?viewport["']?[^>]*>/i.exec(s)
  const vpMobile = !!(vp && /width\s*=\s*device-width/i.test(vp[0]))
  let score = 0
  if (vpMobile) score += 2 /* 移动视口 */
  if (/@media\s*\(\s*max-width/i.test(s)) score += 1 /* 移动优先自适应 */
  if (/(iphone|ipad|android|touch-action|-webkit-tap-highlight|device-width|user-scalable)/i.test(s)) score += 1
  if (/@media\s*\(\s*min-width:\s*(6[4-9]\d|7\d\d|8\d\d|9\d\d|1[0-2]\d\d)/i.test(s)) score -= 2 /* 明显桌面断点 */
  return score > 0 ? "mobile" : "pc"
}

/**
 * 端别判定：文件名优先，其次按内容启发式（逐字移植 `js/sandbox-core.js:42-47 detectKindByName`）。
 * @param name 文件名/目录名
 * @param content html 内容
 * @returns mobile 或 pc
 */
export function detectKindByName(name: string, content: string): SourceKind {
  const n = String(name || "")
  if (/移动/.test(n)) return "mobile"
  if (/\bpc\b/i.test(n.replace(/[-_]/g, " "))) return "pc"
  return detectKind(content)
}

/**
 * 从 html 静态解析页面路由清单（逐字移植 `js/nav-zoom.js:12-26 extractPages`）。
 * @param content html 内容
 * @returns 页面 key 列表（去重保序）
 */
export function extractPages(content: string): string[] {
  const s = String(content || "")
  const pages: string[] = []
  const seen: Record<string, boolean> = {}
  function add(p: string): void {
    if (!p || seen[p]) return
    seen[p] = true
    pages.push(p)
  }
  let m: RegExpExecArray | null
  // A) #-锚定的 hash 路由 token（如 #page-chat、#detail/LV、href="#form/.."）
  const reA = /#([A-Za-z][A-Za-z0-9_\-/]*)/gi
  while ((m = reA.exec(s))) {
    const r = m[1].replace(/\?.*$/, "")
    if (/^(page-|detail|form|doc|list|chat|proj|fund|report)/i.test(r)) add(r)
  }
  // B) 页面根容器：switchRoot/push/showPage 的参数（page-xxx）
  const reB = /(?:switchRoot|push|showPage)\(\s*['"](page-[a-z]+)['"]\s*\)/gi
  while ((m = reB.exec(s))) add(m[1])
  return pages
}

/* ═══════════ 归一化 helpers ═══════════ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return typeof value === "string" ? value : String(value)
}

function asNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeSubPages(value: unknown): SourceSubPage[] {
  if (!Array.isArray(value)) return []
  const out: SourceSubPage[] = []
  for (const item of value) {
    const rec = asRecord(item)
    const file = asText(rec?.file).trim()
    if (!file) continue
    out.push({ file, name: asText(rec?.name).trim() || file.replace(/\.html$/i, "") })
  }
  return out
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => asText(v)).filter((v) => v.length > 0)
}

function normalizeProjects(value: unknown): ProjectInfo[] {
  if (!Array.isArray(value)) return []
  const out: ProjectInfo[] = []
  for (const item of value) {
    const rec = asRecord(item)
    const name = asText(rec?.name).trim()
    if (!name) continue
    out.push({ name, protoCount: Math.max(0, Math.trunc(asNumber(rec?.protoCount))) })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  return out
}

function normalizeFolders(value: unknown): SandboxFolder[] {
  if (!Array.isArray(value)) return []
  const out: SandboxFolder[] = []
  for (const item of value) {
    const rec = asRecord(item)
    if (!rec) continue
    const folder: SandboxFolder = {
      name: asText(rec.name).trim(),
      dir: asText(rec.dir),
      htmlFile: asText(rec.htmlFile).trim() || null,
      html: typeof rec.html === "string" ? rec.html : null,
      mdFile: asText(rec.mdFile).trim() || null,
      md: typeof rec.md === "string" ? rec.md : null,
      subPages: normalizeSubPages(rec.subPages),
      htmlFiles: normalizeStringList(rec.htmlFiles),
    }
    if (!folder.name || !folder.dir) continue
    out.push(folder)
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  return out
}

/** 源身份：优先 sandboxDir，其次 name（对应 js/store.js sourceIdOf 口径）。 */
function sameSource(a: SourceRef | null, b: SourceRef | null): boolean {
  if (!a || !b) return false
  if (a.sandboxDir && b.sandboxDir) return a.sandboxDir === b.sandboxDir
  return !!a.name && a.name === b.name
}

function findSource(list: SourceRef[], key: string): SourceRef | null {
  const k = String(key || "").trim()
  if (!k) return null
  return (
    list.find(
      (s) =>
        s.name === k ||
        s.mainHtmlFile === k ||
        s.displayName === k ||
        s.sandboxDir === k ||
        s.name === k + ".html"
    ) ?? null
  )
}

function bumpVersion(source: SourceRef): SourceRef {
  return { ...source, __ver: (Number(source.__ver) || 0) + 1 }
}

/**
 * 原型在分组/排序里的稳定 key（逐字沿用 `js/sandbox-core.js:229 groupKeyOf`）。
 * 兼容 SourceRef 与侧栏传入的最小对象。
 */
export function protoGroupKey(
  source: Pick<SourceRef, "displayName" | "name" | "sandboxDir">
): string {
  return String(source.displayName || source.name || source.sandboxDir || "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeProtoOrder(value: unknown): ProtoOrderMap {
  if (!isRecord(value)) return {}
  const out: ProtoOrderMap = {}
  for (const [project, rawGroupMap] of Object.entries(value)) {
    if (!isRecord(rawGroupMap)) continue
    const groupMap: Record<string, string[]> = {}
    for (const [gid, rawKeys] of Object.entries(rawGroupMap)) {
      if (!Array.isArray(rawKeys)) continue
      groupMap[gid] = rawKeys.filter((key): key is string => typeof key === "string")
    }
    out[project] = groupMap
  }
  return out
}

function normalizeSubOrder(value: unknown): SubPageOrderMap {
  if (!isRecord(value)) return {}
  const out: SubPageOrderMap = {}
  for (const [dir, rawFiles] of Object.entries(value)) {
    if (!Array.isArray(rawFiles)) continue
    out[dir] = rawFiles.filter((file): file is string => typeof file === "string")
  }
  return out
}

function readProtoOrder(): ProtoOrderMap {
  return normalizeProtoOrder(readJson(ORDER_KEY, null))
}

function writeProtoOrder(map: ProtoOrderMap): void {
  writeJson(ORDER_KEY, map)
}

function readSubOrder(): SubPageOrderMap {
  return normalizeSubOrder(readJson(SUB_ORDER_KEY, null))
}

function writeSubOrder(map: SubPageOrderMap): void {
  writeJson(SUB_ORDER_KEY, map)
}

function groupIdOfSource(source: SourceRef, groups: ProtoGroupsData): string {
  const gid = String(groups.map[protoGroupKey(source)] || "")
  return gid && groups.list.some((group) => group.id === gid) ? gid : ""
}

/** 按持久化 key 排序；缺失项按 zh-CN 名称补在末尾（旧 getOrderedProtos 同口径）。 */
function orderSources(list: SourceRef[], stored: string[]): SourceRef[] {
  const sorted = list
    .slice()
    .sort((a, b) =>
      String(a.displayName || a.name).localeCompare(String(b.displayName || b.name), "zh-CN")
    )
  if (!stored.length) return sorted
  const byKey = new Map<string, SourceRef>()
  sorted.forEach((source) => byKey.set(protoGroupKey(source), source))
  const out: SourceRef[] = []
  for (const key of stored) {
    const source = byKey.get(key)
    if (source) {
      out.push(source)
      byKey.delete(key)
    }
  }
  const remain = Array.from(byKey.values()).sort((a, b) =>
    String(a.displayName || a.name).localeCompare(String(b.displayName || b.name), "zh-CN")
  )
  return out.concat(remain)
}

/** 按持久化文件名排序子页；缺失项按 zh-CN 名称补在末尾。 */
function orderSubPages(list: SourceSubPage[], stored: string[]): SourceSubPage[] {
  const sorted = list
    .slice()
    .sort((a, b) => String(a.name || a.file).localeCompare(String(b.name || b.file), "zh-CN"))
  if (!stored.length) return sorted
  const byFile = new Map<string, SourceSubPage>()
  sorted.forEach((sub) => byFile.set(sub.file, sub))
  const out: SourceSubPage[] = []
  for (const file of stored) {
    const sub = byFile.get(file)
    if (sub) {
      out.push(sub)
      byFile.delete(file)
    }
  }
  const remain = Array.from(byFile.values()).sort((a, b) =>
    String(a.name || a.file).localeCompare(String(b.name || b.file), "zh-CN")
  )
  return out.concat(remain)
}

/** 把 from 移到 to 之前/之后；from 或 to 不存在时原样返回。 */
export function moveKey(
  keys: string[],
  from: string,
  to: string,
  position: DropPosition
): string[] {
  if (from === to) return keys.slice()
  const fromIdx = keys.indexOf(from)
  if (fromIdx < 0) return keys.slice()
  const arr = keys.slice()
  arr.splice(fromIdx, 1)
  const toIdx = arr.indexOf(to)
  if (toIdx < 0) return keys.slice()
  arr.splice(position === "after" ? toIdx + 1 : toIdx, 0, from)
  return arr
}

function sameFolderName(
  list: ProtoGroup[],
  parent: string | null,
  name: string,
  exceptId?: string
): boolean {
  return list.some(
    (group) =>
      group.id !== exceptId &&
      (group.parent || null) === parent &&
      group.name.localeCompare(name, "zh-CN", { sensitivity: "accent" }) === 0
  )
}

function folderChainHas(list: ProtoGroup[], groupId: string, ancestorId: string): boolean {
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

/** 由沙箱列表条目构造 SourceRef（逐字对齐 project-ai-export.js:8125-8127）。 */
function sourceFromFolder(folder: SandboxFolder, previous: SourceRef | null): SourceRef {
  const name = folder.htmlFile as string
  const html = folder.html ?? ""
  return {
    name,
    displayName: folder.name,
    kind: previous ? previous.kind : detectKindByName(name, html),
    sandboxDir: folder.dir,
    mainHtmlFile: folder.htmlFile as string,
    mdFile: folder.mdFile,
    subPages: folder.subPages.map((sp) => ({ ...sp })),
    htmlFiles: folder.htmlFiles.slice(),
    content: html,
    md: folder.md ?? "",
    pages: html ? extractPages(html) : [],
    __ver: previous ? Number(previous.__ver) || 0 : 0,
    activeSubFile: name,
    activeContent: "",
  }
}

/* ═══════════ app-store 同步（project/proto/page/kind 单向写入） ═══════════ */

function syncSelection(source: SourceRef | null, sub?: { file: string; content?: string }): void {
  const app = useAppStore.getState()
  if (!source) {
    app.setProto("")
    app.setPage("")
    return
  }
  app.setProto(source.displayName || source.name)
  app.setKind(source.kind)
  const subFile = sub?.file || ""
  if (subFile && subFile !== source.mainHtmlFile) {
    const subPages = sub?.content ? extractPages(sub.content) : []
    const sp = source.subPages.find((item) => item.file === subFile)
    app.setPage(subPages[0] || sp?.name || subFile.replace(/\.html$/i, ""))
  } else {
    app.setPage(source.pages[0] || "")
  }
}

function errorText(r: { error?: string } | null, fallback: string): string {
  return (r && r.error) || fallback
}

/**
 * 读取“裸载荷”通道（sandbox:projects / sandbox:list）。
 *
 * 这两个通道沿用旧契约，直接返回 `{root, projects}` / `{root, folders}`，没有 `ok` 字段；
 * `invokeProtoMethod` 会把无 `ok` 的对象归一化成 `{ok:false,error:'bad-ipc-result'}` 并丢失载荷
 * （见 `lib/ipc.ts normalizeIpcResult`，且该文件不归 W3-01 修改）。这里保留同一网关取函数 +
 * try/catch 语义，直接从 `window.protoAPI.sandbox` 取原始载荷，不新增通道、不改主进程契约。
 */
async function invokeSandboxPayload<T>(
  method: "projects" | "list",
  ...args: unknown[]
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const api = getProtoApi()
  const space: unknown = api ? api["sandbox"] : undefined
  const fn: unknown =
    space && typeof space === "object"
      ? (space as Record<string, unknown>)[method]
      : undefined
  if (typeof fn !== "function") {
    return { ok: false, error: "missing protoAPI: sandbox." + method }
  }
  try {
    const data = await (fn as (...a: unknown[]) => unknown).apply(space, args)
    return { ok: true, data: data as T }
  } catch (err) {
    return { ok: false, error: ipcErrorText(err) }
  }
}

function toResult(r: { ok: boolean; error?: string; name?: unknown }): SourcesActionResult {
  return r.ok
    ? { ok: true, name: typeof r.name === "string" ? r.name : undefined }
    : { ok: false, error: r.error || "操作失败" }
}

/* ═══════════ store ═══════════ */

/** 原型列表请求序号：快速切项目时丢弃旧请求结果，防止串项目。 */
let sourcesLoadSeq = 0

export interface SourcesStoreHook {
  (): SourcesState
  <S>(selector: (s: SourcesState) => S): S
  getState: () => SourcesState
  setState: (
    partial: Partial<SourcesState> | ((s: SourcesState) => Partial<SourcesState>)
  ) => void
  subscribe: (listener: () => void) => () => void
}

export const useSourcesStore: SourcesStoreHook = create<SourcesState>()((set, get) => ({
  project: "",
  projects: [],
  sources: [],
  currentSource: null,
  activeSubFile: "",
  activeContent: "",
  loading: false,
  error: "",
  pickerOpen: false,
  orderRevision: 0,
  folderRevision: 0,

  openProjectPicker: () => set({ pickerOpen: true }),
  closeProjectPicker: () => set({ pickerOpen: false }),

  loadProjects: async () => {
    set({ loading: true, error: "" })
    const r = await invokeSandboxPayload<{ projects?: unknown }>("projects")
    if (!r.ok) {
      set({ loading: false, error: errorText(r, "加载项目列表失败") })
      return []
    }
    const projects = normalizeProjects(r.data?.projects)
    set({ projects, loading: false })
    return projects
  },

  enterProject: async (name) => {
    const project = String(name || "").trim()
    if (!project) return
    migrateLegacyGroups(project)
    writeText(PROTO_LAST_PROJECT, project)
    set({
      project,
      // 切项目必须清空旧项目残留（对应旧 loadSandboxSources 空项目清理思路）。
      sources: [],
      currentSource: null,
      activeSubFile: "",
      activeContent: "",
      error: "",
      pickerOpen: false,
    })
    const app = useAppStore.getState()
    app.setProject(project)
    app.setProto("")
    app.setPage("")
    await get().loadSources(project)
  },

  loadSources: async (project, selectName) => {
    const p = String(project || "").trim()
    if (!p) {
      sourcesLoadSeq += 1
      set({
        project: "",
        sources: [],
        currentSource: null,
        activeSubFile: "",
        activeContent: "",
        loading: false,
        error: "",
      })
      const app = useAppStore.getState()
      app.setProject("")
      app.setProto("")
      app.setPage("")
      return
    }
    migrateLegacyGroups(p)
    const seq = ++sourcesLoadSeq
    const switching = get().project !== p
    const previousSources = switching ? [] : get().sources
    const previousCurrent = switching ? null : get().currentSource
    set({
      project: p,
      loading: true,
      error: "",
      ...(switching
        ? { sources: [], currentSource: null, activeSubFile: "", activeContent: "" }
        : {}),
    })

    const r = await invokeSandboxPayload<{ folders?: unknown }>("list", p)
    if (seq !== sourcesLoadSeq) return
    if (!r.ok) {
      set({ loading: false, error: errorText(r, "加载原型列表失败") })
      return
    }
    const folders = normalizeFolders(r.data?.folders)
    const built: SourceRef[] = []
    for (const folder of folders) {
      // 无 html 的文件夹不作为原型源（仍可作为沙箱工作区，旧实现同口径）。
      if (!folder.htmlFile) continue
      const prev =
        previousSources.find(
          (s) => s.sandboxDir === folder.dir || s.name === folder.htmlFile
        ) ?? null
      built.push(sourceFromFolder(folder, prev))
    }

    let next: SourceRef | null = null
    if (selectName) next = findSource(built, selectName)
    if (!next && previousCurrent) next = built.find((s) => sameSource(s, previousCurrent)) ?? null
    if (!next) next = built[0] ?? null
    if (next) next = bumpVersion(next)

    const sources = built.map((s) => (next && sameSource(s, next) ? next : s))
    set({
      project: p,
      sources,
      currentSource: next,
      activeSubFile: next?.mainHtmlFile || "",
      activeContent: "",
      loading: false,
      error: "",
    })
    useAppStore.getState().setProject(p)
    syncSelection(next)
  },

  selectSource: (name) => {
    const src = findSource(get().sources, name)
    if (!src) return
    const main = src.mainHtmlFile || src.name
    const next = bumpVersion({ ...src, activeSubFile: main, activeContent: "" })
    set((state) => ({
      sources: state.sources.map((s) => (sameSource(s, next) ? next : s)),
      currentSource: next,
      activeSubFile: main,
      activeContent: "",
      error: "",
    }))
    syncSelection(next)
  },

  selectSubPage: async (file) => {
    const cur = get().currentSource
    if (!cur) return
    const f = String(file || "").trim()
    const main = cur.mainHtmlFile || cur.name
    if (!f || f === main || f === cur.name) {
      const next = { ...cur, activeSubFile: main, activeContent: "" }
      set((state) => ({
        sources: state.sources.map((s) => (sameSource(s, next) ? next : s)),
        currentSource: next,
        activeSubFile: main,
        activeContent: "",
        error: "",
      }))
      syncSelection(next)
      return
    }
    if (!cur.subPages.some((sp) => sp.file === f)) {
      set({ error: "子页面不存在：" + f })
      return
    }
    set({ loading: true, error: "" })
    const r = await invokeProtoMethod("sandbox", "readFile", { dir: cur.sandboxDir, file: f })
    if (!r.ok) {
      set({ loading: false, error: errorText(r, "读取子页面失败") })
      return
    }
    const content = asText((r as unknown as Record<string, unknown>).content)
    const current = get().currentSource
    // 异步读文件期间已切源：丢弃结果，防止串源（对应旧 loadSource 的切源守卫思路）。
    if (!current || !sameSource(current, cur)) {
      set({ loading: false })
      return
    }
    const next = { ...current, activeSubFile: f, activeContent: content }
    set((state) => ({
      sources: state.sources.map((s) => (sameSource(s, next) ? next : s)),
      currentSource: next,
      activeSubFile: f,
      activeContent: content,
      loading: false,
      error: "",
    }))
    syncSelection(next, { file: f, content })
  },

  refresh: async () => {
    const { project, currentSource, activeSubFile } = get()
    if (!project) return
    const selectName = currentSource?.displayName || currentSource?.name || ""
    const main = currentSource?.mainHtmlFile || currentSource?.name || ""
    const sub = activeSubFile && activeSubFile !== main ? activeSubFile : ""
    await get().loadSources(project, selectName)
    if (sub) {
      const src = get().currentSource
      if (src && src.subPages.some((sp) => sp.file === sub)) {
        await get().selectSubPage(sub)
      }
    }
  },

  syncCreatedSubPage: async (dir, file, name) => {
    const targetDir = String(dir || "").trim()
    if (!targetDir) return false
    const project = get().project
    if (!project) return false
    // 只处理已加载的父原型；菜单入口的 source 必然来自 sources。
    if (!get().sources.some((source) => source.sandboxDir === targetDir)) return false

    // 以 sandboxDir 精确选中父原型；loadSources 同时刷新它的 subPages/htmlFiles。
    await get().loadSources(project, targetDir)
    if (get().project !== project) return false
    let current = get().currentSource
    if (!current || current.sandboxDir !== targetDir) {
      // 列表刷新失败时沿用已加载的父源，别把“创建成功”变成“子页面不存在”。
      get().selectSource(targetDir)
      current = get().currentSource
    }
    if (!current || current.sandboxDir !== targetDir) return false

    const createdName = String(name || "").trim()
    const targetFile =
      String(file || "").trim() ||
      current.subPages.find(
        (sub) =>
          (!!createdName && sub.name === createdName) ||
          (!!createdName && sub.file.replace(/\.html$/i, "") === createdName)
      )?.file ||
      ""
    if (!targetFile) return false

    if (!current.subPages.some((sub) => sub.file === targetFile)) {
      // sandbox:list 偶发尚未收录新文件：先补入 UI 状态，真实存在性由 readFile 判定。
      const next: SourceRef = {
        ...current,
        subPages: current.subPages.concat({
          file: targetFile,
          name: createdName || targetFile.replace(/\.html$/i, ""),
        }),
        htmlFiles: current.htmlFiles.includes(targetFile)
          ? current.htmlFiles
          : current.htmlFiles.concat(targetFile),
      }
      set((state) => ({
        sources: state.sources.map((source) => (sameSource(source, next) ? next : source)),
        currentSource: next,
      }))
    }

    await get().selectSubPage(targetFile)
    return get().activeSubFile === targetFile
  },

  reorderProto: (gid, fromKey, toKey, position) => {
    const state = get()
    const project = state.project
    if (!project || !fromKey || !toKey) return false
    const groups = loadGroupsData(project)
    const groupId = String(gid || "")
    if (groupId && !groups.list.some((group) => group.id === groupId)) return false
    const order = readProtoOrder()
    const projectOrder = order[project] || {}
    const orderKey = groupId || "ungrouped"
    const inGroup = state.sources.filter((source) => groupIdOfSource(source, groups) === groupId)
    if (!inGroup.some((source) => protoGroupKey(source) === fromKey)) return false
    if (!inGroup.some((source) => protoGroupKey(source) === toKey)) return false
    const current = orderSources(inGroup, projectOrder[orderKey] || []).map(protoGroupKey)
    const next = moveKey(current, fromKey, toKey, position)
    if (next.join("\u0000") === current.join("\u0000")) return false
    projectOrder[orderKey] = next
    order[project] = projectOrder
    writeProtoOrder(order)
    set({ orderRevision: state.orderRevision + 1 })
    return true
  },

  moveProtoToGroup: (key, gid, beforeKey) => {
    const state = get()
    const project = state.project
    const sourceKey = String(key || "")
    if (!project || !sourceKey) return false
    const source = state.sources.find((item) => protoGroupKey(item) === sourceKey)
    if (!source) return false
    const groups = loadGroupsData(project)
    const targetGid = String(gid || "")
    if (targetGid && !groups.list.some((group) => group.id === targetGid)) return false
    if (targetGid) groups.map[sourceKey] = targetGid
    else delete groups.map[sourceKey]
    saveGroupsData(project, groups)

    const order = readProtoOrder()
    const projectOrder = order[project] || {}
    // 先从所有分组数组移除，避免跨组后在同 key 上重复出现。
    for (const orderGid of Object.keys(projectOrder)) {
      projectOrder[orderGid] = (projectOrder[orderGid] || []).filter((item) => item !== sourceKey)
    }
    const orderKey = targetGid || "ungrouped"
    const targetSources = state.sources.filter(
      (item) => groupIdOfSource(item, groups) === targetGid
    )
    const keys = orderSources(targetSources, projectOrder[orderKey] || [])
      .map(protoGroupKey)
      .filter((item) => item !== sourceKey)
    const anchor = String(beforeKey || "")
    const at = anchor ? keys.indexOf(anchor) : -1
    if (at >= 0) keys.splice(at, 0, sourceKey)
    else keys.push(sourceKey)
    projectOrder[orderKey] = keys
    order[project] = projectOrder
    writeProtoOrder(order)
    set({
      orderRevision: state.orderRevision + 1,
      folderRevision: state.folderRevision + 1,
    })
    return true
  },

  remapProtoKey: (oldKey, newKey) => {
    const state = get()
    const project = state.project
    const from = String(oldKey || "")
    const to = String(newKey || "")
    if (!project || !from || !to || from === to) return false
    let changed = false

    const groups = loadGroupsData(project)
    if (Object.prototype.hasOwnProperty.call(groups.map, from)) {
      groups.map[to] = groups.map[from]
      delete groups.map[from]
      saveGroupsData(project, groups)
      changed = true
    }

    const order = readProtoOrder()
    const projectOrder = order[project]
    if (projectOrder) {
      for (const gid of Object.keys(projectOrder)) {
        const keys = projectOrder[gid] || []
        if (!keys.includes(from)) continue
        const next: string[] = []
        for (const key of keys) {
          const mapped = key === from ? to : key
          if (!next.includes(mapped)) next.push(mapped)
        }
        projectOrder[gid] = next
        changed = true
      }
      if (changed) {
        order[project] = projectOrder
        writeProtoOrder(order)
      }
    }

    if (changed) {
      set({
        orderRevision: state.orderRevision + 1,
        folderRevision: state.folderRevision + 1,
      })
    }
    return changed
  },

  reorderSubPage: (dir, fromFile, toFile, position) => {
    const state = get()
    const targetDir = String(dir || "")
    const from = String(fromFile || "")
    const to = String(toFile || "")
    if (!targetDir || !from || !to || from === to) return false
    const source =
      state.sources.find((item) => item.sandboxDir === targetDir) ||
      (state.currentSource?.sandboxDir === targetDir ? state.currentSource : null)
    if (!source) return false
    if (!source.subPages.some((sub) => sub.file === from)) return false
    if (!source.subPages.some((sub) => sub.file === to)) return false
    const order = readSubOrder()
    const current = orderSubPages(source.subPages, order[targetDir] || []).map(
      (sub) => sub.file
    )
    const next = moveKey(current, from, to, position)
    if (next.join("\u0000") === current.join("\u0000")) return false
    order[targetDir] = next
    writeSubOrder(order)
    set({ orderRevision: state.orderRevision + 1 })
    return true
  },

  createFolder: (name, parent) => {
    const state = get()
    const project = state.project
    if (!project) return { ok: false, error: "尚未进入任何项目" }
    const folderName = String(name || "").trim()
    if (!folderName) return { ok: false, error: "文件夹名称不能为空" }
    const groups = loadGroupsData(project)
    const parentId = parent ? String(parent) : null
    if (parentId && !groups.list.some((group) => group.id === parentId)) {
      return { ok: false, error: "父文件夹不存在" }
    }
    if (sameFolderName(groups.list, parentId, folderName)) {
      return { ok: false, error: "同级已存在同名文件夹" }
    }
    const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    groups.list.push({ id, name: folderName, parent: parentId })
    saveGroupsData(project, groups)
    set({ folderRevision: state.folderRevision + 1 })
    return { ok: true, id, name: folderName }
  },

  renameFolder: (id, name) => {
    const state = get()
    const project = state.project
    const folderId = String(id || "")
    const folderName = String(name || "").trim()
    if (!project) return { ok: false, error: "尚未进入任何项目" }
    if (!folderId) return { ok: false, error: "缺少文件夹 id" }
    if (!folderName) return { ok: false, error: "文件夹名称不能为空" }
    const groups = loadGroupsData(project)
    const folder = groups.list.find((group) => group.id === folderId)
    if (!folder) return { ok: false, error: "文件夹不存在" }
    if (folder.name === folderName) return { ok: true, id: folderId, name: folderName }
    if (sameFolderName(groups.list, folder.parent || null, folderName, folderId)) {
      return { ok: false, error: "同级已存在同名文件夹" }
    }
    folder.name = folderName
    saveGroupsData(project, groups)
    set({ folderRevision: state.folderRevision + 1 })
    return { ok: true, id: folderId, name: folderName }
  },

  removeFolder: (id) => {
    const state = get()
    const project = state.project
    const folderId = String(id || "")
    if (!project) return { ok: false, error: "尚未进入任何项目" }
    if (!folderId) return { ok: false, error: "缺少文件夹 id" }
    const groups = loadGroupsData(project)
    const folder = groups.list.find((group) => group.id === folderId)
    if (!folder) return { ok: false, error: "文件夹不存在" }

    // 递归收集本文件夹与全部后代。
    const removed = new Set<string>([folderId])
    let grew = true
    while (grew) {
      grew = false
      for (const group of groups.list) {
        if (group.parent && removed.has(group.parent) && !removed.has(group.id)) {
          removed.add(group.id)
          grew = true
        }
      }
    }

    groups.list = groups.list.filter((group) => !removed.has(group.id))
    for (const key of Object.keys(groups.map)) {
      if (removed.has(groups.map[key])) delete groups.map[key]
    }
    saveGroupsData(project, groups)

    // 删除分组排序；把其中的原型 key 并入未分组，保持用户可见顺序。
    const order = readProtoOrder()
    const projectOrder = order[project]
    if (projectOrder) {
      const ungrouped = (projectOrder.ungrouped || []).slice()
      for (const gid of Array.from(removed)) {
        for (const key of projectOrder[gid] || []) {
          if (!ungrouped.includes(key)) ungrouped.push(key)
        }
        delete projectOrder[gid]
      }
      projectOrder.ungrouped = ungrouped
      order[project] = projectOrder
      writeProtoOrder(order)
    }

    set({
      folderRevision: state.folderRevision + 1,
      orderRevision: state.orderRevision + 1,
    })
    return { ok: true, id: folderId, name: folder.name }
  },

  moveFolder: (id, parent, beforeId) => {
    const state = get()
    const project = state.project
    const folderId = String(id || "")
    if (!project) return { ok: false, error: "尚未进入任何项目" }
    if (!folderId) return { ok: false, error: "缺少文件夹 id" }
    const groups = loadGroupsData(project)
    const index = groups.list.findIndex((group) => group.id === folderId)
    if (index < 0) return { ok: false, error: "文件夹不存在" }
    const folder = groups.list[index]
    const parentId = parent === undefined ? folder.parent || null : parent ? String(parent) : null
    if (parentId && !groups.list.some((group) => group.id === parentId)) {
      return { ok: false, error: "父文件夹不存在" }
    }
    if (parentId && folderChainHas(groups.list, parentId, folderId)) {
      return { ok: false, error: "不能把文件夹移入自身或其子文件夹" }
    }

    groups.list.splice(index, 1)
    folder.parent = parentId
    const siblings = groups.list.filter((group) => (group.parent || null) === parentId)
    const anchor = beforeId ? String(beforeId) : ""
    const anchorIndex = anchor ? siblings.findIndex((group) => group.id === anchor) : -1
    let insertAt = groups.list.length
    if (anchorIndex >= 0) {
      insertAt = groups.list.findIndex((group) => group.id === siblings[anchorIndex].id)
    } else if (siblings.length) {
      insertAt = groups.list.findIndex((group) => group.id === siblings[siblings.length - 1].id) + 1
    }
    groups.list.splice(insertAt, 0, folder)
    saveGroupsData(project, groups)
    set({ folderRevision: state.folderRevision + 1 })
    return { ok: true, id: folderId, name: folder.name }
  },

  createProject: async (name) => {
    const project = String(name || "").trim()
    if (!project) return { ok: false, error: "项目名称不能为空" }
    const r = await invokeProtoMethod("sandbox", "projectCreate", { name: project })
    if (!r.ok) return toResult(r)
    const created = asText((r as unknown as Record<string, unknown>).name) || project
    await get().loadProjects()
    return { ok: true, name: created }
  },

  renameProject: async (oldName, name) => {
    const from = String(oldName || "").trim()
    const to = String(name || "").trim()
    if (!from || !to) return { ok: false, error: "项目名称不能为空" }
    const r = await invokeProtoMethod("sandbox", "projectRename", { oldName: from, name: to })
    if (!r.ok) return toResult(r)
    const renamed = asText((r as unknown as Record<string, unknown>).name) || to
    if (get().project === from) {
      writeText(PROTO_LAST_PROJECT, renamed)
      set({ project: renamed, sources: [], currentSource: null, activeSubFile: "", activeContent: "" })
      useAppStore.getState().setProject(renamed)
      await get().loadSources(renamed)
    }
    await get().loadProjects()
    return { ok: true, name: renamed }
  },

  removeProject: async (name) => {
    const project = String(name || "").trim()
    if (!project) return { ok: false, error: "项目名称不能为空" }
    if (project === "默认项目") return { ok: false, error: "「默认项目」不可删除" }
    const r = await invokeProtoMethod("sandbox", "projectRemove", { name: project })
    if (!r.ok) return toResult(r)
    if (get().project === project) {
      removeKey(PROTO_LAST_PROJECT)
      set({
        project: "",
        sources: [],
        currentSource: null,
        activeSubFile: "",
        activeContent: "",
        error: "",
      })
      const app = useAppStore.getState()
      app.setProject("")
      app.setProto("")
      app.setPage("")
    }
    await get().loadProjects()
    return { ok: true, name: project }
  },
}))

/**
 * 手动切换端别（顶栏 setKind）回写当前源，保持旧 `setKind` 语义：
 * `currentSource.kind` 与舞台端别一致，刷新后不丢（sourceFromFolder 保留 previous.kind）。
 */
let lastStageKind = useAppStore.getState().kind

useAppStore.subscribe(() => {
  const state = useAppStore.getState()
  if (state.kind === lastStageKind) return
  lastStageKind = state.kind
  const current = useSourcesStore.getState().currentSource
  if (!current || current.kind === state.kind) return
  const next: SourceRef = { ...current, kind: state.kind }
  useSourcesStore.setState((s) => ({
    currentSource: next,
    sources: s.sources.map((item) => (sameSource(item, current) ? next : item)),
  }))
})
