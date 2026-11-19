/**
 * features/links/LinkBind.ts — 跳转绑定轻量状态/纯函数（Wave 2-L）。
 * 旧语义对齐：js/link-bind.js（selector+page 双键匹配、_links 缓存形态、
 * filterKept G04 三键匹配 name/displayName/fileKey、_stale 失效标记、_ 私有字段不导出）。
 * 存储通道只读消费：lib/ipc.ts invokeProtoMethod（links.read/write），不新增通道。
 */

import { invokeProtoMethod } from "@/lib/ipc";
import {
  buildAnnoRectsMessage,
  buildNavJumpMessage,
  buildStampMessage,
  postToFrame,
} from "@/features/preview/lib/secure-srcdoc";
import type { IpcOk } from "@/types/ipc";

/** 单条跳转绑定（沿用 currentSource._links 条目口径）。 */
export interface LinkItem {
  id?: string;
  plid?: string;
  selector: string;
  page: string;
  /** 元素所属 html 文件（W3-08 三键：selector + page + htmlFile）。 */
  htmlFile?: string;
  target: string;
  targetPage?: string;
  label?: string;
  text?: string;
  btnName?: string;
  ts?: number;
  _stale?: boolean;
  [key: string]: unknown;
}

/** 可选目标原型（检查器目标列表/管理抽屉替换目标共用）。 */
export interface LinkTargetProto {
  name: string;
  displayName: string;
  kind?: string;
  mainHtmlFile?: string;
  fileKey?: string;
  subPages?: Array<{ file?: string; name?: string } | string>;
}

/** 双键匹配键：selector + page（与旧 openInspector/validateLinks 一致）。 */
export function linkMatchKey(selector: string, page: string): string {
  return String(selector || "") + "￨" + String(page || "");
}

/** 按 selector+page 查找绑定。 */
export function findBinding(links: LinkItem[], selector: string, page: string): LinkItem | null {
  for (const l of links) {
    if (!l) continue;
    if (String(l.selector || "") === String(selector || "") && String(l.page || "") === String(page || "")) return l;
  }
  return null;
}

/**
 * 按三键查找绑定：selector + page + htmlFile（W3-08）。
 * 旧数据无 htmlFile 视为通配（兼容 Wave2 存量 links.json）。
 * @param links 全部绑定
 * @param selector 稳定选择器
 * @param page 来源页面
 * @param htmlFile 来源 html 文件（可空）
 * @returns 命中绑定或 null
 */
export function findLink(links: LinkItem[], selector: string, page: string, htmlFile?: string): LinkItem | null {
  const file = String(htmlFile || "");
  for (const l of links) {
    if (!l) continue;
    if (String(l.selector || "") !== String(selector || "")) continue;
    if (String(l.page || "") !== String(page || "")) continue;
    if (l.htmlFile && file && String(l.htmlFile) !== file) continue;
    return l;
  }
  return null;
}

/** 生成绑定 plid（沿用旧 `lk_` + base36 口径）。 */
export function makeLinkId(): string {
  return "lk_" + Date.now().toString(36) + Math.floor(Math.random() * 2176782336).toString(36);
}

/**
 * 新增或更新绑定：先按 id/plid，再按三键合并（W3-08）。
 * @param links 全部绑定
 * @param item 待写入绑定
 * @returns 新数组（不修改入参）
 */
export function upsertLink(links: LinkItem[], item: LinkItem): LinkItem[] {
  const next = links.slice();
  const idx = next.findIndex((l) => {
    if (!l) return false;
    if (item.id && l.id === item.id) return true;
    if (item.plid && l.plid === item.plid) return true;
    if (String(l.selector || "") !== String(item.selector || "")) return false;
    if (String(l.page || "") !== String(item.page || "")) return false;
    if (l.htmlFile && item.htmlFile && String(l.htmlFile) !== String(item.htmlFile)) return false;
    return true;
  });
  if (idx >= 0) next[idx] = { ...next[idx], ...item };
  else next.push(item);
  return next;
}

/**
 * 按三键移除绑定。
 * @param links 全部绑定
 * @param selector 稳定选择器
 * @param page 来源页面
 * @param htmlFile 来源 html 文件（可空）
 * @returns 新数组
 */
export function removeLink(links: LinkItem[], selector: string, page: string, htmlFile?: string): LinkItem[] {
  return links.filter((l) => !findLink([l], selector, page, htmlFile));
}

/** 剥离下划线私有字段（_stale/_ 等不进导出，与旧 filterKept map 一致）。 */
export function stripPrivateFields(link: LinkItem): LinkItem {
  const out: LinkItem = { selector: link.selector, page: link.page, target: link.target };
  for (const k of Object.keys(link)) {
    if (k.startsWith("_")) continue;
    (out as Record<string, unknown>)[k] = (link as Record<string, unknown>)[k];
  }
  return out;
}

/** G04 导出过滤：三键匹配 name/displayName/fileKey，仅保留目标在勾选集内的绑定并剥离私有字段。 */
export function filterKeptLinks(
  links: LinkItem[],
  chosen: Array<{ name?: string; displayName?: string; fileKey?: string; htmlFile?: string; mainHtmlFile?: string }>,
): LinkItem[] {
  if (!links || !links.length) return [];
  const nameSet = new Set<string>();
  const displayNameSet = new Set<string>();
  const fileKeySet = new Set<string>();
  for (const s of chosen) {
    if (s.name) {
      nameSet.add(s.name);
      fileKeySet.add(s.name);
      const k = String(s.name).replace(/\.(html?)$/i, "");
      if (k) fileKeySet.add(k);
    }
    if (s.displayName) {
      displayNameSet.add(s.displayName);
      fileKeySet.add(s.displayName);
    }
    const fk = (s as { fileKey?: string }).fileKey;
    if (fk) fileKeySet.add(fk);
    if (s.htmlFile) fileKeySet.add(s.htmlFile);
    if (s.mainHtmlFile) fileKeySet.add(s.mainHtmlFile);
  }
  const out: LinkItem[] = [];
  for (const l of links) {
    const t = String(l.target || "");
    if (!nameSet.has(t) && !displayNameSet.has(t) && !fileKeySet.has(t)) continue;
    out.push(stripPrivateFields(l));
  }
  return out;
}

/**
 * 失效标记：查戳优先（plid 命中即有效），备用 selector 单命中补戳/多命中标 stale。
 * @param links 当前绑定
 * @param exists 查询选择器在当前帧文档中的命中数（调用方经同源 DOM 或帧桥提供）
 */
export function markStaleLinks(links: LinkItem[], exists: (selector: string) => number): LinkItem[] {
  return links.map((l) => {
    try {
      const n = exists(l.selector || "");
      return { ...l, _stale: n !== 1 };
    } catch {
      return { ...l, _stale: true };
    }
  });
}

/** 目标展示文案：target + targetPage（与旧 renderLinkMgr 一致）。 */
export function targetLabel(link: Pick<LinkItem, "target" | "targetPage">): string {
  const t = String(link.target || "");
  const p = String(link.targetPage || "");
  return p ? t + " · " + p : t;
}

/** 按钮中文名优先级：btnName > label「」内 > text 前 20 字（与旧 renderLinkMgr 一致）。 */
export function linkButtonName(link: LinkItem): string {
  const btn = String(link.btnName || "");
  if (btn) return btn;
  const label = String(link.label || "");
  const m = label.match(/「([^」]+)」/);
  if (m) return m[1];
  return String(link.text || "").slice(0, 20);
}

/** 只读：导出单文件语义（__EXPORT_BOOT__ 下取内嵌 __EXPORT_LINKS__，与旧启动恢复一致）。 */
export function getExportLinks(): Array<{ name: string; displayName: string; links: LinkItem[] }> {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__EXPORT_BOOT__ !== true) return [];
    const v = w.__EXPORT_LINKS__ as unknown;
    if (!Array.isArray(v)) return [];
    return (v as Array<Record<string, unknown>>).map((it) => ({
      name: String(it.name || ""),
      displayName: String(it.displayName || it.name || ""),
      links: Array.isArray(it.links) ? (it.links as LinkItem[]) : [],
    }));
  } catch {
    return [];
  }
}

export interface LinksLoadResult {
  ok: boolean;
  links: LinkItem[];
  error?: string;
}

/* ═══════════ 链接帧桥（只消费 W3-02 已有协议：STAMP_SET / NAV_JUMP / ANNO_RECTS） ═══════════ */

/**
 * 给单个绑定在预览帧打戳（STAMP_SET；协议与 secure-srcdoc 冻结一致，不新增类型名）。
 * @param frame 预览 iframe（不可读其 document）
 * @param link 绑定（plid 优先，旧数据回退 id）
 * @returns 是否投递成功
 */
export function stampLinkInFrame(
  frame: HTMLIFrameElement | null,
  link: LinkItem | null | undefined,
): boolean {
  if (!frame || !link) return false;
  const plid = String(link.plid || link.id || "");
  const selector = String(link.selector || "");
  if (!plid || !selector) return false;
  return postToFrame(frame, buildStampMessage(plid, selector, String(link.page || "")));
}

/**
 * 批量打戳（STAMP_SET）。
 * @param frame 预览 iframe
 * @param links 绑定列表
 * @returns 成功投递条数
 */
export function stampLinksInFrame(frame: HTMLIFrameElement | null, links: LinkItem[]): number {
  if (!frame || !Array.isArray(links)) return 0;
  let n = 0;
  for (const link of links) {
    if (stampLinkInFrame(frame, link)) n += 1;
  }
  return n;
}

/**
 * 请求帧内元素矩形（ANNO_RECTS；PreviewFrame 追加的 rect 响应器回 ANNO_RECTS_RESULT）。
 * 标注定位与选中框跟随滚动/缩放共用本入口；未注入响应器时按 best-effort 无回包。
 * @param frame 预览 iframe
 * @param items 业务键 + 选择器
 * @returns 是否投递成功
 */
export function requestAnnoRectsInFrame(
  frame: HTMLIFrameElement | null,
  items: Array<{ id?: string; key?: string; selector?: string }>,
): boolean {
  if (!frame || !Array.isArray(items) || items.length === 0) return false;
  const list = items.map((it) => ({ key: String(it.key ?? it.id ?? ""), selector: String(it.selector ?? "") }));
  return postToFrame(frame, buildAnnoRectsMessage(list));
}

/**
 * 帧内页面跳转（NAV_JUMP；目标页为空表示回主页/顶部）。
 * @param frame 预览 iframe
 * @param page 目标页面 key/hash
 * @returns 是否投递成功
 */
export function jumpPreviewFrame(frame: HTMLIFrameElement | null, page: string): boolean {
  return postToFrame(frame, buildNavJumpMessage(String(page || "")));
}

/** 经 IPC 读取绑定（links.read，dir 为沙箱目录）。 */
export async function loadLinks(dir: string): Promise<LinksLoadResult> {
  if (!dir) return { ok: true, links: [] };
  const r = (await invokeProtoMethod("links", "read", dir)) as IpcOk & { data?: { links?: unknown } };
  if (!r || !r.ok) return { ok: false, links: [], error: r && r.error };
  const raw = r.data && Array.isArray((r.data as { links?: unknown }).links)
    ? ((r.data as { links: unknown[] }).links as LinkItem[])
    : [];
  return { ok: true, links: raw };
}

/** 经 IPC 写回绑定（links.write，导出态短路不写）。 */
export async function saveLinks(dir: string, links: LinkItem[]): Promise<IpcOk> {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__EXPORT_BOOT__ === true) return { ok: true };
  } catch {
    // 忽略。
  }
  if (!dir) return { ok: false, error: "missing-dir" };
  return invokeProtoMethod("links", "write", dir, { links });
}
