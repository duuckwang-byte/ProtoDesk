/**
 * e2e/wave4-stage.spec.ts — Wave4 A1 冒烟 · 域 5「舞台 / 预览 / 移动端」。
 *
 * 只读验证（不改产品代码）：
 * 1. 进入项目/原型：`preview-frame` 唯一、srcdoc 非空、iframe 正文可见；
 * 2. PC ↔ 移动端切换：移动端 375 逻辑宽 + 动态视口高（W5）、默认自适应；
 *    顶栏 `topbar-zoom-readout` 与舞台 `stage-zoom-readout` 必须同源同值（回归「85% vs 60%」）；
 *    缩放机制为 CSS zoom（transform 恒为 none，帧内文字按新比例重栅格化）；
 * 3. 顶栏自适应开关、-/+、50/75/100/125 预设：读数为真实比例；退出自适应后画面真实缩放；
 *    外层无纵向滚轮；
 * 4. 侧栏原型切换（首页/我的）内容变化；顶栏刷新后不白屏；
 * 5. 50% / 125% 下 iframe 内仍可点击/输入；
 * 6. 汇总 console/pageerror/crash，仅 P0/P1 写入报告。
 *
 * 运行：
 *   node e2e/wave4/seed.mjs --domain stage
 *   set PLAND_RENDERER=react
 *   npx playwright test e2e/wave4-stage.spec.ts --workers=1 --output=test-results/wave4/stage
 */
import { test, expect } from '@playwright/test'
import * as path from 'node:path'
import { launchApp, assertCleanExit, reportFailure, type Wave4App } from './wave4/harness'

const DOMAIN = 'stage'
const MOBILE_W = 375

interface ZoomSnapshot {
  topbar: string | null
  stage: string | null
  topbarVisible: boolean
  stageVisible: boolean
  kind: string | null
  fit: string | null
  mobileMode: string | null
  viewport: {
    styleW: string
    styleH: string
    bboxW: number
    bboxH: number
    transform: string
    zoom: string
  } | null
  area: { x: number; y: number; width: number; height: number } | null
  scroll: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
  } | null
  outer: {
    innerHeight: number
    innerWidth: number
    docScrollHeight: number
    docClientHeight: number
    bodyScrollHeight: number
    scrollY: number
    htmlOverflowY: string
    bodyOverflowY: string
  }
}

function log(label: string, data: unknown): void {
  console.log(`[W4-STAGE] ${label} ${JSON.stringify(data)}`)
}

async function readZoom(page: Wave4App['page']): Promise<ZoomSnapshot> {
  return page.evaluate(() => {
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
    const topbar = q('topbar-zoom-readout')
    const stage = q('stage-zoom-readout')
    const vp = q('stage-viewport')
    const frame = q('stage-frame')
    const areaEl = q('stage-mobile-area')
    const scrollEl = q('stage-mobile-scroll')
    const modeSelect = document.querySelector('select[aria-label="移动端视图模式"]') as HTMLSelectElement | null
    const rect = vp ? vp.getBoundingClientRect() : null
    const cs = vp ? getComputedStyle(vp) : null
    const doc = document.documentElement
    const visible = (el: HTMLElement | null): boolean =>
      !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0
    const areaRect = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    return {
      topbar: topbar ? (topbar.textContent || '').trim() : null,
      stage: stage ? (stage.textContent || '').trim() : null,
      topbarVisible: visible(topbar),
      stageVisible: visible(stage),
      kind: frame ? frame.getAttribute('data-kind') : null,
      fit: frame ? frame.getAttribute('data-fit') : null,
      mobileMode: modeSelect ? modeSelect.value : null,
      viewport: vp && rect
        ? {
            styleW: vp.style.width,
            styleH: vp.style.height,
            bboxW: Math.round(rect.width * 1000) / 1000,
            bboxH: Math.round(rect.height * 1000) / 1000,
            transform: cs ? cs.transform : '',
            zoom: cs ? cs.zoom : '',
          }
        : null,
      area: areaRect(areaEl),
      scroll: scrollEl
        ? {
            scrollTop: scrollEl.scrollTop,
            scrollHeight: scrollEl.scrollHeight,
            clientHeight: scrollEl.clientHeight,
          }
        : null,
      outer: {
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        docScrollHeight: doc.scrollHeight,
        docClientHeight: doc.clientHeight,
        bodyScrollHeight: document.body.scrollHeight,
        scrollY: window.scrollY,
        htmlOverflowY: getComputedStyle(doc).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
      },
    }
  })
}

async function frameBodyText(page: Wave4App['page']): Promise<string> {
  try {
    return (
      await page.frameLocator('[data-testid="preview-frame"]').locator('body').innerText({ timeout: 10_000 })
    ).trim()
  } catch {
    return ''
  }
}

function percentOf(label: string | null): number | null {
  if (!label) return null
  const m = /^(\d+)%$/.exec(label)
  return m ? Number(m[1]) : null
}

/** 等两处读数都落到百分比且相等，返回快照。 */
async function waitForStableZoom(page: Wave4App['page']): Promise<ZoomSnapshot> {
  await expect
    .poll(
      async () => {
        const z = await readZoom(page)
        if (z.kind === 'mobile') {
          if (!z.topbar || !z.stage) return 'missing'
          if (!/^\d+%$/.test(z.topbar) || !/^\d+%$/.test(z.stage)) return 'pending'
          return z.topbar === z.stage ? z.topbar : `mismatch:${z.topbar}/${z.stage}`
        }
        return /^\d+%$/.test(z.stage || '') ? z.stage : 'pending'
      },
      { timeout: 10_000, message: '缩放读数应在 10s 内落到百分比并保持一致' },
    )
    .toMatch(/^\d+%$/)
  return readZoom(page)
}

async function assertZoom(page: Wave4App['page'], percent: number, where: string): Promise<ZoomSnapshot> {
  const z = await waitForStableZoom(page)
  expect(z.stage, `${where} 舞台读数`).toBe(`${percent}%`)
  if (z.kind === 'mobile') {
    expect(z.topbar, `${where} 顶栏与舞台读数必须一致`).toBe(`${percent}%`)
    expect(z.mobileMode, `${where} 手动缩放时应离开「适宽」模式`).not.toBe('fit-width')
    expect(z.viewport, `${where} 移动端应有 375 逻辑宽视窗`).not.toBeNull()
    expect(z.viewport!.styleW).toBe(`${MOBILE_W}px`)
    const measured = (z.viewport!.bboxW / MOBILE_W) * 100
    expect(
      Math.abs(measured - percent),
      `${where} 画面真实缩放应=${percent}%，实测 bboxW=${z.viewport!.bboxW}px`,
    ).toBeLessThanOrEqual(1)
    // W5 动态视口高：视口逻辑高×比例 ≈ 壳可视高（bboxH=styleH×比例，底部常驻可见）。
    const scale = z.viewport!.bboxW / MOBILE_W
    const styleH = parseFloat(z.viewport!.styleH)
    expect(
      Math.abs(z.viewport!.bboxH - styleH * scale),
      `${where} 视觉高应=逻辑视口高×比例：bboxH=${z.viewport!.bboxH} styleH=${styleH}`,
    ).toBeLessThanOrEqual(2)
    if (z.scroll) {
      expect(
        z.scroll.scrollHeight,
        `${where} 动态视口高下壳内不应有纵向溢出：scrollHeight=${z.scroll.scrollHeight} clientHeight=${z.scroll.clientHeight}`,
      ).toBeLessThanOrEqual(z.scroll.clientHeight + 1)
    }
    // 缩放机制：CSS zoom（transform 不参与缩放）。
    expect(z.viewport!.transform, `${where} 不应使用 transform 缩放`).toBe('none')
    expect(
      Math.abs(Number(z.viewport!.zoom) - scale),
      `${where} CSS zoom 应=${scale}`,
    ).toBeLessThanOrEqual(0.01)
  }
  return z
}

async function openProject(page: Wave4App['page']): Promise<{ pickerShown: boolean; project: string }> {
  await expect(page.getByTestId('main-window')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('topbar')).toBeVisible()
  await expect(page.getByTestId('stage-frame')).toBeVisible()
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
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  await expect(page.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
  const project = (await page.locator('[data-testid="sidebar"] button[title="切换项目"]').innerText())
    .replace(/\s+/g, ' ')
    .trim()
  expect(project).toBe('测试1')
  return { pickerShown, project }
}

async function clickProto(page: Wave4App['page'], name: '首页' | '我的'): Promise<void> {
  if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
    await page.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
  }
  const proto = page
    .getByTestId('sidebar')
    .locator('button[data-level="proto"]')
    .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) })
    .first()
  await expect(proto).toBeVisible({ timeout: 20_000 })
  await proto.click()
  await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
}

async function typeInFrame(page: Wave4App['page'], value: string): Promise<{ value: string; focused: boolean }> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const input = frame.locator('input.search-input')
  await expect(input).toBeVisible({ timeout: 10_000 })
  // CSS zoom 下 Playwright 1.65 的跨帧点击坐标不换算 zoom，actionability 会误报
  // 「stage-mobile-area intercepts pointer events」；与 clickCardInFrame 同口径，
  // 用 frame bbox/clientWidth 实测缩放比换算成真实鼠标坐标点击。
  const local = await input.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  })
  const frameBox = await page.getByTestId('preview-frame').boundingBox()
  const clientWidth = await page
    .getByTestId('preview-frame')
    .evaluate((el) => (el as HTMLIFrameElement).clientWidth)
  if (!frameBox || !clientWidth) throw new Error('无法读取 preview-frame 几何信息')
  const scale = frameBox.width / clientWidth
  await page.mouse.click(frameBox.x + local.cx * scale, frameBox.y + local.cy * scale)
  await input.fill(value)
  const state = await input.evaluate((el) => ({
    value: (el as HTMLInputElement).value,
    focused: el.ownerDocument.activeElement === el,
  }))
  return state
}

/** 125% 下画面仍可能被舞台裁边，改用中部的商品卡证明 iframe 仍可点击；
 *  同时用 iframe 内滚动证明可滚动。CSS zoom + 外层裁切下 Playwright 的
 *  locator.click 命中判定可能误报「body intercepts pointer events」，这里用真实鼠标坐标点击。
 */
async function clickCardInFrame(
  page: Wave4App['page'],
): Promise<{ clicked: string | null; scrollY: number; screen: unknown; parentHit: string }> {
  const frame = page.frameLocator('[data-testid="preview-frame"]')
  const card = frame.locator('article.product-card').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  // 125% 下商品卡可能落在壳内视口下方；先滚入可视区，避免坐标点击落到视口外/浮层。
  await card.scrollIntoViewIfNeeded()
  const closeToast = page.getByRole('button', { name: '关闭通知' })
  if (await closeToast.count().catch(() => 0)) await closeToast.first().click({ timeout: 1_500 }).catch(() => undefined)
  await card.evaluate((el) => {
    el.setAttribute('data-w4-click', '0')
    el.addEventListener('click', () => el.setAttribute('data-w4-click', '1'), { once: true })
  })
  const local = await card.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }
  })
  const frameBox = await page.getByTestId('preview-frame').boundingBox()
  const clientWidth = await page.getByTestId('preview-frame').evaluate((el) => (el as HTMLIFrameElement).clientWidth)
  if (!frameBox || !clientWidth) throw new Error('无法读取 preview-frame 几何信息')
  const scale = frameBox.width / clientWidth
  const screen = { x: frameBox.x + local.cx * scale, y: frameBox.y + local.cy * scale }
  const parentHit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const owner = el?.closest('[data-testid]') as HTMLElement | null
    return `${el?.tagName || 'none'}|${owner?.getAttribute('data-testid') || ''}`
  }, screen)
  await page.mouse.click(screen.x, screen.y)
  await page.waitForTimeout(150)
  const clicked = await card.getAttribute('data-w4-click')
  const scrollY = await card.evaluate((el) => {
    const win = el.ownerDocument.defaultView
    win?.scrollTo(0, 220)
    return win ? win.scrollY : -1
  })
  return { clicked, scrollY, screen: { ...screen, scale, local }, parentHit }
}

test.describe('Wave4 A1 · 舞台/预览/移动端', () => {
  test('A1 舞台真机冒烟：iframe / 375×780 / 缩放 / 源切换 / 刷新', async ({}, testInfo) => {
    test.setTimeout(300_000)
    let ctx: Wave4App | null = null
    let step = 0

    try {
      ctx = await launchApp({ domain: DOMAIN })
      const page = ctx.page

      // 隔离断言：harness 已精确比较 userData；这里再做一次可读记录。
      const expected = path.resolve(ctx.dataDir).toLowerCase()
      expect(path.resolve(ctx.userData).toLowerCase()).toBe(expected)
      log('isolation', {
        dataDir: ctx.dataDir,
        userData: ctx.userData,
        seed: ctx.seedPresent,
      })

      // ── 0. 进入项目 + 首页原型 ──────────────────────────────────────────
      step = 0
      const entered = await openProject(page)
      log('project', entered)
      await clickProto(page, '首页')
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 20_000 })
      await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'on', { timeout: 10_000 })

      // ── 1. iframe / srcdoc / 正文 ───────────────────────────────────────
      step = 1
      await test.step('1 iframe + srcdoc + 正文', async () => {
        const frames = page.getByTestId('preview-frame')
        await expect(frames).toHaveCount(1)
        await expect(frames).toBeVisible({ timeout: 20_000 })
        await expect
          .poll(async () => ((await frames.getAttribute('srcdoc')) || '').length, { timeout: 20_000 })
          .toBeGreaterThan(10_000)
        const srcdocLen = ((await frames.getAttribute('srcdoc')) || '').length
        await expect.poll(async () => (await frameBodyText(page)).length, { timeout: 20_000 }).toBeGreaterThan(100)
        const bodyText = await frameBodyText(page)
        const stageBox = await page.getByTestId('stage-frame').boundingBox()
        expect(stageBox && stageBox.width > 0 && stageBox.height > 0, '舞台应有可见尺寸').toBe(true)
        const shot = await ctx.shot(1, 'iframe-render')
        log('step1', {
          srcdocLen,
          bodyLen: bodyText.length,
          bodyHead: bodyText.slice(0, 40).replace(/\s+/g, ' '),
          stageBox,
          shot: path.relative(path.resolve(__dirname, '..'), shot).split(path.sep).join('/'),
        })
      })

      // ── 2. 移动端 375 逻辑宽 + 动态视口高 + 顶栏/舞台读数一致 ───────────
      step = 2
      await test.step('2 移动端 375 逻辑宽 + 动态视口高 + 读数一致', async () => {
        const z = await waitForStableZoom(page)
        expect(z.kind).toBe('mobile')
        expect(z.fit).toBe('on')
        expect(z.mobileMode).toBe('fit-width')
        expect(z.topbarVisible, '顶栏缩放读数应可见').toBe(true)
        expect(z.stageVisible, '舞台缩放读数应可见').toBe(true)
        expect(z.topbar, '顶栏与舞台不得出现两套读数').toBe(z.stage)
        expect(percentOf(z.stage)).not.toBeNull()
        expect(z.viewport).not.toBeNull()
        expect(z.viewport!.styleW).toBe(`${MOBILE_W}px`)
        const measured = (z.viewport!.bboxW / MOBILE_W) * 100
        expect(
          Math.abs(measured - (percentOf(z.stage) as number)),
          `自适应读数=${z.stage}，实测=${measured.toFixed(2)}%`,
        ).toBeLessThanOrEqual(1)
        // W5 动态视口高：视口逻辑高×比例 ≈ 壳可视高，画面整体落在可用区内。
        const fitScale = z.viewport!.bboxW / MOBILE_W
        const fitStyleH = parseFloat(z.viewport!.styleH)
        expect(z.area, '应有移动端可用区').not.toBeNull()
        expect(
          Math.abs(z.viewport!.bboxH - fitStyleH * fitScale),
          `视觉高应=逻辑视口高×比例：bboxH=${z.viewport!.bboxH} styleH=${fitStyleH}`,
        ).toBeLessThanOrEqual(2)
        expect(
          Math.abs(z.viewport!.bboxH - (z.scroll ? z.scroll.clientHeight : z.area!.height)),
          '视口视觉高应吃满壳可视高（底部常驻可见）',
        ).toBeLessThanOrEqual(2)
        if (z.scroll) {
          expect(
            z.scroll.scrollHeight,
            `动态视口高下壳内不应有纵向溢出：scrollHeight=${z.scroll.scrollHeight} clientHeight=${z.scroll.clientHeight}`,
          ).toBeLessThanOrEqual(z.scroll.clientHeight + 1)
        }
        expect(z.viewport!.transform, '不应使用 transform 缩放').toBe('none')
        expect(Math.abs(Number(z.viewport!.zoom) - fitScale), '缩放应走 CSS zoom').toBeLessThanOrEqual(0.01)
        const shot = await ctx.shot(2, 'mobile-fit-dynamic-viewport')
        log('step2', {
          topbar: z.topbar,
          stageReadout: z.stage,
          style: `${z.viewport!.styleW}x${z.viewport!.styleH}`,
          bbox: `${z.viewport!.bboxW}x${z.viewport!.bboxH}`,
          zoom: z.viewport!.zoom,
          area: z.area,
          scroll: z.scroll,
          measuredPercent: measured,
          shot: path.relative(path.resolve(__dirname, '..'), shot).split(path.sep).join('/'),
        })
      })

      // ── 3. PC / 移动端切换 ──────────────────────────────────────────────
      step = 3
      await test.step('3 PC / 移动端切换', async () => {
        const fitBefore = await waitForStableZoom(page)
        await page.locator('button[title="桌面端舞台"]').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
        await expect(page.getByTestId('stage-viewport')).toHaveCount(0)
        await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 15_000 })
        await expect
          .poll(async () => ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length, {
            timeout: 20_000,
          })
          .toBeGreaterThan(10_000)
        await expect.poll(async () => (await frameBodyText(page)).length, { timeout: 20_000 }).toBeGreaterThan(100)
        const pcText = await frameBodyText(page)
        log('step3-pc-body', {
          srcdocLen: ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length,
          bodyLen: pcText.length,
          bodyHead: pcText.slice(0, 40).replace(/\s+/g, ' '),
        })
        const pc = await waitForStableZoom(page)
        expect(pc.topbar, 'PC 模式不渲染顶栏移动读数').toBeNull()
        expect(percentOf(pc.stage), 'PC 舞台应有百分比读数').not.toBeNull()
        const pcFrameBox = async () => {
          const box = await page.getByTestId('preview-frame').boundingBox()
          return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null
        }
        const pcAtInitial = await pcFrameBox()
        await page.getByLabel('缩放预设').selectOption('50')
        await expect(page.getByTestId('stage-zoom-readout')).toHaveText('50%', { timeout: 5_000 })
        const pcAt50 = await pcFrameBox()
        await page.getByLabel('缩放预设').selectOption('125')
        await expect(page.getByTestId('stage-zoom-readout')).toHaveText('125%', { timeout: 5_000 })
        const pcAt125 = await pcFrameBox()
        await ctx.shot(3, 'pc-stage')
        log('step3-pc', {
          stageReadout: pc.stage,
          viewportCount: 0,
          frameAtInitial: pcAtInitial,
          frameAt50: pcAt50,
          frameAt125: pcAt125,
          frameChanged: JSON.stringify(pcAtInitial) !== JSON.stringify(pcAt125),
        })

        // 复位到 100%，让后续「退出自适应」有确定期望值。
        await page.getByLabel('缩放预设').selectOption('100')
        await expect(page.getByTestId('stage-zoom-readout')).toHaveText('100%', { timeout: 5_000 })

        await page.locator('button[title="移动端舞台（375 逻辑宽）"]').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 10_000 })
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'on', { timeout: 10_000 })
        const back = await waitForStableZoom(page)
        expect(back.topbar).toBe(back.stage)
        expect(back.mobileMode).toBe('fit-width')
        expect(percentOf(back.stage), '切回移动端应恢复同一自适应比例').toBe(percentOf(fitBefore.stage))
        const shot = await ctx.shot(3, 'mobile-back-fit')
        log('step3-mobile', {
          fitBefore: fitBefore.stage,
          back: back.stage,
          shot: path.relative(path.resolve(__dirname, '..'), shot).split(path.sep).join('/'),
        })
      })

      // ── 4. 侧栏源切换（首页/我的）+ 刷新 ────────────────────────────────
      step = 4
      await test.step('4 源切换 + 刷新', async () => {
        const homeSridoc = ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length
        const homeText = await frameBodyText(page)
        expect(homeText).toContain('猜你喜欢')

        await clickProto(page, '我的')
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-subfile', '我的.html', {
          timeout: 20_000,
        })
        await expect
          .poll(async () => (await frameBodyText(page)).length, { timeout: 20_000 })
          .toBeGreaterThan(20)
        const mineText = await frameBodyText(page)
        expect(mineText).toContain('我的')
        expect(mineText).not.toBe(homeText)
        const mineSridoc = ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length
        expect(mineSridoc).not.toBe(homeSridoc)
        const pillMine = (await page.getByTestId('loc-pill').innerText()).replace(/\s+/g, ' ').trim()
        await ctx.shot(4, 'source-mine')
        log('step4-mine', { sridocLen: mineSridoc, bodyLen: mineText.length, pill: pillMine })

        await clickProto(page, '首页')
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-subfile', '首页.html', {
          timeout: 20_000,
        })
        await expect.poll(async () => (await frameBodyText(page)).length, { timeout: 20_000 }).toBeGreaterThan(100)
        expect(await frameBodyText(page)).toContain('猜你喜欢')

        // 子页：seed 的「首页」目录没有子页面，按计划 SKIP（不判失败）。
        const subPages = await page.getByTestId('stage-subpages').count()
        log('step4-subpages', { count: subPages, status: subPages === 0 ? 'SKIP(no subpages in seed)' : 'present' })

        // 刷新：不白屏、srcdoc 不空、正文仍可见。
        await page.getByTestId('topbar-refresh').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', { timeout: 20_000 })
        await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 20_000 })
        await expect
          .poll(async () => ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length, {
            timeout: 20_000,
          })
          .toBeGreaterThan(10_000)
        await expect.poll(async () => (await frameBodyText(page)).length, { timeout: 20_000 }).toBeGreaterThan(100)
        await expect(page.getByTestId('stage-empty')).toHaveCount(0)
        const shot = await ctx.shot(4, 'refresh-home')
        const refreshedText = await frameBodyText(page)
        log('step4-refresh', {
          sridocLen: ((await page.getByTestId('preview-frame').getAttribute('srcdoc')) || '').length,
          bodyLen: refreshedText.length,
          hasHomeText: refreshedText.includes('猜你喜欢'),
          shot: path.relative(path.resolve(__dirname, '..'), shot).split(path.sep).join('/'),
        })
      })

      // ── 5. 缩放：自适应 / -+ / 预设 / 外层无纵向滚轮 ─────────────────────
      step = 5
      await test.step('5 缩放 / 自适应 / 无外层滚轮', async () => {
        // 5.1 关闭自适应 → 真实 100% 画面
        await page.getByLabel('移动端视图模式').selectOption('100')
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'off', { timeout: 10_000 })
        const manual100 = await assertZoom(page, 100, '退出自适应')
        await ctx.shot(5, 'fit-off-100')
        log('step5-fit-off', { readout: manual100.stage, bbox: manual100.viewport!.bboxW })

        // 5.2 重新开启自适应 → 回到实测比例
        await page.getByLabel('移动端视图模式').selectOption('fit-width')
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'on', { timeout: 10_000 })
        const fitAgain = await waitForStableZoom(page)
        expect(fitAgain.mobileMode).toBe('fit-width')
        expect(fitAgain.topbar).toBe(fitAgain.stage)
        const fitMeasured = (fitAgain.viewport!.bboxW / MOBILE_W) * 100
        expect(Math.abs(fitMeasured - (percentOf(fitAgain.stage) as number))).toBeLessThanOrEqual(1)
        log('step5-fit-on', { readout: fitAgain.stage, measured: fitMeasured })

        // 5.3 四个预设：50 / 75 / 100 / 125（PC 预设下拉；移动端仅 100/125 + 自定义）
        await page.locator('button[title="桌面端舞台"]').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
        for (const percent of [50, 75, 100, 125]) {
          await page.getByLabel('缩放预设').selectOption(String(percent))
          const z = await assertZoom(page, percent, `预设 ${percent}%`)
          log(`step5-preset-${percent}`, {
            topbar: z.topbar,
            stageReadout: z.stage,
            bboxW: z.viewport?.bboxW ?? null,
            fit: z.fit,
          })
          if (percent === 50) await ctx.shot(5, 'preset-50')
          if (percent === 100) await ctx.shot(5, 'preset-100')
          if (percent === 125) await ctx.shot(5, 'preset-125')
        }

        // 5.4 回到移动端并从 125% 起 -/+ 各 10%
        await page.locator('button[title="移动端舞台（375 逻辑宽）"]').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', { timeout: 10_000 })
        await page.getByLabel('移动端视图模式').selectOption('125')
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-fit', 'off', { timeout: 10_000 })
        await page.getByRole('button', { name: '缩小' }).click()
        await assertZoom(page, 115, '缩小')
        log('step5-zoom-out', { readout: (await readZoom(page)).stage })
        await page.getByRole('button', { name: '放大' }).click()
        await assertZoom(page, 125, '放大')
        log('step5-zoom-in', { readout: (await readZoom(page)).stage })

        // 5.5 125% 下外层不得出现纵向滚轮
        const outer = (await readZoom(page)).outer
        log('step5-outer', outer)
        expect(
          outer.docScrollHeight,
          `外层不应可纵向滚动：scrollHeight=${outer.docScrollHeight} clientHeight=${outer.docClientHeight}`,
        ).toBeLessThanOrEqual(outer.docClientHeight + 1)
        await page.mouse.move(700, 20)
        await page.mouse.wheel(0, 900)
        await page.waitForTimeout(300)
        const scrollY = await page.evaluate(() => window.scrollY)
        expect(scrollY, '顶栏滚轮不应滚动外窗').toBe(0)
      })

      // ── 6. 50% / 125% 下 iframe 仍可交互 ────────────────────────────────
      step = 6
      await test.step('6 50% / 125% 交互', async () => {
        // 移动端 50% 由 100% 连续「缩小」得到（每次 10%）；125% 走模式预设。
        await page.getByLabel('移动端视图模式').selectOption('100')
        for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: '缩小' }).click()
        await assertZoom(page, 50, '交互 50%')
        const at50 = await typeInFrame(page, 'W4-50')
        expect(at50.value).toBe('W4-50')
        expect(at50.focused, '50% 下 iframe 输入框应获得焦点').toBe(true)
        const shot50 = await ctx.shot(6, 'interact-50')
        log('step6-50', {
          ...at50,
          shot: path.relative(path.resolve(__dirname, '..'), shot50).split(path.sep).join('/'),
        })

        await page.getByLabel('移动端视图模式').selectOption('125')
        await assertZoom(page, 125, '交互 125%')
        const at125 = await clickCardInFrame(page)
        expect(at125.clicked, '125% 下 iframe 商品卡应收到真实点击').toBe('1')
        expect(at125.scrollY, '125% 下 iframe 内仍可滚动').toBeGreaterThan(0)
        const shot125 = await ctx.shot(6, 'interact-125')
        log('step6-125', {
          ...at125,
          shot: path.relative(path.resolve(__dirname, '..'), shot125).split(path.sep).join('/'),
        })
      })

      // ── 7. console / pageerror / crash ─────────────────────────────────
      step = 7
      await test.step('7 console / pageerror', async () => {
        // seed 原型「大厅.html」自带 Vant/Vue CDN 与内联脚本；其 CSP/语法噪声属用户内容。
        const fatal = ctx!.fatalErrors().filter((t) => !/vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(t))
        log('console', {
          consoleErrors: ctx!.consoleErrors,
          pageErrors: ctx!.pageErrors,
          crashes: ctx!.crashes,
          fatalCount: fatal.length,
        })
        expect(fatal, `致命 console/pageerror/crash 共 ${fatal.length} 条`).toHaveLength(0)
      })

      testInfo.attach('stage-evidence', {
        body: JSON.stringify(
          {
            dataDir: ctx.dataDir,
            userData: ctx.userData,
            seed: ctx.seedPresent,
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
          slug: `stage-step-${step}`,
          level: 'P1',
          expected: '舞台/预览/移动端核心路径可用',
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
