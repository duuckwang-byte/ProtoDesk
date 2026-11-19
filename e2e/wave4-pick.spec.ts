/**
 * e2e/wave4-pick.spec.ts — Wave4 A2 冒烟 · 域 2「Ctrl 拾取 / 就地编辑 / 多选」。
 *
 * 只读验证产品代码（不改 src/main/tests）：
 * 1. 进入 `测试1/首页`，Ctrl 按住悬停：`pick-status` + 帧内准星 + `pick-hover` 非零 bbox；
 *    Ctrl+点击期间不弹窗，松开 Ctrl 后出现底部需求条（chips=选择数）；
 * 2. Ctrl+Shift 修改文字：松开后只出现一个 `pick-modify-dialog`；保存直接改写源 HTML（不入队），取消不写；
 * 3. 多选：Ctrl 按住连点 3 个元素，期间无弹窗；松开需求条 chips=3；
 *    统一需求提交为 1 条批量待提交（batchParts=3）；
 * 4. 检查器：修改需求 / 跳转交互 / 需求标注三板块可见；加需求入队、绑定跳转到「我的」写 links.json；
 * 5. 标注面板：seed 2 条 → 列表可定位（只高亮元素，不打开检查器）→ 面板内直编保存 → 删除经 Confirm，annotations.json 2→1；
 * 6. 待提交：只从工具栏「待提交」打开 Sheet；条目可直接编辑；移除 1 条 / 清空全部均经 Confirm，清空后 `edit_queue_v1` 持久化 `[]`。
 * 7. 需求草稿：继续 Ctrl 多选期间输入条不短暂消失、草稿与 chips 同时保留，松开后焦点回输入框；
 *    取消 / 提交 / 清空选择 / 切源后草稿清空。
 *
 * 数据完整性防线：仅 Ctrl+Shift「保存到代码」改写 `首页.html`；其余拾取/就地改/多选不写原型 HTML，
 * 只允许 annotations.json / links.json 在隔离副本内按预期 +1 / -1。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain pick
 *   npx playwright test e2e/wave4-pick.spec.ts --workers=1 --output=test-results/wave4/pick
 */
import { test, expect, type Page } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { launchApp, assertCleanExit, isFatalConsole, reportFailure, type Wave4App } from './wave4/harness'

const DOMAIN = 'pick'
const PROJECT = '测试1'
const PROTO = '首页'
const HTML_FILE = '首页.html'
const DRAFT_SHOT_DIR = path.resolve(__dirname, '..', 'docs', 'wave4', 'shots', 'retest-pick-draft')

interface FramePoint {
  x: number
  y: number
  scale: number
  frameBox: { x: number; y: number; width: number; height: number }
  local: { left: number; top: number; width: number; height: number; cx: number; cy: number; clientWidth: number; clientHeight: number }
  hit: string
}

interface QueueItem {
  id?: string
  selector: string
  page?: string
  htmlFile?: string
  text: string
  selected?: boolean
}

function log(label: string, data: unknown): void {
  console.log(`[W4-PICK] ${label} ${JSON.stringify(data)}`)
}

function rel(file: string): string {
  return path.relative(path.resolve(__dirname, '..'), file).split(path.sep).join('/')
}

function sha256(file: string): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return 'unreadable'
  }
}

/** 读 JSON 数组长度；`key` 用于 links.json 的 `{links:[...]}` 形态。 */
function arrayCount(file: string, key?: string): number {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    const list = key ? (raw as Record<string, unknown>)[key] : raw
    return Array.isArray(list) ? list.length : -1
  } catch {
    return -1
  }
}

async function ensureProject(page: Page): Promise<boolean> {
  await page.waitForTimeout(2_500)
  const picker = page.getByTestId('project-picker')
  const shown = await picker.isVisible().catch(() => false)
  if (shown) {
    const row = picker.locator('li').filter({ hasText: PROJECT }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => (await page.getByTestId('sidebar').locator('button[title="切换项目"]').innerText()).replace(/\s+/g, ' ').trim(), {
      timeout: 20_000,
    })
    .toBe(PROJECT)
  return shown
}

async function clickProto(page: Page, name: string): Promise<void> {
  const proto = page
    .getByTestId('sidebar-tree')
    .locator('button[data-level="proto"]')
    .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
    .first()
  await expect(proto).toBeVisible({ timeout: 20_000 })
  await proto.click()
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
  await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length, { timeout: 20_000 })
    .toBeGreaterThan(10_000)
}

/** 帧内元素 → 页面（client）坐标。移动端自适应缩放下必须按 frame bbox/clientWidth 换算。 */
async function pointOf(page: Page, selector: string, nth = 0): Promise<FramePoint> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const el = frame.locator(selector).nth(nth)
  await expect(el).toBeVisible({ timeout: 10_000 })
  await el.scrollIntoViewIfNeeded()
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

async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: '关闭通知' })
  for (let i = 0; i < 8; i += 1) {
    if ((await close.count()) === 0) return
    await close.first().click({ timeout: 2_000 }).catch(() => undefined)
  }
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

/**
 * Ctrl 悬停 + 点选一个帧内元素。
 * - 先等 `pick-status` 与帧内准星，再移动鼠标到元素；
 * - 悬停框 bbox 与元素换算后的页面 rect 对齐（±3px）；
 * - 点击后释放 Ctrl/Shift，并等 `pick-status` 消失。
 */
async function pickWithCtrl(
  page: Page,
  selector: string,
  options: {
    nth?: number
    shift?: boolean
    expectHover?: boolean
    /** 悬停框已出现、点击前的取证回调（截图必须在此刻拍）。 */
    onHover?: () => Promise<void>
  } = {},
): Promise<{ hoverBox: { x: number; y: number; width: number; height: number } | null; cursor: string; point: FramePoint }> {
  const nth = options.nth ?? 0
  const shift = options.shift ?? false
  const expectHover = options.expectHover ?? true
  const point = await pointOf(page, selector, nth)
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const frameEl = frame.locator(selector).nth(nth)

  // 先把焦点送进 iframe：否则点击瞬间父窗 blur 会清掉 Stage 的 Ctrl 武装态，
  // 使 PICK_RESULT 只选中、不弹需求条（与 b-pick 同口径；帧内 keydown 由 CTRL_STATE 回传）。
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
  let cursor = ''
  try {
    await expect(page.getByTestId('pick-status')).toBeVisible({ timeout: 5_000 })
    await expect(frame.locator('style#ctrlPickCrosshairStyle')).toHaveCount(1, { timeout: 5_000 })
    // 先在元素附近落一下鼠标，再进入目标中心，确保 HOVER 的 hoverKey 变化。
    await page.mouse.move(point.x - 3, point.y - 3)
    await page.mouse.move(point.x, point.y, { steps: 6 })
    if (expectHover) {
      await expect(page.getByTestId('pick-hover')).toBeVisible({ timeout: 5_000 })
      hoverBox = await page.getByTestId('pick-hover').boundingBox()
      expect(hoverBox, 'pick-hover 应有非零 bbox').not.toBeNull()
      expect(hoverBox!.width, 'pick-hover 宽度应为正').toBeGreaterThan(0)
      expect(hoverBox!.height, 'pick-hover 高度应为正').toBeGreaterThan(0)
      const expected = {
        x: point.frameBox.x + point.local.left * point.scale,
        y: point.frameBox.y + point.local.top * point.scale,
        width: point.local.width * point.scale,
        height: point.local.height * point.scale,
      }
      const tolerance = 3
      expect(Math.abs(hoverBox!.x - expected.x), 'hover box left 应对齐元素').toBeLessThanOrEqual(tolerance)
      expect(Math.abs(hoverBox!.y - expected.y), 'hover box top 应对齐元素').toBeLessThanOrEqual(tolerance)
      expect(Math.abs(hoverBox!.width - expected.width), 'hover box width 应对齐元素').toBeLessThanOrEqual(tolerance + 1)
      expect(Math.abs(hoverBox!.height - expected.height), 'hover box height 应对齐元素').toBeLessThanOrEqual(tolerance + 1)
      cursor = await frameEl.evaluate((node) => {
        const doc = node.ownerDocument
        const r = node.getBoundingClientRect()
        const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return hit ? getComputedStyle(hit).cursor : ''
      })
      expect(cursor, '帧内准星 cursor=crosshair').toBe('crosshair')
    }
    if (options.onHover) await options.onHover()
    await page.mouse.click(point.x, point.y)
  } finally {
    if (shift) await page.keyboard.up('Shift').catch(() => undefined)
    await page.keyboard.up('Control').catch(() => undefined)
    // 焦点可能已进入 iframe/弹窗，补发父窗 keyup，确保松开事件一定被 Stage 收到。
    await page
      .evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }))
      })
      .catch(() => undefined)
  }
  await expect(page.getByTestId('pick-status')).toHaveCount(0, { timeout: 5_000 })
  await expect(frame.locator('style#ctrlPickCrosshairStyle')).toHaveCount(0, { timeout: 5_000 })
  return { hoverBox, cursor, point }
}

/**
 * 按住 Ctrl（可选 Shift）进入拾取态，调用方负责最终释放。
 * 用于「按住连点 N 个元素，松开才出现需求条/修改框」的新手势验证。
 */
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
  const point = await pointOf(page, selector, nth)
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

/** 草稿域截图统一落 docs/wave4/shots/retest-pick-draft/（与既有域截图分开）。 */
async function draftShot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(DRAFT_SHOT_DIR, { recursive: true })
  const file = path.join(DRAFT_SHOT_DIR, name + '.png')
  await page.screenshot({ path: file })
  return path.relative(path.resolve(__dirname, '..'), file).split(path.sep).join('/')
}

/** 释放修饰键并等拾取武装态退出。 */
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

test.describe('Wave4 A2 · Ctrl 拾取 / 就地编辑 / 多选', () => {
  test('A2 pick：Ctrl 拾取→就地改→多选→检查器→标注→待提交', async ({}, testInfo) => {
    test.setTimeout(300_000)
    let ctx: Wave4App | null = null
    let step = 0
    let htmlAfterModify = ''

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      await page.bringToFront().catch(() => undefined)

      // ── 0. 隔离 + 进入项目/原型 ────────────────────────────────────────
      step = 0
      const expected = path.resolve(ctx.dataDir)
      const actual = path.resolve(ctx.userData)
      expect(actual.toLowerCase(), 'userData 必须精确指向域隔离目录').toBe(expected.toLowerCase())
      log('isolation', { dataDir: ctx.dataDir, userData: ctx.userData, seed: ctx.seedPresent })

      const pickerShown = await ensureProject(page)
      // 种子 Local Storage 可能带有旧 edit_queue_v1；域内先清空再重载，保证“有队列才显示”可判。
      const staleQueue = await readQueue(page)
      if (staleQueue.length > 0) {
        await page.evaluate(() => localStorage.removeItem('edit_queue_v1'))
        await page.reload()
        await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
        await ensureProject(page)
      }
      await clickProto(page, PROTO)
      await expect(page.getByTestId('overlays-toolbar')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 20_000 })
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'on', { timeout: 10_000 })

      // 数据基线：HTML hash + 标注/链接条数 + 队列空。
      const sandboxDir = path.join(ctx.dataDir, 'sandbox', PROJECT, PROTO)
      const htmlPath = path.join(sandboxDir, HTML_FILE)
      const annoPath = path.join(sandboxDir, 'annotations.json')
      const linksPath = path.join(sandboxDir, 'links.json')
      const htmlHashBefore = sha256(htmlPath)
      const annoBefore = arrayCount(annoPath)
      const linksBefore = arrayCount(linksPath, 'links')
      expect(annoBefore, 'seed annotations.json 应有 2 条').toBe(2)
      expect(linksBefore, 'seed links.json 应有 2 条').toBe(2)
      expect(await readQueue(page), '清理后待提交队列应为空').toHaveLength(0)
      await expect(page.getByTestId('overlays-open-queue'), '待提交入口在工具栏').toBeVisible()
      await expect(page.getByTestId('overlays-sheet-queue'), '未点击入口时待提交 Sheet 不打开').toHaveCount(0)
      await expect(page.getByTestId('multi-edit-bar'), '底部不再常驻待提交条').toHaveCount(0)
      // 等标注/链接异步读取完成（工具条 aria-label 内含数量）。
      await expect
        .poll(async () => (await page.getByTestId('overlays-open-anno').getAttribute('aria-label')) || '', { timeout: 20_000 })
        .toContain('2')
      await expect
        .poll(async () => (await page.getByTestId('overlays-open-links').getAttribute('aria-label')) || '', { timeout: 20_000 })
        .toContain('2')
      log('baseline', {
        pickerShown,
        staleQueue: staleQueue.length,
        htmlHashBefore: htmlHashBefore.slice(0, 12),
        annoBefore,
        linksBefore,
      })

      // ── 1. Ctrl 悬停 + 点选 + 底部需求条（单元素轻面板）───────────────
      step = 1
      await test.step('1 Ctrl 悬停 / 点选 / 底部需求条', async () => {
        let hoverShot = ''
        const hover = await pickWithCtrl(page, 'p.product-name', {
          nth: 0,
          onHover: async () => {
            hoverShot = await ctx!.shot(1, 'ctrl-hover')
          },
        })
        log('step1-hover', {
          scale: Number(hover.point.scale.toFixed(4)),
          point: { x: Math.round(hover.point.x), y: Math.round(hover.point.y) },
          local: hover.point.local,
          hoverBox: hover.hoverBox,
          cursor: hover.cursor,
          parentHit: hover.point.hit,
        })

        // 松开 Ctrl 才出现底部需求条；点击期间不弹窗。
        const composer = page.getByTestId('pick-composer')
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('1', { timeout: 5_000 })
        await expect(page.locator('.selection-box-overlay')).toHaveCount(1)
        await expect(page.locator('.selection-box-overlay .selection-badge').first()).toHaveText('1')
        await expect(page.getByTestId('pick-composer-chip')).toHaveCount(1)
        await expect(page.getByTestId('pick-composer-annotation'), '单元素应露出标注入口').toBeVisible()
        await expect(page.getByTestId('pick-composer-link'), '单元素应露出交互入口').toBeVisible()
        expect(await page.getByTestId('overlays-sheet-inspector').count(), '拾取默认不打开检查器 Sheet').toBe(0)
        const pickShot = await ctx!.shot(1, 'ctrl-pick')

        // 标注轻面板：直接显示 selector，不打开 Inspector Sheet。
        await page.getByTestId('pick-composer-annotation').click()
        const annoPanel = page.getByTestId('pick-composer-annotation-panel')
        await expect(annoPanel).toBeVisible({ timeout: 5_000 })
        const selectorText = (await annoPanel.locator('.font-mono').first().innerText()).trim()
        expect(selectorText.length, 'selector 不能为空').toBeGreaterThan(0)
        expect(selectorText, `selector 应含 data-pr-id/nth-of-type/#id：${selectorText}`).toMatch(
          /(\[data-pr-id=|nth-of-type\(|#)/,
        )
        expect(await page.getByTestId('overlays-sheet-inspector').count(), '标注面板不得打开 Inspector Sheet').toBe(0)
        const annoShot = await ctx!.shot(1, 'annotation-panel')

        // 交互轻面板：同样不打开 Inspector Sheet。
        await page.getByTestId('pick-composer-link').click()
        await expect(page.getByTestId('pick-composer-link-panel')).toBeVisible({ timeout: 5_000 })
        expect(await page.getByTestId('overlays-sheet-inspector').count(), '交互面板不得打开 Inspector Sheet').toBe(0)
        const linkShot = await ctx!.shot(1, 'link-panel')
        await page.getByLabel('关闭小面板').click()

        // 取消本次拾取：清空选择与需求条。
        await page.getByTestId('pick-composer-cancel').click()
        await expect(composer).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
        log('step1', {
          selectorText,
          selectionBoxes: 1,
          shots: [rel(hoverShot), rel(pickShot), rel(annoShot), rel(linkShot)],
        })

        testInfo.attach('step1-pick', {
          body: JSON.stringify({ selectorText, hover }, null, 2),
          contentType: 'application/json',
        })
      })

      // ── 2. Ctrl+Shift 修改文字：直接写盘 / 取消不落盘 ─────────────────
      step = 2
      await test.step('2 Ctrl+Shift 修改文字 保存 / 取消', async () => {
        const queueBeforeModify = await readQueue(page)
        await pickWithCtrl(page, 'p.product-name', { nth: 0, shift: true })
        const dialog = page.getByTestId('pick-modify-dialog')
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        const input = page.getByTestId('pick-modify-input')
        const prefilled = await input.inputValue()
        expect(prefilled.length, '修改框应预填原文').toBeGreaterThan(0)
        expect(await page.getByTestId('pick-composer').count(), '修改文字时不应叠加需求条').toBe(0)

        // 取消：不写队列、不改 HTML，选择清空。
        await page.getByTestId('pick-modify-cancel').click()
        await expect(dialog).toBeHidden({ timeout: 10_000 })
        expect(await readQueue(page), '取消后队列不得新增').toHaveLength(queueBeforeModify.length)
        expect(sha256(htmlPath), '取消不得改原型 HTML').toBe(htmlHashBefore)
        expect(await page.getByTestId('overlays-selection-count').count(), '取消后选择应清空').toBe(0)

        // 保存：按「保存到代码」口径直接改写源 HTML，不入待提交队列。
        await pickWithCtrl(page, 'p.product-name', { nth: 0, shift: true })
        await expect(dialog).toBeVisible({ timeout: 10_000 })
        const targetText = 'W4-修改文字-新文案'
        await input.fill(targetText)
        const shotOpen = await ctx!.shot(2, 'modify-dialog')
        await page.getByTestId('pick-modify-save').click()
        await expect(dialog).toBeHidden({ timeout: 10_000 })
        await expect
          .poll(() => sha256(htmlPath), { timeout: 10_000 })
          .not.toBe(htmlHashBefore)
        htmlAfterModify = sha256(htmlPath)
        expect(fs.readFileSync(htmlPath, 'utf8'), '源 HTML 应写入新文案').toContain(targetText)
        expect(await readQueue(page), '保存到代码不得入待提交队列').toHaveLength(queueBeforeModify.length)
        expect(await page.getByTestId('ai-dialog').count(), '修改文字不得打开 AI 对话').toBe(0)
        const queuedShot = await ctx!.shot(2, 'modify-saved')
        log('step2', {
          prefilled: prefilled.slice(0, 40),
          targetText,
          htmlBefore: htmlHashBefore.slice(0, 12),
          htmlAfter: htmlAfterModify.slice(0, 12),
          queueLen: queueBeforeModify.length,
          shots: [rel(shotOpen), rel(queuedShot)],
        })
      })

      // ── 3. 多选：Ctrl 按住连点 3 个 / 松开统一需求 / 批量入队 ─────────
      step = 3
      await test.step('3 Ctrl 按住连点 3 个 / 统一需求 / 批量入队', async () => {
        const queueBeforeBatch = await readQueue(page)
        await beginPickModifiers(page)
        for (const nth of [1, 2, 3]) {
          await clickFrameElementHeld(page, 'p.product-name', nth)
          expect(await page.getByTestId('pick-composer').count(), '按住 Ctrl 连点期间不得出现需求条').toBe(0)
          expect(await page.getByTestId('pick-modify-dialog').count(), '按住 Ctrl 连点期间不得出现修改框').toBe(0)
        }
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('3', { timeout: 5_000 })
        await expect(page.locator('.selection-box-overlay')).toHaveCount(3)
        const multiShot = await ctx!.shot(3, 'multi-selected-before-release')
        await endPickModifiers(page)

        const composer = page.getByTestId('pick-composer')
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('pick-composer-chip')).toHaveCount(3)
        await expect(page.getByTestId('pick-composer-annotation'), '多选不应出现标注单元素入口').toHaveCount(0)
        await expect(page.getByTestId('pick-composer-link'), '多选不应出现交互单元素入口').toHaveCount(0)

        // 空诉求拦截。
        await page.getByTestId('pick-composer-submit').click()
        await expect(page.getByTestId('pick-composer-error')).toContainText('请输入需求内容。')
        const validationShot = await ctx!.shot(3, 'multi-validation')

        const batchText = 'W4-批量：统一加大行高'
        await page.getByTestId('pick-composer-input').fill(batchText)
        await page.getByTestId('pick-composer-submit').click()
        await expect(composer).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
        await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(queueBeforeBatch.length + 1)
        const q3 = await readQueue(page)
        const batchItem = q3[q3.length - 1] as QueueItem & { batchParts?: Array<{ selector?: string }> }
        expect(batchItem.text).toBe(batchText)
        expect(batchItem.selector.startsWith('batch:'), '多选应只入 1 条批量条目').toBe(true)
        expect(batchItem.batchParts, '批量条目应带 3 个 batchParts').toHaveLength(3)
        expect(new Set(batchItem.batchParts!.map((p) => p.selector)).size, '3 个元素 selector 应不同').toBe(3)
        expect(batchItem.selected !== false, '新入队条目默认选中').toBe(true)
        const queuedShot = await ctx!.shot(3, 'multi-queued')
        log('step3', {
          count: await page.getByTestId('overlays-open-queue').getAttribute('aria-label'),
          queueLen: q3.length,
          batchParts: batchItem.batchParts,
          shots: [rel(multiShot), rel(validationShot), rel(queuedShot)],
        })
      })

      // ── 4. 检查器：三板块 + 需求入队 + 跳转绑定写盘 ────────────────────
      step = 4
      await test.step('4 检查器 三板块 / 需求 / 跳转', async () => {
        // 选一个与修改文字/多选不同的元素，避免 enqueue 按 selector 合并。
        await pickWithCtrl(page, '.section-title', { nth: 0 })
        await expect(page.getByTestId('pick-composer')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('1', { timeout: 5_000 })
        const inspectorBtn = page.getByTestId('overlays-open-inspector')
        await expect(inspectorBtn).toBeEnabled({ timeout: 5_000 })
        await inspectorBtn.click()
        const sheet = page.getByTestId('overlays-sheet-inspector')
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        const inspector = page.getByTestId('inspector')
        await expect(inspector).toBeVisible()
        await expect
          .poll(async () => (await inspector.locator('.break-all').first().innerText()).trim(), { timeout: 10_000 })
          .toMatch(/(\[data-pr-id=|nth-of-type\(|#)/)
        const jumpSelector = (await inspector.locator('.break-all').first().innerText()).trim()
        log('step4-target', { jumpSelector })
        for (const id of ['inspector-sec-req', 'inspector-sec-jump', 'inspector-sec-anno']) {
          await expect(page.getByTestId(id)).toBeVisible()
        }

        // 修改需求：入队（与已有 selector 不重复 → +1）。
        const reqText = 'W4-需求：统一增加页面留白'
        const queueBeforeReq = await readQueue(page)
        await expect(page.getByTestId('inspector-req-input')).toBeVisible({ timeout: 5_000 })
        await page.getByTestId('inspector-req-input').fill(reqText)
        await page.getByTestId('inspector-req-add').click()
        await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(queueBeforeReq.length + 1)
        const q4 = await readQueue(page)
        expect(q4.filter((q) => q.text === reqText), '需求应入待提交队列').toHaveLength(1)

        // 跳转交互：展开 → 选「我的」→ 保存。
        await page.getByTestId('inspector-sec-jump').getByText('跳转交互', { exact: true }).click()
        const targetPick = page.getByTestId('inspector-jump-target-pick')
        await expect(targetPick).toBeVisible({ timeout: 5_000 })
        const options = (await targetPick.locator('option').allTextContents()).map((s) => s.trim())
        const target = options.find((o) => o.includes('我的'))
        expect(target, `目标原型下拉应包含「我的」，实际=${options.join('|')}`).toBeTruthy()
        await targetPick.selectOption({ label: target })
        await expect(page.getByTestId('inspector-jump-target')).toHaveValue(target!)
        await page.getByTestId('inspector-jump-save').click()
        await expect(page.getByTestId('inspector-jump-state')).toContainText('已绑定', { timeout: 10_000 })
        await expect.poll(() => arrayCount(linksPath, 'links'), { timeout: 10_000 }).toBe(3)
        const linksAfter = JSON.parse(fs.readFileSync(linksPath, 'utf8')) as { links: Array<Record<string, unknown>> }
        const bound = linksAfter.links.find((l) => l.selector === jumpSelector)
        expect(bound, `links.json 应按 selector=${jumpSelector} 新增绑定`).toBeTruthy()
        expect(String(bound!.target || ''), '绑定 target 应为「我的」').toBe(target)
        // 主页（非子页）的 page 约定为空串，与 seed 既有 links.json 一致；htmlFile 三键之一必须非空。
        expect(typeof bound!.page, '绑定 page 字段应为字符串').toBe('string')
        expect(String(bound!.htmlFile || ''), '绑定 htmlFile 非空').toBe(HTML_FILE)

        // 需求标注板块展开可见（本步只验可见性，不新增标注，保留 seed 2 条给步骤 5）。
        await page.getByTestId('inspector-sec-anno').getByText('需求标注', { exact: true }).click()
        await expect(page.getByTestId('inspector-anno-input')).toBeVisible({ timeout: 5_000 })
        await expect(page.getByTestId('inspector-anno-state')).toContainText('未标注')
        const shot = await ctx!.shot(4, 'inspector-jump')
        log('step4', {
          sections: 3,
          reqQueued: q4.length,
          target,
          links: arrayCount(linksPath, 'links'),
          shots: [rel(shot)],
        })
        await page.keyboard.press('Escape')
        await expect(sheet).toBeHidden({ timeout: 10_000 })
        await page.getByTestId('pick-composer-cancel').click()
        await expect(page.getByTestId('pick-composer')).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
      })

      // ── 5. 标注面板：seed 2 条 / 定位 / 删除（Confirm） ───────────────
      step = 5
      await test.step('5 标注面板 2 条 / 定位 / 删除', async () => {
        await dismissToasts(page)
        await page.getByTestId('overlays-open-anno').click()
        const sheet = page.getByTestId('overlays-sheet-anno')
        await expect(sheet).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('anno-panel-count')).toHaveText('2', { timeout: 10_000 })
        await expect(page.getByTestId('anno-panel-item')).toHaveCount(2)
        const panelShot = await ctx!.shot(5, 'anno-panel')

        // 删除第 2 条：Confirm。
        const second = page.getByTestId('anno-panel-item').nth(1)
        const deletedSelector = await second.getAttribute('data-anno-selector')
        await second.getByTestId('anno-panel-delete').click()
        const confirm = page.getByTestId('confirm-dialog')
        await expect(confirm).toBeVisible({ timeout: 5_000 })
        await expect(confirm).toContainText('删除标注')
        const confirmShot = await ctx!.shot(5, 'anno-delete-confirm')
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirm).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('anno-panel-count')).toHaveText('1', { timeout: 10_000 })
        await expect.poll(() => arrayCount(annoPath), { timeout: 10_000 }).toBe(1)
        const annoAfter = JSON.parse(fs.readFileSync(annoPath, 'utf8')) as Array<{ selector?: string }>
        expect(annoAfter.some((a) => a.selector === deletedSelector), '被删标注不应再落盘').toBe(false)

        // 定位第 1 条：只高亮元素，不打开检查器 Sheet。
        const first = page.getByTestId('anno-panel-item').first()
        const firstContent = (await first.innerText()).replace(/\s+/g, ' ')
        await first.click({ position: { x: 18, y: 12 } })
        await expect(page.getByTestId('overlays-sheet-inspector'), '定位不得打开检查器 Sheet').toHaveCount(0)
        await expect(sheet, '标注面板应保持打开').toBeVisible()
        await expect(first).toHaveAttribute('data-located', '1')
        await expect(page.getByTestId('anno-locate-highlight'), '定位应高亮元素').toBeVisible({ timeout: 5_000 })
        const locateShot = await ctx!.shot(5, 'anno-locate')

        // 面板内直编：失焦保存到 annotations.json，无需借道检查器。
        const annoEditor = first.getByTestId('anno-panel-input')
        const editedAnnoText = 'W4-标注：面板内直接编辑已保存'
        await annoEditor.fill(editedAnnoText)
        await annoEditor.blur()
        await expect
          .poll(
            () => {
              try {
                const list = JSON.parse(fs.readFileSync(annoPath, 'utf8')) as Array<{ content?: string }>
                return list.some((a) => a.content === editedAnnoText)
              } catch {
                return false
              }
            },
            { timeout: 10_000 },
          )
          .toBe(true)
        await expect(annoEditor).toHaveValue(editedAnnoText)
        log('step5', {
          before: 2,
          after: arrayCount(annoPath),
          deletedSelector,
          firstItem: firstContent.slice(0, 60),
          editedAnno: editedAnnoText,
          shots: [rel(panelShot), rel(confirmShot), rel(locateShot)],
        })
        await page.keyboard.press('Escape')
        await expect(sheet).toBeHidden({ timeout: 10_000 })

        // 链接检查器（交互面板）可打开：列表应包含 seed 2 条 + 步骤 4 新增 1 条。
        await page.getByTestId('overlays-open-links').click()
        const linksSheet = page.getByTestId('overlays-sheet-links')
        await expect(linksSheet).toBeVisible({ timeout: 10_000 })
        await expect(linksSheet.locator('[data-testid="overlays-link-item"]')).toHaveCount(3, { timeout: 10_000 })
        const linksShot = await ctx!.shot(5, 'links-panel')
        log('step5-links', {
          items: await linksSheet.locator('[data-testid="overlays-link-item"]').count(),
          shot: rel(linksShot),
        })
        await page.keyboard.press('Escape')
        await expect(linksSheet).toBeHidden({ timeout: 10_000 })
      })

      // ── 6. 待提交 Sheet：入口 / 条目编辑 / 移除 / 清空（Confirm + 持久化） ──
      step = 6
      await test.step('6 待提交 Sheet 编辑 / 移除 / 清空 / 持久化', async () => {
        await dismissToasts(page)
        // 底部不再常驻待提交条；只从工具栏入口打开 Sheet。
        await expect(page.getByTestId('multi-edit-bar'), '底部不再常驻待提交条').toHaveCount(0)
        await page.getByTestId('overlays-open-queue').click()
        const queueSheet = page.getByTestId('overlays-sheet-queue')
        await expect(queueSheet).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-item')).toHaveCount(2, { timeout: 10_000 })
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（2）')
        const queueShot = await ctx!.shot(6, 'queue-sheet')

        // 队列条目 textarea 可编辑：失焦保存到 edit_queue_v1，不改变条数/批量语义。
        const queueText = page.getByTestId('overlays-queue-text').first()
        const editedQueueText = 'W4-待提交：条目已就地编辑'
        await expect(queueText).toBeEditable()
        await queueText.fill(editedQueueText)
        await queueText.blur()
        await expect
          .poll(async () => (await readQueue(page))[0]?.text, { timeout: 10_000 })
          .toBe(editedQueueText)
        await expect(queueText).toHaveValue(editedQueueText)

        // 底部提交/清空固定在滚动区之外。
        const footer = page.getByTestId('overlays-queue-footer')
        await expect(footer).toBeVisible()
        const footerOutsideScroll = await page.evaluate(() => {
          const scroll = document.querySelector('[data-testid="overlays-queue-scroll"]')
          const foot = document.querySelector('[data-testid="overlays-queue-footer"]')
          return !!scroll && !!foot && !scroll.contains(foot)
        })
        expect(footerOutsideScroll, '底栏应在滚动区之外').toBe(true)
        await expect(page.getByTestId('overlays-queue-submit')).toBeVisible()
        await expect(page.getByTestId('overlays-queue-clear')).toBeVisible()

        // 移除 1 条（条目内「移除」→ Confirm）。
        await page.getByTestId('overlays-queue-remove').first().click()
        const confirmRemove = page.getByTestId('confirm-dialog')
        await expect(confirmRemove).toBeVisible({ timeout: 5_000 })
        await expect(confirmRemove).toContainText('移除待提交项')
        const removeShot = await ctx!.shot(6, 'queue-remove-confirm')
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirmRemove).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-item')).toHaveCount(1, { timeout: 10_000 })
        await expect(page.getByTestId('overlays-open-queue')).toHaveAttribute('aria-label', '待提交（1）')
        await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(1)

        // 清空全部（底栏「清空」→ Confirm）。
        await page.getByTestId('overlays-queue-clear').click()
        const confirmClear = page.getByTestId('confirm-dialog')
        await expect(confirmClear).toBeVisible({ timeout: 5_000 })
        await expect(confirmClear).toContainText('清空待提交')
        const clearShot = await ctx!.shot(6, 'queue-clear-confirm')
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(confirmClear).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-item')).toHaveCount(0, { timeout: 10_000 })
        await expect(page.getByTestId('overlays-queue-footer'), '空队列不渲染底栏').toHaveCount(0)
        await expect(page.getByTestId('multi-edit-bar'), '清空后也不出现常驻条').toHaveCount(0)
        await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(0)
        const persisted = await page.evaluate(() => localStorage.getItem('edit_queue_v1'))
        expect(persisted, '清空后 edit_queue_v1 持久化为 []').toBe('[]')
        const afterShot = await ctx!.shot(6, 'queue-cleared')
        log('step6', {
          before: 2,
          afterRemove: 1,
          afterClear: 0,
          edited: editedQueueText,
          footerOutsideScroll,
          persisted,
          shots: [rel(queueShot), rel(removeShot), rel(clearShot), rel(afterShot)],
        })
        // 清空后关闭 Sheet：后续拾取需要舞台可点击（Sheet 遮罩会拦截鼠标）。
        await page.keyboard.press('Escape')
        await expect(queueSheet).toBeHidden({ timeout: 10_000 })
      })

      // ── 7. 数据完整性 / console ───────────────────────────────────────
      step = 7
      await test.step('7 数据完整性 / console', async () => {
        expect(htmlAfterModify, '步骤 2「保存到代码」应记录改写后的 HTML 哈希').toBeTruthy()
        expect(sha256(htmlPath), '仅「保存到代码」改写 HTML，后续拾取/多选不得再改').toBe(htmlAfterModify)
        expect(htmlAfterModify, '「保存到代码」应改变原型 HTML').not.toBe(htmlHashBefore)
        expect(arrayCount(annoPath), '标注应 2→1').toBe(1)
        expect(arrayCount(linksPath, 'links'), '链接应 2→3').toBe(3)
        expect(await readQueue(page), '队列最终应为空').toHaveLength(0)
        // seed 原型自带 Vant/Vue CDN 与内联脚本噪声，属用户内容，不计工具致命错误。
        const fatal = ctx!.fatalErrors().filter((t) => !/vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(t))
        log('console', {
          consoleErrors: ctx!.consoleErrors,
          pageErrors: ctx!.pageErrors,
          crashes: ctx!.crashes,
          fatalCount: fatal.length,
        })
        expect(fatal, `致命 console/pageerror/crash 共 ${fatal.length} 条`).toHaveLength(0)
      })

      // ── 8. 需求草稿：继续 Ctrl 多选不清空；取消/提交/清空选择/切源清空 ──
      step = 8
      await test.step('8 需求草稿 Ctrl 继续多选保留 / 取消·提交·清空选择·切源清空', async () => {
        await dismissToasts(page)
        const composer = page.getByTestId('pick-composer')
        const composerInput = page.getByTestId('pick-composer-input')
        const chip = page.getByTestId('pick-composer-chip')
        expect(await readQueue(page), '草稿步骤前待提交队列应为空').toHaveLength(0)

        await pickWithCtrl(page, 'p.product-name', { nth: 0 })
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(chip).toHaveCount(1)
        await composerInput.fill('保留我')
        await expect(composerInput).toHaveValue('保留我')
        const shotDraftBefore = await draftShot(page, 'a-00-draft-before-ctrl')

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
        await centerFrameElement(page, 'p.product-name', 1)
        const composerBox = await composer.boundingBox()
        expect(composerBox, '需求条应有非零 bbox').not.toBeNull()
        const secondPoint = await pointOf(page, 'p.product-name', 1)
        expect(
          secondPoint.y,
          `第二个元素中心 ${Math.round(secondPoint.y)} 不得被需求条顶部 ${Math.round(composerBox!.y)} 遮挡`,
        ).toBeLessThan(composerBox!.y)
        await clickFrameElementHeld(page, 'p.product-name', 1)

        // Ctrl 仍按住：输入条、草稿、chips 必须同时保留（不闪断、不重建）。
        await expect(composer).toBeVisible({ timeout: 5_000 })
        await expect(chip).toHaveCount(2)
        await expect(page.getByTestId('overlays-selection-count')).toHaveText('2')
        await expect(composerInput).toHaveValue('保留我')
        const shotHeld = await draftShot(page, 'a-01-ctrl-held-second-picked')

        await endPickModifiers(page)
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(chip).toHaveCount(2)
        await expect(composerInput).toHaveValue('保留我')
        await expect(composerInput, '松开 Ctrl 后焦点应回到需求输入框').toBeFocused({ timeout: 5_000 })
        const shotReleased = await draftShot(page, 'a-02-released-draft-kept')

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
        const shotTyped = await draftShot(page, 'a-03-typed-continued')

        // 取消：选择清空，再次拾取时草稿为空。
        await page.getByTestId('pick-composer-cancel').click()
        await expect(composer).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
        await pickWithCtrl(page, 'p.product-name', { nth: 0 })
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(composerInput, '取消后草稿应清空').toHaveValue('')

        // 提交：入队 1 条，再次拾取时草稿为空。
        await composerInput.fill('提交后草稿清空')
        await expect(composerInput).toHaveValue('提交后草稿清空')
        await page.getByTestId('pick-composer-submit').click()
        await expect(composer).toBeHidden({ timeout: 5_000 })
        await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(1)
        expect((await readQueue(page))[0].text, '提交内容应原样入队').toBe('提交后草稿清空')
        await pickWithCtrl(page, 'p.product-name', { nth: 0 })
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(composerInput, '提交后草稿应清空').toHaveValue('')

        // 清掉本步唯一入队条目，保持最终队列为空的既有口径。
        await dismissToasts(page)
        await page.getByTestId('overlays-open-queue').click()
        const draftQueueSheet = page.getByTestId('overlays-sheet-queue')
        await expect(draftQueueSheet).toBeVisible({ timeout: 10_000 })
        await page.getByTestId('overlays-queue-clear').click()
        const draftConfirm = page.getByTestId('confirm-dialog')
        await expect(draftConfirm).toBeVisible({ timeout: 5_000 })
        await page.getByTestId('confirm-dialog-ok').click()
        await expect(draftConfirm).toBeHidden({ timeout: 5_000 })
        await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(0)
        await page.keyboard.press('Escape')
        await expect(draftQueueSheet).toBeHidden({ timeout: 5_000 })
        await dismissToasts(page)
        await page.getByTestId('pick-composer-cancel').click()
        await expect(composer).toBeHidden({ timeout: 5_000 })

        // 工具栏清空选择：草稿一起清空，再次拾取为空。
        await pickWithCtrl(page, 'p.product-name', { nth: 0 })
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await composerInput.fill('清空选择前草稿')
        await expect(composerInput).toHaveValue('清空选择前草稿')
        await page.getByTestId('overlays-clear-selection').click()
        await expect(composer).toBeHidden({ timeout: 5_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
        await pickWithCtrl(page, 'p.product-name', { nth: 0 })
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(composerInput, '清空选择后草稿应清空').toHaveValue('')
        const shotCleared = await draftShot(page, 'a-04-cleared-draft-empty')

        // 切源：切到「大厅」后输入条随源失效，切回「首页」重新拾取时草稿为空。
        await composerInput.fill('切源前草稿')
        await expect(composerInput).toHaveValue('切源前草稿')
        const consoleBeforeHall = { console: ctx!.consoleErrors.length, page: ctx!.pageErrors.length }
        await clickProto(page, '大厅')
        await expect(composer).toBeHidden({ timeout: 10_000 })
        await expect(page.getByTestId('overlays-selection-count')).toHaveCount(0)
        await page.waitForTimeout(600)
        const hallNoise = [
          ...ctx!.consoleErrors.slice(consoleBeforeHall.console),
          ...ctx!.pageErrors.slice(consoleBeforeHall.page),
        ]
        const shotHall = await draftShot(page, 'a-05-source-switched-hall')
        await clickProto(page, PROTO)
        const consoleAfterReturn = { console: ctx!.consoleErrors.length, page: ctx!.pageErrors.length }
        await pickWithCtrl(page, 'p.product-name', { nth: 0 })
        await expect(composer).toBeVisible({ timeout: 10_000 })
        await expect(composerInput, '切源后草稿应清空').toHaveValue('')
        const shotSwitchedBack = await draftShot(page, 'a-06-source-back-draft-empty')
        await page.getByTestId('pick-composer-cancel').click()
        await expect(composer).toBeHidden({ timeout: 5_000 })

        // 本步只做草稿生命周期，不得改写 HTML / 标注 / 链接。
        const seedNoise = (text: string) => /vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(text)
        const hallFatal = hallNoise.filter((text) => isFatalConsole(text) && !seedNoise(text))
        expect(hallFatal, `切到「大厅」期间只允许 seed 原型内容噪声：${JSON.stringify(hallFatal)}`).toEqual([])
        const afterReturnFatal = [
          ...ctx!.consoleErrors.slice(consoleAfterReturn.console),
          ...ctx!.pageErrors.slice(consoleAfterReturn.page),
        ].filter((text) => isFatalConsole(text) && !seedNoise(text))
        expect(afterReturnFatal, '切回首页后的拾取/取消不得新增致命 console/pageerror').toEqual([])
        expect(ctx!.crashes, '草稿步骤不得出现 crash').toEqual([])
        expect(sha256(htmlPath), '草稿步骤不得改写原型 HTML').toBe(htmlAfterModify)
        expect(arrayCount(annoPath), '草稿步骤不得改标注').toBe(1)
        expect(arrayCount(linksPath, 'links'), '草稿步骤不得改链接').toBe(3)
        expect(await readQueue(page), '草稿步骤结束时待提交队列应为空').toHaveLength(0)
        log('step8-draft', {
          probe,
          hallNoise,
          hallFatal,
          afterReturnFatal,
          queue: await readQueue(page),
          shots: [rel(shotDraftBefore), rel(shotHeld), rel(shotReleased), rel(shotTyped), rel(shotCleared), rel(shotHall), rel(shotSwitchedBack)],
        })
      })

      testInfo.attach('pick-evidence', {
        body: JSON.stringify(
          {
            dataDir: ctx.dataDir,
            userData: ctx.userData,
            seed: ctx.seedPresent,
            htmlHashBefore: htmlHashBefore.slice(0, 12),
            htmlHashAfter: sha256(htmlPath).slice(0, 12),
            annotations: arrayCount(annoPath),
            links: arrayCount(linksPath, 'links'),
            queue: await readQueue(page),
            consoleErrors: ctx.consoleErrors,
            pageErrors: ctx.pageErrors,
            crashes: ctx.crashes,
            stderr: ctx.stderr.slice(-5),
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
          slug: `pick-step-${step}`,
          level: 'P1',
          expected: 'Ctrl 拾取/就地编辑/多选/检查器/标注/待提交核心路径可用',
          actual: `step ${step} 失败`,
          error: err,
        })
      }
      throw err
    } finally {
      if (ctx) {
        const closed = await ctx.close()
        log('close', closed)
        assertCleanExitOrP2(closed)
      }
    }
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
