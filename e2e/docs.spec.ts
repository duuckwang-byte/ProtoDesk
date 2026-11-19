/**
 * e2e/docs.spec.ts — W3-03 文档闭环回归（静态契约 + 可选真机）。
 *
 * 静态契约（无浏览器可跑）：
 * - 双形态面板 / PC 悬浮不挤压 / 移动端行内挤压；
 * - `?docwin=1` 路由与独立窗口；
 * - 功能说明读 source.md、缺失走 sandbox:read-file；
 * - desc → sandbox:write；latest → doc:write-latest({dir,file:'最新需求.md'})；
 * - 保存守卫（sandboxDir + __ver）与保存后 doc:mirror-push；
 * - useDocWindow（docwin.open/close/toggle）导出。
 *
 * 真机行为仅在设置 PLAND_E2E_APP_URL 时执行（需要可加载的 React 渲染器 URL）。
 */
import { test, expect } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(__dirname, "..")
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8")

const gui = process.env.PLAND_E2E_APP_URL ? test.describe : test.describe.skip

test.describe("docs 静态契约（W3-03 文档闭环）", () => {
  test("docs-panel 双形态：overlay（PC）+ inline（移动）", () => {
    const src = read("src/renderer/components/shell/DocsPanelHost.tsx")
    expect(src).toContain('data-testid="docs-panel"')
    expect(src).toContain('data-variant="overlay"')
    expect(src).toContain('data-variant="inline"')
    expect(src).toContain('data-testid="docs-overlay"')
  })

  test("PC 悬浮 fixed + 遮罩关闭；移动行内 border-l 挤压", () => {
    const src = read("src/renderer/components/shell/DocsPanelHost.tsx")
    expect(src).toContain("fixed bottom-4 right-4 top-12")
    expect(src).toContain("bg-black/30")
    expect(src).toContain("border-l border-border")
  })

  test("PC 目录为文档左侧同层级独立 fixed 面板（220px，与文档共用遮罩/Esc）", () => {
    const src = read("src/renderer/components/shell/DocsPanelHost.tsx")
    expect(src).toContain('data-testid="doc-toc-sidebar"')
    expect(src).toContain("w-[220px]")
    expect(src).toContain("w-[min(980px,calc(100vw-18rem))]")
    expect(src).toContain("min(980px, 100vw - 18rem)")
    // 目录与文档同属一个遮罩层之上，点击目录不触发遮罩关闭。
    expect(src).toContain('data-testid="docs-overlay"')
    expect(src).toContain('onClick={closeDocs}')
  })

  test("独立文档窗使用 variant=window（目录+正文 flex，不套 overlay）", () => {
    const src = read("src/renderer/app/modes/DocWindow.tsx")
    expect(src).toContain('variant="window"')
    expect(src).not.toContain('variant="overlay"')
    expect(read("src/renderer/features/docs/DocsPanel.tsx")).toContain('"window"')
  })

  test("文档面板标题不再出现“占位”Badge", () => {
    const src = read("src/renderer/components/shell/DocsPanelHost.tsx")
    expect(src).not.toContain("占位")
    expect(src).not.toContain("Badge")
  })

  test("MainWindow 按 kind 分流文档容器（PC 悬浮不参与分栏）", () => {
    const src = read("src/renderer/app/modes/MainWindow.tsx")
    expect(src).toContain('kind === "mobile"')
    expect(src).toContain('kind === "pc"')
  })

  test("?docwin=1 路由桩 + doc-window 容器", () => {
    expect(read("src/renderer/main.tsx")).toContain('get("docwin") === "1"')
    expect(read("src/renderer/app/modes/DocWindow.tsx")).toContain('data-testid="doc-window"')
  })

  test("独立窗口订阅 doc:mirror 并应用内容", () => {
    const src = read("src/renderer/app/modes/DocWindow.tsx")
    expect(src).toContain("doc:mirror")
    expect(src).toContain("onDocMirror")
    expect(src).toContain("applyMirrorContent")
  })

  test("独立窗口 ?docwin=1 项目/原型直进 sources-store", () => {
    const src = read("src/renderer/app/modes/DocWindow.tsx")
    expect(src).toContain("loadSources(project, proto")
    expect(src).toContain("PROTO_LAST_PROJECT")
    expect(src).toContain("reportMode")
  })

  test("关闭文档窗保留 mirrorBack mode=panel", () => {
    const src = read("src/renderer/app/modes/DocWindow.tsx")
    expect(src).toContain('invokeProtoMethod("doc", "mirrorBack"')
    expect(src).toContain("reportMode(\"panel\")")
  })

  test("功能说明优先 source.md，缺失走 sandbox:read-file", () => {
    const src = read("src/renderer/stores/docs-store.ts")
    expect(src).toContain("loadDesc:")
    expect(src).toContain('typeof src.md === "string"')
    expect(src).toContain('invokeProtoMethod("sandbox", "readFile"')
    expect(src).toContain("{ dir, file: src.mdFile }")
  })

  test("保存分流：desc → sandbox:write / latest → doc:write-latest", () => {
    const src = read("src/renderer/stores/docs-store.ts")
    expect(src).toContain('invokeProtoMethod("sandbox", "write"')
    expect(src).toContain('invokeProtoMethod("doc", "writeLatest"')
    expect(src).toContain('file: "最新需求.md"')
    expect(src).toContain("descFileOf(snap)")
  })

  test("旧错参已移除：不再发 {content,reqVersion} / {project,proto}", () => {
    const src = read("src/renderer/stores/docs-store.ts")
    expect(src).not.toContain("content: s.draft")
    expect(src).not.toContain("readLatest\", { project")
    expect(src).not.toContain("proto: proto ??")
  })

  test("保存守卫：记录 sandboxDir + __ver，切源丢弃并 toast", () => {
    const src = read("src/renderer/stores/docs-store.ts")
    expect(src).toContain("sourceDir")
    expect(src).toContain("sourceVer")
    expect(src).toContain("__ver")
    expect(src).toContain("保存已阻断")
    expect(src).toContain("已切换原型")
    expect(src).toContain("版本已变化")
  })

  test("保存成功后 doc:mirror-push kind=content", () => {
    const src = read("src/renderer/stores/docs-store.ts")
    expect(src).toContain('invokeProtoMethod("doc", "mirrorPush"')
    expect(src).toContain('kind: "content"')
    expect(src).toContain("payload:")
  })

  test("DocsPanel 挂载即加载功能说明；切 Tab 按当前 dir 读最新需求", () => {
    const src = read("src/renderer/features/docs/DocsPanel.tsx")
    expect(src).toContain("void loadDesc(source)")
    expect(src).toContain('void loadLatest(source?.sandboxDir ?? "")')
    expect(src).not.toContain("useAppStore")
    expect(src).not.toContain("loadLatest(project, proto)")
  })

  test("useDocWindow 导出 docwin.open/close/toggle（W3-04 只读消费）", () => {
    const src = read("src/renderer/stores/docs-store.ts")
    expect(src).toContain("export const useDocWindow")
    expect(src).toContain('invokeProtoMethod("docwin", "open"')
    expect(src).toContain('invokeProtoMethod("docwin", "close"')
    expect(src).toContain('invokeProtoMethod("docwin", "toggle"')
    expect(src).toContain("closeDocs()")
  })

  test("Popover 基建存在，doc-micro-edit 微改可用", () => {
    expect(read("src/renderer/components/ui/popover.tsx")).toContain("PopoverContent")
    expect(read("src/renderer/features/docs/DocEditor.tsx")).toContain('data-testid="doc-micro-edit"')
    expect(read("src/renderer/features/docs/DocEditor.tsx")).toContain("await useDocsStore.getState().save()")
  })
})

gui("docs 真机行为（需 PLAND_E2E_APP_URL）", () => {
  test("PC 文档悬浮不挤压舞台", async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string)
    const stage = page.getByTestId("stage-frame")
    const before = await stage.boundingBox()
    await page.getByRole("button", { name: "打开文档" }).click()
    await expect(page.getByTestId("docs-panel")).toBeVisible()
    const after = await stage.boundingBox()
    expect(after?.width).toBe(before?.width)
  })

  test("Esc 关闭文档", async ({ page }) => {
    await page.goto(process.env.PLAND_E2E_APP_URL as string)
    await page.getByRole("button", { name: "打开文档" }).click()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("docs-panel")).toHaveCount(0)
  })
})
