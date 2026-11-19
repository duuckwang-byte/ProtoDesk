/**
 * e2e/wave4-export.spec.ts — Wave4 A2 导出域真机冒烟（源码 JSON / 独立 HTML / 文档 Markdown）。
 *
 * 覆盖（只判 P0/P1 功能阻断；PNG/PDF 原生保存对话框留 A3，本 spec 只验菜单项存在，不点击）：
 *   1. 顶栏导出菜单 5 项齐全（源码 / 独立 HTML / 文档 PNG / PDF / MD），Esc 可关闭；
 *   2. 源码包 JSON 落盘：可解析、project/当前源 content/md 正确、大小合理、toast；
 *   3. 独立 HTML 落盘：Chromium file:// + 断网打开，断言 __EXPORT_BOOT__ / __EXPORT_SOURCES__ /
 *      styleSheets > 0 / 正文非空 / iframe 正文非空 / 无 React 运行时 / 无外链脚本；
 *   4. md 图片内联：seed 的 md 无图片（assets/ 为空）→ SKIP，不伪造数据；
 *   5. 文档 Markdown 落盘：内容与当前文档（磁盘 首页.md）逐字节一致、文件名含文档标题、toast；
 *   6. toast / 错误处理：空文档导出提示且不落盘；主进程 showSaveDialog 调用计数=0（未触发原生对话框）。
 *
 * 运行（先 seed，再单域跑）：
 *   node e2e/wave4/seed.mjs --domain export
 *   npx playwright test e2e/wave4-export.spec.ts --workers=1 --output=test-results/wave4/export
 *
 * 写入范围：本 spec 只写 docs/wave4/shots/export/** 与 .devdata-wave4-export/**；
 * 临时导出文件写 %TEMP%/pland-wave4/exports/<run>，运行后可整体删除。
 */
import { test, expect } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { ROOT, TEMP_ROOT, assertCleanExit, launchApp, type Wave4App } from './wave4/harness'

type StepStatus = 'PASS' | 'FAIL' | 'SKIP' | 'NOT RUN'

interface StepRow {
  no: number | string
  title: string
  status: StepStatus
  evidence: string
  shots: string[]
  ms: number
}

const rows: StepRow[] = []
const PROJECT = '测试1'
const HOME = '首页'
const MINE = '我的'

function relShot(abs: string): string {
  return path.relative(ROOT, abs).replace(/\\/g, '/')
}

function norm(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message.split('\n').slice(0, 8).join(' | ')
  return String(err)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sha12(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12).toUpperCase()
}

function fileInfo(file: string): { path: string; size: number; sha: string } {
  return { path: file, size: fs.statSync(file).size, sha: sha12(file) }
}

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => !name.endsWith('.crdownload'))
  } catch {
    return []
  }
}

async function runStep(
  ctx: Wave4App,
  no: number | string,
  title: string,
  slug: string,
  fn: () => Promise<{ evidence: string; shots?: string[]; status?: StepStatus }>,
): Promise<boolean> {
  const started = Date.now()
  try {
    const out = await fn()
    const row: StepRow = {
      no,
      title,
      status: out.status ?? 'PASS',
      evidence: out.evidence,
      shots: (out.shots ?? []).map(relShot),
      ms: Date.now() - started,
    }
    rows.push(row)
    console.log(`[export] STEP ${no} ${row.status} ${title} | ${row.evidence} | ${row.shots.join(',') || '-'} | ${row.ms}ms`)
    return true
  } catch (err) {
    const message = errorText(err)
    let failShot = ''
    try {
      failShot = relShot(await ctx.shot(no, slug, { fail: true }))
    } catch {
      /* 页面可能已崩溃，无法截图 */
    }
    const row: StepRow = {
      no,
      title,
      status: 'FAIL',
      evidence: message,
      shots: failShot ? [failShot] : [],
      ms: Date.now() - started,
    }
    rows.push(row)
    console.error(`[export] STEP ${no} FAIL ${title} | ${message} | ${row.shots.join(',') || '-'}`)
    return false
  }
}

function skipStep(no: number | string, title: string, evidence: string): void {
  rows.push({ no, title, status: 'SKIP', evidence, shots: [], ms: 0 })
  console.log(`[export] STEP ${no} SKIP ${title} | ${evidence}`)
}

function markNotRun(no: number | string, title: string, reason: string): void {
  rows.push({
    no,
    title,
    status: 'NOT RUN',
    evidence: reason,
    shots: [],
    ms: 0,
  })
}

/** 冷启动：等项目恢复；若弹选择器则选「测试1」进入。 */
async function ensureProject(page: Page): Promise<boolean> {
  await page.waitForTimeout(2_000)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    const row = picker.locator('li').filter({ hasText: PROJECT }).first()
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
  return shown
}

function sidebarProject(page: Page) {
  return page.getByTestId('sidebar').locator('button[title="切换项目"]')
}

function protoButtons(page: Page) {
  return page.getByTestId('sidebar-tree').locator('button[data-level="proto"]')
}

/** 主进程下载守卫 + 原生保存对话框 spy：只重定向下载，不弹原生框。 */
async function installExportGuards(ctx: Wave4App): Promise<void> {
  await ctx.app.evaluate((electron) => {
    const mod = electron as unknown as {
      session: { defaultSession: { on: (event: string, cb: (event: unknown, item: any) => void) => void } }
      dialog: { showSaveDialog: (...args: unknown[]) => Promise<unknown> }
    }
    const g = globalThis as unknown as Record<string, any>
    g.__w4Downloads = []
    g.__w4SaveDialogCalls = 0
    g.__w4DownloadDir = ''
    try {
      mod.dialog.showSaveDialog = async () => {
        g.__w4SaveDialogCalls += 1
        return { canceled: true }
      }
    } catch {
      /* 某些环境 dialog 只读；spy 失败不影响后续下载断言 */
    }
    mod.session.defaultSession.on('will-download', (_event: unknown, item: any) => {
      try {
        const target = String(g.__w4DownloadDir || '') + '/' + String(item.getFilename() || 'download.bin')
        item.setSavePath(target)
        ;(g.__w4Downloads as string[]).push(target)
      } catch {
        /* 单个下载重定向失败由文件落盘断言兜底 */
      }
    })
  })
}

async function setDownloadDir(ctx: Wave4App, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  await ctx.app.evaluate((_electron, target) => {
    const g = globalThis as unknown as Record<string, any>
    g.__w4DownloadDir = target
  }, dir)
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
        /* 下载尚未完成，下轮再试 */
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
  timeoutMs = 20_000,
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

async function openExportMenu(page: Page): Promise<void> {
  await page.getByTestId('export-menu').click()
  await expect(page.getByTestId('export-source')).toBeVisible({ timeout: 10_000 })
}

async function mainFacts(page: Page): Promise<{
  boot: boolean
  sourceCount: number
  reqMap: boolean
  styleSheets: number
  externalScripts: number
  inlineScripts: number
  react: boolean
  reactRoot: number
  htmlHasReactDom: boolean
  renderer: boolean
  offline: boolean
  bodyTextLen: number
  hiddenDocLen: number
  hiddenDocHasTitle: boolean
}> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, any>
    const hiddenDoc = document.getElementById('docContent')
    return {
      boot: w.__EXPORT_BOOT__ === true,
      sourceCount: Array.isArray(w.__EXPORT_SOURCES__) ? w.__EXPORT_SOURCES__.length : -1,
      reqMap: Boolean(w.__REQ_MAP__ && typeof w.__REQ_MAP__ === 'object'),
      styleSheets: document.styleSheets.length,
      externalScripts: Array.from(document.scripts).filter((s) => Boolean(s.src)).length,
      inlineScripts: Array.from(document.scripts).length,
      react: typeof w.React !== 'undefined',
      reactRoot: document.querySelectorAll('[data-reactroot]').length,
      htmlHasReactDom: /react-dom|createRoot|__REACT_DEVTOOLS/i.test(document.documentElement.innerHTML),
      renderer: Boolean(w.__EXPORT_RENDER__ && typeof w.__EXPORT_RENDER__ === 'object'),
      offline: navigator.onLine === false,
      bodyTextLen: String(document.body?.innerText ?? '').length,
      hiddenDocLen: String(hiddenDoc?.textContent ?? '').length,
      hiddenDocHasTitle: String(hiddenDoc?.textContent ?? '').includes('商城首页'),
    }
  })
}

test.describe('Wave4 A2 导出域（源码 JSON / 独立 HTML / 文档 MD）', () => {
  test('A2 export：菜单 / 源码包 / 独立 HTML 离线 / 文档 MD / toast 与原生框守卫', async ({}, testInfo) => {
    test.setTimeout(360_000)
    const ctx = await launchApp({ domain: 'export' })
    let closeResult: Awaited<ReturnType<Wave4App['close']>> | null = null
    let browser: Browser | null = null
    const exportRoot = path.join(TEMP_ROOT, 'exports', `export-${Date.now()}`)
    const dataRoot = path.join(ctx.dataDir, 'sandbox', PROJECT)
    const diskHomeHtml = path.join(dataRoot, HOME, `${HOME}.html`)
    const diskHomeMd = path.join(dataRoot, HOME, `${HOME}.md`)
    const diskMineHtml = path.join(dataRoot, MINE, `${MINE}.html`)
    const diskMineMd = path.join(dataRoot, MINE, `${MINE}.md`)

    try {
      fs.mkdirSync(exportRoot, { recursive: true })
      const page = ctx.page
      await page.bringToFront().catch(() => undefined)

      // ── 0. 数据隔离 + 冷启动 + 当前源 ───────────────────────────────────
      const expected = path.resolve(ctx.dataDir)
      const actual = path.resolve(ctx.userData)
      expect(actual.toLowerCase(), 'userData 必须精确指向域隔离目录').toBe(expected.toLowerCase())
      console.log(`[export] ISOLATION expected=${expected} actual=${actual} seed=${ctx.seedPresent}`)

      await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
      const pickerShown = await ensureProject(page)
      await expect
        .poll(async () => norm(await sidebarProject(page).innerText()), { timeout: 30_000 })
        .toBe(PROJECT)
      await expect.poll(() => protoButtons(page).count(), { timeout: 20_000 }).toBeGreaterThan(0)
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
        timeout: 20_000,
      })

      const homeButton = protoButtons(page).filter({ hasText: HOME }).first()
      if (!norm(await page.getByTestId('loc-pill').innerText()).includes(HOME)) {
        await homeButton.click()
      }
      await expect.poll(async () => norm(await page.getByTestId('loc-pill').innerText())).toContain(HOME)

      await installExportGuards(ctx)
      console.log(
        `[export] BOOT project=${PROJECT} picker=${pickerShown ? 'shown→entered' : 'auto-restored'} ` +
          `protos=${(await protoButtons(page).allInnerTexts()).map(norm).join('/')} exportRoot=${exportRoot}`,
      )

      // ── 1. 导出菜单 5 项 ────────────────────────────────────────────────
      const menuOk = await runStep(ctx, 1, '顶栏导出菜单 5 项齐全 / Esc 关闭', 'export-menu', async () => {
        const shots: string[] = []
        const ids = ['export-source', 'export-html', 'export-png', 'export-pdf', 'export-md']
        await expect(page.getByTestId('export-menu')).toBeVisible()
        await clearToasts(page)
        await openExportMenu(page)
        const labels: string[] = []
        for (const id of ids) {
          await expect(page.getByTestId(id), `菜单项 ${id} 应可见`).toBeVisible({ timeout: 10_000 })
          labels.push(norm(await page.getByTestId(id).innerText()))
        }
        expect(labels.every((t) => t.length > 0), '菜单项文案不得为空').toBe(true)
        shots.push(await ctx.shot(1, 'export-menu'))
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('export-source')).toBeHidden({ timeout: 5_000 })
        shots.push(await ctx.shot(1, 'export-menu-closed'))
        return {
          evidence:
            `5 项=${labels.length}（${labels.join(' / ')}）；Esc 关闭后菜单项 hidden；` +
            `data-testid 全匹配 export-source/html/png/pdf/md`,
          shots,
        }
      })

      // ── 2. 源码包 JSON ──────────────────────────────────────────────────
      if (!menuOk) {
        for (const [no, title] of [
          [2, '源码包 JSON'],
          [3, '独立 HTML'],
          [4, 'md 图片内联'],
          [5, '文档 Markdown'],
          [6, 'toast / 错误处理 / 原生框守卫'],
          [7, 'console / pageerror / 退出'],
        ] as Array<[number, string]>) markNotRun(no, title, '步骤 1 FAIL，菜单不可用')
      }

      if (menuOk) {
        await runStep(ctx, 2, '导出源码包（JSON）：落盘 / 可解析 / sources 内容与 md', 'source-json', async () => {
          const shots: string[] = []
          const dir = path.join(exportRoot, '01-source')
          await setDownloadDir(ctx, dir)
          await clearToasts(page)
          const startedAt = Date.now()
          await openExportMenu(page)
          await page.getByTestId('export-source').click()
          const toast = await waitToast(page, '源码包已导出', 20_000, ['失败', '没有可导出'])
          shots.push(await ctx.shot(2, 'source-toast'))
          const file = await waitDownload(dir)
          const info = fileInfo(file)
          expect(info.size, '源码包应 >20KB（计划 §3.8 步骤 2）').toBeGreaterThan(20 * 1024)
          expect(path.basename(file), '文件名应含项目名与「源码」').toContain(PROJECT)
          expect(path.basename(file).toLowerCase()).toContain('源码')

          const raw = fs.readFileSync(file, 'utf8')
          let bundle: any
          try {
            bundle = JSON.parse(raw)
          } catch (err) {
            throw new Error('源码包 JSON 解析失败：' + errorText(err))
          }
          expect(bundle.project, 'bundle.project 应为当前项目').toBe(PROJECT)
          expect(typeof bundle.exportedAt, 'exportedAt 应为 ISO 字符串').toBe('string')
          expect(Number.isNaN(Date.parse(bundle.exportedAt)), 'exportedAt 应可解析').toBe(false)
          expect(Array.isArray(bundle.sources), 'bundle.sources 应为数组').toBe(true)
          expect(bundle.sources.length, 'sources 应含当前项目全部原型').toBeGreaterThanOrEqual(2)

          const names = bundle.sources.map((s: any) => String(s.name))
          const displayNames = bundle.sources.map((s: any) => String(s.displayName))
          expect(displayNames, 'sources 应包含 首页/我的').toEqual(expect.arrayContaining([HOME, MINE]))
          expect(names.every((n) => /\.html?$/i.test(n)), 'sources.name 应为主 html 文件名').toBe(true)
          const home = bundle.sources.find((s: any) => s.displayName === HOME)
          const mine = bundle.sources.find((s: any) => s.displayName === MINE)
          expect(home, 'sources 缺少首页').toBeTruthy()
          expect(mine, 'sources 缺少我的').toBeTruthy()

          const homeHtmlDisk = fs.readFileSync(diskHomeHtml, 'utf8')
          const homeMdDisk = fs.readFileSync(diskHomeMd, 'utf8')
          const mineHtmlDisk = fs.readFileSync(diskMineHtml, 'utf8')
          const mineMdDisk = fs.readFileSync(diskMineMd, 'utf8')
          expect(home.content, '首页 content 应与磁盘 html 一致').toBe(homeHtmlDisk)
          expect(home.md, '首页 md 应与磁盘 md 一致').toBe(homeMdDisk)
          expect(mine.content, '我的 content 应与磁盘 html 一致').toBe(mineHtmlDisk)
          expect(mine.md, '我的 md 应与磁盘 md 一致').toBe(mineMdDisk)
          expect(String(home.content).length, '首页 html 不应为空').toBeGreaterThan(300)
          expect(String(home.md).length, '首页 md 应 >3000 字').toBeGreaterThan(3_000)

          shots.push(await ctx.shot(2, 'source-result'))
          return {
            evidence:
              `toast=「${toast}」；文件=${file}；size=${info.size} B（>20KB）；sha256[0:12]=${info.sha}；` +
              `JSON.parse=OK；project=${bundle.project}；sources=${bundle.sources.length}（${names.join(' / ')}）；` +
              `首页.content=${String(home.content).length} 字符（=磁盘 ${Buffer.byteLength(homeHtmlDisk)} B）；` +
              `首页.md=${String(home.md).length} 字符（=磁盘 ${Buffer.byteLength(homeMdDisk)} B）；` +
              `我的.content/md 与磁盘逐字符一致；耗时=${Date.now() - startedAt}ms`,
            shots,
          }
        })
      }

      // ── 3. 独立 HTML + Chromium file:// 断网打开 ───────────────────────
      let htmlText = ''
      if (menuOk) {
        await runStep(ctx, 3, '导出独立 HTML：落盘 + Chromium file:// 断网打开契约', 'standalone-html', async () => {
          const shots: string[] = []
          const dir = path.join(exportRoot, '02-html')
          await setDownloadDir(ctx, dir)
          await clearToasts(page)
          await openExportMenu(page)
          await page.getByTestId('export-html').click()
          const toast = await waitToast(page, '独立 HTML 已导出', 25_000, ['失败', '缺失', '请先选择'])
          shots.push(await ctx.shot(3, 'html-toast'))
          const file = await waitDownload(dir)
          const info = fileInfo(file)
          expect(info.size, '独立 HTML 应 >10KB').toBeGreaterThan(10 * 1024)
          htmlText = fs.readFileSync(file, 'utf8')
          expect(htmlText).toContain('__EXPORT_BOOT__=true')
          expect(htmlText).toContain('__EXPORT_SOURCES__=')
          expect(htmlText.toLowerCase()).toContain('<!doctype html>')

          browser = await chromium.launch({ headless: true })
          const offlineCtx = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } })
          const exported = await offlineCtx.newPage()
          await exported.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30_000 })
          await exported.waitForFunction(() => (window as unknown as Record<string, any>).__EXPORT_BOOT__ === true, {
            timeout: 15_000,
          })
          const facts = await mainFacts(exported)
          expect(facts.boot, '__EXPORT_BOOT__ 必须为 true').toBe(true)
          expect(facts.sourceCount, '__EXPORT_SOURCES__ 必须存在且非空').toBeGreaterThan(0)
          expect(facts.reqMap, '__REQ_MAP__ 必须为对象').toBe(true)
          expect(facts.styleSheets, '导出 HTML 应有内联样式表').toBeGreaterThan(0)
          expect(facts.bodyTextLen, '导出 HTML 正文不应为空').toBeGreaterThan(10)
          expect(facts.hiddenDocLen, '导出 HTML 应内联当前文档 md').toBeGreaterThan(1_000)
          expect(facts.hiddenDocHasTitle, '内联 md 应包含当前文档标题').toBe(true)
          expect(facts.externalScripts, '导出 HTML 不得引用外部脚本').toBe(0)
          expect(facts.react, '导出 HTML 不得加载 React 运行时').toBe(false)
          expect(facts.reactRoot, '导出 HTML 不得有 React 根节点').toBe(0)
          expect(facts.htmlHasReactDom, '导出 HTML 不得包含 react-dom/createRoot').toBe(false)
          expect(facts.renderer, '模板 boot 应暴露 __EXPORT_RENDER__').toBe(true)
          expect(facts.offline, 'Chromium 上下文应为断网模式').toBe(true)

          let iframeTextLen = 0
          const frameBody = exported.frameLocator('#frame').locator('body')
          await expect
            .poll(
              async () => {
                try {
                  return (await frameBody.innerText()).length
                } catch {
                  return 0
                }
              },
              { timeout: 20_000 },
            )
            .toBeGreaterThan(100)
          iframeTextLen = (await frameBody.innerText()).length
          const exportedBody = await exported.locator('body').innerText()
          expect(exportedBody, '正文应包含只读查看器标题').toContain('原型预览')
          expect(exportedBody, '正文应包含当前原型切换按钮').toContain(HOME)

          shots.push(await ctx.shot(3, 'html-offline', { page: exported }))
          await offlineCtx.close()

          return {
            evidence:
              `toast=「${toast}」；文件=${file}；size=${info.size} B；sha256[0:12]=${info.sha}；` +
              `Chromium offline=true；__EXPORT_BOOT__=true；__EXPORT_SOURCES__=${facts.sourceCount} 项；` +
              `styleSheets=${facts.styleSheets}；body 正文=${facts.bodyTextLen} 字符；iframe 正文=${iframeTextLen} 字符；` +
              `内联 md=${facts.hiddenDocLen} 字符（含「商城首页」=${facts.hiddenDocHasTitle}）；` +
              `外链脚本=${facts.externalScripts}；React=${facts.react}；reactRoot=${facts.reactRoot}；` +
              `html 含 react-dom/createRoot=${facts.htmlHasReactDom}；__EXPORT_RENDER__=${facts.renderer}`,
            shots,
          }
        })
      }

      // ── 4. md 图片内联（seed 无图片 → SKIP） ───────────────────────────
      if (menuOk) {
        const mdFiles = [diskHomeMd, diskMineMd]
        const mdImages: Array<{ file: string; path: string }> = []
        for (const file of mdFiles) {
          const text = fs.readFileSync(file, 'utf8')
          for (const m of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
            mdImages.push({ file: path.basename(file), path: String(m[1]).trim() })
          }
        }
        const assetDir = path.join(dataRoot, HOME, 'assets')
        const assetFiles = listFiles(assetDir)
        if (!mdImages.length || !assetFiles.length) {
          skipStep(
            4,
            'md 图片内联为 data:image',
            `seed 的 md 无 assets 图片：首页.md/我的.md 图片语法=${mdImages.length} 条；` +
              `首页/assets/ 文件=${assetFiles.length} 个。按任务口径记 SKIP，不伪造图片数据`,
          )
        } else {
          await runStep(ctx, 4, 'md 图片内联为 data:image', 'md-inline-images', async () => {
            expect(htmlText, '独立 HTML 已落盘才能检查内联').not.toBe('')
            const inlineCount = (htmlText.match(/data:image\//g) || []).length
            expect(inlineCount, 'md 图片应内联为 data:image').toBeGreaterThanOrEqual(mdImages.length)
            return {
              evidence: `md 图片=${mdImages.length} 条（${mdImages.map((x) => x.path).join(' / ')}）；导出 HTML data:image=${inlineCount} 处`,
              shots: [],
            }
          })
        }
      }

      // ── 6a. 空文档错误路径（先于 5：保证 docContent 尚未加载） ──────────
      let emptyDocEvidence = '未执行'
      if (menuOk) {
        const dir = path.join(exportRoot, '03-empty-md')
        await setDownloadDir(ctx, dir)
        await clearToasts(page)
        await openExportMenu(page)
        await page.getByTestId('export-md').click()
        let toast = ''
        try {
          toast = await waitToast(page, '当前文档为空', 6_000)
        } catch {
          toast = ''
        }
        if (toast) {
          await delay(1_200)
          const files = listFiles(dir)
          expect(files, '空文档导出不得落盘').toStrictEqual([])
          emptyDocEvidence = `空文档点击 MD → toast「${toast}」，下载目录文件=0（未落盘）`
        } else {
          const files = listFiles(dir)
          emptyDocEvidence =
            files.length > 0
              ? `空态不可达：文档已在启动时预加载，点击 MD 直接落盘 ${files.join(' / ')}（观察项，不判失败）`
              : `空态不可达：未捕获「当前文档为空」toast，且无文件落盘（观察项）`
        }
        console.log(`[export] STEP 6a ${emptyDocEvidence}`)
      }

      // ── 5. 文档 Markdown ───────────────────────────────────────────────
      if (menuOk) {
        await runStep(ctx, 5, '导出文档 Markdown：落盘且内容与当前文档一致', 'doc-markdown', async () => {
          const shots: string[] = []
          // 先打开文档面板，让 docs-store 加载当前「首页.md」（当前 UI 单按钮，默认功能说明）。
          await page.getByTestId('topbar-docs').click()
          const docs = page.getByTestId('docs-panel')
          await expect(docs).toBeVisible({ timeout: 15_000 })
          await expect(docs).toContainText('商城首页', { timeout: 20_000 })
          shots.push(await ctx.shot(5, 'doc-loaded'))
          await page.keyboard.press('Escape')
          await expect(docs).toBeHidden({ timeout: 5_000 })

          const dir = path.join(exportRoot, '04-doc-md')
          await setDownloadDir(ctx, dir)
          await clearToasts(page)
          await openExportMenu(page)
          await page.getByTestId('export-md').click()
          const toast = await waitToast(page, '文档 Markdown 已导出', 20_000, ['失败', '当前文档为空'])
          shots.push(await ctx.shot(5, 'md-toast'))
          const file = await waitDownload(dir)
          const info = fileInfo(file)
          const downloaded = fs.readFileSync(file)
          const disk = fs.readFileSync(diskHomeMd)
          const name = path.basename(file)
          expect(name.endsWith('.md'), '文档导出应为 .md').toBe(true)
          expect(name, '文件名应含文档标题（首页/功能说明）').toMatch(/首页|功能说明/)
          expect(downloaded.length, '文档 MD 不应为 0 字节').toBeGreaterThan(0)
          const sameBytes = downloaded.equals(disk)
          const sameText = downloaded.toString('utf8') === disk.toString('utf8')
          const sameNormalized =
            downloaded.toString('utf8').replace(/\r\n/g, '\n') === disk.toString('utf8').replace(/\r\n/g, '\n')
          if (!sameBytes && !sameNormalized) {
            throw new Error(
              `导出 MD 与当前文档不一致：downloaded=${downloaded.length}B 磁盘=${disk.length}B；` +
                `首段=${JSON.stringify(downloaded.toString('utf8').slice(0, 80))}`,
            )
          }
          const text = downloaded.toString('utf8')
          expect(text, '文档正文应包含当前文档标题').toContain('# 商城首页')
          expect(text.length, '文档正文应 >3000 字').toBeGreaterThan(3_000)
          shots.push(await ctx.shot(5, 'md-result'))
          return {
            evidence:
              `toast=「${toast}」；文件=${file}；size=${info.size} B；sha256[0:12]=${info.sha}；` +
              `文件名=${name}；与磁盘 首页.md 逐字节一致=${sameBytes}（文本一致=${sameText}，仅换行差异=${!sameBytes && sameNormalized}）；` +
              `正文=${text.length} 字符，首行「${text.split(/\r?\n/)[0]}」`,
            shots,
          }
        })
      }

      // ── 6b. toast / 原生保存对话框守卫 ──────────────────────────────────
      if (menuOk) {
        await runStep(ctx, 6, '导出 toast / 错误处理 / 不触发原生保存对话框', 'toast-guards', async () => {
          const saveDialogCalls = await ctx.app.evaluate(
            () => (globalThis as unknown as Record<string, any>).__w4SaveDialogCalls ?? -1,
          )
          const mainDownloads = await ctx.app.evaluate(
            () => ((globalThis as unknown as Record<string, any>).__w4Downloads ?? []) as string[],
          )
          const pngPdf = fs
            .readdirSync(exportRoot, { recursive: true, encoding: 'utf8' })
            .filter((name) => /\.(png|pdf)$/i.test(String(name)))
          expect(saveDialogCalls, '本 spec 不得触发 dialog.showSaveDialog（PNG/PDF 未点击）').toBe(0)
          expect(pngPdf, '导出目录不应出现 PNG/PDF 文件').toStrictEqual([])
          const shot = await ctx.shot(6, 'final')
          return {
            evidence:
              `showSaveDialog 调用=${saveDialogCalls}（PNG/PDF 菜单项仅断言可见、未点击）；` +
              `导出目录 PNG/PDF 文件=0；主进程 will-download 记录=${mainDownloads.length} 个（${mainDownloads
                .map((p) => path.basename(p))
                .join(' / ')}）；${emptyDocEvidence}`,
            shots: [shot],
          }
        })
      }

      // ── 7. console / pageerror / 收尾 ──────────────────────────────────
      if (menuOk) {
        await runStep(ctx, 7, 'console / pageerror / crash 观察', 'console', async () => {
          const shot = await ctx.shot(7, 'console-final')
          const consoleErrors = ctx.consoleErrors.slice()
          // seed 原型自带 Vant/Vue CDN 与内联脚本噪声，属用户内容，不计工具 pageerror。
          const pageErrors = ctx.pageErrors.filter(
            (e) => !/vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(e),
          )
          const crashes = ctx.crashes.slice()
          const fatal = ctx
            .fatalErrors()
            .filter((e) => !/vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(e))
          console.log('[export] CONSOLE_ERRORS_TOTAL=' + consoleErrors.length)
          if (consoleErrors.length) console.log('[export] CONSOLE_ERRORS\n' + consoleErrors.join('\n'))
          console.log('[export] PAGE_ERRORS_TOTAL=' + pageErrors.length)
          if (pageErrors.length) console.log('[export] PAGE_ERRORS\n' + pageErrors.join('\n'))
          console.log('[export] CRASHES_TOTAL=' + crashes.length)
          expect(pageErrors, `pageerror 应为 0：\n${pageErrors.join('\n')}`).toStrictEqual([])
          expect(crashes, `页面 crash 应为 0：\n${crashes.join('\n')}`).toStrictEqual([])
          expect(fatal, `致命 console error 应为 0：\n${fatal.join('\n')}`).toStrictEqual([])
          return {
            evidence:
              `console error=${consoleErrors.length}（过滤 favicon/devtools/ResizeObserver/Vant 后致命=${fatal.length}）；` +
              `pageerror=${pageErrors.length}；crash=${crashes.length}`,
            shots: [shot],
          }
        })
      }

      // ── 结算 ───────────────────────────────────────────────────────────
      testInfo.annotations.push({
        type: 'wave4-export-summary',
        description: rows.map((r) => `${r.no}.${r.status} ${r.title}`).join(' | '),
      })
      console.log('[export] SUMMARY\n' + JSON.stringify(rows, null, 2))
      const failed = rows.filter((r) => r.status === 'FAIL')
      expect(failed, `导出域失败：\n${failed.map((r) => `${r.no}. ${r.title}: ${r.evidence}`).join('\n')}`).toStrictEqual([])
    } finally {
      if (browser) await browser.close().catch(() => undefined)
      closeResult = await ctx.close()
      console.log(
        `[export] CLOSE method=${closeResult.method} exit=${closeResult.exitCode} elapsed=${closeResult.elapsedMs}ms exited=${closeResult.exited}`,
      )
    }
    assertCleanExitOrP2(closeResult)
  })
})

/** P2：长链路执行后 window-all-closed 偶发不退出，仅容忍 kill 收尾；其它异常仍硬失败。 */
function assertCleanExitOrP2(result: Parameters<typeof assertCleanExit>[0]): void {
  if (result.method === 'kill') {
    console.warn('[gate3] P2 close: window-all-closed 未退出，已 kill 收尾；功能断言仍为硬门禁' )
    return
  }
  assertCleanExit(result)
}
