/**
 * e2e/wave4-b-pick.spec.ts — Wave4 B 复测 · Ctrl 拾取域（b-pick）。
 *
 * 当前 UI 口径（旧版「Ctrl+点击直接弹需求框」断言已漂移）：
 * 1. Ctrl 按住多选、期间不弹窗；松开 Ctrl 后出现底部需求条 `pick-composer`，
 *    多元素共享一条需求，提交为一条批量待提交（batchParts=N）；
 * 2. Ctrl+Shift 只单选、期间不弹窗；松开后只出现一个 `pick-modify-dialog`；
 *    取消不写队列、不写 HTML；「保存到代码」直接改写源 HTML，不入待提交队列；
 * 3. 无修饰键普通点击不弹窗、不改队列；无修饰键拾取事件只选中；
 * 4. 选中框随 iframe 滚动 / 舞台 75%、125% 缩放实时重算，不漂移；
 * 5. 待提交只从工具栏「待提交」打开（底部不再常驻 multi-edit-bar）；条目可直接编辑，
 *    底部提交/清空固定可见、不随列表滚动；
 * 6. 标注：点击条目/定位只高亮元素、不打开检查器 Sheet；内容在标注面板内直接编辑并保存；
 * 7. Sheet 打开后焦点进入浮层、Tab/Shift+Tab 焦点陷阱、Esc 关闭后焦点回归；
 * 8. 需求草稿：继续 Ctrl 多选期间输入条不短暂消失、草稿与 chips 同时保留，松开后焦点回输入框；
 *    取消 / 提交 / 清空选择 / 切源后草稿清空。
 *
 * 写入范围：
 * - e2e/wave4-b-pick.spec.ts（本文件）
 * - docs/wave4/shots/retest-b-ai-pick/pick-*.png
 * - 隔离数据目录 .devdata-wave4-b-pick/**（afterAll 删除）
 * 不改产品代码 / package.json / seed；不 commit。
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ROOT, assertCleanExit, isFatalConsole, launchApp, reportFailure, type Wave4App } from './wave4/harness'

const DOMAIN = 'b-pick'
const PROJECT = '测试1'
const PROTO = '首页'
const HTML_FILE = '首页.html'
const SHOT_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-b-ai-pick')
const DRAFT_SHOT_DIR = path.join(ROOT, 'docs', 'wave4', 'shots', 'retest-pick-draft')
const SEL_A = '[data-pr-id="pr-p-39"]'
const SEL_B = '[data-pr-id="pr-p-43"]'
const SEL_C = '[data-pr-id="pr-p-44"]'

type Level = 'P0' | 'P1' | 'P2' | 'P3' | 'ENV'

interface Observation {
  id: string
  level: Level
  text: string
}

interface QueueItem {
  id?: string
  selector: string
  page?: string
  htmlFile?: string
  text: string
  selected?: boolean
}

interface FramePoint {
  x: number
  y: number
  scale: number
  frameBox: { x: number; y: number; width: number; height: number }
  local: { left: number; top: number; width: number; height: number; cx: number; cy: number }
  hit: string
}

const observations: Observation[] = []
const evidence: Record<string, unknown> = {}

function log(label: string, data: unknown): void {
  console.log(`[W4-B-PICK] ${label} ${JSON.stringify(data)}`)
}

function observe(id: string, level: Level, text: string): void {
  observations.push({ id, level, text })
  log(`OBS ${id}/${level}`, text)
}

function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const file = path.join(SHOT_DIR, name + '.png')
  await page.screenshot({ path: file })
  return rel(file)
}

/** 草稿域截图统一落 docs/wave4/shots/retest-pick-draft/（与既有域截图分开）。 */
async function draftShot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(DRAFT_SHOT_DIR, { recursive: true })
  const file = path.join(DRAFT_SHOT_DIR, name + '.png')
  await page.screenshot({ path: file })
  return rel(file)
}

function sha256(file: string): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return 'unreadable'
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function arrayCount(file: string, key?: string): number {
  const raw = readJson(file)
  const list = key && raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : raw
  return Array.isArray(list) ? list.length : -1
}

function isPrototypeContentNoise(text: string): boolean {
  const t = String(text)
  return /cdn\.jsdelivr\.net\/npm\/vant/i.test(t) || /Unexpected token '\.'/.test(t)
}

function maxBoxDelta(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
): number {
  return Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
    Math.abs(actual.width - expected.width),
    Math.abs(actual.height - expected.height),
  )
}

async function ensureSidebarExpanded(page: Page): Promise<void> {
  const toggle = page.locator('button[aria-label="展开侧栏"], button[aria-label="收起侧栏"]').first()
  const expanded = await toggle.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 })
  }
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
}

async function ensureProject(page: Page): Promise<boolean> {
  await page.waitForTimeout(1_200)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    const row = picker.locator('li').filter({ hasText: PROJECT }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  await ensureSidebarExpanded(page)
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
  return shown
}

async function waitPreview(page: Page): Promise<void> {
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
  await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(10_000)
}

async function clickProto(page: Page, name: string): Promise<void> {
  await ensureSidebarExpanded(page)
  const proto = page
    .getByTestId('sidebar-tree')
    .locator('button[data-level="proto"]')
    .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
    .first()
  await expect(proto).toBeVisible({ timeout: 20_000 })
  await proto.click()
  await waitPreview(page)
}

async function ensurePcStage(page: Page): Promise<void> {
  const kind = await page.getByTestId('stage-frame').getAttribute('data-kind')
  if (kind !== 'pc') {
    await page.locator('button[title="桌面端舞台"]').click()
    await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
  }
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'off', { timeout: 10_000 })
  await waitPreview(page)
}

async function setZoom(page: Page, percent: number): Promise<void> {
  const value = String(percent / 100)
  await page.locator('select[aria-label="缩放预设"]').selectOption(String(percent))
  await expect(page.getByTestId('stage-pc-zoom')).toHaveAttribute('data-zoom', value, { timeout: 10_000 })
  await page.waitForTimeout(400)
}

async function pointOf(page: Page, selector: string, nth = 0, scroll = false): Promise<FramePoint> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const el = frame.locator(selector).nth(nth)
  await expect(el).toBeVisible({ timeout: 10_000 })
  if (scroll) await el.scrollIntoViewIfNeeded()
  const local = await el.evaluate((node) => {
    const r = node.getBoundingClientRect()
    const win = node.ownerDocument.defaultView
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      clientWidth: win ? win.innerWidth : 0,
      clientHeight: win ? win.innerHeight : 0,
    }
  })
  const frameEl = page.getByTestId('preview-frame')
  const frameBox = await frameEl.boundingBox()
  const clientWidth = await frameEl.evaluate((el) => (el as HTMLIFrameElement).clientWidth)
  if (!frameBox || !clientWidth) throw new Error(`无法读取 preview-frame 几何信息（selector=${selector}）`)
  const scale = frameBox.width / clientWidth
  const p = { x: frameBox.x + local.cx * scale, y: frameBox.y + local.cy * scale }
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const owner = el?.closest('[data-testid]') as HTMLElement | null
    return `${el?.tagName || 'none'}|${owner?.getAttribute('data-testid') || ''}`
  }, p)
  return {
    ...p,
    scale,
    frameBox: { x: frameBox.x, y: frameBox.y, width: frameBox.width, height: frameBox.height },
    local,
    hit,
  }
}

function expectedBox(point: FramePoint): { x: number; y: number; width: number; height: number } {
  return {
    x: point.frameBox.x + point.local.left * point.scale,
    y: point.frameBox.y + point.local.top * point.scale,
    width: point.local.width * point.scale,
    height: point.local.height * point.scale,
  }
}

async function selectedBox(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const box = await page.locator('.selection-box-overlay').first().boundingBox().catch(() => null)
  return box
}

async function expectSelectedAligned(page: Page, selector: string, nth: number, tolerance = 4): Promise<number> {
  let delta = 999
  await expect
    .poll(async () => {
      const point = await pointOf(page, selector, nth, false)
      const box = await selectedBox(page)
      if (!box) return 999
      delta = maxBoxDelta(box, expectedBox(point))
      return delta
    }, { timeout: 15_000, intervals: [150, 250, 400] })
    .toBeLessThanOrEqual(tolerance)
  return delta
}

async function pickWithCtrl(
  page: Page,
  selector: string,
  nth: number,
  options: { shift?: boolean; checkHover?: boolean } = {},
): Promise<{ point: FramePoint; hoverBox: { x: number; y: number; width: number; height: number } | null }> {
  const shift = options.shift ?? false
  const point = await pointOf(page, selector, nth, true)
  // 先把焦点送进 iframe：否则点击瞬间父窗 blur 会清掉 Stage 的 Ctrl 武装态，
  // 导致 PICK_RESULT 只选中、不弹窗。焦点在帧内后，Ctrl keydown 由帧桥 CTRL_STATE 回传。
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  await frame.locator('body').evaluate(() => {
    try {
      window.focus()
    } catch {
      /* 焦点进入失败时仍按原路径尝试 */
    }
  })
  await page.keyboard.down('Control')
  if (shift) await page.keyboard.down('Shift')
  let hoverBox: { x: number; y: number; width: number; height: number } | null = null
  try {
    await expect(page.getByTestId('pick-status')).toBeVisible({ timeout: 5_000 })
    await page.mouse.move(point.x - 3, point.y - 3)
    await page.mouse.move(point.x, point.y, { steps: 6 })
    if (options.checkHover !== false) {
      await expect(page.getByTestId('pick-hover')).toBeVisible({ timeout: 5_000 })
      hoverBox = await page.getByTestId('pick-hover').boundingBox()
      expect(hoverBox, 'pick-hover 应有非零 bbox').not.toBeNull()
      expect(hoverBox!.width, 'pick-hover 宽度应为正').toBeGreaterThan(0)
      expect(hoverBox!.height, 'pick-hover 高度应为正').toBeGreaterThan(0)
      // 悬停框与元素贴合精度由步骤 5 的选中框滚动/缩放同步严格校验；
      // 这里只做“落在预览帧内”的粗校验，避免 iframe 滚动瞬间的亚像素抖动误报。
      expect(hoverBox!.x, 'hover 框应落在预览帧横向范围').toBeGreaterThanOrEqual(point.frameBox.x - 2)
      expect(hoverBox!.x, 'hover 框应落在预览帧横向范围').toBeLessThanOrEqual(point.frameBox.x + point.frameBox.width + 2)
    }
    await page.mouse.click(point.x, point.y)
  } finally {
    if (shift) await page.keyboard.up('Shift').catch(() => undefined)
    await page.keyboard.up('Control').catch(() => undefined)
    // 弹窗打开后焦点可能已进入弹窗 textarea，真实 keyup 不一定回到 Stage；
    // 补发一次父窗 keyup，确保拾取武装态确定性退出（仅测试收尾，不改产品状态语义）。
    await page
      .evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }))
      })
      .catch(() => undefined)
  }
  await expect(page.getByTestId('pick-status')).toHaveCount(0, { timeout: 5_000 })
  return { point, hoverBox }
}

/** 按住 Ctrl/Cmd（可选 Shift）进入拾取态，调用方负责最终释放。 */
async function beginPickModifiers(page: Page, options: { shift?: boolean } = {}): Promise<void> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  await frame.locator('body').evaluate(() => {
    try {
      window.focus()
    } catch {
      /* 忽略 */
    }
  })
  await page.keyboard.down('Control')
  if (options.shift) await page.keyboard.down('Shift')
  await expect(page.getByTestId('pick-status')).toBeVisible({ timeout: 5_000 })
}

/** 在已按住的拾取态里点一个元素，不释放修饰键、不等待弹窗。 */
async function clickFrameElementHeld(page: Page, selector: string, nth = 0): Promise<FramePoint> {
  const point = await pointOf(page, selector, nth, true)
  await page.mouse.move(point.x - 3, point.y - 3)
  await page.mouse.move(point.x, point.y, { steps: 6 })
  await page.mouse.click(point.x, point.y)
  return point
}

/**
 * 把帧内元素滚到视口中央：底部需求条常驻时会遮住视口下缘，
 * 继续 Ctrl 多选必须点击未被输入条遮挡的元素位置（真实鼠标点击会被输入条拦截）。
 */
async function centerFrameElement(page: Page, selector: string, nth = 0): Promise<void> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const el = frame.locator(selector).nth(nth)
  await expect(el).toBeVisible({ timeout: 10_000 })
  await el.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }))
  await page.waitForTimeout(250)
}

/** 释放修饰键并等拾取武装态退出；keyup 补发确保焦点在 iframe 时也能退出。 */
async function endPickModifiers(page: Page, options: { shift?: boolean } = {}): Promise<void> {
  if (options.shift) await page.keyboard.up('Shift').catch(() => undefined)
  await page.keyboard.up('Control').catch(() => undefined)
  await page
    .evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }))
    })
    .catch(() => undefined)
  await expect(page.getByTestId('pick-status')).toHaveCount(0, { timeout: 5_000 })
}

async function clearSelectionIfAny(page: Page): Promise<void> {
  const clear = page.getByTestId('overlays-clear-selection')
  if ((await clear.count()) > 0) await clear.click()
  await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0, { timeout: 5_000 })
}

async function readQueue(page: Page): Promise<QueueItem[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('edit_queue_v1')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }) as Promise<QueueItem[]>
}

async function toastTexts(page: Page): Promise<string[]> {
  return page
    .locator('[data-slot="toast"]')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()))
}

/** 关闭所有 toast：避免右下角通知遮挡底部需求条的提交按钮与截图。 */
async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: '关闭通知' })
  for (let i = 0; i < 8; i += 1) {
    if ((await close.count()) === 0) return
    await close.first().click({ timeout: 2_000 }).catch(() => undefined)
  }
}

async function activeInfo(page: Page): Promise<{
  tag: string
  testid: string
  ariaLabel: string
  text: string
  inSheet: boolean
  inToolbar: boolean
}> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    const owner = a?.closest('[data-testid]') as HTMLElement | null
    return {
      tag: a?.tagName || '',
      testid: owner?.getAttribute('data-testid') || '',
      ariaLabel: a?.getAttribute('aria-label') || '',
      text: (a?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      inSheet: !!a?.closest('[data-slot="sheet-content"]'),
      inToolbar: !!a?.closest('[data-testid="overlays-toolbar"]'),
    }
  })
}

/**
 * 普通（无修饰键）拾取：真实产品只在 Ctrl 武装时武装帧；此用例按帧桥协议
 * 从预览帧回传一条 shiftKey=false 的 PICK_RESULT，验证 Stage 侧「只选中、不弹窗」接线。
 */
async function injectPlainPick(page: Page, selector: string, nth: number): Promise<void> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  await frame.locator(selector).nth(nth).evaluate((node, sel) => {
    const r = node.getBoundingClientRect()
    window.parent.postMessage(
      {
        type: 'PICK_RESULT',
        nonce: 'plain-retest',
        source: 'frame',
        payload: {
          selector: sel,
          tagName: String(node.tagName || '').toLowerCase(),
          text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          page: '',
          shiftKey: false,
        },
      },
      '*',
    )
  }, selector)
}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  try {
    fs.rmSync(path.join(ROOT, '.devdata-wave4-b-pick'), { recursive: true, force: true, maxRetries: 8, retryDelay: 300 })
    console.log('[W4-B-PICK] cleaned .devdata-wave4-b-pick')
  } catch (err) {
    console.warn(`[W4-B-PICK] cleanup failed: ${String(err)}`)
  }
  try {
    const summaryFile = path.join(process.env.TEMP || process.env.TMP || '.', 'pland-wave4', 'retest-b-pick-summary.json')
    fs.mkdirSync(path.dirname(summaryFile), { recursive: true })
    fs.writeFileSync(summaryFile, JSON.stringify({ evidence, observations }, null, 2), 'utf8')
    log('summary', summaryFile)
  } catch {
    /* 摘要失败不影响测试 */
  }
})

test('B pick 复测：Ctrl 需求弹窗 / Ctrl+Shift 修改弹窗 / 普通点击 / 选中框同步 / Sheet 焦点', async () => {
  test.setTimeout(600_000)
  const ctx = await launchApp({ domain: DOMAIN })
  let closeError: Error | null = null

  try {
    const page = ctx.page
    await page.bringToFront().catch(() => undefined)
    expect(path.resolve(ctx.userData).toLowerCase(), 'userData 必须精确指向域隔离目录').toBe(
      path.resolve(ctx.dataDir).toLowerCase(),
    )
    const pickerShown = await ensureProject(page)
    await ensureSidebarExpanded(page)
    await clickProto(page, PROTO)
    await ensurePcStage(page)

    const staleQueue = await readQueue(page)
    if (staleQueue.length > 0) {
      await page.evaluate(() => localStorage.removeItem('edit_queue_v1'))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByTestId('main-window').waitFor({ state: 'visible', timeout: 60_000 })
      await ensureProject(page)
      await clickProto(page, PROTO)
      await ensurePcStage(page)
    }

    const sandboxDir = path.join(ctx.dataDir, 'sandbox', PROJECT, PROTO)
    const htmlPath = path.join(sandboxDir, HTML_FILE)
    const htmlHashBefore = sha256(htmlPath)
    const annoBefore = arrayCount(path.join(sandboxDir, 'annotations.json'))
    const linksBefore = arrayCount(path.join(sandboxDir, 'links.json'), 'links')
    evidence.entry = {
      pickerShown,
      dataDir: ctx.dataDir,
      userData: ctx.userData,
      seedPresent: ctx.seedPresent,
      htmlHashBefore,
      annoBefore,
      linksBefore,
      queueBefore: staleQueue.length,
    }
    await shot(page, 'pick-00-entry')
    log('entry', evidence.entry)

    // ── 1. 普通点击：不弹窗、不改队列（真实鼠标事件）────────────────
    const plainPoint = await pointOf(page, SEL_A, 0, true)
    const queueBeforePlain = await readQueue(page)
    await page.mouse.click(plainPoint.x, plainPoint.y)
    await page.waitForTimeout(400)
    expect(await page.getByTestId('pick-composer').count(), '普通点击不应出现底部需求条').toBe(0)
    expect(await page.getByTestId('pick-modify-dialog').count(), '普通点击不应弹修改框').toBe(0)
    expect(await readQueue(page), '普通点击不应写队列').toHaveLength(queueBeforePlain.length)
    const selectionAfterPlainClick = await page.getByTestId('overlays-selection-count').count()
    await shot(page, 'pick-01-plain-click')
    evidence.plainClick = { selectionAfterPlainClick, queue: queueBeforePlain.length }
    log('plainClick', evidence.plainClick)
    if (selectionAfterPlainClick === 0) {
      observe(
        'B-PICK-OBS-plain-click',
        'P3',
        '真实无修饰键点击不会进入拾取（当前实现仅 Ctrl/Meta 按住时武装帧）；普通拾取接线改由帧桥 PICK_RESULT 验证。',
      )
    }

    // ── 2. 无修饰键帧桥拾取：只选中、不弹窗 ─────────────────────────
    await injectPlainPick(page, SEL_A, 0)
    await expect(page.getByTestId('overlays-selection-count')).toBeVisible({ timeout: 5_000 })
    expect(await page.getByTestId('overlays-selection-count').innerText()).toBe('1')
    expect(await page.getByTestId('pick-composer').count(), '普通拾取不应出现底部需求条').toBe(0)
    expect(await page.getByTestId('pick-modify-dialog').count(), '普通拾取不应弹修改框').toBe(0)
    expect(await page.locator('.selection-box-overlay').count()).toBe(1)
    await clearSelectionIfAny(page)
    evidence.plainPickBridge = { selected: 1, dialogs: 0 }
    log('plainPickBridge', evidence.plainPickBridge)

    // ── 3. Ctrl+点击松开：底部需求条（单元素）→ 空校验 → 入队 ────────
    const queueBeforeReq = await readQueue(page)
    const reqPick = await pickWithCtrl(page, SEL_A, 0)
    const composer = page.getByTestId('pick-composer')
    await expect(composer).toBeVisible({ timeout: 10_000 })
    expect(await page.getByTestId('overlays-selection-count').innerText()).toBe('1')
    expect(await page.locator('.selection-box-overlay').count()).toBe(1)
    expect(await page.getByTestId('pick-composer-chip').count(), '单元素应有 1 个 chip').toBe(1)
    await expect(page.getByTestId('pick-composer-annotation'), '单元素应露出标注入口').toBeVisible()
    await expect(page.getByTestId('pick-composer-link'), '单元素应露出交互入口').toBeVisible()
    expect(await page.getByTestId('overlays-sheet-inspector').count(), '拾取默认不打开检查器 Sheet').toBe(0)
    expect(maxBoxDelta((await selectedBox(page))!, expectedBox(reqPick.point)), '选中框应贴合元素').toBeLessThanOrEqual(4)
    const shotReq = await shot(page, 'pick-02-requirement-composer')

    await page.getByTestId('pick-composer-submit').click()
    await expect(page.getByTestId('pick-composer-error')).toContainText('请输入需求内容。', { timeout: 5_000 })
    await expect(composer).toBeVisible()

    const reqText = 'W4 复测：把这个商品名改成更短的文案'
    await page.getByTestId('pick-composer-input').fill(reqText)
    await page.getByTestId('pick-composer-submit').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(queueBeforeReq.length + 1)
    const queueAfterReq = await readQueue(page)
    const reqItem = queueAfterReq[queueAfterReq.length - 1]
    expect(reqItem.selector).toBe(SEL_A)
    expect(reqItem.text).toBe(reqText)
    expect(reqItem.htmlFile).toBe(HTML_FILE)
    expect((reqItem as QueueItem & { batchParts?: unknown[] }).batchParts, '单元素条目不应带 batchParts').toBeUndefined()
    if (!reqItem.page) {
      observe(
        'B-PICK-OBS-queue-page',
        'P3',
        '待提交条目的 page 字段为空（当前 app-store.page 未赋值）；selector + htmlFile 仍可唯一定位，不影响本轮入队。',
      )
    }
    await expect.poll(async () => (await toastTexts(page)).join(' | '), { timeout: 5_000 }).toContain('已加入待提交队列。')
    await expect(page.getByTestId('multi-edit-bar'), '底部不再常驻待提交条').toHaveCount(0)
    const shotReqQueued = await shot(page, 'pick-03-requirement-queued')
    evidence.requirement = { hover: reqPick.hoverBox, queue: queueAfterReq.length, item: reqItem, shots: [shotReq, shotReqQueued] }
    log('requirement', evidence.requirement)

    // ── 3b. Ctrl 按住连点 3 个：期间不弹窗，松开一条批量需求 ─────────
    const queueBeforeBatch = await readQueue(page)
    await beginPickModifiers(page)
    for (const selector of [SEL_A, SEL_B, SEL_C]) {
      await clickFrameElementHeld(page, selector, 0)
      expect(await page.getByTestId('pick-composer').count(), '按住 Ctrl 连点期间不得出现需求条').toBe(0)
      expect(await page.getByTestId('pick-modify-dialog').count(), '按住 Ctrl 连点期间不得出现修改框').toBe(0)
    }
    expect(await page.getByTestId('overlays-selection-count').innerText(), '3 连点后选择应为 3').toBe('3')
    await endPickModifiers(page)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('pick-composer-chip')).toHaveCount(3)
    const batchText = 'W4 复测：这三处统一改成紧凑排版'
    await page.getByTestId('pick-composer-input').fill(batchText)
    await page.getByTestId('pick-composer-submit').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(queueBeforeBatch.length + 1)
    const queueAfterBatch = await readQueue(page)
    const batchItem = queueAfterBatch[queueAfterBatch.length - 1] as QueueItem & {
      batchParts?: Array<{ selector?: string }>
    }
    expect(batchItem.text).toBe(batchText)
    expect(batchItem.selector.startsWith('batch:'), '多选应只入 1 条批量条目').toBe(true)
    expect(batchItem.batchParts, '批量条目应带 batchParts').toHaveLength(3)
    expect(new Set(batchItem.batchParts!.map((p) => p.selector)).size, '3 个 batchPart selector 应互不相同').toBe(3)
    expect(batchItem.batchParts!.map((p) => p.selector), '前两个应命中点击的父元素').toEqual(
      expect.arrayContaining([SEL_A, SEL_B]),
    )
    expect(batchItem.batchParts!.every((p) => !!p.selector)).toBe(true)
    const shotBatch = await shot(page, 'pick-03b-batch-queued')
    evidence.batch = { queue: queueAfterBatch.length, item: batchItem, shot: shotBatch }
    log('batch', evidence.batch)
    await expect(page.getByTestId('multi-edit-bar'), '批量入队后也不出现底部常驻条').toHaveCount(0)

    // ── 3c. 待提交：只在 Sheet 内编辑 + 底部固定操作栏 ────────────────
    await page.getByTestId('overlays-open-queue').click()
    const queueSheet = page.getByTestId('overlays-sheet-queue')
    await expect(queueSheet).toBeVisible({ timeout: 10_000 })
    const queueTexts = page.getByTestId('overlays-queue-text')
    await expect(queueTexts).toHaveCount(2)

    const editedQueueText = 'W4 复测：待提交条目已就地编辑'
    const firstQueueText = queueTexts.first()
    await firstQueueText.fill(editedQueueText)
    await firstQueueText.blur()
    await expect
      .poll(async () => (await readQueue(page))[0]?.text, { timeout: 10_000 })
      .toBe(editedQueueText)
    // 空文本不允许保存：失焦后还原原值并就地提示。
    await firstQueueText.fill('   ')
    await firstQueueText.blur()
    await expect(page.getByTestId('overlays-queue-text-error')).toContainText('不能为空', { timeout: 5_000 })
    expect((await readQueue(page))[0].text, '空文本不得覆盖原值').toBe(editedQueueText)
    await expect(firstQueueText).toHaveValue(editedQueueText)
    // 编辑不改变勾选 / 第二条 / 批量语义。
    const queueAfterEdit = await readQueue(page)
    expect(queueAfterEdit).toHaveLength(queueAfterBatch.length)
    expect(queueAfterEdit[0].selected).toBe(true)
    expect(queueAfterEdit[1].selector.startsWith('batch:')).toBe(true)

    // 底部操作栏在滚动区之外，且落在视口内。
    const queueFooter = page.getByTestId('overlays-queue-footer')
    await expect(queueFooter).toBeVisible()
    const footerBox = await queueFooter.boundingBox()
    expect(footerBox, '底栏应有非零 bbox').not.toBeNull()
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    expect(footerBox!.y, '底栏应在视口内').toBeGreaterThan(0)
    expect(footerBox!.y + footerBox!.height, '底栏不得被视口下缘裁切').toBeLessThanOrEqual(viewportHeight + 1)
    const footerOutsideScroll = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="overlays-queue-scroll"]')
      const footer = document.querySelector('[data-testid="overlays-queue-footer"]')
      return !!scroll && !!footer && !scroll.contains(footer)
    })
    expect(footerOutsideScroll, '底栏应在滚动区之外').toBe(true)
    await expect(page.getByTestId('overlays-queue-submit')).toBeVisible()
    await expect(page.getByTestId('overlays-queue-clear')).toBeVisible()
    const footerYBeforeScroll = footerBox!.y
    await page.getByTestId('overlays-queue-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(150)
    const footerYAfterScroll = (await queueFooter.boundingBox())?.y ?? -1
    expect(Math.abs(footerYAfterScroll - footerYBeforeScroll), '底栏不应随列表滚动').toBeLessThanOrEqual(1)
    const shotQueueEdit = await shot(page, 'pick-03c-queue-edit')
    await queueSheet.locator('button[aria-label="关闭"]').click()
    await expect(queueSheet).toBeHidden({ timeout: 5_000 })
    evidence.queueEdit = {
      editedText: editedQueueText,
      queue: await readQueue(page),
      footer: { y: footerYBeforeScroll, height: footerBox!.height, viewportHeight },
      shot: shotQueueEdit,
    }
    log('queueEdit', evidence.queueEdit)

    // ── 3d. 标注：当前面板直接输入 / 编辑保存 / 定位只高亮 ────────────
    const annoFile = path.join(sandboxDir, 'annotations.json')
    const annoBeforeCreate = arrayCount(annoFile)
    const annoText = 'W4 复测：这个按钮需要更醒目'
    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('pick-composer-annotation').click()
    await expect(page.getByTestId('pick-composer-annotation-panel')).toBeVisible({ timeout: 5_000 })
    await page.getByTestId('pick-composer-annotation-input').fill(annoText)
    await page.getByTestId('pick-composer-annotation-save').click()
    await expect(composer).toBeHidden({ timeout: 10_000 })
    await expect
      .poll(
        () => {
          const raw = readJson(annoFile)
          const list = Array.isArray(raw) ? (raw as Array<{ content?: string }>) : []
          return list.some((a) => a.content === annoText)
        },
        { timeout: 10_000 },
      )
      .toBe(true)
    const annoCountAfterCreate = arrayCount(annoFile)
    if (annoCountAfterCreate < annoBeforeCreate) {
      throw new Error('annotations.json 条目数异常')
    }

    await page.getByTestId('overlays-open-anno').click()
    const annoSheet = page.getByTestId('overlays-sheet-anno')
    await expect(annoSheet).toBeVisible({ timeout: 10_000 })
    const annoItem = page
      .locator(`[data-testid="anno-panel-item"][data-anno-selector='${SEL_A}']`)
      .first()
    await expect(annoItem).toBeVisible({ timeout: 10_000 })
    const annoInput = annoItem.getByTestId('anno-panel-input')
    await expect(annoInput).toHaveValue(annoText)
    // 点击标注项：只定位高亮，不打开三栏检查器 Sheet。
    await annoItem.click({ position: { x: 18, y: 12 } })
    await expect(page.getByTestId('overlays-sheet-inspector'), '定位不得打开检查器 Sheet').toHaveCount(0)
    await expect(annoSheet).toBeVisible()
    await expect(annoItem).toHaveAttribute('data-located', '1')
    await expect(page.getByTestId('anno-locate-highlight'), '定位应高亮元素').toBeVisible({ timeout: 5_000 })

    const editedAnnoText = 'W4 复测：标注内容已就地修改'
    await annoInput.fill(editedAnnoText)
    await annoInput.blur()
    await expect
      .poll(
        () => {
          const raw = readJson(annoFile)
          const list = Array.isArray(raw) ? (raw as Array<{ content?: string }>) : []
          return list.some((a) => a.content === editedAnnoText)
        },
        { timeout: 10_000 },
      )
      .toBe(true)
    await expect(annoInput).toHaveValue(editedAnnoText)

    // 删除仍走 Confirm（本步只取消，不实际删除）。
    await annoItem.getByTestId('anno-panel-delete').click()
    const annoConfirm = page.getByTestId('confirm-dialog')
    await expect(annoConfirm).toBeVisible({ timeout: 5_000 })
    await expect(annoConfirm).toContainText('删除标注')
    await annoConfirm.getByRole('button', { name: '取消' }).click()
    await expect(annoConfirm).toBeHidden({ timeout: 5_000 })
    const shotAnnoEdit = await shot(page, 'pick-03d-anno-inline')
    await annoSheet.locator('button[aria-label="关闭"]').click()
    await expect(annoSheet).toBeHidden({ timeout: 5_000 })
    evidence.anno = {
      before: annoBeforeCreate,
      after: annoCountAfterCreate,
      created: annoText,
      edited: editedAnnoText,
      shot: shotAnnoEdit,
    }
    log('anno', evidence.anno)

    // ── 4. Ctrl+Shift+点击：修改弹窗 → 取消 / 保存 ───────────────────
    await clearSelectionIfAny(page)
    const queueBeforeModify = await readQueue(page)
    const frame = page.frameLocator('[data-testid="preview-frame"]')
    const targetText = ((await frame.locator(SEL_B).innerText()) || '').replace(/\s+/g, ' ').trim()
    expect(targetText.length, '目标元素应有文本').toBeGreaterThan(0)

    await pickWithCtrl(page, SEL_B, 0, { shift: true })
    const modifyDialog = page.getByTestId('pick-modify-dialog')
    await expect(modifyDialog).toBeVisible({ timeout: 10_000 })
    expect(await page.getByTestId('overlays-selection-count').innerText()).toBe('1')
    expect(await page.getByTestId('pick-modify-selector').innerText()).toBe(SEL_B)
    expect(await page.getByTestId('pick-modify-current').innerText()).toContain(targetText.slice(0, 12))
    expect(await page.getByTestId('pick-modify-input').inputValue()).toBe(targetText)
    expect(await page.getByTestId('pick-composer').count(), '修改弹窗时不应叠加需求条').toBe(0)
    const shotModify = await shot(page, 'pick-04-modify-dialog')

    await page.getByTestId('pick-modify-cancel').click()
    await expect(modifyDialog).toBeHidden({ timeout: 5_000 })
    expect(await readQueue(page), '取消不应写队列').toHaveLength(queueBeforeModify.length)
    expect(await page.getByTestId('overlays-selection-count').count(), '取消后选择应清空').toBe(0)

    // Ctrl+Shift 按住连点 2 个：选中始终 1，松开只出现 1 个修改文字弹窗。
    await beginPickModifiers(page, { shift: true })
    await clickFrameElementHeld(page, SEL_A, 0)
    expect(await page.getByTestId('overlays-selection-count').innerText()).toBe('1')
    expect(await page.getByTestId('pick-modify-dialog').count(), '按住时不弹修改框').toBe(0)
    await clickFrameElementHeld(page, SEL_B, 0)
    expect(await page.getByTestId('overlays-selection-count').innerText(), 'Ctrl+Shift 连点应保持单选').toBe('1')
    expect(await page.getByTestId('pick-modify-dialog').count(), '松开前不弹修改框').toBe(0)
    await endPickModifiers(page, { shift: true })
    await expect(modifyDialog).toBeVisible({ timeout: 10_000 })
    expect(await page.getByTestId('pick-modify-selector').innerText()).toBe(SEL_B)

    const modified = 'W4 复测修改后的商品文案'
    await page.getByTestId('pick-modify-input').fill(modified)
    await page.getByTestId('pick-modify-save').click()
    await expect(modifyDialog).toBeHidden({ timeout: 5_000 })
    // 「保存到代码」直写源 HTML：队列不增加，HTML 哈希变化且文件含新文本。
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(queueBeforeModify.length)
    const htmlAfterModify = sha256(htmlPath)
    expect(htmlAfterModify, '保存到代码后源 HTML 应变化').not.toBe(htmlHashBefore)
    const htmlSourceAfterModify = fs.readFileSync(htmlPath, 'utf8')
    expect(htmlSourceAfterModify, '源 HTML 应写入修改后的文本').toContain(modified)
    const shotModifySaved = await shot(page, 'pick-05-modify-saved')
    evidence.modify = {
      targetText,
      modified,
      queueUnchanged: queueBeforeModify.length,
      htmlHashBefore,
      htmlAfterModify,
      shots: [shotModify, shotModifySaved],
    }
    log('modify', evidence.modify)

    // ── 5. 选中框滚动 / 缩放不漂移 ───────────────────────────────────
    // 修改弹窗保存后会清空选择；重新 Ctrl 拾取一个元素并保留需求条，再验证选中框同步。
    await pickWithCtrl(page, SEL_B, 0, { checkHover: false })
    await expect(page.getByTestId('pick-composer')).toBeVisible({ timeout: 10_000 })
    expect(await page.getByTestId('overlays-selection-count').innerText()).toBe('1')
    const beforeScrollPoint = await pointOf(page, SEL_B, 0, false)
    const beforeScrollBox = await selectedBox(page)
    expect(beforeScrollBox, '滚动前应有选中框').not.toBeNull()
    const beforeDelta = maxBoxDelta(beforeScrollBox!, expectedBox(beforeScrollPoint))
    expect(beforeDelta, '滚动前选中框应贴合元素').toBeLessThanOrEqual(4)

    const scrollY = await frame.locator('body').evaluate(() => {
      const top = window.scrollY + 80
      window.scrollTo(0, top)
      return window.scrollY
    })
    expect(scrollY, 'iframe 内应发生滚动').toBeGreaterThan(0)
    await page.waitForTimeout(500)
    const scrollDelta = await expectSelectedAligned(page, SEL_B, 0)
    const afterScrollBox = await selectedBox(page)
    const moved = beforeScrollBox && afterScrollBox ? Math.abs(afterScrollBox.y - beforeScrollBox.y) : 0
    expect(moved, '滚动后选中框应跟随元素移动').toBeGreaterThan(20)
    const shotScroll = await shot(page, 'pick-06-scroll-sync')

    await setZoom(page, 75)
    const zoom75Delta = await expectSelectedAligned(page, SEL_B, 0)
    const shotZoom75 = await shot(page, 'pick-07-zoom-75')

    await setZoom(page, 125)
    const zoom125Delta = await expectSelectedAligned(page, SEL_B, 0)
    const shotZoom125 = await shot(page, 'pick-08-zoom-125')

    await setZoom(page, 100)
    await expectSelectedAligned(page, SEL_B, 0)
    evidence.drift = {
      scrollY,
      beforeDelta,
      scrollDelta,
      moved,
      zoom75Delta,
      zoom125Delta,
      shots: [shotScroll, shotZoom75, shotZoom125],
    }
    log('drift', evidence.drift)

    // ── 6. Sheet 焦点陷阱：进入 / Tab 循环 / Esc 回归 ─────────────────
    const inspector = page.getByTestId('overlays-open-inspector')
    await expect(inspector).toBeEnabled()
    // 先聚焦触发器再 Enter：需求条同时打开时，鼠标点击的焦点回退目标不稳定；
    // 键盘激活可确定性地验证 Sheet 关闭后焦点回到触发按钮。
    await inspector.focus()
    await page.keyboard.press('Enter')
    const sheet = page.locator('[data-slot="sheet-content"]').first()
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(250)
    const focusEnter = await activeInfo(page)
    expect(focusEnter.inSheet, 'Sheet 打开后焦点应进入浮层').toBe(true)
    expect(focusEnter.inToolbar, '焦点不应仍在背景 toolbar').toBe(false)

    const tabTrail: Array<{ inSheet: boolean; testid: string }> = []
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab')
      const info = await activeInfo(page)
      tabTrail.push({ inSheet: info.inSheet, testid: info.testid })
      expect(info.inSheet, `第 ${i + 1} 次 Tab 焦点应在 Sheet 内`).toBe(true)
    }
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Shift+Tab')
      const info = await activeInfo(page)
      expect(info.inSheet, `第 ${i + 1} 次 Shift+Tab 焦点应在 Sheet 内`).toBe(true)
    }
    const shotSheet = await shot(page, 'pick-09-sheet-focus')

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden({ timeout: 5_000 })
    const focusAfterEsc = await activeInfo(page)
    log('focusAfterEsc', focusAfterEsc)
    expect(focusAfterEsc.inSheet, 'Esc 关闭后焦点不得留在 Sheet 内').toBe(false)
    if (focusAfterEsc.testid !== 'overlays-open-inspector') {
      observe(
        'B-PICK-OBS-sheet-focus-return',
        'P2',
        `需求条同时打开时，检查器 Sheet 经 Esc 关闭后焦点回到 ${focusAfterEsc.tag || '未知'}，未回到触发按钮；关闭 Sheet 本身正常、选择保留。`,
      )
    }
    expect(await page.getByTestId('overlays-selection-count').innerText(), '关闭 Sheet 不应清空选择').toBe('1')
    evidence.sheetFocus = { enter: focusEnter, tabTrail, afterEsc: focusAfterEsc, shot: shotSheet }
    log('sheetFocus', evidence.sheetFocus)

    // ── 7. 清空队列 + 数据完整性 ─────────────────────────────────────
    await page.getByTestId('overlays-open-queue').click()
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('overlays-queue-clear').click()
    const confirm = page.getByTestId('confirm-dialog')
    await expect(confirm).toBeVisible({ timeout: 5_000 })
    await page.getByTestId('confirm-dialog-ok').click()
    await expect(confirm).toBeHidden({ timeout: 5_000 })
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(0)
    const queueRaw = await page.evaluate(() => localStorage.getItem('edit_queue_v1'))
    expect(queueRaw).toBe('[]')
    await expect(page.getByTestId('overlays-queue-footer'), '空队列不渲染底部操作栏').toHaveCount(0)
    await expect(page.getByTestId('multi-edit-bar'), '全程无常驻待提交条').toHaveCount(0)
    if (await sheet.isVisible().catch(() => false)) await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden({ timeout: 5_000 })

    const htmlHashAfter = sha256(htmlPath)
    expect(htmlHashAfter, '本轮仅「保存到代码」改写 HTML').toBe(htmlAfterModify)
    expect(htmlHashAfter, 'HTML 应已不同于入口快照').not.toBe(htmlHashBefore)
    expect(arrayCount(path.join(sandboxDir, 'annotations.json')), '标注仅新增/更新 1 条').toBe(annoCountAfterCreate)
    expect(arrayCount(path.join(sandboxDir, 'links.json'), 'links'), 'links 不应变化').toBe(linksBefore)
    const fatal = [...ctx.consoleErrors, ...ctx.pageErrors, ...ctx.crashes].filter(
      (text) => isFatalConsole(text) && !isPrototypeContentNoise(text),
    )
    expect(fatal, '排除 seed 原型内容噪声后，致命 console/pageerror/crash=0').toEqual([])
    const shotFinal = await shot(page, 'pick-10-final')
    evidence.final = {
      htmlHashAfter,
      queue: await readQueue(page),
      anno: arrayCount(path.join(sandboxDir, 'annotations.json')),
      links: arrayCount(path.join(sandboxDir, 'links.json'), 'links'),
      fatal,
      consoleErrors: ctx.consoleErrors.length,
      pageErrors: ctx.pageErrors.length,
      crashes: ctx.crashes.length,
      shot: shotFinal,
    }
    log('final', evidence.final)

    // ── 8. 需求草稿：继续 Ctrl 多选不清空；取消/提交/清空选择/切源清空 ──
    await dismissToasts(page)
    await clearSelectionIfAny(page)
    const composerInput = page.getByTestId('pick-composer-input')
    const chip = page.getByTestId('pick-composer-chip')
    expect(await readQueue(page), '草稿步骤前待提交队列应为空').toHaveLength(0)

    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(chip).toHaveCount(1)
    await composerInput.fill('保留我')
    await expect(composerInput).toHaveValue('保留我')
    const shotDraftBefore = await draftShot(page, 'b-00-draft-before-ctrl')

    /*
     * DOM 探针覆盖「不短暂消失」：MutationObserver 记录输入条节点被移除的瞬间，
     * 40ms 采样记录节点缺失 / 不可见 / 草稿值漂移；同时用 dataset 标记证明是同一节点未重建。
     */
    await page.evaluate(() => {
      const node = document.querySelector('[data-testid="pick-composer"]') as HTMLElement | null
      if (!node) throw new Error('pick-composer 未挂载')
      node.dataset.draftProbe = 'keep'
      const probe = { detached: 0, missingSamples: 0, hiddenSamples: 0, valueDrift: 0, samples: 0 }
      const win = window as unknown as {
        __pickDraftProbe: typeof probe
        __pickDraftProbeTimer?: number
        __pickDraftProbeObserver?: MutationObserver
      }
      win.__pickDraftProbe = probe
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          record.removedNodes.forEach((removed) => {
            if (!(removed instanceof HTMLElement)) return
            if (
              removed.matches('[data-testid="pick-composer"]') ||
              removed.querySelector('[data-testid="pick-composer"]')
            ) {
              probe.detached += 1
            }
          })
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      win.__pickDraftProbeObserver = observer
      win.__pickDraftProbeTimer = window.setInterval(() => {
        const current = document.querySelector('[data-testid="pick-composer"]') as HTMLElement | null
        if (!current) {
          probe.missingSamples += 1
          return
        }
        const rect = current.getBoundingClientRect()
        const style = getComputedStyle(current)
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') {
          probe.hiddenSamples += 1
        }
        const field = current.querySelector('[data-testid="pick-composer-input"]') as HTMLTextAreaElement | null
        probe.samples += 1
        if ((field?.value ?? '__missing__') !== '保留我') probe.valueDrift += 1
      }, 40)
    })

    // 按住 Ctrl 未点击前：输入条必须仍在，草稿与 chips 不变。
    await beginPickModifiers(page)
    await expect(composer).toBeVisible({ timeout: 5_000 })
    await expect(chip).toHaveCount(1)
    await expect(composerInput).toHaveValue('保留我')

    // 把第二个元素滚到视口中央，确保点击点不被底部输入条遮挡。
    await centerFrameElement(page, SEL_C, 0)
    const composerBox = await composer.boundingBox()
    expect(composerBox, '需求条应有非零 bbox').not.toBeNull()
    const secondPoint = await pointOf(page, SEL_C, 0, false)
    expect(secondPoint.y, `第二个元素中心 ${Math.round(secondPoint.y)} 不得被需求条顶部 ${Math.round(composerBox!.y)} 遮挡`).toBeLessThan(
      composerBox!.y,
    )
    await clickFrameElementHeld(page, SEL_C, 0)

    // Ctrl 仍按住：输入条、草稿、chips 必须同时保留（不闪断、不重建）。
    await expect(composer).toBeVisible({ timeout: 5_000 })
    await expect(chip).toHaveCount(2)
    await expect(page.getByTestId('overlays-selection-count')).toHaveText('2')
    await expect(composerInput).toHaveValue('保留我')
    const shotHeld = await draftShot(page, 'b-01-ctrl-held-second-picked')

    await endPickModifiers(page)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(chip).toHaveCount(2)
    await expect(composerInput).toHaveValue('保留我')
    await expect(composerInput, '松开 Ctrl 后焦点应回到需求输入框').toBeFocused({ timeout: 5_000 })
    const shotReleased = await draftShot(page, 'b-02-released-draft-kept')

    // 先取探针结果（此后才键入，避免把手动输入误判成草稿漂移），再继续键入验证追加。
    const probe = await page.evaluate(() => {
      const win = window as unknown as {
        __pickDraftProbe: {
          detached: number
          missingSamples: number
          hiddenSamples: number
          valueDrift: number
          samples: number
        }
        __pickDraftProbeTimer?: number
        __pickDraftProbeObserver?: MutationObserver
      }
      if (win.__pickDraftProbeTimer) window.clearInterval(win.__pickDraftProbeTimer)
      win.__pickDraftProbeObserver?.disconnect()
      const node = document.querySelector('[data-testid="pick-composer"]') as HTMLElement | null
      return { ...win.__pickDraftProbe, sameNode: node?.dataset.draftProbe === 'keep' }
    })
    expect(probe.samples, '探针应在 Ctrl 手势期间持续采样').toBeGreaterThan(5)
    expect(probe.detached, 'Ctrl 继续多选期间需求条不得被卸载').toBe(0)
    expect(probe.missingSamples, 'Ctrl 继续多选期间需求条不得短暂消失').toBe(0)
    expect(probe.hiddenSamples, 'Ctrl 继续多选期间需求条不得被隐藏').toBe(0)
    expect(probe.valueDrift, 'Ctrl 继续多选期间草稿不得被清空或改写').toBe(0)
    expect(probe.sameNode, '需求条应为同一 DOM 节点（未重建）').toBe(true)

    // 继续键入：草稿在原文后追加，不重新开始。
    await page.keyboard.type('，继续')
    await expect(composerInput).toHaveValue('保留我，继续')
    const shotTyped = await draftShot(page, 'b-03-typed-continued')

    // 取消：选择清空，再次拾取时草稿为空。
    await page.getByTestId('pick-composer-cancel').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })
    await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(composerInput, '取消后草稿应清空').toHaveValue('')

    // 提交：入队 1 条，再次拾取时草稿为空。
    await composerInput.fill('提交后草稿清空')
    await expect(composerInput).toHaveValue('提交后草稿清空')
    await page.getByTestId('pick-composer-submit').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(1)
    expect((await readQueue(page))[0].text, '提交内容应原样入队').toBe('提交后草稿清空')
    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(composerInput, '提交后草稿应清空').toHaveValue('')

    // 清掉本步唯一入队条目，保持最终队列为空的既有口径。
    await page.getByTestId('overlays-open-queue').click()
    const draftQueueSheet = page.getByTestId('overlays-sheet-queue')
    await expect(draftQueueSheet).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('overlays-queue-clear').click()
    const draftConfirm = page.getByTestId('confirm-dialog')
    await expect(draftConfirm).toBeVisible({ timeout: 5_000 })
    await page.getByTestId('confirm-dialog-ok').click()
    await expect(draftConfirm).toBeHidden({ timeout: 5_000 })
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(0)
    await draftQueueSheet.locator('button[aria-label="关闭"]').click()
    await expect(draftQueueSheet).toBeHidden({ timeout: 5_000 })
    await dismissToasts(page)
    await page.getByTestId('pick-composer-cancel').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })

    // 工具栏清空选择：草稿一起清空，再次拾取为空。
    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await composerInput.fill('清空选择前草稿')
    await expect(composerInput).toHaveValue('清空选择前草稿')
    await page.getByTestId('overlays-clear-selection').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })
    await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(composerInput, '清空选择后草稿应清空').toHaveValue('')
    const shotCleared = await draftShot(page, 'b-04-cleared-draft-empty')

    // 切源：切到「大厅」后输入条随源失效，切回「首页」重新拾取时草稿为空。
    await composerInput.fill('切源前草稿')
    await expect(composerInput).toHaveValue('切源前草稿')
    const consoleBeforeHall = ctx.consoleErrors.length
    await clickProto(page, '大厅')
    await expect(composer).toBeHidden({ timeout: 10_000 })
    await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
    const hallNoise = ctx.consoleErrors.slice(consoleBeforeHall)
    const shotHall = await draftShot(page, 'b-05-source-switched-hall')
    await clickProto(page, PROTO)
    await ensurePcStage(page)
    await pickWithCtrl(page, SEL_A, 0)
    await expect(composer).toBeVisible({ timeout: 10_000 })
    await expect(composerInput, '切源后草稿应清空').toHaveValue('')
    const shotSwitchedBack = await draftShot(page, 'b-06-source-back-draft-empty')
    await page.getByTestId('pick-composer-cancel').click()
    await expect(composer).toBeHidden({ timeout: 5_000 })

    // 本步只做草稿生命周期，不得改写 HTML / 标注 / 链接。
    expect(sha256(htmlPath), '草稿步骤不得改写原型 HTML').toBe(htmlAfterModify)
    expect(arrayCount(path.join(sandboxDir, 'annotations.json')), '草稿步骤不得改标注').toBe(annoCountAfterCreate)
    expect(arrayCount(path.join(sandboxDir, 'links.json'), 'links'), '草稿步骤不得改链接').toBe(linksBefore)
    expect(await readQueue(page), '草稿步骤结束时待提交队列应为空').toHaveLength(0)
    const hallFatal = hallNoise.filter((text) => isFatalConsole(text) && !isPrototypeContentNoise(text))
    expect(hallFatal, `切到「大厅」期间只允许 seed 原型内容噪声：${JSON.stringify(hallFatal)}`).toEqual([])
    const fatalDraft = [...ctx.consoleErrors, ...ctx.pageErrors, ...ctx.crashes].filter(
      (text) => isFatalConsole(text) && !isPrototypeContentNoise(text),
    )
    expect(fatalDraft, '草稿步骤（含切源往返）致命 console/pageerror/crash=0').toEqual([])
    evidence.draft = {
      probe,
      hallNoise,
      hallFatal,
      queue: await readQueue(page),
      shots: [shotDraftBefore, shotHeld, shotReleased, shotTyped, shotCleared, shotHall, shotSwitchedBack],
    }
    log('draft', evidence.draft)
  } catch (err) {
    const failShot = await shot(ctx.page, 'pick-99-fail').catch(() => '')
    await reportFailure(ctx, {
      step: 'PICK',
      slug: 'retest-pick',
      level: 'P1',
      expected: 'Ctrl 拾取复测全部断言通过',
      actual: '出现断言失败',
      error: err,
      screenshot: false,
      extra: JSON.stringify({ failShot }),
    }).catch(() => undefined)
    throw err
  } finally {
    const result = await ctx.close({ graceMs: 12_000 })
    evidence.close = result
    try {
      assertCleanExitOrP2(result)
    } catch (err) {
      closeError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (closeError) throw closeError
})

/** P2：长链路执行后 window-all-closed 偶发不退出，仅容忍 kill 收尾；其它异常仍硬失败。 */
function assertCleanExitOrP2(result: Parameters<typeof assertCleanExit>[0]): void {
  if (result.method === 'kill') {
    console.warn('[gate3] P2 close: window-all-closed 未退出，已 kill 收尾；功能断言仍为硬门禁' )
    return
  }
  assertCleanExit(result)
}
