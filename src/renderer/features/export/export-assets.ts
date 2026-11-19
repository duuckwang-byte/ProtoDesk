/**
 * src/renderer/features/export/export-assets.ts — W3-04 导出素材内联（独立 HTML）。
 *
 * 对应旧实现 `js/project-ai-export.js:7617-7662`（`inlineMarkdownImages` / `readOneAsset`）：
 * - 列表：`sandbox:list-assets`（`{dir}` → `{ok, items:[{name,relPath,size,mtimeMs}]}`）
 * - 读取：`sandbox:read-asset-base64`（`{dir,relPath}` → `{ok,dataUrl}`，仅 assets/ 内图片）
 * - 替换：md 图片 `![alt](assets/x.png)` → `![alt](data:image/...;base64,...)`
 *
 * 约束：
 * - 只读消费冻结通道，不新增 IPC；
 * - 远程/内联/锚点/绝对路径一律跳过；列表或单张读取失败保留原路径，不阻断导出；
 * - 同时导出文档 PNG/PDF 入参构造（主进程 `doc-export-service.js` 只认 `html`，禁止发 `content`）。
 */

import { invokeProtoMethod } from "@/lib/ipc"

/** md 图片语法（容忍自有 GFM 后缀 `{w=NN align=xx}`；与旧实现逐字一致）。 */
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)(\{[^{}]*\})?/g
/** 不内联的图片前缀（旧 `inlineMarkdownImages` skip 口径）。 */
const SKIP_SCHEME_RE = /^(?:data:|https?:|file:|proto-asset:|blob:|javascript:)/i

/** `sandbox:list-assets` 条目（只取本模块用到的字段）。 */
export interface ExportAssetItem {
  name?: string
  relPath?: string
}

/** 资产读取 IO（生产走 IPC；单测可注入，覆盖降级分支）。 */
export interface ExportAssetIo {
  listAssets: (dir: string) => Promise<{ ok: boolean; items?: ExportAssetItem[] }>
  readAssetBase64: (dir: string, relPath: string) => Promise<{ ok: boolean; dataUrl?: string }>
}

export interface DocExportPayload {
  title: string
  html: string
  width: number
  scale: number
}

/** 文档长图默认逻辑宽度（主进程 clamp 600..2400）。 */
export const DOC_EXPORT_WIDTH = 1200
/** 文档长图默认缩放（主进程 clamp 1..3）。 */
export const DOC_EXPORT_SCALE = 2

function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return typeof value === "string" ? value : String(value)
}

/** 归一化 assets 路径：反斜杠转斜杠，去 `./` 与前导 `/`（用于 list/read 与 map key）。 */
export function normalizeAssetPath(path: string): string {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
}

/** 取 md 图片括号内的路径段（首个空白前的 token，去首尾引号）。 */
export function markdownImagePath(inner: string): string {
  const raw = String(inner ?? "").trim()
  if (!raw) return ""
  return raw.split(/\s+/)[0].replace(/^['"]|['"]$/g, "")
}

/** 是否可内联：相对 `assets/` 图片；远程/内联/锚点/绝对路径跳过。 */
export function isInlineableAssetPath(path: string): boolean {
  const raw = String(path ?? "").trim()
  if (!raw || SKIP_SCHEME_RE.test(raw)) return false
  if (raw.startsWith("#") || raw.startsWith("/")) return false
  return normalizeAssetPath(raw).toLowerCase().includes("assets/")
}

/** 收集 md 中待内联的 assets 图片（按归一化路径去重保序，保留首次原始写法）。 */
export function collectMarkdownImagePaths(md: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const text = String(md ?? "")
  const re = new RegExp(MD_IMAGE_RE.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const path = markdownImagePath(m[1])
    if (!path || !isInlineableAssetPath(path)) continue
    const key = normalizeAssetPath(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

/**
 * 用 dataUrl 映射替换 md 图片路径。
 * @param {string} md Markdown 原文
 * @param {Map<string, string> | Record<string, string>} dataUrls key 为归一化路径
 * @returns {string} 替换后的 Markdown（未命中的图片保留原样）
 */
export function replaceMarkdownImages(
  md: string,
  dataUrls: Map<string, string> | Record<string, string>,
): string {
  const src = String(md ?? "")
  if (!src || !src.includes("![")) return src
  const lookup = (path: string): string => {
    const key = normalizeAssetPath(path)
    if (dataUrls instanceof Map) return asText(dataUrls.get(key))
    return asText((dataUrls as Record<string, string>)[key])
  }
  return src.replace(MD_IMAGE_RE, (full: string, inner: string) => {
    const path = markdownImagePath(inner)
    if (!path) return full
    const dataUrl = lookup(path)
    if (!dataUrl) return full
    const at = String(inner).indexOf(path)
    const inFull = String(full).indexOf(inner)
    if (at < 0 || inFull < 0) return full
    const nextInner = inner.slice(0, at) + dataUrl + inner.slice(at + path.length)
    // 用切片拼接而非 replace，避免 dataUrl/title 中的 `$&` 被当成替换模式。
    return full.slice(0, inFull) + nextInner + full.slice(inFull + inner.length)
  })
}

/** 生产 IO：`sandbox:list-assets` / `sandbox:read-asset-base64`。 */
export const defaultExportAssetIo: ExportAssetIo = {
  listAssets: async (dir) => {
    const r = await invokeProtoMethod("sandbox", "listAssets", { dir })
    const items = (r as unknown as { items?: unknown }).items
    return { ok: r.ok, items: Array.isArray(items) ? (items as ExportAssetItem[]) : [] }
  },
  readAssetBase64: async (dir, relPath) => {
    const r = await invokeProtoMethod("sandbox", "readAssetBase64", { dir, relPath })
    const dataUrl = (r as unknown as { dataUrl?: unknown }).dataUrl
    return { ok: r.ok, dataUrl: typeof dataUrl === "string" ? dataUrl : undefined }
  },
}

/**
 * 把 md 中的 assets 图片内联为 dataUrl。
 * 失败（无目录/列表失败/单张读取失败/异常）一律返回原文，不阻断导出。
 * @param {string} md Markdown 原文
 * @param {string} dir 当前原型沙箱目录
 * @param {ExportAssetIo} io 资产 IO（默认走冻结 IPC 通道）
 * @returns {Promise<string>} 内联后的 Markdown（可能含 dataUrl）
 */
export async function inlineMarkdownImages(
  md: string,
  dir: string,
  io: ExportAssetIo = defaultExportAssetIo,
): Promise<string> {
  const src = String(md ?? "")
  const protoDir = String(dir ?? "").trim()
  if (!src || !protoDir) return src
  const wanted = collectMarkdownImagePaths(src)
  if (!wanted.length) return src
  try {
    const listed = await io.listAssets(protoDir)
    if (!listed || !listed.ok) return src
    const available = new Set<string>()
    for (const item of listed.items ?? []) {
      const rel = normalizeAssetPath(
        asText(item?.relPath) || (item?.name ? "assets/" + asText(item.name) : ""),
      )
      if (rel) available.add(rel)
    }
    if (!available.size) return src

    const targets: string[] = []
    const seen = new Set<string>()
    for (const path of wanted) {
      const rel = normalizeAssetPath(path)
      if (!available.has(rel) || seen.has(rel)) continue
      seen.add(rel)
      targets.push(rel)
    }
    if (!targets.length) return src

    const map = new Map<string, string>()
    await Promise.all(
      targets.map(async (relPath) => {
        try {
          const r = await io.readAssetBase64(protoDir, relPath)
          const dataUrl = asText(r?.dataUrl)
          if (r && r.ok && dataUrl.startsWith("data:")) map.set(relPath, dataUrl)
        } catch {
          // 单张读取失败：保留原路径，不阻断其它图片。
        }
      }),
    )
    if (!map.size) return src
    return replaceMarkdownImages(src, map)
  } catch {
    // 列表/读取整体失败：降级为原文（旧实现同口径）。
    return src
  }
}

/**
 * 文档 PNG/PDF 入参：`{title, html, width, scale}`。
 * 主进程 `main/services/doc-export-service.js:40,78` 只读 `o.html`；空 html 返回 null 由调用方 toast。
 * @param {string} title 文档标题
 * @param {string} html `renderDocPreview` 生成的 HTML
 * @returns {DocExportPayload | null} 入参；html 为空返回 null
 */
export function buildDocExportPayload(title: string, html: string): DocExportPayload | null {
  const body = String(html ?? "")
  if (!body.trim()) return null
  return {
    title: String(title ?? "").trim() || "文档",
    html: body,
    width: DOC_EXPORT_WIDTH,
    scale: DOC_EXPORT_SCALE,
  }
}
