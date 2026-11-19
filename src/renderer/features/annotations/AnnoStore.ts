/**
 * features/annotations/AnnoStore.ts — 需求标注轻量状态 + 纯函数（Wave 2-L）。
 * 旧语义对齐：js/annotation-core.js（CURRENT_ANNOTATIONS 条目形态、selector+page+htmlFile
 * 三键匹配、编号=全量创建序、__EXPORT_BOOT__ 下只读 __ANNO_MAP__）。
 * 存储通道只读消费：lib/ipc.ts invokeProtoMethod（annotations.read/save），不新增通道。
 */

import { invokeProtoMethod } from "@/lib/ipc";
import {
  PROTO_ANNO_VISIBLE,
  readText,
  writeText,
} from "@/lib/storage-keys";
import type { IpcOk } from "@/types/ipc";

/** 单条需求标注（沿用 annotation-core.js 字段口径）。 */
export interface AnnoItem {
  id: string;
  htmlFile: string;
  selector: string;
  textSnippet: string;
  tagName: string;
  elementName: string;
  page: string;
  title: string;
  content: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
}

/** 标注颜色体系（深绿/蓝/橙/浅灰，与旧渲染同色，见 annotation-core.js ANNO_COLORS）。 */
export const ANNO_COLORS = [
  { id: "green", bg: "#047857", fg: "#ffffff" },
  { id: "blue", bg: "#2563EB", fg: "#ffffff" },
  { id: "orange", bg: "#EA580C", fg: "#ffffff" },
  { id: "gray", bg: "#F1F5F9", fg: "#1F2937" },
] as const;

export type AnnoColorId = (typeof ANNO_COLORS)[number]["id"];

/** 取标注颜色（非法回绿，与旧 annoColorOf 一致）。 */
export function annoColorOf(anno: Pick<AnnoItem, "color">): { id: string; bg: string; fg: string } {
  const c = String((anno && anno.color) || "green");
  for (const cc of ANNO_COLORS) if (cc.id === c) return { ...cc };
  return { ...ANNO_COLORS[0] };
}

/** 三键匹配键：selector + page + htmlFile（旧查找口径，无 htmlFile 视为通配由调用方处理）。 */
export function annoMatchKey(a: Pick<AnnoItem, "selector" | "page" | "htmlFile">): string {
  return String(a.selector || "") + "￨" + String(a.page || "") + "￨" + String(a.htmlFile || "");
}

/** 查找已存在标注：先按 id，再按三键（兼容旧无 htmlFile 数据的通配回退）。 */
export function findAnno(
  list: AnnoItem[],
  sel: { id?: string | null; selector: string; page: string; htmlFile: string },
): AnnoItem | null {
  if (sel.id) {
    const hit = list.find((a) => a.id === sel.id);
    if (hit) return hit;
  }
  for (const a of list) {
    if (a.selector !== sel.selector) continue;
    if ((a.page || "") !== (sel.page || "")) continue;
    if (a.htmlFile && sel.htmlFile && a.htmlFile !== sel.htmlFile) continue;
    return a;
  }
  return null;
}

/** 新增或更新（按 id 或三键合并，与旧 saveCurrentAnno 一致）。 */
export function upsertAnno(list: AnnoItem[], item: AnnoItem): AnnoItem[] {
  const next = list.slice();
  const idx = next.findIndex(
    (a) =>
      (item.id && a.id === item.id) ||
      (a.selector === item.selector &&
        (a.page || "") === (item.page || "") &&
        (!a.htmlFile || !item.htmlFile || a.htmlFile === item.htmlFile)),
  );
  if (idx >= 0) {
    const base = next[idx];
    // 命中既有条目时保持身份稳定：id/createdAt 不被新对象覆盖（更新只看 updatedAt）。
    next[idx] = {
      ...base,
      ...item,
      id: base.id || item.id,
      createdAt: base.createdAt || item.createdAt,
      updatedAt: item.updatedAt,
    };
  } else next.push(item);
  return next;
}

/** 按 id 删除。 */
export function removeAnnoById(list: AnnoItem[], id: string): AnnoItem[] {
  return list.filter((a) => a.id !== id);
}

/** 固定编号：全量创建序（index+1），与画布徽标/管理列表一致，不随分组重排。 */
export function annoNumberOf(list: AnnoItem[], id: string): number {
  const i = list.findIndex((a) => a.id === id);
  return i >= 0 ? i + 1 : 0;
}

/** 按页面分组（空页归“首页”，排序稳定，与旧 renderAnnoMgrList 一致）。 */
export function groupAnnosByPage(list: AnnoItem[]): Array<{ page: string; items: AnnoItem[] }> {
  const groups = new Map<string, AnnoItem[]>();
  for (const a of list) {
    const key = a.page || "首页";
    const arr = groups.get(key);
    if (arr) arr.push(a);
    else groups.set(key, [a]);
  }
  return [...groups.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], "zh-CN"))
    .map(([page, items]) => ({ page, items }));
}

/** 归一化 protoAPI 回包 data 为标注数组（坏数据回空，不抛错）。 */
export function normalizeAnnoList(raw: unknown): AnnoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AnnoItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) continue;
    if (typeof o.selector !== "string" || !o.selector) continue;
    out.push({
      id: String(o.id),
      htmlFile: String(o.htmlFile || ""),
      selector: String(o.selector || ""),
      textSnippet: String(o.textSnippet || ""),
      tagName: String(o.tagName || ""),
      elementName: String(o.elementName || o.textSnippet || ""),
      page: String(o.page || ""),
      title: String(o.title || ""),
      content: String(o.content || ""),
      author: String(o.author || "PM"),
      createdAt: String(o.createdAt || ""),
      updatedAt: String(o.updatedAt || o.createdAt || ""),
      color: typeof o.color === "string" ? o.color : undefined,
    });
  }
  return out;
}

/** 标注时间戳（本地 `YYYY-MM-DD HH:mm`，与旧 saveCurrentAnno 口径一致）。 */
export function annoTimestamp(d?: Date): string {
  const now = d || new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    "-" +
    pad(now.getMonth() + 1) +
    "-" +
    pad(now.getDate()) +
    " " +
    pad(now.getHours()) +
    ":" +
    pad(now.getMinutes())
  );
}

/** 新建标注条目工厂（id/时间戳本地生成，与旧 saveCurrentAnno 口径一致）。 */
export function makeAnnoItem(init: {
  htmlFile: string;
  selector: string;
  page: string;
  content: string;
  textSnippet?: string;
  tagName?: string;
  elementName?: string;
}): AnnoItem {
  const stamp = annoTimestamp();
  return {
    id: "anno_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    htmlFile: init.htmlFile,
    selector: init.selector,
    textSnippet: init.textSnippet || "",
    tagName: (init.tagName || "").toUpperCase(),
    elementName: init.elementName || init.textSnippet || "",
    page: init.page,
    title: "",
    content: init.content,
    author: "PM",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** 只读：导出单文件语义（__EXPORT_BOOT__ 为 true 时取内嵌 __ANNO_MAP__，与旧 loadAnnotations 一致）。 */
export function getExportAnnoMap(): Record<string, AnnoItem[]> {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__EXPORT_BOOT__ !== true) return {};
    const map = w.__ANNO_MAP__ as Record<string, unknown> | undefined;
    if (!map || typeof map !== "object") return {};
    const out: Record<string, AnnoItem[]> = {};
    for (const k of Object.keys(map)) out[k] = normalizeAnnoList((map as Record<string, unknown>)[k]);
    return out;
  } catch {
    return {};
  }
}

/* ═══════════ 标注显隐（storage-keys 常量只读消费） ═══════════ */

/**
 * 读标注角标显隐（键 `proto_anno_visible`，与旧 annotation-core.js 一致）。
 * 缺省可见；存量 `false`/`0`/`off` 视为隐藏。
 * @returns true=显示角标
 */
export function readAnnoVisible(): boolean {
  const raw = readText(PROTO_ANNO_VISIBLE);
  if (raw === null) return true;
  const v = raw.trim().toLowerCase();
  return !(v === "false" || v === "0" || v === "off");
}

/**
 * 写标注角标显隐（沿用旧 `'1'`/`'0'` 取值，读取侧兼容 `true`/`false`）。
 * @param visible 是否显示
 */
export function writeAnnoVisible(visible: boolean): void {
  writeText(PROTO_ANNO_VISIBLE, visible ? "1" : "0");
}

export interface AnnoLoadResult {
  ok: boolean;
  list: AnnoItem[];
  error?: string;
}

/** 经 IPC 读取标注（annotations.read，dir 为沙箱目录）。 */
export async function loadAnnos(dir: string): Promise<AnnoLoadResult> {
  if (!dir) return { ok: true, list: [] };
  const r = (await invokeProtoMethod("annotations", "read", dir)) as IpcOk & { data?: unknown };
  if (!r || !r.ok) return { ok: false, list: [], error: r && r.error };
  return { ok: true, list: normalizeAnnoList(r.data) };
}

/** 经 IPC 保存标注（annotations.save，导出态下短路不写，与旧 saveAnnotations 一致）。 */
export async function saveAnnos(dir: string, list: AnnoItem[]): Promise<IpcOk> {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__EXPORT_BOOT__ === true) return { ok: true };
  } catch {
    // 忽略。
  }
  if (!dir) return { ok: false, error: "missing-dir" };
  return invokeProtoMethod("annotations", "save", dir, list);
}
