/**
 * src/renderer/stores/docs-store.ts — W3-03 文档闭环（功能说明 / 最新需求 / mirror）。
 *
 * 数据落点（逐字对齐旧渲染层）：
 * - 功能说明：`js/core-docs.js:56-148`（`getDocMd` + `sandboxMdFile` + `persistSandboxDoc`）
 *   - 读：优先 `SourceRef.md`（`sandbox:list` 已带），缺失时 `sandbox:read-file({dir,file:mdFile})`
 *   - 写：`sandbox:write({dir,file:<name>.md,content})`
 * - 最新需求：`js/project-ai-export.js:179-243`
 *   - 读：`doc:read-latest({dir})`
 *   - 写：`doc:write-latest({dir,file:'最新需求.md',content})`
 * - mirror：`js/core-docs.js:3674-3703,4416-4460,4658-4725`
 *   - 保存/加载成功后 `doc:mirror-push({kind:'content',payload:{content,...}})`
 *
 * 保存守卫（移植 `js/store.js:181-223 guardDocWrite`）：
 * 发起保存时快照 `sandboxDir + __ver + tab + content`；异步返回后若源已切换或版本已推进，
 * 丢弃本次结果并 toast，绝不把 A 原型的内容写进 B 原型的状态。
 *
 * 未保存草稿守卫（wave4 b-docs）：
 * - 切 Tab：`setTab` 发现 draft≠docContent 时只挂起 `pendingGuard`，由 DocsPanel 的 Confirm
 *   决定放弃/继续编辑；确认放弃才切换。
 * - 切原型：Sources 层不可拦截，切换时按 `${sourceDir}::${tab}` 暂存草稿并挂起 source 守卫；
 *   取消则保留暂存，切回该原型自动恢复编辑态（不静默丢失）。
 * - 关面板：docs-store 订阅 ui-store.docsOpen，脏草稿时回开面板并挂起 close-panel 守卫。
 * - 关独立窗：DocsPanel 的 beforeunload 拦截 + close-window 守卫，确认放弃后才真正 close。
 *
 * Markdown / TOC（无第三方依赖）：
 * - 块解析 `parseDocDocument` / `parseDocBlocks`（标题/段落/列表/代码块/GFM 表格/引用/分隔线）；
 * - 渲染 `renderDocPreview`（先转义再插入受控标签，标题带 `data-toc-id`）；
 * - TOC `extractDocHeadings` 与渲染同源分配标题 id；搜索仍兼容遗留 `docSearchDo`。
 *
 * 本文件同时导出 `useDocWindow()`（docwin.open/close/toggle 薄封装），供 W3-04 顶栏
 * 只读消费；不新增 IPC 通道，不改 sources-store / Topbar。
 */

import { create } from "zustand"
import { invokeProtoMethod } from "@/lib/ipc"
import { onDocMirror } from "@/lib/events"
import { useAppStore } from "@/stores/app-store"
import { useSourcesStore, type SourceRef } from "@/stores/sources-store"
import { useUiStore } from "@/stores/ui-store"

/** 文档 Tab：功能说明 / 最新需求。 */
export type DocsTabId = "desc" | "latest"

/** TOC 条目（extractHeadings 包壳产出形态）。 */
export interface DocTocItem {
  /** 跳转锚点 id（slug）。 */
  id: string
  /** 标题级别 1-6。 */
  level: number
  /** 标题文本。 */
  text: string
}

/**
 * 未保存草稿守卫：等待用户确认「放弃修改 / 继续编辑」的动作。
 * - tab：切文档 Tab；- close-panel：关文档面板；- close-window：关独立文档窗；
 * - source：已切原型（Sources 层不可拦截），草稿按「目录 + Tab」暂存后用本守卫询问是否放弃。
 */
export type DocGuardIntent =
  | { kind: "tab"; tab: DocsTabId }
  | { kind: "close-panel" }
  | { kind: "close-window" }
  /**
   * 切原型：`dir/name/key` 指被离开的来源（用于暂存草稿），
   * `toName` 指切到的目标原型（守卫文案写“已切换到「目标」”，不能沿用来源名）。
   */
  | { kind: "source"; dir: string; name: string; key: string; toName?: string }

/** 草稿暂存 key：源目录 + Tab（切原型/切 Tab 不丢草稿）。 */
function draftKey(dir: string, tab: DocsTabId): string {
  return `${String(dir ?? "").trim()}::${tab}`
}

/** Markdown 表格列对齐（GFM `:---:`）。 */
export type DocTableAlign = "left" | "center" | "right" | null

interface DocBlockRange {
  /** 起始行（0-based，含）。 */
  start: number
  /** 结束行（0-based，含）。 */
  end: number
}

/** 标题块：id 与 TOC 条目同源，渲染层输出 `data-toc-id`。 */
export interface DocHeadingBlock extends DocBlockRange {
  kind: "heading"
  level: number
  text: string
  id: string
}

/** 段落块（保留换行，预览用 `<br>`）。 */
export interface DocParagraphBlock extends DocBlockRange {
  kind: "paragraph"
  text: string
}

/** 有序/无序列表块。 */
export interface DocListBlock extends DocBlockRange {
  kind: "list"
  ordered: boolean
  startNumber: number
  items: Array<{ text: string; depth: number }>
}

/** 围栏代码块。 */
export interface DocCodeBlock extends DocBlockRange {
  kind: "code"
  lang: string
  text: string
}

/** GFM 表格块。 */
export interface DocTableBlock extends DocBlockRange {
  kind: "table"
  header: string[]
  align: DocTableAlign[]
  rows: string[][]
}

/** 引用块。 */
export interface DocQuoteBlock extends DocBlockRange {
  kind: "quote"
  text: string
}

/** 分隔线。 */
export interface DocHrBlock extends DocBlockRange {
  kind: "hr"
}

export type DocBlock =
  | DocHeadingBlock
  | DocParagraphBlock
  | DocListBlock
  | DocCodeBlock
  | DocTableBlock
  | DocQuoteBlock
  | DocHrBlock

/* ═══════════ 通用 helpers ═══════════ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return typeof value === "string" ? value : String(value)
}

/** 是否运行在 `?docwin=1` 独立文档窗口（与 main.tsx / core-docs.js isDocWinMode 同口径）。 */
export function isDocWindowMode(search?: string): boolean {
  try {
    const s =
      search ??
      (typeof window !== "undefined" && window.location ? window.location.search : "")
    return new URLSearchParams(s).get("docwin") === "1"
  } catch {
    return false
  }
}

function showToast(title: string, description: string, variant: "default" | "destructive" = "default"): void {
  try {
    useUiStore.getState().pushToast({ title, description, variant })
  } catch {
    // toast 投递失败不影响主流程。
  }
}

function titleFor(tab: DocsTabId, displayName: string): string {
  const name = String(displayName ?? "").trim()
  if (tab === "latest") return name ? `最新需求 · ${name}` : "最新需求 · 当前迭代"
  return name ? `${name} · 功能说明` : "功能说明"
}

/** 功能说明 md 文件名：优先沙箱列表给的 mdFile，否则按原型名推导（旧 sandboxMdFile 口径）。 */
function descFileOf(state: Pick<DocsState, "sourceMdFile" | "sourceName" | "sourceDisplayName">): string {
  const given = String(state.sourceMdFile ?? "").trim()
  if (given) return given
  const base = String(state.sourceName || state.sourceDisplayName || "原型")
    .replace(/\.(html?)$/i, "")
    .replace(/\.md$/i, "")
  return (base || "原型") + ".md"
}

/**
 * 推送当前文档内容到独立文档窗（主窗保存/加载后调用）。
 * 文档窗内不 push（对应旧 mirrorPush 的 isDocWinMode 早退）。
 */
async function pushContentMirror(tab: DocsTabId, content: string, title: string): Promise<void> {
  if (isDocWindowMode()) return
  try {
    const st = useDocsStore.getState()
    await invokeProtoMethod("doc", "mirrorPush", {
      kind: "content",
      payload: {
        content,
        md: content,
        tab,
        reqMode: tab === "latest",
        title,
        dir: st.sourceDir,
        sourceName: st.sourceName,
        sourceDisplayName: st.sourceDisplayName,
        project: useSourcesStore.getState().project,
      },
    })
  } catch {
    // 无文档窗时主进程回 {ok:false,nop:true}；mirror 失败不影响保存。
  }
}

/**
 * 文档窗内保存成功后回推内容到主窗。
 *
 * 方向说明：`doc:mirror-push` 由主进程只投递给 docWin，文档窗调用它只会自投；
 * 文档窗 → 主窗必须走 `doc:mirror-back`（主进程只投递给 mainWin）。
 * 载荷带 `docwin:true` 标记，主窗据此把 content 写入正文/草稿/缓存，无需刷新。
 */
async function pushContentMirrorBack(tab: DocsTabId, content: string, title: string): Promise<void> {
  if (!isDocWindowMode()) return
  try {
    const st = useDocsStore.getState()
    await invokeProtoMethod("doc", "mirrorBack", {
      kind: "content",
      source: "docwin",
      payload: {
        docwin: true,
        origin: "docwin",
        content,
        md: content,
        tab,
        reqMode: tab === "latest",
        title,
        dir: st.sourceDir,
        sourceName: st.sourceName,
        sourceDisplayName: st.sourceDisplayName,
        project: useSourcesStore.getState().project,
      },
    })
  } catch {
    // 主窗不存在/网关缺失时静默；保存本身已落盘，重开面板会按磁盘复核。
  }
}

/**
 * 推送当前源身份到独立文档窗。
 * 仅 `docwin:toggle` 打开时需要：preload 的 toggle 不接收 project/proto，
 * 新窗只能靠本消息从“默认第一个原型”切到主窗当前原型（旧 mirrorPush('source') 口径）。
 */
async function pushSourceMirror(): Promise<void> {
  if (isDocWindowMode()) return
  const sources = useSourcesStore.getState()
  const src = sources.currentSource
  if (!src || !sources.project) return
  try {
    await invokeProtoMethod("doc", "mirrorPush", {
      kind: "source",
      payload: {
        project: sources.project,
        proto: src.displayName || src.name,
        displayName: src.displayName,
        sourceName: src.name,
        dir: src.sandboxDir,
      },
    })
  } catch {
    // 无文档窗时静默。
  }
}

/* ═══════════ 内核包壳（只包壳，不重写） ═══════════ */

/** 遗留全局函数读取（core-docs.js 经典脚本挂载形态）。 */
function legacyFn(name: string): ((...args: never[]) => unknown) | null {
  try {
    const w = window as unknown as Record<string, unknown>
    const fn = w[name]
    return typeof fn === "function" ? (fn as (...args: never[]) => unknown) : null
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;")
}

/** slug（与包壳口径一致的小写-连字符规则）。 */
export function slugifyHeading(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[#*_`~[\]()!<>]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

/** 标题纯文本：去图片/链接/强调/行内代码标记，供 TOC 文案与 id 共用。 */
function headingPlainText(text: string): string {
  return String(text ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .trim()
}

/** 生成全篇唯一标题 id（重复标题追加 -1/-2…，TOC 与渲染共用）。 */
function uniqueHeadingId(base: string, used: Set<string>): string {
  const seed = base || "section"
  let id = seed
  let n = 1
  while (used.has(id)) {
    id = `${seed}-${n}`
    n += 1
  }
  used.add(id)
  return id
}

interface ListLine {
  ordered: boolean
  number: number
  indent: number
  text: string
}

function matchListLine(line: string): ListLine | null {
  const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.+)$/.exec(String(line ?? ""))
  if (!m) return null
  const ordered = /\d/.test(m[2])
  return {
    ordered,
    number: ordered ? Number.parseInt(m[2], 10) || 1 : 1,
    indent: m[1].replace(/\t/g, "  ").length,
    text: m[3].trim(),
  }
}

/** 拆 GFM 表格行（容忍首尾竖线、转义 `\|` 与空单元格）。 */
function splitTableRow(line: string): string[] {
  let s = String(line ?? "").trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ""
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|"
      i += 1
    } else if (ch === "|") {
      cells.push(cur.trim())
      cur = ""
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

/** 表格分隔行：`| --- | :---: |`。 */
function isTableDelimiter(line: string): boolean {
  if (!String(line ?? "").includes("-")) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function tableAlignOf(cell: string): DocTableAlign {
  const s = String(cell ?? "").trim()
  const left = s.startsWith(":")
  const right = s.endsWith(":")
  if (left && right) return "center"
  if (right) return "right"
  if (left) return "left"
  return null
}

function isHrLine(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(String(line ?? ""))
}

function isFenceLine(line: string): RegExpExecArray | null {
  return /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(String(line ?? ""))
}

function isHeadingLine(line: string): RegExpExecArray | null {
  return /^\s{0,3}(#{1,6})\s+(.+)$/.exec(String(line ?? ""))
}

/** 段落收集时判断下一行是否开启新块。 */
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? ""
  if (!line.trim()) return true
  if (/^\s*<!--/.test(line)) return true
  if (isFenceLine(line) || isHeadingLine(line) || isHrLine(line)) return true
  if (/^\s*>/.test(line)) return true
  if (matchListLine(line)) return true
  if (line.includes("|") && isTableDelimiter(lines[index + 1] ?? "")) return true
  return false
}

/** 解码常见 HTML 实体（仅用于 href/src 安全校验后再转义）。 */
function decodeEntities(s: string): string {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * 地址白名单：阻断 javascript/vbscript/file 等危险协议。
 *
 * 图片额外放行 `data:image/*`（CSP img-src 已含 data:）与 `proto-asset:`（沙箱资源协议）；
 * 链接仍不放行 data:，避免把整段文档内容当导航目标。
 * http(s) 图片维持现状：safeUrl 放行，但渲染进程 CSP `img-src` 未含 https，仍会被拦截
 * （受控图片代理/域名白名单需另立需求，本轮不改 CSP）。
 */
function safeUrl(raw: string, kind: "link" | "image" = "link"): string {
  const url = String(raw ?? "").trim()
  if (!url) return ""
  const compact = url.replace(/[\u0000-\u0020]/g, "").toLowerCase()
  if (/^(?:javascript|vbscript|file):/.test(compact)) return ""
  if (/^data:/.test(compact)) {
    // 只接受真正的 image data URI；SVG 在 <img> 内不执行脚本，可放行。
    if (kind === "image" && /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._+-]+)*,/i.test(compact)) {
      return url
    }
    return ""
  }
  // proto-asset: / blob: / http(s) 原样返回（后两者由 CSP 决定是否加载）。
  return url
}

/**
 * 行内 Markdown → 转义后的 HTML（粗体/斜体/删除线/行内代码/链接/图片）。
 * 先转义原文，再仅插入受控标签；代码与链接先替换为占位符，避免后续正则污染属性。
 */
export function renderDocInline(text: string): string {
  const tokens: string[] = []
  const stash = (html: string): string => {
    const token = `\uE000${tokens.length}\uE001`
    tokens.push(html)
    return token
  }

  // 行内代码先占位，内部不再参与任何 Markdown 解析。
  let src = String(text ?? "").replace(/`([^`\n]+)`/g, (_full, code: string) =>
    stash(`<code>${escapeHtml(code)}</code>`),
  )
  src = escapeHtml(src)
  // PRD 表格/段落常用 <br> 表示单元格内换行；只放行换行标签，其余 HTML 保持转义。
  src = src.replace(/&lt;br\s*\/?&gt;/gi, "<br />")

  // 图片先于链接处理，避免 `![alt](url)` 残留感叹号。
  src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt: string, href: string) => {
    const url = safeUrl(decodeEntities(href), "image")
    if (!url) return alt
    // alt 已经在 escapeHtml 阶段转义，直接放入属性即可，避免二次转义。
    return stash(`<img src="${escapeAttr(url)}" alt="${alt}" loading="lazy" />`)
  })
  src = src.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (full, label: string, href: string) => {
    const url = safeUrl(decodeEntities(href))
    if (!url) return label
    return stash(
      `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`,
    )
  })

  src = src
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")

  return src.replace(/\uE000(\d+)\uE001/g, (_full, index: string) => tokens[Number(index)] ?? "")
}

/** 行内渲染 + 换行（段落/引用/表格单元格用）。 */
function renderDocInlineBreaks(text: string): string {
  return renderDocInline(text).replace(/\n/g, "<br />")
}

/**
 * 轻量 Markdown 块解析（无第三方依赖）：
 * 支持标题、段落、有序/无序列表、围栏代码块、GFM 表格、引用、分隔线。
 * 标题 id 由本函数统一分配，TOC 与预览/导出共用，保证 `data-toc-id` 可定位。
 */
export function parseDocDocument(md: string): { blocks: DocBlock[]; headings: DocTocItem[] } {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n")
  const blocks: DocBlock[] = []
  const headings: DocTocItem[] = []
  const usedIds = new Set<string>()
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    // HTML 注释整段跳过（旧文档里常见）。
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes("-->")) i += 1
      i += 1
      continue
    }

    const fence = isFenceLine(line)
    if (fence) {
      const fenceChar = fence[1][0]
      const fenceLen = fence[1].length
      const info = fence[2].trim()
      const closeRe = new RegExp(`^\\s*${fenceChar === "`" ? "`" : "~"}{${fenceLen},}\\s*$`)
      const code: string[] = []
      let j = i + 1
      while (j < lines.length && !closeRe.test(lines[j])) {
        code.push(lines[j])
        j += 1
      }
      if (j < lines.length) j += 1
      blocks.push({ kind: "code", lang: info.split(/\s+/)[0] ?? "", text: code.join("\n"), start: i, end: j - 1 })
      i = j
      continue
    }

    const heading = isHeadingLine(line)
    if (heading) {
      const text = heading[2].replace(/\s+#+\s*$/, "").trim()
      if (text) {
        const plain = headingPlainText(text)
        const id = uniqueHeadingId(slugifyHeading(plain) || `h-${headings.length}`, usedIds)
        blocks.push({ kind: "heading", level: heading[1].length, text, id, start: i, end: i })
        headings.push({ id, level: heading[1].length, text: plain })
      }
      i += 1
      continue
    }

    if (isHrLine(line)) {
      blocks.push({ kind: "hr", start: i, end: i })
      i += 1
      continue
    }

    // GFM 表格：当前行含竖线且下一行为分隔行。
    if (line.includes("|") && isTableDelimiter(lines[i + 1] ?? "")) {
      const header = splitTableRow(line)
      const align = splitTableRow(lines[i + 1] ?? "").map(tableAlignOf)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length) {
        const row = lines[j]
        if (!row.trim() || !row.includes("|")) break
        if (startsBlock(lines, j)) break
        const cells = splitTableRow(row)
        rows.push(header.map((_h, k) => cells[k] ?? ""))
        j += 1
      }
      blocks.push({ kind: "table", header, align, rows, start: i, end: j - 1 })
      i = j
      continue
    }

    const list = matchListLine(line)
    if (list) {
      const items: Array<{ text: string; depth: number }> = []
      const ordered = list.ordered
      const startNumber = list.number
      let j = i
      while (j < lines.length) {
        const item = matchListLine(lines[j])
        if (!item || item.ordered !== ordered) break
        items.push({ text: item.text, depth: Math.min(6, Math.floor(item.indent / 2)) })
        j += 1
      }
      blocks.push({ kind: "list", ordered, startNumber, items, start: i, end: j - 1 })
      i = j
      continue
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      let j = i
      while (j < lines.length && /^\s*>/.test(lines[j])) {
        quote.push(lines[j].replace(/^\s*>\s?/, ""))
        j += 1
      }
      blocks.push({ kind: "quote", text: quote.join("\n"), start: i, end: j - 1 })
      i = j
      continue
    }

    // 普通段落：收集到空行或下一块起始。
    const para: string[] = []
    let j = i
    while (j < lines.length && !startsBlock(lines, j)) {
      para.push(lines[j].trimEnd())
      j += 1
    }
    if (j === i) {
      para.push(line.trimEnd())
      j = i + 1
    }
    blocks.push({ kind: "paragraph", text: para.join("\n"), start: i, end: j - 1 })
    i = j
  }

  return { blocks, headings }
}

/** 块解析（预览层按块渲染 React，避免整段 innerHTML）。 */
export function parseDocBlocks(md: string): DocBlock[] {
  return parseDocDocument(md).blocks
}

/**
 * TOC 提取：与预览共用块解析器，标题 id 天然一致（含重复标题去重）。
 * @param {string} md Markdown 原文
 * @returns {DocTocItem[]} TOC 条目
 */
export function extractDocHeadings(md: string): DocTocItem[] {
  return parseDocDocument(md).headings
}

/** 单块 → 导出用 HTML（所有文本均经转义，标题带 data-toc-id）。 */
function renderDocBlockHtml(block: DocBlock): string {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level))
      return `<h${level} id="${escapeAttr(block.id)}" data-toc-id="${escapeAttr(block.id)}">${renderDocInline(block.text)}</h${level}>`
    }
    case "paragraph":
      return `<p>${renderDocInlineBreaks(block.text)}</p>`
    case "list": {
      const tag = block.ordered ? "ol" : "ul"
      const start = block.ordered && block.startNumber !== 1 ? ` start="${block.startNumber}"` : ""
      const items = block.items
        .map(
          (item) =>
            `<li${item.depth ? ` style="margin-left:${item.depth * 14}px"` : ""}>${renderDocInline(item.text)}</li>`,
        )
        .join("")
      return `<${tag}${start}>${items}</${tag}>`
    }
    case "code": {
      const cls = block.lang ? ` class="language-${escapeAttr(block.lang.replace(/[^\w-]/g, ""))}"` : ""
      return `<pre><code${cls}>${escapeHtml(block.text)}</code></pre>`
    }
    case "table": {
      const cell = (tag: "th" | "td", text: string, index: number): string => {
        const align = block.align[index] ?? null
        const style = align ? ` style="text-align:${align}"` : ""
        return `<${tag}${style}>${renderDocInlineBreaks(text)}</${tag}>`
      }
      const head = `<thead><tr>${block.header.map((h, k) => cell("th", h, k)).join("")}</tr></thead>`
      const body = block.rows.length
        ? `<tbody>${block.rows
            .map((row) => `<tr>${row.map((c, k) => cell("td", c, k)).join("")}</tr>`)
            .join("")}</tbody>`
        : ""
      return `<table>${head}${body}</table>`
    }
    case "quote":
      return `<blockquote>${renderDocInlineBreaks(block.text)}</blockquote>`
    case "hr":
      return "<hr />"
    default:
      return ""
  }
}

/**
 * Markdown → HTML（预览导出 / PNG / PDF 共用）。
 * 本地轻量解析，标题输出与 TOC 同源的 `data-toc-id`；全部文本先转义，保留 XSS 防护。
 * @param {string} md Markdown 原文
 * @returns {string} 可直接 innerHTML 的 HTML（已转义处理）
 */
export function renderDocPreview(md: string): string {
  return parseDocDocument(md)
    .blocks.map(renderDocBlockHtml)
    .filter(Boolean)
    .join("\n")
}

/**
 * 搜索包壳：优先委托遗留 `docSearchDo(q)`，否则返回本地过滤命中行号。
 * React 侧 TOC/列表过滤以本地返回为准，遗留高亮只做增强。
 * @param {string} q 搜索关键字
 * @param {string} md 被搜索正文
 * @returns {number[]} 命中行号（0-based）
 */
export function searchDocLines(q: string, md: string): number[] {
  const needle = String(q ?? "").trim().toLowerCase()
  if (!needle) return []
  const legacy = legacyFn("docSearchDo")
  if (legacy) {
    try {
      legacy(needle as never)
    } catch {
      // 遗留高亮失败不影响本地过滤。
    }
  }
  const hits: number[] = []
  String(md ?? "")
    .split("\n")
    .forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) hits.push(i)
    })
  return hits
}

/* ═══════════ 文档 store ═══════════ */

export interface DocsState {
  /** 当前 Tab 正文（已保存态）。 */
  docContent: string
  /** 编辑草稿（未保存态）。 */
  draft: string
  /** 是否处于编辑态。 */
  editing: boolean
  /** TOC（由当前正文派生，buildToc 包壳写入）。 */
  toc: DocTocItem[]
  /** TOC/正文搜索关键字。 */
  search: string
  /** 内容修订号（内容变化 +1，mirror/导出消费；不再作为 IPC 入参）。 */
  reqVersion: number
  /** 保存中。 */
  saving: boolean
  /** 读取中。 */
  loading: boolean
  /** 最近一次错误文案（空串 = 无错误）。 */
  lastError: string
  /** 当前 Tab。 */
  tab: DocsTabId
  /** 功能说明缓存（按当前源目录）。 */
  descContent: string
  /** 最新需求缓存（按当前源目录）。 */
  latestContent: string
  /** 功能说明是否已按当前源加载。 */
  descLoaded: boolean
  /** 最新需求是否已加载。 */
  latestLoaded: boolean
  /** 主窗最近一次收到的 docwin mirror 内容所属目录（空串 = 无待消费 mirror）。 */
  mirrorDir: string
  /** 主窗最近一次收到的 docwin mirror 内容所属 Tab（只在本 Tab 的加载中消费）。 */
  mirrorTab: DocsTabId
  /** 主窗最近一次收到的 docwin mirror 正文（关闭/重开面板优先使用）。 */
  mirrorContent: string
  /** 是否还有尚未被面板加载消费的 mirror 内容。 */
  mirrorPending: boolean
  /** 当前绑定源目录（保存守卫快照）。 */
  sourceDir: string
  /** 当前绑定源版本 `SourceRef.__ver`（保存守卫快照）。 */
  sourceVer: number
  /** 当前源主 html 文件名（mdFile 缺失时推导 md 名）。 */
  sourceName: string
  /** 当前源显示名（文档标题）。 */
  sourceDisplayName: string
  /** 当前源 md 文件名（保存落点）。 */
  sourceMdFile: string | null
  /** 文档标题（顶栏/导出只读）。 */
  docTitle: string
  /** 未保存草稿暂存：key = `${sourceDir}::${tab}`（切原型后切回可恢复编辑态）。 */
  draftStash: Record<string, string>
  /** 待确认的丢弃动作（null = 无）；由 DocsPanel 渲染 Confirm，确认放弃后才执行。 */
  pendingGuard: DocGuardIntent | null
  setDocContent: (content: string) => void
  setDraft: (draft: string) => void
  setSearch: (search: string) => void
  setToc: (toc: DocTocItem[]) => void
  setEditing: (editing: boolean) => void
  setTab: (tab: DocsTabId) => void
  bumpReqVersion: () => void
  /** 进入编辑态（draft = 当前正文快照；有暂存草稿时优先恢复）。 */
  beginEdit: () => void
  /** 放弃草稿（draft 回滚到正文，退出编辑态，并清掉当前目录+Tab 的暂存）。 */
  discard: () => void
  /** 暂存当前未保存草稿；返回暂存 key（无草稿 / 无源目录时返回空串）。 */
  stashDraft: () => string
  /** 确认（true）或取消（false）挂起的丢弃动作；取消保留编辑态。 */
  resolveGuard: (accept: boolean) => void
  /** 保存草稿：desc → sandbox:write；latest → doc:write-latest；成功后 mirrorPush。 */
  save: () => Promise<boolean>
  /**
   * 加载功能说明：优先 source.md，缺失则 sandbox:read-file({dir,file:mdFile})。
   * 同一源目录已加载时直接命中缓存（不会用列表里的旧 md 覆盖本地已保存内容）。
   */
  loadDesc: (source?: SourceRef | null) => Promise<boolean>
  /** 加载最新需求：doc:read-latest({dir})；传空则取当前源目录。 */
  loadLatest: (dir?: string | null) => Promise<boolean>
  /** 应用 doc:mirror content 消息（DocWindow 用）。 */
  applyMirrorContent: (payload: unknown) => void
}

export interface DocsStoreHook {
  (): DocsState
  <S>(selector: (s: DocsState) => S): S
  getState: () => DocsState
  setState: (partial: Partial<DocsState> | ((s: DocsState) => Partial<DocsState>)) => void
  subscribe: (listener: () => void) => void
}

/** 功能说明读请求序号：切源时丢弃旧读回包。 */
let descLoadSeq = 0
/** 最新需求读请求序号：切源/切 Tab 时丢弃旧读回包。 */
let latestLoadSeq = 0

/** 切 Tab 的纯执行路径：守卫确认后才走到这里，并恢复目标 Tab 的暂存草稿。 */
function applyTabSwitch(
  id: DocsTabId,
  set: (partial: Partial<DocsState> | ((s: DocsState) => Partial<DocsState>)) => void,
  get: () => DocsState,
): void {
  const s = get()
  if (s.tab === id) return
  const content = id === "desc" ? s.descContent : s.latestContent
  const stashed = s.draftStash[draftKey(s.sourceDir, id)]
  const restore = stashed !== undefined && stashed !== content
  set({
    tab: id,
    docContent: content,
    draft: restore ? stashed : content,
    editing: restore,
    lastError: "",
    docTitle: titleFor(id, s.sourceDisplayName),
  })
}

export const useDocsStore: DocsStoreHook = create<DocsState>()((set, get) => ({
  docContent: "",
  draft: "",
  editing: false,
  toc: [],
  search: "",
  reqVersion: 0,
  saving: false,
  loading: false,
  lastError: "",
  tab: "desc",
  descContent: "",
  latestContent: "",
  descLoaded: false,
  latestLoaded: false,
  mirrorDir: "",
  mirrorTab: "desc",
  mirrorContent: "",
  mirrorPending: false,
  sourceDir: "",
  sourceVer: 0,
  sourceName: "",
  sourceDisplayName: "",
  sourceMdFile: null,
  docTitle: "功能说明",
  draftStash: {},
  pendingGuard: null,

  setDocContent: (content) =>
    set((s) => {
      const text = String(content ?? "")
      return {
        docContent: text,
        draft: s.editing ? s.draft : text,
        ...(s.tab === "desc"
          ? { descContent: text, descLoaded: true }
          : { latestContent: text, latestLoaded: true }),
      }
    }),
  setDraft: (draft) => set({ draft: String(draft ?? "") }),
  setSearch: (search) => set({ search: String(search ?? "") }),
  setToc: (toc) => set({ toc: Array.isArray(toc) ? toc : [] }),
  setEditing: (editing) => set({ editing: Boolean(editing) }),
  setTab: (tab) => {
    const id: DocsTabId = tab === "latest" ? "latest" : "desc"
    const s = get()
    if (s.tab === id) return
    if (s.draft !== s.docContent) {
      // 有未保存草稿：只挂起，等 DocsPanel 的 Confirm 结果，绝不静默切走。
      const canPrompt = useUiStore.getState().docsOpen || isDocWindowMode()
      if (canPrompt) {
        set({ pendingGuard: { kind: "tab", tab: id } })
        return
      }
      // 面板不可见（无 Confirm 承载）：先按「目录 + Tab」暂存再切，切回可恢复。
      get().stashDraft()
    }
    applyTabSwitch(id, set, get)
  },
  bumpReqVersion: () => set((s) => ({ reqVersion: s.reqVersion + 1 })),
  beginEdit: () =>
    set((s) => {
      const stashed = s.draftStash[draftKey(s.sourceDir, s.tab)]
      return { editing: true, draft: stashed ?? s.docContent }
    }),
  discard: () =>
    set((s) => {
      const key = draftKey(s.sourceDir, s.tab)
      if (!(key in s.draftStash)) return { editing: false, draft: s.docContent }
      const next = { ...s.draftStash }
      delete next[key]
      return { editing: false, draft: s.docContent, draftStash: next }
    }),
  stashDraft: () => {
    const s = get()
    const dir = String(s.sourceDir || "").trim()
    if (!dir || s.draft === s.docContent) return ""
    const key = draftKey(dir, s.tab)
    if (s.draftStash[key] !== s.draft) {
      set({ draftStash: { ...s.draftStash, [key]: s.draft } })
    }
    return key
  },
  resolveGuard: (accept) => {
    const guard = get().pendingGuard
    if (!guard) return
    set({ pendingGuard: null })
    if (!accept) return
    if (guard.kind === "tab") {
      set((s) => ({ draft: s.docContent, editing: false }))
      applyTabSwitch(guard.tab, set, get)
      return
    }
    if (guard.kind === "source") {
      // 确认放弃：删掉该原型的暂存草稿；取消时暂存保留，切回可继续编辑。
      set((s) => {
        if (!(guard.key in s.draftStash)) return {}
        const next = { ...s.draftStash }
        delete next[guard.key]
        return { draftStash: next }
      })
      return
    }
    // close-panel / close-window：确认放弃后丢弃草稿；关面板由 ui-store 收口。
    set((s) => ({ draft: s.docContent, editing: false }))
    if (guard.kind === "close-panel") useUiStore.getState().closeDocs()
  },

  save: async (): Promise<boolean> => {
    const snap = get()
    if (snap.saving) return false
    const dir = String(snap.sourceDir || "").trim()
    if (!dir) {
      const msg = "未选择原型，无法保存文档"
      set({ lastError: msg })
      showToast("文档保存失败", msg, "destructive")
      return false
    }

    const tab = snap.tab
    const content = snap.draft
    const ver = Number(snap.sourceVer) || 0
    const file = tab === "desc" ? descFileOf(snap) : "最新需求.md"

    // 发起前若源已切换/版本已推进，直接阻断（避免写错目录）。
    const liveBefore = useSourcesStore.getState().currentSource
    if (liveBefore && liveBefore.sandboxDir) {
      const liveVer = Number(liveBefore.__ver) || 0
      if (liveBefore.sandboxDir !== dir) {
        const msg = "保存已阻断：已切换原型，本次保存不会写入当前原型"
        set({ lastError: msg })
        showToast("保存已阻断", msg, "destructive")
        return false
      }
      if (liveVer !== ver) {
        const msg = "保存已阻断：当前原型版本已变化（并发保存），请重新保存"
        set({ lastError: msg })
        showToast("保存已阻断", msg, "destructive")
        return false
      }
    }

    set({ saving: true, lastError: "" })
    try {
      const r =
        tab === "desc"
          ? await invokeProtoMethod("sandbox", "write", { dir, file, content })
          : await invokeProtoMethod("doc", "writeLatest", { dir, file: "最新需求.md", content })

      // 异步返回后守卫：源目录/版本任一变化都丢弃本次结果（磁盘写入仍发生在快照目录）。
      const now = get()
      const liveAfter = useSourcesStore.getState().currentSource
      const liveDir = liveAfter?.sandboxDir || now.sourceDir
      const liveVer = liveAfter ? Number(liveAfter.__ver) || 0 : Number(now.sourceVer) || 0
      if (now.sourceDir !== dir || (liveDir && liveDir !== dir)) {
        const msg = "保存已阻断：已切换原型，本次保存结果不会写入新原型"
        set({ saving: false, lastError: msg })
        showToast("保存已阻断", msg, "destructive")
        return false
      }
      if (liveVer !== ver) {
        const msg = "保存已阻断：当前原型版本已变化（并发保存），请重新保存"
        set({ saving: false, lastError: msg })
        showToast("保存已阻断", msg, "destructive")
        return false
      }

      if (!r.ok) {
        const msg = r.error || "save-failed"
        set({ saving: false, lastError: msg })
        showToast("文档保存失败", msg, "destructive")
        return false
      }

      set((s) => {
        // 已落盘：清掉该目录+Tab 的暂存草稿，避免之后切回时复活旧草稿。
        const stash = { ...s.draftStash }
        delete stash[draftKey(dir, tab)]
        return {
          saving: false,
          lastError: "",
          reqVersion: s.reqVersion + 1,
          // 本窗刚保存的内容优先；之前收到的 mirror 已落盘/过期，不再参与下一次缓存复核。
          mirrorPending: false,
          draftStash: stash,
          ...(tab === "desc"
            ? { descContent: content, descLoaded: true }
            : { latestContent: content, latestLoaded: true }),
          ...(s.tab === tab ? { docContent: content, draft: content, editing: false } : {}),
        }
      })

      if (get().tab === tab) {
        const title = titleFor(tab, get().sourceDisplayName)
        // 主窗保存 → 推给 docWin；docwin 保存 → mirror-back 回主窗（push 只投递到 docWin，不能回传）。
        if (isDocWindowMode()) await pushContentMirrorBack(tab, content, title)
        else await pushContentMirror(tab, content, title)
      }
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ saving: false, lastError: msg })
      showToast("文档保存失败", msg, "destructive")
      return false
    }
  },

  loadDesc: async (source): Promise<boolean> => {
    const src = source ?? useSourcesStore.getState().currentSource
    const dir = String(src?.sandboxDir || "").trim()

    if (!src || !dir) {
      descLoadSeq += 1
      set({
        descContent: "",
        latestContent: "",
        descLoaded: false,
        latestLoaded: false,
        mirrorDir: "",
        mirrorTab: "desc",
        mirrorContent: "",
        mirrorPending: false,
        sourceDir: "",
        sourceVer: 0,
        sourceName: "",
        sourceDisplayName: "",
        sourceMdFile: null,
        docContent: "",
        draft: "",
        editing: false,
        loading: false,
        lastError: "",
        pendingGuard: null,
        docTitle: titleFor(get().tab, ""),
      })
      return false
    }

    const ver = Number(src.__ver) || 0
    const prev = get()
    const sameDir = prev.sourceDir === dir

    // 同一源目录已加载：缓存命中仍需按磁盘复核一次（docwin 等外部写入后磁盘已更新，
    // 旧缓存不能覆盖新内容）。sandbox:read-file 当前不回 mtime，故以内容比对 + __ver
    // 作为版本判据；不使用列表里的旧 md，读失败/文件缺失时保留本地缓存。
    if (sameDir && prev.descLoaded) {
      const seq = ++descLoadSeq
      const baseline = prev.descContent
      const file =
        String(src.mdFile ?? "").trim() ||
        descFileOf({ sourceMdFile: null, sourceName: src.name, sourceDisplayName: src.displayName })
      let content = baseline
      if (file) {
        const r = await invokeProtoMethod("sandbox", "readFile", { dir, file })
        if (seq !== descLoadSeq) return false
        if (r.ok) content = asText((r as unknown as Record<string, unknown>).content)
      }
      if (seq !== descLoadSeq) return false

      // 读回包归属校验：已切到其它源则丢弃。
      const live = useSourcesStore.getState().currentSource
      if (live && live.sandboxDir && live.sandboxDir !== dir) {
        set({ loading: false })
        return false
      }
      const now = get()
      if (now.sourceDir !== dir) return false

      // 读盘期间保存/镜像写入了更新内容：保留更新方，避免旧磁盘读回覆盖。
      if (now.descContent !== baseline && now.descContent !== content) content = now.descContent
      // 未消费的 mirror content 是最近一次落盘结果：优先于可能落后的磁盘读回（关闭/重开面板即取它）。
      const nowPending =
        now.mirrorPending &&
        now.mirrorDir === dir &&
        now.mirrorTab === "desc" &&
        Boolean(now.mirrorContent)
      if (nowPending) content = now.mirrorContent

      // 切回同一源：若之前切走时暂存过草稿，恢复编辑态（切换原型不丢草稿）。
      const stashed = now.draftStash[draftKey(dir, "desc")]
      const restoreDraft = !nowPending && stashed !== undefined && stashed !== content ? stashed : null

      set((s) => ({
        loading: false,
        sourceVer: ver,
        sourceName: src.name,
        sourceDisplayName: src.displayName,
        sourceMdFile: src.mdFile ?? null,
        docTitle: s.tab === "desc" ? titleFor("desc", src.displayName) : s.docTitle,
        ...(nowPending ? { mirrorPending: false } : {}),
        ...(content !== s.descContent ? { descContent: content, descLoaded: true } : {}),
        ...(s.tab === "desc" && !s.editing
          ? restoreDraft !== null
            ? { docContent: content, draft: restoreDraft, editing: true }
            : s.docContent !== content
              ? { docContent: content, draft: content }
              : {}
          : {}),
      }))
      // 切回已缓存源时仍向文档窗同步，避免文档窗停留在上一个原型的内容。
      if (get().tab === "desc") {
        await pushContentMirror("desc", content, titleFor("desc", get().sourceDisplayName))
      }
      return true
    }

    const seq = ++descLoadSeq
    // 切到新源：先把当前未保存草稿按「旧目录 + Tab」暂存，切回该原型可恢复编辑态。
    if (!sameDir) get().stashDraft()
    set((s) => ({
      loading: true,
      lastError: "",
      sourceDir: dir,
      sourceVer: ver,
      sourceName: src.name,
      sourceDisplayName: src.displayName,
      sourceMdFile: src.mdFile ?? null,
      docTitle: titleFor(s.tab, src.displayName),
      ...(sameDir
        ? {}
        : {
            descContent: "",
            latestContent: "",
            descLoaded: false,
            latestLoaded: false,
            mirrorDir: "",
            mirrorTab: "desc",
            mirrorContent: "",
            mirrorPending: false,
            docContent: "",
            draft: "",
            editing: false,
          }),
    }))

    // 优先列表自带的 md；缺失才读磁盘同名 md（旧 getDocMd + sandbox.readFile 口径）。
    let content = typeof src.md === "string" ? src.md : ""
    if (!content && src.mdFile) {
      const r = await invokeProtoMethod("sandbox", "readFile", { dir, file: src.mdFile })
      if (seq !== descLoadSeq) return false
      if (r.ok) content = asText((r as unknown as Record<string, unknown>).content)
    }
    if (seq !== descLoadSeq) return false

    // 读回包归属校验：已切到其它源则丢弃。
    const live = useSourcesStore.getState().currentSource
    if (live && live.sandboxDir && live.sandboxDir !== dir) {
      set({ loading: false })
      return false
    }

    set((s) => {
      const stashed = s.draftStash[draftKey(dir, "desc")]
      const restoreDraft = stashed !== undefined && stashed !== content ? stashed : null
      return {
        descContent: content,
        descLoaded: true,
        loading: false,
        lastError: "",
        ...(s.tab === "desc"
          ? sameDir && s.editing
            ? // 同源重载（__ver 推进 / 面板重开）不能覆盖正在编辑的草稿。
              { docContent: content }
            : restoreDraft !== null
              ? { docContent: content, draft: restoreDraft, editing: true }
              : { docContent: content, draft: content, editing: false }
          : {}),
        docTitle: s.tab === "desc" ? titleFor("desc", s.sourceDisplayName) : s.docTitle,
      }
    })

    if (get().tab === "desc") {
      await pushContentMirror("desc", content, titleFor("desc", get().sourceDisplayName))
    }
    return true
  },

  loadLatest: async (dir): Promise<boolean> => {
    const cur = useSourcesStore.getState().currentSource
    const target = String(dir ?? cur?.sandboxDir ?? get().sourceDir ?? "").trim()
    if (!target) {
      latestLoadSeq += 1
      set((s) => ({
        latestContent: "",
        latestLoaded: false,
        loading: false,
        lastError: "",
        mirrorDir: "",
        mirrorTab: "desc",
        mirrorContent: "",
        mirrorPending: false,
        ...(s.tab === "latest" ? { docContent: "", draft: "", editing: false } : {}),
      }))
      return false
    }

    const seq = ++latestLoadSeq
    set((s) => ({
      loading: true,
      lastError: "",
      sourceDir: s.sourceDir || target,
      sourceVer:
        s.sourceDir === target
          ? s.sourceVer
          : cur && cur.sandboxDir === target
            ? Number(cur.__ver) || 0
            : s.sourceVer,
    }))

    const r = await invokeProtoMethod("doc", "readLatest", { dir: target })
    if (seq !== latestLoadSeq) return false

    // 读回包归属校验：已切源/已切目录则丢弃。
    const live = useSourcesStore.getState().currentSource
    if ((live && live.sandboxDir && live.sandboxDir !== target) || (get().sourceDir && get().sourceDir !== target)) {
      set({ loading: false })
      return false
    }
    if (!r.ok) {
      set({ loading: false, lastError: r.error || "读取最新需求失败" })
      return false
    }

    const diskContent = asText((r as unknown as Record<string, unknown>).content)
    // 未消费的 docwin mirror 是最近一次保存结果：优先于可能落后的磁盘读回。
    const prev = get()
    const pendingMirror =
      prev.mirrorPending &&
      prev.mirrorDir === target &&
      prev.mirrorTab === "latest" &&
      Boolean(prev.mirrorContent)
    const content = pendingMirror ? prev.mirrorContent : diskContent
    set((s) => {
      // 切回同一源：恢复之前暂存的「最新需求」草稿。
      const stashed = s.draftStash[draftKey(target, "latest")]
      const restoreDraft = !pendingMirror && stashed !== undefined && stashed !== content ? stashed : null
      return {
        latestContent: content,
        latestLoaded: true,
        loading: false,
        lastError: "",
        ...(pendingMirror ? { mirrorPending: false } : {}),
        ...(s.tab === "latest"
          ? s.editing
            ? // 同源重读（__ver 推进）保留正在编辑的草稿。
              { docContent: content }
            : restoreDraft !== null
              ? { docContent: content, draft: restoreDraft, editing: true }
              : { docContent: content, draft: content, editing: false }
          : {}),
        docTitle: s.tab === "latest" ? titleFor("latest", s.sourceDisplayName) : s.docTitle,
      }
    })

    if (get().tab === "latest") {
      await pushContentMirror("latest", content, titleFor("latest", get().sourceDisplayName))
    }
    return true
  },

  applyMirrorContent: (payload) => {
    const rec = asRecord(payload)
    const direct = typeof payload === "string" ? payload : ""
    const content = direct || asText(rec?.content ?? rec?.md ?? rec?.text)
    const tab: DocsTabId = rec?.tab === "latest" || rec?.reqMode === true ? "latest" : "desc"
    const dir = asText(rec?.dir)
    const title = asText(rec?.title)
    // 主窗收 docwin 回推的 content：记下未消费内容，关闭/重开面板时直接命中，
    // 不被随后可能落后的磁盘读回/旧缓存覆盖。文档窗内只应用内容，不记回推标记。
    const mirrorDir = dir || get().sourceDir
    const markPending = !isDocWindowMode() && Boolean(mirrorDir)
    set((s) => {
      // 外部（docwin）已落盘的正文覆盖时，清掉对应暂存，避免之后切回复活旧草稿。
      const stash = { ...s.draftStash }
      if (mirrorDir) delete stash[draftKey(mirrorDir, tab)]
      return {
        tab,
        docContent: content,
        draft: content,
        editing: false,
        lastError: "",
        draftStash: stash,
        ...(tab === "desc"
          ? { descContent: content, descLoaded: true }
          : { latestContent: content, latestLoaded: true }),
        ...(dir ? { sourceDir: dir } : {}),
        ...(markPending
          ? { mirrorDir, mirrorTab: tab, mirrorContent: content, mirrorPending: true }
          : {}),
        ...(title ? { docTitle: title } : {}),
        reqVersion: s.reqVersion + 1,
      }
    })
  },
}))

/* ═══════════ 独立文档窗口（W3-04 只读消费） ═══════════ */

export type DocWindowMode = "panel" | "win"

export interface DocWindowOpenOptions {
  /** 项目名；缺省取当前 sources-store 项目。 */
  project?: string
  /** 原型显示名；缺省取当前 SourceRef.displayName。 */
  proto?: string
}

export interface DocWindowState {
  /** 当前文档承载形态：主窗面板 or 独立窗口。 */
  mode: DocWindowMode
  /** docwin 请求进行中。 */
  busy: boolean
  /** 在独立窗口打开文档（`docwin:open`）。 */
  open: (opts?: DocWindowOpenOptions) => Promise<DocWindowMode | null>
  /** 关闭独立窗口（`docwin:close`）。 */
  close: () => Promise<DocWindowMode | null>
  /** 切换面板/独立窗口（`docwin:toggle`）。 */
  toggle: () => Promise<DocWindowMode | null>
}

export interface DocWindowHook {
  (): DocWindowState
  <S>(selector: (s: DocWindowState) => S): S
  getState: () => DocWindowState
  setState: (partial: Partial<DocWindowState> | ((s: DocWindowState) => Partial<DocWindowState>)) => void
  subscribe: (listener: () => void) => () => void
}

function docWindowArgs(opts?: DocWindowOpenOptions): { project: string; proto: string } {
  const sources = useSourcesStore.getState()
  const src = sources.currentSource
  const project = String(opts?.project ?? sources.project ?? useAppStore.getState().project ?? "").trim()
  const proto = String(opts?.proto ?? src?.displayName ?? src?.name ?? "")
    .replace(/\.(html?|md)$/i, "")
    .trim()
  return { project, proto }
}

function modeOf(r: { ok: boolean; error?: string } | null): DocWindowMode | null {
  const raw = r as unknown as Record<string, unknown> | null
  const mode = raw?.mode
  return mode === "win" || mode === "panel" ? mode : null
}

function docWindowError(r: { ok: boolean; error?: string } | null): string {
  if (r && !r.ok) return r.error === "busy" ? "AI 任务进行中，请稍后再切换文档窗口" : r.error || "文档窗口操作失败"
  return ""
}

export const useDocWindow: DocWindowHook = create<DocWindowState>()((set, get) => ({
  mode: isDocWindowMode() ? "win" : "panel",
  busy: false,

  open: async (opts): Promise<DocWindowMode | null> => {
    if (get().busy) return null
    set({ busy: true })
    const r = await invokeProtoMethod("docwin", "open", docWindowArgs(opts))
    const mode = modeOf(r)
    set({ busy: false, ...(mode ? { mode } : {}) })
    if (!r.ok || !mode) {
      showToast("无法打开独立文档窗口", docWindowError(r), "destructive")
      return null
    }
    if (mode === "win") {
      useUiStore.getState().closeDocs()
      const doc = useDocsStore.getState()
      if (doc.docContent) void pushContentMirror(doc.tab, doc.docContent, doc.docTitle)
    }
    return mode
  },

  close: async (): Promise<DocWindowMode | null> => {
    if (get().busy) return null
    set({ busy: true })
    const r = await invokeProtoMethod("docwin", "close")
    const mode = modeOf(r)
    set({ busy: false, ...(mode ? { mode } : {}) })
    if (!r.ok || !mode) {
      showToast("无法关闭独立文档窗口", docWindowError(r), "destructive")
      return null
    }
    // 关闭独立窗口 = 切回主窗面板（X 关窗只同步按钮态，不自动开面板）。
    if (mode === "panel") {
      // 文档窗保存已落盘：回面板前按磁盘复核，mirror 消息晚到/丢失也不展示旧正文。
      await refreshDocsBeforePanel()
      useUiStore.getState().openDocs()
    }
    return mode
  },

  toggle: async (): Promise<DocWindowMode | null> => {
    if (get().busy) return null
    set({ busy: true })
    const r = await invokeProtoMethod("docwin", "toggle")
    const mode = modeOf(r)
    set({ busy: false, ...(mode ? { mode } : {}) })
    if (!r.ok || !mode) {
      showToast("无法切换文档窗口", docWindowError(r), "destructive")
      return null
    }
    if (mode === "win") {
      useUiStore.getState().closeDocs()
      // toggle 不接收 project/proto：先同步源身份，再推内容（新窗从第一个原型切到当前原型）。
      await pushSourceMirror()
      const doc = useDocsStore.getState()
      if (doc.docContent) void pushContentMirror(doc.tab, doc.docContent, doc.docTitle)
    } else {
      await refreshDocsBeforePanel()
      useUiStore.getState().openDocs()
    }
    return mode
  },
}))

/**
 * 主窗回到面板前按磁盘复核当前源：docwin 保存已落盘，但 mirror 消息可能晚到或丢失，
 * 此时直接重读 md（loadDesc 缓存命中也会复核磁盘），关闭/重开面板即看到最新内容。
 * 当前源与文档缓存目录不一致时不动，避免把 A 原型内容回填到 B 原型。
 */
async function refreshDocsBeforePanel(): Promise<void> {
  const doc = useDocsStore.getState()
  const src = useSourcesStore.getState().currentSource
  if (!src || !src.sandboxDir) return
  if (doc.sourceDir && doc.sourceDir !== src.sandboxDir) return
  try {
    await doc.loadDesc(src)
  } catch {
    // 磁盘复核失败保留现有缓存（mirror content 已写入）。
  }
}

/**
 * 主窗 `doc:mirror` 分发：
 * - kind=content（docwin 保存后经 doc:mirror-back 回传）→ 写入正文/草稿/缓存；
 * - kind=mode（docwin 打开/关闭通知）→ 同步按钮态（只改 mode，不自动开面板）。
 * 文档窗内忽略 content（自身编辑由 DocWindow 的监听处理），避免回推自应用。
 */
export function applyDocMirrorMessage(msg: unknown): void {
  try {
    const rec = asRecord(msg)
    if (!rec) return
    if (rec.kind === "content") {
      if (isDocWindowMode()) return
      const payload = asRecord(rec.payload) ?? rec
      const dir = asText(payload.dir)
      const liveDir =
        String(useSourcesStore.getState().currentSource?.sandboxDir || "").trim() ||
        useDocsStore.getState().sourceDir
      // 源切换守卫：docwin 回推的目录与主窗当前源不一致时丢弃，避免 A 原型内容写进 B 原型。
      if (dir && liveDir && dir !== liveDir) return
      useDocsStore.getState().applyMirrorContent(rec.payload ?? rec)
      return
    }
    if (rec.kind !== "mode") return
    const payload = asRecord(rec.payload)
    const mode = rec.mode ?? payload?.mode
    if (mode === "win" || mode === "panel") {
      useDocWindow.setState({ mode, busy: false })
    }
  } catch {
    // 脏 mirror 消息静默丢弃。
  }
}

/** docwin 自身关闭/主进程 closed 通知 → 同步主窗按钮态（只改 mode，不自动开面板）。 */
let docWindowMirrorBound = false
function bindDocWindowMirror(): void {
  if (docWindowMirrorBound) return
  docWindowMirrorBound = true
  try {
    onDocMirror((msg) => applyDocMirrorMessage(msg))
  } catch {
    // 网关缺失（纯浏览器预览）时无监听。
  }
}

bindDocWindowMirror()

/**
 * 文档面板关闭守卫。
 *
 * DocsPanelHost 的关闭按钮 / 遮罩、MainWindow 的 Esc 栈都会直接 `ui-store.closeDocs()`，
 * 本模块在关闭瞬间拦下：有未保存草稿时把面板拉回打开态并挂起 `pendingGuard=close-panel`，
 * 由 DocsPanel 渲染 Confirm（放弃 / 继续编辑）。确认放弃后才真正关闭，取消则草稿与编辑态原样保留。
 *
 * 例外：打开独立文档窗时的程序性收面板（mode 已切到 win）不拦——草稿仍留在主窗 store，
 * 关掉独立窗回面板时可继续编辑。
 */
let docsPanelGuardBound = false
let lastDocsOpen = false
function bindDocsPanelGuard(): void {
  if (docsPanelGuardBound) return
  docsPanelGuardBound = true
  lastDocsOpen = useUiStore.getState().docsOpen
  useUiStore.subscribe(() => {
    const open = useUiStore.getState().docsOpen
    const prev = lastDocsOpen
    lastDocsOpen = open
    if (!prev || open) return
    if (isDocWindowMode() || useDocWindow.getState().mode === "win") return
    const doc = useDocsStore.getState()
    if (doc.draft === doc.docContent) return
    useDocsStore.setState({ pendingGuard: { kind: "close-panel" } })
    // 同步回开：React 只在最终快照上渲染，面板不会被卸载，Confirm 直接出现在原面板里。
    useUiStore.getState().openDocs()
  })
}

bindDocsPanelGuard()
