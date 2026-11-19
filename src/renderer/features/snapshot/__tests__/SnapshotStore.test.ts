/**
 * src/renderer/features/snapshot/__tests__/SnapshotStore.test.ts — W3-08 快照 C4/C5 回归。
 *
 * 覆盖：
 * - C4：snapshot.list 回包读 `items:[{ts}]`（不再读 list/data、条目不再取 id/name）；
 * - C5：snapshot.restore 入参必须是 `{dir, ts}`（不是 `{dir,id}`）；
 * - ts 解析/排序/展示；
 * - 列表失败透传、空目录短路、非法 ts 本地拒绝。
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  SNAPSHOT_TS_RE,
  listSnapshots,
  normalizeSnapshots,
  parseSnapshotTs,
  restoreSnapshot,
  snapshotLabel,
  snapshotTimeText,
  sortSnapshots,
  type SnapshotItem,
} from "../SnapshotStore"

type AnyFn = (...args: unknown[]) => unknown

function reset(): void {
  localStorage.clear()
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
}

function installSnapshot(handlers: { list?: AnyFn; restore?: AnyFn }): void {
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
    snapshot: {
      list: handlers.list ?? (async () => ({ ok: true, items: [] })),
      restore: handlers.restore ?? (async () => ({ ok: true })),
    },
  }
}

beforeEach(reset)

describe("C4：列表读 items + 条目用 ts", () => {
  it("normalizeSnapshots 读取 {items:[{ts}]}", () => {
    const list = normalizeSnapshots({ ok: true, items: [{ ts: "20260921-133413" }, { ts: "20260922-080102" }] })
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      ts: "20260921-133413",
      id: "20260921-133413",
      name: "2026-09-21 13:34:13",
    })
    expect(list[0].createdAt).toBe("2026-09-21T13:34:13")
  })

  it("items 优先于旧 list/data（C4 不回退到旧字段）", () => {
    const list = normalizeSnapshots({
      items: [{ ts: "20260101-000000" }],
      list: [{ id: "legacy-list" }],
      data: [{ id: "legacy-data" }],
    })
    expect(list.map((s) => s.ts)).toEqual(["20260101-000000"])
  })

  it("兼容裸数组 / 字符串 ts / 旧 id（仅兜底）", () => {
    expect(normalizeSnapshots(["20260101-000000", { id: "20260202-010101", name: "旧名称" }])).toEqual([
      expect.objectContaining({ ts: "20260101-000000", id: "20260101-000000" }),
      expect.objectContaining({ ts: "20260202-010101", id: "20260202-010101", name: "旧名称" }),
    ])
  })

  it("丢弃空 ts 与重复 ts", () => {
    expect(normalizeSnapshots([{ ts: "" }, { ts: "20260101-000000" }, { ts: "20260101-000000" }, null])).toHaveLength(1)
  })

  it("listSnapshots 发 snapshot.list(dir)，只从 items 取值并倒序", async () => {
    const args: unknown[] = []
    installSnapshot({
      list: async (...a) => {
        args.push(...a)
        return { ok: true, items: [{ ts: "20260101-000000" }, { ts: "20260303-030303" }, { ts: "20260202-020202" }] }
      },
    })
    const r = await listSnapshots("/sandbox/A/登录页")
    expect(args).toEqual(["/sandbox/A/登录页"])
    expect(r.ok).toBe(true)
    expect(r.list.map((s) => s.ts)).toEqual(["20260303-030303", "20260202-020202", "20260101-000000"])
  })

  it("listSnapshots 空目录短路；失败透传 error", async () => {
    let called = 0
    installSnapshot({
      list: async () => {
        called += 1
        return { ok: false, error: "EACCES" }
      },
    })
    expect(await listSnapshots("")).toEqual({ ok: true, list: [] })
    expect(called).toBe(0)
    expect(await listSnapshots("/sandbox/A/登录页")).toEqual({ ok: false, list: [], error: "EACCES" })
  })
})

describe("C5：恢复发 {dir, ts}", () => {
  it("restoreSnapshot 只发 {dir, ts}（无 id 字段）", async () => {
    let args: unknown[] = []
    installSnapshot({
      restore: async (...a) => {
        args = a
        return { ok: true }
      },
    })
    const r = await restoreSnapshot("/sandbox/A/登录页", "20260921-133413")
    expect(r.ok).toBe(true)
    expect(args).toEqual([{ dir: "/sandbox/A/登录页", ts: "20260921-133413" }])
    expect((args[0] as Record<string, unknown>).id).toBeUndefined()
  })

  it("非法 ts 本地拒绝，不发 IPC", async () => {
    let called = 0
    installSnapshot({
      restore: async () => {
        called += 1
        return { ok: true }
      },
    })
    for (const bad of ["", "abc", "2026-09-21", "20260921-1334", "20260921-133413-1"]) {
      const r = await restoreSnapshot("/sandbox/A/登录页", bad)
      expect(r.ok).toBe(false)
    }
    expect(called).toBe(0)
  })

  it("dir 缺失拒绝", async () => {
    const r = await restoreSnapshot("", "20260921-133413")
    expect(r).toEqual({ ok: false, error: "missing-args" })
  })
})

describe("ts 解析 / 排序 / 展示", () => {
  it("SNAPSHOT_TS_RE 与主进程一致", () => {
    expect(SNAPSHOT_TS_RE.test("20260921-133413")).toBe(true)
    expect(SNAPSHOT_TS_RE.test("20260921-13341")).toBe(false)
  })

  it("parseSnapshotTs 解析为本地 Date；非法回 null", () => {
    const d = parseSnapshotTs("20260921-133413")
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(8)
    expect(d?.getDate()).toBe(21)
    expect(d?.getHours()).toBe(13)
    expect(parseSnapshotTs("bad")).toBeNull()
  })

  it("snapshotLabel 输出到秒；非法原样返回", () => {
    expect(snapshotLabel("20260921-133413")).toBe("2026-09-21 13:34:13")
    expect(snapshotLabel("bad")).toBe("bad")
  })

  it("sortSnapshots 按 ts 倒序，无法解析的沉底", () => {
    const list: SnapshotItem[] = [
      { ts: "bad", id: "bad", name: "bad", createdAt: "" },
      { ts: "20260101-000000", id: "a", name: "a", createdAt: "" },
      { ts: "20260303-030303", id: "b", name: "b", createdAt: "" },
    ]
    expect(sortSnapshots(list).map((s) => s.ts)).toEqual(["20260303-030303", "20260101-000000", "bad"])
  })

  it("snapshotTimeText 优先 createdAt，非法回退 ts 格式化", () => {
    expect(snapshotTimeText({ createdAt: "2026-09-21T13:34:13", ts: "20260921-133413" })).toBe("2026-09-21 13:34")
    expect(snapshotTimeText({ createdAt: "", ts: "20260921-133413" })).toBe("2026-09-21 13:34:13")
    expect(snapshotTimeText({ createdAt: "", ts: "" })).toBe("—")
  })
})
