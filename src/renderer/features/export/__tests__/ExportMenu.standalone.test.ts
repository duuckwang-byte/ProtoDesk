/**
 * src/renderer/features/export/__tests__/ExportMenu.standalone.test.ts — W4-P2 独立 HTML 文档区回归。
 *
 * 缺陷：独立 HTML 右侧文档区空白——md 被写进 `display:none` 的 #docContent，
 * 而可见的 #exportLiteDoc 为空（docs/wave4/reports/export.md §5 export-OBS-1）。
 *
 * 覆盖：
 * - buildStandaloneHtml 输出只有一份“可见”文档容器（#docContent），不再输出隐藏副本；
 * - md 确实内联进 __EXPORT_SOURCES__，契约 __EXPORT_BOOT__ / __EXPORT_SOURCES__ 不变；
 * - 模板（js/export-template.js）把 md 渲染进可见节点：标题 / 表格 / 正文非空；
 * - 兼容旧导出结构（隐藏 #docContent + 可见 #exportLiteDoc）时不写隐藏节点。
 */

import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildStandaloneHtml } from "../ExportMenu"

/** 与构建实际产物同源（scripts/copy-export-assets.mjs 复制本文件到 export-assets/）。 */
const TEMPLATE_JS = fs.readFileSync(path.resolve(process.cwd(), "js", "export-template.js"), "utf8")

const DOC_MD = [
  "# 商城首页 — 产品需求文档 (PRD)",
  "",
  "## 3. 功能清单",
  "",
  "| 模块 | 说明 |",
  "| --- | --- |",
  "| 首页 | 商品推荐 |",
  "",
  "这是正文段落，用于验证右侧文档区非空白。",
].join("\n")

const SOURCES = [
  {
    name: "首页.html",
    displayName: "首页",
    kind: "pc",
    content: "<html><body>proto</body></html>",
    md: DOC_MD,
  },
]

function w(): Record<string, any> {
  return window as unknown as Record<string, any>
}

function standaloneHtml(): string {
  return buildStandaloneHtml({
    title: "首页",
    embeds: SOURCES,
    reqMap: {},
    linksData: [],
    annoMap: {},
    cssText: "",
    templateJs: TEMPLATE_JS,
    iconsJs: "",
  })
}

/** 把导出 HTML 的 body 结构挂到当前 document（script 不执行），再由用例显式跑模板。 */
function mountExportBody(html = standaloneHtml()): void {
  const parsed = new DOMParser().parseFromString(html, "text/html")
  document.body.innerHTML = parsed.body.innerHTML
}

function bootTemplate(sources: unknown[] = SOURCES): void {
  w().__EXPORT_BOOT__ = true
  w().__EXPORT_SOURCES__ = sources
  w().__REQ_MAP__ = {}
  // 模板是经典脚本 IIFE；这里按导出 HTML 的加载方式直接执行。
  new Function(TEMPLATE_JS)()
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ""
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ""
  for (const key of [
    "__EXPORT_BOOT__",
    "__EXPORT_SOURCES__",
    "__REQ_MAP__",
    "__EXPORT_RENDER__",
    "__exportRenderMdLite",
    "__EXPORT_RENDER_BOOT__",
  ]) {
    delete w()[key]
  }
})

describe("buildStandaloneHtml 文档区结构", () => {
  it("只有一份可见文档容器，md 已内联，无隐藏副本", () => {
    const html = standaloneHtml()
    const doc = new DOMParser().parseFromString(html, "text/html")
    const docEl = doc.getElementById("docContent")

    expect(docEl, "导出 HTML 必须包含文档容器 #docContent").toBeTruthy()
    expect(docEl!.getAttribute("style") || "", "#docContent 不得内联 display:none").not.toMatch(
      /display\s*:\s*none/i,
    )
    expect(docEl!.closest(".export-lite-doc"), "#docContent 应位于右侧文档面板内").toBeTruthy()
    expect(doc.getElementById("exportLiteDoc"), "不应再输出空的隐藏文档副本").toBeNull()
    expect(doc.getElementById("docTitle"), "不应再输出隐藏标题副本").toBeNull()

    const titleEl = doc.getElementById("exportLiteTitle")
    expect(titleEl, "右侧文档面板应有可见标题节点").toBeTruthy()
    expect(titleEl!.closest(".export-lite-doc")).toBeTruthy()

    expect(html, "内联数据应含文档 md 标题").toContain("商城首页")
    expect(html, "内联数据应含文档 md 表格内容").toContain("商品推荐")
  })

  it("保持 __EXPORT_BOOT__ / __EXPORT_SOURCES__ 契约且不加载 React", () => {
    const html = standaloneHtml()
    expect(html).toContain("__EXPORT_BOOT__=true")
    expect(html).toContain("__EXPORT_SOURCES__=")
    expect(html).toContain("__REQ_MAP__=")
    expect(html).toContain("no react runtime")
    expect(html).not.toMatch(/react-dom|createRoot|__REACT_DEVTOOLS/i)
  })
})

describe("export-template 文档渲染目标", () => {
  it("新版结构：md 渲染进可见 #docContent（标题 / 表格 / 正文）", () => {
    mountExportBody()
    bootTemplate()

    const docEl = document.getElementById("docContent")
    expect(docEl, "导出 HTML 必须有 #docContent").toBeTruthy()
    expect(window.getComputedStyle(docEl!).display).not.toBe("none")
    expect(docEl!.style.display).not.toBe("none")

    expect(docEl!.textContent).toContain("商城首页")
    expect(docEl!.querySelector("h1.md-h")?.textContent).toContain("产品需求文档")
    expect(docEl!.querySelector("table.md-table")).toBeTruthy()
    expect(docEl!.querySelector("table.md-table th")?.textContent).toBe("模块")
    expect(docEl!.querySelectorAll("table.md-table tbody tr").length).toBe(1)
    expect(docEl!.querySelector(".md-table td")?.textContent).toBe("首页")
    expect(docEl!.textContent).toContain("这是正文段落")

    expect(document.getElementById("exportLiteTitle")?.textContent).toBe("首页")
    expect(w().__EXPORT_RENDER__?.count).toBe(1)
  })

  it("旧版结构：隐藏 #docContent 时渲染进可见 #exportLiteDoc，不依赖隐藏节点", () => {
    document.body.innerHTML = [
      '<div class="export-lite"><div class="export-lite-bar" id="exportLiteList"></div>',
      '<div class="export-lite-stage"><iframe id="frame"></iframe><div class="export-lite-doc">',
      '<h3 id="exportLiteTitle"></h3><div id="exportLiteDoc"></div>',
      '<div id="docContent" style="display:none"></div>',
      '<div id="docTitle" style="display:none"></div>',
      '<div id="sbList" style="display:none"></div></div></div></div>',
    ].join("")
    bootTemplate()

    const lite = document.getElementById("exportLiteDoc")
    expect(lite, "旧版结构应保留 #exportLiteDoc").toBeTruthy()
    expect(lite!.textContent).toContain("商城首页")
    expect(lite!.querySelector("table.md-table")).toBeTruthy()
    expect(document.getElementById("docContent")!.textContent).toBe("")
    expect(document.getElementById("exportLiteTitle")!.textContent).toBe("首页")
    expect(document.getElementById("docTitle")!.textContent).toBe("")
  })
})

describe("export-template Markdown <br> 换行", () => {
  /** PRD 表格单元格/正文常用字面 <br> 表示换行（seed 首页.md 共 50 处）。 */
  const BR_MD = [
    "# 换行验证",
    "",
    "| 模块 | 说明 |",
    "| --- | --- |",
    "| 首页 | 1. 第一行<br>2. 第二行<br/>3. 第三行 |",
    "",
    "正文第一行<br>正文第二行",
    "",
    "行内代码 `<br>` 应保持字面，不变成换行标签。",
  ].join("\n")

  function htmlWith(md: string): string {
    return buildStandaloneHtml({
      title: "换行",
      embeds: [{ name: "首页.html", displayName: "首页", kind: "pc", content: "<html></html>", md }],
      reqMap: {},
      linksData: [],
      annoMap: {},
      cssText: "",
      templateJs: TEMPLATE_JS,
      iconsJs: "",
    })
  }

  it("表格单元格与正文的字面 <br> 渲染为真实换行标签", () => {
    mountExportBody(htmlWith(BR_MD))
    bootTemplate([{ ...SOURCES[0], md: BR_MD }])

    const docEl = document.getElementById("docContent") as HTMLElement
    expect(docEl).toBeTruthy()
    // 表格/正文的 <br> 不再以字面文本出现（行内代码里的 <br> 属于代码内容，单独断言）。
    const prose = docEl.cloneNode(true) as HTMLElement
    prose.querySelectorAll("code").forEach((el) => el.remove())
    expect(prose.textContent || "").not.toMatch(/<br\s*\/?>/i)

    const cell = Array.from(docEl.querySelectorAll("table.md-table td")).find((td) =>
      (td.textContent || "").includes("第一行"),
    )
    expect(cell, "表格应正常渲染").toBeTruthy()
    expect(cell!.querySelectorAll("br").length, "单元格内 2 个 <br> 应转成换行标签").toBe(2)
    expect(cell!.textContent).toContain("第一行")
    expect(cell!.textContent).toContain("第二行")
    expect(cell!.textContent).toContain("第三行")

    const para = Array.from(docEl.querySelectorAll("p")).find((p) =>
      (p.textContent || "").includes("正文第一行"),
    )
    expect(para, "正文段落应保留").toBeTruthy()
    expect(para!.querySelectorAll("br").length).toBe(1)
    expect(para!.textContent).toBe("正文第一行正文第二行")

    // 行内代码中的 <br> 保持字面文本，避免被误当标签。
    const code = Array.from(docEl.querySelectorAll("code")).find(
      (el) => (el.textContent || "") === "<br>",
    )
    expect(code, "行内代码 `<br>` 应保持字面").toBeTruthy()
    expect(code!.querySelector("br")).toBeNull()

    // 其余 HTML 仍按文本转义（不放开任意标签）。
    expect(docEl.querySelectorAll("br").length, "共 3 个换行标签（表格 2 + 正文 1）").toBe(3)
  })

  it("其他 HTML 仍转义，文档契约不变", () => {
    const md = ["# 安全", "", "<script>alert(1)</script>", "", "行内 <img src=x onerror=alert(1)> 文本"].join(
      "\n",
    )
    const html = htmlWith(md)
    expect(html).toContain("__EXPORT_BOOT__=true")
    expect(html).toContain("__EXPORT_SOURCES__=")

    mountExportBody(html)
    bootTemplate([{ ...SOURCES[0], md }])
    const docEl = document.getElementById("docContent") as HTMLElement
    expect(docEl.querySelector("script")).toBeNull()
    expect(docEl.querySelector("img")).toBeNull()
    expect(docEl.textContent).toContain("<script>alert(1)</script>")
    expect(docEl.textContent).toContain("<img src=x onerror=alert(1)>")
  })
})
