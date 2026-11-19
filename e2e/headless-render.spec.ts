/**
 * e2e/headless-render.spec.ts — T5 模拟真机：无头浏览器渲染 + 截图。
 *
 * - file:// 协议加载 dist/renderer/index.html（主窗）与 ?docwin=1（独立窗）。
 * - file:// 下 ES module 脚本需 Chromium `--allow-file-access-from-files`
 *   否则被 CORS 拦截（origin 'null'），此处经 launchOptions 放行，
 *   更接近 Electron file 承载的真机语义。
 * - 断言只做“渲染出骨架 + 零致命 console error”，不碰业务逻辑。
 * - 截图输出到 docs/smoke-shots/（5 张）。
 */
import { test, expect } from "@playwright/test"
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"

// file:// 下加载 Vite module bundle 的必需放行。
test.use({
  launchOptions: {
    args: ["--allow-file-access-from-files"],
  },
})

const INDEX_URL = pathToFileURL(
  path.resolve(__dirname, "../dist/renderer/index.html"),
).toString()
const DOCWIN_URL = INDEX_URL + "?docwin=1"
const SHOT_DIR = path.resolve(__dirname, "../docs/smoke-shots")

test.beforeAll(() => {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  if (!fs.existsSync(path.resolve(__dirname, "../dist/renderer/index.html"))) {
    throw new Error("dist/renderer/index.html 缺失，请先跑 npm run build:renderer")
  }
})

type ErrorBucket = { errors: string[] }

/** 已知无害模式（第三方警告/ favicon 等），不计为致命。 */
function isFatal(text: string): boolean {
  const t = text.toLowerCase()
  const ignored = [
    "favicon",
    "third-party",
    "thirdparty",
    "react devtools",
    "react-dom-test-utils",
  ]
  if (ignored.some((s) => t.includes(s))) return false
  return true
}

function attachCollectors(page: import("@playwright/test").Page, bucket: ErrorBucket): void {
  page.on("console", (msg) => {
    if (msg.type() === "error") bucket.errors.push(msg.text().slice(0, 1000))
  })
  page.on("pageerror", (err) => {
    bucket.errors.push("pageerror: " + String(err?.message ?? err).slice(0, 1000))
  })
}

test.describe("T5 无头渲染（file:// + Chromium）", () => {
  test("a) 主窗骨架可见 + 零致命 console error", async ({ page }) => {
    const bucket: ErrorBucket = { errors: [] }
    attachCollectors(page, bucket)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(INDEX_URL, { waitUntil: "load", timeout: 30_000 })
    await expect(page.getByTestId("main-window")).toBeVisible({ timeout: 15_000 })
    // 骨架三件套：顶栏 / 侧栏 / 舞台外框
    await expect(page.getByTestId("topbar")).toBeVisible()
    await expect(page.getByTestId("sidebar")).toBeVisible()
    await expect(page.getByTestId("stage-frame")).toBeVisible()
    // 给异步初始化（store/事件回退）留 1s，再结算 console error
    await page.waitForTimeout(1000)
    const fatal = bucket.errors.filter(isFatal)
    expect(fatal, `致命 console error:\n${fatal.join("\n")}`).toStrictEqual([])
  })

  test("b) 三视口截图 1440×900 / 1024×768 / 600×900", async ({ page }) => {
    const sizes = [
      { width: 1440, height: 900, name: "main-1440x900.png" },
      { width: 1024, height: 768, name: "main-1024x768.png" },
      { width: 600, height: 900, name: "main-600x900.png" },
    ]
    for (const s of sizes) {
      const bucket: ErrorBucket = { errors: [] }
      const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
        if (msg.type() === "error") bucket.errors.push(msg.text().slice(0, 1000))
      }
      const onErr = (err: Error) => {
        bucket.errors.push("pageerror: " + String(err?.message ?? err).slice(0, 1000))
      }
      page.on("console", onConsole)
      page.on("pageerror", onErr)
      await page.setViewportSize({ width: s.width, height: s.height })
      await page.goto(INDEX_URL, { waitUntil: "load", timeout: 30_000 })
      await expect(page.getByTestId("main-window")).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(SHOT_DIR, s.name), fullPage: false })
      page.off("console", onConsole)
      page.off("pageerror", onErr)
      const fatal = bucket.errors.filter(isFatal)
      expect(fatal, `${s.name} 视口致命 console error:\n${fatal.join("\n")}`).toStrictEqual([])
      expect(fs.existsSync(path.join(SHOT_DIR, s.name))).toBe(true)
    }
  })

  test("c) 移动端模拟 390×844 @2x 自适应盒截图", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    const bucket: ErrorBucket = { errors: [] }
    attachCollectors(page, bucket)
    await page.goto(INDEX_URL, { waitUntil: "load", timeout: 30_000 })
    await expect(page.getByTestId("main-window")).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(SHOT_DIR, "mobile-390x844-2x.png"), fullPage: false })
    const fatal = bucket.errors.filter(isFatal)
    expect(fatal, `移动端致命 console error:\n${fatal.join("\n")}`).toStrictEqual([])
    expect(fs.existsSync(path.join(SHOT_DIR, "mobile-390x844-2x.png"))).toBe(true)
    await context.close()
  })

  test("d) 独立文档窗 ?docwin=1 骨架 + 截图", async ({ page }) => {
    const bucket: ErrorBucket = { errors: [] }
    attachCollectors(page, bucket)
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(DOCWIN_URL, { waitUntil: "load", timeout: 30_000 })
    await expect(page.getByTestId("doc-window")).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(SHOT_DIR, "docwin-1024x768.png"), fullPage: false })
    const fatal = bucket.errors.filter(isFatal)
    expect(fatal, `docwin 致命 console error:\n${fatal.join("\n")}`).toStrictEqual([])
    expect(fs.existsSync(path.join(SHOT_DIR, "docwin-1024x768.png"))).toBe(true)
  })
})
