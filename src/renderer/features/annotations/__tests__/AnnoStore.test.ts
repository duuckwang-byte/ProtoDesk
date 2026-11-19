/**
 * src/renderer/features/annotations/__tests__/AnnoStore.test.ts — W3-08 标注数据层。
 *
 * 覆盖：
 * - 三键（selector + page + htmlFile）匹配 / 旧无 htmlFile 通配；
 * - makeAnnoItem / upsertAnno / removeAnnoById / 编号 / 分页；
 * - annotations.read / annotations.save 入参（dir 来自 currentSource.sandboxDir）；
 * - 导出态短路；
 * - 标注显隐键 proto_anno_visible（storage-keys 常量只读消费）。
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  annoMatchKey,
  annoNumberOf,
  annoTimestamp,
  findAnno,
  groupAnnosByPage,
  loadAnnos,
  makeAnnoItem,
  normalizeAnnoList,
  readAnnoVisible,
  removeAnnoById,
  saveAnnos,
  upsertAnno,
  writeAnnoVisible,
  type AnnoItem,
} from "../AnnoStore"
import { PROTO_ANNO_VISIBLE } from "@/lib/storage-keys"

type AnyFn = (...args: unknown[]) => unknown

function reset(): void {
  localStorage.clear()
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
  delete (window as unknown as { __EXPORT_BOOT__?: unknown }).__EXPORT_BOOT__
}

function installAnnotations(handlers: { read?: AnyFn; save?: AnyFn }): void {
  ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
    annotations: {
      read: handlers.read ?? (async () => ({ ok: true, data: [] })),
      save: handlers.save ?? (async () => ({ ok: true })),
    },
  }
}

function anno(overrides: Partial<AnnoItem> = {}): AnnoItem {
  return {
    id: "anno_1",
    htmlFile: "登录页.html",
    selector: ".btn-ok",
    textSnippet: "确定",
    tagName: "BUTTON",
    elementName: "确定",
    page: "page-login",
    title: "",
    content: "按钮文案改短",
    author: "PM",
    createdAt: "2026-11-12 10:00",
    updatedAt: "2026-11-12 10:00",
    ...overrides,
  }
}

beforeEach(reset)

describe("三键匹配（selector + page + htmlFile）", () => {
  it("annoMatchKey 逐字拼接三键", () => {
    expect(annoMatchKey({ selector: ".a", page: "page-1", htmlFile: "a.html" })).toBe(".a￨page-1￨a.html")
  })

  it("findAnno 命中三键；htmlFile 不同则不命中", () => {
    const list = [anno()]
    expect(findAnno(list, { selector: ".btn-ok", page: "page-login", htmlFile: "登录页.html" })?.id).toBe("anno_1")
    expect(findAnno(list, { selector: ".btn-ok", page: "page-login", htmlFile: "详情.html" })).toBeNull()
    expect(findAnno(list, { selector: ".btn-ok", page: "page-other", htmlFile: "登录页.html" })).toBeNull()
  })

  it("旧数据无 htmlFile 按通配兼容", () => {
    const legacy = anno({ id: "legacy", htmlFile: "" })
    expect(findAnno([legacy], { selector: ".btn-ok", page: "page-login", htmlFile: "登录页.html" })?.id).toBe("legacy")
  })

  it("按 id 优先命中（即使三键不同）", () => {
    const list = [anno()]
    expect(findAnno(list, { id: "anno_1", selector: ".other", page: "x", htmlFile: "y.html" })?.id).toBe("anno_1")
  })
})

describe("upsert / remove / 编号 / 分组", () => {
  it("upsertAnno 按三键更新并保留 id/createdAt", () => {
    const first = anno()
    const next = upsertAnno([first], {
      ...first,
      id: "anno_new",
      content: "新内容",
      updatedAt: "2026-11-12 11:00",
    })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe("anno_1")
    expect(next[0].content).toBe("新内容")
    expect(next[0].createdAt).toBe("2026-11-12 10:00")
  })

  it("upsertAnno 按 id 更新而不是新增", () => {
    const next = upsertAnno([anno()], anno({ id: "anno_1", selector: ".changed", content: "改" }))
    expect(next).toHaveLength(1)
    expect(next[0].selector).toBe(".changed")
  })

  it("removeAnnoById 只删命中 id", () => {
    const list = [anno(), anno({ id: "anno_2", selector: ".other" })]
    expect(removeAnnoById(list, "anno_1").map((a) => a.id)).toEqual(["anno_2"])
  })

  it("编号为全量创建序；按页分组稳定", () => {
    const list = [
      anno(),
      anno({ id: "anno_2", selector: ".b", page: "page-home" }),
      anno({ id: "anno_3", selector: ".c", page: "page-login" }),
    ]
    expect(annoNumberOf(list, "anno_2")).toBe(2)
    const groups = groupAnnosByPage(list)
    const login = groups.find((g) => g.page === "page-login")
    expect(login?.items.map((a) => a.id)).toEqual(["anno_1", "anno_3"])
  })
})

describe("工厂 / 归一化", () => {
  it("makeAnnoItem 写三键与文本快照", () => {
    const item = makeAnnoItem({
      htmlFile: "登录页.html",
      selector: ".btn-ok",
      page: "page-login",
      content: "改文案",
      textSnippet: "确定",
      tagName: "button",
    })
    expect(item).toMatchObject({
      htmlFile: "登录页.html",
      selector: ".btn-ok",
      page: "page-login",
      content: "改文案",
      tagName: "BUTTON",
      textSnippet: "确定",
    })
    expect(item.id).toMatch(/^anno_/)
    expect(item.createdAt).toBe(item.updatedAt)
  })

  it("annoTimestamp 为本地 YYYY-MM-DD HH:mm", () => {
    expect(annoTimestamp(new Date(2026, 10, 12, 9, 8, 7))).toBe("2026-11-12 09:08")
  })

  it("normalizeAnnoList 丢弃无 id/selector 的坏数据", () => {
    const list = normalizeAnnoList([
      { id: "a", selector: ".x" },
      { id: "", selector: ".y" },
      { id: "b", selector: "" },
      null,
      "bad",
    ])
    expect(list.map((a) => a.id)).toEqual(["a"])
    expect(list[0].author).toBe("PM")
  })
})

describe("annotations.read / save（dir = sandboxDir）", () => {
  it("loadAnnos 发 read(dir) 并归一化 data", async () => {
    let args: unknown[] = []
    installAnnotations({
      read: async (...a) => {
        args = a
        return { ok: true, data: [{ id: "anno_1", selector: ".btn-ok", page: "page-login", htmlFile: "登录页.html" }] }
      },
    })
    const r = await loadAnnos("/sandbox/A/登录页")
    expect(args).toEqual(["/sandbox/A/登录页"])
    expect(r.ok).toBe(true)
    expect(r.list).toHaveLength(1)
  })

  it("loadAnnos 空目录短路，不发 IPC", async () => {
    let called = 0
    installAnnotations({
      read: async () => {
        called += 1
        return { ok: true, data: [] }
      },
    })
    const r = await loadAnnos("")
    expect(r).toEqual({ ok: true, list: [] })
    expect(called).toBe(0)
  })

  it("loadAnnos 失败透传 error 且回空列表", async () => {
    installAnnotations({ read: async () => ({ ok: false, error: "EACCES" }) })
    const r = await loadAnnos("/sandbox/A/登录页")
    expect(r).toEqual({ ok: false, list: [], error: "EACCES" })
  })

  it("saveAnnos 发 save(dir, list)", async () => {
    let args: unknown[] = []
    installAnnotations({
      save: async (...a) => {
        args = a
        return { ok: true }
      },
    })
    const list = [anno()]
    const r = await saveAnnos("/sandbox/A/登录页", list)
    expect(r.ok).toBe(true)
    expect(args[0]).toBe("/sandbox/A/登录页")
    expect(args[1]).toEqual(list)
  })

  it("__EXPORT_BOOT__ 下 saveAnnos 短路不写", async () => {
    let called = 0
    installAnnotations({
      save: async () => {
        called += 1
        return { ok: true }
      },
    })
    ;(window as unknown as { __EXPORT_BOOT__?: unknown }).__EXPORT_BOOT__ = true
    const r = await saveAnnos("/sandbox/A/登录页", [anno()])
    expect(r.ok).toBe(true)
    expect(called).toBe(0)
  })

  it("dir 缺失时 saveAnnos 拒绝", async () => {
    const r = await saveAnnos("", [anno()])
    expect(r.ok).toBe(false)
    expect(r.error).toBe("missing-dir")
  })
})

describe("标注显隐键（proto_anno_visible）", () => {
  it("缺省显示；false/0/off 视为隐藏", () => {
    expect(readAnnoVisible()).toBe(true)
    localStorage.setItem(PROTO_ANNO_VISIBLE, "0")
    expect(readAnnoVisible()).toBe(false)
    localStorage.setItem(PROTO_ANNO_VISIBLE, "false")
    expect(readAnnoVisible()).toBe(false)
    localStorage.setItem(PROTO_ANNO_VISIBLE, "off")
    expect(readAnnoVisible()).toBe(false)
    localStorage.setItem(PROTO_ANNO_VISIBLE, "1")
    expect(readAnnoVisible()).toBe(true)
  })

  it("writeAnnoVisible 写 1/0（旧键值口径）", () => {
    writeAnnoVisible(false)
    expect(localStorage.getItem(PROTO_ANNO_VISIBLE)).toBe("0")
    writeAnnoVisible(true)
    expect(localStorage.getItem(PROTO_ANNO_VISIBLE)).toBe("1")
  })
})
