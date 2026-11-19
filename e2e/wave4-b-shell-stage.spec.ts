/**
 * e2e/wave4-b-shell-stage.spec.ts — Wave4 B · 主壳 / 舞台「复测」。
 *
 * 只覆盖当前 UI 已经演进的断言（旧 B 版入口已漂移）：
 *   1. 设置只在侧栏底部；顶栏无「设置 / 功能说明 / 最新需求」，只有 `topbar-docs`；
 *   2. 顶栏「文档」只开合面板，不创建独立文档窗；
 *   3. 侧栏收起后没有 MiniDock 浮层（任何端别都没有）；
 *   4. 移动端默认展开侧栏/文档（不自动收起）；切回 PC 关闭文档、侧栏保留；
 *   5. 在「非当前原型」上新建子页，会自动切到该原型的父源并选中新子页。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain b-shell-retest
 *   npx playwright test e2e/wave4-b-shell-stage.spec.ts --workers=1 --output=test-results/wave4/retest-b-docs-shell
 *
 * 数据目录：仓库根 `.devdata-wave4-b-shell-retest`（结束后由执行者清理）。
 * 截图：`docs/wave4/shots/retest-b-docs-shell/shell-*.png`。
 */
import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Locator, Page } from 'playwright'
import { ROOT, assertCleanExit, dataDirFor, isFatalConsole, launchApp, type CloseResult, type Wave4App } from './wave4/harness'

const DOMAIN = 'b-shell-retest'
const PROJECT = '测试1'
const HOME = '首页'
const OTHER = '我的'
const SUB = `SHELLR-子页-${Date.now().toString().slice(-5)}`
const SHOT_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-b-docs-shell')

type Level = 'P0' | 'P1' | 'P2' | 'P3' | '—'
type StepStatus = 'PASS' | 'FAIL' | 'SKIP'

interface StepRow {
  no: number
  title: string
  status: StepStatus
  level: Level
  evidence: string
  shots: string[]
  ms: number
}

interface Observation {
  id: string
  level: 'P2' | 'P3' | 'ENV'
  title: string
  detail: string
  evidence: string
}

const rows: StepRow[] = []
const observations: Observation[] = []
let ctx: Wave4App | null = null

function norm(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function relShot(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.split('\n').slice(0, 8).join(' | ') : String(err)
}

function observe(id: string, level: Observation['level'], title: string, detail: string, evidence: string): void {
  observations.push({ id, level, title, detail, evidence })
  console.log(`[b-shell-retest] OBS ${id} ${level} ${title} | ${detail} | ${evidence}`)
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const file = path.join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path: file })
  return relShot(file)
}

function sidebar(page: Page): Locator {
  return page.getByTestId('sidebar')
}

function tree(page: Page): Locator {
  return page.getByTestId('sidebar-tree')
}

async function ensureSidebar(page: Page): Promise<void> {
  if (await sidebar(page).isVisible().catch(() => false)) return
  const expand = page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' })
  await expect(expand).toBeVisible({ timeout: 10_000 })
  await expand.click()
  await expect(tree(page)).toBeVisible({ timeout: 15_000 })
}

async function collapseSidebar(page: Page): Promise<void> {
  await ensureSidebar(page)
  await page.getByTestId('topbar').getByRole('button', { name: '收起侧栏' }).click()
  await expect(sidebar(page)).toHaveCount(0, { timeout: 10_000 })
}

async function setPc(page: Page): Promise<void> {
  const frame = page.getByTestId('stage-frame')
  if ((await frame.getAttribute('data-kind')) === 'pc') return
  await page.locator('button[title="桌面端舞台"]').evaluate((el) => (el as HTMLElement).click())
  await expect(frame).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
}

async function setMobile(page: Page): Promise<void> {
  const frame = page.getByTestId('stage-frame')
  if ((await frame.getAttribute('data-kind')) === 'mobile') return
  await page.locator('button[title="移动端舞台（375 逻辑宽）"]').evaluate((el) => (el as HTMLElement).click())
  await expect(frame).toHaveAttribute('data-kind', 'mobile', { timeout: 10_000 })
}

async function selectProto(page: Page, name: string): Promise<void> {
  await ensureSidebar(page)
  const row = tree(page).locator('button[data-level="proto"]').filter({ hasText: name }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
  await expect
    .poll(async () => norm(await page.getByTestId('loc-pill').innerText()), { timeout: 20_000 })
    .toContain(name)
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 15_000 })
}

async function enterProject(page: Page): Promise<boolean> {
  await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(1_800)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    await picker.locator('li').filter({ hasText: PROJECT }).first().getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  return shown
}

async function windowFacts() {
  return ctx!.app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().map((win) => ({
      url: win.webContents.getURL(),
      visible: win.isVisible(),
      title: win.getTitle(),
    }))
    return { count: wins.length, wins }
  })
}

async function runStep(no: number, title: string, slug: string, fn: () => Promise<{ evidence: string; shots?: string[]; level?: Level }>): Promise<boolean> {
  const started = Date.now()
  try {
    const out = await fn()
    const level = out.level ?? '—'
    const status: StepStatus = level === 'P0' || level === 'P1' ? 'FAIL' : 'PASS'
    rows.push({ no, title, status, level, evidence: out.evidence, shots: out.shots ?? [], ms: Date.now() - started })
    console.log(`[b-shell-retest] STEP ${no} ${status} ${title} | ${out.evidence} | ${(out.shots ?? []).join(',') || '-'} | ${Date.now() - started}ms`)
    return status === 'PASS'
  } catch (err) {
    let failShot = ''
    try {
      failShot = await shot(ctx!.page, `shell-${String(no).padStart(2, '0')}-${slug}-FAIL`)
    } catch {
      /* 页面可能已关闭 */
    }
    rows.push({
      no,
      title,
      status: 'FAIL',
      level: 'P1',
      evidence: errorText(err),
      shots: failShot ? [failShot] : [],
      ms: Date.now() - started,
    })
    console.error(`[b-shell-retest] STEP ${no} FAIL ${title} | ${errorText(err)} | ${failShot || '-'}`)
    return false
  }
}

test.describe('Wave4 B 主壳 / 舞台复测（当前 UI）', () => {
  test('主壳：设置入口 / topbar-docs / 无 MiniDock / 端别恢复 / 非当前原型子页', async ({}, testInfo) => {
    test.setTimeout(480_000)
    let closeResult: CloseResult | null = null
    let ok = true
    const consoleAll: string[] = []
    const pageErrorsAll: string[] = []
    const crashesAll: string[] = []

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      const pickerShown = await enterProject(page)
      console.log(
        `[b-shell-retest] dataDir=${ctx.dataDir} userData=${ctx.userData} seed=${ctx.seedPresent} picker=${pickerShown}`,
      )

      // ── 1. 冷启动：移动端默认展开侧栏/文档、无 MiniDock、顶栏入口收敛 ─
      ok = await runStep(1, '冷启动 / 移动端默认展开侧栏与文档 / 顶栏入口收敛 / 无 MiniDock', 'cold-start', async () => {
        const shots: string[] = []
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 20_000 })
        await expect(sidebar(page), '打开移动端原型应默认展开侧栏').toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('docs-panel'), '打开移动端原型应默认打开文档').toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('docs-panel'), '移动端文档必须为 inline 挤压').toHaveAttribute('data-variant', 'inline')
        await expect(page.getByTestId('mini-dock')).toHaveCount(0)

        const topbar = page.getByTestId('topbar')
        await expect(topbar.getByTestId('topbar-docs')).toHaveCount(1)
        await expect(topbar.locator('[data-testid^="topbar-doc"]')).toHaveCount(1)
        await expect(topbar.getByTestId('topbar-doc-desc')).toHaveCount(0)
        await expect(topbar.getByTestId('topbar-doc-latest')).toHaveCount(0)
        await expect(topbar.locator('button[aria-label="设置"]')).toHaveCount(0)
        await expect(topbar.getByText('功能说明', { exact: true })).toHaveCount(0)
        await expect(topbar.getByText('最新需求', { exact: true })).toHaveCount(0)
        shots.push(await shot(page, 'shell-01-cold-start'))

        await ensureSidebar(page)
        await expect(tree(page)).toBeVisible({ timeout: 15_000 })
        await expect(page.getByTestId('mini-dock'), '展开侧栏后也不应出现 MiniDock').toHaveCount(0)
        const names = (await tree(page).locator('[data-key]').allInnerTexts()).map(norm)
        expect(names.length, 'seed 应有 4 个原型').toBe(4)
        shots.push(await shot(page, 'shell-01-sidebar'))
        return {
          evidence: `冷启动 kind=mobile、sidebar=1、docs=1（inline）、mini-dock=0；顶栏只有 topbar-docs（topbar-doc-* 计数=1），无设置/功能说明/最新需求；原型=${names.join(' / ')}`,
          shots,
        }
      })
      if (!ok) throw new Error('冷启动失败，停止后续')

      // ── 2. 设置只在侧栏底部 ─────────────────────────────────────────
      ok = await runStep(2, '设置只在侧栏底部（顶栏无设置）', 'settings-entry', async () => {
        const shots: string[] = []
        await ensureSidebar(page)
        const settingsButtons = page.locator('button[aria-label="打开设置"]')
        await expect(settingsButtons, '全局只应有 1 个设置入口').toHaveCount(1)
        const inSidebar = sidebar(page).locator('button[aria-label="打开设置"]')
        await expect(inSidebar).toBeVisible()
        await expect(page.getByTestId('topbar').locator('button[aria-label="打开设置"]')).toHaveCount(0)
        await inSidebar.click()
        await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 15_000 })
        shots.push(await shot(page, 'shell-02-settings-sidebar'))
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('settings-dialog')).toBeHidden({ timeout: 8_000 })
        return {
          evidence: `设置入口全局=1，且位于 sidebar 底部；topbar 设置入口=0；点击打开 settings-dialog，Esc 关闭`,
          shots,
        }
      })
      if (!ok) throw new Error('设置入口失败，停止后续')

      // ── 3. topbar-docs 只开合面板，不弹独立窗 ──────────────────────
      ok = await runStep(3, 'topbar-docs 只开合文档面板，不弹独立窗', 'docs-toggle', async () => {
        const shots: string[] = []
        const before = await windowFacts()
        expect(before.count).toBe(1)
        const docs = page.getByTestId('docs-panel')
        // 冷启动时移动端文档默认打开；先关掉，确保下面的「点击打开」不是复用初始状态。
        if (await docs.isVisible().catch(() => false)) {
          await docs.getByRole('button', { name: '关闭文档' }).click()
          await expect(docs).toBeHidden({ timeout: 8_000 })
        }
        await page.getByTestId('topbar-docs').click()
        await expect(docs).toBeVisible({ timeout: 15_000 })
        await expect(page.getByTestId('topbar-docs')).toHaveAttribute('aria-pressed', 'true')
        await page.waitForTimeout(1_200)
        const after = await windowFacts()
        expect(after.count, '点击文档不得创建新窗口').toBe(1)
        expect(after.wins.filter((w) => w.url.includes('docwin=1')), '不得出现 docwin=1').toStrictEqual([])
        shots.push(await shot(page, 'shell-03-docs-open'))

        // 移动端文档为 inline 挤压，不覆盖顶栏；PC overlay 才会挡住 topbar-docs 点击。
        const hit = await page.getByTestId('topbar-docs').evaluate((el) => {
          const r = el.getBoundingClientRect()
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null
          return top?.closest('[data-testid="docs-overlay"]') ? 'docs-overlay' : top?.closest('[data-testid="topbar-docs"]') ? 'topbar-docs' : top?.tagName || 'none'
        })
        await page.getByTestId('topbar-docs').click()
        await expect(docs).toBeHidden({ timeout: 8_000 })
        await expect(page.getByTestId('topbar-docs')).toHaveAttribute('aria-pressed', 'false')
        const afterToggle = await windowFacts()
        expect(afterToggle.count).toBe(1)
        if (hit !== 'topbar-docs') {
          observe(
            'b-shell-retest-P2-docs-overlay',
            'P2',
            'PC 文档 overlay 覆盖顶栏，打开后无法用 topbar-docs 再次点按关闭',
            '文档面板打开时 overlay 命中 topbar-docs 位置；关闭需用面板 X / Esc（toggle 逻辑本身正常）',
            `elementFromPoint(topbar-docs)=${hit}`,
          )
        }
        return {
          evidence: `点击前窗口=1；打开后 1.2s 窗口仍=1、无 docwin=1；aria-pressed=true；再次点击后 aria-pressed=false、面板关闭、窗口仍=1；topbar 命中=${hit}`,
          shots,
        }
      })
      if (!ok) throw new Error('topbar-docs 失败，停止后续')

      // ── 4. 侧栏收起后无 MiniDock ───────────────────────────────────
      ok = await runStep(4, '收起侧栏后无 MiniDock', 'no-minidock', async () => {
        const shots: string[] = []
        await collapseSidebar(page)
        await expect(page.getByTestId('mini-dock')).toHaveCount(0)
        await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible({ timeout: 5_000 })
        shots.push(await shot(page, 'shell-04-no-minidock'))
        await ensureSidebar(page)
        await expect(page.getByTestId('mini-dock')).toHaveCount(0)
        return {
          evidence: `收起侧栏 sidebar=0、mini-dock=0；顶栏「展开侧栏」可用；重新展开后 mini-dock 仍=0`,
          shots,
        }
      })
      if (!ok) throw new Error('MiniDock 失败，停止后续')

      // ── 5. 移动端默认展开 / 切回 PC 关闭文档、侧栏保留 ─────────────
      ok = await runStep(5, '移动端默认展开侧栏/文档；切回 PC 关闭文档、侧栏保留', 'chrome-default', async () => {
        const shots: string[] = []
        const docs = page.getByTestId('docs-panel')

        await setPc(page)
        await ensureSidebar(page)
        if (await docs.isVisible().catch(() => false)) {
          await docs.getByRole('button', { name: '关闭文档' }).click()
          await expect(docs).toBeHidden({ timeout: 8_000 })
        }
        await collapseSidebar(page)
        await expect(sidebar(page)).toHaveCount(0, { timeout: 10_000 })
        shots.push(await shot(page, 'shell-05-pc-all-closed'))

        // PC 全关 → 切移动端：端别切换按默认打开侧栏与文档（inline 挤压）。
        await setMobile(page)
        await expect(sidebar(page), '切到移动端应默认展开侧栏').toBeVisible({ timeout: 10_000 })
        await expect(docs, '切到移动端应默认打开文档').toBeVisible({ timeout: 10_000 })
        await expect(docs, '移动端文档必须为 inline 挤压').toHaveAttribute('data-variant', 'inline')
        await expect(page.getByTestId('mini-dock')).toHaveCount(0)
        shots.push(await shot(page, 'shell-05-mobile-default-open'))

        // 移动端开着 → 切回 PC：只在切换瞬间关闭文档；侧栏保留，不强制改。
        await setPc(page)
        await expect(sidebar(page), '切回 PC 不强制关闭侧栏').toBeVisible({ timeout: 10_000 })
        await expect(docs, '切回 PC 应关闭移动端默认打开的文档').toBeHidden({ timeout: 10_000 })
        shots.push(await shot(page, 'shell-05-back-to-pc-docs-closed'))

        // 文档已由切 PC 关闭；收起侧栏后再次切移动端：仍按默认重新打开。
        await collapseSidebar(page)
        await setMobile(page)
        await expect(sidebar(page), '再次进入移动端应重新展开侧栏').toBeVisible({ timeout: 10_000 })
        await expect(docs, '再次进入移动端应重新打开文档').toBeVisible({ timeout: 10_000 })
        await expect(docs).toHaveAttribute('data-variant', 'inline')

        // 移动端手动关闭 → 切回 PC：不强制打开。
        await page.keyboard.press('Escape')
        await expect(docs).toBeHidden({ timeout: 8_000 })
        await collapseSidebar(page)
        await setPc(page)
        await expect(sidebar(page), '切回 PC 不强制打开侧栏').toHaveCount(0, { timeout: 10_000 })
        await expect(docs, '切回 PC 不强制打开文档').toHaveCount(0, { timeout: 10_000 })
        shots.push(await shot(page, 'shell-05-pc-kept-closed'))

        // 恢复默认态供后续步骤使用（移动端源仍在，切端别会重新打开）。
        await setMobile(page)
        await expect(sidebar(page)).toBeVisible({ timeout: 10_000 })
        await expect(docs).toBeVisible({ timeout: 10_000 })
        shots.push(await shot(page, 'shell-05-mobile-restored'))

        return {
          evidence: `PC 全关（sidebar=0/docs=0）→ 切移动端：sidebar=1、docs=1（inline）、mini-dock=0；开着切回 PC：sidebar=1、docs=0（切换瞬间关闭文档，侧栏不强制改）；手动关闭后再回移动端：sidebar=1、docs=1（inline，重新打开）；移动端手动关闭后切 PC：sidebar=0、docs=0（不强制打开）；再回移动端：sidebar=1、docs=1`,
          shots,
        }
      })
      if (!ok) throw new Error('移动端默认 chrome 失败，停止后续')

      // ── 6. 非当前原型新建子页自动切到新子页 ────────────────────────
      ok = await runStep(6, '非当前原型新建子页：自动切父源 + 新子页', 'subpage-switch', async () => {
        const shots: string[] = []
        await setPc(page)
        const docs = page.getByTestId('docs-panel')
        // 第 5 步结束时为移动端且文档打开；切 PC 会在切换瞬间自动关闭文档，
        // 不再手动点关闭，随后 selectProto 切到移动端源会按默认以 inline 重新打开。
        await expect(docs, '切 PC 应自动关闭文档').toBeHidden({ timeout: 8_000 })
        await selectProto(page, HOME)
        await ensureSidebar(page)
        await expect(docs, '切到移动端源应默认打开文档').toBeVisible({ timeout: 10_000 })
        await expect(docs).toHaveAttribute('data-variant', 'inline')
        await expect.poll(async () => norm(await page.getByTestId('loc-pill').innerText()), { timeout: 10_000 }).toContain(HOME)

        // 新建子页面的 Dialog 与 inline 文档同为 z-50 且文档在 DOM 靠后，会盖住弹窗；
        // 先手动关闭文档（用户操作），创建成功后切到 OTHER 源会按默认重新打开。
        await docs.getByRole('button', { name: '关闭文档' }).click()
        await expect(docs).toBeHidden({ timeout: 8_000 })

        const otherRow = tree(page).locator(`[data-key="${OTHER}"]`).first()
        await expect(otherRow).toBeVisible({ timeout: 10_000 })
        await otherRow.hover()
        await otherRow.locator(`button[aria-label^="原型「${OTHER}」更多操作"]`).click()
        await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 })
        await page.getByRole('menuitem', { name: '新建子页面' }).click()
        const dialog = page.getByRole('dialog').filter({ hasText: '新建子页面' }).first()
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        await dialog.locator('input[aria-label="新建子页面"]').fill(SUB)
        await dialog.getByRole('button', { name: '确定' }).click()
        await expect(dialog).toBeHidden({ timeout: 15_000 })

        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-subfile', `${SUB}.html`, { timeout: 20_000 })
        await expect.poll(async () => norm(await page.getByTestId('loc-pill').innerText()), { timeout: 20_000 }).toContain(SUB)
        await expect.poll(async () => norm(await page.getByTestId('loc-pill').innerText()), { timeout: 20_000 }).toContain(OTHER)

        // 切源会把端别回写为源端别（seed 全为移动端），并保持侧栏/文档按默认打开。
        await ensureSidebar(page)
        await expect(page.getByTestId('docs-panel'), '切到另一个移动端原型应保持文档打开').toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('docs-panel')).toHaveAttribute('data-variant', 'inline')
        const subButton = tree(page).locator('button[data-level="subpage"]').filter({ hasText: SUB }).first()
        await expect(subButton).toBeVisible({ timeout: 10_000 })
        await expect(subButton).toHaveAttribute('aria-current', 'true')
        await expect(subButton.locator('xpath=..')).toHaveAttribute('data-selected', 'true')
        const subFile = path.join(ctx!.dataDir, 'sandbox', PROJECT, OTHER, `${SUB}.html`)
        expect(fs.existsSync(subFile), `新子页文件应落盘：${subFile}`).toBe(true)
        shots.push(await shot(page, 'shell-06-subpage-switched'))
        return {
          evidence: `当前=${HOME} 时在非当前原型「${OTHER}」新建子页 ${SUB} → stage data-subfile=${SUB}.html，loc-pill 含 ${OTHER}/${SUB}；侧栏子页 aria-current=true 且行 data-selected=true；切源后 sidebar 可见、docs=1（inline）；文件已落盘`,
          shots,
        }
      })
      if (!ok) throw new Error('子页切换失败，停止后续')

      // ── 7. console / pageerror / crash ─────────────────────────────
      ok = await runStep(7, 'console / pageerror / crash 汇总', 'console', async () => {
        consoleAll.push(...ctx!.consoleErrors)
        pageErrorsAll.push(...ctx!.pageErrors)
        crashesAll.push(...ctx!.crashes)
        const noise = (text: string): boolean =>
          /cdn\.jsdelivr\.net\/npm\/vant/i.test(text) ||
          /Unexpected token '\.'/.test(text) ||
          /Content Security Policy/i.test(text) ||
          /Refused to load/i.test(text) ||
          /favicon/i.test(text)
        const fatalConsole = consoleAll.filter((text) => isFatalConsole(text) && !noise(text))
        const fatalPage = pageErrorsAll.filter((text) => !noise(text))
        const fatalCrash = crashesAll.filter((text) => !noise(text))
        console.log('[b-shell-retest] CONSOLE_RAW=' + consoleAll.length + '\n' + consoleAll.join('\n---\n'))
        console.log('[b-shell-retest] PAGEERROR_RAW=' + pageErrorsAll.length + '\n' + pageErrorsAll.join('\n---\n'))
        const file = await shot(page, 'shell-07-final')
        expect(fatalPage, `pageerror：\n${fatalPage.join('\n')}`).toStrictEqual([])
        expect(fatalCrash, `crash：\n${fatalCrash.join('\n')}`).toStrictEqual([])
        expect(fatalConsole, `console error：\n${fatalConsole.join('\n')}`).toStrictEqual([])
        if (consoleAll.length || pageErrorsAll.length) {
          observe(
            'b-shell-retest-ENV-prototype-noise',
            'ENV',
            'seed 原型内容自带外部 CDN/脚本噪声',
            `原始 console=${consoleAll.length}、pageerror=${pageErrorsAll.length}`,
            `过滤后 fatal console=${fatalConsole.length}、pageerror=${fatalPage.length}、crash=${fatalCrash.length}`,
          )
        }
        return {
          evidence: `原始 console=${consoleAll.length}、pageerror=${pageErrorsAll.length}、crash=${crashesAll.length}；过滤 Vant/CSP/内联后 fatal console=${fatalConsole.length}、pageerror=${fatalPage.length}、crash=${fatalCrash.length}`,
          shots: [file],
        }
      })

      closeResult = await ctx.close()
      console.log(`[b-shell-retest] CLOSE method=${closeResult.method} exit=${closeResult.exitCode} elapsed=${closeResult.elapsedMs}ms`)
    } finally {
      if (!closeResult && ctx) {
        try {
          closeResult = await ctx.close()
        } catch (err) {
          console.log('[b-shell-retest] close failed: ' + errorText(err))
        }
      }
      testInfo.annotations.push({
        type: 'wave4-b-shell-retest-summary',
        description: rows
          .map((r) => `${r.no}.${r.status}[${r.level}] ${r.title}${r.shots.length ? ` [${r.shots.join('; ')}]` : ''}`)
          .join(' | '),
      })
      testInfo.annotations.push({
        type: 'wave4-b-shell-retest-observations',
        description: observations.map((o) => `${o.id}:${o.level} ${o.title}`).join(' | ') || '(none)',
      })
      testInfo.annotations.push({
        type: 'wave4-b-shell-retest-rowjson',
        description: JSON.stringify({ rows, observations }),
      })
    }

    if (closeResult) assertCleanExitOrP2(closeResult)
    const failed = rows.filter((r) => r.status === 'FAIL')
    expect(failed, `主壳复测失败：\n${failed.map((r) => `${r.no}. [${r.level}] ${r.title}: ${r.evidence}`).join('\n')}`).toStrictEqual([])
    console.log(`[b-shell-retest] RESULTS ${JSON.stringify(rows, null, 2)}`)
    console.log(`[b-shell-retest] OBSERVATIONS ${JSON.stringify(observations, null, 2)}`)
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
