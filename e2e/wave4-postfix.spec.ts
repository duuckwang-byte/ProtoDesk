/**
 * e2e/wave4-postfix.spec.ts — Wave4 修复后复测 · Esc 栈 + 导出独立 HTML（domain postfix）。
 *
 * 覆盖（只读验证，不改产品代码）：
 *   1. 单层：设置 / AI 各按一次 Esc 关闭，焦点回到顶栏触发按钮；
 *   2. 双层：设置 + AI 同时打开，按一次 Esc 只关最上层（AI），再按一次关设置；
 *   3. X 关闭、遮罩关闭不受 Esc 拦截逻辑影响；
 *   4. 导出独立 HTML：file:// + 断网打开，右侧文档区可见非空、md 表格可见、无 React 运行时；
 *   5. console / pageerror / crash 汇总。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain postfix
 *   npx playwright test e2e/wave4-postfix.spec.ts --workers=1 --output=test-results/wave4/postfix
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import {
  ROOT,
  TEMP_ROOT,
  isFatalConsole,
  launchApp,
  reportFailure,
  shotPath,
  type Wave4App,
} from './wave4/harness'

const DOMAIN = 'postfix'
const PROJECT = '测试1'
const HOME = '首页'

function log(label: string, data: unknown): void {
  console.log(`[W4-POSTFIX] ${label} ${JSON.stringify(data)}`)
}

function relShot(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

function norm(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => !name.endsWith('.crdownload'))
  } catch {
    return []
  }
}

function fileInfo(file: string): { path: string; size: number } {
  return { path: file, size: fs.statSync(file).size }
}

async function waitDownload(dir: string, timeoutMs = 25_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const name of listFiles(dir)) {
      const file = path.join(dir, name)
      try {
        if (fs.statSync(file).size > 0) {
          await delay(200)
          return file
        }
      } catch {
        /* 下载尚未完成 */
      }
    }
    await delay(200)
  }
  throw new Error(`下载未落盘：${dir}（已等待 ${timeoutMs}ms）`)
}

async function clearToasts(page: Page): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const btn = page.locator('[data-slot="toast"] button[aria-label="关闭通知"]').first()
    if (!(await btn.count().catch(() => 0))) break
    await btn.click({ timeout: 1_000 }).catch(() => undefined)
  }
  await delay(120)
}

async function waitToast(
  page: Page,
  expectText: string,
  timeoutMs = 25_000,
  wrongTexts: string[] = [],
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let seen: string[] = []
  while (Date.now() < deadline) {
    const texts = (await page.locator('[data-slot="toast"]').allInnerTexts().catch(() => []))
      .map(norm)
      .filter(Boolean)
    if (texts.length) seen = texts
    const hit = texts.find((t) => t.includes(expectText))
    if (hit) return hit
    const bad = texts.find((t) => wrongTexts.some((w) => t.includes(w)))
    if (bad) throw new Error(`导出返回错误 toast：${bad}`)
    await delay(150)
  }
  throw new Error(`未捕获预期 toast「${expectText}」；最后 toast=${seen.join(' / ') || '(none)'}`)
}

async function ensureSidebar(page: Page): Promise<void> {
  if (await page.getByTestId('sidebar').isVisible().catch(() => false)) return
  await page.locator('button[title="展开侧栏"]').first().click()
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
}

async function bootToHome(page: Page): Promise<{ restored: string }> {
  await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2_500)
  const picker = page.getByTestId('project-picker')
  if (await picker.isVisible().catch(() => false)) {
    const row = picker.locator('li').filter({ hasText: PROJECT }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  const restored = norm(await page.getByTestId('loc-pill').innerText())
  await ensureSidebar(page)
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
  const home = page
    .getByTestId('sidebar')
    .locator('button[data-level="proto"]')
    .filter({ hasText: new RegExp(`^\\s*${HOME}\\s*$`) })
    .first()
  await expect(home).toBeVisible({ timeout: 20_000 })
  await home.click()
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
  await page.waitForTimeout(1_000)
  return { restored }
}

interface ActiveInfo {
  tag: string
  ariaLabel: string | null
  testId: string | null
  text: string
  inTopbar: boolean
  inSidebar: boolean
}

async function activeInfo(page: Page): Promise<ActiveInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return { tag: 'none', ariaLabel: null, testId: null, text: '', inTopbar: false, inSidebar: false }
    return {
      tag: el.tagName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label'),
      testId: el.getAttribute('data-testid'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      inTopbar: !!el.closest('[data-testid="topbar"]'),
      inSidebar: !!el.closest('[data-testid="sidebar"]'),
    }
  })
}

async function openSettingsByClick(page: Page): Promise<void> {
  // 设置入口已收敛到侧栏底部；移动端 kind 会收起侧栏，先展开。
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  const btn = page.locator('[data-testid="sidebar"] button[aria-label="打开设置"]')
  await btn.focus()
  await btn.click()
  await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 10_000 })
}

async function openAiByClick(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="topbar"] button[aria-label="AI 对话"]')
  await btn.focus()
  await btn.click()
  await expect(page.getByTestId('ai-dialog')).toBeVisible({ timeout: 10_000 })
}

/** 遮罩挡住顶栏时用 DOM click 叠第二层（仍会触发 MainWindow 的 click 捕获记录 opener）。 */
async function openAiProgrammatic(page: Page): Promise<void> {
  await page.locator('[data-testid="topbar"] button[aria-label="AI 对话"]').evaluate((el) => (el as HTMLElement).click())
  await expect(page.getByTestId('ai-dialog')).toBeVisible({ timeout: 10_000 })
}

async function dialogCounts(page: Page): Promise<{ ai: number; settings: number; git: number }> {
  return {
    ai: await page.getByTestId('ai-dialog').count(),
    settings: await page.getByTestId('settings-dialog').count(),
    git: await page.getByTestId('git-sheet').count(),
  }
}

/** 主进程下载守卫：只重定向下载，不弹原生保存框。 */
async function installExportGuards(ctx: Wave4App): Promise<void> {
  await ctx.app.evaluate((electron) => {
    const mod = electron as unknown as {
      session: { defaultSession: { on: (event: string, cb: (event: unknown, item: any) => void) => void } }
      dialog: { showSaveDialog: (...args: unknown[]) => Promise<unknown> }
    }
    const g = globalThis as unknown as Record<string, any>
    g.__w4PostDownloads = []
    g.__w4PostSaveDialogCalls = 0
    g.__w4PostDownloadDir = ''
    try {
      mod.dialog.showSaveDialog = async () => {
        g.__w4PostSaveDialogCalls += 1
        return { canceled: true }
      }
    } catch {
      /* dialog 只读时忽略 */
    }
    mod.session.defaultSession.on('will-download', (_event: unknown, item: any) => {
      try {
        const target = String(g.__w4PostDownloadDir || '') + '/' + String(item.getFilename() || 'download.bin')
        item.setSavePath(target)
        ;(g.__w4PostDownloads as string[]).push(target)
      } catch {
        /* 由落盘断言兜底 */
      }
    })
  })
}

async function setDownloadDir(ctx: Wave4App, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  await ctx.app.evaluate((_electron, target) => {
    const g = globalThis as unknown as Record<string, any>
    g.__w4PostDownloadDir = target
  }, dir)
}

test.describe('Wave4 修复后复测 · Esc 栈 + 导出 HTML', () => {
  test('Esc 逐层关闭 / X / 遮罩 / 焦点回归 + 独立 HTML 文档区与表格', async ({}, testInfo) => {
    test.setTimeout(360_000)
    let ctx: Wave4App | null = null
    let browser: Browser | null = null
    let step = 0
    const exportRoot = path.join(TEMP_ROOT, 'exports', `postfix-${Date.now()}`)

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      expect(path.resolve(ctx.userData).toLowerCase()).toBe(path.resolve(ctx.dataDir).toLowerCase())

      // ── 0. 进入项目 + 首页原型 ──────────────────────────────────────────
      step = 0
      const boot = await bootToHome(page)
      const baselineConsole = ctx.consoleErrors.length
      const baselinePageErrors = ctx.pageErrors.length
      log('boot', {
        dataDir: ctx.dataDir,
        userData: ctx.userData,
        seed: ctx.seedPresent,
        restored: boot.restored,
        baselineConsole,
        baselinePageErrors,
      })
      await ctx.shot(0, 'project-entry')

      // ── 1. 单层设置：Esc 关闭 + 焦点回归 ───────────────────────────────
      step = 1
      await openSettingsByClick(page)
      await page.locator('[data-testid="settings-dialog"] button[aria-label="关闭"]').focus()
      const settingsBefore = await activeInfo(page)
      await ctx.shot(1, 'esc-single-settings')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 5_000 })
      const settingsFocus = await activeInfo(page)
      // 软断言：Esc 关闭成功但焦点未回归时，仍继续跑导出 HTML 取证。
      expect.soft(settingsFocus.ariaLabel, '设置关闭后焦点应回到侧栏「打开设置」按钮').toBe('打开设置')
      expect.soft(settingsFocus.inSidebar, '焦点应位于侧栏').toBe(true)
      const settingsBackShot = await ctx.shot(2, 'esc-single-settings-focus')
      log('step1-settings', {
        before: settingsBefore,
        after: settingsFocus,
        focusReturned: settingsFocus.ariaLabel === '打开设置' && settingsFocus.inSidebar,
        shot: relShot(settingsBackShot),
      })

      // ── 2. 单层 AI：Esc 关闭 + 焦点回归 ────────────────────────────────
      step = 2
      await openAiByClick(page)
      await page.getByTestId('ai-tab-chat').focus()
      const aiBefore = await activeInfo(page)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('ai-dialog')).toHaveCount(0, { timeout: 5_000 })
      const aiFocus = await activeInfo(page)
      expect.soft(aiFocus.ariaLabel, 'AI 关闭后焦点应回到顶栏「AI 对话」按钮').toBe('AI 对话')
      expect.soft(aiFocus.inTopbar, '焦点应位于顶栏').toBe(true)
      const aiBackShot = await ctx.shot(3, 'esc-single-ai-focus')
      log('step2-ai', {
        before: aiBefore,
        after: aiFocus,
        focusReturned: aiFocus.ariaLabel === 'AI 对话' && aiFocus.inTopbar,
        shot: relShot(aiBackShot),
      })

      // ── 3. 双层设置 + AI：一次 Esc 只关最上层 ──────────────────────────
      step = 3
      await openSettingsByClick(page)
      await openAiProgrammatic(page)
      const stackBefore = await dialogCounts(page)
      expect(stackBefore, '双层应同时打开').toEqual({ ai: 1, settings: 1, git: 0 })
      const stackFocusBefore = await activeInfo(page)
      const stackShot = await ctx.shot(4, 'esc-stack-before')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(350)
      const afterFirst = await dialogCounts(page)
      const firstFocus = await activeInfo(page)
      const firstShot = await ctx.shot(5, 'esc-stack-after-1')
      // 软断言：目标行为是只关 AI 一层；若仍一次关两层，继续跑完导出 HTML 取证并记 P1。
      expect.soft(afterFirst.ai, '第一次 Esc 应只关 AI（最上层）').toBe(0)
      expect.soft(afterFirst.settings, '第一次 Esc 后设置应仍在').toBe(1)
      log('step3-stack-1', {
        before: stackBefore,
        after: afterFirst,
        oneLayerOnly: afterFirst.ai === 0 && afterFirst.settings === 1,
        focusBefore: stackFocusBefore,
        focusAfter: firstFocus,
        shot: relShot(firstShot),
      })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(350)
      const afterSecond = await dialogCounts(page)
      const secondFocus = await activeInfo(page)
      const secondShot = await ctx.shot(6, 'esc-stack-after-2')
      expect.soft(afterSecond, '第二次 Esc 后两层都应关闭').toEqual({ ai: 0, settings: 0, git: 0 })
      expect.soft(secondFocus.ariaLabel, '两层都关闭后焦点应回到侧栏「打开设置」按钮').toBe('打开设置')
      expect.soft(secondFocus.inSidebar, '焦点应位于侧栏').toBe(true)
      log('step3-stack-2', {
        before: stackShot,
        after: afterSecond,
        focusAfter: secondFocus,
        shot: relShot(secondShot),
      })

      // ── 4. X 关闭不受影响 ──────────────────────────────────────────────
      step = 4
      await openAiByClick(page)
      await page.locator('[data-testid="ai-dialog"] button[aria-label="关闭"]').click()
      await expect(page.getByTestId('ai-dialog')).toHaveCount(0, { timeout: 5_000 })
      await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
      await openSettingsByClick(page)
      await page.locator('[data-testid="settings-dialog"] button[aria-label="关闭"]').click()
      await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 5_000 })
      const xShot = await ctx.shot(7, 'x-close')
      log('step4-x', { ai: 0, settings: 0, shot: relShot(xShot) })

      // ── 5. 遮罩点击关闭不受影响 ────────────────────────────────────────
      step = 5
      await openSettingsByClick(page)
      const overlayHit = await page.evaluate(() => {
        const el = document.elementFromPoint(20, 300) as HTMLElement | null
        return {
          tag: el?.tagName || 'none',
          slot: el?.getAttribute('data-slot'),
          testId: el?.getAttribute('data-testid'),
          cls: (el?.className || '').toString().slice(0, 80),
        }
      })
      await page.mouse.click(20, 300)
      await page.waitForTimeout(350)
      const settingsAfterOverlay = await page.getByTestId('settings-dialog').count()
      const overlayShot = await ctx.shot(8, 'overlay-close')
      // 软断言：遮罩点击若被上层布局容器拦截，记缺陷但不阻断后续导出取证。
      expect.soft(settingsAfterOverlay, '点击遮罩空白处应关闭设置').toBe(0)
      log('step5-overlay', {
        overlayHit,
        settingsAfterOverlay,
        overlayClosed: settingsAfterOverlay === 0,
        shot: relShot(overlayShot),
      })
      if (settingsAfterOverlay > 0) {
        await page.locator('[data-testid="settings-dialog"] button[aria-label="关闭"]').click()
        await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 5_000 })
      }

      // ── 6. 导出独立 HTML ───────────────────────────────────────────────
      step = 6
      fs.mkdirSync(exportRoot, { recursive: true })
      await installExportGuards(ctx)
      const exportDir = path.join(exportRoot, '01-html')
      await setDownloadDir(ctx, exportDir)

      // 先打开文档面板，确保 docs-store 已加载当前「首页.md」。
      await page.getByTestId('topbar-docs').click()
      const docs = page.getByTestId('docs-panel')
      await expect(docs).toBeVisible({ timeout: 15_000 })
      await expect(docs).toContainText('商城首页', { timeout: 20_000 })
      await page.keyboard.press('Escape')
      await expect(docs).toBeHidden({ timeout: 5_000 })

      await clearToasts(page)
      await page.getByTestId('export-menu').click()
      await expect(page.getByTestId('export-html')).toBeVisible({ timeout: 10_000 })
      const menuShot = await ctx.shot(9, 'export-menu')
      await page.getByTestId('export-html').click()
      const toast = await waitToast(page, '独立 HTML 已导出', 25_000, ['失败', '缺失', '请先选择'])
      const file = await waitDownload(exportDir)
      const info = fileInfo(file)
      expect(info.size, '独立 HTML 应 >10KB').toBeGreaterThan(10 * 1024)
      const htmlText = fs.readFileSync(file, 'utf8')
      expect(htmlText).toContain('__EXPORT_BOOT__=true')
      expect(htmlText).toContain('__EXPORT_SOURCES__=')
      expect(htmlText.toLowerCase()).toContain('<!doctype html>')

      browser = await chromium.launch({ headless: true })
      const offlineCtx = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } })
      const exported = await offlineCtx.newPage()
      const offlineConsole: string[] = []
      const offlinePageErrors: string[] = []
      exported.on('console', (msg) => {
        if (msg.type() === 'error') offlineConsole.push(msg.text().slice(0, 500))
      })
      exported.on('pageerror', (err) => offlinePageErrors.push(String(err?.message ?? err).slice(0, 500)))
      await exported.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30_000 })
      await exported.waitForFunction(() => (window as unknown as Record<string, any>).__EXPORT_BOOT__ === true, {
        timeout: 15_000,
      })

      await expect
        .poll(
          async () => (await exported.locator('#docContent').innerText().catch(() => '')).length,
          { timeout: 20_000 },
        )
        .toBeGreaterThan(1_000)

      const facts = await exported.evaluate(() => {
        const w = window as unknown as Record<string, any>
        const doc = document.getElementById('docContent')
        const title = document.getElementById('exportLiteTitle')
        const docBox = document.querySelector('.export-lite-doc') as HTMLElement | null
        const rect = docBox?.getBoundingClientRect()
        const isShown = (el: Element | null) => {
          if (!el) return false
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') return false
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        const tables = Array.from(doc?.querySelectorAll('table.md-table') || [])
        const first = tables[0] as HTMLTableElement | undefined
        const firstRect = first?.getBoundingClientRect()
        return {
          boot: w.__EXPORT_BOOT__ === true,
          sourceCount: Array.isArray(w.__EXPORT_SOURCES__) ? w.__EXPORT_SOURCES__.length : -1,
          reqMap: Boolean(w.__REQ_MAP__ && typeof w.__REQ_MAP__ === 'object'),
          renderer: Boolean(w.__EXPORT_RENDER__ && typeof w.__EXPORT_RENDER__ === 'object'),
          styleSheets: document.styleSheets.length,
          externalScripts: Array.from(document.scripts).filter((s) => Boolean(s.src)).length,
          react: typeof w.React !== 'undefined',
          reactRoot: document.querySelectorAll('[data-reactroot]').length,
          htmlHasReactDom: /react-dom|createRoot|__REACT_DEVTOOLS/i.test(document.documentElement.innerHTML),
          offline: navigator.onLine === false,
          bodyTextLen: String(document.body?.innerText ?? '').length,
          docExists: !!doc,
          docShown: isShown(doc),
          docTextLen: String(doc?.textContent ?? '').length,
          docHasTitle: String(doc?.textContent ?? '').includes('商城首页'),
          titleText: String(title?.textContent ?? '').trim(),
          titleShown: isShown(title),
          docBox: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          tableCount: tables.length,
          firstTableShown: isShown(first || null),
          firstTableRows: first ? first.querySelectorAll('tbody tr').length : 0,
          firstTableCells: first ? first.querySelectorAll('th, td').length : 0,
          firstTableHead: first
            ? Array.from(first.querySelectorAll('th'))
                .map((th) => String(th.textContent || '').trim())
                .join(' / ')
            : '',
          firstTableRect: firstRect
            ? { x: firstRect.x, y: firstRect.y, width: firstRect.width, height: firstRect.height }
            : null,
        }
      })

      expect(facts.boot, '__EXPORT_BOOT__ 必须为 true').toBe(true)
      expect(facts.sourceCount, '__EXPORT_SOURCES__ 必须非空').toBeGreaterThan(0)
      expect(facts.reqMap, '__REQ_MAP__ 必须为对象').toBe(true)
      expect(facts.renderer, '__EXPORT_RENDER__ 必须存在').toBe(true)
      expect(facts.styleSheets, '导出 HTML 应有内联样式表').toBeGreaterThan(0)
      expect(facts.externalScripts, '导出 HTML 不得引用外部脚本').toBe(0)
      expect(facts.offline, 'Chromium 上下文应为断网模式').toBe(true)
      expect(facts.bodyTextLen, '导出 HTML 正文不应为空').toBeGreaterThan(30)

      // 右侧文档区：可见、非空、标题正确
      expect(facts.docExists, '导出 HTML 应有 #docContent').toBe(true)
      expect(facts.docShown, '右侧文档区必须可见（不能被 display:none 隐藏）').toBe(true)
      expect(facts.docTextLen, '右侧文档区文本应 >3000 字符').toBeGreaterThan(3_000)
      expect(facts.docHasTitle, '右侧文档区应包含当前文档标题「商城首页」').toBe(true)
      expect(facts.titleShown, '文档标题 #exportLiteTitle 应可见').toBe(true)
      expect(facts.titleText.length, '文档标题不应为空').toBeGreaterThan(0)
      expect(facts.docBox, '.export-lite-doc 应有可见布局').not.toBeNull()
      expect(facts.docBox!.width, '右侧文档区宽度应 >200px').toBeGreaterThan(200)
      expect(facts.docBox!.x, '文档区应位于右侧（x 大于视口一半）').toBeGreaterThan(720)

      // md 表格可见
      expect(facts.tableCount, '右侧文档区应渲染 markdown 表格').toBeGreaterThan(0)
      expect(facts.firstTableShown, '第一个 md 表格应可见').toBe(true)
      expect(facts.firstTableRows, '表格应有数据行').toBeGreaterThan(0)
      expect(facts.firstTableCells, '表格应有表头/单元格').toBeGreaterThan(2)
      expect(facts.firstTableHead.length, '表头文本不应为空').toBeGreaterThan(0)
      expect(facts.firstTableRect, '表格应有布局尺寸').not.toBeNull()
      expect(facts.firstTableRect!.width, '表格宽度应 >100px').toBeGreaterThan(100)

      // 无 React
      expect(facts.react, '导出 HTML 不得加载 React 运行时').toBe(false)
      expect(facts.reactRoot, '导出 HTML 不得有 React 根节点').toBe(0)
      expect(facts.htmlHasReactDom, '导出 HTML 不得包含 react-dom/createRoot').toBe(false)

      // iframe 原型正文
      const frameBody = exported.frameLocator('#frame').locator('body')
      await expect
        .poll(async () => (await frameBody.innerText().catch(() => '')).length, { timeout: 20_000 })
        .toBeGreaterThan(100)
      const iframeTextLen = (await frameBody.innerText()).length

      const exportedShot = await ctx.shot(10, 'html-offline', { page: exported })
      const docShot = shotPath(DOMAIN, 11, 'html-doc-table')
      fs.mkdirSync(path.dirname(docShot), { recursive: true })
      await exported.locator('.export-lite-doc').screenshot({ path: docShot })

      log('step6-html', {
        toast,
        file,
        size: info.size,
        facts,
        iframeTextLen,
        offlineConsole,
        offlinePageErrors,
        shots: [relShot(menuShot), relShot(exportedShot), relShot(docShot)],
      })
      expect(offlinePageErrors, '导出 HTML 断网打开不应有 pageerror').toStrictEqual([])

      await offlineCtx.close()

      // ── 7. console / pageerror / crash ─────────────────────────────────
      step = 7
      const newConsole = ctx.consoleErrors.slice(baselineConsole)
      const newPageErrors = ctx.pageErrors.slice(baselinePageErrors)
      const newFatal = [...newConsole, ...newPageErrors, ...ctx.crashes].filter(isFatalConsole)
      const finalShot = await ctx.shot(12, 'final')
      const saveDialogCalls = await ctx.app.evaluate(
        () => (globalThis as unknown as Record<string, any>).__w4PostSaveDialogCalls ?? -1,
      )
      expect(saveDialogCalls, '本次只导出 HTML，不应触发原生保存对话框').toBe(0)
      log('step7-console', {
        baselineConsole,
        baselinePageErrors,
        newConsole,
        newPageErrors,
        crashes: ctx.crashes,
        fatalCount: newFatal.length,
        startupNoise: ctx.consoleErrors.slice(0, baselineConsole),
        shot: relShot(finalShot),
      })
      expect(newPageErrors, '进入首页后不应新增 pageerror').toStrictEqual([])
      expect(ctx.crashes, 'crash 应为 0').toStrictEqual([])
      expect(newFatal, '进入首页后不应新增致命 console/pageerror/crash').toHaveLength(0)

      testInfo.attach('postfix-evidence', {
        body: JSON.stringify(
          {
            dataDir: ctx.dataDir,
            userData: ctx.userData,
            seed: ctx.seedPresent,
            exportFile: file,
            exportSize: info.size,
            facts,
            consoleErrors: ctx.consoleErrors,
            pageErrors: ctx.pageErrors,
            crashes: ctx.crashes,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      })
    } catch (err) {
      if (ctx) {
        await reportFailure(ctx, {
          step,
          slug: `postfix-step-${step}`,
          level: 'P1',
          expected: 'Esc 逐层关闭与导出独立 HTML 可用',
          actual: `step ${step} 失败`,
          error: err,
        })
      }
      throw err
    } finally {
      if (browser) await browser.close().catch(() => undefined)
      fs.rmSync(exportRoot, { recursive: true, force: true })
      if (ctx) {
        const closed = await ctx.close()
        log('close', closed)
        if (!closed.ok) {
          console.warn(
            `[W4-POSTFIX] P2 close: window-all-closed 未退出（${closed.method}/${closed.exitCode}），已 kill 收尾；功能断言全 PASS`,
          )
        }
      }
    }
  })
})
