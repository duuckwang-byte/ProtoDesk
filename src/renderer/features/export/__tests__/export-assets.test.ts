/**
 * src/renderer/features/export/__tests__/export-assets.test.ts — W3-04 导出素材单测。
 *
 * 覆盖：
 * - md 图片路径收集：assets/ 相对路径，跳过 data:/http:/file:/锚点/绝对路径，去重；
 * - 替换：保留 alt/title 与 `{w=NN}` 后缀；
 * - 内联：`sandbox:list-assets({dir})` → `read-asset-base64({dir,relPath})` → dataUrl；
 * - 降级：列表失败 / 单张失败 / 无目录 / 无图片 → 返回原文，不抛错；
 * - 文档 PNG/PDF 入参：`{title,html,width,scale}`，无 `content`。
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DOC_EXPORT_SCALE,
  DOC_EXPORT_WIDTH,
  buildDocExportPayload,
  collectMarkdownImagePaths,
  inlineMarkdownImages,
  isInlineableAssetPath,
  normalizeAssetPath,
  replaceMarkdownImages,
  type ExportAssetIo,
} from "../export-assets"

type ListFn = (dir: string) => Promise<{ ok: boolean; items?: Array<{ name?: string; relPath?: string }> }>
type ReadFn = (dir: string, relPath: string) => Promise<{ ok: boolean; dataUrl?: string }>

function makeIo(list: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>): ExportAssetIo {
  return {
    listAssets: list as unknown as ListFn,
    readAssetBase64: read as unknown as ReadFn,
  }
}

function removeApi(): void {
  delete (window as unknown as { protoAPI?: unknown }).protoAPI
}

afterEach(() => {
  removeApi()
  vi.restoreAllMocks()
})

describe("collectMarkdownImagePaths", () => {
  it("只收 assets/ 相对图片，跳过远程/内联/锚点/绝对路径并去重", () => {
    const md = [
      "![a](assets/a.png)",
      "![b](./assets/b.jpg)",
      "![c](https://cdn.example.com/c.png)",
      "![d](data:image/png;base64,AAAA)",
      "![e](/assets/e.png)",
      "![f](#anchor)",
      "![g](file:///tmp/g.png)",
      "![h](assets/a.png)",
    ].join("\n")
    expect(collectMarkdownImagePaths(md)).toEqual(["assets/a.png", "./assets/b.jpg"])
  })

  it("isInlineableAssetPath / normalizeAssetPath 口径", () => {
    expect(isInlineableAssetPath("assets/a.png")).toBe(true)
    expect(isInlineableAssetPath("./assets/a.png")).toBe(true)
    expect(isInlineableAssetPath("images/a.png")).toBe(false)
    expect(isInlineableAssetPath("javascript:alert(1)")).toBe(false)
    expect(normalizeAssetPath(".\\assets\\a.png")).toBe("assets/a.png")
  })
})

describe("replaceMarkdownImages", () => {
  it("替换路径，保留 alt/title 与 {w=NN} 后缀", () => {
    const map = new Map([["assets/a.png", "data:image/png;base64,AAA"]])
    const out = replaceMarkdownImages('![shot](assets/a.png "标题"){w=200}', map)
    expect(out).toBe('![shot](data:image/png;base64,AAA "标题"){w=200}')
  })

  it("未命中路径保持原样", () => {
    const md = "![x](assets/x.png)"
    expect(replaceMarkdownImages(md, new Map())).toBe(md)
  })
})

describe("inlineMarkdownImages", () => {
  it("listAssets → readAssetBase64(relPath) → dataUrl 内联", async () => {
    const list = vi.fn(async () => ({
      ok: true,
      items: [
        { name: "a.png", relPath: "assets/a.png" },
        { name: "b.png", relPath: "assets/b.png" },
      ],
    }))
    const read = vi.fn(async (_dir: string, relPath: string) => ({
      ok: true,
      dataUrl: "data:image/png;base64," + relPath,
    }))
    const md = "![a](assets/a.png)\n![b](./assets/b.png)\n![c](assets/c.png)"
    const out = await inlineMarkdownImages(md, "C:/sandbox/p1", makeIo(list, read))

    expect(out).toContain("data:image/png;base64,assets/a.png")
    expect(out).toContain("data:image/png;base64,assets/b.png")
    // 列表里不存在的资产保持原路径。
    expect(out).toContain("![c](assets/c.png)")
    expect(list).toHaveBeenCalledWith("C:/sandbox/p1")
    expect(read).toHaveBeenCalledWith("C:/sandbox/p1", "assets/a.png")
    expect(read).toHaveBeenCalledWith("C:/sandbox/p1", "assets/b.png")
  })

  it("列表失败降级为原文，不抛错", async () => {
    const list = vi.fn(async () => ({ ok: false, items: [] }))
    const read = vi.fn()
    const md = "![a](assets/a.png)"
    await expect(inlineMarkdownImages(md, "C:/sandbox/p1", makeIo(list, read))).resolves.toBe(md)
    expect(read).not.toHaveBeenCalled()
  })

  it("单张读取失败/抛错只跳过该张", async () => {
    const list = vi.fn(async () => ({
      ok: true,
      items: [
        { relPath: "assets/ok.png" },
        { relPath: "assets/bad.png" },
      ],
    }))
    const read = vi.fn(async (_dir: string, relPath: string) => {
      if (relPath === "assets/bad.png") throw new Error("read-fail")
      return { ok: true, dataUrl: "data:image/png;base64,OK" }
    })
    const md = "![ok](assets/ok.png) ![bad](assets/bad.png)"
    const out = await inlineMarkdownImages(md, "C:/sandbox/p1", makeIo(list, read))
    expect(out).toContain("![ok](data:image/png;base64,OK)")
    expect(out).toContain("![bad](assets/bad.png)")
  })

  it("无目录 / 无图片时不调用 IO", async () => {
    const list = vi.fn()
    const read = vi.fn()
    const io = makeIo(list, read)
    await expect(inlineMarkdownImages("![a](assets/a.png)", "", io)).resolves.toBe("![a](assets/a.png)")
    await expect(inlineMarkdownImages("无图片", "C:/sandbox/p1", io)).resolves.toBe("无图片")
    expect(list).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it("默认 IO 走 sandbox:list-assets / sandbox:read-asset-base64 入参", async () => {
    const listAssets = vi.fn(async () => ({
      ok: true,
      items: [{ name: "a.png", relPath: "assets/a.png" }],
    }))
    const readAssetBase64 = vi.fn(async () => ({
      ok: true,
      dataUrl: "data:image/png;base64,GW",
    }))
    ;(window as unknown as { protoAPI?: unknown }).protoAPI = {
      sandbox: { listAssets, readAssetBase64 },
    }
    const out = await inlineMarkdownImages("![a](assets/a.png)", "C:/sandbox/p1")
    expect(out).toBe("![a](data:image/png;base64,GW)")
    expect(listAssets).toHaveBeenCalledWith({ dir: "C:/sandbox/p1" })
    expect(readAssetBase64).toHaveBeenCalledWith({ dir: "C:/sandbox/p1", relPath: "assets/a.png" })
  })
})

describe("buildDocExportPayload（文档 PNG/PDF）", () => {
  it("只含 title/html/width/scale，不再发 content", () => {
    const payload = buildDocExportPayload("功能说明", "<p>正文</p>")
    expect(payload).toEqual({
      title: "功能说明",
      html: "<p>正文</p>",
      width: DOC_EXPORT_WIDTH,
      scale: DOC_EXPORT_SCALE,
    })
    expect(Object.keys(payload as object).sort()).toEqual(["html", "scale", "title", "width"])
    expect(payload as unknown as Record<string, unknown>).not.toHaveProperty("content")
  })

  it("空 html / 空标题降级", () => {
    expect(buildDocExportPayload("t", "   ")).toBeNull()
    expect(buildDocExportPayload("", "<p>x</p>")?.title).toBe("文档")
  })
})
