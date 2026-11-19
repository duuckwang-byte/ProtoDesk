/**
 * e2e/wave4-mobile-viewport.spec.ts — Wave5 修订复测 · 移动端视口（domain mobile-viewport）。
 *
 * W5 口径（CSS zoom + 动态视口高）：
 *   1. 进入移动端默认展开侧栏并打开文档（不再自动收起）；切回 PC 关闭文档、侧栏保留；
 *      移动端文档 z-40 低于 Dialog/Sheet（z-50），新建子页弹窗可见可输入；
 *   2. 默认「适宽」：手机壳占满可用高，视口高 = 壳可视高 ÷ 比例（动态），
 *      内容高精确吃满可视高 → 壳内无纵向滚动、底部常驻可见；滚轮被原型（iframe）
 *      内部消费；外层窗口无滚动；正文逻辑字号（375 逻辑宽）不小于 12px；
 *   3. 模式切换 全貌 / 适宽 / 100 / 125 / custom：顶栏与舞台读数一致；
 *      全貌仍是 375×780 参考机整体 fit；非全貌模式壳内均无纵向滚动、
 *      帧内视口高（innerHeight）随壳可视高反缩（真机语义）；
 *   4. 缩放机制：stage-viewport 走 CSS zoom（transform 保持 none）；
 *      小地图只在壳内真实纵向溢出时显示（动态视口高下各模式均不显示）；
 *   5. console / pageerror / crash 汇总。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain mobile-viewport --force
 *   npx playwright test e2e/wave4-mobile-viewport.spec.ts --workers=1 --output=test-results/wave4/mobile-viewport
 */
import { test, expect } from '@playwright/test'
import * as path from 'node:path'
import { launchApp, assertCleanExit, isFatalConsole, reportFailure, type Wave4App } from './wave4/harness'

const DOMAIN = 'mobile-viewport'
const MOBILE_W = 375

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface MobileSnapshot {
  kind: string | null
  mode: string | null
  fit: string | null
  topbar: string | null
  stage: string | null
  fitPressed: string | null
  viewport: {
    styleW: string
    styleH: string
    bboxW: number
    bboxH: number
    transform: string
    zoom: string
  } | null
  area: Rect | null
  shell: Rect | null
  overview: Rect | null
  scroll: {
    scrollTop: number
    scrollLeft: number
    scrollHeight: number
    clientHeight: number
    scrollWidth: number
    clientWidth: number
  } | null
  minimap: {
    visible: boolean
    track: Rect | null
    thumbTop: number | null
    thumbHeight: number | null
    ariaValue: string | null
  }
  outer: {
    innerWidth: number
    innerHeight: number
    docScrollHeight: number
    docClientHeight: number
    bodyScrollHeight: number
    scrollY: number
  }
}

function log(label: string, data: unknown): void {
  console.log(`[W4-MOBILE] ${label} ${JSON.stringify(data)}`)
}

function relShot(abs: string): string {
  return path.relative(path.resolve(__dirname, '..'), abs).split(path.sep).join('/')
}

function percentOf(label: string | null): number | null {
  if (!label) return null
  const m = /^(\d+)%$/.exec(label)
  return m ? Number(m[1]) : null
}

function rectOf(el: Element | null): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

async function readMobile(page: Wave4App['page']): Promise<MobileSnapshot> {
  return page.evaluate(() => {
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
    const vp = q('stage-viewport')
    const frame = q('stage-frame')
    const fitToggle = q('topbar-fit-toggle')
    const area = q('stage-mobile-area')
    const shell = q('stage-mobile-shell')
    const overview = q('stage-mobile-overview')
    const scroll = q('stage-mobile-scroll')
    const minimap = q('mobile-minimap')
    const track = q('mobile-minimap-track')
    const thumb = q('mobile-minimap-thumb')
    const doc = document.documentElement
    const rect = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const finite = (n: number) => (Number.isFinite(n) ? n : -1)
    return {
      kind: frame ? frame.getAttribute('data-kind') : null,
      mode: frame ? frame.getAttribute('data-mobile-mode') : null,
      fit: frame ? frame.getAttribute('data-fit') : null,
      topbar: (q('topbar-zoom-readout')?.textContent || '').trim() || null,
      stage: (q('stage-zoom-readout')?.textContent || '').trim() || null,
      fitPressed: fitToggle ? fitToggle.getAttribute('aria-pressed') : null,
      viewport: vp
        ? {
            styleW: vp.style.width,
            styleH: vp.style.height,
            bboxW: Math.round(vp.getBoundingClientRect().width * 1000) / 1000,
            bboxH: Math.round(vp.getBoundingClientRect().height * 1000) / 1000,
            transform: getComputedStyle(vp).transform,
            zoom: getComputedStyle(vp).zoom,
          }
        : null,
      area: rect(area),
      shell: rect(shell),
      overview: rect(overview),
      scroll: scroll
        ? {
            scrollTop: scroll.scrollTop,
            scrollLeft: scroll.scrollLeft,
            scrollHeight: scroll.scrollHeight,
            clientHeight: scroll.clientHeight,
            scrollWidth: scroll.scrollWidth,
            clientWidth: scroll.clientWidth,
          }
        : null,
      minimap: {
        visible: !!minimap && minimap.getBoundingClientRect().width > 0,
        track: rect(track),
        thumbTop: thumb ? finite(parseFloat(thumb.style.top || 'NaN')) : null,
        thumbHeight: thumb ? finite(parseFloat(thumb.style.height || 'NaN')) : null,
        ariaValue: track ? track.getAttribute('aria-valuenow') : null,
      },
      outer: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        docScrollHeight: doc.scrollHeight,
        docClientHeight: doc.clientHeight,
        bodyScrollHeight: document.body.scrollHeight,
        scrollY: window.scrollY,
      },
    }
  })
}

/** 等顶栏/舞台读数稳定为同值百分比。 */
async function waitStableReadout(page: Wave4App['page']): Promise<MobileSnapshot> {
  await expect
    .poll(
      async () => {
        const z = await readMobile(page)
        if (!z.topbar || !z.stage) return 'missing'
        if (!/^\d+%$/.test(z.topbar) || !/^\d+%$/.test(z.stage)) return 'pending'
        return z.topbar === z.stage ? z.topbar : `mismatch:${z.topbar}/${z.stage}`
      },
      { timeout: 10_000, message: '移动端顶栏/舞台读数应稳定为同一个百分比' },
    )
    .toMatch(/^\d+%$/)
  return readMobile(page)
}

async function selectMode(page: Wave4App['page'], mode: string): Promise<MobileSnapshot> {
  await page.getByLabel('移动端视图模式').selectOption(mode)
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-mobile-mode', mode, { timeout: 10_000 })
  return waitStableReadout(page)
}

async function frameTextStats(page: Wave4App['page']): Promise<{
  bodyFont: number
  minFont: number
  minSamples: Array<{ text: string; size: number; tag: string }>
  textLen: number
}> {
  return page
    .frameLocator('[data-testid="preview-frame"]')
    .locator('body')
    .evaluate((body) => {
      const samples: Array<{ text: string; size: number; tag: string }> = []
      const all = Array.from(body.querySelectorAll<HTMLElement>('*'))
      for (const el of all) {
        const direct = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => String(n.textContent || '').trim())
          .join('')
        if (!direct) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') continue
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) continue
        samples.push({ text: direct.slice(0, 24), size: parseFloat(cs.fontSize), tag: el.tagName.toLowerCase() })
      }
      const sizes = samples.map((s) => s.size).filter((n) => Number.isFinite(n) && n > 0)
      sizes.sort((a, b) => a - b)
      return {
        bodyFont: parseFloat(getComputedStyle(body).fontSize),
        minFont: sizes.length ? sizes[0] : -1,
        minSamples: samples
          .filter((s) => s.size === sizes[0])
          .slice(0, 5)
          .map((s) => ({ text: s.text, size: s.size, tag: s.tag })),
        textLen: String(body.innerText || '').trim().length,
      }
    })
}

async function setShellScroll(page: Wave4App['page'], top: number): Promise<void> {
  await page.getByTestId('stage-mobile-scroll').evaluate((el, value) => {
    ;(el as HTMLElement).scrollTop = value
  }, top)
  await page.waitForTimeout(250)
}

/** 帧内视口（iframe 自己的 innerWidth/innerHeight，逻辑像素）：动态视口高的真机语义证据。 */
async function readFrameViewport(page: Wave4App['page']): Promise<{ innerWidth: number; innerHeight: number }> {
  return page
    .frameLocator('[data-testid="preview-frame"]')
    .locator('body')
    .evaluate(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }))
}

async function ensureSidebar(page: Wave4App['page']): Promise<void> {
  if (await page.getByTestId('sidebar').isVisible().catch(() => false)) return
  await page.locator('button[title="展开侧栏"]').first().click()
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
}

async function openProjectAndHome(page: Wave4App['page']): Promise<{ pickerShown: boolean; restored: string }> {
  await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(2_500)
  const picker = page.getByTestId('project-picker')
  const pickerShown = await picker.isVisible().catch(() => false)
  if (pickerShown) {
    const row = picker.locator('li').filter({ hasText: '测试1' }).first()
    await row.waitFor({ state: 'visible', timeout: 15_000 })
    await row.getByRole('button').first().click()
    await picker.getByRole('button', { name: '进入项目' }).click()
    await expect(picker).toBeHidden({ timeout: 30_000 })
  }
  const restored = (await page.getByTestId('loc-pill').innerText()).replace(/\s+/g, ' ').trim()
  // 启动会自动恢复上次原型（seed 里可能是移动端「大厅」），移动端默认展开侧栏；
  // ensureSidebar 只在上次会话手动收起时兜底展开，随后切到「首页」。
  await ensureSidebar(page)
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
  const home = page
    .getByTestId('sidebar')
    .locator('button[data-level="proto"]')
    .filter({ hasText: /^\s*首页\s*$/ })
    .first()
  await expect(home).toBeVisible({ timeout: 20_000 })
  await home.click()
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
  return { pickerShown, restored }
}

test.describe('Wave4 修复后复测 · 移动端视口', () => {
  test('移动端视口：适宽/全貌/100/125/custom + 动态视口高 + CSS zoom 缩放机制', async ({}, testInfo) => {
    test.setTimeout(300_000)
    let ctx: Wave4App | null = null
    let step = 0

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page
      expect(path.resolve(ctx.userData).toLowerCase()).toBe(path.resolve(ctx.dataDir).toLowerCase())

      // ── 0. 进入项目 + 首页原型 ──────────────────────────────────────────
      step = 0
      const boot = await openProjectAndHome(page)
      await page.waitForTimeout(1_500)
      // seed 启动会自动恢复上次原型（大厅，含独立内联脚本），先记录其噪声再切到首页；
      // 以下只对「切到首页之后新增」的 console/pageerror 判失败，避免把 seed 内容噪声当产品缺陷。
      const baselineConsole = ctx.consoleErrors.length
      const baselinePageErrors = ctx.pageErrors.length
      log('boot', {
        dataDir: ctx.dataDir,
        userData: ctx.userData,
        seed: ctx.seedPresent,
        pickerShown: boot.pickerShown,
        restored: boot.restored,
        baselineConsole,
        baselinePageErrors,
      })
      await ctx.shot(0, 'project-entry')

      // ── 1. PC 基线：侧栏 + 文档打开；切移动端验证默认保持打开 ───────────
      step = 1
      if ((await page.getByTestId('stage-frame').getAttribute('data-kind')) !== 'pc') {
        await page.locator('button[title="桌面端舞台"]').click()
      }
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
      await ensureSidebar(page)
      const docs = page.getByTestId('docs-panel')
      if (!(await docs.isVisible().catch(() => false))) {
        await page.getByTestId('topbar-docs').click()
      }
      await expect(docs).toBeVisible({ timeout: 15_000 })
      await expect(docs).toContainText('商城首页', { timeout: 20_000 })
      const pcShot = await ctx.shot(1, 'pc-before-mobile')
      log('step1-pc', {
        sidebar: await page.getByTestId('sidebar').count(),
        docs: await docs.isVisible(),
        shot: relShot(pcShot),
      })

      // 切移动端：默认 chrome 口径是「展开侧栏 + 打开文档」，不再自动收起。
      await page.locator('button[title="移动端舞台（375 逻辑宽）"]').evaluate((el) => (el as HTMLElement).click())
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 10_000 })
      await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 10_000 })
      await expect(docs).toBeVisible({ timeout: 10_000 })
      await expect(docs).toHaveAttribute('data-variant', 'inline')
      const docsZ = Number(
        await docs.evaluate((el) => getComputedStyle(el as HTMLElement).zIndex).catch(() => 'NaN'),
      )
      expect(docsZ, '移动端 inline 文档应为 z-40（低于 Dialog/Sheet 的 z-50）').toBe(40)
      const mobileShot = await ctx.shot(1, 'mobile-default-open')
      log('step1-mobile-default', {
        sidebar: await page.getByTestId('sidebar').count(),
        docs: await docs.isVisible(),
        docsZ,
        shot: relShot(mobileShot),
      })

      // 文档默认打开时点侧栏「新建子页面」：Dialog 必须压在文档之上，输入框可聚焦可输入；
      // 只填探针名后取消，不落盘子页，保证用例可重复。
      const homeRow = page
        .getByTestId('sidebar')
        .locator('button[data-level="proto"]')
        .filter({ hasText: /^\s*首页\s*$/ })
        .first()
      await homeRow.hover()
      await page
        .getByTestId('sidebar')
        .locator('button[aria-label="原型「首页」更多操作"]')
        .first()
        .click()
      await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 })
      await page.getByRole('menuitem', { name: '新建子页面' }).click()
      const subDialog = page.getByRole('dialog').filter({ hasText: '新建子页面' }).first()
      await expect(subDialog).toBeVisible({ timeout: 10_000 })
      const layer = await page.evaluate(() => {
        const docsEl = document.querySelector('[data-testid="docs-panel"]') as HTMLElement | null
        const dialogEl = Array.from(document.querySelectorAll('[role="dialog"]')).find(
          (el) => (el.textContent || '').includes('新建子页面'),
        ) as HTMLElement | null
        const portalEl = dialogEl?.closest('[data-slot="dialog-portal"]') as HTMLElement | null
        const inputEl = dialogEl?.querySelector('input[aria-label="新建子页面"]') as HTMLElement | null
        const rect = inputEl?.getBoundingClientRect()
        const hit = rect
          ? (document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) as HTMLElement | null)
          : null
        return {
          docsZ: docsEl ? getComputedStyle(docsEl).zIndex : null,
          dialogZ: portalEl ? getComputedStyle(portalEl).zIndex : null,
          inputHitInsideDialog: !!(hit && hit.closest('[role="dialog"]')),
          inputHitTag: hit?.tagName || null,
        }
      })
      expect(layer.docsZ, '文档层级').toBe('40')
      expect(layer.dialogZ, 'Dialog portal 层级').toBe('50')
      expect(layer.inputHitInsideDialog, `输入框中心点应命中 Dialog，实际=${layer.inputHitTag}`).toBe(true)
      await subDialog.locator('input[aria-label="新建子页面"]').fill('层级探针')
      await expect(subDialog.locator('input[aria-label="新建子页面"]')).toHaveValue('层级探针')
      const dialogShot = await ctx.shot(1, 'subpage-dialog-above-docs')
      await subDialog.getByRole('button', { name: '取消' }).click()
      await expect(subDialog).toBeHidden({ timeout: 5_000 })
      await expect(docs, '关闭 Dialog 后文档仍应打开').toBeVisible()
      const dialogClosedShot = await ctx.shot(1, 'subpage-dialog-closed-docs-open')
      log('step1-subpage-dialog', { ...layer, shot: relShot(dialogShot), closedShot: relShot(dialogClosedShot) })

      // 切回 PC：只在 mobile → PC 的切换瞬间关闭文档；侧栏保留移动端时的状态，不强制改。
      await page.locator('button[title="桌面端舞台"]').evaluate((el) => (el as HTMLElement).click())
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
      await expect(page.getByTestId('sidebar'), '切回 PC 不强制改侧栏').toBeVisible({ timeout: 10_000 })
      await expect(docs, '切回 PC 应关闭移动端默认打开的文档').toBeHidden({ timeout: 10_000 })
      const pcClosedShot = await ctx.shot(1, 'pc-docs-closed')
      await page.locator('button[title="移动端舞台（375 逻辑宽）"]').evaluate((el) => (el as HTMLElement).click())
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 10_000 })
      await expect(docs, '再回移动端按默认重新打开文档').toBeVisible({ timeout: 10_000 })
      await expect(docs).toHaveAttribute('data-variant', 'inline')
      log('step1-kind-roundtrip', {
        docs: await docs.isVisible(),
        shot: relShot(pcClosedShot),
      })

      // 后续视口/小地图用例需要完整舞台宽度：验证完默认 chrome 后按用户操作关闭文档。
      await docs.getByRole('button', { name: '关闭文档' }).click()
      await expect(docs).toHaveCount(0, { timeout: 10_000 })

      // ── 2. 默认「适宽」：壳占满可用高、动态视口高无壳内滚动、滚轮归原型 ──
      step = 2
      const fit = await waitStableReadout(page)
      expect(fit.kind).toBe('mobile')
      expect(fit.mode).toBe('fit-width')
      expect(fit.fit).toBe('on')
      expect(fit.topbar).toBe(fit.stage)
      expect(fit.area, '移动端舞台可用区应存在').not.toBeNull()
      expect(fit.shell, '适宽模式应有手机壳').not.toBeNull()
      expect(fit.scroll, '适宽模式应有壳内滚动容器').not.toBeNull()

      const shellHeightGap = Math.abs(fit.shell!.height - fit.area!.height)
      expect(
        shellHeightGap,
        `适宽手机壳应占满可用高：shell=${fit.shell!.height.toFixed(2)} area=${fit.area!.height.toFixed(2)}`,
      ).toBeLessThanOrEqual(2)
      // W5 动态视口高：内容高精确吃满可视高，壳内不产生纵向滚动。
      expect(
        fit.scroll!.scrollHeight,
        `适宽内容高应吃满可视高（无壳内纵向滚动）：scrollHeight=${fit.scroll!.scrollHeight} clientHeight=${fit.scroll!.clientHeight}`,
      ).toBeLessThanOrEqual(fit.scroll!.clientHeight + 1)
      expect(
        fit.outer.docScrollHeight,
        `外层不应有纵向滚动：scrollHeight=${fit.outer.docScrollHeight} clientHeight=${fit.outer.docClientHeight}`,
      ).toBeLessThanOrEqual(fit.outer.docClientHeight + 1)

      const stats = await frameTextStats(page)
      expect(stats.textLen, 'iframe 正文不应为空').toBeGreaterThan(100)
      expect(
        stats.minFont,
        `375 逻辑宽下正文最小字号应 ≥12px，实测 ${stats.minFont}px（${JSON.stringify(stats.minSamples)}）`,
      ).toBeGreaterThanOrEqual(12)
      const layoutScale = fit.viewport!.bboxW / MOBILE_W
      const visualMinFont = stats.minFont * layoutScale
      // 视口逻辑高 = 壳可视高 ÷ 比例；缩放机制为 CSS zoom（transform 保持 none）。
      const fitStyleH = parseFloat(fit.viewport!.styleH)
      expect(
        Math.abs(fitStyleH * layoutScale - fit.scroll!.clientHeight),
        `视口高×比例 应≈壳可视高：styleH=${fitStyleH} scale=${layoutScale} clientHeight=${fit.scroll!.clientHeight}`,
      ).toBeLessThanOrEqual(2)
      expect(Number(fit.viewport!.zoom), '缩放应走 CSS zoom').toBeCloseTo(layoutScale, 2)
      expect(fit.viewport!.transform, '不应再使用 transform 缩放').toBe('none')
      log('step2-fit', {
        readout: fit.stage,
        area: fit.area,
        shell: fit.shell,
        scroll: fit.scroll,
        viewport: fit.viewport,
        bodyFont: stats.bodyFont,
        minFont: stats.minFont,
        layoutScale,
        visualMinFont,
        outer: fit.outer,
      })

      // 壳内写 scrollTop 会被 clamp 回 0（无纵向可滚）；外层不滚。
      await setShellScroll(page, 180)
      const scrolled = await readMobile(page)
      expect(scrolled.scroll!.scrollTop, '壳内无纵向滚动，scrollTop 应保持 0').toBe(0)
      expect(scrolled.outer.scrollY, '壳内滚动不应带动外层窗口').toBe(0)
      await page.mouse.move(scrolled.shell!.x + scrolled.shell!.width / 2, scrolled.shell!.y + 60)
      await page.mouse.wheel(0, 700)
      await page.waitForTimeout(400)
      const afterWheel = await readMobile(page)
      const frameViewport = await readFrameViewport(page)
      const frameScrollY = await page
        .frameLocator('[data-testid="preview-frame"]')
        .locator('body')
        .evaluate(() => window.scrollY)
        .catch(() => -1)
      expect(afterWheel.scroll!.scrollTop, '滚轮后壳内仍不应纵向滚动').toBe(0)
      expect(afterWheel.outer.scrollY, '滚轮后外层窗口仍不应滚动').toBe(0)
      // W5 动态视口高：帧内视口高与舞台逻辑视口高一致（真机语义）。
      expect(
        Math.abs(frameViewport.innerHeight - fitStyleH),
        `帧内 innerHeight=${frameViewport.innerHeight} 应≈舞台逻辑视口高 ${fitStyleH}`,
      ).toBeLessThanOrEqual(2)
      // 滚轮被原型（iframe）内部消费。
      expect(frameScrollY, '滚轮应被原型内部消费（帧内已滚动）').toBeGreaterThan(0)
      log('step2-scroll', {
        shellScrollTop: scrolled.scroll!.scrollTop,
        afterWheelShellTop: afterWheel.scroll!.scrollTop,
        frameViewport,
        frameScrollY,
        outerScrollY: afterWheel.outer.scrollY,
      })
      await ctx.shot(3, 'fit-width')

      // ── 3. 全貌：一屏完整、无壳内滚动、无小地图 ────────────────────────
      step = 3
      const overview = await selectMode(page, 'overview')
      expect(overview.mode).toBe('overview')
      expect(overview.overview, '全貌应渲染完整手机框').not.toBeNull()
      expect(overview.scroll, '全貌不应有壳内滚动容器').toBeNull()
      expect(overview.minimap.visible, '全貌不显示小地图').toBe(false)
      expect(overview.minimap.track).toBeNull()
      const ov = overview.overview!
      const area = overview.area!
      expect(ov.x, '全貌左边不应超出可用区').toBeGreaterThanOrEqual(area.x - 1)
      expect(ov.y, '全貌上边不应超出可用区').toBeGreaterThanOrEqual(area.y - 1)
      expect(ov.x + ov.width, '全貌右边不应超出可用区').toBeLessThanOrEqual(area.x + area.width + 1)
      expect(ov.y + ov.height, '全貌下边不应超出可用区').toBeLessThanOrEqual(area.y + area.height + 1)
      const ovMeasured = (overview.viewport!.bboxW / MOBILE_W) * 100
      expect(Math.abs(ovMeasured - (percentOf(overview.stage) as number))).toBeLessThanOrEqual(1)
      const ovShot = await ctx.shot(4, 'overview')
      log('step3-overview', {
        readout: overview.stage,
        measured: ovMeasured,
        overlay: ov,
        area,
        shot: relShot(ovShot),
      })

      // ── 4. 100%：精确 1:1、壳内无纵向滚动、小地图不显示 ─────────────────
      step = 4
      const at100 = await selectMode(page, '100')
      expect(at100.stage).toBe('100%')
      expect(at100.topbar).toBe('100%')
      expect(at100.viewport!.bboxW).toBeCloseTo(375, 1)
      // W5 动态视口高：视觉高吃满壳可视高（底部常驻可见，无需滚动）。
      expect(at100.viewport!.bboxH).toBeCloseTo(at100.scroll!.clientHeight, 1)
      expect(
        at100.scroll!.scrollHeight,
        `100% 壳内不应有纵向溢出：scrollHeight=${at100.scroll!.scrollHeight} clientHeight=${at100.scroll!.clientHeight}`,
      ).toBeLessThanOrEqual(at100.scroll!.clientHeight + 1)
      expect(at100.minimap.visible, '无纵向溢出，100% 不显示小地图').toBe(false)
      expect(Number(at100.viewport!.zoom), '100% 应走 CSS zoom(1)').toBeCloseTo(1, 2)
      const at100StyleH = parseFloat(at100.viewport!.styleH)
      expect(Math.abs(at100StyleH - at100.scroll!.clientHeight), '视口逻辑高=壳可视高÷1').toBeLessThanOrEqual(1)
      const at100Frame = await readFrameViewport(page)
      expect(Math.abs(at100Frame.innerHeight - at100StyleH), '帧内视口高应随壳同步').toBeLessThanOrEqual(2)
      await setShellScroll(page, 240)
      const at100scrolled = await readMobile(page)
      expect(at100scrolled.scroll!.scrollTop, '无纵向可滚，写入应 clamp 回 0').toBe(0)
      log('step4-100', {
        readout: at100.stage,
        viewport: at100.viewport,
        scroll: at100.scroll,
        frameViewport: at100Frame,
        minimap: at100.minimap,
      })
      await ctx.shot(5, 'mode-100')

      // ── 5. 125%：视口高随比例反缩，底部无需滚动即可见 ───────────────────
      step = 5
      const at125 = await selectMode(page, '125')
      expect(at125.stage).toBe('125%')
      expect(at125.topbar).toBe('125%')
      expect(at125.viewport!.bboxW).toBeCloseTo(468.75, 1)
      expect(
        at125.viewport!.bboxH,
        `125% 视觉高应吃满壳可视高（不再是 780×1.25）：bboxH=${at125.viewport!.bboxH}`,
      ).toBeCloseTo(at125.scroll!.clientHeight, 1)
      expect(
        at125.scroll!.scrollHeight,
        `125% 壳内不应有纵向溢出：scrollHeight=${at125.scroll!.scrollHeight} clientHeight=${at125.scroll!.clientHeight}`,
      ).toBeLessThanOrEqual(at125.scroll!.clientHeight + 1)
      expect(at125.minimap.visible, '无纵向溢出，125% 不显示小地图').toBe(false)
      expect(Number(at125.viewport!.zoom), '125% 应走 CSS zoom(1.25)').toBeCloseTo(1.25, 2)
      const at125StyleH = parseFloat(at125.viewport!.styleH)
      expect(
        Math.abs(at125StyleH * 1.25 - at125.scroll!.clientHeight),
        `视口逻辑高×1.25 应≈壳可视高：styleH=${at125StyleH}`,
      ).toBeLessThanOrEqual(2)
      const at125Frame = await readFrameViewport(page)
      expect(
        Math.abs(at125Frame.innerHeight - at125StyleH),
        `帧内视口高应随比例反缩：innerHeight=${at125Frame.innerHeight} styleH=${at125StyleH}`,
      ).toBeLessThanOrEqual(2)
      await setShellScroll(page, 99_999)
      const at125bottom = await readMobile(page)
      expect(at125bottom.scroll!.scrollTop, '底部无需壳内滚动即可见，scrollTop 保持 0').toBe(0)
      const b125Shot = await ctx.shot(6, 'mode-125')
      log('step5-125', {
        readout: at125.stage,
        viewport: at125.viewport,
        scroll: at125.scroll,
        frameViewport: at125Frame,
        minimap: at125.minimap,
        bottomScrollTop: at125bottom.scroll!.scrollTop,
        shot: relShot(b125Shot),
      })

      // ── 6. custom：-/+ 进入自定义比例，读数与实测一致 ───────────────────
      step = 6
      await page.getByRole('button', { name: '缩小' }).click()
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-mobile-mode', 'custom', { timeout: 10_000 })
      const custom = await waitStableReadout(page)
      expect(custom.mode).toBe('custom')
      expect(custom.stage).toBe('115%')
      expect(custom.topbar).toBe('115%')
      expect(custom.viewport!.bboxW).toBeCloseTo(375 * 1.15, 1)
      const customShot = await ctx.shot(8, 'mode-custom')
      log('step6-custom', { readout: custom.stage, viewport: custom.viewport, shot: relShot(customShot) })

      // ── 7. 模式往返：各模式壳内均无纵向滚动，往返位置恒为 0 ─────────────
      step = 7
      const backFit = await selectMode(page, 'fit-width')
      expect(backFit.mode).toBe('fit-width')
      await setShellScroll(page, 140)
      const fitSaved = await readMobile(page)
      expect(fitSaved.scroll!.scrollTop, '适宽无纵向可滚，位置恒为 0').toBe(0)
      await selectMode(page, '100')
      await setShellScroll(page, 200)
      const at100Saved = await readMobile(page)
      expect(at100Saved.scroll!.scrollTop, '100% 无纵向可滚，位置恒为 0').toBe(0)
      const backToFit = await selectMode(page, 'fit-width')
      expect(backToFit.scroll!.scrollTop, '切回适宽位置仍为 0').toBe(0)
      const restoreShot = await ctx.shot(9, 'restore-fit-width')
      const backTo100 = await selectMode(page, '100')
      expect(backTo100.scroll!.scrollTop, '切回 100% 位置仍为 0').toBe(0)
      log('step7-restore', {
        fitSaved: fitSaved.scroll!.scrollTop,
        at100Saved: at100Saved.scroll!.scrollTop,
        backToFit: backToFit.scroll!.scrollTop,
        backTo100: backTo100.scroll!.scrollTop,
        shot: relShot(restoreShot),
      })

      // ── 8. 缩放机制探针：各模式均走 CSS zoom、transform 为 none、小地图隐藏 ──
      step = 8
      const mechModes: Array<{ mode: string; expectScale: (snap: MobileSnapshot) => number }> = [
        { mode: 'fit-width', expectScale: (s) => s.viewport!.bboxW / MOBILE_W },
        { mode: '100', expectScale: () => 1 },
        { mode: '125', expectScale: () => 1.25 },
        { mode: 'custom', expectScale: (s) => (percentOf(s.stage) as number) / 100 },
      ]
      for (const mech of mechModes) {
        let snap: MobileSnapshot
        if (mech.mode === 'custom') {
          // custom 不在下拉常驻项里：从当前模式点「缩小」进入。
          await page.getByRole('button', { name: '缩小' }).click()
          await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-mobile-mode', 'custom', { timeout: 10_000 })
          snap = await waitStableReadout(page)
        } else {
          snap = await selectMode(page, mech.mode)
        }
        const expectedScale = mech.expectScale(snap)
        expect(
          Math.abs(Number(snap.viewport!.zoom) - expectedScale),
          `${mech.mode} 应走 CSS zoom=${expectedScale}`,
        ).toBeLessThanOrEqual(0.01)
        expect(snap.viewport!.transform, `${mech.mode} 不应使用 transform 缩放`).toBe('none')
        expect(
          snap.scroll!.scrollHeight,
          `${mech.mode} 壳内不应有纵向溢出`,
        ).toBeLessThanOrEqual(snap.scroll!.clientHeight + 1)
        expect(snap.minimap.visible, `${mech.mode} 无纵向溢出不显示小地图`).toBe(false)
      }
      const mechShot = await ctx.shot(10, 'zoom-mechanism')
      log('step8-zoom-mechanism', {
        modes: mechModes.map((m) => m.mode),
        shot: relShot(mechShot),
      })

      // ── 9. console / pageerror / crash ─────────────────────────────────
      step = 9
      const finalShot = await ctx.shot(11, 'final')
      const newConsole = ctx.consoleErrors.slice(baselineConsole)
      const newPageErrors = ctx.pageErrors.slice(baselinePageErrors)
      const newFatal = [...newConsole, ...newPageErrors, ...ctx.crashes].filter(isFatalConsole)
      log('step9-console', {
        baselineConsole,
        baselinePageErrors,
        newConsole,
        newPageErrors,
        crashes: ctx.crashes,
        fatalCount: newFatal.length,
        startupNoise: ctx.consoleErrors.slice(0, baselineConsole),
        shot: relShot(finalShot),
      })
      expect(newPageErrors, '切到首页后不应新增 pageerror').toStrictEqual([])
      expect(ctx.crashes, 'crash 应为 0').toStrictEqual([])
      expect(newFatal, '切到首页后不应新增致命 console/pageerror/crash').toHaveLength(0)

      testInfo.attach('mobile-viewport-evidence', {
        body: JSON.stringify(
          {
            dataDir: ctx.dataDir,
            userData: ctx.userData,
            seed: ctx.seedPresent,
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
          slug: `mobile-viewport-step-${step}`,
          level: 'P1',
          expected: '移动端视口核心路径可用',
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
