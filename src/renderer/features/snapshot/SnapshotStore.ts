/**
 * features/snapshot/SnapshotStore.ts — 快照轻量状态/纯函数（Wave 2-L；W3-08 修 C4/C5）。
 *
 * 旧语义对齐（只读参考）：
 * - `snapshot:list` 主进程返回 `{ok, items:[{ts:'YYYYMMDD-HHmmss'}]}`
 *   （main/services/sandbox-storage-service.js:2328-2339）——**C4：读 items，条目用 ts**；
 * - `snapshot:restore` 入参是 `{dir, ts}`（同文件 2341-2362）——**C5：不是 {dir,id}**；
 * - 恢复为 destructive 操作，调用方必须先经 Confirm；失败文案原样透传。
 *
 * 通道只读消费：lib/ipc.ts invokeProtoMethod（snapshot.list / snapshot.restore），
 * 不新增 IPC、不改 main/preload。
 */

import { invokeProtoMethod } from "@/lib/ipc";
import type { IpcOk } from "@/types/ipc";

/** 主进程快照目录名格式（恢复参数 ts 的唯一合法形态）。 */
export const SNAPSHOT_TS_RE = /^\d{8}-\d{6}$/;

/**
 * 单条快照（归一化后形态）。
 * `ts` 是主进程唯一标识，也是 `snapshot:restore` 的入参；`id` 仅为兼容既有 UI 的别名。
 */
export interface SnapshotItem {
  /** 快照时间戳 `YYYYMMDD-HHmmss`（恢复参数）。 */
  ts: string;
  /** 兼容别名：恒等于 ts（旧面板按 id 渲染/做 key）。 */
  id: string;
  /** 展示名（无显式 name 时为格式化时间）。 */
  name: string;
  /** 规范化时间（可被 Date.parse 解析；由 ts 推导或主进程透传）。 */
  createdAt: string;
  label?: string;
}

/**
 * 解析主进程快照时间戳 `YYYYMMDD-HHmmss`。
 * @param ts 快照目录名
 * @returns Date；非法回 null
 */
export function parseSnapshotTs(ts: unknown): Date | null {
  const s = String(ts || "");
  if (!SNAPSHOT_TS_RE.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(9, 11));
  const mi = Number(s.slice(11, 13));
  const sec = Number(s.slice(13, 15));
  const date = new Date(y, mo, d, h, mi, sec);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * ts → 本地 ISO 形态（`2026-09-21T13:34:13`），供排序/展示复用。
 * @param ts 快照目录名
 * @returns 可解析时间串；非法回空串
 */
export function snapshotIsoFromTs(ts: unknown): string {
  const d = parseSnapshotTs(ts);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

/**
 * 快照展示名（`2026-09-21 13:34:13`）；非法 ts 原样返回。
 * @param ts 快照目录名
 * @returns 展示文案
 */
export function snapshotLabel(ts: unknown): string {
  const d = parseSnapshotTs(ts);
  if (!d) return String(ts || "");
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

/**
 * 归一化 snapshot:list 回包为快照数组（坏数据回空，不抛错）。
 *
 * 兼容输入：
 * - 主进程标准形态 `{ok, items:[{ts}]}`（C4 主路径）；
 * - 裸数组 / 旧 `{list}` / 旧 `{data}`；
 * - 条目为字符串 ts，或对象 `{ts}`（旧 `{id|name|createdAt}` 仅作最后兜底）。
 *
 * @param raw 回包或 items/list/data 载荷
 * @returns 归一化快照列表（未排序）
 */
export function normalizeSnapshots(raw: unknown): SnapshotItem[] {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const candidate = Array.isArray(raw)
    ? raw
    : rec && Array.isArray(rec.items)
      ? rec.items
      : rec && Array.isArray(rec.list)
        ? rec.list
        : rec && Array.isArray(rec.data)
          ? rec.data
          : null;
  if (!candidate) return [];

  const out: SnapshotItem[] = [];
  const seen = new Set<string>();
  for (const r of candidate) {
    let ts = "";
    let name = "";
    let createdAt = "";
    let label: string | undefined;
    if (typeof r === "string") {
      ts = r.trim();
    } else if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      ts = String(o.ts ?? o.id ?? o.name ?? "").trim();
      name = String(o.name ?? "").trim();
      createdAt = String(o.createdAt ?? o.time ?? o.mtime ?? "").trim();
      if (typeof o.label === "string" && o.label.trim()) label = o.label.trim();
    }
    if (!ts || seen.has(ts)) continue; // 主进程目录名唯一；空/重复条目直接丢弃
    seen.add(ts);
    const iso = snapshotIsoFromTs(ts);
    out.push({
      ts,
      id: ts,
      name: name || snapshotLabel(ts) || ts,
      createdAt: createdAt || iso,
      label,
    });
  }
  return out;
}

/** 按快照时间倒序（新→旧；无法解析的按字符串倒序稳定排在后面）。 */
export function sortSnapshots(list: SnapshotItem[]): SnapshotItem[] {
  return list.slice().sort((a, b) => {
    const ta = parseSnapshotTs(a.ts);
    const tb = parseSnapshotTs(b.ts);
    const na = ta ? ta.getTime() : -1;
    const nb = tb ? tb.getTime() : -1;
    if (nb !== na) return nb - na;
    return String(b.ts).localeCompare(String(a.ts));
  });
}

/** 展示用时间文案（优先 createdAt；解析失败回格式化 ts；空回“—”）。 */
export function snapshotTimeText(s: Pick<SnapshotItem, "createdAt" | "ts">): string {
  const t = String(s.createdAt || "");
  if (t) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes())
      );
    }
    return t;
  }
  const label = snapshotLabel(s.ts);
  return label || "—";
}

export interface SnapshotListResult {
  ok: boolean;
  list: SnapshotItem[];
  error?: string;
}

/**
 * 经 IPC 列出快照（snapshot:list）。
 * C4：主进程回 `items:[{ts}]`，这里优先读 items；旧 list/data 仅兼容兜底。
 * @param dir 当前原型沙箱目录（空串短路，不发 IPC）
 */
export async function listSnapshots(dir: string): Promise<SnapshotListResult> {
  if (!dir) return { ok: true, list: [] };
  const r = (await invokeProtoMethod("snapshot", "list", dir)) as IpcOk & {
    items?: unknown;
    list?: unknown;
    data?: unknown;
  };
  if (!r || !r.ok) return { ok: false, list: [], error: r && r.error };
  const raw = r.items ?? r.list ?? r.data;
  return { ok: true, list: sortSnapshots(normalizeSnapshots(raw)) };
}

/**
 * 经 IPC 恢复快照（snapshot:restore，destructive：调用方必须先经 Confirm 确认）。
 * C5：入参固定 `{dir, ts}`（不是 `{dir, id}`）；本地先校验 ts 形态，避免无意义 IPC。
 * @param dir 当前原型沙箱目录
 * @param ts 快照目录名 `YYYYMMDD-HHmmss`
 */
export async function restoreSnapshot(dir: string, ts: string): Promise<IpcOk> {
  if (!dir || !ts) return { ok: false, error: "missing-args" };
  if (!SNAPSHOT_TS_RE.test(String(ts))) return { ok: false, error: "非法快照标识" };
  return invokeProtoMethod("snapshot", "restore", { dir, ts: String(ts) });
}
