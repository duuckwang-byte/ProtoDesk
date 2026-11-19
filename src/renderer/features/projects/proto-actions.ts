/**
 * src/renderer/features/projects/proto-actions.ts — W3-01 原型/子页动作（侧栏底部入口用）。
 *
 * 对应旧实现：
 * - 新建原型：`sandbox:create`（`main/services/sandbox-storage-service.js:1663-1689`）
 * - 导入原型：`pick-text-file` + `sandbox:adopt`（`project-ai-export.js:304-321`）
 * - 重命名/删除原型：`sandbox:rename` / `sandbox:remove`
 * - 子页 CRUD：`sandbox:create-subpage/rename-subpage/delete-subpage`
 *   （`js/sandbox-core.js:342-502`）
 *
 * 本文件只做“调用 + 成功后刷新 sources-store”，不重复实现存储逻辑；
 * 所有 IPC 通道均在 70 冻结表内，不新增通道。
 */

import { getProtoApi, invokeProtoMethod, ipcErrorText } from "@/lib/ipc"
import { useSourcesStore, type SourceKind, type SourcesActionResult } from "@/stores/sources-store"

export interface ProtoActionResult extends SourcesActionResult {
  /** 用户取消（pick-text-file 返回 null）。 */
  cancelled?: boolean
  /** 导入拆分时创建的全部原型名。 */
  created?: string[]
  /** 子页文件名（create/rename 成功时）。 */
  file?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return typeof value === "string" ? value : String(value)
}

function fail(error: unknown, fallback: string): ProtoActionResult {
  return { ok: false, error: error ? ipcErrorText(error) : fallback }
}

function currentProject(explicit?: string): string {
  return String(explicit || useSourcesStore.getState().project || "").trim()
}

function resultOf(r: { ok: boolean; error?: string }): ProtoActionResult {
  return r.ok ? { ok: true } : { ok: false, error: r.error || "操作失败" }
}

/* ═══════════ 新建 / 导入 ═══════════ */

export interface CreateProtoInput {
  name: string
  kind: SourceKind
  project?: string
}

/**
 * 新建空白原型并选中（sandbox:create）。
 * @param input 名称/端别/项目
 * @returns 操作结果（name = 新建原型文件夹名）
 */
export async function createProto(input: CreateProtoInput): Promise<ProtoActionResult> {
  const project = currentProject(input.project)
  if (!project) return { ok: false, error: "尚未进入任何项目，请先选择项目" }
  const name = String(input.name || "").trim()
  if (!name) return { ok: false, error: "请输入原型名称" }
  const r = await invokeProtoMethod("sandbox", "create", {
    name,
    kind: input.kind === "pc" ? "pc" : "mobile",
    project,
  })
  if (!r.ok) return resultOf(r)
  const created = asText((r as unknown as Record<string, unknown>).name) || name
  await useSourcesStore.getState().loadSources(project, created)
  return { ok: true, name: created }
}

export interface AdoptProtoInput {
  name: string
  content: string
  srcPath?: string
  project?: string
}

/**
 * 导入单个 html 为原型（sandbox:adopt）并选中。
 * @param input 文件名/内容/来源路径/项目
 * @returns 操作结果（name = 导入后的原型文件夹名）
 */
export async function adoptProto(input: AdoptProtoInput): Promise<ProtoActionResult> {
  const project = currentProject(input.project)
  if (!project) return { ok: false, error: "尚未进入任何项目，请先选择项目" }
  const name = String(input.name || "").trim()
  if (!name) return { ok: false, error: "缺少文件名" }
  if (typeof input.content !== "string") return { ok: false, error: "文件内容为空" }
  const r = await invokeProtoMethod("sandbox", "adopt", {
    name,
    content: input.content,
    srcPath: input.srcPath || "",
    project,
  })
  if (!r.ok) return resultOf(r)
  const rec = r as unknown as Record<string, unknown>
  const created = asText(rec.name) || name
  await useSourcesStore.getState().loadSources(project, created)
  return { ok: true, name: created }
}

/** pick-text-file 的顶层网关调用（不在 sandbox 命名空间下，不能用 invokeProtoMethod）。 */
async function pickTextFile(opts: Record<string, unknown>): Promise<unknown> {
  const api = getProtoApi()
  const fn: unknown = api ? api["pickTextFile"] : undefined
  if (typeof fn !== "function") throw new Error("missing protoAPI: pickTextFile")
  return await (fn as (o: unknown) => unknown)(opts)
}

interface PickedFile {
  path: string
  name: string
  content: string
  error?: string
}

function normalizePickedFile(value: unknown): PickedFile | null {
  const rec = asRecord(value)
  if (!rec) return null
  const name = asText(rec.name).trim()
  const content = typeof rec.content === "string" ? rec.content : ""
  if (!name) return null
  return {
    path: asText(rec.path),
    name,
    content,
    error: asText(rec.error) || undefined,
  }
}

/**
 * 从本地选择 html 文件导入（可多选），逐个 sandbox:adopt。
 * @returns 操作结果；用户取消时 `{ok:false, cancelled:true}`（调用方不 toast）
 */
export async function importProtoFromFile(): Promise<ProtoActionResult> {
  const project = currentProject()
  if (!project) return { ok: false, error: "尚未进入任何项目，请先选择项目" }
  let picked: unknown
  try {
    picked = await pickTextFile({
      title: "导入原型",
      filters: [{ name: "HTML 原型", extensions: ["html", "htm"] }],
      multi: true,
    })
  } catch (e) {
    return fail(e, "打开文件选择器失败")
  }
  if (picked === null || picked === undefined) return { ok: false, cancelled: true }

  const rec = asRecord(picked)
  const rawFiles = rec && Array.isArray(rec.files) ? rec.files : [picked]
  const files = rawFiles.map(normalizePickedFile).filter((f): f is PickedFile => !!f)
  if (!files.length) return { ok: false, error: "未选择可导入的 HTML 文件" }

  const created: string[] = []
  let lastError = ""
  for (const file of files) {
    if (file.error) {
      lastError = file.error
      continue
    }
    const r = await invokeProtoMethod("sandbox", "adopt", {
      name: file.name,
      content: file.content,
      srcPath: file.path,
      project,
    })
    if (!r.ok) {
      lastError = r.error || "导入失败：" + file.name
      continue
    }
    const out = r as unknown as Record<string, unknown>
    const splitCreated = Array.isArray(out.created)
      ? out.created.map((v) => asText(v)).filter(Boolean)
      : []
    if (splitCreated.length) created.push(...splitCreated)
    else {
      const one = asText(out.name) || file.name
      created.push(one)
    }
  }
  if (!created.length) return { ok: false, error: lastError || "导入失败" }

  await useSourcesStore.getState().loadSources(project, created[created.length - 1])
  return { ok: true, name: created[created.length - 1], created }
}

/* ═══════════ 原型重命名 / 删除 ═══════════ */

/**
 * 重命名原型（sandbox:rename）。
 * @param dir 原型沙箱目录
 * @param name 新名称
 * @returns 操作结果
 */
export async function renameProto(dir: string, name: string): Promise<ProtoActionResult> {
  const target = String(dir || "").trim()
  const next = String(name || "").trim()
  if (!target || !next) return { ok: false, error: "缺少目录或新名称" }
  const before = useSourcesStore
    .getState()
    .sources.find((source) => source.sandboxDir === target)
  const oldKey = before ? before.displayName || before.name : ""
  const r = await invokeProtoMethod("sandbox", "rename", { dir: target, name: next })
  if (!r.ok) return resultOf(r)
  const renamed = asText((r as unknown as Record<string, unknown>).name) || next
  // 分组 map / protoOrder_v1 以显示名为 key：改名后同步，避免原型掉出文件夹。
  if (oldKey && oldKey !== renamed) {
    useSourcesStore.getState().remapProtoKey(oldKey, renamed)
  }
  const project = useSourcesStore.getState().project
  if (project) await useSourcesStore.getState().loadSources(project, renamed)
  else await useSourcesStore.getState().refresh()
  return { ok: true, name: renamed }
}

/**
 * 删除原型（sandbox:remove；仅项目下二级目录）。
 * @param dir 原型沙箱目录
 * @returns 操作结果
 */
export async function removeProto(dir: string): Promise<ProtoActionResult> {
  const target = String(dir || "").trim()
  if (!target) return { ok: false, error: "缺少原型目录" }
  const r = await invokeProtoMethod("sandbox", "remove", { dir: target })
  if (!r.ok) return resultOf(r)
  await useSourcesStore.getState().refresh()
  return { ok: true }
}

/* ═══════════ 子页面 CRUD ═══════════ */

/**
 * 新建子页面（sandbox:create-subpage）。
 *
 * 创建成功后按父原型（`dir`）刷新 subPages/htmlFiles 并切到新子页；父原型不是当前源时
 * 先切父源再切子页，避免成功创建后报「子页面不存在」。
 * 创建失败不触碰 store（不刷新、不清空列表），由调用方 toast 明确的错误文案。
 *
 * @param dir 原型沙箱目录
 * @param name 子页名称
 * @param kind 端别（默认沿用当前源）
 * @returns 操作结果（file = 新文件名）
 */
export async function createSubPage(
  dir: string,
  name: string,
  kind?: SourceKind
): Promise<ProtoActionResult> {
  const target = String(dir || "").trim()
  const next = String(name || "").trim()
  if (!target || !next) return { ok: false, error: "缺少目录或子页名称" }
  const r = await invokeProtoMethod("sandbox", "createSubPage", {
    dir: target,
    name: next,
    kind: kind || useSourcesStore.getState().currentSource?.kind || "pc",
  })
  if (!r.ok) return resultOf(r)
  const file = asText((r as unknown as Record<string, unknown>).file)
  const selected = await useSourcesStore.getState().syncCreatedSubPage(target, file, next)
  return {
    ok: true,
    file: file || (selected ? useSourcesStore.getState().activeSubFile : ""),
    name: next,
  }
}

/**
 * 重命名子页面（sandbox:rename-subpage）。
 * @param dir 原型沙箱目录
 * @param oldFile 旧文件名
 * @param newName 新名称
 * @returns 操作结果（file = 新文件名）
 */
export async function renameSubPage(
  dir: string,
  oldFile: string,
  newName: string
): Promise<ProtoActionResult> {
  const target = String(dir || "").trim()
  const from = String(oldFile || "").trim()
  const next = String(newName || "").trim()
  if (!target || !from || !next) return { ok: false, error: "缺少目录/旧文件/新名称" }
  const r = await invokeProtoMethod("sandbox", "renameSubPage", {
    dir: target,
    oldFile: from,
    newName: next,
  })
  if (!r.ok) return resultOf(r)
  const rec = r as unknown as Record<string, unknown>
  const file = asText(rec.newFile)
  await useSourcesStore.getState().refresh()
  if (file) await useSourcesStore.getState().selectSubPage(file)
  return { ok: true, file, name: next }
}

/**
 * 删除子页面（sandbox:delete-subpage）。
 * @param dir 原型沙箱目录
 * @param file 子页文件名
 * @returns 操作结果
 */
export async function deleteSubPage(dir: string, file: string): Promise<ProtoActionResult> {
  const target = String(dir || "").trim()
  const f = String(file || "").trim()
  if (!target || !f) return { ok: false, error: "缺少目录或子页文件名" }
  const r = await invokeProtoMethod("sandbox", "deleteSubPage", { dir: target, file: f })
  if (!r.ok) return resultOf(r)
  await useSourcesStore.getState().refresh()
  return { ok: true, file: f }
}
