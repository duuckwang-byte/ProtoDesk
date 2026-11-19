/**
 * e2e/wave4-b-docs.spec.ts — Wave4 B · 文档域「复测」。
  *
 * 只覆盖当前 UI 已经演进的断言（旧 B 版文档体验已漂移）：
 *   1. PC 文档面板宽 980px；目录是文档左侧独立 fixed 面板（220px，等高相邻）；
 *      窄窗按 `100vw - 18rem` 夹紧；overlay 不挤压舞台；1024 视口不越界；
 *   2. 移动端 inline 面板宽 640px；窄窗按 70% 夹紧。
  *   3. 移动端目录抽屉可过 `doc-toc-close` 关闭；Esc 只关目录、不关面板；
 *   4. 目录条目固定 24px 高，跳转后当前条 data-active=true。
  *   5. 未保存草稿守卫：切 Tab / 切原型 / 关面板 / 关独立窗都会弹 Confirm。
  *   6. Markdown 图片：data:image 与 proto-asset 真实渲染 <img>，javascript 回退 alt。
  *   7. 表格在窄面板内横向滚动（overflow-x）。
  *
 * 运行：
  *   node e2e/wave4/seed.mjs --domain b-docs-retest
 *   npx playwright test e2e/wave4-b-docs.spec.ts --workers=1 --output=test-results/wave4/retest-b-docs-shell
 *
 * 数据目录：仓库根 `.devdata-wave4-b-docs-retest`（结束后由执行者清理）。
  * 截图：`docs/wave4/shots/retest-b-docs-shell/docs-*.png`。
  *
 * 判级：P0/P1 作为 FAIL 并停止后续步骤；P2/P3 只记录。
  */
import { test, expect } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Locator, Page } from 'playwright'
import { ROOT, assertCleanExit, dataDirFor, launchApp, type CloseResult, type Wave4App } from './wave4/harness'

const DOMAIN = 'b-docs-retest'
const PROJECT = '测试1'
const HOME = '首页'
const OTHER = '我的'
const DOC_REL = path.join('sandbox', PROJECT, HOME, '首页.md')
const LATEST_REL = path.join('sandbox', PROJECT, HOME, '最新需求.md')
const OTHER_MD_REL = path.join('sandbox', PROJECT, OTHER, '我的.md')
const ASSET_REL = path.join('sandbox', PROJECT, HOME, 'assets', 'w4br.png')
const ASSET_URL = `proto-asset://local/${encodeURIComponent(PROJECT)}/${encodeURIComponent(HOME)}/assets/w4br.png`

const SHOT_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-b-docs-shell')

const PARA_MARK = 'W4BR-PARA-ALPHA'
const TABLE_CELL = 'W4BR-TABLE-CELL'
const CODE_LINE = 'W4BR-CODE-LINE'
const WIDE_MARK = 'W4BR-WIDE-CELL'
const DATA_ALT = 'W4BR-DATA-ALT'
const ASSET_ALT = 'W4BR-ASSET-ALT'
const JS_ALT = 'W4BR-JS-ALT'
const TAB_DRAFT = 'W4BR-TAB-DRAFT'
const SOURCE_DRAFT = 'W4BR-SOURCE-DRAFT'
const CLOSE_DRAFT = 'W4BR-CLOSE-DRAFT'
const WIN_DRAFT = 'W4BR-WIN-DRAFT'

const PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

type Level = 'P0' | 'P1' | 'P2' | 'P3'
type StepStatus = 'PASS' | 'FAIL' | 'SKIP'

interface StepResult {
  no: number
  slug: string
  title: string
  status: StepStatus
  level: Level | '-'
  evidence: string
  shots: string[]
  ms: number
}

interface Observation {
  id: string
  level: 'P2' | 'P3'
  text: string
  evidence: string
}

class StepError extends Error {
  level: Level
  constructor(level: Level, message: string) {
    super(message)
    this.level = level
  }
}

function norm(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sha12(file: string): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12)
  } catch {
    return 'unreadable'
  }
}

function readDoc(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
}

function relShot(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

async function waitFileContains(file: string, needle: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (readDoc(file).includes(needle)) return
    } catch {
      /* 写入失败 */
    }
    await delay(100)
  }
  throw new Error(`文件在 ${timeoutMs}ms 内未包含 ${needle}（${file}`)
}

function longSections(count: number, chars: number): string {
  const rows: string[] = []
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(3, '0')
    rows.push(
      `## W4BR 长文 ${n} 章节`,
      '',
      `W4BR-LONG-${n} 用于验证长目录 24px、滚动高亮与平滑跳转。`.padEnd(chars, '长文填充'),
      '',
    )
  }
  return rows.join('\n')
}

const WIDE_CELL_TEXT =
  '这是一段刻意拉长的单元格内容，用于验证窄文档面板下表格容器可以横向滚动，而不是把中文逐字压成竖排。'.repeat(3)

const FIXTURE = [
  '',
  '## W4BR 文档能力夹具',
  '',
  `### 段落`,
  '',
  `${PARA_MARK}：这一段用于验证目录定位、滚动高亮与草稿守卫。`,
  '',
  '### 列表与代码',
  '',
  '- W4BR-BULLET-1',
  '- W4BR-BULLET-2',
  '',
  '```ts',
  `const w4br = "${CODE_LINE}"`,
  '```',
  '',
  '### 图片',
  '',
  `图片一：![${DATA_ALT}](${PNG_URI})`,
  '',
  `图片二：![${ASSET_ALT}](${ASSET_URL})`,
  '',
  `图片三：![${JS_ALT}](javascript:alert)`,
  '',
  '### 表格',
  '',
  '| 能力 | 标记 | 备注 |',
  '| :--- | :--- | :--- |',
  `| 表格 | ${TABLE_CELL} | 单元格内不应出现原始竖线 |`,
  '',
  '### 宽表横向滚动',
  '',
  '| 宽表 | 说明 | 备注 | 扩展A | 扩展B |',
  '| :--- | :--- | :--- | :--- | :--- |',
  `| ${WIDE_MARK} | ${WIDE_CELL_TEXT} | ${WIDE_CELL_TEXT} | ${WIDE_CELL_TEXT} | ${WIDE_CELL_TEXT} |`,
  '',
  longSections(80, 90),
  '',
].join('\n')

const results: StepResult[] = []
const failures: { no: number; title: string; level: Level; message: string }[] = []
const observations: Observation[] = []
let ctx: Wave4App | null = null

function observe(id: string, level: 'P2' | 'P3', text: string, evidence: string): void {
  observations.push({ id, level, text, evidence })
  console.log(`[b-docs-retest] OBS ${id} ${level} ${text} | ${evidence}`)
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const file = path.join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path: file })
  return relShot(file)
}

test.describe('Wave4 B 文档复测（当前 UI）', () => {
  test('文档：宽屏 / 目录 / 草稿守卫 / 图片 / 表格横滚', async ({}, testInfo) => {
    test.setTimeout(720_000)

    const dataDir = dataDirFor(DOMAIN)
    const docPath = path.join(dataDir, DOC_REL)
    const latestPath = path.join(dataDir, LATEST_REL)
    const otherMdPath = path.join(dataDir, OTHER_MD_REL)
    const assetPath = path.join(dataDir, ASSET_REL)
    if (!fs.existsSync(docPath)) {
      throw new Error(`缺少 seed 文档：${docPath}；先执行 node e2e/wave4/seed.mjs --domain ${DOMAIN}`)
    }

    const seedDocBytes = fs.readFileSync(docPath)
    const seedLatestBytes = fs.readFileSync(latestPath)
    const seedOtherBytes = fs.readFileSync(otherMdPath)
    const seedHash = sha12(docPath)
    const seedLatestHash = sha12(latestPath)
    const seedOtherHash = sha12(otherMdPath)

    // 写入夹具 + proto-asset 真实图片资源（只写隔离副本）。
    fs.writeFileSync(docPath, readDoc(docPath).replace(/\s+$/, '') + '\n' + FIXTURE, 'utf8')
    fs.mkdirSync(path.dirname(assetPath), { recursive: true })
    fs.writeFileSync(assetPath, Buffer.from(PNG_URI.split(',')[1], 'base64'))
    const fixtureHash = sha12(docPath)

    let closeResult: CloseResult | null = null
    let fatal: string[] = []
    let restored = false
    let stopped = false
    let winInfo: { bounds: { x: number; y: number; width: number; height: number }; maximized: boolean; min: number[] } | null =
      null

    function panel(p: Page): Locator {
      return p.getByTestId('docs-panel')
    }
    function preview(p: Page): Locator {
      return p.getByTestId('docs-panel').getByTestId('doc-preview')
    }
    function editor(p: Page): Locator {
      return p.getByTestId('docs-panel').getByTestId('doc-editor')
    }
    function docTab(p: Page, name: '功能说明' | '最新需求'): Locator {
      return panel(p).getByRole('tab', { name, exact: true })
    }
    function confirmDlg(p: Page): Locator {
      return p.getByTestId('confirm-dialog')
    }

    async function setPc(p: Page): Promise<void> {
      const frame = p.getByTestId('stage-frame')
      if ((await frame.getAttribute('data-kind')) === 'pc') return
      await p.locator('button[title="桌面端舞台"]').evaluate((el) => (el as HTMLElement).click())
      await expect(frame).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
    }

    async function setMobile(p: Page): Promise<void> {
      const frame = p.getByTestId('stage-frame')
      if ((await frame.getAttribute('data-kind')) === 'mobile') return
      await p.locator('button[title="移动端舞台（375 逻辑宽）"]').evaluate((el) => (el as HTMLElement).click())
      await expect(frame).toHaveAttribute('data-kind', 'mobile', { timeout: 10_000 })
    }

    async function ensureSidebar(p: Page): Promise<void> {
      if (await p.getByTestId('sidebar-tree').isVisible().catch(() => false)) return
      const expand = p.getByTestId('topbar').getByRole('button', { name: '展开侧栏' })
      if (await expand.count().catch(() => 0)) await expand.first().click()
      await expect(p.getByTestId('sidebar-tree')).toBeVisible({ timeout: 15_000 })
    }

    async function collapseSidebar(p: Page): Promise<void> {
      const collapse = p.getByTestId('topbar').getByRole('button', { name: '收起侧栏' })
      if (await collapse.count().catch(() => 0)) await collapse.first().click()
      await expect(p.getByTestId('sidebar')).toHaveCount(0, { timeout: 10_000 })
    }

    async function selectProto(p: Page, name: string): Promise<void> {
      await ensureSidebar(p)
      const row = p
        .getByTestId('sidebar')
        .locator('button[data-level="proto"]')
        .filter({ hasText: name })
        .first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      await row.click()
      await expect
        .poll(async () => norm(await p.getByTestId('loc-pill').innerText()), { timeout: 20_000 })
        .toContain(name)
      await expect(p.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 15_000 })
    }

    async function enterProject(p: Page): Promise<void> {
      await p.getByTestId('main-window').waitFor({ state: 'visible', timeout: 30_000 })
      await p.waitForTimeout(1_800)
      const picker = p.getByTestId('project-picker')
      if (await picker.isVisible().catch(() => false)) {
        await picker.locator('li').filter({ hasText: PROJECT }).first().getByRole('button').first().click()
        await picker.getByRole('button', { name: '进入项目' }).click()
        await expect(picker).toBeHidden({ timeout: 30_000 })
      }
    }

    async function openDocs(p: Page): Promise<void> {
      if (!(await panel(p).isVisible().catch(() => false))) {
        await p.getByTestId('topbar-docs').click()
      }
      await expect(panel(p)).toBeVisible({ timeout: 15_000 })
      await expect
        .poll(
          async () =>
            (await p.getByTestId('doc-preview').count().catch(() => 0)) +
            (await p.getByTestId('doc-edit-area').count().catch(() => 0)),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0)
    }

    async function cancelEdit(p: Page): Promise<void> {
      if (!(await p.getByTestId('doc-edit-area').isVisible().catch(() => false))) return
      const cancel = panel(p).getByRole('button', { name: '取消', exact: true }).first()
      if (await cancel.isEnabled().catch(() => false)) await cancel.click()
      await expect(p.getByTestId('doc-edit-area')).toHaveCount(0, { timeout: 10_000 })
    }

    async function closeDocsSafe(p: Page): Promise<void> {
      for (let i = 0; i < 6; i += 1) {
        if (!(await panel(p).isVisible().catch(() => false))) return
        if (await confirmDlg(p).isVisible().catch(() => false)) {
          await confirmDlg(p).getByRole('button', { name: '继续编辑' }).click()
          await delay(120)
        }
        await cancelEdit(p)
        await p.keyboard.press('Escape')
        await delay(180)
      }
      await expect(panel(p)).toBeHidden({ timeout: 8_000 })
    }

    async function openHomeDesc(p: Page, pc: boolean): Promise<void> {
      await closeDocsSafe(p)
      if (pc) await setPc(p)
      await selectProto(p, HOME)
      if (pc) await setPc(p)
      await openDocs(p)
      await docTab(p, '功能说明').click()
      await expect
        .poll(async () => (await preview(p).innerText().catch(() => '')).includes(PARA_MARK), { timeout: 25_000 })
        .toBe(true)
      await expect
        .poll(async () => p.getByTestId('doc-toc-item').count(), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(80)
    }

    async function enterEdit(p: Page): Promise<Locator> {
      const btn = panel(p).getByRole('button', { name: '进入编辑', exact: true })
      await expect(btn).toBeVisible({ timeout: 8_000 })
      await btn.click()
      const area = p.getByTestId('doc-edit-area')
      await expect(area).toBeVisible({ timeout: 8_000 })
      return area
    }

    async function appendDraft(area: Locator, marker: string): Promise<void> {
      await area.evaluate((el, text) => {
        const node = el as HTMLElement
        node.innerText = `${node.innerText.replace(/\s+$/, '')}\n\n${text}`
        node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      }, marker)
      await expect(
        (area.page() as Page).getByTestId('doc-editor').getByText('未保存', { exact: true }),
      ).toBeVisible({ timeout: 8_000 })
    }

    async function layout(p: Page) {
      return p.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        const main = document.querySelector('main') as HTMLElement | null
        const stage = box('[data-testid="stage-frame"]')
        const viewport = box('[data-testid="stage-viewport"]')
        const viewportEl = document.querySelector('[data-testid="stage-viewport"]') as HTMLElement | null
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          mainWidth: main ? main.clientWidth : 0,
          panel: box('[data-testid="docs-panel"]'),
          toc: box('[data-testid="doc-toc-sidebar"]'),
          variant: document.querySelector('[data-testid="docs-panel"]')?.getAttribute('data-variant') ?? null,
          stage,
          viewport,
          // 移动端逻辑视口恒为 375×780；getBoundingClientRect 会乘 layoutScale，不适合断言逻辑尺寸。
          viewportLogical: viewportEl
            ? { width: Number.parseFloat(viewportEl.style.width), height: Number.parseFloat(viewportEl.style.height) }
            : null,
        }
      })
    }

    async function resizeWindow(width: number, height: number, min?: [number, number]): Promise<void> {
      await ctx!.app.evaluate(
        ({ BrowserWindow }, args) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win) throw new Error('main window missing')
          if (win.isMaximized()) win.unmaximize()
          if (args.min) win.setMinimumSize(args.min[0], args.min[1])
          win.setSize(args.width, args.height)
        },
        { width, height, min },
      )
    }

    async function restoreWindow(): Promise<void> {
      if (!winInfo) return
      await ctx!.app.evaluate(
        ({ BrowserWindow }, info) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (!win) return
          win.setMinimumSize(info.min[0] || 1024, info.min[1] || 680)
          win.setSize(info.bounds.width, info.bounds.height)
          if (info.maximized) win.maximize()
        },
        winInfo,
      )
    }

    async function runStep(
      no: number,
      slug: string,
      title: string,
      fn: () => Promise<Omit<StepResult, 'no' | 'slug' | 'title' | 'status' | 'ms'>>,
    ): Promise<void> {
      if (stopped) {
        results.push({ no, slug, title, status: 'SKIP', level: '-', evidence: '前序 P0/P1 失败，停止后续', shots: [], ms: 0 })
        return
      }
      const started = Date.now()
      try {
        const out = await fn()
        const status: StepStatus = out.level === 'P0' || out.level === 'P1' ? 'FAIL' : 'PASS'
        results.push({ no, slug, title, status, level: out.level, evidence: out.evidence, shots: out.shots, ms: Date.now() - started })
        console.log(`[b-docs-retest] STEP ${no} ${status} ${title} | ${out.evidence} | ${out.shots.join(',') || '-'} | ${Date.now() - started}ms`)
        if (status === 'FAIL') {
          failures.push({ no, title, level: out.level as Level, message: out.evidence })
          stopped = true
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        const level: Level = e instanceof StepError ? e.level : 'P1'
        let failShot = ''
        try {
          failShot = await shot(ctx!.page, `docs-${String(no).padStart(2, '0')}-${slug}-FAIL`)
        } catch {
          /* 页面可能已关闭 */
        }
        results.push({
          no,
          slug,
          title,
          status: 'FAIL',
          level,
          evidence: e.message,
          shots: failShot ? [failShot] : [],
          ms: Date.now() - started,
        })
        failures.push({ no, title, level, message: e.message })
        console.log(`[b-docs-retest] STEP ${no} FAIL ${title} | ${level} ${e.message} | ${Date.now() - started}ms`)
        stopped = true
      }
    }

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      await enterProject(page)
      await selectProto(page, HOME)
      await setPc(page)
      await ensureSidebar(page)
      console.log(
        `[b-docs-retest] dataDir=${dataDir} userData=${ctx.userData} seed=${ctx.seedPresent} fixture=${fixtureHash}`,
      )
      winInfo = await ctx.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        return {
          bounds: win.getBounds(),
          maximized: win.isMaximized(),
          min: win.getMinimumSize(),
        }
      })

      // ── 1. PC 文档宽 980 / 目录独立 220 / overlay 不挤压舞台 ─────────
      await runStep(1, 'pc-width-1200', 'PC 文档宽 980px / 目录独立 220px / overlay 不挤压舞台', async () => {
        const stageBefore = await layout(page)
        await openDocs(page)
        await expect(panel(page)).toHaveAttribute('data-variant', 'overlay')
        await expect.poll(async () => (await preview(page).innerText().catch(() => '')).length, { timeout: 25_000 }).toBeGreaterThan(3_000)
        const initial = await layout(page)
        const initialExpected = Math.min(980, initial.vw - 288)
        expect(initial.panel, 'PC 文档面板应有布局').not.toBeNull()
        expect(
          Math.abs(initial.panel!.width - initialExpected),
          `PC 面板宽 ${initial.panel!.width} ，期望 ${initialExpected}`,
        ).toBeLessThanOrEqual(1.5)
        expect(
          Math.abs((initial.stage?.width ?? 0) - (stageBefore.stage?.width ?? 0)),
          'overlay 不应挤压舞台',
        ).toBeLessThanOrEqual(1)

        // 目录：独立 fixed 面板，位于文档左侧、220px、与文档等高且不重叠。
        const tocBox = initial.toc
        expect(tocBox, 'PC 目录面板应有布局').not.toBeNull()
        expect(tocBox!.width).toBeCloseTo(220, 0)
        expect(tocBox!.height).toBeCloseTo(initial.panel!.height, 0)
        expect(tocBox!.y).toBeCloseTo(initial.panel!.y, 0)
        const tocGap = initial.panel!.x - (tocBox!.x + tocBox!.width)
        expect(tocGap, `目录与文档应左右相邻（gap=${tocGap}）`).toBeGreaterThanOrEqual(0)
        expect(tocGap).toBeLessThanOrEqual(12)
        await expect(page.getByTestId('doc-toc-toggle')).toHaveCount(0)
        await expect(page.getByRole('button', { name: '收起目录' })).toHaveCount(0)

        // 点击目录只跳转，不关闭文档。
        await expect(page.getByTestId('doc-toc-item').first()).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('doc-toc-item').nth(1).click()
        await expect(panel(page), '点击目录不应关闭文档').toBeVisible()
        await expect(confirmDlg(page)).toHaveCount(0)

        // 1024 视口：目录不出左缘、文档不出右缘，正文仍 ≥560px。
        await resizeWindow(1024, 800, [400, 400])
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBeLessThanOrEqual(1_024)
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBeGreaterThan(900)
        const compact = await layout(page)
        expect(compact.panel, '1024 视口文档面板应有布局').not.toBeNull()
        expect(compact.panel!.width).toBeCloseTo(Math.min(980, compact.vw - 288), 0)
        expect(compact.toc, '1024 视口目录面板应有布局').not.toBeNull()
        expect(compact.toc!.x, '目录不应越出屏幕左缘').toBeGreaterThanOrEqual(0)
        expect(compact.toc!.x + compact.toc!.width).toBeLessThanOrEqual(compact.panel!.x + 1)
        expect(compact.panel!.x + compact.panel!.width).toBeLessThanOrEqual(compact.vw + 1)
        const compactPreview = await preview(page).boundingBox()
        expect(compactPreview!.width, '1024 视口文档正文仍应 ≥560px').toBeGreaterThanOrEqual(560)
        await restoreWindow()
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 15_000 }).toBeGreaterThan(1_000)
        await expect
          .poll(async () => {
            const s = await layout(page)
            return Math.abs((s.panel?.width ?? 0) - Math.min(980, s.vw - 288))
          }, { timeout: 10_000 })
          .toBeLessThanOrEqual(1.5)

        // 真实 980 分支：把窗口临时放大到 1600 宽（可能超出屏幕，但 CSS 视口会真实变宽）。
        await resizeWindow(1600, 1000, [400, 400])
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBeGreaterThan(1_232)
        await expect
          .poll(async () => (await layout(page)).panel?.width ?? 0, { timeout: 10_000 })
          .toBeCloseTo(980, 0)
        const state = await layout(page)
        expect(state.panel!.width).toBeCloseTo(980, 0)
        expect(state.panel!.width).toBeLessThanOrEqual(980)
        expect(state.toc!.width).toBeCloseTo(220, 0)
        expect(state.toc!.x + state.toc!.width).toBeLessThanOrEqual(state.panel!.x + 1)

        const title = norm(await panel(page).getByTestId('docs-doc-title').innerText())
        expect(title).toContain('功能说明')
        const stats = await preview(page).evaluate((el) => ({
          h1: el.querySelectorAll('h1').length,
          h2: el.querySelectorAll('h2').length,
          tables: el.querySelectorAll('table').length,
          text: (el.innerText || '').trim(),
        }))
        expect(stats.h1).toBe(1)
        expect(stats.h2).toBeGreaterThanOrEqual(80)
        expect(stats.tables).toBeGreaterThanOrEqual(6)
        expect(stats.text).not.toContain('| :--- |')
        expect(stats.text).not.toContain('```')

        const file = await shot(page, 'docs-01-pc-1200')
        await restoreWindow()
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 15_000 }).toBeLessThan(1_400)
        return {
          level: '-',
          evidence: `variant=overlay；初始 vw=${initial.vw}，panel=${initial.panel!.width.toFixed(1)}（期望 ${initialExpected.toFixed(1)}），toc=${tocBox!.width.toFixed(1)}（gap=${tocGap.toFixed(1)}，等高=${tocBox!.height.toFixed(1)}）；1024 视口 panel=${compact.panel!.width.toFixed(1)}、tocLeft=${compact.toc!.x.toFixed(1)}、正文宽=${compactPreview!.width.toFixed(1)}；放大后 vw=${state.vw}，panel=${state.panel!.width.toFixed(1)}px（真实 980 分支）；无收起按钮；点击目录后文档仍打开；舞台宽 ${stageBefore.stage?.width.toFixed(1)}→${initial.stage?.width.toFixed(1)}（打开面板前后）；标题=${title}；h1=${stats.h1}、h2=${stats.h2}、表格 ${stats.tables}`,
          shots: [file],
        }
      })

      // ── 2. 窄窗 clamp ───────────────────────────────────────────────
      await runStep(2, 'pc-narrow-clamp', 'PC 窄窗宽度夹紧（100vw - 18rem）', async () => {
        await resizeWindow(800, 800, [400, 400])
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBeLessThan(900)
        await expect
          .poll(
            async () => {
              const s = await layout(page)
              return Math.abs((s.panel?.width ?? 0) - Math.min(980, s.vw - 288))
            },
            { timeout: 10_000 },
          )
          .toBeLessThanOrEqual(1.5)
        const narrow = await layout(page)
        expect(narrow.vw).toBeLessThan(900)
        expect(narrow.panel!.width).toBeLessThan(980)
        expect(narrow.panel!.width).toBeGreaterThan(400)
        expect(narrow.toc).not.toBeNull()
        expect(narrow.toc!.x).toBeGreaterThanOrEqual(0)
        expect(narrow.toc!.x + narrow.toc!.width).toBeLessThanOrEqual(narrow.panel!.x + 1)
        const file = await shot(page, 'docs-02-pc-narrow')
        await restoreWindow()
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 15_000 }).toBeGreaterThan(1_000)
        await expect
          .poll(async () => {
            const s = await layout(page)
            return Math.abs((s.panel?.width ?? 0) - Math.min(980, s.vw - 288))
          }, { timeout: 10_000 })
          .toBeLessThanOrEqual(1.5)
        return {
          level: '-',
          evidence: `窄窗 vw=${narrow.vw}，panel=${narrow.panel!.width.toFixed(1)}≈ vw-288，≤980），tocLeft=${narrow.toc!.x.toFixed(1)}、tocWidth=${narrow.toc!.width.toFixed(1)}；恢复 vw=${(await layout(page)).vw}，panel=${(await layout(page)).panel?.width.toFixed(1)}`,
          shots: [file],
        }
      })

      // ── 3. 移动端 640 / 窄窗 70% ────────────────────────────────────
      await runStep(3, 'mobile-width', '移动端 inline 宽 640px / 窄窗 70%', async () => {
        await closeDocsSafe(page)
        await setMobile(page)
        await collapseSidebar(page)
        await openDocs(page)
        await expect(panel(page)).toHaveAttribute('data-variant', 'inline', { timeout: 10_000 })
        await expect
          .poll(
            async () => {
              const s = await layout(page)
              return Math.abs((s.panel?.width ?? 0) - Math.min(640, s.mainWidth * 0.7))
            },
            { timeout: 10_000 },
          )
          .toBeLessThanOrEqual(1.5)
        const wide = await layout(page)
        expect(wide.panel!.width).toBeCloseTo(Math.min(640, wide.mainWidth * 0.7), 0)
        const viewportWide = wide.viewportLogical
        expect(Math.round(viewportWide?.width ?? 0)).toBe(375)
        // W5 动态视口高：视口高随可用区变化（不再固定 780），只断言正值。
        expect(Number.parseFloat(String(viewportWide?.height ?? 0))).toBeGreaterThan(300)
        const fileWide = await shot(page, 'docs-03-mobile-640')

        await resizeWindow(800, 800, [400, 400])
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBeLessThan(900)
        await expect
          .poll(
            async () => {
              const s = await layout(page)
              return Math.abs((s.panel?.width ?? 0) - s.mainWidth * 0.7)
            },
            { timeout: 10_000 },
          )
          .toBeLessThanOrEqual(1.5)
        const narrow = await layout(page)
        expect(narrow.panel!.width).toBeLessThan(640)
        expect(narrow.panel!.width / narrow.mainWidth).toBeCloseTo(0.7, 2)
        const fileNarrow = await shot(page, 'docs-03-mobile-70pct')
        await restoreWindow()
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 15_000 }).toBeGreaterThan(1_000)
        await expect.poll(async () => (await layout(page)).panel?.width ?? 0, { timeout: 10_000 }).toBeCloseTo(640, 0)
        return {
          level: '-',
          evidence: `宽窗 main=${wide.mainWidth}，panel=${wide.panel!.width.toFixed(1)}（min(640,70%)=${Math.min(640, wide.mainWidth * 0.7).toFixed(1)}），stage 逻辑视口=${Math.round(viewportWide?.width ?? 0)}×${Math.round(viewportWide?.height ?? 0)}；窄窗 main=${narrow.mainWidth}，panel=${narrow.panel!.width.toFixed(1)}%（${((narrow.panel!.width / narrow.mainWidth) * 100).toFixed(1)}%）；恢复到 640`,
          shots: [fileWide, fileNarrow],
        }
      })

      // ── 4. 移动端目录：close 按钮 / Esc 只关目录 / 24px / 高亮 ──────
      await runStep(4, 'mobile-toc', '移动端目录：doc-toc-close / Esc 只关目录 / 24px / 高亮', async () => {
        const drawerBtn = panel(page).getByRole('button', { name: '目录', exact: true }).first()
        await drawerBtn.click()
        const drawer = panel(page).getByTestId('doc-toc-drawer')
        await expect(drawer).toHaveAttribute('data-open', 'true')
        const closeBtn = drawer.getByTestId('doc-toc-close')
        await expect(closeBtn).toBeVisible({ timeout: 5_000 })
        await closeBtn.click()
        await expect(drawer).toHaveAttribute('data-open', 'false')
        await expect(panel(page)).toBeVisible()
        await delay(350)
        const closedGeom = await page.evaluate(() => {
          const drawerEl = document.querySelector('[data-testid="doc-toc-drawer"]') as HTMLElement | null
          const panelEl = document.querySelector('[data-testid="docs-panel"]') as HTMLElement | null
          if (!drawerEl || !panelEl) return null
          const d = drawerEl.getBoundingClientRect()
          const p = panelEl.getBoundingClientRect()
          const style = getComputedStyle(drawerEl)
          const hitX = (Math.max(d.x, 0) + Math.min(d.right, p.x)) / 2
          const hitY = d.y + Math.min(d.height / 2, 120)
          const hit = document.elementFromPoint(hitX, hitY)
          return {
            drawer: { x: d.x, right: d.right, width: d.width },
            panel: { x: p.x, right: p.right, width: p.width },
            outsidePanel: Math.max(0, Math.min(d.right, p.x) - Math.max(d.x, 0)),
            pointerEvents: style.pointerEvents,
            opacity: style.opacity,
            visuallyHit: !!(hit && drawerEl.contains(hit)),
          }
        })
        // 关闭态必须真正不可见：opacity=0 + pointer-events=none + 面板外命中测试不落在抽屉上。
        expect(closedGeom?.opacity, '关闭后目录抽屉应透明').toBe('0')
        expect(closedGeom?.pointerEvents, '关闭后目录抽屉不应接收指针').toBe('none')
        expect(closedGeom?.visuallyHit, '关闭后目录抽屉不得在面板外可命中').toBe(false)
        if (closedGeom && closedGeom.outsidePanel > 8 && closedGeom.opacity !== '0') {
          const leakShot = await shot(page, 'docs-04-mobile-toc-closed-leak')
          observe(
            'b-docs-retest-P2-toc-drawer-leak',
            'P2',
            '移动端目录关闭后仍可见：抽屉滑出面板左缘但面板未裁剪，目录浮在舞台上。',
            `data-open=false / pointer-events=none 已生效，但视觉上没有消失；drawerRight=${closedGeom.drawer.right.toFixed(1)}，panelLeft=${closedGeom.panel.x.toFixed(1)}，落在舞台侧的可见宽=${closedGeom.outsidePanel.toFixed(1)}px，pointerEvents=${closedGeom.pointerEvents}，截图 ${leakShot}`,
          )
        }

        await drawerBtn.click()
        await expect(drawer).toHaveAttribute('data-open', 'true')
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveAttribute('data-open', 'false', { timeout: 5_000 })
        await expect(panel(page), 'Esc 只关目录，文档面板必须保留').toBeVisible()
        await expect(confirmDlg(page)).toHaveCount(0)

        await drawerBtn.click()
        await expect(drawer).toHaveAttribute('data-open', 'true')
        const firstBox = await drawer.getByTestId('doc-toc-item').first().boundingBox()
        const itemHeight = Math.round(firstBox?.height ?? 0)
        expect(itemHeight, '目录条目应为 24px').toBe(24)
        // 选中间条目：长文末尾的标题无法滚到容器顶部，用最后一条会把“高亮当前项”变成不可判定。
        const target = drawer.getByTestId('doc-toc-item').nth(40)
        const targetId = await target.getAttribute('data-toc-id')
        const targetText = norm(await target.innerText())
        expect(targetId).toBeTruthy()
        const before = await preview(page).evaluate((el) => (el as HTMLElement).scrollTop)
        await target.click()
        await expect(drawer).toHaveAttribute('data-open', 'false', { timeout: 5_000 })
        await expect
          .poll(async () => preview(page).evaluate((el) => (el as HTMLElement).scrollTop), { timeout: 12_000 })
          .toBeGreaterThan(before + 1_000)
        await delay(900)
        const jumpState = await page.evaluate((args) => {
          const scroller = document.querySelector('[data-testid="doc-preview"]') as HTMLElement | null
          const items = Array.from(document.querySelectorAll('[data-testid="doc-toc-item"]')) as HTMLElement[]
          const heading = Array.from(document.querySelectorAll('[data-testid="doc-preview"] [data-toc-id]')).find(
            (node) => node.getAttribute('data-toc-id') === args.targetId,
          ) as HTMLElement | undefined
          return {
            scrollTop: scroller?.scrollTop ?? -1,
            scrollerTop: scroller ? Math.round(scroller.getBoundingClientRect().top) : -1,
            active: items.filter((el) => el.getAttribute('data-active') === 'true').map((el) => el.getAttribute('data-toc-id')),
            targetHeadingTop: heading ? Math.round(heading.getBoundingClientRect().top) : -1,
          }
        }, { targetId })
        console.log('[b-docs-retest] TOC_JUMP ' + JSON.stringify({ ...jumpState, targetId, targetText }))
        if (jumpState.active[0] !== targetId) {
          observe(
            'b-docs-retest-P2-toc-active-edge',
            'P2',
            '目录跳转后高亮可能停在目标上一条（目标标题落在容器顶 +8px 的判定边界）',
            `点击「${targetText}」后 scrollTop=${Math.round(jumpState.scrollTop)}，目标标题 top=${jumpState.targetHeadingTop}、容器 top=${jumpState.scrollerTop}（差值 ${jumpState.targetHeadingTop - jumpState.scrollerTop}），active=${jumpState.active.join(',') || '(none)'}`,
          )
        }
        // 再滚 24px，确认滚动高亮能正确切到目标（而不是完全没有高亮）。
        await preview(page).evaluate((el) => ((el as HTMLElement).scrollTop += 24))
        await delay(250)
        await expect
          .poll(async () => panel(page).locator(`[data-testid="doc-toc-item"][data-active="true"][data-toc-id="${targetId}"]`).count(), {
            timeout: 10_000,
          })
          .toBe(1)
        const activeCount = await panel(page).locator('[data-testid="doc-toc-item"][data-active="true"]').count()
        expect(activeCount).toBe(1)
        const file = await shot(page, 'docs-04-mobile-toc')
        return {
          level: '-',
          evidence: `doc-toc-close 可关（data-open true→false）；再开后 Esc 只关目录、面板保留且无 Confirm；条目高=${itemHeight}px；点击第 41 条后 scrollTop ${Math.round(before)}→${Math.round(await preview(page).evaluate((el) => (el as HTMLElement).scrollTop))}，高亮 count=${activeCount} 且目标 ${targetId}`,
          shots: [file],
        }
      })

      // ── 5. 切 Tab 草稿 Confirm ──────────────────────────────────────
      await runStep(5, 'tab-guard', '切 Tab 有草稿 → Confirm', async () => {
        await expect(docTab(page, '功能说明')).toHaveAttribute('aria-selected', 'true')
        const area = await enterEdit(page)
        await appendDraft(area, TAB_DRAFT)
        await docTab(page, '最新需求').click()
        await expect(confirmDlg(page)).toBeVisible({ timeout: 8_000 })
        await expect(confirmDlg(page)).toContainText('未保存的草稿')
        await expect(confirmDlg(page)).toContainText('最新需求')
        const file = await shot(page, 'docs-05-tab-guard')

        await confirmDlg(page).getByRole('button', { name: '继续编辑' }).click()
        await expect(confirmDlg(page)).toBeHidden({ timeout: 5_000 })
        await expect(docTab(page, '功能说明')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByTestId('doc-edit-area')).toBeVisible()
        expect(await page.getByTestId('doc-edit-area').innerText()).toContain(TAB_DRAFT)

        await docTab(page, '最新需求').click()
        await expect(confirmDlg(page)).toBeVisible({ timeout: 8_000 })
        await confirmDlg(page).getByRole('button', { name: '放弃修改' }).click()
        await expect(confirmDlg(page)).toBeHidden({ timeout: 8_000 })
        await expect(docTab(page, '最新需求')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByTestId('doc-edit-area')).toHaveCount(0)
        await expect.poll(async () => (await preview(page).innerText()).includes('11121321'), { timeout: 20_000 }).toBe(true)
        await docTab(page, '功能说明').click()
        await expect.poll(async () => (await preview(page).innerText()).includes(PARA_MARK), { timeout: 20_000 }).toBe(true)
        return {
          level: '-',
          evidence: `脏草稿点「最新需求」→ Confirm（标题 文案含切 Tab），继续编辑保留编辑态与草稿；再次切换并放弃后 Tab 切到最新需求、编辑区卸载、正文 11121321；切回功能说明正常`,
          shots: [file],
        }
      })

      // ── 6. 切原型草稿 Confirm ──────────────────────────────────────
      await runStep(6, 'source-guard', '切原型有草稿 → Confirm', async () => {
        await setMobile(page)
        await ensureSidebar(page)
        const area = await enterEdit(page)
        await appendDraft(area, SOURCE_DRAFT)
        const otherRow = page
          .getByTestId('sidebar')
          .locator('button[data-level="proto"]')
          .filter({ hasText: OTHER })
          .first()
        await expect(otherRow).toBeVisible({ timeout: 10_000 })
        await otherRow.click()
        await expect(confirmDlg(page)).toBeVisible({ timeout: 10_000 })
        await expect(confirmDlg(page)).toContainText('未保存的草稿')
        await expect(confirmDlg(page)).toContainText(`已切换到「${OTHER}」`)
        await expect(confirmDlg(page)).toContainText(`你在「${HOME}」的修改尚未保存`)
        await expect(panel(page)).toBeVisible()
        const guardText = norm(await confirmDlg(page).innerText())
        const file = await shot(page, 'docs-06-source-guard')
        if (!guardText.includes(`已切换到「${OTHER}」`) || guardText.includes(`已切换到「${HOME}」`)) {
          observe(
            'b-docs-retest-P2-source-guard-wording',
            'P2',
            '切原型守卫文案未指向刚切到的目标原型「我的」',
            '用户从 首页 切到 我的 时，Confirm 应显示「已切换到「我的」」，否则容易被理解为切换失败/回到首页',
            `confirm=${guardText}`,
          )
        }

        await confirmDlg(page).getByRole('button', { name: '放弃修改' }).click()
        await expect(confirmDlg(page)).toBeHidden({ timeout: 8_000 })
        await expect(docTab(page, '功能说明')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByTestId('doc-edit-area')).toHaveCount(0, { timeout: 10_000 })
        await expect
          .poll(async () => norm(await preview(page).innerText()), { timeout: 20_000 })
          .toContain(OTHER)
        await expect.poll(async () => (await preview(page).innerText()).includes(SOURCE_DRAFT), { timeout: 5_000 }).toBe(false)
        expect(readDoc(docPath), '未确认的旧草稿不应写入磁盘').not.toContain(SOURCE_DRAFT)

        await selectProto(page, HOME)
        await expect
          .poll(async () => (await preview(page).innerText()).includes(PARA_MARK), { timeout: 25_000 })
          .toBe(true)
        const backArea = await enterEdit(page)
        expect(await backArea.innerText(), '放弃后切回原原型不应恢复旧草稿').not.toContain(SOURCE_DRAFT)
        await cancelEdit(page)
        return {
          level: '-',
          evidence: `编辑中点击「我的」→ Confirm 文案含「已切换到「我的」」与「你在「首页」的修改尚未保存」，面板保留；放弃后编辑区卸载、正文切到我的、旧草稿未写入 首页.md；切回首页编辑区不含 ${SOURCE_DRAFT}；confirm=${guardText}`,
          shots: [file],
        }
      })

      // ── 7. 关面板草稿 Confirm ──────────────────────────────────────
      await runStep(7, 'close-panel-guard', '关面板有草稿 → Confirm', async () => {
        const area = await enterEdit(page)
        await appendDraft(area, CLOSE_DRAFT)
        await page.keyboard.press('Escape')
        await expect(confirmDlg(page)).toBeVisible({ timeout: 10_000 })
        await expect(confirmDlg(page)).toContainText('未保存的草稿')
        await expect(confirmDlg(page)).toContainText('关闭文档面板')
        await expect(panel(page), 'Confirm 期间面板必须保留').toBeVisible()
        const file = await shot(page, 'docs-07-close-panel-guard')

        await confirmDlg(page).getByRole('button', { name: '继续编辑' }).click()
        await expect(confirmDlg(page)).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('doc-edit-area')).toBeVisible()
        expect(await page.getByTestId('doc-edit-area').innerText()).toContain(CLOSE_DRAFT)

        await page.keyboard.press('Escape')
        await expect(confirmDlg(page)).toBeVisible({ timeout: 10_000 })
        await confirmDlg(page).getByRole('button', { name: '放弃修改' }).click()
        await expect(panel(page)).toBeHidden({ timeout: 10_000 })
        await expect(confirmDlg(page)).toHaveCount(0)

        await openDocs(page)
        await expect(page.getByTestId('doc-edit-area')).toHaveCount(0)
        await expect.poll(async () => (await preview(page).innerText()).includes(CLOSE_DRAFT), { timeout: 8_000 }).toBe(false)
        expect(readDoc(docPath)).not.toContain(CLOSE_DRAFT)
        return {
          level: '-',
          evidence: `Esc 关面板被拦下：Confirm 文案含「关闭文档面板」，面板保留；继续编辑保留草稿；再次 Esc 并放弃 → 面板关闭；重开无编辑区、正文与磁盘均无 ${CLOSE_DRAFT}`,
          shots: [file],
        }
      })

      // ── 8. 独立窗草稿 Confirm ──────────────────────────────────────
      await runStep(8, 'docwin-guard', '关独立文档窗有草稿 → Confirm', async () => {
        const winPromise = ctx!.app.waitForEvent('window', { timeout: 25_000 })
        await panel(page).getByRole('button', { name: '在独立窗口打开文档' }).click()
        const docPage = await winPromise
        await docPage.getByTestId('doc-window').waitFor({ state: 'visible', timeout: 25_000 })
        await expect(panel(page)).toBeHidden({ timeout: 10_000 })
        await expect.poll(async () => (await docPage.getByTestId('doc-preview').innerText().catch(() => '')).length, { timeout: 30_000 }).toBeGreaterThan(2_000)

        // 独立窗：不套 overlay，目录与正文左右 flex，目录常驻 220px 且不遮挡。
        await expect(docPage.getByTestId('docs-overlay')).toHaveCount(0)
        const winToc = docPage.getByTestId('doc-toc-sidebar')
        await expect(winToc).toBeVisible({ timeout: 10_000 })
        await expect(docPage.getByTestId('doc-toc-toggle')).toHaveCount(0)
        await expect(docPage.getByRole('button', { name: '收起目录' })).toHaveCount(0)
        const winTocBox = await winToc.boundingBox()
        const winPreviewBox = await docPage.getByTestId('doc-preview').boundingBox()
        expect(winTocBox!.width, '独立窗目录应常驻 220px').toBeCloseTo(220, 0)
        expect(winTocBox!.x + winTocBox!.width, '目录不应遮挡正文').toBeLessThanOrEqual(winPreviewBox!.x + 1)

        const editBtn = docPage.getByRole('button', { name: '进入编辑', exact: true })
        await expect(editBtn).toBeVisible({ timeout: 10_000 })
        await editBtn.click()
        const area = docPage.getByTestId('doc-edit-area')
        await expect(area).toBeVisible({ timeout: 8_000 })
        await appendDraft(area, WIN_DRAFT)

        await docPage.keyboard.press('Escape')
        await expect(docPage.getByTestId('confirm-dialog')).toBeVisible({ timeout: 10_000 })
        await expect(docPage.getByTestId('confirm-dialog')).toContainText('关闭独立文档窗口')
        await delay(900)
        expect(docPage.isClosed(), '有草稿时 Esc 不应直接关闭独立窗').toBe(false)
        const file = await shot(docPage, 'docs-08-docwin-guard')

        await docPage.getByTestId('confirm-dialog').getByRole('button', { name: '放弃修改' }).click()
        await expect.poll(() => docPage.isClosed(), { timeout: 15_000 }).toBe(true)
        await expect(panel(page)).toBeHidden({ timeout: 8_000 })
        expect(readDoc(docPath), '独立窗未保存草稿不应落盘').not.toContain(WIN_DRAFT)

        await openDocs(page)
        await expect.poll(async () => (await preview(page).innerText()).includes(WIN_DRAFT), { timeout: 8_000 }).toBe(false)
        await expect(page.getByTestId('doc-edit-area')).toHaveCount(0)
        return {
          level: '-',
          evidence: `独立窗编辑后按 Esc：窗口保持打开，Confirm 文案含「关闭独立文档窗口」；点击放弃后窗口才关闭、主窗面板保持关闭，主窗正文与磁盘均无 ${WIN_DRAFT}`,
          shots: [file],
        }
      })

      // ── 9. 图片 data / proto-asset ──────────────────────────────────
      await runStep(9, 'images', '图片 data:image 与 proto-asset 真实渲染', async () => {
        await openHomeDesc(page, true)
        const dataImg = preview(page).locator(`img[alt="${DATA_ALT}"]`)
        const assetImg = preview(page).locator(`img[alt="${ASSET_ALT}"]`)
        await expect(dataImg).toHaveCount(1)
        await expect(assetImg).toHaveCount(1)
        // 图片带 loading="lazy"，夹具在长文末尾；先滚到图片位置再等真实解码。
        await dataImg.scrollIntoViewIfNeeded()
        await assetImg.scrollIntoViewIfNeeded()
        await expect
          .poll(async () => dataImg.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 8_000 })
          .toBeGreaterThan(0)
        await expect
          .poll(async () => assetImg.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 8_000 })
          .toBeGreaterThan(0)
        expect(await dataImg.getAttribute('src'), 'data:image 应保留').toMatch(/^data:image\/png/)
        expect(await assetImg.getAttribute('src')).toBe(ASSET_URL)
        await expect(preview(page).locator('img[src^="javascript"]')).toHaveCount(0)
        await expect(preview(page).getByText(JS_ALT, { exact: false })).toHaveCount(1)
        const file = await shot(page, 'docs-09-images')
        const natural = await assetImg.evaluate((el) => ({
          w: (el as HTMLImageElement).naturalWidth,
          h: (el as HTMLImageElement).naturalHeight,
        }))
        return {
          level: '-',
          evidence: `data:image img=1 且 naturalWidth>0；proto-asset img=1（natural ${natural.w}×${natural.h}，src=${ASSET_URL}）；javascript 图片无 <img>、回退 alt=${JS_ALT}`,
          shots: [file],
        }
      })

      // ── 10. 表格横向滚动 ───────────────────────────────────────────
      await runStep(10, 'table-scroll', '窄面板表格横向滚动', async () => {
        await setMobile(page)
        await openDocs(page)
        await expect(panel(page)).toHaveAttribute('data-variant', 'inline')
        const table = preview(page).locator('table').filter({ hasText: WIDE_MARK }).first()
        await expect(table).toBeVisible({ timeout: 10_000 })
        const wrapper = table.locator('xpath=..')
        const info = await wrapper.evaluate((el) => {
          const node = el as HTMLElement
          const cs = getComputedStyle(node)
          return {
            overflowX: cs.overflowX,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            scrollLeft: node.scrollLeft,
          }
        })
        expect(info.overflowX).toMatch(/auto|scroll/)
        expect(info.scrollWidth, `表格容器 ${info.scrollWidth}/${info.clientWidth} 应可横向滚动`).toBeGreaterThan(
          info.clientWidth + 20,
        )
        await wrapper.evaluate((el) => ((el as HTMLElement).scrollLeft = 140))
        await delay(150)
        expect(await wrapper.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeGreaterThan(100)
        const file = await shot(page, 'docs-10-table-scroll')
        await setPc(page)
        return {
          level: '-',
          evidence: `inline 面板下宽表容器 overflow-x=${info.overflowX}，scrollWidth=${info.scrollWidth} > clientWidth=${info.clientWidth}，scrollLeft 可设为 140`,
          shots: [file],
        }
      })

      const rawFatal = ctx.fatalErrors()
      fatal = rawFatal.filter((text) => !/cdn\.jsdelivr\.net|vant@4|Unexpected token '\.'/i.test(text))
      console.log(`[b-docs-retest] FATAL_CONSOLE=${fatal.length} RAW_FATAL=${rawFatal.length}`)
      if (rawFatal.length !== fatal.length) console.log('[b-docs-retest] THIRD_PARTY_NOISE\n' + rawFatal.filter((t) => !fatal.includes(t)).join('\n'))
      closeResult = await ctx.close()
      console.log(`[b-docs-retest] close method=${closeResult.method} exit=${closeResult.exitCode} elapsed=${closeResult.elapsedMs}ms`)
    } finally {
      if (ctx) {
        try {
          if (await ctx.page.getByTestId('confirm-dialog').isVisible().catch(() => false)) {
            await ctx.page.getByTestId('confirm-dialog').getByRole('button', { name: '继续编辑' }).click().catch(() => undefined)
          }
          await ctx.page.keyboard.press('Escape').catch(() => undefined)
        } catch {
          /* 页面可能已关闭 */
        }
      }
      try {
        fs.writeFileSync(docPath, seedDocBytes)
        fs.writeFileSync(latestPath, seedLatestBytes)
        fs.writeFileSync(otherMdPath, seedOtherBytes)
        fs.rmSync(assetPath, { force: true })
        restored = true
      } catch (err) {
        console.log(`[b-docs-retest] restore failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (ctx && !closeResult) {
        try {
          closeResult = await ctx.close({ graceMs: 8_000, appCloseMs: 5_000 })
        } catch (err) {
          console.log(`[b-docs-retest] forced close failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      testInfo.annotations.push({
        type: 'wave4-b-docs-retest-summary',
        description: results
          .map((r) => `${r.no}.${r.status}[${r.level}] ${r.title}${r.shots.length ? ` [${r.shots.join('; ')}]` : ''}`)
          .join(' | '),
      })
      testInfo.annotations.push({
        type: 'wave4-b-docs-retest-observations',
        description: observations.map((o) => `${o.id} ${o.level} ${o.text}`).join(' | ') || '(none)',
      })
    }

    assertCleanExitOrP2(closeResult as CloseResult)
    expect(restored, 'seed 文档应已还原').toBe(true)
    expect(sha12(docPath), '首页.md 应还原到 seed hash').toBe(seedHash)
    expect(sha12(latestPath), '最新需求.md 应还原到 seed hash').toBe(seedLatestHash)
    expect(sha12(otherMdPath), '我的.md 应还原到 seed hash').toBe(seedOtherHash)
    expect(fatal, `致命 console/page error：\n${fatal.join('\n')}`).toStrictEqual([])
    expect(failures, `文档复测失败：\n${failures.map((f) => `${f.no}. [${f.level}] ${f.title}: ${f.message}`).join('\n')}`).toStrictEqual([])
    console.log(`[b-docs-retest] RESULTS ${JSON.stringify(results, null, 2)}`)
    console.log(`[b-docs-retest] OBSERVATIONS ${JSON.stringify(observations, null, 2)}`)
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
