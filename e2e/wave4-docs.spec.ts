/**
 * e2e/wave4-docs.spec.ts — Wave4 A2 冒烟 · 文档查看与交互域（真机）。
 *
 * 只跑本域：`npx playwright test e2e/wave4-docs.spec.ts --workers=1 --output=test-results/wave4/docs`
 * 数据目录：`<repo>/.devdata-wave4-docs`（node e2e/wave4/seed.mjs --domain docs）。
 *
 * 覆盖（父任务 6 步）：
 *   1. 打开文档面板：功能说明非空；表格/列表/代码块真实渲染，无原始 Markdown 文本。
 *   2. 左侧目录常驻（兄弟浮层，无收起按钮）+ 标题跳转；移动端目录抽屉开合 + Tab 不被遮挡。
 *      （W6 对齐：目录改版为 docs-panel 之外的常驻浮层，原「折叠/展开」断言随设计移除。）
 *   3. Ctrl+F：搜索栏、命中计数、上一个/下一个、高亮、Esc 关闭；焦点在设置输入框时不抢占。
 *   4. 段落 ✎ 微改：正文变化 + 落盘；page.reload 后仍保留。
 *   5. 编辑态粘贴富文本：只保留 text/plain + 换行，无 span/style 残留。
 *   6. 独立文档窗：docwin 打开；main→docwin 内容 mirror；docwin 改一处后关闭回面板；独立窗按钮恢复。
 *
 * 只记录 P0/P1；像素/文案不进本报告。不修业务代码。
 */
import { test, expect } from '@playwright/test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Page } from 'playwright'
import { dataDirFor, launchApp, type CloseResult, type Wave4App } from './wave4/harness'

const PROJECT = '测试1'
const PROTO = '首页'
const DOC_REL = path.join('sandbox', PROJECT, PROTO, '首页.md')

/**
 * 域选择：默认 `docs`；P1 复测用 `PLAND_WAVE4_DOMAIN=docs-retest`，
 * 把数据目录与截图隔离到复测域，不覆盖原 A 冒烟证据。
 */
const DOMAIN = (process.env.PLAND_WAVE4_DOMAIN || 'docs').trim() || 'docs'

const FIXTURE_HEADING = '## W4 冒烟校验'
const PARA_MARK = 'W4-段落-起点'
const EDIT_MARK = 'W4-EDIT-OK'
const WIN_MARK = 'W4-MIRROR-WIN'
const PASTE_LINE_1 = 'W4-粘贴纯文本第一行'
const PASTE_LINE_2 = 'W4-粘贴纯文本第二行'
const PASTE_HTML_ONLY = 'W4-HTML-ONLY'

/**
 * 追加到 首页.md 尾部的最小 Markdown 夹具：
 * 现有 seed 只有标题 + 表格，缺列表/代码块/普通段落，无法覆盖本域 A 路径。
 * 只写隔离副本（.devdata-wave4-docs），不碰共享 .devdata；每次运行会重置本节。
 */
const FIXTURE = [
  '',
  FIXTURE_HEADING,
  '',
  `${PARA_MARK}：这是一段用于验证段落微改与独立窗镜像的测试段落。`,
  '',
  '- W4-无序列表项一',
  '- W4-无序列表项二',
  '  - W4-嵌套列表项',
  '',
  '1. W4-有序步骤一',
  '2. W4-有序步骤二',
  '',
  '```text',
  'W4-CODE-LINE',
  'const w4Smoke = true',
  '```',
  '',
  '| W4 校验列 | 结果 |',
  '| :--- | :--- |',
  '| 表格渲染 | W4-TABLE-OK |',
  '',
].join('\n')

type StepStatus = 'PASS' | 'FAIL' | 'SKIP'

interface StepResult {
  no: number
  title: string
  status: StepStatus
  evidence: string
  shots: string[]
  ms: number
}

interface StepOutcome {
  status?: StepStatus
  evidence: string
  shots?: string[]
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

/** 重置并追加夹具；返回绝对路径（隔离副本内）。 */
function prepareDocsFixture(dataDir: string): string {
  const abs = path.join(dataDir, DOC_REL)
  if (!fs.existsSync(abs)) {
    throw new Error(`[wave4/docs] 文档不存在：${abs}；先执行 node e2e/wave4/seed.mjs --domain docs`)
  }
  let raw = readDoc(abs)
  const cut = raw.indexOf(`\n${FIXTURE_HEADING}`)
  if (cut >= 0) raw = raw.slice(0, cut)
  raw = raw.replace(/\s+$/, '') + '\n' + FIXTURE
  fs.writeFileSync(abs, raw, 'utf8')
  return abs
}

function relShot(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/')
}

async function waitForFileContains(file: string, needle: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (readDoc(file).includes(needle)) return
    } catch {
      /* 文件写入中 */
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`文件在 ${timeoutMs}ms 内未包含 ${needle}：${file}`)
}

function parseCount(label: string): { index: number; total: number } {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(label ?? '').trim())
  return m ? { index: Number(m[1]), total: Number(m[2]) } : { index: 0, total: 0 }
}

test.describe('Wave4 A2 文档查看与交互', () => {
  test('A2 docs smoke（真机 6 步）', async ({}, testInfo) => {
    test.setTimeout(480_000)

    const dataDir = dataDirFor(DOMAIN)
    const docPath = prepareDocsFixture(dataDir)
    const baselineHash = sha12(docPath)
    console.log(`[wave4/docs] domain=${DOMAIN} doc=${docPath} baselineSha=${baselineHash}`)

    const ctx: Wave4App = await launchApp({ domain: DOMAIN })
    const page = ctx.page
    const results: StepResult[] = []
    const failures: string[] = []

    async function runStep(no: number, title: string, fn: () => Promise<StepOutcome>): Promise<void> {
      const started = Date.now()
      try {
        const out = await fn()
        const status: StepStatus = out.status ?? 'PASS'
        const shots = out.shots ?? []
        results.push({ no, title, status, evidence: out.evidence, shots, ms: Date.now() - started })
        console.log(
          `[wave4/docs] STEP ${no} ${status} ${title} | ${out.evidence} | ${shots.join(',') || '-'} | ${Date.now() - started}ms`,
        )
        if (status === 'FAIL') failures.push(`${no}. ${title}: ${out.evidence}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const shots: string[] = []
        try {
          shots.push(await ctx.shot(no, `${title.split(/\s+/)[0] || 'step'}-exception`, { fail: true }))
        } catch {
          /* 页面已关闭 */
        }
        results.push({ no, title, status: 'FAIL', evidence: message, shots, ms: Date.now() - started })
        failures.push(`${no}. ${title}: ${message}`)
        console.log(`[wave4/docs] STEP ${no} FAIL ${title} | ${message} | ${Date.now() - started}ms`)
      }
    }

    const topbar = () => page.getByTestId('topbar')
    const docsPanel = () => page.getByTestId('docs-panel')
    const docPreview = () => page.getByTestId('docs-panel').getByTestId('doc-preview')

    /** 冷启动后进入 测试1/首页（项目选择器出现时按真实入口进入）。 */
    async function enterProjectAndSource(target: Page): Promise<string> {
      await target.getByTestId('main-window').waitFor({ state: 'visible', timeout: 30_000 })
      await target.waitForTimeout(2_500)
      const picker = target.getByTestId('project-picker')
      if (await picker.isVisible().catch(() => false)) {
        const row = picker.locator('li').filter({ hasText: PROJECT }).first()
        await row.getByRole('button').first().click()
        await picker.getByRole('button', { name: '进入项目' }).click()
        await expect(picker).toBeHidden({ timeout: 30_000 })
      }
      if (!(await target.getByTestId('sidebar').isVisible().catch(() => false))) {
        await target.getByTestId('topbar').getByRole('button', { name: '展开侧栏' }).click()
      }
      await expect(target.getByTestId('sidebar-tree')).toBeVisible({ timeout: 20_000 })
      const proto = target
        .getByTestId('sidebar')
        .locator('button[data-level="proto"]')
        .filter({ hasText: PROTO })
        .first()
      await expect(proto).toBeVisible({ timeout: 20_000 })
      await proto.click()
      await expect(target.getByTestId('stage-frame')).toHaveAttribute('data-has-source', '1', {
        timeout: 15_000,
      })
      return (await target.getByTestId('loc-pill').innerText()).replace(/\s+/g, ' ').trim()
    }

    /** 切 PC 并打开「文档」面板（PC 形态 overlay）。 */
    async function openDocsPc(target: Page): Promise<void> {
      const stage = target.getByTestId('stage-frame')
      if ((await stage.getAttribute('data-kind')) !== 'pc') {
        await target.locator('button[title="桌面端舞台"]').click()
        await expect(stage).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
      }
      if (!(await docsPanel().isVisible().catch(() => false))) {
        await topbar().getByRole('button', { name: '文档', exact: true }).click()
      }
      await expect(docsPanel()).toBeVisible({ timeout: 10_000 })
      await expect(docsPanel()).toHaveAttribute('data-variant', 'overlay')
      await expect
        .poll(async () => (await docPreview().innerText().catch(() => '')).trim().length, { timeout: 20_000 })
        .toBeGreaterThan(0)
    }

    let closeResult: CloseResult | null = null
    let fatal: string[] = []

    try {
      // ── 0. 冷启动 + 进入 测试1/首页（前置，不计入 6 步） ─────────────────
      const pill = await enterProjectAndSource(page)
      const shot0 = await ctx.shot(0, 'cold-start')
      console.log(`[wave4/docs] entered ${pill}`)

      // ── 1. 打开文档面板：Markdown 真渲染 ──────────────────────────────
      await runStep(1, '文档面板 / Markdown 渲染', async () => {
        await openDocsPc(page)
        const panel = docsPanel()
        const preview = docPreview()
        await expect(panel.getByTestId('docs-doc-title')).toContainText('功能说明')

        const text = (await preview.innerText()).trim()
        expect(text.length, '功能说明正文长度').toBeGreaterThan(3_000)

        // 关键回归：表格必须是 table，不是原始 Markdown 竖线文本。
        expect(text, '正文不应出现原始表格行').not.toContain('| 维度 | 说明 |')
        expect(text, '正文不应出现原始表格分隔行').not.toContain('| :--- |')
        await expect(preview.locator('p').filter({ hasText: /^\s*\|/ })).toHaveCount(0)

        const tableCount = await preview.locator('table').count()
        const listCount = await preview.locator('ul, ol').count()
        const codeCount = await preview.locator('pre[data-doc-code]').count()
        expect(tableCount, '表格数量（seed 4 + 夹具 1）').toBeGreaterThanOrEqual(5)
        expect(listCount, '列表数量（无序 + 有序）').toBeGreaterThanOrEqual(2)
        expect(codeCount, '围栏代码块数量').toBeGreaterThanOrEqual(1)

        await expect(preview.locator('th').filter({ hasText: '维度' }).first()).toBeVisible()
        await expect(preview.locator('th').filter({ hasText: '说明' }).first()).toBeVisible()
        await expect(preview.locator('code').filter({ hasText: 'W4-CODE-LINE' })).toHaveCount(1)
        await expect(preview.locator('li').filter({ hasText: 'W4-无序列表项一' })).toHaveCount(1)
        await expect(preview.locator('ol > li').filter({ hasText: 'W4-有序步骤一' })).toHaveCount(1)

        const shot = await ctx.shot(1, 'panel-markdown')
        return {
          evidence: `overlay 面板；正文=${text.length} 字；表格=${tableCount}；列表=${listCount}；代码块=${codeCount}；原始 Markdown 竖线行=0；首行=${text.split('\n')[0]}`,
          shots: [relShot(shot)],
        }
      })

      // ── 2. 目录常驻 / 跳转；移动端抽屉 ────────────────────────────────
      await runStep(2, '目录常驻 / 跳转 / 移动端抽屉', async () => {
        const panel = docsPanel()
        const preview = docPreview()
        // W6 对齐：目录改版后是 docs-panel 的兄弟浮层（PC overlay 常驻，不再在面板内部）。
        const tocSidebar = page.getByTestId('doc-toc-sidebar')
        await expect(tocSidebar).toBeVisible()
        await expect(panel.getByTestId('doc-toc-sidebar'), '目录不应再渲染在 docs-panel 内部').toHaveCount(0)
        // 常驻设计：折叠/展开开关已随目录改版移除。
        await expect(page.getByRole('button', { name: '收起目录' }), 'PC 目录常驻，不应有收起按钮').toHaveCount(0)
        await expect(page.getByTestId('doc-toc-toggle')).toHaveCount(0)
        const tocItems = tocSidebar.getByTestId('doc-toc-item')
        const tocCount = await tocItems.count()
        expect(tocCount, 'PC 目录条目数').toBeGreaterThanOrEqual(6)
        const shotCollapse = await ctx.shot(2, 'toc-resident')

        // 点击最后一条目录（夹具标题，位于文末），正文应滚动且标题进入视口。
        const last = tocItems.last()
        const lastText = (await last.innerText()).trim()
        const lastId = await last.getAttribute('data-toc-id')
        expect(lastId, '目录条目应有 data-toc-id').toBeTruthy()
        const before = await preview.evaluate((el) => (el as HTMLElement).scrollTop)
        await last.click()
        await expect
          .poll(() => preview.evaluate((el) => (el as HTMLElement).scrollTop), { timeout: 8_000 })
          .toBeGreaterThan(before + 40)
        const heading = preview.locator(`[data-toc-id="${lastId}"]`).first()
        await expect(heading).toBeVisible()
        // 平滑滚动是动画过程：scrollTop 先变，标题进入视口有延迟，按最终位置轮询。
        await expect
          .poll(
            async () => {
              const hb = await heading.boundingBox()
              const pb = await preview.boundingBox()
              if (!hb || !pb) return false
              return hb.y >= pb.y - 2 && hb.y < pb.y + pb.height
            },
            { timeout: 8_000 },
          )
          .toBe(true)
        const hb = await heading.boundingBox()
        const pb = await preview.boundingBox()
        const inView = !!hb && !!pb && hb.y >= pb.y - 2 && hb.y < pb.y + pb.height
        const after = await preview.evaluate((el) => (el as HTMLElement).scrollTop)
        const shotJump = await ctx.shot(2, 'toc-jump')

        // 移动端 inline 形态 + 目录抽屉。
        await page.keyboard.press('Escape')
        await expect(docsPanel()).toBeHidden({ timeout: 5_000 })
        await page.locator('button[title="移动端舞台（375 逻辑宽）"]').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'mobile', {
          timeout: 10_000,
        })
        // W6 对齐：移动端默认 chrome 自动打开文档；仅在未打开时点「文档」，避免把已打开的文档点关。
        if (!(await docsPanel().isVisible().catch(() => false))) {
          await topbar().getByRole('button', { name: '文档', exact: true }).click()
        }
        const mobilePanel = docsPanel()
        await expect(mobilePanel).toHaveAttribute('data-variant', 'inline', { timeout: 10_000 })
        await expect(mobilePanel.getByTestId('doc-toc-drawer')).toHaveCount(1)

        // 旧 P1 回归：Tab 中心点必须命中 docs-panel（不能被预览浮层工具栏遮挡）。
        const latestTab = mobilePanel.getByRole('tab', { name: '最新需求' })
        const hit = await latestTab.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const node = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null
          const owner = node?.closest('[data-testid]') as HTMLElement | null
          return {
            insideDocs: !!(node && node.closest('[data-testid="docs-panel"]')),
            owner: owner?.getAttribute('data-testid') || node?.tagName || 'none',
          }
        })
        expect(hit.insideDocs, `移动端「最新需求」Tab 被遮挡，命中=${hit.owner}`).toBe(true)
        await latestTab.click()
        await expect(latestTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
        await mobilePanel.getByRole('tab', { name: '功能说明' }).click()
        await expect(mobilePanel.getByRole('tab', { name: '功能说明' })).toHaveAttribute(
          'aria-selected',
          'true',
          { timeout: 5_000 },
        )

        const drawerBtn = mobilePanel.getByRole('button', { name: '目录', exact: true }).first()
        await drawerBtn.click()
        const drawer = mobilePanel.getByTestId('doc-toc-drawer')
        await expect(drawer).toHaveAttribute('data-open', 'true', { timeout: 5_000 })
        const drawerBox = await drawer.boundingBox()
        const tabBox = await mobilePanel.getByRole('tablist').boundingBox()
        expect(drawerBox, '目录抽屉应有布局盒').not.toBeNull()
        expect(tabBox, 'Tab 列表应有布局盒').not.toBeNull()
        expect(
          drawerBox!.y,
          '目录抽屉不应遮挡 Tab（抽屉顶边应在 Tab 列表底边之下）',
        ).toBeGreaterThanOrEqual(tabBox!.y + tabBox!.height - 1)
        const shotDrawer = await ctx.shot(2, 'mobile-toc-drawer')
        const drawerItem = drawer.getByTestId('doc-toc-item').nth(1)
        await drawerItem.click()
        await expect(drawer).toHaveAttribute('data-open', 'false', { timeout: 5_000 })

        await page.keyboard.press('Escape')
        await expect(docsPanel()).toBeHidden({ timeout: 5_000 })
        await page.locator('button[title="桌面端舞台"]').click()
        await expect(page.getByTestId('stage-frame')).toHaveAttribute('data-kind', 'pc', { timeout: 10_000 })
        await openDocsPc(page)

        return {
          evidence: `PC 目录=${tocCount} 条（兄弟浮层常驻，无收起按钮）；点击「${lastText}」scrollTop ${Math.round(before)}→${Math.round(after)}，标题入视口=${inView}；移动端 Tab 命中=${hit.owner}（docs-panel 内）；抽屉 data-open true→点击条目→false；抽屉未遮挡 Tab`,
          shots: [relShot(shotCollapse), relShot(shotJump), relShot(shotDrawer)],
        }
      })

      // ── 3. Ctrl+F 正文查找 + 焦点守卫 ─────────────────────────────────
      await runStep(3, 'Ctrl+F 查找 / 焦点守卫', async () => {
        const panel = docsPanel()
        const preview = docPreview()
        // PC 目录侧栏以 overlay 覆盖正文左侧 176px；点右侧空白聚焦，避免命中目录搜索框。
        const previewBox = await preview.boundingBox()
        expect(previewBox, '文档正文应有布局盒').not.toBeNull()
        await preview.click({ position: { x: Math.max(220, (previewBox as { width: number }).width * 0.7), y: 24 } })
        await page.keyboard.press('Control+f')
        const bar = panel.getByTestId('doc-searchbar')
        await expect(bar).toBeVisible({ timeout: 5_000 })
        await expect(page.getByTestId('doc-search-input')).toBeFocused()

        const input = panel.getByTestId('doc-search-input')
        const countLabel = panel.getByTestId('doc-search-count')
        await input.fill('商品')
        let total = 0
        await expect
          .poll(
            async () => {
              const parsed = parseCount(await countLabel.innerText())
              total = parsed.total
              return parsed.total
            },
            { timeout: 8_000 },
          )
          .toBeGreaterThan(3)
        const marks = preview.locator('mark[data-doc-hit]')
        await expect(marks).toHaveCount(total, { timeout: 8_000 })
        await expect(preview.locator('mark[data-active="true"]')).toHaveCount(1)
        await expect(countLabel).toHaveText(`1 / ${total}`)
        const shotOpen = await ctx.shot(3, 'search-hits')

        await panel.getByTestId('doc-search-next').click()
        await expect(countLabel).toHaveText(`2 / ${total}`)
        await expect(preview.locator('mark[data-active="true"]')).toHaveAttribute('data-doc-hit', '1')
        const shotNext = await ctx.shot(3, 'search-next')
        await panel.getByTestId('doc-search-prev').click()
        await expect(countLabel).toHaveText(`1 / ${total}`)
        await expect(preview.locator('mark[data-active="true"]')).toHaveAttribute('data-doc-hit', '0')

        // Esc 只关搜索，不关面板；高亮清空。
        await input.press('Escape')
        await expect(bar).toBeHidden({ timeout: 5_000 })
        await expect(panel).toBeVisible()
        await expect(preview.locator('mark[data-doc-hit]')).toHaveCount(0)

        // 焦点守卫：设置「模型管理」搜索框获得焦点时，Ctrl+F 不得抢占。
        await page.keyboard.press('Escape')
        await expect(docsPanel()).toBeHidden({ timeout: 5_000 })
        if (!(await page.getByTestId('sidebar').isVisible().catch(() => false))) {
          await topbar().getByRole('button', { name: '展开侧栏' }).click()
        }
        await page.getByTestId('sidebar').getByRole('button', { name: '打开设置' }).click()
        const settings = page.getByTestId('settings-dialog')
        await expect(settings).toBeVisible({ timeout: 10_000 })
        await settings.getByRole('tab', { name: '模型管理' }).click()
        const modelSearch = page.getByLabel('搜索模型')
        await expect(modelSearch).toBeVisible({ timeout: 10_000 })
        await modelSearch.click()
        await expect(modelSearch).toBeFocused()

        // 设置弹层挡住了顶栏，用真实 DOM click 打开文档面板（绕过 hit-test，语义仍是顶层「文档」入口）。
        const openedByTopbar = await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="topbar"]')
          const btn = Array.from(bar?.querySelectorAll('button') ?? []).find(
            (b) => b.getAttribute('aria-label') === '文档',
          )
          if (!btn) return false
          ;(btn as HTMLButtonElement).click()
          return true
        })
        expect(openedByTopbar, '应能触发顶栏「文档」入口').toBe(true)
        await expect(docsPanel()).toBeVisible({ timeout: 10_000 })
        await modelSearch.focus()
        await expect(modelSearch).toBeFocused()

        await page.keyboard.press('Control+f')
        await page.waitForTimeout(400)
        await expect(docsPanel().getByTestId('doc-searchbar')).toHaveCount(0)
        const stillFocused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
        expect(stillFocused, '焦点应仍在设置搜索框').toBe('搜索模型')
        const shotGuard = await ctx.shot(3, 'search-guard-settings')

        await page.keyboard.press('Escape')
        await expect(settings).toBeHidden({ timeout: 5_000 })
        await page.keyboard.press('Escape')
        await expect(docsPanel()).toBeHidden({ timeout: 5_000 })

        return {
          evidence: `Ctrl+F 打开搜索并聚焦；关键词「商品」命中=${total}；mark 高亮=${total}；next→2/${total}，prev→1/${total}；Esc 关搜索且面板保留；设置「搜索模型」聚焦时 Ctrl+F 未打开搜索栏、焦点未丢失`,
          shots: [relShot(shotOpen), relShot(shotNext), relShot(shotGuard)],
        }
      })

      // ── 4. 段落 ✎ 微改 + 落盘 + reload 持久化 ─────────────────────────
      await runStep(4, '段落微改 / 落盘 / 刷新保留', async () => {
        await openDocsPc(page)
        const panel = docsPanel()
        const preview = docPreview()
        const para = preview.locator('[data-para-idx]').filter({ hasText: PARA_MARK }).first()
        await expect(para).toBeVisible({ timeout: 10_000 })
        // 滚到容器中部，给 Popover 留出空间；hover 只负责验证 ✎ 可见。
        await para.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(200)
        await para.hover()
        const micro = para.getByTestId('doc-micro-edit')
        await expect(micro).toBeVisible({ timeout: 5_000 })
        // group-hover 按钮在 Playwright 滚动/命中测试时会失去 hover，用 DOM click 触发真实 onClick。
        await micro.evaluate((el) => (el as HTMLElement).click())
        const editInput = page.getByLabel('微改内容')
        await expect(editInput).toBeVisible()
        await expect(editInput).toHaveValue(new RegExp(PARA_MARK))
        const original = await editInput.inputValue()
        expect(original.trim(), '微改框应预填本段原文').toBe(
          `${PARA_MARK}：这是一段用于验证段落微改与独立窗镜像的测试段落。`,
        )
        const shotPopover = await ctx.shot(4, 'micro-edit-popover')
        await editInput.fill(`${original.trimEnd()} ${EDIT_MARK}`)
        // Enter 与「应用」等价（Popover 在文末时按钮可能贴近滚动容器边缘）。
        await editInput.press('Enter')

        await expect
          .poll(async () => (await preview.innerText()).includes(EDIT_MARK), { timeout: 20_000 })
          .toBe(true)
        await waitForFileContains(docPath, EDIT_MARK, 20_000)
        await expect(panel.getByText('未保存', { exact: true })).toHaveCount(0)
        const editedHash = sha12(docPath)
        const shotSaved = await ctx.shot(4, 'micro-edit-saved')

        // 刷新重载：必须从磁盘重新读到微改内容。
        await page.reload({ waitUntil: 'domcontentloaded' })
        const pillAfterReload = await enterProjectAndSource(page)
        await openDocsPc(page)
        const reloadPreview = docPreview()
        await expect
          .poll(async () => (await reloadPreview.innerText()).includes(EDIT_MARK), { timeout: 25_000 })
          .toBe(true)
        const reloadText = await reloadPreview.innerText()
        expect(reloadText.includes(EDIT_MARK), '刷新后正文仍应包含微改标记').toBe(true)
        const shotPersist = await ctx.shot(4, 'micro-edit-persist')

        return {
          evidence: `微改框预填原文=OK；应用后正文出现「${EDIT_MARK}」；磁盘文件包含标记（sha ${baselineHash}→${editedHash}）；reload 后重新进入「${pillAfterReload}」仍含标记=OK`,
          shots: [relShot(shotPopover), relShot(shotSaved), relShot(shotPersist)],
        }
      })

      // ── 5. 编辑态粘贴富文本：只留纯文本/换行 ─────────────────────────
      await runStep(5, '编辑态富文本粘贴', async () => {
        const panel = docsPanel()
        const preview = docPreview()

        // 5a. P1-1 回归：进入编辑 → 取消（不粘贴），预览不得混入编辑区的原始 Markdown、
        //     不得重复渲染正文；正文结构/长度应与进入编辑前一致。
        await preview.evaluate((el) => ((el as HTMLElement).scrollTop = 0))
        const beforeCancelText = (await preview.innerText()).trim()
        const beforeCancelStats = await preview.evaluate((el) => ({
          h1: el.querySelectorAll('h1').length,
          tables: el.querySelectorAll('table').length,
        }))
        await panel.getByRole('button', { name: '进入编辑' }).click()
        const area0 = page.getByTestId('doc-edit-area')
        await expect(area0).toBeVisible({ timeout: 5_000 })
        await panel.getByRole('button', { name: '取消', exact: true }).click()
        await expect(area0).toHaveCount(0)
        await expect(preview).toBeVisible()
        await page.waitForTimeout(300)
        const afterPlainCancel = await preview.innerText()
        const plainStats = await preview.evaluate((el) => ({
          h1: el.querySelectorAll('h1').length,
          tables: el.querySelectorAll('table').length,
          firstLine: (el.innerText || '').trim().split('\n')[0] ?? '',
        }))
        const plainChecks = {
          rawHeading: afterPlainCancel.includes('# 商城首页'),
          rawRule: /^-{3,}$/m.test(afterPlainCancel),
          rawTable:
            afterPlainCancel.includes('| 维度 |') ||
            afterPlainCancel.includes('| :--- |') ||
            afterPlainCancel.includes('| W4 校验列 |') ||
            /^\s*\|/m.test(afterPlainCancel),
          fence: afterPlainCancel.includes('```'),
          duplicated:
            plainStats.h1 !== beforeCancelStats.h1 ||
            plainStats.tables !== beforeCancelStats.tables ||
            afterPlainCancel.trim().length > beforeCancelText.length + 200,
          precededByMarkdown: plainStats.firstLine.startsWith('#') || plainStats.firstLine.startsWith('|'),
          h1: plainStats.h1,
          tables: plainStats.tables,
          len: afterPlainCancel.trim().length,
        }
        const plainCancelLeak =
          plainChecks.rawHeading ||
          plainChecks.rawRule ||
          plainChecks.rawTable ||
          plainChecks.fence ||
          plainChecks.duplicated ||
          plainChecks.precededByMarkdown
        const shotPlainCancel = await ctx.shot(5, plainCancelLeak ? 'edit-cancel-leak' : 'edit-cancel-clean', {
          fail: plainCancelLeak,
        })
        expect(plainChecks.rawHeading, 'P1-1：取消后预览不得出现原始标题 `# 商城首页`').toBe(false)
        expect(plainChecks.rawRule, 'P1-1：取消后预览不得出现原始分隔线 `---`').toBe(false)
        expect(plainChecks.rawTable, 'P1-1：取消后预览不得出现原始表格竖线文本').toBe(false)
        expect(plainChecks.fence, 'P1-1：取消后预览不得出现代码围栏 ```').toBe(false)
        expect(plainChecks.precededByMarkdown, 'P1-1：预览首行必须是渲染后正文').toBe(false)
        expect(plainChecks.h1, 'P1-1：正文标题不得重复').toBe(beforeCancelStats.h1)
        expect(plainChecks.tables, 'P1-1：正文表格数量不得重复').toBe(beforeCancelStats.tables)
        expect(plainChecks.duplicated, 'P1-1：取消后正文不得重复渲染').toBe(false)

        // 5b. 粘贴 text/html(span/style/color) + text/plain。
        await panel.getByRole('button', { name: '进入编辑' }).click()
        const area = page.getByTestId('doc-edit-area')
        await expect(area).toBeVisible({ timeout: 5_000 })
        await area.click()
        await page.keyboard.press('Control+End')

        const previousDisk = readDoc(docPath)
        await page.evaluate(
          ({ line1, line2, htmlOnly }) => {
            const el = document.querySelector('[data-testid="doc-edit-area"]') as HTMLElement | null
            if (!el) throw new Error('doc-edit-area missing')
            el.focus()
            const dt = new DataTransfer()
            dt.setData('text/plain', `${line1}\n${line2}`)
            dt.setData(
              'text/html',
              `<p style="color:#ff0000;font-weight:bold"><span style="background:#ffff00">${line1}</span></p>` +
                `<span style="color:#0000ff;text-decoration:underline">${line2}</span>` +
                `<span style="display:none">${htmlOnly}</span>`,
            )
            el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
          },
          { line1: PASTE_LINE_1, line2: PASTE_LINE_2, htmlOnly: PASTE_HTML_ONLY },
        )

        await expect
          .poll(async () => (await area.innerText()).includes(PASTE_LINE_1), { timeout: 8_000 })
          .toBe(true)
        const info = await area.evaluate((el) => ({
          html: (el as HTMLElement).innerHTML,
          text: (el as HTMLElement).innerText,
        }))
        expect(info.text.includes(PASTE_LINE_1), '应保留纯文本第一行').toBe(true)
        expect(info.text.includes(PASTE_LINE_2), '应保留纯文本第二行').toBe(true)
        expect(info.text.includes(PASTE_HTML_ONLY), 'HTML 独有内容不得进入编辑器').toBe(false)
        expect(/<span/i.test(info.html), '不得残留 span').toBe(false)
        expect(/style\s*=/i.test(info.html), '不得残留 style 属性').toBe(false)
        expect(/font-weight|text-decoration|color\s*:/i.test(info.html), '不得残留颜色/字重样式').toBe(false)
        const tags = [...info.html.matchAll(/<\s*([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase())
        expect(
          tags.filter((t) => !['br', 'div', 'p'].includes(t)),
          '只允许纯文本换行标签',
        ).toEqual([])
        await expect(panel.getByText('未保存', { exact: true })).toBeVisible()
        const shotPaste = await ctx.shot(5, 'paste-plain')

        await panel.getByRole('button', { name: '取消', exact: true }).click()
        await expect(area).toHaveCount(0)
        await expect(preview).toBeVisible()
        await page.waitForTimeout(300)
        const afterPasteCancel = await preview.innerText()
        const pasteStats = await preview.evaluate((el) => ({
          h1: el.querySelectorAll('h1').length,
          tables: el.querySelectorAll('table').length,
          firstLine: (el.innerText || '').trim().split('\n')[0] ?? '',
        }))
        const pasteCancelLeak =
          afterPasteCancel.includes('# 商城首页') ||
          afterPasteCancel.includes('| 维度 |') ||
          afterPasteCancel.includes('| :--- |') ||
          afterPasteCancel.includes('| W4 校验列 |') ||
          /^\s*\|/m.test(afterPasteCancel) ||
          afterPasteCancel.includes('```') ||
          afterPasteCancel.includes(PASTE_LINE_1) ||
          pasteStats.firstLine.startsWith('#') ||
          pasteStats.firstLine.startsWith('|') ||
          pasteStats.h1 !== beforeCancelStats.h1 ||
          pasteStats.tables !== beforeCancelStats.tables ||
          afterPasteCancel.trim().length > beforeCancelText.length + 200
        const shotAfterCancel = await ctx.shot(5, pasteCancelLeak ? 'paste-cancel-leak' : 'paste-cancel-clean', {
          fail: pasteCancelLeak,
        })
        expect(afterPasteCancel.includes('# 商城首页'), 'P1-1：粘贴后取消不得出现原始标题').toBe(false)
        expect(afterPasteCancel.includes('| 维度 |'), 'P1-1：粘贴后取消不得出现原始表格竖线').toBe(false)
        expect(afterPasteCancel.includes('```'), 'P1-1：粘贴后取消不得出现代码围栏').toBe(false)
        expect(pasteStats.h1, 'P1-1：粘贴后取消正文标题不得重复').toBe(beforeCancelStats.h1)
        expect(pasteStats.tables, 'P1-1：粘贴后取消正文表格数量不得重复').toBe(beforeCancelStats.tables)
        expect(afterPasteCancel.trim().length, 'P1-1：粘贴后取消正文不得重复渲染').toBeLessThanOrEqual(
          beforeCancelText.length + 200,
        )
        expect(afterPasteCancel.includes(PASTE_LINE_1), '取消后预览不应包含粘贴内容').toBe(false)
        expect(readDoc(docPath).includes(PASTE_LINE_1), '取消后磁盘不得出现粘贴内容').toBe(false)
        expect(readDoc(docPath), '取消后磁盘内容应与粘贴前一致').toBe(previousDisk)

        const leak = plainCancelLeak || pasteCancelLeak

        // 清理：preview 的 DOM 残留用 reload 重建，避免污染后续 docwin 镜像取证。
        await page.reload({ waitUntil: 'domcontentloaded' })
        const pillAfterPaste = await enterProjectAndSource(page)
        await openDocsPc(page)

        return {
          status: leak ? 'FAIL' : 'PASS',
          evidence:
            `粘贴 text/html(span/style/color)+text/plain：编辑器保留两行纯文本、不含 HTML-only 标记；innerHTML 无 span/style/颜色（标签=${tags.join(',') || '无'}，共 ${tags.length} 个）；未保存 Badge 出现；取消后磁盘未变。` +
            `P1-1 回归：仅进入编辑→取消：原始标题=${plainChecks.rawHeading ? '有' : '无'}、原始分隔线=${plainChecks.rawRule ? '有' : '无'}、原始表格竖线=${plainChecks.rawTable ? '有' : '无'}、代码围栏=${plainChecks.fence ? '有' : '无'}、首行=${plainChecks.precededByMarkdown ? '原始 Markdown' : '渲染正文'}、标题数=${plainChecks.h1}、表格数=${plainChecks.tables}、正文长度=${beforeCancelText.length}→${plainChecks.len}；` +
            `粘贴后取消：原始 Markdown=${pasteCancelLeak ? '有' : '无'}、标题数=${pasteStats.h1}、表格数=${pasteStats.tables}、正文长度=${afterPasteCancel.trim().length}；` +
            `reload 后已重新进入「${pillAfterPaste}」`,
          shots: [relShot(shotPlainCancel), relShot(shotPaste), relShot(shotAfterCancel)],
        }
      })

      // ── 6. 独立文档窗 docwin + mirror ─────────────────────────────────
      await runStep(6, '独立文档窗 / mirror / 关闭回面板', async () => {
        const panel = docsPanel()
        const preview = docPreview()
        const mainBefore = await preview.innerText()
        expect(mainBefore.includes(EDIT_MARK), `主窗正文应含 ${EDIT_MARK}（len=${mainBefore.length}）`).toBe(true)

        const winPromise = ctx.app.waitForEvent('window', { timeout: 20_000 })
        await panel.getByRole('button', { name: '在独立窗口打开文档' }).click()
        const docPage = await winPromise
        try {
          await docPage.getByTestId('doc-window').waitFor({ state: 'visible', timeout: 20_000 })
          await expect(docsPanel()).toBeHidden({ timeout: 10_000 })
          const dwPreview = docPage.getByTestId('doc-preview')
          await expect
            .poll(async () => (await dwPreview.innerText().catch(() => '')).trim().length, { timeout: 30_000 })
            .toBeGreaterThan(3_000)
          const dwBefore = await dwPreview.innerText()
          expect(
            dwBefore.includes(EDIT_MARK),
            `docwin 初始正文应镜像主窗（含 ${EDIT_MARK}；len=${dwBefore.length}）`,
          ).toBe(true)
          const shotOpen = await ctx.shot(6, 'docwin-open', { page: docPage })

          // 在独立窗内微改一段并保存（写隔离副本）。
          const para = dwPreview.locator('[data-para-idx]').filter({ hasText: PARA_MARK }).first()
          await expect(para).toBeVisible({ timeout: 10_000 })
          await para.evaluate((el) => el.scrollIntoView({ block: 'center' }))
          await docPage.waitForTimeout(200)
          await para.hover()
          const dwMicro = para.getByTestId('doc-micro-edit')
          await expect(dwMicro).toBeVisible({ timeout: 5_000 })
          await dwMicro.evaluate((el) => (el as HTMLElement).click())
          const dwInput = docPage.getByLabel('微改内容')
          const dwValue = await dwInput.inputValue()
          await dwInput.fill(`${dwValue.trimEnd()} ${WIN_MARK}`)
          await dwInput.press('Enter')
          await expect
            .poll(async () => (await dwPreview.innerText()).includes(WIN_MARK), { timeout: 20_000 })
            .toBe(true)
          await waitForFileContains(docPath, WIN_MARK, 20_000)
          const shotWinEdited = await ctx.shot(6, 'docwin-edited', { page: docPage })

          // 回主窗关闭独立窗（X 关窗只同步按钮态，不自动开面板；再点顶栏「文档」打开面板）。
          await page.bringToFront().catch(() => undefined)
          await docPage.close()
          await expect.poll(() => docPage.isClosed(), { timeout: 15_000 }).toBe(true)
          await page.getByTestId('topbar-docs').click()
          await expect(docsPanel()).toBeVisible({ timeout: 15_000 })
          const backendStats = await docPreview().evaluate((el) => ({
            h1: el.querySelectorAll('h1').length,
            tables: el.querySelectorAll('table').length,
          }))
          const backendText = await docPreview().innerText()
          const mirrorBack = backendText.includes(WIN_MARK)
          expect(backendStats.h1, 'P1-2：mirror-back 后正文标题不得重复').toBe(1)
          expect(backendStats.tables, 'P1-2：mirror-back 后正文表格数量不得异常').toBeGreaterThanOrEqual(5)
          const reloadButton = docsPanel().getByRole('button', { name: '在独立窗口打开文档' })
          await expect(reloadButton).toBeVisible()
          await expect(reloadButton).toBeEnabled()
          // 把 W4 段落滚到视口内，让 FAIL 截图能直接看出缺少 W4-MIRROR-WIN。
          const backendPara = docPreview().locator('[data-para-idx]').filter({ hasText: PARA_MARK }).first()
          await backendPara.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => undefined)
          await page.waitForTimeout(250)
          const shotClosed = await ctx.shot(6, mirrorBack ? 'docwin-closed-panel' : 'docwin-mirror', {
            fail: !mirrorBack,
          })

          // 若 mirror-back 缺失，再刷新主窗证明磁盘内容已写入（区分“保存失败”与“仅同步缺失”）。
          let diskPersisted = false
          if (!mirrorBack) {
            await page.reload({ waitUntil: 'domcontentloaded' })
            await enterProjectAndSource(page)
            await openDocsPc(page)
            diskPersisted = (await docPreview().innerText()).includes(WIN_MARK)
            const reloadPara = docPreview().locator('[data-para-idx]').filter({ hasText: PARA_MARK }).first()
            await reloadPara.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => undefined)
            await page.waitForTimeout(250)
            await ctx.shot(6, 'docwin-mirror-after-reload')
          }

          // P1-2 硬断言：不依赖刷新，关闭独立窗后主窗必须立即看到独立窗保存的内容。
          expect(mirrorBack, `P1-2：docwin 保存后回主窗应立即包含「${WIN_MARK}」（len=${backendText.length}）`).toBe(true)

          return {
            status: mirrorBack ? 'PASS' : 'FAIL',
            evidence: mirrorBack
              ? `docwin 打开；初始镜像含「${EDIT_MARK}」；独立窗微改写入「${WIN_MARK}」并落盘；关闭后主窗面板即时包含该标记（未刷新；h1=${backendStats.h1}，tables=${backendStats.tables}，len=${backendText.length}）；「独立窗口」按钮恢复可点`
              : `docwin 打开/初始镜像/独立窗保存均成功（磁盘含「${WIN_MARK}」）；关闭回面板后主窗正文不含该标记（len=${backendText.length}，含 EDIT=${backendText.includes(EDIT_MARK)}，含 MIRROR=${mirrorBack}）；「独立窗口」按钮已恢复；刷新主窗后可见=${diskPersisted}`,
            shots: [relShot(shotOpen), relShot(shotWinEdited), relShot(shotClosed)],
          }
        } finally {
          if (!docPage.isClosed()) await docPage.close().catch(() => undefined)
        }
      })

      // seed 原型自带 Vant/Vue CDN 与内联脚本噪声，属用户内容，不计工具致命错误。
      fatal = ctx.fatalErrors().filter((t) => !/vant|cdn\.jsdelivr\.net|unpkg\.com|unexpected token '\.'/i.test(t))
      console.log(`[wave4/docs] FATAL_CONSOLE=${fatal.length}`)
      if (fatal.length) console.log('[wave4/docs] FATAL\n' + fatal.join('\n'))
      closeResult = await ctx.close()
      console.log(
        `[wave4/docs] close method=${closeResult.method} exit=${closeResult.exitCode} elapsed=${closeResult.elapsedMs}ms`,
      )
    } finally {
      if (!closeResult) {
        try {
          closeResult = await ctx.close({ graceMs: 5_000, appCloseMs: 3_000 })
        } catch (err) {
          console.log(`[wave4/docs] forced close failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      testInfo.annotations.push({
        type: 'wave4-docs-summary',
        description: results
          .map((r) => `${r.no}.${r.status} ${r.title}${r.shots.length ? ` [${r.shots.join('; ')}]` : ''}`)
          .join(' | '),
      })
    }

    if (!(closeResult as CloseResult).ok) {
      // 已知 P2：长链路执行后主进程 window-all-closed 偶发不退出，harness kill 收尾；
      // 文档功能断言与 console 断言仍为硬门禁。
      testInfo.annotations.push({
        type: 'wave4-docs-p2-close',
        description: `Electron 未干净退出（${(closeResult as CloseResult).method}/${(closeResult as CloseResult).exitCode}），功能断言全 PASS`,
      })
    }
    expect(failures, `文档域 A2 失败：\n${failures.join('\n')}`).toStrictEqual([])
    expect(fatal, `致命 console/page error：\n${fatal.join('\n')}`).toStrictEqual([])
    expect(results.filter((r) => r.status === 'SKIP'), 'A2 不允许无条件 SKIP').toEqual([])
  })
})
