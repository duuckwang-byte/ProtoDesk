/**
 * e2e/export.spec.ts — W3-04 导出闭环回归（静态契约 + 可选真机）。
 *
 * 静态契约（无浏览器可跑，读 src 源文件）：
 * - Topbar 传真实 sources（sources-store）/ currentName（当前源 name）/
 *   docText + docTitle（docs-store）；
 * - 文档按钮接 useDocWindow（open/close/toggle 按 mode 调），不再只开面板；
 * - 文档 PNG/PDF 经 renderDocPreview 生成 html，payload 为 {title,html,width,scale}，不发 content；
 * - 独立 HTML 用真实源内容（内存 content → sandbox:read-file），md 图片经
 *   sandbox:list-assets → sandbox:read-asset-base64(relPath) 内联，失败降级；
 * - __EXPORT_BOOT__/__REQ_MAP__/__EXPORT_SOURCES__/__EXPORT_LINKS__/__ANNO_MAP__
 *   契约与 export-assets/ 读取保持不变；导出 HTML 不加载 React。
 *
 * 真机行为仅在设置 PLAND_E2E_APP_URL 时执行（需要可加载的 React 渲染器 URL）。
 */
import { test, expect } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(__dirname, "..")
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8")

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip

test.describe("export 静态契约（W3-04 导出闭环）", () => {
  test("Topbar 传真实 sources / currentName / 文档 store 数据", () => {
    const src = read("src/renderer/components/shell/Topbar.tsx")
    expect(src).toContain("useSourcesStore")
    expect(src).toContain("sources={sources}")
    expect(src).toContain("currentName={currentSource?.name")
    expect(src).toContain("docText={docContent}")
    expect(src).toContain("docTitle={docTitle")
    expect(src).toContain("useDocsStore")
    expect(src).not.toContain("sources={[]}")
  })

  test("文档入口收敛：顶栏单按钮开面板，独立文档窗由面板发起", () => {
    const topbar = read("src/renderer/components/shell/Topbar.tsx")
    expect(topbar).toContain('data-testid="topbar-docs"')
    expect(topbar).toContain("docsOpen")
    expect(topbar).toContain("toggleDocs")
    expect(topbar).not.toContain("useDocWindow")
    expect(topbar).not.toContain("openDocWindow")

    const panel = read("src/renderer/features/docs/DocsPanel.tsx")
    expect(panel).toContain("useDocWindow")
    expect(panel).toContain("openDocWindow")
    expect(panel).toContain("在独立窗口打开文档")
  })

  test("文档 PNG/PDF 发 html（renderDocPreview），payload 为 title/html/width/scale", () => {
    const menu = read("src/renderer/features/export/ExportMenu.tsx")
    const assets = read("src/renderer/features/export/export-assets.ts")
    expect(menu).toContain("renderDocPreview")
    expect(menu).toContain("buildDocExportPayload")
    expect(menu).toContain("当前文档为空")
    expect(menu).not.toContain("content: docText")
    expect(menu).not.toMatch(/content:\s*String\(docText/)
    expect(menu).toContain('invokeProtoMethod("doc", channel, payload)')
    for (const key of ["title", "html", "width", "scale"]) expect(assets).toContain(key)
    expect(assets).toContain("DocExportPayload")
  })

  test("主进程文档导出只认 html（旧 content 参数会报缺少导出内容）", () => {
    const main = read("main/services/doc-export-service.js")
    expect(main).toContain("o2.html")
    expect(main).toContain("缺少导出内容")
  })

  test("独立 HTML 使用真实源内容 + md 图片内联", () => {
    const menu = read("src/renderer/features/export/ExportMenu.tsx")
    expect(menu).toContain('invokeProtoMethod("sandbox", "readFile"')
    expect(menu).toContain("readSourceContent")
    expect(menu).toContain("readSourceMd")
    expect(menu).toContain("inlineMarkdownImages")
    expect(menu).toContain("mdFile")
  })

  test("export-assets：listAssets → readAssetBase64(relPath) → dataUrl，失败降级不阻断", () => {
    const src = read("src/renderer/features/export/export-assets.ts")
    expect(src).toContain('"listAssets"')
    expect(src).toContain('"readAssetBase64"')
    expect(src).toContain("{ dir, relPath }")
    expect(src).toContain("dataUrl")
    expect(src).toContain("assets/")
    expect(src).toContain("return src")
    expect(src).toContain("catch")
    expect(src).not.toContain("ipcRenderer")
    expect(src).not.toMatch(/invoke\(\s*['"]sandbox:/)
  })

  test("__EXPORT_BOOT__ / __REQ_MAP__ / __EXPORT_SOURCES__ / __EXPORT_LINKS__ / __ANNO_MAP__ 契约保留", () => {
    const legacy = read("js/project-ai-export.js")
    expect(legacy).toContain("window.__EXPORT_BOOT__=true")
    expect(legacy).toContain("window.__EXPORT_SOURCES__")
    const menu = read("src/renderer/features/export/ExportMenu.tsx")
    for (const key of [
      "__EXPORT_BOOT__",
      "__REQ_MAP__",
      "__EXPORT_SOURCES__",
      "__EXPORT_LINKS__",
      "__ANNO_MAP__",
    ]) {
      expect(menu).toContain(key)
    }
    expect(menu).toContain("export-assets/")
  })

  test("导出 HTML 不加载 React（仅 vanilla 模板 + 冻结数据脚本）", () => {
    const src = read("src/renderer/features/export/ExportMenu.tsx")
    expect(src).toContain("no react runtime")
    expect(src).not.toContain("createRoot")
    expect(src).not.toContain("react-dom/client")
    const template = read("js/export-template.js")
    expect(template).toContain("__EXPORT_SOURCES__")
  })
})

gui("export 真机行为（需 PLAND_E2E_APP_URL）", () => {
  test("导出菜单可打开，源码 / 独立 HTML / 文档项可见", async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string)
    await page.getByTestId("export-menu").click()
    await expect(page.getByTestId("export-html")).toBeVisible()
    await expect(page.getByTestId("export-pdf")).toBeVisible()
  })
})
